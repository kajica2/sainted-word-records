// scripts/check-grant-invite-batch-unit.mjs — unit coverage for the batch
// grant helpers in scripts/grant-invite.mjs.
//
// Pure helpers only (parseEmails / normalizeEmail / planBatch) — no store, no
// I/O. grant-invite.mjs imports api/_lib/kv.js, which resolves its store from
// db.js at call time (DATABASE_URL → Postgres, else ./data files), so loading
// the module for its exports is safe with no env set. The module's own main()
// is guarded by an entry-point check so importing it never executes the CLI.
//
// Asserts:
//  - parseEmails splits on commas AND newlines, trims, lowercases, drops
//    empties, dedupes in first-seen order, tolerates non-string input.
//  - normalizeEmail accepts well-formed addresses, rejects malformed ones.
//  - planBatch mints fresh codes on create, reuses index codes on repeat,
//    never mutates the caller's Map, tolerates empty input.

// grant-invite.mjs lives in the same scripts/ directory as this test.
const cliUrl = new URL('./grant-invite.mjs', import.meta.url).href;

// The entry-point guard in grant-invite.mjs compares import.meta.url against
// process.argv[1]; argv is the runner's, so importing never calls main().
const { parseEmails, normalizeEmail, planBatch } = await import(cliUrl);

let failures = 0;
function check(name, fn) {
  try {
    fn();
    console.log('  ✓', name);
  } catch (e) {
    failures++;
    console.log('  ✗', name, '\n     ', e.message);
  }
}
function eq(actual, expected, label) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) throw new Error(`${label}: expected ${b}, got ${a}`);
}

console.log('grant-invite batch unit:');

check('parseEmails splits on commas and newlines, trims, lowercases, dedupes', () => {
  eq(
    parseEmails(' A@X.com , b@y.com\nc@z.com, a@x.com\n\n  '),
    ['a@x.com', 'b@y.com', 'c@z.com'],
    'parseEmails'
  );
});

check('parseEmails handles non-string input', () => {
  eq(parseEmails(null), [], 'null');
  eq(parseEmails(undefined), [], 'undefined');
  eq(parseEmails(42), [], 'number');
});

check('normalizeEmail accepts well-formed addresses', () => {
  eq(normalizeEmail('  Kai@Example.COM  '), 'kai@example.com', 'trim+lower');
  eq(normalizeEmail('a.b+c@sub.domain.org'), 'a.b+c@sub.domain.org', 'username+domain');
});

check('normalizeEmail rejects malformed addresses', () => {
  eq(normalizeEmail('no-at-sign'), null, 'missing @');
  eq(normalizeEmail('a@nodot'), null, 'missing tld');
  eq(normalizeEmail('sp ace@x.com'), null, 'space in local');
  eq(normalizeEmail('a@x.com\nb@y.com'), null, 'newline inside address');
  eq(normalizeEmail(''), null, 'empty');
});

check('planBatch mints fresh codes on create', () => {
  const plan = planBatch(['a@x.com', 'b@y.com'], new Map());
  eq(plan.map((p) => p.action), ['create', 'create'], 'actions');
  if (plan[0].code === plan[1].code) throw new Error('codes must differ');
  if (!/^[A-Z0-9]{5}-[A-Z0-9]{5}-[A-Z0-9]{5}$/.test(plan[0].code)) {
    throw new Error('code shape wrong: ' + plan[0].code);
  }
});

check('planBatch reuses the index code on repeat', () => {
  const index = new Map([['a@x.com', 'AAAAA-BBBBB-CCCCC']]);
  const plan = planBatch(['a@x.com', 'b@y.com'], index);
  eq(plan.map((p) => p.action), ['reuse', 'create'], 'actions');
  if (plan[0].code !== 'AAAAA-BBBBB-CCCCC') throw new Error('reused code wrong');
  eq(index.has('b@y.com'), false, 'caller index not mutated');
});

check('planBatch tolerates an empty email list', () => {
  eq(planBatch([], new Map()), [], 'empty');
});

const failedCount = failures;
console.log('\n' + (failedCount ? `grant-invite batch unit: ${failedCount} FAILED` : 'grant-invite batch unit: all assertions passed'));
process.exit(failedCount ? 1 : 0);