// engine-reel.client.js — auto-advance "demo reel" player for the engine.
//
// Plays a curated reel (marketplace/curated/*.reel.json) as a hands-off
// playlist: each track brings its own .swr-set (FX persona + hero layer)
// and its own audio. On genuine track end the reel auto-advances to the
// next track; a reel with `loop: true` wraps to track 0 after the last
// track, otherwise it stops at the end.
//
// Reel manifest (swr-reel/v1):
//   { schema: 'swr-reel/v1', id, name, description, createdAt, author,
//     tags, loop, tracks: [{ setFile, setId, name, engine, audio,
//     durationSeconds }] }
//
// Track sets are standard .swr-set docs (see swr-sets.js). They are
// imported via window.SWR_SETS.importSet() and applied via applySet().
//
// Public API on window.SWR_REEL (one global — the *.client.js convention):
//   .CATALOG                  — curated reel registry (feeds the toolbar select)
//   .state                    — live { playing, index, total, current, tracks }
//   .getState()               — shallow snapshot of the above
//   .subscribe(fn)            — fn(snapshot) after every change; returns unsubscribe
//   .loadReel(urlOrManifest)  — fetch + cache the manifest and its set docs
//   .play(i = 0)              — apply + play track i (default: first track)
//   .pause() / .resume()      — pause/resume the current track
//   .togglePlay()             — UI button helper (play ⇄ pause)
//   .next() / .prev()         — jump to the next/previous track
//   .goto(i)                  — jump to track i (clamped to range)
//   .stop()                   — pause, reset to track 0, detach the ended hook
//   .destroy()                — stop + drop all subscribers
//
// Edge behavior (manual navigation honors the reel's `loop` flag):
//   - next() on the last track: wraps to 0 iff loop, else stays put.
//   - prev() on track 0: wraps to the last track iff loop, else restarts
//     track 0 (re-applies it, so the audio starts over).
//   - goto(i) always clamps; it never wraps.
//   - Auto-advance (the 'ended' hook) wraps iff loop; with loop false the
//     reel stops at the end of the last track.
//
// 'ended' coexistence: the Audio bus (lib/audio.client.js on engine.html,
// the inline Audio class on the variants) attaches its own single 'ended'
// listener per loaded element (song-end pause/fade). Audio.loadFile()
// creates a FRESH media element per load, so per-element listeners never
// accumulate across tracks — the old element (and its listeners) dies with
// the swap. We attach one listener to the CURRENT element after each apply
// and detach it on stop()/destroy() (attachEnded/detachEnded) so no reel
// listener outlives the reel. Auto-advance fires ONLY from a genuine
// 'ended' while state.playing — pause()/stop() never route through the
// advance path, and a re-entrancy guard means one 'ended' advances exactly
// one track.
//
// Layer reset: applySet() appends library files and maps metadata onto the
// tail of Layers.list, so without a reset the layer stack would grow across
// tracks. The reel clears the layer list right before each applySet and
// then materializes the set's hero layer itself (restoreHeroLayers) —
// applySet's tail mapping is a no-op on an empty list.

(function () {
  if (window.SWR_REEL) return; // idempotent

  // ---- curated reel registry ---------------------------------------------
  // Mirrors the "nothing auto-loads" ethos of the library packs: entries
  // only load when the user picks one in the toolbar select.
  const CATALOG = [
    {
      id: 'slip-sets-1',
      name: 'Slip Sets 1',
      url: '/marketplace/curated/slip-sets-1.reel.json',
    },
  ];

  // ---- state ---------------------------------------------------------------
  const state = {
    playing: false,
    index: 0,
    total: 0,
    current: null, // { name, engine } of the selected track
    tracks: [],    // public track info (name, engine, setFile, audio, durationSeconds)
  };

  let manifest = null;    // parsed swr-reel/v1 doc, null until loadReel()
  let setDocs = [];       // cached per-track .swr-set JSON strings (from loadReel)
  let setPromises = [];   // per-track importSet cache: in-flight Promise | resolved set
  let loadedIndex = -1;   // track currently applied to the engine, -1 = none
  let seq = 0;            // token: bumped by every command so superseded async
                          // track loads bail instead of clobbering newer ones
  let advancing = false;  // re-entrancy guard for the 'ended' path
  let endedEl = null;     // element our 'ended' hook is attached to
  let endedFn = null;
  const listeners = [];

  // ---- dependency lookups (read at call time — script order varies) --------
  function setsApi() {
    return window.SWR_SETS || null;
  }
  // window.Audio is the native Audio constructor until lib/audio.client.js
  // attaches the engine bus — require loadFile() before trusting it.
  function audioApi() {
    const a = (window.SWR && window.SWR.Audio) || window.Audio || null;
    return a && typeof a.loadFile === 'function' ? a : null;
  }
  function layersApi() {
    const l = window.Layers || (window.SWR && window.SWR.Layers) || null;
    return l && Array.isArray(l.list) ? l : null;
  }
  function libraryApi() {
    return window.Library || (window.SWR && window.SWR.Library) || null;
  }
  function status(msg, cls) {
    if (typeof window.setStatus === 'function') window.setStatus(msg, cls);
  }

  // ---- helpers -------------------------------------------------------------
  function ready() {
    return !!manifest && state.total > 0;
  }

  function loopEnabled() {
    return !!(manifest && manifest.loop);
  }

  function clampIndex(i) {
    const n = Number(i);
    const v = Number.isFinite(n) ? Math.trunc(n) : 0;
    return Math.max(0, Math.min(state.total - 1, v));
  }

  // Resolve a track's setFile against the manifest URL (and the manifest URL
  // against the page) so relative refs work; root-absolute and absolute refs
  // pass through unchanged. Falls back to the ref as-is where URL parsing is
  // unavailable.
  function resolveRef(ref, base) {
    try {
      const loc = (window.location && window.location.href) || '';
      const anchor = base ? (loc ? new URL(base, loc) : base) : loc;
      return anchor ? new URL(ref, anchor).toString() : ref;
    } catch (_) {
      return ref;
    }
  }

  async function fetchText(url) {
    const res = await fetch(url);
    if (!res || !res.ok) {
      throw new Error('HTTP ' + (res ? res.status : 'no response') + ' for ' + url);
    }
    return res.text();
  }

  function snapshot() {
    return {
      playing: state.playing,
      index: state.index,
      total: state.total,
      current: state.current ? { name: state.current.name, engine: state.current.engine } : null,
      tracks: state.tracks.map((t) => ({
        name: t.name,
        engine: t.engine,
        setFile: t.setFile,
        audio: t.audio,
        durationSeconds: t.durationSeconds,
      })),
    };
  }

  function notify() {
    const snap = snapshot();
    for (const fn of listeners.slice()) {
      try { fn(snap); } catch (e) { console.warn('reel subscriber failed', e); }
    }
  }

  function subscribe(fn) {
    if (typeof fn !== 'function') return function () {};
    listeners.push(fn);
    return function unsubscribe() {
      const i = listeners.indexOf(fn);
      if (i >= 0) listeners.splice(i, 1);
    };
  }

  // ---- 'ended' hook --------------------------------------------------------
  function attachEnded(el) {
    detachEnded();
    if (!el || typeof el.addEventListener !== 'function') return;
    endedEl = el;
    endedFn = onEnded;
    el.addEventListener('ended', endedFn);
  }

  function detachEnded() {
    const el = endedEl;
    const fn = endedFn;
    endedEl = null;
    endedFn = null;
    if (el && fn && typeof el.removeEventListener === 'function') {
      try { el.removeEventListener('ended', fn); } catch (_) {}
    }
  }

  // The ONLY auto-advance trigger. Manual pause()/stop() leave
  // state.playing false, so a straggler 'ended' (e.g. from an element that
  // was already at its end during a swap) is ignored — advance never fires
  // from a manual pause.
  function onEnded() {
    if (!state.playing) return;
    if (advancing) return; // one 'ended' must advance exactly one track
    advancing = true;
    (async () => {
      try {
        await advance();
      } catch (e) {
        console.warn('reel: advance failed', e);
      } finally {
        advancing = false;
      }
    })();
  }

  async function advance() {
    const isLast = state.index + 1 >= state.total;
    if (isLast) {
      if (!loopEnabled()) {
        // loop:false — the reel stops at the end of the last track.
        detachEnded();
        state.playing = false;
        status('reel finished', 'ok');
        notify();
        return;
      }
      await applyTrack(0, { autoplay: true });
      return;
    }
    await applyTrack(state.index + 1, { autoplay: true });
  }

  // ---- layer reset + hero restore -----------------------------------------
  // In-place clear: the render loop and panels hold the Layers.list array
  // reference, so splice/length=0 (the same reset used by persist-wire and
  // project.client.js) — never reassign the array.
  function clearLayers() {
    const layers = layersApi();
    if (!layers) return;
    layers.list.length = 0;
    layers.selected = null;
    if (typeof layers.render === 'function') layers.render();
    const se = document.getElementById && document.getElementById('stage-empty');
    if (se && se.classList) se.classList.remove('hidden');
  }

  function findLibItem(assetFile) {
    const lib = libraryApi();
    if (!lib || !Array.isArray(lib.items) || !assetFile) return null;
    const name = assetFile.name || '';
    const size = assetFile.size;
    return lib.items.find((i) => i.name === name && (size == null || !i.blob || i.blob.size === size))
      || lib.items.find((i) => i.name === name)
      || null;
  }

  // Same field mapping applySet() uses for tail layers — kept here because
  // applySet's mapping is a no-op on an empty list (which is exactly the
  // state we hand it after clearLayers()).
  function applyLayerMeta(layer, ld) {
    if (!layer || !ld) return;
    if (ld.blend) layer.blend = ld.blend;
    if (typeof ld.opacity === 'number') layer.opacity = ld.opacity;
    if (typeof ld.baseScale === 'number') layer.baseScale = ld.baseScale;
    if (typeof ld.hue === 'number') layer.hue = ld.hue;
    if (typeof ld.brightness === 'number') layer.brightness = ld.brightness;
    if (typeof ld.contrast === 'number') layer.contrast = ld.contrast;
    if (ld.pos) layer.pos = ld.pos;
    if (typeof ld.rotOffset === 'number') layer.rotOffset = ld.rotOffset;
    if (Array.isArray(ld.reactors)) layer.reactors = ld.reactors;
    if (Array.isArray(ld.modulators)) layer.modulators = ld.modulators;
  }

  // Materialize each set layer as a real engine layer. Idempotent: if a
  // layer for the asset already exists (some pages create layers during
  // applySet's addFiles), only its metadata is refreshed.
  function restoreHeroLayers(set) {
    const layers = layersApi();
    if (!layers || !set || !Array.isArray(set.layers)) return;
    for (const ld of set.layers) {
      if (!ld || !ld.asset) continue;
      let target = layers.list.find((l) => l.asset && ld.asset && l.asset.name === ld.asset.name) || null;
      if (!target) {
        const item = findLibItem(ld.asset);
        if (!item) {
          status('reel: hero asset missing (' + (ld.asset.name || '?') + ')', 'warn');
          continue;
        }
        if (typeof layers.add !== 'function') continue;
        layers.add(item);
        target = layers.list[layers.list.length - 1] || null;
      }
      applyLayerMeta(target, ld);
    }
    if (typeof layers.render === 'function') layers.render();
  }

  // ---- track loading -------------------------------------------------------
  // importSet() fetches the media each doc references (audio + hero art),
  // so the result is cached per track: a looping reel downloads each mp3
  // once, not once per lap. A failed import clears its slot so it can retry.
  function getSet(i) {
    if (setPromises[i]) return setPromises[i];
    const sets = setsApi();
    if (!sets || typeof sets.importSet !== 'function') {
      return Promise.reject(new Error('swr-sets module not loaded'));
    }
    const p = Promise.resolve(sets.importSet(setDocs[i])).catch((err) => {
      setPromises[i] = null;
      throw err;
    });
    setPromises[i] = p;
    return p;
  }

  async function applyTrack(i, opts) {
    opts = opts || {};
    const autoplay = !!opts.autoplay;
    const token = ++seq; // supersedes any in-flight track load
    const track = state.tracks[i];
    if (!track) return;

    state.index = i;
    state.current = { name: track.name, engine: track.engine };
    detachEnded();
    notify();

    let set;
    try {
      set = await getSet(i);
    } catch (e) {
      if (token !== seq) return;
      console.warn('reel: track load failed', e);
      status('reel: could not load ' + track.name, 'err');
      state.playing = false;
      notify();
      return;
    }
    if (token !== seq) return; // a newer command took over while fetching

    const sets = setsApi();
    if (!sets || typeof sets.applySet !== 'function') {
      status('reel: swr-sets module not loaded', 'err');
      state.playing = false;
      notify();
      return;
    }

    // Replace (never append) the layer stack. Clearing right before the
    // apply keeps the finished track's visual on stage while its successor
    // downloads; applySet then brings in the new set's files.
    clearLayers();
    const audioBefore = audioApi();
    const elBefore = (audioBefore && audioBefore.audioEl) || null;
    try {
      await sets.applySet(set); // FX persona + audio load/play + library add
    } catch (e) {
      if (token !== seq) return;
      console.warn('reel: applySet failed', e);
      status('reel: could not apply ' + track.name, 'err');
      state.playing = false;
      notify();
      return;
    }
    if (token !== seq) return;

    restoreHeroLayers(set);

    // applySet loads audio via Audio.loadFile(), which always creates a NEW
    // media element — so the audio is live iff audioEl changed identity.
    // (A set without audio, or a failed fetch, leaves the old element in
    // place and must not be re-attached/re-played as if it were this track.)
    const audio = audioApi();
    const elAfter = (audio && audio.audioEl) || null;
    const hasAudio = !!elAfter && elAfter !== elBefore;
    if (hasAudio) attachEnded(elAfter);
    else status('reel: ' + track.name + ' has no audio', 'warn');

    if (autoplay && hasAudio) {
      if (typeof audio.play === 'function') audio.play();
      state.playing = true;
    } else {
      // applySet plays unconditionally — honor a paused jump instead.
      if (audio && typeof audio.pause === 'function') audio.pause();
      state.playing = false;
    }
    loadedIndex = i;
    status('reel: ' + (i + 1) + '/' + state.total + ' · ' + track.name, 'ok');
    notify();
  }

  // ---- commands ------------------------------------------------------------
  async function loadReel(src) {
    let doc;
    let base = null;
    if (typeof src === 'string') {
      const res = await fetch(src);
      if (!res || !res.ok) {
        throw new Error('reel manifest HTTP ' + (res ? res.status : 'no response'));
      }
      doc = await res.json();
      base = src;
    } else if (src && typeof src === 'object') {
      doc = src;
    } else {
      throw new Error('loadReel expects a manifest URL or a parsed manifest');
    }

    if (doc.schema !== 'swr-reel/v1') {
      throw new Error('unsupported reel schema: ' + doc.schema);
    }
    const tracks = Array.isArray(doc.tracks) ? doc.tracks : [];
    if (!tracks.length) throw new Error('reel has no tracks');
    tracks.forEach((t, i) => {
      if (!t || typeof t.setFile !== 'string' || !t.setFile) {
        throw new Error('reel track ' + i + ' has no setFile');
      }
    });

    // Fetch + cache every track's .swr-set doc up front (cheap JSON); the
    // media those docs reference is fetched lazily by importSet on first
    // play, so loading a reel never downloads the mp3s up front.
    const docs = await Promise.all(
      tracks.map((t) => fetchText(resolveRef(t.setFile, base)))
    );

    manifest = doc;
    setDocs = docs;
    setPromises = [];
    loadedIndex = -1;
    detachEnded();
    state.playing = false;
    state.index = 0;
    state.total = tracks.length;
    state.tracks = tracks.map((t, i) => ({
      name: t.name || 'Track ' + (i + 1),
      engine: t.engine || '',
      setFile: t.setFile,
      audio: t.audio || '',
      durationSeconds: t.durationSeconds || 0,
    }));
    state.current = { name: state.tracks[0].name, engine: state.tracks[0].engine };
    notify();
    return doc;
  }

  async function play(i) {
    if (!ready()) {
      status('demo reel: pick a reel first', 'warn');
      return;
    }
    state.playing = true; // intent — applyTrack keeps it on only if audio loaded
    await applyTrack(clampIndex(i == null ? 0 : i), { autoplay: true });
  }

  function pause() {
    state.playing = false;
    const audio = audioApi();
    if (audio && typeof audio.pause === 'function') audio.pause();
    notify();
  }

  function resume() {
    if (loadedIndex < 0) {
      status('demo reel: press play first', 'warn');
      return;
    }
    const audio = audioApi();
    if (!audio || !audio.audioEl) {
      status('demo reel: no track loaded', 'warn');
      return;
    }
    state.playing = true;
    if (typeof audio.play === 'function') audio.play();
    notify();
  }

  function togglePlay() {
    if (state.playing) {
      pause();
    } else if (loadedIndex >= 0) {
      resume();
    } else {
      play().catch((e) => console.warn('reel: play failed', e));
    }
  }

  async function next() {
    if (!ready()) {
      status('demo reel: pick a reel first', 'warn');
      return;
    }
    const i = state.index + 1;
    if (i >= state.total) {
      if (!loopEnabled()) {
        status('end of reel', 'warn');
        return;
      }
      await applyTrack(0, { autoplay: state.playing });
      return;
    }
    await applyTrack(i, { autoplay: state.playing });
  }

  async function prev() {
    if (!ready()) {
      status('demo reel: pick a reel first', 'warn');
      return;
    }
    const i = state.index - 1;
    if (i < 0) {
      // Manual prev at the top of the reel wraps iff loop; otherwise it
      // restarts the current track (standard player behavior).
      await applyTrack(loopEnabled() ? state.total - 1 : 0, { autoplay: state.playing });
      return;
    }
    await applyTrack(i, { autoplay: state.playing });
  }

  async function goto(i) {
    if (!ready()) {
      status('demo reel: pick a reel first', 'warn');
      return;
    }
    await applyTrack(clampIndex(i), { autoplay: state.playing });
  }

  function stop() {
    seq++; // cancel any in-flight track load
    advancing = false;
    state.playing = false;
    detachEnded();
    const audio = audioApi();
    if (audio && typeof audio.pause === 'function') audio.pause();
    loadedIndex = -1;
    state.index = 0;
    state.current = state.tracks.length
      ? { name: state.tracks[0].name, engine: state.tracks[0].engine }
      : null;
    notify();
  }

  function destroy() {
    stop();
    listeners.length = 0;
  }

  // ---- toolbar UI (engine.html) -------------------------------------------
  // Self-mounting, like lib/intensity-slider.client.js: no-op on pages that
  // don't render the reel bar (#reel-select / #reel-play live in engine.html
  // next to the Import .swr-set cluster).
  function mountUI() {
    const sel = document.getElementById('reel-select');
    const playBtn = document.getElementById('reel-play');
    const prevBtn = document.getElementById('reel-prev');
    const nextBtn = document.getElementById('reel-next');
    const label = document.getElementById('reel-status');
    if (!sel && !playBtn) return;

    if (sel) {
      const placeholder = document.createElement('option');
      placeholder.value = '';
      placeholder.textContent = '— Demo reels —';
      sel.appendChild(placeholder);
      for (const r of CATALOG) {
        const opt = document.createElement('option');
        opt.value = r.url;
        opt.textContent = r.name;
        sel.appendChild(opt);
      }
      sel.addEventListener('change', () => {
        const url = sel.value;
        if (!url) return;
        (async () => {
          const entry = CATALOG.find((c) => c.url === url);
          status('loading reel ' + (entry ? entry.name : '') + '…', '');
          try {
            await loadReel(url);
            await play(0); // picking a reel starts it — hands-off from here
          } catch (e) {
            console.warn('reel: select failed', e);
            status('reel failed to load', 'err');
          }
        })();
      });
    }
    if (playBtn) playBtn.addEventListener('click', () => togglePlay());
    if (prevBtn) prevBtn.addEventListener('click', () => {
      prev().catch((e) => console.warn('reel: prev failed', e));
    });
    if (nextBtn) nextBtn.addEventListener('click', () => {
      next().catch((e) => console.warn('reel: next failed', e));
    });

    const syncUI = function syncUI() {
      if (label) {
        label.textContent = state.total
          ? (state.playing ? '' : '❚❚ ') + (state.index + 1) + '/' + state.total +
            (state.current ? ' · ' + state.current.name : '')
          : 'no reel';
      }
      if (playBtn) playBtn.textContent = state.playing ? '❚❚ Pause' : '▶ Play';
      if (prevBtn) prevBtn.disabled = !state.total;
      if (nextBtn) nextBtn.disabled = !state.total;
    };
    subscribe(syncUI);
    syncUI(); // paint the idle state on mount
  }

  window.SWR_REEL = {
    CATALOG,
    state,
    getState: snapshot,
    subscribe,
    loadReel,
    play,
    pause,
    resume,
    togglePlay,
    next,
    prev,
    goto,
    stop,
    destroy,
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mountUI);
  } else {
    mountUI();
  }
})();
