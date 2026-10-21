// scripts/lib/ws-client.mjs
// ---------------------------------------------------------------
// A minimal WebSocket client, for the Node versions that do not ship
// one.
//
// Why it exists: Node 20 has no global WebSocket. It is behind
// `--experimental-websocket` there and stable from Node 22, so the
// live-input gate — which drives Chrome over the DevTools Protocol and
// therefore needs a WebSocket — died on the CI runner (which pins Node
// 20) with "ERROR: WebSocket is not defined", before it asserted
// anything.
//
// This implements exactly what a DevTools socket needs and nothing
// more: the client handshake, masked text frames out, unmasked text
// frames in, ping/pong, close. No dependencies — the repo has no
// runtime dependencies and this keeps it that way.
//
// The API is the browser's, so the calling code does not care which
// implementation it got:
//
//   const ws = new WebSocketImpl(url);
//   ws.onopen = () => {};
//   ws.onerror = (err) => {};
//   ws.onmessage = (ev) => ev.data;   // a string
//   ws.send(text);
//   ws.close();
//
// Exported as `pickWebSocket()`: the global WebSocket when the runtime
// has one, this client when it does not.

import { createHash, randomBytes } from 'node:crypto';
import http from 'node:http';

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

export class SimpleWebSocket {
  constructor(url) {
    this.url = url;
    this.onopen = null;
    this.onerror = null;
    this.onmessage = null;
    this.onclose = null;
    this.socket = null;
    this.buffer = Buffer.alloc(0);
    this.fragments = [];
    this.fragmentOpcode = 0;
    this.closed = false;
    this.connect();
  }

  connect() {
    let u;
    try {
      u = new URL(this.url);
    } catch (err) {
      this._fail('bad websocket url: ' + this.url);
      return;
    }
    const key = randomBytes(16).toString('base64');
    const req = http.request({
      hostname: u.hostname,
      port: u.port || (u.protocol === 'wss:' ? 443 : 80),
      path: (u.pathname || '/') + (u.search || ''),
      headers: {
        Connection: 'Upgrade',
        Upgrade: 'websocket',
        'Sec-WebSocket-Key': key,
        'Sec-WebSocket-Version': '13',
      },
    });
    req.on('upgrade', (res, socket, head) => {
      const accept = createHash('sha1').update(key + GUID).digest('base64');
      if (res.headers['sec-websocket-accept'] !== accept) {
        socket.destroy();
        this._fail('websocket handshake mismatch');
        return;
      }
      this.socket = socket;
      socket.setNoDelay(true);
      if (head && head.length) this._push(head);
      socket.on('data', (d) => this._push(d));
      socket.on('error', (err) => this._fail(err.message));
      socket.on('close', () => {
        this.closed = true;
        if (this.onclose) this.onclose();
      });
      // Deferred: the caller assigns onopen right after the constructor
      // returns, so the event must not fire before that.
      setImmediate(() => { if (this.onopen) this.onopen(); });
    });
    req.on('error', (err) => this._fail(err.message));
    req.end();
  }

  _push(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    for (;;) {
      if (this.buffer.length < 2) return;
      const b0 = this.buffer[0];
      const b1 = this.buffer[1];
      const fin = (b0 & 0x80) !== 0;
      const opcode = b0 & 0x0f;
      const masked = (b1 & 0x80) !== 0;
      let len = b1 & 0x7f;
      let offset = 2;
      if (len === 126) {
        if (this.buffer.length < offset + 2) return;
        len = this.buffer.readUInt16BE(offset);
        offset += 2;
      } else if (len === 127) {
        if (this.buffer.length < offset + 8) return;
        len = Number(this.buffer.readBigUInt64BE(offset));
        offset += 8;
      }
      let mask = null;
      if (masked) {
        if (this.buffer.length < offset + 4) return;
        mask = this.buffer.subarray(offset, offset + 4);
        offset += 4;
      }
      if (this.buffer.length < offset + len) return;
      const payload = Buffer.from(this.buffer.subarray(offset, offset + len));
      this.buffer = this.buffer.subarray(offset + len);
      if (mask) {
        for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4];
      }
      this._frame(fin, opcode, payload);
    }
  }

  _frame(fin, opcode, payload) {
    if (opcode === 0x8) { this.close(); return; }              // close
    if (opcode === 0x9) { this._send(0xa, payload); return; }  // ping → pong
    if (opcode === 0xa) return;                                // pong
    if (opcode === 0x0) this.fragments.push(payload);
    else { this.fragments = [payload]; this.fragmentOpcode = opcode; }
    if (!fin) return;
    const full = Buffer.concat(this.fragments);
    this.fragments = [];
    if (this.fragmentOpcode === 0x1 && this.onmessage) {
      this.onmessage({ data: full.toString('utf8') });
    }
  }

  _send(opcode, payload) {
    if (!this.socket || this.closed) return;
    const mask = randomBytes(4);
    const len = payload.length;
    let header;
    if (len < 126) {
      header = Buffer.from([0x80 | opcode, 0x80 | len]);
    } else if (len < 65536) {
      header = Buffer.alloc(4);
      header[0] = 0x80 | opcode;
      header[1] = 0x80 | 126;
      header.writeUInt16BE(len, 2);
    } else {
      header = Buffer.alloc(10);
      header[0] = 0x80 | opcode;
      header[1] = 0x80 | 127;
      header.writeBigUInt64BE(BigInt(len), 2);
    }
    const masked = Buffer.from(payload);
    for (let i = 0; i < masked.length; i++) masked[i] ^= mask[i % 4];
    this.socket.write(Buffer.concat([header, mask, masked]));
  }

  send(text) { this._send(0x1, Buffer.from(text, 'utf8')); }

  close() {
    if (!this.socket) return;
    try { this._send(0x8, Buffer.alloc(0)); } catch { /* already gone */ }
    try { this.socket.end(); } catch { /* already gone */ }
    this.socket = null;
  }

  _fail(message) {
    if (this.onerror) this.onerror(new Error(message));
  }
}

// The global WebSocket when the runtime has one, the client above when it
// does not. SWR_WS_FALLBACK=1 forces the fallback — that is how the
// fallback is tested on a machine that does have the global.
export function pickWebSocket() {
  if (process.env.SWR_WS_FALLBACK === '1') return SimpleWebSocket;
  return typeof WebSocket !== 'undefined' ? WebSocket : SimpleWebSocket;
}
