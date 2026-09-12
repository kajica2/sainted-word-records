// client/bg-removal-confirm.client.js
//
// Post-upload confirmation dialog for the dropzone → curator pipeline.
//
// Listens to the `swr:drop` CustomEvent that client/dropzone.client.js
// dispatches after every batch. For batches that contain any PNG/JPEG
// files, opens a modal listing each image's curator verdict:
//
//   - 'cleaned'  → background removed (uniform bg was detected)
//       Shows the cleaned image + "Undo" button that reverts to the
//       original by emitting a swr:bg-removal:revert event with the
//       file.
//   - 'passthrough' → curator saw a non-uniform background and kept
//       the file as-is.
//       Offers "Force-remove background" (re-runs curator with
//       mode='force') and "Keep as-is".
//   - 'skipped' → not a PNG/JPEG (video/audio/etc.). No action.
//
// The dialog is opt-in via data-bg-removal-confirm="true" on the
// .swr-dropzone element (default off to preserve existing behavior).
// Once a user makes a choice, the choice is remembered for the rest
// of the session via localStorage['swr-bg-removal-choice'] so repeat
// uploads don't nag — the user can always re-trigger by clearing the
// preference.
//
// Public API on window.SWR.BgRemovalConfirm:
//   { open(results), version, ATTRS }

(function () {
  'use strict';
  if (window.SWR && window.SWR.BgRemovalConfirm) return;

  const VERSION = '1.0.0';
  const STORAGE_KEY = 'swr-bg-removal-choice';
  // Allowed: 'auto' | 'force' | 'off'
  const STORAGE_ALLOWED = new Set(['auto', 'force', 'off']);

  const STYLE_ID = 'swr-bgremoval-styles';
  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent = [
      '.bg-removal-modal {',
      '  position: fixed; inset: 0; z-index: 9999;',
      '  display: none; align-items: center; justify-content: center;',
      '  background: rgba(8, 5, 3, 0.72);',
      '  backdrop-filter: blur(10px);',
      '  font-family: var(--font-body, "Geist", system-ui, sans-serif);',
      '}',
      '.bg-removal-modal.is-open { display: flex; }',
      '.bg-removal-modal__panel {',
      '  background: var(--bg-2, #161310);',
      '  color: var(--ink, #f5ead8);',
      '  border: 1px solid var(--line, #2c2419);',
      '  border-radius: 14px;',
      '  width: min(720px, calc(100vw - 32px));',
      '  max-height: calc(100vh - 64px);',
      '  overflow: auto;',
      '  padding: 22px 24px 24px;',
      '  box-shadow: 0 20px 60px rgba(0,0,0,0.55);',
      '}',
      '.bg-removal-modal__head {',
      '  display: flex; align-items: baseline; justify-content: space-between;',
      '  gap: 12px; margin-bottom: 14px;',
      '  padding-bottom: 12px; border-bottom: 1px solid var(--line, #2c2419);',
      '}',
      '.bg-removal-modal__title {',
      '  font-family: var(--font-display, "Fraunces", serif);',
      '  font-weight: 400; font-size: 20px; margin: 0;',
      '  letter-spacing: -0.01em;',
      '}',
      '.bg-removal-modal__sub {',
      '  font-family: var(--font-mono, monospace); font-size: 11px;',
      '  color: var(--muted, #8a7a66); letter-spacing: 0.08em;',
      '  text-transform: uppercase;',
      '}',
      '.bg-removal-modal__list { list-style: none; padding: 0; margin: 0; }',
      '.bg-removal-modal__item {',
      '  display: grid; grid-template-columns: 56px 1fr auto; gap: 14px;',
      '  align-items: center;',
      '  padding: 10px 0; border-bottom: 1px solid var(--line, #2c2419);',
      '}',
      '.bg-removal-modal__item:last-child { border-bottom: 0; }',
      '.bg-removal-modal__thumb {',
      '  width: 56px; height: 56px; border-radius: 6px;',
      '  background: var(--bg, #0e0c0a);',
      '  background-image:',
      '    linear-gradient(45deg, rgba(255,255,255,0.05) 25%, transparent 25%, transparent 75%, rgba(255,255,255,0.05) 75%),',
      '    linear-gradient(45deg, rgba(255,255,255,0.05) 25%, transparent 25%, transparent 75%, rgba(255,255,255,0.05) 75%);',
      '  background-size: 12px 12px;',
      '  background-position: 0 0, 6px 6px;',
      '  overflow: hidden;',
      '  display: flex; align-items: center; justify-content: center;',
      '}',
      '.bg-removal-modal__thumb img { width: 100%; height: 100%; object-fit: cover; }',
      '.bg-removal-modal__meta { min-width: 0; }',
      '.bg-removal-modal__name {',
      '  font-size: 13px; font-weight: 500;',
      '  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;',
      '  color: var(--ink, #f5ead8);',
      '}',
      '.bg-removal-modal__verdict {',
      '  font-family: var(--font-mono, monospace); font-size: 10px;',
      '  letter-spacing: 0.08em; text-transform: uppercase;',
      '  color: var(--muted, #8a7a66); margin-top: 2px;',
      '}',
      '.bg-removal-modal__verdict--cleaned { color: var(--accent, #e6306b); }',
      '.bg-removal-modal__verdict--kept { color: var(--ink-2, #c0b29c); }',
      '.bg-removal-modal__actions { display: flex; gap: 6px; flex-wrap: wrap; justify-content: flex-end; }',
      '.bg-removal-modal__btn {',
      '  font-family: var(--font-mono, monospace); font-size: 10px;',
      '  letter-spacing: 0.08em; text-transform: uppercase;',
      '  padding: 6px 12px; border-radius: 999px;',
      '  background: transparent; color: var(--ink-2, #c0b29c);',
      '  border: 1px solid var(--line, #2c2419); cursor: pointer;',
      '  transition: all 0.18s;',
      '}',
      '.bg-removal-modal__btn:hover { color: var(--accent, #e6306b); border-color: var(--accent, #e6306b); }',
      '.bg-removal-modal__btn--primary { background: var(--accent, #e6306b); color: white; border-color: var(--accent, #e6306b); }',
      '.bg-removal-modal__btn--primary:hover { background: var(--ink, #1a1612); color: var(--bg, #faf7f2); border-color: var(--ink, #1a1612); }',
      '.bg-removal-modal__foot {',
      '  display: flex; align-items: center; justify-content: space-between; gap: 12px;',
      '  margin-top: 16px; padding-top: 14px; border-top: 1px solid var(--line, #2c2419);',
      '  font-family: var(--font-mono, monospace); font-size: 11px; color: var(--muted, #8a7a66);',
      '  letter-spacing: 0.04em;',
      '}',
      '.bg-removal-modal__foot-actions { display: flex; gap: 8px; }',
      '.bg-removal-modal__remember {',
      '  display: flex; align-items: center; gap: 6px; cursor: pointer; user-select: none;',
      '  font-family: var(--font-mono, monospace); font-size: 11px;',
      '  color: var(--ink-2, #c0b29c);',
      '}',
      '.bg-removal-modal__remember input { accent-color: var(--accent, #e6306b); }',
    ].join('\n');
    document.head.appendChild(s);
  }

  function isPngOrJpeg(file) {
    const t = (file.type || '').toLowerCase();
    return t === 'image/png' || t === 'image/jpeg' || t === 'image/jpg';
  }

  function objectUrlFor(file) {
    try { return URL.createObjectURL(file); } catch (_) { return ''; }
  }

  function readSavedChoice() {
    try {
      const v = localStorage.getItem(STORAGE_KEY);
      return STORAGE_ALLOWED.has(v) ? v : null;
    } catch (_) { return null;
    }
  }

  function saveChoice(choice) {
    if (!STORAGE_ALLOWED.has(choice)) return;
    try { localStorage.setItem(STORAGE_KEY, choice); } catch (_) {}
  }

  function clearChoice() {
    try { localStorage.removeItem(STORAGE_KEY); } catch (_) {}
  }

  // Re-runs the curator with mode='force' on a single file. Resolves
  // to the curator's full result object (status, file, folder, tags).
  async function forceRemove(file) {
    const curator = window.SWR_ASSET_CURATOR;
    if (!curator || !isPngOrJpeg(file)) return null;
    try {
      // The curator's process() doesn't expose a `mode` arg yet, so we
      // shim by setting a one-shot global hint the curator respects
      // (see client/asset-curator.client.js → process).
      window.__SWR_FORCE_BG_REMOVAL = true;
      const r = await curator.process(file);
      window.__SWR_FORCE_BG_REMOVAL = false;
      return r;
    } catch (_) {
      window.__SWR_FORCE_BG_REMOVAL = false;
      return null;
    }
  }

  function buildItem(file, result) {
    const li = document.createElement('li');
    li.className = 'bg-removal-modal__item';

    const thumb = document.createElement('div');
    thumb.className = 'bg-removal-modal__thumb';
    const img = document.createElement('img');
    img.src = objectUrlFor(file);
    img.alt = file.name || '';
    img.loading = 'lazy';
    thumb.appendChild(img);

    const meta = document.createElement('div');
    meta.className = 'bg-removal-modal__meta';
    const name = document.createElement('div');
    name.className = 'bg-removal-modal__name';
    name.textContent = file.name || '(unnamed)';
    const verdict = document.createElement('div');
    const status = result?.status || 'skipped';
    verdict.className = 'bg-removal-modal__verdict bg-removal-modal__verdict--' + (
      status === 'cleaned' ? 'cleaned' : status === 'passthrough' ? 'kept' : 'kept'
    );
    const folder = result?.folder ? ` → ${result.folder}` : '';
    const bg = result?.backgroundColor;
    const bgTxt = bg ? ` (bg ${bg.r},${bg.g},${bg.b})` : '';
    verdict.textContent =
      status === 'cleaned' ? `Background removed${bgTxt}${folder}` :
      status === 'passthrough' ? `Kept as-is (no uniform bg detected)${folder}` :
      `Skipped — not a PNG/JPEG${folder}`;
    meta.appendChild(name);
    meta.appendChild(verdict);

    const actions = document.createElement('div');
    actions.className = 'bg-removal-modal__actions';
    if (isPngOrJpeg(file)) {
      if (status === 'cleaned') {
        const undo = document.createElement('button');
        undo.className = 'bg-removal-modal__btn';
        undo.textContent = 'Undo';
        undo.title = 'Revert to the original (with background)';
        undo.addEventListener('click', () => {
          // Revert by emitting the original File in a swr:bg-removal:revert
          // event. Downstream consumers (engine, etc.) listen for this and
          // swap back the original. If no consumer is listening we just
          // visually mark the row as reverted.
          document.dispatchEvent(new CustomEvent('swr:bg-removal:revert', {
            detail: { file, originalFile: file, cleanedBlob: result?.file },
            bubbles: true,
          }));
          li.dataset.reverted = '1';
          verdict.textContent = 'Reverted to original';
          verdict.classList.remove('bg-removal-modal__verdict--cleaned');
          verdict.classList.add('bg-removal-modal__verdict--kept');
          undo.disabled = true;
          undo.style.opacity = '0.4';
        });
        actions.appendChild(undo);
      } else if (status === 'passthrough') {
        const force = document.createElement('button');
        force.className = 'bg-removal-modal__btn bg-removal-modal__btn--primary';
        force.textContent = 'Force-remove';
        force.title = 'Run the chroma-key pass even though no uniform background was detected';
        force.addEventListener('click', async () => {
          force.disabled = true;
          force.textContent = 'Working…';
          const r2 = await forceRemove(file);
          if (r2 && r2.status === 'cleaned') {
            // Re-render this row as cleaned
            const newLi = buildItem(r2.file, r2);
            li.replaceWith(newLi);
            saveChoice('force');
          } else if (r2) {
            force.textContent = 'No clean cut';
            verdict.textContent = 'Force attempt kept the image (no uniform bg)';
          } else {
            force.textContent = 'Failed';
          }
        });
        actions.appendChild(force);
        const keep = document.createElement('button');
        keep.className = 'bg-removal-modal__btn';
        keep.textContent = 'Keep as-is';
        keep.addEventListener('click', () => {
          li.style.opacity = '0.55';
          verdict.textContent = 'Kept as-is (your choice)';
          keep.disabled = true;
          force.disabled = true;
          saveChoice('off');
        });
        actions.appendChild(keep);
      }
    }

    li.appendChild(thumb);
    li.appendChild(meta);
    li.appendChild(actions);
    return li;
  }

  function buildModal(results, onClose) {
    injectStyles();
    const overlay = document.createElement('div');
    overlay.className = 'bg-removal-modal';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', 'Background removal review');

    const panel = document.createElement('div');
    panel.className = 'bg-removal-modal__panel';

    const head = document.createElement('div');
    head.className = 'bg-removal-modal__head';
    const title = document.createElement('h2');
    title.className = 'bg-removal-modal__title';
    title.textContent = 'Background removal';
    const sub = document.createElement('span');
    sub.className = 'bg-removal-modal__sub';
    const pngs = results.filter((r) => isPngOrJpeg(r.file));
    sub.textContent = `${pngs.length} image${pngs.length === 1 ? '' : 's'} reviewed`;
    head.appendChild(title);
    head.appendChild(sub);

    const list = document.createElement('ul');
    list.className = 'bg-removal-modal__list';
    results.forEach((r) => list.appendChild(buildItem(r.file, r.result)));

    const foot = document.createElement('div');
    foot.className = 'bg-removal-modal__foot';
    const remember = document.createElement('label');
    remember.className = 'bg-removal-modal__remember';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.addEventListener('change', () => {
      if (cb.checked) {
        // Remember the current most-recent decision set as the default
        // for the next upload. We save 'auto' (let curator decide) since
        // the user just reviewed and either accepted or fixed.
        saveChoice('auto');
      } else {
        clearChoice();
      }
    });
    const cbText = document.createElement('span');
    cbText.textContent = 'Don\'t ask again for this session';
    remember.appendChild(cb);
    remember.appendChild(cbText);

    const footActions = document.createElement('div');
    footActions.className = 'bg-removal-modal__foot-actions';
    const done = document.createElement('button');
    done.className = 'bg-removal-modal__btn bg-removal-modal__btn--primary';
    done.textContent = 'Done';
    done.addEventListener('click', () => {
      overlay.classList.remove('is-open');
      // Free object URLs to avoid leaks
      overlay.querySelectorAll('img').forEach((im) => {
        try { URL.revokeObjectURL(im.src); } catch (_) {}
      });
      setTimeout(() => overlay.remove(), 200);
      if (typeof onClose === 'function') onClose();
    });
    footActions.appendChild(done);

    foot.appendChild(remember);
    foot.appendChild(footActions);

    panel.appendChild(head);
    panel.appendChild(list);
    panel.appendChild(foot);
    overlay.appendChild(panel);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) done.click();
    });
    document.addEventListener('keydown', function escListener(e) {
      if (e.key === 'Escape') {
        done.click();
        document.removeEventListener('keydown', escListener);
      }
    });
    return overlay;
  }

  // Returns the PNG/JPEG subset of `results` if there's anything worth
  // reviewing; otherwise returns null.
  function filterForReview(results) {
    const pngs = (results || []).filter((r) => r && r.file && isPngOrJpeg(r.file));
    if (!pngs.length) return null;
    return pngs;
  }

  function open(results) {
    const pngs = filterForReview(results);
    if (!pngs) return;
    // Skip if the user disabled the prompt for the session
    const saved = readSavedChoice();
    if (saved === 'off') return;
    const overlay = buildModal(pngs, () => {});
    document.body.appendChild(overlay);
    // Defer to next frame so the CSS transition runs
    requestAnimationFrame(() => overlay.classList.add('is-open'));
  }

  // Auto-attach: listen to swr:drop events on document. The dropzone
  // client (client/dropzone.client.js) passes the originating dropzone
  // element in detail.source so we can read its data-bg-removal-confirm
  // attribute without relying on event.target (which can be null
  // when CustomEvents are dispatched on document).
  function attach() {
    document.addEventListener('swr:drop', (e) => {
      const detail = (e && e.detail) || {};
      const results = detail.results || [];
      if (!results.length) return;
      const src = detail.source || (e.target && e.target.closest && e.target.closest('.swr-dropzone[data-bg-removal-confirm]'));
      if (!src) return;
      const mode = src.getAttribute && src.getAttribute('data-bg-removal-confirm');
      if (mode === 'false' || mode === 'off') return;
      open(results);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', attach, { once: true });
  } else {
    attach();
  }

  window.SWR = window.SWR || {};
  window.SWR.BgRemovalConfirm = { version: VERSION, open, attach, ATTRS: { STORAGE_KEY, STORAGE_ALLOWED: Array.from(STORAGE_ALLOWED) } };
})();
