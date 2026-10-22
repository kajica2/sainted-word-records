// scripts/lib/packs-offsite.mjs — the shared logic for serving the curated
// media packs from an off-site host instead of the deploy.
//
// Why this exists: `packs/` is 582 files and 39.6 MB — a quarter of the
// build. The packs are opt-in content (the engine's library drawer and
// /packs.html fetch /packs/manifest.json and then load the media listed
// in it), so the seam is exactly one file: the manifest.
//
//   - PACKS_BASE unset  → the build copies packs/ whole, the manifest's
//     `base` stays "/packs/", the media is served by the deploy.
//   - PACKS_BASE set    → the build copies ONLY packs/manifest.json, with
//     its `base` rewritten to the off-site URL. The 582 media files stay
//     out of the build and are fetched cross-origin from the host.
//
// Nothing here touches the network: the publish step
// (scripts/publish-media-offsite.mjs) does that, and the build only needs
// to know WHICH files to copy and what the manifest's base becomes.

import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

export const PACKS_DIR = 'packs';
export const PACKS_MANIFEST = 'packs/manifest.json';

// The off-site base must be an absolute http(s) URL. It is joined with the
// manifest's relative paths (`manifestBase + rel` in
// client/library-packs.client.js), so it must end in a slash.
export function normalizeBase(base) {
  if (typeof base !== 'string') return '';
  const b = base.trim();
  if (!b) return '';
  if (!/^https?:\/\//i.test(b)) return '';
  return b.endsWith('/') ? b : b + '/';
}

export function isOffsiteBase(base) {
  return normalizeBase(base) !== '';
}

// What the build copies for the packs.
//   'full'         → the whole directory (the default, no off-site host)
//   'manifest-only'→ only the manifest, pointing at the off-site host
export function packsCopyPlan(base) {
  return isOffsiteBase(base) ? 'manifest-only' : 'full';
}

// Rewrite the manifest's `base`. Every other key — the pack lists, the
// cover paths, the schema version — is preserved verbatim: the manifest is
// the contract between the deploy and the off-site host, and a rewrite
// that touched anything else would silently change what the site serves.
export function rewriteManifest(text, base) {
  const manifest = JSON.parse(text);
  manifest.base = normalizeBase(base);
  return JSON.stringify(manifest, null, 2) + '\n';
}

// Every file under the packs directory, as repo-relative paths, with its
// size. A path that escapes the packs directory is refused rather than
// uploaded: the publish step sends these to a public host.
export function listPackFiles(root, packsDir = PACKS_DIR) {
  const base = resolve(root, packsDir);
  const out = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir).sort()) {
      const full = join(dir, name);
      const st = statSync(full);
      if (st.isDirectory()) {
        walk(full);
        continue;
      }
      const rel = relative(base, full).split(sep).join('/');
      if (!rel || rel.startsWith('..')) continue;
      out.push({ rel, bytes: st.size });
    }
  };
  if (existsSync(base)) walk(base);
  return out;
}

// The bytes the build saves by shipping the media off-site: everything in
// the packs directory except the manifest the deploy still needs.
export function offsiteSavings(root, packsDir = PACKS_DIR) {
  return listPackFiles(root, packsDir)
    .filter((f) => f.rel !== 'manifest.json')
    .reduce((sum, f) => sum + f.bytes, 0);
}
