#!/usr/bin/env node
// scripts/media-optimize.mjs — re-encode the shipped media to delivery size.
//
// Why: the media the build ships is encoded far above what a browser
// needs. Measured 2026-10-21 on the real files:
//   videos/stage-take-2026-09-29.mp4   1024x574 @ 2.3 Mbps  → 11.8M
//   portfolio/portfolio-morning-haunt-v2.mp4  832x464 @ 5.5 Mbps → 3.3M
// The same file at a 1 Mbps cap is 5.7M and 0.5M. Nothing in the page
// can show the difference; the deploy pays for it on every request.
//
// The rule this script follows: **never make a file bigger.** A file
// whose source bitrate is already under the cap is left alone. That is
// what a plain CRF pass gets wrong — CRF 28 on a 896 kbps source
// produced a LARGER file.
//
// Usage:
//   node scripts/media-optimize.mjs --dry-run          # report only
//   node scripts/media-optimize.mjs --apply            # re-encode in place
//   node scripts/media-optimize.mjs --apply --only videos
//   node scripts/media-optimize.mjs --apply --only audios
//
// In-place: the filename and extension do not change, so no page, no
// manifest and no URL has to change.
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, renameSync, statSync, unlinkSync } from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const DRY = !APPLY;
const onlyIdx = args.indexOf('--only');
const ONLY = onlyIdx > -1 ? args[onlyIdx + 1] : null;

// Cap per kind. Video keeps a real audio track at 128k (the variants
// play muted, but the portfolio/landing pages do not).
const CAPS = {
  video: { vb: '1000k', ab: '128k', ext: 'mp4' },
  audio: { vb: null, ab: '128k', ext: 'mp3' },
};
const VIDEO_DIRS = ['videos', 'portfolio', 'promo'];
const AUDIO_DIRS = ['audios', 'packs/audio-loops'];

const MEDIA = /\.(mp4|webm|mov|m4a|mp3|wav)$/i;

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (MEDIA.test(e.name)) out.push(p);
  }
  return out;
}

function probe(file) {
  const out = execFileSync('ffprobe', [
    '-v', 'error',
    '-show_entries', 'format=duration,bit_rate',
    '-show_entries', 'stream=codec_type,codec_name,width,height,bit_rate',
    '-of', 'json', file,
  ], { encoding: 'utf8' });
  const j = JSON.parse(out);
  const v = (j.streams || []).find((s) => s.codec_type === 'video');
  const a = (j.streams || []).find((s) => s.codec_type === 'audio');
  return {
    duration: parseFloat(j.format?.duration || 0),
    totalBitrate: parseInt(j.format?.bit_rate || 0, 10),
    video: v ? { codec: v.codec_name, w: v.width, h: v.height, bitrate: parseInt(v.bit_rate || 0, 10) } : null,
    audio: a ? { codec: a.codec_name, bitrate: parseInt(a.bit_rate || 0, 10) } : null,
  };
}

function bitrateToBps(s) {
  if (!s) return 0;
  const m = /^(\d+(?:\.\d+)?)([kKmM]?)$/.exec(s.trim());
  if (!m) return 0;
  const n = parseFloat(m[1]);
  return Math.round(n * (m[2].toLowerCase() === 'm' ? 1e6 : m[2].toLowerCase() === 'k' ? 1e3 : 1));
}

const targets = [];
if (!ONLY || ONLY === 'videos') for (const d of VIDEO_DIRS) targets.push(...walk(d));
if (!ONLY || ONLY === 'audios') for (const d of AUDIO_DIRS) targets.push(...walk(d));

console.log(`media-optimize: ${targets.length} file(s) ${APPLY ? 'to re-encode' : 'to report'} (dry run: ${DRY})`);
console.log('===================================================================');
console.log('');

let beforeTotal = 0, afterTotal = 0, changed = 0, skipped = 0, failed = 0;
const tmp = path.join('dist', '.media-optimize-tmp');
// The scratch dir is needed for the probe encode in both modes — a dry run
// still has to know what the output would weigh.
execFileSync('mkdir', ['-p', tmp]);

for (const file of targets) {
  const kind = /\.mp3$/i.test(file) ? 'audio' : (/\.mp4$/i.test(file) ? 'video' : null);
  if (!kind) { skipped++; continue; }
  const cap = CAPS[kind];
  const before = statSync(file).size;
  beforeTotal += before;

  let info;
  try { info = probe(file); } catch (e) { console.log(`  ! ${file}: ffprobe failed (${e.message})`); failed++; continue; }

  // What is the source's own bitrate for this stream?
  const srcBitrate = kind === 'video'
    ? (info.video?.bitrate || (info.totalBitrate && info.audio ? info.totalBitrate - info.audio.bitrate : info.totalBitrate))
    : (info.audio?.bitrate || info.totalBitrate);
  const capBps = bitrateToBps(kind === 'video' ? cap.vb : cap.ab);

  if (srcBitrate && srcBitrate <= capBps) {
    // Already at or under the cap — re-encoding can only make it worse.
    afterTotal += before;
    skipped++;
    console.log(`  = ${file}  ${(before / 1048576).toFixed(1)}M  source ${Math.round(srcBitrate / 1000)} kbps ≤ cap ${Math.round(capBps / 1000)} kbps — left alone`);
    continue;
  }

  const out = path.join(tmp, path.basename(file));
  const args = ['-y', '-loglevel', 'error', '-i', file];
  if (kind === 'video') {
    args.push('-c:v', 'libx264', '-b:v', cap.vb, '-maxrate', cap.vb, '-bufsize', '2000k',
      '-preset', 'medium', '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
      '-c:a', 'aac', '-b:a', cap.ab);
  } else {
    args.push('-c:a', 'libmp3lame', '-b:a', cap.ab);
  }
  args.push(out);

  try {
    execFileSync('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });
  } catch (e) {
    console.log(`  ! ${file}: ffmpeg failed (${String(e.stderr || e.message).slice(0, 120)})`);
    afterTotal += before;
    failed++;
    continue;
  }

  const after = statSync(out).size;
  const dur = probe(out);
  const durOk = Math.abs(dur.duration - info.duration) < 0.25;
  const dimOk = kind === 'video'
    ? (!info.video || (dur.video && dur.video.w === info.video.w && dur.video.h === info.video.h))
    : true;

  if (after >= before || !durOk || !dimOk) {
    // Never ship a worse file.
    console.log(`  = ${file}  ${(before / 1048576).toFixed(1)}M → ${(after / 1048576).toFixed(1)}M  rejected (${after >= before ? 'not smaller' : !durOk ? 'duration drift' : 'dimension drift'})`);
    unlinkSync(out);
    afterTotal += before;
    skipped++;
    continue;
  }

  afterTotal += after;
  changed++;
  console.log(`  ✓ ${file}  ${(before / 1048576).toFixed(1)}M → ${(after / 1048576).toFixed(1)}M  (-${Math.round((before - after) * 100 / before)}%)`);

  if (APPLY) {
    renameSync(out, file);
  }
}

if (APPLY && existsSync(tmp)) {
  try { execFileSync('rm', ['-rf', tmp]); } catch { /* best effort */ }
}

console.log('');
console.log(`  before: ${(beforeTotal / 1048576).toFixed(1)}M  after: ${(afterTotal / 1048576).toFixed(1)}M  saved: ${((beforeTotal - afterTotal) / 1048576).toFixed(1)}M`);
console.log(`  ${changed} would change, ${skipped} left alone, ${failed} failed`);
if (DRY) console.log('  (dry run — pass --apply to write the files)');
