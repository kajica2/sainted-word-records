// lib/midi-feat.client.js — MIDI as a song source: Standard MIDI File parser +
// canonical feature synthesis, so a `.mid` drives the exact same 12-field feat
// shape that lib/media-feat.client.js extracts from an <audio>/<video> element.
//
// Why: the engine is "drop in a song". A MIDI file has no audio, so it could not
// be a song — the visuals had nothing to read. This module closes that by
// deriving the canonical feat timeline from note events, which is strictly
// better than audio for beat/onset: note-on times ARE the onsets (no flux
// guessing, no jitter), and the tempo map gives BPM exactly.
//
// Canonical feat shape (see lib/media-feat.client.js — do not diverge):
//   { bass, mid, treble, air, sub, rms, centroid, beat, onset,
//     beatPulse, onsetPulse, bpm }
// `beat` / `onset` are decaying envelopes (1 on hit, x0.7 per frame, matching
// media-feat's DECAY); `beatPulse` / `onsetPulse` are booleans true only on the
// frame the hit happens. When the transport is not playing the pulses are
// cleared and the envelopes are left alone — same as media-feat when the media
// element is paused.
//
// Public API (window.SWR_MIDI_FEAT):
//   parse(bytes)     -> { format, ppq, tracks, notes, tempoMap, durationSec, bpm }
//   analyze(source)  -> { bpm, key, scale, confidence, chromagram, onsets, duration }
//                      (shaped like AudioAnalysisV2.analyzeBuffer)
//   attach(source)   -> handle { feat, sample(ms), play(), pause(), seek(sec),
//                                duration, position, playing, detach(), parsed }
//
// Zero dependencies. Accepts ArrayBuffer | Uint8Array | parsed object.

(function () {
  'use strict';

  if (window.SWR_MIDI_FEAT && window.SWR_MIDI_FEAT.__loaded) return;

  var DECAY = 0.7;            // envelope decay per frame — media-feat parity
  var MINOR_KEELO = null;     // (reserved)

  // ---- byte helpers ----------------------------------------------------

  function toBytes(input) {
    if (!input) throw new Error('midi-feat: empty input');
    // Duck-typed, not instanceof: this module is loaded in browser realms,
    // vm sandboxes and workers, where the Uint8Array constructor is a
    // different object. A typed array has .buffer + numeric .length; a raw
    // ArrayBuffer has .byteLength and no .length.
    if (typeof input.byteLength !== 'number') {
      throw new Error('midi-feat: expected ArrayBuffer | Uint8Array');
    }
    if (typeof input.length === 'number') {
      return new Uint8Array(input.buffer, input.byteOffset || 0, input.byteLength);
    }
    return new Uint8Array(input);
  }

  function ascii(b, off, len) {
    var s = '';
    for (var i = 0; i < len; i++) s += String.fromCharCode(b[off + i]);
    return s;
  }

  function u16(b, o) { return (b[o] << 8) | b[o + 1]; }

  function u32(b, o) {
    return ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
  }

  // MIDI variable-length quantity. Returns [value, nextOffset].
  function varint(b, o) {
    var v = 0;
    for (var i = 0; i < 4; i++) {
      var byte = b[o + i];
      if (byte === undefined) throw new Error('midi-feat: truncated variable-length value');
      v = (v << 7) | (byte & 0x7f);
      if (!(byte & 0x80)) return [v, o + i + 1];
    }
    throw new Error('midi-feat: variable-length value longer than 4 bytes');
  }

  // ---- parsing ---------------------------------------------------------

  // data byte counts for channel messages, indexed by high nibble (8..E)
  var CHANNEL_DATA = [2, 2, 2, 2, 1, 1, 2]; // 8x 9x Ax Bx Cx Dx Ex

  function parse(input) {
    var b = toBytes(input);
    if (b.length < 14) throw new Error('midi-feat: too short to be a MIDI file');
    if (ascii(b, 0, 4) !== 'MThd') throw new Error('midi-feat: missing MThd header (not a Standard MIDI File)');

    var headerLen = u32(b, 4);
    var format = u16(b, 8);
    var ntrks = u16(b, 10);
    var division = u16(b, 12);
    if (division & 0x8000) throw new Error('midi-feat: SMPTE time division is not supported');
    var ppq = division || 480;

    var off = 8 + headerLen;
    var notes = [];
    var tempoMap = [];
    var endTick = 0;
    var tracksRead = 0;

    while (off + 8 <= b.length && tracksRead < ntrks) {
      var chunkType = ascii(b, off, 4);
      var chunkLen = u32(b, off + 4);
      var p = off + 8;
      var chunkEnd = Math.min(p + chunkLen, b.length);
      if (chunkType !== 'MTrk') { off = chunkEnd; continue; } // skip unknown chunks
      tracksRead++;

      var tick = 0;
      var running = 0;      // running status byte (0 = none)
      var open = {};        // "ch:note" -> array of {tick, vel}

      while (p < chunkEnd) {
        var d = varint(b, p); tick += d[0]; p = d[1];
        if (p >= chunkEnd) break;

        var status = b[p];
        if (status & 0x80) {
          p++;
          if (status < 0xf0) running = status;         // channel message: set running status
          else if (status !== 0xf7 && status !== 0xf0) running = 0; // meta/sysEx cancels it
        } else if (running) {
          status = running;                            // data byte: reuse running status
        } else {
          throw new Error('midi-feat: data byte with no running status at offset ' + p);
        }

        if (status === 0xff) {                         // meta
          var metaType = b[p++];
          var md = varint(b, p); var metaLen = md[0]; p = md[1];
          if (metaType === 0x51 && metaLen === 3) {
            tempoMap.push({ tick: tick, us: (b[p] << 16) | (b[p + 1] << 8) | b[p + 2] });
          }
          p += metaLen;
          if (metaType === 0x2f) break;                // end of track
          continue;
        }

        if (status === 0xf0 || status === 0xf7) {      // sysex: length-prefixed
          var sd = varint(b, p); p = sd[1] + sd[0];
          continue;
        }

        var hi = status & 0xf0;
        var ch = status & 0x0f;
        var n = CHANNEL_DATA[hi - 0x80] || 2;
        var d1 = b[p]; var d2 = n > 1 ? b[p + 1] : 0;
        p += n;

        if (hi === 0x90 && d2 > 0) {                   // note on
          var key = ch + ':' + d1;
          (open[key] || (open[key] = [])).push({ tick: tick, vel: d2 });
        } else if (hi === 0x80 || (hi === 0x90 && d2 === 0)) { // note off (incl. vel-0 note-on)
          var k2 = ch + ':' + d1;
          var stack = open[k2];
          if (stack && stack.length) {
            var on = stack.pop();
            notes.push({ tick: on.tick, durTicks: Math.max(1, tick - on.tick), ch: ch, note: d1, vel: on.vel });
          }
        }
      }

      if (tick > endTick) endTick = tick;
      off = chunkEnd;
    }

    // dangling note-ons (missing note-off) close at end of track
    for (var kk in open) {
      if (!Object.prototype.hasOwnProperty.call(open, kk)) continue;
      var st = open[kk];
      for (var i = 0; i < st.length; i++) {
        var parts = kk.split(':');
        notes.push({ tick: st[i].tick, durTicks: Math.max(1, endTick - st[i].tick), ch: +parts[0], note: +parts[1], vel: st[i].vel });
      }
    }

    notes.sort(function (a, b2) { return a.tick - b2.tick; });

    if (!tempoMap.length) tempoMap.push({ tick: 0, us: 500000 });
    tempoMap.sort(function (a, b2) { return a.tick - b2.tick; });

    // collapse duplicate ticks (last write wins, as sequencers do)
    var tm = [tempoMap[0]];
    for (var t = 1; t < tempoMap.length; t++) {
      if (tempoMap[t].tick === tm[tm.length - 1].tick) tm[tm.length - 1] = tempoMap[t];
      else tm.push(tempoMap[t]);
    }
    tempoMap = tm;

    function tickToSec(target) {
      var sec = 0, lastTick = 0, us = tempoMap[0].us;
      for (var i = 1; i < tempoMap.length; i++) {
        if (tempoMap[i].tick >= target) break;
        sec += (tempoMap[i].tick - lastTick) * us / 1e6 / ppq;
        lastTick = tempoMap[i].tick;
        us = tempoMap[i].us;
      }
      sec += (target - lastTick) * us / 1e6 / ppq;
      return sec;
    }

    var durationSec = 0;
    for (var ni = 0; ni < notes.length; ni++) {
      var end = tickToSec(notes[ni].tick + notes[ni].durTicks);
      if (end > durationSec) durationSec = end;
    }
    if (endTick) durationSec = Math.max(durationSec, tickToSec(endTick));

    var bpm = Math.round(6e7 / tempoMap[tempoMap.length - 1].us);

    return {
      format: format,
      ppq: ppq,
      tracks: tracksRead,
      notes: notes,
      tempoMap: tempoMap,
      durationSec: durationSec,
      bpm: bpm,
      tickToSec: tickToSec
    };
  }

  // ---- analysis (AudioAnalysisV2-shaped) -------------------------------

  // Krumhansl-Schmuckler key profiles — same family as audio-analysis-v2.js so
  // a MIDI-derived key is comparable with an audio-derived one.
  var MAJOR_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
  var MINOR_PROFILE = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
  var PITCH_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

  function correlate(a, b) {
    var n = a.length, ma = 0, mb = 0, i;
    for (i = 0; i < n; i++) { ma += a[i]; mb += b[i]; }
    ma /= n; mb /= n;
    var num = 0, da = 0, db = 0;
    for (i = 0; i < n; i++) {
      var xa = a[i] - ma, xb = b[i] - mb;
      num += xa * xb; da += xa * xa; db += xb * xb;
    }
    var den = Math.sqrt(da * db);
    return den > 0 ? num / den : 0;
  }

  function analyze(source) {
    var p = (source && source.notes) ? source : parse(source);
    var notes = p.notes;

    var chroma = new Float32Array(12);
    var total = 0;
    for (var i = 0; i < notes.length; i++) {
      var w = notes[i].vel * notes[i].durTicks;
      chroma[notes[i].note % 12] += w;
      total += w;
    }
    if (total > 0) for (var c = 0; c < 12; c++) chroma[c] /= total;

    // key via best rotation of both profiles against the chromagram
    var bestKey = 'C', bestScale = 'major', bestScore = -2;
    for (var root = 0; root < 12; root++) {
      var rot = new Array(12);
      for (var j = 0; j < 12; j++) rot[j] = chroma[(root + j) % 12];
      var maj = correlate(rot, MAJOR_PROFILE);
      var min = correlate(rot, MINOR_PROFILE);
      if (maj > bestScore) { bestScore = maj; bestKey = PITCH_NAMES[root]; bestScale = 'major'; }
      if (min > bestScore) { bestScore = min; bestKey = PITCH_NAMES[root]; bestScale = 'minor'; }
    }

    // onsets = unique note-on times, in seconds
    var seen = {}, onsets = [];
    for (var k = 0; k < notes.length; k++) {
      var s = p.tickToSec(notes[k].tick);
      var slot = Math.round(s * 1000);
      if (seen[slot]) continue;
      seen[slot] = 1;
      onsets.push(s);
    }
    onsets.sort(function (a, b) { return a - b; });

    return {
      bpm: p.bpm,
      key: notes.length ? bestKey : 'C',
      scale: notes.length ? bestScale : 'major',
      confidence: Math.max(0, bestScore),
      chromagram: chroma,
      onsets: onsets,
      duration: p.durationSec
    };
  }

  // ---- transport + per-frame feat --------------------------------------

  function attach(source) {
    var p = (source && source.notes) ? source : parse(source);
    var notes = p.notes;

    // precompute note windows in seconds so sample() is a cheap scan
    var windows = new Array(notes.length);
    for (var i = 0; i < notes.length; i++) {
      windows[i] = {
        t0: p.tickToSec(notes[i].tick),
        t1: p.tickToSec(notes[i].tick + notes[i].durTicks),
        note: notes[i].note,
        vel: notes[i].vel / 127
      };
    }

    var feat = {
      bass: 0, mid: 0, treble: 0, air: 0, sub: 0, rms: 0, centroid: 0,
      beat: 0, onset: 0, beatPulse: false, onsetPulse: false,
      bpm: p.bpm || 0
    };

    var pos = 0;             // transport position, seconds
    var playing = false;
    var startedAt = 0;       // wall clock of play()
    var lastBeatIdx = -1;
    var onsetCursor = 0;     // index of the next unreported note-on

    // Rewind/advance the onset cursor to the first note-on at or after `sec`,
    // so a note sitting exactly on the transport position fires once.
    function rearmOnsets(sec) {
      var i = 0;
      while (i < windows.length && windows[i].t0 < sec - 1e-9) i++;
      onsetCursor = i;
    }

    function sample(nowMs) {
      if (playing) {
        var now = (typeof nowMs === 'number') ? nowMs : Date.now();
        pos = (now - startedAt) / 1000;
        if (pos > p.durationSec) { pos = p.durationSec; playing = false; }
      }

      // media-feat parity: a paused source clears the pulses and freezes the
      // envelopes instead of decaying them.
      if (!playing) {
        feat.beatPulse = false;
        feat.onsetPulse = false;
        return feat;
      }

      var sub = 0, bass = 0, mid = 0, treble = 0, air = 0;
      var mass = 0, pitchSum = 0, count = 0;

      for (var i = 0; i < windows.length; i++) {
        var w = windows[i];
        if (w.t0 > pos) break;              // windows are onset-sorted
        if (w.t1 <= pos) continue;          // already ended
        var v = w.vel;
        mass += v;
        pitchSum += w.note;
        count++;
        if (w.note < 36) sub += v;
        else if (w.note < 60) bass += v;
        else if (w.note < 84) mid += v;
        else if (w.note < 108) treble += v;
        else air += v;
      }

      feat.sub = Math.min(1, sub);
      feat.bass = Math.min(1, bass);
      feat.mid = Math.min(1, mid);
      feat.treble = Math.min(1, treble);
      feat.air = Math.min(1, air);
      feat.rms = Math.min(1, mass / 4);      // ~4 concurrent notes = full scale
      feat.centroid = count ? Math.max(0, Math.min(1, (pitchSum / count - 21) / 87)) : 0;

      // beat grid straight off the tempo map — no estimation needed
      var bpm = feat.bpm || 120;
      var beatIdx = Math.floor(pos * bpm / 60);
      if (beatIdx !== lastBeatIdx) {
        lastBeatIdx = beatIdx;
        feat.beat = 1;
        feat.beatPulse = true;
      } else {
        feat.beat = feat.beat * DECAY;
        feat.beatPulse = false;
      }

      // onsets = note-ons crossed since the last frame (exact, no estimation)
      var hit = false;
      while (onsetCursor < windows.length && windows[onsetCursor].t0 <= pos + 1e-9) {
        hit = true;
        onsetCursor++;
      }
      if (hit) {
        feat.onset = 1;
        feat.onsetPulse = true;
      } else {
        feat.onset = feat.onset * DECAY;
        feat.onsetPulse = false;
      }

      return feat;
    }

    return {
      feat: feat,
      parsed: p,
      sample: sample,
      play: function (nowMs) {
        if (playing) return;
        playing = true;
        var clock = (typeof nowMs === 'number') ? nowMs : Date.now();
        startedAt = clock - pos * 1000;
        rearmOnsets(pos);
      },
      pause: function () {
        playing = false;
        feat.beatPulse = false;
        feat.onsetPulse = false;
      },
      seek: function (sec, nowMs) {
        pos = Math.max(0, Math.min(p.durationSec, sec || 0));
        var clock = (typeof nowMs === 'number') ? nowMs : Date.now();
        startedAt = clock - pos * 1000;
        rearmOnsets(pos);
        lastBeatIdx = Math.floor(pos * (feat.bpm || 120) / 60);
      },
      detach: function () { playing = false; windows = []; notes = []; },
      get duration() { return p.durationSec; },
      get position() { return pos; },
      get playing() { return playing; }
    };
  }

  window.SWR_MIDI_FEAT = {
    __loaded: true,
    parse: parse,
    analyze: analyze,
    attach: attach
  };
})();
