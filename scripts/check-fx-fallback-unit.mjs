#!/usr/bin/env node
// scripts/check-fx-fallback-unit.mjs
//
// fx-postprocess used to call getContext unconditionally and, on null,
// warn "WebGL not available" and return before window.FX existed.
// The gate is off by default: that path must be quiet and must still
// publish the setter API. The warning stays only when the page asked
// for WebGL and the browser refused a context.

import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const DETECT = readFileSync(join(ROOT, 'lib/webgl-feature-detect.client.js'), 'utf8');
const FX = readFileSync(join(ROOT, 'fx-postprocess.js'), 'utf8');

function load({ search, getContext }) {
  const warnings = [];
  let contextCalls = 0;
  const listeners = {};
  const store = new Map();
  const stage = {
    id: 'render',
    clientWidth: 640,
    clientHeight: 360,
    width: 640,
    height: 360,
    parentElement: { appendChild() {} },
  };
  const document = {
    readyState: 'loading',
    getElementById(id) { return id === 'render' ? stage : null; },
    createElement() {
      return {
        id: '',
        style: {},
        width: 0,
        height: 0,
        getContext(kind) {
          contextCalls += 1;
          return getContext(kind);
        },
      };
    },
    addEventListener(type, fn) { (listeners[type] ||= []).push(fn); },
  };
  const sandbox = {
    document,
    location: { search },
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
    },
    console: { warn: (...a) => warnings.push(a.join(' ')), error() {}, log() {} },
    setTimeout,
    URLSearchParams,
    performance: { now: () => 0 },
    isFinite,
    parseFloat,
    Math,
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  createContext(sandbox);
  runInContext(DETECT, sandbox);
  runInContext(FX, sandbox);
  for (const fn of listeners.DOMContentLoaded || []) fn();
  return { sandbox, warnings, contextCalls: () => contextCalls };
}

let failed = 0;
function check(name, ok, detail) {
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ' (' + detail + ')' : ''}`);
  if (!ok) failed += 1;
}

{
  const { sandbox, warnings, contextCalls } = load({ search: '', getContext: () => null });
  const fx = sandbox.window.FX;
  check('default gate does not call getContext', contextCalls() === 0, `calls ${contextCalls()}`);
  check('default gate does not warn', !warnings.some((w) => w.includes('WebGL not available')), warnings.join(' | '));
  check('default gate still publishes FX', !!fx && fx.available === false && typeof fx.setPersona === 'function');
  fx.setPersona({ temp: 0.4, mut: 0.25, mutAlgo: 2 });
  fx.setTemp(5);
  check('stub setters write state', fx.state.temp === 1 && fx.state.mut === 0.25 && fx.state.mutAlgo === 2, JSON.stringify(fx.state));
  check('stub has no output canvas', fx.outputCanvas === null);
}

{
  const { sandbox, warnings, contextCalls } = load({ search: '?webgl=1', getContext: () => null });
  const fx = sandbox.window.FX;
  check('opt-in with no context does call getContext', contextCalls() > 0, `calls ${contextCalls()}`);
  check('opt-in with no context warns', warnings.some((w) => w.includes('WebGL not available')), warnings.join(' | '));
  check('opt-in failure still publishes FX', !!fx && fx.available === false && typeof fx.setMut === 'function');
}

if (failed) {
  console.log(`FX FALLBACK UNIT: ${failed} FAILED`);
  process.exit(1);
}
console.log('FX FALLBACK UNIT: PASSED');
