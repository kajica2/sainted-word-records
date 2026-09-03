// tools/manifest-editor.client.js — vanilla JS controller for tools/manifest-editor.html
//
// Reads + writes library/manifest.json via the optional /api/manifest endpoint
// (Vercel serverless function — api/manifest.js). Falls back to localStorage +
// raw-JSON paste if the endpoint is unavailable. Does NOT upload file binaries;
// it only edits the manifest. Copy actual media into library/ on disk separately.

(function () {
  'use strict';

  // ----- DOM refs -----
  var $ = function (id) { return document.getElementById(id); };
  var els = {
    status:       $('status'),
    filesTbody:   $('files-tbody'),
    filesCount:   $('files-count'),
    groupsContainer: $('groups-container'),
    dropzone:     $('dropzone'),
    fileInput:    $('file-input'),
    rawPanel:     $('raw-panel'),
    rawTextarea:  $('raw-textarea'),
    statTotal:    $('stat-total'),
    statImg:      $('stat-img'),
    statVid:      $('stat-vid'),
    statPersona:  $('stat-persona'),
    statMissing:  $('stat-missing'),
    statOrphan:   $('stat-orphan'),
  };

  // ----- state -----
  var state = {
    files: [],          // array of { path, present }
    personaGroups: {},  // groupName -> array of paths
    raw: null,          // raw JSON object (for round-tripping unknown keys)
    fileSystem: { hasFs: false, root: '' },
    apiAvailable: false,
  };

  var SAMPLE = {
    files: [
      'p01.jpg', 'p02.png', 'p03.jpg', 'p04.jpg', 'p05.jpg',
      'p06.jpg', 'p07.jpg', 'p08.jpg', 'p09.jpg', 'p10.jpg',
      'c01-rooftop.mp4', 'c03-taxi.mp4', 'c06-smoke.mp4', 'c07-sunrise.mp4', 'c09-security.mp4',
      'persona/p16-raw-1.png', 'persona/p17-raw-2.png',
      'persona/p18-poster-1.png', 'persona/p19-poster-2.png',
      'persona/p20-mask-1.png', 'persona/p21-mask-2.png',
      'persona/p22-fx-1.png', 'persona/p23-fx-2.png',
      'persona/p24-filter-1.png', 'persona/p25-filter-2.png',
      'persona/p26-neon-1.png', 'persona/p27-neon-2.png',
      'persona/p28-film-1.png', 'persona/p29-film-2.png',
      'persona/p30-grid-1.png', 'persona/p31-grid-2.png',
      'persona/p32-smoke-1.png', 'persona/p33-smoke-2.png',
      'persona/p34-hallucination-1.png', 'persona/p35-hallucination-2.png',
    ],
    personaGroups: {
      raw: ['persona/p16-raw-1.png', 'persona/p17-raw-2.png'],
      poster: ['persona/p18-poster-1.png', 'persona/p19-poster-2.png'],
      mask: ['persona/p20-mask-1.png', 'persona/p21-mask-2.png'],
      fx: ['persona/p22-fx-1.png', 'persona/p23-fx-2.png'],
      filter: ['persona/p24-filter-1.png', 'persona/p25-filter-2.png'],
      neon: ['persona/p26-neon-1.png', 'persona/p27-neon-2.png'],
      film: ['persona/p28-film-1.png', 'persona/p29-film-2.png'],
      grid: ['persona/p30-grid-1.png', 'persona/p31-grid-2.png'],
      smoke: ['persona/p32-smoke-1.png', 'persona/p33-smoke-2.png'],
      hallucination: ['persona/p34-hallucination-1.png', 'persona/p35-hallucination-2.png'],
    },
  };

  // ----- helpers -----
  function setStatus(msg, kind) {
    els.status.innerHTML = '';
    if (!msg) return;
    var div = document.createElement('div');
    div.className = 'status ' + (kind || '');
    div.textContent = msg;
    els.status.appendChild(div);
  }

  function classify(p) {
    var ext = (p.split('.').pop() || '').toLowerCase();
    if (/^(mp4|webm|mov)$/.test(ext)) return 'video';
    if (/^(jpg|jpeg|png|gif|webp)$/.test(ext)) return 'image';
    if (/^(mp3|wav|ogg|m4a)$/.test(ext)) return 'audio';
    return 'other';
  }

  function groupsFor(p) {
    var out = [];
    for (var g in state.personaGroups) {
      if (state.personaGroups[g].indexOf(p) >= 0) out.push(g);
    }
    return out;
  }

  function validate() {
    var errors = [];
    var seen = {};
    state.files.forEach(function (f, idx) {
      if (!f.path || typeof f.path !== 'string') {
        errors.push('row ' + idx + ': empty path');
        return;
      }
      if (seen[f.path]) errors.push('duplicate: ' + f.path);
      seen[f.path] = true;
      if (f.path.indexOf('..') >= 0) errors.push('path contains ..: ' + f.path);
      if (f.path.startsWith('/') && f.path.indexOf('library/') !== 0) errors.push('absolute path not under library/: ' + f.path);
    });
    var fileSet = new Set(state.files.map(function (f) { return f.path; }));
    for (var g in state.personaGroups) {
      if (!Array.isArray(state.personaGroups[g])) {
        errors.push('personaGroups.' + g + ' is not an array');
        continue;
      }
      state.personaGroups[g].forEach(function (p) {
        if (!fileSet.has(p)) errors.push('personaGroups.' + g + ' references "' + p + '" not in top-level files[]');
      });
    }
    return errors;
  }

  function rebuildPersonaFromFiles() {
    // Drop any group entries whose path isn't in files[]
    var fileSet = new Set(state.files.map(function (f) { return f.path; }));
    for (var g in state.personaGroups) {
      state.personaGroups[g] = state.personaGroups[g].filter(function (p) { return fileSet.has(p); });
    }
  }

  function updateStats() {
    var fileSet = new Set(state.files.map(function (f) { return f.path; }));
    var counts = { image: 0, video: 0, persona: 0, missing: 0, orphan: 0 };
    var personaSet = new Set();
    for (var g in state.personaGroups) state.personaGroups[g].forEach(function (p) { personaSet.add(p); });
    state.files.forEach(function (f) {
      var k = classify(f.path);
      if (k === 'image') counts.image++;
      else if (k === 'video') counts.video++;
      if (f.path.indexOf('persona/') === 0) counts.persona++;
      if (!f.present) counts.missing++;
      if (k !== 'other' && !personaSet.has(f.path) && f.path.indexOf('persona/') !== 0) counts.orphan++;
    });
    els.statTotal.textContent = state.files.length;
    els.statImg.textContent = counts.image;
    els.statVid.textContent = counts.video;
    els.statPersona.textContent = counts.persona;
    els.statMissing.textContent = counts.missing;
    els.statOrphan.textContent = counts.orphan;
    els.filesCount.textContent = '(' + state.files.length + ')';
  }

  // ----- rendering -----
  function render() {
    // files table
    els.filesTbody.innerHTML = '';
    state.files.forEach(function (f, idx) {
      var tr = document.createElement('tr');
      if (!f.present) tr.className = 'missing';
      var kind = classify(f.path);
      var tdKind = document.createElement('td');
      var pill = document.createElement('span');
      pill.className = 'pill ' + kind;
      pill.textContent = kind;
      tdKind.appendChild(pill);
      tr.appendChild(tdKind);

      var tdPath = document.createElement('td');
      // thumbnail
      if (kind === 'image' || kind === 'video') {
        var thumb = document.createElement('img');
        thumb.className = 'file-thumb';
        thumb.src = '../library/' + f.path;
        thumb.onerror = function () { this.style.display = 'none'; };
        tdPath.appendChild(thumb);
      }
      var pathInput = document.createElement('input');
      pathInput.type = 'text';
      pathInput.value = f.path;
      pathInput.addEventListener('change', function () {
        state.files[idx].path = pathInput.value.trim();
        render();
      });
      tdPath.appendChild(pathInput);
      tr.appendChild(tdPath);

      var tdGroups = document.createElement('td');
      var grps = groupsFor(f.path);
      if (grps.length) {
        grps.forEach(function (g) {
          var pill = document.createElement('span');
          pill.className = 'pill persona';
          pill.style.marginRight = '4px';
          pill.textContent = g;
          tdGroups.appendChild(pill);
        });
      } else if (f.path.indexOf('persona/') === 0) {
        var ph = document.createElement('span');
        ph.style.color = 'var(--muted)';
        ph.style.fontSize = '11px';
        ph.textContent = '(no group)';
        tdGroups.appendChild(ph);
      }
      tr.appendChild(tdGroups);

      var tdStatus = document.createElement('td');
      if (!f.present) {
        var s = document.createElement('span');
        s.style.color = 'var(--err)';
        s.style.fontSize = '11px';
        s.textContent = 'missing on disk';
        tdStatus.appendChild(s);
      } else {
        var s = document.createElement('span');
        s.style.color = 'var(--ok)';
        s.style.fontSize = '11px';
        s.textContent = '✓';
        tdStatus.appendChild(s);
      }
      tr.appendChild(tdStatus);

      var tdAct = document.createElement('td');
      tdAct.className = 'row-actions';
      var upBtn = mkBtn('↑', function () { moveFile(idx, -1); });
      var downBtn = mkBtn('↓', function () { moveFile(idx, +1); });
      var delBtn = mkBtn('×', function () { removeFile(idx); }, 'danger');
      tdAct.appendChild(upBtn);
      tdAct.appendChild(downBtn);
      tdAct.appendChild(delBtn);
      tr.appendChild(tdAct);

      els.filesTbody.appendChild(tr);
    });

    // groups
    els.groupsContainer.innerHTML = '';
    var groupNames = Object.keys(state.personaGroups).sort();
    groupNames.forEach(function (g) {
      var block = document.createElement('div');
      block.className = 'group-block';
      var h = document.createElement('h4');
      h.textContent = g + ' (' + state.personaGroups[g].length + ')';
      var delGrp = mkBtn('×', function () { deleteGroup(g); }, 'danger');
      h.appendChild(delGrp);
      block.appendChild(h);

      var input = document.createElement('input');
      input.type = 'text';
      input.placeholder = 'persona/*.png path to add';
      input.addEventListener('keydown', function (ev) {
        if (ev.key === 'Enter' && input.value.trim()) {
          addToGroup(g, input.value.trim());
          input.value = '';
        }
      });
      block.appendChild(input);

      var tags = document.createElement('div');
      tags.className = 'group-files';
      state.personaGroups[g].forEach(function (p) {
        var tag = document.createElement('span');
        tag.className = 'tag';
        tag.textContent = p;
        var x = document.createElement('button');
        x.textContent = '×';
        x.title = 'remove from group';
        x.addEventListener('click', function () { removeFromGroup(g, p); });
        tag.appendChild(x);
        tags.appendChild(tag);
      });
      block.appendChild(tags);
      els.groupsContainer.appendChild(block);
    });

    updateStats();
  }

  function mkBtn(label, fn, kind) {
    var b = document.createElement('button');
    b.className = 'btn' + (kind ? ' ' + kind : '');
    b.textContent = label;
    b.addEventListener('click', function (e) { e.preventDefault(); fn(); });
    return b;
  }

  // ----- actions -----
  function addFiles(paths) {
    var seen = new Set(state.files.map(function (f) { return f.path; }));
    var added = 0;
    paths.forEach(function (p) {
      p = (p || '').replace(/^\.\//, '').trim();
      if (!p || seen.has(p)) return;
      state.files.push({ path: p, present: false });
      seen.add(p);
      added++;
    });
    if (added) {
      checkPresentOnDisk();
      render();
      setStatus('+ ' + added + ' file(s) added. Run Validate to check.', 'ok');
    } else {
      setStatus('No new files (all duplicates or empty).', 'warn');
    }
  }
  function moveFile(idx, dir) {
    var j = idx + dir;
    if (j < 0 || j >= state.files.length) return;
    var tmp = state.files[idx];
    state.files[idx] = state.files[j];
    state.files[j] = tmp;
    render();
  }
  function removeFile(idx) {
    state.files.splice(idx, 1);
    rebuildPersonaFromFiles();
    render();
  }
  function addEmptyRow() {
    state.files.push({ path: '', present: false });
    render();
  }
  function dedupe() {
    var seen = new Set();
    var removed = 0;
    state.files = state.files.filter(function (f) {
      if (seen.has(f.path)) { removed++; return false; }
      seen.add(f.path);
      return true;
    });
    render();
    setStatus('Dedupe: removed ' + removed + ' duplicate(s).', removed ? 'ok' : '');
  }
  function stripMissing() {
    var before = state.files.length;
    state.files = state.files.filter(function (f) { return f.present; });
    var removed = before - state.files.length;
    rebuildPersonaFromFiles();
    render();
    setStatus('Strip missing: removed ' + removed + ' missing-on-disk entries.', removed ? 'warn' : '');
  }
  function addGroup() {
    var name = prompt('Group name (e.g. "neon", "film"):');
    if (!name) return;
    if (state.personaGroups[name]) { setStatus('Group already exists: ' + name, 'warn'); return; }
    state.personaGroups[name] = [];
    render();
  }
  function deleteGroup(name) {
    if (!confirm('Delete group "' + name + '"? Files stay in top-level files[].')) return;
    delete state.personaGroups[name];
    render();
  }
  function addToGroup(group, path) {
    if (state.personaGroups[group].indexOf(path) < 0) state.personaGroups[group].push(path);
    render();
  }
  function removeFromGroup(group, path) {
    state.personaGroups[group] = state.personaGroups[group].filter(function (p) { return p !== path; });
    render();
  }

  // ----- API + disk check -----
  async function checkPresentOnDisk() {
    // The browser page can't read /library/ directly (security), but
    // /api/manifest?action=known-files can return a Set of files that exist on disk.
    // Falls back to optimistic present=true if endpoint unavailable.
    try {
      var r = await fetch('/api/manifest?action=known-files');
      if (!r.ok) throw new Error(r.status);
      var known = await r.json();
      var set = new Set(known.files || []);
      state.files.forEach(function (f) { f.present = set.has(f.path); });
    } catch (e) {
      // optimistic: mark all present
      state.files.forEach(function (f) { f.present = true; });
    }
    render();
  }

  async function loadFromApi() {
    setStatus('Loading…');
    try {
      var r = await fetch('/api/manifest');
      if (!r.ok) throw new Error('HTTP ' + r.status);
      var j = await r.json();
      applyManifest(j);
      setStatus('Loaded manifest from /api/manifest', 'ok');
    } catch (e) {
      setStatus('Could not load from /api/manifest: ' + e.message + ' — use "Load sample" or paste raw JSON.', 'err');
    }
  }

  async function saveToApi() {
    var errors = validate();
    if (errors.length) {
      setStatus('Validation failed: ' + errors.length + ' issue(s). Fix before saving.', 'err');
      return;
    }
    setStatus('Saving…');
    var payload = toManifest();
    try {
      var r = await fetch('/api/manifest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!r.ok) {
        var txt = await r.text();
        throw new Error('HTTP ' + r.status + ': ' + txt);
      }
      var j = await r.json();
      applyManifest(j);
      setStatus('Saved to /api/manifest. Pull from disk and commit.', 'ok');
    } catch (e) {
      setStatus('Save failed: ' + e.message, 'err');
    }
  }

  function toManifest() {
    var m = { files: state.files.map(function (f) { return f.path; }) };
    if (Object.keys(state.personaGroups).length) m.personaGroups = state.personaGroups;
    return m;
  }

  function applyManifest(m) {
    if (!m || typeof m !== 'object') throw new Error('Manifest is not an object');
    state.raw = m;
    state.files = Array.isArray(m.files) ? m.files.map(function (p) { return { path: p, present: false }; }) : [];
    state.personaGroups = m.personaGroups && typeof m.personaGroups === 'object' ? m.personaGroups : {};
    // unknown top-level keys: preserved in state.raw only — round-tripped as-is
    checkPresentOnDisk();
    render();
  }

  function loadSample() {
    applyManifest(SAMPLE);
    setStatus('Loaded sample manifest (mirror of pre-corruption state). Edit and Save.', 'ok');
  }

  function showRaw() {
    els.rawTextarea.value = JSON.stringify(toManifest(), null, 2);
    els.rawPanel.classList.toggle('hidden');
  }
  function applyRaw() {
    try {
      var j = JSON.parse(els.rawTextarea.value);
      applyManifest(j);
      setStatus('Applied raw JSON.', 'ok');
    } catch (e) {
      setStatus('Invalid JSON: ' + e.message, 'err');
    }
  }

  function formatRaw() {
    try {
      var j = JSON.parse(els.rawTextarea.value);
      els.rawTextarea.value = JSON.stringify(j, null, 2);
    } catch (e) { setStatus('Cannot format: ' + e.message, 'err'); }
  }

  function downloadManifest() {
    var blob = new Blob([JSON.stringify(toManifest(), null, 2) + '\n'], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'manifest.json';
    a.click();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    setStatus('Downloaded manifest.json. Place it at library/manifest.json and commit.', 'ok');
  }

  function doValidate() {
    var errors = validate();
    if (errors.length) {
      setStatus('❌ ' + errors.length + ' validation error(s): ' + errors.slice(0, 5).join(' | '), 'err');
    } else {
      setStatus('✓ Manifest is valid: ' + state.files.length + ' files, ' + Object.keys(state.personaGroups).length + ' groups.', 'ok');
    }
  }

  // ----- drag/drop & file input -----
  els.dropzone.addEventListener('click', function () { els.fileInput.click(); });
  els.dropzone.addEventListener('dragover', function (e) { e.preventDefault(); els.dropzone.classList.add('drag'); });
  els.dropzone.addEventListener('dragleave', function () { els.dropzone.classList.remove('drag'); });
  els.dropzone.addEventListener('drop', function (e) {
    e.preventDefault();
    els.dropzone.classList.remove('drag');
    var files = Array.from(e.dataTransfer.files || []);
    // Web pages can only read filename; they're dropped without content
    addFiles(files.map(function (f) { return f.name; }));
  });
  els.fileInput.addEventListener('change', function () {
    var files = Array.from(els.fileInput.files || []);
    addFiles(files.map(function (f) { return f.name; }));
    els.fileInput.value = '';
  });

  // ----- buttons -----
  $('btn-load').addEventListener('click', loadFromApi);
  $('btn-sample').addEventListener('click', loadSample);
  $('btn-add-empty').addEventListener('click', addEmptyRow);
  $('btn-dedupe').addEventListener('click', dedupe);
  $('btn-strip-missing').addEventListener('click', stripMissing);
  $('btn-validate').addEventListener('click', doValidate);
  $('btn-raw').addEventListener('click', showRaw);
  $('btn-format').addEventListener('click', formatRaw);
  $('btn-raw-apply').addEventListener('click', applyRaw);
  $('btn-download').addEventListener('click', function () {
    var errs = validate();
    if (errs.length) {
      if (!confirm('Manifest has ' + errs.length + ' validation issue(s). Download anyway?')) return;
    }
    downloadManifest();
  });
  $('btn-push').addEventListener('click', saveToApi);
  $('btn-add-group').addEventListener('click', addGroup);

  // ----- boot -----
  // Try the API on load. If unavailable, fall back to local sample.
  fetch('/api/manifest?action=known-files').then(function (r) {
    state.apiAvailable = r.ok;
    if (r.ok) {
      loadFromApi();
    } else {
      loadSample();
      setStatus('No /api/manifest endpoint detected — running in offline mode (Download to save).', 'warn');
    }
  }).catch(function () {
    loadSample();
    setStatus('No /api/manifest endpoint detected — running in offline mode. Edit JSON, then Download to save.', 'warn');
  });
})();
