#!/usr/bin/env node
/**
 * Variant Dropdown Debug Test
 * Run: node scripts/debug-variant-dropdown.js
 */

import puppeteer from 'puppeteer';

const URL = 'http://localhost:5174/engine';

async function test() {
  console.log('🚀 Starting variant dropdown debug...\n');
  
  const browser = await puppeteer.launch({
    headless: false,
    args: ['--start-maximized']
  });
  
  const page = await browser.newPage();
  
  // Capture console messages
  page.on('console', msg => {
    const type = msg.type();
    if (type === 'error') {
      console.log(`❌ CONSOLE ERROR: ${msg.text()}`);
    }
  });
  
  // Capture page errors
  page.on('pageerror', err => {
    console.log(`❌ PAGE ERROR: ${err.message}`);
  });
  
  console.log(`📱 Opening: ${URL}`);
  await page.goto(URL, { waitUntil: 'networkidle0', timeout: 30000 });
  
  // Wait for variant switcher to load
  await page.waitForSelector('#variant', { timeout: 10000 });
  
  // Get all options in the variant dropdown
  const options = await page.evaluate(() => {
    const select = document.getElementById('variant');
    if (!select) return { error: 'Select not found' };
    
    const opts = Array.from(select.options).map(o => ({
      value: o.value,
      text: o.textContent
    }));
    
    return { 
      count: opts.length,
      options: opts
    };
  });
  
  console.log(`\n📋 Variant dropdown options: ${options.count}`);
  
  if (options.error) {
    console.log(`❌ ERROR: ${options.error}`);
  } else {
    options.options.forEach(o => {
      console.log(`   ${o.value === 'off' ? '—' : '●'} ${o.text}`);
    });
  }
  
  // Check if SWR_VARIANTS loaded
  const variantsLoaded = await page.evaluate(() => {
    return {
      exists: typeof window.SWR_VARIANTS !== 'undefined',
      hasActivate: typeof window.SWR_VARIANTS?.activate === 'function',
      hasList: typeof window.SWR_VARIANTS?.list === 'function',
      list: window.SWR_VARIANTS?.list ? window.SWR_VARIANTS.list() : null
    };
  });
  
  console.log(`\n🔧 SWR_VARIANTS status:`);
  console.log(`   Exists: ${variantsLoaded.exists ? '✅' : '❌'}`);
  console.log(`   has activate(): ${variantsLoaded.hasActivate ? '✅' : '❌'}`);
  console.log(`   has list(): ${variantsLoaded.hasList ? '✅' : '❌'}`);
  if (variantsLoaded.list) {
    console.log(`   Variants: ${variantsLoaded.list.join(', ')}`);
  }
  
  // Check for errors
  console.log(`\n✅ Test complete!`);
  
  await browser.close();
}

test().catch(err => {
  console.error('❌ Test failed:', err.message);
  process.exit(1);
});
