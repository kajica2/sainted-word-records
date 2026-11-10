/* global window */
(function () {
  const ALLOWED = new Set([
    'svg', 'g', 'path', 'rect', 'circle', 'ellipse', 'polygon', 'polyline', 'line',
    'defs', 'linearGradient', 'radialGradient', 'stop', 'title', 'desc', 'image',
  ]);

  function sanitizeSvgText(svgText) {
    const doc = new DOMParser().parseFromString(svgText, 'image/svg+xml');
    const root = doc.documentElement;
    if (root.localName !== 'svg' || doc.querySelector('parsererror')) {
      throw new Error('Invalid SVG');
    }
    for (const n of [...root.querySelectorAll('*')]) {
      if (!ALLOWED.has(n.localName)) {
        n.remove();
        continue;
      }
      for (const a of [...n.attributes]) {
        const name = a.name.toLowerCase();
        if (name.startsWith('on')) n.removeAttribute(a.name);
        if (/href|xlink:href/i.test(name) && !/^#/.test(a.value)) n.removeAttribute(a.name);
        if (/url\s*\(/i.test(a.value)) n.removeAttribute(a.name);
      }
    }
    return new XMLSerializer().serializeToString(root);
  }

  window.SWR_COLOR_TALES_SANITIZE = { sanitizeSvgText, ALLOWED };
})();
