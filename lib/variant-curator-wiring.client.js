// lib/variant-curator-wiring.client.js
//
// Shared curator-stack UI wiring for the engine variants (neon / film /
// grid / smoke / hallucination) + the PWA engine.html shell + the
// dashboard. Each surface ships its own toolbar markup (Hooks / Stats /
// Mood / Scenes / Automix + sub-buttons) and its own hook-panel +
// automix-debug-panel placement, but the click→runtime wiring is
// identical. This module extracts that wiring into one place.
//
// What it does:
//   1. Wires #hook-btn → SWR_HOOK_DETECTOR.detect() + reveal #hook-panel
//      with the detected drop time / energy / confidence.
//   2. Wires .hook-preset chips → SWR_HOOK_DETECTOR.exportHook(preset).
//   3. Wires #hook-clear → clears lastResult + hides #hook-panel.
//   4. Wires #stats-btn → opens a modal showing SWR_STATS.summary().
//   5. Wires #mood-btn → opens a modal with image upload that calls
//      SWR_MOOD.analyze() + applySuggestion() + setOverlayImage().
//   6. Wires #scenes-btn → opens a modal with 4 pads; click=recall,
//      long-press (1s)=save (delegates to SWR_SCENES).
//   7. Does NOT wire #automix-toggle, #automix-freeze, #automix-save,
//      #automix-lock, or #automix-debug — those are handled by
//      client/automix-runtime.client.js (which auto-wires on
//      DOMContentLoaded if the expected elements exist).
//
// Loading:
//   <script src="../lib/variant-curator-wiring.client.js" defer></script>
// or
//   <script src="/lib/variant-curator-wiring.client.js" defer></script>
//
// Idempotent: returns the existing window.SWR_CURATOR_WIRED on second
// evaluation. Safe to load on every variant.

(function () {
  'use strict';
  if (window.SWR_CURATOR_WIRED) return;

  function $(id) { return document.getElementById(id); }

  // Status pill text — variants use different elements for status.
  // Try a few common IDs in order: #status, #set-status, #dash-status-pill.
  // Falls back to console.log if none is found.
  function setStatus(msg, kind) {
    var el = $('status') || $('set-status') || $('dash-status-pill');
    if (el) {
      el.textContent = msg;
      el.style.color = kind === 'err' ? '#f55' : '#5f5';
      return;
    }
    if (kind === 'err') console.warn('[curator]', msg);
    else console.log('[curator]', msg);
  }

  function makeModal(id, bodyHtml, onClose) {
    var m = document.createElement('div');
    m.id = id;
    m.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:var(--panel-2);color:var(--fg);padding:20px;border:1px solid var(--accent);border-radius:8px;z-index:9999;font:11px ui-monospace,monospace;';
    m.innerHTML = bodyHtml;
    document.body.appendChild(m);
    if (onClose) {
      var closeBtn = m.querySelector('.swr-curator-close');
      if (closeBtn) closeBtn.addEventListener('click', onClose);
    }
    return m;
  }

  function wire() {
    // ---- Hook detector ----
    var hookBtn = $('hook-btn');
    if (hookBtn) {
      hookBtn.addEventListener('click', async function () {
        if (!window.SWR_HOOK_DETECTOR) { setStatus('hook detector not loaded', 'err'); return; }
        setStatus('analyzing drop…', 'ok');
        var r = await window.SWR_HOOK_DETECTOR.detect();
        if (r && r.ok) {
          var p = $('hook-panel'); if (p) p.style.display = 'block';
          var t = $('hook-time'), e = $('hook-energy'), c = $('hook-conf');
          if (t) t.textContent = r.result.time + 's';
          if (e) e.textContent = r.result.energy + '\u00d7';
          if (c) c.textContent = Math.round(r.result.confidence * 100) + '%';
          setStatus('drop @ ' + r.result.time + 's', 'ok');
        } else {
          setStatus((r && r.reason) || 'detection failed', 'err');
        }
      });
    }
    var hookClear = $('hook-clear');
    if (hookClear) {
      hookClear.addEventListener('click', function () {
        if (window.SWR_HOOK_DETECTOR) window.SWR_HOOK_DETECTOR.lastResult = null;
        var p = $('hook-panel'); if (p) p.style.display = 'none';
      });
    }
    document.querySelectorAll('.hook-preset').forEach(function (btn) {
      btn.addEventListener('click', async function () {
        if (!window.SWR_HOOK_DETECTOR) { setStatus('hook detector not loaded', 'err'); return; }
        setStatus('starting ' + btn.dataset.preset + ' export…', 'ok');
        var r = await window.SWR_HOOK_DETECTOR.exportHook(btn.dataset.preset);
        if (!r || !r.ok) setStatus((r && r.reason) || 'export failed', 'err');
      });
    });

    // ---- Stats modal ----
    var statsBtn = $('stats-btn');
    if (statsBtn) {
      statsBtn.addEventListener('click', function () {
        if (!window.SWR_STATS) return;
        var s = window.SWR_STATS.summary();
        var existing = $('swr-stats-modal');
        if (existing) { existing.remove(); return; }
        makeModal('swr-stats-modal',
          '<h3 style="margin:0 0 12px;color:var(--accent);font-size:14px;">Local Stats</h3>' +
          '<div>Total renders: <b>' + s.totalRenders + '</b></div>' +
          '<div>Last 30 days: <b>' + s.last30Count + '</b></div>' +
          '<div>Total minutes: <b>' + s.totalMinutes + '</b></div>' +
          '<div>Total size: <b>' + s.totalSizeMB + ' MB</b></div>' +
          '<div style="margin-top:12px;display:flex;gap:6px;">' +
            '<button class="tbtn swr-curator-close" style="padding:4px 10px;font-size:10px;">Close</button>' +
          '</div>',
          function () { var m = $('swr-stats-modal'); if (m) m.remove(); }
        );
      });
    }

    // ---- Mood modal ----
    var moodBtn = $('mood-btn');
    if (moodBtn) {
      moodBtn.addEventListener('click', function () {
        if (!window.SWR_MOOD) return;
        var existing = $('swr-mood-modal');
        if (existing) { existing.remove(); return; }
        makeModal('swr-mood-modal',
          '<h3 style="margin:0 0 12px;color:var(--accent);font-size:14px;">Mood Board</h3>' +
          '<input type="file" id="swr-mood-file" accept="image/*" style="font-size:10px;">' +
          '<div style="margin-top:8px;font-size:10px;color:var(--muted);">Drop a reference image — k-means palette + brightness/sat/contrast/warmth.</div>' +
          '<div style="margin-top:12px;display:flex;gap:6px;">' +
            '<button class="tbtn" id="swr-mood-apply" style="padding:4px 10px;font-size:10px;">Apply</button>' +
            '<button class="tbtn swr-curator-close" style="padding:4px 10px;font-size:10px;">Close</button>' +
          '</div>' +
          '<div id="swr-mood-result" style="margin-top:10px;font-size:10px;"></div>',
          function () { var m = $('swr-mood-modal'); if (m) m.remove(); }
        );
        var fileInput = $('swr-mood-file');
        if (fileInput) {
          fileInput.addEventListener('change', function (ev) {
            var f = ev.target.files && ev.target.files[0];
            if (!f) return;
            var reader = new FileReader();
            reader.onload = function () {
              var img = new Image();
              img.onload = async function () {
                var r = await window.SWR_MOOD.analyze(img);
                window.SWR_MOOD.setOverlayImage(reader.result);
                window.SWR_MOOD.setOverlayVisible(true);
                var resEl = $('swr-mood-result');
                if (resEl) resEl.textContent = 'bright ' + r.features.meanBright.toFixed(2) +
                  ' · sat ' + r.features.meanSat.toFixed(2) +
                  ' · contrast ' + r.features.contrast.toFixed(2) +
                  ' · temp ' + (r.features.temperature > 0 ? 'warm' : 'cool');
              };
              img.src = reader.result;
            };
            reader.readAsDataURL(f);
          });
        }
        var applyBtn = $('swr-mood-apply');
        if (applyBtn) {
          applyBtn.addEventListener('click', function () {
            if (window.SWR_MOOD.applySuggestion()) setStatus('mood applied', 'ok');
          });
        }
      });
    }

    // ---- Scenes modal ----
    var scenesBtn = $('scenes-btn');
    if (scenesBtn) {
      scenesBtn.addEventListener('click', function () {
        if (!window.SWR_SCENES) return;
        var existing = $('swr-scenes-modal');
        if (existing) { existing.remove(); return; }
        makeModal('swr-scenes-modal',
          '<h3 style="margin:0 0 12px;color:var(--accent);font-size:14px;">Scenes</h3>' +
          '<div style="font-size:10px;color:var(--muted);margin-bottom:8px;">Click to recall · long-press (1s) to save</div>' +
          '<div id="swr-scenes-list" style="display:grid;grid-template-columns:1fr 1fr;gap:4px;"></div>' +
          '<div style="margin-top:12px;display:flex;gap:6px;">' +
            '<button class="tbtn swr-curator-close" style="padding:4px 10px;font-size:10px;">Close</button>' +
          '</div>',
          function () { var m = $('swr-scenes-modal'); if (m) m.remove(); }
        );
        var list = $('swr-scenes-list');
        if (list) {
          window.SWR_SCENES.list().forEach(function (s, i) {
            var pad = document.createElement('button');
            pad.className = 'tbtn';
            pad.style.cssText = 'padding:14px 6px;font-size:10px;';
            pad.textContent = s.label + (s.snapshot ? '' : ' (empty)');
            var timer = null;
            pad.addEventListener('click', function () {
              if (timer) { clearTimeout(timer); timer = null; window.SWR_SCENES.cancelCapture(); return; }
              window.SWR_SCENES.recall(i);
              setStatus('recalled ' + s.label, 'ok');
            });
            pad.addEventListener('mousedown', function () {
              timer = setTimeout(function () {
                window.SWR_SCENES.startCapture(i);
                timer = null;
                setStatus('saving scene ' + (i + 1) + '…', 'ok');
              }, 1000);
            });
            pad.addEventListener('mouseup', function () {
              if (timer) { clearTimeout(timer); timer = null; }
            });
            list.appendChild(pad);
          });
        }
      });
    }
  }

  // Auto-wire on DOMContentLoaded (or immediately if DOM is ready).
  function boot() { wire(); }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }

  // Public API for tests + manual re-wiring after dynamic DOM changes.
  window.SWR_CURATOR_WIRED = {
    wire: wire,
    version: '1.0.0',
  };
})();