// software-factory/worker-lease.mjs — at-most-N concurrent workers, crash-safe.
//
// WHY THIS EXISTS
// ---------------
// The swarm policy allows at most 2 active agents globally. Nothing enforced
// it: two workers could run at once, then a third, and the budget ledger
// (software-factory/budget-ledger.mjs) would be the only thing to notice —
// after the money was already spent.
//
// THE MODEL
// ---------
// A lease is a file under `data/swr-leases/`. It records who holds it, for
// what, and when it expires.
//
//   * Claiming takes an exclusive global lock (`leases.lock`, created with
//     `open(..., 'wx')` — atomic), so two claimants cannot both count
//     themselves as the first worker.
//   * Under the lock, expired leases are pruned and the live ones counted.
//     At the cap, the claim is refused with `reason: 'cap'`.
//   * The lease file itself is created with `'wx'` too, so a lease id can
//     never be double-issued.
//   * Re-claiming with the same `workerId` is IDEMPOTENT: the same worker
//     gets its existing lease back (and may renew it). It never consumes a
//     second slot.
//   * A worker that dies leaves its lease behind. The lease expires after
//     its TTL and the next claim prunes it — that is the crash recovery
//     path, and it needs no cleanup daemon.
//
// Zero dependencies. Node >= 18.
//
// Run: `node software-factory/worker-lease.mjs status`
//      `node software-factory/worker-lease.mjs claim --worker-id w1 --mission visual`

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(HERE, '..');

export const DEFAULT_MAX_WORKERS = 2;
export const DEFAULT_LEASE_DIR = path.join(REPO_ROOT, 'data', 'swr-leases');
export const DEFAULT_LEASE_TTL_MS = 15 * 60 * 1000; // 15 minutes
export const STALE_LOCK_MS = 15_000;
export const LOCK_WAIT_MS = 20_000;
// A lease file younger than this is assumed to be a writer's work in
// progress, not debris. It is never deleted on the strength of being
// unreadable.
export const CORRUPT_FILE_MS = 60_000;

function sleepSync(ms) {
  const sab = new SharedArrayBuffer(4);
  const ia = new Int32Array(sab);
  Atomics.wait(ia, 0, 0, ms);
}

function readJsonFile(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    if (err && err.code === 'ENOENT') return null;
    throw err;
  }
}

export class WorkerLeaseManager {
  constructor({
    dir = DEFAULT_LEASE_DIR,
    maxWorkers = DEFAULT_MAX_WORKERS,
    now = () => Date.now(),
    ttlMs = DEFAULT_LEASE_TTL_MS,
    staleLockMs = STALE_LOCK_MS,
    lockWaitMs = LOCK_WAIT_MS,
    corruptFileMs = CORRUPT_FILE_MS,
  } = {}) {
    this.dir = dir;
    this.maxWorkers = maxWorkers;
    this.now = now;
    this.ttlMs = ttlMs;
    this.staleLockMs = staleLockMs;
    this.lockWaitMs = lockWaitMs;
    this.corruptFileMs = corruptFileMs;
    fs.mkdirSync(this.dir, { recursive: true });
  }

  get lockPath() {
    return path.join(this.dir, 'leases.lock');
  }

  _leasePath(workerId) {
    const safe = String(workerId).replace(/[^A-Za-z0-9._-]/g, '_');
    return path.join(this.dir, `${safe}.lease.json`);
  }

  _nowMs() {
    return Number(this.now());
  }

  /**
   * Run `fn` under the global lock.
   *
   * Two rules make the lock safe:
   *
   * 1. **The holder releases only its OWN lock.** The lock file carries a
   *    unique token; the release unlinks it only if the token still
   *    matches. Without that, a holder whose lock was broken would delete
   *    the BREAKER's lock on its way out — and two processes would be
   *    inside the critical section at once.
   * 2. **A stale lock is broken by an atomic MOVE, not an unlink.** The
   *    rename moves the stale lock aside; only one process can win that
   *    race, and the losers wait. An unlink-then-create lets two
   *    breakers both believe they took the lock.
   */
  _withLock(fn) {
    const lockPath = this.lockPath;
    const deadline = Date.now() + this.lockWaitMs;
    for (;;) {
      const token = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      let fd;
      try {
        fd = fs.openSync(lockPath, 'wx');
      } catch (err) {
        if (!err || err.code !== 'EEXIST') throw err;
        try {
          const st = fs.statSync(lockPath);
          if (Date.now() - st.mtimeMs > this.staleLockMs) {
            // Break it by MOVING it aside: the rename is atomic, so only
            // one breaker wins and the others keep waiting.
            const stale = `${lockPath}.stale-${process.pid}-${Math.random().toString(36).slice(2)}`;
            try {
              fs.renameSync(lockPath, stale);
              fs.unlinkSync(stale);
            } catch {
              /* somebody else broke it first */
            }
            continue;
          }
        } catch {
          continue;
        }
        if (Date.now() >= deadline) throw new Error('worker-lease: could not acquire the lease lock');
        sleepSync(3 + Math.floor(Math.random() * 7));
        continue;
      }
      try {
        fs.writeSync(fd, `${token}\n`);
      } finally {
        fs.closeSync(fd);
      }
      try {
        // We are the HOLDER: mark our own lock as ours. The lock file was
        // just created, so this is close to a no-op — but it keeps the
        // intent explicit: ONLY the holder may refresh this lock, and
        // `_readLeases()` (which readers also call) must not.
        //
        // The lock's mtime therefore marks the START of the critical
        // section. That is the signal the staleness check wants: a lock
        // older than `staleLockMs` belongs to a holder that stopped
        // making progress. It is not a periodic heartbeat — a critical
        // section here is a handful of file operations and finishes in
        // well under a millisecond, so it cannot outlive its own
        // staleness window while the holder is still inside it.
        this._touchLock();
        return fn();
      } finally {
        // Release ATOMICALLY: move whatever is at the lock path aside,
        // then look at the file we moved. A check-then-unlink has a window
        // in which a breaker can replace the lock and the holder then
        // deletes the BREAKER's lock — two processes inside the critical
        // section, and two slots past the cap.
        //
        // NOTHING in here returns: a `return` in a finally block would
        // discard the value the try block produced.
        const releaseTmp = `${lockPath}.release-${process.pid}-${Math.random().toString(36).slice(2)}`;
        let moved = false;
        try {
          fs.renameSync(lockPath, releaseTmp);
          moved = true;
        } catch {
          moved = false; // somebody else already moved it
        }
        if (moved) {
          let mine = false;
          try {
            mine = fs.readFileSync(releaseTmp, 'utf8').trim() === token;
          } catch {
            mine = false;
          }
          try {
            if (mine) {
              fs.unlinkSync(releaseTmp);
            } else if (!fs.existsSync(lockPath)) {
              // It was not ours: put it back — unless somebody has taken
              // the path in the meantime, in which case it is debris.
              fs.renameSync(releaseTmp, lockPath);
            } else {
              fs.unlinkSync(releaseTmp);
            }
          } catch {
            /* best effort */
          }
        }
      }
    }
  }

  /**
   * Every lease file on disk, expired ones flagged.
   *
   * A CORRUPT lease file (a crash between the create and the write) carries
   * no information: it cannot say who holds it or until when. It is pruned
   * rather than thrown on — otherwise one truncated file bricks the whole
   * pool until an operator deletes it by hand.
   *
   * BUT a file that is merely *young* is not corrupt: a writer that has
   * not finished yet looks exactly like a truncated file. Lease files are
   * now written atomically, and the prune additionally refuses to touch a
   * file that was modified within `corruptFileMs` — so a live lease can
   * never be deleted by a reader that caught it mid-write.
   */
  _readLeases() {
    const out = [];
    let names = [];
    try {
      names = fs.readdirSync(this.dir);
    } catch (err) {
      if (err && err.code === 'ENOENT') return out;
      throw err;
    }
    this._pruneTempFiles();
    // NOTE: the lock is deliberately NOT refreshed here.
    //
    // `_readLeases()` is called both by the lock HOLDER (inside
    // `_withLock`) and by READERS (`status()`, and any other process
    // watching the pool). Only the holder may refresh the lock: a
    // reader that refreshes someone else's lock keeps a CRASHED
    // holder's lock looking alive.
    //
    // That defeats the recovery path this module promises. With the
    // defaults (staleLockMs 15s, lockWaitMs 20s), one monitor process
    // polling `status()` every few seconds keeps the lock's age under
    // 15s forever, so `claim()` never sees it as stale, waits the full
    // 20s, and throws "could not acquire the lease lock" — the pool is
    // wedged for as long as anything reads the status.
    //
    // The holder refreshes its OWN lock in `_withLock`, below.
    for (const name of names) {
      if (!name.endsWith('.lease.json')) continue;
      const file = path.join(this.dir, name);
      let lease = null;
      let unreadable = false;
      try {
        lease = readJsonFile(file);
      } catch (err) {
        if (err && err.code === 'ENOENT') continue; // a normal race: it is gone
        unreadable = true;
      }
      if (unreadable || !lease || typeof lease !== 'object') {
        const age = this._fileAgeMs(file);
        if (age === null) continue; // gone
        if (age < this.corruptFileMs) {
          // Too young to be debris: a writer is probably still on it. Do not
          // count it, do not delete it, and do not let it hold a slot.
          this.youngUnreadable = (this.youngUnreadable || 0) + 1;
          continue;
        }
        this.corrupt = (this.corrupt || 0) + 1;
        try {
          fs.unlinkSync(file);
        } catch {
          /* already gone */
        }
        continue;
      }
      lease.file = file;
      lease.expired = Number(lease.expiresAt) <= this._nowMs();
      out.push(lease);
    }
    return out;
  }

  /**
   * Refresh the lock's mtime.
   *
   * "Stale" must mean "the holder has made no progress for a while", not
   * "the holder took the lock a while ago". Without this touch, a holder
   * that is still working inside the critical section can have its lock
   * broken out from under it — and a second process then enters the
   * critical section with it.
   */
  _touchLock() {
    try {
      const now = new Date();
      fs.utimesSync(this.lockPath, now, now);
    } catch {
      /* the lock is gone or not ours — the caller's own checks decide */
    }
  }

  /** How old a file is, in milliseconds, or null if it is gone. */
  _fileAgeMs(file) {
    try {
      return this._nowMs() - fs.statSync(file).mtimeMs;
    } catch {
      return null;
    }
  }

  /**
   * Remove temp files left behind by a crashed atomic write.
   *
   * A crash between the create and the rename leaves a `.tmp-` fragment.
   * It says nothing about any slot, and nothing else would ever remove
   * it — so the directory would grow litter forever.
   *
   * The matcher is a PATTERN, not a substring: a worker id may legally
   * contain `.tmp-` or `.stale-`, and a live lease file must never be
   * mistaken for litter.
   */
  _pruneTempFiles(maxAgeMs = 60_000) {
    let names = [];
    try {
      names = fs.readdirSync(this.dir);
    } catch {
      return 0;
    }
    let removed = 0;
    for (const name of names) {
      if (name.endsWith('.lease.json')) continue; // never a lease file
      const isFragment = /\.tmp-\d+-[a-z0-9]+$/.test(name) || /\.stale-\d+-[a-z0-9]+$/.test(name) || /\.release-\d+-[a-z0-9]+$/.test(name);
      if (!isFragment) continue;
      const file = path.join(this.dir, name);
      const age = this._fileAgeMs(file);
      if (age === null || age < maxAgeMs) continue;
      try {
        fs.unlinkSync(file);
        removed++;
      } catch {
        /* already gone */
      }
    }
    return removed;
  }

  _pruneExpired(leases) {
    const expired = leases.filter((l) => l.expired);
    for (const l of expired) {
      try {
        fs.unlinkSync(l.file);
      } catch {
        /* already gone */
      }
    }
    return { expired, live: leases.filter((l) => !l.expired) };
  }

  /**
   * Write a lease file ATOMICALLY, and never over a live one.
   *
   * The file used to be created empty and then filled in place, which
   * leaves a window in which another process reads a zero-length file. A
   * reader that treats "unreadable" as "corrupt" then deletes a LIVE
   * lease — and the pool hands out more slots than the cap allows. The
   * temp file plus the rename closes the window: a reader sees either the
   * old lease or the new one, never a fragment.
   *
   * The rename OVERWRITES its destination, so the exclusivity has to be
   * checked explicitly: a lease id that already exists on disk belongs to
   * somebody else, and this claim is a race — two worker ids can
   * sanitise to the same file name.
   */
  _writeLease(lease) {
    const file = this._leasePath(lease.workerId);
    if (fs.existsSync(file)) {
      const err = new Error(`worker-lease: a lease for "${lease.workerId}" already exists`);
      err.code = 'EEXIST';
      throw err;
    }
    this._writeJsonAtomic(file, lease);
    return file;
  }

  /** Write JSON to `file` through a temp file and an atomic rename. */
  _writeJsonAtomic(file, value) {
    const tmp = `${file}.tmp-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
    const fd = fs.openSync(tmp, 'w');
    try {
      fs.writeSync(fd, JSON.stringify(value, null, 2) + '\n');
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(tmp, file);
  }

  /**
   * Claim a worker slot.
   *
   * @returns {{ok:boolean, reason?:string, lease?:object, active?:number}}
   */
  claim({ workerId, mission = null, ttlMs = null, note = null, dryRun = false } = {}) {
    if (!workerId) throw new Error('worker-lease: claim() needs a workerId');
    const ttl = Number(ttlMs) > 0 ? Number(ttlMs) : this.ttlMs;
    return this._withLock(() => {
      const leases = this._readLeases();
      const { expired, live } = this._pruneExpired(leases);

      // Idempotent: the same worker keeps its slot.
      const mine = live.find((l) => l.workerId === workerId);
      if (mine) {
        mine.expiresAt = this._nowMs() + ttl;
        mine.renewedAt = new Date(this._nowMs()).toISOString();
        this._writeJsonAtomic(mine.file, mine);
        return { ok: true, idempotent: true, lease: mine, active: live.length, pruned: expired.length };
      }

      if (live.length >= this.maxWorkers) {
        return {
          ok: false,
          reason: 'cap',
          active: live.length,
          maxWorkers: this.maxWorkers,
          pruned: expired.length,
          leases: live.map((l) => ({ workerId: l.workerId, mission: l.mission, expiresAt: l.expiresAt })),
        };
      }

      const lease = {
        workerId,
        mission,
        note,
        pid: process.pid,
        claimedAt: new Date(this._nowMs()).toISOString(),
        expiresAt: this._nowMs() + ttl,
        ttlMs: ttl,
      };

      if (dryRun) {
        return {
          ok: true,
          dryRun: true,
          wouldClaim: lease,
          active: live.length,
          pruned: expired.length,
        };
      }

      try {
        lease.file = this._writeLease(lease);
      } catch (err) {
        if (err && err.code === 'EEXIST') {
          return { ok: false, reason: 'race', active: live.length };
        }
        throw err;
      }
      return { ok: true, lease, active: live.length + 1, pruned: expired.length };
    });
  }

  /** Extend a lease this worker already holds. */
  renew({ workerId, ttlMs = null } = {}) {
    if (!workerId) throw new Error('worker-lease: renew() needs a workerId');
    const ttl = Number(ttlMs) > 0 ? Number(ttlMs) : this.ttlMs;
    return this._withLock(() => {
      const { live } = this._pruneExpired(this._readLeases());
      const mine = live.find((l) => l.workerId === workerId);
      if (!mine) return { ok: false, reason: 'unknown-worker' };
      mine.expiresAt = this._nowMs() + ttl;
      mine.renewedAt = new Date(this._nowMs()).toISOString();
      this._writeJsonAtomic(mine.file, mine);
      return { ok: true, lease: mine, active: live.length };
    });
  }

  /** Give the slot back. Idempotent. */
  release({ workerId, reason = null } = {}) {
    if (!workerId) throw new Error('worker-lease: release() needs a workerId');
    return this._withLock(() => {
      const { live } = this._pruneExpired(this._readLeases());
      const mine = live.find((l) => l.workerId === workerId);
      if (!mine) return { ok: true, released: false, reason: 'unknown-worker' };
      try {
        fs.unlinkSync(mine.file);
      } catch {
        /* already gone */
      }
      const remaining = this._readLeases().filter((l) => !l.expired);
      return { ok: true, released: true, workerId, reason, active: remaining.length };
    });
  }

  status() {
    const leases = this._readLeases();
    const live = leases.filter((l) => !l.expired);
    const expired = leases.filter((l) => l.expired);
    return {
      active: live.length,
      maxWorkers: this.maxWorkers,
      leases: live.map((l) => ({
        workerId: l.workerId,
        mission: l.mission,
        pid: l.pid,
        claimedAt: l.claimedAt,
        expiresAt: l.expiresAt,
      })),
      expired: expired.map((l) => ({ workerId: l.workerId, expiresAt: l.expiresAt })),
      // How many unreadable lease files this process has pruned. Non-zero
      // means an agent crashed while writing its lease.
      corruptPruned: this.corrupt || 0,
    };
  }
}

export function createLeaseManager(opts = {}) {
  return new WorkerLeaseManager(opts);
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const USAGE = `worker-lease — at most N concurrent workers, crash-safe

usage:
  node software-factory/worker-lease.mjs status
  node software-factory/worker-lease.mjs claim --worker-id ID [--mission M] [--ttl-ms N] [--dry-run]
  node software-factory/worker-lease.mjs renew --worker-id ID [--ttl-ms N]
  node software-factory/worker-lease.mjs release --worker-id ID
`;

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) out[key] = true;
      else {
        out[key] = next;
        i++;
      }
    } else out._.push(a);
  }
  return out;
}

export function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const cmd = args._[0];
  if (!cmd || args.help || args.h) {
    process.stdout.write(USAGE);
    return cmd ? 0 : 2;
  }
  const mgr = new WorkerLeaseManager({
    dir: args['state-dir'] || DEFAULT_LEASE_DIR,
    maxWorkers: args['max-workers'] !== undefined ? Number(args['max-workers']) : DEFAULT_MAX_WORKERS,
  });
  if (cmd === 'status') {
    process.stdout.write(JSON.stringify(mgr.status(), null, 2) + '\n');
    return 0;
  }
  if (cmd === 'claim') {
    if (!args['worker-id']) {
      process.stderr.write('worker-lease: claim needs --worker-id\n');
      return 2;
    }
    const res = mgr.claim({
      workerId: args['worker-id'],
      mission: args.mission || null,
      ttlMs: args['ttl-ms'] !== undefined ? Number(args['ttl-ms']) : null,
      dryRun: Boolean(args['dry-run']),
    });
    process.stdout.write(JSON.stringify(res, null, 2) + '\n');
    return res.ok ? 0 : 1;
  }
  if (cmd === 'renew') {
    if (!args['worker-id']) {
      process.stderr.write('worker-lease: renew needs --worker-id\n');
      return 2;
    }
    const res = mgr.renew({ workerId: args['worker-id'], ttlMs: args['ttl-ms'] !== undefined ? Number(args['ttl-ms']) : null });
    process.stdout.write(JSON.stringify(res, null, 2) + '\n');
    return res.ok ? 0 : 1;
  }
  if (cmd === 'release') {
    if (!args['worker-id']) {
      process.stderr.write('worker-lease: release needs --worker-id\n');
      return 2;
    }
    const res = mgr.release({ workerId: args['worker-id'], reason: args.reason || null });
    process.stdout.write(JSON.stringify(res, null, 2) + '\n');
    return 0;
  }
  process.stderr.write(`worker-lease: unknown command "${cmd}"\n${USAGE}`);
  return 2;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  process.exit(main());
}
