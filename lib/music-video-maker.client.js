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
        clips: state.clips.map((c) => ({
          id: c.id, type: c.type, name: c.name, mime: c.mime,
          durationMs: c.durationMs, createdAt: c.createdAt,
          blend: c.blend, opacity: c.opacity, transition: c.transition,
        })),
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
            blend: c.blend || 'source-over',
            opacity: c.opacity != null ? c.opacity : 1,
            transition: c.transition || 'cut',
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

  const BLEND_OPTIONS = ['source-over', 'source-in', 'screen', 'lighter', 'multiply', 'difference', 'overlay'];
  const TRANSITION_OPTIONS = [
    { value: 'cut', label: 'cut' },
    { value: 'fade', label: 'fade 250ms' },
  ];

  function setClipProps(id, patch) {
    const clip = state.clips.find((c) => c.id === id);
    if (!clip) return null;
    if ('blend' in patch) clip.blend = patch.blend;
    if ('opacity' in patch) clip.opacity = clamp01(patch.opacity);
    if ('transition' in patch) clip.transition = patch.transition;
    save();
    renderClips();
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
      opa.addEventListener('input', () => setClipProps(clip.id, { opacity: parseFloat(opa.value) }));
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

      card.appendChild(thumb);
      card.appendChild(meta);
      card.appendChild(controls);
      card.appendChild(actions);
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
    if (!_videoEls.size) return;
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
    // For each active row, drive its video
    const dur = timelineDurationMs();
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
    void dur;
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
      // Audio stream from the song's <audio> element, if loaded
      let audioStream = null;
      try {
        const A = window.SWR && window.SWR.Audio;
        if (A && A.el && typeof A.el.captureStream === 'function') {
          audioStream = A.el.captureStream();
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
      // Auto-stop
      this.autoStopAt = (typeof durMs === 'number' && durMs > 0) ? Date.now() + durMs : 0;
      if (this.autoStopAt > 0) {
        this.autoStopTimer = setTimeout(() => { if (this.recording) this.stop(); }, this.autoStopAt - Date.now());
      }
      // UI
      const recBtn = $('rec');
      if (recBtn) {
        recBtn.textContent = '■ STOP REC';
        recBtn.classList.add('mvm-recording');
        recBtn.classList.add('tbtn-danger', 'danger');
      }
      const playPause = $('play-pause'); if (playPause) playPause.disabled = true;
      const stopBtn = $('stop'); if (stopBtn) stopBtn.disabled = false;
      setStatus('recording · ' + (this.mime.indexOf('mp4') !== -1 ? 'MP4' : 'WebM'), 'live');
      return true;
    },
    stop() {
      if (!this.recording) return;
      this.recording = false;
      if (this.autoStopTimer) { clearTimeout(this.autoStopTimer); this.autoStopTimer = null; }
      try { this.rec.stop(); } catch (_) {}
      const recBtn = $('rec');
      if (recBtn) {
        recBtn.textContent = '● REC';
        recBtn.classList.remove('mvm-recording');
      }
      const playPause = $('play-pause'); if (playPause) playPause.disabled = false;
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
    // REC: button + duration select. Manual mode (value 0) requires the
    // user to click STOP. Auto modes set the duration in ms.
    const recBtn = $('rec');
    if (recBtn) {
      if (!Recorder.isSupported) { recBtn.disabled = true; recBtn.title = 'MediaRecorder not supported in this browser'; }
      recBtn.addEventListener('click', () => {
        if (Recorder.recording) { Recorder.stop(); return; }
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
        // ESC stops the recording
        const onEsc = (e) => { if (e.key === 'Escape' && Recorder.recording) { Recorder.stop(); document.removeEventListener('keydown', onEsc); } };
        document.addEventListener('keydown', onEsc);
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
    setClipProps,
    addToTimeline, removeFromTimeline,
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