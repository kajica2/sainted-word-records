// scripts/dev-control-ws.mjs — Tiny WebSocket control bridge for the
// Sainted Word Records visualizers (versions/*.html).
//
// One purpose: pass JSON messages between any number of "drivers" (an
// OSC bridge, a Bluetooth shim, a mobile page, an agentic loop) and
// any number of visualizer tabs that have the `visualizer-controller.js`
// client loaded.
//
// This runs alongside `npm run dev` (Vite) on a different port (8787).
// It is NOT vendored into the production build — visualizers fall back
// to running in single-page mode without remote control. The dev-only
// contract is intentional: a real production control surface would
// live behind auth + a signed token. This is the smallest useful thing.
//
// Protocol (JSON over WS, bi-directional, opaque routing): see
// client/visualizer-controller.js for the canonical spec.
//
// Usage:
//   node scripts/dev-control-ws.mjs            # listens on :8787
//   VC_WS_PORT=9001 node scripts/dev-control-ws.mjs
//   curl -i -N -H "Connection: Upgrade" -H "Upgrade: websocket" \
//        -H "Sec-WebSocket-Key: $(head -c 16 /dev/urandom | base64)" \
//        -H "Sec-WebSocket-Version: 13" \
//        http://127.0.0.1:8787/
//
// Author: Kai Djuric · 2026-08-25

import { WebSocketServer } from 'ws';

const PORT = parseInt(process.env.VC_WS_PORT || '8787', 10);
const HOST = process.env.VC_WS_HOST || '127.0.0.1';

const wss = new WebSocketServer({ host: HOST, port: PORT });
const peers = new Set(); // one entry per connection: { ws, role, hello }

function snapshot() {
  const out = [];
  for (const p of peers) {
    out.push({ role: p.role || 'unknown', hello: p.hello || null, age: Math.round((Date.now() - p.t) / 1000) });
  }
  return out;
}

wss.on('connection', (ws, req) => {
  const peer = { ws, role: null, hello: null, t: Date.now() };
  peers.add(peer);

  console.log(`[vc] + peer (${peers.size} total) from ${req.socket.remoteAddress}`);

  ws.on('message', (data) => {
    let msg;
    try { msg = JSON.parse(data.toString('utf8')); } catch { return; }
    if (!msg || typeof msg !== 'object') return;

    // First message from a peer should be a hello; tag its role based on
    // payload shape (heuristic, not enforced).
    if (msg.type === 'hello') {
      peer.hello = msg;
      peer.role = msg.role ||
        (msg.version ? 'visualizer' :
         msg.source ? msg.source :
         'driver');
      // Broadcast to all so peers can discover each other.
      fanout(peer, { type: 'peer:hello', peer: { role: peer.role } });
      return;
    }

    // Everything else: broadcast to all OTHER peers (drivers and other
    // visualizers). Drivers typically want to fan out to all visualizers;
    // visualizers never need their own outbound to echo back. We do
    // broadcast for simplicity — visualizers' handleInbound is idempotent
    // for `set` (writes the same value).
    fanout(peer, msg);
  });

  ws.on('close', () => {
    peers.delete(peer);
    console.log(`[vc] - peer (${peers.size} remaining)`);
    fanout(null, { type: 'peer:bye', role: peer.role });
  });

  ws.on('error', (e) => {
    console.warn('[vc] peer error', e && e.message);
  });
});

function fanout(fromPeer, msg) {
  for (const p of peers) {
    if (p === fromPeer) continue;
    if (p.ws.readyState === p.ws.OPEN) {
      try { p.ws.send(JSON.stringify(msg)); } catch (_) { /* */ }
    }
  }
}

console.log(`[vc] dev control bridge listening on ws://${HOST}:${PORT}`);

// Tiny health endpoint for `curl :8787/healthz` from the dev workflow.
import http from 'node:http';
const healthServer = http.createServer((req, res) => {
  if (req.url === '/healthz' || req.url === '/') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, peers: snapshot(), port: PORT }));
    return;
  }
  res.writeHead(404).end();
});
const HEALTH_PORT = parseInt(process.env.VC_WS_HEALTH_PORT || '8799', 10);
healthServer.listen(HEALTH_PORT, HOST, () => {
  console.log(`[vc] health on http://${HOST}:${HEALTH_PORT}/healthz`);
});
