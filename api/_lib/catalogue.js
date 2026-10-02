// api/_lib/catalogue.js — seller catalogue ledger (songs / videos / packs).
//
// The seller-side counterpart to the Connect pilot: once a seller's
// connected account is active (status 'active'), they register the items
// they want to sell — individually OR grouped into bundles ("sell together
// or separately"). Every purchase is a remix license; this module only owns
// the catalogue records, not payments (those land in Phase 2).
//
// Store layout — same key space on every backend (JSON files under
// SWRC_DATA_DIR locally, `kv` table rows with the same relative key on
// Postgres — see api/_lib/db.js):
//   catalogue/index.json            [ listing, ... ] — queryable ledger
//   catalogue/<id>.json             audit copy of one listing
//
// A listing:
//   {
//     id, sellerUserId,
//     type: 'song' | 'video' | 'pack',
//     title, description,
//     priceMinor,            // integer minor units (EUR cents)
//     currency,              // 'EUR' (pilot)
//     media: [{ kind: 'audio'|'video'|'image', key, name, size, featured? }],
//       // featured: true on the ONE file that gets posted up as the listing
//       // preview — a WebM. At most one; only a video kind can carry it.
//     tags: [string],
//     bundleOf: [listingId], // same-seller refs — sell together
//     status: 'draft' | 'live',
//     createdAt, updatedAt, deletedAt?
//   }
//
// Media keys come from /api/storage/sign-upload (userId-prefixed, e.g.
// `<userId>/catalogue/<uuid>.mp3`) and are re-validated here so a listing
// can only reference the seller's own files.

import { join } from 'node:path';
import { uuid, readJson, writeJson, withLock, DATA_ROOT, safeKey } from './db.js';

export const CATALOGUE_TYPES = ['song', 'video', 'pack'];
export const CATALOGUE_STATUSES = ['draft', 'live'];
export const MEDIA_KINDS = ['audio', 'video', 'image'];
export const LISTING_ID_RE = /^[a-f0-9-]{8,40}$/i;
export const TITLE_MAX = 120;
export const DESC_MAX = 2000;
export const TAGS_MAX = 8;
export const TAG_MAX = 24;
export const BUNDLE_MAX = 12;
export const MEDIA_MAX = 20;
export const DEFAULT_CURRENCY = 'EUR';

const CATALOGUE_ROOT = join(DATA_ROOT, 'catalogue');

// ---- validation helpers (shared with the unit suite) ----

export function normalizeType(raw) {
  return CATALOGUE_TYPES.includes(raw) ? raw : null;
}

export function normalizeStatus(raw, fallback = 'draft') {
  return CATALOGUE_STATUSES.includes(raw) ? raw : fallback;
}

export function normalizeTitle(raw) {
  if (typeof raw !== 'string') return null;
  const t = raw.trim();
  return t && t.length <= TITLE_MAX ? t : null;
}

export function normalizeDescription(raw) {
  if (typeof raw !== 'string') return '';
  return raw.trim().slice(0, DESC_MAX);
}

export function normalizePriceMinor(raw) {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 && n <= 10_000_000 ? n : null;
}

export function normalizeCurrency(raw) {
  const c = typeof raw === 'string' ? raw.trim().toUpperCase() : '';
  return c || DEFAULT_CURRENCY;
}

export function normalizeTags(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const t of raw.slice(0, TAGS_MAX)) {
    const s = typeof t === 'string' ? t.trim() : '';
    if (!s || s.length > TAG_MAX) continue;
    const low = s.toLowerCase();
    if (!out.some((x) => x.toLowerCase() === low)) out.push(s);
  }
  return out.slice(0, TAGS_MAX);
}

// Shape-validate a media entry; ownership (userId prefix) is checked by the
// caller in create/update since key validation needs the seller id.
// `featured: true` marks the ONE file that gets "posted up" — the listing's
// preview asset (a WebM). At most one featured entry survives; only a video
// kind may carry it. Everything else (audio/image/other videos) is packaged
// alongside but never featured.
export function normalizeMedia(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  let featuredSeen = false;
  for (const m of raw.slice(0, MEDIA_MAX)) {
    if (!m || typeof m !== 'object') continue;
    const kind = MEDIA_KINDS.includes(m.kind) ? m.kind : null;
    const key = typeof m.key === 'string' ? m.key.trim() : '';
    if (!kind || !key) continue;
    if (key.length > 512) continue;
    try { safeKey(key.replace(/^[^/]+\//, '')); } catch { continue; }
    const featured = !!(m.featured === true || m.featured === 'true') && kind === 'video' && !featuredSeen;
    if (featured) featuredSeen = true;
    out.push({
      kind,
      key,
      name: typeof m.name === 'string' ? m.name.slice(0, 240) : key.split('/').pop(),
      size: Number.isFinite(Number(m.size)) ? Number(m.size) : 0,
      featured,
    });
  }
  return out;
}

function assertMediaOwned(media, userId) {
  const prefix = userId + '/';
  for (const m of media) {
    if (!m.key.startsWith(prefix)) {
      throw new TypeError('media key outside seller scope');
    }
  }
}

// ---- paths ----

export function catalogueIndexPath() {
  return join(CATALOGUE_ROOT, 'index.json');
}
export function catalogueItemPath(id) {
  if (!LISTING_ID_RE.test(id)) throw new Error('invalid listing id');
  return join(CATALOGUE_ROOT, `${id}.json`);
}

// ---- reads (no lock: a single read is atomic per backend) ----

export async function listCatalog(userId) {
  const all = await readJson(catalogueIndexPath(), []);
  if (!Array.isArray(all)) return [];
  return all
    .filter((r) => r && r.sellerUserId === userId && !r.deletedAt)
    .sort((a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt));
}

export async function getCatalogItem(userId, id) {
  if (!LISTING_ID_RE.test(id)) return null;
  const item = await readJson(catalogueItemPath(id), null);
  if (!item || item.sellerUserId !== userId || item.deletedAt) return null;
  return item;
}

// Raw read for bundle validation + future share/order code (no ownership
// gate — callers must pair it with an ownership check when needed).
export async function findCatalogItemById(id) {
  if (!LISTING_ID_RE.test(id)) return null;
  const item = await readJson(catalogueItemPath(id), null);
  return item || null;
}

// PUBLIC browse view: live listings across all sellers, shaped for buyers
// (seller identity, media keys and internal fields are stripped).
export async function listLiveCatalog() {
  const all = await readJson(catalogueIndexPath(), []);
  if (!Array.isArray(all)) return [];
  return all
    .filter((r) => r && r.status === 'live' && !r.deletedAt)
    .sort((a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt))
    .map((r) => ({
      id: r.id,
      type: r.type,
      title: r.title,
      description: r.description || '',
      priceMinor: r.priceMinor,
      currency: r.currency || DEFAULT_CURRENCY,
      tags: r.tags || [],
      bundleOf: r.bundleOf || [],
      mediaCount: Array.isArray(r.media) ? r.media.length : 0,
      updatedAt: r.updatedAt,
      createdAt: r.createdAt,
    }));
}

// Resolve a listing to its sellable items (a bundle of one → the listing;
// a bundle with refs → the listing plus its same-seller bundle members),
// keeping only LIVE, non-deleted items. Used by the checkout handler so
// bundle pricing is computed server-side, never trusted from the client.
export async function resolveSellableItems(listingId) {
  if (!LISTING_ID_RE.test(listingId)) return [];
  const root = await findCatalogItemById(listingId);
  if (!root || root.status !== 'live' || root.deletedAt) return [];
  const out = [{ id: root.id, type: root.type, title: root.title, priceMinor: root.priceMinor }];
  for (const refId of (root.bundleOf || [])) {
    const ref = await findCatalogItemById(refId);
    if (!ref || ref.status !== 'live' || ref.deletedAt || ref.sellerUserId !== root.sellerUserId) continue;
    out.push({ id: ref.id, type: ref.type, title: ref.title, priceMinor: ref.priceMinor });
  }
  return out;
}

// ---- writes (every mutation is one withLock) ----

// Every mutation updates BOTH the index row (queryable on Postgres, which
// has no readdir) and the audit copy, in the same lock — mirror of the
// slots/ ledger pattern.

export async function createCatalogItem({ userId, input = {} }) {
  if (typeof userId !== 'string' || !/^[a-f0-9-]{8,40}$/i.test(userId)) {
    throw new TypeError('invalid userId');
  }
  const type = normalizeType(input.type);
  if (!type) throw new TypeError('invalid type');
  const title = normalizeTitle(input.title);
  if (!title) throw new TypeError('title required (max 120 chars)');
  const priceMinor = normalizePriceMinor(input.priceMinor);
  if (!priceMinor) throw new TypeError('priceMinor must be a positive integer');
  const media = normalizeMedia(input.media);
  assertMediaOwned(media, userId);
  const bundleOf = await resolveBundleOf(input.bundleOf, userId);

  const now = new Date().toISOString();
  const item = {
    id: uuid(),
    sellerUserId: userId,
    type,
    title,
    description: normalizeDescription(input.description),
    priceMinor,
    currency: normalizeCurrency(input.currency),
    media,
    tags: normalizeTags(input.tags),
    bundleOf,
    status: normalizeStatus(input.status),
    createdAt: now,
    updatedAt: now,
  };

  await withLock(async () => {
    const index = (await readJson(catalogueIndexPath(), [])) || [];
    index.push(item);
    await writeJson(catalogueIndexPath(), index);
    await writeJson(catalogueItemPath(item.id), item);
  });
  return item;
}

// Patch update. `patch` is a whitelist of editable fields; anything else is
// ignored. Returns the updated item or null when not found / not owner.
export async function updateCatalogItem({ userId, id, patch = {} }) {
  if (!LISTING_ID_RE.test(id)) return null;
  return withLock(async () => {
    const item = await readJson(catalogueItemPath(id), null);
    if (!item || item.sellerUserId !== userId || item.deletedAt) return null;

    const next = { ...item };
    if (patch.title !== undefined) {
      const t = normalizeTitle(patch.title);
      if (!t) throw new TypeError('title required (max 120 chars)');
      next.title = t;
    }
    if (patch.description !== undefined) next.description = normalizeDescription(patch.description);
    if (patch.priceMinor !== undefined) {
      const p = normalizePriceMinor(patch.priceMinor);
      if (!p) throw new TypeError('priceMinor must be a positive integer');
      next.priceMinor = p;
    }
    if (patch.currency !== undefined) next.currency = normalizeCurrency(patch.currency);
    if (patch.media !== undefined) {
      const media = normalizeMedia(patch.media);
      assertMediaOwned(media, userId);
      next.media = media;
    }
    if (patch.tags !== undefined) next.tags = normalizeTags(patch.tags);
    if (patch.bundleOf !== undefined) next.bundleOf = await resolveBundleOf(patch.bundleOf, userId);
    if (patch.status !== undefined) next.status = normalizeStatus(patch.status, next.status);

    next.updatedAt = new Date().toISOString();
    await writeJson(catalogueItemPath(id), next);
    const index = (await readJson(catalogueIndexPath(), [])) || [];
    const idx = index.findIndex((r) => r && r.id === id);
    if (idx >= 0) index[idx] = next;
    await writeJson(catalogueIndexPath(), index);
    return next;
  });
}

// Soft delete: hides from the catalogue, keeps the audit row.
export async function deleteCatalogItem({ userId, id }) {
  if (!LISTING_ID_RE.test(id)) return null;
  return withLock(async () => {
    const item = await readJson(catalogueItemPath(id), null);
    if (!item || item.sellerUserId !== userId || item.deletedAt) return null;
    const next = { ...item, status: 'draft', deletedAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    await writeJson(catalogueItemPath(id), next);
    const index = (await readJson(catalogueIndexPath(), [])) || [];
    const idx = index.findIndex((r) => r && r.id === id);
    if (idx >= 0) index[idx] = next;
    await writeJson(catalogueIndexPath(), index);
    return next;
  });
}

async function resolveBundleOf(raw, userId) {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) throw new TypeError('bundleOf must be an array');
  const ids = raw.filter((x) => typeof x === 'string' && LISTING_ID_RE.test(x)).slice(0, BUNDLE_MAX);
  const out = [];
  for (const id of ids) {
    const ref = await findCatalogItemById(id);
    if (ref && ref.sellerUserId === userId && !ref.deletedAt && !out.includes(id)) {
      out.push(id);
    }
  }
  return out;
}