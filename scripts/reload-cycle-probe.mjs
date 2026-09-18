// Onboarding matrix: which overlay blocks clicks, across visits + flag states.
// Usage: node scripts/reload-cycle-probe.mjs   (ENG_BASE env to target prod)
import puppeteer from 'puppeteer';

const BASE = process.env.ENG_BASE || 'http://localhost:4173';
const URL = `${BASE}/engine.html`;

const browser = await puppeteer.launch({
  headless: 'new',
  args: ['--no-sandbox', ''],
});
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
page.on('pageerror', (e) => console.log('  PAGEERROR:', e.message.slice(0, 150)));

const state = async (label) => {
  const r = await page.evaluate(() => {
    const btn = document.getElementById('play');
    let topAtPlay = null;
    if (btn) {
      const rc = btn.getBoundingClientRect();
      const t = document.elementFromPoint(rc.x + rc.width / 2, rc.y + rc.height / 2);
      topAtPlay = t ? (t.id || t.className || t.tagName).toString().slice(0, 30) : null;
    }
    const panel = document.getElementById('swr-onboard');
    const tour = document.getElementById('swr-onboard-tour');
    return {
      flag: (() => { try { return localStorage.getItem('swr.onboarded.v1') ? 'SET' : 'unset'; } catch (e) { return 'err'; } })(),
      persona: !!document.getElementById('persona-onboarding-modal'),
      panel: panel ? (panel.hidden ? 'hidden' : (panel.classList.contains('is-open') ? 'OPEN' : 'closing')) : 'absent',
      tour: tour ? 'opacity=' + (getComputedStyle(tour).opacity) : 'absent',
      tourState: window.SWR_ONBOARD_HF ? window.SWR_ONBOARD_HF.state() : 'n/a',
      topAtPlay,
      playLabel: btn ? btn.textContent.trim() : null,
      paused: (window.Audio && window.Audio.audioEl) ? window.Audio.audioEl.paused : null,
    };
  });
  console.log(`  [${label}] ${JSON.stringify(r)}`);
  return r;
};

console.log('═══ VISIT 1 (fresh) ═══');
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
await new Promise((r) => setTimeout(r, 2000)); await state('t=2s');
await new Promise((r) => setTimeout(r, 3000)); await state('t=5s');
await page.screenshot({ path: '/tmp/eng-matrix-v1-5s.png' });

// Exercise the tour's SKIP path while it is still playing (the fix under
// test): skipping must persist the dismissal flag exactly like Esc does.
if (await page.$('#swr-hf-skip')) {
  await page.click('#swr-hf-skip').catch((e) => console.log('  tour skip err:', e.message.slice(0, 90)));
  await new Promise((r) => setTimeout(r, 700));
  await state('after tour skip (flag must read SET)');
} else {
  await page.keyboard.press('Escape');
  await new Promise((r) => setTimeout(r, 600));
}
// Then the persona modal, then the panel if still open.
if (await page.$('#persona-onboarding-modal')) {
  await page.click('[data-action="skip"]').catch((e) => console.log('  persona skip err:', e.message.slice(0, 90)));
  await new Promise((r) => setTimeout(r, 600));
}
// Close the panel via its API: a coordinate-click on the backdrop's center
// lands on the (topmost) panel body instead — selector clicks here are a
// hit-testing trap. The panel exposes window.SWR_ONBOARD.close().
await page.evaluate(() => { if (window.SWR_ONBOARD && window.SWR_ONBOARD.close) window.SWR_ONBOARD.close(); });
await new Promise((r) => setTimeout(r, 700));
await state('after dismissals');
await page.click('#play').catch((e) => console.log('  play click err:', e.message.slice(0, 90)));
await new Promise((r) => setTimeout(r, 2000)); await state('after play click');

console.log('\n═══ VISIT 2 (reload, no autoplay flag) ═══');
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
await new Promise((r) => setTimeout(r, 5000));
await state('boot+5s');
for (let c = 1; c <= 3; c++) {
  await page.click('#play').catch((e) => console.log('  click err:', e.message.slice(0, 80)));
  await new Promise((r) => setTimeout(r, 1800));
  await state(`after click #${c}`);
}
await browser.close();
