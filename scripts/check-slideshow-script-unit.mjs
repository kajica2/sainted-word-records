#!/usr/bin/env node
// Slideshow script driver — parse / play / stop / still resolve / caption draw.

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = fs.readFileSync(path.join(ROOT, 'client/slideshow-script.client.js'), 'utf8');

let failures = 0;
function check(cond, msg) {
  if (cond) {
    console.log('  ✓ ' + msg);
    return;
  }
  failures += 1;
  console.log('  ✗ ' + msg);
}

function boot(extra) {
  const store = Object.create(null);
  if (extra && extra._storeSeed && typeof extra._storeSeed === 'object') {
    Object.assign(store, extra._storeSeed);
    delete extra._storeSeed;
  }
  const events = [];
  const timers = [];
  let now = 1000;
  const laneList = [];
  const lane = {
    list: laneList,
    selected: null,
    add(asset) {
      const layer = { id: 'I' + (laneList.length + 1), asset, _imageLane: true, hidden: false };
      laneList.push(layer);
      this.selected = layer;
      return layer;
    },
    select(layer) { this.selected = layer; },
    render() {},
    stepStill(delta) {
      if (!laneList.length) return false;
      const cur = this.selected || laneList[0];
      let idx = laneList.indexOf(cur);
      if (idx < 0) idx = 0;
      const next = laneList[(idx + (delta < 0 ? -1 : 1) + laneList.length) % laneList.length];
      this.selected = next;
      return true;
    },
  };
  const swaps = [];
  const sandbox = {
    console,
    performance: { now: () => now },
    setTimeout(fn, ms) {
      const id = timers.length + 1;
      timers.push({ id, fn, at: now + (ms || 0), cleared: false });
      return id;
    },
    clearTimeout(id) {
      const t = timers.find((x) => x.id === id);
      if (t) t.cleared = true;
    },
    localStorage: {
      getItem(k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
      setItem(k, v) { store[k] = String(v); },
    },
    CustomEvent: class {
      constructor(type, init) {
        this.type = type;
        this.detail = init && init.detail;
      }
    },
    dispatchEvent(ev) {
      events.push(ev);
      return true;
    },
    setStatus() {},
    SWR_IMAGE_LANE: lane,
    SWR_IMAGE_STYLES: {
      swap(layer, asset) {
        swaps.push([layer, asset]);
        if (layer) layer.asset = asset;
        return true;
      },
    },
    SWR_RENDER: { invalidate() {} },
    Library: {
      items: [
        { id: 'a1', type: 'image', name: 'dancer-a.png' },
        { id: 'a2', type: 'image', name: 'dancer-b.png' },
        { id: 'v1', type: 'video', name: 'clip.mp4' },
      ],
    },
  };
  Object.assign(sandbox, extra || {});
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.runInNewContext(SRC, sandbox, { filename: 'slideshow-script.client.js' });
  return {
    api: sandbox.SWR_SLIDESHOW,
    lane,
    swaps,
    events,
    store,
    tick(ms) {
      now += ms;
      for (const t of timers) {
        if (!t.cleared && t.at <= now && t.fn) {
          const fn = t.fn;
          t.cleared = true;
          fn();
        }
      }
    },
  };
}

console.log('slideshow-script: parse');
{
  const { api } = boot();
  check(!!api && typeof api.parse === 'function', 'SWR_SLIDESHOW.parse exposed');
  const cues = api.parse([
    '# comment',
    '0:02 | hello | 2',
    '0:05 | later',
    '3 | seconds form',
    'bare caption',
    '',
  ].join('\n'));
  check(cues.length === 4, 'parses four cues (skips blank + comment)');
  check(cues[0].durationMs === 2000 && cues[0].text === 'hello' && cues[0].still === '2',
    'clock cue + caption + still index');
  check(cues[1].durationMs === 3000 && cues[1].text === 'later',
    'absolute clock 0:05 dwells relative to previous clock (5000-2000)');
  check(cues[2].durationMs === 3000 && cues[2].text === 'seconds form',
    'values under 200 treated as seconds');
  check(cues[3].text === 'bare caption' && cues[3].durationMs === 3000,
    'bare caption uses default dwell');
}

console.log('slideshow-script: load / play / stop');
{
  const env = boot();
  const { api, lane, events } = env;
  lane.add({ id: 's1', type: 'image', name: 'one.png' });
  lane.add({ id: 's2', type: 'image', name: 'two.png' });
  const cues = api.load('800 | first\n900 | second | 2');
  check(cues.length === 2, 'load returns cues');
  check(env.store['swr.slideshowScript.v1'] && env.store['swr.slideshowScript.v1'].includes('first'),
    'persists script to localStorage');
  check(api.play() === true, 'play starts with stills present');
  let st = api.getState();
  check(st.playing && st.index === 0 && st.caption === 'first', 'first cue active');
  check(events.some((e) => e.type === 'swr:slideshow-play'), 'play event fired');
  check(events.some((e) => e.type === 'swr:slideshow-cue' && e.detail && e.detail.text === 'first'),
    'cue event for first caption');
  env.tick(850);
  st = api.getState();
  check(st.playing && st.index === 1 && st.caption === 'second', 'advances to second cue');
  check(lane.selected && lane.selected.asset && lane.selected.asset.id === 's2',
    'still token 2 selects second lane asset');
  api.stop();
  st = api.getState();
  check(!st.playing && st.caption === '', 'stop clears playing + caption');
  check(events.some((e) => e.type === 'swr:slideshow-stop'), 'stop event fired');
}

console.log('slideshow-script: refuse play without stills / without cues');
{
  const empty = boot({ Library: { items: [] }, SWR_LIB: { items: [] } });
  check(empty.api.play() === false, 'play refuses with empty script');
  empty.api.load('1000 | only text');
  check(empty.api.play() === false, 'play refuses when no stills exist');
}

console.log('slideshow-script: library stills when lane empty');
{
  const env = boot();
  // Empty lane → seed every library still, then focus the cue target.
  check(env.api.load('500 | hi | dancer-b') && env.api.play() === true,
    'play works from library stills when lane empty');
  check(env.lane.list.length === 2, 'play seeds all library stills into the lane');
  check(env.lane.selected && env.lane.selected.asset
    && env.lane.selected.asset.name === 'dancer-b.png',
    'first cue focuses the named still');
  check(env.lane.list.filter(function (l) { return !l.hidden; }).length === 1,
    'only the focused still is visible after seeding');
  env.api.stop();
}

console.log('slideshow-script: first cue shows a photo with empty still token');
{
  const env = boot();
  env.api.load('400 | open\n400 | next');
  check(env.api.play() === true, 'play with bare captions seeds lane');
  check(env.lane.list.length === 2, 'both library stills seeded');
  check(env.lane.selected === env.lane.list[0] && env.lane.list[0].hidden === false,
    'opening cue focuses the first still');
  env.tick(450);
  check(env.api.getState().index === 1 && env.lane.selected === env.lane.list[1],
    'second cue advances to the next still');
  env.api.stop();
}

console.log('slideshow-script: advanceStill + draw');
{
  const env = boot();
  env.lane.add({ id: 's1', type: 'image', name: 'one.png' });
  env.lane.add({ id: 's2', type: 'image', name: 'two.png' });
  env.lane.selected = env.lane.list[0];
  check(env.api.advanceStill(1) === true, 'advanceStill steps forward');
  check(env.lane.selected === env.lane.list[1], 'lane selection moved forward');
  check(env.lane.list[0].hidden === true && env.lane.list[1].hidden === false,
    'advanceStill hides non-focused opaque stills');
  check(env.api.prev() === true && env.lane.selected === env.lane.list[0], 'prev wraps/steps back');
  check(env.lane.list[0].hidden === false && env.lane.list[1].hidden === true,
    'prev focuses the previous still alone');

  const calls = [];
  const ctx = {
    canvas: { width: 1280, height: 720 },
    save() { calls.push('save'); },
    restore() { calls.push('restore'); },
    measureText() { return { width: 120 }; },
    fillRect() { calls.push('fillRect'); },
    fillText(t) { calls.push('fillText:' + t); },
  };
  env.api.load('1000 | NEON CAPTION');
  env.api.play();
  check(env.api.draw(ctx, 1280, 720) === true, 'draw paints when caption set');
  check(calls.includes('fillText:NEON CAPTION'), 'draw writes caption text');
  env.api.stop();
  check(env.api.draw(ctx, 1280, 720) === false, 'draw is a no-op without caption');
}

console.log('slideshow-script: load during play stops timer');
{
  const env = boot();
  env.lane.add({ id: 's1', type: 'image', name: 'one.png' });
  env.lane.add({ id: 's2', type: 'image', name: 'two.png' });
  env.api.load('5000 | first\n5000 | second');
  check(env.api.play() === true, 'long cues start playing');
  check(env.api.getState().playing === true, 'playing before reload');
  env.api.load('400 | replaced');
  const st = env.api.getState();
  check(st.playing === false, 'load stops playback');
  check(st.total === 1 && st.cues[0].text === 'replaced', 'load replaces cues');
  env.tick(6000);
  check(env.api.getState().playing === false && env.api.getState().index === -1,
    'stale timer does not advance after load');
}

console.log('slideshow-script: music drive / still speed');
{
  const env = boot({ A: { feat: { rms: 0, beat: 0, bass: 0 } } });
  check(env.api.getMusicDrive() === false, 'music drive defaults off');
  check(env.api.getMusicSpeed() === 1, 'music speed defaults to 1');
  check(env.api.effectiveDuration(4000) === 4000, 'drive off keeps authored dwell');

  check(env.api.setMusicDrive(true) === true, 'setMusicDrive on');
  check(env.api.getState().musicDrive === true, 'getState carries musicDrive');
  // rate = 1 * (0.45 + 0) = 0.45 → wait = 4000/0.45 ≈ 8889, clamped by MAX_MS
  const quiet = env.api.effectiveDuration(4000);
  check(quiet > 4000, 'quiet energy at speed 1 lengthens dwell (rate < 1)');

  env.api.setMusicSpeed(2);
  // rate = 2 * 0.45 = 0.9 → wait ≈ 4444
  const sped = env.api.effectiveDuration(4000);
  check(sped < quiet && sped > 4000, 'higher speed shortens quiet dwell vs speed 1');

  env.api.setMusicSpeed(3);
}
{
  const env = boot({ A: { feat: { rms: 1, beat: 0.8, bass: 0.9 } } });
  env.api.setMusicDrive(true);
  env.api.setMusicSpeed(3);
  // rate = 3 * (0.45 + 0.55*1) = 3 → wait = 4000/3 ≈ 1333
  const loud = env.api.effectiveDuration(4000);
  check(loud < 2000, 'loud energy + speed 3 shortens dwell below half');
  check(loud >= 200, 'dwell never drops below MIN_MS');

  const persisted = JSON.parse(env.store['swr.slideshowMusic.v1']);
  check(persisted.drive === true && persisted.speed === 3, 'music prefs persist to localStorage');
  check(env.events.some((e) => e.type === 'swr:slideshow-music'), 'music change fires event');

  check(env.api.setMusicSpeed(99) === 4, 'music speed clamps to MAX');
  check(env.api.setMusicSpeed(0) === 0.25, 'music speed clamps to MIN');
  check(env.api.setMusicDrive(false) === false, 'drive can toggle off');
  check(env.api.effectiveDuration(4000) === 4000, 'drive off ignores feat again');
}

console.log('slideshow-script: music prefs restore from localStorage');
{
  const env = boot({
    _storeSeed: {
      'swr.slideshowMusic.v1': JSON.stringify({ drive: true, speed: 2.5 }),
    },
  });
  check(env.api.getMusicDrive() === true, 'restoreMusic reads drive');
  check(env.api.getMusicSpeed() === 2.5, 'restoreMusic reads speed');
}

console.log('slideshow-script: music drive advances cues sooner while playing');
{
  const env = boot({ A: { feat: { rms: 1, beat: 1, bass: 1 } } });
  env.lane.add({ id: 's1', type: 'image', name: 'one.png' });
  env.lane.add({ id: 's2', type: 'image', name: 'two.png' });
  env.api.setMusicDrive(true);
  env.api.setMusicSpeed(2);
  // base 2000 → rate = 2 * (0.45+0.55*1) = 2 → wait 1000
  env.api.load('2000 | first\n2000 | second');
  check(env.api.play() === true, 'play with music drive');
  env.tick(900);
  check(env.api.getState().index === 0, 'still on first cue before shortened dwell');
  env.tick(200);
  check(env.api.getState().index === 1, 'advances after music-scaled dwell');
  env.api.stop();
}

console.log('slideshow-script: neon wiring');
{
  const neon = fs.readFileSync(path.join(ROOT, 'versions/neon.html'), 'utf8');
  check(neon.includes('slideshow-script.client.js'), 'neon.html loads slideshow-script');
  check(neon.includes('image-lane.client.js'), 'neon.html loads image-lane');
  check(neon.includes('image-lane-panel'), 'neon.html mounts stills lane UI');
  check(neon.includes('SWR_SLIDESHOW.draw'), 'neon render draws slideshow captions');
  check(/type === 'image'[\s\S]*SWR_IMAGE_LANE/.test(neon), 'neon Layers.add routes images to lane');

  const demo = fs.readFileSync(path.join(ROOT, 'client/neon-demo-panel.client.js'), 'utf8');
  check(demo.includes('Slideshow script'), 'demo panel exposes slideshow section');
  check(demo.includes('slideshow:play') && demo.includes('demo-slideshow-script'),
    'demo panel registers play + textarea');
  check(demo.includes('slideshow:musicDrive') && demo.includes('slideshow:musicSpeed'),
    'demo panel exposes music drive toggle + still speed slider');
  check(demo.includes('demo-slideshow-music-drive') && demo.includes('demo-slideshow-music-speed'),
    'demo panel mounts music drive DOM ids');

  const keys = fs.readFileSync(path.join(ROOT, 'engine-keys.client.js'), 'utf8');
  check(keys.includes('laneHasStills') && /ArrowLeft[\s\S]*imageLanePrevStill/.test(keys),
    'arrow keys step image-lane stills');
  check(/SWR_SLIDESHOW[\s\S]*advanceStill/.test(keys),
    'stepImageStill prefers slideshow advanceStill over lane.stepStill');
}

if (failures === 0) {
  console.log('\nALL GREEN (slideshow-script)');
  process.exit(0);
}
console.log('\n' + failures + ' FAILED (slideshow-script)');
process.exit(1);
