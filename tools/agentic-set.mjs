#!/usr/bin/env node
// tools/agentic-set.mjs — Issue a single set/load/action over the WS bridge.
//
// Usage:
//   node tools/agentic-set.mjs param sens 1.7                       [host] [port]
//   node tools/agentic-set.mjs action play                             [host] [port]
//   node tools/agentic-set.mjs load  aurora                           [host] [port]
//   node tools/agentic-set.mjs snapshot                              [host] [port]
//   node tools/agentic-set.mjs --peer-count                          [host] [port]
//
// Defaults: ws://127.0.0.1:8787
//
// This is the canonical "agentic" surface for the visualizer transport:
// any LLM (HF Space, Hermes agent loop, local llama.cpp, etc.) can drive
// SWR by issuing one of these messages.

import process from 'node:process';
import { WebSocket } from 'ws';
import http from 'node:http';

function parseArgs(argv) {
  const out = { command: 'help', args: [], host: '127.0.0.1', port: 8787 };
  let i = 0;
  while (i < argv.length) {
    const a = argv[i];
    if (a === '--help' || a === '-h') { out.command = 'help'; i++; continue; }
    if (a === '--host' && i + 1 < argv.length) { out.host = argv[++i]; i++; continue; }
    if (a === '--port' && i + 1 < argv.length) { out.port = parseInt(argv[++i], 10); i++; continue; }
    out.args.push(a); i++;
  }
  if (out.args.length > 0) out.command = out.args[0];
  return out;
}

function help() {
  console.error(`agentic-set: drive a SWR visualizer over the WS bridge.

Usage:
  node tools/agentic-set.mjs <command> [args] [--host HOST] [--port PORT]

Commands:
  param  <name> <value>      Set an engine parameter (sens, gate, decay, etc.)
  action <name>              Trigger a UI action (play, pause, ...)
  load   <version>           Navigate to /versions/<version>.html
  snapshot                   Read params from any visualizer peer (no message sent)
  --peer-count               Just count visualizer peers on the bridge

Defaults: ws://127.0.0.1:8787`);
}

const parsed = parseArgs(process.argv.slice(2));
const { command, args, host, port } = parsed;

if (command === 'help') { help(); process.exit(0); }

const wsUrl = `ws://${host}:${port}`;

const ws = new WebSocket(wsUrl);
let closed = false;
ws.on('open', () => {
  ws.send(JSON.stringify({ type: 'hello', role: 'agentic', source: 'cli' }));

  let msg;
  switch (command) {
    case 'param':
      if (args.length < 3) {
        console.error('param needs a name and value');
        help(); closed = true; ws.close(); process.exit(2);
      }
      msg = { type: 'set', param: args[1], value: parseFloat(args[2]) };
      break;
    case 'action':
      if (args.length < 2) { console.error('action needs a name'); help(); process.exit(2); }
      msg = { type: 'action', name: args[1] };
      break;
    case 'load':
      if (args.length < 2) { console.error('load needs a version'); help(); process.exit(2); }
      msg = { type: 'load', version: args[1] };
      break;
    case 'snapshot':
      ws.close();
      const req1 = http.get(`http://${host}:8799/healthz`, (res) => {
        let body = '';
        res.on('data', (c) => body += c);
        res.on('end', () => {
          try {
            const j = JSON.parse(body);
            console.log(JSON.stringify({ peers: j.peers.map((p) => ({ role: p.role, version: p.hello && p.hello.version, params: p.hello && p.hello.params })) }, null, 2));
          } catch (e) { console.error('parse error', e.message); process.exit(1); }
        });
      });
      req1.on('error', (e) => { console.error('healthz error', e.message); process.exit(1); });
      return;
    case '--peer-count':
      ws.close();
      const req2 = http.get(`http://${host}:8799/healthz`, (res) => {
        let body = '';
        res.on('data', (c) => body += c);
        res.on('end', () => {
          try {
            const j = JSON.parse(body);
            console.log(j.peers.filter((p) => p.role === 'visualizer').length);
          } catch (e) { console.error('parse error', e.message); process.exit(1); }
        });
      });
      req2.on('error', (e) => { console.error('healthz error', e.message); process.exit(1); });
      return;
    default:
      console.error(`unknown command: ${command}`);
      help();
      process.exit(2);
  }

  if (msg) ws.send(JSON.stringify(msg));
  // Wait briefly for the bridge to fan out, then exit.
  setTimeout(() => { try { ws.close(); } catch (_) {} }, 200);
});

ws.on('message', (data) => {
  // Surface inbound messages only for non-trivial commands.
  if (command === 'snapshot') return;
  try {
    const m = JSON.parse(data.toString('utf8'));
    if (m.type !== 'peer:hello' && m.type !== 'peer:bye') {
      console.log(JSON.stringify(m));
    }
  } catch (_) { /* ignore */ }
});

ws.on('error', (e) => {
  console.error(`ws error: ${e.message}`);
  process.exit(1);
});

ws.on('close', () => {
  if (!closed) process.exit(0);
});
