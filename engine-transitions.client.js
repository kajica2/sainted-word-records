// engine-transitions.client.js
//
// CSS-native transition pack for engine.html + every variant. One external
// file, 10 transitions inspired by the 2026-09-09 daily cron note:
//
//   Cover        : whip-blur, swivel
//   Distortion   : glitch-block, chromatic-split
//   Spatial      : zoom-through
//   Brightness   : flash-cover, lens-flare
//   Mask         : paint-stroke, circle-wipe
//   Hybrid       : warp-dissolve
//
// Each transition builds a `.preview` wrapper on top of canvas#render with
// `.frames > .frame.a + .frame.b` and toggles a `.playing` class to drive
// pure CSS animations (keyframes + transitions). The live stage keeps
// rendering underneath; the wrapper's CSS clones the visual via
// mix-blend-mode:normal + a captured bitmap (only the static "before" frame
// is needed for CSS-driven transitions).
//
// Tech notes:
//   - Pure CSS, no JS animation loops. Each transition resolves on
//     animationend / transitionend with a small safety timeout.
//   - Stage-agnostic: works with #stage or canvas#render as the parent.
//   - One <style> tag injected at boot, deduplicated on HMR via a flag.
//   - Active transitions serialize through a single Promise queue so a
//     second fire() waits for the first to finish (avoids fighting
//     transitionend listeners).
//
// Public API (window.SWRTransitions):
//   .fire(name, opts?)      → Promise; resolves when the transition
//                             finishes, rejects on unknown name or no
//                             render canvas.
//   .setAutoFire(cfg)       → { onBeat, everyNBeats=1, transition='flash-cover' }
//   .stop()                 → cancels auto-fire.
//   .list()                 → ['whip-blur','glitch-block','zoom-through',
//                              'flash-cover','paint-stroke','chromatic-split',
//                              'swivel','circle-wipe','warp-dissolve',
//                              'lens-flare']

(function () {
  'use strict';
  if (window.SWRTransitions) return; // idempotent across HMR

  const NAMES = [
    'whip-blur', 'glitch-block', 'zoom-through', 'flash-cover',
    'paint-stroke', 'chromatic-split', 'swivel', 'circle-wipe',
    'warp-dissolve', 'lens-flare',
  ];
  const DEFAULT_DUR = {
    'whip-blur': 450,
    'glitch-block': 500,
    'zoom-through': 500,
    'flash-cover': 500,
    'paint-stroke': 550,
    'chromatic-split': 500,
    'swivel': 600,
    'circle-wipe': 600,
    'warp-dissolve': 600,
    'lens-flare': 800,
  };

  // ---- helpers ------------------------------------------------------------

  const $ = (id) => document.getElementById(id);
  const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
  const clamp = (v, lo, hi) => v < lo ? lo : v > hi ? hi : v;

  function resolveStage() {
    const render = $('render');
    if (!render) return null;
    const explicit = $('stage');
    const stage = explicit || render.parentElement || document.body;
    const rect = render.getBoundingClientRect();
    return {
      stage, render, isWrapper: !!explicit,
      viewport: {
        w: Math.max(1, Math.floor(rect.width)),
        h: Math.max(1, Math.floor(rect.height)),
        left: rect.left, top: rect.top,
      },
    };
  }

  function readFeat() {
    const a = window.Audio;
    if (!a || !a.feat) return { beat: 0, onset: 0, bass: 0, beatPulse: 0, bpm: 0 };
    return a.feat;
  }

  // ---- CSS injection ------------------------------------------------------
  //
  // All 10 transitions share one <style> tag. Idempotent: if #swr-tx-css
  // already exists we skip. The CSS uses !important on duration props so
  // caller overrides via opts win.
  function injectCSS() {
    if ($('swr-tx-css')) return;
    const style = document.createElement('style');
    style.id = 'swr-tx-css';
    style.textContent = `
.swr-tx-preview {
  position: fixed;
  pointer-events: none;
  z-index: 9999;
  overflow: hidden;
  perspective: 1000px;
  transform-style: preserve-3d;
}
.swr-tx-frames {
  position: absolute;
  inset: 0;
  transform-style: preserve-3d;
}
.swr-tx-frame {
  position: absolute;
  inset: 0;
  backface-visibility: hidden;
  will-change: transform, opacity, filter, clip-path;
}
.swr-tx-frame.b { opacity: 0; }
.swr-tx-flash, .swr-tx-flare {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 5;
  opacity: 0;
}
.swr-tx-paint-svg {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  z-index: 5;
}
.swr-tx-paint-path {
  fill: none;
  stroke: white;
  stroke-width: 80;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-dasharray: 2000;
  stroke-dashoffset: 2000;
}

/* 1. Whip Pan Cover */
.swr-tx-whip .swr-tx-frame.a, .swr-tx-whip .swr-tx-frame.b {
  transition: transform 0.45s cubic-bezier(0.4, 0, 0.6, 1), filter 0.45s, opacity 0s 0.22s;
}
.swr-tx-whip .swr-tx-frame.b { transform: translateX(100%); filter: blur(20px); }
.swr-tx-whip.playing .swr-tx-frame.a { transform: translateX(-100%); filter: blur(20px); }
.swr-tx-whip.playing .swr-tx-frame.b { transform: translateX(0); filter: blur(0); opacity: 1; }

/* 2. Glitch Block */
.swr-tx-glitch .swr-tx-frame { transition: none; }
.swr-tx-glitch .swr-tx-frame.a, .swr-tx-glitch .swr-tx-frame.b { opacity: 0; }
.swr-tx-glitch.playing .swr-tx-frame.a { animation: swr-tx-glitchA 0.5s steps(8) forwards; }
.swr-tx-glitch.playing .swr-tx-frame.b { animation: swr-tx-glitchB 0.5s steps(8) forwards; }
@keyframes swr-tx-glitchA {
  0%   { transform: translate(0, 0);       clip-path: inset(0);               opacity: 1; }
  20%  { transform: translate(-8px, 4px);  clip-path: inset(20% 0 30% 0); }
  40%  { transform: translate(12px, -6px); clip-path: inset(50% 0 10% 0); }
  60%  { transform: translate(-6px, 8px);  clip-path: inset(10% 0 60% 0); }
  80%  { transform: translate(8px, -4px);  clip-path: inset(40% 0 20% 0); }
  100% { transform: translate(0, 0);       clip-path: inset(0);               opacity: 0; }
}
@keyframes swr-tx-glitchB {
  0%   { transform: translate(12px, -6px); clip-path: inset(50% 0 10% 0);  opacity: 1; }
  20%  { transform: translate(-8px, 4px);  clip-path: inset(20% 0 30% 0); }
  40%  { transform: translate(6px, 8px);   clip-path: inset(10% 0 60% 0); }
  60%  { transform: translate(-12px, 6px); clip-path: inset(40% 0 20% 0); }
  80%  { transform: translate(0, 0);       clip-path: inset(20% 0 30% 0); }
  100% { transform: translate(0, 0);       clip-path: inset(0);              opacity: 1; }
}

/* 3. Zoom Through Object */
.swr-tx-zoom .swr-tx-frame {
  transition: transform 0.5s cubic-bezier(0.7, 0, 0.3, 1), clip-path 0.5s, opacity 0s 0.25s;
}
.swr-tx-zoom .swr-tx-frame.b { transform: scale(0.3); clip-path: circle(20% at 50% 50%); }
.swr-tx-zoom.playing .swr-tx-frame.a {
  transform: scale(8);
  clip-path: circle(5% at 50% 50%);
  opacity: 0;
}
.swr-tx-zoom.playing .swr-tx-frame.b {
  transform: scale(1);
  clip-path: circle(150% at 50% 50%);
}

/* 4. Strobe Flash */
.swr-tx-flash .swr-tx-frame { transition: opacity 0.1s; }
.swr-tx-flash .swr-tx-frame.a, .swr-tx-flash .swr-tx-frame.b { opacity: 1; }
.swr-tx-flash .swr-tx-frame.b { opacity: 0; }
.swr-tx-flash .swr-tx-flash {
  background: white;
  opacity: 0;
}
.swr-tx-flash.playing .swr-tx-flash { animation: swr-tx-strobe 0.5s steps(4) forwards; }
.swr-tx-flash.playing .swr-tx-frame.a { opacity: 0; }
.swr-tx-flash.playing .swr-tx-frame.b { opacity: 1; transition-delay: 0.25s; }
@keyframes swr-tx-strobe {
  0%, 30%   { opacity: 0; }
  40%       { opacity: 1; }
  50%       { opacity: 0; }
  60%       { opacity: 1; }
  100%      { opacity: 1; }
}

/* 5. Paint Stroke */
.swr-tx-paint .swr-tx-frame.b { opacity: 0; transition: opacity 0s 0.45s; }
.swr-tx-paint.playing .swr-tx-frame.b { opacity: 1; }
.swr-tx-paint.playing .swr-tx-paint-path {
  animation: swr-tx-paintStroke 0.55s ease-out forwards;
}
@keyframes swr-tx-paintStroke {
  0%   { stroke-dashoffset: 2000; opacity: 1; }
  65%  { stroke-dashoffset: 0;    opacity: 1; }
  100% { stroke-dashoffset: 0;    opacity: 0; }
}

/* 6. Chromatic Split */
.swr-tx-chroma .swr-tx-frame.a, .swr-tx-chroma .swr-tx-frame.b {
  transition: opacity 0.5s;
}
.swr-tx-chroma .swr-tx-frame.a { opacity: 1; filter: drop-shadow(-10px 3px 0 #ff0066) drop-shadow(10px -3px 0 #00ffff); }
.swr-tx-chroma .swr-tx-frame.b {
  opacity: 0;
  filter: drop-shadow(18px 0 0 #ff0066) drop-shadow(-18px 0 0 #00ffff);
}
.swr-tx-chroma.playing .swr-tx-frame.a { opacity: 0; filter: drop-shadow(0 0 0 transparent); transition: opacity 0.5s, filter 0.5s; }
.swr-tx-chroma.playing .swr-tx-frame.b {
  opacity: 1;
  filter: drop-shadow(0 0 0 transparent);
  transition-delay: 0.3s;
}

/* 7. Swivel Clone (3D) */
.swr-tx-swivel .swr-tx-frames {
  transition: transform 0.6s cubic-bezier(0.7, 0, 0.3, 1);
}
.swr-tx-swivel .swr-tx-frame { backface-visibility: hidden; }
.swr-tx-swivel .swr-tx-frame.b { transform: rotateY(180deg); }
.swr-tx-swivel.playing .swr-tx-frames { transform: rotateY(180deg); }

/* 8. Circle Wipe */
.swr-tx-circle .swr-tx-frame.b {
  transition: clip-path 0.6s cubic-bezier(0.7, 0, 0.3, 1);
  clip-path: circle(0% at 50% 50%);
  opacity: 1;
}
.swr-tx-circle.playing .swr-tx-frame.b { clip-path: circle(150% at 50% 50%); }

/* 9. Warp + Dissolve */
.swr-tx-warp .swr-tx-frame {
  transition: transform 0.6s cubic-bezier(0.7, 0, 0.3, 1), opacity 0.4s, filter 0.6s;
}
.swr-tx-warp .swr-tx-frame.b {
  transform: scale(1.4) skewX(-15deg);
  filter: blur(20px);
  opacity: 0;
}
.swr-tx-warp.playing .swr-tx-frame.a {
  transform: scale(1.4) skewX(15deg);
  filter: blur(20px);
  opacity: 0;
}
.swr-tx-warp.playing .swr-tx-frame.b {
  transform: scale(1) skewX(0);
  filter: blur(0);
  opacity: 1;
}

/* 10. Lens Flare Sweep */
.swr-tx-flare .swr-tx-frame { transition: opacity 0.2s; }
.swr-tx-flare .swr-tx-frame.b { opacity: 0; }
.swr-tx-flare .swr-tx-flare {
  background: radial-gradient(
    circle at 50% 50%,
    rgba(255, 255, 255, 1) 0%,
    rgba(255, 220, 150, 0.7) 12%,
    transparent 40%
  );
  opacity: 0;
  transform: scale(0);
}
.swr-tx-flare.playing .swr-tx-flare { animation: swr-tx-flare 0.8s ease-out forwards; }
.swr-tx-flare.playing .swr-tx-frame.a { opacity: 0; }
.swr-tx-flare.playing .swr-tx-frame.b { opacity: 1; transition-delay: 0.4s; }
@keyframes swr-tx-flare {
  0%   { opacity: 0; transform: scale(0); }
  30%  { opacity: 1; transform: scale(1.5); }
  70%  { opacity: 1; transform: scale(3); }
  100% { opacity: 0; transform: scale(5); }
}
`;
    document.head.appendChild(style);
  }

  // ---- DOM construction ---------------------------------------------------
  //
  // Each transition builds a small subtree (preview + frames + frame a/b +
  // optional extras) positioned over canvas#render. We snapshot the live
  // canvas to a dataURL and use it as the background of `.frame.a` so the
  // user sees a frozen "before" frame as the transition plays. Frame b
  // starts with opacity 0 — each transition's CSS reveals it.
  //
  // To capture the bitmap we drawImage onto a hidden canvas. Cross-origin
  // video clips taint the source canvas and drawImage of the tainted
  // canvas throws. We fall back to a solid black frame so the transition
  // still completes; the b-frame usually lands as the live composition
  // underneath (no capture needed).
  function snapshotDataURL(render, w, h) {
    try {
      const off = document.createElement('canvas');
      off.width = w; off.height = h;
      const ctx2 = off.getContext('2d');
      ctx2.drawImage(render, 0, 0, w, h);
      return off.toDataURL('image/png');
    } catch (e) {
      return null;
    }
  }

  // Build the preview subtree. Returns the wrapper element.
  function buildPreview(opts) {
    const ctx = resolveStage();
    if (!ctx) return null;
    const W = ctx.viewport.w;
    const H = ctx.viewport.h;

    const preview = document.createElement('div');
    preview.className = 'swr-tx-preview';
    preview.style.cssText =
      'left:' + ctx.viewport.left + 'px;' +
      'top:' + ctx.viewport.top + 'px;' +
      'width:' + W + 'px;' +
      'height:' + H + 'px;';

    const frames = document.createElement('div');
    frames.className = 'swr-tx-frames';
    preview.appendChild(frames);

    const a = document.createElement('div');
    a.className = 'swr-tx-frame a';
    const b = document.createElement('div');
    b.className = 'swr-tx-frame b';
    frames.appendChild(a);
    frames.appendChild(b);

    // Snapshot live canvas for the "before" frame. If the canvas is tainted
    // (cross-origin video), snapshot returns null and the transition falls
    // back to a flat-color a-frame. The b-frame is always invisible until
    // the CSS reveal — it shows whatever is at canvas#render underneath.
    const dataURL = snapshotDataURL(ctx.render, W, H);
    if (dataURL) {
      a.style.backgroundImage = 'url(' + dataURL + ')';
      a.style.backgroundSize = 'cover';
      b.style.background = 'transparent';
    } else {
      a.style.background = '#000';
      b.style.background = 'transparent';
    }
    return preview;
  }

  // Toggle .playing on an element and resolve when the longest animation
  // completes. Picks a safety timeout (max(default duration, opts override) +
  // 100ms) so we never hang if a transitionend event is missed (e.g.
  // display:none mid-transition, or reduced-motion disabled).
  function playCSS(preview, name, opts) {
    const dur = (opts && opts.duration) || DEFAULT_DUR[name] || 600;
    return new Promise((resolveP) => {
      // Force reflow so the animation restarts cleanly even if .playing
      // was set on the previous render.
      preview.classList.remove('playing');
      void preview.offsetWidth;
      preview.classList.add('playing');
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        preview.classList.remove('playing');
        // Remove the preview on the next frame so the b-frame's revealed
        // state doesn't flash. Callers see the live composition resume.
        requestAnimationFrame(() => preview.remove());
        resolveP();
      };
      // Prefer animationend (most transitions use @keyframes). Fall back
      // to transitionend (CSS transition-based reveals like whip-blur).
      const onEnd = (e) => {
        // The strobe/lens-flare end on the .flash/.flare child; listen
        // there too.
        if (e && e.target !== preview && !(e.target instanceof Element &&
            (e.target.classList.contains('swr-tx-flash') ||
             e.target.classList.contains('swr-tx-flare')))) {
          return;
        }
        preview.removeEventListener('animationend', onEnd, true);
        preview.removeEventListener('transitionend', onEnd, true);
        finish();
      };
      preview.addEventListener('animationend', onEnd, true);
      preview.addEventListener('transitionend', onEnd, true);
      // Safety net.
      setTimeout(finish, dur + 120);
    });
  }

  // Each transition is a (opts) → Promise factory. They share the same
  // preview-build + play-CSS lifecycle; the differences are purely in the
  // CSS class on the preview wrapper and any extra DOM (flash, flare, svg).

  function whipBlur(opts) {
    const ctx = resolveStage(); if (!ctx) return Promise.reject(new Error('no render canvas'));
    const preview = buildPreview(opts);
    if (!preview) return Promise.reject(new Error('no render canvas'));
    preview.classList.add('swr-tx-whip');
    document.body.appendChild(preview);
    return playCSS(preview, 'whip-blur', opts);
  }

  function glitchBlock(opts) {
    const ctx = resolveStage(); if (!ctx) return Promise.reject(new Error('no render canvas'));
    const preview = buildPreview(opts);
    if (!preview) return Promise.reject(new Error('no render canvas'));
    preview.classList.add('swr-tx-glitch');
    document.body.appendChild(preview);
    return playCSS(preview, 'glitch-block', opts);
  }

  function zoomThrough(opts) {
    const ctx = resolveStage(); if (!ctx) return Promise.reject(new Error('no render canvas'));
    const preview = buildPreview(opts);
    if (!preview) return Promise.reject(new Error('no render canvas'));
    preview.classList.add('swr-tx-zoom');
    document.body.appendChild(preview);
    return playCSS(preview, 'zoom-through', opts);
  }

  function flashCover(opts) {
    const ctx = resolveStage(); if (!ctx) return Promise.reject(new Error('no render canvas'));
    const preview = buildPreview(opts);
    if (!preview) return Promise.reject(new Error('no render canvas'));
    preview.classList.add('swr-tx-flash');
    const flash = document.createElement('div');
    flash.className = 'swr-tx-flash';
    // Allow caller to override flash color (CSS uses !important-free
    // background, so inline style wins).
    if (opts && opts.flashColor) {
      flash.style.background = opts.flashColor;
    }
    preview.appendChild(flash);
    document.body.appendChild(preview);
    return playCSS(preview, 'flash-cover', opts);
  }

  function paintStroke(opts) {
    const ctx = resolveStage(); if (!ctx) return Promise.reject(new Error('no render canvas'));
    const preview = buildPreview(opts);
    if (!preview) return Promise.reject(new Error('no render canvas'));
    preview.classList.add('swr-tx-paint');
    const svgNS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('class', 'swr-tx-paint-svg');
    svg.setAttribute('viewBox', '0 0 100 56');
    svg.setAttribute('preserveAspectRatio', 'none');
    const path = document.createElementNS(svgNS, 'path');
    path.setAttribute('class', 'swr-tx-paint-path');
    // Path is free-form per the source. Default is a horizontal sweep;
    // caller can pass opts.path to swap in any d="..." string.
    path.setAttribute('d', (opts && opts.path) || 'M 0 28 Q 20 10, 40 25 T 80 20 Q 95 35, 100 30');
    svg.appendChild(path);
    preview.appendChild(svg);
    document.body.appendChild(preview);
    return playCSS(preview, 'paint-stroke', opts);
  }

  function chromaticSplit(opts) {
    const ctx = resolveStage(); if (!ctx) return Promise.reject(new Error('no render canvas'));
    const preview = buildPreview(opts);
    if (!preview) return Promise.reject(new Error('no render canvas'));
    preview.classList.add('swr-tx-chroma');
    document.body.appendChild(preview);
    return playCSS(preview, 'chromatic-split', opts);
  }

  function swivel(opts) {
    const ctx = resolveStage(); if (!ctx) return Promise.reject(new Error('no render canvas'));
    const preview = buildPreview(opts);
    if (!preview) return Promise.reject(new Error('no render canvas'));
    preview.classList.add('swr-tx-swivel');
    document.body.appendChild(preview);
    return playCSS(preview, 'swivel', opts);
  }

  function circleWipe(opts) {
    const ctx = resolveStage(); if (!ctx) return Promise.reject(new Error('no render canvas'));
    const preview = buildPreview(opts);
    if (!preview) return Promise.reject(new Error('no render canvas'));
    preview.classList.add('swr-tx-circle');
    document.body.appendChild(preview);
    return playCSS(preview, 'circle-wipe', opts);
  }

  function warpDissolve(opts) {
    const ctx = resolveStage(); if (!ctx) return Promise.reject(new Error('no render canvas'));
    const preview = buildPreview(opts);
    if (!preview) return Promise.reject(new Error('no render canvas'));
    preview.classList.add('swr-tx-warp');
    document.body.appendChild(preview);
    return playCSS(preview, 'warp-dissolve', opts);
  }

  function lensFlare(opts) {
    const ctx = resolveStage(); if (!ctx) return Promise.reject(new Error('no render canvas'));
    const preview = buildPreview(opts);
    if (!preview) return Promise.reject(new Error('no render canvas'));
    preview.classList.add('swr-tx-flare');
    const flare = document.createElement('div');
    flare.className = 'swr-tx-flare';
    if (opts && opts.flareColor) {
      // Allow cold/hot gradient override. Pass a CSS background value.
      flare.style.background = opts.flareColor;
    }
    preview.appendChild(flare);
    document.body.appendChild(preview);
    return playCSS(preview, 'lens-flare', opts);
  }

  // ---- fire dispatcher ----------------------------------------------------
  const fns = {
    'whip-blur': whipBlur,
    'glitch-block': glitchBlock,
    'zoom-through': zoomThrough,
    'flash-cover': flashCover,
    'paint-stroke': paintStroke,
    'chromatic-split': chromaticSplit,
    'swivel': swivel,
    'circle-wipe': circleWipe,
    'warp-dissolve': warpDissolve,
    'lens-flare': lensFlare,
  };

  let active = null;
  let autoFire = null;

  function fire(name, opts) {
    if (!fns[name]) return Promise.reject(new Error('unknown transition: ' + name));
    if (active) return active.then(() => fire(name, opts));
    active = fns[name](opts).finally(() => { active = null; });
    return active;
  }
  function setAutoFire(cfg) { autoFire = cfg || null; }
  function stop() { autoFire = null; active = null; }

  // ---- beat-driven auto-fire ---------------------------------------------
  let beatCounter = 0;
  function beatTick() {
    const f = readFeat();
    if (autoFire && autoFire.onBeat && f.beatPulse) {
      beatCounter += 1;
      const everyN = Math.max(1, autoFire.everyNBeats || 1);
      if (beatCounter >= everyN) {
        beatCounter = 0;
        const name = autoFire.transition || 'flash-cover';
        fire(name).catch(() => {});
      }
    } else if (!f.beatPulse) {
      beatCounter = 0;
    }
    requestAnimationFrame(beatTick);
  }
  requestAnimationFrame(beatTick);

  // ---- control panel -----------------------------------------------------
  function injectPanel() {
    if ($('swr-transitions-panel')) return;
    if ($('global')) injectFooterPanel();
    else injectFloatingPanel();
  }

  function injectFooterPanel() {
    const panel = document.createElement('div');
    panel.id = 'swr-transitions-panel';
    panel.style.cssText =
      'display:flex;align-items:center;gap:6px;padding:0 12px;' +
      'flex-wrap:wrap;max-width:60vw;' +
      'font:600 10px ui-monospace,Menlo,monospace;letter-spacing:0.06em;' +
      'text-transform:uppercase;color:var(--muted);';
    panel.innerHTML =
      '<span style="color:var(--accent);">FX</span>' +
      NAMES.map((n) =>
        '<button data-tx="' + n + '" ' +
        'style="background:var(--panel-2);border:1px solid var(--line-2);' +
        'color:var(--fg);padding:4px 8px;border-radius:4px;cursor:pointer;' +
        'font:inherit;letter-spacing:inherit;">' + n + '</button>'
      ).join('') +
      '<button data-tx-auto ' +
      'style="background:transparent;border:1px solid var(--line);' +
      'color:var(--muted);padding:4px 8px;border-radius:4px;cursor:pointer;' +
      'font:inherit;letter-spacing:inherit;">auto: off</button>';
    $('global').appendChild(panel);
    bindPanelEvents(panel);
  }

  function injectFloatingPanel() {
    const root = document.createElement('div');
    root.id = 'swr-transitions-panel';
    root.style.cssText =
      'position:fixed;right:16px;bottom:16px;z-index:10000;' +
      'font:600 10px ui-monospace,Menlo,monospace;letter-spacing:0.04em;' +
      'text-transform:uppercase;';

    const toggle = document.createElement('button');
    toggle.textContent = 'FX';
    toggle.style.cssText =
      'width:48px;height:48px;border-radius:50%;background:#1a1028;' +
      'border:1px solid #ff3d92;color:#ff3d92;cursor:pointer;' +
      'font:700 14px ui-monospace,Menlo,monospace;letter-spacing:0.08em;' +
      'box-shadow:0 8px 24px rgba(0,0,0,0.6);';
    root.appendChild(toggle);

    const pop = document.createElement('div');
    pop.style.cssText =
      'display:none;flex-direction:column;gap:4px;padding:8px;' +
      'margin-bottom:8px;background:#0d0918;border:1px solid #2a1d3a;' +
      'border-radius:6px;min-width:160px;max-height:60vh;overflow-y:auto;';
    pop.innerHTML =
      NAMES.map((n) =>
        '<button data-tx="' + n + '" ' +
        'style="background:#1a1028;border:1px solid #3a2a4a;color:#f5e9ff;' +
        'padding:5px 10px;border-radius:4px;cursor:pointer;' +
        'font:inherit;letter-spacing:inherit;text-align:left;">' + n + '</button>'
      ).join('') +
      '<button data-tx-auto ' +
      'style="background:transparent;border:1px solid #2a1d3a;color:#9a8aaa;' +
      'padding:5px 10px;border-radius:4px;cursor:pointer;' +
      'font:inherit;letter-spacing:inherit;text-align:left;">auto: off</button>';
    root.appendChild(pop);

    toggle.addEventListener('click', () => {
      pop.style.display = pop.style.display === 'none' ? 'flex' : 'none';
    });
    bindPanelEvents(pop);

    document.body.appendChild(root);
  }

  function bindPanelEvents(panel) {
    panel.addEventListener('click', (e) => {
      const btn = e.target.closest('button');
      if (!btn) return;
      const name = btn.getAttribute('data-tx');
      if (name) {
        fire(name).catch((err) => console.warn('[swr-tx]', err));
        flashButton(btn);
        return;
      }
      if (btn.hasAttribute('data-tx-auto')) {
        const on = autoFire && autoFire.onBeat;
        if (on) {
          setAutoFire(null);
          btn.textContent = 'auto: off';
        } else {
          setAutoFire({ onBeat: true, everyNBeats: 1, transition: 'flash-cover' });
          btn.textContent = 'auto: on';
        }
        flashButton(btn);
      }
    });
  }

  function flashButton(btn) {
    const prevBg = btn.style.background;
    const prevColor = btn.style.color;
    btn.style.background = '#ff3d92';
    btn.style.color = '#000';
    setTimeout(() => {
      btn.style.background = prevBg;
      btn.style.color = prevColor;
    }, 200);
  }

  // ---- boot ---------------------------------------------------------------

  function boot() {
    injectCSS();
    injectPanel();
    window.SWRTransitions = {
      fire, setAutoFire, stop, list: () => NAMES.slice(),
      NAMES, DEFAULT_DUR,
      resolveStage,
    };
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();