// client/engine-directors.client.js
//
// Directors: Scene, Loop, and the duration-windowed narrative trio
// (Short 30-60s, Medium 60-120s, Long 2-5min).
// Each returns a Director object with setup() and update().
// Context includes real AudioFeatures from audio-analysis-v2.

(function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // Scene Director — user-authored scenes in bars
  // ---------------------------------------------------------------------------
  /**
   * @param {Object} config
   * @param {Array} config.scenes - [{ id, startBar, bars, layers, transitionIn }]
   * @returns {Director}
   */
  function sceneDirector(config) {
    config = config || {};
    var scenes = config.scenes || [];
    var name = 'scene:' + (scenes[0]?.id || 'empty');

    return {
      name: name,

      setup: function (ctx) {
        if (scenes.length > 0) {
          ctx.layers = scenes[0].layers;
          ctx._cur = scenes[0].id;
        }
      },

      update: function (ctx) {
        // Find the scene that covers the current bar
        var cur = null;
        for (var i = scenes.length - 1; i >= 0; i--) {
          if (ctx.bar >= scenes[i].startBar) {
            cur = scenes[i];
            break;
          }
        }
        if (!cur) return;

        // Skip if already in this scene
        if (cur.id === ctx._cur) return;

        // Transition to new scene
        ctx._cur = cur.id;
        ctx.layers = cur.layers;

        // Run transition FX if provided
        if (cur.transitionIn) {
          cur.transitionIn(ctx);
        }
      },

      // Optional: which bars does this scene cover?
      includes: function (bar) {
        for (var i = 0; i < scenes.length; i++) {
          if (bar >= scenes[i].startBar && bar < scenes[i].startBar + scenes[i].bars) {
            return true;
          }
        }
        return false;
      }
    };
  }

  // ---------------------------------------------------------------------------
  // Loop Director — seamless periodic phase
  // ---------------------------------------------------------------------------
  /**
   * @param {Object} config
   * @param {number} [config.bars=2] - Loop length in bars
   * @param {Array} config.layers - Layer stack to loop
   * @param {number} [config.seamFade=0.05] - Seam fade ratio
   * @returns {Director}
   */
  function loopDirector(config) {
    config = config || {};
    var bars = config.bars || 2;
    var layers = config.layers || [];
    var seamFade = config.seamFade || 0.05;
    var name = 'loop:' + bars + 'bars';

    return {
      name: name,

      setup: function (ctx) {
        ctx.layers = layers;
        ctx._loopLen = bars * 4; // beats per loop
      },

      update: function (ctx) {
        // Get real BPM for accurate timing
        var bpm = (ctx.audio && ctx.audio.bpm) || 120;

        // Calculate phase from beat position within loop
        var beatInLoop = ctx.beat % ctx._loopLen;
        ctx.phase = beatInLoop / ctx._loopLen; // 0..1

        // Set energy from real audio
        if (ctx.audio) {
          ctx.energy = ctx.audio.bass / 255 * 0.6 + ctx.audio.rms / 255 * 0.4;
        }

        // Update all layers with phase
        for (var i = 0; i < ctx.layers.length; i++) {
          if (ctx.layers[i]) {
            ctx.layers[i].phase = ctx.phase;
          }
        }

        // Mark seam for FX that need it
        ctx.seam = ctx.phase < seamFade || ctx.phase > (1 - seamFade);
      }
    };
  }

  // ---------------------------------------------------------------------------
  // Structured arc engine — shared by Short / Medium / Long
  // ---------------------------------------------------------------------------
  /**
   * Duration-windowed narrative director. The authored arc is normalized onto
   * the director's bar budget, so the whole narrative plays out inside the
   * configured duration window ([minSec, maxSec]) no matter how long the
   * template was authored.
   *
   * Energy is interpolated between arc checkpoints, nudged by real audio
   * (bass + loudness), then written to ctx.energy and mirrored onto every
   * ctx.fx[k].intensity.
   *
   * @param {Object} config
   * @param {number} [config.bars] - Requested bar count (clamped to the window)
   * @param {string} [config.template] - Arc template id
   * @param {Array} [config.baseLayers] - Base layer stack
   * @param {Object} opts - Per-director defaults
   * @param {string} opts.kind - Director kind ('short' | 'medium' | 'long')
   * @param {number} opts.bars - Default bar count
   * @param {string} opts.defaultTemplate - Fallback template id
   * @param {number[]} opts.durationSec - [minSec, maxSec] target duration
   * @param {Object.<string, Array>} opts.arcs - Template id → arc segments
   * @returns {Director}
   */
  function structuredDirector(config, opts) {
    config = config || {};
    var arcs = opts.arcs;
    var bars = config.bars || opts.bars;
    var template = config.template || opts.defaultTemplate;
    var baseLayers = config.baseLayers || [];
    // An unknown template falls back to the default arc — and the name must
    // report the arc actually in use, not the one that was asked for.
    var effective = arcs[template] ? template : opts.defaultTemplate;
    var arc = arcs[effective];
    var span = arc.length ? arc[arc.length - 1].at : 0;
    // Arc checkpoints declare section *starts*, so the closing section would
    // otherwise begin on the final bar and never render. Extend the timeline
    // by the same length as the section before it: the closer gets a real
    // slice of the piece instead of a single frame.
    var tail = arc.length > 1 ? span - arc[arc.length - 2].at : 0;
    var total = span + tail;
    var name = opts.kind + ':' + effective;

    // Bar budget for a given BPM that lands the piece inside the window.
    // 1 bar = 4 beats = 240/bpm seconds, so seconds = bars * 240 / bpm.
    function barsFor(bpm) {
      var minBars = Math.ceil(opts.durationSec[0] * bpm / 240);
      var maxBars = Math.floor(opts.durationSec[1] * bpm / 240);
      if (maxBars < minBars) maxBars = minBars; // degenerate BPM rounding
      return Math.max(minBars, Math.min(maxBars, bars));
    }

    return {
      name: name,

      setup: function (ctx) {
        ctx.arc = arc;
        ctx.layers = baseLayers;
        ctx._bars = barsFor((ctx.audio && ctx.audio.bpm) || 120);
      },

      update: function (ctx) {
        var bpm = (ctx.audio && ctx.audio.bpm) || 120;
        var clampedBars = barsFor(bpm);
        ctx._bars = clampedBars;

        // Map playback bars onto the authored arc: bar 0 → arc start, the
        // final bar → end of the timeline, so the template fills the budget.
        var denom = Math.max(1, clampedBars - 1);
        var arcBar = total > 0 ? Math.min(total, ctx.bar * total / denom) : ctx.bar;

        // Find current arc segment
        var seg = null;
        for (var i = arc.length - 1; i >= 0; i--) {
          if (arcBar >= arc[i].at) {
            seg = arc[i];
            break;
          }
        }
        if (!seg) return;

        // Interpolate energy toward the next segment
        var nextSeg = null;
        for (var j = 0; j < arc.length; j++) {
          if (arc[j].at > seg.at && (!nextSeg || arc[j].at < nextSeg.at)) {
            nextSeg = arc[j];
          }
        }

        if (nextSeg && nextSeg.at > seg.at) {
          var t = (arcBar - seg.at) / (nextSeg.at - seg.at);
          ctx.energy = seg.energy + (nextSeg.energy - seg.energy) * t;
        } else {
          ctx.energy = seg.energy;
        }

        // Real audio-driven energy boost (bass + loudness), clamped to 0..1
        if (ctx.audio) {
          ctx.energy = Math.min(1, ctx.energy + ctx.audio.bass / 255 * 0.3 + ctx.audio.rms / 255 * 0.2);
        }

        ctx.section = seg.name;

        // Apply the final energy to FX intensity
        if (ctx.fx) {
          for (var k = 0; k < ctx.fx.length; k++) {
            ctx.fx[k].intensity = ctx.energy;
          }
        }
      }
    };
  }

  // ---------------------------------------------------------------------------
  // Short Director — 30-60s structured narrative
  // ---------------------------------------------------------------------------
  /**
   * @param {Object} config
   * @param {number} [config.bars=20] - Target bars (clamped to 30-60s)
   * @param {string} [config.template='hook-build-drop-outro'] - Arc template
   * @param {Array} config.baseLayers - Base layer stack
   * @returns {Director}
   */
  var SHORT_ARCS = {
    'hook-build-drop-outro': [
      { at: 0, name: 'intro', energy: 0.3 },
      { at: 2, name: 'hook', energy: 0.5 },
      { at: 6, name: 'build', energy: 0.7 },
      { at: 10, name: 'drop', energy: 1.0 },
      { at: 16, name: 'outro', energy: 0.3 }
    ],
    'verse-chorus': [
      { at: 0, name: 'verse', energy: 0.4 },
      { at: 8, name: 'chorus', energy: 0.9 },
      { at: 16, name: 'verse2', energy: 0.5 },
      { at: 24, name: 'chorus2', energy: 1.0 }
    ],
    'ambient-build': [
      { at: 0, name: 'ambient', energy: 0.2 },
      { at: 8, name: 'build', energy: 0.6 },
      { at: 16, name: 'peak', energy: 1.0 },
      { at: 24, name: 'fade', energy: 0.2 }
    ]
  };

  function shortDirector(config) {
    return structuredDirector(config, {
      kind: 'short',
      bars: 20,
      defaultTemplate: 'hook-build-drop-outro',
      durationSec: [30, 60],
      arcs: SHORT_ARCS
    });
  }

  // ---------------------------------------------------------------------------
  // Medium Director — 60-120s structured narrative
  // ---------------------------------------------------------------------------
  /**
   * @param {Object} config
   * @param {number} [config.bars=40] - Target bars (clamped to 60-120s)
   * @param {string} [config.template='verse-chorus-bridge-outro'] - Arc template
   * @param {Array} config.baseLayers - Base layer stack
   * @returns {Director}
   */
  var MEDIUM_ARCS = {
    'verse-chorus-bridge-outro': [
      { at: 0, name: 'intro', energy: 0.3 },
      { at: 4, name: 'verse1', energy: 0.4 },
      { at: 12, name: 'pre-chorus', energy: 0.6 },
      { at: 16, name: 'chorus1', energy: 0.9 },
      { at: 28, name: 'verse2', energy: 0.5 },
      { at: 36, name: 'bridge', energy: 0.7 },
      { at: 44, name: 'chorus2', energy: 1.0 },
      { at: 56, name: 'outro', energy: 0.3 }
    ],
    'slow-build': [
      { at: 0, name: 'ambient', energy: 0.2 },
      { at: 8, name: 'intro', energy: 0.3 },
      { at: 20, name: 'build1', energy: 0.5 },
      { at: 32, name: 'build2', energy: 0.7 },
      { at: 44, name: 'peak', energy: 1.0 },
      { at: 56, name: 'fade', energy: 0.2 }
    ],
    'triple-drop': [
      { at: 0, name: 'intro', energy: 0.3 },
      { at: 8, name: 'drop1', energy: 0.9 },
      { at: 20, name: 'build', energy: 0.5 },
      { at: 28, name: 'drop2', energy: 1.0 },
      { at: 40, name: 'build', energy: 0.5 },
      { at: 48, name: 'drop3', energy: 1.0 },
      { at: 60, name: 'outro', energy: 0.3 }
    ]
  };

  function mediumDirector(config) {
    return structuredDirector(config, {
      kind: 'medium',
      bars: 40,
      defaultTemplate: 'verse-chorus-bridge-outro',
      durationSec: [60, 120],
      arcs: MEDIUM_ARCS
    });
  }

  // ---------------------------------------------------------------------------
  // Long Director — 2-5min structured narrative
  // ---------------------------------------------------------------------------
  /**
   * @param {Object} config
   * @param {number} [config.bars=120] - Target bars (clamped to 2-5min)
   * @param {string} [config.template='full-song'] - Arc template
   * @param {Array} config.baseLayers - Base layer stack
   * @returns {Director}
   */
  var LONG_ARCS = {
    'full-song': [
      { at: 0, name: 'intro', energy: 0.25 },
      { at: 8, name: 'verse1', energy: 0.35 },
      { at: 16, name: 'pre-chorus1', energy: 0.5 },
      { at: 24, name: 'chorus1', energy: 0.85 },
      { at: 40, name: 'verse2', energy: 0.4 },
      { at: 48, name: 'pre-chorus2', energy: 0.55 },
      { at: 56, name: 'chorus2', energy: 0.9 },
      { at: 72, name: 'bridge', energy: 0.6 },
      { at: 88, name: 'chorus3', energy: 0.95 },
      { at: 104, name: 'outro', energy: 0.25 },
      { at: 116, name: 'end', energy: 0.1 }
    ],
    'epic-build': [
      { at: 0, name: 'ambient', energy: 0.15 },
      { at: 16, name: 'intro', energy: 0.25 },
      { at: 32, name: 'verse1', energy: 0.35 },
      { at: 48, name: 'build1', energy: 0.5 },
      { at: 64, name: 'build2', energy: 0.65 },
      { at: 80, name: 'peak1', energy: 0.9 },
      { at: 96, name: 'calm', energy: 0.4 },
      { at: 108, name: 'peak2', energy: 1.0 },
      { at: 124, name: 'outro', energy: 0.2 }
    ],
    'dj-mix': [
      { at: 0, name: 'mix1', energy: 0.5 },
      { at: 16, name: 'blend1', energy: 0.6 },
      { at: 32, name: 'mix2', energy: 0.7 },
      { at: 48, name: 'peak1', energy: 0.9 },
      { at: 64, name: 'blend2', energy: 0.55 },
      { at: 80, name: 'mix3', energy: 0.65 },
      { at: 96, name: 'peak2', energy: 0.95 },
      { at: 112, name: 'close', energy: 0.35 }
    ]
  };

  function longDirector(config) {
    return structuredDirector(config, {
      kind: 'long',
      bars: 120,
      defaultTemplate: 'full-song',
      durationSec: [120, 300],
      arcs: LONG_ARCS
    });
  }

  // ---------------------------------------------------------------------------
  // Beat-Quantized Transition Helper
  // ---------------------------------------------------------------------------
  /**
   * Returns true if we're close to a beat boundary (beatPhase < threshold)
   * Use for beat-quantized transitions
   * @param {DirectorContext} ctx
   * @param {number} threshold - 0-1, lower = tighter to beat
   * @returns {boolean}
   */
  function onBeat(ctx, threshold) {
    threshold = threshold || 0.1;
    return ctx.beatPhase !== undefined && ctx.beatPhase < threshold;
  }

  // ---------------------------------------------------------------------------
  // Director Factory
  // ---------------------------------------------------------------------------
  var DIRECTORS = {
    scene: sceneDirector,
    loop: loopDirector,
    short: shortDirector,
    medium: mediumDirector,
    long: longDirector
  };

  /**
   * Create a director by type
   * @param {string} type - 'scene', 'loop', 'short', 'medium', or 'long'
   * @param {Object} [options] - Director-specific options
   * @returns {Director}
   */
  function createDirector(type, options) {
    var fn = DIRECTORS[type];
    if (!fn) {
      throw new Error('Unknown director: ' + type + '. Available: ' + Object.keys(DIRECTORS).join(', '));
    }
    return fn(options);
  }

  // ---------------------------------------------------------------------------
  // Export
  // ---------------------------------------------------------------------------
  if (typeof window !== 'undefined') {
    window.SWR_DIRECTORS = {
      sceneDirector: sceneDirector,
      loopDirector: loopDirector,
      shortDirector: shortDirector,
      mediumDirector: mediumDirector,
      longDirector: longDirector,
      createDirector: createDirector,
      onBeat: onBeat,
      DIRECTORS: DIRECTORS
    };
  }

})();
