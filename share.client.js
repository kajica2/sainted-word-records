// share.client.js — URL hash share: encode current project into the URL
// fragment, restore on page load.
//
// Scope: FX + layers + UI prefs (no audio, no library assets). Full
// projects with audio still use the file-download channel (project.js).
// A shared URL is short — typically a few KB — because we strip the
// large fields (library, audio) and use compact JSON.
//
// Round trip:
//   save:   Project.get() → strip audio/library → JSON.stringify
//           → btoa(unescape(encodeURIComponent(...))) → URL hash
//   load:   location.hash → decodeURIComponent(escape(atob(...)))
//           → JSON.parse → Project.apply()

(function () {
  if (window.Share) return;  // idempotent

  const HASH_PREFIX = '#project=';

  function getShareableProject() {
    const SWR = window.SWR;
    const Project = SWR && window.Project;
    if (!Project || !Project.get) return null;
    const p = Project.get();
    if (!p) return null;
    // Strip the heavy fields. Library re-imports are a manual step the
    // user does on the receiving end. Audio is too large for URL hash.
    return {
      version: p.version || 1,
      fx: p.fx,
      preset: p.preset,
      persona: p.persona,
      palette: p.palette,
      scheduler: p.scheduler,
      panels: p.panels,
      layers: p.layers,           // metadata only — references assets by name
    };
  }

  function encode(project) {
    const json = JSON.stringify(project);
    // UTF-8 safe base64 (handles any character in JSON)
    return btoa(unescape(encodeURIComponent(json)))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');       // strip padding for URL safety
  }

  function decode(s) {
    // Reverse the URL-safe substitutions
    let b64 = s.replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4) b64 += '=';
    const json = decodeURIComponent(escape(atob(b64)));
    return JSON.parse(json);
  }

  function getShareUrl() {
    const project = getShareableProject();
    if (!project) return null;
    const enc = encode(project);
    const base = location.origin + location.pathname;
    return base + HASH_PREFIX + enc;
  }

  function copyShareUrl() {
    const url = getShareUrl();
    if (!url) {
      setStatus('share: no project to share', 'warn');
      return null;
    }
    // Clipboard API + fallback
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url)
        .then(() => setStatus('share url copied — paste anywhere', 'ok'))
        .catch(err => {
          console.warn('[share] clipboard failed:', err);
          fallbackCopy(url);
        });
    } else {
      fallbackCopy(url);
    }
    return url;
  }

  function fallbackCopy(text) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;top:-9999px;';
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand('copy');
      setStatus('share url copied (fallback)', 'ok');
    } catch (err) {
      setStatus('share: copy failed — url in console', 'warn');
      console.log('[share] copy this URL:', text);
    }
    ta.remove();
  }

  function loadFromHash() {
    if (!location.hash || !location.hash.startsWith(HASH_PREFIX)) return false;
    const enc = location.hash.slice(HASH_PREFIX.length);
    try {
      const project = decode(enc);
      const SWR = window.SWR;
      const Project = window.Project;
      if (Project && Project.apply) {
        // Strip audio from the loaded project (URL share doesn't include it)
        if (project.audio) delete project.audio;
        // Library references will fail (no assets bundled) — that's expected,
        // the user is told via setStatus that assets are missing.
        Project.apply(project);
        // Clear the hash so reload doesn't re-apply
        history.replaceState(null, '', location.pathname);
        return true;
      }
    } catch (err) {
      if (typeof setStatus === 'function') {
        setStatus('share: failed to load project from url: ' + err.message, 'err');
      }
    }
    return false;
  }

  // ---- UI ----
  function buildUI() {
    if (document.getElementById('share-btn')) return;

    // Add to existing PROJECT panel
    const projPanel = document.getElementById('project-panel');
    if (projPanel) {
      // Insert before the existing buttons
      const buttonsRow = projPanel.querySelector('#pj-save')?.parentElement;
      if (buttonsRow) {
        const btn = document.createElement('button');
        btn.id = 'share-btn';
        btn.style.cssText = 'width:100%;padding:6px;background:#7e2a4a;color:#fff;border:1px solid #9a4060;border-radius:6px;cursor:pointer;margin-bottom:4px;';
        btn.textContent = '🔗 Copy share URL';
        btn.title = 'Copy a URL that loads this project (no audio)';
        btn.addEventListener('click', copyShareUrl);
        buttonsRow.insertBefore(btn, buttonsRow.firstChild);
      }
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      buildUI();
      // Load after a short delay so SWR + Project are ready
      setTimeout(loadFromHash, 800);
    });
  } else {
    setTimeout(() => {
      buildUI();
      loadFromHash();
    }, 100);
  }

  window.Share = {
    getShareUrl,
    copyShareUrl,
    encode,
    decode,
    loadFromHash,
  };
})();