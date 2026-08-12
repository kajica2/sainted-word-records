// project.js — serialize and restore the editor state (Project save/load).
//
// Project shape:
//   {
//     version: 1,
//     savedAt: <iso>,
//     library: [ { id, name, type, motion, luma, hue, w, h, duration } ],   // metadata only
//     layers:  [ { id, assetId, blend, opacity, baseScale, hue, brightness, contrast, reactors, pos, z } ],
//     fx:      { temperature, mutations, mutAlgo, posterize, vignette, chroma, grain, sepia, glow },
//     preset:  'pulse' | 'drift' | ... | null,
//     persona: 'raw' | 'poster' | ... | 'off',
//     scheduler: { enabled, minSeconds, maxSeconds, beatSync },
//     panels:  { library: { rotated }, layers: { rotated } },
//     palette: 'neon' | 'solar' | ...,
//   }
//
// Library assets (videos/images) are NOT included in the project — they have
// to be present on disk at load time, referenced by name. (Bigger blobs would
// be base64-encoded and bloat the file 50-100x; out of scope for this item.)
// The save dialog warns the user about this on download.

(function () {
  if (window.Project) return;  // idempotent

  const VERSION = 1;

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
    };
  }

  function download() {
    const project = get();
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
      setStatus(`saved project (${project.layers.length} layers, ${project.library.length} assets)`, 'ok');
    }
    return project;
  }

  // Apply a project snapshot to the running app.
  // Restores: FX uniforms, sliders, persona, preset, palette, scheduler config, panel rotation.
  // Library: names of missing assets are reported via setStatus; layers that reference them
  //   keep their .asset reference but the asset may not resolve at draw time (UI will show empty).
  // Audio: songName is informational; actual song playback is not auto-restored.
  function apply(project) {
    if (!project || project.version !== VERSION) {
      if (typeof setStatus === 'function') {
        setStatus(`project version mismatch (got ${project && project.version}, want ${VERSION})`, 'err');
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
      setStatus(msg, missing > 0 ? 'warn' : 'ok');
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
      'min-width:180px'
    ].join(';');
    panel.innerHTML = `
      <div style="display:flex;align-items:center;gap:6px;margin-bottom:6px;">
        <strong style="font-size:11px;letter-spacing:0.04em;">📁 PROJECT</strong>
        <button id="pj-hide" title="Hide panel" style="margin-left:auto;background:transparent;border:0;color:#888;cursor:pointer;font-size:14px;line-height:1;">×</button>
      </div>
      <button id="pj-save"   style="width:100%;padding:6px;background:#222;color:#ddd;border:1px solid #444;border-radius:6px;cursor:pointer;margin-bottom:4px;">⬇  Save</button>
      <button id="pj-load"   style="width:100%;padding:6px;background:#222;color:#ddd;border:1px solid #444;border-radius:6px;cursor:pointer;">⬆  Load</button>
      <input id="pj-file"    type="file" accept="application/json,.json" style="display:none;">
      <div style="margin-top:6px;font-size:10px;color:#888;">Saves JSON. Assets not bundled — re-import on load.</div>
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
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', buildUI);
  } else {
    setTimeout(buildUI, 100);
  }

  window.Project = { get, apply, loadFile, download, VERSION };
})();