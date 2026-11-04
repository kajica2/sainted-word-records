// tests/helpers/fake-provider.mjs — a local stand-in for the Anthropic
// Messages API, used by tests/swarm-guard-wiring.test.mjs.
//
// It runs in its OWN PROCESS on purpose: the wiring test drives the bridge
// with spawnSync, which blocks the parent's event loop — a server in the
// parent could never answer the child's request, and the test would hang
// until the provider's ten-minute timeout.
//
// Environment:
//   LEDGER_DIR    the budget state dir to read at request time
//   LEASE_DIR     the lease state dir (deleted on request when DELETE_LEASES=1)
//   LOG           the file the request observations are appended to
//   DELAY_MS      how long to hold the response
//   DELETE_LEASES "1" → delete the agent's lease file while the request is in flight
//   CLAIM_WORKER  a worker id to claim a lease for while the request is in flight —
//                 used to fill the pool so a re-claim has nowhere to go
//
// stdout: the chosen port, as a single line.
import { createServer } from 'node:http';
import { appendFileSync, existsSync, readFileSync, readdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const LEDGER_DIR = process.env.LEDGER_DIR || '';
const LEASE_DIR = process.env.LEASE_DIR || '';
const LOG = process.env.LOG || '';
const DELAY_MS = Number(process.env.DELAY_MS) || 0;
const DELETE_LEASES = process.env.DELETE_LEASES === '1';
const CLAIM_WORKER = process.env.CLAIM_WORKER || '';
const HELPER_DIR = process.argv[2] || process.cwd();

/** Fill the pool with other workers, so a re-claim has nowhere to go. */
async function claimSlot() {
  if (!CLAIM_WORKER || !LEASE_DIR) return;
  try {
    const mod = await import(pathToFileURL(join(HELPER_DIR, 'software-factory', 'worker-lease.mjs')).href);
    const manager = mod.createLeaseManager({ dir: LEASE_DIR });
    // Two workers: the pool's cap is two, so the third one has nowhere
    // to go.
    manager.claim({ workerId: CLAIM_WORKER, mission: 'usurper' });
    manager.claim({ workerId: `${CLAIM_WORKER}-2`, mission: 'usurper' });
  } catch {
    /* the helper could not reach the lease module — the test will say so */
  }
}

function ledgerRecords() {
  if (!LEDGER_DIR || !existsSync(LEDGER_DIR)) return [];
  const records = [];
  for (const name of readdirSync(LEDGER_DIR)) {
    if (!name.startsWith('ledger-') || !name.endsWith('.jsonl')) continue;
    for (const line of readFileSync(join(LEDGER_DIR, name), 'utf8').split('\n')) {
      if (!line.trim()) continue;
      try { records.push(JSON.parse(line)); } catch { /* a torn line is its own finding */ }
    }
  }
  return records;
}

function deleteLeases() {
  if (!LEASE_DIR || !existsSync(LEASE_DIR)) return;
  for (const name of readdirSync(LEASE_DIR)) {
    if (!name.endsWith('.lease.json')) continue;
    try { unlinkSync(join(LEASE_DIR, name)); } catch { /* gone */ }
  }
}

const server = createServer((req, res) => {
  let body = '';
  req.on('data', (chunk) => { body += chunk; });
  req.on('end', () => {
    const observation = {
      at: new Date().toISOString(),
      method: req.method,
      path: req.url,
      body,
      ledgerAtRequest: ledgerRecords(),
    };
    if (LOG) appendFileSync(LOG, JSON.stringify(observation) + '\n');
    if (DELETE_LEASES) deleteLeases();
    if (CLAIM_WORKER) claimSlot();
    const respond = () => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          content: [{ type: 'text', text: 'fake provider answer' }],
          stop_reason: 'end_turn',
          usage: { input_tokens: 1234, output_tokens: 567, cache_read_input_tokens: 0 },
        }),
      );
    };
    if (DELAY_MS) setTimeout(respond, DELAY_MS);
    else respond();
  });
});

server.listen(0, '127.0.0.1', () => {
  process.stdout.write(String(server.address().port) + '\n');
});

process.on('SIGTERM', () => server.close(() => process.exit(0)));
