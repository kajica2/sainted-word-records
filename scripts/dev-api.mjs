// scripts/dev-api.mjs — Vite dev middleware that serves /api/* using the
// same handlers that Vercel will run in production. We import them as
// functions and call them with synthesized (req, res) objects.
//
// This file is loaded by vite.config.js's configureServer hook and turns
// `npm run dev` into a complete end-to-end loop without a separate server.
//
// IMPORTANT: paths to api/* modules are built at runtime so esbuild (which
// compiles vite.config.js) doesn't statically resolve api/* imports.
// Vite's scanner would otherwise try to compile api/*.js as part of the
// engine bundle.

import { createRequire } from 'node:module';
import { PassThrough } from 'node:stream';

const require = createRequire(import.meta.url);

const HANDLER_PATHS = {
  'auth/session': '../api/auth/session.js',
  'auth/magic': '../api/auth/magic.js',
  'auth/verify': '../api/auth/verify.js',
  'storage/sign-upload': '../api/storage/sign-upload.js',
  'storage/sign-download': '../api/storage/sign-download.js',
  'storage/object': '../api/storage/object.js',
  'projects/': '../api/projects/index.js',
  'projects/item': '../api/projects/[id].js',
  'health': '../api/health.js',
};

function pickHandlerPath(urlPath) {
  const segs = urlPath.replace(/^\/+/, '').split('?')[0].split('/');
  if (segs[0] !== 'api') return null;
  if (segs[1] === 'auth' && (segs[2] === 'session' || segs[2] === 'magic' || segs[2] === 'verify')) {
    return HANDLER_PATHS['auth/' + segs[2]];
  }
  if (segs[1] === 'storage') {
    if (segs[2] === 'sign-upload') return HANDLER_PATHS['storage/sign-upload'];
    if (segs[2] === 'sign-download') return HANDLER_PATHS['storage/sign-download'];
    if (segs[2] === 'object') return HANDLER_PATHS['storage/object'];
  }
  if (segs[1] === 'projects') {
    if (!segs[2]) return HANDLER_PATHS['projects/'];
    return HANDLER_PATHS['projects/item'];
  }
  if (segs[1] === 'health') return HANDLER_PATHS['health'];
  return null;
}

const handlerCache = new Map();
async function loadHandler(relPath) {
  // relPath is relative to scripts/ (this file's location).
  const abs = require('path').resolve(require('path').dirname(new URL(import.meta.url).pathname), relPath);
  const cacheKey = abs;
  if (handlerCache.has(cacheKey)) return handlerCache.get(cacheKey);
  const url = require('url').pathToFileURL(abs).href;
  const mod = await import(url);
  const handler = mod.default || mod;
  handlerCache.set(cacheKey, handler);
  return handler;
}

export async function handleApi(req, res, next) {
  const url = req.url || '';
  if (!url.startsWith('/api/')) return next();

  const filePath = pickHandlerPath(url);
  if (!filePath) {
    res.statusCode = 404;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'no_handler', url }));
    return;
  }

  let handler;
  try {
    handler = await loadHandler(filePath);
  } catch (e) {
    process.stderr.write('[dev-api] import failed for ' + filePath + ': ' + e.message + '\n');
    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: 'handler_import_failed', message: e.message }));
    }
    return;
  }

  // Parse query into req.query
  const u = new URL(url, 'http://x');
  const query = {};
  for (const [k, v] of u.searchParams) query[k] = v;
  req.query = query;

  // Buffer POST/PUT bodies so handlers can use req.body OR req.on('data').
  // We preserve the original req stream so handlers that listen for 'data'
  // continue to work, but we also set req.body to a string for readJsonBody.
  //
  // Cap the body at 60 MB so a malicious client can't OOM the dev server.
  // Handlers cap themselves lower (1 MB / 2 MB / 50 MB); this is just a
  // last-resort guard at the middleware layer.
  if (req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH') {
    const MAX_MIDDLEWARE_BODY = 60 * 1024 * 1024;
    const chunks = [];
    let total = 0;
    let aborted = false;
    await new Promise((resolve) => {
      req.on('data', (c) => {
        if (aborted) return;
        total += c.length;
        if (total > MAX_MIDDLEWARE_BODY) {
          aborted = true;
          try { req.destroy(); } catch {}
          resolve();
          return;
        }
        chunks.push(c);
      });
      req.on('end', resolve);
      req.on('error', resolve);
    });
    if (aborted) {
      if (!res.headersSent) {
        res.statusCode = 413;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: 'payload_too_large', max: MAX_MIDDLEWARE_BODY }));
      }
      return;
    }
    const buf = Buffer.concat(chunks);
    Object.defineProperty(req, 'body', {
      value: buf.length ? buf.toString('utf8') : '',
      configurable: true,
    });
    // Replace req with a PassThrough that emits our buffered data then
    // ends. Handlers that read req.on('data') get the full body in one go.
    //
    // NOTE: we intentionally don't forward the original req's 'error'
    // event — by the time handlers run, we've already consumed the body.
    // Handlers that want connection-error semantics should rely on Vite's
    // own middleware-level timeouts.
    const { PassThrough } = require('node:stream');
    const replay = new PassThrough();
    replay.end(buf);
    const origOn = req.on.bind(req);
    const origOnce = req.once.bind(req);
    const origEmit = req.emit.bind(req);
    req.on = function (event, listener) {
      if (event === 'data' || event === 'end' || event === 'readable') {
        return replay.on(event, listener);
      }
      return origOn(event, listener);
    };
    req.once = function (event, listener) {
      if (event === 'data' || event === 'end' || event === 'readable') {
        return replay.once(event, listener);
      }
      return origOnce(event, listener);
    };
    req.emit = function (event, ...args) {
      if (event === 'data' || event === 'end' || event === 'readable') {
        return replay.emit(event, ...args);
      }
      return origEmit(event, ...args);
    };
  }

  try {
    await handler(req, res);
  } catch (e) {
    console.error('[dev-api] handler threw for', filePath, ':', e);
    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: 'handler_threw', message: e.message }));
    }
  }
}
