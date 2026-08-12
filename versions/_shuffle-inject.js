// Apply the "fresh look on every remap" randomization to the 5 versions.
import fs from 'fs';
import path from 'path';

const versions = ['neon', 'film', 'grid', 'smoke', 'hallucination'];

// Same patch for the remap() greedy pick (matches film/grid/smoke/hallucination format)
const OLD_REMAP_GREEDY = `        const used = new Set();
        const assignments = roles.map(r => {
          let best=null,bestS=-1;
          for (const s of scored) { if (used.has(s.it.id)) continue;
            const v = s.sc[r.want] * r.weight; if (v>bestS) { bestS=v; best=s.it; } }
          if (best) used.add(best.id);
          return best;
        });`;

const NEW_REMAP_GREEDY = `        // Pick from top-N candidates randomly so each remap = fresh look
        const topN = 2 + (Math.floor(Math.random()*2)); // 2 or 3
        const used = new Set();
        const assignments = roles.map(r => {
          const cands = [];
          for (const s of scored) { if (used.has(s.it.id)) continue;
            cands.push({ it: s.it, v: s.sc[r.want] * r.weight }); }
          if (!cands.length) return null;
          cands.sort((a,b) => b.v - a.v);
          const pool = cands.slice(0, Math.min(topN, cands.length));
          const total = pool.reduce((s,c) => s + Math.max(c.v, 0.01), 0);
          let r2 = Math.random() * total;
          let pick = pool[0];
          for (const c of pool) { r2 -= Math.max(c.v, 0.01); if (r2 <= 0) { pick = c; break; } }
          used.add(pick.it.id);
          return pick.it;
        });`;

for (const v of versions) {
  const p = `/Users/kajicadjuric/Documents/autodashboard/products/sainted-word-records/versions/${v}.html`;
  let html = fs.readFileSync(p, 'utf8');
  if (!html.includes(OLD_REMAP_GREEDY)) {
    console.log(`  ${v}.html: greedy pattern not found — manual fix needed`);
    continue;
  }
  html = html.replace(OLD_REMAP_GREEDY, NEW_REMAP_GREEDY);
  fs.writeFileSync(p, html);
  console.log(`  ${v}.html: remap randomized`);
}
console.log('done');
