// scripts/check-kit-zip-unit.mjs — unit coverage for kit-zip.js
//
// Asserts the local ZIP writer produces valid PKZIP bytes for empty
// inputs, single-file inputs, and multi-file inputs (with files that
// contain both ASCII + binary bytes). Also asserts the central
// directory record positions match the local file headers.

import { Buffer } from 'node:buffer';
import { buildZipFromItems, itemsHash } from '../api/_lib/kit-zip.js';

const results = [];
async function check(name, fn) {
  let ok = false, detail = '';
  try {
    const r = await fn();
    ok = r === true;
    detail = typeof r === 'string' ? r : '';
  } catch (e) {
    detail = e.message + (e.stack ? '\n' + e.stack.split('\n').slice(1, 3).join('\n') : '');
  }
  results.push({ name, ok, detail });
  console.log((ok ? '  PASS  ' : '  FAIL  ') + name + (detail ? ' — ' + detail : ''));
}

// ---- zip layout -----------------------------------------------------------

function readU32LE(b, o) { return b.readUInt32LE(o); }
function readU16LE(b, o) { return b.readUInt16LE(o); }

function findEOCD(buf) {
  // EOCD signature 0x06054b50 lives somewhere in the last 64K + 22 bytes
  const sig = 0x06054b50;
  const start = Math.max(0, buf.length - 65557);
  for (let i = buf.length - 22; i >= start; i--) {
    if (readU32LE(buf, i) === sig) return i;
  }
  return -1;
}

function listLocalHeaders(buf) {
  const out = [];
  const sig = 0x04034b50;
  for (let i = 0; i + 30 <= buf.length; i++) {
    if (readU32LE(buf, i) === sig) {
      const nameLen = readU16LE(buf, i + 26);
      const extraLen = readU16LE(buf, i + 28);
      const compSize = readU32LE(buf, i + 18);
      const nameBuf = buf.subarray(i + 30, i + 30 + nameLen);
      out.push({ offset: i, name: nameBuf.toString('utf8'), compSize, dataStart: i + 30 + nameLen + extraLen });
      i += 30 + nameLen + extraLen + compSize - 1;
    }
  }
  return out;
}

function listCentral(buf) {
  const out = [];
  const sig = 0x02014b50;
  for (let i = 0; i + 46 <= buf.length; i++) {
    if (readU32LE(buf, i) === sig) {
      const nameLen = readU16LE(buf, i + 28);
      const localOff = readU32LE(buf, i + 42);
      const nameBuf = buf.subarray(i + 46, i + 46 + nameLen);
      out.push({ offset: i, name: nameBuf.toString('utf8'), localOff });
      i += 46 + nameLen - 1;
    }
  }
  return out;
}

// ---- tests ---------------------------------------------------------------

(async () => {
check('itemsHash is deterministic and order-sensitive', async () => {
  const a = await itemsHash([{ kind: 'audio', name: 'a.mp3' }, { kind: 'image', name: 'b.webp' }]);
  const b = await itemsHash([{ kind: 'audio', name: 'a.mp3' }, { kind: 'image', name: 'b.webp' }]);
  const c = await itemsHash([{ kind: 'image', name: 'b.webp' }, { kind: 'audio', name: 'a.mp3' }]);
  if (a !== b) return 'same input → different hash';
  if (a === c) return 'reordered input → same hash';
  if (a.length !== 16) return 'expected 16 char hash, got ' + a.length;
  return true;
});

check('empty items list produces a valid 22-byte ZIP (EOCD only)', async () => {
  const buf = await buildZipFromItems('u1', { items: [] });
  if (buf.length !== 22) return 'expected 22, got ' + buf.length;
  if (readU32LE(buf, 0) !== 0x06054b50) return 'no EOCD sig';
  if (readU16LE(buf, 8) !== 0) return 'entry count ≠ 0';
  return true;
});

check('single file: LFH + CD + EOCD positions line up', async () => {
  // Mock storageGet by passing inlineBase64 instead of going through storage
  const kit = {
    items: [
      { name: 'song.mp3', inlineBase64: Buffer.from('hello world').toString('base64') },
    ],
  };
  const buf = await buildZipFromItems('u1', kit);
  const lh = listLocalHeaders(buf);
  const cd = listCentral(buf);
  const eocd = findEOCD(buf);
  if (lh.length !== 1 || cd.length !== 1) return 'expected 1 each, got lh=' + lh.length + ' cd=' + cd.length;
  if (lh[0].name !== 'song.mp3') return 'wrong lh name: ' + lh[0].name;
  if (cd[0].localOff !== lh[0].offset) return 'CD offset mismatch';
  if (eocd < 0) return 'EOCD not found';
  // CRC check: hello-world CRC = 0x0d4a1185
  const crc = readU32LE(buf, lh[0].offset + 14);
  if (crc !== 0x0d4a1185) return 'bad CRC: ' + crc.toString(16);
  return true;
});

check('multi-file ZIP: each entry\u2019s CD offset matches its LFH', async () => {
  const kit = {
    items: [
      { name: 'a.txt', inlineBase64: Buffer.from('one').toString('base64') },
      { name: 'b.webp', inlineBase64: Buffer.from([0x52, 0x49, 0x46, 0x46]).toString('base64') }, // RIFF
      { name: 'c.swr-project', inlineBase64: Buffer.from('{"v":1}').toString('base64') },
    ],
  };
  const buf = await buildZipFromItems('u1', kit);
  const lh = listLocalHeaders(buf);
  const cd = listCentral(buf);
  if (lh.length !== 3) return 'expected 3 local headers, got ' + lh.length;
  if (cd.length !== 3) return 'expected 3 central headers, got ' + cd.length;
  for (let i = 0; i < 3; i++) {
    if (cd[i].localOff !== lh[i].offset) return `entry ${i} CD offset (${cd[i].localOff}) ≠ LFH offset (${lh[i].offset})`;
  }
  const eocd = findEOCD(buf);
  if (eocd < 0) return 'EOCD not found';
  const totalEntries = readU16LE(buf, eocd + 10);
  if (totalEntries !== 3) return 'EOCD says ' + totalEntries + ' entries';
  return true;
});

check('rejects path-traversal names (.. or absolute)', async () => {
  const kit = {
    items: [
      { name: '../../etc/passwd', inlineBase64: Buffer.from('x').toString('base64') },
      { name: '/abs/path.txt', inlineBase64: Buffer.from('y').toString('base64') },
      { name: 'safe.txt', inlineBase64: Buffer.from('z').toString('base64') },
    ],
  };
  const buf = await buildZipFromItems('u1', kit);
  const lh = listLocalHeaders(buf);
  if (lh.length !== 1) return 'expected exactly 1 safe entry, got ' + lh.length;
  if (lh[0].name !== 'safe.txt') return 'wrong entry kept';
  return true;
});

// ---- summary --------------------------------------------------------------

const pass = results.filter((r) => r.ok).length;
const fail = results.filter((r) => !r.ok).length;
console.log(`\n${pass} passed, ${fail} failed (${results.length} checks)`);
if (fail > 0) process.exit(1);
})();
