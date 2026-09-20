# Phase 0 Audit — Port `music_video` automix+curator stack to all variants

**Date:** 2026-09-20
**Owner:** Kai (orchestrator)
**Status:** READY FOR IMPLEMENTATION

## Baseline confirmation

`verify-automix.mjs` ran **19/19 green** against `versions/music_video.html` on 2026-09-20.
The automix pipeline (adaptive tick, blend interpolation, freeze/save/lock/debug,
keyboard shortcuts A/F/B/K/D, URL deep-links, cleanup) is functional in music_video.

`verify-music-video-maker.mjs` requires an external dev server (`:5174`) and was
**not run** during the audit. Run it manually before Phase 2.

`verify-mvm-review-fixes.mjs` likewise requires an external dev server.

---

## Scope decision recap

- **Hologram stack stays music_video-only** (3D renderer is a variant identity, not
  functionality). Not ported.
- **Dashboard surfaces state** (subscribes to existing stores), does not run a
  second engine instance.

## What we're porting (the 11-script standard)

The automix + asset-curator + state-stores stack. **11 scripts, exact order matters.**
Source order from `versions/music_video.html:359-369`:

```
1.  <script src="../client/preset-anchor-map.client.js"></script>
2.  <script src="../client/anchor-embed.js"></script>
3.  <script src="../client/automix.client.js"></script>
4.  <script src="../client/section-detector.client.js" defer></script>
5.  <script src="../client/preset-cycle.client.js"></script>
6.  <script src="../client/preset-pick-store.client.js"></script>
7.  <script src="../client/layer-state-store.client.js"></script>
8.  <script src="../client/last-mix-store.client.js"></script>
9.  <script src="../client/asset-curator.client.js"></script>
10. <script src="../client/library-packs.client.js" defer></script>
11. <script src="../client/track-analyzer.client.js"></script>     <!-- music_video.html:4281 -->
```

All 11 scripts **exist on disk** and are healthy (verified 2026-09-20).

### Why this order matters

- 1–2 (`preset-anchor-map` + `anchor-embed`) export window-attached helpers used by 3+
- 3 (`automix`) reads helpers from 1–2, schedules ticks
- 4 (`section-detector`, `defer`) consumes audio analysis asynchronously
- 5–8 (`preset-cycle`, `preset-pick-store`, `layer-state-store`, `last-mix-store`) are
  the state machines automix mutates; they must be loaded before automix fires its
  first tick
- 9 (`asset-curator`) drives the hero-panel UI based on automix state
- 10 (`library-packs`, `defer`) augments the library with curated packs; defer is fine
  because it's a fetch
- 11 (`track-analyzer`) is loaded separately (music_video:4281) — *not* in the
  contiguous 359–369 block — because it depends on audio loading completing first

**Insertion point convention:** drop the first 10 in a contiguous block right after
the existing `engine-render.client.js` script tag. Add `track-analyzer.client.js` at
the same position variants already load `audio-analysis-v2.js` (after `recorder`,
near the end of the script list).

---

## The 5 UI panels (HTML markup to add)

Source: `versions/music_video.html:445,454-477,522-529`.

### Panel A — `#mood-overlay` (inside `<section class="stage">`, after `<canvas id="render">`)

```html
<img id="mood-overlay" alt="mood reference"
     style="position:fixed;top:16px;right:16px;width:160px;height:auto;opacity:0.3;
            z-index:50;display:none;cursor:move;border:1px solid var(--line);" />
```

### Panel B — `#hook-panel` (inside `<aside class="layers">`, before the existing layer
list / at top of the aside)

```html
<div id="hook-panel" style="display:none;padding:6px 8px 8px;border-bottom:1px solid var(--line);background:var(--panel-2);">
  <div class="ph">
    <span>Hook Export</span>
    <button id="hook-clear" class="tbtn" title="Clear detected drop" style="padding:1px 6px;font-size:10px;line-height:1;">×</button>
  </div>
  <div id="hook-info" style="font-size:9px;color:var(--muted);padding:2px 0 4px;">
    <span>drop: <b id="hook-time">—</b></span> · <span>energy: <b id="hook-energy">—</b></span> · <span>conf: <b id="hook-conf">—</b></span>
  </div>
  <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:2px;">
    <button class="tbtn hook-preset" data-preset="teaser" style="padding:3px 6px;font-size:9px;">Teaser 3s</button>
    <button class="tbtn hook-preset" data-preset="hook"    style="padding:3px 6px;font-size:9px;">Hook 5s</button>
    <button class="tbtn hook-preset" data-preset="clip"    style="padding:3px 6px;font-size:9px;">Clip 15s</button>
  </div>
</div>
```

### Panel C — `#hero-panel` (inside `<aside class="layers">`, immediately after hook-panel)

```html
<div id="hero-panel" style="display:none;padding:6px 8px 8px;border-bottom:1px solid var(--line);background:var(--panel-2);">
  <div style="display:flex;align-items:center;gap:6px;font-size:9px;letter-spacing:0.08em;color:var(--muted);text-transform:uppercase;margin-bottom:4px;">
    <span style="flex:1;">Hero Frames</span>
    <span id="hero-count" style="color:var(--c);">0</span>
    <button id="hero-clear" class="tbtn" title="Clear captured frames" style="padding:1px 6px;font-size:10px;line-height:1;">×</button>
  </div>
  <div id="hero-thumbs" style="display:grid;grid-template-columns:repeat(3,1fr);gap:2px;min-height:48px;"></div>
  <div style="display:flex;gap:4px;padding-top:4px;">
    <button id="hero-grab"    class="tbtn" style="flex:1;padding:3px 6px;font-size:9px;">Grab now</button>
    <button id="hero-suggest" class="tbtn" style="flex:1;padding:3px 6px;font-size:9px;">Suggest 3</button>
  </div>
</div>
```

### Panel D — Toolbar buttons (inside `<footer>`, append to the `<span class="gc">` row
containing the existing decay slider, before the `<span class="spacer">`)

```html
<span class="gc"><button class="tbtn" id="hook-btn"  title="Detect drop + export hook clips (teaser 3s / hook 5s / clip 15s)" style="padding:3px 8px;font-size:9px;">Hooks</button></span>
<span class="gc"><button class="tbtn" id="stats-btn" title="Local render statistics"                                                                  style="padding:3px 8px;font-size:9px;">Stats</button></span>
<span class="gc"><button class="tbtn" id="mood-btn"  title="Mood board: analyze a reference image + suggest engine mapping"                          style="padding:3px 8px;font-size:9px;">Mood</button></span>
<span class="gc"><button class="tbtn" id="scenes-btn" title="Scene pads (4): click=recall, hold 1s=save"                                                style="padding:3px 8px;font-size:9px;">Scenes</button></span>
<span class="gc" style="border-left:1px solid var(--line);padding-left:14px;margin-left:4px;">
  <label class="tbtn" id="automix-toggle" style="cursor:pointer;">Automix <span id="automix-state" style="color:var(--m);">OFF</span></label>
  <button class="tbtn" id="automix-freeze" title="Freeze: stop ticking but keep the current blend (F)" style="padding:3px 8px;font-size:9px;margin-left:6px;">Freeze</button>
  <button class="tbtn" id="automix-save"   title="Save the current blend as a manual preset (B)"     style="padding:3px 8px;font-size:9px;margin-left:2px;">Save</button>
  <button class="tbtn" id="automix-lock"   title="Lock to the single nearest anchor (K)"             style="padding:3px 8px;font-size:9px;margin-left:2px;">Lock</button>
  <button class="tbtn" id="automix-debug"  title="Toggle the automix debug panel (D)"                style="padding:3px 8px;font-size:9px;margin-left:2px;">Debug</button>
</span>
```

### Panel E — `#automix-debug-panel` (immediately after the footer block, before `</body>`)

```html
<div id="automix-debug-panel" hidden style="position:fixed; bottom:80px; right:14px; z-index:9999; background:rgba(10,10,16,0.92); color:var(--fg); padding:14px 18px; border:1px solid var(--line); border-radius:8px; font-family:var(--font-mono); font-size:11px; min-width:240px; max-width:340px; line-height:1.55;">
  <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
    <b style="letter-spacing:0.1em; text-transform:uppercase;">Debug</b>
    <button id="automix-debug-close" title="Close" style="background:none; border:none; color:var(--muted); cursor:pointer; font-size:16px; line-height:1;">×</button>
  </div>
  <div id="automix-debug-body" style="color:var(--fg-mute);">idle</div>
</div>
```

---

## Per-surface checklist

### Phase 2 — `engine.html`

- **Add 10 scripts** after `engine-render.client.js` script tag (insertion line ~1600)
- **Add `track-analyzer.client.js`** near `audio-analysis-v2.js` (insertion line ~1640)
- **Add Panel A** (`#mood-overlay`) inside `<section class="stage">` (insertion line ~1900)
- **Add Panels B + C** (`#hook-panel`, `#hero-panel`) inside `<aside id="layers">` (insertion line ~2080)
- **Add Panel D** (toolbar buttons) inside `<footer id="global">` (insertion line ~2106, before spacer)
- **Add Panel E** (`#automix-debug-panel`) before `</body>` (insertion line ~8400)
- **New verify:** `verify-engine-automix.mjs` — load engine.html, assert 11 scripts
  present, assert 5 panels in DOM, drive automix toggle and assert blend evolution
- **No new test for hologram** (skipped per scope decision)
- **Tie-in:** engine.html already has `client/variant-switcher.client.js` and uses
  `window.SWR_VARIANTS.postFx()` — the variant system is already integrated; this
  work only adds automix capability to the runtime

### Phase 3A — `versions/neon.html` + `versions/film.html` (one PR)

For each file:

- Insert 10-script block after `engine-render.client.js` (neon:281, film:281)
- Insert `track-analyzer.client.js` near `audio-analysis-v2.js`
- Insert Panel A inside `<section class="stage">` (neon:349, film:352)
- Insert Panels B + C inside `<aside class="layers">` (neon:356, film:359)
- Insert Panel D inside `<footer>` before the `<span class="spacer">` row (neon:~358, film:~361)
- Insert Panel E before `</body>`
- New verify scripts: `verify-neon-automix.mjs`, `verify-film-automix.mjs`

### Phase 3B — `versions/grid.html` + `versions/smoke.html` + `versions/hallucination.html` (one PR)

Same recipe, different line numbers:

| Variant         | Insertion points (anchor: `engine-render.client.js` → stage → layers → footer) |
|-----------------|-------------------------------------------------------------------------------|
| `grid.html`     | scripts after 333; stage after 404; layers after 413; footer before 417 spacer |
| `smoke.html`    | scripts after 274; stage after 341; layers after 348; footer before 352 spacer |
| `hallucination.html` | scripts after 392; stage after 458; layers after 465; footer before 469 spacer |

- New verify scripts: `verify-grid-automix.mjs`, `verify-smoke-automix.mjs`,
  `verify-hallucination-automix.mjs`

### Phase 4 — `dashboard.html`

**Tie-in:** `dashboard-engine.client.js` is the only existing client script. The
dashboard subscribes to engine state via `window.SWR_*` global stores. To surface
automix + curator state:

- Add to `dashboard.html` markup: three read-only tiles (Automix status, Hero count,
  Section detector state) — read from `window.SWR_AUTOMIX_STATE`,
  `window.SWR_LAYER_STATE`, `window.SWR_HERO_FRAMES` (verify these are exposed;
  if not, expose them in the relevant `.client.js`)
- Subscribe in `dashboard-engine.client.js` to `MutationEvent` or `storage` event so
  the dashboard updates live
- New verify: `verify-dashboard-automix-tiles.mjs` — load dashboard, assert the 3
  tiles exist, assert they update when stores change

### Phase 5 — Cross-surface verify

- Add `verify-automix-cross-surface.mjs`: boot each surface (engine, neon, film, grid,
  smoke, hallucination, music_video), assert the 11 scripts are loaded as
  `ScriptElement`s in the DOM, assert 5 panels are present in markup, report any drift
- Wire all new `verify:*` scripts into `npm run check:full`
- Build size audit: confirm `dist/` size delta ≤ 9 MB (66 MB → ≤ 75 MB)

---

## Risks & mitigations

| Risk                                                                    | Mitigation                                                                                  |
|-------------------------------------------------------------------------|---------------------------------------------------------------------------------------------|
| Per-variant sidebar CSS differs (grid: thicker borders, smoke: opacity) | Phase 0 audit confirms style overrides are inline `style="..."` — overrides win over CSS    |
| `engine.html` already has 22 missing scripts (vs variants' 11)          | Some engine.html missing scripts are *replaced* by `type="module"` siblings — verify each  |
| automix exposes `window.SWR_AUTOMIX_STATE` after Phase 1; dashboard expects it | Phase 4 audit confirms export names; add `window.SWR_*` aliases if needed             |
| Track-analyzer depends on audio loading — loading order with `audio-analysis-v2.js` matters | Document the order in Phase 1's loader helper |
| 5 variants × 5 panels × ~30 lines/panel = ~750 lines of HTML added       | Use copy-paste with `sed`/`edit` rather than hand-editing; verify line counts in PR review |

---

## Estimated effort

- Phase 2 (engine.html): 3 hr
- Phase 3A (neon + film): 4 hr (both)
- Phase 3B (grid + smoke + hallucination): 6 hr (3 variants × 2 hr)
- Phase 4 (dashboard): 1 hr
- Phase 5 (verify + ship): 1 hr

**Total: ~15 hr wall-clock**, parallelizable to ~10 hr with one helper.

## Branch strategy

- `feat/port-music-video-automix` long-lived branch
- 5 PRs: Phase 0 (audit) ✅, 1 (engine.html), 2A (neon+film), 2B (grid+smoke+hallucination), 3 (dashboard)
- Each PR green on `npm run check:full` before merge
- Vercel auto-deploys per PR for visual review