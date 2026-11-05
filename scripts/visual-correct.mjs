#!/usr/bin/env node
// scripts/visual-correct.mjs — read-only Command Center assertions.
//
// Checks the shipped DOM without injecting controls. Missing UI fails the run.
//
// Usage:
//   node scripts/visual-correct.mjs                  # one pass against local
//   CC_BASE_URL=https://... node scripts/visual-correct.mjs
//   CC_LOOP=1 node scripts/visual-correct.mjs        # loop until clean or 5 min

import puppeteer from 'puppeteer';
import http from 'node:http';
import { spawn } from 'node:child_process';

const PORT = 54042;
const LOCAL_BASE = `http://127.0.0.1:${PORT}`;
const BASE = process.env.CC_BASE_URL || LOCAL_BASE;
const EXTERNAL = !!process.env.CC_BASE_URL;
const VARIANT = process.env.CC_VARIANT || 'neon';
const LOOP = process.env.CC_LOOP === '1';
const MAX_MS = Number(process.env.CC_LOOP_MS || 300000);

function startServer() {
  return new Promise((resolve, reject) => {
    const proc = spawn('python3', ['-m', 'http.server', String(PORT)], {
      cwd: process.cwd(), stdio: 'ignore',
    });
    const start = Date.now();
    const tick = () => http.get(`${LOCAL_BASE}/versions/${VARIANT}.html`, (res) => {
      res.resume();
      if (res.statusCode === 200) return resolve(proc);
      if (Date.now() - start > 8000) return reject(new Error('server timeout'));
      setTimeout(tick, 100);
    }).on('error', () => {
      if (Date.now() - start > 8000) return reject(new Error('server error'));
      setTimeout(tick, 80);
    });
    setTimeout(tick, 100);
  });
}

async function checkAndCorrect(page) {
  // Observe the shipped DOM; never repair the page under test.
  return page.evaluate(() => {
    const missing = [];
    const top = document.querySelector('.swr-cc-top');
    if (!top) missing.push('top');
    const actions = top?.querySelector('.swr-cc-top-actions');
    if (!actions) missing.push('top-actions');
    const labels = Array.from(actions?.querySelectorAll('button') || [])
      .map(button => button.textContent.trim());
    if (!labels.includes('Settings')) missing.push('settings');
    if (!labels.includes('Profile')) missing.push('profile');
    if (!document.querySelector('.swr-cc-panel')) missing.push('panels');
    const scenes = document.querySelector('[data-cc-scenes]');
    if (!scenes) missing.push('scenes');
    const save = Array.from(scenes?.parentNode.querySelectorAll('button') || [])
      .some(button => /^save$/i.test(button.textContent.trim()));
    if (!save) missing.push('save');
    return { ok: missing.length === 0, fixes: [], missing };
  });
}

(async () => {
  console.log(`visual-correct → ${BASE}/versions/${VARIANT}.html?cc=1`);
  let server;
  if (!EXTERNAL) {
    try { server = await startServer(); }
    catch (e) { console.error('server boot failed', e.message); process.exit(1); }
  }

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 1000 });

  const start = Date.now();
  let pass = 0;
  while (true) {
    pass++;
    console.log(`\n--- pass ${pass} ---`);
    await page.goto(`${BASE}/versions/${VARIANT}.html?cc=1`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForFunction(() => !!document.getElementById('swr-cc'), { timeout: 20000 }).catch(() => {});
    await new Promise((r) => setTimeout(r, 2500));

    const result = await checkAndCorrect(page);
    console.log('fixes:', result.fixes.length ? result.fixes.join(', ') : 'none');
    console.log('missing:', result.missing.length ? result.missing.join(', ') : 'none');

    if (result.ok && result.fixes.length === 0) {
      console.log('layout clean — no corrections needed');
      break;
    }
    if (!LOOP || Date.now() - start > MAX_MS) {
      console.log(LOOP ? 'timeout reached' : 'single pass done');
      process.exitCode = 1;
      break;
    }
    console.log('waiting 15s before next pass…');
    await new Promise((r) => setTimeout(r, 15000));
  }

  await browser.close();
  if (server) server.kill();
  console.log('\ndone');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
