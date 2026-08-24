// lib/music-video-maker.client.js — Music Video Maker page runtime.
//
// Exposes window.MVM for the /make-video page. Phase 1 scope:
//   - Project state model (song, clips, timeline) + localStorage persistence
//   - File upload via SWR_MEDIA.addMedia (IndexedDB) with object-URL caching
//   - Song picker modal via SWR_LIBRARY_SWITCHER.render
//   - Timeline scaffold (add/remove clips; no drag/drop, no preview compositing)
//   - Transport controls (play/pause/stop) — advances a playhead position
//
// Phase 2 (separate workstream): canvas compositing during playback,
// MediaRecorder export, drag-and-drop reordering, text overlays, transitions.

(function () {
  'use strict';
  if (window.MVM) return;

  const LS_KEY = 'swr.mvm.project';

  // ---- helpers ----

  function $(id) { return document.getElementById(id); }
  function setStatus(text, cls) {
    const el = $('status');
    if (!el) return;
    el.textContent = text;
    el.style.color = cls === 'err' ? 'var(--accent)' :
                     cls === 'warn' ? 'var(--yellow)' : 'var(--green)';
  }
  function fmtMs(ms) {
    if (!ms || !isFinite(ms) || ms <= 0) return '0:00';
    const s = ms / 1000;
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return m + ':' + String(sec).padStart(2, '0');
  }
  function uuid() {
    // Small random id; doesn't need cryptographic strength.
    return 'c' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }

  // ---- project state ----
  //
  // clips[]:    { id, type, name, mime, durationMs, blobUrl, createdAt }
  //             blobUrl is non-serialized; rebuilt from IDB on load().
  // timeline[]: { id, clipId, startMs, endMs }
  //             (Phase 2 will add: transition, textOverlays)

  const state = {
    song: null,    // UnifiedSong (or null) — see library-switcher
    clips: [],
    timeline: [],
    // Transient (not persisted)
    _playheadMs: 0,
    _playing: false,
    _tickHandle: null,
  };

  function freshProject() {
    state.song = null;
    state.clips = [];
    state.timeline = [];
    state._playheadMs = 0;
    state._playing = false;
  }

  // ---- persistence ----

  // We persist clips WITHOUT blobUrl (it's session-only). On load we
  // restore blobUrl by re-fetching the IndexedDB blob. Songs are also
  // session-only via blob URLs, but for Phase 1 the song is just
  // remembered as a description; the caller re-picks on reload.
  function save() {
    try {
      const persistable = {
        song: state.song ? { ...state.song, blobUrl: undefined, blob: undefined } : null,
        clips: state.clips.map((c) => ({ id: c.id, type: c.type, name: c.name, mime: c.mime, durationMs: c.durationMs, createdAt: c.createdAt })),
        timeline: state.timeline,
        updatedAt: Date.now(),
      };
      localStorage.setItem(LS_KEY, JSON.stringify(persistable));
    } catch (e) {
      console.warn('[mvm] save failed', e);
    }
  }

  async function load() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (!raw) return false;
      const data = JSON.parse(raw);
      state.song = data.song || null;
      state.timeline = Array.isArray(data.timeline) ? data.timeline : [];
      // Restore blobUrl for each clip via the IndexedDB row.
      const M = window.SWR_MEDIA;
      if (M && typeof M.getUserMedia === 'function' && data.clips && data.clips.length) {
        const rows = await M.getUserMedia();
        const byId = new Map(rows.map((r) => [r.id, r]));
        state.clips = data.clips.map((c) => {
          const row = byId.get(c.id);
          return {
            ...c,
            blobUrl: row && row.blob ? URL.createObjectURL(row.blob) : null,
          };
        }).filter((c) => c.blobUrl);
      } else {
        state.clips = [];
      }
      return true;
    } catch (e) {
      console.warn('[mvm] load failed', e);
      return false;
    }
  }

  // ---- clip CRUD ----

  async function addClip(file) {
    if (!file || !file.type) return null;
    const isVideo = file.type.indexOf('video/') === 0;
    const isImage = file.type.indexOf('image/') === 0;
    if (!isVideo && !isImage) {
      setStatus('unsupported file type: ' + file.type, 'err');
      return null;
    }
    const M = window.SWR_MEDIA;
    if (!M || typeof M.addMedia !== 'function') {
      setStatus('SWR_MEDIA not available', 'err');
      return null;
    }
    let inserted = [];
    try { inserted = await M.addMedia([file]); } catch (e) {
      setStatus('addMedia failed: ' + e.message, 'err');
      return null;
    }
    if (!inserted || !inserted[0]) {
      setStatus('addMedia returned no row', 'err');
      return null;
    }
    const row = inserted[0];
    const blobUrl = URL.createObjectURL(row.blob);
    let durationMs = 0;
    if (isVideo) {
      // Probe duration via a hidden video element.
      durationMs = await new Promise((resolve) => {
        const v = document.createElement('video');
        v.preload = 'metadata';
        v.muted = true;
        v.src = blobUrl;
        v.addEventListener('loadedmetadata', () => resolve(Math.round((v.duration || 0) * 1000)), { once: true });
        v.addEventListener('error', () => resolve(0), { once: true });
        setTimeout(() => resolve(0), 4000);
      });
    } else {
      durationMs = 3000; // default for images
    }
    const clip = {
      id: row.id,
      type: isVideo ? 'video' : 'image',
      name: row.name || file.name,
      mime: row.mime,
      durationMs,
      blobUrl,
      createdAt: row.createdAt || Date.now(),
    };
    state.clips.push(clip);
    save();
    renderClips();
    renderTimeline();
    updateDuration();
    setStatus('clip added: ' + clip.name, 'ok');
    return clip;
  }

  async function removeClip(id) {
    const idx = state.clips.findIndex((c) => c.id === id);
    if (idx === -1) return;
    const clip = state.clips[idx];
    try { if (clip.blobUrl) URL.revokeObjectURL(clip.blobUrl); } catch (_) {}
    state.clips.splice(idx, 1);
    // Cascade: remove any timeline rows pointing at this clip.
    const before = state.timeline.length;
    state.timeline = state.timeline.filter((t) => t.clipId !== id);
    // Cleanup IDB (best-effort; do not block UI on failure).
    try {
      const M = window.SWR_MEDIA;
      if (M && typeof M.deleteMedia === 'function') await M.deleteMedia(id);
    } catch (_) {}
    save();
    if (state.timeline.length !== before) renderTimeline();
    renderClips();
    updateDuration();
    setStatus('clip removed', 'ok');
  }

  // ---- timeline ----

  function addToTimeline(clipId) {
    const clip = state.clips.find((c) => c.id === clipId);
    if (!clip) return;
    const dur = clip.durationMs || 3000;
    // Append after the current last entry's end (or 0 if empty).
    const startMs = state.timeline.length
      ? Math.max(...state.timeline.map((t) => t.endMs))
      : 0;
    state.timeline.push({
      id: 'tl' + uuid(),
      clipId,
      startMs,
      endMs: startMs + dur,
    });
    save();
    renderTimeline();
    updateDuration();
  }

  function removeFromTimeline(tlId) {
    const idx = state.timeline.findIndex((t) => t.id === tlId);
    if (idx === -1) return;
    state.timeline.splice(idx, 1);
    save();
    renderTimeline();
    updateDuration();
  }

  function timelineDurationMs() {
    if (!state.timeline.length) return 0;
    return Math.max(...state.timeline.map((t) => t.endMs));
  }

  // ---- rendering ----

  function clipById(id) {
    return state.clips.find((c) => c.id === id) || null;
  }

  function renderClips() {
    const root = $('clips-list');
    if (!root) return;
    root.innerHTML = '';
    if (!state.clips.length) {
      const empty = document.createElement('div');
      empty.className = 'mvm-empty';
      empty.textContent = 'No clips yet — click + ADD or drop files.';
      root.appendChild(empty);
      return;
    }
    state.clips.forEach((clip) => {
      const card = document.createElement('div');
      card.className = 'mvm-clip-card';
      const thumb = document.createElement('div');
      thumb.className = 'mvm-clip-thumb';
      if (clip.type === 'image') {
        const img = document.createElement('img');
        img.src = clip.blobUrl;
        img.alt = clip.name;
        thumb.appendChild(img);
      } else {
        thumb.textContent = '▶';
      }
      const meta = document.createElement('div');
      meta.className = 'mvm-clip-meta';
      const name = document.createElement('div');
      name.className = 'mvm-clip-name';
      name.textContent = clip.name;
      name.title = clip.name;
      const sub = document.createElement('div');
      sub.className = 'mvm-clip-sub';
      sub.textContent = clip.type + ' · ' + fmtMs(clip.durationMs);
      meta.appendChild(name); meta.appendChild(sub);
      const actions = document.createElement('div');
      actions.className = 'mvm-clip-actions';
      const addBtn = document.createElement('button');
      addBtn.className = 'tl-add';
      addBtn.textContent = '+ TIMELINE';
      addBtn.title = 'Add this clip to the timeline';
      addBtn.addEventListener('click', () => addToTimeline(clip.id));
      const delBtn = document.createElement('button');
      delBtn.className = 'tl-remove';
      delBtn.textContent = '✕';
      delBtn.title = 'Remove clip from library';
      delBtn.addEventListener('click', () => removeClip(clip.id));
      actions.appendChild(addBtn); actions.appendChild(delBtn);
      card.appendChild(thumb); card.appendChild(meta); card.appendChild(actions);
      root.appendChild(card);
    });
  }

  function renderTimeline() {
    const root = $('timeline-list');
    if (!root) return;
    root.innerHTML = '';
    if (!state.timeline.length) {
      const empty = document.createElement('div');
      empty.className = 'mvm-empty';
      empty.textContent = 'Timeline empty — add clips from the left.';
      root.appendChild(empty);
      return;
    }
    const sorted = state.timeline.slice().sort((a, b) => a.startMs - b.startMs);
    sorted.forEach((t) => {
      const clip = clipById(t.clipId);
      if (!clip) return; // skip dangling refs
      const row = document.createElement('div');
      row.className = 'mvm-timeline-row';
      const time = document.createElement('span');
      time.className = 'tl-time';
      time.textContent = fmtMs(t.startMs) + ' → ' + fmtMs(t.endMs);
      const name = document.createElement('span');
      name.className = 'tl-name';
      name.textContent = clip.name;
      name.title = clip.name + ' (' + fmtMs(t.endMs - t.startMs) + ')';
      const remove = document.createElement('button');
      remove.className = 'mvm-clip-actions';
      const x = document.createElement('button');
      x.textContent = '✕';
      x.title = 'Remove from timeline';
      x.style.cssText = 'background:transparent;border:1px solid var(--accent);color:var(--accent);font:9px ui-monospace,monospace;padding:3px 6px;cursor:pointer;';
      x.addEventListener('click', () => removeFromTimeline(t.id));
      row.appendChild(time); row.appendChild(name); row.appendChild(x);
      root.appendChild(row);
    });
  }

  function updateDuration() {
    const dur = timelineDurationMs();
    $('tl-duration').textContent = fmtMs(dur);
    const readout = $('time-readout');
    if (readout) readout.textContent = fmtMs(state._playheadMs) + ' / ' + fmtMs(dur);
    $('play-pause').disabled = dur === 0;
    $('stop').disabled = dur === 0;
  }

  function renderSongDisplay() {
    const cur = $('current-song');
    const rem = $('remove-song');
    if (state.song) {
      cur.textContent = '🎵 ' + state.song.title;
      cur.classList.add('has-song');
      rem.style.display = '';
    } else {
      cur.textContent = '— no song —';
      cur.classList.remove('has-song');
      rem.style.display = 'none';
    }
  }

  // ---- transport ----

  function play() {
    if (state._playing) return;
    if (timelineDurationMs() === 0) return;
    state._playing = true;
    state._tickHandle = setInterval(() => {
      state._playheadMs = Math.min(state._playheadMs + 33, timelineDurationMs());
      const readout = $('time-readout');
      if (readout) readout.textContent = fmtMs(state._playheadMs) + ' / ' + fmtMs(timelineDurationMs());
      if (state._playheadMs >= timelineDurationMs()) pause();
    }, 33);
    $('play-pause').textContent = '❚❚ PAUSE';
    setStatus('playing', 'ok');
  }

  function pause() {
    if (state._tickHandle) { clearInterval(state._tickHandle); state._tickHandle = null; }
    state._playing = false;
    $('play-pause').textContent = '▶ PLAY';
    setStatus('paused', 'warn');
  }

  function stop() {
    pause();
    state._playheadMs = 0;
    const readout = $('time-readout');
    if (readout) readout.textContent = fmtMs(0) + ' / ' + fmtMs(timelineDurationMs());
    setStatus('stopped', 'ok');
  }

  function togglePlay() { state._playing ? pause() : play(); }

  // ---- song picker integration ----

  function openSongModal() {
    const modal = $('song-modal');
    const host = $('song-modal-host');
    if (!modal || !host) return;
    host.innerHTML = '';
    modal.classList.add('open');
    if (!window.SWR_LIBRARY_SWITCHER) {
      setStatus('library switcher not loaded', 'err');
      return;
    }
    window.SWR_LIBRARY_SWITCHER.render(host, {
        onPick: async (song) => {
          await loadSongIntoBus(song);
          closeSongModal();
        },
      });
  }

  function closeSongModal() {
    const modal = $('song-modal');
    if (modal) modal.classList.remove('open');
    const host = $('song-modal-host');
    if (host) host.innerHTML = '';
  }

  async function loadSongIntoBus(song) {
    const url = await window.SWR_LIBRARY_SWITCHER.pick(song.source, song.sourceId);
    if (!url) { setStatus('could not resolve song URL', 'err'); return; }
    // The engine's Audio.load() takes a File. Fetch the URL to a Blob, then a File.
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const blob = await res.blob();
      const file = new File([blob], song.title || 'song', { type: blob.type || 'audio/mpeg' });
      const A = window.SWR && window.SWR.Audio;
      if (!A || typeof A.load !== 'function') { setStatus('engine Audio not available', 'err'); return; }
      A.load(file);
      state.song = { ...song, blobUrl: url };
      save();
      renderSongDisplay();
      setStatus('song loaded: ' + song.title, 'ok');
    } catch (e) {
      setStatus('load failed: ' + e.message, 'err');
    }
  }

  function removeSong() {
    if (state.song && state.song.blobUrl && state.song.blobUrl.startsWith('blob:')) {
      try { URL.revokeObjectURL(state.song.blobUrl); } catch (_) {}
    }
    state.song = null;
    save();
    renderSongDisplay();
    setStatus('song removed', 'ok');
  }

  // ---- reset ----

  function resetProject() {
    if (!confirm('Reset this project? Clips in your library are kept, but the song and timeline will be cleared.')) return;
    // Revoke all clip blob URLs
    state.clips.forEach((c) => { try { if (c.blobUrl) URL.revokeObjectURL(c.blobUrl); } catch (_) {} });
    if (state.song && state.song.blobUrl && state.song.blobUrl.startsWith('blob:')) {
      try { URL.revokeObjectURL(state.song.blobUrl); } catch (_) {}
    }
    freshProject();
    try { localStorage.removeItem(LS_KEY); } catch (_) {}
    renderClips();
    renderTimeline();
    renderSongDisplay();
    updateDuration();
    setStatus('project reset', 'ok');
  }

  // ---- file input + drag-drop wiring ----

  function wireFileInput() {
    const input = $('clip-input');
    const addBtn = $('add-clip');
    if (addBtn && input) addBtn.addEventListener('click', () => input.click());
    if (input) {
      input.addEventListener('change', async () => {
        const files = Array.from(input.files || []);
        for (const f of files) await addClip(f);
        input.value = '';
      });
    }
    // Drag-drop onto the page body
    document.addEventListener('dragover', (e) => { e.preventDefault(); });
    document.addEventListener('drop', async (e) => {
      e.preventDefault();
      const files = Array.from(e.dataTransfer && e.dataTransfer.files || []);
      for (const f of files) {
        if (f && f.type) await addClip(f);
      }
    });
  }

  // ---- init ----

  async function init() {
    wireFileInput();
    // Header buttons
    $('pick-song').addEventListener('click', openSongModal);
    $('remove-song').addEventListener('click', removeSong);
    $('reset-project').addEventListener('click', resetProject);
    $('close-song-modal').addEventListener('click', closeSongModal);
    // Transport
    $('play-pause').addEventListener('click', togglePlay);
    $('stop').addEventListener('click', stop);
    // Modal background click closes
    $('song-modal').addEventListener('click', (e) => {
      if (e.target.id === 'song-modal') closeSongModal();
    });

    await load();
    renderClips();
    renderTimeline();
    renderSongDisplay();
    updateDuration();
    setStatus(state.clips.length ? 'project loaded' : 'ready', 'ok');
  }

  // ---- public ----

  window.MVM = {
    init,
    get project() {
      return {
        song: state.song,
        clips: state.clips.slice(),
        timeline: state.timeline.slice(),
      };
    },
    save, load,
    addClip, removeClip,
    addToTimeline, removeFromTimeline,
    timelineDurationMs,
    play, pause, stop,
    removeSong,
    resetProject,
    // Render helpers (for tests / external scripting)
    renderClips, renderTimeline, renderSongDisplay, updateDuration,
  };

  // Boot when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();