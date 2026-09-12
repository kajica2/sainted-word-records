#!/usr/bin/env node
// verify-curator-batch.mjs — batch-run client/asset-curator.client.js over a
// directory of image files.
//
// Usage:
//   node verify-curator-batch.mjs <input-dir> [--out <out-dir>] [--no-hf]
//                                  [--pattern <comma-separated globs>]
//                                  [--engine <url>] [--port <n>]
//
// What it does:
//   1. Boots a local static server rooted at the repo (so asset-curator's
//      fetch calls resolve to something)
//   2. Loads engine.html in headless Chrome (which installs the curator on
//      window.SWR_ASSET_CURATOR)
//   3. For each matching input file: reads → base64 → File in page →
//      window.SWR_ASSET_CURATOR.process(file)
//   4. Decodes the cleaned Blob back to disk
//   5. Writes curated-manifest.json + a per-file summary table
//
// No HF: set window.__SWR_HF_DISABLED = true (matches the curator's opt-out
// guard). Default is --no-hf; pass --hf to re-enable.
//
// Exit code 0 on full success, 1 if any file failed processing.

import http from 'http';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
import puppeteer from 'puppeteer';

const __filename = fileURLToPath(import.meta.url);
const ROOT = path.dirname(__filename);
const DEFAULT_PORT = 8095;

// ─── arg parsing ──────────────────────────────────────────────────────
function parseArgs(argv) {
  const args = argv.slice(2);
  if (!args.length || args[0] === '-h' || args[0] === '--help') {
    printUsage();
    process.exit(args[0] ? 0 : 1);
  }
  const opts = {
    inputDir: null,
    outDir: path.join(os.homedir(), 'Downloads', 'curated-output'),
    noHf: true,         // default OFF (matches user's standing preference)
    pattern: '*.png,*.jpg,*.jpeg',
    engine: '_curator-runner.html',
    port: DEFAULT_PORT,
  };
  // Positional: first non-flag arg is input dir
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--out')         opts.outDir = path.resolve(args[++i]);
    else if (a === '--no-hf')  opts.noHf = true;
    else if (a === '--hf')     opts.noHf = false;
    else if (a === '--pattern')opts.pattern = args[++i];
    else if (a === '--engine') opts.engine = args[++i];
    else if (a === '--port')   opts.port = parseInt(args[++i], 10);
    else if (!a.startsWith('-') && !opts.inputDir) opts.inputDir = path.resolve(a);
    else { console.error('unknown arg:', a); printUsage(); process.exit(1); }
  }
  if (!opts.inputDir) {
    console.error('input dir required');
    printUsage();
    process.exit(1);
  }
  return opts;
}
function printUsage() {
  console.log(`Usage: node verify-curator-batch.mjs <input-dir>
                [--out <out-dir>]
                [--no-hf | --hf]
                [--pattern <comma-globs>]    default: *.png,*.jpg,*.jpeg
                [--engine <relpath>]         default: _curator-runner.html
                [--port <n>]                 default: ${DEFAULT_PORT}`);
}

// ─── local static server ──────────────────────────────────────────────
function bootServer(rootDir, port, engine) {
  return new Promise((resolve) => {
    const MIME = {
      '.html':'text/html','.js':'text/javascript','.mjs':'text/javascript',
      '.css':'text/css','.json':'application/json','.svg':'image/svg+xml',
      '.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg',
      '.webp':'image/webp','.gif':'image/gif',
      '.wav':'audio/wav','.mp3':'audio/mpeg','.mp4':'video/mp4','.webm':'video/webm',
    };
    const server = http.createServer((req, res) => {
      const rel = decodeURIComponent((req.url || '/').split('?')[0].replace(/^\/+/, '')) || engine;
      const file = path.join(rootDir, rel);
      if (!file.startsWith(rootDir) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        res.writeHead(404); res.end('nf'); return;
      }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' });
      fs.createReadStream(file).pipe(res);
    });
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}

// ─── file enumeration ─────────────────────────────────────────────────
function enumerateFiles(inputDir, pattern) {
  const globs = pattern.split(',').map((g) => g.trim()).filter(Boolean);
  const all = fs.readdirSync(inputDir, { withFileTypes: true });
  return all
    .filter((d) => d.isFile() && globs.some((g) => matchGlob(g, d.name)))
    .map((d) => path.join(inputDir, d.name));
}
function matchGlob(glob, name) {
  // Tiny case-insensitive matcher: supports '*' wildcards only.
  const rx = new RegExp(
    '^' + glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$',
    'i'
  );
  return rx.test(name);
}

// ─── puppeteer runner ─────────────────────────────────────────────────
async function processFile(page, inputPath, opts) {
  const buf = fs.readFileSync(inputPath);
  const b64 = buf.toString('base64');
  const ext = path.extname(inputPath).toLowerCase();
  const mime =
    ext === '.png'  ? 'image/png'  :
    ext === '.jpg'  ? 'image/jpeg' :
    ext === '.jpeg' ? 'image/jpeg' :
    ext === '.webp' ? 'image/webp' :
    'application/octet-stream';
  const name = path.basename(inputPath);

  const result = await page.evaluate(
    async (b64, name, mime) => {
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const file = new File([bytes], name, { type: mime });
      const r = await window.SWR_ASSET_CURATOR.process(file);
      // Serialize: re-encode cleaned Blob to base64 so Node can decode.
      const outBuf = new Uint8Array(await r.file.arrayBuffer());
      let outB64 = '';
      // chunked to avoid call-stack limits on very large arrays
      const CHUNK = 0x8000;
      for (let i = 0; i < outBuf.length; i += CHUNK) {
        outB64 += String.fromCharCode.apply(null, outBuf.subarray(i, i + CHUNK));
      }
      outB64 = btoa(outB64);
      return {
        folder: r.folder,
        tags: r.tags,
        status: r.status,
        tookMs: r.tookMs,
        backgroundColor: r.backgroundColor,
        outB64,
        outType: r.file.type || mime,
      };
    },
    b64, name, mime
  );

  // Decode cleaned blob to disk
  const outName = name;
  const outPath = path.join(opts.outDir, outName);
  const cleaned = Buffer.from(result.outB64, 'base64');
  fs.writeFileSync(outPath, cleaned);

  return {
    src: inputPath,
    out: outPath,
    folder: result.folder,
    tags: result.tags,
    status: result.status,
    tookMs: result.tookMs,
    backgroundColor: result.backgroundColor,
    bytesIn: buf.length,
    bytesOut: cleaned.length,
    mime: result.outType,
  };
}

async function main() {
  const opts = parseArgs(process.argv);
  if (!fs.existsSync(opts.inputDir) || !fs.statSync(opts.inputDir).isDirectory()) {
    console.error('input dir does not exist or is not a directory:', opts.inputDir);
    process.exit(1);
  }
  fs.mkdirSync(opts.outDir, { recursive: true });

  const inputs = enumerateFiles(opts.inputDir, opts.pattern);
  if (!inputs.length) {
    console.error('no files matched in', opts.inputDir, 'with pattern', opts.pattern);
    process.exit(1);
  }
  console.log(`[curator-batch] ${inputs.length} files matched`);
  console.log(`[curator-batch] output dir: ${opts.outDir}`);
  console.log(`[curator-batch] HF: ${opts.noHf ? 'disabled' : 'enabled'}`);

  const server = await bootServer(ROOT, opts.port, opts.engine);
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });
  let exitCode = 0;
  try {
    const page = await browser.newPage();
    page.on('console', (m) => {
      const t = m.type();
      if (t === 'error' || t === 'warning') {
        console.log(`  [page:${t}] ${m.text()}`);
      }
    });

    await page.goto(`http://127.0.0.1:${opts.port}/${opts.engine}`, { waitUntil: 'domcontentloaded', timeout: 30000 });

    // Wait for the curator module to install
    const ready = await page.waitForFunction(
      () => !!(window.SWR_ASSET_CURATOR && typeof window.SWR_ASSET_CURATOR.process === 'function'),
      { timeout: 15000 }
    ).catch(() => null);
    if (!ready) {
      throw new Error('SWR_ASSET_CURATOR did not install within 15s');
    }
    if (opts.noHf) {
      await page.evaluate(() => { window.__SWR_HF_DISABLED = true; });
    }

    const manifest = [];
    let nOk = 0, nSkip = 0, nFail = 0;
    const startedAt = Date.now();
    for (let i = 0; i < inputs.length; i++) {
      const f = inputs[i];
      process.stdout.write(`[${String(i + 1).padStart(3)}/${inputs.length}] ${path.basename(f)} … `);
      try {
        const r = await processFile(page, f, opts);
        manifest.push(r);
        const top = (r.tags && r.tags[0] && r.tags[0].tag) || '—';
        if (r.status === 'skipped') nSkip++;
        else nOk++;
        console.log(`${r.status.padEnd(11)} ${r.folder.padEnd(20)} ${top.padEnd(18)} ${r.tookMs}ms`);
      } catch (e) {
        nFail++;
        console.log(`FAILED: ${e.message}`);
        manifest.push({ src: f, out: null, status: 'failed', error: String(e.message || e) });
        exitCode = 1;
      }
    }
    const elapsedMs = Date.now() - startedAt;

    fs.writeFileSync(
      path.join(opts.outDir, 'curated-manifest.json'),
      JSON.stringify({
        generatedAt: new Date().toISOString(),
        inputDir: opts.inputDir,
        outDir: opts.outDir,
        pattern: opts.pattern,
        hfEnabled: !opts.noHf,
        counts: { ok: nOk, skipped: nSkip, failed: nFail, total: inputs.length },
        elapsedMs,
        entries: manifest,
      }, null, 2)
    );

    console.log('');
    console.log(`[curator-batch] DONE in ${elapsedMs}ms`);
    console.log(`[curator-batch] ${nOk} ok · ${nSkip} skipped · ${nFail} failed`);
    console.log(`[curator-batch] manifest: ${path.join(opts.outDir, 'curated-manifest.json')}`);
  } finally {
    await browser.close();
    server.close();
  }
  process.exit(exitCode);
}

main().catch((e) => {
  console.error('[curator-batch] fatal:', e);
  process.exit(1);
});