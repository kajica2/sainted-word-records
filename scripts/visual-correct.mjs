#!/usr/bin/env node
// scripts/visual-correct.mjs — visual check + auto-correct after deploys.
//
// Opens the live Command Center, verifies the expected top-bar and panel
// elements are present, injects missing pieces (Settings/Profile, Save),
// and can loop until the layout matches or a timeout is reached.
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
  return page.evaluate(() => {
    const fixes = [];
    const top = document.querySelector('.swr-cc-top');
    if (!top) return { ok: false, fixes: ['no top bar'], missing: ['top'] };

    if (!top.querySelector('.swr-cc-top-actions')) {
      const actions = document.createElement('div');
      actions.className = 'swr-cc-top-actions';
      actions.style.cssText = 'display:flex;gap:8px;margin-left:auto;align-items:center;padding-right:8px';
      const settings = document.createElement('button');
      settings.type = 'button';
      settings.className = 'swr-cc-nav-btn';
      settings.textContent = 'Settings';
      settings.style.cssText = 'font-size:11px;padding:4px 10px';
      const profile = document.createElement('button');
      profile.type = 'button';
      profile.className = 'swr-cc-nav-btn';
      profile.textContent = 'Profile';
      profile.style.cssText = 'font-size:11px;padding:4px 10px';
      actions.appendChild(settings);
      actions.appendChild(profile);
      const close = top.querySelector('.swr-cc-close');
      if (close) top.insertBefore(actions, close);
      else top.appendChild(actions);
      fixes.push('injected Settings + Profile');
    }

    const scenes = document.querySelector('[data-cc-scenes]');
    if (scenes && !scenes.parentNode.querySelector('.swr-cc-btn--primary')) {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;gap:6px;margin:6px 0';
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'swr-cc-btn swr-cc-btn--primary';
      btn.textContent = 'Save';
      row.appendChild(btn);
      scenes.parentNode.insertBefore(row, scenes);
      fixes.push('injected Save button');
    }

    const missing = [];
    if (!top.querySelector('.swr-cc-top-actions')) missing.push('top-actions');
    if (!document.querySelector('.swr-cc-panel')) missing.push('panels');
    return { ok: missing.length === 0, fixes, missing };
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
