/* global window */
(function () {
  const AUTO_ADVANCE_COVERAGE = 0.60;
  const TRANSITION_MS = 650;
  const DEFAULT_FILL_INTERVAL_MS = 600;
  const SPEED_MIN = 0.25;
  const SPEED_MAX = 4;
  const FILL_FADE_DEFAULT = 0.70;
  const BEAT_SPEED_SNAP = [0.25, 0.5, 1, 2, 4];

  const PRESETS = {
    calm: { speed: 0.5, fillFade: 0.9, label: 'Calm' },
    groove: { speed: 1, fillFade: 0.7, label: 'Groove' },
    electric: { speed: 2, fillFade: 0.35, label: 'Electric' },
    original: { speed: 1, fillFade: 0.7, label: 'Original' },
    watercolor: { speed: 0.5, fillFade: 0.85, label: 'Watercolor-style' },
  };

  const MUSICAL_KEYS = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
  const SCALES = {
    major: [0, 2, 4, 5, 7, 9, 11],
    minor: [0, 2, 3, 5, 7, 8, 10],
  };

  const CHARACTERS_WEBP = '/color-tales/characters.webp';
  const PLACEHOLDER_ART = '/color-tales/default-characters-placeholder.svg';

  window.SWR_COLOR_TALES_CONSTANTS = {
    AUTO_ADVANCE_COVERAGE,
    TRANSITION_MS,
    DEFAULT_FILL_INTERVAL_MS,
    SPEED_MIN,
    SPEED_MAX,
    FILL_FADE_DEFAULT,
    BEAT_SPEED_SNAP,
    PRESETS,
    MUSICAL_KEYS,
    SCALES,
    CHARACTERS_WEBP,
    PLACEHOLDER_ART,
  };
})();
