// tools/swr-vault-init.mjs — create the SWR Obsidian vault if missing.
//
// Usage:
//   SWR_VAULT=/path/to/vault node tools/swr-vault-init.mjs
//
// Default vault: /Users/kaidejuricmassbook/Documents/SWR-Vault
// (falls back to .obsidian-swr/ inside the repo if that path is
//  unwritable, e.g. sandboxed shells).

import { existsSync, mkdirSync, writeFileSync, statSync } from 'node:fs';
import { dirname, join, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SWR = join(HERE, '..');

function pickVault() {
  if (process.env.SWR_VAULT && isAbsolute(process.env.SWR_VAULT)) {
    return process.env.SWR_VAULT;
  }
  if (process.env.SWR_VAULT) {
    return resolve(SWR, process.env.SWR_VAULT);
  }
  const preferred = '/Users/kaidejuricmassbook/Documents/SWR-Vault';
  try {
    mkdirSync(preferred, { recursive: true });
    statSync(preferred);
    return preferred;
  } catch (_) {
    return join(SWR, '.obsidian-swr');
  }
}

const VAULT = pickVault();

function writeIfMissing(p, body) {
  if (!existsSync(p)) writeFileSync(p, body);
}

function init() {
  if (!existsSync(VAULT)) mkdirSync(VAULT, { recursive: true });
  const obs = join(VAULT, '.obsidian');
  mkdirSync(obs, { recursive: true });
  mkdirSync(join(obs, 'plugins'), { recursive: true });
  mkdirSync(join(obs, 'themes'), { recursive: true });
  mkdirSync(join(obs, 'snippets'), { recursive: true });

  writeIfMissing(join(obs, 'workspace.json'), JSON.stringify({
    open: false,
    collectionFormat: 2,
    pinnedTabs: [],
  }, null, 2));
  writeIfMissing(join(obs, 'app.json'), JSON.stringify({
    alwaysUpdateLinks: true,
    newLinkFormat: 'shortest',
    useMarkdownLinks: false,
  }, null, 2));
  writeIfMissing(join(obs, 'appearance.json'), JSON.stringify({
    baseFontSize: 16,
    theme: 'obsidian',
  }, null, 2));

  mkdirSync(join(VAULT, 'Journal'), { recursive: true });
  mkdirSync(join(VAULT, 'MOCs'), { recursive: true });
  writeIfMissing(join(VAULT, 'MOCs', 'SWR.md'), [
    '---',
    'tags: [map-of-content, swr]',
    '---',
    '# SWR Vault — Map of Contents',
    '',
    '> Index of every Journal entry, audit, and design doc the SWR',
    '> orchestrator writes. Updated by `node tools/swr-journal-log.mjs init`.',
    '',
    '## Journal',
    '```dataview',
    'TABLE day AS "Day", file.link AS "Entry", tags',
    'FROM "Journal"',
    'SORT day DESC',
    'LIMIT 30',
    '```',
    '',
    '## Audits & plans',
    '```dataview',
    'LIST',
    'FROM "Plans"',
    'SORT file.ctime DESC',
    '```',
    '',
    '## Active P0/P1 backlog (from docs/PLANS)',
    '```dataview',
    'LIST',
    'FROM #audit OR #plan',
    'WHERE contains(tags, "live")',
    '```',
  ].join('\n'));

  writeIfMissing(join(VAULT, '.gitignore'), [
    '.obsidian/workspace-cache.sqlite*',
    '.obsidian/workspace.json.bak',
    '.obsidian/cache/',
    '.trash/',
  ].join('\n'));

  // Symlink so the SWR team can find the vault from the repo
  console.log('vault ready: ' + VAULT);
  console.log('open it in Obsidian (File → Open vault → ' + VAULT + ')');
  console.log('or run: open ' + VAULT);
}

init();
