// scripts/check-live-layer-cap-unit.mjs
// A camera started on a full stage must not adopt the layer that is
// already on top. Stopping the camera used to splice that layer out.

import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const LAYERS = readFileSync(new URL('../lib/layers.client.js', import.meta.url), 'utf8');
const LIVE = readFileSync(new URL('../client/swr-live-input.client.js', import.meta.url), 'utf8');
const KEYS = readFileSync(new URL('../engine-keys.client.js', import.meta.url), 'utf8');

const results = [];
async function check(name, fn) {
  let ok = false;
  let detail = '';
  try {
    const r = await fn();
    ok = r === true;
    detail = typeof r === 'string' ? r : '';
  } catch (e) {
    detail = e && e.message ? e.message : String(e);
  }
  results.push({ name, ok, detail });
  console.log((ok ? '  PASS  ' : '  FAIL  ') + name + (detail ? ' — ' + detail : ''));
}

function makeNode(tag) {
  const n = {
    tagName: String(tag || 'div').toUpperCase(),
    children: [],
    style: {},
    className: '',
    dataset: {},
    value: '',
    parentNode: null,
    classList: null,
    appendChild(c) { c.parentNode = this; this.children.push(c); return c; },
    removeChild(c) {
      c.parentNode = null;
      this.children = this.children.filter((x) => x !== c);
    },
    setAttribute() {},
    removeAttribute() {},
    addEventListener() {},
    removeEventListener() {},
    querySelector() { return makeNode('span'); },
    querySelectorAll() { return []; },
    play() { return { catch() {} }; },
    pause() {},
  };
  n.classList = {
    add() {},
    remove() {},
    toggle() { return false; },
    contains() { return false; },
  };
  return n;
}

function baseSandbox() {
  const body = makeNode('body');
  const sandbox = {
    console: { warn() {}, log() {}, info() {}, error() {} },
    setTimeout,
    clearTimeout,
    Image: function Image() { this.src = ''; },
    setStatus() {},
    CustomEvent: class {
      constructor(type, init) { this.type = type; this.detail = init && init.detail; }
    },
    document: {
      body,
      createElement: (tag) => makeNode(tag),
      createDocumentFragment: () => makeNode('fragment'),
      getElementById: () => makeNode('div'),
      querySelector: () => makeNode('div'),
      querySelectorAll: () => [],
      addEventListener() {},
      removeEventListener() {},
      dispatchEvent() { return true; },
    },
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  return sandbox;
}

function load(sandbox, src) {
  vm.runInContext(src, sandbox);
}

function cameraApi(stopped) {
  return {
    create() {
      return {
        startCamera() {
          return Promise.resolve({
            success: true,
            stream: { getTracks() { return []; } },
            resolution: { width: 16, height: 16 },
          });
        },
        stopCamera() { stopped.n += 1; },
      };
    },
  };
}

function clip(id) {
  return { id, name: id, type: 'video', url: id };
}

await check('a full stage refuses the camera and stopping it keeps every layer', async () => {
  const sandbox = baseSandbox();
  const stopped = { n: 0 };
  sandbox.SWR_MEDIA_INPUT = cameraApi(stopped);
  load(sandbox, LAYERS);
  sandbox.SWR = { Layers: sandbox.Layers };
  load(sandbox, LIVE);
  const L = sandbox.Layers;
  L.add(clip('a'));
  L.add(clip('b'));
  L.add(clip('c'));
  const ids = L.list.map((l) => l.id).join();
  const res = await sandbox.SWR_LIVE_INPUT.startCamera();
  if (res.ok !== false || res.error !== 'LayerCap') return 'start ' + JSON.stringify(res);
  if (L.list.map((l) => l.id).join() !== ids) return 'start changed the stack';
  if (stopped.n !== 1) return 'camera stream left running: ' + stopped.n;
  sandbox.SWR_LIVE_INPUT.stopCamera();
  if (L.list.map((l) => l.id).join() !== ids) return 'stop deleted a layer';
  if (L.list.length !== 3) return 'length ' + L.list.length;
  return true;
});

await check('a camera fits when the stage has room, and stopping removes only that layer', async () => {
  const sandbox = baseSandbox();
  const stopped = { n: 0 };
  sandbox.SWR_MEDIA_INPUT = cameraApi(stopped);
  load(sandbox, LAYERS);
  sandbox.SWR = { Layers: sandbox.Layers };
  load(sandbox, LIVE);
  const L = sandbox.Layers;
  L.add(clip('a'));
  L.add(clip('b'));
  const res = await sandbox.SWR_LIVE_INPUT.startCamera();
  if (!res.ok) return 'start refused a free slot ' + JSON.stringify(res);
  if (L.list.length !== 3) return 'length ' + L.list.length;
  const cam = L.list[L.list.length - 1];
  if (!cam.asset || cam.asset.id !== 'live-camera') return 'top layer is not the camera';
  if (cam.blend !== 'screen') return 'blend ' + cam.blend;
  if (stopped.n !== 0) return 'start released the stream';
  sandbox.SWR_LIVE_INPUT.stopCamera();
  if (L.list.length !== 2) return 'stop left ' + L.list.length;
  if (L.list.some((l) => l.asset && l.asset.id === 'live-camera')) return 'camera layer survived';
  return true;
});

await check('a page whose add returns nothing still gets the camera layer it pushed', async () => {
  const sandbox = baseSandbox();
  const stopped = { n: 0 };
  sandbox.SWR_MEDIA_INPUT = cameraApi(stopped);
  const list = [];
  sandbox.SWR = {
    Layers: {
      list,
      add(asset) {
        list.push({ id: 'L' + list.length, asset, blend: 'multiply' });
      },
      render() {},
    },
  };
  load(sandbox, LIVE);
  const res = await sandbox.SWR_LIVE_INPUT.startCamera();
  if (!res.ok) return 'start failed ' + JSON.stringify(res);
  if (list.length !== 1 || list[0].asset.id !== 'live-camera') return 'camera was not adopted';
  if (list[0].blend !== 'screen') return 'blend ' + list[0].blend;
  sandbox.SWR_LIVE_INPUT.stopCamera();
  if (list.length !== 0) return 'stop left ' + list.length;
  return true;
});

await check('a refused add does not restyle the layer already on top', () => {
  const matches = KEYS.match(/L\.list\.length > before/g) || [];
  if (matches.length < 2) return 'a master wrap still takes the last layer (' + matches.length + ')';
  return true;
});

const fail = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - fail} passed, ${fail} failed (${results.length} checks)`);
if (fail) process.exit(1);
