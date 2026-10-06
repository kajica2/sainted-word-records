// api/_lib/orders.js — buyer order ledger for the marketplace pilot.
//
// An order is created when a buyer starts Checkout (status 'pending'),
// then fulfilled when the Stripe `checkout.session.completed` webhook
// arrives (status 'paid'). Every purchase is a remix license: the order
// records WHICH listings were bought, from WHICH seller, at what prices.
//
// Money model — the platform is always FREE for creators:
//   priceMinor   = sum of the seller's listing prices (what the seller
//                  receives, 100%)
//   feeMinor     = buyer-side service fee = round(priceMinor * feePercent/100)
//   totalMinor   = priceMinor + feeMinor (what the buyer is charged)
// The Checkout Session charges totalMinor and uses
// payment_intent_data.application_fee_amount = feeMinor with
// transfer_data.destination = seller's connected account, so the seller
// gets exactly priceMinor and the buyer absorbs the fee.
//
// Store layout — same key space on every backend (JSON under
// SWRC_DATA_DIR locally, `kv` table rows on Postgres — see db.js):
//   orders/index.json       [ order, ... ] — queryable ledger
//   orders/<id>.json        audit copy of one order
//
// An order:
//   { id, sessionId, buyerUserId, buyerEmail, sellerUserId,
//     sellerAccountId, items: [{ listingId, type, title, priceMinor }],
//     currency, priceMinor, feeMinor, totalMinor, feePercent,
//     status: 'pending'|'paid'|'cancelled', paymentIntentId?,
//     createdAt, updatedAt }

import { join } from 'node:path';
import { uuid, readJson, writeJson, withLock, DATA_ROOT } from './db.js';

export const ORDER_STATUSES = ['pending', 'paid', 'cancelled'];
export const ORDER_ID_RE = /^[a-f0-9-]{8,40}$/i;
export const ITEMS_MAX = 12;

const ORDERS_ROOT = join(DATA_ROOT, 'orders');
const UUID_RE = /^[a-f0-9-]{8,40}$/i;

function assertId(id, label = 'id') {
  if (typeof id !== 'string' || !UUID_RE.test(id)) throw new TypeError(`invalid ${label}`);
}

// ---- fee math (pure; unit-tested) ----

// feePercent is the buyer-side surcharge (1..99). feeMinor rounds to the
// nearest minor unit so totalMinor always equals priceMinor + feeMinor.
export function computeOrderTotals({ priceMinor, feePercent }) {
  const price = Number(priceMinor);
  const pct = Number(feePercent);
  if (!Number.isInteger(price) || price <= 0) throw new TypeError('priceMinor must be a positive integer');
  if (!Number.isInteger(pct) || pct < 0 || pct > 99) throw new TypeError('feePercent must be an integer 0..99');
  const fee = Math.round((price * pct) / 100);
  return { priceMinor: price, feeMinor: fee, totalMinor: price + fee };
}

// ---- paths ----

export function ordersIndexPath() {
  return join(ORDERS_ROOT, 'index.json');
}
export function orderPath(id) {
  if (!ORDER_ID_RE.test(id)) throw new Error('invalid order id');
  return join(ORDERS_ROOT, `${id}.json`);
}

// ---- reads ----

export async function getOrder(id) {
  if (!ORDER_ID_RE.test(id)) return null;
  return readJson(orderPath(id), null);
}

export async function findOrderBySession(sessionId) {
  if (!sessionId) return null;
  const all = await readJson(ordersIndexPath(), []);
  return Array.isArray(all)
    ? all.find((o) => o && o.sessionId === sessionId) || null
    : null;
}

export async function listOrdersForUser(userId) {
  assertId(userId, 'userId');
  const all = await readJson(ordersIndexPath(), []);
  if (!Array.isArray(all)) return [];
  return all
    .filter((o) => o && (o.buyerUserId === userId || o.sellerUserId === userId))
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

// ---- writes ----

// Create a pending order. `items` must already be validated catalogue
// listings (the checkout handler resolves them server-side).
export async function createOrder({ buyerUserId, buyerEmail, sellerUserId, sellerAccountId, items, currency = 'EUR', feePercent }) {
  assertId(buyerUserId, 'buyerUserId');
  assertId(sellerUserId, 'sellerUserId');
  if (!Array.isArray(items) || !items.length || items.length > ITEMS_MAX) {
    throw new TypeError(`items must be 1..${ITEMS_MAX} entries`);
  }
  const clean = items.map((it) => ({
    listingId: String(it.listingId),
    type: String(it.type),
    title: String(it.title).slice(0, 120),
    priceMinor: it.priceMinor,
  }));
  const priceMinor = clean.reduce((s, it) => s + it.priceMinor, 0);
  const totals = computeOrderTotals({ priceMinor, feePercent });

  const now = new Date().toISOString();
  const order = {
    id: uuid(),
    sessionId: null,
    buyerUserId,
    buyerEmail: String(buyerEmail || '').toLowerCase(),
    sellerUserId,
    sellerAccountId,
    items: clean,
    currency,
    priceMinor: totals.priceMinor,
    feeMinor: totals.feeMinor,
    totalMinor: totals.totalMinor,
    feePercent,
    status: 'pending',
    paymentIntentId: null,
    createdAt: now,
    updatedAt: now,
  };

  await withLock(async () => {
    const index = (await readJson(ordersIndexPath(), [])) || [];
    index.push(order);
    await writeJson(ordersIndexPath(), index);
    await writeJson(orderPath(order.id), order);
  });
  return order;
}

// Whitelisted patch (session links + status transitions).
export async function updateOrder(id, patch = {}) {
  if (!ORDER_ID_RE.test(id)) return null;
  return withLock(async () => {
    const cur = await readJson(orderPath(id), null);
    if (!cur) return null;
    const next = { ...cur, ...whitelistOrderPatch(patch), updatedAt: new Date().toISOString() };
    await writeJson(orderPath(id), next);
    await rewriteIndexRow(next);
    return next;
  });
}

// Fulfilment path: idempotent — a redelivered webhook never double flips.
export async function markOrderPaidBySession(sessionId, { paymentIntentId = null } = {}) {
  const cur = await findOrderBySession(sessionId);
  if (!cur) return null;
  if (cur.status === 'paid') return cur;
  return updateOrder(cur.id, { status: 'paid', sessionId, paymentIntentId: paymentIntentId || cur.paymentIntentId });
}

// ---- internal ----

const EDITABLE = new Set(['sessionId', 'status', 'paymentIntentId']);
function whitelistOrderPatch(patch = {}) {
  const out = {};
  for (const k of Object.keys(patch)) {
    if (!EDITABLE.has(k)) continue;
    const v = patch[k];
    if (k === 'status') {
      if (!ORDER_STATUSES.includes(v)) continue;
      out.status = v;
    } else if (typeof v === 'string' && v) {
      out[k] = v;
    }
  }
  return out;
}

async function rewriteIndexRow(next) {
  const index = (await readJson(ordersIndexPath(), [])) || [];
  const idx = index.findIndex((o) => o && o.id === next.id);
  if (idx >= 0) index[idx] = next;
  await writeJson(ordersIndexPath(), index);
}