// scripts/variant-picker-variants.mjs — Node-only companion to
// lib/variant-picker.mjs.
//
// This is the ONLY part of the variant-picker story that touches the
// filesystem. It lives here rather than in lib/ for one concrete reason:
// lib/variant-picker.mjs must stay loadable in a browser (an ES module with
// no `node:` imports) so a UI auto-pick and the batch CLI share the SAME
// scoring table instead of drifting into two definitions.
//
// Its job is a build-time sanity check, not picking: confirm that every
// variant referenced by PROFILES still exists as versions/<name>.html with
// a readable title/description, so a renamed or deleted variant is caught by
// tests rather than by a batch run that silently renders the wrong thing.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PROFILES } from '../lib/variant-picker.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VERSIONS_DIR = path.resolve(__dirname, '..', 'versions');

// Returns [{ name, title, description }] for each PROFILES entry that exists
// on disk. Variants missing from disk are simply absent from the result, so
// the caller can diff the two sets and report the gap.
export function listKnownVariants() {
  if (!fs.existsSync(VERSIONS_DIR)) return [];
  const out = [];
  for (const f of fs.readdirSync(VERSIONS_DIR)) {
    if (!f.endsWith('.html')) continue;
    if (f.startsWith('_')) continue;
    const html = fs.readFileSync(path.join(VERSIONS_DIR, f), 'utf8');
    const title = (html.match(/<title>([^<]+)<\/title>/) || [])[1] || '';
    const desc = (html.match(/<meta name="description" content="([^"]+)"/) || [])[1] || '';
    const name = f.replace(/\.html$/, '');
    if (PROFILES[name]) out.push({ name, title: title.trim(), description: desc.trim() });
  }
  return out;
}

export default { listKnownVariants };
