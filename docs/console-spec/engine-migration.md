# /engine → Console — CSS Token Migration

Exact changes to apply to your engine stylesheet to adopt the Console design system. The Console editor (`/dashboard`) already uses these tokens; this guide brings `/engine` into the same family so the two editors feel like siblings, not strangers.

## TL;DR

1. Add the Console token block to `:root`.
2. Rename existing dark-theme tokens to alias the Console ones.
3. Replace the top nav with the version selector component.
4. Swap the layer + library data model so the UI renders the renamed vocabulary.
5. Patch the empty stage hint.
6. Add the focused state, mobile breakpoints, and `prefers-reduced-motion` rules.

After this, `/engine` and `/dashboard` look like the same product. Picking "Console" in the version selector on either page routes to `/dashboard` (or `/?v=console`); picking "Neon/Film/Grid/Spectrum/Aurora" routes to a sibling route.

---

## 1. Token additions — drop into your `:root`

```css
:root {
  /* — surface ————————————————————————————— */
  --bg:           #0A0A0B;
  --bg-panel:     #111114;
  --bg-panel-2:   #16161B;
  --bg-elev:      #1C1C22;
  --line:         #232328;
  --line-strong:  #2E2E36;

  /* — text ——————————————————————————————— */
  --fg:           #E5E5E7;
  --fg-mute:      #8A8A92;
  --fg-faint:     #5A5A62;
  --fg-on-accent: #0A0A0B;

  /* — signal —————————————————————————————— */
  --signal:        #FF6B1A;   /* the ONE accent */
  --signal-soft:   #FF6B1A33; /* 20% alpha — fills */
  --signal-line:   #FF6B1A14; /*  8% alpha — grid */
  --signal-glow:   #FF6B1A08; /*  3% alpha — halos */
  --warn:          #FFD600;
  --error:         #FF3355;
  --ok:            #34D399;

  /* — type ——————————————————————————————— */
  --f-ui:    'Inter', system-ui, sans-serif;
  --f-mono:  'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace;

  /* — metrics ————————————————————————————— */
  --r-sm: 4px;  --r-md: 6px;  --r-lg: 10px;
  --sidebar-l-w: 240px;
  --sidebar-r-w: 280px;
  --top-h: 56px;
  --bottom-h: 64px;

  /* — motion ————————————————————————————— */
  --ease: cubic-bezier(.2,.8,.2,1);
  --dur-1: 120ms;
  --dur-2: 240ms;
}
```

## 2. Token rename map — keep your existing variable names working

If your engine currently uses different names, **alias them** to the Console tokens so every existing selector keeps working:

```css
:root {
  /* old → new (pick whichever side matches your current code) */
  --swr-bg:          var(--bg);
  --swr-bg-panel:    var(--bg-panel);
  --swr-bg-elev:     var(--bg-elev);
  --swr-fg:          var(--fg);
  --swr-fg-mute:     var(--fg-mute);
  --swr-fg-faint:    var(--fg-faint);
  --swr-line:        var(--line);
  --swr-accent:      var(--signal);
  --swr-accent-soft: var(--signal-soft);
  /* etc. — add as many aliases as your codebase needs */
}
```

Or — preferred — do a global find/replace from your old names to the new ones. The Console names are deliberately generic so they'll survive future versions.

## 3. Replace the top nav with the version selector

**Before** (your current `/engine`):

```html
<header id="transport">
  <button id="brandkit-chip">…</button>
  <button id="pt-chip">PT — activate</button>
  <a href="/">←</a>
  <button class="swr-tx-master">⏸</button>
  … 41 children, see audit notes …
</header>
```

**After**:

```html
<header class="top">
  <a class="brand" href="/">
    <span class="sw">SW</span>
    <span class="brand-text"><b>SAINTED</b><span>WORD RECORDS</span></span>
  </a>

  <nav class="versions" aria-label="Visual language">
    <a href="/versions/neon"     data-v="neon">Neon</a>
    <a href="/versions/film"     data-v="film">Film</a>
    <a href="/versions/grid"     data-v="grid">Grid</a>
    <a href="/versions/spectrum" data-v="spectrum">Spectrum</a>
    <a href="/versions/aurora"   data-v="aurora">Aurora</a>
    <span class="sep" aria-hidden="true"></span>
    <a href="/dashboard"         data-v="console" aria-current="page">Console</a>
  </nav>

  <div class="transport">
    <button class="btn-play" aria-label="Play">▶</button>
    <span class="time">0:00 / 0:00</span>
    <span class="wave"><!-- mini canvas --></span>
    <span class="pill">BPM <b>120</b></span>
    <span class="pill">KEY <b>A min</b></span>
    <a class="back" href="/">← Back</a>
  </div>
</header>
```

Add the matching CSS (copy the `.top`, `.brand`, `.versions`, `.transport` blocks from `console.html`).

The `aria-current="page"` attribute should be set server-side based on which version you're rendering. If you only have one engine page that swaps the visual via JS, set it client-side after reading `?v=` from the URL.

## 4. Rename layer + library vocabulary

If your data model is a JSON manifest like:

```json
{ "layers": [
  { "id": "shared",  "label": "Shared" },
  { "id": "aura",    "label": "Aura" },
  { "id": "grain",   "label": "Grain" },
  { "id": "halo",    "label": "Halo" },
  { "id": "marker",  "label": "Marker" }
]}
```

Replace with:

```json
{ "layers": [
  { "id": "waveform", "label": "Waveform", "hero": true },
  { "id": "spectrum", "label": "Spectrum" },
  { "id": "lfo",      "label": "LFO" },
  { "id": "key",      "label": "Key",      "hud": true },
  { "id": "meter",    "label": "Meter" }
]}
```

The `hero` flag promotes a layer to "big button, always visible." The `hud` flag tells the renderer this layer is a persistent data overlay (BPM/K HUD), not a visual element.

For library assets, replace the current 8 PNG cards with:

```json
{ "library": [
  { "id": "wave",  "label": "Wave",  "type": "svg" },
  { "id": "grid",  "label": "Grid",  "type": "svg" },
  { "id": "bar",   "label": "Bar",   "type": "svg" },
  { "id": "dot",   "label": "Dot",   "type": "svg" },
  { "id": "line",  "label": "Line",  "type": "svg" },
  { "id": "frame", "label": "Frame", "type": "svg" },
  { "id": "trace", "label": "Trace", "type": "svg" },
  { "id": "lfo",   "label": "LFO",   "type": "svg" }
]}
```

If users have saved projects that reference the old layer IDs, add an alias map so the rename is non-breaking:

```js
const LAYER_ALIAS = {
  shared: 'waveform',
  aura:   'spectrum',
  grain:  'lfo',
  halo:   'key',
  marker: 'meter',
};
```

## 5. Empty stage — replace the music note icon

**Before**:

```html
<div id="stage-empty">
  <h3>Algorithmic Audio-Reactive Engine</h3>
  <p>Load a song, drop a library of clips, hit play…</p>
</div>
```

**After**:

```html
<div id="stage-empty">
  <canvas id="stage-preview" width="800" height="500" aria-hidden="true"></canvas>
  <h3>Drop a song — or pick from the library</h3>
  <p class="hint-row">
    <button class="ghost" id="try-sample">Try a 30-second sample</button>
    <button class="ghost" id="open-library">Browse library</button>
  </p>
</div>
```

The preview canvas renders a static Console hero (wave + spectrum + corner ticks + HUDs). On `try-sample` click, load a bundled MP3 from `/assets/samples/*.mp3`. On `open-library` click, expand the Library panel.

## 6. Focus, motion, breakpoints — copy the global rules

Append to your stylesheet:

```css
*:focus { outline: 0; }
*:focus-visible {
  outline: 2px solid var(--signal);
  outline-offset: 2px;
  border-radius: var(--r-sm);
}

@media (max-width: 1100px) {
  :root { --sidebar-l-w: 200px; --sidebar-r-w: 240px; }
  .transport .wave { display: none; }
}
@media (max-width: 768px) {
  .workspace { grid-template-columns: 1fr; grid-template-rows: auto 50vh auto; }
  aside.l { border-right: 0; border-bottom: 1px solid var(--line); max-height: 30vh; }
  aside.r { border-left: 0; border-top: 1px solid var(--line); max-height: 30vh; }
  .lib-grid { grid-template-columns: repeat(4, 1fr); }
  .transport .pill, .transport .back { display: none; }
  .versions { overflow-x: auto; max-width: 50vw; }
}
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}

a.sr { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; border: 0; }
```

And add the skip link as the first focusable element of `<body>`:

```html
<a class="sr" href="#stage-canvas">Skip to canvas</a>
```

## 7. Drop the persona modal on the engine

The persona modal belongs on `/`, not on `/engine`. Currently both fire on the engine page. Add a flag to the modal component:

```js
const personaModal = document.querySelector('#persona-onboarding-modal');
if (personaModal && location.pathname.startsWith('/engine')) {
  personaModal.remove();
}
```

Or, cleaner, render the modal only on routes that include `/` or `/intro`:

```js
if (['/', '/intro'].includes(location.pathname)) showPersonaModal();
```

## 8. Add the bottom waveform bar (persistent data overlay)

Insert before the closing of `<section id="stage-wrap">` (or equivalent):

```html
<div class="bottom">
  <button class="adv">▾ ADVANCED</button>
  <div class="waveform">
    <span>WAVEFORM</span>
    <canvas id="bottomWave"></canvas>
    <b>BEATS</b>
  </div>
  <button class="rec">● REC</button>
</div>
```

Match the CSS from `console.html` (`.bottom`, `.adv`, `.waveform`, `.rec`). The bar should always be visible — even when the stage is empty.

## 9. Drop the brand chip fallback

Your `bk-chip-initial` shows `?` when the font fails. Set an explicit initial:

```html
<span class="bk-chip-initial">S</span>
```

Or hide the chip until a brand kit is loaded:

```js
const chip = document.getElementById('brandkit-chip');
if (!localStorage.getItem('swr-brand')) chip.style.display = 'none';
```

## 10. Move the PT (paywall) chip out of the top bar

Find:

```html
<button id="pt-chip" class="pt-chip">PT — activate</button>
```

Move it into a settings menu:

```html
<details class="settings-menu">
  <summary>Settings</summary>
  <a href="/pricing">Personal Tier — activate</a>
  <a href="/about">About</a>
</details>
```

The top bar shouldn't carry a paywall nudge as its second item.

---

## Acceptance checklist

After applying the migration, verify:

- [ ] Top nav shows the version selector, not the multi-tool tabs.
- [ ] Picking a version routes to the right page (`/versions/<name>` or `/dashboard` for Console).
- [ ] Active version gets the orange dot prefix and `aria-current="page"`.
- [ ] Background is `#0A0A0B`, accent is `#FF6B1A` everywhere — no other colors on the canvas itself.
- [ ] Layers panel shows `Waveform / Spectrum / LFO / Key / Meter`, not `Shared / Aura / Grain / Halo / Marker`.
- [ ] Library shows 8 geometric assets named `Wave / Grid / Bar / Dot / Line / Frame / Trace / LFO`.
- [ ] Bottom waveform bar is persistent and visible at all times.
- [ ] Empty stage shows a Canvas preview of the Console look, not a music note icon.
- [ ] Tab/keyboard focus has a designed 2px orange ring with 2px offset.
- [ ] Mobile (375px): stage takes full viewport, sidebars become scrollable bottom regions, version selector is horizontally scrollable.
- [ ] `prefers-reduced-motion: reduce` opts out of all transitions and animations.
- [ ] Persona modal does not appear on `/engine` or `/dashboard`.
- [ ] PT paywall chip is gone from the top bar.
- [ ] Old saved projects still load — layer ID aliases (`shared→waveform`, etc.) are wired.

If you want, the next deliverable is a PR-style diff that patches `engine.html` and `dashboard.html` in place rather than describing the changes here. Let me know.
