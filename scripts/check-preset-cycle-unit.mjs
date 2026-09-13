import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync('client/preset-cycle.client.js', 'utf8');
const context = { window: {} };
vm.runInNewContext(source, context);

const ids = ['pulse', 'neon', 'grid', 'eclipse', 'smoke', 'aurora', 'film', 'glitch', 'void'];
const cycle = context.window.SWR_PRESET_CYCLE;
let tests = 0;
function assert(condition, message) {
  tests++;
  if (!condition) throw new Error(`FAIL: ${message}`);
}

assert(cycle.next(null) === 'pulse', 'next(null)');
assert(cycle.next('pulse') === 'neon', 'next pulse');
assert(cycle.next('void') === 'pulse', 'next wraps');
assert(cycle.next('unknown-id') === 'pulse', 'next unknown');
assert(cycle.next(42) === 'pulse', 'next non-string');
assert(cycle.prev('pulse') === 'void', 'prev wraps');
assert(cycle.prev('void') === 'glitch', 'prev void');
assert(cycle.prev(null) === 'void', 'prev null');
assert(cycle.prev('unknown') === 'void', 'prev unknown');
assert(cycle.indexOf('neon') === 1 && cycle.indexOf('xyz') === -1, 'indexOf');
assert(cycle.first() === 'pulse' && cycle.last() === 'void', 'first/last');
const copy = cycle.ids();
copy[0] = 'changed';
assert(cycle.first() === 'pulse', 'ids defensive copy');
const original = context.window.VersionsPresets;
context.window.VersionsPresets = { SHORTCUT_PRESETS: ['one', 'two'] };
cycle.rebuild();
assert(cycle.first() === 'one' && cycle.last() === 'two' && cycle.next('one') === 'two', 'rebuild');
context.window.VersionsPresets = original;
const emptyContext = { window: { VersionsPresets: { SHORTCUT_PRESETS: [] } } };
vm.runInNewContext(source, emptyContext);
const empty = emptyContext.window.SWR_PRESET_CYCLE;
assert(empty.next(null) === null, 'empty list');

console.log(`PRESET CYCLE UNIT: ALL GREEN (${tests} tests)`);
