# Deployed-app debugging — alias lag, caches, and visual render loops

Lessons from debugging "media upside down / flipped" in the sainted-word-records
audio-reactive engine. The user reported the same symptom four times across
four turns while I patched code and pushed fresh deploys. Each patch was real;
none of them fixed the user's view. The root cause was something I checked
last: **which deployment was the user's URL actually serving?**

## The diagnostic that should come earlier

Before deep-diving code, before even reading the relevant files, run:

```bash
# 1. Which Vercel deployments exist (newest first)?
vercel ls --limit 5

# 2. Which aliases exist?
vercel alias ls

# 3. What does the user's URL actually serve RIGHT NOW?
curl -s https://<user-domain>/<path-to-suspect.js> | grep <pattern from latest fix>

# 4. Compare fresh-vs-cached etags
curl -sI https://<user-domain>/<path> | grep -iE "etag|x-vercel-cache|date"
```

If the URL serves stale content (older than your latest commit), the fix is
**alias promotion, not more code changes**:

```bash
# Pin the user-visible domain to the latest deployment
LATEST=$(vercel ls --limit 1 | grep -oE 'https://[^ ]+-kai-djurics-projects.vercel.app' | head -1)
vercel alias set "$LATEST" <user-visible-domain>
```

Vercel auto-deploys on push but does **not** auto-promote team-level aliases
(`<project>-kai-djurics-projects.vercel.app`). You have to `vercel alias set`
manually. If you skip this, the user keeps seeing the old build while you
think you've shipped a fix.

## Cache-busting for the user

After promoting an alias, also confirm the CDN cache serves the new content:

- `x-vercel-cache: HIT` from `curl -sI` is fine if the etag matches the new build.
- For browser-side caches, the user needs a hard refresh (Cmd+Shift+R /
  Ctrl+Shift+R). Adding `?v=<sha>` or `?t=<timestamp>` to the URL bypasses
  intermediate caches.
- If you see `cache-control: public, max-age=0, must-revalidate` that's correct
  — the browser will revalidate, the CDN should too.

## Visual rendering — the puppeteer probe pattern

When the user says "X is upside-down / flipped / wrong-looking" and the canvas
is HTML5, you can't see it from the agent loop. Spawn a probe:

```javascript
import puppeteer from 'puppeteer';
const browser = await puppeteer.launch({
  headless: 'new',
  args: ['--no-sandbox','--disable-setuid-sandbox','--autoplay-policy=no-user-gesture-required'],
  defaultViewport: { width: 1400, height: 900 },
});
const page = await browser.newPage();
const logs = [];
page.on('console', m => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', e => logs.push(`[PE] ${e.message}`));
await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
// wait for any app-defined ready promise, with fallback
await page.waitForFunction(() => window.__appReady, { timeout: 8000 }).catch(() => {});
// dismiss any autoplay overlay
try { await page.click('#start', { timeout: 800 }); } catch {}
// let one render cycle settle
await new Promise(r => setTimeout(r, 3000));
// capture
const canvas = await page.$('#render');
if (canvas) await canvas.screenshot({ path: '/tmp/render.png' });
// dump live state — layers, audio features, rotation values, etc.
const state = await page.evaluate(() => ({
  layers: window.SWR?.Layers?.list?.map(l => ({
    id: l.id, asset: l.asset?.name,
    rot: l._rot,
    reactors: l.reactors?.filter(r => r.target === 'rot').map(r => `${r.feature}→${r.target}×${r.scale}`),
  })),
  audio: window.SWR?.Audio ? {
    playing: window.SWR.Audio.playing,
    feat: window.SWR.Audio.feat,
    sens: window.SWR.Audio.params?.sens,
  } : null,
}));
console.log(JSON.stringify(state, null, 2));
```

For pixel-level analysis of the screenshot (ASCII view, axis-flip similarity,
quadrant brightness), use PIL:

```python
from PIL import Image
import numpy as np
img = np.array(Image.open('/tmp/render.png'))
h, w = img.shape[:2]
# Horizontal-mirror diff: low = image is horizontally symmetric
left = img[:, :w//2].astype(int)
right = np.fliplr(img[:, w//2:]).astype(int)
print(f'horizontal mirror diff: {np.abs(left - right).mean():.2f}')
# Top-bottom diff: low = vertically symmetric
top = img[:h//2].astype(int)
bot = np.flipud(img[h//2:]).astype(int)
print(f'vertical mirror diff: {np.abs(top - bot).mean():.2f}')
# 180°-rotation diff: low = the image is already a 180° rotation of itself
img_rot = np.rot90(img, 2)
print(f'180° rotation diff: {np.abs(img.astype(int) - img_rot.astype(int)).mean():.2f}')
```

If `180° rotation diff` is HIGH (~80-100 for a typical composition), the image
is NOT currently a 180° rotation. If it's LOW (~10-20), the image is symmetric
under 180° (could be a flag, a textile pattern, etc. — usually not a bug).

For delegating vision description back into the loop: `delegate_task` with a
sub-agent that has access to `browser_exec` or PIL. Have them crop the canvas
region (e.g. `img[60:840, 240:1160]` to exclude sidebars) and describe what
they see in terms of orientation: are buildings standing up or on their roofs?
is text forwards or backwards? are faces right-side-up or upside-down?

## The two transformation gotchas that bit this session

### 1. `Math.asin(Math.sin(x))` is the wrong rotation clamp

The author meant to wrap accumulated rotation into `(-90°, +90°]` to "never
visibly flip 180°". But `asin(sin(x))` is **discontinuous**: it maps 170° → 10°
(positive) but 190° → -10° (negative). The layer visibly flips sign every
~180° of accumulation, even though the absolute magnitude is bounded.

The right wrap: `((x + 540) % 360) - 180` — preserves sign, only wraps at the
±180° boundary. Rotation stays continuous; the user no longer sees "the layer
is facing the wrong way".

### 2. Magic-multiplier reactors + per-frame accumulation = hidden spin

In `applyR(l)`, reactor scale is multiplied by a target-specific magic number
(`out.rot += v * 30`, `out.hue += v * 60`, `out.x += v * 200`). With reactor
`scale: 60` and `sens: 1.5`, `v` reaches `0.5 * 60 * 1.5 = 45`, then `* 30`
gives `1350°` accumulated **per audio frame**. At 60fps that's 7-8 full
rotations per second. The user sees a violent spin / flipped layer.

Two fixes that compound:

- **Read `r.scale` straight**: drop the magic 30/60/200 multipliers. The
  reactor's `r.scale` is the per-reactor gain in its target's natural units
  (degrees for rot, pixels for x/y, degrees for hue, scale-factor for scale).
- **Cap per-frame magnitudes** by keeping `r.scale` small (3-15 for rot, not
  60-180). Layer rotation then advances 1-3°/frame — visible motion, no spin.

### 3. Legacy-fallback reactor scales can hide behind persistence

`lib/persist-wire.client.js` ships a `DEFAULT_REACTOR_PRESETS` array used as
the fallback when a persisted snapshot lacks a `reactors` field. If the
fallback has `rot` reactors with `scale: 180` while the inline variant presets
cap at `scale: 60`, **a user who reloads the page** (re-hydrating from
localStorage) silently picks up the larger scale. They don't add a new layer;
they reload, and the layer that was added in the previous session now spins.
The fix is to keep the fallback scales in sync with the inline ones — verify
both files in `lib/` and `versions/*.html` and the manifests, not just the
HTML the user is looking at.

## When the user re-reports the same bug

If the user comes back with the same symptom after your fix:

1. **Verify the fix is live at the URL they used** (not the URL you tested).
   `curl -s https://<their-domain>/path | grep <your-fix-marker>`. If absent,
   it's an alias/cache issue — promote, then ask them to hard-refresh.
2. **Re-probe and re-analyze** from scratch, even if it feels redundant.
   Don't anchor on your first theory. The user wouldn't re-report if your
   fix worked; either the fix didn't land, or you fixed the wrong thing.
3. **Read the live state**, not just code. Reactor scales that look fine in
   source can multiply through `sens` and frame-rate to produce effects
   invisible in the static source.
4. **One variable per change** — when you change `applyR`, change the inline
   presets in the same commit so the next reload picks up both. Otherwise
   you'll see "the fix didn't work" when really the new code is computing a
   new value with the old preset.
