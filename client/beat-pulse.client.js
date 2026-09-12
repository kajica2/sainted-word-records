// client/beat-pulse.client.js — micro-evolution driver.
//
// Listens to A.feat.beat (already exposed by the audio layer as a 0..1
// "beat energy" gauge) and fires a one-beat envelope on every rising
// edge (prev < 0.5, now ≥ 0.5). Subscribers can react via
// CustomEvent('swr-beat-pulse', { detail: { beatNumber, strength } }) to
// nudge FX, color, motion. A follow-up CustomEvent('pulse-decay') fires
// on the next animation frame so subscribers can ease back toward rest.
//
// Public API on window.SWR_BEAT_PULSE:
//   .init()       — start watching A.feat.beat (idempotent)
//   .on(ev, fn)   — register handler ('pulse' | 'decay' | '*')
//   .lastPulse    — { beatNumber, strength, tMs } | null
//   .isActive     — true once init() has wired the watcher
//   .stop()       — tear down the watcher (for tests)
//
// Events (window.dispatchEvent):
//   swr-beat-pulse { detail: { beatNumber, strength } }
//   pulse-decay    { detail: { beatNumber } }
//
// No new deps. Vanilla ES module, single quotes, 2-space, no semicolons.

(function () {
  'use strict';
  if (window.SWR_BEAT_PULSE) return;

  const RISE = 0.5;
  let prev = 0, beatNumber = 0, decayFrame = -1, handle = null;
  const handlers = { pulse: [], decay: [] };
  let lastPulse = null, active = false;

  // The synthetic mutator in unit tests sets window.__swrBeatPulseFeat;
  // otherwise we read from window.A / window.SWR.Audio.
  function readFeat() {
    if (window.__swrBeatPulseFeat) return window.__swrBeatPulseFeat;
    const A = window.A || (window.SWR && window.SWR.Audio);
    return (A && A.feat) || {};
  }

  function tick() {
    const f = readFeat();
    const now = f.beat != null ? f.beat : 0;
    if (prev < RISE && now >= RISE) {
      const strength = (f.bass || 0) + (f.onset || 0);
      beatNumber += 1;
      const detail = { beatNumber, strength };
      lastPulse = { ...detail, tMs: Date.now() };
      window.dispatchEvent(new CustomEvent('swr-beat-pulse', { detail }));
      handlers.pulse.forEach(h => { try { h(detail); } catch (_) {} });
      // Schedule decay at the start of the NEXT beat frame. rAF keeps it
      // synced with the page's render cadence (typically 60fps).
      if (decayFrame < 0) {
        decayFrame = requestAnimationFrame(() => {
          decayFrame = -1;
          const d = { beatNumber };
          window.dispatchEvent(new CustomEvent('pulse-decay', { detail: d }));
          handlers.decay.forEach(h => { try { h(d); } catch (_) {} });
        });
      }
    }
    prev = now;
  }

  function on(event, fn) {
    if (typeof fn !== 'function') return false;
    if (event === 'pulse' || event === '*') { handlers.pulse.push(fn); return true; }
    if (event === 'decay')                   { handlers.decay.push(fn); return true; }
    return false;
  }

  function init() {
    if (active) return;
    active = true;
    handle = setInterval(tick, 16);
  }

  function stop() {
    if (handle != null) { try { clearInterval(handle); } catch (_) {} handle = null; }
    if (decayFrame >= 0) { try { cancelAnimationFrame(decayFrame); } catch (_) {} decayFrame = -1; }
    active = false;
  }

  window.SWR_BEAT_PULSE = {
    init,
    on,
    stop,
    get lastPulse() { return lastPulse; },
    get isActive() { return active; },
  };
})();
