// api/_lib/marketplace.js — marketplace claiming system with limited quantities,
// cycling scarcity, clip lifespans, and availability ticker.
//
// Store layout (mirrors slots.js pattern):
//   marketplace/claims/index.json               [ claim, ... ] — all claims
//   marketplace/claims/<userId>/<itemId>.json  audit copy of one claim
//   marketplace/items/index.json               [ item, ... ] — all claimable items
//   marketplace/items/<itemId>.json            individual item record
//   marketplace/ticker.json                     { tick, lastUpdate, items: {...} }
//
// Item status lifecycle: available → claimed/expired
// Quantity cycling: when quantity reaches 0, item becomes claimed; when
// lifespanSeconds expires, item becomes expired regardless of quantity.

import { join } from 'node:path';
import { uuid, readJson, writeJson, withLock, DATA_ROOT } from './db.js';

// ---- constants ----

export const ITEM_TYPES = ['logo', 'image', 'clip', 'music_clip'];
export const CREATOR_TYPES = ['motion_designer', 'graphics_designer', 'creator'];
export const ITEM_STATUSES = ['available', 'claimed', 'expired'];
export const MEDIA_KINDS = ['thumbnail', 'preview', 'full', 'audio'];

// Default lifespan: 24 hours
export const DEFAULT_LIFESPAN_SECONDS = 24 * 60 * 60;

// ---- paths ----

const MARKETPLACE_ROOT = join(DATA_ROOT, 'marketplace');

function ensureMarketplaceDirs() {
  // Called lazily on first write
}

function claimsIndexPath() {
  return join(MARKETPLACE_ROOT, 'claims', 'index.json');
}

function claimRecordPath(userId, itemId) {
  return join(MARKETPLACE_ROOT, 'claims', userId, `${itemId}.json`);
}

function itemsIndexPath() {
  return join(MARKETPLACE_ROOT, 'items', 'index.json');
}

function itemPath(itemId) {
  return join(MARKETPLACE_ROOT, 'items', `${itemId}.json`);
}

function tickerPath() {
  return join(MARKETPLACE_ROOT, 'ticker.json');
}

// ---- validation helpers ----

export function normalizeItemType(type) {
  if (!type || !ITEM_TYPES.includes(type)) {
    return null;
  }
  return type;
}

export function normalizeCreatorType(creatorType) {
  if (!creatorType || !CREATOR_TYPES.includes(creatorType)) {
    return null;
  }
  return creatorType;
}

export function normalizeMedia(media) {
  if (!Array.isArray(media)) {
    return [];
  }
  return media
    .filter(m => m && m.key && m.kind && MEDIA_KINDS.includes(m.kind))
    .map(m => ({ key: m.key, kind: m.kind, url: m.url || '' }));
}

function assertValidItem(doc) {
  if (!doc.id) throw new Error('item id is required');
  if (!doc.type || !ITEM_TYPES.includes(doc.type)) {
    throw new Error(`invalid item type: ${doc.type}`);
  }
  if (!doc.title || typeof doc.title !== 'string') {
    throw new Error('item title is required');
  }
  if (!doc.creatorType || !CREATOR_TYPES.includes(doc.creatorType)) {
    throw new Error(`invalid creator type: ${doc.creatorType}`);
  }
  if (typeof doc.quantity !== 'number' || doc.quantity < 0) {
    throw new Error('quantity must be a non-negative number');
  }
  if (typeof doc.maxQuantity !== 'number' || doc.maxQuantity < 1) {
    throw new Error('maxQuantity must be a positive number');
  }
  if (doc.maxQuantity < doc.quantity) {
    throw new Error('maxQuantity cannot be less than quantity');
  }
}

// ---- item operations ----

/**
 * Create a new claimable item.
 * @param {Object} opts
 * @param {string} opts.id - unique item id (auto-generated if not provided)
 * @param {string} opts.type - logo | image | clip | music_clip
 * @param {string} opts.title
 * @param {string} opts.description
 * @param {string} opts.creatorType - motion_designer | graphics_designer | creator
 * @param {Array<{key, kind, url}>} opts.media
 * @param {number} opts.quantity - current available quantity
 * @param {number} opts.maxQuantity - maximum quantity
 * @param {number} opts.lifespanSeconds - seconds from availableAt until expires
 * @param {number} [opts.availableAt] - timestamp when item becomes available (default: now)
 * @returns {Promise<Object>} the created item
 */
export async function createClaimItem({
  id = uuid(),
  type,
  title,
  description = '',
  creatorType,
  media = [],
  quantity,
  maxQuantity,
  lifespanSeconds = DEFAULT_LIFESPAN_SECONDS,
  availableAt = Date.now(),
}) {
  const now = Date.now();
  const expiresAt = availableAt + (lifespanSeconds * 1000);

  const item = {
    id,
    type: normalizeItemType(type),
    title,
    description,
    creatorType: normalizeCreatorType(creatorType),
    media: normalizeMedia(media),
    quantity: Math.floor(quantity) || 0,
    claimed: 0,
    maxQuantity: Math.floor(maxQuantity) || 1,
    lifespanSeconds,
    availableAt,
    expiresAt,
    status: 'available',
    createdAt: now,
  };

  assertValidItem(item);

  // Ensure directories exist
  try {
    const { ensureDir } = await import('./db.js');
    await ensureDir(join(MARKETPLACE_ROOT, 'items'));
    await ensureDir(join(MARKETPLACE_ROOT, 'claims'));
  } catch (_) {}

  // Add to index
  const items = await readJson(itemsIndexPath(), []);
  items.push({ id, type: item.type, title: item.title, status: item.status, expiresAt });
  await writeJson(itemsIndexPath(), items);

  // Write individual item
  await writeJson(itemPath(item.id), item);

  // Update ticker
  await updateTicker(item.id, item);

  return item;
}

/**
 * Claim an item for a user.
 * @param {Object} opts
 * @param {string} opts.userId
 * @param {string} opts.itemId
 * @returns {Promise<Object>} the claim record
 * @throws {Error} if item not available, expired, or out of stock
 */
export async function claimItem({ userId, itemId }) {
  return withLock(async () => {
    const item = await readJson(itemPath(itemId));
    if (!item) {
      throw new Error('item not found');
    }

    const now = Date.now();

    // Check availability
    if (item.status !== 'available') {
      throw new Error(`item is ${item.status}`);
    }

    if (now < item.availableAt) {
      throw new Error('item not yet available');
    }

    if (now >= item.expiresAt) {
      // Mark as expired
      item.status = 'expired';
      item.expiresAt = now;
      await writeJson(itemPath(itemId), item);
      await updateIndexItemStatus(itemId, 'expired');
      throw new Error('item has expired');
    }

    if (item.quantity <= 0) {
      // Mark as fully claimed
      item.status = 'claimed';
      item.quantity = 0;
      await writeJson(itemPath(itemId), item);
      await updateIndexItemStatus(itemId, 'claimed');
      throw new Error('item is out of stock');
    }

    // Create claim record
    const claim = {
      id: uuid(),
      userId,
      itemId,
      claimedAt: now,
    };

    // Update item
    item.quantity -= 1;
    item.claimed += 1;
    if (item.quantity <= 0) {
      item.status = 'claimed';
      await updateIndexItemStatus(itemId, 'claimed');
    }

    await writeJson(itemPath(itemId), item);

    // Record claim
    const claims = await readJson(claimsIndexPath(), []);
    claims.push({ id: claim.id, userId, itemId, claimedAt: claim.claimedAt });
    await writeJson(claimsIndexPath(), claims);

    // Individual claim record
    try {
      await ensureDir(join(MARKETPLACE_ROOT, 'claims', userId));
    } catch (_) {}
    await writeJson(claimRecordPath(userId, itemId), claim);

    // Update ticker
    await updateTicker(itemId, item);

    return claim;
  });
}

/**
 * List all available items (not claimed, not expired, quantity > 0).
 * @param {Object} opts
 * @param {string} [opts.type] - filter by type
 * @param {string} [opts.creatorType] - filter by creator type
 * @returns {Promise<Array>} available items
 */
export async function listAvailableItems({ type, creatorType } = {}) {
  const items = await readJson(itemsIndexPath(), []);
  const now = Date.now();

  let available = items.filter(item => {
    // Must be available status
    if (item.status !== 'available') return false;
    // Must not be expired
    if (item.expiresAt && now >= item.expiresAt) return false;
    // Must have quantity (checked via individual item)
    return true;
  });

  // Filter by type
  if (type) {
    available = available.filter(item => item.type === type);
  }

  // Filter by creator type (need to read full item)
  if (creatorType) {
    const filtered = [];
    for (const item of available) {
      const full = await readJson(itemPath(item.id));
      if (full && full.creatorType === creatorType) {
        filtered.push(item);
      }
    }
    available = filtered;
  }

  // Enrich with current quantity from individual items
  const enriched = [];
  for (const item of available) {
    const full = await readJson(itemPath(item.id));
    if (full && full.quantity > 0) {
      enriched.push({
        id: full.id,
        type: full.type,
        title: full.title,
        description: full.description,
        creatorType: full.creatorType,
        media: full.media,
        quantity: full.quantity,
        maxQuantity: full.maxQuantity,
        expiresAt: full.expiresAt,
        status: full.status,
      });
    }
  }

  return enriched;
}

/**
 * Get all items claimed by a user.
 * @param {string} userId
 * @returns {Promise<Array>} claimed items with full details
 */
export async function getClaimedItems(userId) {
  const claims = await readJson(claimsIndexPath(), []);
  const userClaims = claims.filter(c => c.userId === userId);

  const items = [];
  for (const claim of userClaims) {
    const item = await readJson(itemPath(claim.itemId));
    if (item) {
      items.push({
        claimId: claim.id,
        claimedAt: claim.claimedAt,
        ...item,
      });
    }
  }

  return items;
}

/**
 * List all live items (available or claimed status, not expired).
 * @returns {Promise<Array>} live items
 */
export async function listLiveItems() {
  const items = await readJson(itemsIndexPath(), []);
  const now = Date.now();

  const live = [];
  for (const item of items) {
    if (item.status === 'expired') continue;
    if (item.expiresAt && now >= item.expiresAt) continue;
    
    const full = await readJson(itemPath(item.id));
    if (full) {
      live.push(full);
    }
  }

  return live;
}

/**
 * Update item quantity (admin operation).
 * @param {string} itemId
 * @param {number} quantityDelta - positive to add, negative to remove
 * @returns {Promise<Object>} updated item
 */
export async function updateItemQuantity(itemId, quantityDelta) {
  return withLock(async () => {
    const item = await readJson(itemPath(itemId));
    if (!item) {
      throw new Error('item not found');
    }

    const newQuantity = item.quantity + quantityDelta;
    if (newQuantity < 0) {
      throw new Error('quantity cannot go below zero');
    }

    item.quantity = newQuantity;
    
    // Update status based on new quantity
    if (item.status === 'available' && item.quantity <= 0) {
      item.status = 'claimed';
      await updateIndexItemStatus(itemId, 'claimed');
    } else if (item.status === 'claimed' && item.quantity > 0) {
      item.status = 'available';
      await updateIndexItemStatus(itemId, 'available');
    }

    await writeJson(itemPath(itemId), item);
    await updateTicker(itemId, item);

    return item;
  });
}

/**
 * Remove all expired items from the index.
 * @returns {Promise<{removed: number, items: Array}>} cleanup result
 */
export async function removeExpiredItems() {
  const items = await readJson(itemsIndexPath(), []);
  const now = Date.now();

  const remaining = [];
  const removed = [];

  for (const item of items) {
    if (item.status === 'expired') {
      removed.push(item);
      continue;
    }
    if (item.expiresAt && now >= item.expiresAt) {
      // Mark as expired in individual record
      const full = await readJson(itemPath(item.id));
      if (full) {
        full.status = 'expired';
        await writeJson(itemPath(item.id), full);
      }
      await updateIndexItemStatus(item.id, 'expired');
      removed.push(item);
      continue;
    }
    remaining.push(item);
  }

  await writeJson(itemsIndexPath(), remaining);

  return { removed: removed.length, items: removed };
}

/**
 * Get ticker data for real-time availability display.
 * @returns {Promise<Object>} ticker state with totals
 */
export async function getTickerData() {
  const ticker = await readJson(tickerPath(), {
    tick: 0,
    lastUpdate: Date.now(),
    items: {},
  });

  // Refresh stale items
  const items = await readJson(itemsIndexPath(), []);
  const now = Date.now();
  let updated = false;

  for (const item of items) {
    if (item.status === 'available' && item.expiresAt && now >= item.expiresAt) {
      // Auto-expire
      const full = await readJson(itemPath(item.id));
      if (full) {
        full.status = 'expired';
        await writeJson(itemPath(item.id), full);
      }
      await updateIndexItemStatus(item.id, 'expired');
      updated = true;
    }
  }

  if (updated) {
    return getTickerData(); // Recurse with fresh data
  }

  // Calculate totals from items
  let totalAvailable = 0;
  let totalClaimed = 0;
  let totalItems = 0;
  let expiringSoon = 0;

  for (const item of items) {
    if (item.status === 'available' || item.status === 'claimed') {
      totalItems++;
      totalAvailable += item.quantity || 0;
      totalClaimed += item.claimed || 0;

      // Check if expiring soon (within 1 hour)
      if (item.status === 'available' && item.expiresAt) {
        const timeLeft = item.expiresAt - now;
        if (timeLeft > 0 && timeLeft < 60 * 60 * 1000) {
          expiringSoon++;
        }
      }
    }
  }

  return {
    ...ticker,
    available: totalAvailable,
    claimed: totalClaimed,
    total: totalItems,
    expiringSoon,
  };
}

// ---- internal helpers ----

async function updateIndexItemStatus(itemId, status) {
  const items = await readJson(itemsIndexPath(), []);
  const idx = items.findIndex(i => i.id === itemId);
  if (idx >= 0) {
    items[idx].status = status;
    await writeJson(itemsIndexPath(), items);
  }
}

async function updateTicker(itemId, item) {
  const ticker = await readJson(tickerPath(), {
    tick: 0,
    lastUpdate: Date.now(),
    items: {},
  });

  ticker.tick += 1;
  ticker.lastUpdate = Date.now();
  ticker.items[itemId] = {
    quantity: item.quantity,
    maxQuantity: item.maxQuantity,
    status: item.status,
    expiresAt: item.expiresAt,
  };

  await writeJson(tickerPath(), ticker);
}
