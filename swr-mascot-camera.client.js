// swr-mascot-camera.client.js — face/pose-aware mascot driven by camera input.
//
// Usage:
//   <swr-mascot-camera></swr-mascot-camera>
// Or with a remote SVG source:
//   <swr-mascot-camera src="/swr-mascot-camera.svg"></swr-mascot-camera>
//
// Behavior:
//   1. Mounts an inline SVG (loaded via fetch from `src`, or a default
//      fallback string if no src is given / fetch fails).
//   2. On first user interaction with the host, requests camera permission
//      via getUserMedia. Auto-mount is intentionally avoided — camera
//      prompts must be user-initiated per browser policy.
//   3. Samples frames at 8 fps into a tiny (160×90) offscreen canvas.
//      Compares each frame to the previous one:
//        - motion  = mean absolute pixel diff (0..1)
//        - cx,cy  = motion-weighted centroid (where the moving thing is)
//   4. Maps (motion, cx, cy) → SVG state:
//        motion > 0.35  → .wave  (hand raised, open smile)
//        cy  < 0.4      → .look-up  (eyes up, small "oh")
//        cx  relative to 0.5 → --tilt (CSS var, -1..+1) tilts the whole head
//        motion smoothed → --motion (CSS var, 0..1) drives pulse magnitude
//   5. If permission is denied / no camera / getUserMedia unsupported,
//      mascot stays in .idle state with --motion = 0 — looks perfectly
//      fine as a static brand mark, no console errors.
//
// The mascot is keyboard-accessible: Enter/Space on the host toggles the
// camera prompt. Click toggles too.
//
// Self-contained, no dependencies, no CDN fetches. The detection runs in
// ~30 lines of plain JS at 160×90 — trivial CPU on any device.

(function () {
  if (customElements.get('swr-mascot-camera')) return; // idempotent

  // ---- Default SVG (the same one shipped at /swr-mascot-camera.svg).
  // Kept inline so the component works even if the file 404s or the host
  // is opened from a file:// URL where fetch() is blocked. The two
  // strings are kept identical by the comment below; if you edit the SVG
  // file, also paste the changes here.
  const FALLBACK_SVG_URL = '/swr-mascot-camera.svg';

  // 8 fps is plenty for "is there a face here" detection — saves battery,
  // CPU, and doesn't compete with the engine's render loop.
  const SAMPLE_INTERVAL_MS = 125;
  // Sample size: 160x90 keeps the diff loop at ~14k pixels per frame.
  const SAMPLE_W = 160;
  const SAMPLE_H = 90;

  class SwrMascotCamera extends HTMLElement {
    constructor() {
      super();
      this._stream = null;
      this._video = null;
      this._sampleCanvas = null;
      this._sampleCtx = null;
      this._prevFrame = null;       // Uint8ClampedArray of previous luma frame
      this._currentFrame = null;    // Uint8ClampedArray of current luma frame
      this._sampleTimer = null;
      this._motion = 0;             // smoothed 0..1
      this._depth = 0;              // smoothed 0..1, slow-moving EMA of motion (proximity proxy)
      this._motionPeak = 0;         // max motionScale over the last 3 frames — wave trigger
      this._centroid = { x: 0.5, y: 0.5 }; // 0..1 each
      this._stateClearTimer = null;
      this._armed = false;          // user has clicked → camera requested
      this._stateHistory = [];      // last few states for debouncing transitions
      this._currentState = null;    // 'idle' | 'wave' | 'look-up' | 'lean-in' | 'back-away'
      this._hasBeenActive = false;  // latched true the first time motion > 0.1 is seen
      this._motionScaleHistory = []; // last 3 raw motionScale values for peak detection
    }

    static get observedAttributes() {
      return ['src', 'auto', 'label'];
    }

    connectedCallback() {
      this.style.display = 'inline-block';
      this.style.position = 'relative';
      this.style.outline = 'none';
      this.tabIndex = 0;
      this.setAttribute('role', 'button');
      this._renderShell();

      const src = this.getAttribute('src') || FALLBACK_SVG_URL;
      this._loadSvg(src).then(svg => {
        // Wrap the inner svg so we can style + drive it without colliding
        // with the host element's styles.
        const wrapper = document.createElement('div');
        wrapper.className = 'mascot-svg-wrap';
        wrapper.style.cssText = 'display:block;width:240px;height:240px;';
        wrapper.appendChild(svg);
        const inner = this.querySelector('.mascot-inner');
        if (inner) inner.appendChild(wrapper);
      }).catch(err => {
        console.warn('[swr-mascot] SVG load failed:', err);
        this.querySelector('.mascot-status').textContent = 'svg load failed';
      });

      this.addEventListener('click', () => this._toggleArmed());
      this.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          this._toggleArmed();
        }
      });
    }

    disconnectedCallback() {
      this._stopCamera();
      if (this._sampleTimer) clearInterval(this._sampleTimer);
    }

    _renderShell() {
      this.innerHTML = `
        <style>
          swr-mascot-camera {
            cursor: pointer;
            user-select: none;
            border-radius: 12px;
            transition: transform 0.2s;
          }
          swr-mascot-camera:hover { transform: translateY(-2px); }
          swr-mascot-camera:focus-visible {
            outline: 2px solid var(--accent, #ff2d8a);
            outline-offset: 4px;
          }
          swr-mascot-camera .mascot-inner {
            display: block;
          }
          swr-mascot-camera .mascot-status {
            position: absolute;
            bottom: -22px;
            left: 0;
            right: 0;
            text-align: center;
            font: 10px/1 ui-monospace, SFMono-Regular, Menlo, monospace;
            letter-spacing: 0.12em;
            text-transform: uppercase;
            color: var(--muted, #8a7a66);
            opacity: 0.7;
          }
          swr-mascot-camera[data-armed="true"] .mascot-status {
            color: var(--accent, #ff2d8a);
            opacity: 1;
          }
          swr-mascot-camera svg { display: block; }
        </style>
        <div class="mascot-inner"></div>
        <div class="mascot-status">click to enable camera</div>
      `;
    }

    async _loadSvg(src) {
      // Try fetching the file first; fall back to inline string on failure.
      try {
        const res = await fetch(src, { cache: 'force-cache' });
        if (res.ok) {
          const txt = await res.text();
          const doc = new DOMParser().parseFromString(txt, 'image/svg+xml');
          const svg = doc.documentElement;
          if (svg && svg.tagName.toLowerCase() === 'svg') {
            svg.setAttribute('class', 'mascot-svg');
            return svg;
          }
        }
      } catch (_) { /* fall through */ }
      throw new Error('Could not load mascot SVG from ' + src);
    }

    async _toggleArmed() {
      if (this._armed) {
        this._stopCamera();
        this._armed = false;
        this.removeAttribute('data-armed');
        this.querySelector('.mascot-status').textContent = 'click to enable camera';
        this._setSvgState(null);
        this._setMotionVars(0, 0);
      } else {
        this._armed = true;
        this.setAttribute('data-armed', 'true');
        this.querySelector('.mascot-status').textContent = 'requesting camera…';
        await this._startCamera();
      }
    }

    async _startCamera() {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        this.querySelector('.mascot-status').textContent = 'no getUserMedia';
        return;
      }
      try {
        this._stream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 640 }, height: { ideal: 360 } },
          audio: false,
        });
      } catch (err) {
        const msg = (err && err.name === 'NotAllowedError')
          ? 'permission denied — click to retry'
          : `camera error: ${err && err.message ? err.message : err}`;
        this.querySelector('.mascot-status').textContent = msg;
        this._armed = false;
        this.removeAttribute('data-armed');
        return;
      }

      // Hidden <video> for sampling. Not added to DOM — no preview surface.
      this._video = document.createElement('video');
      this._video.srcObject = this._stream;
      this._video.muted = true;
      this._video.playsInline = true;
      this._video.autoplay = true;
      try { await this._video.play(); } catch (_) {}

      // Wait for at least one frame
      await new Promise(resolve => {
        if (this._video.readyState >= 2) return resolve();
        this._video.addEventListener('loadeddata', resolve, { once: true });
        setTimeout(resolve, 2000);
      });

      // Sample canvas
      this._sampleCanvas = document.createElement('canvas');
      this._sampleCanvas.width = SAMPLE_W;
      this._sampleCanvas.height = SAMPLE_H;
      this._sampleCtx = this._sampleCanvas.getContext('2d', { willReadFrequently: true });

      this._prevFrame = new Uint8ClampedArray(SAMPLE_W * SAMPLE_H);
      this._currentFrame = new Uint8ClampedArray(SAMPLE_W * SAMPLE_H);

      this.querySelector('.mascot-status').textContent = 'live · reacting to you';

      // Start the detection loop
      this._sampleTimer = setInterval(() => this._sample(), SAMPLE_INTERVAL_MS);
    }

    _stopCamera() {
      if (this._sampleTimer) {
        clearInterval(this._sampleTimer);
        this._sampleTimer = null;
      }
      if (this._stream) {
        this._stream.getTracks().forEach(t => t.stop());
        this._stream = null;
      }
      if (this._video) {
        try { this._video.pause(); } catch (_) {}
        this._video.srcObject = null;
        this._video = null;
      }
      this._sampleCanvas = null;
      this._sampleCtx = null;
      this._prevFrame = null;
      this._currentFrame = null;
    }

    _sample() {
      if (!this._video || !this._sampleCtx || this._video.readyState < 2) return;

      const w = SAMPLE_W, h = SAMPLE_H;
      // Draw the current frame into the offscreen canvas, scaled down
      this._sampleCtx.drawImage(this._video, 0, 0, w, h);
      const img = this._sampleCtx.getImageData(0, 0, w, h).data;

      // Convert to luma buffer + compute motion against previous frame
      let motionSum = 0;
      let weightedX = 0;
      let weightedY = 0;
      let weightSum = 0;
      const cur = this._currentFrame;
      const prev = this._prevFrame;

      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const i = (y * w + x) * 4;
          // Rec.601 luma — cheap and good enough for motion detection
          const luma = (img[i] * 299 + img[i + 1] * 587 + img[i + 2] * 114) >> 10;
          const idx = y * w + x;
          cur[idx] = luma;
          const diff = Math.abs(luma - prev[idx]);
          if (diff > 12) { // ignore JPEG/sensor grain
            motionSum += diff;
            weightedX += x * diff;
            weightedY += y * diff;
            weightSum += diff;
          }
        }
      }

      // Swap buffers
      const tmp = this._prevFrame;
      this._prevFrame = cur;
      this._currentFrame = tmp;

      // Normalize motion to 0..1 (luma diff per pixel can go up to ~255)
      const motionRaw = weightSum > 0 ? motionSum / (w * h * 255) : 0;
      // Higher gain: a 1960-px face circle jumping across the frame should
      // produce motionScale > 0.5 (which we need to clear the wave threshold).
      const motionScale = Math.min(1, motionRaw * 40);

      // Exponential smoothing so the mascot doesn't jitter every frame.
      // Slower decay (0.5 / 0.5) than depth, so a hand-wave registers across
      // 2-3 frames (~250-375ms at 8fps) instead of decaying in one tick.
      this._motion = this._motion * 0.5 + motionScale * 0.5;
      // Peak tracker: max raw motionScale over the last 3 frames. A single-
      // frame burst (e.g. a hand wave) registers as a wave even if the EMA
      // smoothed it away — the peak outlasts the EMA's decay.
      this._motionScaleHistory.push(motionScale);
      if (this._motionScaleHistory.length > 3) this._motionScaleHistory.shift();
      this._motionPeak = this._motionScaleHistory.reduce((m, v) => Math.max(m, v), 0);
      // Depth = much slower EMA of motion. A short burst of motion reads as
      // a gesture; sustained motion reads as "the camera is close / person
      // is large in frame." This is a cheap proxy for actual depth sensing.
      this._depth = this._depth * 0.97 + motionScale * 0.03;
      // Latch: once we've seen any meaningful activity, we know someone was
      // here, so back-away becomes a valid transition. Without activity, we
      // stay in idle even after long quiet periods (a still camera scene).
      if (motionScale > 0.1 || this._motion > 0.15) this._hasBeenActive = true;

      if (weightSum > 0) {
        this._centroid.x = weightedX / weightSum / w; // 0..1
        this._centroid.y = weightedY / weightSum / h; // 0..1
      }

      // Map centroid.x (0..1) → --tilt (-1..+1)
      const tilt = Math.max(-1, Math.min(1, (this._centroid.x - 0.5) * 2));

      this._setMotionVars(this._motion, tilt, this._depth);
      this._updateState();
    }

    _setMotionVars(motion, tilt, depth) {
      const svg = this.querySelector('svg.mascot-svg');
      if (!svg) return;
      svg.style.setProperty('--motion', motion.toFixed(3));
      svg.style.setProperty('--tilt',   tilt.toFixed(3));
      svg.style.setProperty('--depth',  depth.toFixed(3));
    }

    _updateState() {
      const svg = this.querySelector('svg.mascot-svg');
      if (!svg) return;
      let next;
      // State hierarchy (most-emphatic first):
      //   lean-in   — sustained large motion → "you're close"
      //   wave      — peak burst of motion → "hello!"
      //   look-up   — face region in upper third → "looking up"
      //   back-away — long quiet period AFTER activity → "stepped back / left"
      //   idle      — default, gentle pulse (also a still-camera scene)
      if (this._depth > 0.30 && this._motion > 0.10) {
        next = 'lean-in';
      } else if (this._motionPeak > 0.40) {
        // Use the raw peak (max of last 3 frames) so a single-frame hand
        // wave registers even after the EMA smooths it away.
        next = 'wave';
      } else if (this._centroid.y < 0.36) {
        // Look-up wins purely on centroid position (no motion threshold)
        // so a stable "looking up" pose registers even after motion decays.
        next = 'look-up';
      } else if (this._hasBeenActive && this._depth < 0.08 && this._motion < 0.05) {
        next = 'back-away';
      } else {
        next = 'idle';
      }
      this._setSvgStateDebounced(next);
    }

    // Debounce state transitions over ~3 frames so brief blips don't snap
    // the mascot between poses. Holds the existing state unless the new
    // candidate wins a majority vote across the last 3 samples.
    _setSvgStateDebounced(next) {
      this._stateHistory.push(next);
      if (this._stateHistory.length > 3) this._stateHistory.shift();
      // Majority vote
      const counts = {};
      for (const s of this._stateHistory) counts[s] = (counts[s] || 0) + 1;
      let winner = next, max = 0;
      for (const [s, n] of Object.entries(counts)) {
        if (n > max) { max = n; winner = s; }
      }
      if (winner === this._currentState) return;
      this._currentState = winner;
      this._setSvgState(winner === 'idle' ? null : winner);
    }

    _setSvgState(state) {
      const svg = this.querySelector('svg.mascot-svg');
      if (!svg) return;
      svg.classList.remove('wave', 'look-up', 'lean-in', 'back-away');
      if (state) svg.classList.add(state);
    }
  }

  customElements.define('swr-mascot-camera', SwrMascotCamera);
})();