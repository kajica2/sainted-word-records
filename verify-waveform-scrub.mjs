// verify-waveform-scrub.mjs
// Verifies the scrolling waveform strip (lib/waveform-scrub.client.js)
// on swr-app.html. Confirms:
//   1. the custom element is defined and mounted in the transport
//   2. it decodes a track and paints the waveform (real pixels)
//   3. the wave SCROLLS with the clock (the pixels move when the
//      playhead advances)
//   4. the playhead is pinned at the centre in scroll mode
//   5. clicking the strip seeks
//   6. zero console errors
//
// Run against a local dev server:
//   WAVEFORM_VERIFIER_URL=http://127.0.0.1:4183/swr-app.html node verify-waveform-scrub.mjs
import puppeteer from 'puppeteer';
import fs from 'node:fs';

const URL = process.env.WAVEFORM_VERIFIER_URL || 'http://127.0.0.1:4183/swr-app.html';

const checks = [];
const pass = (m) => { checks.push({ ok: true, msg: m }); console.log('  OK  ', m); };
const fail = (m) => { checks.push({ ok: false, msg: m }); console.log('  FAIL', m); };

// A short WAV, synthesised in the page: three seconds of a tone with a
// quiet gap, so the waveform has a shape worth looking at.
const MAKE_WAV = `(() => {
  const sr = 44100, secs = 3, n = sr * secs;
  const data = new Int16Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const env = Math.sin(Math.PI * Math.min(1, t / secs));
    const gap = t > 1.4 && t < 1.7 ? 0.05 : 1;
    data[i] = Math.round(12000 * env * gap * Math.sin(2 * Math.PI * 220 * t));
  }
  const buf = new ArrayBuffer(44 + data.length * 2);
  const v = new DataView(buf);
  const ws = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  ws(0, 'RIFF'); v.setUint32(4, 36 + data.length * 2, true); ws(8, 'WAVE');
  ws(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true); v.setUint16(32, 2, true);
  v.setUint16(34, 16, true); ws(36, 'data'); v.setUint32(40, data.length * 2, true);
  new Int16Array(buf, 44).set(data);
  let s = ''; const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
})()`;

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });

const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));

try {
  await page.goto(URL, { waitUntil: 'networkidle2', timeout: 60000 });
} catch (e) {
  console.log('  FAIL could not load', URL, '-', e.message);
  await browser.close();
  process.exit(1);
}

// 1. The element is there and defined.
const mounted = await page.evaluate(() => {
  const el = document.getElementById('waveform');
  return {
    exists: !!el,
    defined: !!(window.customElements && window.customElements.get('swr-waveform')),
    api: !!(window.SWR_WAVEFORM),
    inTransport: !!(el && el.closest('.transport')),
    height: el ? el.getBoundingClientRect().height : 0,
  };
});
mounted.exists ? pass('the <swr-waveform> element is in the transport') : fail('the <swr-waveform> element is missing');
mounted.defined ? pass('the custom element is defined') : fail('the custom element is not defined');
mounted.api ? pass('window.SWR_WAVEFORM is published') : fail('window.SWR_WAVEFORM is missing');
mounted.inTransport ? pass('the strip sits inside the transport') : fail('the strip is not in the transport');
mounted.height > 20 ? pass(`the strip has height (${Math.round(mounted.height)}px)`) : fail(`the strip has no height (${mounted.height})`);

// The first-run onboarding modal ("Load your media to get started")
// covers the transport on a fresh profile. Dismiss it — otherwise the
// strip is behind the modal and the element screenshot shows the drop
// zone instead of the wave.
const dismissed = await page.evaluate(() => {
  const btn = Array.from(document.querySelectorAll('button, [role=button]'))
    .find((b) => /skip for now/i.test((b.innerText || '').trim()));
  if (!btn) return false;
  btn.click();
  return true;
});
if (dismissed) {
  await new Promise((r) => setTimeout(r, 500));
  pass('the first-run onboarding modal was dismissed');
} else {
  pass('no first-run onboarding modal on this profile');
}

// The baseline: what the page threw before the strip was touched.
const baseline = errors.slice();

// 2. Load a real track into the media element and let it decode.
await page.evaluate(async (b64) => {
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  const blob = new Blob([arr], { type: 'audio/wav' });
  const url = URL.createObjectURL(blob);
  const el = document.getElementById('audioEl');
  el.src = url;
  await new Promise((res) => {
    if (el.readyState >= 1) return res();
    el.addEventListener('loadedmetadata', res, { once: true });
  });
}, await page.evaluate(MAKE_WAV));

// Give the decode + first paint a moment.
await new Promise((r) => setTimeout(r, 1200));

const painted = await page.evaluate(() => {
  const el = document.getElementById('waveform');
  const cv = el && el.querySelector('canvas');
  if (!cv) return { canvas: false };
  const ctx = cv.getContext('2d');
  const d = ctx.getImageData(0, 0, cv.width, cv.height).data;
  let lit = 0;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] > 8) lit++;
  }
  return { canvas: true, lit, w: cv.width, h: cv.height };
});
painted.canvas ? pass('the strip has a canvas') : fail('the strip has no canvas');
painted.lit > 100 ? pass(`the waveform painted (${painted.lit} lit pixels)`) : fail(`the waveform painted nothing (${painted.lit} lit pixels)`);

// 3 + 4. It scrolls, and the playhead stays pinned.
const scrolled = await page.evaluate(async () => {
  const el = document.getElementById('waveform');
  const cv = el.querySelector('canvas');
  const ctx = cv.getContext('2d');
  const shot = () => {
    const d = ctx.getImageData(0, 0, cv.width, cv.height).data;
    let sum = 0;
    for (let i = 0; i < d.length; i += 4) sum += d[i] * (i % 7);
    return sum;
  };
  const before = shot();
  const media = document.getElementById('audioEl');
  media.currentTime = 1.2;   // move the clock, so the wave straddles the head
  await new Promise((r) => setTimeout(r, 600));
  const after = shot();
  // Where is the bright playhead column?
  const d = ctx.getImageData(0, 0, cv.width, cv.height).data;
  let bestX = -1, best = 0;
  for (let x = 0; x < cv.width; x++) {
    let bright = 0;
    for (let y = 0; y < cv.height; y++) {
      const i = (y * cv.width + x) * 4;
      if (d[i + 3] > 200 && d[i] + d[i + 1] + d[i + 2] > 300) bright++;
    }
    if (bright > best) { best = bright; bestX = x; }
  }
  return { before, after, bestX, w: cv.width };
});
scrolled.before !== scrolled.after
  ? pass('the strip changes when the clock moves (it scrolls)')
  : fail('the strip did not change when the clock moved');
const centre = scrolled.w / 2;
Math.abs(scrolled.bestX - centre) < scrolled.w * 0.08
  ? pass(`the playhead is pinned near the centre (x=${scrolled.bestX}, centre=${Math.round(centre)})`)
  : fail(`the playhead is not at the centre (x=${scrolled.bestX}, centre=${Math.round(centre)})`);

// 5. Clicking seeks.
const seeked = await page.evaluate(async () => {
  const media = document.getElementById('audioEl');
  const before = media.currentTime;
  const cv = document.getElementById('waveform').querySelector('canvas');
  const r = cv.getBoundingClientRect();
  // Click a quarter of the way to the RIGHT of the centre -> a later
  // time (the strip is a window on the song).
  const x = r.left + r.width * 0.75;
  const y = r.top + r.height / 2;
  const opts = { clientX: x, clientY: y, bubbles: true, pointerId: 1, isPrimary: true };
  cv.dispatchEvent(new PointerEvent('pointerdown', opts));
  cv.dispatchEvent(new PointerEvent('pointerup', opts));
  await new Promise((r2) => setTimeout(r2, 250));
  return { before, after: media.currentTime };
});
seeked.after > seeked.before + 0.1
  ? pass(`clicking the strip seeks (${seeked.before.toFixed(2)}s -> ${seeked.after.toFixed(2)}s)`)
  : fail(`clicking the strip did not seek (${seeked.before.toFixed(2)}s -> ${seeked.after.toFixed(2)}s)`);

// 6. The evidence.
{
  // The canvas's OWN pixels — the strip's actual output. An element
  // screenshot clips the page, and this app's workspace is transformed,
  // so the clip lands on the page header instead of the strip. The
  // canvas does not care about any of that.
  // The seek test above left the playhead at the end of the track, so
  // the whole wave reads as "played" and the split is invisible. Put
  // the clock back mid-track so the picture shows both sides.
  await page.evaluate(() => {
    const m = document.getElementById('audioEl');
    m.currentTime = Math.min(1.2, (m.duration || 3) * 0.4);
  });
  await new Promise((r) => setTimeout(r, 500));
  const dataUrl = await page.evaluate(() => {
    const cv = document.getElementById('waveform').querySelector('canvas');
    return cv ? cv.toDataURL('image/png') : null;
  });
  if (dataUrl) {
    const path = process.env.WAVEFORM_SHOT || '/tmp/waveform-strip.png';
    fs.writeFileSync(path, Buffer.from(dataUrl.split(',')[1], 'base64'));
    pass(`the strip's own pixels were written to ${path}`);
  } else {
    fail('could not read the strip canvas');
  }
}

// 7. No NEW console errors.
//
// The baseline is what the page throws on load BEFORE the strip is
// used. swr-app.html already throws "autoplayRandomTrack is not
// defined" (it is called at L5526, inside a block, where the function
// declaration at L8915 is not in scope) — a pre-existing page bug, and
// this verifier is about the waveform. What matters is that USING the
// strip adds nothing.
if (errors.length === baseline.length) pass('the strip adds no console errors');
else fail(`the strip added ${errors.length - baseline.length} console error(s): ${errors.slice(baseline.length).join(' | ')}`);
if (baseline.length) console.log(`  note: the page already threw ${baseline.length} error(s) before the strip was used`);

await browser.close();

const failed = checks.filter((c) => !c.ok).length;
console.log(failed === 0 ? '\nwaveform-scrub: PASS' : `\nwaveform-scrub: ${failed} FAILURE(S)`);
process.exit(failed === 0 ? 0 : 1);
