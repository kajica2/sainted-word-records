#!/usr/bin/env node
// The Recent folder: touch() records a clip, pick() returns the newest
// ones, and a reload (a fresh item with the same name and size) gets the
// stored time back.

import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../client/recent-media.client.js', import.meta.url), 'utf8');
const store = {};
const window = {
  localStorage: {
    getItem: function (k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
    setItem: function (k, v) { store[k] = v; },
  },
};
vm.runInNewContext(source, { window: window });
const api = window.SWR_RECENT_MEDIA;

let failed = 0;
function assert(cond, msg) {
  if (!cond) {
    failed++;
    console.log('  FAIL ' + msg);
  } else {
    console.log('  PASS ' + msg);
  }
}

const older = { name: 'dance-01.mp4', blob: { size: 100 }, id: 1 };
const newer = { name: 'dance-02.mp4', blob: { size: 200 }, id: 2 };
const untouched = { name: 'still.png', blob: { size: 50 }, id: 3 };

assert(api.touch(older, 1000) === 1000, 'touch stamps the given time');
assert(api.touch(newer, 2000) === 2000, 'touch stamps a newer clip later');
const picked = api.pick([untouched, older, newer], 12);
assert(picked.length === 2 && picked[0] === newer && picked[1] === older, 'pick is newest-first and skips untouched');
assert(api.pick([newer, older], 1).length === 1 && api.pick([newer, older], 1)[0] === newer, 'pick honours the cap');

const reloaded = { name: 'dance-02.mp4', blob: { size: 200 }, id: 99 };
assert(api.stamp(reloaded) === 2000 && reloaded.recentAt === 2000, 'a reloaded item recovers its recent time by name and size');
const again = api.pick([reloaded], 12);
assert(again[0] === reloaded, 'the recovered item is in the recent folder');

const persisted = { name: 'kept.mp4', persistId: 'abc', id: 4 };
api.touch(persisted, 3000);
const byId = { name: 'renamed.mp4', persistId: 'abc', id: 5 };
assert(api.stamp(byId) === 3000, 'persist id wins over the file name');

const uploaded = { name: 'clip.mp4', blob: { size: 80 } };
api.touch(uploaded, 4000);
const restored = { name: 'clip.mp4', blob: { size: 80 }, persistId: 'xyz' };
assert(api.stamp(restored) === 4000, 'a restored upload keeps the time stored under its name');
assert(store['swr.recent-media.v1'].indexOf('"id:xyz":4000') !== -1, 'the time is copied onto the persist id');

vm.runInNewContext(source, { window: window });
assert(window.SWR_RECENT_MEDIA === api, 'loading twice keeps the first instance');

if (failed) {
  console.log('RECENT MEDIA UNIT: FAIL (' + failed + ')');
  process.exit(1);
}
console.log('RECENT MEDIA UNIT: ALL GREEN');
