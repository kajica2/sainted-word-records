// lib/auto-pick.client.js — "pick a style for my song" hand-off.
//
// Given the song already loaded on the page, analyse it, ask the variant
// picker which engine variant fits, and hand the user off to that variant
// with the song preserved.
//
// Design constraints, all deliberate:
//
// 1. REUSE, DON'T INVENT. Two mechanisms already existed and both are used
//    as-is rather than reimplemented:
//      - lib/variant-picker.mjs decides the variant. It is imported at call
//        time, not at module scope, so this module still loads on a page
//        where the import would fail and the feature degrades to a clear
//        message instead of throwing during script evaluation.
//      - versions/last-song.js writes the song to the shared IndexedDB
//        ('sainted-word-records'/'songs'/'current'), and every variant page
//        already auto-restores from it. So the hand-off is "save, then
//        navigate" — no new transport, no query-string payload that would
//        break on a reload.
//
// 2. NO CLIP OR TIMELINE INVENTIONS. This does not arrange anything. It
//    answers "which variant suits this track" and gets the user there.
//
// 3. NEVER SILENTLY DO NOTHING. Every failure path reports a specific,
//    actionable reason through onStatus, because a button that appears to
//    work and does not is worse than one that explains why it can't.

(function () {
  'use strict';
  if (window.SWR_AUTO_PICK) return;

  // Where the engine variants live. Kept as one constant so a future move
  // only has to change this line.
  const VARIANT_BASE = '/versions/';

  const PICKER_URL = '/lib/variant-picker.mjs';

  function _status(msg, kind) {
    if (typeof window.SWR_AUTO_PICK_STATUS === 'function') {
      try { window.SWR_AUTO_PICK_STATUS(msg, kind); return; } catch (_) { /* fall through */ }
    }
    // Fallback so the module is usable without a host-provided reporter.
    if (kind === 'err') console.error('[auto-pick]', msg);
    else console.log('[auto-pick]', msg);
  }

  // The song lives on an HTMLAudioElement whose src is a blob: URL, so the
  // bytes are recoverable without threading the original File through the
  // whole page. Returns a File so downstream consumers see what they expect.
  //
  // The NAME is not on the element: mvm-audio-bus keeps no filename, and
  // music-video-maker.client.js holds it in its own closure (state.song.title).
  // Reading the rendered label is the least invasive way to avoid persisting
  // every song as "song" — and it is what the user sees, so it is what they
  // will recognise in the restore list.
  function _displayedSongName() {
    const el = document.getElementById('current-song');
    if (!el) return null;
    // The maker renders "🎵 <title>" / "— no song —"; strip decoration.
    const text = String(el.textContent || '').replace(/^\s*🎵\s*/, '').trim();
    if (!text || text === '— no song —') return null;
    return text;
  }

  async function currentSongFile() {
    const audio = window.SWR && window.SWR.Audio;
    const el = audio && audio.el;
    const src = el && el.src;
    if (!src) return null;
    const name = _displayedSongName() || ('song-' + Date.now());
    if (!/^blob:/i.test(src)) {
      // A bundled/remote default rather than a user file: still analysable,
      // but there is nothing to persist for the hand-off.
      const res = await fetch(src);
      const blob = await res.blob();
      return { file: new File([blob], name, { type: blob.type || 'audio/mpeg' }), persistable: false };
    }
    const res = await fetch(src);
    const blob = await res.blob();
    return { file: new File([blob], name, { type: blob.type || 'audio/mpeg' }), persistable: true };
  }

  async function analyze(file) {
    const A = window.AudioAnalysisV2;
    if (!A || typeof A.analyzeBuffer !== 'function') {
      throw new Error('analyzer not loaded on this page (audio-analysis-v2.js)');
    }
    if (typeof window.AudioContext !== 'function' && typeof window.webkitAudioContext !== 'function') {
      throw new Error('Web Audio unavailable in this browser');
    }
    const Ctx = window.AudioContext || window.webkitAudioContext;
    const ctx = new Ctx();
    try {
      const buf = await file.arrayBuffer();
      const audioBuffer = await ctx.decodeAudioData(buf);
      // analyzeBuffer takes an AudioBuffer and returns
      // { bpm, key, scale, confidence, chromagram, onsets, duration, ... }
      return A.analyzeBuffer(audioBuffer);
    } finally {
      // Release the context immediately — decoding a whole song is the only
      // reason we made one, and browsers cap concurrent AudioContexts.
      try { ctx.close(); } catch (_) {}
    }
  }

  async function pickForCurrentSong() {
    const found = await currentSongFile();
    if (!found) throw new Error('no song loaded — pick a song first');
    _status('analysing…', 'info');
    const analysis = await analyze(found.file);

    const picker = await import(PICKER_URL);
    if (typeof picker.pick !== 'function') throw new Error('variant picker has no pick() export');
    const result = picker.pick(analysis);
    return { result, analysis, file: found.file, persistable: found.persistable };
  }

  // Analyse, then hand off. `opts.dryRun` returns the decision without
  // navigating, which is what the browser test uses.
  async function handOff(opts) {
    opts = opts || {};
    try {
      const { result, analysis, file, persistable } = await pickForCurrentSong();

      // Persist BEFORE navigating: the variant page reads this on boot, so
      // navigating first would race the write and auto-start the wrong song.
      if (persistable && typeof window.SWR_LAST_SONG_SAVE === 'function') {
        try { await window.SWR_LAST_SONG_SAVE(file); }
        catch (e) { console.warn('[auto-pick] could not persist song for hand-off', e); }
      }

      const bpm = Math.round(analysis.bpm || 0);
      // The picker returns `rationale` as a human-readable STRING (e.g.
      // "neon wins (score 1.80) via: bpm_hi, chroma_synth"), not a structured
      // object. An earlier version of this module assumed `.matched` and so
      // always reported "fallback" while silently dropping the feature list.
      const rationale = result && typeof result.rationale === 'string' ? result.rationale : '';
      _status(
        'picked ' + result.variant + (bpm ? ' · ' + bpm + ' BPM' : '') +
        (rationale ? ' · ' + rationale : ''),
        'ok',
      );

      const target = VARIANT_BASE + result.variant;
      if (opts.dryRun) return { result, analysis, target, navigated: false };
      window.location.href = target;
      return { result, analysis, target, navigated: true };
    } catch (e) {
      _status(String((e && e.message) || e), 'err');
      if (opts.dryRun) throw e;
      return null;
    }
  }

  window.SWR_AUTO_PICK = {
    handOff,
    pickForCurrentSong,
    currentSongFile,
    analyze,
    VARIANT_BASE,
  };
})();
