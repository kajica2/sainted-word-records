// scripts/check-media-offsite-unit.mjs — unit coverage for the off-site
// media packs (scripts/lib/packs-offsite.mjs) and the publish plan
// (scripts/publish-media-offsite.mjs).
//
// Contract under test:
//   - normalizeBase() accepts ONLY an absolute http(s) URL and always
//     leaves it with a trailing slash (the manifest's paths are joined
//     onto the base, so the slash is the join)
//   - packsCopyPlan() is 'full' without a base and 'manifest-only' with
//     one: the deploy ships the media only when nothing is off-site
//   - rewriteManifest() changes the base and NOTHING else — the pack
//     lists, the covers and every other key are preserved verbatim
//   - listPackFiles() walks the packs directory, stays inside it (a
//     path that escapes is refused, the host is public) and reports the
//     real sizes
//   - offsiteSavings() is everything except the manifest
//   - the publish plan is PURE: it maps the walk onto the host's paths
//     without touching the network, so --dry-run cannot upload
//
// The packs are what the library drawer loads; a wrong base or a lost
// pack path breaks the site silently, so this is worth pinning down.

import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

import {
  PACKS_DIR,
  listPackFiles,
  normalizeBase,
  offsiteSavings,
  packsCopyPlan,
  rewriteManifest,
} from './lib/packs-offsite.mjs';
import {
  baseFromBlobUrl,
  blobPath,
  describePlan,
  hfBase,
  planUpload,
} from './publish-media-offsite.mjs';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));

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

// ---- a manual walk of the packs directory ---------------------------------
// The gate does not trust listPackFiles() to measure itself: the walk
// below is written out longhand so a change in the helper cannot make
// both sides agree on a wrong answer.
function walkPacks(dir) {
  const out = [];
  const base = resolve(dir);
  const walk = (current) => {
    for (const name of readdirSync(current).sort()) {
      const full = join(current, name);
      const st = statSync(full);
      if (st.isDirectory()) {
        walk(full);
        continue;
      }
      out.push({ rel: relative(base, full).split(sep).join('/'), bytes: st.size });
    }
  };
  walk(base);
  return out;
}

async function main() {
  const walk = walkPacks(join(ROOT, PACKS_DIR));
  const walkTotal = walk.reduce((sum, f) => sum + f.bytes, 0);
  const manifest = walk.find(f => f.rel === 'manifest.json');

  // ---- normalizeBase ------------------------------------------------------

  await check('normalizeBase() rejects an empty base', () => {
    if (normalizeBase('') !== '') return 'got ' + JSON.stringify(normalizeBase(''));
    return true;
  });

  await check('normalizeBase() rejects a relative base', () => {
    const got = normalizeBase('/packs/');
    if (got !== '') return 'got ' + JSON.stringify(got);
    return true;
  });

  await check('normalizeBase() rejects a non-http scheme', () => {
    const got = normalizeBase('ftp://cdn.example/packs/');
    if (got !== '') return 'got ' + JSON.stringify(got);
    return true;
  });

  await check('normalizeBase() rejects a non-string base', () => {
    if (normalizeBase(undefined) !== '') return 'undefined was accepted';
    if (normalizeBase(null) !== '') return 'null was accepted';
    return true;
  });

  await check('normalizeBase() adds the trailing slash', () => {
    const got = normalizeBase('https://cdn.example/packs');
    if (got !== 'https://cdn.example/packs/') return 'got ' + JSON.stringify(got);
    return true;
  });

  await check('normalizeBase() keeps an existing trailing slash', () => {
    const got = normalizeBase('https://cdn.example/packs/');
    if (got !== 'https://cdn.example/packs/') return 'got ' + JSON.stringify(got);
    return true;
  });

  // ---- packsCopyPlan ------------------------------------------------------

  await check('packsCopyPlan() is \'full\' without a base', () => {
    if (packsCopyPlan('') !== 'full') return 'got ' + packsCopyPlan('');
    if (packsCopyPlan(undefined) !== 'full') return 'undefined gave ' + packsCopyPlan(undefined);
    return true;
  });

  await check('packsCopyPlan() is \'manifest-only\' with an absolute base', () => {
    if (packsCopyPlan('https://cdn.example/packs/') !== 'manifest-only') {
      return 'got ' + packsCopyPlan('https://cdn.example/packs/');
    }
    return true;
  });

  // ---- rewriteManifest ----------------------------------------------------

  const manifestText = readFileSync(join(ROOT, PACKS_DIR, 'manifest.json'), 'utf8');
  const before = JSON.parse(manifestText);

  await check('rewriteManifest() replaces the base', () => {
    const after = JSON.parse(rewriteManifest(manifestText, 'https://cdn.example/packs/'));
    if (after.base !== 'https://cdn.example/packs/') return 'base is ' + after.base;
    return true;
  });

  await check('rewriteManifest() keeps every other key verbatim', () => {
    const after = JSON.parse(rewriteManifest(manifestText, 'https://cdn.example/packs/'));
    for (const key of Object.keys(before)) {
      if (key === 'base') continue;
      if (JSON.stringify(after[key]) !== JSON.stringify(before[key])) {
        return key + ' changed';
      }
    }
    if (JSON.stringify(Object.keys(after)) !== JSON.stringify(Object.keys(before))) {
      return 'the key set changed';
    }
    return true;
  });

  await check('rewriteManifest() keeps the pack lists intact', () => {
    const after = JSON.parse(rewriteManifest(manifestText, 'https://cdn.example/packs/'));
    for (const [pack, files] of Object.entries(before.packs || {})) {
      if (!Array.isArray(files)) return pack + ' is not a list';
      if (!files.length) return pack + ' is empty';
      if (JSON.stringify(after.packs[pack]) !== JSON.stringify(files)) return pack + ' changed';
    }
    return true;
  });

  await check('rewriteManifest() output parses as JSON', () => {
    const out = rewriteManifest(manifestText, 'https://cdn.example/packs/');
    let parsed = null;
    try {
      parsed = JSON.parse(out);
    } catch (e) {
      return e.message;
    }
    if (!parsed || typeof parsed !== 'object') return 'the output is not an object';
    return true;
  });

  // ---- listPackFiles ------------------------------------------------------

  const files = listPackFiles(ROOT, PACKS_DIR);

  await check('listPackFiles() finds every file in the packs directory', () => {
    if (files.length !== walk.length) return `${files.length} found, ${walk.length} on disk`;
    return true;
  });

  await check('listPackFiles() reports the real byte total', () => {
    const total = files.reduce((sum, f) => sum + f.bytes, 0);
    if (total !== walkTotal) return `${total} bytes, ${walkTotal} on disk`;
    return true;
  });

  await check('listPackFiles() stays inside the packs directory', () => {
    for (const f of files) {
      if (!f.rel) return 'an entry has no path';
      if (f.rel.startsWith('..')) return f.rel + ' escapes the packs directory';
      if (f.rel.includes('..')) return f.rel + ' escapes the packs directory';
      if (f.rel.includes('\\')) return f.rel + ' is not a POSIX path';
    }
    return true;
  });

  // A symlink inside the packs directory has a path that stays inside it
  // while its target points anywhere. The walk must not hand such a file
  // to the uploader — the publish step puts these on a public host — and
  // must not follow it into a directory outside the tree.
  await check('listPackFiles() skips symlinks that point outside', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'swr-offsite-'));
    try {
      const packs = join(tmp, 'packs');
      const outside = join(tmp, 'outside');
      mkdirSync(packs);
      mkdirSync(outside);
      writeFileSync(join(packs, 'real.webp'), 'x');
      writeFileSync(join(outside, 'secret.txt'), 'x');
      symlinkSync(join(outside, 'secret.txt'), join(packs, 'escape.webp'));
      symlinkSync(outside, join(packs, 'escape-dir'));
      const found = listPackFiles(tmp, 'packs').map((f) => f.rel).sort();
      const expected = ['real.webp'];
      if (found.length !== expected.length || found[0] !== expected[0]) {
        return 'walked ' + JSON.stringify(found) + ', expected ' + JSON.stringify(expected);
      }
      return true;
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  await check('listPackFiles() includes the manifest', () => {
    if (!files.some(f => f.rel === 'manifest.json')) return 'manifest.json is missing';
    return true;
  });

  await check('listPackFiles() reports the same paths as the manual walk', () => {
    const a = files.map(f => f.rel).sort();
    const b = walk.map(f => f.rel).sort();
    if (a.length !== b.length) return `${a.length} vs ${b.length}`;
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) return a[i] + ' vs ' + b[i];
    }
    return true;
  });

  // ---- offsiteSavings -----------------------------------------------------

  await check('offsiteSavings() is everything except the manifest', () => {
    const got = offsiteSavings(ROOT, PACKS_DIR);
    const want = walkTotal - (manifest ? manifest.bytes : 0);
    if (got !== want) return `${got} bytes, expected ${want}`;
    return true;
  });

  await check('offsiteSavings() is positive for the real packs', () => {
    if (offsiteSavings(ROOT, PACKS_DIR) <= 0) return 'nothing would be saved';
    return true;
  });

  // ---- the publish plan ----------------------------------------------------

  const plan = planUpload(files, 'blob');

  await check('the publish plan covers every file', () => {
    if (plan.count !== walk.length) return `${plan.count} planned, ${walk.length} on disk`;
    if (plan.entries.length !== plan.count) return 'the entries do not match the count';
    return true;
  });

  await check('the publish plan totals the same bytes', () => {
    if (plan.bytes !== walkTotal) return `${plan.bytes} bytes, ${walkTotal} on disk`;
    return true;
  });

  await check('the publish plan puts every file under packs/', () => {
    for (const e of plan.entries) {
      if (!e.path.startsWith(PACKS_DIR + '/')) return e.path + ' is outside the packs directory';
      if (e.path !== blobPath(e.rel)) return e.path + ' does not match its rel';
    }
    return true;
  });

  await check('the publish plan maps a file to packs/<rel>', () => {
    if (blobPath('dancers/dancer-01.webp') !== 'packs/dancers/dancer-01.webp') {
      return 'got ' + blobPath('dancers/dancer-01.webp');
    }
    if (blobPath('manifest.json') !== 'packs/manifest.json') return 'got ' + blobPath('manifest.json');
    return true;
  });

  await check('the publish plan is pure — no network, no side effects', () => {
    const before = JSON.stringify(plan);
    const again = planUpload(files, 'blob');
    if (JSON.stringify(again) !== before) return 'two plans differ';
    if (again === plan) return 'the plan is the same object — it is not a fresh value';
    return true;
  });

  await check('the publish plan does not touch the network', async () => {
    const realFetch = globalThis.fetch;
    let called = false;
    globalThis.fetch = (...args) => {
      called = true;
      throw new Error('the plan must not fetch');
    };
    try {
      planUpload(files, 'blob');
      describePlan(plan);
    } finally {
      globalThis.fetch = realFetch;
    }
    if (called) return 'a fetch was attempted';
    return true;
  });

  await check('the plan report names the host, the count and the bytes', () => {
    const lines = describePlan(plan);
    const text = lines.join('\n');
    if (!text.includes('blob')) return 'the host is missing';
    if (!text.includes(String(plan.count))) return 'the file count is missing';
    if (!text.includes(String(plan.bytes))) return 'the byte total is missing';
    if (!text.includes(PACKS_DIR + '/')) return 'no path is shown';
    return true;
  });

  await check('the plan report shows only a few paths', () => {
    const lines = describePlan(plan);
    const paths = lines.filter(l => l.includes(PACKS_DIR + '/'));
    if (paths.length > 6) return paths.length + ' paths are shown';
    return true;
  });

  // ---- the base URL --------------------------------------------------------

  await check('the Blob base is the URL up to the packs/ prefix', () => {
    const got = baseFromBlobUrl('https://store.public.blob.vercel-storage.com/packs/dancers/dancer-01.webp');
    if (got !== 'https://store.public.blob.vercel-storage.com/packs/') return 'got ' + got;
    return true;
  });

  await check('the Blob base is empty for an unrelated URL', () => {
    if (baseFromBlobUrl('https://example.com/other/file.webp') !== '') {
      return 'got ' + baseFromBlobUrl('https://example.com/other/file.webp');
    }
    return true;
  });

  await check('the Hub base points at the dataset packs/', () => {
    const got = hfBase('kaidejuric/packs');
    if (got !== 'https://huggingface.co/datasets/kaidejuric/packs/resolve/main/packs/') return 'got ' + got;
    if (!got.endsWith('/')) return 'the base does not end with a slash';
    return true;
  });
}

// ---- the report ----------------------------------------------------------

await main();

const failed = results.filter(r => !r.ok);
console.log('');
if (failed.length) {
  console.log(`MEDIA OFFSITE UNIT: ${failed.length} of ${results.length} checks FAILED`);
  process.exit(1);
}
console.log(`MEDIA OFFSITE UNIT: all ${results.length} checks passed`);
