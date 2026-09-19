import puppeteer from 'puppeteer';

const URL = process.argv[2] || 'https://sainted-word-records.vercel.app/gallery/posters';
const QUIET_MS = 3500;

(async () => {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  const page = await browser.newPage();
  const consoleMsgs = [];
  const failed = [];

  page.on('console', (msg) => {
    if (msg.type() === 'error' || msg.type() === 'warning') {
      consoleMsgs.push({ type: msg.type(), text: msg.text() });
    }
  });
  page.on('pageerror', (err) => {
    consoleMsgs.push({ type: 'pageerror', text: err.message });
  });
  page.on('response', (res) => {
    if (res.status() >= 400 && res.status() < 600) {
      failed.push({ status: res.status(), url: res.url() });
    }
  });
  page.on('requestfailed', (req) => {
    failed.push({ status: 'failed', url: req.url(), reason: req.failure()?.errorText });
  });

  console.log(`\nVisiting: ${URL}\n`);
  try {
    await page.goto(URL, { waitUntil: 'networkidle2', timeout: 30000 });
  } catch (e) {
    console.log(`goto failed: ${e.message}`);
  }
  await new Promise((r) => setTimeout(r, QUIET_MS));

  console.log(`Title: ${await page.title()}\n`);

  console.log(`=== ${consoleMsgs.length} console messages ===`);
  consoleMsgs.forEach((m, i) => {
    console.log(`  [${i + 1}] [${m.type}] ${m.text.slice(0, 280)}`);
  });

  console.log(`\n=== ${failed.length} failed network requests ===`);
  failed.forEach((f, i) => {
    console.log(`  [${i + 1}] [${f.status}] ${f.url}${f.reason ? ' — ' + f.reason : ''}`);
  });

  // Check if <body> actually has visible content
  const stats = await page.evaluate(() => {
    const body = document.body;
    return {
      bodyChildren: body ? body.children.length : 0,
      bodyTextLength: body ? body.innerText.length : 0,
      bodyInnerHTMLLength: body ? body.innerHTML.length : 0,
      hasNav: !!document.querySelector('swr-nav'),
      hasCards: document.querySelectorAll('[class*="card"], [class*="gallery"]').length,
    };
  });
  console.log('\n=== DOM stats ===');
  console.log(JSON.stringify(stats, null, 2));

  await browser.close();
})();
