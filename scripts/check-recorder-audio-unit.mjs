#!/usr/bin/env node
// scripts/check-recorder-audio-unit.mjs — the music only goes into a mime
// that can carry it.
//
// WHY THIS IS A SOURCE GATE
// -------------------------
// The export has to carry the song, or there is no beat in the file to
// follow. Two of the three recording paths used to ship a file with no audio
// at all (the WebCodecs path's audio tap threw, and swr-app.html's recorded
// stream never got an audio track) — see scripts/check-recorder-verify.mjs,
// which proves the outcome in a browser.
//
// There is a third way for the music to go missing, and it is the quietest
// one: a mime that names a VIDEO-ONLY codec list. `video/mp4;codecs=avc1`
// has no audio codec in it, so an audio track on such a stream is refused by
// the recorder or dropped from the file — the export comes out mute, with
// nothing in the logs to say why. The recorder has to know which mimes can
// carry audio BEFORE it tapes the song in, not after.
//
// WHAT THIS ASSERTS
// -----------------
// For every page that records:
//
//   1. The page knows which mimes can carry audio — and knows it CORRECTLY.
//      The rule is executed, not merely present: the helper is lifted out of
//      the shipped source and run against a table of mimes, so a helper that
//      always returns true fails the gate.
//
//   2. Every place where an audio track is put on the recorded stream sits
//      under that rule. A track taped in unconditionally is the defect.
//
//   3. The first candidate in every mime list can carry audio, so the
//      recorder prefers a mime that holds the song over a video-only one it
//      happens to reach first.
//
// Run: node scripts/check-recorder-audio-unit.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// The pages that record. neon.html is generated from versions/neon.html
// (scripts/sync-root-neon.mjs) and is checked separately so the generator
// cannot quietly drop the fix.
const PAGES = ['versions/neon.html', 'neon.html', 'engine.html', 'swr-app.html'];

const HELPER = 'mimeCanCarryAudio';

/**
 * What a mime can carry.
 *
 * A mime with a codec list can carry audio only if the list names an audio
 * codec. A mime with NO codec list lets the browser choose its own defaults,
 * and those defaults include audio — `video/mp4` means H.264 + AAC.
 */
const CASES = [
  ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', true],
  ['video/mp4;codecs=avc1,mp4a.40.2', true],
  ['video/mp4;codecs=h264,aac', true],
  ['video/webm;codecs=vp9,opus', true],
  ['video/webm;codecs=vp8,opus', true],
  ['video/mp4;codecs=avc1', false],
  ['video/mp4;codecs=avc1.42E01E', false],
  ['video/webm;codecs=vp9', false],
  ['video/mp4', true],
  ['video/webm', true],
  ['', true],
];

const checks = [];
const pass = (m, d) => { checks.push({ ok: true, m, d }); console.log('PASS:', m, d ? `(${d})` : ''); };
const fail = (m, d) => { checks.push({ ok: false, m, d }); console.log('FAIL:', m, d ? `(${d})` : ''); };

/**
 * The source with every string, template, comment and regex blanked out —
 * the characters replaced by spaces, so every offset still points at the
 * same place in the original.
 *
 * The gate has to know which `if` block a line of code sits in, and that
 * cannot be answered with a regex: a brace inside a string is not a brace.
 */
function blankOut(src) {
  const out = src.split('');
  const n = src.length;
  const blank = (from, to) => {
    for (let k = from; k < to && k < n; k++) if (out[k] !== '\n') out[k] = ' ';
  };
  // The last significant character, so a '/' can be told apart from the
  // start of a regex.
  let prev = '';
  let i = 0;
  while (i < n) {
    const ch = src[i];
    if (ch === '/' && src[i + 1] === '/') {
      let j = i;
      while (j < n && src[j] !== '\n') j++;
      blank(i, j); i = j; continue;
    }
    if (ch === '/' && src[i + 1] === '*') {
      let j = src.indexOf('*/', i + 2);
      j = j === -1 ? n : j + 2;
      blank(i, j); i = j; continue;
    }
    if (ch === '/' && /[(,=:[!&|?{};+\-*%~^<>]/.test(prev)) {
      let j = i + 1;
      let inClass = false;
      let closed = false;
      while (j < n) {
        const c = src[j];
        if (c === '\\') { j += 2; continue; }
        if (c === '[') inClass = true;
        else if (c === ']') inClass = false;
        else if (c === '/' && !inClass) { j++; closed = true; break; }
        else if (c === '\n') break;
        j++;
      }
      if (closed) { blank(i, j); i = j; prev = '/'; continue; }
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      const q = ch;
      let j = i + 1;
      while (j < n) {
        const c = src[j];
        if (c === '\\') { j += 2; continue; }
        if (c === q) { j++; break; }
        if (q !== '`' && c === '\n') break;   // unterminated
        j++;
      }
      blank(i, j); i = j; prev = 'x'; continue;
    }
    if (!/\s/.test(ch)) prev = ch;
    i++;
  }
  return out.join('');
}

/** The index of the bracket that closes the one at `open`, or -1. */
function matchPair(blanked, open, openCh, closeCh) {
  let depth = 0;
  for (let i = open; i < blanked.length; i++) {
    const c = blanked[i];
    if (c === openCh) depth++;
    else if (c === closeCh) { depth--; if (depth === 0) return i; }
  }
  return -1;
}

/** The `if (...) { ... }` blocks, as their header text and their range. */
function ifBlocks(blanked) {
  const blocks = [];
  const re = /\bif\s*\(/g;
  let m;
  while ((m = re.exec(blanked)) !== null) {
    const open = m.index + m[0].length - 1;
    const close = matchPair(blanked, open, '(', ')');
    if (close === -1) continue;
    let b = close + 1;
    while (b < blanked.length && /\s/.test(blanked[b])) b++;
    if (blanked[b] !== '{') continue;            // a braceless `if` — no block
    const e = matchPair(blanked, b, '{', '}');
    if (e === -1) continue;
    blocks.push({ header: blanked.slice(open + 1, close), from: b, to: e });
  }
  return blocks;
}

/** The innermost array literal containing `index`, or null. */
function enclosingArray(blanked, index) {
  // Walking backwards, the first '[' that opens a level is the innermost
  // array around `index`; a ']' before it means `index` is not in an array.
  let depth = 0;
  for (let i = index; i >= 0; i--) {
    const c = blanked[i];
    if (c === ']') {
      if (depth === 0) return null;
      depth--;
    } else if (c === '[') {
      depth++;
      if (depth === 1) {
        const close = matchPair(blanked, i, '[', ']');
        return close === -1 ? null : { from: i, to: close };
      }
    }
  }
  return null;
}

/** The helper, lifted out of the shipped source so it can be RUN. */
function extractHelper(src, blanked) {
  let idx = src.indexOf(`function ${HELPER}`);
  let isConst = false;
  if (idx === -1) {
    idx = src.indexOf(`const ${HELPER}`);
    if (idx === -1) return null;
    isConst = true;
  }
  let bodyStart;
  if (isConst) {
    const arrow = src.indexOf('=>', idx);
    if (arrow === -1) return null;
    bodyStart = blanked.indexOf('{', arrow);
  } else {
    const open = src.indexOf('(', idx);
    if (open === -1) return null;
    const close = matchPair(blanked, open, '(', ')');
    if (close === -1) return null;
    bodyStart = blanked.indexOf('{', close);
  }
  if (bodyStart === -1) return null;
  const bodyEnd = matchPair(blanked, bodyStart, '{', '}');
  if (bodyEnd === -1) return null;
  return { text: src.slice(idx, bodyEnd + 1), isConst };
}

/** Run the helper. A helper that cannot be run is a helper that cannot help. */
function loadHelper(text, isConst) {
  const body = isConst ? text.replace(/^const\s+/, '') : text;
  // eslint-disable-next-line no-new-func
  return new Function(body + `\nreturn ${HELPER};`)();
}

/** Where an audio track is put onto the recorded stream. */
function attachSites(src) {
  const sites = [];
  // The recorded stream is the one named `stream`; the lookbehind keeps an
  // unrelated `something.stream.addTrack(...)` out of the way.
  const re = /(?<![.\w$])stream\.addTrack\s*\(|\.push\s*\(\s*\.\.\.[^)]*getAudioTracks\s*\(\s*\)\s*\)/gi;
  let m;
  while ((m = re.exec(src)) !== null) sites.push({ index: m.index, text: m[0] });
  return sites;
}

/** The mime candidate lists: arrays of mime strings, and nothing else. */
function mimeLists(src, blanked) {
  const lists = [];
  const seen = new Set();
  const re = /['"](?:video|audio)\/[a-z0-9][^'"]*['"]/gi;
  let m;
  while ((m = re.exec(src)) !== null) {
    const arr = enclosingArray(blanked, m.index);
    if (!arr) continue;
    if (seen.has(arr.from)) continue;
    seen.add(arr.from);
    const inner = src.slice(arr.from + 1, arr.to);
    const items = inner.match(/['"](?:video|audio)\/[a-z0-9][^'"]*['"]/gi) || [];
    if (items.length < 2) continue;          // not a candidate list
    lists.push({ from: arr.from, items });
  }
  return lists;
}

for (const rel of PAGES) {
  const full = path.join(ROOT, rel);
  if (!fs.existsSync(full)) { fail(`${rel} exists`, 'file not found'); continue; }
  const src = fs.readFileSync(full, 'utf8');
  const blanked = blankOut(src);

  // ---- 1. the page knows which mimes can carry audio, and knows it right
  const helper = extractHelper(src, blanked);
  if (!helper) {
    fail(`${rel}: the page knows which mimes can carry audio`,
      `no \`${HELPER}\` helper — a recorder that tapes the music in without asking cannot know the mime will take it`);
    continue;
  }
  let fn;
  try {
    fn = loadHelper(helper.text, helper.isConst);
  } catch (err) {
    fail(`${rel}: the mime rule runs`, `the helper could not be run: ${err.message}`);
    continue;
  }
  const wrong = CASES.filter(([mime, want]) => {
    let got;
    try { got = !!fn(mime); } catch (err) { got = 'threw: ' + err.message; }
    return got !== want;
  });
  if (wrong.length) {
    fail(`${rel}: the mime rule is right`,
      wrong.map(([mime, want]) => `${mime} → ${fn(mime)} (want ${want})`).join(', '));
    continue;
  }
  pass(`${rel}: the mime rule is right`,
    `${CASES.length} mimes, ${HELPER} executed from the shipped source`);

  // ---- 2. the audio track only goes in under that rule
  const sites = attachSites(src);
  if (!sites.length) {
    fail(`${rel}: the music is taped into the recording`, 'no audio track reaches the recorded stream');
    continue;
  }
  const blocks = ifBlocks(blanked);
  const unguarded = sites.filter((site) => {
    const guarded = blocks.some((b) =>
      site.index > b.from && site.index < b.to && b.header.includes(HELPER));
    return !guarded;
  });
  if (unguarded.length) {
    fail(`${rel}: the music is taped in only under the mime rule`,
      unguarded.map((s) => `\`${s.text.replace(/\s+/g, ' ')}\` is not under a ${HELPER} guard`).join('; '));
    continue;
  }
  pass(`${rel}: the music is taped in only under the mime rule`,
    `${sites.length} attach site${sites.length === 1 ? '' : 's'}, all guarded`);

  // ---- 3. the recorder prefers a mime that can hold the song
  const lists = mimeLists(src, blanked);
  if (!lists.length) {
    fail(`${rel}: the recorder prefers a mime that can hold the song`, 'no mime candidate list found');
    continue;
  }
  const badFirst = lists.filter((l) => !fn(l.items[0].slice(1, -1)));
  if (badFirst.length) {
    fail(`${rel}: the recorder prefers a mime that can hold the song`,
      badFirst.map((l) => `the first candidate is ${l.items[0]}`).join('; '));
    continue;
  }
  pass(`${rel}: the recorder prefers a mime that can hold the song`,
    `${lists.length} candidate list${lists.length === 1 ? '' : 's'}, each led by ${lists[0].items[0]}`);
}

console.log('');
console.log(`RECORDER AUDIO: ${checks.filter((c) => c.ok).length}/${checks.length} checks passed`);
if (checks.some((c) => !c.ok)) process.exit(1);
console.log('OK');
