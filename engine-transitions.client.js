// engine-transitions.client.js — music-video transition vocabulary
//
// 28 named transitions. Two delivery systems:
//   1. CSS keyframe / clip-path animations on a stage overlay (#swr-tx-layer).
//   2. FX-burst hooks that ramp a window.FX uniform 0 -> peak -> 0 over a window.
// Auto-fire: setAutoFire({ onBeat, everyNBeats, transition }) drives #1 and #2
// from a synthesized beat emitter (uses requestAnimationFrame + interval when no
// external beat source is plugged in).
//
// Usage:
//   <script src="/engine-transitions.client.js"></script>
//   window.SWRTransitions.fire('fade-to-black');           // one-shot
//   window.SWRTransitions.fire('glitch-burst', { peak: 0.9 });
//   window.SWRTransitions.setAutoFire({ everyNBeats: 4, transition: 'circle-wipe' });
//
// Idempotent: safe to load twice. No engine.html wiring in this pass — module
// only; engine.html integration is a follow-up.

(function () {
  if (window.SWRTransitions) return;  // idempotent

  // ---- Config ----
  const DEFAULT_DURATION = 520;        // ms — matches a comfortable downbeat
  const DEFAULT_PEAK = 1.0;            // peak value for FX-burst ramps
  const OVERLAY_ID = 'swr-tx-layer';
  const STAGE_SELECTOR = '#render, #stage canvas, #fx-canvas';
  const BEAT_DEFAULT_BPM = 120;        // fallback when no audio wired

  // ---- Transition catalog ----
  // Family tags drive picker UIs and preset↔transition pairing. The
  // data/preset-transitions.json manifest (consumed by
  // lib/preset-transitions.client.js) uses these families + kinds to
  // recommend transitions per version-presets preset (PRD-019).
  // kind: 'css' = full-screen CSS keyframe on overlay; 'fx' = uniform ramp on window.FX
  const TRANSITIONS = {
    // ─── Original 10 — CSS-native cover/distortion/spatial/brightness/mask/hybrid ───
    'whip-blur':         { kind: 'css', family: 'cover',      duration: 380 },
    'glitch-block':      { kind: 'css', family: 'distortion', duration: 520, peak: 0.85 },
    'zoom-through':      { kind: 'css', family: 'spatial',    duration: 680 },
    'flash-cover':       { kind: 'css', family: 'brightness', duration: 420 },
    'paint-stroke':      { kind: 'css', family: 'mask',       duration: 720 },
    'chromatic-split':   { kind: 'css', family: 'distortion', duration: 460, peak: 0.7 },
    'swivel':            { kind: 'css', family: 'cover',      duration: 540 },
    'circle-wipe':       { kind: 'css', family: 'mask',       duration: 520 },
    'warp-dissolve':     { kind: 'css', family: 'hybrid',     duration: 620, peak: 0.6 },
    'lens-flare':        { kind: 'css', family: 'brightness', duration: 780 },

    // ─── Sprint A — CSS-only trivial additions ───
    'fade-to-black':     { kind: 'css', family: 'fade',       duration: 520 },
    'pure-crossfade':    { kind: 'css', family: 'fade',       duration: 480 },
    'linear-wipe-lr':    { kind: 'css', family: 'wipe',       duration: 460 },
    'linear-wipe-tb':    { kind: 'css', family: 'wipe',       duration: 460 },
    'diagonal-wipe':     { kind: 'css', family: 'wipe',       duration: 520 },
    'iris-in':           { kind: 'css', family: 'mask',       duration: 520 },  // inverse of circle-wipe

    // ─── Sprint B — FX-burst hooks (ramp window.FX uniform 0 -> peak -> 0) ───
    'pixelation-ramp':   { kind: 'fx',  family: 'distortion', uniform: 'setPosterize', duration: 380, peak: 0.95 },
    'chroma-burst':      { kind: 'fx',  family: 'distortion', uniform: 'setChroma',    duration: 320, peak: 0.9 },
    'glitch-burst':      { kind: 'fx',  family: 'distortion', uniform: 'setMut',       duration: 360, peak: 0.85, algo: 1 },
    'glow-burst':        { kind: 'fx',  family: 'brightness', uniform: 'setGlow',      duration: 520, peak: 0.8 },
    'liquid-burst':      { kind: 'fx',  family: 'distortion', uniform: 'setMut',       duration: 600, peak: 0.6, algo: 2 },
    'ripple-burst':      { kind: 'fx',  family: 'spatial',    uniform: 'setMut',       duration: 480, peak: 0.75, algo: 4 },
    'kaleidoscope-burst':{ kind: 'fx',  family: 'spatial',    uniform: 'setMut',       duration: 620, peak: 0.7, algo: 3 },
    'vignette-punch':    { kind: 'fx',  family: 'brightness', uniform: 'setVignette',  duration: 380, peak: 0.85 },

    // ─── Sprint C/D — specialty ───
    'snap-zoom':         { kind: 'css', family: 'spatial',    duration: 280, peak: 0.9 },
    'negative-pop':      { kind: 'css', family: 'distortion', duration: 240, peak: 0.85 },
    'vhs-tracking':      { kind: 'css', family: 'distortion', duration: 520, peak: 0.7 },
    'object-pass-through':{ kind: 'css', family: 'cover',     duration: 620 },
    'particle-wipe':     { kind: 'css', family: 'mask',       duration: 720 }
    // 'aspect-ratio-swap' is viewport-level (not a stage overlay) — declared
    // in API but implemented as a separate method (see fireAspectRatioSwap below)
    // 'frame-freeze-zoom' and 'light-leak-pop' require canvas capture / overlay
    // assets; declared in API, implemented below with a procedurally generated
    // light-leak gradient (no PNG dependency) and the existing snapshotDataURL
    // pattern from the engine for freeze-zoom.
  };

  // Transitions needing special handling (not generic CSS keyframe):
  const SPECIAL = new Set([
    'aspect-ratio-swap',
    'frame-freeze-zoom',
    'light-leak-pop'
  ]);

  // ---- Serialization queue ----
  // CSS keyframe animations stack on the same overlay; serialize to avoid
  // mid-flight animation overrides cutting off the previous transition.
  const queue = [];
  let running = false;

  function drain() {
    if (running) return;
    const job = queue.shift();
    if (!job) return;
    running = true;
    job().finally(() => { running = false; drain(); });
  }

  // ---- Overlay element ----
  function ensureOverlay() {
    let el = document.getElementById(OVERLAY_ID);
    if (el) return el;
    el = document.createElement('div');
    el.id = OVERLAY_ID;
    el.setAttribute('aria-hidden', 'true');
    Object.assign(el.style, {
      position: 'fixed',
      inset: '0',
      pointerEvents: 'none',
      zIndex: '9999',
      mixBlendMode: 'normal',
      willChange: 'transform, opacity, clip-path, filter',
      display: 'none'
    });
    document.body.appendChild(el);
    return el;
  }

  function stageRect() {
    // Find the visible stage (render canvas, fx-canvas, or stage section).
    const stage = document.querySelector(STAGE_SELECTOR);
    if (!stage) return { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
    const r = stage.getBoundingClientRect();
    return { left: r.left, top: r.top, width: r.width, height: r.height };
  }

  // ---- CSS keyframes (generated per-transition, named to avoid collisions) ──
  // We build a fresh <style> node per fire() and remove it after the animation
  // ends. This keeps each transition self-contained and avoids state bleed
  // when two transitions overlap (queue serializes, but defensively).
  let styleCounter = 0;

  function fireKeyframe(name, opts) {
    const cfg = TRANSITIONS[name];
    if (!cfg || cfg.kind !== 'css') return Promise.reject(new Error(`unknown css transition: ${name}`));
    const duration = (opts && opts.duration) || cfg.duration;
    const peak = (opts && opts.peak != null) ? opts.peak : (cfg.peak != null ? cfg.peak : 1);
    const id = `swr-tx-${++styleCounter}`;
    const rect = stageRect();
    const overlay = ensureOverlay();

    const css = cssFor(name, id, duration, peak, rect);
    const styleNode = document.createElement('style');
    styleNode.id = id;
    styleNode.textContent = css;
    document.head.appendChild(styleNode);

    overlay.style.display = 'block';
    overlay.className = '';
    overlay.classList.add(id);

    return new Promise(resolve => {
      const done = () => {
        overlay.classList.remove(id);
        overlay.style.display = 'none';
        styleNode.remove();
        resolve();
      };
      overlay.addEventListener('animationend', done, { once: true });
      // Safety net: never block the queue longer than duration + 120ms.
      setTimeout(done, duration + 120);
    });
  }

  // ---- Per-transition CSS builders ----
  // Each builder writes @keyframes for its unique animation name and the
  // .<id> selector that applies it. The overlay is a full-screen black/white
  // or shape layer; the stage canvas remains underneath and shows through
  // any transparent portion of the overlay.
  function cssFor(name, id, dur, peak, rect) {
    const w = rect.width, h = rect.height;
    const r = Math.hypot(w, h);
    switch (name) {
      case 'whip-blur':
        return `.${id}{animation:whip${id} ${dur}ms ease-out forwards}
                @keyframes whip${id}{0%{transform:translateX(-100%);filter:blur(0)}30%{opacity:1;filter:blur(${peak*8}px)}100%{transform:translateX(100%);opacity:1;filter:blur(0)}}
                .${id}{background:#000}`;

      case 'glitch-block': {
        // 8 slice rows, each with offset and clip-path slice
        const rows = [];
        for (let i = 0; i < 8; i++) {
          const top = (i / 8) * 100;
          rows.push(`${(i*12)}%{clip-path:inset(${top}% 0 ${100-top-12}% 0);transform:translateX(${(i%2?1:-1)*peak*40}px)}`);
        }
        return `.${id}{background:transparent;animation:glt${id} ${dur}ms steps(8,end) forwards}
                @keyframes glt${id}{0%{opacity:1}${rows.join('')}=100%{opacity:1;transform:translateX(0);clip-path:inset(0)}}`;
      }

      case 'zoom-through':
        return `.${id}{background:#000;animation:zt${id} ${dur}ms ease-in forwards}
                @keyframes zt${id}{0%{clip-path:circle(${r*0.3}px at 50% 50%)}100%{clip-path:circle(${r*1.5}px at 50% 50%)}`;

      case 'flash-cover':
        return `.${id}{background:#fff;animation:fc${id} ${dur}ms steps(4) forwards}
                @keyframes fc${id}{0%{opacity:0}25%{opacity:${peak}}50%{opacity:0}75%{opacity:${peak*0.7}}100%{opacity:0}}`;

      case 'paint-stroke':
        return `.${id}{background:#000;animation:ps${id} ${dur}ms ease-in-out forwards}
                @keyframes ps${id}{0%{clip-path:polygon(0 50%,100% 50%,100% 50%,0 50%)}100%{clip-path:polygon(0 0,100% 0,100% 100%,0 100%)}}`;

      case 'chromatic-split':
        return `.${id}{background:#000;animation:cs${id} ${dur}ms ease-out forwards}
                @keyframes cs${id}{0%{opacity:0;filter:drop-shadow(-${peak*16}px 0 #f0f) drop-shadow(${peak*16}px 0 #0ff)}50%{opacity:1}100%{opacity:0;filter:none}}`;

      case 'swivel':
        return `.${id}{background:#000;animation:sw${id} ${dur}ms ease-in-out forwards;transform-origin:50% 50%}
                @keyframes sw${id}{0%{transform:rotateY(0deg);opacity:1}50%{transform:rotateY(90deg);opacity:1}100%{transform:rotateY(180deg);opacity:0}}`;

      case 'circle-wipe':
        return `.${id}{background:#000;animation:cw${id} ${dur}ms ease-in forwards}
                @keyframes cw${id}{0%{clip-path:circle(0% at 50% 50%)}100%{clip-path:circle(${peak*150}% at 50% 50%)}}`;

      case 'warp-dissolve':
        return `.${id}{background:#000;animation:wd${id} ${dur}ms ease-in-out forwards;transform-origin:50% 50%}
                @keyframes wd${id}{0%{opacity:0;transform:scale(${0.9+peak*0.1}) skewX(0);filter:blur(0)}50%{opacity:${peak};transform:scale(${1+peak*0.05}) skewX(${peak*8}deg);filter:blur(${peak*4}px)}100%{opacity:0;transform:scale(1.1) skewX(0);filter:blur(0)}}`;

      case 'lens-flare':
        return `.${id}{background:radial-gradient(circle at 50% 50%, rgba(255,235,200,${peak}) 0%, rgba(255,180,80,${peak*0.6}) 20%, rgba(255,80,40,${peak*0.3}) 40%, transparent 70%);animation:lf${id} ${dur}ms ease-out forwards;mix-blend-mode:screen}
                @keyframes lf${id}{0%{transform:scale(0);opacity:0}30%{opacity:1}100%{transform:scale(${peak*2.5});opacity:0}}`;

      // ─── Sprint A ───
      case 'fade-to-black':
        return `.${id}{background:#000;animation:fb${id} ${dur}ms ease-out forwards}
                @keyframes fb${id}{0%{opacity:0}30%{opacity:1}100%{opacity:1}}`;

      case 'pure-crossfade':
        // Pure opacity swap — no warp. Implementation note: true crossfade needs
        // two scenes; in single-scene mode we fade to a neutral grey that
        // recovers. This is a "soft scene reset" not a true crossfade.
        return `.${id}{background:linear-gradient(#1a1028,#0d0918);animation:pc${id} ${dur}ms ease-in-out forwards}
                @keyframes pc${id}{0%{opacity:0}50%{opacity:1}100%{opacity:0}}`;

      case 'linear-wipe-lr':
        return `.${id}{background:#000;animation:lwl${id} ${dur}ms ease-in-out forwards}
                @keyframes lwl${id}{0%{clip-path:inset(0 100% 0 0)}100%{clip-path:inset(0 0 0 0)}}`;

      case 'linear-wipe-tb':
        return `.${id}{background:#000;animation:lwt${id} ${dur}ms ease-in-out forwards}
                @keyframes lwt${id}{0%{clip-path:inset(0 0 100% 0)}100%{clip-path:inset(0 0 0 0)}}`;

      case 'diagonal-wipe':
        return `.${id}{background:#000;animation:dw${id} ${dur}ms ease-in-out forwards}
                @keyframes dw${id}{0%{clip-path:polygon(0 0,0 0,0 0,0 0)}100%{clip-path:polygon(0 0,100% 0,100% 100%,0 100%)}}`;

      case 'iris-in':
        // Inverse of circle-wipe: start full coverage, collapse to center.
        return `.${id}{background:#000;animation:ii${id} ${dur}ms ease-in forwards}
                @keyframes ii${id}{0%{clip-path:circle(${peak*150}% at 50% 50%)}100%{clip-path:circle(0% at 50% 50%)}}`;

      // ─── Sprint C/D ───
      case 'snap-zoom':
        // Fast scale punch on a full-cover overlay; pure CSS snap.
        return `.${id}{background:#000;animation:sz${id} ${dur}ms ease-out forwards;transform-origin:50% 50%}
                @keyframes sz${id}{0%{transform:scale(1);opacity:0}30%{opacity:${peak}}100%{transform:scale(2);opacity:0}}`;

      case 'negative-pop':
        // One-frame invert flash via filter on the overlay.
        return `.${id}{background:transparent;animation:np${id} ${dur}ms steps(2) forwards}
                @keyframes np${id}{0%{opacity:0;filter:invert(0)}50%{opacity:${peak};filter:invert(1)}100%{opacity:0;filter:invert(0)}}`;

      case 'vhs-tracking': {
        // Rolling band + RGB offset.
        const bandH = 18;
        return `.${id}{background:linear-gradient(180deg, transparent 0%, transparent 40%, rgba(255,255,255,${peak*0.25}) 50%, transparent 60%, transparent 100%);animation:vhs${id} ${dur}ms ease-out forwards;mix-blend-mode:screen}
                @keyframes vhs${id}{0%{transform:translateY(-${h}px);filter:none}50%{transform:translateY(${h/2}px);filter:drop-shadow(-${peak*8}px 0 #f0f) drop-shadow(${peak*8}px 0 #0ff)}100%{transform:translateY(${h}px);filter:none}}`;
      }

      case 'object-pass-through':
        // Simulated occluder: an off-screen dark ellipse sweeps across.
        return `.${id}{background:radial-gradient(ellipse 30% 50% at 50% 50%, #000 0%, #000 60%, transparent 100%);animation:opt${id} ${dur}ms ease-in-out forwards}
                @keyframes opt${id}{0%{transform:translateX(-${w*0.6}px) scale(0.8);opacity:0}50%{opacity:1}100%{transform:translateX(${w*0.6}px) scale(1.2);opacity:0}}`;

      case 'particle-wipe':
        // Cheap "particle" look: many small radial-gradient dots across the overlay,
        // each fading out at staggered times via animation-delay.
        const dots = [];
        const N = 40;
        for (let i = 0; i < N; i++) {
          const dx = Math.floor(Math.random() * 100);
          const dy = Math.floor(Math.random() * 100);
          const delay = (i / N) * dur;
          dots.push(`.${id}::before{background:radial-gradient(circle at ${dx}% ${dy}%, #000 0%, transparent 8%)}`);
        }
        return `.${id}{background:#000;animation:pw${id} ${dur}ms ease-out forwards;${dots[0] || ''}}
                @keyframes pw${id}{0%{opacity:0}50%{opacity:${peak}}100%{opacity:0}}`;

      default:
        // Unknown CSS variant — flash white as a safe fallback so the user sees something.
        return `.${id}{background:#fff;animation:fb${id} ${dur}ms steps(2) forwards}
                @keyframes fb${id}{0%{opacity:0}50%{opacity:1}100%{opacity:0}}`;
    }
  }

  // ---- FX-burst: ramp a window.FX uniform 0 -> peak -> 0 over duration ────
  function fireFXBurst(name, opts) {
    const cfg = TRANSITIONS[name];
    if (!cfg || cfg.kind !== 'fx') return Promise.reject(new Error(`unknown fx transition: ${name}`));
    if (!window.FX || typeof window.FX[cfg.uniform] !== 'function') {
      console.warn(`[swr-tx] window.FX.${cfg.uniform} unavailable; skipping ${name}`);
      return Promise.resolve();
    }
    const duration = (opts && opts.duration) || cfg.duration;
    const peak = (opts && opts.peak != null) ? opts.peak : cfg.peak;
    const setter = window.FX[cfg.uniform].bind(window.FX);
    const prevAlgo = (cfg.algo != null && window.FX.uniforms) ? window.FX.uniforms.mutAlgo : null;
    if (cfg.algo != null && typeof window.FX.setAlgo === 'function') {
      window.FX.setAlgo(cfg.algo);
    }
    const t0 = performance.now();
    return new Promise(resolve => {
      const tick = () => {
        const t = (performance.now() - t0) / duration;       // 0..1
        if (t >= 1) {
          setter(0);
          if (prevAlgo != null) window.FX.setAlgo(prevAlgo);
          resolve();
          return;
        }
        // Symmetric ramp: 0 -> peak -> 0 with a sin envelope.
        setter(peak * Math.sin(t * Math.PI));
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
  }

  // ---- Special transitions (compositional / asset-dependent) ──────────────
  function fireFrameFreezeZoom() {
    // Capture the stage canvas, hold it, scale-in. Falls back to a white flash
    // if the canvas is tainted (cross-origin video) — matching the
    // snapshotDataURL pattern in engine.html.
    const stage = document.querySelector('#fx-canvas') || document.querySelector('#render');
    if (!stage) return Promise.resolve();
    let dataURL;
    try {
      dataURL = stage.toDataURL('image/png');
    } catch (err) {
      console.warn('[swr-tx] canvas tainted; frame-freeze-zoom falling back to flash', err);
      return fireKeyframe('flash-cover', { duration: 380 });
    }
    const overlay = ensureOverlay();
    overlay.style.background = `url(${dataURL}) center/contain no-repeat #000`;
    overlay.style.backgroundSize = 'cover';
    overlay.style.display = 'block';
    overlay.style.animation = `ffz${++styleCounter} 520ms ease-out forwards`;
    return new Promise(resolve => {
      const id = styleCounter;
      const styleNode = document.createElement('style');
      styleNode.textContent = `@keyframes ffz${id}{0%{transform:scale(1);filter:none}100%{transform:scale(1.15);filter:contrast(1.2) brightness(1.1)}}`;
      document.head.appendChild(styleNode);
      overlay.addEventListener('animationend', () => {
        overlay.style.display = 'none';
        overlay.style.background = '';
        styleNode.remove();
        resolve();
      }, { once: true });
    });
  }

  function fireLightLeakPop() {
    // Procedural warm light leak — radial gradient with screen blend. No PNG.
    const overlay = ensureOverlay();
    overlay.style.background = `radial-gradient(ellipse 60% 80% at 30% 40%,
      rgba(255, 220, 160, 0.85) 0%,
      rgba(255, 140, 80, 0.6) 30%,
      rgba(220, 80, 120, 0.4) 60%,
      transparent 90%)`;
    overlay.style.mixBlendMode = 'screen';
    overlay.style.display = 'block';
    overlay.style.animation = `llp${++styleCounter} 680ms ease-out forwards`;
    return new Promise(resolve => {
      const id = styleCounter;
      const styleNode = document.createElement('style');
      styleNode.textContent = `@keyframes llp${id}{0%{opacity:0;transform:scale(1.3)}30%{opacity:1}100%{opacity:0;transform:scale(1)}}`;
      document.head.appendChild(styleNode);
      overlay.addEventListener('animationend', () => {
        overlay.style.display = 'none';
        overlay.style.background = '';
        overlay.style.mixBlendMode = 'normal';
        styleNode.remove();
        resolve();
      }, { once: true });
    });
  }

  function fireAspectRatioSwap(opts) {
    // Viewport-level: animate the stage canvas's aspect-ratio via clip-path
    // on the stage container. 16:9 -> 9:16 -> 1:1 -> 2.39:1 rotation.
    const targets = (opts && opts.sequence) || ['16:9', '9:16', '1:1', '16:9'];
    const stage = document.querySelector('#stage');
    if (!stage) return Promise.resolve();
    const stepMs = 360;
    const transitions = [];
    targets.forEach((ratio, i) => {
      transitions.push(new Promise(resolve => {
        const [w, h] = ratio.split(':').map(Number);
        const aspect = w / h;
        const vw = window.innerWidth, vh = window.innerHeight;
        let cw, ch;
        if (aspect >= vw / vh) { cw = vw * 0.92; ch = cw / aspect; }
        else { ch = vh * 0.92; cw = ch * aspect; }
        stage.style.transition = `width ${stepMs}ms ease, height ${stepMs}ms ease`;
        stage.style.width = `${cw}px`;
        stage.style.height = `${ch}px`;
        setTimeout(resolve, stepMs + 40);
      }));
    });
    return transitions.reduce((p, c) => p.then(() => c), Promise.resolve());
  }

  // ---- Beat sources ----
  // Two paths to fire auto-fire transitions:
  //   (a) external — window.SWRTransitions.onBeat(bpm, hit) called from the
  //       audio analyser each frame it detects a beat (preferred when an
  //       analyser is wired — keeps the BPM in sync with the real song).
  //   (b) internal — setBPM() / setAutoFire() spin a setInterval at the
  //       configured BPM. Used as a fallback so the module works without an
  //       audio source (e.g. demo / persona-preview pages).
  //
  // When (a) is in use, the internal interval is suppressed. It re-arms if
  // the user explicitly calls setBPM or setAutoFire after the audio source
  // goes away (so the fallback still works).
  let _bpm = BEAT_DEFAULT_BPM;
  let _beatHandler = null;
  let _beatTickHandle = null;
  let _externalBeatMode = false;

  function startBeatEmitter() {
    if (_beatTickHandle || _externalBeatMode) return;
    const intervalMs = 60000 / Math.max(1, _bpm);
    _beatTickHandle = setInterval(() => {
      if (_beatHandler) _beatHandler();
    }, intervalMs);
  }

  function stopBeatEmitter() {
    if (_beatTickHandle) { clearInterval(_beatTickHandle); _beatTickHandle = null; }
  }

  function setBPM(bpm) {
    _bpm = Math.max(30, Math.min(240, bpm));
    // Explicit setBPM from the UI re-enables internal mode (fallback).
    _externalBeatMode = false;
    if (_beatTickHandle) { stopBeatEmitter(); startBeatEmitter(); }
  }

  // External beat receiver. Call this from the audio analyser on each frame
  // it detects a beat. bpm is the current estimate (used for the BPM input
  // in the panel UI). hit is the beat-hit boolean (true = beat this frame).
  function onBeat(bpm, hit) {
    let bpmChanged = false;
    if (typeof bpm === 'number' && bpm > 0 && Number.isFinite(bpm)) {
      const rounded = Math.round(bpm);
      if (rounded !== _bpm) {
        _bpm = Math.max(30, Math.min(240, rounded));
        bpmChanged = true;
      }
    }
    _externalBeatMode = true;
    if (_beatTickHandle) stopBeatEmitter();  // silence the fallback
    if (bpmChanged && window.SWRTransitionsUI && typeof window.SWRTransitionsUI.onBpmUpdate === 'function') {
      window.SWRTransitionsUI.onBpmUpdate(_bpm);
    }
    if (hit && _beatHandler) _beatHandler();
  }

  // ---- Auto-fire ───────────────────────────────────────────────────────────
  // setAutoFire({ onBeat: number, everyNBeats: number, transition: string })
  // Fires the named transition every N beats, optionally offset by onBeat beats.
  let _autoConfig = null;
  let _autoCounter = 0;

  function setAutoFire(cfg) {
    if (!cfg) { _autoConfig = null; _beatHandler = null; stopBeatEmitter(); return; }
    _autoConfig = {
      onBeat: cfg.onBeat || 0,
      everyNBeats: cfg.everyNBeats || 4,
      transition: cfg.transition
    };
    if (cfg.bpm) setBPM(cfg.bpm);
    _autoCounter = 0;
    _beatHandler = () => {
      _autoCounter++;
      if (_autoCounter >= _autoConfig.onBeat &&
          ((_autoCounter - _autoConfig.onBeat) % _autoConfig.everyNBeats) === 0) {
        fire(_autoConfig.transition, { _src: 'auto' });
      }
    };
    startBeatEmitter();
  }

  // ---- Public API ──────────────────────────────────────────────────────────
  // Notify observers (e.g. the transition-harness) after every successful fire.
  // Detail includes the transition name + the source ("manual", "auto",
  // "special", "fx") so the UI can color-code the log entry.
  function _emitFire(name, source) {
    try {
      document.dispatchEvent(new CustomEvent('swr-tx:fire', { detail: { name, source, t: Date.now() } }));
    } catch (_) { /* old browsers / SSR — ignore */ }
  }

  function fire(name, opts) {
    if (SPECIAL.has(name)) {
      const job = () => {
        const r = name === 'frame-freeze-zoom' ? fireFrameFreezeZoom()
                : name === 'light-leak-pop'      ? fireLightLeakPop()
                : name === 'aspect-ratio-swap'   ? fireAspectRatioSwap(opts)
                : Promise.resolve();
        _emitFire(name, opts && opts._src ? opts._src : 'special');
        return r;
      };
      queue.push(job); drain();
      return Promise.resolve();
    }
    if (!TRANSITIONS[name]) {
      return Promise.reject(new Error(`unknown transition: ${name}`));
    }
    const cfg = TRANSITIONS[name];
    const job = () => {
      const r = cfg.kind === 'css' ? fireKeyframe(name, opts) : fireFXBurst(name, opts);
      _emitFire(name, opts && opts._src ? opts._src : cfg.kind);
      return r;
    };
    queue.push(job); drain();
    return Promise.resolve();
  }

  function list() {
    return Object.keys(TRANSITIONS).map(n => ({ name: n, ...TRANSITIONS[n] }));
  }

  window.SWRTransitions = {
    fire,
    list,
    setAutoFire,
    setBPM,
    onBeat,        // audio analyser hook: window.SWRTransitions.onBeat(bpm, hit)
    // Escape hatch for debug / advanced users.
    _TRANSITIONS: TRANSITIONS
  };
})();