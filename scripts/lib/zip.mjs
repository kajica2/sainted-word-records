// scripts/lib/zip.mjs — a minimal, dependency-free ZIP writer.
//
// The generation archives are built from the repo, on every build, on every
// machine — including CI runners that have no `zip` binary and no npm
// dependency budget for an archiver. So the archive format is written here,
// directly: local file headers, a central directory and an end-of-central-
// directory record, with zlib (Node's built-in) doing the compression.
//
// Only the two methods that matter are supported: DEFLATE for text (which is
// most of the repo) and STORE for media that is already compressed (an mp3
// gains nothing from deflate and costs a second of CPU per file).

import zlib from 'node:zlib';

const LOCAL_SIG = 0x04034b50;
const CENTRAL_SIG = 0x02014b50;
const EOCD_SIG = 0x06054b50;

const METHOD_STORE = 0;
const METHOD_DEFLATE = 8;

// Already-compressed formats: storing them is faster and smaller.
const STORE_EXT = new Set([
  '.mp3', '.m4a', '.wav', '.ogg', '.opus',
  '.mp4', '.webm', '.mov', '.m4v',
  '.jpg', '.jpeg', '.png', '.webp', '.gif', '.avif',
  '.woff', '.woff2', '.zip',
]);

// CRC-32 (IEEE) — the checksum every ZIP entry carries.
const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c;
  }
  return table;
})();

export function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

// MS-DOS timestamps have no timezone, so the only way to make one instant
// encode to one byte pattern is to read it in UTC. Using the local-time
// getters here made the same archive differ between a UTC CI runner and a
// developer in another zone — the build stopped being reproducible.
function dosDateTime(date) {
  const d = date instanceof Date && !Number.isNaN(date.getTime()) ? date : new Date(0);
  const year = Math.max(1980, d.getUTCFullYear());
  const time = ((d.getUTCHours() & 0x1f) << 11) | ((d.getUTCMinutes() & 0x3f) << 5) | ((d.getUTCSeconds() / 2) & 0x1f);
  const dateBits = (((year - 1980) & 0x7f) << 9) | (((d.getUTCMonth() + 1) & 0x0f) << 5) | (d.getUTCDate() & 0x1f);
  return { time, date: dateBits };
}

function extOf(name) {
  const i = name.lastIndexOf('.');
  return i === -1 ? '' : name.slice(i).toLowerCase();
}

/**
 * Build a ZIP archive.
 *
 * @param {Array<{name: string, data: Buffer, mtime?: Date}>} entries
 * @returns {Buffer} the archive
 */
export function createZip(entries) {
  const chunks = [];
  const central = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, 'utf8');
    const data = entry.data || Buffer.alloc(0);
    const crc = crc32(data);
    const store = STORE_EXT.has(extOf(entry.name));
    const method = store ? METHOD_STORE : METHOD_DEFLATE;
    const payload = store ? data : zlib.deflateRawSync(data, { level: 9 });
    const { time, date } = dosDateTime(entry.mtime);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(LOCAL_SIG, 0);
    local.writeUInt16LE(20, 4);           // version needed
    local.writeUInt16LE(0, 6);            // flags
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(payload.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);           // extra length

    chunks.push(local, nameBuf, payload);

    const header = Buffer.alloc(46);
    header.writeUInt32LE(CENTRAL_SIG, 0);
    header.writeUInt16LE(20, 4);          // version made by
    header.writeUInt16LE(20, 6);          // version needed
    header.writeUInt16LE(0, 8);           // flags
    header.writeUInt16LE(method, 10);
    header.writeUInt16LE(time, 12);
    header.writeUInt16LE(date, 14);
    header.writeUInt32LE(crc, 16);
    header.writeUInt32LE(payload.length, 20);
    header.writeUInt32LE(data.length, 24);
    header.writeUInt16LE(nameBuf.length, 28);
    header.writeUInt16LE(0, 30);          // extra
    header.writeUInt16LE(0, 32);          // comment
    header.writeUInt16LE(0, 34);          // disk number
    header.writeUInt16LE(0, 36);          // internal attrs
    header.writeUInt32LE(0, 38);          // external attrs
    header.writeUInt32LE(offset, 42);     // local header offset
    central.push(header, nameBuf);

    offset += local.length + nameBuf.length + payload.length;
  }

  const centralBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(EOCD_SIG, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...chunks, centralBuf, eocd]);
}

/**
 * Read the entry names out of an archive — the reader half of the writer,
 * used by the gate to prove an archive is well-formed and carries what it
 * claims to.
 *
 * @param {Buffer} buf
 * @returns {Array<{name: string, size: number, crc: number}>}
 */
export function readZipEntries(buf) {
  // The end-of-central-directory record is the last 22 bytes (plus a
  // comment); find its signature by scanning backwards.
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0 && i >= buf.length - 22 - 0xffff; i -= 1) {
    if (buf.readUInt32LE(i) === EOCD_SIG) {
      eocd = i;
      break;
    }
  }
  if (eocd === -1) throw new Error('not a zip: no end-of-central-directory record');
  const count = buf.readUInt16LE(eocd + 10);
  let offset = buf.readUInt32LE(eocd + 16);
  const entries = [];
  for (let i = 0; i < count; i += 1) {
    if (buf.readUInt32LE(offset) !== CENTRAL_SIG) {
      throw new Error(`not a zip: bad central directory entry at ${offset}`);
    }
    const size = buf.readUInt32LE(offset + 24);
    const crc = buf.readUInt32LE(offset + 16);
    const nameLen = buf.readUInt16LE(offset + 28);
    const extraLen = buf.readUInt16LE(offset + 30);
    const commentLen = buf.readUInt16LE(offset + 32);
    const name = buf.toString('utf8', offset + 46, offset + 46 + nameLen);
    entries.push({ name, size, crc, offset: buf.readUInt32LE(offset + 42) });
    offset += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

/**
 * Read one entry's bytes back out of an archive.
 *
 * @param {Buffer} buf the archive
 * @param {Array} entries the result of readZipEntries()
 * @param {string} name the entry name
 * @returns {Buffer|null}
 */
export function readZipFile(buf, entries, name) {
  const entry = entries.find((e) => e.name === name);
  if (!entry) return null;
  const local = entry.offset;
  if (buf.readUInt32LE(local) !== LOCAL_SIG) throw new Error(`not a zip: bad local header for ${name}`);
  const method = buf.readUInt16LE(local + 8);
  const compressedSize = buf.readUInt32LE(local + 18);
  const nameLen = buf.readUInt16LE(local + 26);
  const extraLen = buf.readUInt16LE(local + 28);
  const start = local + 30 + nameLen + extraLen;
  const payload = buf.subarray(start, start + compressedSize);
  if (method === METHOD_STORE) return Buffer.from(payload);
  if (method === METHOD_DEFLATE) return zlib.inflateRawSync(payload);
  throw new Error(`not a zip: unsupported compression method ${method}`);
}
