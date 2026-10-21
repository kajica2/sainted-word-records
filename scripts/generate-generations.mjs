#!/usr/bin/env node
// scripts/generate-generations.mjs — build the living history.
//
// Reads the authored records (marketing/generations.json), measures what the
// tree actually contains, and writes two things:
//
//   generations.json        — the shipped data the history page fetches
//   generations/<id>.zip    — one archive per generation (build output)
//
// Every archive carries the generation's own files plus CREDITS.md: each
// media file with its length, bitrate, codec and sample rate, each source
// file with its size and checksum. The credits are measured with ffprobe, not
// written by hand, so they stay true when a track is re-encoded — and the
// page can never quote a number the file does not have.
//
// Only tracked files are part of a generation. That is the same rule the
// media inventory page uses: media that lives only on this machine is not
// part of what the project shipped, so it is credited as untracked rather
// than quietly included.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createZip } from './lib/zip.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const AUTHORED = path.join(ROOT, 'marketing', 'generations.json');
const OUT_JSON = path.join(ROOT, 'generations.json');
const OUT_ZIPS = path.join(ROOT, 'generations');

const MEDIA_EXT = new Set(['.mp3', '.wav', '.m4a', '.aac', '.ogg', '.opus', '.flac']);
const VIDEO_EXT = new Set(['.mp4', '.webm', '.mov', '.m4v', '.mkv']);

// ── helpers ──────────────────────────────────────────────────────────────────

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function trackedFiles() {
  try {
    const out = execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, maxBuffer: 64 * 1024 * 1024, encoding: 'utf8' });
    return new Set(out.split('\0').filter(Boolean));
  } catch (_) {
    return null; // no git (a tarball build) — fall back to "everything is here"
  }
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function lineCount(file) {
  try {
    const text = fs.readFileSync(file, 'utf8');
    if (text.includes('\0')) return null; // binary
    return text.split('\n').length - (text.endsWith('\n') ? 1 : 0);
  } catch (_) {
    return null;
  }
}

// ffprobe gives the numbers a credit needs: how long the file runs and how
// many bits per second it spends getting there.
const probeCache = new Map();
function probeMedia(file, kind) {
  const key = `${kind}:${file}`;
  if (probeCache.has(key)) return probeCache.get(key);
  let result = null;
  try {
    const raw = execFileSync('ffprobe', [
      '-v', 'error',
      '-show_entries', 'format=duration,bit_rate,size,format_name',
      '-show_entries', 'stream=codec_name,codec_type,sample_rate,channels,width,height',
      '-of', 'json',
      file,
    ], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
    const parsed = JSON.parse(raw);
    const format = parsed.format || {};
    const streams = parsed.streams || [];
    const audio = streams.find((s) => s.codec_type === 'audio');
    const video = streams.find((s) => s.codec_type === 'video');
    // An audio file can carry cover art (an mjpeg video stream) — the codec
    // in the credit has to be the one the file actually plays.
    const stream = kind === 'audio' ? (audio || video) : (video || audio);
    result = {
      duration: format.duration ? Number(Number(format.duration).toFixed(3)) : null,
      bitrate: format.bit_rate ? Math.round(Number(format.bit_rate)) : null,
      container: format.format_name || null,
      codec: stream ? stream.codec_name || null : null,
      sampleRate: audio && audio.sample_rate ? Number(audio.sample_rate) : null,
      channels: audio && audio.channels ? Number(audio.channels) : null,
      width: video && video.width ? Number(video.width) : null,
      height: video && video.height ? Number(video.height) : null,
    };
  } catch (_) {
    result = null; // ffprobe missing or the file is not media
  }
  probeCache.set(key, result);
  return result;
}

function mediaKind(file) {
  const ext = path.extname(file).toLowerCase();
  if (MEDIA_EXT.has(ext)) return 'audio';
  if (VIDEO_EXT.has(ext)) return 'video';
  return null;
}

// Expand a `dir/*.ext` pattern against the tracked file list. Only the
// single-directory, single-star form is supported — that is all the history
// needs, and a real glob library is not worth a dependency here.
function expandGlob(pattern, trackedSet) {
  const star = pattern.indexOf('*');
  if (star === -1) return trackedSet ? (trackedSet.has(pattern) ? [pattern] : []) : (fs.existsSync(path.join(ROOT, pattern)) ? [pattern] : []);
  const prefix = pattern.slice(0, star);
  const suffix = pattern.slice(star + 1);
  const candidates = trackedSet
    ? [...trackedSet]
    : (fs.existsSync(path.join(ROOT, prefix)) ? fs.readdirSync(path.join(ROOT, prefix)).map((f) => `${prefix}${f}`) : []);
  return candidates
    .filter((f) => f.startsWith(prefix) && f.endsWith(suffix) && !f.slice(prefix.length, f.length - suffix.length).includes('/'))
    .sort();
}

function humanBytes(bytes) {
  if (!Number.isFinite(bytes)) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function humanDuration(seconds) {
  if (!Number.isFinite(seconds)) return '—';
  const total = Math.round(seconds);
  const m = Math.floor(total / 60);
  const s = total % 60;
  if (m === 0) return `${s}s`;
  return `${m}m ${String(s).padStart(2, '0')}s`;
}

function humanBitrate(bps) {
  if (!Number.isFinite(bps)) return '—';
  return `${Math.round(bps / 1000)} kbps`;
}

// ── build ────────────────────────────────────────────────────────────────────

const authored = readJson(AUTHORED);
const tracked = trackedFiles();
const generations = [];

for (const gen of authored.generations) {
  // ── the files this generation shipped ────────────────────────────────────
  // The artifacts are the pages the generation is linked to; `include` is a
  // glob over the tree (the preset stream, the version pages) so a
  // generation can carry a whole set of files without anyone maintaining
  // the list by hand.
  const fileSpecs = [];
  for (const artifact of gen.artifacts || []) {
    fileSpecs.push({ path: artifact.path, label: artifact.label || artifact.path, href: artifact.href || null });
  }
  for (const pattern of gen.include || []) {
    for (const match of expandGlob(pattern, tracked)) {
      fileSpecs.push({ path: match, label: match, href: null });
    }
  }

  const seen = new Set();
  const files = [];
  for (const spec of fileSpecs) {
    if (seen.has(spec.path)) continue;
    seen.add(spec.path);
    const abs = path.join(ROOT, spec.path);
    const exists = fs.existsSync(abs);
    const isTracked = tracked ? tracked.has(spec.path) : true;
    files.push({
      kind: 'file',
      path: spec.path,
      label: spec.label,
      href: spec.href,
      exists,
      tracked: isTracked,
      bytes: exists ? fs.statSync(abs).size : 0,
      lines: exists ? lineCount(abs) : null,
      sha256: exists ? sha256(abs).slice(0, 12) : null,
    });
  }

  // ── the media this generation shipped ────────────────────────────────────
  const media = [];
  for (const entry of gen.media || []) {
    const rel = entry.path;
    const abs = path.join(ROOT, rel);
    const exists = fs.existsSync(abs);
    const isTracked = tracked ? tracked.has(rel) : true;
    const kind = mediaKind(rel);
    const probe = exists && kind ? probeMedia(abs, kind) : null;
    media.push({
      kind: kind || 'file',
      path: rel,
      note: entry.note || null,
      embed: Boolean(entry.embed),
      exists,
      tracked: isTracked,
      bytes: exists ? fs.statSync(abs).size : 0,
      duration: probe ? probe.duration : null,
      bitrate: probe ? probe.bitrate : null,
      codec: probe ? probe.codec : null,
      container: probe ? probe.container : null,
      sampleRate: probe ? probe.sampleRate : null,
      channels: probe ? probe.channels : null,
      width: probe ? probe.width : null,
      height: probe ? probe.height : null,
    });
  }

  // ── the credits ──────────────────────────────────────────────────────────
  // Source files count when they exist; media counts only when it is
  // tracked — a track that lives on one machine is not part of what the
  // project shipped.
  const shippedFiles = files.filter((f) => f.exists);
  const shippedMedia = media.filter((m) => m.exists && m.tracked);
  const embeddedMedia = shippedMedia.filter((m) => m.embed);
  const totalDuration = shippedMedia.reduce((sum, m) => sum + (m.duration || 0), 0);
  const totalBytes = [...shippedFiles, ...shippedMedia].reduce((sum, f) => sum + f.bytes, 0);
  const totalMediaBytes = shippedMedia.reduce((sum, m) => sum + m.bytes, 0);
  // The bitrate a track actually spends: bytes over time, averaged per file.
  const averageBitrate = totalDuration > 0
    ? Math.round((totalMediaBytes * 8) / totalDuration)
    : null;

  generations.push({
    id: gen.id,
    era: gen.era,
    kind: gen.kind,
    date: gen.date,
    title: gen.title,
    story: gen.story,
    facts: gen.facts || null,
    artifacts: files.map((f) => ({
      label: f.label,
      href: f.href,
      path: f.path,
      bytes: f.bytes,
      lines: f.lines,
      exists: f.exists,
      tracked: f.tracked,
    })),
    media: media.map((m) => ({
      kind: m.kind,
      path: m.path,
      note: m.note,
      duration: m.duration,
      bitrate: m.bitrate,
      codec: m.codec,
      container: m.container,
      sampleRate: m.sampleRate,
      channels: m.channels,
      width: m.width,
      height: m.height,
      bytes: m.bytes,
      embedded: m.embed && m.exists && m.tracked,
      tracked: m.tracked,
    })),
    credits: {
      files: shippedFiles.length,
      media: shippedMedia.length,
      bytes: totalBytes,
      mediaBytes: totalMediaBytes,
      duration: Math.round(totalDuration * 1000) / 1000,
      averageBitrate,
      untracked: files.filter((f) => f.exists && !f.tracked).length
        + media.filter((m) => m.exists && !m.tracked).length,
    },
  });
}

const out = {
  meta: {
    ...authored.meta,
    generatedFrom: 'marketing/generations.json',
  },
  generations,
};

fs.writeFileSync(OUT_JSON, `${JSON.stringify(out, null, 2)}\n`);

// ── the archives ────────────────────────────────────────────────────────────

fs.rmSync(OUT_ZIPS, { recursive: true, force: true });
fs.mkdirSync(OUT_ZIPS, { recursive: true });

function creditsMarkdown(gen) {
  const lines = [];
  lines.push(`# Credits — ${gen.title}`);
  lines.push('');
  lines.push(`Generation \`${gen.id}\` · era ${gen.era} · kind ${gen.kind} · ${gen.date}`);
  lines.push('');
  lines.push('>');
  lines.push(`> ${gen.story}`);
  lines.push('');

  const shippedMedia = gen.media.filter((m) => m.tracked);
  lines.push('## Media');
  lines.push('');
  if (!shippedMedia.length) {
    lines.push('_This generation shipped no audio or video of its own._');
  } else {
    lines.push('| file | kind | length | bitrate | codec | detail | size |');
    lines.push('| --- | --- | --- | --- | --- | --- | --- |');
    for (const m of shippedMedia) {
      const detail = m.kind === 'video'
        ? `${m.width || '?'}×${m.height || '?'}`
        : [m.sampleRate ? `${(m.sampleRate / 1000).toFixed(1)} kHz` : null, m.channels === 1 ? 'mono' : m.channels === 2 ? 'stereo' : null]
          .filter(Boolean).join(' · ') || '—';
      lines.push(`| \`${m.path}\` | ${m.kind} | ${humanDuration(m.duration)} | ${humanBitrate(m.bitrate)} | ${m.codec || '—'} | ${detail} | ${humanBytes(m.bytes)} |`);
    }
    lines.push('');
    const totalDuration = shippedMedia.reduce((sum, m) => sum + (m.duration || 0), 0);
    const totalBytes = shippedMedia.reduce((sum, m) => sum + m.bytes, 0);
    lines.push(`**${shippedMedia.length} media file${shippedMedia.length === 1 ? '' : 's'}** · ${humanDuration(totalDuration)} · ${humanBytes(totalBytes)} · average ${humanBitrate(totalDuration > 0 ? (totalBytes * 8) / totalDuration : null)}`);
  }
  lines.push('');

  const shippedFiles = gen.artifacts.filter((a) => a.exists);
  lines.push('## Files');
  lines.push('');
  if (!shippedFiles.length) {
    lines.push('_No source files were recorded for this generation._');
  } else {
    lines.push('| file | lines | size | sha256 |');
    lines.push('| --- | --- | --- | --- |');
    for (const f of shippedFiles) {
      lines.push(`| \`${f.path}\` | ${f.lines ?? '—'} | ${humanBytes(f.bytes)} | \`${f.sha256}\` |`);
    }
  }
  lines.push('');

  lines.push('## Notes');
  lines.push('');
  lines.push('- Measured from the tree with ffprobe; not written by hand.');
  lines.push('- Media is credited only when it is tracked in git — media that');
  lines.push('  lives on one machine is not part of what the project shipped.');
  const untracked = gen.media.filter((m) => m.exists && !m.tracked).length;
  if (untracked) {
    lines.push(`- ${untracked} media file${untracked === 1 ? ' is' : 's are'} present locally but untracked, and are credited as untracked.`);
  }
  lines.push('');
  return lines.join('\n');
}

const archives = [];
for (const gen of generations) {
  const entries = [];
  for (const artifact of gen.artifacts) {
    if (!artifact.exists) continue;
    const abs = path.join(ROOT, artifact.path);
    entries.push({
      name: `files/${artifact.path}`,
      data: fs.readFileSync(abs),
      mtime: fs.statSync(abs).mtime,
    });
  }
  for (const m of gen.media) {
    if (!m.embedded) continue;
    const abs = path.join(ROOT, m.path);
    if (!fs.existsSync(abs)) continue;
    entries.push({
      name: `media/${m.path}`,
      data: fs.readFileSync(abs),
      mtime: fs.statSync(abs).mtime,
    });
  }

  // The two generated entries carry the generation's own authored date, not
  // "now": a build output that changes on every build is not reproducible,
  // and `check:build-idempotent` fails on it. The date is content-derived,
  // so the archive only changes when the generation does.
  const stamp = new Date(`${gen.date}T00:00:00Z`);

  const credits = Buffer.from(creditsMarkdown(gen), 'utf8');
  entries.push({ name: 'CREDITS.md', data: credits, mtime: stamp });

  const manifest = {
    generation: gen.id,
    era: gen.era,
    kind: gen.kind,
    date: gen.date,
    title: gen.title,
    story: gen.story,
    facts: gen.facts || null,
    files: gen.artifacts.map((a) => ({ path: a.path, label: a.label, href: a.href, bytes: a.bytes, lines: a.lines, sha256: a.sha256 })),
    media: gen.media.map((m) => ({
      path: m.path,
      kind: m.kind,
      embedded: m.embedded,
      duration: m.duration,
      bitrate: m.bitrate,
      codec: m.codec,
      sampleRate: m.sampleRate,
      channels: m.channels,
      width: m.width,
      height: m.height,
      bytes: m.bytes,
    })),
    credits: gen.credits,
  };
  entries.push({
    name: 'MANIFEST.json',
    data: Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, 'utf8'),
    mtime: stamp,
  });

  const zip = createZip(entries);
  const file = path.join(OUT_ZIPS, `${gen.id}.zip`);
  fs.writeFileSync(file, zip);
  archives.push({ id: gen.id, bytes: zip.length, entries: entries.length });
  gen.credits.archive = `generations/${gen.id}.zip`;
  gen.credits.archiveBytes = zip.length;
  gen.credits.archiveEntries = entries.length;
}

// The archive size is part of the data the page shows, so the file is
// written again now that the archives exist.
fs.writeFileSync(OUT_JSON, `${JSON.stringify(out, null, 2)}\n`);

const totalArchive = archives.reduce((sum, a) => sum + a.bytes, 0);
console.log(`generations: ${generations.length} records, ${archives.length} archives, ${humanBytes(totalArchive)}`);
for (const a of archives) {
  console.log(`  ${a.id.padEnd(28)} ${humanBytes(a.bytes).padStart(10)}  ${a.entries} entries`);
}
