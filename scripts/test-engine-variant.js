#!/usr/bin/env node
/**
 * Engine Smoke Test - Variant Dropdown
 * Tests that the engine loads and variant dropdown works
 * 
 * Run: node scripts/test-engine-variant.js
 */

import puppeteer from 'puppeteer';

const URL = process.env.ENGINE_URL || 'http://localhost:5174/engine';

async function test() {
  console.log(`\n🧪 Engine Variant Test`);
  console.log(`   URL: ${URL}\n`);
  
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox']
  });
  
  const page = await browser.newPage();
  
  const errors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  
  await page.goto(URL, { waitUntil: 'networkidle0', timeout: 30000 });
  await page.waitForSelector('#variant', { timeout: 10000 });
  
  const result = await page.evaluate(() => {
    const select = document.getElementById('variant');
    const options = Array.from(select.options).map(o => o.textContent);
    const variantCount = options.length - 1; // exclude "none"
    
    return {
      variantCount,
      options,
      hasSWR_VARIANTS: typeof window.SWR_VARIANTS !== 'undefined'
    };
  });
  
  console.log(`📋 Variants: ${result.variantCount}`);
  console.log(`   Options: ${result.options.join(', ')}`);
  console.log(`   SWR_VARIANTS loaded: ${result.hasSWR_VARIANTS ? '✅' : '❌'}`);
  
  if (errors.length > 0) {
    console.log(`\n⚠️  Console errors (non-blocking):`);
    errors.forEach(e => console.log(`   ${e.slice(0, 80)}`));
  }
  
  // Test variant activation
  console.log(`\n🧪 Testing variant activation...`);
  
  const testResult = await page.evaluate(async () => {
    try {
      await window.SWR_VARIANTS.activate('neon');
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });
  
  console.log(`   Activate 'neon': ${testResult.success ? '✅' : '❌'}`);
  if (!testResult.success) {
    console.log(`   Error: ${testResult.error}`);
  }
  
  await browser.close();
  
  // Pass if we have variants and can activate
  const passed = result.variantCount > 0 && testResult.success;
  
  console.log(`\n${passed ? '✅ PASS' : '❌ FAIL'}: Engine variant dropdown functional\n`);
  
  process.exit(passed ? 0 : 1);
}

test().catch(err => {
  console.error('❌ Test error:', err.message);
  process.exit(1);
});
