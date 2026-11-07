// Deterministic arrangement planner. Pure module: no browser APIs or audio effects.
// Input loops: [{ id, duration, energy?, tags? }]. Output is a non-destructive edit decision list.
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
function rng(seed) {
  let s = (Number(seed) >>> 0) || 1;
  return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return (s >>> 0) / 4294967296; };
}
export function planRemix(loops, options = {}) {
  if (!Array.isArray(loops) || !loops.length) throw new TypeError('At least one loop is required');
  const normalized = loops.map((loop, i) => {
    if (!loop || !Number.isFinite(loop.duration) || loop.duration <= 0)
      throw new RangeError('Loop duration must be a positive finite number');
    return { id: String(loop.id ?? i), duration: loop.duration, energy: clamp(Number.isFinite(loop.energy) ? loop.energy : 0.5, 0, 1) };
  });
  const targetDuration = options.targetDuration ?? 180;
  if (!Number.isFinite(targetDuration) || targetDuration <= 0 || targetDuration > 3600)
    throw new RangeError('targetDuration must be in (0, 3600]');
  const creativity = clamp(Number.isFinite(options.creativity) ? options.creativity : 0.65, 0, 1);
  const candidates = options.candidates ?? 4;
  if (!Number.isInteger(candidates) || candidates < 1 || candidates > 16)
    throw new RangeError('candidates must be an integer from 1 to 16');
  const seed = options.seed ?? 43172;
  const bpm = options.bpm ?? null;
  if (bpm !== null && (!Number.isFinite(bpm) || bpm <= 0))
    throw new RangeError('bpm must be positive when provided');
  const beat = bpm ? 60 / bpm : null;
  return Array.from({ length: candidates }, (_, candidate) => {
    const random = rng((Number(seed) + candidate * 2654435761) >>> 0);
    const events = [];
    let t = 0, previous = -1;
    while (t < targetDuration - 1e-8) {
      const progress = t / targetDuration;
      // Low-high-low energy contour; creativity controls departures from it.
      const desired = 0.25 + 0.65 * Math.sin(Math.PI * progress);
      const ranked = normalized.map((loop, i) => ({
        i, score: Math.abs(loop.energy - desired) + (i === previous && normalized.length > 1 ? 0.4 : 0) + random() * creativity * 1.2,
      })).sort((a, b) => a.score - b.score);
      const chosen = ranked[0].i;
      const loop = normalized[chosen];
      const remaining = targetDuration - t;
      let duration = Math.min(loop.duration, remaining);
      // Optional beat-aware cuts: never produce zero-length events.
      if (beat && duration < remaining && duration >= beat) {
        const aligned = Math.floor((duration + 1e-9) / beat) * beat;
        if (aligned > 0) duration = aligned;
      }
      duration = Math.min(duration, remaining);
      if (duration <= 0) throw new Error('Planner could not advance');
      events.push({
        sourceId: loop.id,
        start: Number(t.toFixed(9)),
        duration: Number(duration.toFixed(9)),
        sourceStart: 0,
        energy: loop.energy,
      });
      t += duration;
      previous = chosen;
      if (events.length > 100000) throw new RangeError('Too many events; use longer source loops');
    }
    // Remove accumulated floating point drift from final event.
    const last = events[events.length - 1];
    last.duration = Number((targetDuration - last.start).toFixed(9));
    return { candidate, seed: (Number(seed) + candidate * 2654435761) >>> 0, duration: targetDuration, bpm, events };
  });
}
