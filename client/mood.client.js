// client/mood.client.js
//
// Mood-board reference analyzer. K-means (k=5) on a 64×64 downsample
// extracts a palette; brightness / saturation / Michelson contrast /
// warm–cool temperature are computed; the result maps onto the four
// footer sliders (depth/gate/decay/sens). The reference image can be
// dragged and persisted per-session via overlayPos / overlayVisible.
//
// Extracted from versions/music_video.html:2864-3033 (Phase 1b).
//
// Public API on window.SWR_MOOD:
//   analyze(img)              → { palette, features, suggestion, ts }
//   applySuggestion()         Write suggested values to #depth/#gate/#decay/#sens
//   setOverlayImage(dataUrl)   Update the #mood-overlay <img> src
//   setOverlayVisible(bool)    Show/hide #mood-overlay
//   loadOverlayPos()          → { x, y, visible }
//   saveOverlayPos(x, y)      Persist overlay position
//   lastAnalysis              Latest analyze() result (or null)
//   overlayPos                { x, y }
//   overlayVisible            bool

(function () {
  'use strict';
  if (window.SWR_MOOD) return;

  function $(id) { return document.getElementById(id); }

  var mood = {
    STORAGE_KEY: 'swr.mood.overlay.v1',
    overlayPos: { x: 16, y: 16 },
    overlayVisible: false,
    lastAnalysis: null,

    _kmeans(pixels, k, maxIter) {
      if (pixels.length < k) return { centroids: pixels.slice(0, k), sizes: pixels.map(function () { return 1; }) };
      var centroids = [];
      centroids.push(pixels[Math.floor(Math.random() * pixels.length)].slice());
      while (centroids.length < k) {
        var dists = pixels.map(function (p) {
          var minD = Infinity;
          for (var ci = 0; ci < centroids.length; ci++) {
            var c = centroids[ci];
            var d = (p[0] - c[0]) * (p[0] - c[0]) + (p[1] - c[1]) * (p[1] - c[1]) + (p[2] - c[2]) * (p[2] - c[2]);
            if (d < minD) minD = d;
          }
          return minD;
        });
        var total = dists.reduce(function (a, b) { return a + b; }, 0);
        var r = Math.random() * total;
        for (var i = 0; i < dists.length; i++) {
          r -= dists[i];
          if (r <= 0) { centroids.push(pixels[i].slice()); break; }
        }
      }
      for (var it = 0; it < maxIter; it++) {
        var sums = centroids.map(function () { return [0, 0, 0, 0]; });
        for (var pi = 0; pi < pixels.length; pi++) {
          var p = pixels[pi];
          var bestI = 0, bestD = Infinity;
          for (var i2 = 0; i2 < centroids.length; i2++) {
            var c = centroids[i2];
            var d = (p[0] - c[0]) * (p[0] - c[0]) + (p[1] - c[1]) * (p[1] - c[1]) + (p[2] - c[2]) * (p[2] - c[2]);
            if (d < bestD) { bestD = d; bestI = i2; }
          }
          var s = sums[bestI];
          s[0] += p[0]; s[1] += p[1]; s[2] += p[2]; s[3]++;
        }
        var moved = false;
        for (var i3 = 0; i3 < centroids.length; i3++) {
          if (sums[i3][3] > 0) {
            var newC = [sums[i3][0] / sums[i3][3], sums[i3][1] / sums[i3][3], sums[i3][2] / sums[i3][3]];
            if (Math.abs(newC[0] - centroids[i3][0]) + Math.abs(newC[1] - centroids[i3][1]) + Math.abs(newC[2] - centroids[i3][2]) > 1) {
              centroids[i3] = newC;
              moved = true;
            }
          }
        }
        if (!moved) break;
      }
      var sizes = new Array(centroids.length).fill(0);
      for (var pi2 = 0; pi2 < pixels.length; pi2++) {
        var p2 = pixels[pi2];
        var bestI2 = 0, bestD2 = Infinity;
        for (var i4 = 0; i4 < centroids.length; i4++) {
          var c2 = centroids[i4];
          var d2 = (p2[0] - c2[0]) * (p2[0] - c2[0]) + (p2[1] - c2[1]) * (p2[1] - c2[1]) + (p2[2] - c2[2]) * (p2[2] - c2[2]);
          if (d2 < bestD2) { bestD2 = d2; bestI2 = i4; }
        }
        sizes[bestI2]++;
      }
      return { centroids: centroids, sizes: sizes };
    },

    _sampleImage(img, sampleSize) {
      sampleSize = sampleSize || 64;
      var c = document.createElement('canvas');
      c.width = sampleSize; c.height = sampleSize;
      var cx = c.getContext('2d');
      cx.drawImage(img, 0, 0, sampleSize, sampleSize);
      var data = cx.getImageData(0, 0, sampleSize, sampleSize).data;
      var pixels = [];
      for (var i = 0; i < data.length; i += 4) {
        pixels.push([data[i], data[i + 1], data[i + 2]]);
      }
      return { pixels: pixels, raw: data, width: sampleSize, height: sampleSize };
    },

    _features(pixels) {
      var sumL = 0, sumS = 0;
      var minL = 255, maxL = 0;
      var warm = 0, cool = 0;
      for (var i = 0; i < pixels.length; i++) {
        var r = pixels[i][0], g = pixels[i][1], b = pixels[i][2];
        var max = Math.max(r, g, b), min = Math.min(r, g, b);
        var L = (max + min) / 2;
        var S = max === min ? 0 : (max - min) / (255 - Math.abs(2 * L - 255));
        sumL += L;
        sumS += S;
        if (L < minL) minL = L;
        if (L > maxL) maxL = L;
        warm += (r - b);
        cool += (b - r);
      }
      var n = pixels.length;
      var meanBright = sumL / n / 255;
      var meanSat = sumS / n;
      var contrast = (maxL - minL) / (maxL + minL + 1e-6);
      var tempSum = warm - cool;
      var tempNorm = Math.max(-1, Math.min(1, tempSum / (n * 255)));
      return { meanBright: meanBright, meanSat: meanSat, contrast: contrast, temperature: tempNorm };
    },

    _suggest(f) {
      var warmth = f.temperature > 0;
      var highContrast = f.contrast > 0.5;
      var highSat = f.meanSat > 0.4;
      var bright = f.meanBright > 0.5;
      var depth = warmth ? 1.0 : 0.0;
      var gate = highContrast ? 2.5 : 1.4;
      var decay = highSat ? 0.65 : 0.85;
      var sens = bright ? 1.5 : 1.0;
      return {
        depth: depth, gate: gate, decay: decay, sens: sens,
        warmth: warmth ? 'warm' : 'cool',
        contrast: highContrast ? 'high' : 'low',
        saturation: highSat ? 'high' : 'low',
      };
    },

    analyze: async function (img) {
      var sampled = this._sampleImage(img, 64);
      var palette = this._kmeans(sampled.pixels, 5, 10);
      var features = this._features(sampled.pixels);
      var suggestion = this._suggest(features);
      this.lastAnalysis = { palette: palette, features: features, suggestion: suggestion, ts: Date.now() };
      return this.lastAnalysis;
    },

    applySuggestion() {
      if (!this.lastAnalysis) return false;
      var s = this.lastAnalysis.suggestion;
      var sliders = [
        ['depth', s.depth],
        ['gate', s.gate],
        ['decay', s.decay],
        ['sens', s.sens],
      ];
      for (var i = 0; i < sliders.length; i++) {
        var el = document.getElementById(sliders[i][0]);
        if (!el) continue;
        el.value = String(sliders[i][1]);
        el.dispatchEvent(new Event('input', { bubbles: true }));
      }
      return true;
    },

    saveOverlayPos(x, y) {
      try { localStorage.setItem(this.STORAGE_KEY, JSON.stringify({ x: x, y: y, visible: this.overlayVisible })); } catch (_) {}
    },

    loadOverlayPos() {
      try {
        var raw = localStorage.getItem(this.STORAGE_KEY);
        if (!raw) return { x: 16, y: 16, visible: false };
        return JSON.parse(raw);
      } catch (_) { return { x: 16, y: 16, visible: false }; }
    },

    setOverlayVisible(v) {
      this.overlayVisible = !!v;
      var img = $('mood-overlay');
      if (img) img.style.display = v ? 'block' : 'none';
      this.saveOverlayPos(this.overlayPos ? this.overlayPos.x : 16, this.overlayPos ? this.overlayPos.y : 16);
    },

    setOverlayImage(dataUrl) {
      var img = $('mood-overlay');
      if (img) img.src = dataUrl;
    },
  };

  window.SWR_MOOD = mood;
})();