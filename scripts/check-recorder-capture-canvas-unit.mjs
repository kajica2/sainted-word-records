#!/usr/bin/env node
// scripts/check-recorder-capture-canvas-unit.mjs — the capture canvas must
// be IN THE DOCUMENT while it is being recorded.
//
// WHY THIS IS A SOURCE GATE
// -------------------------
// The recorder composites the live stage onto a second canvas ("the mirror"
// in versions/neon.html, "the recording canvas" in swr-app.html) and records
// THAT canvas, because captureStream() and VideoFrame both read the raw
// canvas pixels and would otherwise miss the CSS grade the stage carries.
//
// The composite canvas used to be detached — created with
// document.createElement('canvas') and never appended. On the NEON page
// that killed the recording outright: lib/watermark.client.js wraps
// HTMLCanvasElement.prototype.captureStream, so what is really recorded is
// a compositor canvas that copies its source once per frame, and its tick
// stops as soon as the source is not connected to the document
// (`if (!source.isConnected)`). A detached mirror meant the compositor was
// never painted, the recorded canvas never changed, captureStream() emitted
// no frames at all, MediaRecorder produced no data, and the export was a
// zero-byte file.
//
// The symptom was the NEON engine's "nothing captured - press REC while the
// song plays", and it only appeared on the WebM fallback path — the
// WebCodecs/MP4 path reads the canvas through VideoFrame, which works
// detached. So a browser that cannot encode H.264 fell back to a path that
// had never worked, and the take died at the end of it.
//
// The browser gate would catch this, but only on a runner and only with a
// browser that refuses H.264; a source lint says the invariant outright, in
// a second, on every machine.
//
// WHAT THIS ASSERTS
// -----------------
// For every canvas that is captured from (.captureStream()), in every page
// that records: the canvas is appended to the document, and it is removed
// again when the take ends. A canvas that is attached and never removed is
// a leak; a canvas that is never attached is a dead recording.
//
// The invariant is stated as the rule rather than as the mechanism. Whether
// a detached canvas yields frames is a browser detail — a detached canvas
// that is painted every frame still emitted frames in Chrome 158 — while
// the compositor's own "the source must be connected" guard is the rule
// that actually killed the NEON take. The invariant that survives both
// readings is the one worth enforcing: the canvas a recorder reads is in
// the document while it is recorded.
//
// Run: node scripts/check-recorder-capture-canvas-unit.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// The pages that record. neon.html is generated from versions/neon.html
// (scripts/sync-root-neon.mjs) and is checked separately so the generator
// cannot quietly drop the fix.
const PAGES = ['versions/neon.html', 'neon.html', 'swr-app.html'];

const checks = [];
const pass = (m, d) => { checks.push({ ok: true, m, d }); console.log('PASS:', m, d ? `(${d})` : ''); };
const fail = (m, d) => { checks.push({ ok: false, m, d }); console.log('FAIL:', m, d ? `(${d})` : ''); };

/** Every identifier that is captured from: `foo.captureStream(...)`. */
function capturedCanvases(src) {
  const names = new Set();
  const re = /([A-Za-z_$][\w$]*)\.captureStream\s*\(/g;
  let m;
  while ((m = re.exec(src)) !== null) names.add(m[1]);
  return [...names];
}

/** Is this variable a canvas? */
function isCanvasVar(src, name) {
  return new RegExp(`(?:const|let|var)\\s+${name}\\s*=\\s*document\\.createElement\\(\\s*['"]canvas['"]\\s*\\)`).test(src);
}

/**
 * The canvas that ends up being captured from.
 *
 * The capture is often through an alias — versions/neon.html records
 * `captureSource`, which is the stage until the mirror takes over:
 *
 *     let captureSource = stage;
 *     ...
 *     captureSource = mirror;        // the mirror is what gets recorded
 *     ...
 *     const vstream = captureSource.captureStream(fps);
 *
 * So the captured identifier is resolved to every canvas it can be assigned.
 */
function captureCanvasVars(src) {
  const out = new Set();
  for (const cap of capturedCanvases(src)) {
    if (isCanvasVar(src, cap)) { out.add(cap); continue; }
    const re = new RegExp(`(?:^|[;\\n])\\s*(?:const|let|var)?\\s*${cap}\\s*=\\s*([A-Za-z_$][\\w$]*)`, 'g');
    let m;
    while ((m = re.exec(src)) !== null) {
      if (isCanvasVar(src, m[1])) out.add(m[1]);
    }
  }
  return [...out];
}

function isAttached(src, name) {
  return new RegExp(`(?:document\\.body|document\\.documentElement)\\.(?:appendChild|append)\\s*\\(\\s*${name}\\s*\\)`).test(src)
    || new RegExp(`\\.appendChild\\s*\\(\\s*${name}\\s*\\)`).test(src);
}

function isRemoved(src, name) {
  if (new RegExp(`\\.removeChild\\s*\\(\\s*${name}\\s*\\)`).test(src)) return true;
  if (new RegExp(`\\.remove\\s*\\(\\s*\\)`).test(src) && new RegExp(`${name}[^;]*\\.remove\\s*\\(`).test(src)) return true;
  return false;
}

for (const rel of PAGES) {
  const full = path.join(ROOT, rel);
  if (!fs.existsSync(full)) { fail(`${rel} exists`, 'file not found'); continue; }
  const src = fs.readFileSync(full, 'utf8');

  const targets = captureCanvasVars(src);
  if (!targets.length) {
    fail(`${rel}: a canvas is captured from`, 'no canvas variable was found with .captureStream()');
    continue;
  }

  for (const name of targets) {
    if (!isAttached(src, name)) {
      fail(`${rel}: the capture canvas "${name}" is in the document while recording`,
        `"${name}" is never appended — the canvas a recorder reads has to be in the document`);
      continue;
    }
    if (!isRemoved(src, name)) {
      fail(`${rel}: the capture canvas "${name}" is removed when the take ends`,
        `"${name}" is attached but never removed — it would stay in the document`);
      continue;
    }
    pass(`${rel}: the capture canvas "${name}" is in the document while recording, and removed after`,
      'attached on capture, removed on teardown');
  }
}

console.log('');
console.log(`RECORDER CAPTURE CANVAS: ${checks.filter((c) => c.ok).length}/${checks.length} checks passed`);
if (checks.some((c) => !c.ok)) process.exit(1);
console.log('OK');
