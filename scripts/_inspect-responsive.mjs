// scripts/_inspect-responsive.mjs — measure swr-app.html at 4 viewports
import puppeteer from 'puppeteer';

const URL = 'http://localhost:8094/swr-app.html';
const VIEWPORTS = [
  { name: 'desktop-1440', w: 1440, h: 900 },
  { name: 'tablet-900',   w: 900,  h: 1200 },
  { name: 'mobile-414',   w: 414,  h: 896 },
  { name: 'mobile-small', w: 360,  h: 740 },
];

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
try {
  for (const v of VIEWPORTS) {
    const page = await browser.newPage();
    await page.setViewport({ width: v.w, height: v.h, deviceScaleFactor: 1 });
    await page.goto(URL + '?cb=' + Date.now(), { waitUntil: 'networkidle0', timeout: 30000 });
    await page.evaluate(() => {
      const btn = document.querySelector('button[data-onboard="dismiss"]');
      if (btn) btn.click();
    });
    await new Promise(r => setTimeout(r, 600));
    const summary = await page.evaluate(() => {
      const winW = window.innerWidth;
      const docW = document.documentElement.scrollWidth;
      const overflowX = docW > winW;
      const measure = (sel) => {
        const el = document.querySelector(sel);
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { w: Math.round(r.width), h: Math.round(r.height), x: Math.round(r.x), y: Math.round(r.y) };
      };
      const tabScrollers = Array.from(document.querySelectorAll('.tabs, .lib-toolbar, .tabpanel, .stage__viewport'))
        .filter(e => e.scrollWidth > e.clientWidth + 2)
        .map(e => `${e.tagName.toLowerCase()}.${(e.className||'').toString().slice(0,30)}: ${e.scrollWidth}px > ${e.clientWidth}px`)
        .slice(0, 6);
      // detect any element wider than viewport
      const tooWide = Array.from(document.querySelectorAll('body *'))
        .filter(e => {
          const r = e.getBoundingClientRect();
          return r.width > winW + 4 && r.width < 99999;
        })
        .map(e => `${e.tagName.toLowerCase()}.${(e.className||'').toString().slice(0,30)}: ${Math.round(e.getBoundingClientRect().width)}px`)
        .slice(0, 10);
      return {
        winW, docW, overflowX,
        pageHeight: document.documentElement.scrollHeight,
        engine:    measure('.engine'),
        stage:     measure('.stage__viewport'),
        sidebar:   measure('.engine__sidebar'),
        transport: measure('.transport'),
        tabbar:    measure('#engineTabs'),
        nav:       measure('.nav'),
        tabScrollers,
        tooWide,
      };
    });
    console.log('\n===', v.name, `(${v.w}x${v.h}) ===`);
    console.log('overflowX:', summary.overflowX, 'pageHeight:', summary.pageHeight);
    console.log('engine:', summary.engine);
    console.log('stage:', summary.stage);
    console.log('sidebar:', summary.sidebar);
    console.log('transport:', summary.transport);
    console.log('tabbar:', summary.tabbar);
    console.log('nav:', summary.nav);
    if (summary.tooWide.length) {
      console.log('TOO WIDE ELEMENTS:', summary.tooWide);
    }
    if (summary.tabScrollers.length) {
      console.log('H-SCROLLERS:', summary.tabScrollers);
    }
    await page.close();
  }
} finally {
  await browser.close();
}
