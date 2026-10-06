// font-variants.client.js — display type specimen (window.SWR_FONTS).
//
// A type specimen for the families the site actually ships. There are no
// font files in the repo — every face is loaded from Google Fonts — so this
// module owns the axis metadata (which faces are variable, which axes they
// expose) and renders specimen rows from it. Keep FONTS in sync with the
// <link> in fonts.html: a face whose axes are wrong here will silently fall
// back to its default instance rather than error.
//
// Global-script IIFE per the repo's .client.js convention: attaches exactly
// one global (window.SWR_FONTS).

(function () {
  if (window.SWR_FONTS) return; // idempotent

  // variable: does the face respond to font-variation-settings?
  //   wght  — weight axis range [min, max]
  //   opsz  — optical size axis range [min, max]
  //   ital  — true when a true italic instance ships
  //   soft  — Fraunces' SOFT axis range [min, max]
  // weight — for static faces, the weights that actually resolve
  var FONTS = [
    {
      id: 'fraunces',
      name: 'Fraunces',
      role: 'Display serif',
      stack: "'Fraunces', ui-serif, Georgia, serif",
      variable: true,
      wght: [300, 900],
      opsz: [9, 144],
      ital: true,
      soft: [0, 100],
      note: 'Optical size + weight + SOFT. The house display face.',
    },
    {
      id: 'archivo-black',
      name: 'Archivo Black',
      role: 'Display sans',
      stack: "'Archivo Black', 'Inter', sans-serif",
      variable: false,
      weight: [400],
      note: 'Single heavy instance. No weight or slant axis.',
    },
    {
      id: 'dm-serif-display',
      name: 'DM Serif Display',
      role: 'Display serif',
      stack: "'DM Serif Display', ui-serif, Georgia, serif",
      variable: false,
      weight: [400],
      ital: true,
      note: 'Regular + italic only. Sized for large text.',
    },
    {
      id: 'cormorant',
      name: 'Cormorant Garamond',
      role: 'Display serif',
      stack: "'Cormorant Garamond', ui-serif, Georgia, serif",
      variable: false,
      weight: [300, 400, 600],
      ital: true,
      note: 'Old-style, very high contrast at display sizes.',
    },
    {
      id: 'space-grotesk',
      name: 'Space Grotesk',
      role: 'Display sans',
      stack: "'Space Grotesk', 'Inter', sans-serif",
      variable: true,
      wght: [300, 700],
      note: 'Geometric sans with quirky terminals.',
    },
    {
      id: 'dm-sans',
      name: 'DM Sans',
      role: 'Text sans',
      stack: "'DM Sans', 'Inter', sans-serif",
      variable: true,
      wght: [400, 700],
      opsz: [9, 40],
      ital: true,
      note: 'Optical size + weight. The workhorse UI face.',
    },
    {
      id: 'inter',
      name: 'Inter',
      role: 'Text sans',
      stack: "'Inter', -apple-system, system-ui, sans-serif",
      variable: true,
      wght: [300, 800],
      ital: true,
      note: 'Tall x-height, explicit tabular figures.',
    },
    {
      id: 'geist',
      name: 'Geist',
      role: 'Text sans',
      stack: "'Geist', -apple-system, system-ui, sans-serif",
      variable: true,
      wght: [300, 700],
      note: 'Body face across the marketing pages.',
    },
    {
      id: 'archivo-black-mono',
      name: 'Mono faces',
      role: 'Data / labels',
      stack: "'Geist Mono', 'JetBrains Mono', ui-monospace, monospace",
      variable: true,
      wght: [400, 600],
      mono: true,
      note: 'Geist Mono primary, JetBrains Mono for code.',
    },
    {
      id: 'jetbrains',
      name: 'JetBrains Mono',
      role: 'Code',
      stack: "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace",
      variable: true,
      wght: [400, 800],
      mono: true,
      note: 'Ligs, tall x-height. Readout + code surfaces.',
    },
    {
      id: 'space-mono',
      name: 'Space Mono',
      role: 'Data / labels',
      stack: "'Space Mono', ui-monospace, monospace",
      variable: false,
      weight: [400, 700],
      mono: true,
      note: 'Distinctive slab-ish mono. Marketplace tags.',
    },
    {
      id: 'plex-mono',
      name: 'IBM Plex Mono',
      role: 'Data / labels',
      stack: "'IBM Plex Mono', ui-monospace, monospace",
      variable: false,
      weight: [400, 500, 600],
      mono: true,
      note: 'Humanist mono. Receipts + invoices.',
    },
    {
      id: 'special-elite',
      name: 'Special Elite',
      role: 'Accent',
      stack: "'Special Elite', Georgia, serif",
      variable: false,
      weight: [400],
      mono: true,
      note: 'Worn typewriter. One page only — deliberate rarity.',
    },
  ];

  var SPECIMEN = 'Sainted Word';

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // The weight steps a specimen row should show: variable faces get a spread
  // across their axis, static faces show exactly what they ship.
  function weightsFor(font) {
    if (font.weight) return font.weight.slice();
    if (!font.wght) return [400];
    var lo = font.wght[0];
    var hi = font.wght[1];
    var span = hi - lo;
    // Up to five steps, rounded to conventional weights where possible.
    var steps = span <= 200 ? 3 : span <= 400 ? 4 : 5;
    var out = [];
    for (var i = 0; i < steps; i++) out.push(Math.round(lo + (span * i) / (steps - 1)));
    return out.filter(function (w, i) { return out.indexOf(w) === i; });
  }

  // Build the font-variation-settings value for a specimen instance.
  function fvs(font, opts) {
    opts = opts || {};
    var parts = [];
    if (font.variable) {
      if (font.wght) {
        var w = Math.min(font.wght[1], Math.max(font.wght[0], opts.weight || 400));
        parts.push('"wght" ' + w);
      }
      if (font.opsz && opts.opsz != null) {
        var o = Math.min(font.opsz[1], Math.max(font.opsz[0], opts.opsz));
        parts.push('"opsz" ' + o);
      }
      if (font.soft && opts.soft != null) parts.push('"SOFT" ' + opts.soft);
    }
    return parts.length ? parts.join(', ') : 'normal';
  }

  // Axis readout, e.g. "wght 300–900 · opsz 9–144 · SOFT 0–100 · italic"
  function axisSummary(font) {
    var bits = [];
    if (font.wght) bits.push('wght ' + font.wght[0] + '–' + font.wght[1]);
    if (font.opsz) bits.push('opsz ' + font.opsz[0] + '–' + font.opsz[1]);
    if (font.soft) bits.push('SOFT ' + font.soft[0] + '–' + font.soft[1]);
    if (font.ital) bits.push('italic');
    if (!bits.length) bits.push('static · ' + (font.weight || [400]).join(' · '));
    return bits.join(' · ');
  }

  // One specimen block: the name at size, then a weight ladder, then a
  // paragraph set in the face.
  function renderSpecimen(font) {
    var ws = weightsFor(font);
    var ladder = ws.map(function (w) {
      return '<div class="fv__ladder-row">' +
        '<span class="fv__w">' + w + '</span>' +
        '<span class="fv__sample" style="font-family:' + font.stack +
          ';font-variation-settings:' + fvs(font, { weight: w }) +
          (font.variable ? '' : ';font-weight:' + w) +
          (font.ital ? ';font-style:normal' : '') + '">' +
        esc(SPECIMEN) + '</span></div>';
    }).join('');

    var italic = font.ital
      ? '<div class="fv__ladder-row"><span class="fv__w">it</span>' +
        '<span class="fv__sample fv__sample--italic" style="font-family:' + font.stack + '">' +
        esc(SPECIMEN) + '</span></div>'
      : '';

    return '<article class="fv__card" id="f-' + font.id + '" data-font="' + esc(font.id) + '">' +
      '<div class="fv__head">' +
        '<h2 class="fv__name" style="font-family:' + font.stack + '">' + esc(font.name) + '</h2>' +
        '<span class="fv__role">' + esc(font.role) + '</span>' +
      '</div>' +
      '<div class="fv__axes">' + esc(axisSummary(font)) + '</div>' +
      (font.note ? '<p class="fv__note">' + esc(font.note) + '</p>' : '') +
      '<div class="fv__ladder">' + ladder + italic + '</div>' +
      '<p class="fv__para" style="font-family:' + font.stack + ';font-variation-settings:' +
        fvs(font, { weight: 400 }) + '">Pack the video with the song. Read it from across the ' +
        'room — a 9×3 sheet of ornament glyphs, displaced under evolving noise, rolling one ' +
        'step at a time through the series.</p>' +
      '<code class="fv__stack">' + esc(font.stack.split(',')[0]) + '</code>' +
      '</article>';
  }

  // --- live specimen (hero) -------------------------------------------------
  // One big line whose face, size, weight, optical size, slant and tracking
  // are all live. This is the part that answers "what does the axis actually
  // do" — a static ladder can't show the in-between values.

  function mountSpecimen(host, opts) {
    opts = opts || {};
    if (!host) return null;

    var state = {
      fontId: opts.fontId || FONTS[0].id,
      size: opts.size || 96,
      weight: opts.weight || 400,
      opsz: opts.opsz != null ? opts.opsz : (FONTS[0].opsz ? 72 : null),
      soft: FONTS[0].soft ? 0 : null,
      tracking: 0,
      italic: false,
      text: SPECIMEN,
    };

    var line = document.createElement('div');
    line.className = 'fv__live-line';
    line.setAttribute('role', 'img');
    line.setAttribute('aria-live', 'polite');

    var meta = document.createElement('div');
    meta.className = 'fv__live-meta';

    function font() {
      for (var i = 0; i < FONTS.length; i++) if (FONTS[i].id === state.fontId) return FONTS[i];
      return FONTS[0];
    }

    function paint() {
      var f = font();
      line.style.fontFamily = f.stack;
      line.style.fontSize = state.size + 'px';
      // Variable faces take weight through font-variation-settings; static
      // faces need the legacy property, and clamp to what they actually ship.
      if (f.variable) {
        line.style.fontVariationSettings = fvs(f, state);
        line.style.fontWeight = 'normal';
      } else {
        line.style.fontVariationSettings = 'normal';
        var avail = f.weight || [400];
        var w = state.weight;
        line.style.fontWeight = avail.indexOf(w) === -1
          ? avail.reduce(function (a, b) { return Math.abs(b - w) < Math.abs(a - w) ? b : a; })
          : w;
      }
      if (f.opsz) line.style.fontVariationSettings = fvs(f, state);
      line.style.fontStyle = state.italic && f.ital ? 'italic' : 'normal';
      line.style.letterSpacing = state.tracking + 'px';
      line.textContent = state.text || SPECIMEN;

      var bits = [f.name, state.size + 'px'];
      bits.push('wght ' + (f.variable ? state.weight : line.style.fontWeight));
      if (f.opsz) bits.push('opsz ' + state.opsz);
      if (f.soft) bits.push('SOFT ' + state.soft);
      if (state.italic && f.ital) bits.push('italic');
      if (state.tracking) bits.push('track ' + state.tracking + 'px');
      meta.textContent = bits.join(' · ');
      host.setAttribute('data-live-font', f.id);
    }

    function set(patch) {
      for (var k in patch) if (Object.prototype.hasOwnProperty.call(patch, k)) state[k] = patch[k];
      paint();
      if (typeof opts.onChange === 'function') opts.onChange(state, font());
    }

    host.appendChild(line);
    host.appendChild(meta);
    paint();

    return { set: set, state: state, paint: paint };
  }

  window.SWR_FONTS = {
    FONTS: FONTS,
    SPECIMEN: SPECIMEN,
    renderSpecimen: renderSpecimen,
    mountSpecimen: mountSpecimen,
    weightsFor: weightsFor,
    axisSummary: axisSummary,
    fvs: fvs,
  };
})();