// client/asset-curator.client.js — auto-process uploaded media
//
// When the user drops a PNG/JPEG into the music_video library, this
// module runs a corner-pixel sniff to detect a uniform background
// (white, black, or any single dominant color), chroma-keys it via
// Canvas API, and tags the result with a local heuristic. Optionally
// augments the tag set by calling kaidjuric/association on HF Spaces
// for CLIP zero-shot classification — but only when the HF call
// completes within 3s; otherwise we fall back to local-only tags.
//
// Public API on window.SWR_ASSET_CURATOR:
//
//   .process(file: File) -> Promise<{
//     file: Blob,                       // cleaned file (or original passthrough)
//     folder: string,                    // 'gift-bags' | 'transparent-pngs' | ...
//     tags: [{tag: string, score: number}],
//     status: 'cleaned' | 'passthrough' | 'skipped',
//     tookMs: number,
//     backgroundColor: {r,g,b} | null,   // detected bg color (cleaned only)
//   }>
//
//   .status() -> 'online' | 'offline'   // whether HF tagging is reachable
//
// Reuses the existing `kaidjuric/png-creator` algorithm (Threshold mode
// in pure Pillow) but runs it client-side via Canvas API. This avoids
// the HF Space's cold-start, the BUILD_ERROR state we hit on
// kaidjuric/png-creator, and the gradio_client server dependency.
//
// The HF Space dependency is optional. When it's reachable, the
// tag set is richer. When it's not, the local heuristic still
// produces usable tags for ~12 common asset categories.

(function () {
  'use strict';
  if (window.SWR_ASSET_CURATOR) return;

  // ─── Configuration ────────────────────────────────────────────────
  const HF_ASSOCIATION_SPACE = 'https://kaidjuric-association.hf.space';
  const HF_TIMEOUT_MS = 3000;
  const BG_THRESHOLD_RGB = 30;   // pixels within this RGB distance of the bg become transparent
  const CORNER_SAMPLE_SIZE = 8;  // pixels averaged per corner (8x8 block)

  // ─── Local tag heuristic ──────────────────────────────────────────
  // Match filename + dimensions. Returns {tag, score}[] ordered by score desc.
  const TAG_RULES = [
    { tag: 'gift bag',   folder: 'gift-bags',         score: 0.95, test: (f) => /gift|bag|present|ribbon/i.test(f.name) },
    { tag: 'icon',       folder: 'transparent-pngs',  score: 0.85, test: (f) => f.width === f.height && f.width <= 256 },
    { tag: 'logo',       folder: 'transparent-pngs',  score: 0.85, test: (f) => /logo|brand|mark/i.test(f.name) },
    { tag: 'silhouette', folder: 'transparent-pngs',  score: 0.80, test: (f) => /silhouette|outline|shadow/i.test(f.name) },
    { tag: 'transparent',folder: 'transparent-pngs',  score: 0.70, test: (f) => /transparent|alpha/i.test(f.name) },
    { tag: 'character',  folder: 'characters',        score: 0.65, test: (f) => /char|person|figure|face/i.test(f.name) },
    { tag: 'animal',     folder: 'creatures',         score: 0.65, test: (f) => /cat|dog|bird|animal|pet/i.test(f.name) },
    { tag: 'flower',     folder: 'nature',            score: 0.60, test: (f) => /flower|bloom|petal/i.test(f.name) },
    { tag: 'plant',      folder: 'nature',            score: 0.60, test: (f) => /plant|tree|leaf/i.test(f.name) },
    { tag: 'food',       folder: 'food',              score: 0.60, test: (f) => /food|cookie|cake|fruit/i.test(f.name) },
    { tag: 'object',     folder: 'objects',           score: 0.50, test: (f) => /object|item|tool/i.test(f.name) },
  ];

  function localTags(file, width, height, hasUniformBg) {
    const out = [];
    for (const rule of TAG_RULES) {
      try {
        if (rule.test({ name: file.name || '', width, height })) {
          out.push({ tag: rule.tag, score: rule.score, folder: rule.folder });
        }
      } catch (_) {}
    }
    // If we found a uniform background, lean 'transparent'
    if (hasUniformBg && !out.find(t => t.tag === 'transparent')) {
      out.push({ tag: 'transparent', score: 0.75, folder: 'transparent-pngs' });
    }
    // Sort by score desc
    out.sort((a, b) => b.score - a.score);
    return out;
  }

  function pickFolder(tags) {
    if (!tags || !tags.length) return 'uncategorized';
    return tags[0].folder || 'uncategorized';
  }

  // ─── Background detection ─────────────────────────────────────────
  // Sample 4 corner regions. If their average colors are all within ε of
  // each other, we have a uniform background.
  async function detectBackgroundColor(imageData, w, h) {
    const corners = [
      { x: 0, y: 0 },
      { x: w - CORNER_SAMPLE_SIZE, y: 0 },
      { x: 0, y: h - CORNER_SAMPLE_SIZE },
      { x: w - CORNER_SAMPLE_SIZE, y: h - CORNER_SAMPLE_SIZE },
    ];
    const averages = corners.map((c) => {
      let r = 0, g = 0, b = 0, count = 0;
      for (let y = c.y; y < c.y + CORNER_SAMPLE_SIZE && y < h; y++) {
        for (let x = c.x; x < c.x + CORNER_SAMPLE_SIZE && x < w; x++) {
          const i = (y * w + x) * 4;
          r += imageData.data[i];
          g += imageData.data[i + 1];
          b += imageData.data[i + 2];
          count++;
        }
      }
      return { r: r / count, g: g / count, b: b / count };
    });
    const epsilon = 8;
    const avgR = averages.reduce((s, c) => s + c.r, 0) / 4;
    const avgG = averages.reduce((s, c) => s + c.g, 0) / 4;
    const avgB = averages.reduce((s, c) => s + c.b, 0) / 4;
    const allClose = averages.every(
      (c) =>
        Math.abs(c.r - avgR) < epsilon &&
        Math.abs(c.g - avgG) < epsilon &&
        Math.abs(c.b - avgB) < epsilon
    );
    if (!allClose) return null;
    return { r: Math.round(avgR), g: Math.round(avgG), b: Math.round(avgB) };
  }

  // ─── Canvas chroma key ────────────────────────────────────────────
  // Sets alpha=0 for pixels within BG_THRESHOLD_RGB of the bg color.
  // Modifies imageData in place. Returns true if any alpha was changed.
  function chromaKey(imageData, bg, threshold) {
    const t2 = threshold * threshold;
    const d = imageData.data;
    let changed = 0;
    for (let i = 0; i < d.length; i += 4) {
      const dr = d[i] - bg.r;
      const dg = d[i + 1] - bg.g;
      const db = d[i + 2] - bg.b;
      if (dr * dr + dg * dg + db * db < t2) {
        if (d[i + 3] !== 0) { d[i + 3] = 0; changed++; }
      }
    }
    return changed > 0;
  }

  // ─── Optional HF Space tagging ─────────────────────────────────────
  // Hits kaidjuric/association's /gradio_api/call/tag endpoint with a
  // 3s timeout. Returns [{tag, score}] or null on failure.
  async function tagViaHF(imageBlob) {
    // Batch-runner opt-out (e.g. verify-curator-batch.mjs sets
    // window.__SWR_HF_DISABLED = true to keep runs deterministic + offline).
    if (typeof window !== 'undefined' && window.__SWR_HF_DISABLED) return null;
    if (typeof AbortSignal === 'undefined' || typeof AbortSignal.timeout !== 'function') {
      return null;
    }
    try {
      // Step 1: get the gradio client to compute the upload hash
      const uploadForm = new FormData();
      uploadForm.append('files', imageBlob, 'asset.png');
      const uploadResp = await fetch(HF_ASSOCIATION_SPACE + '/gradio_api/upload', {
        method: 'POST',
        body: uploadForm,
        signal: AbortSignal.timeout(HF_TIMEOUT_MS),
      });
      if (!uploadResp.ok) return null;
      const uploadJson = await uploadResp.json();
      const filePath = uploadJson[0];

      // Step 2: call the tag endpoint
      const tagForm = new FormData();
      tagForm.append('data', JSON.stringify({
        data: [{ path: filePath, meta: { _type: 'gradio.FileData' } }],
        top_k: 5,
      }));
      const tagResp = await fetch(HF_ASSOCIATION_SPACE + '/gradio_api/call/tag', {
        method: 'POST',
        body: tagForm,
        signal: AbortSignal.timeout(HF_TIMEOUT_MS),
      });
      if (!tagResp.ok) return null;
      const eventId = (await tagResp.text()).trim().replace(/^data: /, '');
      if (!eventId) return null;

      // Step 3: poll for the result
      const resultUrl = HF_ASSOCIATION_SPACE + '/gradio_api/result/tag/' + eventId;
      const deadline = Date.now() + HF_TIMEOUT_MS;
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 200));
        const rResp = await fetch(resultUrl);
        if (!rResp.ok) continue;
        const rType = rResp.headers.get('content-type') || '';
        if (rType.includes('json')) {
          const result = await rResp.json();
          // result is { "tag1": score1, "tag2": score2, ... }
          return Object.entries(result).map(([tag, score]) => ({
            tag: String(tag),
            score: Number(score),
          }));
        }
      }
      return null;
    } catch (_) {
      return null;
    }
  }

  // ─── Public API ────────────────────────────────────────────────────
  const FOLDER_MAP = {
    'gift bag':         'gift-bags',
    'gift':             'gift-bags',
    'transparent':      'transparent-pngs',
    'silhouette':       'transparent-pngs',
    'icon':             'transparent-pngs',
    'logo':             'transparent-pngs',
    'character':        'characters',
    'person':           'characters',
    'animal':           'creatures',
    'pet':              'creatures',
    'creature':         'creatures',
    'flower':           'nature',
    'plant':            'nature',
    'tree':             'nature',
    'food':             'food',
    'object':           'objects',
    'tool':             'objects',
  };

  function mergeTags(localList, hfList) {
    const byTag = new Map();
    for (const t of localList || []) byTag.set(t.tag, { ...t });
    for (const t of hfList || []) {
      const existing = byTag.get(t.tag);
      if (existing) {
        existing.score = Math.max(existing.score, t.score);
      } else {
        const folder = FOLDER_MAP[t.tag] || 'uncategorized';
        byTag.set(t.tag, { ...t, folder });
      }
    }
    return Array.from(byTag.values()).sort((a, b) => b.score - a.score);
  }

  async function process(file) {
    const start = performance.now();
    if (!(file instanceof Blob)) {
      return {
        file, folder: 'uncategorized', tags: [], status: 'skipped',
        tookMs: 0, backgroundColor: null,
      };
    }

    // Only PNG/JPEG get processed. GIF/MP4/etc pass through.
    const type = (file.type || '').toLowerCase();
    const isPngOrJpeg = type === 'image/png' || type === 'image/jpeg';
    if (!isPngOrJpeg) {
      return {
        file, folder: 'uncategorized', tags: [],
        status: 'skipped', tookMs: 0, backgroundColor: null,
      };
    }

    // ── Decode the image ──
    const bitmap = await createImageBitmap(file);
    const w = bitmap.width;
    const h = bitmap.height;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(bitmap, 0, 0);
    const imageData = ctx.getImageData(0, 0, w, h);

    // ── Detect + remove uniform background ──
    // The opt-in force mode (set by client/bg-removal-confirm) bypasses
    // the corner-sample check and chroma-keys against the average corner
    // color anyway. Useful when the bg isn't strictly uniform but the
    // user explicitly wants it removed anyway. The threshold stays the
    // same — pixel-accurate only against the sampled color.
    const forceMode = !!window.__SWR_FORCE_BG_REMOVAL;
    let bg = await detectBackgroundColor(imageData, w, h);
    if (!bg && forceMode) {
      // Sample the center of each edge (4 points) for a fallback bg.
      const pts = [
        { x: Math.floor(w / 2), y: 0 },
        { x: Math.floor(w / 2), y: h - 1 },
        { x: 0, y: Math.floor(h / 2) },
        { x: w - 1, y: Math.floor(h / 2) },
      ];
      let r = 0, g = 0, b = 0;
      pts.forEach((p) => {
        const i = (p.y * w + p.x) * 4;
        r += imageData.data[i];
        g += imageData.data[i + 1];
        b += imageData.data[i + 2];
      });
      bg = { r: Math.round(r / 4), g: Math.round(g / 4), b: Math.round(b / 4) };
    }
    let cleaned = false;
    let status = 'passthrough';
    if (bg) {
      cleaned = chromaKey(imageData, bg, BG_THRESHOLD_RGB);
      if (cleaned) status = 'cleaned';
    }

    // ── Render the result (cleaned or original) ──
    if (cleaned) ctx.putImageData(imageData, 0, 0);
    const outBlob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));

    // ── Tags: local heuristic (always) + HF augmentation (best-effort) ──
    const localList = localTags(file, w, h, !!bg);
    let hfList = null;
    try {
      hfList = await tagViaHF(outBlob);
    } catch (_) {}
    const merged = mergeTags(localList, hfList);
    const folder = pickFolder(merged);
    const tookMs = performance.now() - start;

    return {
      file: outBlob || file,
      folder,
      tags: merged,
      status,
      tookMs,
      backgroundColor: bg,
    };
  }

  // HF reachability probe — used by the UI footer status pill.
  let _statusCache = { value: 'unknown', at: 0 };
  async function status() {
    if (Date.now() - _statusCache.at < 30000) return _statusCache.value;
    try {
      const r = await fetch(HF_ASSOCIATION_SPACE + '/gradio_api/info', {
        method: 'GET',
        signal: AbortSignal.timeout(2000),
      });
      _statusCache = { value: r.ok ? 'online' : 'offline', at: Date.now() };
    } catch (_) {
      _statusCache = { value: 'offline', at: Date.now() };
    }
    return _statusCache.value;
  }

  window.SWR_ASSET_CURATOR = {
    process,
    status,
    _internals: { TAG_RULES, FOLDER_MAP, BG_THRESHOLD_RGB },
  };
})();
