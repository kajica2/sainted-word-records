// reel-player.client.js
//
// Timeline player for video_single.html. Reads a reel JSON (panels +
// transitions), drives window.SWR_MOOD between panels, fires the CSS
// transitions on the pack at panel boundaries.
//
// Public API:
//   window.SWRReels.list()          → array of {name, file} for the dropdown
//   window.SWRReels.play(name?)     → start the named reel (or the first)
//   window.SWRReels.stop()          → halt any running reel + revert mood
//   window.SWRReels.current         → { name, panelIndex, status: 'idle'|'playing'|'done' }
//
// Panel shape (see reels/rooftop-opening.json):
//   {
//     id: 'panel-1',
//     at: 0.0,             // absolute time in seconds (cue starts here)
//     hold: 1.2,           // duration the panel stays before the next transition
//     mood: 'wide-rooftop', // painter key (window.SWR_MOOD)
//     transitionIn: { name, cssTransition, duration, audioCue, note } | null,
//     transitionOut: { ... } | null,
//     storyboard: { label, shot, music, color, intent },
//   }
//
// transitionOut fires at panel.at + panel.hold (i.e. just before the next panel).
// transitionIn fires at the panel's own at (which equals the previous panel's
// at + hold + transitionOut.duration). For a 2-panel reel, transitionIn is
// null on every panel (no in-transition — the cut happens via the prior
// transitionOut). For a 3+ panel reel, transitionIn is non-null on panels
// 2..N.

(function () {
  'use strict';
  if (window.SWRReels) return; // idempotent

  const DEFAULT_REEL = 'rooftop-opening';

  let reelsIndex = null;       // [{name, file}] — populated lazily
  let current = { name: null, panelIndex: -1, status: 'idle' };
  let timers = [];             // setTimeout handles (so we can cancel)
  let stopFlag = false;

  function schedule(fn, ms) {
    const id = setTimeout(() => {
      // Drop from the list if it fired (or was cancelled).
      timers = timers.filter((t) => t !== id);
      if (stopFlag) return;
      fn();
    }, ms);
    timers.push(id);
    return id;
  }

  function cancelTimers() {
    for (const id of timers) clearTimeout(id);
    timers = [];
  }

  async function fetchIndex() {
    // Try the manifest first if it exists; fall back to a hardcoded list.
    if (reelsIndex) return reelsIndex;
    try {
      const r = await fetch('./reels/manifest.json');
      if (r.ok) {
        const m = await r.json();
        reelsIndex = m.reels || [];
        return reelsIndex;
      }
    } catch (_) {}
    // Fallback: single known reel.
    reelsIndex = [{ name: DEFAULT_REEL, file: './reels/' + DEFAULT_REEL + '.json' }];
    return reelsIndex;
  }

  async function loadReel(name) {
    const idx = await fetchIndex();
    const entry = idx.find((r) => r.name === name) || idx[0];
    if (!entry) throw new Error('no reel available');
    const r = await fetch(entry.file);
    if (!r.ok) throw new Error('fetch ' + entry.file + ' → ' + r.status);
    const data = await r.json();
    return { ...data, file: entry.file };
  }

  async function fireTransition(spec) {
    if (!spec) return;
    // Match-cut: no CSS transition, just the panel-mood swap is the cut.
    if (!spec.cssTransition || spec.duration === 0) return;
    if (!window.SWRTransitions) return;
    try {
      await window.SWRTransitions.fire(spec.cssTransition, { duration: spec.duration });
    } catch (e) {
      console.warn('[reel]', spec.cssTransition, e);
    }
  }

  // The reel's audio source — fetch it as an ArrayBuffer, convert to a File,
  // and hand it to the existing Audio.load(). Falls back gracefully if the
  // file isn't reachable (e.g. in dev with no library fetched).
  async function loadAudio(src) {
    if (!src) return;
    try {
      const r = await fetch(src);
      if (!r.ok) return;
      const blob = await r.blob();
      const name = (src.split('/').pop() || 'reel.mp3');
      const file = new File([blob], name, { type: blob.type || 'audio/mpeg' });
      if (window.SWR && window.SWR.Audio) {
        window.SWR.Audio.load(file);
        window.SWR.Audio.play();
      }
    } catch (e) {
      console.warn('[reel] audio load:', e.message);
    }
  }

  async function play(name) {
    stop();
    stopFlag = false;
    current = { name: name || DEFAULT_REEL, panelIndex: 0, status: 'playing' };
    notifyUi();
    let reel;
    try {
      reel = await loadReel(current.name);
    } catch (e) {
      console.warn('[reel]', e);
      current.status = 'idle';
      notifyUi();
      return;
    }
    // Load the reel's audio (best-effort).
    loadAudio(reel.audio);
    const panels = reel.panels || [];
    if (!panels.length) {
      current.status = 'idle';
      notifyUi();
      return;
    }
    // Set initial mood immediately.
    window.SWR_MOOD = panels[0].mood;
    // For each panel boundary, schedule the transition.
    // transitionIn of panel N fires at panels[N].at (assuming panels[N-1]
    // finished its hold). transitionOut of panel N fires at panels[N].at +
    // panels[N].hold. The transitionIn lands on top of the previous
    // transitionOut — we fire transitionIn first (just before the cut),
    // swap mood, then fire transitionOut after the mood's been held for
    // hold seconds. Practically: fire transitionIn at at, then transitionOut
    // at at + hold.
    for (let i = 0; i < panels.length; i++) {
      const p = panels[i];
      const startMs = Math.max(0, p.at * 1000);
      // transitionIn (skip on the first panel — there's no prior state)
      if (i > 0 && p.transitionIn && p.transitionIn.cssTransition) {
        schedule(() => {
          window.SWR_MOOD = p.mood;
          fireTransition(p.transitionIn);
          current.panelIndex = i;
          notifyUi();
        }, startMs);
      } else if (i > 0) {
        // No transitionIn — instant mood swap at panel boundary.
        schedule(() => {
          window.SWR_MOOD = p.mood;
          current.panelIndex = i;
          notifyUi();
        }, startMs);
      }
      // transitionOut
      if (p.transitionOut) {
        const outMs = (p.at + (p.hold || 0)) * 1000;
        schedule(() => {
          fireTransition(p.transitionOut);
        }, outMs);
      }
    }
    // End marker — total reel duration.
    const lastPanel = panels[panels.length - 1];
    const totalS = lastPanel.at + (lastPanel.hold || 0);
    schedule(() => {
      current.status = 'done';
      notifyUi();
    }, totalS * 1000 + 200);
  }

  function stop() {
    stopFlag = true;
    cancelTimers();
    if (window.SWR && window.SWR.Audio && window.SWR.Audio.pause) {
      try { window.SWR.Audio.pause(); } catch (_) {}
    }
    current = { name: current.name, panelIndex: -1, status: 'idle' };
    window.SWR_MOOD = 'default';
    notifyUi();
  }

  // Lightweight UI hook — the reel player doesn't own DOM, but dispatches
  // a CustomEvent when state changes so the host page can update its own
  // controls (reel button label, panel indicator, etc.).
  function notifyUi() {
    try {
      window.dispatchEvent(new CustomEvent('swr-reel-state', { detail: { ...current } }));
    } catch (_) {}
  }

  window.SWRReels = {
    play, stop, list: () => fetchIndex(),
    get current() { return { ...current }; },
  };
})();