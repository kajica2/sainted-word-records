// client/section-detector.client.js
//
// Auto-detect sections from audio analysis (onsets + energy).
// Used to auto-generate Scene director scenes from a loaded track.

(function () {
  'use strict';

  /**
   * Detect sections from audio analysis
   * @param {Object} analysis - AudioAnalysisV2 output
   * @param {Object} options - Configuration
   * @returns {Array} sections - [{ startBar, name, energy }]
   */
  function detectSections(analysis, options) {
    options = options || {};
    var bpm = analysis.bpm || 120;
    var onsets = analysis.onsets || [];
    var energy = analysis.energy || [];
    var duration = analysis.duration || 0;

    var beatsPerBar = 4;
    var secondsPerBeat = 60 / bpm;
    var secondsPerBar = secondsPerBeat * beatsPerBar;
    var totalBars = Math.floor(duration / secondsPerBar);

    // Default to simple structure if insufficient data
    if (!onsets || onsets.length < 8 || !energy || energy.length < 10) {
      return [
        { startBar: 0, name: 'section1', energy: 0.5 },
        { startBar: Math.floor(totalBars / 2), name: 'section2', energy: 0.7 }
      ];
    }

    // Compute energy at each bar
    var barCount = Math.min(totalBars, 64); // Cap at 64 bars
    var barEnergy = [];
    var samplesPerBar = Math.max(1, Math.floor(energy.length / barCount));

    for (var i = 0; i < barCount; i++) {
      var startIdx = i * samplesPerBar;
      var endIdx = Math.min(startIdx + samplesPerBar, energy.length);
      var sum = 0;
      for (var j = startIdx; j < endIdx; j++) {
        sum += energy[j] || 0;
      }
      barEnergy.push(sum / (endIdx - startIdx));
    }

    // Normalize energy
    var maxE = Math.max.apply(null, barEnergy);
    var minE = Math.min.apply(null, barEnergy);
    for (var k = 0; k < barEnergy.length; k++) {
      barEnergy[k] = maxE > minE ? (barEnergy[k] - minE) / (maxE - minE) : 0.5;
    }

    // Detect sections based on energy changes
    var sections = [];
    var currentSection = { startBar: 0, energy: barEnergy[0] };
    var energyThreshold = options.energyThreshold || 0.15; // 15% change = new section
    var minSectionBars = options.minSectionBars || 4; // Minimum 4 bars per section

    for (var bar = 1; bar < barCount; bar++) {
      var energyDelta = Math.abs(barEnergy[bar] - currentSection.energy);

      if (energyDelta > energyThreshold && (bar - currentSection.startBar) >= minSectionBars) {
        // Close current section
        currentSection.bars = bar - currentSection.startBar;
        currentSection.name = nameSection(currentSection.energy);
        sections.push(currentSection);

        // Start new section
        currentSection = { startBar: bar, energy: barEnergy[bar] };
      } else {
        // Smooth energy for current section
        currentSection.energy = currentSection.energy * 0.8 + barEnergy[bar] * 0.2;
      }
    }

    // Close final section
    if (barCount > 0) {
      currentSection.bars = barCount - currentSection.startBar;
      currentSection.name = nameSection(currentSection.energy);
      sections.push(currentSection);
    }

    // Ensure we have at least something
    if (sections.length === 0) {
      sections.push({ startBar: 0, name: 'full', energy: 0.5, bars: barCount });
    }

    return sections;
  }

  /**
   * Name a section based on its energy level
   */
  function nameSection(energy) {
    if (energy < 0.25) return 'ambient';
    if (energy < 0.45) return 'verse';
    if (energy < 0.65) return 'pre-chorus';
    if (energy < 0.85) return 'chorus';
    return 'peak';
  }

  /**
   * Convert sections to Scene director format
   */
  function sectionsToScenes(sections, layersFactory) {
    var scenes = [];
    for (var i = 0; i < sections.length; i++) {
      var s = sections[i];
      scenes.push({
        id: s.name + '_' + i,
        startBar: s.startBar,
        bars: s.bars || 4,
        layers: layersFactory ? layersFactory(s, i) : [],
        energy: s.energy
      });
    }
    return scenes;
  }

  // Export
  if (typeof window !== 'undefined') {
    window.SWR_SECTION_DETECTOR = {
      detectSections: detectSections,
      sectionsToScenes: sectionsToScenes
    };
  }

})();
