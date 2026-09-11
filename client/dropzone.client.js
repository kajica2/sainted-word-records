// client/dropzone.client.js
//
// Reusable batch file dropzone. Any element with class="swr-dropzone"
// auto-attaches: dragging files anywhere on it shows the drop overlay,
// dropping batches through window.SWR_ASSET_CURATOR.process() (when
// present) and emits a 'swr:drop' CustomEvent on document with the
// processed batch + per-file results.
//
// Wiring options (data-*):
//   data-accept="image/*,video/*,audio/*,.json,.svg"  (optional, default: image/*,video/*,audio/*)
//   data-max-files="0"                                 (optional, 0 = unlimited, default: 0)
//   data-target="asset-input"                          (optional, input id to forward the batch to)
//   data-mode="preview|forward|silent"                 (optional, default: preview)
//
// Modes:
//   preview  — render a small chip per file showing name + curator status
//   forward  — push each File into the <input data-target> via DataTransfer
//              (so existing engine addFiles() loops see the batch)
//   silent   — just emit swr:drop event, no UI
//
// Public surface on window.SWR.Dropzone:
//   { process, attach, detach, version }

(function () {
  'use strict';

  if (window.SWR && window.SWR.Dropzone) return;

  const VERSION = '1.0.0';

  const STYLE_ID = 'swr-dropzone-styles';
  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent = [
      '.swr-dropzone {',
      '  position: relative;',
      '  transition: background 0.18s ease, border-color 0.18s ease;',
      '}',
      '.swr-dropzone--idle {',
      '  border: 1.5px dashed var(--line, rgba(255,255,255,0.18));',
      '  border-radius: 12px;',
      '  padding: 18px;',
      '  text-align: center;',
      '  color: var(--muted, #8a7a5a);',
      '  font-family: var(--font-mono, ui-monospace, Menlo, monospace);',
      '  font-size: 12px; letter-spacing: 0.12em; text-transform: uppercase;',
      '  cursor: pointer;',
      '}',
      '.swr-dropzone--idle:hover { border-color: var(--accent, #d4af37); color: var(--accent, #d4af37); }',
      '.swr-dropzone--drag {',
      '  border-color: var(--accent, #d4af37);',
      '  background: color-mix(in srgb, var(--accent, #d4af37) 8%, transparent);',
      '  color: var(--accent, #d4af37);',
      '}',
      '.swr-dropzone__hint { display: block; font-size: 11px; opacity: 0.7; margin-top: 4px; letter-spacing: 0.04em; text-transform: none; }',
      '.swr-dropzone__overlay {',
      '  position: absolute; inset: 0;',
      '  display: none; align-items: center; justify-content: center;',
      '  background: rgba(10, 6, 4, 0.72);',
      '  backdrop-filter: blur(10px);',
      '  border-radius: 12px;',
      '  color: var(--accent, #d4af37);',
      '  font-family: var(--font-mono, ui-monospace, Menlo, monospace);',
      '  font-size: 14px; letter-spacing: 0.18em; text-transform: uppercase;',
      '  pointer-events: none; z-index: 10;',
      '}',
      '.swr-dropzone--drag .swr-dropzone__overlay { display: flex; }',
      '.swr-dropzone__chip-row {',
      '  display: flex; flex-wrap: wrap; gap: 6px; margin-top: 12px; padding: 0;',
      '  list-style: none;',
      '}',
      '.swr-dropzone__chip {',
      '  display: inline-flex; align-items: center; gap: 6px;',
      '  padding: 4px 10px; border-radius: 999px;',
      '  background: var(--panel, rgba(0,0,0,0.4));',
      '  border: 1px solid var(--line, rgba(255,255,255,0.18));',
      '  color: var(--ink, #f5e9c8);',
      '  font-family: var(--font-mono, ui-monospace, Menlo, monospace);',
      '  font-size: 11px;',
      '  max-width: 100%;',
      '}',
      '.swr-dropzone__chip--cleaned { border-color: var(--accent, #d4af37); color: var(--accent, #d4af37); }',
      '.swr-dropzone__chip--passthrough { border-color: rgba(180,200,220,0.6); color: rgba(180,200,220,0.85); }',
      '.swr-dropzone__chip--skipped { opacity: 0.6; }',
      '.swr-dropzone__chip-dot { width: 6px; height: 6px; border-radius: 50%; background: currentColor; }',
      '.swr-dropzone__chip-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 200px; }',
    ].join('\n');
    document.head.appendChild(s);
  }

  function defaultAccept() {
    return 'image/*,video/*,audio/*';
  }

  function readDataTransfer(dt) {
    // Walks dataTransfer.items so folder drops are flattened.
    // Synthetic DataTransfer items (programmatic, e.g. tests) often have
    // webkitGetAsEntry() === null — fall back to flat dt.files for those.
    const out = [];
    if (!dt) return Promise.resolve(out);
    const items = dt.items ? Array.from(dt.items) : [];
    const files = dt.files ? Array.from(dt.files) : [];
    if (items.length && typeof items[0].webkitGetAsEntry === 'function') {
      const promises = items.map((item) => {
        if (item.kind !== 'file') return Promise.resolve([]);
        let entry = null;
        try { entry = item.webkitGetAsEntry(); } catch (_) {}
        if (!entry) {
          // Synthetic file — fall back to dt.files lookup by name.
          const file = files.find((f) => f.name === item.getAsFile()?.name);
          return Promise.resolve(file ? [file] : (item.getAsFile() ? [item.getAsFile()] : []));
        }
        return walkEntry(entry);
      });
      return Promise.all(promises).then((arrs) => arrs.flat());
    }
    return Promise.resolve(files);
  }

  function walkEntry(entry) {
    if (entry.isFile) {
      return new Promise((resolve) => entry.file((f) => resolve([f]), () => resolve([])));
    }
    if (entry.isDirectory) {
      const reader = entry.createReader();
      return new Promise((resolve) => {
        const all = [];
        const read = () => {
          reader.readEntries((entries) => {
            if (!entries.length) return resolve(all);
            const promises = entries.map(walkEntry);
            Promise.all(promises).then((arrs) => {
              all.push(...arrs.flat());
              read();
            });
          }, () => resolve(all));
        };
        read();
      });
    }
    return Promise.resolve([]);
  }

  function matchesAccept(file, acceptList) {
    if (!acceptList || !acceptList.length) return true;
    const type = (file.type || '').toLowerCase();
    const name = (file.name || '').toLowerCase();
    return acceptList.some((rule) => {
      if (rule.startsWith('.')) return name.endsWith(rule.toLowerCase());
      if (rule.endsWith('/*')) {
        const prefix = rule.slice(0, -2);
        return type.startsWith(prefix + '/');
      }
      return type === rule;
    });
  }

  async function processOne(file, curator) {
    if (curator && /image\/(png|jpeg|jpg)/.test(file.type)) {
      try {
        const r = await curator.process(file);
        return { file, result: r, status: r.status || 'cleaned' };
      } catch (e) {
        return { file, result: null, status: 'skipped', error: e.message };
      }
    }
    return { file, result: null, status: 'skipped' };
  }

  async function processBatch(files, opts) {
    const curator = window.SWR_ASSET_CURATOR || null;
    const accept = (opts.accept || defaultAccept()).split(',').map((s) => s.trim()).filter(Boolean);
    const max = parseInt(opts.maxFiles || '0', 10);
    const filtered = files.filter((f) => matchesAccept(f, accept)).slice(0, max || Infinity);
    const results = [];
    // Run sequentially to avoid hammering the curator.
    for (const f of filtered) {
      const r = await processOne(f, curator);
      results.push(r);
    }
    return results;
  }

  function attach(el) {
    if (!el || el.__swrDropzoneAttached) return;
    el.__swrDropzoneAttached = true;

    injectStyles();
    el.classList.add('swr-dropzone');
    if (!el.querySelector('.swr-dropzone__overlay')) {
      const ov = document.createElement('div');
      ov.className = 'swr-dropzone__overlay';
      ov.textContent = 'Drop files to batch-upload';
      el.appendChild(ov);
    }
    if (!el.querySelector('.swr-dropzone__hint')) {
      const hint = document.createElement('span');
      hint.className = 'swr-dropzone__hint';
      hint.textContent = (el.getAttribute('data-accept') || defaultAccept()) + (el.getAttribute('data-mode') === 'silent' ? '' : ' — drag any number of files at once');
      el.appendChild(hint);
    }
    if (!el.classList.contains('swr-dropzone--idle')) el.classList.add('swr-dropzone--idle');

    let dragCount = 0;
    el.addEventListener('dragenter', (e) => {
      e.preventDefault();
      dragCount++;
      el.classList.add('swr-dropzone--drag');
    });
    el.addEventListener('dragover', (e) => {
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    });
    el.addEventListener('dragleave', () => {
      dragCount = Math.max(0, dragCount - 1);
      if (dragCount === 0) el.classList.remove('swr-dropzone--drag');
    });
    el.addEventListener('drop', async (e) => {
      e.preventDefault();
      dragCount = 0;
      el.classList.remove('swr-dropzone--drag');

      const opts = readOpts(el);
      const files = await readDataTransfer(e.dataTransfer);
      if (!files.length) return;

      const results = await processBatch(files, opts);
      const mode = opts.mode || 'preview';

      if (mode === 'forward') {
        forwardToInput(results, opts.target);
      } else if (mode === 'preview') {
        renderChips(el, results);
      }

      document.dispatchEvent(new CustomEvent('swr:drop', {
        detail: { results, files: results.map((r) => r.file) },
        bubbles: true,
      }));
    });

    // Click → open file picker (multi-select) → same path.
    el.addEventListener('click', (e) => {
      // Ignore clicks on the input itself (forward mode uses it directly).
      if (e.target.closest('input[type="file"]')) return;
      e.preventDefault();
      const picker = document.createElement('input');
      picker.type = 'file';
      picker.multiple = true;
      picker.accept = el.getAttribute('data-accept') || defaultAccept();
      picker.style.display = 'none';
      document.body.appendChild(picker);
      picker.addEventListener('change', async () => {
        const files = Array.from(picker.files || []);
        picker.remove();
        if (!files.length) return;
        const opts = readOpts(el);
        const results = await processBatch(files, opts);
        const mode = opts.mode || 'preview';
        if (mode === 'forward') forwardToInput(results, opts.target);
        else if (mode === 'preview') renderChips(el, results);
        document.dispatchEvent(new CustomEvent('swr:drop', {
          detail: { results, files: results.map((r) => r.file) },
          bubbles: true,
        }));
      });
      picker.click();
    });
  }

  function readOpts(el) {
    return {
      accept: el.getAttribute('data-accept') || defaultAccept(),
      maxFiles: el.getAttribute('data-max-files') || '0',
      target: el.getAttribute('data-target') || '',
      mode: el.getAttribute('data-mode') || 'preview',
    };
  }

  function forwardToInput(results, targetId) {
    if (!targetId) return;
    const input = document.getElementById(targetId);
    if (!input) return;
    try {
      const dt = new DataTransfer();
      results.forEach((r) => dt.items.add(r.file));
      input.files = dt.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    } catch (e) {
      // Some browsers refuse to set files programmatically; surface as event.
      document.dispatchEvent(new CustomEvent('swr:drop:forward-failed', {
        detail: { error: e.message, results, targetId }, bubbles: true,
      }));
    }
  }

  function renderChips(el, results) {
    let row = el.querySelector('.swr-dropzone__chip-row');
    if (!row) {
      row = document.createElement('ul');
      row.className = 'swr-dropzone__chip-row';
      el.appendChild(row);
    }
    results.forEach((r) => {
      const li = document.createElement('li');
      li.className = 'swr-dropzone__chip';
      let label = '· skip';
      if (r.status === 'cleaned') {
        li.classList.add('swr-dropzone__chip--cleaned');
        label = r.result?.folder ? `· cleaned → ${r.result.folder}` : '· cleaned';
      } else if (r.status === 'passthrough') {
        li.classList.add('swr-dropzone__chip--passthrough');
        label = r.result?.folder ? `· kept → ${r.result.folder}` : '· kept';
      } else {
        li.classList.add('swr-dropzone__chip--skipped');
      }
      const dot = document.createElement('span');
      dot.className = 'swr-dropzone__chip-dot';
      const name = document.createElement('span');
      name.className = 'swr-dropzone__chip-name';
      name.textContent = r.file.name;
      const tag = document.createElement('span');
      tag.textContent = label;
      li.appendChild(dot);
      li.appendChild(name);
      li.appendChild(tag);
      if (r.error) {
        const err = document.createElement('span');
        err.style.opacity = '0.6';
        err.style.marginLeft = '4px';
        err.title = r.error;
        err.textContent = '⚠';
        li.appendChild(err);
      }
      row.appendChild(li);
    });
  }

  function detach(el) {
    if (!el || !el.__swrDropzoneAttached) return;
    el.__swrDropzoneAttached = false;
    el.classList.remove('swr-dropzone', 'swr-dropzone--idle', 'swr-dropzone--drag');
  }

  function attachAll(root) {
    const sel = '.swr-dropzone:not([data-swr-no-auto])';
    const nodes = Array.from((root || document).querySelectorAll(sel));
    nodes.forEach(attach);
    return nodes.length;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => attachAll(), { once: true });
  } else {
    attachAll();
  }

  window.SWR = window.SWR || {};
  window.SWR.Dropzone = { version: VERSION, attach, detach, attachAll, processBatch };
})();