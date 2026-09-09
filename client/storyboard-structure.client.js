// client/storyboard-structure.client.js — Scene Identification.
//
// Pure function: take a SongProfile and emit a Scene[] with stable IDs,
// emotional tags, and a suggested cut-rate per scene. Reused by the
// transitions planner and the shots picker downstream.
//
// Public API on window.SWR_STRUCTURE:
//
//   SWR_STRUCTURE.segment(profile, opts?) -> Scene[]
//     profile: SongProfile from SWR_SONG.analyze()
//     opts: {
//       minSceneSec?: number = 4,
//       maxSceneSec?: number = 32,
//       phraseBars?: number = 4,
//     }
//
// Scene shape:
//   {
//     id: 'sc-001',                      // stable, zero-padded
//     kind: 'intro'|'verse'|'pre-chorus'|'chorus'|'bridge'|'breakdown'|'drop'|'outro',
//     startBar: number, endBar: number,
//     startSec: number, endSec: number,
//     energy: 0..1,
//     tags: {
//       mood: 'dark'|'warm'|'bright'|'tense'|'euphoric',
//       motion: 'low'|'med'|'high',     // from spectral centroid avg
//       palette: undefined | string,    // populated by the shots picker
//     },
//     suggestedCutEvery: 'bar'|'2bar'|'phrase'|'chorus',
//   }

(function () {
  'use strict';
  if (window.SWR_STRUCTURE) return;

  function pad(n, width) {
    const s = String(n);
    return s.length >= width ? s : '0'.repeat(width - s.length) + s;
  }

  // Average mood label across the moodArc samples inside [startSec, endSec].
  function averageMood(moodArc, startSec, endSec) {
    let dark = 0, warm = 0, bright = 0, tense = 0, euphoric = 0;
    let n = 0;
    for (const m of moodArc) {
      if (m.sec < startSec || m.sec > endSec) continue;
      n++;
      if (m.mood === 'dark') dark++;
      else if (m.mood === 'warm') warm++;
      else if (m.mood === 'bright') bright++;
      else if (m.mood === 'tense') tense++;
      else if (m.mood === 'euphoric') euphoric++;
    }
    if (n === 0) return 'warm';
    const counts = [
      ['dark', dark], ['warm', warm], ['bright', bright],
      ['tense', tense], ['euphoric', euphoric],
    ].sort((a, b) => b[1] - a[1]);
    return counts[0][1] > 0 ? counts[0][0] : 'warm';
  }

  // Average motion label from the centroid curve.
  function averageMotion(centroid, sr, hopSec, startSec, endSec) {
    if (!centroid || centroid.length === 0) return 'med';
    const startFrame = Math.max(0, Math.floor(startSec / hopSec));
    const endFrame = Math.min(centroid.length, Math.ceil(endSec / hopSec));
    if (endFrame <= startFrame) return 'med';
    let sum = 0;
    for (let i = startFrame; i < endFrame; i++) sum += centroid[i];
    const avg = sum / (endFrame - startFrame);
    // Heuristic: <500Hz = low, 500-2000Hz = med, >2000Hz = high.
    if (avg < 500) return 'low';
    if (avg < 2000) return 'med';
    return 'high';
  }

  // Pick a cut-rate from the scene kind + bpm.
  function pickCutEvery(kind, bpm) {
    switch (kind) {
      case 'chorus':
      case 'drop':
        return 'bar';
      case 'verse':
      case 'pre-chorus':
        return bpm >= 140 ? 'bar' : bpm <= 80 ? 'phrase' : '2bar';
      case 'bridge':
      case 'breakdown':
        return 'phrase';
      case 'intro':
      case 'outro':
        return 'phrase';
      default:
        return '2bar';
    }
  }

  // Split a section longer than maxSceneSec into pieces at local loudness
  // troughs. Returns an array of [startSec, endSec] pairs.
  function splitOnTroughs(section, profile, maxSceneSec) {
    const { loudness, centroid } = profile;
    if (!loudness || loudness.length === 0) return [[section.startSec, section.endSec]];
    const hopSec = 0.1; // matches loudnessAndCentroid default
    const dur = section.endSec - section.startSec;
    if (dur <= maxSceneSec) return [[section.startSec, section.endSec]];

    const startFrame = Math.floor(section.startSec / hopSec);
    const endFrame = Math.ceil(section.endSec / hopSec);
    const slice = Array.from(loudness.slice(startFrame, endFrame));
    const pieces = [];
    const pieceLenSec = maxSceneSec;
    let cursor = section.startSec;
    while (cursor < section.endSec) {
      const pieceEnd = Math.min(section.endSec, cursor + pieceLenSec);
      // Find the trough (minimum) in [cursor+pieceLenSec*0.3, cursor+pieceLenSec*0.9]
      const troughStartFrame = Math.floor((cursor + pieceLenSec * 0.3) / hopSec);
      const troughEndFrame = Math.min(slice.length, Math.ceil((cursor + pieceLenSec * 0.9) / hopSec));
      let minIdx = troughStartFrame;
      let minVal = Infinity;
      for (let i = troughStartFrame; i < troughEndFrame; i++) {
        if (slice[i] < minVal) { minVal = slice[i]; minIdx = i; }
      }
      const troughSec = (minIdx * hopSec) + section.startSec;
      const splitAt = troughSec > cursor + 1 && troughSec < pieceEnd - 1 ? troughSec : pieceEnd;
      pieces.push([cursor, splitAt]);
      cursor = splitAt;
    }
    return pieces;
  }

  // Merge scenes shorter than minSceneSec into a neighbor of the same kind.
  // If no same-kind neighbor, extend the previous scene.
  function mergeShortScenes(scenes, minSceneSec) {
    if (scenes.length === 0) return scenes;
    let i = 0;
    while (i < scenes.length) {
      const dur = scenes[i].endSec - scenes[i].startSec;
      if (dur < minSceneSec && scenes.length > 1) {
        if (i + 1 < scenes.length && scenes[i + 1].kind === scenes[i].kind) {
          // Merge with next
          scenes[i].endSec = scenes[i + 1].endSec;
          scenes[i].endBar = scenes[i + 1].endBar;
          scenes.splice(i + 1, 1);
        } else if (i > 0) {
          // Extend previous
          scenes[i - 1].endSec = scenes[i].endSec;
          scenes[i - 1].endBar = scenes[i].endBar;
          scenes.splice(i, 1);
          i--;
        } else {
          i++;
        }
      } else {
        i++;
      }
    }
    return scenes;
  }

  function segment(profile, opts) {
    opts = opts || {};
    const minSceneSec = opts.minSceneSec != null ? opts.minSceneSec : 4;
    const maxSceneSec = opts.maxSceneSec != null ? opts.maxSceneSec : 32;

    if (!profile || !Array.isArray(profile.sections) || profile.sections.length === 0) {
      // Fall back to single-scene storyboard
      return [{
        id: 'sc-001',
        kind: 'verse',
        startBar: 0,
        endBar: profile ? profile.bars.length - 1 : 0,
        startSec: 0,
        endSec: profile ? profile.duration : 0,
        energy: 0.5,
        tags: { mood: 'warm', motion: 'med', palette: undefined },
        suggestedCutEvery: pickCutEvery('verse', profile ? profile.bpm : 120),
      }];
    }

    // 1. Split any section longer than maxSceneSec.
    const expanded = [];
    for (const sec of profile.sections) {
      const pieces = splitOnTroughs(sec, profile, maxSceneSec);
      for (const [s, e] of pieces) {
        expanded.push({
          ...sec,
          startSec: s,
          endSec: e,
          startBar: barIndexAt(profile.bars, s),
          endBar: barIndexAt(profile.bars, e),
        });
      }
    }

    // 2. Assign IDs.
    const scenes = expanded.map((sec, idx) => ({
      id: 'sc-' + pad(idx + 1, 3),
      kind: sec.kind,
      startBar: sec.startBar,
      endBar: sec.endBar,
      startSec: sec.startSec,
      endSec: sec.endSec,
      energy: sec.energy,
      tags: {
        mood: averageMood(profile.moodArc || [], sec.startSec, sec.endSec),
        motion: averageMotion(profile.centroid, profile.sampleRate || 44100, 0.1, sec.startSec, sec.endSec),
        palette: undefined,
      },
      suggestedCutEvery: pickCutEvery(sec.kind, profile.bpm),
    }));

    // 3. Merge short scenes.
    mergeShortScenes(scenes, minSceneSec);

    // 4. Re-assign IDs after merges.
    scenes.forEach((s, i) => { s.id = 'sc-' + pad(i + 1, 3); });

    return scenes;
  }

  function barIndexAt(bars, sec) {
    if (!bars || bars.length === 0) return 0;
    for (let i = 0; i < bars.length; i++) {
      if (bars[i].startSec > sec) return Math.max(0, i - 1);
    }
    return bars.length - 1;
  }

  window.SWR_STRUCTURE = {
    segment,
    _internals: {
      averageMood,
      averageMotion,
      pickCutEvery,
      splitOnTroughs,
      mergeShortScenes,
      barIndexAt,
    },
  };
})();
