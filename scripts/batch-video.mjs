#!/usr/bin/env node
// scripts/batch-video.mjs — batch audio-reactive MP4 generator.
//
// For each input MP3/WAV in --input (file or directory of MP3/WAV):
//   1. analyze via audio-analysis-v2.js in headless Chrome
//   2. pick a versions/<variant>.html via lib/variant-picker.mjs
//   3. render full-song MP4 via scripts/render-full-song.mjs (CDP screenshot pipeline)
//
// Writes a summary.json to --output with the analysis + pick + render
// outcome per song.
//
// Usage:
//   node scripts/batch-video.mjs --input <dir|file.mp3> --output <dir> \
//     [--variant <name>] [--parallel N] [--fps N] [--width N] [--height N] \
//     [--quiet] [--keep-analysis]
//
//   --variant     override the picker (use a specific engine page)
//   --parallel N  spawn N child Node processes (each with its own Puppeteer)
//                 to render songs in parallel. Default 1.
//   --fps N       capture fps for the renderer (default 24; 12 = draft mode)
//   --quiet       suppress per-render progress logs

import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import puppeteer from 'puppeteer';
import { pick } from '../lib/variant-picker.mjs';

const args = parseArgs(process.argv.slice(2));
if (!args.input && !args.manifest) {
  console.error('usage: node scripts/batch-video.mjs --input <dir|file> --output <dir> [options]\n       or: node scripts/batch-video.mjs --manifest <jobs.json> --output <dir> [options]');
  process.exit(2);
}
const outDir = path.resolve(args.output);
fs.mkdirSync(outDir, { recursive: true });

// --manifest <file.json> lets the caller specify an explicit job list
// instead of an --input directory glob. Format:
//   [
//     { "input": "/abs/path/song.mp3", "variant": "film", "library": ["/abs/clip.mp4"] },
//     { "input": "/abs/path/other.mp3" }   // variant omitted -> picker decides
//   ]
// Useful for reproducible demos: capture the picks for a folder, save
// as a manifest, then re-run with --manifest to render the same set.
let inputs, customVariantForInput = null;
if (args.manifest) {
  const manifestPath = path.resolve(args.manifest);
  if (!fs.existsSync(manifestPath)) {
    console.error(`manifest not found: ${manifestPath}`);
    process.exit(2);
  }
  const jobs = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (!Array.isArray(jobs) || jobs.length === 0) {
    console.error('manifest must be a non-empty JSON array');
    process.exit(2);
  }
  inputs = [];
  customVariantForInput = new Map();
  for (const job of jobs) {
    if (!job.input || !fs.existsSync(job.input)) {
      console.error(`manifest job has missing or invalid input: ${JSON.stringify(job)}`);
      process.exit(2);
    }
    inputs.push(path.resolve(job.input));
    if (job.variant) customVariantForInput.set(inputs[inputs.length - 1], job.variant);
  }
} else {
  const inputArg = path.resolve(args.input);
  inputs = discoverInputs(inputArg);
  if (inputs.length === 0) { console.error('no mp3/wav inputs found at', inputArg); process.exit(2); }
}
console.log(`batch: ${inputs.length} input(s), output -> ${outDir}, parallel=${args.parallel}, fps=${args.fps}`);

const parallel = args.parallel;
const analyzeOnly = args.analyzeOnly;
const skipExisting = args.skipExisting;
const maxRetries = args.retry;

// === Step 1: analyze all inputs (single Puppeteer is fine for this) ===
const analyses = await analyzeAll(inputs);
const summary = [];

// --analyze-only: print picks table and exit before any rendering.
if (analyzeOnly) {
  console.log('\n--- picks ---');
  for (let i = 0; i < inputs.length; i++) {
    const inPath = inputs[i];
    const a = analyses[i];
    const pick_ = pickVariantFor(inPath, a);
    console.log(`${path.basename(inPath).padEnd(50)}  -> ${pick_.variant.padEnd(14)} (score ${pick_.score.toFixed(2)})  ${pick_.rationale}`);
    summary.push({ input: inPath, pick: pick_, analysis: trimAnalysis(a), render: null, wallMs: 0 });
  }
  const summaryPath = path.join(outDir, 'summary.json');
  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));
  console.log(`\nanalyze-only: ${summary.length} picks -> ${summaryPath}`);
  process.exit(0);
}

// === Step 2: render each ================================================
function pickVariantFor(inPath, analysis) {
  // Per-input override from --manifest beats CLI --variant; CLI beats picker.
  const perInput = customVariantForInput && customVariantForInput.get(inPath);
  if (perInput) return { variant: perInput, score: 999, rationale: 'manifest-override', allScores: {}, features: analysis.features || {} };
  if (args.variant) return { variant: args.variant, score: 999, rationale: 'cli-override', allScores: {}, features: analysis.features || {} };
  return pick(analysis);
}

if (parallel <= 1) {
  // Sequential in this process — import renderVariant and call directly.
  const { renderVariant } = await import('./render-full-song.mjs');
  for (let i = 0; i < inputs.length; i++) {
    const inPath = inputs[i];
    const a = analyses[i];
    const pick_ = pickVariantFor(inPath, a);
    const outPath = path.join(outDir, path.basename(inPath, path.extname(inPath)) + '.' + pick_.variant + '.mp4');
    const t0 = Date.now();
    if (skipExisting && shouldSkip(outPath)) {
      if (!args.quiet) console.log(`skip ${path.basename(inPath)} -> ${path.basename(outPath)} (exists)`);
      summary.push({ input: inPath, ok: true, output: outPath, skipped: true,
                     analysis: trimAnalysis(a), pick: pick_, wallMs: 0 });
      continue;
    }
    let lastErr;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const r = await renderVariant({
          inputPath: inPath, outPath,
          variant: pick_.variant,
          fps: args.fps,
          width: args.width, height: args.height,
          quiet: args.quiet,
        });
        summary.push({ input: inPath, ok: true, output: outPath, analysis: trimAnalysis(a),
                       pick: pick_, render: r, attempts: attempt + 1, wallMs: Date.now() - t0 });
        lastErr = null;
        break;
      } catch (e) {
        lastErr = e;
        if (!args.quiet) console.error(`FAIL ${path.basename(inPath)} attempt ${attempt + 1}/${maxRetries + 1}: ${e.message}`);
        // Remove partial output so the next attempt starts clean
        try { fs.unlinkSync(outPath); } catch (_) {}
      }
    }
    if (lastErr) {
      summary.push({ input: inPath, ok: false, error: lastErr.message,
                     analysis: trimAnalysis(a), pick: pick_ });
    }
  }
} else {
  // Parallel: each render is its own Node child process. Each child
  // loads render-full-song.mjs as if invoked standalone for one song.
  // This sidesteps CDP-browser contention between concurrent browsers.
  const queue = inputs.map((inPath, i) => ({ inPath, a: analyses[i], pick_: pickVariantFor(inPath, analyses[i]) }));
  const slots = Array.from({ length: Math.min(parallel, queue.length) }, () => ({ busy: false }));
  // Spawn a worker pool. Each slot processes one job at a time, taking
  // the next job from the queue when the previous one finishes. This
  // guarantees `parallel` jobs run concurrently — no recursive chain.
  function runSlot(slot) {
    return new Promise((resolveAll) => {
      const next = () => {
        const job = queue.shift();
        if (!job) return resolveAll();
        slot.busy = true;
        const outPath = path.join(outDir, path.basename(job.inPath, path.extname(job.inPath)) + '.' + job.pick_.variant + '.mp4');
        // Skip if output already exists.
        if (skipExisting && shouldSkip(outPath)) {
          if (!args.quiet) console.log(`skip ${path.basename(job.inPath)} -> ${path.basename(outPath)} (exists)`);
          summary.push({ input: job.inPath, ok: true, output: outPath, skipped: true,
                         analysis: trimAnalysis(job.a), pick: job.pick_, wallMs: 0 });
          slot.busy = false;
          next();
          return;
        }
        // Spawn a render with retry loop. Each attempt is a fresh child
        // process so transient state (browser, port, etc.) is fully reset.
        const t0 = Date.now();
        let attemptIdx = 0;
        const spawnAttempt = () => {
          attemptIdx++;
          const child = spawn(process.execPath, [
            path.resolve('scripts/render-full-song.mjs'),
            job.inPath, outPath,
            '--variant', job.pick_.variant,
          ], { stdio: ['ignore', 'pipe', 'pipe'] });
          let stderr = '';
          child.stderr.on('data', (d) => { stderr += d.toString(); if (!args.quiet) process.stderr.write(d); });
          child.stdout.on('data', (d) => { if (!args.quiet) process.stdout.write(d); });
          child.on('exit', (code) => {
            const ok = code === 0 && shouldSkip(outPath);
            if (ok) {
              summary.push({
                input: job.inPath, ok: true, output: outPath,
                analysis: trimAnalysis(job.a), pick: job.pick_,
                attempts: attemptIdx, wallMs: Date.now() - t0,
              });
              slot.busy = false;
              next();
            } else if (attemptIdx <= maxRetries) {
              if (!args.quiet) console.error(`FAIL ${path.basename(job.inPath)} attempt ${attemptIdx}/${maxRetries + 1}: exit ${code}`);
              try { fs.unlinkSync(outPath); } catch (_) {}
              spawnAttempt();
            } else {
              summary.push({
                input: job.inPath, ok: false,
                analysis: trimAnalysis(job.a), pick: job.pick_,
                attempts: attemptIdx,
                error: stderr.split('\n').slice(-3).join('\n') || `exit ${code}`,
              });
              if (!args.quiet) console.error(`FAIL ${path.basename(job.inPath)} after ${attemptIdx} attempts`);
              slot.busy = false;
              next();
            }
          });
        };
        spawnAttempt();
      };
      next();
    });
  }
  await Promise.all(slots.map(runSlot));
}

const summaryPath = path.join(outDir, 'summary.json');
fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));
console.log(`\nbatch done: ${summary.filter(s => s.ok).length}/${summary.length} ok`);
console.log(`summary -> ${summaryPath}`);

// === helpers ==============================================================
function parseArgs(argv) {
  const out = { parallel: 1, fps: 24, width: 640, height: 360, quiet: false,
                analyzeOnly: false, skipExisting: false, retry: 0, manifest: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--input') out.input = argv[++i];
    else if (a === '--output') out.output = argv[++i];
    else if (a === '--variant') out.variant = argv[++i];
    else if (a === '--parallel') out.parallel = parseInt(argv[++i], 10);
    else if (a === '--fps') out.fps = parseInt(argv[++i], 10);
    else if (a === '--width') out.width = parseInt(argv[++i], 10);
    else if (a === '--height') out.height = parseInt(argv[++i], 10);
    else if (a === '--quiet') out.quiet = true;
    else if (a === '--analyze-only') out.analyzeOnly = true;
    else if (a === '--skip-existing') out.skipExisting = true;
    else if (a === '--retry') out.retry = parseInt(argv[++i], 10);
    else if (a === '--manifest') out.manifest = argv[++i];
    else if (a === '--help' || a === '-h') {
      console.log(`batch-video.mjs — analyze audio + render MP4 per song
Usage: node scripts/batch-video.mjs --input <dir|file> --output <dir> [options]
       node scripts/batch-video.mjs --manifest <jobs.json> --output <dir> [options]

Options:
  --variant <name>     override picker; force this variant for every song
  --parallel N         spawn N concurrent Node child processes (each its own browser)
  --fps N              capture fps (default 24; 12 = draft mode)
  --width N --height N viewport + capture dimensions (default 640x360)
  --analyze-only       run analyzer + picker, print picks, exit before rendering
  --skip-existing      skip a song if <out>/<song>.<variant>.mp4 already exists (>=100KB)
  --retry N            retry a failed render up to N times before giving up
  --manifest <file>    JSON array of {input, variant?, library?} jobs (instead of --input glob)
  --quiet              suppress per-render progress logs

Output: writes <song>.<variant>.mp4 + summary.json to --output.
`);
      process.exit(0);
    }
    else { console.error(`unknown flag: ${a}`); process.exit(2); }
  }
  return out;
}

// Returns true if --skip-existing should skip this job. We consider
// the output "present" only if the file is at least 100KB — a typical
// rendered MP4 is multi-MB; anything smaller is a half-written file
// from a previous failed render that should be re-attempted.
const MIN_VALID_OUTPUT_SIZE = 100 * 1024;
function shouldSkip(outPath) {
  try {
    const st = fs.statSync(outPath);
    return st.size >= MIN_VALID_OUTPUT_SIZE;
  } catch (_) {
    return false;
  }
}

function discoverInputs(arg) {
  const stat = fs.statSync(arg);
  if (stat.isFile()) return [arg];
  if (stat.isDirectory()) {
    return fs.readdirSync(arg)
      .filter((f) => /\.(mp3|wav|m4a|flac|ogg)$/i.test(f))
      .map((f) => path.join(arg, f))
      .sort();
  }
  return [];
}

function trimAnalysis(a) {
  if (!a) return null;
  // Drop the giant onsets array; keep bucketed features + chroma + key/scale.
  const { onsets, ...rest } = a;
  return rest;
}

async function analyzeAll(inputs) {
  // Delegate to scripts/analyze-mp3.mjs's CLI per-file to keep the
  // analyzer code in one place. Spawn one child per input.
  const child = spawn(process.execPath, [
    path.resolve('scripts/analyze-mp3.mjs'),
    ...inputs,
  ], { stdio: ['ignore', 'pipe', 'inherit'] });
  let buf = '';
  child.stdout.on('data', (d) => { buf += d.toString(); });
  await new Promise((resolve, reject) => {
    child.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`analyze-mp3 exit ${code}`)));
  });
  const lines = buf.trim().split('\n').filter(Boolean);
  return lines.map((line) => JSON.parse(line));
}