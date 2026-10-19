// scripts/generate-pt-keys.mjs — mint PT license keys (the operator's issuer).
//
// pt.client.js accepts `swr-{solo|band|label}-{4..12 alnum}` and performs no
// signature check — the format is deliberately opaque and forgeable, as
// documented in that file — so minting a key is producing a random string in
// the accepted shape. This script is the issuer that was missing: unambiguous
// alphabet (no I/O/0/1, so a key survives being read aloud or retyped), an
// append-only local ledger, and the tier credit grants mirroring pt.client.js.
//
// Usage:
//   node scripts/generate-pt-keys.mjs                              # 10 keys, every tier
//   node scripts/generate-pt-keys.mjs --tier band --count 10
//   node scripts/generate-pt-keys.mjs --tier label --count 5 --json
//   npm run keys:pt -- --tier solo --count 10
//
// The ledger (pt-keys.local.txt) is gitignored: this repo is public and these
// keys ARE the product. Never commit minted keys.
import fs from 'node:fs';
import crypto from 'node:crypto';

// Keep in sync with pt.client.js TIERS.
const TIERS = {
  solo:  { name: 'PT Solo',  credits: 50,  price: '€120' },
  band:  { name: 'PT Band',  credits: 150, price: '€280' },
  label: { name: 'PT Label', credits: 500, price: '€600' },
};
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const LEDGER = 'pt-keys.local.txt';
const CODE_LEN = 8;

const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf(name); return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : dflt; };
const tierArg = String(opt('--tier', 'all')).toLowerCase();
const count = Math.max(1, Math.min(500, parseInt(opt('--count', '10'), 10) || 10));
const asJson = args.includes('--json');

const tiers = tierArg === 'all' ? Object.keys(TIERS) : [tierArg];
for (const t of tiers) {
  if (!(t in TIERS)) {
    console.error(`unknown tier: ${t} (use ${Object.keys(TIERS).join('|')}|all)`);
    process.exit(2);
  }
}

const code = () => Array.from({ length: CODE_LEN }, () => ALPHABET[crypto.randomInt(ALPHABET.length)]).join('');
const minted = [];
for (const tier of tiers) for (let i = 0; i < count; i++) minted.push(`swr-${tier}-${code()}`);

const stamp = new Date().toISOString();
fs.appendFileSync(LEDGER, minted.map((k) => `${k}\t${stamp}`).join('\n') + '\n');

if (asJson) {
  console.log(JSON.stringify({ mintedAt: stamp, count: minted.length, tiers: tiers.map((t) => ({ tier: t, credits: TIERS[t].credits, keys: minted.filter((k) => k.startsWith(`swr-${t}-`)) })) }, null, 2));
} else {
  for (const tier of tiers) {
    const set = minted.filter((k) => k.startsWith(`swr-${tier}-`));
    console.log(`\n${TIERS[tier].name} — ${TIERS[tier].credits} credits (${TIERS[tier].price})`);
    for (const k of set) console.log('  ' + k);
  }
}
console.log(`\n${minted.length} key(s) minted → ${LEDGER} (gitignored).`);

// ---- Optional: import the freshly-minted keys to the server ledger
//      via the operator import endpoint (FIX 2 part B). The endpoint is
//      idempotent so re-running is safe. The local file is always
//      written first; the import is a separate step.
const importFlagIdx = args.indexOf('--import');
const importDryRunIdx = args.indexOf('--import-dry-run');
const apiOriginIdx = args.indexOf('--api-origin');
const doImport = importFlagIdx >= 0 || importDryRunIdx >= 0;
if (doImport) {
  const apiOrigin = apiOriginIdx >= 0
    ? args[apiOriginIdx + 1]
    : (process.env.PT_API_ORIGIN || 'http://127.0.0.1:5174');
  const secret = process.env.PT_IMPORT_SECRET || null;
  const url = apiOrigin.replace(/\/$/, '') + '/api/admin/pt/keys/import';
  const body = { keys: minted };
  const headers = { 'content-type': 'application/json' };
  if (secret) headers['x-import-secret'] = secret;
  if (importDryRunIdx >= 0) {
    console.log('\nIMPORT DRY RUN: would POST ' + minted.length + ' key(s) to ' + url);
    for (const k of minted) console.log('  - ' + k);
  } else {
    console.log('\nImporting ' + minted.length + ' key(s) to ' + url + '...');
    const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
    const resBody = await res.json();
    console.log('HTTP ' + res.status + ': ' + JSON.stringify(resBody, null, 2));
    if (!res.ok || !resBody.ok) {
      console.error('Import failed. Keys are still in ' + LEDGER + ' and can be re-imported with:');
      console.error('  node scripts/migrate-pt-keys-local.mjs');
      process.exit(1);
    }
  }
}
