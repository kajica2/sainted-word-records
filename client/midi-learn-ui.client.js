// client/midi-learn-ui.client.js — in-page target picker for MIDI
// learn mode. Listens to `swr-midi-learn` CustomEvents from
// SWR_MIDI and renders a small floating popup with one button per
// possible target. Tap a target -> commit. Escape or Cancel ->
// cancel.
//
// The popup sits in the top-center of the viewport, below the HUD
// on the engine, and is keyboard-accessible. Mobile + desktop share
// the same UI; the engine's body is not blocked (we use pointer-events
// only on the panel, not the page).

(function () {
  'use strict';
  if (window.SWR_MIDI_LEARN_UI) return;

  // Skip on pages that don't opt in
  function ready(fn) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', fn);
    } else { fn(); }
  }

  ready(function () {
    if (!window.SWR_MIDI) return;
    if (!document.getElementById('midi-pill') &&
        !document.getElementById('c-onboard') &&
        !document.querySelector('[data-midi-learn]')) {
      // Page hasn't opted in via pill, onboard sentinel, or attribute.
      // Mount quietly anyway, in case the page wants the UI without
      // any of those opt-ins.
    }

    let pop = null;
    let targetButtons = [];

    function ensureDOM() {
      if (pop) return pop;
      pop = document.createElement('div');
      pop.className = 'swr-learn-pop';
      pop.setAttribute('role', 'dialog');
      pop.setAttribute('aria-live', 'polite');
      pop.setAttribute('aria-modal', 'true');
      pop.setAttribute('aria-labelledby', 'swr-learn-title');
      pop.style.cssText = [
        'position:fixed',
        'left:50%', 'top:calc(env(safe-area-inset-top, 0px) + 64px)',
        'transform:translateX(-50%)',
        'min-width:280px', 'max-width:calc(100vw - 24px)',
        'padding:14px 16px',
        'background:rgba(8,8,12,.96)',
        'border:1px solid rgba(255,255,255,.12)',
        'border-radius:14px',
        'box-shadow:0 12px 32px rgba(0,0,0,.5)',
        'backdrop-filter:blur(20px)',
        '-webkit-backdrop-filter:blur(20px)',
        'color:#f6f6fa',
        'font:600 12px/1.4 system-ui',
        'z-index:60', 'pointer-events:auto',
        'display:none',
      ].join(';');
      document.body.appendChild(pop);
      return pop;
    }

    function show(message) {
      const p = ensureDOM();
      p.innerHTML = message + '<div class="swr-learn-actions" style="margin-top:10px; display:flex; gap:6px; flex-wrap:wrap;"></div>';
      p.style.display = 'block';
      return p;
    }
    function hide() {
      if (!pop) return;
      pop.style.display = 'none';
      pop.innerHTML = '';
    }

    function status() {
      try { return window.SWR_MIDI && window.SWR_MIDI.snapshot(); }
      catch (_) { return null; }
    }

    function buildTargetList() {
      const out = [];
      const L = window.Layers;
      if (L && Array.isArray(L.list)) {
        for (let i = 0; i < L.list.length && i < 16; i++) {
          const li = document.createElement('button');
          li.className = 'swr-learn-target';
          li.type = 'button';
          li.dataset.target = ':' + i + ':opacity';
          li.textContent = 'Layer ' + (i + 1) + ' · opacity';
          styleTargetButton(li);
          out.push(li);

          const ls = document.createElement('button');
          ls.className = 'swr-learn-target';
          ls.type = 'button';
          ls.dataset.target = ':' + i + ':baseScale';
          ls.textContent = 'Layer ' + (i + 1) + ' · scale';
          styleTargetButton(ls);
          out.push(ls);

          if (L.selected && L.selected === L.list[i]) {
            const ro = document.createElement('button');
            ro.className = 'swr-learn-target';
            ro.type = 'button';
            ro.dataset.target = ':' + i + ':rotOffset';
            ro.textContent = 'Layer ' + (i + 1) + ' · rotation';
            styleTargetButton(ro);
            out.push(ro);
          }
        }
      }
      // Always-available fallbacks
      out.push(makeTargetBtn(':0:opacity', 'Selected · opacity'));
      out.push(makeTargetBtn(':0:baseScale', 'Selected · scale'));
      out.push(makeTargetBtn(':autoSwap:freeze', 'Auto-swap · freeze'));
      out.push(makeTargetBtn(':swr-autoMap', 'No-op (cancel)'));
      return out;
    }

    function makeTargetBtn(target, label) {
      const li = document.createElement('button');
      li.className = 'swr-learn-target';
      li.type = 'button';
      li.dataset.target = target;
      li.textContent = label;
      styleTargetButton(li);
      return li;
    }

    function styleTargetButton(el) {
      el.style.cssText = [
        'padding:8px 12px',
        'min-height:36px',
        'background:rgba(255,255,255,.06)',
        'border:1px solid rgba(255,255,255,.12)',
        'color:#f6f6fa',
        'border-radius:8px',
        'font:600 11px/1.2 system-ui',
        'cursor:pointer',
        'flex:1 1 calc(50% - 6px)',
        'min-width:140px',
      ].join(';');
    }

    function renderCaptured() {
      const s = status();
      if (!s) return hide();
      // Find the captured CC detail from learn state via subscribeLearn
      // We pass a one-shot listener that fills in the head.
      const head = '<div id="swr-learn-title" style="display:flex; align-items:center; gap:8px; margin-bottom:8px;">' +
        '<span aria-hidden="true" style="color:#fbbf24; font-size:14px;">●</span>' +
        '<span style="flex:1;">' + renderHead(s) + '</span>' +
        '<button id="swr-learn-cancel" type="button" style="background:transparent; border:0; color:rgba(255,255,255,.55); cursor:pointer; font:600 11px/1 system-ui; padding:6px 8px;">Cancel</button>' +
        '</div>';
      const p = show(head);
      const actions = p.querySelector('.swr-learn-actions');
      targetButtons = buildTargetList();
      targetButtons.forEach(function (b) {
        b.addEventListener('click', function () {
          const target = b.dataset.target;
          if (target === ':swr-autoMap') {
            window.SWR_MIDI.cancel();
            hide();
            return;
          }
          const saved = window.SWR_MIDI.commit(target);
          hide();
          // Status feedback
          if (window.setStatus) {
            const cc = saved ? saved.cc : '?';
            const input = saved ? saved.input : 'device';
            window.setStatus('midi: bound CC ' + cc + ' (' + input + ') → ' + target, 'ok');
          }
        });
        actions.appendChild(b);
      });
      // Cancel button
      const cancelBtn = p.querySelector('#swr-learn-cancel');
      if (cancelBtn) {
        cancelBtn.addEventListener('click', function () {
          window.SWR_MIDI.cancel();
          hide();
        });
      }
    }

    function renderHead(s) {
      // Pull the latest captured info from the midi module's
      // subscribeLearn so the head text shows CC + value.
      // We use a one-shot approach: subscribe, read, unsubscribe.
      let capturedInfo = null;
      const unsub = window.SWR_MIDI.subscribeLearn(function (state, cap) {
        if (state === 'captured') capturedInfo = cap;
      });
      // re-emit to make sure the listener fires
      try { window.dispatchEvent(new CustomEvent('swr-midi-learn')); } catch (_) {}
      unsub();
      if (!capturedInfo) {
        return s.enabled
          ? (s.inputs.length ? 'move a knob / fader to bind' : 'no MIDI input — plug one in')
          : 'midi: auto-map disabled';
      }
      return 'Bind CC ' + capturedInfo.cc + ' (' + capturedInfo.input +
             ', value ' + capturedInfo.value + ') to:';
    }

    // Listen to learn state changes from SWR_MIDI
    function onLearnEvent(ev) {
      const detail = (ev && ev.detail) || {};
      if (detail.state === 'captured') renderCaptured();
      else if (detail.state === 'idle' || detail.state === 'armed') hide();
    }

    document.addEventListener('swr-midi-learn', onLearnEvent);

    // Escape closes
    document.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape' && pop && pop.style.display !== 'none') {
        window.SWR_MIDI.cancel();
        hide();
      }
    });

    // Public surface so the page can pop the picker manually.
    window.SWR_MIDI_LEARN_UI = {
      arm: function () { if (window.SWR_MIDI) window.SWR_MIDI.arm(); },
      cancel: function () {
        if (window.SWR_MIDI) window.SWR_MIDI.cancel();
        hide();
      },
      show: function () { renderCaptured(); },
      hide: hide,
    };
  });
})();
