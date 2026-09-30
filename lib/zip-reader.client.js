// lib/zip-reader.client.js — minimal ZIP reader (browser IIFE).
//
// window.ZIP_READER.read(ArrayBuffer) -> [{ name, data: Uint8Array, mime }]
//
// Supports stored (method 0) + deflate (method 8) entries via a small
// RFC 1951 inflate. No external dependencies. Rejects path traversal.
// Used by marketplace.html to ingest .swr-set media packs.
//
// ZIP layout notes:
//   - End-of-central-directory record (EOCD): PK\x05\x06
//   - Central directory entries:            PK\x01\x02
//   - Local file headers:                   PK\x03\x04
//
// This reader is intentionally minimal: entry sizes/offsets are read from
// the central directory (never the local header), so data-descriptor
// flags (bit 3) are harmless. Encrypted entries are refused.

(function () {
  if (window.ZIP_READER) return; // idempotent

  const TEXT_DECODER = typeof TextDecoder !== 'undefined' ? new TextDecoder('utf-8') : null;
  const MAX_NAME = 512;

  function readU16(b, o) { return (b[o] | (b[o + 1] << 8)) >>> 0; }
  function readU32(b, o) {
    return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
  }

  // === PATH TRAVERSAL GUARD ===============================================
  // Entry names must never escape the archive's root: no '..' segments,
  // no leading '/', no Windows drive letters, no backslashes.
  function isSafeName(name) {
    if (!name || name.length > MAX_NAME || name.indexOf('\0') !== -1) return false;
    if (name.charCodeAt(0) === 0x2f /* / */) return false;
    if (/^[a-zA-Z]:[\\/]/.test(name)) return false;
    const nameStr = String(name);
    if (nameStr.indexOf('\\') !== -1) return false;
    const parts = nameStr.split('/');
    for (let i = 0; i < parts.length; i++) {
      if (parts[i] === '..' || parts[i] === '.') return false;
    }
    return true;
  }

  function mimeFor(name) {
    const base = String(name).toLowerCase();
    if (/\.swr-set\.json$/i.test(base)) return 'application/json';
    if (/\.json$/i.test(base)) return 'application/json';
    if (/\.mp4$/i.test(base)) return 'video/mp4';
    if (/\.webm$/i.test(base)) return 'video/webm';
    if (/\.webp$/i.test(base)) return 'image/webp';
    if (/\.png$/i.test(base)) return 'image/png';
    if (/\.jpe?g$/i.test(base)) return 'image/jpeg';
    if (/\.gif$/i.test(base)) return 'image/gif';
    if (/\.wav$/i.test(base)) return 'audio/wav';
    if (/\.mp3$/i.test(base)) return 'audio/mpeg';
    return 'application/octet-stream';
  }

  // === CRC-32 (IEEE) — integrity check on uncompressed data ===
  const CRC_TABLE = (function () {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c >>> 0;
    }
    return t;
  })();

  function crc32(data, start, end) {
    let c = 0xffffffff;
    for (let i = start; i < end; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  // === RFC 1951 inflate ===================================================
  // Bit-pointer over the compressed bytes. Bits are consumed LSB-first;
  // Huffman codes are rebuilt into their MSB-first form while decoding.
  function inflate(data, start, end, expectedSize) {
    let pos = start;
    let bitPos = 0;

    function bits(n) {
      let out = 0;
      for (let i = 0; i < n; i++) {
        if (pos >= end) throw new Error('zip: truncated deflate stream');
        out |= ((data[pos] >> bitPos) & 1) << i;
        if (++bitPos === 8) { bitPos = 0; pos++; }
      }
      return out >>> 0;
    }

    function alignByte() {
      if (bitPos === 0) return;
      bitPos = 0;
      pos++;
    }

    // Build a canonical Huffman table from a code-length list. The table is
    // indexed by (code << (15 - len)); while decoding, bits read from the
    // stream are accumulated MSB-first so the first-read bit is the high bit
    // of the code. Slots store (sym << 4) | len — the length check keeps a
    // shorter code's lookup from colliding with a longer code that happens
    // to share the same top bits. 0xffff marks "no symbol".
    function buildTable(lengths) {
      const MAX = 15;
      const count = new Array(MAX + 1).fill(0);
      for (let i = 0; i < lengths.length; i++) {
        const l = lengths[i];
        if (l > 0) count[l]++;
      }
      let code = 0;
      const firstCode = new Array(MAX + 1).fill(0);
      for (let b = 1; b <= MAX; b++) {
        code = (code + count[b - 1]) << 1;
        firstCode[b] = code;
      }
      const table = new Uint16Array(1 << MAX); // 32K entries (~64KB)
      table.fill(0xffff);
      for (let sym = 0; sym < lengths.length; sym++) {
        const l = lengths[sym];
        if (l === 0) continue;
        const val = (sym << 4) | l;
        const startIdx = firstCode[l]++ << (MAX - l);
        const endIdx = startIdx + (1 << (MAX - l));
        for (let i = startIdx; i < endIdx; i++) table[i] = val;
      }
      return table;
    }

    function decodeSymbol(table) {
      let code = 0;
      for (let len = 1; len <= 15; len++) {
        code = (code << 1) | bits(1);
        const v = table[code << (15 - len)];
        if (v !== 0xffff && (v & 0x0f) === len) return v >> 4;
      }
      throw new Error('zip: invalid huffman code');
    }

    // Fixed (RFC 1951 §3.2.6) literals/lengths + distances
    const FIXED_LIT = new Uint8Array(288);
    for (let i = 0; i < 144; i++) FIXED_LIT[i] = 8;
    for (let i = 144; i < 256; i++) FIXED_LIT[i] = 9;
    for (let i = 256; i < 280; i++) FIXED_LIT[i] = 7;
    for (let i = 280; i < 288; i++) FIXED_LIT[i] = 8;
    const FIXED_DIST = new Uint8Array(30).fill(5);

    const LENGTH_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
    const LENGTH_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
    const DIST_BASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
    const DIST_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];

    const CODE_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

    const out = new Uint8Array(expectedSize || 1);
    let outPos = 0;

    function emit(byte) {
      if (outPos >= out.length) throw new Error('zip: output overflow');
      out[outPos++] = byte;
    }

    while (true) {
      const bfinal = bits(1);
      const btype = bits(2);
      if (btype === 0) {
        // Stored (uncompressed) block — byte-aligned, carries its own data,
        // so skip the Huffman symbol loop entirely.
        alignByte();
        if (pos + 4 > end) throw new Error('zip: truncated stored block');
        const len = data[pos] | (data[pos + 1] << 8);
        const nlen = data[pos + 2] | (data[pos + 3] << 8);
        pos += 4;
        if ((len ^ 0xffff) !== nlen) throw new Error('zip: stored block length mismatch');
        if (pos + len > end) throw new Error('zip: truncated stored data');
        for (let i = 0; i < len; i++) emit(data[pos + i]);
        pos += len;
        if (bfinal) break;
        continue;
      }
      let litTable;
      let distTable;
      if (btype === 1) {
        litTable = buildTable(FIXED_LIT);
        distTable = buildTable(FIXED_DIST);
      } else if (btype === 2) {
        const hlit = bits(5) + 257;
        const hdist = bits(5) + 1;
        const hclen = bits(4) + 4;
        const clLengths = new Uint8Array(19);
        for (let i = 0; i < hclen; i++) clLengths[CODE_ORDER[i]] = bits(3);
        const clTable = buildTable(clLengths);
        const total = hlit + hdist;
        const lengths = new Uint8Array(total);
        let i = 0;
        while (i < total) {
          const sym = decodeSymbol(clTable);
          if (sym <= 15) {
            lengths[i++] = sym;
          } else if (sym === 16) {
            if (i === 0) throw new Error('zip: repeat with no previous length');
            const rep = 3 + bits(2);
            const prev = lengths[i - 1];
            for (let r = 0; r < rep; r++) lengths[i++] = prev;
          } else if (sym === 17) {
            i += 3 + bits(3);
          } else if (sym === 18) {
            i += 11 + bits(7);
          }
          if (i > total) throw new Error('zip: code lengths overflow');
        }
        litTable = buildTable(lengths.subarray(0, hlit));
        distTable = buildTable(lengths.subarray(hlit));
      } else {
        throw new Error('zip: unsupported block type 3');
      }
      // Decode symbols
      while (true) {
        const sym = decodeSymbol(litTable);
        if (sym < 256) { emit(sym); continue; }
        if (sym === 256) break; // end of block
        const li = sym - 257;
        const length = LENGTH_BASE[li] + bits(LENGTH_EXTRA[li]);
        const dsym = decodeSymbol(distTable);
        const dist = DIST_BASE[dsym] + bits(DIST_EXTRA[dsym]);
        if (dist > outPos) throw new Error('zip: distance too far back');
        // byte-by-byte copy handles overlapping matches
        for (let i = 0; i < length; i++) emit(out[outPos - dist]);
      }
      if (bfinal) break;
    }

    return out.subarray(0, outPos);
  }

  // === Archive parse (central directory) ================================
  function findEocd(data) {
    // EOCD is the last structure; a trailing comment can stretch back up to
    // 65535 bytes, so scan backwards from the end.
    const from = Math.max(0, data.length - (22 + 65535));
    for (let i = data.length - 22; i >= from; i--) {
      if (data[i] === 0x50 && data[i + 1] === 0x4b && data[i + 2] === 0x05 && data[i + 3] === 0x06) return i;
    }
    return -1;
  }

  function read(buf) {
    const data = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    if (data.length < 22) throw new Error('zip: file too small to be a zip');
    const eocd = findEocd(data);
    if (eocd < 0) throw new Error('zip: end of central directory not found');
    const total = readU16(data, eocd + 10);
    const cdOffset = readU32(data, eocd + 16);
    if (cdOffset > data.length) throw new Error('zip: central directory offset out of range');

    let p = cdOffset;
    const entries = [];
    for (let i = 0; i < total; i++) {
      if (p + 46 > data.length) throw new Error('zip: truncated central directory');
      if (readU32(data, p) !== 0x02014b50) throw new Error('zip: bad central directory signature');
      const flags = readU16(data, p + 8);
      const method = readU16(data, p + 10);
      const crc = readU32(data, p + 16);
      const compSize = readU32(data, p + 20);
      const uncompSize = readU32(data, p + 24);
      const nameLen = readU16(data, p + 28);
      const extraLen = readU16(data, p + 30);
      const commentLen = readU16(data, p + 32);
      const localOffset = readU32(data, p + 42);
      const nameBytes = data.subarray(p + 46, p + 46 + nameLen);
      const name = TEXT_DECODER
        ? TEXT_DECODER.decode(nameBytes)
        : String.fromCharCode.apply(null, nameBytes);
      p += 46 + nameLen + extraLen + commentLen;

      if (!isSafeName(name)) {
        throw new Error('zip: unsafe entry name rejected: ' + name);
      }
      entries.push({ name, method, flags, crc, compSize, uncompSize, localOffset });
    }

    const results = [];
    for (const e of entries) {
      if (/\/$/.test(e.name)) continue; // directory entry
      if (e.flags & 0x1) throw new Error('zip: encrypted entries not supported: ' + e.name);
      if (e.method !== 0 && e.method !== 8) {
        throw new Error('zip: unsupported compression method ' + e.method + ' for ' + e.name);
      }
      const lp = e.localOffset;
      if (lp + 30 > data.length || readU32(data, lp) !== 0x04034b50) {
        throw new Error('zip: bad local header for ' + e.name);
      }
      const lNameLen = readU16(data, lp + 26);
      const lExtraLen = readU16(data, lp + 28);
      const dataStart = lp + 30 + lNameLen + lExtraLen;
      if (dataStart + e.compSize > data.length) throw new Error('zip: truncated data for ' + e.name);

      let out;
      if (e.method === 0) {
        out = data.slice(dataStart, dataStart + e.compSize);
      } else {
        out = inflate(data, dataStart, dataStart + e.compSize, e.uncompSize);
      }
      if (out.length !== e.uncompSize) throw new Error('zip: size mismatch for ' + e.name);
      if (crc32(out, 0, out.length) !== e.crc) throw new Error('zip: crc mismatch for ' + e.name);
      results.push({ name: e.name, data: out, mime: mimeFor(e.name) });
    }
    return results;
  }

  window.ZIP_READER = { read };
})();