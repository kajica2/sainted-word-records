#!/usr/bin/env node
// scripts/check-cors-preview-domain.mjs  -  P2.1 unit test.
//
// The CORS allowlist in api/_lib/http.js used to be three hardcoded
// origins, so a Vercel preview deploy (a URL of the form
// `https://sainted-word-records-git-<branch>-<user>.vercel.app`) was
// silently rejected. The fix widened the allowlist into a list of exact
// origins + regex patterns, with the regex namespace match restricted to
// `https://*.vercel.app` (and `httpsOnly: true` so it cannot bind to an
// http:// preview, a redirect target or a path-embedded match).
//
// What we assert:
//   1. The canonical production origin still passes (the SWRC_APP_ORIGIN
//      env default or the localhost dev entries  -  at least one).
//   2. A Vercel preview branch URL passes (`https://<anything>.vercel.app`).
//   3. An http:// wildcard match is REJECTED (the `httpsOnly` guard).
//   4. A path-embedded match is REJECTED (hostname-only test, not the
//      whole URL string).
//   5. A redirect-target-shaped `Origin` (an absolute URL with path +
//      query) only matches because its HOSTNAME matches, not its tail.
//   6. A non-vercel random origin is REJECTED  -  the regex is anchored.
//   7. The response ALWAYS carries the safe response headers (Methods,
//      Headers, Credentials, Max-Age), regardless of the Origin result.
//   8. setCors does NOT throw when called without an `origin` argument
//      (the previous "echo back" failure mode where callers were expected
//      to pass a header).

import * as http from './lib/mini-resp.mjs';

const { setCors } = await import('../api/_lib/http.js');

let failures = 0;
function assert(cond, msg, detail) {
  if (cond) {
    console.log('  ✓', msg, detail ? `(${detail})` : '');
  } else {
    console.log('  ✗', msg, detail ? `(${detail})` : '');
    failures += 1;
  }
}

function makeRes() {
  return http.makeRes();
}

function getHeader(res, name) {
  // Match Node's case-insensitive header lookup (ServerResponse.getHeader
  // lowercases its argument). The mock stores lowercased.
  return res.getHeader(name);
}

function section1() {
  console.log('\n=== 1. Production origin (SWRC_APP_ORIGIN default) passes ===');
  // Clear SWRC_APP_ORIGIN so the default kicks in
  delete process.env.SWRC_APP_ORIGIN;
  const res = makeRes();
  setCors(res, 'https://sainted-word-records.vercel.app');
  assert(
    getHeader(res, 'Access-Control-Allow-Origin') === 'https://sainted-word-records.vercel.app',
    "Access-Control-Allow-Origin === 'https://sainted-word-records.vercel.app'",
    getHeader(res, 'Access-Control-Allow-Origin')
  );
  assert(getHeader(res, 'Vary') === 'Origin', "Vary: Origin header present");
}

function section2() {
  console.log('\n=== 2. Localhost dev origins pass (5174 / 4173) ===');
  for (const origin of ['http://localhost:5174', 'http://localhost:4173']) {
    const res = makeRes();
    setCors(res, origin);
    assert(
      getHeader(res, 'Access-Control-Allow-Origin') === origin,
      `${origin} → Allow-Origin echoed`,
      getHeader(res, 'Access-Control-Allow-Origin')
    );
  }
}

function section3() {
  console.log('\n=== 3. Vercel preview branch URLs match the regex ===');
  const previewOrigins = [
    'https://sainted-word-records-git-feature-abc123.vercel.app',
    'https://sainted-word-records-git-fix-engine-xyz789.vercel.app',
    'https://sainted-word-records.vercel.app', // prod canonical also matches
    // The Vercel ephemeral "PR" subdomain pattern
    'https://sainted-word-records-pr-42.vercel.app',
    // Bare domain is a single-label Host, not a "branch" - still matches the regex
    'https://random-team-name.vercel.app',
  ];
  for (const origin of previewOrigins) {
    const res = makeRes();
    setCors(res, origin);
    assert(
      getHeader(res, 'Access-Control-Allow-Origin') === origin,
      `${origin} → Allow-Origin echoed`,
      getHeader(res, 'Access-Control-Allow-Origin')
    );
  }
}

function section4() {
  console.log('\n=== 4. http:// wildcard match is REJECTED (httpsOnly guard) ===');
  const httpOrigins = [
    'http://sainted-word-records-git-feature.vercel.app', // non-https version
    'http://attacker.example.vercel.app', // same TLD but http
  ];
  for (const origin of httpOrigins) {
    const res = makeRes();
    setCors(res, origin);
    assert(
      !getHeader(res, 'Access-Control-Allow-Origin'),
      `${origin} → Allow-Origin header NOT set`,
      getHeader(res, 'Access-Control-Allow-Origin')
    );
  }
}

function section5() {
  console.log('\n=== 5. Path/query embedded in Origin does NOT match (hostname-only) ===');
  // The Origin header MUST be a same-origin scheme + host + port - no path,
  // no query. But a malicious or malformed caller could try to slip them in;
  // the regex matches HOSTNAME so "/.vercel.app/../" or "?foo=.vercel.app"
  // never match.
  const sneaks = [
    'https://evil.example.com/.vercel.app',
    'https://evil.example.com/?host=.vercel.app',
    'https://evil.example.com#.vercel.app',
  ];
  for (const origin of sneaks) {
    const res = makeRes();
    setCors(res, origin);
    assert(
      !getHeader(res, 'Access-Control-Allow-Origin'),
      `${origin} → Allow-Origin header NOT set (hostname-only match)`,
      getHeader(res, 'Access-Control-Allow-Origin')
    );
  }
}

function section6() {
  console.log('\n=== 6. Non-vercel host is REJECTED (regex is anchored) ===');
  const rejected = [
    'https://www.example.com',
    'https://sainted-word-records.vercel.app.attacker.com', // suffix attack
    'https://attacker.com/redirect?to=sainted-word-records.vercel.app', // not an Origin header but tests path doesn't matter
  ];
  for (const origin of rejected) {
    const res = makeRes();
    setCors(res, origin);
    assert(
      !getHeader(res, 'Access-Control-Allow-Origin'),
      `${origin} → Allow-Origin header NOT set`,
      getHeader(res, 'Access-Control-Allow-Origin')
    );
  }
}

function section7() {
  console.log('\n=== 7. Response ALWAYS carries the safe CORS headers ===');
  // Regardless of whether the Origin matched, the standard CORS response
  // headers are always set on the ServerResponse.
  for (const origin of [
    'https://sainted-word-records.vercel.app',
    'https://random-branch.vercel.app',
    'https://attacker.example.com',
  ]) {
    const res = makeRes();
    setCors(res, origin);
    assert(
      getHeader(res, 'Access-Control-Allow-Methods') === 'GET,POST,PUT,DELETE,OPTIONS',
      'Allow-Methods present'
    );
    assert(
      getHeader(res, 'Access-Control-Allow-Headers') === 'Content-Type, Authorization',
      'Allow-Headers present'
    );
    assert(
      getHeader(res, 'Access-Control-Allow-Credentials') === 'true',
      'Allow-Credentials === true'
    );
    assert(
      getHeader(res, 'Access-Control-Max-Age') === '600',
      'Max-Age === 600'
    );
  }
}

function section8() {
  console.log('\n=== 8. setCors handles no-origin call without throwing ===');
  // Some callers (notably OPTIONS pre-flight handlers that don't read the
  // Origin header) call setCors without an Origin. The previous wrong code
  // crashed or set Vary: null. Both current and previous should not throw.
  for (const origin of [null, undefined, '']) {
    const res = makeRes();
    let threw = false;
    try {
      setCors(res, origin);
    } catch (e) {
      threw = true;
    }
    assert(!threw, `setCors(res, ${String(origin)}) did not throw`);
  }
}

function section9() {
  console.log('\n=== 9. SWRC_APP_ORIGIN env override wins ===');
  process.env.SWRC_APP_ORIGIN = 'https://custom.example.com';
  try {
    const res = makeRes();
    setCors(res, 'https://custom.example.com');
    assert(
      getHeader(res, 'Access-Control-Allow-Origin') === 'https://custom.example.com',
      'Custom SWRC_APP_ORIGIN passes'
    );
    const res2 = makeRes();
    setCors(res2, 'https://sainted-word-records.vercel.app');
    // The default production URL no longer matches because SWRC_APP_ORIGIN
    // replaces the first entry. But it still matches the `*.vercel.app` regex.
    assert(
      getHeader(res2, 'Access-Control-Allow-Origin') === 'https://sainted-word-records.vercel.app',
      '... and so does the default prod URL via the regex'
    );
  } finally {
    delete process.env.SWRC_APP_ORIGIN;
  }
}

async function main() {
  section1();
  section2();
  section3();
  section4();
  section5();
  section6();
  section7();
  section8();
  section9();
  console.log('\n' + (failures === 0
    ? 'CORS PREVIEW: all assertions passed'
    : `CORS PREVIEW: ${failures} failure(s)`));
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('CAUGHT:', e.stack);
  process.exit(2);
});
