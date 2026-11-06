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
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const PORT = 54042;
const LOCAL_BASE = `http://127.0.0.1:${PORT}`;
const BASE = process.env.CC_BASE_URL || LOCAL_BASE;
const EXTERNAL = !!process.env.CC_BASE_URL;
const VARIANT = process.env.CC_VARIANT || 'neon';
const LOOP = process.env.CC_LOOP === '1';
const MAX_MS = Number(process.env.CC_LOOP_MS || 300000);
const ARTIFACT_DIR = process.env.CC_ARTIFACT_DIR || 'artifacts/command-center';

function startServer() {
  return new Promise((resolve, reject) => {
    const proc = spawn('python3', ['-m', 'http.server', String(PORT)], {
      cwd: process.cwd(), stdio: 'ignore',
    });
    proc.once('error', reject);
    proc.once('exit', code => reject(new Error(`local server exited before readiness (${code})`)));
    const fail = message => { proc.kill(); reject(new Error(message)); };
    const start = Date.now();
    const tick = () => http.get(`${LOCAL_BASE}/versions/${VARIANT}.html`, (res) => {
      res.resume();
      if (res.statusCode === 200) return resolve(proc);
      if (Date.now() - start > 8000) return fail('server timeout');
      setTimeout(tick, 100);
    }).on('error', () => {
      if (Date.now() - start > 8000) return fail('server error');
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
  const target = `${BASE}/versions/${VARIANT}.html?cc=1`;
  console.log(`visual-correct → ${target}`);
  let server, browser, page;
  let result = null;
  let failure = null;
  let pass = 0;
  try {
    if (!EXTERNAL) server = await startServer();
    browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
    page = await browser.newPage();
    await page.setViewport({ width: 1600, height: 1000 });
    const start = Date.now();
    while (true) {
      pass++;
      await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForFunction(() => !!document.getElementById('swr-cc'), { timeout: 20000 }).catch(() => {});
      await new Promise(resolve => setTimeout(resolve, 2500));
      result = await checkAndCorrect(page);
      console.log(`pass ${pass}: missing: ${result.missing.join(', ') || 'none'}`);
      if (result.ok) break;
      if (!LOOP || Date.now() - start > MAX_MS) {
        process.exitCode = 1;
        break;
      }
      await new Promise(resolve => setTimeout(resolve, 15000));
    }
  } catch (error) {
    failure = error;
    process.exitCode = 1;
    console.error(error);
  } finally {
    // Capture evidence before closing Chrome. Diagnostics must not bypass cleanup.
    try {
      await mkdir(ARTIFACT_DIR, { recursive: true });
      if (page) {
        try {
          await page.screenshot({ path: join(ARTIFACT_DIR, 'command-center.png'), fullPage: true });
        } catch (error) {
          console.error('screenshot unavailable:', error.message);
        }
      }
      await writeFile(join(ARTIFACT_DIR, 'report.json'), JSON.stringify({
        target, commit: process.env.GITHUB_SHA || null,
        ok: !failure && result?.ok === true,
        passes: pass, missing: result?.missing || [],
        error: failure?.message || null,
      }, null, 2));
    } catch (error) {
      console.error('artifact capture failed:', error.message);
      process.exitCode = 1;
    } finally {
      try {
        if (browser) await browser.close();
      } catch (error) {
        console.error('browser cleanup failed:', error.message);
        process.exitCode = 1;
      } finally {
        if (server) server.kill();
      }
    }
  }
})();
