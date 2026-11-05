// Unit gate: walkthrough master switch defaults off; onboarding modules honour it.
import fs from 'node:fs';
import vm from 'node:vm';

const walkSrc = fs.readFileSync('lib/walkthrough-auto.client.js', 'utf8');
const hfSrc = fs.readFileSync('swr-onboarding-hf.client.js', 'utf8');
const personaSrc = fs.readFileSync('persona-onboarding.js', 'utf8');

let failed = 0;
function ok(label, cond) {
  if (cond) console.log('  ✓', label);
  else { console.error('  ✗', label); failed++; }
}

const sandbox = { window: {}, document: { getElementById: () => null } };
vm.createContext(sandbox);
vm.runInContext(walkSrc, sandbox);
ok('SWR_WALKTHROUGH_AUTO defaults to false', sandbox.window.SWR_WALKTHROUGH_AUTO === false);
ok('SWR_WALKTHROUGH.autoEnabled() is false by default', sandbox.window.SWR_WALKTHROUGH.autoEnabled() === false);
sandbox.window.SWR_WALKTHROUGH_AUTO = true;
ok('autoEnabled() true when flag set', sandbox.window.SWR_WALKTHROUGH.autoEnabled() === true);

ok('HF tour gates auto-trigger on walkthroughAutoEnabled', /walkthroughAutoEnabled\(\) && !isDismissed\(\)/.test(hfSrc));
ok('persona onboarding gates init on walkthroughAutoEnabled', /walkthroughAutoEnabled\(\)/.test(personaSrc));

if (failed) {
  console.error(`\nWALKTHROUGH AUTO UNIT: ${failed} failure(s)`);
  process.exit(1);
}
console.log('\nWALKTHROUGH AUTO UNIT: ALL GREEN');
