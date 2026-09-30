// client/key-palette.client.js
//
// Map detected key to harmonically complementary palette colors.
// Based on music theory: key determines which colors feel "right" together.

(function () {
  'use strict';

  /**
   * Key to palette mapping
   * Based on circle of fifths relationships:
   * - Keys close in the circle share similar energy
   * - Relative minor/major have similar mood
   */
  var KEY_PALETTES = {
    // Major keys - bright, confident
    'C':  { primary: '#ff6b6b', secondary: '#4ecdc4', accent: '#ffe66d', bg: '#1a1a2e' },
    'G':  { primary: '#96ceb4', secondary: '#ff6b6b', accent: '#4ecdc4', bg: '#1a2a1e' },
    'D':  { primary: '#ffd93d', secondary: '#6bcb77', accent: '#4d96ff', bg: '#2a2a1a' },
    'A':  { primary: '#ff6b6b', secondary: '#feca57', accent: '#54a0ff', bg: '#2e1a1a' },
    'E':  { primary: '#f8b500', secondary: '#ff6b6b', accent: '#00d2d3', bg: '#2a2015' },
    'B':  { primary: '#a55eea', secondary: '#ff6b6b', accent: '#26de81', bg: '#1e1a2e' },
    'F#': { primary: '#45aaf2', secondary: '#fd9644', accent: '#fc5c65', bg: '#151a2e' },
    'Db': { primary: '#fd79a8', secondary: '#00b894', accent: '#fdcb6e', bg: '#2e1a24' },
    'Ab': { primary: '#e17055', secondary: '#00cec9', accent: '#ffeaa7', bg: '#2e1f1a' },
    'Eb': { primary: '#74b9ff', secondary: '#ff7675', accent: '#fdcb6e', bg: '#1a1e2e' },
    'Bb': { primary: '#d63031', secondary: '#e17055', accent: '#74b9ff', bg: '#2e1a1a' },
    'F':  { primary: '#00b894', secondary: '#ff7675', accent: '#ffeaa7', bg: '#1a2e24' },

    // Minor keys - darker, more introspective
    'Am': { primary: '#a29bfe', secondary: '#fd79a8', accent: '#00cec9', bg: '#1a1a2e' },
    'Em': { primary: '#ff7675', secondary: '#74b9ff', accent: '#fdcb6e', bg: '#2e1a1a' },
    'Bm': { primary: '#fdcb6e', secondary: '#e17055', accent: '#0984e3', bg: '#2a2015' },
    'F#m':{ primary: '#6c5ce7', secondary: '#fd79a8', accent: '#00b894', bg: '#1e1a2e' },
    'C#m':{ primary: '#0984e3', secondary: '#ff7675', accent: '#55efc4', bg: '#151a2e' },
    'G#m':{ primary: '#e84393', secondary: '#00cec9', accent: '#ffeaa7', bg: '#2e1a24' },
    'Ebm':{ primary: '#636e72', secondary: '#b2bec3', accent: '#dfe6e9', bg: '#1a1c1e' },
    'Bbm':{ primary: '#d63031', secondary: '#fdcb6e', accent: '#74b9ff', bg: '#2e1a1a' },
    'Fm': { primary: '#00cec9', secondary: '#ff7675', accent: '#ffeaa7', bg: '#1a2e2e' },
    'Cm': { primary: '#ff6b6b', secondary: '#4ecdc4', accent: '#ffe66d', bg: '#2e1a1a' },
    'Gm': { primary: '#6bcb77', secondary: '#ff6b6b', accent: '#4d96ff', bg: '#1e2a1a' },
    'Dm': { primary: '#ffeaa7', secondary: '#74b9ff', accent: '#ff7675', bg: '#2a2a1a' }
  };

  /**
   * Get palette for a detected key
   * @param {string} key - Detected key (e.g. "A", "Bb", "Cm")
   * @param {Object} fallback - Fallback palette if key not found
   * @returns {Object} palette - { primary, secondary, accent, bg }
   */
  function getPaletteForKey(key, fallback) {
    if (!key) return fallback || DEFAULT_PALETTE;

    // Normalize key (handle flats/sharps)
    var normalized = normalizeKey(key);
    var palette = KEY_PALETTES[normalized];

    if (palette) return palette;

    // Try to find by relative major/minor
    var relative = getRelativeKey(normalized);
    if (relative && KEY_PALETTES[relative]) {
      return KEY_PALETTES[relative];
    }

    return fallback || DEFAULT_PALETTE;
  }

  /**
   * Normalize key string
   */
  function normalizeKey(key) {
    if (!key) return null;
    key = key.trim().toUpperCase();
    // Convert flats to sharps
    var flatToSharp = {
      'BB': 'A#', 'EB': 'D#', 'AB': 'G#', 'DB': 'C#', 'GB': 'F#', 'CB': 'BB',
      'BBM': 'A#M', 'EM': 'D#M', 'ABM': 'G#M', 'DBM': 'C#M', 'GBM': 'F#M', 'CBM': 'BB'
    };
    if (flatToSharp[key]) return flatToSharp[key];
    return key;
  }

  /**
   * Get relative major/minor
   */
  function getRelativeKey(key) {
    if (!key) return null;
    var majorToMinor = {
      'C': 'Am', 'G': 'Em', 'D': 'Bm', 'A': 'F#m', 'E': 'C#m', 'B': 'G#m',
      'F#': 'E#m', 'DB': 'Bbm', 'AB': 'Fm', 'EB': 'Cm', 'BB': 'Gm', 'F': 'Dm'
    };
    var minorToMajor = {
      'Am': 'C', 'Em': 'G', 'Bm': 'D', 'F#m': 'A', 'C#m': 'E', 'G#m': 'B',
      'E#m': 'F#', 'Bbm': 'DB', 'Fm': 'AB', 'Cm': 'EB', 'Gm': 'BB', 'Dm': 'F'
    };
    return majorToMinor[key] || minorToMajor[key];
  }

  /**
   * Get energy level for a key (for FX intensity)
   */
  function getKeyEnergy(key) {
    var normalized = normalizeKey(key);
    // Minor keys tend to be lower energy, major keys higher
    if (normalized && normalized.endsWith('M')) return 0.6; // minor
    return 0.7; // major
  }

  // Default fallback palette
  var DEFAULT_PALETTE = {
    primary: '#ff3d92',
    secondary: '#00e5ff',
    accent: '#ffd24a',
    bg: '#050308'
  };

  // Export
  if (typeof window !== 'undefined') {
    window.SWR_KEY_PALETTE = {
      getPaletteForKey: getPaletteForKey,
      getKeyEnergy: getKeyEnergy,
      KEY_PALETTES: KEY_PALETTES,
      DEFAULT_PALETTE: DEFAULT_PALETTE
    };
  }

})();
