// lib/alpha-layer.client.js — Layer 2 alpha playground + create-mode editor.
//
// Mounts a 20%-opacity overlay canvas on top of the preview canvas. In normal
// (watch) mode, the alpha canvas is barely visible — it shows a faint hint
// of the journey state. In create mode (toggled by the user), it brightens
// to 60-80% opacity and becomes interactive.
//
// Users can drop custom JS that subscribes to window.JourneyState and draws
// into the alpha canvas. This module just provides the shell + toggle.

(function () {
  'use strict';
  if (window.AlphaLayer && window.AlphaLayer.__v1) return;

  const Alpha = {
    __v1: true,
    _canvas: null,
    _ctx: null,
    _wrap: null,
    _toggleBtn: null,
    _createMode: false,
    _rafId: 0,
    _subscribers: new Set(),

    start() {
      const preview = document.getElementById('preview');
      if (!preview) {
        console.warn('[alpha-layer] no #preview canvas; alpha layer disabled');
        return;
      }

      // Wrap the preview canvas so we can layer on top.
      let wrap = preview.parentElement;
      if (!wrap.classList.contains('journey-wrap')) {
        wrap.classList.add('journey-wrap');
        wrap.style.position = 'relative';
      }
      this._wrap = wrap;

      // Create the canvas.
      this._canvas = document.createElement('canvas');
      this._canvas.id = 'journey-alpha';
      this._canvas.width = preview.width;
      this._canvas.height = preview.height;
      this._canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;opacity:0.20;pointer-events:none;transition:opacity 0.4s ease;mix-blend-mode:screen;';
      wrap.appendChild(this._canvas);
      this._ctx = this._canvas.getContext('2d');

      // Create-mode toggle button.
      this._toggleBtn = document.createElement('button');
      this._toggleBtn.id = 'journey-create-toggle';
      this._toggleBtn.textContent = '◐ Create';
      this._toggleBtn.style.cssText = 'position:absolute;top:8px;right:8px;z-index:5;background:rgba(0,0,0,0.5);color:var(--muted);border:1px solid var(--line);border-radius:4px;padding:4px 10px;font:10px ui-monospace,monospace;cursor:pointer;letter-spacing:0.08em;text-transform:uppercase;transition:all 0.2s ease;';
      this._toggleBtn.addEventListener('click', () => this._toggleCreate());
      wrap.appendChild(this._toggleBtn);

      // Pointer steer (only when create mode is on).
      this._canvas.addEventListener('pointerdown', e => {
        if (!this._createMode) return;
        this._canvas.setPointerCapture(e.pointerId);
        this._lastPointer = { x: e.clientX, y: e.clientY };
      });
      this._canvas.addEventListener('pointermove', e => {
        if (!this._createMode || !this._lastPointer) return;
        const dx = (e.clientX - this._lastPointer.x) / this._canvas.width;
        const dy = (e.clientY - this._lastPointer.y) / this._canvas.height;
        if (window.JourneyState) window.JourneyState.setUserSteer(dx * 4, dy * 4);
        this._lastPointer = { x: e.clientX, y: e.clientY };
      });
      this._canvas.addEventListener('pointerup', () => { this._lastPointer = null; });

      this._rafId = requestAnimationFrame((n) => this._tick(n));
    },

    _toggleCreate() {
      this._createMode = !this._createMode;
      this._canvas.style.opacity = this._createMode ? '0.7' : '0.20';
      this._canvas.style.pointerEvents = this._createMode ? 'auto' : 'none';
      this._toggleBtn.textContent = this._createMode ? '◑ Done' : '◐ Create';
      this._toggleBtn.style.color = this._createMode ? 'var(--accent)' : 'var(--muted)';
      this._toggleBtn.style.borderColor = this._createMode ? 'var(--accent)' : 'var(--line)';
    },

    _tick(now) {
      const JS = window.JourneyState;
      const s = JS ? JS._state : null;
      if (s && this._ctx) {
        // Default render: a faint circle whose position/size follow the journey.
        // Subscribers can override by clearing the canvas first.
        this._ctx.clearRect(0, 0, this._canvas.width, this._canvas.height);
        const cx = this._canvas.width / 2 + s.player.position.x * 60;
        const cy = this._canvas.height / 2 - s.player.position.y * 60;
        const radius = 8 + s.audio.energy * 18 + (s.audio.beatPulse ? 6 : 0);
        const hue = (this._hueAccum = (this._hueAccum || 0) + 1.2 / 60) % 360;
        this._ctx.fillStyle = `hsla(${hue}, 80%, 60%, ${this._createMode ? 0.4 : 0.18})`;
        this._ctx.beginPath();
        this._ctx.arc(cx, cy, radius, 0, Math.PI * 2);
        this._ctx.fill();
        // Trail dot at velocity direction
        if (Math.hypot(s.player.velocity.x, s.player.velocity.y) > 0.005) {
          const tx = cx + s.player.velocity.x * 40;
          const ty = cy - s.player.velocity.y * 40;
          this._ctx.fillStyle = `hsla(${(hue + 180) % 360}, 70%, 70%, ${this._createMode ? 0.25 : 0.10})`;
          this._ctx.beginPath();
          this._ctx.arc(tx, ty, 3, 0, Math.PI * 2);
          this._ctx.fill();
        }
        // Run user subscribers.
        for (const cb of this._subscribers) {
          try { cb(this._ctx, s, this._canvas); } catch (e) { console.warn('[alpha-layer] subscriber error', e); }
        }
      }
      this._rafId = requestAnimationFrame((n) => this._tick(n));
    },

    // For users to drop their own JS shapes into the alpha layer.
    subscribe(cb) {
      this._subscribers.add(cb);
      return () => this._subscribers.delete(cb);
    },

    stop() {
      if (this._rafId) cancelAnimationFrame(this._rafId);
      if (this._canvas && this._canvas.parentElement) this._canvas.parentElement.removeChild(this._canvas);
      if (this._toggleBtn && this._toggleBtn.parentElement) this._toggleBtn.parentElement.removeChild(this._toggleBtn);
      this._rafId = 0;
    },
  };

  window.AlphaLayer = Alpha;
})();
