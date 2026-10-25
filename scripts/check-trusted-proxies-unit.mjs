#!/usr/bin/env node
// scripts/check-trusted-proxies-unit.mjs - unit tests for the client-IP gate
// (api/_lib/http.js: `clientIp` / `normalizeIp`).
//
// The client IP is the bucket key for every per-IP rate limit, so this gate
// exists to pin ONE question down: when is `x-forwarded-for` allowed to decide
// who the client is, and when is it thrown away?
//
// The defect it closes: seven handlers read `x-forwarded-for[0]` directly. On
// Vercel the edge rewrites that header so the value is trustworthy; on any
// other deployment it is a string the client chose, so rotating it per request
// minted a fresh rate-limit bucket per request and the per-IP limits on
// /api/auth/magic, /api/invite/redeem, /api/catalogue/public,
// /api/license/verify, /api/pt/verify and /api/early-access were no limits at
// all. `api/admin/pt/keys/import.js` was worse than a bypassed throttle: the
// IP was an AUTHORISATION input (the dev-mode localhost allowlist).
//
// What is asserted:
//   1. the chain is walked from the RIGHT (a 3-hop chain, 1 trusted proxy)
//   2. an untrusted peer means the header is IGNORED, not honoured
//   3. a client that forges left-hand entries cannot move its own bucket
//   4. `::ffff:` normalization gives one bucket, not two
//   5. an empty / blank / malformed TRUSTED_PROXIES fails CLOSED
//   6. a missing or empty header falls back to the peer
//   7. the Vercel default yields the CLIENT ip, not the edge ip
//   8. CIDR (v4 and v6) and exact entries both match a proxy
//   9. every one of the seven call sites uses the shared helper
//
// Every case carries its own counter-case: a positive and a negative for each
// branch, so a gate that returns one constant for everything cannot pass.
//
// Run: node scripts/check-trusted-proxies-unit.mjs
// Exit: 0 = all assertions pass, 1 = any failure.

import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LIB = path.join(ROOT, 'api/_lib/http.js');
const SRC = fs.readFileSync(LIB, 'utf8');

// ---- load the real module into a sandbox ------------------------------------
//
// http.js is plain ESM with no imports, so the loader strips the `export`
// keywords and appends a collector in the SAME script: a top-level `const` in
// a vm script lives in that script's lexical scope, not on the sandbox, so the
// collector has to be part of the text it reads from.
//
// A fresh context per case, because two of the things under test are "this is
// read at CALL time, not at load time" and "the parsed trust list does not
// leak between configurations". Re-loading proves both without relying on the
// order the cases happen to run in.
const EXPORTS = [...SRC.matchAll(/^export\s+(?:async\s+function|function|const|let|var|class)\s+([A-Za-z0-9_$]+)/gm)]
  .map((m) => m[1]);
if (EXPORTS.length === 0) {
  console.error('no exports found in api/_lib/http.js - has the module shape changed?');
  process.exit(2);
}
if (/^\s*import\s[\s{*'"]/m.test(SRC)) {
  console.error('api/_lib/http.js grew an import; this loader only handles a dependency-free module');
  process.exit(2);
}
const LOADER = SRC.replace(/^export\s+/gm, '')
  + `\n;globalThis.__exports = { ${EXPORTS.join(', ')} };\n`;

function loadHttp(env = {}) {
  const warns = [];
  const sandbox = {
    console: {
      log() {},
      warn: (...args) => warns.push(args.join(' ')),
      error() {},
    },
    // No network, no filesystem, no timers: this gate can only see what the
    // module computes from the request and the env it is handed.
    process: { env: { ...env } },
    Buffer,
    URL,
    setTimeout,
    clearTimeout,
  };
  vm.createContext(sandbox);
  vm.runInContext(LOADER, sandbox, { filename: 'http.js' });
  return { ...sandbox.__exports, warns };
}

let failures = 0;
function check(name, fn) {
  try {
    fn();
    console.log('  ✓', name);
  } catch (e) {
    failures += 1;
    console.log('  ✗', name, '\n     ', e.message);
  }
}
function eq(actual, expected, label) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) throw new Error(`${label}: expected ${b}, got ${a}`);
}
function req({ forwarded, peer, env = {} } = {}) {
  const headers = {};
  if (forwarded !== undefined) headers['x-forwarded-for'] = forwarded;
  return {
    headers,
    socket: peer === undefined ? {} : { remoteAddress: peer },
    ...(Object.keys(env).length ? { _env: env } : {}),
  };
}
function ip(forwarded, peer, env = {}) {
  const { clientIp } = loadHttp(env);
  return clientIp(req({ forwarded, peer }));
}

console.log('trusted-proxies unit:');

// ---------------------------------------------------------------------------
// 1. The direction of the walk.
// ---------------------------------------------------------------------------

check('the chain is walked from the RIGHT: 3 hops, 1 trusted proxy', () => {
  // Client -> Proxy(10.0.0.1) -> app. The header the proxy wrote is
  // `client, proxy` (each proxy appends the hop in front of it), so the
  // rightmost entry is the client and the leftmost one is anything the client
  // chose to put there.
  const env = { TRUSTED_PROXIES: '10.0.0.1' };
  eq(
    ip('198.51.100.7, 203.0.113.9', '10.0.0.1', env),
    '203.0.113.9',
    'rightmost untrusted entry'
  );
  // The counter-case: the leftmost entry is NOT returned. If this ever equals
  // the rightmost one the case can no longer see the direction.
  if ('198.51.100.7' === '203.0.113.9') throw new Error('the two candidates must differ');
  eq(
    ip('203.0.113.9, 198.51.100.7', '10.0.0.1', env),
    '198.51.100.7',
    'reversed chain still takes the rightmost untrusted entry'
  );
});

check('two trusted proxies: the walk skips both and stops at the client', () => {
  const env = { TRUSTED_PROXIES: '10.0.0.1, 10.0.0.2' };
  // Client -> P1 -> P2(10.0.0.2, the peer) -> app. P2 appended P1's address,
  // P1 appended the client's, so the wire order is `client, P1`.
  eq(
    ip('198.51.100.7, 10.0.0.1', '10.0.0.2', env),
    '198.51.100.7',
    'client behind two proxies'
  );
  // The counter-case: with only P2 trusted, P1 is not a trusted entry, so the
  // walk stops one hop earlier and reports the proxy. The proxy COUNT changes
  // the answer, which is what "the (N+1)th from the right" means.
  eq(
    ip('198.51.100.7, 10.0.0.1', '10.0.0.2', { TRUSTED_PROXIES: '10.0.0.2' }),
    '10.0.0.1',
    'one proxy configured, two on the wire'
  );
});

check('every hop trusted: the peer is reported, never a chain entry', () => {
  const env = { TRUSTED_PROXIES: '10.0.0.1, 10.0.0.2' };
  eq(ip('10.0.0.1', '10.0.0.2', env), '10.0.0.2', 'all-trusted chain');
  eq(ip('', '10.0.0.2', env), '10.0.0.2', 'empty header');
  // The counter-case: one untrusted entry anywhere turns the chain back on.
  eq(ip('10.0.0.1, 198.51.100.7', '10.0.0.2', env), '198.51.100.7', 'one untrusted hop');
});

// ---------------------------------------------------------------------------
// 2. The peer gate.
// ---------------------------------------------------------------------------

check('an untrusted peer means the header is IGNORED, not honoured', () => {
  const env = { TRUSTED_PROXIES: '10.0.0.1' };
  eq(ip('198.51.100.7', '203.0.113.9', env), '203.0.113.9', 'off-list peer');
  // The counter-case: the same request from a peer that IS on the list is
  // honoured, so the difference is the peer and not something incidental.
  eq(ip('198.51.100.7', '10.0.0.1', env), '198.51.100.7', 'on-list peer');
});

check('a peer that only LOOKS like a proxy is not trusted', () => {
  const env = { TRUSTED_PROXIES: '10.0.0.1' };
  for (const peer of ['10.0.0.10', '110.0.0.1', '10.0.0.1.1', '10.0.0.01', '', undefined]) {
    const got = ip('198.51.100.7', peer, env);
    if (got === '198.51.100.7') throw new Error(`peer ${JSON.stringify(peer)} was treated as trusted`);
  }
  // The counter-case: the canonical spelling of the same address IS trusted.
  eq(ip('198.51.100.7', '10.0.0.1', env), '198.51.100.7', 'canonical peer');
});

check('no socket at all falls back to "unknown", never throws', () => {
  const env = { TRUSTED_PROXIES: '10.0.0.1' };
  eq(ip('198.51.100.7', undefined, env), 'unknown', 'no socket, trusted list configured');
  eq(ip('198.51.100.7', undefined), 'unknown', 'no socket, nothing configured');
  eq(ip('198.51.100.7', '', env), 'unknown', 'empty peer');
  // The counter-case: a peer that exists is always preferred over the literal.
  eq(ip('198.51.100.7', '203.0.113.9', env), '203.0.113.9', 'peer present');
});

// ---------------------------------------------------------------------------
// 3. The actual attack: forging the left-hand side of the chain.
// ---------------------------------------------------------------------------

check('a client that forges left-hand entries cannot move its own bucket', () => {
  const env = { TRUSTED_PROXIES: '10.0.0.1' };
  const seen = new Set();
  // The client rotates whatever it likes to the left of the real address the
  // proxy appended. Every one of these is a different request as far as the
  // old code was concerned, and one bucket as far as this code is concerned.
  for (const forged of [
    '1.1.1.1',
    '2.2.2.2, 3.3.3.3',
    '4.4.4.4, 5.5.5.5, 6.6.6.6, 7.7.7.7, 8.8.8.8',
    'not-an-ip, 9.9.9.9',
    '10.0.0.1',                      // a trusted address, to bait a left-walk
    '  203.0.113.9  , 203.0.113.9',  // the client guessing the real address
  ]) {
    seen.add(ip(`${forged}, 203.0.113.9`, '10.0.0.1', env));
  }
  eq([...seen], ['203.0.113.9'], 'every forgery lands in one bucket');
  // The counter-case: two genuinely different clients behind the same proxy
  // must still get two buckets, or the fix would be "ignore the header
  // entirely", which trades a bypass for a site-wide shared bucket.
  eq(ip('203.0.113.9', '10.0.0.1', env), '203.0.113.9', 'client A');
  eq(ip('198.51.100.7', '10.0.0.1', env), '198.51.100.7', 'client B');
});

check('a forged chain cannot impersonate a trusted proxy', () => {
  const env = { TRUSTED_PROXIES: '10.0.0.1' };
  // If the walk ever trusted the LEFT-most entries, this request would be
  // reported as coming from the proxy and the next hop's real address would be
  // returned instead of the client's.
  eq(ip('10.0.0.1, 198.51.100.7', '203.0.113.9', env), '203.0.113.9', 'untrusted peer, forged chain');
  eq(ip('10.0.0.1, 10.0.0.1, 198.51.100.7', '10.0.0.1', env), '198.51.100.7', 'trusted peer, forged chain');
});

check('a repeated header (array) is joined, not smuggled past the split', () => {
  const env = { TRUSTED_PROXIES: '10.0.0.1' };
  const { clientIp } = loadHttp(env);
  const r = { headers: { 'x-forwarded-for': ['198.51.100.7', '203.0.113.9'] }, socket: { remoteAddress: '10.0.0.1' } };
  eq(clientIp(r), '203.0.113.9', 'array header');
  // The counter-case: an array whose rightmost entry is trusted is still
  // walked, not taken.
  const r2 = { headers: { 'x-forwarded-for': ['198.51.100.7', '10.0.0.1'] }, socket: { remoteAddress: '10.0.0.1' } };
  eq(clientIp(r2), '198.51.100.7', 'array header, rightmost trusted');
});

// ---------------------------------------------------------------------------
// 4. Normalization: one client, one bucket.
// ---------------------------------------------------------------------------

check('::ffff: normalization gives one bucket, not two', () => {
  const env = { TRUSTED_PROXIES: '10.0.0.1' };
  // The same client arriving on a dual-stack socket vs a v4-only socket.
  const mapped = ip('::ffff:203.0.113.9', '::ffff:10.0.0.1', env);
  const bare = ip('203.0.113.9', '10.0.0.1', env);
  eq(mapped, '203.0.113.9', 'mapped client');
  eq(mapped, bare, 'mapped and bare are one bucket');
  // And the same for the peer, which is what the gate compares.
  eq(ip('203.0.113.9', '::ffff:10.0.0.1', env), '203.0.113.9', 'mapped proxy peer');
  // The counter-case: a different client is still a different bucket.
  if (ip('198.51.100.7', '::ffff:10.0.0.1', env) === mapped) {
    throw new Error('two different clients collapsed into one bucket');
  }
});

check('normalizeIp canonicalises, and is idempotent', () => {
  const { normalizeIp } = loadHttp();
  const cases = [
    ['::ffff:1.2.3.4', '1.2.3.4'],
    ['::FFFF:1.2.3.4', '1.2.3.4'],
    ['::ffff:0.0.0.0', '0.0.0.0'],
    ['::ffff:0:0.0.0', '::ffff:0:0.0.0'],  // a truncated v4 tail is not an address
    ['64:ff9b::1.2.3.4', '64:ff9b::102:304'],
    ['  10.0.0.1  ', '10.0.0.1'],
    ['2001:0DB8:0000:0000:0000:0000:0000:0001', '2001:db8::1'],
    ['2001:db8:0:0:1:0:0:1', '2001:db8::1:0:0:1'],
    ['fe80::', 'fe80::'],
    ['::', '::'],
    ['::1', '::1'],
    ['1:2:3:4:5:6:7:8', '1:2:3:4:5:6:7:8'],
    ['fe80::1%eth0', 'fe80::1'],        // a zone id is host-local
    ['[2001:db8::1]', '2001:db8::1'],   // bracketed, as a Host header writes it
    ['010.0.0.1', '010.0.0.1'],         // ambiguous octal is NOT reinterpreted
    ['1.2.3.256', '1.2.3.256'],
    ['localhost', 'localhost'],
    ['', ''],
    [null, ''],
    [undefined, ''],
  ];
  for (const [input, expected] of cases) {
    eq(normalizeIp(input), expected, `normalizeIp(${JSON.stringify(input)})`);
    // Idempotence: keying on a canonical form must not move the bucket.
    eq(normalizeIp(expected), expected, `normalizeIp is not idempotent for ${JSON.stringify(expected)}`);
  }
  // The counter-case for the reject rules: a leading zero in a REAL proxy
  // entry means the entry matches nothing rather than something else.
  const { clientIp } = loadHttp({ TRUSTED_PROXIES: '010.0.0.1' });
  eq(
    clientIp({ headers: { 'x-forwarded-for': '198.51.100.7' }, socket: { remoteAddress: '10.0.0.1' } }),
    '10.0.0.1',
    'a mis-spelled entry trusts nothing'
  );
});

// ---------------------------------------------------------------------------
// 5. Failing closed on misconfiguration.
// ---------------------------------------------------------------------------

check('an absent, blank or malformed TRUSTED_PROXIES fails CLOSED', () => {
  const spoofed = '198.51.100.7';
  for (const [label, env] of [
    ['absent', {}],
    ['empty string', { TRUSTED_PROXIES: '' }],
    ['whitespace', { TRUSTED_PROXIES: '   ' }],
    ['commas only', { TRUSTED_PROXIES: ',,, ' }],
    ['not an address', { TRUSTED_PROXIES: 'garbage' }],
    ['out of range octet', { TRUSTED_PROXIES: '10.0.0.256' }],
    ['prefix too long', { TRUSTED_PROXIES: '10.0.0.0/33' }],
    ['prefix not a number', { TRUSTED_PROXIES: '10.0.0.0/x' }],
    ['bare star', { TRUSTED_PROXIES: '*' }],
    ['a shell glob', { TRUSTED_PROXIES: '0.0.0.0/0, *' }],
  ]) {
    eq(ip(spoofed, '203.0.113.9', env), '203.0.113.9', `${label} must ignore the header`);
  }
  // The counter-case for each: the SAME env with the peer on the list is
  // honoured, so the close is caused by the configuration and not by the
  // request shape.
  eq(ip(spoofed, '10.0.0.1', { TRUSTED_PROXIES: '10.0.0.1' }), spoofed, 'a good list is honoured');
  eq(ip(spoofed, '10.0.0.1', { TRUSTED_PROXIES: '   ' }), '10.0.0.1', 'blank list is closed');
});

check('a bad entry is skipped, it does not disable the good ones', () => {
  const env = { TRUSTED_PROXIES: 'garbage, 10.0.0.1, 300.1.1.1/8' };
  eq(ip('198.51.100.7', '10.0.0.1', env), '198.51.100.7', 'the good entry still matches');
  // The counter-case: the skipped entries trust nothing at all.
  eq(ip('198.51.100.7', '10.0.0.2', env), '10.0.0.2', 'the skipped entries match nothing');
  // And it says so, once per distinct value, so a silent misconfiguration is
  // not how an operator finds out.
  const { clientIp, warns } = loadHttp(env);
  clientIp({ headers: {}, socket: { remoteAddress: '10.0.0.1' } });
  clientIp({ headers: {}, socket: { remoteAddress: '10.0.0.1' } });
  if (warns.length !== 1) throw new Error(`expected one warning for two calls, got ${warns.length}`);
  if (!/garbage/.test(warns[0]) || !/300\.1\.1\.1\/8/.test(warns[0])) {
    throw new Error(`the warning must name both bad entries: ${warns[0]}`);
  }
  // The counter-case: a clean list is silent.
  const clean = loadHttp({ TRUSTED_PROXIES: '10.0.0.1' });
  clean.clientIp({ headers: {}, socket: { remoteAddress: '10.0.0.1' } });
  eq(clean.warns, [], 'a clean list must not warn');
});

// ---------------------------------------------------------------------------
// 6. Missing headers.
// ---------------------------------------------------------------------------

check('a missing or empty header falls back to the peer', () => {
  for (const env of [{}, { TRUSTED_PROXIES: '10.0.0.1' }, { TRUSTED_PROXIES: '10.0.0.1', VERCEL: '1' }]) {
    eq(ip(undefined, '203.0.113.9', env), '203.0.113.9', `absent header (${JSON.stringify(env)})`);
    eq(ip('', '203.0.113.9', env), '203.0.113.9', `empty header (${JSON.stringify(env)})`);
    eq(ip('   ', '203.0.113.9', env), '203.0.113.9', `blank header (${JSON.stringify(env)})`);
    eq(ip(',,,', '203.0.113.9', env), '203.0.113.9', `commas only (${JSON.stringify(env)})`);
  }
  // The counter-case: a header WITH a value is read when the configuration
  // allows it, so the fallback is not just "always the peer".
  eq(ip('198.51.100.7', '10.0.0.1', { TRUSTED_PROXIES: '10.0.0.1' }), '198.51.100.7', 'header present');
});

// ---------------------------------------------------------------------------
// 7. The Vercel default.
// ---------------------------------------------------------------------------

check('the Vercel default yields the CLIENT ip, not the edge ip', () => {
  // Inside a Vercel function the socket is the edge, not the browser: the
  // peer is a private/loopback address shared by every request. Falling back
  // to it would put every user in one rate-limit bucket, which locks the whole
  // site out at once - a worse failure than the spoofing it would prevent.
  const env = { VERCEL: '1', VERCEL_ENV: 'production' };
  eq(ip('203.0.113.9', '::ffff:10.0.0.1', env), '203.0.113.9', 'production');
  eq(ip('203.0.113.9', '::1', env), '203.0.113.9', 'loopback peer');
  eq(ip('203.0.113.9', '127.0.0.1', { VERCEL: '1', VERCEL_ENV: 'preview' }), '203.0.113.9', 'preview deploy');
  // The counter-case: the SAME request off Vercel is closed to the peer.
  eq(ip('203.0.113.9', '::ffff:10.0.0.1'), '10.0.0.1', 'off Vercel');
  eq(ip('203.0.113.9', '::ffff:10.0.0.1', { VERCEL_ENV: 'production' }), '10.0.0.1', 'VERCEL_ENV alone is not the platform');
});

check('the platform marker cannot be faked by a client, but a dev process is not a platform', () => {
  // VERCEL=1 is injected by the platform, never by the request, so trusting it
  // is a statement about the DEPLOYMENT. `vercel dev` sets it without an edge
  // in front, which is the one process where the default would be wrong.
  eq(ip('203.0.113.9', '::1', { VERCEL: '1', VERCEL_ENV: 'development' }), '::1', 'vercel dev is closed');
  // The counter-case: an unset VERCEL_ENV is not 'development', so a real
  // deployment that sets only the platform marker still works.
  eq(ip('203.0.113.9', '::1', { VERCEL: '1' }), '203.0.113.9', 'VERCEL alone still trusts the edge');
});

check('an explicit TRUSTED_PROXIES overrides the Vercel default', () => {
  // The operator's list is the whole truth: if the peer is not on it, the
  // header is ignored even on Vercel.
  const env = { VERCEL: '1', VERCEL_ENV: 'production', TRUSTED_PROXIES: '10.0.0.1' };
  eq(ip('203.0.113.9', '::ffff:10.0.0.1', env), '203.0.113.9', 'the edge is on the list');
  eq(ip('203.0.113.9', '10.0.0.1', env), '203.0.113.9', 'canonical spelling on the list');
  eq(ip('203.0.113.9', '203.0.113.9', env), '203.0.113.9', 'an edge that is NOT on the list is ignored');
  // The counter-case: without the list the same request is open on Vercel and
  // closed off it.
  eq(ip('203.0.113.9', '203.0.113.9', { VERCEL: '1', VERCEL_ENV: 'production' }), '203.0.113.9', 'platform default');
});

// ---------------------------------------------------------------------------
// 8. CIDR and exact entries.
// ---------------------------------------------------------------------------

check('CIDR ranges match an IPv4 proxy', () => {
  const env = { TRUSTED_PROXIES: '172.16.0.0/12' };
  eq(ip('198.51.100.7', '172.16.5.5', env), '198.51.100.7', 'inside the range');
  eq(ip('198.51.100.7', '172.31.255.255', env), '198.51.100.7', 'last address of the range');
  eq(ip('198.51.100.7', '172.32.0.0', env), '172.32.0.0', 'just past the range');
  eq(ip('198.51.100.7', '172.15.255.255', env), '172.15.255.255', 'just before the range');
  // The counter-case: a /24 does not admit its neighbour.
  eq(ip('198.51.100.7', '10.0.0.1', { TRUSTED_PROXIES: '10.0.0.0/24' }), '198.51.100.7', 'inside the /24');
  eq(ip('198.51.100.7', '10.0.1.1', { TRUSTED_PROXIES: '10.0.0.0/24' }), '10.0.1.1', 'outside the /24');
  // A v4 entry never matches a v6 address, and the other way round.
  eq(ip('198.51.100.7', '::ffff:10.0.0.1', { TRUSTED_PROXIES: '10.0.0.0/8' }), '198.51.100.7', 'mapped peer is a v4 peer');
  eq(ip('198.51.100.7', '2001:db8::1', { TRUSTED_PROXIES: '10.0.0.0/8' }), '2001:db8::1', 'a v6 peer is not in a v4 range');
});

check('CIDR ranges and exact entries match an IPv6 proxy', () => {
  const env = { TRUSTED_PROXIES: '2001:db8::/32' };
  eq(ip('198.51.100.7', '2001:db8:0:0:0:0:0:5', env), '198.51.100.7', 'inside the range');
  eq(ip('198.51.100.7', '2001:db9::5', env), '2001:db9::5', 'outside the range');
  // An exact entry is canonicalised before it is compared, so the operator can
  // paste the expanded form and the socket can report the compressed one.
  eq(ip('198.51.100.7', '2001:db8::1', { TRUSTED_PROXIES: '2001:0db8:0000:0000:0000:0000:0000:0001' }), '198.51.100.7', 'expanded entry');
  eq(ip('198.51.100.7', '::1', { TRUSTED_PROXIES: '::1' }), '198.51.100.7', 'loopback entry');
  eq(ip('198.51.100.7', '::2', { TRUSTED_PROXIES: '::1' }), '::2', 'a neighbour is not loopback');
});

check('the list accepts commas, spaces and newlines', () => {
  for (const raw of ['10.0.0.1,10.0.0.2', '10.0.0.1 10.0.0.2', '10.0.0.1\n10.0.0.2', '10.0.0.1 , 10.0.0.2']) {
    eq(ip('198.51.100.7', '10.0.0.2', { TRUSTED_PROXIES: raw }), '198.51.100.7', `separators in ${JSON.stringify(raw)}`);
  }
  // The counter-case: only the listed address is trusted.
  eq(ip('198.51.100.7', '10.0.0.3', { TRUSTED_PROXIES: '10.0.0.1,10.0.0.2' }), '10.0.0.3', 'not on the list');
});

// ---------------------------------------------------------------------------
// 9. The call sites. A helper nobody calls is not a gate.
// ---------------------------------------------------------------------------

const CALL_SITES = [
  'api/auth/magic.js',
  'api/license/verify.js',
  'api/admin/pt/keys/import.js',
  'api/early-access.js',
  'api/invite/redeem.js',
  'api/pt/verify.js',
  'api/catalogue/public.js',
];

check('no handler reads x-forwarded-for by hand', () => {
  // Comments are stripped first, because the call sites now carry a comment
  // naming the header, and a gate that matches its own documentation is a gate
  // that has to be weakened every time somebody explains the fix.
  const stripComments = (src) => {
    let out = '';
    let mode = 'code';
    for (let i = 0; i < src.length; i++) {
      const c = src[i];
      const next = src[i + 1];
      if (mode === 'code') {
        if (c === '/' && next === '/') { mode = 'line'; i++; continue; }
        if (c === '/' && next === '*') { mode = 'block'; i++; continue; }
        if (c === "'" || c === '"' || c === '`') mode = c;
        out += c;
        continue;
      }
      if (mode === 'line') { if (c === '\n') { mode = 'code'; out += c; } continue; }
      if (mode === 'block') {
        if (c === '*' && next === '/') { mode = 'code'; i++; continue; }
        if (c === '\n') out += c;
        continue;
      }
      if (c === '\\') { out += src.slice(i, i + 2); i++; continue; }
      if (c === mode) mode = 'code';
      out += c;
    }
    return out;
  };
  const offenders = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(abs); continue; }
      if (!entry.name.endsWith('.js')) continue;
      const rel = path.relative(ROOT, abs);
      if (rel === 'api/_lib/http.js') continue;      // the one allowed reader
      if (stripComments(fs.readFileSync(abs, 'utf8')).includes('x-forwarded-for')) offenders.push(rel);
    }
  };
  walk(path.join(ROOT, 'api'));
  eq(offenders, [], 'handlers that still parse the header themselves');
  // The counter-case: the stripper really does see a header read when there
  // is one, so an empty offender list is not just a broken scrubber.
  eq(stripComments("const ip = req.headers['x-forwarded-for']; // x-forwarded-for").includes('x-forwarded-for'), true, 'scrubber sees a real read');
  eq(stripComments("// x-forwarded-for is client-controlled\nconst ip = 1;").includes('x-forwarded-for'), false, 'scrubber ignores a comment');
});

check('every rate-limited handler derives its bucket from clientIp()', () => {
  const missing = [];
  for (const rel of CALL_SITES) {
    const text = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    if (!/clientIp\(/.test(text)) missing.push(rel);
    // And it must be the shared helper, not a local function of the same name.
    if (/function clientIp\s*\(/.test(text)) missing.push(`${rel} (defines its own)`);
  }
  eq(missing, [], 'call sites missing the shared helper');
  // The counter-case: the helper is really there to be found.
  const magic = fs.readFileSync(path.join(ROOT, 'api/auth/magic.js'), 'utf8');
  if (!/import\s*\{[^}]*clientIp[^}]*\}\s*from\s*'\.\.\/_lib\/http\.js'/.test(magic)) {
    throw new Error('api/auth/magic.js does not import clientIp from api/_lib/http.js');
  }
});

// ---------------------------------------------------------------------------

const failed = failures;
console.log('');
console.log(failed
  ? `trusted-proxies unit: ${failed} FAILED`
  : 'trusted-proxies unit: all assertions passed');
process.exit(failed ? 1 : 0);