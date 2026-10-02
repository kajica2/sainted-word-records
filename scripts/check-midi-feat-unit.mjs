// scripts/check-midi-feat-unit.mjs — SMF parsing + canonical feat synthesis.
//
// Contract coverage for lib/midi-feat.client.js, the module that lets a `.mid`
// be a song: it must produce the SAME 12-field feat shape that
// lib/media-feat.client.js reads off an <audio> element, or every variant that
// consumes `Audio.feat` sees zeros. The behavioural details that matter and are
// asserted here:
//   - `beat` / `onset` are decaying envelopes (1 on hit, x0.7 per frame) and
//     `beatPulse` / `onsetPulse` are booleans on the hit frame — media-feat
//     parity, since engine-core renders `feat.beat` straight into opacity.
//   - A paused transport clears the pulses but does NOT decay the envelopes
//     (media-feat returns early the same way when the element is paused).
//   - `beat` comes off the tempo map (exact), `onset` off note-on times
//     (exact) — no estimation, so these must not jitter.
//
// Everything is deterministic: synthetic SMF bytes are built in-process and the
// transport clock is injected (`play(0)`, `sample(ms)`), never Date.now().
// Negative controls matter as much as the positives: a corrupt file must throw
// a clear error instead of silently yielding an empty feat object that renders
// a black composition.
//
// Run: node scripts/check-midi-feat-unit.mjs

import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// lib/midi-feat.client.js is a browser global-script (it assigns window.*), so
// load it with a window shim rather than importing it as a module.
const SRC = readFileSync(new URL('../lib/midi-feat.client.js', import.meta.url), 'utf8');
const sandbox = { window: {}, console };
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(SRC, sandbox);
const MIDI = sandbox.window.SWR_MIDI_FEAT;

if (!MIDI || typeof MIDI.parse !== 'function') {
  console.error('MIDI-FEAT UNIT: SWR_MIDI_FEAT.parse not exposed by lib/midi-feat.client.js');
  process.exit(1);
}

// ---- synthetic SMF construction ----------------------------------------

function varint(n) {
  const out = [n & 0x7f];
  let v = n >>> 7;
  while (v > 0) { out.unshift((v & 0x7f) | 0x80); v >>>= 7; }
  return out;
}
const u16 = (n) => [(n >> 8) & 0xff, n & 0xff];
const u32 = (n) => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];

function chunk(type, data) {
  return [...type.split('').map((c) => c.charCodeAt(0)), ...u32(data.length), ...data];
}

// events: [{ d: deltaTicks, bytes: [...] }]
function track(events) {
  const body = [];
  for (const e of events) body.push(...varint(e.d), ...e.bytes);
  body.push(...varint(0), 0xff, 0x2f, 0x00); // end of track
  return chunk('MTrk', body);
}

function smf(ppq, tracks, { format = 1, divisionOverride = null } = {}) {
  const header = chunk('MThd', [...u16(format), ...u16(tracks.length), ...u16(divisionOverride ?? ppq)]);
  return Uint8Array.from([...header, ...tracks.flatMap((t) => [...t])]);
}

const noteOn = (d, ch, note, vel) => ({ d, bytes: [0x90 | ch, note, vel] });
const noteOff = (d, ch, note, vel = 0) => ({ d, bytes: [0x80 | ch, note, vel] });
const meta = (d, type, data) => ({ d, bytes: [0xff, type, ...varint(data.length), ...data] });
const TEMPO_120 = [0x07, 0xa1, 0x20]; // 500000 us/quarter

// A C-major scale over 4s at 120 BPM (ppq 480), plus one off-beat note so
// `onset` and `beat` are forced to disagree and both stay testable.
const CONDUCTOR = track([
  meta(0, 0x51, TEMPO_120),
  meta(0, 0x58, [0x04, 0x02, 0x18, 0x08]),
]);
const SCALE = [60, 62, 64, 65, 67, 69, 71, 72];
// C-major scale, one quarter note each (480 ticks), plus an off-beat G4 inside
// the first beat so `onset` and `beat` are forced to disagree. Explicit
// note-offs keep every duration exact:
//   t=0 C4 on | t=240 G4 on | t=480 C4/G4 off + D4 on | ... | t=3840 C5 off
const MELODY = track((() => {
  const ev = [noteOn(0, 0, 60, 100), noteOn(240, 0, 67, 60)];
  ev.push(noteOff(240, 0, 60), noteOff(0, 0, 67));
  SCALE.slice(1).forEach((n, i) => {
    ev.push(noteOn(0, 0, n, 95 - i * 5));
    ev.push(noteOff(480, 0, n));
  });
  return ev;
})());

const FIXTURE = smf(480, [CONDUCTOR, MELODY]);

// ---- tiny assert harness -----------------------------------------------

let pass = 0, fail = 0;
function check(name, ok, detail = '') {
  if (ok) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); }
}
const close = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

// ---- parse --------------------------------------------------------------
console.log('MIDI-FEAT UNIT: parse');

const parsed = MIDI.parse(FIXTURE);
check('reads header (format 1, ppq 480)', parsed.format === 1 && parsed.ppq === 480,
  `format=${parsed.format} ppq=${parsed.ppq}`);
check('parses every note-on', parsed.notes.length === 9, `notes=${parsed.notes.length}`);
check('note ticks are exact', parsed.notes[0].tick === 0 && parsed.notes[1].tick === 240,
  `t0=${parsed.notes[0].tick} t1=${parsed.notes[1]?.tick}`);
check('note durations survive pairing', parsed.notes[0].durTicks === 480,
  `dur=${parsed.notes[0].durTicks}`);
check('velocity preserved', parsed.notes[0].vel === 100, `vel=${parsed.notes[0].vel}`);
check('tempo map defaults to 120 BPM', parsed.tempoMap.length === 1 && parsed.tempoMap[0].us === 500000,
  JSON.stringify(parsed.tempoMap));
check('bpm read from tempo map', parsed.bpm === 120, `bpm=${parsed.bpm}`);
check('duration is 4.0s', close(parsed.durationSec, 4.0, 1e-6), `dur=${parsed.durationSec}`);

// Running status must parse identically (many sequencers emit it).
const RUNNING = track([
  { d: 0, bytes: [0x90, 60, 100] },
  { d: 240, bytes: [67, 60] },        // running status note-on
  { d: 0, bytes: [62, 95] },          // running status, same delta
  { d: 480, bytes: [0x80, 60, 0] },
]);
const runningParsed = MIDI.parse(smf(480, [CONDUCTOR, RUNNING]));
check('running status resolves to note-on', runningParsed.notes.length >= 2,
  `notes=${runningParsed.notes.length}`);
check('running-status note carries its pitch', runningParsed.notes.some((n) => n.note === 62));

// A vel-0 note-on is a note-off (per the SMF spec), never a zero-velocity note.
const VELZERO = track([
  { d: 0, bytes: [0x90, 60, 100] },
  { d: 480, bytes: [0x90, 60, 0] },   // = note off
]);
const velParsed = MIDI.parse(smf(480, [CONDUCTOR, VELZERO]));
check('vel-0 note-on closes the note', velParsed.notes.length === 1, `notes=${velParsed.notes.length}`);
check('closed note keeps the on velocity', velParsed.notes[0].vel === 100 && velParsed.notes[0].durTicks === 480,
  JSON.stringify(velParsed.notes[0]));

const EMPTY = MIDI.parse(smf(480, [track([])]));
check('empty track parses to zero notes', EMPTY.notes.length === 0 && EMPTY.durationSec === 0);

// ---- analyze ------------------------------------------------------------
console.log('MIDI-FEAT UNIT: analyze');

const an = MIDI.analyze(FIXTURE);
check('bpm is exact, not estimated', an.bpm === 120, `bpm=${an.bpm}`);
check('onsets = note-on times', an.onsets.length === 9, `onsets=${an.onsets.length}`);
check('onsets are in seconds', close(an.onsets[1], 0.25, 1e-6), `onsets[1]=${an.onsets[1]}`);
check('chromagram is normalized', close([...an.chromagram].reduce((s, v) => s + v, 0), 1, 1e-6));
check('chromagram peaks on the tonic', an.chromagram[0] === Math.max(...an.chromagram),
  `C=${an.chromagram[0].toFixed(3)} max=${Math.max(...an.chromagram).toFixed(3)}`);
check('key is C major for a C-major scale', an.key === 'C' && an.scale === 'major',
  `key=${an.key} ${an.scale}`);
check('confidence is a correlation', an.confidence > 0, `conf=${an.confidence}`);
check('duration matches parse', close(an.duration, 4.0, 1e-6), `dur=${an.duration}`);

// ---- attach / feat ------------------------------------------------------
console.log('MIDI-FEAT UNIT: attach + feat');

const FEAT_KEYS = ['bass', 'mid', 'treble', 'air', 'sub', 'rms', 'centroid', 'beat', 'onset', 'beatPulse', 'onsetPulse', 'bpm'];
const h = MIDI.attach(FIXTURE);
check('handle exposes all 12 feat fields', FEAT_KEYS.every((k) => k in h.feat),
  `have=${Object.keys(h.feat).join(',')}`);
check('feat.bpm seeded from the tempo map', h.feat.bpm === 120, `bpm=${h.feat.bpm}`);
check('duration exposed on the handle', close(h.duration, 4.0, 1e-6), `dur=${h.duration}`);

// t=0: a note-on and a beat land together.
h.play(0);
const f0 = h.sample(0);
check('t=0 fires the onset pulse', f0.onsetPulse === true);
check('t=0 fires the beat pulse', f0.beatPulse === true);
check('t=0 has energy', f0.rms > 0 && f0.centroid > 0, `rms=${f0.rms} centroid=${f0.centroid}`);
check('C4 lands in the mid band', f0.mid > 0 && f0.bass === 0, `mid=${f0.mid} bass=${f0.bass}`);

// 250ms: the off-beat note-on — an onset that is NOT a beat.
const f250 = h.sample(250);
check('off-beat note-on fires onset without a beat', f250.onsetPulse === true && f250.beatPulse === false,
  `onset=${f250.onsetPulse} beat=${f250.beatPulse}`);

// 510ms: the next beat (0.5s @ 120 BPM).
const f510 = h.sample(510);
check('beat grid fires at 0.5s', f510.beatPulse === true, `beat=${f510.beatPulse}`);
check('beat envelope resets to 1 on the hit', f510.beat === 1, `beat=${f510.beat}`);

// 600ms: no note-on in (0.51, 0.6] and beat 1 already fired -> both decay.
const f600 = h.sample(600);
check('off-hit frames decay the envelopes', f600.beat < 1 && f600.onset < 1,
  `beat=${f600.beat} onset=${f600.onset}`);
check('decay matches media-feat (x0.7)', close(f600.beat, 0.7, 1e-6), `beat=${f600.beat}`);
check('off-hit frames clear both pulses', f600.beatPulse === false && f600.onsetPulse === false);

// Paused parity: pulses clear, envelopes freeze (media-feat returns early too).
const before = h.feat.beat;
h.pause();
const fp = h.sample(700);
check('paused clears the pulses', fp.beatPulse === false && fp.onsetPulse === false);
check('paused freezes the envelopes', fp.beat === before, `beat=${fp.beat} was=${before}`);
check('position stops advancing while paused', close(h.position, 0.6, 1e-6), `pos=${h.position}`);

// Seek: landing between note-ons must not invent an onset, landing exactly on
// one must fire it (the cursor is armed at the seek position).
h.seek(2.2, 0);      // next note-on is at 2.5s
h.play(0);
const fs = h.sample(16); // pos = 2.216
check('seek past a note-on does not re-fire it', fs.onsetPulse === false,
  `pos=${h.position.toFixed(3)} onset=${fs.onsetPulse}`);
check('beat index re-anchors on seek', fs.beatPulse === false || fs.beat === 1,
  `beat=${fs.beat}`);

h.seek(2.0, 0);      // a note-on sits exactly on 2.0s
h.play(0);
const fAt = h.sample(16); // pos = 2.016
check('seek onto a note-on fires it once', fAt.onsetPulse === true,
  `pos=${h.position.toFixed(3)} onset=${fAt.onsetPulse}`);
check('the same note-on does not fire twice', h.sample(32).onsetPulse === false,
  `pos=${h.position.toFixed(3)}`);

h.detach();
check('detach leaves a usable (frozen) feat object', typeof h.feat.bpm === 'number');

// ---- negative controls --------------------------------------------------
console.log('MIDI-FEAT UNIT: negative controls');

function throws(fn, needle) {
  try { fn(); return false; }
  catch (e) { return String(e.message).includes(needle); }
}
check('garbage bytes throw (missing MThd)', throws(() => MIDI.parse(Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14])), 'MThd'));
check('SMPTE division is rejected clearly', throws(() => MIDI.parse(smf(480, [CONDUCTOR], { divisionOverride: 0xe728 })), 'SMPTE'));
check('truncated varint throws', throws(() => MIDI.parse(Uint8Array.from([...[77, 84, 104, 100], ...u32(6), ...u16(0), ...u16(1), ...u16(480), 77, 84, 114, 107, ...u32(4), ...varint(0), 0xff])), 'variable-length'));
check('empty input throws', throws(() => MIDI.parse(null), 'empty'));
check('zero-length buffer throws', throws(() => MIDI.parse(new Uint8Array(0)), 'too short'));

// ---- summary ------------------------------------------------------------
console.log(`MIDI-FEAT UNIT: passed ${pass}, failed ${fail}`);
if (fail > 0) process.exit(1);
