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
    textOverlays: [],
    // Transient (not persisted)
    _playheadMs: 0,
    _playing: false,
    _tickHandle: null,
  };

  function freshProject() {
    state.song = null;
    state.clips = [];
    state.textOverlays = [];
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
        clips: state.clips.map((c) => ({
          id: c.id, type: c.type, name: c.name, mime: c.mime,
          durationMs: c.durationMs, createdAt: c.createdAt,
          blend: c.blend, opacity: c.opacity, transition: c.transition,
        })),
        timeline: state.timeline,
        textOverlays: state.textOverlays || [],
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
      state.textOverlays = Array.isArray(data.textOverlays) ? data.textOverlays : [];
      // Restore blobUrl for each clip via the IndexedDB row.
      const M = window.SWR_MEDIA;
      if (M && typeof M.getUserMedia === 'function' && data.clips && data.clips.length) {
        const rows = await M.getUserMedia();
        const byId = new Map(rows.map((r) => [r.id, r]));
        state.clips = data.clips.map((c) => {
          const row = byId.get(c.id);
          return {
            ...c,
            blend: c.blend || 'source-over',
            opacity: c.opacity != null ? c.opacity : 1,
            transition: c.transition || 'cut',
            blobUrl: row && row.blob ? URL.createObjectURL(row.blob) : null,
          };
        }).filter((c) => c.blobUrl);
      } else {
        state.clips = [];
      }

      // Auto-restore the saved song onto the audio bus. The persisted
      // song descriptor carries source + sourceId; the URL is fetched
      // fresh via the Library Switcher's pick() (which owns the URL).
      // Note: we set el.src but do NOT call el.play() — autoplay policy
      // requires a user gesture. The user presses ▶ to actually start
      // playback. The song's bytes are now attached to the audio bus
      // so REC captures them immediately if the user skips ▶.
      const songRestored = await tryRestoreSong(state);
      if (songRestored && typeof setStatus === 'function') {
        setStatus('restored: ' + (state.song && state.song.title), 'ok');
      }

      return true;
    } catch (e) {
      console.warn('[mvm] load failed', e);
      return false;
    }
  }

  // Re-attach a saved song to the audio bus. Mirrors loadSongIntoBus()
  // minus the file-round-trip — same code path, just triggered from
  // persisted state instead of a user click. Returns true if el.src was
  // successfully set.
  async function tryRestoreSong(stateRef) {
    const s = stateRef && stateRef.song;
    if (!s || !s.source || !s.sourceId) return false;
    const L = window.SWR_LIBRARY_SWITCHER;
    const A = window.SWR && window.SWR.Audio;
    if (!L || typeof L.pick !== 'function') return false;
    if (!A) return false;
    // Eagerly init the audio element if it doesn't exist yet — same
    // pattern as loadSongIntoBus. The silent header is harmless (no
    // audible playback — duration remains 0) and gets replaced
    // immediately by the real pick() URL below.
    if (!A.el) {
      try {
        const silent = new Blob([new Uint8Array([
          0x52,0x49,0x46,0x46, 0x24,0x00,0x00,0x00, 0x57,0x41,0x56,0x45,
          0x66,0x6D,0x74,0x20, 0x10,0x00,0x00,0x00, 0x01,0x00,0x01,0x00,
          0x44,0xAC,0x00,0x00, 0x88,0x58,0x01,0x00, 0x02,0x00,0x10,0x00,
          0x64,0x61,0x74,0x61, 0x00,0x00,0x00,0x00
        ])], { type: 'audio/wav' });
        A.load(new File([silent], 'silent.wav', { type: 'audio/wav' }));
      } catch (_) { return false; }
    }
    if (!A.el) return false;
    let url = null;
    try { url = await L.pick(s.source, s.sourceId); } catch (_) { return false; }
    if (!url) return false;
    try {
      A.el.src = url;
      // Don't autoplay — the user has to press ▶. Browser autoplay
      // policy requires a user gesture; restoring playback silently
      // would (a) be blocked, (b) feel surprising.
      stateRef.song = { ...s, blobUrl: url };
      return true;
    } catch (e) {
      console.warn('[mvm] song restore failed:', e);
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
      blend: 'source-over',
      opacity: 1,
      transition: 'cut',
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
    // Drop any video element associated with this clip
    if (_videoEls.has(id)) {
      const el = _videoEls.get(id);
      try { el.pause(); el.removeAttribute('src'); el.load(); } catch (_) {}
      try { el.remove(); } catch (_) {}
      _videoEls.delete(id);
    }
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

  // Reorder a timeline row to a new index. Recomputes startMs for every
  // row so the timeline stays contiguous (no gaps, no overlaps).
  // The dragged row keeps its duration; only its startMs changes.
  function reorderTimeline(tlId, targetIndex) {
    const idx = state.timeline.findIndex((t) => t.id === tlId);
    if (idx === -1) return null;
    const [row] = state.timeline.splice(idx, 1);
    const clamped = Math.max(0, Math.min(targetIndex, state.timeline.length));
    state.timeline.splice(clamped, 0, row);
    // Reassign startMs in the current order, preserving each row's duration.
    let cursor = 0;
    const sorted = state.timeline.slice().sort((a, b) => a.startMs - b.startMs);
    // sorted[clamped] is the row we just moved (it may have shifted).
    // Walk in order and lay down durations.
    cursor = 0;
    for (const t of state.timeline) {
      const dur = Math.max(100, t.endMs - t.startMs);
      t.startMs = cursor;
      t.endMs = cursor + dur;
      cursor = t.endMs;
    }
    void sorted;
    save();
    renderTimeline();
    updateDuration();
    return row;
  }

  // Resize a timeline row to a new endMs. Clamps:
  //   - min endMs = startMs + 100 (a 100ms minimum)
  //   - max endMs = startMs + originalDuration (the row's full clip length;
  //     the caller passes this so we can show extended time even though
  //     the underlying clip is shorter)
  // Every subsequent row's startMs/endMs shifts by the same delta so the
  // timeline stays contiguous (no overlaps, no gaps).
  function resizeTimelineRow(tlId, newEndMs, originalDuration) {
    const idx = state.timeline.findIndex((t) => t.id === tlId);
    if (idx === -1) return null;
    const row = state.timeline[idx];
    const minEnd = row.startMs + 100;
    const maxEnd = row.startMs + (originalDuration || (row.endMs - row.startMs) * 2 || 5000);
    const clampedEnd = Math.max(minEnd, Math.min(maxEnd, newEndMs | 0));
    const delta = clampedEnd - row.endMs;
    row.endMs = clampedEnd;
    if (delta === 0) return row;
    // Push every row after this one (in timeline order) by `delta`.
    const sorted = state.timeline.slice().sort((a, b) => a.startMs - b.startMs);
    const sortedIdx = sorted.findIndex((x) => x.id === tlId);
    for (let i = sortedIdx + 1; i < sorted.length; i++) {
      const t = sorted[i];
      const realRow = state.timeline.find((x) => x.id === t.id);
      if (!realRow) continue;
      realRow.startMs += delta;
      realRow.endMs += delta;
    }
    void sorted;
    save();
    renderTimeline();
    updateDuration();
    return row;
  }

  function addToTimeline(clipId) {
    const clip = state.clips.find((c) => c.id === clipId);
    if (!clip) return;
    const dur = clip.durationMs || 3000;
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

  const BLEND_OPTIONS = ['source-over', 'source-in', 'screen', 'lighter', 'multiply', 'difference', 'overlay'];
  const TRANSITION_OPTIONS = [
    { value: 'cut', label: 'cut' },
    { value: 'fade', label: 'fade 250ms' },
  ];

  function setClipProps(id, patch) {
    return _setClipProps(id, patch, { rerender: true });
  }
  // setClipPropsQuiet: update state + persist, but don't rebuild the
  // clip cards. Use this during continuous interactions (e.g. dragging
  // the opacity slider) where rebuilding the DOM on every input event
  // destroys the input element mid-drag.
  function setClipPropsQuiet(id, patch) {
    return _setClipProps(id, patch, { rerender: false });
  }
  function _setClipProps(id, patch, opts) {
    const clip = state.clips.find((c) => c.id === id);
    if (!clip) return null;
    if ('blend' in patch) clip.blend = patch.blend;
    if ('opacity' in patch) clip.opacity = clamp01(patch.opacity);
    if ('transition' in patch) clip.transition = patch.transition;
    save();
    if (opts && opts.rerender) renderClips();
    return clip;
  }

  function clamp01(v) {
    if (typeof v !== 'number' || !isFinite(v)) return 1;
    if (v < 0) return 0;
    if (v > 1) return 1;
    return v;
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

      const controls = document.createElement('div');
      controls.className = 'mvm-clip-controls';
      const blend = document.createElement('select');
      blend.title = 'Blend mode';
      BLEND_OPTIONS.forEach((b) => {
        const o = document.createElement('option');
        o.value = b; o.textContent = b;
        if ((clip.blend || 'source-over') === b) o.selected = true;
        blend.appendChild(o);
      });
      blend.addEventListener('change', () => setClipProps(clip.id, { blend: blend.value }));
      const opa = document.createElement('input');
      opa.type = 'range'; opa.min = '0'; opa.max = '1'; opa.step = '0.05';
      opa.value = String(clip.opacity != null ? clip.opacity : 1);
      opa.title = 'Opacity';
      // Phase 11 fix: in-drag updates use setClipPropsQuiet (no
      // renderClips), so the input element isn't recreated mid-drag.
      // On 'change' (mouseup/touchend), do a full renderClips so the
      // clip card's other controls (blend/transition selects) reflect
      // any state changes from elsewhere.
      opa.addEventListener('input', () => setClipPropsQuiet(clip.id, { opacity: parseFloat(opa.value) }));
      opa.addEventListener('change', () => setClipProps(clip.id, { opacity: parseFloat(opa.value) }));
      const tr = document.createElement('select');
      tr.title = 'Transition into next clip';
      TRANSITION_OPTIONS.forEach((t) => {
        const o = document.createElement('option');
        o.value = t.value; o.textContent = t.label;
        if ((clip.transition || 'cut') === t.value) o.selected = true;
        tr.appendChild(o);
      });
      tr.addEventListener('change', () => setClipProps(clip.id, { transition: tr.value }));
      controls.appendChild(blend);
      controls.appendChild(opa);
      controls.appendChild(tr);

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

      // Phase 7: make the card draggable to drop into the timeline
      card.setAttribute('draggable', 'true');
      card.dataset.clipid = clip.id;
      card.addEventListener('dragstart', (e) => {
        try { e.dataTransfer.setData('text/plain', clip.id); } catch (_) {}
        try { e.dataTransfer.setData('application/x-swr-clip', clip.id); } catch (_) {}
        e.dataTransfer.effectAllowed = 'copy';
        card.classList.add('mvm-clip-dragging');
      });
      card.addEventListener('dragend', () => {
        card.classList.remove('mvm-clip-dragging');
      });

      card.appendChild(thumb);
      card.appendChild(meta);
      card.appendChild(controls);
      card.appendChild(actions);
      root.appendChild(card);
    });
  }

  // Render a small thumbnail (dataURL) for a clip's first frame.
  // For images: load the blobUrl into an Image, draw onto an offscreen
  // canvas, return a dataURL. For videos: set currentTime=0.05, draw
  // the <video> onto a canvas, return a dataURL.
  function renderClipThumb(clip, w, h) {
    if (!clip || !clip.blobUrl) return null;
    const cw = w || 60, ch = h || 40;
    const canvas = document.createElement('canvas');
    canvas.width = cw; canvas.height = ch;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    if (clip.type === 'image') {
      return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
          try {
            ctx.drawImage(img, 0, 0, cw, ch);
            resolve(canvas.toDataURL('image/jpeg', 0.6));
          } catch (e) { resolve(null); }
        };
        img.onerror = () => resolve(null);
        img.src = clip.blobUrl;
      });
    }
    // Video: try to seek to the start and capture a frame
    if (clip.type === 'video') {
      const v = getOrCreateVideoEl(clip);
      if (!v) return null;
      return new Promise((resolve) => {
        const onSeeked = () => {
          try {
            ctx.drawImage(v, 0, 0, cw, ch);
            resolve(canvas.toDataURL('image/jpeg', 0.6));
          } catch (e) { resolve(null); }
        };
        if (v.readyState >= 2) {
          try { v.currentTime = 0.05; } catch (_) {}
          v.addEventListener('seeked', onSeeked, { once: true });
        } else {
          v.addEventListener('loadeddata', () => {
            try { v.currentTime = 0.05; } catch (_) {}
            v.addEventListener('seeked', onSeeked, { once: true });
          }, { once: true });
        }
      });
    }
    return null;
  }

  function renderTimeline() {
    const root = $('timeline-list');
    if (!root) return;
    root.innerHTML = '';
    if (!state.timeline.length) {
      const empty = document.createElement('div');
      empty.className = 'mvm-empty';
      empty.textContent = 'Timeline empty — add clips from the left. Drag a row to reorder, drag the right edge to resize.';
      root.appendChild(empty);
      return;
    }
    // Phase 7: drop handler for drag-from-clips-panel. If a clip is
    // dropped at the top of the list (above the first row), it gets
    // inserted at index 0. If dropped between two rows, it lands between.
    // The current row's dragover handler still works for timeline→timeline
    // reorders; the clip→timeline drop is handled here.
    const onListDrop = (e) => {
      // Guard: if the row's drop already handled this event, skip
      if (e.__swrRowHandled) return;
      const clipId = e.dataTransfer.getData('text/plain') ||
                     e.dataTransfer.getData('application/x-swr-clip');
      if (!clipId) return;
      // Don't interfere with timeline→timeline reorders
      if (window.__swrMvmDraggingTimelineRow) return;
      e.preventDefault();
      e.__swrRowHandled = true;
      // Find the target index based on the Y position
      const rows = Array.from(root.querySelectorAll('.mvm-timeline-row'));
      let targetIdx = rows.length;
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i].getBoundingClientRect();
        if (e.clientY < r.top + r.height / 2) { targetIdx = i; break; }
      }
      // Insert the clip at targetIdx with a default 3s duration
      const clip = clipById(clipId);
      if (!clip) return;
      // Calculate the startMs for the inserted row
      const sortedNow = state.timeline.slice().sort((a, b) => a.startMs - b.startMs);
      let startMs = 0;
      if (targetIdx > 0 && sortedNow[targetIdx - 1]) {
        startMs = sortedNow[targetIdx - 1].endMs;
      } else if (targetIdx === 0) {
        startMs = 0;
      }
      const dur = clip.durationMs || 3000;
      const newRow = {
        id: 'tl' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
        clipId: clip.id,
        startMs,
        endMs: startMs + dur,
      };
      // Insert into state.timeline at the right position so the existing
      // contiguous-startMs logic kicks in
      state.timeline.push(newRow);
      reorderTimeline(newRow.id, targetIdx);
    };
    const onListDragOver = (e) => {
      // Only handle if not a row drag (set by the row handler)
      if (window.__swrMvmDraggingTimelineRow) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    };
    root.addEventListener('drop', onListDrop);
    root.addEventListener('dragover', onListDragOver);

    const sorted = state.timeline.slice().sort((a, b) => a.startMs - b.startMs);
    sorted.forEach((t) => {
      const clip = clipById(t.clipId);
      if (!clip) return; // skip dangling refs
      const row = document.createElement('div');
      row.className = 'mvm-timeline-row';
      row.setAttribute('draggable', 'true');
      row.dataset.tlid = t.id;

      // Thumbnail (Phase 6): small 60x40 image of the clip's first frame.
      const thumb = document.createElement('div');
      thumb.className = 'tl-thumb';
      if (clip.blobUrl) {
        if (clip._thumbDataUrl) {
          const img = document.createElement('img');
          img.src = clip._thumbDataUrl;
          img.alt = '';
          thumb.appendChild(img);
        } else {
          thumb.classList.add('tl-thumb-loading');
          // Render the thumb async; the next renderTimeline() call will
          // pick up the cached _thumbDataUrl.
          renderClipThumb(clip, 60, 40).then((dataUrl) => {
            if (dataUrl) {
              clip._thumbDataUrl = dataUrl;
              const img = document.createElement('img');
              img.src = dataUrl;
              img.alt = '';
              thumb.innerHTML = '';
              thumb.classList.remove('tl-thumb-loading');
              thumb.appendChild(img);
            }
          }).catch(() => { thumb.classList.remove('tl-thumb-loading'); });
          // Fallback: type icon
          const icon = document.createElement('div');
          icon.className = 'tl-thumb-icon';
          icon.textContent = clip.type === 'image' ? '🖼' : '▶';
          thumb.appendChild(icon);
        }
      }

      const time = document.createElement('span');
      time.className = 'tl-time';
      time.textContent = fmtMs(t.startMs) + ' → ' + fmtMs(t.endMs);
      const name = document.createElement('span');
      name.className = 'tl-name';
      name.textContent = clip.name;
      name.title = clip.name + ' (' + fmtMs(t.endMs - t.startMs) + ')';
      const grip = document.createElement('div');
      grip.className = 'mvm-tl-grip';
      grip.title = 'Drag to resize';
      const x = document.createElement('button');
      x.textContent = '✕';
      x.title = 'Remove from timeline';
      x.style.cssText = 'background:transparent;border:1px solid var(--accent);color:var(--accent);font:9px ui-monospace,monospace;padding:3px 6px;cursor:pointer;';
      x.addEventListener('click', (e) => { e.stopPropagation(); removeFromTimeline(t.id); });

      row.appendChild(thumb);
      row.appendChild(time);
      row.appendChild(name);
      row.appendChild(grip);
      row.appendChild(x);

      // ---- Drag reorder wiring (HTML5 drag-and-drop) ----
      row.addEventListener('dragstart', (e) => {
        if (e.target.classList && e.target.classList.contains('mvm-tl-grip')) {
          // Don't start a reorder drag if the user grabbed the resize grip
          e.preventDefault();
          return;
        }
        row.classList.add('mvm-tl-dragging');
        try { e.dataTransfer.setData('text/plain', t.id); } catch (_) {}
        e.dataTransfer.effectAllowed = 'move';
        // Mark that a timeline row is being dragged so the list-level
        // drop handler (Phase 7) doesn't try to add a clip at the same time
        window.__swrMvmDraggingTimelineRow = true;
      });
      row.addEventListener('dragend', () => {
        row.classList.remove('mvm-tl-dragging');
        window.__swrMvmDraggingTimelineRow = false;
        // Strip any leftover drop indicators
        const all = root.querySelectorAll('.mvm-tl-drop-before, .mvm-tl-drop-after');
        all.forEach((el) => { el.classList.remove('mvm-tl-drop-before', 'mvm-tl-drop-after'); });
      });
      row.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        const r = row.getBoundingClientRect();
        const before = e.clientY < r.top + r.height / 2;
        row.classList.toggle('mvm-tl-drop-before', before);
        row.classList.toggle('mvm-tl-drop-after', !before);
      });
      row.addEventListener('dragleave', () => {
        row.classList.remove('mvm-tl-drop-before', 'mvm-tl-drop-after');
      });
      row.addEventListener('drop', (e) => {
        e.preventDefault();
        e.__swrRowHandled = true;
        const draggedId = e.dataTransfer.getData('text/plain');
        if (!draggedId || draggedId === t.id) return;
        const r = row.getBoundingClientRect();
        const before = e.clientY < r.top + r.height / 2;
        const sortedNow = state.timeline.slice().sort((a, b) => a.startMs - b.startMs);
        const fromIdx = sortedNow.findIndex((x) => x.id === draggedId);
        if (fromIdx === -1) return;
        let toIdx = sortedNow.findIndex((x) => x.id === t.id);
        // If we're dropping after the target row, the insertion index is
        // toIdx + 1. If we're removing an earlier item first, the indices
        // shift by -1.
        if (!before) toIdx += 1;
        if (fromIdx < toIdx) toIdx -= 1;
        reorderTimeline(draggedId, toIdx);
      });

      // ---- Right-edge grip: pointer-driven resize ----
      grip.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        grip.setPointerCapture(e.pointerId);
        grip.classList.add('mvm-tl-grip-active');
        const startX = e.clientX;
        const startEndMs = t.endMs;
        const startStartMs = t.startMs;
        const initialDuration = startEndMs - startStartMs;
        // pxPerMs: how many pixels of horizontal movement equal 1 ms of
        // timeline extension. Use the total visible timeline width as the
        // base; if the timeline is empty, use a 1ms = 0.05px fallback.
        const tlList = $('timeline-list');
        const totalMs = timelineDurationMs() || 1;
        const visiblePx = tlList ? tlList.clientWidth : 200;
        const pxPerMs = Math.max(0.02, visiblePx / totalMs);
        let lastEndMs = startEndMs;

        const onMove = (ev) => {
          const deltaPx = ev.clientX - startX;
          const deltaMs = deltaPx / pxPerMs;
          const proposed = startEndMs + deltaMs;
          lastEndMs = proposed;
          // Live update without saving or re-rendering
          time.textContent = fmtMs(startStartMs) + ' → ' + fmtMs(proposed);
        };
        const onUp = (ev) => {
          try { grip.releasePointerCapture(e.pointerId); } catch (_) {}
          grip.classList.remove('mvm-tl-grip-active');
          grip.removeEventListener('pointermove', onMove);
          grip.removeEventListener('pointerup', onUp);
          grip.removeEventListener('pointercancel', onUp);
          resizeTimelineRow(t.id, lastEndMs, initialDuration);
        };
        grip.addEventListener('pointermove', onMove);
        grip.addEventListener('pointerup', onUp);
        grip.addEventListener('pointercancel', onUp);
      });

      root.appendChild(row);
    });
  }

  // ---- Compositor (Phase 2) ----
  //
  // renderFrame(playheadMs) is called on every 33ms tick during play.
  // It draws the timeline row whose [startMs, endMs) contains playheadMs
  // onto the preview canvas. For video clips we keep a <video> element
  // in lockstep (currentTime = playheadMs - row.startMs) so the captured
  // frame matches the timeline. For 'fade' transition we draw the next
  // row's clip with rising opacity for the last 250ms of the current
  // row's window.
  //
  // A single canvas + single drawImage per active row keeps this
  // cheap enough to run at 30 fps without dropping frames.

  const _videoEls = new Map(); // clipId -> HTMLVideoElement

  function getOrCreateVideoEl(clip) {
    let el = _videoEls.get(clip.id);
    if (el) return el;
    el = document.createElement('video');
    el.src = clip.blobUrl;
    el.muted = true;
    el.loop = true;
    el.playsInline = true;
    el.preload = 'auto';
    el.style.display = 'none';
    document.body.appendChild(el);
    _videoEls.set(clip.id, el);
    return el;
  }

  function ensureImageDecoded(clip) {
    return new Promise((resolve) => {
      if (clip._img) { if (clip._img.complete) resolve(); else clip._img.addEventListener('load', () => resolve(), { once: true }); return; }
      const img = new Image();
      img.src = clip.blobUrl;
      img.decode ? img.decode().then(() => { clip._img = img; resolve(); }).catch(() => { clip._img = img; resolve(); }) : (img.onload = () => { clip._img = img; resolve(); });
    });
  }

  function setCanvasSize() {
    const canvas = $('preview');
    if (!canvas) return;
    // Match canvas to its CSS box; the engine uses 16:9 (640x360 baseline)
    const cssW = canvas.clientWidth || 640;
    const cssH = canvas.clientHeight || 360;
    if (canvas.width !== cssW) canvas.width = cssW;
    if (canvas.height !== cssH) canvas.height = cssH;
  }

  // Sync all <video> elements to the playhead: play if the row is currently
  // active, pause + rewind if not. Also kill the videos once their row has
  // passed well outside the window (cheap, prevents runaway memory).
  function syncVideoClips(playheadMs) {
    const ids = new Set();
    for (const t of state.timeline) ids.add(t.clipId);
    // Pause videos whose clip is no longer on the timeline
    for (const [id, el] of _videoEls) {
      if (!ids.has(id)) {
        try { el.pause(); el.removeAttribute('src'); el.load(); } catch (_) {}
        try { el.remove(); } catch (_) {}
        _videoEls.delete(id);
      }
    }
    // For each video row in the warm window, create or sync the element.
    // (Phase 11 fix: removed the early-return on _videoEls.size === 0 —
    //  previously this prevented the first video element from ever being
    //  created, so video clips never rendered on first playback.)
    const window = 1000; // ms before/after the playhead we keep warm
    for (const t of state.timeline) {
      const clip = clipById(t.clipId);
      if (!clip || clip.type !== 'video') continue;
      const inWindow = playheadMs >= t.startMs - window && playheadMs <= t.endMs + window;
      if (!inWindow) continue;
      const el = getOrCreateVideoEl(clip);
      const localMs = playheadMs - t.startMs;
      // Seek if drift > 80ms
      if (Math.abs((el.currentTime * 1000) - localMs) > 80) {
        try { el.currentTime = Math.max(0, localMs / 1000); } catch (_) {}
      }
      const isActive = playheadMs >= t.startMs && playheadMs < t.endMs;
      if (isActive) {
        if (el.paused) el.play().catch(() => {});
      } else {
        if (!el.paused) el.pause();
      }
    }
  }

  function drawClip(ctx, clip, w, h) {
    if (clip.type === 'image') {
      const img = clip._img;
      if (img && img.complete) ctx.drawImage(img, 0, 0, w, h);
    } else {
      const el = _videoEls.get(clip.id);
      if (el && el.readyState >= 2) ctx.drawImage(el, 0, 0, w, h);
    }
  }

  function findActiveRow(playheadMs) {
    for (const t of state.timeline) {
      if (playheadMs >= t.startMs && playheadMs < t.endMs) return t;
    }
    return null;
  }

  function findNextRow(playheadMs) {
    const sorted = state.timeline.slice().sort((a, b) => a.startMs - b.startMs);
    for (const t of sorted) {
      if (t.startMs > playheadMs) return t;
    }
    return null;
  }

  function renderFrame(playheadMs) {
    setCanvasSize();
    const canvas = $('preview');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const w = canvas.width, h = canvas.height;
    ctx.fillStyle = '#0a0008';
    ctx.fillRect(0, 0, w, h);
    const cur = findActiveRow(playheadMs);
    if (cur) {
      const clip = clipById(cur.clipId);
      if (clip) {
        ctx.globalAlpha = clip.opacity != null ? clip.opacity : 1;
        ctx.globalCompositeOperation = clip.blend || 'source-over';
        drawClip(ctx, clip, w, h);
        // Crossfade to next clip if this one ends in <250ms and transition = fade
        if (clip.transition === 'fade') {
          const FADE = 250;
          const distEnd = cur.endMs - playheadMs;
          if (distEnd < FADE) {
            const next = findNextRow(playheadMs);
            if (next) {
              const nclip = clipById(next.clipId);
              if (nclip) {
                // Opacity ramps 0 -> (clip.opacity) over the FADE window
                const t = 1 - (distEnd / FADE);
                ctx.globalAlpha = (nclip.opacity != null ? nclip.opacity : 1) * Math.max(0, Math.min(1, t));
                ctx.globalCompositeOperation = nclip.blend || 'screen';
                drawClip(ctx, nclip, w, h);
              }
            }
          }
        }
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';
      }
    }
    // ---- Text overlays (Phase 5) ----
    // Draw all overlays whose time window contains the playhead, on top
    // of the clip but under the audio-reactive visualizer.
    if (state.textOverlays && state.textOverlays.length) {
      ctx.save();
      for (const ov of state.textOverlays) {
        if (playheadMs < ov.startMs || playheadMs >= ov.endMs) continue;
        ctx.font = ov.size + 'px ' + ov.font;
        ctx.fillStyle = ov.color;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.shadowColor = 'rgba(0, 0, 0, 0.7)';
        ctx.shadowBlur = 8;
        ctx.shadowOffsetY = 2;
        ctx.fillText(ov.text, w * ov.x, h * ov.y);
      }
      ctx.restore();
    }
    // ---- Audio-reactive visualizer overlay (Phase 4) ----
    if (state.song && state._vizEnabled !== false &&
        window.MVM_AUDIO_VIZ && typeof window.MVM_AUDIO_VIZ.render === 'function') {
      if (!state._vizT0) state._vizT0 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
      const tNow = ((typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now()) - state._vizT0;
      const feat = (window.SWR && window.SWR.Audio && window.SWR.Audio.feat) || {};
      window.MVM_AUDIO_VIZ.render(ctx, w, h, feat, tNow);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }
  }

  function updateDuration() {
    const dur = timelineDurationMs();
    $('tl-duration').textContent = fmtMs(dur);
    const readout = $('time-readout');
    if (readout) readout.textContent = fmtMs(state._playheadMs) + ' / ' + fmtMs(dur);
    $('play-pause').disabled = dur === 0 || Recorder.recording;
    $('stop').disabled = dur === 0;
    $('rec').disabled = dur === 0 || Recorder.recording;
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

  // ---- Recorder (Phase 2) ----
  //
  // MediaRecorder pipeline:
  //   video stream = canvas.captureStream(30)
  //   audio stream = A.el.captureStream() (if a song is loaded)
  //   combined via MediaStream of both tracks
  //   recorded with mime = video/mp4 (preferred) or video/webm fallback
  //   output: Blob → object URL → <a download> click
  const Recorder = {
    rec: null,
    chunks: [],
    mime: '',
    autoStopAt: 0,
    autoStopTimer: null,
    recording: false,
    mediaDest: null,
    // Phase 8: live-elapsed tick + two-click stop safety
    _startedAt: 0,           // performance.now() at recording start
    _elapsedTimer: null,     // 250ms tick that updates foot-meta
    _pendingStopAt: 0,       // performance.now() deadline for the second click
    _pendingStopTimer: null, // setTimeout to clear the pending-stop hint
    isSupported: typeof MediaRecorder !== 'undefined' &&
                 typeof HTMLCanvasElement !== 'undefined' &&
                 typeof HTMLCanvasElement.prototype.captureStream === 'function',
    pickMime() {
      if (typeof MediaRecorder === 'undefined') return '';
      const candidates = [
        'video/mp4;codecs=avc1.42e01e,mp4a.40.2',
        'video/mp4',
        'video/webm;codecs=vp9,opus',
        'video/webm;codecs=vp8,opus',
        'video/webm',
      ];
      for (const c of candidates) {
        try { if (MediaRecorder.isTypeSupported(c)) return c; } catch (_) {}
      }
      return '';
    },
    start(durMs) {
      if (!this.isSupported) { setStatus('MediaRecorder not supported', 'err'); return false; }
      if (this.recording) return false;
      const canvas = $('preview');
      if (!canvas) { setStatus('no canvas', 'err'); return false; }
      this.mime = this.pickMime();
      if (!this.mime) { setStatus('no supported mime', 'err'); return false; }
      // Video stream from canvas
      let videoStream;
      try { videoStream = canvas.captureStream(30); }
      catch (e) { setStatus('captureStream failed: ' + e.message, 'err'); return false; }
      // Audio stream from the song's audio bus (mvm-audio-bus.captureStream
      // returns a MediaStream from a MediaStreamDestination that the bus
      // already wires into the Web Audio graph). Earlier this read
      // A.el.captureStream() — that doesn't exist; the bus exposes
      // captureStream() as a method on A, not on A.el. Every previous
      // recording was video-only.
      let audioStream = null;
      let audioTrackCount = 0;
      try {
        const A = window.SWR && window.SWR.Audio;
        if (A && typeof A.captureStream === 'function') {
          // Eager-init the audio element if the user pressed REC
          // without ever loading a song. We can't synthesize bytes —
          // captureStream() needs a real source — so we just skip the
          // audio path and tell the user.
          if (!A.el) {
            setStatus('load a song first (PICK SONG)', 'warn');
          } else if (A.el.src &&
              typeof A.el.readyState === 'number' && A.el.readyState >= 2) {
            audioStream = A.captureStream();
            audioTrackCount = audioStream && audioStream.getAudioTracks
              ? audioStream.getAudioTracks().length : 0;
          } else if (A.el.src) {
            // Has a src but no data yet. The browser is still buffering —
            // retry once after a short delay (NOT awaited; Recorder.start
            // is not async). On a hit, we still capture audio; on a miss
            // the recording falls back to video-only without aborting.
            setTimeout(() => {
              try {
                if (A.el && A.el.readyState >= 2) {
                  audioStream = A.captureStream();
                }
              } catch (_) {}
            }, 250);
            setStatus('song still buffering — recording starts, audio will attach shortly', 'warn');
          }
        }
      } catch (_) { audioStream = null; }
      // Combine
      const tracks = [...videoStream.getVideoTracks()];
      if (audioStream) tracks.push(...audioStream.getAudioTracks());
      const combined = new MediaStream(tracks);
      try {
        this.rec = new MediaRecorder(combined, { mimeType: this.mime, videoBitsPerSecond: 8_000_000 });
      } catch (e) { setStatus('MediaRecorder ctor failed: ' + e.message, 'err'); return false; }
      this.chunks = [];
      this.rec.ondataavailable = (e) => { if (e.data && e.data.size) this.chunks.push(e.data); };
      this.rec.onstop = () => this._save();
      this.rec.start(500);
      this.recording = true;
      this._startedAt = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
      this._clearPendingStop();
      // Auto-stop
      this.autoStopAt = (typeof durMs === 'number' && durMs > 0) ? Date.now() + durMs : 0;
      if (this.autoStopAt > 0) {
        this.autoStopTimer = setTimeout(() => { if (this.recording) this.stop(); }, this.autoStopAt - Date.now());
      }
      // UI
      const recBtn = $('rec');
      if (recBtn) {
        recBtn.textContent = '■ STOP REC';
        recBtn.classList.remove('mvm-pending-stop');
        recBtn.classList.add('mvm-recording');
        recBtn.classList.add('tbtn-danger', 'danger');
      }
      const playPause = $('play-pause'); if (playPause) playPause.disabled = true;
      const stopBtn = $('stop'); if (stopBtn) stopBtn.disabled = false;
      setStatus('recording · ' + (this.mime.indexOf('mp4') !== -1 ? 'MP4' : 'WebM'), 'live');
      // Phase 8: live elapsed counter. Updates the foot-meta element
      // every 250ms while recording.
      this._tickElapsed();
      this._elapsedTimer = setInterval(() => this._tickElapsed(), 250);
      return true;
    },
    // Phase 8: update the footer with the recording's elapsed time +
    // (optionally) the total duration when auto-stop is set.
    _tickElapsed() {
      if (!this.recording) return;
      const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
      const elapsed = Math.max(0, now - this._startedAt);
      const fmt = (ms) => {
        const s = Math.floor(ms / 1000);
        const m = Math.floor(s / 60);
        const r = s % 60;
        return m + ':' + (r < 10 ? '0' + r : r);
      };
      let text = 'REC ' + fmt(elapsed);
      if (this.autoStopAt) {
        const total = Math.max(0, this.autoStopAt - (this._startedAt - (now - this._startedAt)));
        // Simpler: compute total from the duration the user asked for
        // (this.autoStopAt was set to Date.now() + durMs at start time;
        // we want elapsed vs remaining, where total = autoStopAt - nowAtStart).
        // We don't store nowAtStart; recompute from now-elapsed at start.
        // Approximation: this.autoStopAt - Date.now() is the remaining
        // ms in real time. Combine.
        const remaining = Math.max(0, this.autoStopAt - Date.now());
        text += ' / ' + fmt(remaining);
      }
      const meta = $('foot-meta');
      if (meta) meta.textContent = text;
    },
    _setPendingStop() {
      this._pendingStopAt = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
      const recBtn = $('rec');
      if (recBtn) {
        recBtn.classList.add('mvm-pending-stop');
        recBtn.title = 'Click again within 1.5s to stop recording';
      }
      const meta = $('foot-meta');
      if (meta) {
        const cur = meta.textContent || '';
        if (cur.indexOf('— click again') === -1) meta.textContent = cur + ' — click again to stop';
      }
      // Auto-clear the hint after 1.5s
      this._pendingStopTimer = setTimeout(() => this._clearPendingStop(), 1500);
    },
    _clearPendingStop() {
      this._pendingStopAt = 0;
      if (this._pendingStopTimer) {
        clearTimeout(this._pendingStopTimer);
        this._pendingStopTimer = null;
      }
      const recBtn = $('rec');
      if (recBtn) {
        recBtn.classList.remove('mvm-pending-stop');
        recBtn.title = '';
      }
      // The next _tickElapsed will overwrite the meta text within 250ms
    },
    stop() {
      if (!this.recording) return;
      this.recording = false;
      if (this.autoStopTimer) { clearTimeout(this.autoStopTimer); this.autoStopTimer = null; }
      if (this._elapsedTimer) { clearInterval(this._elapsedTimer); this._elapsedTimer = null; }
      this._clearPendingStop();
      try { this.rec.stop(); } catch (_) {}
      const recBtn = $('rec');
      if (recBtn) {
        recBtn.textContent = '● REC';
        recBtn.classList.remove('mvm-recording', 'mvm-pending-stop');
        recBtn.title = '';
      }
      const playPause = $('play-pause'); if (playPause) playPause.disabled = false;
      // Reset the foot-meta back to its neutral state.
      const meta = $('foot-meta');
      if (meta) meta.textContent = '—';
      setStatus('rendering…', '');
    },
    _save() {
      try {
        const blob = new Blob(this.chunks, { type: this.mime });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        const ext = this.mime.indexOf('mp4') !== -1 ? 'mp4' : 'webm';
        a.download = 'sainted-word-mvm-' + ts + '.' + ext;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => { try { URL.revokeObjectURL(url); } catch (_) {} }, 1500);
        setStatus('exported · ' + ext.toUpperCase() + ' · ' + Math.round(blob.size / 1024) + ' KB', 'ok');
      } catch (e) {
        setStatus('save failed: ' + e.message, 'err');
      }
    },
  };

  // ---- transport ----

  function play() {
    if (state._playing) return;
    if (Recorder && Recorder.recording) return; // can't play while recording
    if (timelineDurationMs() === 0) return;
    state._playing = true;
    // Pre-decode images so first frame is instant
    const preloads = [];
    for (const t of state.timeline) {
      const clip = clipById(t.clipId);
      if (clip && clip.type === 'image' && !clip._img) preloads.push(ensureImageDecoded(clip));
    }
    Promise.all(preloads).catch(() => {});

    state._tickHandle = setInterval(() => {
      state._playheadMs = Math.min(state._playheadMs + 33, timelineDurationMs());
      syncVideoClips(state._playheadMs);
      renderFrame(state._playheadMs);
      const readout = $('time-readout');
      if (readout) readout.textContent = fmtMs(state._playheadMs) + ' / ' + fmtMs(timelineDurationMs());
      if (state._playheadMs >= timelineDurationMs()) {
        pause();
        if (Recorder && Recorder.recording) Recorder.stop();
      }
    }, 33);
    $('play-pause').textContent = '❚❚ PAUSE';
    setStatus('playing', 'ok');
  }

  function pause() {
    if (state._tickHandle) { clearInterval(state._tickHandle); state._tickHandle = null; }
    // Pause any active <video> elements
    for (const el of _videoEls.values()) { try { el.pause(); } catch (_) {} }
    state._playing = false;
    $('play-pause').textContent = '▶ PLAY';
    setStatus('paused', 'warn');
  }

  function stop() {
    // If we're recording, stop the recorder first so MediaRecorder's
    // MediaStream + tracks are released. Without this, STOP leaves the
    // recorder running silently and the user can't tell.
    if (Recorder && Recorder.recording) {
      try { Recorder.stop(); } catch (_) {}
    }
    pause();
    state._playheadMs = 0;
    // Clear preview canvas
    setCanvasSize();
    const canvas = $('preview');
    if (canvas) {
      const c = canvas.getContext('2d');
      if (c) { c.fillStyle = '#0a0008'; c.fillRect(0, 0, canvas.width, canvas.height); }
    }
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

  // ---- library manager integration ----
  //
  // The manager is library-focused — search/sort/curate/dispatch to playlist.
  // We render it into its own modal (#library-modal) so it doesn't replace
  // the Phase-1 picker (which still handles cross-source lookups via
  // audio-bus / playlist tabs).

  function openLibraryModal() {
    const modal = $('library-modal');
    const host = $('library-modal-host');
    if (!modal || !host) return;
    host.innerHTML = '';
    modal.classList.add('open');
    if (!window.SWR_LIBRARY_MANAGER) {
      setStatus('library manager not loaded', 'err');
      return;
    }
    window.SWR_LIBRARY_MANAGER.render(host, {
      onPick: async (song) => {
        // Per-row "▶" picks a library row directly into the engine. The
        // picker's `pick()` knows how to resolve `source: 'library'` to a
        // blob URL; we delegate to loadSongIntoBus for parity with the
        // picker's behavior.
        await loadSongIntoBus(song);
        closeLibraryModal();
      },
    });
  }

  function closeLibraryModal() {
    const modal = $('library-modal');
    if (modal) modal.classList.remove('open');
    const host = $('library-modal-host');
    if (host) host.innerHTML = '';
  }

  async function loadSongIntoBus(song) {
    const url = await window.SWR_LIBRARY_SWITCHER.pick(song.source, song.sourceId);
    if (!url) { setStatus('could not resolve song URL', 'err'); return; }
    // <audio>.src = url works directly — no fetch+File round-trip needed.
    // The earlier path wrapped the URL through fetch → blob → File →
    // A.load(file), which (a) leaked the Library Switcher's URL and
    // (b) wasted a network round-trip. Set src directly; the bus owns
    // any blob: URL it later allocated via A.load(file) on its own
    // el.__swr_blob_url.
    const A = window.SWR && window.SWR.Audio;
    if (!A) { setStatus('audio bus not available', 'err'); return; }
    // The mvm-audio-bus creates A.el lazily inside A.load(file). When
    // we set el.src directly (this path), the element must exist
    // first — otherwise assigning src throws. Eager init: call a
    // no-op load() with a tiny silent WAV to spin up the bus.
    if (!A.el) {
      try {
        // 1-byte silent WAV header — see WAVEFORM comments in
        // lib/mvm-audio-bus.client.js for why we don't need real bytes.
        const silent = new Blob([new Uint8Array([
          0x52,0x49,0x46,0x46, 0x24,0x00,0x00,0x00, 0x57,0x41,0x56,0x45,
          0x66,0x6D,0x74,0x20, 0x10,0x00,0x00,0x00, 0x01,0x00,0x01,0x00,
          0x44,0xAC,0x00,0x00, 0x88,0x58,0x01,0x00, 0x02,0x00,0x10,0x00,
          0x64,0x61,0x74,0x61, 0x00,0x00,0x00,0x00
        ])], { type: 'audio/wav' });
        A.load(new File([silent], 'silent.wav', { type: 'audio/wav' }));
      } catch (e) { /* fall through; the next line may still work if A.load was previously called */ }
    }
    if (!A.el) { setStatus('audio bus failed to init', 'err'); return; }
    A.el.src = url;
    if (typeof A.play === 'function') {
      try { A.play(); } catch (_) { /* autoplay gated; user will press ▶ */ }
    }
    state.song = { ...song, blobUrl: url };
    save();
    renderSongDisplay();
    setStatus('song loaded: ' + song.title, 'ok');
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
    // Clean up any <video> elements we created
    for (const el of _videoEls.values()) {
      try { el.pause(); el.removeAttribute('src'); el.load(); } catch (_) {}
      try { el.remove(); } catch (_) {}
    }
    _videoEls.clear();
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
    // Library manager modal
    $('manage-library').addEventListener('click', openLibraryModal);
    $('close-library-modal').addEventListener('click', closeLibraryModal);
    // Transport
    $('play-pause').addEventListener('click', togglePlay);
    $('stop').addEventListener('click', stop);
    // Phase 11: page lifecycle cleanup. If the user navigates away
    // while recording, MediaRecorder would keep running silently and
    // leak the canvas captureStream + audio bus MediaStreamDestination.
    // Stop the recorder and pause any active video elements on
    // pagehide / beforeunload.
    function onPageHide() {
      try { if (Recorder && Recorder.recording) Recorder.stop(); } catch (_) {}
      for (const el of _videoEls.values()) {
        try { el.pause(); } catch (_) {}
      }
    }
    window.addEventListener('pagehide', onPageHide);
    window.addEventListener('beforeunload', onPageHide);

    // Phase 8: single global ESC handler. Pressing Escape while
    // recording stops the recording (bypasses the two-click safety).
    // Before, every click of the REC button added a new keydown
    // listener — leaks if the user clicked multiple times before the
    // recording actually started.
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && Recorder && Recorder.recording) {
        Recorder.stop();
      }
    });

    // VIZ toggle — flips state._vizEnabled, which gates the visualizer
    // overlay in renderFrame.
    const vizToggle = $('viz-toggle');
    if (vizToggle) {
      vizToggle.addEventListener('change', () => {
        state._vizEnabled = !!vizToggle.checked;
      });
    }
    // REC: button + duration select. Manual mode (value 0) requires the
    // user to click STOP. Auto modes set the duration in ms.
    const recBtn = $('rec');
    if (recBtn) {
      if (!Recorder.isSupported) { recBtn.disabled = true; recBtn.title = 'MediaRecorder not supported in this browser'; }
      recBtn.addEventListener('click', () => {
        if (Recorder.recording) {
          // Phase 8: two-click safety. The first click of STOP REC sets
          // a pending-stop state with a 1.5s window; a second click
          // within that window actually stops the recording. This
          // prevents accidental single-click kills of long recordings.
          if (Recorder._pendingStopAt) {
            Recorder.stop();
          } else {
            Recorder._setPendingStop();
          }
          return;
        }
        // Read duration
        const sel = $('rec-dur');
        const v = sel ? sel.value : '0';
        let durMs = 0;
        if (v === 'song') {
          const A = window.SWR && window.SWR.Audio;
          if (A && A.el && isFinite(A.el.duration) && A.el.duration > 0) {
            durMs = Math.max(0, (A.el.duration - (A.el.currentTime || 0)) * 1000);
          }
        } else if (v !== '0' && v !== 'manual') {
          durMs = parseInt(v, 10) * 1000;
        }
        Recorder.start(durMs);
      });
    }
    // Modal background click closes
    $('song-modal').addEventListener('click', (e) => {
      if (e.target.id === 'song-modal') closeSongModal();
    });
    $('library-modal').addEventListener('click', (e) => {
      if (e.target.id === 'library-modal') closeLibraryModal();
    });

    await load();
    renderClips();
    renderTimeline();
    renderSongDisplay();
    updateDuration();
    setStatus(state.clips.length ? 'project loaded' : 'ready', 'ok');
  }

  // ---- Text overlays (Phase 5 full surface) ----
  //
  // CRUD + render path. Public API: addTextOverlay, removeTextOverlay,
  // updateTextOverlay. The render path is in renderFrame() above.
  function makeTextOverlayId() {
    return 'tx:' + Date.now() + ':' + Math.random().toString(36).slice(2, 8);
  }

  function addTextOverlay(opts) {
    const text = (opts && opts.text != null) ? String(opts.text) : '';
    if (!text.trim()) return null;
    const font = (opts && opts.font) || 'ui-monospace, monospace';
    const size = (opts && opts.size) || 48;
    const color = (opts && opts.color) || '#ffffff';
    const x = (opts && opts.x != null) ? opts.x : 0.5;
    const y = (opts && opts.y != null) ? opts.y : 0.5;
    const startMs = (opts && opts.startMs != null) ? opts.startMs : 0;
    const durationMs = (opts && opts.durationMs != null) ? opts.durationMs : Math.min(5000, Math.max(1000, timelineDurationMs() || 5000));
    const overlay = {
      id: makeTextOverlayId(),
      text, font, size, color, x, y, startMs,
      endMs: startMs + durationMs,
    };
    state.textOverlays.push(overlay);
    save();
    return overlay;
  }

  function removeTextOverlay(id) {
    const before = state.textOverlays.length;
    state.textOverlays = state.textOverlays.filter((t) => t.id !== id);
    if (state.textOverlays.length !== before) { save(); return true; }
    return false;
  }

  function updateTextOverlay(id, patch) {
    const t = state.textOverlays.find((x) => x.id === id);
    if (!t) return null;
    if ('text' in patch) t.text = String(patch.text);
    if ('font' in patch) t.font = String(patch.font);
    if ('size' in patch) t.size = parseInt(patch.size, 10) || t.size;
    if ('color' in patch) t.color = String(patch.color);
    if ('x' in patch) t.x = parseFloat(patch.x);
    if ('y' in patch) t.y = parseFloat(patch.y);
    if ('startMs' in patch) {
      t.startMs = parseInt(patch.startMs, 10) || 0;
      if ('durationMs' in patch) t.endMs = t.startMs + parseInt(patch.durationMs, 10);
    }
    save();
    return t;
  }

  // ---- public ----

  window.MVM = {
    init,
    get project() {
      return {
        song: state.song,
        clips: state.clips.slice(),
        timeline: state.timeline.slice(),
        textOverlays: (state.textOverlays || []).slice(),
      };
    },
    save, load,
    addClip, removeClip,
    setClipProps,
    addToTimeline, removeFromTimeline, reorderTimeline, resizeTimelineRow,
    addTextOverlay, removeTextOverlay, updateTextOverlay,
    timelineDurationMs,
    play, pause, stop,
    removeSong,
    resetProject,
    // Compositor
    renderFrame,
    syncVideoClips,
    setCanvasSize,
    // Recorder
    Recorder,
    setVizEnabled(enabled) {
      state._vizEnabled = !!enabled;
      const cb = $('viz-toggle');
      if (cb) cb.checked = state._vizEnabled;
      return state._vizEnabled;
    },
    get vizEnabled() { return state._vizEnabled !== false; },
    // Render helpers (for tests / external scripting)
    renderClips, renderTimeline, renderSongDisplay, updateDuration, renderClipThumb,
  };

  // Boot when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();