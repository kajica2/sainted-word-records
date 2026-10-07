// lib/look-variant.client.js
//
// Honors ?look=clean|film on the engine variant pages and applies the render
// grade defined in preset-pipeline/VARIANTS.md:
//   Clean — sharp, no grain, light vignette (high-end / commercial)
//   Film  — grainy, lifted blacks, heavier vignette (moody / artistic)
//
// The grade is display-level (CSS filter on the render canvas + GPU-composited
// grain/vignette overlays) so it works on every variant regardless of its GLSL
// or 2D pipeline, and it never reads pixels back per frame.
//
// Exposes the active look as document.documentElement[data-look] for tests.
(function () {
  'use strict';

  var look = null;
  try { look = new URLSearchParams(location.search).get('look'); } catch (_) {}
  if (look !== 'clean' && look !== 'film') return;

  var GRADE = {
    clean: {
      filter: 'contrast(1.06) saturate(1.05)',
      grain: 0,
      vignette: 0.15,
    },
    film: {
      filter: 'contrast(0.88) saturate(0.92) sepia(0.08) brightness(1.03)',
      grain: 0.25,
      vignette: 0.32,
    },
  };
  var g = GRADE[look];

  var GRAIN_URL = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 0.6 0'/></filter><rect width='100%25' height='100%25' filter='url(%23n)'/></svg>";

  function overlay(cssText, cls) {
    var el = document.createElement('div');
    el.className = cls;
    el.setAttribute('aria-hidden', 'true');
    el.style.cssText = cssText;
    document.body.appendChild(el);
  }

  function apply() {
    // Grade layer (contrast / tint) as a full-screen backdrop-filter. This is
    // deliberately NOT the render canvas' own style.filter: lib/swr-natural sets
    // that every frame (its filmic grade) and would race a one-shot write here.
    // A separate overlay grades the composited result and never contends.
    overlay(
      'position:fixed;inset:0;z-index:58;pointer-events:none;' +
      'backdrop-filter:' + g.filter + ';-webkit-backdrop-filter:' + g.filter + ';',
      'swr-look-grade');

    // Grain (Film only) and vignette: fixed, pointer-transparent, composited
    // on the GPU so they cost no per-frame canvas work.
    if (g.grain > 0) {
      overlay(
        'position:fixed;inset:0;z-index:60;pointer-events:none;' +
        'opacity:' + g.grain + ';mix-blend-mode:overlay;' +
        'background-image:url("' + GRAIN_URL + '");background-size:160px 160px;',
        'swr-look-grain');
    }
    overlay(
      'position:fixed;inset:0;z-index:59;pointer-events:none;' +
      'background:radial-gradient(ellipse at center, transparent 32%, rgba(0,0,0,' + g.vignette + ') 100%);',
      'swr-look-vignette');

    document.documentElement.setAttribute('data-look', look);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', apply);
  } else {
    apply();
  }
})();
