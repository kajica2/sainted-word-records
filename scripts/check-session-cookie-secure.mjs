#!/usr/bin/env node
// scripts/check-session-cookie-secure.mjs - unit test for the P2.2 fix
// in api/_lib/http.js.
//
// Plan: docs/PLANS/architecture-audit-2026-10.md, section 2.2. The set
// cookie carries Secure; the clear cookie did not. The fix is one
// token; the test is the gate that keeps it that way.
//
// The behavioural contract we assert:
//   1. setSessionCookie(res, token) writes a Set-Cookie with Secure.
//   2. clearSessionCookie(res) writes a Set-Cookie with Secure.
//   3. Both write the same suite of flags otherwise: Path=/,
//      HttpOnly, SameSite=Lax. The deletion's only difference from
//      the set is the empty value + Max-Age=0.
//   4. The deletion does NOT echo the token - the value stays empty.
//   5. readSessionCookie({headers:{cookie:'swrc_session=t'}}) parses
//      it back. readSessionCookie({}) returns null (no header). With
//      a foreign cookie mixed in (`other=x; swrc_session=t`) the
//      parser ignores the foreign segment and reads the swrc value.
//   6. COOKIE_NAME equals 'swrc_session' (the constant the rest of
//      the codebase keys on).
//
// http.js is a small ESM leaf module (no imports, just exports). We
// strip the `export ` keyword from the source text and run the rest
// in a node:vm sandbox - that loads it as a script while still
// catching any future regression on the visible-flag contract.

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

let failures = 0;
function assert(cond, msg) {
  if (cond) console.log('  PASS', msg);
  else { console.log('  FAIL', msg); failures++; }
}

// -- Mock response object that captures Set-Cookie ---------------

function makeRes() {
  const headers = Object.create(null);
  return {
    headers,
    setHeader(name, value) {
      headers[name] = value;
    },
    getHeader(name) {
      return Object.prototype.hasOwnProperty.call(headers, name) ? headers[name] : undefined;
    },
  };
}

// -- Load http.js into a node:vm sandbox -------------------------

// http.js is ESM with `export function` and `export const`. To run
// it as a script we strip the `export` keyword, but top-level
// `const` declarations in script mode do NOT attach to the global
// (only `var`, `function`, and `class` do). Promote `const` to `var`
// so every export becomes a real property on the sandbox. Function
// bodies reference `process` only inside functions the test does not
// call, so we do not stub it.
const SRC = fs.readFileSync(path.join(ROOT, 'api/_lib/http.js'), 'utf8');
const SCRIPT = SRC
  .replace(/^export\s+const\b/gm, 'var')
  .replace(/^export\s+(?=function|async|class)/gm, '');

const sandbox = {
  console: { log() {}, warn() {}, error() {} },
};
vm.createContext(sandbox);
vm.runInContext(SCRIPT, sandbox, { filename: 'http.js' });

const {
  COOKIE_NAME,
  setSessionCookie,
  clearSessionCookie,
  readSessionCookie,
} = sandbox;

// -- Static checks: cookie name + flag suite --------------------

console.log('session cookie: constant');
assert(COOKIE_NAME === 'swrc_session', "COOKIE_NAME is 'swrc_session'");

// -- setSessionCookie carries Secure + the standard flags -------

console.log('session cookie: set carries Secure');
const setRes = makeRes();
setSessionCookie(setRes, 'tok_abc_123');
const setCookie = setRes.getHeader('Set-Cookie') || '';
assert(typeof setCookie === 'string' && setCookie.length > 0, 'setSessionCookie writes a Set-Cookie header');
assert(/\bSecure\b/.test(setCookie), 'setSessionCookie sets Secure');
assert(/\bHttpOnly\b/.test(setCookie), 'setSessionCookie sets HttpOnly');
assert(/\bSameSite=Lax\b/.test(setCookie), 'setSessionCookie sets SameSite=Lax');
assert(/Path=\//.test(setCookie), 'setSessionCookie sets Path=/');
assert(/\bMax-Age=2592000\b/.test(setCookie), 'setSessionCookie sets a 30-day Max-Age by default');
assert(/swrc_session=tok_abc_123/.test(setCookie), 'setSessionCookie carries the token');

// -- clearSessionCookie carries Secure + the standard flags -----

console.log('session cookie: clear carries Secure (P2.2 fix)');
const clearRes = makeRes();
clearSessionCookie(clearRes);
const clearCookie = clearRes.getHeader('Set-Cookie') || '';
assert(typeof clearCookie === 'string' && clearCookie.length > 0, 'clearSessionCookie writes a Set-Cookie header');
assert(/\bSecure\b/.test(clearCookie), 'clearSessionCookie sets Secure (matches set cookie)');
assert(/\bHttpOnly\b/.test(clearCookie), 'clearSessionCookie sets HttpOnly');
assert(/\bSameSite=Lax\b/.test(clearCookie), 'clearSessionCookie sets SameSite=Lax');
assert(/Path=\//.test(clearCookie), 'clearSessionCookie sets Path=/');
assert(/\bMax-Age=0\b/.test(clearCookie), 'clearSessionCookie sets Max-Age=0');
assert(/swrc_session=;/.test(clearCookie), 'clearSessionCookie clears the value (empty token)');
assert(!/swrc_session=[^;]/.test(clearCookie), 'clearSessionCookie does not echo any token');

// -- The deletion is a close relative of the set ----------------
// Same flag suite, both carry Secure, only difference is value +
// Max-Age. This is the structural property the plan calls out.
console.log('session cookie: set + delete flag set match');
const setFlags = new Set(setCookie.split(/;\s*/).filter(Boolean).map((s) => s.split('=')[0]));
const clearFlags = new Set(clearCookie.split(/;\s*/).filter(Boolean).map((s) => s.split('=')[0]));
const onlyInSet = [...setFlags].filter((f) => !clearFlags.has(f));
const onlyInClear = [...clearFlags].filter((f) => !setFlags.has(f));
assert(
  onlyInSet.length === 0 && onlyInClear.length === 0,
  'set + delete cookies carry the same flag set',
  onlyInSet.length || onlyInClear.length
    ? ('only set=' + JSON.stringify(onlyInSet) + ' only clear=' + JSON.stringify(onlyInClear))
    : ''
);

// -- readSessionCookie: parses the swrc cookie back --------------

console.log('session cookie: read parses + ignores foreign cookies');
assert(
  readSessionCookie({ headers: { cookie: 'swrc_session=tok_abc_123' } }) === 'tok_abc_123',
  'reads a lone swrc_session cookie back'
);
assert(
  readSessionCookie({ headers: { cookie: 'other=x; swrc_session=tok_abc_123' } }) === 'tok_abc_123',
  'reads swrc_session when a foreign cookie precedes it'
);
assert(
  readSessionCookie({ headers: { cookie: 'swrc_session=tok_abc_123; other=y' } }) === 'tok_abc_123',
  'reads swrc_session when a foreign cookie follows it'
);
assert(
  readSessionCookie({ headers: { cookie: 'other=x; other2=y' } }) === null,
  'returns null when no swrc_session cookie present'
);
assert(
  readSessionCookie({ headers: {} }) === null,
  'returns null when no Cookie header at all'
);
assert(
  readSessionCookie({ headers: null }) === null,
  'returns null when headers missing entirely'
);
assert(
  readSessionCookie({ headers: { cookie: 'swrc_session=' } }) === null,
  'returns null when swrc_session has empty value'
);

console.log('');
if (failures === 0) {
  console.log('ALL GREEN - set + delete session cookies both carry Secure; parser behaviour intact');
  process.exit(0);
} else {
  console.log(failures + ' FAILED');
  process.exit(1);
}
