import puppeteer from 'puppeteer';
const B = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox','--use-gl=swiftshader','--enable-webgl','--autoplay-policy=no-user-gesture-required'] });
const P = await B.newPage();
await P.setViewport({ width: 900, height: 600 });
const errs = [];
P.on('pageerror', e => errs.push('PAGEERR: '+e.message));
P.on('console', m => { if (m.type()==='error') errs.push('CONSOLE: '+m.text()); });
await P.goto('http://localhost:4173/engine.html', { waitUntil: 'networkidle2', timeout: 30000 }).catch(async()=>{
  await P.goto('file://'+process.cwd()+'/dist/engine/index.html', { waitUntil: 'networkidle2' });
});
await new Promise(r => setTimeout(r, 1500));
const res = await P.evaluate(async () => {
  // Load a real large photo into a layer, then sample the stage for non-blank pixels.
  const img = new Image();
  img.src = '/default-library/holo-0.webp';
  await new Promise(r => { img.onload = r; img.onerror = r; });
  const asset = { id:'t', type:'image', name:'t', url: img.src, w: img.naturalWidth, h: img.naturalHeight, _el: img, rotation: 0 };
  const L = window.Layers; if (!L || !L.add) return { err: 'no Layers.add' };
  L.add(asset);
  const layer = L.list[L.list.length - 1];
  if (!layer) return { err: 'add() did not push a layer' };
  layer.opacity = 1; layer.reactors = []; layer.modulators = []; layer.baseScale = 1;
  await new Promise(r => setTimeout(r, 700)); // let a few frames draw
  const stage = document.getElementById('render');
  if (!stage) return { err: 'no #render canvas', canvases: [...document.querySelectorAll('canvas')].map(c=>c.id||'(anon)') };
  const g = stage.getContext('2d');
  const d = g.getImageData(0, 0, stage.width, stage.height).data;
  // measure variance: a blank/uniform frame has ~0 variance
  let min=255, max=0; const seen = new Set();
  for (let i=0;i<d.length;i+=4){ const l=d[i]; if(l<min)min=l; if(l>max)max=l; seen.add(l); }
  const scaledBuilt = !!(layer.asset && layer.asset._scaled);
  const scaledIsCanvas = scaledBuilt && layer.asset._scaled.tagName === 'CANVAS';
  return { nw: img.naturalWidth, nh: img.naturalHeight, distinct: seen.size, min, max,
           spread: max-min, scaledBuilt, scaledIsCanvas,
           scaledW: layer.asset._scaled ? (layer.asset._scaled.width||layer.asset._scaled.naturalWidth) : null };
});
console.log(JSON.stringify(res, null, 2));
console.log('ERRORS:', errs.length ? errs.slice(0,5) : 'none');
// A drawn photo must have many distinct luminances and real spread.
const ok = res.spread > 40 && res.distinct > 30 && !res.err;
console.log(ok ? 'IMG-DRAW: PASS (photo rendered non-blank)' : 'IMG-DRAW: FAIL');
await B.close();
process.exit(ok && errs.length===0 ? 0 : 1);
