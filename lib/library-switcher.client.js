// lib/library-switcher.client.js — unified song source picker.
//
// Exposes window.SWR_LIBRARY_SWITCHER for any consumer (the future
// Music Video Maker page, a history view, the engine's song selector,
// etc.) that needs to pick a song without caring which backing store
// it lives in.
//
//   list(source)                 — returns UnifiedSong[] for that source
//   pick(source, sourceId)       — resolves to a playable URL (object URL
//                                  for IndexedDB blobs; existing src for
//                                  the live audio bus; the stored url for
//                                  bundled sources)
//   render(target, opts)         — mounts the picker UI into a container
//                                  element. opts: { onPick(unifiedSong) }
//
// UnifiedSong shape:
//   {
//     id, source, sourceId, title, artist?, duration, url, thumbUrl?
//   }
//
// Idempotent: re-evaluating the script returns the cached singleton.

(function () {
  'use strict';
  if (window.SWR_LIBRARY_SWITCHER) return;

  // ---- source helpers ----

  // Audio bus (currently-loaded song). Always exactly one entry, if the
  // user has loaded anything. If nothing is playing, returns [].
  function listAudioBus() {
    const A = window.SWR && window.SWR.Audio;
    const el = A && A.el;
    if (!el || !el.src) return [];
    const id = 'audio-bus:' + (el.src || '');
    return [{
      id,
      source: 'audio-bus',
      sourceId: el.src,
      title: guessTitle(el.src),
      duration: isFinite(el.duration) && el.duration > 0 ? el.duration : 0,
      url: el.src, // already playable
    }];
  }

  // IndexedDB user media library. Only audio MIME types count as "songs";
  // images/videos are skipped at this source so the picker stays focused
  // on audio.
  async function listLibrary() {
    const M = window.SWR_MEDIA;
    if (!M || typeof M.getUserMedia !== 'function') return [];
    let rows = [];
    try { rows = await M.getUserMedia(); } catch (_) { return []; }
    return (rows || [])
      .filter((r) => r && r.blob && r.mime && r.mime.indexOf('audio/') === 0)
      .map(toUnifiedFromLibrary);
  }

  function toUnifiedFromLibrary(r) {
    return {
      id: 'library:' + r.id,
      source: 'library',
      sourceId: r.id,
      title: r.name || '(untitled)',
      duration: 0, // unknown until played
      url: undefined, // resolved via pick() — never store object URLs at rest
      blob: r.blob, // stash blob for pick() resolution; not serialized
      mime: r.mime,
      createdAt: r.createdAt,
    };
  }

  // The current playlist. window.SWR.PLAYLIST doesn't exist yet (it's a
  // future feature); the contract below is what the picker expects when
  // it does. Returning [] now keeps the picker functional; when the
  // playlist lands, populate it without changing the picker.
  async function listPlaylist() {
    const P = window.SWR && window.SWR.PLAYLIST;
    if (!P || !Array.isArray(P.songs)) return [];
    return P.songs.map((s, i) => ({
      id: 'playlist:' + (s.id || i),
      source: 'playlist',
      sourceId: s.id || String(i),
      title: s.title || s.name || '(untitled)',
      artist: s.artist,
      duration: s.duration || 0,
      url: s.url,
      thumbUrl: s.thumbUrl,
    }));
  }

  // Uploads namespace — separate from IndexedDB library? currently the
  // same store. Future split will land here without API changes. Today
  // it returns the same rows as `library`.
  async function listUploads() { return listLibrary(); }

  // ---- pick() ----

  async function pick(source, sourceId) {
    if (source === 'audio-bus') {
      const A = window.SWR && window.SWR.Audio;
      return (A && A.el && A.el.src) || null;
    }
    if (source === 'library') {
      // sourceId is the IndexedDB row id; resolve to a fresh object URL.
      const M = window.SWR_MEDIA;
      if (!M || typeof M.getUserMedia !== 'function') return null;
      let rows = [];
      try { rows = await M.getUserMedia(); } catch (_) { return null; }
      const row = (rows || []).find((r) => r.id === sourceId);
      if (!row || !row.blob) return null;
      return URL.createObjectURL(row.blob);
    }
    if (source === 'playlist') {
      const P = window.SWR && window.SWR.PLAYLIST;
      if (!P || !Array.isArray(P.songs)) return null;
      const idx = P.songs.findIndex((s) => (s.id || '') === sourceId);
      if (idx === -1) return null;
      return P.songs[idx].url || null;
    }
    return null;
  }

  // ---- render() ----

  const SOURCES = [
    { key: 'library', label: 'LIBRARY' },
    { key: 'uploads', label: 'UPLOADS' },
    { key: 'playlist', label: 'PLAYLIST' },
    { key: 'audio-bus', label: 'AUDIO BUS' },
  ];

  function guessTitle(url) {
    if (!url) return '(no title)';
    try {
      const u = new URL(url, location.href);
      const last = u.pathname.split('/').pop();
      if (last && last.length > 0) return decodeURIComponent(last);
    } catch (_) {}
    return '(playing)';
  }

  function fmtDur(s) {
    if (!s || !isFinite(s) || s <= 0) return '—:—';
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return m + ':' + String(sec).padStart(2, '0');
  }

  function el(tag, props, children) {
    const e = document.createElement(tag);
    if (props) {
      for (const k in props) {
        if (k === 'class') e.className = props[k];
        else if (k === 'text') e.textContent = props[k];
        else if (k === 'html') e.innerHTML = props[k];
        else if (k.indexOf('on') === 0 && typeof props[k] === 'function') {
          e.addEventListener(k.slice(2).toLowerCase(), props[k]);
        } else if (props[k] != null) {
          e.setAttribute(k, props[k]);
        }
      }
    }
    (children || []).forEach((c) => {
      if (c == null) return;
      e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return e;
  }

  function render(target, opts) {
    opts = opts || {};
    if (typeof target === 'string') target = document.querySelector(target);
    if (!target) return null;
    target.innerHTML = '';
    target.classList.add('lsw-root');

    const state = { source: 'audio-bus', songs: [] };

    const tabs = el('div', { class: 'lsw-tabs' },
      SOURCES.map((s) => {
        const b = el('button', {
          type: 'button', class: 'lsw-tab', 'data-source': s.key, text: s.label,
        });
        b.addEventListener('click', () => selectSource(s.key));
        return b;
      }),
    );

    const list = el('div', { class: 'lsw-list' });
    const empty = el('div', { class: 'lsw-empty' });

    const root = el('div', { class: 'lsw-panel' }, [tabs, list, empty]);

    function setActiveTab(key) {
      tabs.querySelectorAll('.lsw-tab').forEach((b) => {
        b.classList.toggle('active', b.getAttribute('data-source') === key);
      });
    }

    function renderRows(songs) {
      list.innerHTML = '';
      empty.style.display = songs.length ? 'none' : '';
      if (!songs.length) {
        empty.textContent = emptyLabel(state.source);
        return;
      }
      songs.forEach((s) => {
        const row = el('div', { class: 'lsw-row' }, [
          el('div', { class: 'lsw-thumb' }, s.thumbUrl
            ? [Object.assign(new Image(), { src: s.thumbUrl })]
            : [el('span', { class: 'lsw-thumb-fallback', text: initial(s.title) })]),
          el('div', { class: 'lsw-meta' }, [
            el('div', { class: 'lsw-title', text: s.title }),
            el('div', { class: 'lsw-sub', text: (s.artist ? s.artist + ' · ' : '') + fmtDur(s.duration) }),
          ]),
          el('button', {
            type: 'button', class: 'lsw-pick', text: 'SELECT',
            onclick: async (ev) => {
              const btn = ev.currentTarget;
              btn.disabled = true;
              btn.textContent = '…';
              try {
                if (typeof opts.onPick === 'function') {
                  await opts.onPick(s);
                }
                btn.textContent = '✓';
                setTimeout(() => { btn.textContent = 'SELECT'; btn.disabled = false; }, 1200);
              } catch (e) {
                btn.textContent = 'ERR';
                setTimeout(() => { btn.textContent = 'SELECT'; btn.disabled = false; }, 1500);
              }
            },
          }),
        ]);
        list.appendChild(row);
      });
    }

    function initial(t) {
      if (!t) return '♪';
      const c = t.trim().charAt(0).toUpperCase();
      return /[A-Z0-9]/.test(c) ? c : '♪';
    }

    async function selectSource(key) {
      state.source = key;
      setActiveTab(key);
      list.innerHTML = '';
      empty.textContent = 'loading…';
      empty.style.display = '';
      let songs = [];
      try {
        if (key === 'library') songs = await listLibrary();
        else if (key === 'uploads') songs = await listUploads();
        else if (key === 'playlist') songs = await listPlaylist();
        else if (key === 'audio-bus') songs = listAudioBus();
      } catch (e) {
        songs = [];
      }
      state.songs = songs;
      renderRows(songs);
    }

    target.appendChild(root);
    selectSource(state.source);
    setActiveTab(state.source);

    return {
      root,
      destroy() { target.innerHTML = ''; target.classList.remove('lsw-root'); },
      selectSource,
    };
  }

  function emptyLabel(source) {
    if (source === 'audio-bus') return 'Nothing playing — load a song first.';
    if (source === 'library') return 'No songs saved to your library yet.';
    if (source === 'uploads') return 'No uploads yet.';
    if (source === 'playlist') return 'No playlist active.';
    return 'Empty.';
  }

  // ---- public ----

  window.SWR_LIBRARY_SWITCHER = {
    sources: SOURCES.map((s) => s.key),
    list(source) {
      if (source === 'audio-bus') return Promise.resolve(listAudioBus());
      if (source === 'library') return listLibrary();
      if (source === 'uploads') return listUploads();
      if (source === 'playlist') return listPlaylist();
      return Promise.resolve([]);
    },
    pick,
    render,
  };
})();