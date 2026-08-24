// project.js — serialize and restore the editor state (Project save/load).
//
// Project shape:
//   {
//     version: 2,
//     savedAt: <iso>,
//     library: [ { id, name, type, motion, luma, hue, w, h, duration } ],   // metadata only
//     layers:  [ { id, assetId, blend, opacity, baseScale, hue, brightness, contrast, reactors, pos, z } ],
//     fx:      { temperature, mutations, mutAlgo, posterize, vignette, chroma, grain, sepia, glow, grayscale, blur },
//     preset:  'pulse' | 'drift' | ... | null,
//     persona: 'raw' | 'poster' | ... | 'off',
//     scheduler: { enabled, minSeconds, maxSeconds, beatSync },
//     panels:  { library: { rotated }, layers: { rotated } },
//     palette: 'neon' | 'solar' | ...,
//     audio:   { name, type, dataUrl, seekPosition } | null,
//   }
//
// Audio source IS included — embedded as a base64 data URL so the project
// is fully self-contained. A 4-minute MP3 ~ 4 MB becomes ~ 5.4 MB base64.
// Library assets (videos/images) are still NOT bundled — they'd bloat the
// file 50-100x. Users re-import clips after loading.

(function () {
  if (window.Project) return;  // idempotent

  const VERSION = 2;

  // ---- Audio: serialize the current audioEl's source as base64 ----
  async function captureAudio() {
    const SWR = window.SWR || {};
    const Audio = SWR.Audio || {};
    const audioEl = Audio.audioEl;
    if (!audioEl || !audioEl.src) return null;
    // Skip mic/camera streams (they're not blob: URLs)
    if (!audioEl.src.startsWith('blob:')) return null;

    try {
      // Fetch the blob URL and re-encode
      const resp = await fetch(audioEl.src);
      const blob = await resp.blob();
      const dataUrl = await new Promise((resolve, reject) => {
        const fr = new FileReader();
        fr.onload = () => resolve(fr.result);
        fr.onerror = () => reject(new Error('FileReader failed'));
        fr.readAsDataURL(blob);
      });
      return {
        name: Audio.feat && audioEl.src.split('/').pop().split('?')[0] || 'song',
        type: blob.type || 'audio/mpeg',
        dataUrl,
        seekPosition: audioEl.currentTime || 0,
        wasPlaying: !!Audio.playing,
      };
    } catch (err) {
      console.warn('[project] audio capture failed:', err);
      return null;
    }
  }

  function get() {
    const SWR = window.SWR || {};
    const Audio = SWR.Audio || {};
    const Library = SWR.Library || {};
    const Layers = SWR.Layers || {};
    const FX = window.FX || { state: {} };

    // Library: only metadata, not blobs
    const library = (Library.items || []).map(it => ({
      id: it.id,
      name: it.name,
      type: it.type,
      motion: it.motion || 0,
      luma: it.luma || 0,
      hue: it.hue || 0,
      w: it.w || 0,
      h: it.h || 0,
      duration: it.duration || 0,
    }));

    const layers = (Layers.list || []).map(l => ({
      id: l.id,
      assetId: l.asset ? l.asset.id : null,
      assetName: l.asset ? l.asset.name : null,
      blend: l.blend,
      opacity: l.opacity,
      baseScale: l.baseScale,
      hue: l.hue,
      brightness: l.brightness,
      contrast: l.contrast,
      alpha: l.alpha,
      mutate: l.mutate,
      reactors: (l.reactors || []).map(r => ({ ...r })),
      pos: l.pos ? { ...l.pos } : { x: 0, y: 0, rot: 0 },
      z: l.z,
    }));

    const fxState = FX.state || {};
    const fx = {
      temperature: fxState.temp,
      mutations:    fxState.mut,
      mutAlgo:      fxState.mutAlgo,
      posterize:    fxState.posterize,
      vignette:     fxState.vignette,
      chroma:       fxState.chroma,
      grain:        fxState.grain,
      sepia:        fxState.sepia,
      glow:         fxState.glow,
      grayscale:    fxState.grayscale,
      blur:         fxState.blur,
    };

    // Sliders win over FX state when both exist (sliders are the user-facing truth)
    const slider = (id) => {
      const el = document.getElementById(id);
      return el ? parseFloat(el.value) : null;
    };
    const s = {
      temperature: slider('temperature'),
      mutations:    slider('mutations'),
      mutAlgo:      slider('mut-algo'),
      posterize:    slider('posterize'),
      vignette:     slider('vignette'),
      chroma:       slider('chroma'),
      grain:        slider('grain'),
      sepia:        slider('sepia'),
      glow:         slider('glow'),
      grayscale:    slider('grayscale'),
      blur:         slider('blur'),
    };
    for (const k of Object.keys(fx)) {
      if (s[k] !== null && s[k] !== undefined) fx[k] = s[k];
    }

    const personaSel = document.getElementById('persona');
    const presetSel  = document.getElementById('preset');
    const paletteSel = document.getElementById('palette');

    // Scheduler state
    const SchedState = (window.LayerScheduler && window.LayerScheduler.state) || {};

    // Panels
    let panels = { library: { rotated: false }, layers: { rotated: false } };
    try {
      panels = JSON.parse(localStorage.getItem('swr_panel_rot') || '{}');
      panels.library = panels.library || { rotated: false };
      panels.layers  = panels.layers  || { rotated: false };
    } catch {}

    return {
      version: VERSION,
      savedAt: new Date().toISOString(),
      library,
      layers,
      fx,
      preset:  presetSel  ? presetSel.value  : null,
      persona: personaSel ? personaSel.value : 'off',
      palette: paletteSel ? paletteSel.value : null,
      scheduler: {
        enabled:    !!SchedState.enabled,
        minSeconds: SchedState.minSeconds || 5,
        maxSeconds: SchedState.maxSeconds || 10,
        beatSync:   !!SchedState.beatSync,
      },
      panels,
      songName: (Audio.audioEl && Audio.audioEl.src) ? Audio.audioEl.src.split('/').pop().split('?')[0] : null,
      // audio is filled in async by download() — leave null in get()'s sync return
      audio: null,
    };
  }

  async function download() {
    const project = get();
    // Capture audio (async — base64 encode the current audio file)
    const audio = await captureAudio();
    project.audio = audio;
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const blob = new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `swr-project-${ts}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    if (typeof setStatus === 'function') {
      const audioNote = audio ? ` + audio (${Math.round(audio.dataUrl.length / 1024)} KB)` : ' (no audio)';
      if (typeof setStatus === 'function') setStatus(`saved project (${project.layers.length} layers, ${project.library.length} assets${audioNote})`, 'ok');
    }
    return project;
  }

  // Apply a project snapshot to the running app.
  // Restores: FX uniforms, sliders, persona, preset, palette, scheduler config,
  // panel rotation, AND the audio source (if embedded as base64 data URL).
  // Library: names of missing assets are reported via setStatus; layers that
  //   reference them keep their .asset reference but the asset may not resolve
  //   at draw time (UI will show empty).
  // Audio: if project.audio.dataUrl is present, decoded back to a File and
  //   fed through Audio.loadFile(). Seek position + play state restored.
  async function apply(project) {
    if (!project) return false;
    // Allow version 1 (no audio) and version 2 (with audio).
    if (project.version !== 1 && project.version !== VERSION) {
      if (typeof setStatus === 'function') {
        if (typeof setStatus === 'function') setStatus(`project version mismatch (got ${project.version}, want 1 or ${VERSION})`, 'err');
      }
      return false;
    }

    const SWR = window.SWR || {};
    const Library = SWR.Library || {};
    const Layers  = SWR.Layers  || {};

    // 1. Set FX state directly
    if (window.FX && project.fx) {
      window.FX.setPersona({
        temp: project.fx.temperature,
        mut: project.fx.mutations,
        mutAlgo: project.fx.mutAlgo,
        posterize: project.fx.posterize,
        vignette: project.fx.vignette,
        chroma: project.fx.chroma,
        grain: project.fx.grain,
        sepia: project.fx.sepia,
        glow: project.fx.glow,
        grayscale: project.fx.grayscale || 0,
        blur: project.fx.blur || 0,
      });
    }

    // 2. Set sliders + value displays
    const setSlider = (id, v) => {
      const el = document.getElementById(id);
      const valEl = document.getElementById(id + '-v');
      if (el) el.value = String(v);
      if (valEl) valEl.textContent = (id === 'mut-algo') ? String(v) : (parseFloat(v).toFixed(2));
    };
    if (project.fx) {
      setSlider('temperature', project.fx.temperature);
      setSlider('mutations',    project.fx.mutations);
      setSlider('mut-algo',     project.fx.mutAlgo);
      setSlider('posterize',    project.fx.posterize);
      setSlider('vignette',     project.fx.vignette);
      setSlider('chroma',       project.fx.chroma);
      setSlider('grain',        project.fx.grain);
      setSlider('sepia',        project.fx.sepia);
      setSlider('glow',         project.fx.glow);
      setSlider('grayscale',    project.fx.grayscale || 0);
      setSlider('blur',         project.fx.blur || 0);
    }

    // 3. Set persona / preset / palette dropdowns
    const personaSel = document.getElementById('persona');
    const presetSel  = document.getElementById('preset');
    const paletteSel = document.getElementById('palette');
    if (personaSel && project.persona !== undefined) {
      personaSel.value = project.persona;
      // Don't dispatch — that would re-tween; we just want the dropdown to reflect state.
    }
    if (presetSel && project.preset) {
      presetSel.value = project.preset;
      presetSel.dispatchEvent(new Event('change'));
    }
    if (paletteSel && project.palette) {
      paletteSel.value = project.palette;
      paletteSel.dispatchEvent(new Event('change'));
    }

    // 4. Re-build layers if Library is populated
    if (Layers.list && project.layers && project.layers.length) {
      // Build assetId → asset map from current Library
      const libMap = new Map((Library.items || []).map(it => [it.id, it]));
      const byName = new Map((Library.items || []).map(it => [it.name, it]));

      // Capture z baseline so rebuilt layers stack the same way
      const zBase = (Layers.list.length ? Math.max(...Layers.list.map(l => l.z || 0)) : 0) + 1;

      for (let i = 0; i < project.layers.length; i++) {
        const pl = project.layers[i];
        let asset = null;
        if (pl.assetId && libMap.has(pl.assetId)) {
          asset = libMap.get(pl.assetId);
        } else if (pl.assetName && byName.has(pl.assetName)) {
          asset = byName.get(pl.assetName);
        }
        if (!asset) continue;  // asset missing; skip

        Layers.add(asset);
        const l = Layers.list[Layers.list.length - 1];
        if (!l) continue;
        Object.assign(l, {
          blend: pl.blend,
          opacity: pl.opacity,
          baseScale: pl.baseScale,
          hue: pl.hue,
          brightness: pl.brightness,
          contrast: pl.contrast,
          alpha: pl.alpha,
          mutate: pl.mutate,
          reactors: (pl.reactors || []).map(r => ({ ...r })),
          pos: pl.pos ? { ...pl.pos } : l.pos,
          z: pl.z !== undefined ? pl.z : (zBase + i),
        });
      }
      if (Layers.render) Layers.render();
    }

    // 5. Scheduler config
    if (project.scheduler && window.LayerScheduler) {
      window.LayerScheduler.setRange(project.scheduler.minSeconds, project.scheduler.maxSeconds);
      if (project.scheduler.enabled) window.LayerScheduler.start();
    }

    // 6. Panel rotation
    if (project.panels) {
      const applyRot = (id, rotated) => {
        const panel = document.getElementById(id);
        const btn = document.querySelector(`.panel-rotate[data-target="${id}"]`);
        if (panel) panel.classList.toggle('rotated', !!rotated);
        if (btn) btn.classList.toggle('active', !!rotated);
      };
      applyRot('library', project.panels.library && project.panels.library.rotated);
      applyRot('layers',  project.panels.layers  && project.panels.layers.rotated);
      try {
        localStorage.setItem('swr_panel_rot', JSON.stringify(project.panels));
      } catch {}
    }

    if (typeof setStatus === 'function') {
      const missing = (project.layers || []).filter(pl => {
        if (!pl.assetName) return true;
        return !(Library.items || []).some(it => it.name === pl.assetName);
      }).length;
      const msg = missing > 0
        ? `project restored (${missing} layer(s) skipped — assets missing)`
        : `project restored (${project.layers.length} layers)`;
      if (typeof setStatus === 'function') setStatus(msg, missing > 0 ? 'warn' : 'ok');
    }

    // 7. Restore audio source (if embedded as base64 in v2+)
    if (project.audio && project.audio.dataUrl) {
      try {
        const a = project.audio;
        const resp = await fetch(a.dataUrl);
        const blob = await resp.blob();
        const file = new File([blob], a.name || 'song', { type: a.type || 'audio/mpeg' });
        // Feed through the normal load path so the engine wires up everything
        if (Audio && typeof Audio.loadFile === 'function') {
          Audio.loadFile(file);
          // Restore seek position once metadata is loaded
          if (a.seekPosition && Audio.audioEl) {
            const restoreSeek = () => {
              if (Audio.audioEl && Audio.audioEl.duration && a.seekPosition < Audio.audioEl.duration) {
                Audio.audioEl.currentTime = a.seekPosition;
              }
              if (a.wasPlaying && Audio.play) Audio.play();
            };
            if (Audio.audioEl.readyState >= 1) restoreSeek();
            else Audio.audioEl.addEventListener('loadedmetadata', restoreSeek, { once: true });
          }
          if (typeof setStatus === 'function') {
            if (typeof setStatus === 'function') setStatus('restored audio: ' + (a.name || 'song'), 'ok');
          }
        }
      } catch (err) {
        if (typeof setStatus === 'function') {
          if (typeof setStatus === 'function') setStatus('audio restore failed: ' + err.message, 'warn');
        }
      }
    }

    return true;
  }

  // Read a File and apply
  function loadFile(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const project = JSON.parse(e.target.result);
        apply(project);
      } catch (err) {
        if (typeof setStatus === 'function') setStatus(`project load failed: ${err.message}`, 'err');
      }
    };
    reader.onerror = () => {
      if (typeof setStatus === 'function') setStatus('project load failed: read error', 'err');
    };
    reader.readAsText(file);
  }

  // ---- UI ----
  function buildUI() {
    if (document.getElementById('project-panel')) return;
    const panel = document.createElement('div');
    panel.id = 'project-panel';
    panel.style.cssText = [
      'position:fixed', 'top:14px', 'right:14px', 'z-index:9999',
      'background:rgba(15,15,20,0.92)', 'color:#eee',
      'border:1px solid #333', 'border-radius:10px',
      'padding:10px 12px', 'font:11px/1.4 -apple-system,BlinkMacSystemFont,system-ui,sans-serif',
      'box-shadow:0 4px 18px rgba(0,0,0,0.4)', 'user-select:none',
      'min-width:220px'
    ].join(';');
    panel.innerHTML = `
      <div style="display:flex;align-items:center;gap:6px;margin-bottom:6px;">
        <strong style="font-size:11px;letter-spacing:0.04em;">📁 PROJECT</strong>
        <span id="pj-cloud-status" title="cloud sync status" style="margin-left:auto;font-size:9px;color:#888;letter-spacing:0.06em;text-transform:uppercase;">local</span>
        <button id="pj-hide" title="Hide panel" style="background:transparent;border:0;color:#888;cursor:pointer;font-size:14px;line-height:1;padding:0 0 0 6px;">×</button>
      </div>
      <button id="pj-save"   style="width:100%;padding:6px;background:#222;color:#ddd;border:1px solid #444;border-radius:6px;cursor:pointer;margin-bottom:4px;">⬇  Save (local)</button>
      <button id="pj-cloud-save" style="width:100%;padding:6px;background:#1c8c64;color:#fff;border:0;border-radius:6px;cursor:pointer;margin-bottom:4px;">☁  Save to cloud</button>
      <button id="pj-cloud-open" style="width:100%;padding:6px;background:#222;color:#ddd;border:1px solid #444;border-radius:6px;cursor:pointer;margin-bottom:4px;">☁  Open from cloud…</button>
      <button id="pj-load"   style="width:100%;padding:6px;background:#222;color:#ddd;border:1px solid #444;border-radius:6px;cursor:pointer;">⬆  Load file</button>
      <input id="pj-file"    type="file" accept="application/json,.json" style="display:none;">
    `;
    document.body.appendChild(panel);

    document.getElementById('pj-save').addEventListener('click', download);
    document.getElementById('pj-load').addEventListener('click', () => {
      document.getElementById('pj-file').click();
    });
    document.getElementById('pj-file').addEventListener('change', (e) => {
      const file = e.target.files && e.target.files[0];
      if (file) loadFile(file);
      e.target.value = '';
    });
    document.getElementById('pj-hide').addEventListener('click', () => {
      panel.style.display = 'none';
    });

    document.getElementById('pj-cloud-save').addEventListener('click', saveToCloud);
    document.getElementById('pj-cloud-open').addEventListener('click', openCloudPicker);

    // Hide cloud buttons until SWR_AUTH reports a signed-in user.
    // The chip is updated by syncChip() on every state change.
    syncChip();
  }

  // ---- Cloud sync (M1) ----
  let lastCloudId = null; // remembers the most recently saved cloud project id

  async function saveToCloud() {
    if (!window.SWR_AUTH || !window.SWR_STORAGE) {
      if (typeof setStatus === 'function') setStatus('cloud save: client modules missing', 'err');
      return;
    }
    const user = await window.SWR_AUTH.session({ force: true });
    if (!user) {
      if (typeof setStatus === 'function') setStatus('cloud save: sign in first (top-right)', 'warn');
      return;
    }
    setSync('saving');
    try {
      // 1. Capture project doc (no audio yet)
      const project = get();
      // 2. Upload audio as a separate blob (keeps the project doc small
      //    and lets the audio be streamed on load).
      if (project.audio && project.audio.dataUrl) {
        try {
          const resp = await fetch(project.audio.dataUrl);
          const blob = await resp.blob();
          const file = new File([blob], project.audio.name || 'song', { type: project.audio.type || blob.type || 'audio/mpeg' });
          const up = await window.SWR_STORAGE.uploadFile(file, 'songs');
          project.audio = { name: file.name, type: file.type, key: up.key, size: up.size };
        } catch (e) {
          console.warn('[project] audio upload failed; saving without audio', e);
          project.audio = null;
        }
      }
      // 3. Upsert project
      if (lastCloudId) project.id = lastCloudId;
      const meta = await window.SWR_STORAGE.saveProject(project);
      lastCloudId = meta.id;
      if (typeof setStatus === 'function') setStatus('cloud save: ' + meta.name + ' (' + project.layers.length + ' layers)', 'ok');
      setSync('synced');
    } catch (e) {
      if (typeof setStatus === 'function') setStatus('cloud save failed: ' + (e.body && e.body.error || e.message), 'err');
      setSync('error');
    }
  }

  async function openCloudPicker() {
    if (!window.SWR_AUTH || !window.SWR_STORAGE) return;
    const user = await window.SWR_AUTH.session({ force: true });
    if (!user) {
      if (typeof setStatus === 'function') setStatus('sign in first', 'warn');
      return;
    }
    try {
      const items = await window.SWR_STORAGE.listProjects();
      if (!items.length) {
        if (typeof setStatus === 'function') setStatus('no cloud projects yet', 'warn');
        return;
      }
      // Build a tiny modal listing the user's projects
      const modal = document.createElement('div');
      modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:10000;display:flex;align-items:center;justify-content:center;';
      const box = document.createElement('div');
      box.style.cssText = 'background:#0a0a0e;color:#eee;padding:18px 22px;border-radius:10px;max-width:520px;width:90%;border:1px solid #333;';
      box.innerHTML = '<strong style="font-size:14px;letter-spacing:0.06em;text-transform:uppercase;">☁ Open cloud project</strong><div id="pj-cloud-list" style="margin-top:12px;max-height:60vh;overflow:auto;"></div><div style="margin-top:12px;text-align:right;"><button id="pj-cloud-cancel" style="background:#222;color:#ddd;border:1px solid #444;border-radius:6px;padding:6px 12px;cursor:pointer;">Cancel</button></div>';
      modal.appendChild(box);
      document.body.appendChild(modal);
      const list = box.querySelector('#pj-cloud-list');
      for (const it of items) {
        const row = document.createElement('div');
        row.style.cssText = 'display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid #222;gap:8px;';
        const date = new Date(it.updatedAt);
        row.innerHTML = '<div><div style="font-weight:600">' + escapeHtml(it.name) + '</div><div style="font-size:10px;color:#888">' + date.toLocaleString() + '</div></div>';
        const btn = document.createElement('button');
        btn.textContent = 'Open';
        btn.style.cssText = 'background:#1c8c64;color:#fff;border:0;border-radius:6px;padding:6px 12px;cursor:pointer;';
        btn.addEventListener('click', async () => {
          modal.remove();
          await loadFromCloud(it.id);
        });
        row.appendChild(btn);
        list.appendChild(row);
      }
      box.querySelector('#pj-cloud-cancel').addEventListener('click', () => modal.remove());
    } catch (e) {
      if (typeof setStatus === 'function') setStatus('cloud list failed: ' + e.message, 'err');
    }
  }

  async function loadFromCloud(id) {
    if (!window.SWR_STORAGE) return;
    setSync('loading');
    try {
      const project = await window.SWR_STORAGE.loadProject(id);
      // Re-hydrate audio from cloud storage if present
      if (project && project.doc && project.doc.audio && project.doc.audio.key) {
        try {
          const file = await window.SWR_STORAGE.downloadAsFile(project.doc.audio.key, project.doc.audio.name);
          // Convert back to dataUrl so apply() can decode it (same path as file load)
          const fr = new FileReader();
          const dataUrl = await new Promise((resolve, reject) => {
            fr.onload = () => resolve(fr.result);
            fr.onerror = reject;
            fr.readAsDataURL(file);
          });
          project.doc.audio = Object.assign({}, project.doc.audio, { dataUrl });
          // Drop the key — it's been consumed
          delete project.doc.audio.key;
        } catch (e) {
          console.warn('[project] audio hydrate failed; loading without audio', e);
          project.doc.audio = null;
        }
      }
      // The stored doc may be {id, name, userId, doc, ...}; pull .doc if present
      const docToApply = project && project.doc ? project.doc : project;
      lastCloudId = docToApply && docToApply.id ? docToApply.id : id;
      apply(docToApply);
      setSync('synced');
    } catch (e) {
      if (typeof setStatus === 'function') setStatus('cloud load failed: ' + (e.body && e.body.error || e.message), 'err');
      setSync('error');
    }
  }

  function setSync(state) {
    const chip = document.getElementById('pj-cloud-status');
    if (!chip) return;
    chip.dataset.state = state;
    const colors = {
      idle: '#888', saving: '#f5a524', loading: '#f5a524',
      synced: '#1c8c64', error: '#d8232a', local: '#888',
    };
    chip.style.color = colors[state] || '#888';
    chip.textContent = state;
  }

  async function syncChip() {
    if (!window.SWR_AUTH) return setSync('local');
    const user = await window.SWR_AUTH.session();
    if (!user) return setSync('local');
    setSync('synced');
  }

  function escapeHtml(s) {
    return String(s || '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', buildUI);
  } else {
    setTimeout(buildUI, 100);
  }

  window.Project = { get, apply, loadFile, download, saveToCloud, loadFromCloud, openCloudPicker, VERSION };
})();