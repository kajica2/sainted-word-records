// Replace the deterministic `[i%N]` blend picks in the remap function with
// a per-remap shuffled array, so each RE-MAP click produces a different look.
import fs from 'fs';
const versions = ['neon', 'film', 'grid', 'smoke', 'hallucination'];

// Match the remap() block's layer creation. The exact line varies by version,
// so we capture the blend array from inside the remap() function specifically.
// Strategy: find the `this.list.push({` block that uses an array literal
// (the remap version), and rewrite the `[i%N]` to use a shuffled order.
const versionsData = {
  neon:  { old: `id:'L'+(i+1), asset: it, blend:['screen','lighter','difference','overlay','multiply','screen'][i%6],`,
           arr: `['screen','lighter','difference','overlay','multiply','screen']` },
  film:  { old: `id:'L'+(i+1), asset: it, blend:['source-over','multiply','overlay','soft-light','source-over','overlay'][i%6],`,
           arr: `['source-over','multiply','overlay','soft-light','source-over','overlay']` },
  grid:  { old: `id:'L'+(i+1), asset: assignments[i], cell: cells[i%cells.length],`,
           arr: null, grid: true },
  smoke: { old: `id:'L'+(i+1), asset: assignments[i], blend:['screen','soft-light','overlay','soft-light','screen','overlay'][i%6],`,
           arr: `['screen','soft-light','overlay','soft-light','screen','overlay']` },
  hallucination: { old: `id:'L'+(i+1), asset: assignments[i], blend:['lighter','difference','screen','multiply','lighter','difference'][i%6],`,
           arr: `['lighter','difference','screen','multiply','lighter','difference']` },
};

for (const [v, d] of Object.entries(versionsData)) {
  const p = `/Users/kajicadjuric/Documents/autodashboard/products/sainted-word-records/versions/${v}.html`;
  let html = fs.readFileSync(p, 'utf8');
  if (!html.includes(d.old)) {
    console.log(`  ${v}.html: pattern not found`);
    continue;
  }
  if (d.grid) {
    // Grid uses 'cells' not 'blend' — shuffle the cells array per remap
    const cellsMatch = html.match(/const cells = \[([^\]]+)\]/);
    if (cellsMatch) {
      // Inject a shuffled cells array right before the remap function
      const old = `const cells = [${cellsMatch[1]}];`;
      const nu = `let _cells_cache = null;\n        function _shuffledCells() {\n          if (!_cells_cache) {\n            _cells_cache = [${cellsMatch[1]}];\n            for (let i = _cells_cache.length - 1; i > 0; i--) {\n              const j = Math.floor(Math.random() * (i + 1));\n              [_cells_cache[i], _cells_cache[j]] = [_cells_cache[j], _cells_cache[i]];\n            }\n          }\n          _cells_cache.push(_cells_cache.shift());\n          return _cells_cache;\n        }\n        const cells = [${cellsMatch[1]}];`;
      html = html.replace(old, nu);
      // Now update the cells[i%cells.length] to use shuffledCells()
      html = html.replace(/cells\[i%cells\.length\]/g, '_shuffledCells()[i%6]');
      console.log(`  ${v}.html: cells shuffled per remap`);
    }
    fs.writeFileSync(p, html);
    continue;
  }
  // We can't compute a real shuffle at build time, so inject a runtime shuffle
  // that runs once per remap().
  const newCode = d.old.replace(
    d.arr + '[i%6]',
    `(__shuffle_once('${v}',[${d.arr.slice(1,-1)}]))[i%6]`
  );
  // Inject the helper at the top of the IIFE if not present
  if (!html.includes(`function __shuffle_once`)) {
    html = html.replace(
      /(<script>)/,
      `$1\n    function __shuffle_once(key, arr) {\n      if (!__shuffle_once._cache || __shuffle_once._key !== key) {\n        const a = arr.slice();\n        for (let i = a.length - 1; i > 0; i--) {\n          const j = Math.floor(Math.random() * (i + 1));\n          [a[i], a[j]] = [a[j], a[i]];\n        }\n        __shuffle_once._cache = a;\n        __shuffle_once._key = key;\n      }\n      __shuffle_once._cache.push(__shuffle_once._cache.shift());\n      return __shuffle_once._cache;\n    }\n`
    );
  }
  html = html.replace(d.old, newCode);
  fs.writeFileSync(p, html);
  console.log(`  ${v}.html: blend shuffled per remap`);
}
console.log('done');
