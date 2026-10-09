#!/usr/bin/env node
// tools/local-dns.mjs — an unprivileged local nameserver for this repo's
// dev server, plus a system-integration helper.
//
// Why this exists: the Vite dev server (npm run dev, :5174) is the whole
// point of this box, but you can only reach it as http://127.0.0.1:5174/.
// Vite does not honour vercel.json rewrites, so "/" 404s there while "/"
// serves /landing.html in production — a hostname that mirrors the deploy
// is what makes local work trustworthy. This server answers
// sainted-word.test (and anything under it) with 127.0.0.1, and forwards
// every other query to the machine's real resolvers, so it can sit in
// front of the whole system without breaking outbound lookups.
//
// Zero dependencies, DNS wire format implemented here (RFC 1035 + the
// RFC 4592 wildcard rule + RFC 6761 .test) so nothing in package.json,
// package-lock.json or the Vercel build has to change. Run it with
// `node tools/local-dns.mjs`; nothing imports it.
//
// Port: binds 127.0.0.1:5354 by default. Port 53 needs root (verified:
// bind 127.0.0.1:53 fails with EACCES for a non-root uid), and macOS
// resolver files support a per-client `port`, so 5354 loses nothing — see
// tools/local-dns-system.sh, which writes the root-owned
// /etc/resolver/sainted-word.test stub that points at it.
//
// Usage:
//   node tools/local-dns.mjs                    # serve (foreground)
//   node tools/local-dns.mjs --probe sainted-word.test
//   node tools/local-dns.mjs --probe example.com # prove forwarding
//   node tools/local-dns.mjs --port 53           # if you are root
//
// Query it with the system resolver once tools/local-dns-system.sh is
// installed, or directly, no root required:
//   dig @127.0.0.1 -p 5354 sainted-word.test A

import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createSocket } from 'node:dgram';
import { createServer } from 'node:net';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_CONFIG = resolve(HERE, 'local-dns.config.json');

// DNS message types we reason about. Everything else in-zone is answered
// NODATA, which is the correct answer for a type the zone does not carry.
const T = {
  A: 1, NS: 2, CNAME: 5, SOA: 6, PTR: 12, MX: 15, TXT: 16,
  AAAA: 28, SRV: 33, OPT: 41, HTTPS: 65, ANY: 255,
};

const RCODE = { NOERROR: 0, FORMERR: 1, SERVFAIL: 2, NXDOMAIN: 3, NOTIMP: 4, REFUSED: 5 };
const CLASS_IN = 1;

// Upstream query budget. Short on purpose: a dev resolver that hangs the
// system's lookups for 30s is worse than one that fails fast and the
// resolver falls through to the next nameserver in the search list.
const UPSTREAM_TIMEOUT_MS = 2000;
const UPSTREAM_ATTEMPTS = 2;
const CLIENT_TIMEOUT_MS = 5000;

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

function loadConfig(path) {
  if (!existsSync(path)) {
    throw new Error(`config not found: ${path}`);
  }
  const cfg = JSON.parse(readFileSync(path, 'utf8'));
  if (!cfg.zone) throw new Error('config.zone is required');
  if (!cfg.records || typeof cfg.records !== 'object') {
    throw new Error('config.records is required');
  }
  // Normalise every record value to an array of literal IPs so the lookup
  // path never branches on shape.
  const records = new Map();
  for (const [name, value] of Object.entries(cfg.records)) {
    const list = (Array.isArray(value) ? value : [value]).map((v) => {
      const ip = String(v).trim();
      if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(ip) && !ip.includes(':')) {
        throw new Error(`record ${name}: not an IP address: ${ip}`);
      }
      return ip;
    });
    records.set(normaliseName(name).toLowerCase(), list);
  }
  return {
    host: cfg.host || '127.0.0.1',
    port: Number(cfg.port) || 5354,
    zone: normaliseName(cfg.zone).toLowerCase(),
    ttl: Number(cfg.ttl) || 60,
    records,
    upstream: Array.isArray(cfg.upstream) ? cfg.upstream.filter(Boolean) : [],
  };
}

function normaliseName(name) {
  let n = String(name).trim().toLowerCase();
  while (n.endsWith('.')) n = n.slice(0, -1);
  return n;
}

// ---------------------------------------------------------------------------
// Upstream resolvers
// ---------------------------------------------------------------------------

// Prefer the resolvers macOS itself is configured with (scutil), then
// /etc/resolv.conf, so this server agrees with the machine rather than
// imposing a public resolver. 127.0.0.1 and our own port are excluded to
// avoid a forwarding loop.
function detectUpstreams(selfHost, selfPort) {
  const found = [];
  const add = (raw) => {
    if (!raw) return;
    const [host, port] = String(raw).split(':');
    if (!host || host === selfHost) return;
    if (Number(port) === selfPort) return;
    if (host === '::1') return;
    if (!found.includes(host)) found.push(host);
  };

  try {
    const out = execFileSync('scutil', ['--dns'], { encoding: 'utf8', timeout: 5000 });
    for (const m of out.matchAll(/nameserver\[\d+\]\s*:\s*(\S+)/g)) add(m[1]);
  } catch { /* scutil missing or timed out — fall through to resolv.conf */ }

  try {
    const rc = readFileSync('/etc/resolv.conf', 'utf8');
    for (const m of rc.matchAll(/^\s*nameserver\s+(\S+)/gm)) add(m[1]);
  } catch { /* no resolv.conf */ }

  return found;
}

// ---------------------------------------------------------------------------
// Wire format
// ---------------------------------------------------------------------------

function encodeName(name) {
  const out = [];
  for (const label of normaliseName(name).split('.').filter(Boolean)) {
    const bytes = Buffer.from(label, 'utf8');
    if (bytes.length > 63) throw new Error(`label too long: ${label}`);
    out.push(Buffer.from([bytes.length]), bytes);
  }
  out.push(Buffer.from([0]));
  return Buffer.concat(out);
}

function ipToBuffer(ip) {
  return Buffer.from(ip.split('.').map((n) => Number(n) & 0xff));
}

// Reads the first question and reports where the name ended, so the caller
// knows the offset of QTYPE. Returns null on anything malformed — a short
// read on UDP is normal (a TCP message that did not fit), so never throw.
function parseQuestion(msg) {
  if (msg.length < 12) return null;
  const qdcount = msg.readUInt16BE(4);
  if (qdcount < 1) return null;
  let off = 12;
  const labels = [];
  for (;;) {
    if (off >= msg.length) return null;
    const len = msg[off];
    if (len === 0) { off += 1; break; }
    // Compression pointers are legal in questions but never emitted by a
    // sane client; refusing keeps the parser bounded.
    if ((len & 0xc0) !== 0 || len > 63) return null;
    if (off + 1 + len > msg.length) return null;
    labels.push(msg.toString('utf8', off + 1, off + 1 + len));
    off += 1 + len;
  }
  if (off + 4 > msg.length) return null;
  return {
    name: labels.join('.').toLowerCase(),
    qtype: msg.readUInt16BE(off),
    qclass: msg.readUInt16BE(off + 2),
    endOfQuestion: off + 4,
  };
}

function header(id, flags) {
  const buf = Buffer.alloc(12);
  buf.writeUInt16BE(id, 0);
  buf.writeUInt16BE(flags, 2);
  return buf;
}

// A pointer to offset 12 — where the question's QNAME always starts — so
// answer records cost 2 bytes instead of a second copy of the name.
const PTR_TO_QUESTION = 0xc00c;

function buildAnswer(type, rdata, ttl) {
  const buf = Buffer.alloc(12 + rdata.length);
  buf.writeUInt16BE(PTR_TO_QUESTION, 0);
  buf.writeUInt16BE(type, 2);
  buf.writeUInt16BE(CLASS_IN, 4);
  buf.writeUInt32BE(ttl, 6);
  buf.writeUInt16BE(rdata.length, 10);
  rdata.copy(buf, 12);
  return buf;
}

function soaRecord(zone, ttl, serial) {
  const rdata = Buffer.concat([
    encodeName(`ns.${zone}`),
    encodeName(`hostmaster.${zone}`),
    int32(serial), int32(3600), int32(600), int32(604800), int32(ttl),
  ]);
  // The SOA sits in the AUTHORITY section, so its NAME is the zone name
  // rather than a compression pointer back into the question. After the name
  // come 10 bytes of type/class/ttl/rdlength, then rdata itself.
  const name = encodeName(zone);
  const record = Buffer.alloc(name.length + 10 + rdata.length);
  name.copy(record, 0);
  record.writeUInt16BE(T.SOA, name.length);
  record.writeUInt16BE(CLASS_IN, name.length + 2);
  record.writeUInt32BE(ttl, name.length + 4);
  record.writeUInt16BE(rdata.length, name.length + 8);
  rdata.copy(record, name.length + 10);
  return record;
}

function int32(n) {
  const buf = Buffer.alloc(4);
  buf.writeUInt32BE(n >>> 0, 0);
  return buf;
}

const QR = 0x8000, AA = 0x0400, TC = 0x0200, RD = 0x0100, RA = 0x0080, RCODE_MASK = 0x000f;

// ---------------------------------------------------------------------------
// Zone matching
// ---------------------------------------------------------------------------

// Exact record, then RFC 4592 style wildcard walk: *.zone answers anything
// under the zone, and *.sub.zone answers anything under sub.zone. The
// wildcard deliberately matches any depth — this is a dev zone, and a
// one-label-only rule would make app.engine.sainted-word.test NXDOMAIN for
// no reason anyone would want.
function lookup(zone, records, name) {
  if (records.has(name)) return records.get(name);
  if (name === zone) return null;
  const labels = name.split('.');
  for (let i = 0; i < labels.length; i++) {
    const wildcard = ['*', ...labels.slice(i)].join('.');
    if (records.has(wildcard)) return records.get(wildcard);
    if (labels.slice(i).join('.') === zone) break;
  }
  return null;
}

function inZone(zone, name) {
  return name === zone || name.endsWith(`.${zone}`);
}

// ---------------------------------------------------------------------------
// Answering
// ---------------------------------------------------------------------------

function answerLocally(query, zone, records, ttl, serial, recursionAvailable) {
  const q = parseQuestion(query);
  if (!q) {
    const id = query.readUInt16BE(0);
    const flags = (query.readUInt16BE(2) & RD) | QR | RCODE_MASK & RCODE.FORMERR;
    return header(id, flags);
  }

  const id = query.readUInt16BE(0);
  const reqFlags = query.readUInt16BE(2);
  const base = (reqFlags & RD) | QR | (recursionAvailable ? RA : 0);
  const question = query.subarray(12, q.endOfQuestion);

  const finish = (rcode, answers = [], authority = []) => {
    const out = header(id, base | rcode);
    out.writeUInt16BE(1, 4);            // QDCOUNT
    out.writeUInt16BE(answers.length, 6);
    out.writeUInt16BE(authority.length, 8);
    return Buffer.concat([out, question, ...answers, ...authority]);
  };

  if (q.qclass !== CLASS_IN) return finish(RCODE.REFUSED);
  if (!inZone(zone, q.name)) return null; // caller forwards it
  if (q.qtype === T.OPT) return finish(RCODE.NOERROR);

  const ips = lookup(zone, records, q.name);
  if (!ips) {
    // NXDOMAIN + SOA so a resolver caching the negative answer honours the
    // zone's minimum TTL instead of re-asking on every lookup.
    return finish(RCODE.NXDOMAIN, [], [soaRecord(zone, ttl, serial)]);
  }

  const wantV6 = q.qtype === T.AAAA || q.qtype === T.ANY;
  const v4 = ips.filter((ip) => !ip.includes(':'));
  const v6 = ips.filter((ip) => ip.includes(':'));

  // A name that exists but carries no record of the requested type is
  // NOERROR/NODATA, never NXDOMAIN.
  const answers = [];
  if (q.qtype === T.A || q.qtype === T.ANY) {
    for (const ip of v4) answers.push(buildAnswer(T.A, ipToBuffer(ip), ttl));
  }
  if (wantV6) {
    for (const ip of v6) answers.push(buildAnswer(T.AAAA, Buffer.from(ip.replace(/^\[|\]$/g, '')), ttl));
  }
  if (answers.length === 0) {
    return finish(RCODE.NOERROR, [], [soaRecord(zone, ttl, serial)]);
  }
  return finish(RCODE.NOERROR, answers, []);
}

// The upstream answer is forwarded byte-for-byte apart from the transaction
// ID and the RA bit — parsing and rebuilding someone else's records buys
// nothing and risks mangling them.
function rewriteForwarded(upstreamBytes, queryId, reqFlags) {
  const out = Buffer.from(upstreamBytes);
  out.writeUInt16BE(queryId, 0);
  const flags = (out.readUInt16BE(2) & ~RA & ~AA) | QR | (reqFlags & RD) | RA;
  out.writeUInt16BE(flags, 2);
  return out;
}

function queryUpstream(query, upstreams) {
  return new Promise((done) => {
    let index = 0;
    const reqFlags = query.readUInt16BE(2);

    const attempt = () => {
      if (index >= upstreams.length * UPSTREAM_ATTEMPTS) {
        done(null);
        return;
      }
      const host = upstreams[index % upstreams.length];
      const round = Math.floor(index / upstreams.length);
      index += 1;

      const id = index;
      const out = Buffer.from(query);
      out.writeUInt16BE(id, 0);

      const socket = createSocket('udp4');
      let settled = false;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        try { socket.close(); } catch { /* already closed */ }
        done(value);
      };
      const timer = setTimeout(() => {
        try { socket.close(); } catch { /* already closed */ }
        // Round 2 of the same upstream is the retry; after both, move on.
        if (round + 1 >= UPSTREAM_ATTEMPTS) finish(null);
        else attempt();
      }, UPSTREAM_TIMEOUT_MS);

      socket.on('message', (msg) => {
        clearTimeout(timer);
        if (msg.readUInt16BE(0) !== id) { socket.close(); return; } // late/foreign
        const truncated = (msg.readUInt16BE(2) & TC) !== 0;
        if (truncated) {
          socket.close();
          // A truncated answer is still an answer; hand it back rather than
          // silently burning another 2s on TCP.
          finish(rewriteForwarded(msg, query.readUInt16BE(0), reqFlags));
          return;
        }
        finish(rewriteForwarded(msg, query.readUInt16BE(0), reqFlags));
      });
      socket.on('error', () => {
        clearTimeout(timer);
        try { socket.close(); } catch { /* already closed */ }
        if (round + 1 >= UPSTREAM_ATTEMPTS) finish(null);
        else attempt();
      });
      socket.send(out, 53, host, (err) => {
        if (err) socket.emit('error', err);
      });
    };

    attempt();
  });
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

function serve(cfg, log = () => {}) {
  const serial = Math.floor(Date.now() / 1000) >>> 0;
  const upstreams = cfg.upstream.length ? cfg.upstream : detectUpstreams(cfg.host, cfg.port);
  const recursionAvailable = upstreams.length > 0;

  const local = async (query) => {
    const direct = answerLocally(query, cfg.zone, cfg.records, cfg.ttl, serial, recursionAvailable);
    if (direct) return direct;
    if (!recursionAvailable) {
      const id = query.readUInt16BE(0);
      const flags = (query.readUInt16BE(2) & RD) | QR | RCODE.SERVFAIL;
      return header(id, flags);
    }
    const forwarded = await queryUpstream(query, upstreams);
    if (forwarded) return forwarded;
    const id = query.readUInt16BE(0);
    const flags = (query.readUInt16BE(2) & RD) | QR | RA | RCODE.SERVFAIL;
    return header(id, flags);
  };

  const udp = createSocket('udp4');
  udp.on('message', (msg, rinfo) => {
    local(msg).then((answer) => {
      udp.send(answer, rinfo.port, rinfo.address);
    }).catch((e) => {
      // Never let one bad query take the server down; answer SERVFAIL.
      const id = msg.length >= 2 ? msg.readUInt16BE(0) : 0;
      const flags = (msg.length >= 4 ? msg.readUInt16BE(2) & RD : 0) | QR | RCODE.SERVFAIL;
      udp.send(header(id, flags), rinfo.port, rinfo.address);
      console.error('[local-dns] query failed:', e.message);
    });
    const q = parseQuestion(msg);
    if (q) log(`udp  ${q.name} ${typeName(q.qtype)} from ${rinfo.address}`);
  });

  // TCP framing is a 2-byte length prefix; dig uses it for answers over
  // 512 bytes and for zone transfers, and a resolver that answers UDP only
  // is not a resolver.
  const tcp = createServer((socket) => {
    let buffered = Buffer.alloc(0);
    socket.on('data', (chunk) => {
      buffered = Buffer.concat([buffered, chunk]);
      while (buffered.length >= 2) {
        const len = buffered.readUInt16BE(0);
        if (buffered.length < 2 + len) return;
        const msg = buffered.subarray(2, 2 + len);
        buffered = buffered.subarray(2 + len);
        local(msg).then((answer) => {
          const frame = Buffer.alloc(2 + answer.length);
          frame.writeUInt16BE(answer.length, 0);
          answer.copy(frame, 2);
          socket.write(frame);
        }).catch((e) => {
          const id = msg.length >= 2 ? msg.readUInt16BE(0) : 0;
          const flags = (msg.length >= 4 ? msg.readUInt16BE(2) & RD : 0) | QR | RCODE.SERVFAIL;
          const frame = Buffer.alloc(2 + header(id, flags).length);
          header(id, flags).copy(frame, 2);
          frame.writeUInt16BE(frame.length - 2, 0);
          socket.write(frame);
          console.error('[local-dns] tcp query failed:', e.message);
        });
        const q = parseQuestion(msg);
        if (q) log(`tcp  ${q.name} ${typeName(q.qtype)} from ${socket.remoteAddress}`);
      }
    });
    socket.on('error', () => { /* client hung up */ });
  });

  return new Promise((done) => {
    udp.on('error', (e) => {
      if (e.code === 'EACCES') {
        console.error(`[local-dns] cannot bind ${cfg.host}:${cfg.port}: ${e.code}`);
        console.error('[local-dns] port 53 needs root — run under sudo, or use the');
        console.error('[local-dns] default 5354 with tools/local-dns-system.sh.');
        process.exit(1);
      }
      console.error('[local-dns] udp error:', e.message);
    });
    tcp.on('error', (e) => {
      if (e.code === 'EACCES') {
        console.error(`[local-dns] cannot bind ${cfg.host}:${cfg.port}: ${e.code}`);
        console.error('[local-dns] port 53 needs root — run under sudo, or use the');
        console.error('[local-dns] default 5354 with tools/local-dns-system.sh.');
        process.exit(1);
      }
      console.error('[local-dns] tcp error:', e.message);
    });
    udp.bind(cfg.port, cfg.host, () => tcp.listen(cfg.port, cfg.host, () => {
      log(`udp+tcp ${cfg.host}:${cfg.port} zone=${cfg.zone} ttl=${cfg.ttl} records=${cfg.records.size}`);
      log(cfg.upstream.length
        ? `upstream ${cfg.upstream.join(', ')} (from config)`
        : recursionAvailable
          ? `upstream ${upstreams.join(', ')} (detected)`
          : 'upstream none — authoritative only, out-of-zone queries SERVFAIL');
      done({ udp, tcp });
    }));
  });
}

const TYPE_NAMES = Object.fromEntries(Object.entries(T).map(([k, v]) => [v, k]));
function typeName(t) { return TYPE_NAMES[t] || `TYPE${t}`; }

// ---------------------------------------------------------------------------
// Self-probe: proves the server answers without needing dig or root
// ---------------------------------------------------------------------------

function probe(cfg, name, type) {
  return new Promise((done) => {
    const socket = createSocket('udp4');
    const id = 0x4f4d;
    const qname = encodeName(name);
    const query = Buffer.alloc(12 + qname.length + 4);
    query.writeUInt16BE(id, 0);
    query.writeUInt16BE(RD, 2);
    query.writeUInt16BE(1, 4);
    qname.copy(query, 12);
    query.writeUInt16BE(type, 12 + qname.length);
    query.writeUInt16BE(CLASS_IN, 12 + qname.length + 2);

    socket.on('message', (msg) => {
      socket.close();
      const q = parseQuestion(msg);
      const rcode = msg.readUInt16BE(2) & RCODE_MASK;
      const ancount = msg.readUInt16BE(6);
      const answers = [];
      let off = q ? q.endOfQuestion : 12;
      for (let i = 0; i < ancount && off + 16 <= msg.length; i++) {
        if ((msg[off] & 0xc0) !== 0xc0) break; // compressed name expected
        const rtype = msg.readUInt16BE(off + 2);
        const rdlen = msg.readUInt16BE(off + 10);
        const rd = msg.subarray(off + 12, off + 12 + rdlen);
        if (rtype === T.A) answers.push([...rd].join('.'));
        else if (rtype === T.AAAA) {
          const parts = [];
          for (let j = 0; j < rd.length; j += 2) parts.push(rd.readUInt16BE(j).toString(16));
          answers.push(parts.join(':'));
        } else answers.push(`type${rtype}`);
        off += 12 + rdlen;
      }
      done({ name, rcode, answers });
    });
    socket.send(query, cfg.port, cfg.host);
  });
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') args.help = true;
    else if (a === '--port') args.port = Number(argv[++i]);
    else if (a === '--host') args.host = argv[++i];
    else if (a === '--config') args.config = argv[++i];
    else if (a === '--probe') {
      args.probe = argv[++i];
      // Accept a bare type right after the name: `--probe example.com AAAA`.
      // Without this the token is silently dropped and the probe asks for A,
      // which reads as "the server answered AAAA with an address".
      const next = argv[i + 1];
      if (next && /^(A|AAAA|NS|CNAME|SOA|PTR|MX|TXT|SRV|HTTPS|ANY)$/i.test(next)) {
        args.type = argv[++i];
      }
    }
    else if (a === '--type') args.type = argv[++i];
    else if (a === '--no-upstream') args.noUpstream = true;
    else args._.push(a);
  }
  return args;
}

const HELP = `local-dns.mjs — unprivileged nameserver for this repo's dev server

  node tools/local-dns.mjs                     serve on the config host/port
  node tools/local-dns.mjs --probe <name>      query the running server
  node tools/local-dns.mjs --probe <n> --type AAAA
  node tools/local-dns.mjs --port 53           requires root
  node tools/local-dns.mjs --no-upstream       authoritative only

System integration (needs sudo once, server stays unprivileged):
  sudo bash tools/local-dns-system.sh install
  sudo bash tools/local-dns-system.sh uninstall
`;

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { console.log(HELP); return; }

  const cfg = loadConfig(args.config || DEFAULT_CONFIG);
  if (args.port) cfg.port = args.port;
  if (args.host) cfg.host = args.host;
  if (args.noUpstream) cfg.upstream = [];

  if (args.probe) {
    // Query the already-running server; never bind, or --probe would just
    // prove it can talk to itself.
    const type = (args.type || 'A').toUpperCase();
    const result = await probe(cfg, args.probe, T[type] || T.A);
    const rcode = ['NOERROR', 'FORMERR', 'SERVFAIL', 'NXDOMAIN', 'NOTIMP', 'REFUSED'][result.rcode];
    console.log(`${result.name} ${type} -> ${rcode}${result.answers.length ? ' ' + result.answers.join(' ') : ''}`);
    process.exit(result.rcode === 0 || result.answers.length ? 0 : 1);
  }

  const log = (line) => console.log(`[local-dns] ${line}`);
  await serve(cfg, log);
  console.log('');
  console.log('  dig @127.0.0.1 -p ' + cfg.port + ' ' + cfg.zone + ' A');
  console.log(`  curl --resolve ${cfg.zone}:5174:127.0.0.1 http://${cfg.zone}:5174/`);
  console.log('  sudo bash tools/local-dns-system.sh install   # system-wide');
  console.log('');

  const shutdown = () => { process.exit(0); };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((e) => {
  console.error('[local-dns] ' + (e.stack || e.message));
  process.exit(1);
});
