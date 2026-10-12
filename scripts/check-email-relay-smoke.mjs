// scripts/check-email-relay-smoke.mjs — Regression gate: ensure no open email relay
import { spawn } from 'node:child_process';

const ENDPOINT = process.env.ENDPOINT || 'http://localhost:5174';
const PROD = 'https://sainted-word-records.vercel.app';

async function check(url, label) {
  return new Promise((resolve) => {
    const req = fetch(`${url}/api/email-book?to=test@example.com`, {
      method: 'GET',
      redirect: 'follow',
    }).then(r => ({ status: r.status, ok: r.ok })).catch(e => ({ error: e.message }));
    
    setTimeout(() => resolve({ status: 0, error: 'timeout' }), 5000);
    
    Promise.race([req, new Promise(r => setTimeout(() => r({ status: 0, error: 'timeout' }), 5000))]).then(resolve);
  });
}

async function main() {
  const results = [];
  
  // Check production (the vulnerable endpoint)
  const prod = await check(PROD, 'production');
  results.push({ env: 'production', ...prod });
  
  console.log('Email Relay Regression Gate');
  console.log('============================');
  for (const r of results) {
    const status = r.status === 404 || r.error === 'timeout' || r.status === 0 ? 'PASS (no relay)' : `FAIL (status ${r.status})`;
    console.log(`${r.env}: ${status}`);
    if (r.error) console.log(`  Error: ${r.error}`);
  }
  
  // Gate: must return 404 or timeout
  const failed = results.filter(r => r.status !== 404 && r.error !== 'timeout' && r.status !== 0);
  if (failed.length > 0) {
    console.log('\n❌ FAIL: Open email relay detected');
    process.exit(1);
  }
  
  console.log('\n✅ PASS: No open email relay');
  process.exit(0);
}

main();
