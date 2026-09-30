// client/engine-directors.types.js
//
// Type definitions for the Director system.
// Directors drive the visual timeline based on audio analysis.

/**
 * @typedef {Object} AudioFeatures
 * @property {number} bass - 0-255 bass energy
 * @property {number} mid - 0-255 mid energy
 * @property {number} treble - 0-255 treble energy
 * @property {number} beat - 0-1 beat pulse (smoothed)
 * @property {number} rms - 0-255 RMS volume
 * @property {number} centroid - spectral centroid
 * @property {number} bpm - detected BPM (0 if unclear)
 * @property {string} key - detected key (e.g. "A", "Bb")
 * @property {string} scale - "major" or "minor"
 * @property {number} confidence - 0-1 key detection confidence
 */

/**
 * @typedef {Object} Layer
 * @property {string} id
 * @property {HTMLCanvasElement} canvas
 * @property {object} state - layer-specific state
 */

/**
 * @typedef {Object} DirectorContext
 * @property {Layer[]} layers - Active layer stack
 * @property {number} bar - Current bar (0-indexed)
 * @property {number} beat - Current beat (0-3)
 * @property {number} beatPhase - 0-1 position within beat
 * @property {number} energy - 0-1, drives FX intensity
 * @property {number} time - Current time in seconds
 * @property {AudioFeatures} audio - Real audio features
 * @property {object} [meta] - Director-specific metadata
 * @property {string} [_cur] - Current scene/segment ID
 * @property {number} [phase] - Loop phase 0-1
 * @property {boolean} [seam] - True if at loop seam
 * @property {string} [section] - Current section name
 */

/**
 * @typedef {Object} Director
 * @property {string} name - Director name for debugging
 * @property {function(DirectorContext): void} setup - Called once on init
 * @property {function(DirectorContext): void} update - Called every frame
 * @property {function(number): boolean} [includes] - Optional: does this director cover this bar?
 */

// Export for use in other modules
if (typeof window !== 'undefined') {
  window.SWR_DIRECTOR_TYPES = {
    AudioFeatures: null,
    Layer: null,
    DirectorContext: null,
    Director: null
  };
}
