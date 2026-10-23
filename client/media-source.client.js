// client/media-source.client.js — the Media Source panel.
//
// The panel answers one question: where does the audio come from, and how
// is the picture locked to it?
//
//   Media Source
//   ├─ Video file:        [the loaded media]
//   ├─ Audio source:      Video audio | External audio file | None
//   ├─ Sync visuals to audio:  [on]
//   └─ Audio offset:      [0] ms
//
// The panel owns NOTHING of the audio graph: it drives window.Audio, which
// owns the source routing, the clock and the offset. The split is
// deliberate — the export path (which taps Audio.analyser) therefore
// inherits whatever the preview is doing, with no second set of controls
// that could disagree with the first.
//
// The rules the panel encodes:
//
//   * "Video audio" — the media element carries the audio. One element, so
//     the picture and the sound are the same clock and are locked by
//     construction. The sync and the offset have nothing to trim, so they
//     are disabled (with a title saying why) rather than lying.
//   * "External audio file" — a second element carries the audio and
//     becomes the clock; the media element is the picture and is corrected
//     onto it. Here the sync and the offset are the point of the panel.
//   * "None" — no audio at all. The picture still runs (the element is
//     captured by the graph but not connected, so it is silent).
//
// The offset sign follows the panel's contract: POSITIVE DELAYS THE AUDIO.
// The picture is therefore ahead of the music by that many milliseconds.
//
// Public API
//
//   window.SWR_MEDIA_SOURCE.__loaded   — true once the module is evaluated
//   .mount(hostEl)   — render the panel into a host element (default:
//                      #media-source). Idempotent.
//   .refresh()       — re-read window.Audio into the controls
//   .state()         — the current panel state (for tests + other pages)

(function () {
  'use strict';

  if (window.SWR_MEDIA_SOURCE && window.SWR_MEDIA_SOURCE.__loaded) return;

  // The offset is a user preference that outlives the session: the file it
  // trims is re-picked, the trim is remembered.
  var OFFSET_KEY = 'swr.media.offsetMs';

  function Audio() {
    return window.Audio || (window.SWR && window.SWR.Audio) || null;
  }
  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  // ---- styles (scoped via the .msrc prefix; no global rules) ----------
  function ensureStyles() {
    if (document.getElementById('media-source-css')) return;
    const s = document.createElement('style');
    s.id = 'media-source-css';
    s.textContent = `
.msrc { display:flex; flex-direction:column; gap:6px; padding:8px; border-bottom:1px solid var(--line); }
.msrc-head { font-size:10px; text-transform:uppercase; letter-spacing:.06em; color:var(--text-2,#aaa); }
.msrc-row { display:grid; grid-template-columns:88px 1fr; align-items:center; gap:8px; font-size:10px; color:var(--text-2,#aaa); }
.msrc-row > label { text-transform:none; letter-spacing:0; }
.msrc-val { display:flex; align-items:center; gap:6px; min-width:0; }
.msrc-name { color:var(--text-1,#eee); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.msrc-empty { color:var(--text-2,#888); font-style:italic; }
.msrc select, .msrc input[type="number"] {
  background:rgba(255,255,255,.05); color:var(--text-1,#eee);
  border:1px solid var(--border,#333); border-radius:4px; padding:3px 4px; font-size:10px;
}
.msrc input[type="number"] { width:64px; }
.msrc select:disabled, .msrc input:disabled { opacity:.4; }
.msrc input[type="file"] { display:none; }
.msrc .msrc-hint { font-size:9px; color:var(--text-2,#888); grid-column:1 / -1; }
.msrc .msrc-badge {
  font-size:8px; letter-spacing:.06em; padding:1px 4px; border-radius:3px;
  background:rgba(255,255,255,.08); color:var(--text-2,#bbb);
}
    `.trim();
    document.head.appendChild(s);
  }

  // ---- the panel -------------------------------------------------------
  var ui = {};
  var mounted = false;

  function readStoredOffset() {
    try {
      const v = parseInt(localStorage.getItem(OFFSET_KEY), 10);
      return isFinite(v) ? v : 0;
    } catch (e) { return 0; }
  }
  function storeOffset(ms) {
    try { localStorage.setItem(OFFSET_KEY, String(ms)); } catch (e) {}
  }

  function onSourceChange() {
    const A = Audio();
    if (!A) return;
    const v = ui.select.value;
    if (v === 'external') {
      // The mode only becomes "external" once a file is actually loaded —
      // otherwise picking the option and cancelling would silence the
      // engine. So: open the picker, and let the file handler decide.
      ui.file.click();
      return;
    }
    A.setAudioSource(v);
    refresh();
  }

  function onFilePicked(e) {
    const A = Audio();
    const f = e.target.files && e.target.files[0];
    e.target.value = '';   // allow the same file to be picked again
    if (!A || !f) { refresh(); return; }
    Promise.resolve(A.loadExternalAudio(f)).then(refresh, refresh);
  }

  function onSyncChange() {
    const A = Audio();
    if (!A) return;
    A.setSync(!!ui.sync.checked);
    refresh();
  }

  function onOffsetChange() {
    const A = Audio();
    if (!A) return;
    const n = parseInt(ui.offset.value, 10);
    const ms = A.setOffsetMs(isFinite(n) ? n : 0);
    storeOffset(ms);
    refresh();
  }

  function build(host) {
    ensureStyles();
    host.innerHTML = '';
    host.classList.add('msrc');

    const head = el('div', 'msrc-head', 'Media Source');
    host.appendChild(head);

    // ---- Video file ----
    const fileRow = el('div', 'msrc-row');
    const fileLabel = el('label', null, 'Video file');
    fileLabel.setAttribute('for', 'msrc-file');
    const fileVal = el('div', 'msrc-val');
    const fileName = el('span', 'msrc-name', '—');
    const fileBadge = el('span', 'msrc-badge', 'VIDEO');
    fileBadge.style.display = 'none';
    fileVal.appendChild(fileName);
    fileVal.appendChild(fileBadge);
    fileRow.appendChild(fileLabel);
    fileRow.appendChild(fileVal);
    host.appendChild(fileRow);

    // ---- Audio source ----
    const srcRow = el('div', 'msrc-row');
    const srcLabel = el('label', null, 'Audio source');
    srcLabel.setAttribute('for', 'msrc-source');
    const srcVal = el('div', 'msrc-val');
    const select = document.createElement('select');
    select.id = 'msrc-source';
    select.title = 'Where the audio comes from. The export follows this setting.';
    [
      ['video', 'Video audio'],
      ['external', 'External audio file'],
      ['none', 'None'],
    ].forEach(([value, label]) => {
      const opt = document.createElement('option');
      opt.value = value;
      opt.textContent = label;
      select.appendChild(opt);
    });
    const file = document.createElement('input');
    file.type = 'file';
    file.id = 'msrc-audio-file';
    file.accept = 'audio/*';
    file.title = 'The music that plays under the picture';
    srcVal.appendChild(select);
    srcVal.appendChild(file);
    srcRow.appendChild(srcLabel);
    srcRow.appendChild(srcVal);
    host.appendChild(srcRow);

    const extRow = el('div', 'msrc-row');
    const extLabel = el('label', null, 'Audio file');
    const extVal = el('div', 'msrc-val');
    const extName = el('span', 'msrc-name', '—');
    extVal.appendChild(extName);
    extRow.appendChild(extLabel);
    extRow.appendChild(extVal);
    extRow.style.display = 'none';
    host.appendChild(extRow);

    // ---- Sync ----
    const syncRow = el('div', 'msrc-row');
    const syncLabel = el('label', null, 'Sync visuals');
    const syncVal = el('div', 'msrc-val');
    const sync = document.createElement('input');
    sync.type = 'checkbox';
    sync.id = 'msrc-sync';
    sync.title = 'Keep the picture locked to the music';
    const syncText = el('span', null, 'to audio');
    syncVal.appendChild(sync);
    syncVal.appendChild(syncText);
    syncRow.appendChild(syncLabel);
    syncRow.appendChild(syncVal);
    host.appendChild(syncRow);

    // ---- Offset ----
    const offRow = el('div', 'msrc-row');
    const offLabel = el('label', null, 'Audio offset');
    const offVal = el('div', 'msrc-val');
    const offset = document.createElement('input');
    offset.type = 'number';
    offset.id = 'msrc-offset';
    offset.step = '10';
    offset.value = '0';
    offset.title = 'Milliseconds. Positive delays the audio, negative advances it.';
    const offUnit = el('span', null, 'ms');
    offVal.appendChild(offset);
    offVal.appendChild(offUnit);
    offRow.appendChild(offLabel);
    offRow.appendChild(offVal);
    host.appendChild(offRow);

    const hint = el('div', 'msrc-hint', '');
    host.appendChild(hint);

    ui = {
      host, fileName, fileBadge, select, file, extRow, extName,
      sync, offset, hint,
    };

    select.addEventListener('change', onSourceChange);
    file.addEventListener('change', onFilePicked);
    sync.addEventListener('change', onSyncChange);
    offset.addEventListener('change', onOffsetChange);
    // The audio engine announces every change of the source, the sync or
    // the offset — including the ones made from code rather than from
    // this panel.
    window.addEventListener('swr:media-source', refresh);
    // The file dialog steals focus and gives it back when it closes — that
    // is the only reliable signal that the picker was cancelled, and the
    // panel has to snap the select back to the mode that is really in use.
    window.addEventListener('focus', refresh);
  }

  // ---- refresh ---------------------------------------------------------
  function refresh() {
    if (!mounted || !ui.select) return;
    const A = Audio();
    if (!A) return;

    const name = A.mediaName || '';
    ui.fileName.textContent = name || '—';
    ui.fileName.className = name ? 'msrc-name' : 'msrc-name msrc-empty';
    ui.fileBadge.style.display = name && A.mediaIsVideo ? '' : 'none';

    const mode = A.audioSource || 'video';
    ui.select.value = mode;

    const external = mode === 'external' || !!A.externalEl;
    ui.extRow.style.display = external ? '' : 'none';
    ui.extName.textContent = A.externalName || '—';
    ui.extName.className = A.externalName ? 'msrc-name' : 'msrc-name msrc-empty';

    // The sync and the offset only mean something when the picture and the
    // music are two different elements. With the video's own track they are
    // the same element — locked by construction, nothing to trim.
    const separate = mode === 'external';
    ui.sync.disabled = !separate;
    ui.sync.checked = !!A.sync;
    ui.sync.title = separate
      ? 'Keep the picture locked to the music'
      : 'The video\'s own audio is the same element as the picture — always in sync.';
    ui.offset.disabled = !separate;
    ui.offset.value = String(A.offsetMs || 0);
    ui.offset.title = separate
      ? 'Milliseconds. Positive delays the audio, negative advances it.'
      : 'Only applies when the audio comes from a separate file.';

    ui.hint.textContent = mode === 'none'
      ? 'No audio — the picture runs on its own.'
      : (separate
        ? 'The picture follows the music' + (A.sync ? '.' : ' (sync off).')
        : 'The picture and the sound are the same element.');
  }

  // ---- public ----------------------------------------------------------
  function mount(hostEl) {
    const host = hostEl || $('media-source');
    if (!host) return false;
    build(host);
    mounted = true;
    const A = Audio();
    if (A && typeof A.setOffsetMs === 'function') {
      // Restore the remembered trim. Only when the user has not moved it
      // for this session.
      const stored = readStoredOffset();
      if (stored && !A.offsetMs) A.setOffsetMs(stored);
    } else {
      // The audio engine has not been evaluated yet — try again shortly.
      setTimeout(function () { if (!Audio()) mount(host); }, 120);
    }
    refresh();
    // The song-loaded seam: a new media file changes the panel's first row
    // and resets the source to the video's own track.
    const prev = window.__swrOnSongLoaded;
    window.__swrOnSongLoaded = function (file, audio) {
      if (typeof prev === 'function') { try { prev(file, audio); } catch (e) {} }
      try { refresh(); } catch (e) {}
    };
    return true;
  }

  window.SWR_MEDIA_SOURCE = {
    __loaded: true,
    mount,
    refresh,
    state() {
      const A = Audio();
      if (!A) return null;
      return {
        audioSource: A.audioSource,
        sync: !!A.sync,
        offsetMs: A.offsetMs || 0,
        externalName: A.externalName || '',
        mediaName: A.mediaName || '',
        clock: A.clock,
      };
    },
  };

  // Auto-mount when the engine's panel is in the document.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { mount(); });
  } else {
    mount();
  }
})();
