// api/_lib/kit-zip.js — Minimal ZIP writer (stored method, no deps).
//
// Builds a ZIP archive (PKZIP format) using method 0 (stored) only.
// Each entry: 30-byte local file header + filename + uncompressed data
// + 46-byte central directory record + filename + 22-byte EOCD.
//
// Why method 0:
//   - No external dependency (no zlib / adm-zip on the server).
//   - Audio + image files are already compressed (mp3, webp, png). The
//     most useful artifact — the .swr-project JSON — is small enough
//     that compression wouldn't matter.
//
// Why no streaming / no async deflate:
//   - The pack runs once per GET, the inputs are already in memory or
//     in object storage; build-and-store keeps the call simple and
//     correct. Future rev: add deflate for the project JSON only.
//
// Layout (returned as a Buffer):
//   [local file header + filename + data] × N
//   [central directory record + filename] × N
//   EOCD (22 bytes)

import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { storageGet } from './db.js';

// CRC32 implementation (IEEE polynomial). Required by the ZIP format.
// table-based for speed.
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[i] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    c = (CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8)) >>> 0;
  }
  return (c ^ 0xFFFFFFFF) >>> 0;
}

// DOS time/date (mode 0 in MS-DOS). 2-second resolution.
function dosTime(d = new Date()) {
  const t =
    ((d.getHours() & 0x1F) << 11) |
    ((d.getMinutes() & 0x3F) << 5) |
    ((Math.floor(d.getSeconds() / 2)) & 0x1F);
  const dt =
    (((d.getFullYear() - 1980) & 0x7F) << 9) |
    (((d.getMonth() + 1) & 0x0F) << 5) |
    (d.getDate() & 0x1F);
  return { time: t, date: dt };
}

// Pull each item's bytes from object storage (or inline base64 for
// project items). Returns [{ name, data, mime }].
async function resolveItems(userId, kit) {
  const out = [];
  for (const it of (kit.items || [])) {
    try {
      if (it.inlineBase64) {
        const buf = Buffer.from(it.inlineBase64, 'base64');
        out.push({ name: it.name || 'project.swr-project', data: buf, mime: 'application/json' });
        continue;
      }
      if (it.storageKey) {
        const buf = await storageGet(userId, it.storageKey);
        if (!buf) continue;
        out.push({ name: it.name || it.storageKey.split('/').pop(), data: buf, mime: mimeFromKind(it.kind) });
      }
    } catch (e) {
      // skip broken items (don't break the whole kit on one bad file)
      console.warn('[kit-zip] skipping item', it && it.name, e.message);
    }
  }
  return out;
}

function mimeFromKind(kind) {
  switch ((kind || '').toLowerCase()) {
    case 'audio':  return 'audio/mpeg';
    case 'image':  return 'image/webp';
    case 'video':  return 'video/mp4';
    case 'project':return 'application/json';
    default:       return 'application/octet-stream';
  }
}

// Build the zip from a kit's items list. Returns a Buffer.
export async function buildZipFromItems(userId, kit) {
  const items = await resolveItems(userId, kit);
  const dt = dosTime();

  const localChunks = [];
  const centralChunks = [];
  let cursor = 0;

  for (const { name, data } of items) {
    // Path traversal guard (zip slip via "..")
    if (name.includes('..') || name.startsWith('/')) continue;
    const nameBuf = Buffer.from(name, 'utf8');
    const crc = crc32(data);

    // Local file header (30 bytes + name)
    const lfh = Buffer.alloc(30);
    lfh.writeUInt32LE(0x04034b50, 0);             // signature
    lfh.writeUInt16LE(20, 4);                    // version needed
    lfh.writeUInt16LE(0, 6);                     // flags
    lfh.writeUInt16LE(0, 8);                     // method (0 = stored)
    lfh.writeUInt16LE(dt.time, 10);
    lfh.writeUInt16LE(dt.date, 12);
    lfh.writeUInt32LE(crc, 14);                  // CRC32
    lfh.writeUInt32LE(data.length, 18);          // compressed size
    lfh.writeUInt32LE(data.length, 22);          // uncompressed size
    lfh.writeUInt16LE(nameBuf.length, 26);
    lfh.writeUInt16LE(0, 28);                    // extra field length

    localChunks.push(lfh, nameBuf, data);

    // Central directory record (46 bytes + name)
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);              // signature
    cd.writeUInt16LE(20, 4);                     // version made by
    cd.writeUInt16LE(20, 6);                     // version needed
    cd.writeUInt16LE(0, 8);                      // flags
    cd.writeUInt16LE(0, 10);                     // method
    cd.writeUInt16LE(dt.time, 12);
    cd.writeUInt16LE(dt.date, 14);
    cd.writeUInt32LE(crc, 16);                   // CRC32
    cd.writeUInt32LE(data.length, 20);           // compressed
    cd.writeUInt32LE(data.length, 24);           // uncompressed
    cd.writeUInt16LE(nameBuf.length, 28);
    cd.writeUInt16LE(0, 30);                     // extra field length
    cd.writeUInt16LE(0, 32);                     // comment length
    cd.writeUInt16LE(0, 34);                     // disk number start
    cd.writeUInt16LE(0, 36);                     // internal attrs
    cd.writeUInt32LE(0, 38);                     // external attrs
    cd.writeUInt32LE(cursor, 42);                // local header offset

    centralChunks.push(cd, nameBuf);
    cursor += lfh.length + nameBuf.length + data.length;
  }

  const localBuf = Buffer.concat(localChunks);
  const centralBuf = Buffer.concat(centralChunks);

  // End of central directory record (22 bytes)
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);              // signature
  eocd.writeUInt16LE(0, 4);                      // disk number
  eocd.writeUInt16LE(0, 6);                      // disk with CD
  eocd.writeUInt16LE(items.length, 8);           // entries on this disk
  eocd.writeUInt16LE(items.length, 10);          // total entries
  eocd.writeUInt32LE(centralBuf.length, 12);     // CD size
  eocd.writeUInt32LE(localBuf.length, 16);       // CD offset
  eocd.writeUInt16LE(0, 20);                     // comment length

  return Buffer.concat([localBuf, centralBuf, eocd]);
}

// Convenience: hash of the items list, used as a cache key. Stable across
// builds so a kit with unchanged items gets a stable zip URL.
export async function itemsHash(items) {
  const h = createHash('sha256');
  for (const it of (items || [])) {
    h.update(String(it.kind || '')); h.update('\x1f');
    h.update(String(it.name || '')); h.update('\x1f');
    h.update(String(it.storageKey || '')); h.update('\x1f');
    h.update(String(it.inlineBase64 ? 'i' + it.inlineBase64.length : 'noinline'));
    h.update('\n');
  }
  return h.digest('hex').slice(0, 16);
}
