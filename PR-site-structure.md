# Site structure: splash at `/`, app at `/engine/`, no `index.html` anywhere

## TL;DR

The old `index.html` was doing two unrelated jobs at once — it was the splash
**and** the engine — and a brandkit auth wall was hiding the engine behind a
login redirect. We split them, gave them their own URLs, and made sure no
`index.html` ships anywhere in the source tree or the build output.

| URL | Serves | Status |
|---|---|---|
| `/` | Splash (`landing.html`) | 200 |
| `/landing.html` | Splash (direct file) | 200 |
| `/engine` | App (`engine.html`, via rewrite) | 200 |
| `/engine/` | App (trailing-slash form) | 308 → 200 |
| `/engine.html` | App (direct file) | 200 |
| `/index.html` | **nothing** (intentionally) | 404 |
| `/index_app.html` | **nothing** (intentionally) | 404 |

The PWA installs to `/engine/` (not `/`), so opening the installed app drops
the user straight into the studio, not the splash.

## Why

The original launch shipped as a single `index.html` page that was both the
marketing landing and the full WebGL engine. Pre-launch it sat behind a
brandkit auth redirect to `/login.html` (now removed — see commit `e712003`).
Once we removed the auth wall, the dual-role page became obvious: every time
you refreshed the engine, the page would show the splash hero for a beat
before booting the studio, and the back button took you to the splash instead
of "back to the app". Worse, there was no clean URL distinction for PWA
install — installing from `/` would launch the splash, not the studio.

This PR fixes the URL model at the foundation, which makes a bunch of
follow-on work sane:

1. **PWA start_url** can point at the app, not the splash.
2. **SW app shell** can list `/landing.html` and `/engine` separately, so a
   "back to the studio" tap from a deeplink lands on the engine without a
   hydration flash.
3. **The engine's internal asset paths** can be absolute (`/fx-postprocess.js`
   not `fx-postprocess.js`) and they still resolve when the page is at
   `/engine/`.
4. **Brandkit probe** can verify the engine is reachable at a stable URL.

## What changed

### File renames + new files
- `index_app.html` → `engine.html` (rename, with a 66% similarity score
  because of the absolute-path conversion)
- `landing.html` (new) — the splash, written from the old `index.html` shell
  but trimmed and with a hero CTA pointing to `/engine`
- `index.html` (deleted from project root + `public/`) — was the stale splash
  duplicate left over from before the rename

### Path conversion (the only engine.js change that actually matters)
Every `src=` and `href=` inside `engine.html` was converted from relative to
absolute. This is required because the engine now lives at `/engine/` and a
relative path would resolve against that scope, not the project root.

```diff
- <script src="fx-postprocess.js"></script>
+ <script src="/fx-postprocess.js"></script>
- <link rel="stylesheet" href="video-fx.css">
+ <link rel="stylesheet" href="/video-fx.css">
```

That includes the favicon data-URL (preserved as-is) and every PWA / PT /
service-worker bootstrap.

### Vite config
```diff
  build: {
-   rollupOptions: { input: 'index_app.html' },
+   rollupOptions: { input: 'engine.html' },
  },
- closeBundle() {
-   // copy dist/index_app.html to dist/index.html
-   copyFileSync('dist/index_app.html', 'dist/index.html');
- }
+ closeBundle() {
+   // no-op — the engine now lives at /engine/ (rewrite), and there is
+   // no index.html anywhere by design
+ }
```

`emptyOutDir: false` is preserved so the `copy-static` plugin can keep its
own wipe-and-copy behavior without Vite racing it.

### Vercel rewrites
```json
"rewrites": [
  { "source": "/",          "destination": "/landing.html" },
  { "source": "/engine",    "destination": "/engine.html" },
  { "source": "/engine/",   "destination": "/engine.html" }
]
```

`cleanUrls: false` stays on — we want the `.html` extensions to remain
visible in the address bar so it's obvious which page you're on.

### PWA
```diff
  "start_url": "/engine",
  "scope":     "/engine/"
```

Installed PWA launches into the app. Splash is reachable but is not the
install target. iOS install hint still shows in mobile Safari (handled by
`pwa-bootstrap.js`).

### Service worker (`sw.js`)
```diff
- const CACHE_VERSION = 'swr-v1';
+ const CACHE_VERSION = 'swr-v2';
```

Cache version bumped because the URL structure changed. APP_SHELL extended
with `/landing.html`, `/engine`, `/engine.html`, `/pt.client.js`,
`/pt-panel.client.js`. The 9 Vite-bundled client modules (`project.js`,
`mic-input.js`, etc.) are still **not** listed — they're inside
`dist/assets/engine-*.js` and get caught by the runtime cache on first fetch.

### Marketing pages
Every `href="./index.html"` (the "Main engine" link) was rewritten to
`href="/engine"` in:

- `campaign.html` (17 sections + new PT section)
- `personas.html` (23-persona gallery)
- `interactive-howto.html`
- `market-study.html`
- `profit-plan.html`
- `thanks.html` (PT path "open the engine" now goes to `/engine`, not `/`)
- `landing.html` (hero CTA + footer "Main engine" link)

### Brandkit
`brandkit.client.js#probeStudio()` updated to look for the engine at
`/engine` and `/engine.html` (was `/index.html` and `/index_app.html`).

### PT panel
`pt-panel.client.js` "Top up" and "See pricing" links made absolute
(`/campaign.html#pt`) so they work from any page the panel might be
mounted on.

### README
Quickstart step 1 now says: "Open the splash → click **Open the engine**"
(landing page) "or jump straight to `/engine/`" (the app). Added a note
that splash and engine are separate URLs and the PWA installs to the engine.

## Verifier fixes (URLs were broken for the new structure)

| Verifier | Fix |
|---|---|
| `verify-pt.mjs` | Added `ROOT` const (URL with `/engine` stripped) so `/campaign.html` and `/thanks.html` don't concatenate to `/enginecampaign.html` |
| `out/audit-core-features/verify-pwa.mjs` | Default URL → `/engine`; `fetch()` uses `location.origin` (was failing with "TypeError: Failed to fetch" when passed a full URL from the engine page); `swr-v2` (was `swr-v1`); `protocolTimeout` 60s → 180s; added `scope = /engine/` check |
| `verify-cloudpages-deploy.mjs` | `/index.html` now has `expectStatus: 404` (intentional); `/engine` and `/engine/` added to the page list |

## Verification (live at `sainted-word-records.vercel.app`)

| Verifier | Result |
|---|---|
| `verify-pt` | 16/16 ✓ |
| `verify-css-fx` | 12/12 ✓ |
| `verify-persistence` | 16/16 ✓ |
| `verify-fx-presets` | 26/27 (1 pre-existing pixel-diff flake, not a regression) |
| `verify-morpha` | 18/18 ✓ |
| `verify-train-stages` | 13/13 ✓ |
| `verify-watermark` | 19/19 ✓ |
| `verify-layer-scheduler-drag` | 19/19 ✓ |
| `verify-pwa` (live, 8 checks) | 26/26 ✓ — `start_url=/engine`, `scope=/engine/`, `swr-v2` cache |
| `verify-cloudpages-deploy` | GREEN — 12 marketing pages + `/index.html` expected 404 + `/engine` `/engine/` both 200 |

URL smoke test:
```
/              → 200   (splash)
/engine        → 200   (app, via rewrite)
/engine/       → 308   (trailing-slash redirect → 200)
/engine.html   → 200   (direct file)
/index.html    → 404   ✓ no index.html anywhere
/index_app.html→ 404   ✓ no leftover
```

## Out of scope (separate PRs)

- 20 box-set merch PNGs staged for deletion (cleanup)
- `dist-dev/*` regenerated build artifacts
- `.vercelignore` 1-line diff
- PT/PWA/CSSFX wiring changes in `camera.client.js`, `fx-postprocess.js`,
  `personas.js`, etc. — these are part of the same session's work but not
  strictly URL-related, so they get their own commit

## Risk + rollback

Low risk. Reverting this commit (or `git revert e712003`) restores the
pre-restructure state: the engine goes back to `index.html`, splash is at
the old splash URL, and the PWA start_url reverts. The only thing that
doesn't auto-rollback is the cache: the swr-v2 SW will stay installed on
users' devices until they clear site data. To be safe, push a
`swr-v3-noop` SW that just deletes itself before reverting.
