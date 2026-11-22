#!/usr/bin/env node
// scripts/check-sw-navigation-unit.mjs
//
// A document navigation that 504s (or whose fetch throws) must be served
// from the precached shell. The previous handler returned the 504 itself,
// so the page console showed "Failed to load resource: 504" for
// /engine?utm_source=… even when /engine.html was already in the cache.
// A 4xx is a real answer and must not be replaced.

import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const ORIGIN = 'https://sainted-word-records.vercel.app';

function boot() {
  const listeners = {};
  const buckets = new Map();
  const self = {
    location: { origin: ORIGIN },
    addEventListener(type, fn) {
      (listeners[type] ||= []).push(fn);
    },
    skipWaiting() {},
    clients: { claim() { return Promise.resolve(); } },
  };

  function keyOf(req, ignoreSearch) {
    const raw = typeof req === 'string' ? new URL(req, ORIGIN).href : req.url;
    const u = new URL(raw);
    if (ignoreSearch) u.search = '';
    u.hash = '';
    return u.href;
  }

  function bucket(name) {
    if (!buckets.has(name)) buckets.set(name, new Map());
    const map = buckets.get(name);
    return {
      put(req, res) {
        map.set(keyOf(req, false), res);
        return Promise.resolve();
      },
      match(req, opts) {
        const ignore = !!(opts && opts.ignoreSearch);
        const key = keyOf(req, ignore);
        if (map.has(key)) return Promise.resolve(map.get(key));
        if (ignore) {
          for (const [k, v] of map) {
            if (keyOf(k, true) === key) return Promise.resolve(v);
          }
        }
        return Promise.resolve(undefined);
      },
      addAll() { return Promise.resolve(); },
    };
  }

  const sandbox = {
    self,
    caches: {
      open: (name) => Promise.resolve(bucket(name)),
      keys: () => Promise.resolve([...buckets.keys()]),
      delete: (name) => Promise.resolve(buckets.delete(name)),
    },
    fetch: () => Promise.reject(new Error('unset')),
    URL,
    Response,
    Request,
    Headers,
    console,
  };
  sandbox.globalThis = sandbox;
  createContext(sandbox);
  runInContext(readFileSync(join(ROOT, 'sw.js'), 'utf8'), sandbox);
  return { sandbox, listeners, buckets };
}

function html(status, body) {
  return new Response(body, {
    status,
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });
}

async function navigate(ctx, pathAndQuery, network) {
  ctx.sandbox.fetch = network;
  const req = new Request(ORIGIN + pathAndQuery, {
    method: 'GET',
    headers: { accept: 'text/html' },
  });
  let pending = null;
  const event = { request: req, respondWith(p) { pending = p; } };
  for (const fn of ctx.listeners.fetch) fn(event);
  if (!pending) throw new Error('navigation was not handled');
  return pending;
}

let failed = 0;
function check(name, ok, detail) {
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ' (' + detail + ')' : ''}`);
  if (!ok) failed += 1;
}

const ctx = boot();
// The install listener opens the cache lazily. Seed the version the
// worker actually uses by opening it the same way a precache would.
const live = await ctx.sandbox.caches.open('swr-v6');
await live.put('/engine', html(200, 'ENGINE'));
await live.put('/engine.html', html(200, 'ENGINE-HTML'));
await live.put('/', html(200, 'HOME'));

{
  const res = await navigate(ctx, '/engine?utm_source=chatgpt.com', async () => html(504, ''));
  const body = await res.text();
  check('504 navigation serves the precached /engine shell', res.status === 200 && body === 'ENGINE', `status ${res.status} body ${body}`);
  const stored = await live.match(ORIGIN + '/engine?utm_source=chatgpt.com');
  check('504 body is not written into the cache', !stored);
}

{
  const res = await navigate(ctx, '/marketplace', async () => html(404, 'missing'));
  const body = await res.text();
  check('404 navigation is returned as 404', res.status === 404 && body === 'missing', `status ${res.status} body ${body}`);
}

{
  const res = await navigate(ctx, '/engine', async () => html(200, 'FRESH'));
  const body = await res.text();
  check('200 navigation is returned and cached', res.status === 200 && body === 'FRESH', `status ${res.status} body ${body}`);
  const stored = await live.match(ORIGIN + '/engine');
  const storedBody = stored ? await stored.text() : '';
  check('fresh document replaces the cached shell', storedBody === 'FRESH', storedBody);
}

{
  const empty = boot();
  await empty.sandbox.caches.open('swr-v6');
  const res = await navigate(empty, '/engine?utm_source=chatgpt.com', async () => { throw new Error('gateway'); });
  const body = await res.text();
  check('thrown fetch with an empty cache serves the inline shell', res.status === 503 && body.includes('offline'), `status ${res.status}`);
}

{
  const res = await navigate(ctx, '/somewhere-uncached', async () => { throw new Error('gateway'); });
  const body = await res.text();
  check('thrown fetch falls back to cached /', res.status === 200 && body === 'HOME', `status ${res.status} body ${body}`);
}

if (failed) {
  console.log(`SW NAVIGATION UNIT: ${failed} FAILED`);
  process.exit(1);
}
console.log('SW NAVIGATION UNIT: PASSED');
