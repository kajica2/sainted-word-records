# Ralph Wiggum Loops — Receipts Index (durable copy)

Session: 2026-08-25 — Sainted Word Records visualizer control.

This file is the durable archive of every loop shipped under the
Ralph Wiggum Loops doctrine. Originally stored at
`/tmp/ralph-loops/INDEX.md` (ephemeral, lost on reboot) — relocated
here so future sessions can read it.

## Doctrine summary

For each work item, the loop answer is: **name the loop's question,
take the smallest reversible move, ship it, archive the receipt,
ask the next loop's question.**

Reversibility table:

| Action                                          | Reversible?           |
|-------------------------------------------------|-----------------------|
| Write a local file                                | yes                   |
| `git commit` (no force, no -amend)               | yes                   |
| `git push` to a new branch                       | yes                   |
| `git push --force` over a remote                 | **no — pause**        |
| `hf upload` to a brand-new Space                 | yes (delete the Space) |
| `hf upload` over an existing Space               | **no — pause**        |
| Stripe / payment / hardware pairing              | **no — pause**        |
| `kill <pid>` of a process I started              | yes                   |
| `kill <pid>` of someone else's process          | **no — pause**        |

## Loops in this session

| # | Subject | Commits |
|---|---|---|
| 1 | Visualizer-control transport (WS bridge + DOM adapter + verify) | `5d647d5` |
| 2 | Mobile page + Agentic CLI drivers | `28e82ef` |
| 3 | OSC bridge (python-osc + websocket-client) | `d6e5f03` |
| 4 | Fleet integration — `<script>` tag in 12 visualizers | `8cc6d59` |
| 5 | Cross-app parameter pump (`tools/freq-bridge.js`) + survey doc | `1240d0a`, `823e8b2` |
| 6 | "Good outside look" — `tools/dev-up.sh` + `dev-down.sh` + `VISUALIZER-CONTROL.md` | `323810d` |
| 7 | Read-only server-status tool | `9cd54c4` |
| 8 | LAN pair helper — share-button + URL-param pre-fill | `02415ea` |
| 9 | Vercel deploy recipe (script + doc, no actual deploy) | `01af195` |

Plus a parallel session landed commit `5ec611e feat(library):
per-asset × button with optimistic delete + 5s undo` against
`engine.html` — disjoint from my work; the visualizer-control
files were all untouched.

## Notification format learned

Background-process exit notifications received during this session:

| Proc id | Exit code | Actual cause |
|---|---|---|
| proc_3600ee7fd4fd | None (SIGTERM) | `bash tools/dev-down.sh` |
| proc_3b2693e90ae8 | 0 | Vite dev server, SIGTERM via dev-down.sh |
| proc_027a78f454bc | -15 (SIGTERM) | WS bridge, SIGTERM via dev-down.sh |
| proc_47d37ccdbe47 | None (SIGTERM) | `bash tools/dev-up.sh`, SIGTERM via dev-down.sh |
| proc_24515e92c04e | None (SIGTERM) | loop-8 smoke test, SIGTERM via dev-down.sh |
| proc_5d6e1ecadb74 | None (SIGTERM) | (loop-9 — see below) |

**Canonical interpretation:**
- `None` exit = killed by signal, normal cleanup
- `-15` = SIGTERM, more specific
- `0` = exited cleanly with success
- In every case so far, cause has been `bash tools/dev-down.sh` between turns

**Confirmation procedure:** `bash tools/dev-ps.sh`. Single command,
ground truth on what is running.

## Still parked (waiting on user input)

| Item | Why parked |
|---|---|
| **Bluetooth (4th driver)** | Needs device name + protocol choice. macOS-only `IOBluetooth` shim. |
| **Freq-Lab cross-app bridge deployment** | Needs freq-lab write access for the 1-PR option (Option A). |
| **TLS + auth on the WS bridge** | Production hardening. Free-text WS today. |
| **QR code bootstrap** | Follow-up loop after the share-link helper; needs inlined QR generator or a tiny dep. |
| **Actual Vercel deploy (loop 10)** | Loop 9 shipped the recipe; the actual `vercel deploy` needs `VERCEL_TOKEN` or `vercel login`. Run `bash tools/deploy-vercel.sh` once auth is in place. |

Each is a single commit when unblocked; nothing else depends on them.

## Audio-to-score rule #12 cross-cut

Whenever the working tree shows `package.json` / `package-lock.json`
/ `verify-hf-publish.mjs` / `docs/CI-VERIFY-STRATEGY.md` / `scripts/lib/`
as dirty/untracked, **do not touch**. That WIP belongs to a
parallel workstream. Stick to the visualizer-control files
(`client/`, `scripts/dev-control-ws.mjs`, `tools/`, `versions/*`)
unless the user explicitly invites the broader scope.