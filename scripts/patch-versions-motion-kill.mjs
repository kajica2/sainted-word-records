#!/usr/bin/env node
// One-shot patcher: inject motion-kill-switch on every versions/*.html and gate canvas/CSS motion.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VERSIONS = path.join(ROOT, 'versions');
const KILL_TAG = '<script src="/lib/motion-kill-switch.client.js"></script>';
const KILL_MARK = 'motion-kill-switch.client.js';

const ROT_REPLACEMENTS = [
  [/ctx\.rotate\(([^)]+)\)/g, 'SWR_MOTION_KILL.gateRotate(ctx, $1)'],
  [/mainCtx\.rotate\(([^)]+)\)/g, 'SWR_MOTION_KILL.gateRotate(mainCtx, $1)'],
  [/_ctx\.rotate\(([^)]+)\)/g, 'SWR_MOTION_KILL.gateRotate(_ctx, $1)'],
  [/rc\.rotate\(([^)]+)\)/g, 'SWR_MOTION_KILL.gateRotate(rc, $1)'],
  [/pc\.rotate\(([^)]+)\)/g, 'SWR_MOTION_KILL.gateRotate(pc, $1)'],
  [/cx\.rotate\(([^)]+)\)/g, 'SWR_MOTION_KILL.gateRotate(cx, $1)'],
];

const SCALE_REPLACEMENTS = [
  [/ctx\.scale\((zoom,\s*zoom)\)/g, 'SWR_MOTION_KILL.gateScale(ctx, $1)'],
  [/ctx\.scale\((beatScale,\s*beatScale)\)/g, 'SWR_MOTION_KILL.gateScale(ctx, $1)'],
];

function injectKillSwitch(src) {
  if (src.includes(KILL_MARK)) return src;
  const bust = '<script src="/lib/app-version-bust.js"></script>';
  if (src.includes(bust)) {
    return src.replace(bust, bust + '\n  ' + KILL_TAG);
  }
  const relBust = '<script src="../lib/app-version-bust.js"></script>';
  if (src.includes(relBust)) {
    return src.replace(relBust, relBust + '\n  ' + KILL_TAG);
  }
  const head = '<head>';
  if (src.includes(head)) {
    return src.replace(head, head + '\n  ' + KILL_TAG);
  }
  return src;
}

function gateCanvasMotion(src) {
  let out = src;
  for (const [re, rep] of ROT_REPLACEMENTS) {
    out = out.replace(re, (match, ...args) => {
      if (match.includes('SWR_MOTION_KILL.gateRotate')) return match;
      return rep.replace('$1', args[0]);
    });
  }
  for (const [re, rep] of SCALE_REPLACEMENTS) {
    out = out.replace(re, (match) => {
      if (match.includes('SWR_MOTION_KILL.gateScale')) return match;
      return match.replace(/ctx\.scale\(/, 'SWR_MOTION_KILL.gateScale(ctx, ');
    });
  }
  // Double-gate guard
  out = out.replace(/SWR_MOTION_KILL\.gateRotate\([^,]+,\s*SWR_MOTION_KILL\.gateRotate/g, 'SWR_MOTION_KILL.gateRotate');
  return out;
}

function patchCleanEngine(src) {
  if (!src.includes('Clean Engine - CSS-only')) return src;
  if (src.includes('filterCssFxCatalog')) return src;
  const needle = 'const CSS_EFFECTS = [';
  const idx = src.indexOf(needle);
  if (idx < 0) return src;
  const insert =
    "      function filterCssEffects(list) {\n" +
    "        if (!window.SWR_MOTION_KILL || !SWR_MOTION_KILL.filterCssFxCatalog) return list;\n" +
    "        return SWR_MOTION_KILL.filterCssFxCatalog(list.map(function (n) { return { name: n || '' }; }))\n" +
    "          .map(function (e) { return e.name; });\n" +
    "      }\n\n      ";
  src = src.slice(0, idx) + insert + src.slice(idx);
  src = src.replace(
    /const CSS_EFFECTS = \[[\s\S]*?\];/,
    (block) => block.replace('];', '].slice();') + '\n      const CSS_EFFECTS = filterCssEffects(CSS_EFFECTS_RAW);',
  );
  src = src.replace('const CSS_EFFECTS = [', 'const CSS_EFFECTS_RAW = [');
  src = src.replace(
    "if (effect) {\n          preview.classList.add(effect);",
    "if (effect && (!window.SWR_MOTION_KILL || SWR_MOTION_KILL.isCssFxAllowed(effect))) {\n          preview.classList.add(effect);",
  );
  // Hide blocked <option> values
  src = src.replace(
    '</select>\n      </div>\n      \n      <div class="intensity-ctrl">',
    '</select>\n      </div>\n      \n      <div class="intensity-ctrl">',
  );
  if (!src.includes('swr-clean-effect-options')) {
    src = src.replace(
      "const timeDisplay = document.getElementById('time-display');",
      "const timeDisplay = document.getElementById('time-display');\n\n" +
      "      function syncEffectSelectOptions() {\n" +
      "        if (!window.SWR_MOTION_KILL) return;\n" +
      "        effectSelect.querySelectorAll('option').forEach(function (opt) {\n" +
      "          if (!opt.value) return;\n" +
      "          var ok = SWR_MOTION_KILL.isCssFxAllowed(opt.value);\n" +
      "          opt.disabled = !ok;\n" +
      "          opt.hidden = !ok;\n" +
      "        });\n" +
      "      }\n" +
      "      syncEffectSelectOptions();",
    );
  }
  return src;
}

function patchMtvTitleScale(src) {
  return src.replace(
    "title.style.transform = 'scale(' + (1 + beat * 0.05) + ')';",
    "title.style.transform = 'scale(' + (window.SWR_MOTION_KILL ? SWR_MOTION_KILL.cssZoomFactor(1 + beat * 0.05) : (1 + beat * 0.05)) + ')';",
  );
}

const htmlFiles = fs.readdirSync(VERSIONS).filter((f) => f.endsWith('.html')).sort();
let changed = 0;
for (const file of htmlFiles) {
  const fp = path.join(VERSIONS, file);
  let src = fs.readFileSync(fp, 'utf8');
  const before = src;
  src = injectKillSwitch(src);
  src = gateCanvasMotion(src);
  src = patchCleanEngine(src);
  src = patchMtvTitleScale(src);
  if (src !== before) {
    fs.writeFileSync(fp, src);
    console.log('patched', file);
    changed++;
  } else {
    console.log('unchanged', file);
  }
}
console.log('done:', changed, 'files changed');
