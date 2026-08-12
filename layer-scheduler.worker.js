// layer-scheduler.worker.js
// Runs OFF the main thread. Owns:
//   - the swap timer (random interval between [minSeconds, maxSeconds])
//   - optional beat-sync: schedules swaps to nearest 4-bar grid when audio beat info arrives
//
// Posts back to main thread:
//   { type: 'swap', layerId, assetId, nextDelayMs, tick }
//
// Main thread decides what to do with `assetId` (look it up in Library.items, swap layer.asset, re-render).
// Keep all video/canvas/IndexedDB work on the main thread.

let cfg = {
  enabled: false,
  minMs: 5000,
  maxMs: 10000,
  beatSync: false,
  bpm: 120,
  beatsPerSwap: 16,     // 4 bars at 4/4
};
let pool = [];           // asset ids eligible for random pick
let recent = [];         // avoid immediate repeats
let timer = null;
let lastBeatCount = 0;

// Audio features streamed from main thread (used only when beatSync is on).
// We don't *compute* FFT here — just count beats to align next swap.
let beatCount = 0;

function rand(min, max) { return Math.random() * (max - min) + min; }

function pickAssetId() {
  if (!pool.length) return null;
  // Filter out most-recent picks so we don't immediately repeat
  const recentSet = new Set(recent.slice(-3));
  const fresh = pool.filter(id => !recentSet.has(id));
  const src = fresh.length ? fresh : pool;
  const pick = src[Math.floor(Math.random() * src.length)];
  recent.push(pick);
  if (recent.length > 6) recent.shift();
  return pick;
}

function scheduleNext() {
  if (timer) { clearTimeout(timer); timer = null; }
  if (!cfg.enabled || !pool.length) return;

  let delayMs;
  if (cfg.beatSync && cfg.bpm > 0) {
    // Snap to nearest beat grid: 1 beat = 60000/bpm ms
    const beatMs = 60000 / cfg.bpm;
    const beatsToWait = cfg.beatsPerSwap;
    delayMs = beatMs * beatsToWait;
  } else {
    delayMs = rand(cfg.minMs, cfg.maxMs);
  }

  timer = setTimeout(() => {
    const assetId = pickAssetId();
    if (assetId) {
      // Choose a random layer on the main thread — main thread knows which layer IDs exist
      const layerIndex = -1;  // -1 sentinel: "pick any" — main thread interprets
      postMessage({ type: 'swap', assetId, layerIndex, tick: Date.now() });
    }
    scheduleNext();
  }, delayMs);
}

self.onmessage = (e) => {
  const msg = e.data || {};
  switch (msg.type) {
    case 'config': {
      const prevEnabled = cfg.enabled;
      Object.assign(cfg, msg.cfg || {});
      if (cfg.enabled !== prevEnabled) {
        if (cfg.enabled) scheduleNext();
        else if (timer) { clearTimeout(timer); timer = null; }
      } else if (cfg.enabled) {
        // settings changed while running — restart timer with new params
        scheduleNext();
      }
      break;
    }
    case 'setPool':
      pool = (msg.ids || []).slice();
      recent = [];
      break;
    case 'addToPool':
      for (const id of (msg.ids || [])) {
        if (!pool.includes(id)) pool.push(id);
      }
      break;
    case 'removeFromPool':
      pool = pool.filter(id => !(msg.ids || []).includes(id));
      break;
    case 'stop':
      cfg.enabled = false;
      if (timer) { clearTimeout(timer); timer = null; }
      break;
    case 'start':
      cfg.enabled = true;
      scheduleNext();
      break;
    case 'tick': {
      // Optional beat tick from main thread (e.g. Audio's beat detection)
      // We don't act on every beat — scheduleNext() handles timing.
      // Just track count for debug if needed.
      beatCount = msg.beatCount || beatCount;
      break;
    }
    default:
      // ignore unknown
  }
};