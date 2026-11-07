import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../scripts/visual-correct.mjs', import.meta.url), 'utf8');
const runner = source.slice(source.indexOf('\n(async () =>'));

async function run(mode) {
  const calls = [];
  let report;
  const page = {
    setViewport: async () => {},
    goto: async () => { if (mode === 'navigation') throw new Error('navigation failed'); },
    waitForFunction: async () => {},
    screenshot: async () => {
      calls.push('screenshot');
      if (mode === 'screenshot') throw new Error('screenshot failed');
    },
  };
  const context = vm.createContext({
    BASE: 'http://localhost:54042', VARIANT: 'neon', EXTERNAL: false,
    LOOP: false, MAX_MS: 1, ARTIFACT_DIR: 'artifacts/command-center',
    process: { env: { GITHUB_SHA: 'test-sha' }, exitCode: 0 },
    console: { log() {}, error() {} },
    setTimeout: fn => { fn(); },
    startServer: async () => ({ kill: () => calls.push('server killed') }),
    puppeteer: { launch: async () => {
      if (mode === 'launch') throw new Error('launch failed');
      return {
        newPage: async () => page,
        close: async () => {
          calls.push('browser closed');
          if (mode === 'close') throw new Error('close failed');
        },
      };
    } },
    checkAndCorrect: async () => ({ ok: mode !== 'missing', missing: mode === 'missing' ? ['save'] : [] }),
    mkdir: async () => {},
    join: (...parts) => parts.join('/'),
    writeFile: async (_path, data) => {
      calls.push('report written');
      if (mode === 'artifact') throw new Error('disk failed');
      report = JSON.parse(data);
    },
  });
  await vm.runInContext(runner, context);
  return { calls, report, code: context.process.exitCode };
}

test('success records the tested commit and closes both resources', async () => {
  const result = await run('success');
  assert.equal(result.code, 0);
  assert.equal(result.report.ok, true);
  assert.equal(result.report.commit, 'test-sha');
  assert.deepEqual(result.calls.slice(-2), ['browser closed', 'server killed']);
});
for (const mode of ['navigation', 'missing', 'screenshot', 'artifact', 'close', 'launch']) {
  test(mode + ' path preserves cleanup and an honest outcome', async () => {
    const result = await run(mode);
    assert.ok(result.calls.includes('server killed'));
    if (mode !== 'launch') assert.ok(result.calls.includes('browser closed'));
    // A screenshot is best-effort; a passed check still has a JSON report.
    assert.equal(result.code, mode === 'screenshot' ? 0 : 1);
    if (['navigation', 'missing', 'launch'].includes(mode)) assert.equal(result.report.ok, false);
    if (mode === 'missing') assert.deepEqual(result.report.missing, ['save']);
    if (mode === 'navigation') assert.equal(result.report.error, 'navigation failed');
  });
}
