// client/engine-directors.client.js
//
// Directors: Scene, Loop, Short
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
  // Short Director — 30-60s structured narrative
  // ---------------------------------------------------------------------------
  /**
   * @param {Object} config
   * @param {number} [config.bars=20] - Target bars (scales to 30-60s)
   * @param {string} [config.template='hook-build-drop-outro'] - Arc template
   * @param {Array} config.baseLayers - Base layer stack
   * @returns {Director}
   */
  function shortDirector(config) {
    var bars = config.bars || 20;
    var template = config.template || 'hook-build-drop-outro';
    var baseLayers = config.baseLayers || [];

    // Arc templates — energy at each checkpoint
    var arcs = {
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

    var arc = arcs[template] || arcs['hook-build-drop-outro'];
    var name = 'short:' + template;

    return {
      name: name,

      setup: function (ctx) {
        ctx.arc = arc;
        ctx.layers = baseLayers;
        ctx._bars = bars;
      },

      update: function (ctx) {
        // Get real BPM for accurate timing
        var bpm = (ctx.audio && ctx.audio.bpm) || 120;

        // Clamp bars to hit 30-60s target
        var minBars = Math.ceil(30 * bpm / 240);
        var maxBars = Math.floor(60 * bpm / 240);
        var clampedBars = Math.max(minBars, Math.min(maxBars, bars));

        // Find current arc segment
        var seg = null;
        for (var i = arc.length - 1; i >= 0; i--) {
          if (ctx.bar >= arc[i].at) {
            seg = arc[i];
            break;
          }
        }
        if (!seg) return;

        // Interpolate energy between segments
        var nextSeg = null;
        for (var j = 0; j < arc.length; j++) {
          if (arc[j].at > seg.at && (!nextSeg || arc[j].at < nextSeg.at)) {
            nextSeg = arc[j];
          }
        }

        if (nextSeg && nextSeg.at > seg.at) {
          var t = (ctx.bar - seg.at) / (nextSeg.at - seg.at);
          ctx.energy = seg.energy + (nextSeg.energy - seg.energy) * t;
        } else {
          ctx.energy = seg.energy;
        }

        // Set section name
        ctx.section = seg.name;

        // Apply energy to FX intensity if available
        if (ctx.fx) {
          for (var k = 0; k < ctx.fx.length; k++) {
            ctx.fx[k].intensity = ctx.energy;
          }
        }

        // Real audio-driven energy boost
        if (ctx.audio) {
          var audioEnergy = ctx.audio.bass / 255 * 0.3 + ctx.audio.rms / 255 * 0.2;
          ctx.energy = Math.min(1, ctx.energy + audioEnergy);
        }
      }
    };
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
    short: shortDirector
  };

  /**
   * Create a director by type
   * @param {string} type - 'scene', 'loop', or 'short'
   * @param {Object} options - Director-specific options
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
      createDirector: createDirector,
      onBeat: onBeat,
      DIRECTORS: DIRECTORS
    };
  }

})();
