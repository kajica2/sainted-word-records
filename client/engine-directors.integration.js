// client/engine-directors.integration.js
//
// Integration guide for wiring Directors into Spit runtime.
//
// STEP 1: Load the directors module
// Add to spit.html after swr-spit-runtime.client.js:
// <script src="/client/engine-directors.client.js" defer></script>
// <script src="/client/engine-directors.types.js" defer></script>
//
// STEP 2: Initialize director in Spit runtime
// In swr-spit-runtime.client.js, after _beatInfo is set:
//
// Inside the SpitRuntime class, add:
//
//   this._director = null;
//
// After beat loads (around line 384):
//
//   if (options.director) {
//     this._director = window.SWR_DIRECTORS.createDirector(options.director.type, options.director.config);
//     this._director.setup(this._directorCtx());
//   }
//
// STEP 3: Create director context helper
// Add method to SpitRuntime:
//
//   _directorCtx: function() {
//     var beat = this._beatInfo;
//     var bpm = beat && beat.bpm || 120;
//     var beatsPerBar = 4;
//     var currentTime = this._audio && this._audio.currentTime || 0;
//     var currentBar = Math.floor(currentTime * bpm / 60 / beatsPerBar);
//     var beatInBar = Math.floor((currentTime * bpm / 60) % beatsPerBar);
//     var beatPhase = (currentTime * bpm / 60) % 1;
//
//     return {
//       layers: this._layers || [],
//       bar: currentBar,
//       beat: beatInBar,
//       beatPhase: beatPhase,
//       energy: 0.5, // default, updated by director
//       time: currentTime,
//       audio: this._audioFeatures || { bpm: bpm, bass: 128, mid: 128, treble: 128, beat: 0, rms: 128 },
//       fx: this._fxStack || [],
//       meta: {}
//     };
//   },
//
// STEP 4: Hook director update into the RAF loop
// In the main animation loop (around where beat features update):
//
//   if (this._director) {
//     var ctx = this._directorCtx();
//     this._director.update(ctx);
//     // Apply director output to layers/FX
//     this._layers = ctx.layers;
//   }
//
// STEP 5: Wire real-time audio features
// In the audio update callback (where Audio.feat is updated):
//
//   this._audioFeatures = {
//     bpm: this._beatInfo.bpm,
//     bass: Audio.feat.bass,
//     mid: Audio.feat.mid,
//     treble: Audio.feat.treble,
//     beat: Audio.feat.beat,
//     rms: Audio.feat.rms,
//     key: this._beatInfo.key,
//     scale: this._beatInfo.scale
//   };
//
// USAGE EXAMPLES
// ==============
//
// 1. Scene Director:
//   var director = SWR_DIRECTORS.createDirector('scene', {
//     scenes: [
//       { id: 'intro', startBar: 0, bars: 4, layers: [layerA, layerB] },
//       { id: 'verse', startBar: 4, bars: 8, layers: [layerC], transitionIn: crossfade },
//       { id: 'chorus', startBar: 12, bars: 8, layers: [layerD, layerE] }
//     ]
//   });
//
// 2. Loop Director:
//   var director = SWR_DIRECTORS.createDirector('loop', {
//     bars: 4,           // 4 bar loop
//     layers: [layerA, layerB, layerC],
//     seamFade: 0.05     // 5% fade at loop boundaries
//   });
//
// 3. Short Director:
//   var director = SWR_DIRECTORS.createDirector('short', {
//     bars: 20,                        // scales to 30-60s based on BPM
//     template: 'hook-build-drop-outro', // arc template
//     baseLayers: [layerMain]
//   });
//
// BEAT-QUANTIZED TRANSITIONS
// ==========================
//
// Use SWR_DIRECTORS.onBeat(ctx, threshold) for transitions that snap to beat:
//
//   if (SWR_DIRECTORS.onBeat(ctx, 0.1) && ctx.bar >= nextSceneStartBar) {
//     ctx.layers = nextSceneLayers;
//   }
//
// KEY-AWARE PALETTE (optional)
// ===========================
//
// Map detected key to complementary palette:
//
//   var keyToPalette = {
//     'C':  { primary: '#ff6b6b', secondary: '#4ecdc4', accent: '#ffe66d' },
//     'G':  { primary: '#96ceb4', secondary: '#ff6b6b', accent: '#4ecdc4' },
//     // ... etc
//   };
//
//   var palette = keyToPalette[ctx.audio.key] || defaultPalette;
//   ctx.layers.forEach(function(l) { l.palette = palette; });
