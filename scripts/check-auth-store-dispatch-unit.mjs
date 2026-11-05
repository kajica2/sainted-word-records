#!/usr/bin/env node
// scripts/check-auth-store-dispatch-unit.mjs - auth store dispatch gate.
//
// api/_lib/db.js is the ONLY entry point the routes use for users,
// provider links, verification tokens, sessions and the connect blob. It
// holds two implementations: the local JSON/Postgres store (its own body)
// and the Firestore store in api/_lib/auth-firestore.js. Every exported
// auth function opens with a dispatch guard:
//
//   const store = authStore();
//   if (store) return store.<fn>(<args>);
//
// authStore() returns the Firestore module when
// fsAuth.authFirestoreEnabled() is true - i.e. when
// SWR_AUTH_STORE === 'firestore' AND Firestore is configured - and null
// otherwise.
//
// This gate PROVES the dispatch really happens: with the switch ON the
// data lands in Firestore and NOT in the local JSON files, with the switch
// OFF the opposite, and the SAME imported module instance honours the
// switch on every call.
//
// There is no live Firestore (and no JVM for the emulator). api/_lib/ is
// copied to a temp dir, the copy's firestore.js is replaced with a stub
// whose getFirestore() hands back the in-memory fake from
// scripts/lib/fake-firestore.mjs, and the COPY's db.js is imported and
// driven. The copy's own auth-firestore.js imports that stub, so the code
// under test is the shipped code, not a re-implementation.
//
// Assertions (behaviour, not wiring):
//   1. with SWR_AUTH_STORE=firestore, createUser lands in the fake
//      Firestore `users` collection
//   2. with SWR_AUTH_STORE=firestore, the local auth/users.json does NOT
//      contain the user
//   3. with SWR_AUTH_STORE=firestore, findUserByEmail finds the user
//      that was just created - and the local store does not hold it, so
//      the read came from Firestore
//   4. with SWR_AUTH_STORE=firestore, createSession + getSession
//      round-trip and the session lands in the fake `sessions` collection
//   5. with SWR_AUTH_STORE=firestore, health() reports authStore
//      'firestore' and its users/sessions counts are the Firestore ones
//   6. with SWR_AUTH_STORE unset, createUser lands in the local
//      $SWRC_DATA_DIR/auth/users.json and NOT in the fake Firestore
//   7. with SWR_AUTH_STORE unset, health() reports authStore 'filesystem'
//      and its user count is the local file's, not Firestore's
//   8. the switch is honoured PER CALL: flipping SWR_AUTH_STORE back to
//      'firestore' on the same module instance sends the next createUser
//      to Firestore and not to the local JSON store
//
// The gate proves it can still fail: the copy of db.js is mutated in
// memory (the createUser dispatch guard deleted, authStore() forced to
// null, the createSession dispatch guard deleted) and the SAME assertions
// are re-run against each mutant - the Firestore-side assertions must go
// RED, and exactly those.
//
// Run:  node scripts/check-auth-store-dispatch-unit.mjs
// Exit: 0 PASS, 1 FAIL.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { createFakeFirestore } from './lib/fake-firestore.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const LIB = path.join(ROOT, 'api/_lib');
const NODE_MODULES = path.join(ROOT, 'node_modules');

let pass = 0;
const failures = [];
function assert(cond, msg, detail) {
  if (cond) {
    pass++;
    console.log('  ok  ', msg, detail != null ? `(${detail})` : '');
  } else {
    failures.push(msg);
    console.log('  FAIL', msg, detail != null ? `(${detail})` : '');
  }
}

// ── the environment the copies run in ──────────────────────────────────────
// db.js reads SWRC_DATA_DIR at module load (the local store's root) and
// the database URL at module load too (Postgres vs the JSON files), so
// both are pinned before the copy is imported. Everything is restored
// when the gate is done.
const SAVED_ENV = {};
for (const key of ['SWRC_DATA_DIR', 'SWR_AUTH_STORE', 'DATABASE_URL',
  'POSTGRES_URL', 'PRISMA_DATABASE_URL', 'NODE_ENV']) {
  SAVED_ENV[key] = process.env[key];
}
function restoreEnv() {
  for (const key of Object.keys(SAVED_ENV)) {
    if (SAVED_ENV[key] === undefined) delete process.env[key];
    else process.env[key] = SAVED_ENV[key];
  }
}

function prepareEnv(dataDir) {
  // The local JSON store writes here - never into the repo's data/.
  process.env.SWRC_DATA_DIR = dataDir;
  // Force the filesystem backend: the Postgres backend is chosen from
  // DATABASE_URL at module load, and this gate must never open a pool.
  delete process.env.DATABASE_URL;
  delete process.env.POSTGRES_URL;
  delete process.env.PRISMA_DATABASE_URL;
  // db.js only prints its "no DATABASE_URL" warning outside of tests.
  process.env.NODE_ENV = 'test';
}

// ── a disposable copy of api/_lib ──────────────────────────────────────────
// The copy keeps the relative imports working (auth-firestore.js imports
// ./firestore.js and ./ids.js from the same directory), so the shipped
// code runs unmodified apart from the deliberate firestore.js stub.
function makeLibCopy(tag) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'swr-auth-dispatch-lib-'));
  fs.cpSync(LIB, dir, { recursive: true });

  // The copy lives outside the repo, so `import '@vercel/blob'` (a static
  // import in db.js) would not resolve. A symlink to the repo's
  // node_modules keeps the copy's dependency resolution identical to the
  // repo's without copying anything into the repo tree.
  fs.symlinkSync(NODE_MODULES, path.join(dir, 'node_modules'), 'dir');

  // The copy's .js files are ESM (the repo's package.json says so); the
  // temp dir has no package.json, so declare it here.
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify({ name: 'swr-auth-dispatch-copy', type: 'module' }, null, 2) + '\n'
  );

  // The fake lives on globalThis under a per-copy key, so the shipped
  // copy and every mutant copy get their own store.
  const key = `__SWR_TEST_FAKE_FS_${tag}`;
  fs.writeFileSync(path.join(dir, 'firestore.js'), `// Test stub replacing api/_lib/firestore.js inside the temp copy.
// The Firestore client is the in-memory fake the gate installed on
// globalThis: no network, no emulator, no credentials.
export function firestoreConfigured() {
  return true;
}

export async function getFirestore() {
  return globalThis[${JSON.stringify(key)}];
}
`);

  return { dir, key };
}

async function loadDb(copy, dataDir) {
  prepareEnv(dataDir);
  const fake = createFakeFirestore();
  globalThis[copy.key] = fake;
  const mod = await import(pathToFileURL(path.join(copy.dir, 'db.js')).href);
  return { db: mod, fake };
}

// ── the assertion suite ───────────────────────────────────────────────────
// One function, parameterised by the imported db module, the fake
// Firestore and the local data dir, so the SAME assertions can be run
// against the shipped copy and against each mutated copy.
async function runSuite(db, fake, dataDir, check) {
  const usersPath = path.join(dataDir, 'auth', 'users.json');
  const readLocalUsers = () => {
    try {
      const parsed = JSON.parse(fs.readFileSync(usersPath, 'utf8'));
      return Array.isArray(parsed) ? parsed : [];
    } catch (_) {
      return [];
    }
  };
  const fakeUsers = async () => {
    const snap = await fake.collection('users').get();
    return snap.docs.map((d) => d.data() || {});
  };

  // ---- the Firestore store is live ----
  process.env.SWR_AUTH_STORE = 'firestore';
  const user = await db.createUser({ email: 'fs-one@example.com', name: 'FS One' });
  await db.createUser({ email: 'fs-two@example.com', name: 'FS Two' });

  // 1. the user is in Firestore
  {
    const users = await fakeUsers();
    const hit = users.find((u) => u.email === 'fs-one@example.com');
    check(1, !!hit && hit.id === user.id,
      'with SWR_AUTH_STORE=firestore, createUser lands in the Firestore users collection',
      hit ? hit.id : 'not in firestore');
  }

  // 2. the user is NOT in the local JSON store
  {
    const local = readLocalUsers();
    const hit = local.find((u) => u.email === 'fs-one@example.com');
    check(2, !hit,
      'with SWR_AUTH_STORE=firestore, the local auth/users.json does not hold the user',
      hit ? `local has ${hit.email}` : `local users: ${local.length}`);
  }

  // 3. findUserByEmail round-trips through Firestore
  {
    const found = await db.findUserByEmail('fs-one@example.com');
    const local = readLocalUsers();
    const inLocal = local.some((u) => u.email === 'fs-one@example.com');
    check(3, !!found && found.id === user.id && !inLocal,
      'with SWR_AUTH_STORE=firestore, findUserByEmail finds the user just created (via Firestore)',
      found ? `${found.id} local=${inLocal}` : 'null');
  }

  // 4. the session round-trips and lands in Firestore
  {
    const session = await db.createSession({ userId: user.id });
    const got = await db.getSession(session.token);
    const snap = await fake.collection('sessions').get();
    const inFirestore = snap.docs.some((d) => (d.data() || {}).token === session.token);
    check(4, !!got && got.token === session.token && got.userId === user.id && inFirestore,
      'with SWR_AUTH_STORE=firestore, a session round-trips and lands in the Firestore sessions collection',
      `got=${got ? 'ok' : 'null'} inFirestore=${inFirestore}`);
  }

  // 5. health() reports the Firestore counts
  {
    const h = await db.health();
    check(5, h.authStore === 'firestore' && h.users === 2 && h.sessions === 1,
      'with SWR_AUTH_STORE=firestore, health() reports authStore firestore and the Firestore counts',
      `authStore=${h.authStore} users=${h.users} sessions=${h.sessions}`);
  }

  // ---- the switch is off: the local JSON store serves ----
  delete process.env.SWR_AUTH_STORE;
  const localUser = await db.createUser({ email: 'local-one@example.com', name: 'Local One' });

  // 6. the user is in the local file and NOT in Firestore
  {
    const local = readLocalUsers();
    const inLocal = local.some((u) => u.email === 'local-one@example.com');
    const users = await fakeUsers();
    const inFirestore = users.some((u) => u.email === 'local-one@example.com');
    check(6, inLocal && !inFirestore && !!localUser && !!localUser.id,
      'with SWR_AUTH_STORE unset, createUser lands in the local users.json and NOT in Firestore',
      `local=${inLocal} firestore=${inFirestore}`);
  }

  // 7. health() reports the local counts
  {
    const local = readLocalUsers();
    const users = await fakeUsers();
    const h = await db.health();
    check(7, h.authStore === 'filesystem' && h.users === local.length && h.users !== users.length,
      'with SWR_AUTH_STORE unset, health() reports authStore filesystem and the local user count',
      `authStore=${h.authStore} users=${h.users} local=${local.length} firestore=${users.length}`);
  }

  // ---- the switch is honoured per call, on the SAME module instance ----
  process.env.SWR_AUTH_STORE = 'firestore';
  const again = await db.createUser({ email: 'fs-three@example.com', name: 'FS Three' });
  {
    const users = await fakeUsers();
    const inFirestore = users.some((u) => u.email === 'fs-three@example.com');
    const inLocal = readLocalUsers().some((u) => u.email === 'fs-three@example.com');
    check(8, inFirestore && !inLocal && !!again,
      'the same module instance honours the switch per call (back on: Firestore, not the local store)',
      `firestore=${inFirestore} local=${inLocal}`);
  }
}

// ── run the suite against the shipped copy ─────────────────────────────────
console.log('auth store dispatch gate');
console.log('');

const tmpRoots = [];
function tmpDir(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpRoots.push(dir);
  return dir;
}

const shippedCopy = makeLibCopy('shipped');
const shippedData = tmpDir('swr-auth-dispatch-data-');
const shipped = await loadDb(shippedCopy, shippedData);

const shippedResults = [];
await runSuite(shipped.db, shipped.fake, shippedData, (n, cond, msg, detail) => {
  shippedResults.push({ n, ok: !!cond });
  assert(cond, `${n}. ${msg}`, detail);
});

// ── the mutation self-test ────────────────────────────────────────────────
// Copy api/_lib/ to a temp dir, mutate the copy's db.js, import it, and
// re-run the SAME assertions: the Firestore-side assertions must go RED
// and only those. The repo tree is never written to.
async function runMutant(label, mutate, expectRed) {
  const copy = makeLibCopy(label);
  const dataDir = tmpDir(`swr-auth-dispatch-data-${label}-`);
  try {
    const target = path.join(copy.dir, 'db.js');
    const original = fs.readFileSync(target, 'utf8');
    const mutated = mutate(original);
    if (mutated === original) {
      failures.push(`mutant ${label}: the mutation did not change the source`);
      console.log('  FAIL', `mutant ${label}: the mutation did not change the source`);
      return;
    }
    fs.writeFileSync(target, mutated);
    const mod = await loadDb(copy, dataDir);
    const results = [];
    let threw = null;
    try {
      await runSuite(mod.db, mod.fake, dataDir, (n, cond) => results.push({ n, ok: !!cond }));
    } catch (e) {
      threw = e;
    }
    const red = results.filter((r) => !r.ok).map((r) => r.n).sort((a, b) => a - b);
    const expected = [...expectRed].sort((a, b) => a - b);
    const same = red.length === expected.length && red.every((n, i) => n === expected[i]);
    assert(same && !threw,
      `RED PROOF: the ${label} mutant turns assertion(s) ${expectRed.join(', ')} RED and only those`,
      threw ? `threw: ${threw.message}` : `red assertions: [${red.join(', ')}]`);
  } finally {
    delete globalThis[copy.key];
    try {
      fs.rmSync(copy.dir, { recursive: true, force: true });
    } catch (_) {}
  }
}

await runMutant(
  'createUser-guard-removed',
  (src) => src.replace(
    '  if (store) return store.createUser({ email, name, image, provider });',
    '  /* the dispatch guard is gone */'
  ),
  [1, 2, 3, 5, 8]
);

await runMutant(
  'authStore-always-null',
  (src) => src.replace(
    '  return fsAuth.authFirestoreEnabled() ? fsAuth : null;',
    '  return null;'
  ),
  [1, 2, 3, 4, 5, 8]
);

await runMutant(
  'createSession-guard-removed',
  (src) => src.replace(
    '  if (store) return store.createSession({ userId, ttlMs });',
    '  /* the dispatch guard is gone */'
  ),
  [4, 5]
);

// ── cleanup ───────────────────────────────────────────────────────────────
delete globalThis[shippedCopy.key];
restoreEnv();
for (const dir of tmpRoots) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch (_) {}
}
try {
  fs.rmSync(shippedCopy.dir, { recursive: true, force: true });
} catch (_) {}

// ── summary ───────────────────────────────────────────────────────────────
console.log('');
console.log(`PASS: ${pass}`);
console.log(`FAIL: ${failures.length}`);
if (failures.length) {
  console.log('');
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
process.exit(0);
