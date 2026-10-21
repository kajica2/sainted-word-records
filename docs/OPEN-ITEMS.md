# Open Items — SWR + digital_twin

> Generated: 2026-10-11
> Last updated: this file

## Contents
- [SWR Repo (sainted-word-records)](#swr-repo-sainted-word-records)
- [digital_twin Repo](#digital_twin-repo)
- [Cross-repo Items](#cross-repo-items)

---

# SWR Repo (sainted-word-records)

## PR #169 — fix/engine-transport-wrap

| Field | Value |
|---|---|
| **Status** | MERGEABLE, CI running |
| **Branch** | `fix/engine-transport-wrap` |
| **Head** | `be6d707` (FLUX.2 cover backend) |
| **Commits** | 21 commits covering slot-ledger, media-pack, directors, transport fix |
| **Blockers** | None — waiting on CI + Vercel preview |

**Notes:**
- Merge conflict already resolved
- CI (`check:full`) + Vercel previews must pass before merge
- Working tree contains uncommitted Stripe-Connect pilot files (intentional)

---

## Stripe Connect Pilot

| Field | Value |
|---|---|
| **Status** | NOT STARTED |
| **Priority** | MEDIUM |
| **Files** | `api/_lib/stripe.js`, `api/connect/`, `api/webhooks/`, `api/catalogue/`, `connect.html`, `seller.client.js`, `docs/stripe-connect-pilot.md` |

**Notes:**
- Slots grants currently carry `paid: false` + `trial: true`
- Registration gate (`api/_lib/slots.js`) must flip to require `paid: true` once Stripe lands
- Marked with `TOGGLE` comments in `api/_lib/slots.js`

---

## Automix Enhancements (Backlog)

| Item | Status | Priority |
|---|---|---|
| FLUX.2 daemon for batch covers | NOT STARTED | LOW |
| Perf: 32B FLUX.2 model (out of reach on 24GB) | BLOCKED | LOW |

**Notes:**
- Generator spawns fresh renderer per pack (~90s model load each)
- digital_twin has single-load batch renderer (`bdb02e2`) that could be reused
- klein-4B bf16 is the ceiling for Apple M4 Pro 24GB

---

## New Gates (2026-10 post-commit)

| Gate | Status |
|---|---|
| `check:variants-unit` | NEW |
| `check:variants-smoke` | NEW |
| `check:reel-unit` | NEW |

**Notes:**
- Full 14-variant switcher coverage
- Added to `check` (63 steps) and `check:full` (20 steps)

---

## Local Nameserver Setup

| Field | Value |
|---|---|
| **Status** | NOT RUN YET |
| **Files** | `tools/local-dns.mjs`, `tools/local-dns.config.json`, `tools/local-dns-system.sh` |
| **Command** | `tools/local-dns-system.sh install` then `node tools/local-dns.mjs` |

**Notes:**
- Answers `sainted-word.test` (RFC 6761 reserved) with `127.0.0.1`
- Enables dev at `http://sainted-word.test:5174/`
- Already in `vite.config.js` and `allowedHosts`

---

## Targeting Pipeline Regex Fix

| Field | Value |
|---|---|
| **Status** | FIXED |
| **Commit** | Post-`main` |
| **Issue** | `[a-z0-9-]+` didn't match `music_video` / `music_video_mtv` (underscore) |

**Notes:**
- Fixed in `targeting-pipeline/build-rules.mjs` — regex now `[a-z0-9_-]+`
- Rebuild emits 14 variants (baroque + grid filtered from persona affinity lists)

---

# digital_twin Repo

## MJ Web Submitter (FIXED)

| Field | Value |
|---|---|
| **Status** | **FIXED** ✓ |
| **Fix Commit** | `7b84334` |
| **Issue** | 0/7 prompts submitted — CDP `Input.insertText` doesn't trigger React onChange |
| **Fix** | Native setter + input/change events to sync React state before clicking send button |
| **Verified** | Single-prompt test: `submitted via: send-button`, task accepted with 4 images |

**Notes:**
- Logs which submit path was used per prompt (`submitted via: send-button` or `enter-fallback`)
- All unit tests pass (27/27)

---

## FLUX.2 Batch Renderer

| Field | Value |
|---|---|
| **Status** | DONE |
| **Commit** | `bdb02e2` |
| **Feature** | Single-load batch renderer + cover manifests |

**Notes:**
- Solves the per-pack model reload issue
- Can be wired into SWR generator for batch cover generation

---

## Automation Scope Doc

| Field | Value |
|---|---|
| **Status** | DONE |
| **File** | `digital_twin/docs/AUTOMATION-SCOPE.md` |
| **Content** | Full scope of automix FX engine + automation/media pipeline |

---

# Cross-repo Items

## Media-pack FLUX.2 Integration

| Field | Value |
|---|---|
| **Status** | DONE |
| **SWR Commit** | `be6d707` |
| **Feature** | `--cover-backend flux2` in `generate-media-pack.mjs` |

**Notes:**
- Uses digital_twin's FLUX.2 renderer for bespoke covers
- Env-overridable paths (`FLUX2_RENDERER`, `FLUX2_PYTHON`)
- Falls back to frame extraction on renderer failure

---

## Cleanup: Experiment Artifacts

| Field | Value |
|---|---|
| **Status** | PENDING |
| **Files** | `free-output/`, `output.md` (digital_twin) |

**Notes:**
- Gitignored, left on disk
- Not required but could be cleaned up

---

# Quick Commands

```bash
# SWR - run full gate
npm run check:full

# digital_twin - run MJ tests
node lib/mj-web.test.js

# digital_twin - single prompt test
node lib/mj-web.js --prompt-file /tmp/mj-single.md --output mj-output/diag

# digital_twin - local nameserver
node tools/local-dns.mjs
```
