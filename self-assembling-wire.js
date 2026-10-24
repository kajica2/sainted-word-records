// self-assembling-wire.js
// Wires SWRSelfAssemblingDirector into the Sainted Word Records engine.
// Hooks __swrOnSongLoaded, decodes the song, runs the director,
// and applies the best persona + intensity per section via window.Personas.apply
// and window.FX.setMut.

(function () {
  if (window.SWR_SELF_ASSEMBLING_WIRED) return;
  window.SWR_SELF_ASSEMBLING_WIRED = true;

  const STATE = {
    enabled: true,
    plan: null,
    director: null,
    lastApplied: null,
    analyzing: false,
  };

  function setStatus(msg, cls) {
    if (typeof window.setStatus === 'function') window.setStatus(msg, cls || 'ok');
    else console.log('[self-assembling]', msg);
  }

  function getAudio() {
    return window.Audio || (window.SWR && window.SWR.Audio) || null;
  }

  async function analyzeAndAssemble(fileOrBuffer) {
    if (!STATE.enabled || STATE.analyzing) return;
    STATE.analyzing = true;
    try {
      setStatus('self-assembling · studying song…', 'busy');
      const audio = getAudio();
      if (!audio) { setStatus('self-assembling · no Audio', 'err'); return; }

      let buf = null;
      if (fileOrBuffer && fileOrBuffer.sampleRate) {
        buf = fileOrBuffer;
      } else {
        const el = audio.clockElement ? audio.clockElement() : audio.audioEl;
        if (!el || !el.src) { setStatus('self-assembling · no media', 'err'); return; }
        if (!audio.ctx && audio.unlock) audio.unlock();
        const resp = await fetch(el.src);
        const arr = await resp.arrayBuffer();
        buf = await audio.ctx.decodeAudioData(arr);
      }

      if (!window.SWRSelfAssemblingDirector) {
        setStatus('self-assembling · director not loaded', 'err');
        return;
      }
      if (!STATE.director) STATE.director = new window.SWRSelfAssemblingDirector();

      const plan = await STATE.director.assemble(buf);
      STATE.plan = plan;
      STATE.lastApplied = null;

      const summary = (plan.sections || []).map(s => `${s.label}@${s.start.toFixed(0)}s`).slice(0, 6).join(' · ');
      setStatus(`self-assembling · ${plan.sections.length} sections · ${plan.bpm || '—'} bpm · ${summary}`, 'ok');
      console.log('[self-assembling] plan', plan);

      window.SWR_SELF_ASSEMBLING = {
        plan,
        director: STATE.director,
        disable() { STATE.enabled = false; setStatus('self-assembling off', 'ok'); },
        enable() { STATE.enabled = true; setStatus('self-assembling on', 'ok'); },
        getActive() {
          const a = getAudio();
          if (!a || !STATE.plan) return null;
          return STATE.director.getActive(STATE.plan, a.clock || 0);
        },
      };
    } catch (err) {
      console.warn('[self-assembling] analysis failed', err);
      setStatus('self-assembling · failed', 'err');
    } finally {
      STATE.analyzing = false;
    }
  }

  const prevHook = window.__swrOnSongLoaded;
  window.__swrOnSongLoaded = function (file, audio) {
    if (typeof prevHook === 'function') { try { prevHook(file, audio); } catch (_) {} }
    setTimeout(() => analyzeAndAssemble(), 400);
  };

  function tryBootHook() {
    const audio = getAudio();
    if (audio && audio.audioEl && audio.audioEl.src) setTimeout(() => analyzeAndAssemble(), 800);
  }

  function tick() {
    if (!STATE.enabled || !STATE.plan || !STATE.director) return;
    const audio = getAudio();
    if (!audio || !audio.playing) return;
    const t = audio.clock || 0;
    const active = STATE.director.getActive(STATE.plan, t);
    if (!active) return;
    if (STATE.lastApplied && STATE.lastApplied.start === active.start && STATE.lastApplied.persona === active.persona) return;
    STATE.lastApplied = active;

    if (window.Personas && typeof window.Personas.apply === 'function') {
      try { window.Personas.apply(active.persona); } catch (_) {}
    } else if (window.FX && typeof window.FX.setPersona === 'function') {
      try { window.FX.setPersona({ mut: active.intensity }); } catch (_) {}
    }
    if (window.FX && typeof window.FX.setMut === 'function') {
      try { window.FX.setMut(active.intensity); } catch (_) {}
    }
    setStatus(`${active.label} · ${active.persona} · ${(active.intensity * 100).toFixed(0)}%`, 'ok');
  }

  function startTick() {
    function loop() { tick(); requestAnimationFrame(loop); }
    requestAnimationFrame(loop);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => { tryBootHook(); startTick(); });
  } else {
    tryBootHook();
    startTick();
  }

  console.log('[self-assembling] wire loaded');
})();
