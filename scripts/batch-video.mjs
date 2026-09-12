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
if (!args.input || !args.output) {
  console.error('usage: node scripts/batch-video.mjs --input <dir|file> --output <dir> [--variant <name>] [--parallel N] [--fps N]');
  process.exit(2);
}
const inputArg = path.resolve(args.input);
const outDir = path.resolve(args.output);
fs.mkdirSync(outDir, { recursive: true });

const inputs = discoverInputs(inputArg);
if (inputs.length === 0) { console.error('no mp3/wav inputs found at', inputArg); process.exit(2); }
console.log(`batch: ${inputs.length} input(s), output -> ${outDir}, parallel=${args.parallel}, fps=${args.fps}`);

const parallel = args.parallel;

// === Step 1: analyze all inputs (single Puppeteer is fine for this) ===
const analyses = await analyzeAll(inputs);
const summary = [];

// === Step 2: render each ================================================
if (parallel <= 1) {
  // Sequential in this process — import renderVariant and call directly.
  const { renderVariant } = await import('./render-full-song.mjs');
  for (let i = 0; i < inputs.length; i++) {
    const inPath = inputs[i];
    const a = analyses[i];
    const pick_ = args.variant ? { variant: args.variant, score: 999, rationale: 'cli-override', allScores: {}, features: a.features || {} } : pick(a);
    const outPath = path.join(outDir, path.basename(inPath, path.extname(inPath)) + '.' + pick_.variant + '.mp4');
    const t0 = Date.now();
    try {
      const r = await renderVariant({
        inputPath: inPath, outPath,
        variant: pick_.variant,
        fps: args.fps,
        width: args.width, height: args.height,
        quiet: args.quiet,
      });
      summary.push({ input: inPath, ok: true, output: outPath, analysis: trimAnalysis(a),
                     pick: pick_, render: r, wallMs: Date.now() - t0 });
    } catch (e) {
      summary.push({ input: inPath, ok: false, error: e.message,
                     analysis: trimAnalysis(a), pick: pick_ });
      console.error(`FAIL ${path.basename(inPath)}: ${e.message}`);
    }
  }
} else {
  // Parallel: each render is its own Node child process. Each child
  // loads render-full-song.mjs as if invoked standalone for one song.
  // This sidesteps CDP-browser contention between concurrent browsers.
  const queue = inputs.map((inPath, i) => ({ inPath, a: analyses[i], pick_: args.variant ? { variant: args.variant, score: 999, rationale: 'cli-override' } : pick(analyses[i]) }));
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
        const t0 = Date.now();
        const child = spawn(process.execPath, [
          path.resolve('scripts/render-full-song.mjs'),
          job.inPath, outPath,
          '--variant', job.pick_.variant,
        ], { stdio: ['ignore', 'pipe', 'pipe'] });
        let stderr = '';
        child.stderr.on('data', (d) => { stderr += d.toString(); if (!args.quiet) process.stderr.write(d); });
        child.stdout.on('data', (d) => { if (!args.quiet) process.stdout.write(d); });
        child.on('exit', (code) => {
          const ok = code === 0 && fs.existsSync(outPath);
          summary.push({
            input: job.inPath, ok, output: ok ? outPath : null,
            analysis: trimAnalysis(job.a),
            pick: job.pick_,
            wallMs: Date.now() - t0,
            ...(ok ? {} : { error: stderr.split('\n').slice(-3).join('\n') || `exit ${code}` }),
          });
          if (!ok && !args.quiet) console.error(`FAIL ${path.basename(job.inPath)}: ${code !== 0 ? `exit ${code}` : 'output missing'}`);
          slot.busy = false;
          next();
        });
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
  const out = { parallel: 1, fps: 24, width: 640, height: 360, quiet: false };
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
  }
  return out;
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