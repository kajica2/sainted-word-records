#!/usr/bin/env node
// scripts/generate-media-pack.mjs — media-pack generator.
//
// Two modes:
//
// A. Packs path (default): for each chosen pack id (from packs/manifest.json):
//   1. render ONE audio-reactive MP4 (scripts/render-full-song.mjs) with the
//      pack's clips as the library, at --fps/--width/--height;
//   2. build a schema-v2 .swr-set.json that auto-starts audio + video
//      (embedded WAV + embedded pack clips, film-ish FX);
//   3. emit ERC-721/1155-style nft-metadata.json + a cover.webp (first frame
//      of the rendered MP4 via ffmpeg);
//   4. emit the pack's remaining spec artifacts (packs/covers/pack-spec.md):
//      cover-anim.html (HyperFrames cover copy with baked params),
//      preview.mp3 (15s ffmpeg trim), LICENSE.txt (repo MIT + media line);
//   5. zip the pack into out/media-pack-<id>.zip;
//   6. write out/media-pack/manifest.json summarizing every pack.
//
// B. Clips path (--clips-dir): "upload a webm with audio as a 15-30s clip" —
//   a folder of user-supplied WebM/MP4 shots is normalized into ≤--clip-max
//   (default 15s) WebM clips (VP9 + Opus, audio intact) and those clips
//   become a single pack's video layers + zip payload:
//   1. discover *.webm / *.mp4 in --clips-dir (deterministic sort), and
//      normalize each: longer than --clip-max is auto-cropped, shorter clips
//      pass through untouched (no -t), failed encodes are skipped with a
//      warning and never abort the batch;
//   2. build a schema-v2 .swr-set.json embedding the NORMALIZED clips
//      (mimeType video/webm);
//   3. emit nft-metadata.json (clip_source: webm-upload, clip_max_sec) +
//      cover.webp (first frame of the FIRST normalized clip when the full-
//      song MP4 was not rendered);
//   4. emit cover-anim.html / preview.mp3 / LICENSE.txt exactly like the
//      packs path;
//   5. zip everything — clips stay FLAT at the zip root (zip -j) and each
//      clip's zip entry name is identical to its .swr-set asset name, so
//      marketplace.html's importSetWithMedia sidecar hydration (name match)
//      restores the Files without decoding the embedded dataUrls.
//
// Usage:
//   node scripts/generate-media-pack.mjs \
//     --audio <input.wav> \
//     (--packs skaters,cinematic-reel | --clips-dir ./shots) \
//     --output out/media-pack \
//     [--variant film] [--fps 12] [--width 640] [--height 360] [--skip-render]
//     [--pack-id custom-webm] [--clip-max 15] [--webm-only]
//
// Requirements:
//   - ffmpeg/ffprobe on PATH (cover extraction + song duration + clip probe)
//   - `zip` CLI on PATH (pack bundling)
//   - a running dev server on http://localhost:5174 (render step only —
//     --webm-only needs none)
//
// Exit code is 0 only when every pack rendered + zipped successfully; a
// failed pack is reported and skipped so the other packs still complete.

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { listKnownVariants } from './variant-picker-variants.mjs';

const ROOT = path.resolve(process.cwd());
const DEV_SERVER = { host: '127.0.0.1', port: 5174 };
const DEFAULT_CLIP_MAX_SEC = 15;

// Per-pack artifacts beyond the swr-set / mp4 / cover: the HyperFrames cover
// animation (copied + parameterized into cover-anim.html), a 15s preview.mp3,
// and LICENSE.txt. Spec: packs/covers/pack-spec.md.
const COVER_ANIM_SRC = path.join(ROOT, 'packs', 'covers', 'hyperframe-cover.html');

// === main =================================================================
// Guarded with the render-full-song.mjs convention so scripts/check-
// webm-clips-unit.mjs can import the pure helpers (parse/validate/normalize)
// without executing the CLI.
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  await runMain();
}

async function runMain() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printUsage();
    process.exit(0);
  }
  const argError = validateArgs(args);
  if (argError) {
    printUsage();
    console.error(`error: ${argError}`);
    process.exit(2);
  }
  const clipMax = resolveClipMax(args);
  const clipMode = !!args.clipsDir;
  const variant = args.variant || 'film';
  const fps = args.fps || 12;
  const width = args.width || 640;
  const height = args.height || 360;
  const skipRender = !!args.skipRender;
  const webmOnly = !!args.webmOnly;
  const outDir = path.resolve(args.output || 'out/media-pack');
  const wavPath = path.resolve(args.audio);

  if (!fs.existsSync(wavPath)) {
    console.error(`audio file not found: ${wavPath}`);
    process.exit(2);
  }

  // engine must be a real versions/ variant page
  const knownVariants = listKnownVariants().map(v => v.name);
  if (!knownVariants.includes(variant)) {
    console.error(`variant '${variant}' is not a known versions/ page`);
    console.error(`known variants: ${knownVariants.join(', ')}`);
    process.exit(2);
  }

  const packs = clipMode ? synthesizeClipsPack(args) : resolvePacks(args.packs);
  fs.mkdirSync(outDir, { recursive: true });

  const songSeconds = parseFloat(
    requireExec('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', wavPath])
  );
  console.log(`media-pack: ${clipMode ? `clips-dir pack (${packs[0].id})` : `${packs.length} pack(s)`}, variant=${variant}, ${fps}fps ${width}x${height}, song=${songSeconds.toFixed(2)}s, output=${outDir}`);

  // === Step 1: dev server check (render step only) =========================
  // --webm-only (clips mode) never renders, so it needs no dev server.
  if (!skipRender && !webmOnly) {
    const up = await checkDevServer(variant);
    if (!up) {
      console.error(`dev server not reachable at http://${DEV_SERVER.host}:${DEV_SERVER.port} — start it (npm run dev) before rendering, or pass --skip-render.`);
      process.exit(2);
    }
    console.log(`dev server OK: http://${DEV_SERVER.host}:${DEV_SERVER.port}`);
  }

  // === Per-pack pipeline ====================================================
  const wavName = path.basename(wavPath);
  const wavSize = fs.statSync(wavPath).size;
  const results = [];

  for (const pack of packs) {
    const isClipPack = !!pack.clipMode;
    const title = packTitle(pack.id);
    const packDir = path.join(outDir, pack.id);
    fs.mkdirSync(packDir, { recursive: true });
    const stats = {
      id: pack.id,
      title,
      clips: pack.clips.length,
      render: null,
      setFile: null,
      zipFile: null,
      zipSize: 0,
      error: null,
    };

    // --- a0. (clips mode) normalize every source clip → webm -----------------
    // Produces pack.normalized = [{ src, path, name, mimeType, inDur, outDur,
    // outBytes, trimmed }]; the set layers, the cover (webm-only) and the zip
    // all consume these. Longer-than-max clips are auto-cropped with -t; a
    // clip already shorter than max passes through untouched (no -t); a clip
    // that fails ffmpeg is warned + skipped, never fatal to the batch.
    let clipCount = pack.clips.length;
    if (isClipPack) {
      const clipDir = path.join(packDir, 'clips');
      fs.mkdirSync(clipDir, { recursive: true });
      const norm = normalizeClips({ clips: pack.clips, destDir: clipDir, maxSec: pack.clipMax });
      pack.normalized = norm.normalized;
      stats.clips = norm.normalized.length;
      if (!norm.normalized.length) {
        stats.error = 'all clips failed to normalize';
        console.error(`  [${pack.id}] ALL CLIPS FAILED — skipping pack, continuing`);
        results.push(stats);
        continue;
      }
      clipCount = norm.normalized.length;
      if (norm.skipped.length) {
        stats.skippedClips = norm.skipped.map(s => path.basename(s.src));
        console.warn(`  [${pack.id}] skipped ${norm.skipped.length} clip(s): ${stats.skippedClips.join(', ')}`);
      }
      console.log(`  [${pack.id}] normalized ${clipCount} webm clip(s) (max ${pack.clipMax}s)`);
    }

    // --- a. render one video per pack -------------------------------------
    // Clips mode + --webm-only skips the MP4 entirely; clips mode without it
    // still attempts a render (the normalized webm files work as library
    // assets), but a render failure there is NOT pack-fatal — the clips/set/
    // zip are the deliverable.
    const mp4Path = path.join(packDir, `${pack.id}.mp4`);
    const hasMp4 = fs.existsSync(mp4Path) && fs.statSync(mp4Path).size > 100 * 1024;
    if (skipRender || webmOnly) {
      if (isClipPack && webmOnly) console.log(`  [${pack.id}] webm-only — no full-song MP4 render`);
      else if (!hasMp4) console.warn(`  [${pack.id}] --skip-render but no ${pack.id}.mp4 found; continuing without it`);
      else console.log(`  [${pack.id}] skip render (reusing ${mp4Path})`);
    } else if (hasMp4) {
      console.log(`  [${pack.id}] mp4 already exists — reusing (remove to re-render)`);
    } else {
      console.log(`  [${pack.id}] rendering ${clipCount}-clip video (${Math.ceil(songSeconds * fps)} frames @ ${fps}fps)…`);
      const renderStart = Date.now();
      const renderClips = isClipPack ? pack.normalized.map(n => n.path) : pack.clips;
      const ok = renderPack({ wavPath, mp4Path, variant, fps, width, height, clips: renderClips });
      const wall = ((Date.now() - renderStart) / 1000).toFixed(0);
      if (!ok) {
        if (isClipPack) {
          console.warn(`  [${pack.id}] RENDER FAILED (${wall}s wall) — continuing without an MP4`);
        } else {
          stats.error = `render failed after ${wall}s`;
          console.error(`  [${pack.id}] RENDER FAILED (${wall}s wall) — skipping pack, continuing`);
          results.push(stats);
          continue;
        }
      } else {
        stats.render = { wallSeconds: Number(wall), mp4Bytes: fs.statSync(mp4Path).size };
        console.log(`  [${pack.id}] rendered ${(fs.statSync(mp4Path).size / 1024 / 1024).toFixed(1)}MB MP4 in ${wall}s`);
      }
    }

    const mp4Present = fs.existsSync(mp4Path);
    stats.mp4 = mp4Present ? path.relative(ROOT, mp4Path) : null;

    // --- b. .swr-set.json (schema v2, auto-start audio + video layers) -----
    const setDoc = buildSet({ pack, title, wavPath, wavName, wavSize, variant, clipMode: isClipPack });
    const setPath = path.join(packDir, `${pack.id}.swr-set.json`);
    fs.writeFileSync(setPath, JSON.stringify(setDoc, null, 2));
    stats.setId = setDoc.id;
    stats.setFile = path.relative(ROOT, setPath);
    console.log(`  [${pack.id}] wrote ${pack.id}.swr-set.json (${(fs.statSync(setPath).size / 1024 / 1024).toFixed(1)}MB, ${clipCount} video layers)`);

    // --- c. cover.webp from the rendered MP4's first frame ----------------
    // This ffmpeg build lacks a webp encoder, so extract a PNG first frame,
    // then transcode with cwebp when present; fall back to shipping the PNG
    // (nft.image then points at cover.png). In webm-only clips mode there is
    // no MP4 — the cover comes from the FIRST normalized clip instead.
    const coverPngPath = path.join(packDir, 'cover.png');
    let coverName = null;
    const coverSource = mp4Present
      ? mp4Path
      : (isClipPack && pack.normalized.length ? pack.normalized[0].path : null);
    if (coverSource) {
      const fr = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', coverSource, '-frames:v', '1', coverPngPath], { stdio: ['ignore', 'ignore', 'pipe'] });
      if (fr.status === 0 && fs.existsSync(coverPngPath) && fs.statSync(coverPngPath).size > 0) {
        const webpPath = path.join(packDir, 'cover.webp');
        const cw = spawnSync('cwebp', ['-quiet', coverPngPath, '-o', webpPath], { stdio: ['ignore', 'ignore', 'pipe'] });
        if (cw.status === 0 && fs.existsSync(webpPath) && fs.statSync(webpPath).size > 0) {
          coverName = 'cover.webp';
        } else {
          // No cwebp here — ship the PNG as the cover instead.
          coverName = 'cover.png';
          console.warn(`  [${pack.id}] cwebp unavailable — shipping cover.png as the cover`);
        }
      } else {
        console.warn(`  [${pack.id}] cover extraction failed (${(fr.stderr || '').toString().split('\n').slice(-1)[0] || 'ffmpeg error'})`);
      }
    }
    const hasCover = !!coverName;
    if (hasCover) stats.coverName = coverName;

    // --- c2. cover-anim.html — HyperFrames cover copy with baked params -----
    // packs/covers/hyperframe-cover.html, with pack=/clips=/audio= defaults
    // baked in so the shipped file is self-contained (query params still win).
    const coverAnimPath = path.join(packDir, 'cover-anim.html');
    let hasCoverAnim = false;
    if (fs.existsSync(COVER_ANIM_SRC)) {
      try {
        bakeCoverAnim({ srcPath: COVER_ANIM_SRC, destPath: coverAnimPath, packId: pack.id, clipCount, wavName });
        hasCoverAnim = true;
        stats.coverAnim = path.relative(ROOT, coverAnimPath);
        console.log(`  [${pack.id}] wrote cover-anim.html (pack=${pack.id} clips=${clipCount} audio=${wavName})`);
      } catch (err) {
        console.warn(`  [${pack.id}] cover-anim.html copy failed: ${err.message}`);
      }
    } else {
      console.warn(`  [${pack.id}] ${COVER_ANIM_SRC} not found — skipping cover-anim.html`);
    }

    // --- c3. preview.mp3 — 15s audio preview (spec: ffmpeg -t 15) -----------
    const previewPath = path.join(packDir, 'preview.mp3');
    let hasPreview = false;
    {
      const r = spawnSync('ffmpeg', ['-y', '-i', wavPath, '-t', '15', '-ac', '2', '-ar', '44100', '-b:a', '128k', previewPath], { stdio: ['ignore', 'ignore', 'pipe'] });
      hasPreview = r.status === 0 && fs.existsSync(previewPath);
      if (!hasPreview) console.warn(`  [${pack.id}] preview.mp3 failed (${(r.stderr || '').toString().split('\n').slice(-1)[0] || 'ffmpeg error'})`);
      else stats.previewAudio = path.relative(ROOT, previewPath);
    }

    // --- c4. LICENSE.txt — repo MIT text + media line -----------------------
    const licensePath = path.join(packDir, 'LICENSE.txt');
    let hasLicense = false;
    {
      const licenseSrc = path.join(ROOT, 'LICENSE');
      if (fs.existsSync(licenseSrc)) {
        const licenseText = fs.readFileSync(licenseSrc, 'utf8').trim() + '\n\nMedia clips: CC0 (see packs/manifest.json); animation + code: MIT — Kai Djuric, 2026\n';
        fs.writeFileSync(licensePath, licenseText);
        hasLicense = true;
        stats.license = path.relative(ROOT, licensePath);
      } else {
        console.warn(`  [${pack.id}] ${licenseSrc} not found — skipping LICENSE.txt`);
      }
    }

    // --- d. nft-metadata.json ----------------------------------------------
    const nftPath = path.join(packDir, 'nft-metadata.json');
    const nft = buildNftMetadata({
      pack, title, wavName, variant, fps, width, height, songSeconds, mp4Present, coverName,
      hasCoverAnim, hasPreview, zipName: `media-pack-${pack.id}.zip`,
      clipMode: isClipPack, clipMax: isClipPack ? pack.clipMax : null, normalizedClips: isClipPack ? pack.normalized : null,
    });
    fs.writeFileSync(nftPath, JSON.stringify(nft, null, 2));
    stats.nftFile = path.relative(ROOT, nftPath);

    // --- e. zip (self-contained per pack) ----------------------------------
    // Clips stay FLAT (zip -j junk-path model, matching the existing archive
    // layout) and each clip's entry name equals its .swr-set asset name — the
    // marketplace zip import hydrates set media by exact name match, so the
    // normalized webm Files restore from the sidecars without dataUrl decode.
    const zipBase = path.join(outDir, `media-pack-${pack.id}.zip`);
    const zipFiles = [setPath, nftPath];
    if (mp4Present) zipFiles.push(mp4Path);
    if (isClipPack) for (const n of pack.normalized) zipFiles.push(n.path);
    if (hasCover) zipFiles.push(path.join(packDir, coverName));
    if (hasCoverAnim) zipFiles.push(coverAnimPath);
    if (hasPreview) zipFiles.push(previewPath);
    if (hasLicense) zipFiles.push(licensePath);
    const zr = spawnSync('zip', ['-j', '-q', zipBase, ...zipFiles], { stdio: ['ignore', 'ignore', 'pipe'] });
    if (zr.status !== 0 || !fs.existsSync(zipBase)) {
      stats.error = `zip failed (${(zr.stderr || '').toString().split('\n').slice(-1)[0] || 'zip error'})`;
      console.error(`  [${pack.id}] ZIP FAILED — ${stats.error}`);
    } else {
      stats.zipFile = path.relative(ROOT, zipBase);
      stats.zipSize = fs.statSync(zipBase).size;
      // nft-metadata.json carries the zip's uri/size in properties.files — the
      // size is only known after the archive exists, so patch it in and refresh
      // the archive's entry so the shipped copy is complete too.
      if (fs.existsSync(nftPath)) {
        const nftObj = JSON.parse(fs.readFileSync(nftPath, 'utf8'));
        if (nftObj && nftObj.properties && nftObj.properties.files) {
          nftObj.properties.files.size = stats.zipSize;
          fs.writeFileSync(nftPath, JSON.stringify(nftObj, null, 2));
          const zr2 = spawnSync('zip', ['-j', '-q', zipBase, nftPath], { stdio: ['ignore', 'ignore', 'pipe'] });
          if (zr2.status !== 0) console.warn(`  [${pack.id}] zip entry refresh for nft-metadata.json failed`);
          stats.zipSize = fs.statSync(zipBase).size;
        }
      }
      console.log(`  [${pack.id}] zip -> ${stats.zipFile} (${(stats.zipSize / 1024 / 1024).toFixed(2)}MB)`);
    }

    results.push(stats);
  }

  // --- f. top-level manifest.json -------------------------------------------
  const manifest = {
    schema: 'swr-media-pack/v1',
    generatedAt: new Date().toISOString(),
    audio: { name: wavName, path: path.relative(ROOT, wavPath), size: wavSize, durationSeconds: songSeconds },
    config: { variant, fps, width, height, skipRender, clipMode, clipMax },
    packs: results.map(r => ({
      id: r.id,
      name: r.title,
      error: r.error || null,
      zip: r.zipFile,
      zipSize: r.zipSize,
      setFile: r.setFile,
      setId: r.setId || null,
      nftMetadata: r.nftFile || null,
      coverAnim: r.coverAnim || null,
      previewAudio: r.previewAudio || null,
      license: r.license || null,
      clips: r.clips ?? null,
      skippedClips: r.skippedClips ?? null,
      media: {
        video: r.mp4,
        cover: r.coverName || null,
      },
    })),
  };
  const manifestPath = path.join(outDir, 'manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  console.log(`manifest -> ${path.relative(ROOT, manifestPath)}`);

  const okCount = results.filter(r => !r.error).length;
  console.log(`\ndone: ${okCount}/${results.length} packs ok`);
  for (const r of results) {
    if (r.error) console.error(`  ✗ ${r.id}: ${r.error}`);
  }
  process.exit(okCount === results.length ? 0 : 1);
}

// === helpers ==============================================================
function printUsage() {
  console.log(`usage: node scripts/generate-media-pack.mjs --audio <input.wav> (--packs <id1,id2> | --clips-dir <dir>) [options]
  --audio <file>        WAV to render + embed in each set (required)
  --packs <ids>         comma-separated pack ids from packs/manifest.json
                        (mutually exclusive with --clips-dir)
  --clips-dir <dir>     folder of user-supplied WebM/MP4 shots; each is
                        normalized to a ≤--clip-max WebM clip (VP9+Opus, audio
                        intact) and the clips become the pack's video layers +
                        zip payload. Pack id defaults to custom-webm.
  --pack-id <id>        pack id used with --clips-dir (default: custom-webm)
  --clip-max <secs>     auto-crop ceiling in seconds for --clips-dir clips
                        (default: 15); longer clips are trimmed to this length,
                        shorter ones pass through untouched
  --webm-only           with --clips-dir: skip the full-song MP4 render
                        entirely (no dev server needed) — output is the
                        normalized webm clips + set + cover + zip
  --output <dir>        output directory (default: out/media-pack)
  --variant <name>      versions/ variant to render; also the set's engine (default: film)
  --fps N               render fps (default: 12)
  --width N --height N  render resolution (default: 640x360)
  --skip-render         reuse an existing rendered <pack>.mp4 instead of rendering
  --help                show this help`);
}

export function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--audio') out.audio = argv[++i];
    else if (a === '--packs') out.packs = argv[++i];
    else if (a === '--clips-dir') out.clipsDir = argv[++i];
    else if (a === '--pack-id') out.packId = argv[++i];
    else if (a === '--clip-max') out.clipMax = parseFloat(argv[++i]);
    else if (a === '--webm-only') out.webmOnly = true;
    else if (a === '--output') out.output = argv[++i];
    else if (a === '--variant') out.variant = argv[++i];
    else if (a === '--fps') out.fps = parseInt(argv[++i], 10);
    else if (a === '--width') out.width = parseInt(argv[++i], 10);
    else if (a === '--height') out.height = parseInt(argv[++i], 10);
    else if (a === '--skip-render') out.skipRender = true;
    else if (a === '--help' || a === '-h') out.help = true;
    else if (a.startsWith('--')) { console.error(`unknown flag: ${a}`); process.exit(2); }
    else if (!out.audio) out.audio = a;
  }
  return out;
}

export function validateArgs(args) {
  if (args.clipsDir && args.packs) {
    return `--clips-dir and --packs are mutually exclusive (got clips-dir=${args.clipsDir}, packs=${args.packs})`;
  }
  if (args.clipMax !== undefined && !(Number.isFinite(args.clipMax) && args.clipMax > 0)) {
    return `--clip-max must be a positive number of seconds (got ${args.clipMax})`;
  }
  return null;
}

export function resolveClipMax(args) {
  const n = Number(args && args.clipMax);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_CLIP_MAX_SEC;
}

function synthesizeClipsPack(args) {
  const clipsDir = path.resolve(args.clipsDir);
  if (!fs.existsSync(clipsDir) || !fs.statSync(clipsDir).isDirectory()) {
    console.error(`clips dir not found: ${clipsDir}`);
    process.exit(2);
  }
  const clips = discoverClips(clipsDir);
  if (!clips.length) {
    console.error(`no *.webm / *.mp4 clips found in ${clipsDir}`);
    process.exit(2);
  }
  return [{
    id: args.packId || 'custom-webm',
    clipMode: true,
    clipMax: resolveClipMax(args),
    clips,
    clipsDir,
  }];
}

function resolvePacks(packsArg) {
  const manifestPath = path.join(ROOT, 'packs', 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    console.error(`packs manifest not found: ${manifestPath}`);
    process.exit(2);
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const all = manifest.packs || {};
  const ids = String(packsArg).split(',').map(s => s.trim()).filter(Boolean);
  const missing = ids.filter(id => !all[id]);
  if (missing.length) {
    console.error(`unknown pack id(s): ${missing.join(', ')}`);
    console.error(`available: ${Object.keys(all).join(', ')}`);
    process.exit(2);
  }
  return ids.map(id => ({
    id,
    clips: all[id].map(rel => path.join(ROOT, 'packs', rel)),
  }));
}

function packTitle(id) {
  return id.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

function requireExec(cmd, args) {
  const r = spawnSync(cmd, args, { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`${cmd} failed: ${(r.stderr || r.stdout || '').trim()}`);
  return r.stdout.trim();
}

function checkDevServer(variantName) {
  return new Promise((resolve) => {
    const req = http.get(
      { host: DEV_SERVER.host, port: DEV_SERVER.port, path: `/versions/${variantName}.html`, timeout: 4000 },
      (res) => { res.resume(); resolve(res.statusCode === 200); }
    );
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

function renderPack({ wavPath, mp4Path, variant, fps, width, height, clips }) {
  // Must pass an ABSOLUTE script path: render-full-song's CLI guard compares
  // process.argv[1] against `file://` + argv — a relative path never equals
  // import.meta.url, so the CLI shim silently never runs.
  const renderScript = path.join(ROOT, 'scripts', 'render-full-song.mjs');
  const args = [
    renderScript,
    wavPath, mp4Path,
    '--variant', variant,
    '--fps', String(fps),
    '--width', String(width),
    '--height', String(height),
    ...clips,
  ];
  const res = spawnSync(process.execPath, args, { cwd: ROOT, stdio: 'inherit' });
  return res.status === 0;
}

function toDataUrl(filePath, mime) {
  const data = fs.readFileSync(filePath);
  return `data:${mime};base64,${data.toString('base64')}`;
}

// --- WebM clip normalization (clips-dir mode) ------------------------------
// All four are pure enough to unit-test with injected probe/spawn/readdir/
// stat mocks (see scripts/check-webm-clips-unit.mjs).
export function probeDuration(file, { exec = requireExec } = {}) {
  // ffprobe format=duration; null means "unknown" (callers treat unknown as
  // "cap it" so an unmeasurable input can never slip past --clip-max).
  try {
    const out = exec('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file]);
    const n = Number.parseFloat(out);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

export function normalizeWebmClip({ src, dest, maxSec, probe = probeDuration, spawn = spawnSync, stat = fs.statSync }) {
  let inDur = null;
  try { inDur = typeof probe === 'function' ? probe(src) : null; } catch { inDur = null; }
  // Auto-crop: cap the clip when its length is unknown or exceeds maxSec.
  // Shorter clips pass through untouched (no -t, keep their full length).
  const trimmed = inDur === null || inDur >= maxSec;
  const args = ['-y', '-i', src];
  if (trimmed) args.push('-t', String(maxSec));
  args.push('-c:v', 'libvpx-vp9', '-crf', '32', '-b:v', '0', '-c:a', 'libopus', '-b:a', '96k', '-shortest', dest);
  let r = null;
  try {
    r = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });
  } catch (err) {
    r = { status: null, stderr: Buffer.from(String((err && err.message) || err)) };
  }
  let outBytes = 0;
  try {
    const s = stat(dest);
    if (s && typeof s.size === 'number') outBytes = s.size;
  } catch { /* dest missing → treated as failed */ }
  const ok = !!r && r.status === 0 && outBytes > 0;
  let outDur = null;
  if (ok) {
    try { outDur = typeof probe === 'function' ? probe(dest) : null; } catch { outDur = null; }
  }
  const stderrText = r && r.stderr != null ? String(r.stderr) : '';
  return {
    ok,
    inDur,
    trimmed,
    outDur,
    outBytes,
    args,
    error: ok ? null : (stderrText.split('\n').slice(-1)[0] || 'ffmpeg error'),
  };
}

export function uniqueName(baseName, used) {
  // Deterministic collision suffix: shot.webm → shot-2.webm → shot-3.webm …
  if (!used.has(baseName)) return baseName;
  const dot = baseName.lastIndexOf('.');
  const stem = dot === -1 ? baseName : baseName.slice(0, dot);
  const ext = dot === -1 ? '' : baseName.slice(dot);
  let k = 2;
  let candidate = `${stem}-${k}${ext}`;
  while (used.has(candidate)) {
    k += 1;
    candidate = `${stem}-${k}${ext}`;
  }
  return candidate;
}

export function discoverClips(dir, { readDir = fs.readdirSync } = {}) {
  // *.webm / *.mp4 (case-insensitive) only, ASCII-sorted for determinism.
  let names;
  try {
    names = readDir(dir);
  } catch {
    names = [];
  }
  return names
    .filter(n => /\.(webm|mp4)$/i.test(n))
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    .map(n => path.join(dir, n));
}

export function normalizeClips({ clips, destDir, maxSec, probe = probeDuration, spawn = spawnSync, stat = fs.statSync }) {
  const used = new Set();
  const normalized = [];
  const skipped = [];
  for (const src of clips) {
    const stem = path.basename(src).replace(/\.(webm|mp4)$/i, '');
    let inDur = null;
    try { inDur = typeof probe === 'function' ? probe(src) : null; } catch { inDur = null; }
    const trimmed = inDur === null || inDur >= maxSec;
    // Trimmed clips carry the crop in the name (<stem>-<max>s.webm); the
    // stem name is kept when the clip passes through untouched. That name is
    // BOTH the zip entry (flat, -j) and the .swr-set asset name — the
    // marketplace importer hydrates by exact name match, so they must agree.
    let name = `${stem}${trimmed ? `-${maxSec}s` : ''}.webm`;
    name = uniqueName(name, used);
    used.add(name);
    const dest = path.join(destDir, name);
    const r = normalizeWebmClip({ src, dest, maxSec, probe, spawn, stat });
    const dur = n => (n === null || n === undefined ? '?' : `${Number(n).toFixed(2)}s`);
    if (r.ok) {
      normalized.push({ src, path: dest, name, mimeType: 'video/webm', inDur: r.inDur, trimmed: r.trimmed, outDur: r.outDur, outBytes: r.outBytes });
      console.log(`    clip ${name}: in=${dur(r.inDur)} out=${dur(r.outDur)} ${r.outBytes} bytes${r.trimmed ? ` (auto-cropped to ${maxSec}s)` : ' (untouched)'}`);
    } else {
      // Failure is per-clip, never fatal: warn, skip, keep the rest going.
      skipped.push({ src, name, error: r.error });
      console.warn(`    clip ${path.basename(src)}: SKIPPED — ${r.error}`);
    }
  }
  return { normalized, skipped };
}

function buildSet({ pack, title, wavPath, wavName, wavSize, variant, clipMode = false }) {
  // Clips mode layers are the NORMALIZED webm clips ({ path, name, mimeType:
  // 'video/webm' }); packs-path layers are plain file paths (video/mp4).
  const clips = clipMode ? pack.normalized : pack.clips;
  const layers = clips.map((clip, i) => {
    const info = typeof clip === 'string'
      ? { path: clip, name: path.basename(clip), mimeType: 'video/mp4' }
      : clip;
    return {
      id: `L${i + 1}`,
      name: info.name,
      blend: 'source-over',
      opacity: 1,
      baseScale: 1,
      hue: 0,
      brightness: 1,
      contrast: 1,
      pos: { x: 0, y: 0, rot: 0 },
      rotOffset: 0,
      reactors: [],
      modulators: [],
      asset: {
        name: info.name,
        mimeType: info.mimeType,
        size: fs.statSync(info.path).size,
        dataUrl: toDataUrl(info.path, info.mimeType),
      },
    };
  });
  return {
    schemaVersion: 2,
    id: crypto.randomUUID(),
    name: `${title} · Auto-Start`,
    author: 'SWR',
    description: clipMode
      ? `Auto-start media pack: ${title} (${clips.length} normalized WebM clips, ≤${pack.clipMax}s each) for ${wavName} with the ${variant} engine. Audio + video start together.`
      : `Auto-start media pack: ${title} (${clips.length} video clips) rendered for ${wavName} with the ${variant} engine. Audio + video start together.`,
    tags: [pack.id, variant, 'media-pack', 'auto-start'],
    createdAt: new Date().toISOString(),
    ownerId: null,
    visibility: 'public',
    engine: variant,
    audio: {
      name: wavName,
      mimeType: 'audio/wav',
      size: wavSize,
      dataUrl: toDataUrl(wavPath, 'audio/wav'),
    },
    // Film-ish default — exactly the 14 fields FX.setPersona() consumes.
    fx: {
      temp: 0.35, mut: 0.1, mutAlgo: 1, posterize: 0, vignette: 0.45,
      chroma: 0.2, grain: 0.35, sepia: 0.25, glow: 0.3, grayscale: 0,
      blur: 0.08, liquid: 0.1, pearl: 0.15, glitch: 0,
    },
    layers,
    settings: { bpm: 96, key: 'D', scale: 'major' },
  };
}

function buildNftMetadata({ pack, title, wavName, variant, fps, width, height, songSeconds, mp4Present, coverName, hasCoverAnim, hasPreview, zipName, clipMode = false, clipMax = null, normalizedClips = null }) {
  const attributes = [
    { trait_type: 'audio', value: wavName },
    { trait_type: 'video_pack', value: pack.id },
    { trait_type: 'clips', value: clipMode ? normalizedClips.length : pack.clips.length },
    { trait_type: 'variant', value: variant },
    { trait_type: 'fps', value: fps },
    { trait_type: 'resolution', value: `${width}x${height}` },
    { trait_type: 'duration_seconds', value: Math.round(songSeconds * 10) / 10 },
    { trait_type: 'schema_version', value: 2 },
  ];
  if (clipMode) {
    // Clips mode provenance: where the layers came from + the crop ceiling.
    attributes.push(
      { trait_type: 'clip_source', value: 'webm-upload' },
      { trait_type: 'clip_max_sec', value: clipMax },
    );
  }
  const nft = {
    name: `${title} · ${wavName.replace(/\.[^.]+$/, '')} · Media Pack`,
    description: clipMode
      ? `Audio-reactive ${variant} media pack of ${wavName} built from ${pack.clips.length} uploaded WebM shots normalized to ≤${clipMax}s clips. Includes an auto-start .swr-set, the normalized WebM clips, and a cover.`
      : `Audio-reactive ${variant} render of ${wavName} built from the ${title} media pack (${pack.clips.length} clips). Includes an auto-start .swr-set, the rendered MP4, and a cover.`,
    external_url: 'https://sainted-word-records.vercel.app/marketplace',
    attributes,
    // Spec shape (packs/covers/pack-spec.md): files carries the zip uri/size
    // plus the audio preview; authors + license mirror the pack licensing.
    properties: {
      files: {
        type: 'application/zip',
        uri: zipName,
        size: null, // patched with the real archive size after zip (step e)
      },
      authors: [
        { name: 'Kai Djuric', role: 'creator', url: 'https://github.com/kajica2' },
      ],
      license: 'CC0-1.0',
    },
  };
  if (mp4Present) nft.animation_url = `${pack.id}.mp4`;
  else if (clipMode && normalizedClips && normalizedClips.length) nft.animation_url = normalizedClips[0].name;
  if (coverName) nft.image = coverName;
  if (hasCoverAnim) nft.properties.files.cover_anim_url = 'cover-anim.html';
  if (hasPreview) nft.properties.files.preview_audio_url = 'preview.mp3';
  return nft;
}

function bakeCoverAnim({ srcPath, destPath, packId, clipCount, wavName }) {
  // Bake the query params into the copy's defaults so the shipped file works
  // standalone (pack= / clips= / audio= — accent= left to the SWR pink
  // default; a live ?… query string still overrides the baked defaults).
  const esc = s => String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  let html = fs.readFileSync(srcPath, 'utf8');
  html = html
    .replace(/var CLIPS\s+= q\.get\('clips'\)\s+\|\|\s+'12';/, `var CLIPS  = q.get('clips')  || '${esc(clipCount)}';`)
    .replace(/var AUDIO\s+= q\.get\('audio'\)\s+\|\|\s+'tribalismo\.mp3';/, `var AUDIO  = q.get('audio')  || '${esc(wavName)}';`)
    .replace(/var PACK\s+= q\.get\('pack'\)\s+\|\|\s+'';/, `var PACK   = q.get('pack')   || '${esc(packId)}';`);
  html = html.replace('<!DOCTYPE html>', `<!DOCTYPE html>\n<!-- GENERATED copy of packs/covers/hyperframe-cover.html (scripts/generate-media-pack.mjs) — baked params: pack=${packId} clips=${clipCount} audio=${wavName}. -->`);
  fs.writeFileSync(destPath, html);
}