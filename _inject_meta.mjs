#!/usr/bin/env node
// _inject_meta.mjs — add og:/twitter:/description/favicon meta tags to
// every versions/<engine>.html so they preview properly when shared on
// social platforms.
//
// Idempotent: re-running reports "skipped" for pages already patched.
//
// The preset dict in versions-presets.js is the source of truth for the
// per-engine label and description.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PRESETS = fs.readFileSync(path.join(__dirname, 'versions-presets.js'), 'utf8');

// Extract label + desc per preset (matches the JS literal shape)
function getMeta(key) {
  const re = new RegExp(`\\b${key}:\\s*\\{[\\s\\S]*?label:\\s*'([^']*)'`);
  const labelM = re.exec(PRESETS);
  const descRe = new RegExp(`\\b${key}:\\s*\\{[\\s\\S]*?desc:\\s*'([^']*)'`);
  const descM = descRe.exec(PRESETS);
  return labelM && descM ? { label: labelM[1], desc: descM[1] } : null;
}

const META_TPL = (label, desc) => `
  <meta name="description" content="${desc}" />
  <meta name="theme-color" content="#0a0d12" />
  <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
  <link rel="icon" type="image/x-icon" href="/favicon.ico" />
  <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
  <meta property="og:type" content="website" />
  <meta property="og:site_name" content="Sainted Word Records" />
  <meta property="og:title" content="${label} · SWR engine" />
  <meta property="og:description" content="${desc}" />
  <meta property="og:image" content="/keyart/${label.toLowerCase()}.png" />
  <meta property="og:url" content="https://sainted-word-records.vercel.app/versions/${label.toLowerCase()}.html" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${label} · SWR engine" />
  <meta name="twitter:description" content="${desc}" />
  <meta name="twitter:image" content="/keyart/${label.toLowerCase()}.png" />`;

const ENGINES = [
  'aurora', 'baroque', 'chrome', 'eclipse', 'film', 'fractal', 'gallery',
  'glitch', 'grid', 'hallucination', 'kraft', 'mosaic', 'neon', 'phosphor',
  'pulse', 'smoke', 'tape', 'void', 'watercolor',
];

let patched = 0, skipped = 0, failed = 0;
for (const name of ENGINES) {
  const meta = getMeta(name);
  if (!meta) { console.log(`  ${name}: no preset entry, skip`); failed++; continue; }
  const file = path.join(__dirname, 'versions', `${name}.html`);
  let src = fs.readFileSync(file, 'utf8');
  if (src.includes('og:title') || src.includes('property="og:image"')) {
    console.log(`  ${name}.html: skipped (already has og tags)`);
    skipped++;
    continue;
  }
  // Inject immediately after the <title> tag so all og: and twitter:
  // siblings land in <head>.
  const m = src.match(/<title>[^<]*<\/title>/);
  if (!m) { console.log(`  ${name}.html: FAILED (no <title>)`); failed++; continue; }
  src = src.replace(m[0], m[0] + META_TPL(meta.label, meta.desc));
  fs.writeFileSync(file, src, 'utf8');
  console.log(`  ${name}.html: patched (label="${meta.label}")`);
  patched++;
}
console.log(`\n${patched} patched, ${skipped} skipped, ${failed} failed`);
process.exit(failed ? 1 : 0);
