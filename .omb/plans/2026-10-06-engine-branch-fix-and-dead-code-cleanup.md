# Plan: make `feat/slip-sets-1` coherent, then remove the engine's dead copy and duplicate include

| | |
|---|---|
| Scope | `engine.html` + `engine-*.client.js` only |
| Phase 1 branch | `feat/slip-sets-1` at `d4b292a` (forward-fix commits; no history rewrite) |
| Phase 2 branch | new `chore/engine-dead-code-cleanup` from `main` (`cd61f86`) — independent of Phase 1 |
| Baseline | branch: local `npm run check` = `check: all 60 steps passed`; CI red (`check: 1/60 step(s) FAILED: npm run check:reel-unit`, `verify:engine-boot` 404 `/engine-reel.client.js`, `check:dist-links` 1 unresolved target). `main`: `check` group = 58 steps |

**Line numbers differ per branch.** Every `engine.html` / `AGENTS.md` number below is given as `branch / main`. Phase 1 tasks use the branch number; Phase 2 tasks use the `main` number. Instructions are also stated by content so a drifted line can be re-found with the grep given.

**Governing decisions**

- The live engine is the inline `<script type="module">` in `engine.html` (opens ≈L2786 / ≈L2776, banner `// SAINTED-WORD RECORDS — Algorithmic audio-reactive video engine`; closes L5548 / L5530; `window.SWR` assembled at L5444 / L5426). `engine-core.client.js` is a diverged copy no page loads. This plan retires the copy; it does **not** finish the extraction.
- Fix `6a1ba56` forward (add the files it references). Its `feat(fx)` message stays misleading — pushed history is not rewritten; the follow-up commit body says so.
- Behaviour-neutral throughout: every edit is a file add, a delete, a comment, a doc line, or a test assertion. `verify:engine-boot` (zero page errors, canvas sized, no duplicate ids) proves neutrality.

**Non-goals (verified, deliberately left alone)**

- `project.js` / `project.client.js` are both live: `project.js:611` → `window.Project` (wires the `pj-*` DOM); `project.client.js:284` → `window.SWR_PROJECT`, consumed by `engine-keys.client.js`, `engine-settings.client.js`, `verify-project.mjs`, `verify-project-rotation.mjs`.
- `swr-app.html` (its own 9,580-line engine), `engine-keys`/`engine-genops` size splits, the lost searchable preset dropdown, and whatever made CI red at `2cd589e` (pre-reel; log shows no failing step).

**User decisions required before task 1** (see § User verification).

---

## U1 — `feat/slip-sets-1` references files that are not in git

**Outcome:** a fresh clone of the branch passes `npm run check`, `/engine/` boots with no 404, `check:dist-links` resolves every target, and a reel track whose audio path is missing fails `check:reel-unit` instead of 404ing in production.

**Current evidence** — `git show --stat 6a1ba56` (labelled `feat(fx)`) also carries:

```
engine.html:2771        <script src="/engine-reel.client.js" defer></script>
vite.config.js:268      'engine-reel.client.js',                       // rootFiles
package.json:59,75      "check:reel-unit": "node scripts/check-reel-unit.mjs", "verify:reel": "node verify-reel.mjs"
scripts/run-steps.mjs:111  'npm run check:reel-unit',                  // check group: 60 steps
marketplace/curated/index.json  +46 lines → slip-01..07 *.swr-set.json, slip-sets-1.reel.json
```

`git status --short` at `d4b292a` — all `??`: `engine-reel.client.js` (635 lines), `scripts/check-reel-unit.mjs`, `verify-reel.mjs`, `marketplace/curated/slip-0{1..7}-*.swr-set.json`, `marketplace/curated/slip-sets-1.reel.json`, `audios/slip-sets-1/` (7 MP3 = 33 MB; the 7 `.log` beside them are gitignored). Audio paths `/audios/slip-sets-1/*.mp3` appear in **8** JSON files: `slip-sets-1.reel.json` (7 refs) and each of the 7 `.swr-set.json`; `index.json` has none. `node scripts/check-reel-unit.mjs` → `REEL UNIT: all assertions passed` locally.

Gate gap (verified): `scripts/check-dist-links.mjs:39-42` walks `.html` only, so JSON-referenced audio is invisible to it; `verify-reel.mjs:158,179` simulates track end by dispatching `ended` and never fetches an MP3. Nothing today fails when the MP3s are absent.

**Implementation shape:**
- Edit `engine-reel.client.js:40` before adding it: the comment "engine-core.client.js on the variants" → "the inline engine in engine.html (`Audio` class) on the variants". (It is the only engine-core reference that lives on this branch alone.)
- Add to `scripts/check-reel-unit.mjs` one assertion: for every entry in `marketplace/curated/slip-sets-1.reel.json` with an `audio` field, either the path is an absolute URL or `fs.existsSync(path.join(ROOT, audio))` is true. RED today if the MP3s are skipped; GREEN under either decision below.
- Commit A `feat(reel): add demo-reel player + unit/verify scripts referenced by 6a1ba56` — `git add engine-reel.client.js scripts/check-reel-unit.mjs verify-reel.mjs marketplace/curated/slip-0*-*.swr-set.json marketplace/curated/slip-sets-1.reel.json` (explicit paths — `.omb/plans/` is also untracked and must not ride along). Body: "6a1ba56 (feat(fx)) wired these via `commit -am`; the files were never added. Restores CI: check:reel-unit, verify:engine-boot, check:dist-links."
- Commit B per decision D1:
  - **D1-A (commit audio):** `git add audios/slip-sets-1/*.mp3` → `feat(reel): slip-sets-1 demo audio (7 MP3, 33 MB)`. `vite.config.js:506` copies `audios/` into `dist`, so CI byte-sum goes ~66 → ~99 MB of the 130 MB budget; state the measured number in the PR.
  - **D1-B (host externally):** upload the 7 MP3s (Vercel Blob or HF), then rewrite the 8 JSON files so every `/audios/slip-sets-1/<name>.mp3` becomes the absolute URL (`sed -i '' 's#/audios/slip-sets-1/#<base-url>/#' marketplace/curated/slip-sets-1.reel.json marketplace/curated/slip-0*-*.swr-set.json`); commit `feat(reel): point slip-sets-1 audio at <host>`. Confirm `engine-reel.client.js` / `swr-sets.js` accept absolute URLs (grep `importSet` for a path prefix check before choosing this).
- `AGENTS.md` on this branch (same commit as A): Project layout bullet for `engine-*.client.js` gains `engine-reel.client.js` (`window.SWR_REEL`, auto-advance demo-reel player, loaded by `engine.html` next to `swr-sets.js`); Testing "`check` **58 steps**" (L105) → **60**, mention `check:reel-unit`.
- Push; `gh run list --branch feat/slip-sets-1 --limit 1` → `completed success`.

**Tests**
1. `npm run check:reel-unit` — new assertion: 7 audio paths resolve; RED under D1-B until the JSON rewrite lands.
2. `npm run verify:engine-boot` — today on a clean checkout: `✗ unexpected HTTP failures (got: ["404 .../engine-reel.client.js"])`; after Commit A: zero HTTP failures, zero page errors.
3. `npm run build && npm run check:dist-links` — today `✗ every internal link resolves in dist (1 target(s))`; after: all resolve.
4. Clean-checkout proof (do not use `git stash -u` — it would stash `.omb/plans/` and the MP3s): `git worktree add /private/var/folders/sn/w6jzx_fn5d145nwjmbsz2k5h0000gn/T/opencode/ss1 feat/slip-sets-1 && cd $_ && npm ci && npm run check` → `check: all 60 steps passed`; then `git worktree remove` it.
5. `node scripts/run-steps.mjs check --list | head -1` → `check (60 steps)` matches the AGENTS.md number.

---

## U2 — `engine-core.client.js` is a 4,225-line copy nothing loads

**Outcome:** the dead copy is gone; every comment that pointed at it says where the engine actually lives.

**Current evidence**
- `engine-core.client.js:3` — "Extracted from engine.html's inline `<script type="module">` (was L1648-L5453, 3,804 lines). The body is verbatim". File is now 4,225 lines; the inline block is ≈2,760 lines — diverged.
- No loader: `grep -rln "engine-core" --include='*.html' --exclude-dir={node_modules,dist,dist-dev,.worktrees,_archive} .` → none. Not in `vite.config.js` (`grep -n engine-core vite.config.js` → none), so not in `dist/`. No `import`/`fetch`/string loader in any `.js/.mjs/.json/.yml/.sh`: the only hits are the comment lines below and the file itself.
- The last code commit touching it, `73afe7c fix(watermark)` (already in `main`), changed the live `engine.html` (119 lines) and only 8 lines here (7 comments + 1 `setStatus` call that also exists in `engine.html`). Nothing lives solely in the copy.
- Comment-only references on `main`: `engine-3d.client.js:3` ("INTEGRATION (read me before touching engine-core / render loop)"), `engine-3d.client.js:23` ("drop into engine-core.client.js /"), `persona-runtime.client.js:10` ("engine-core.client.js requires 8+ panel DOM elements"), `engine-keys.client.js:154` ("engine-core.client.js, which none of these pages load — they use the"). (`engine-reel.client.js:40` is handled in U1.)

**Implementation shape:**
- `git rm engine-core.client.js`.
- Comment rewrites (text only):
  - `engine-3d.client.js:3` → `// INTEGRATION (read me before touching the inline engine in engine.html / render loop)`
  - `engine-3d.client.js:23` → `// Minimal render-loop integration (drop into engine.html's inline Renderer /`
  - `persona-runtime.client.js:10` → `//   engine.html's inline engine requires 8+ panel DOM elements (load-song, lib,`
  - `engine-keys.client.js:154` → replace `engine-core.client.js, which none of these pages load — they use the` with `engine.html's inline engine, which these pages do not load — they use the`
- Leave `codebase-map-obsidian.md` (no generator under `scripts/` or `tools/`; informational) and `LOOP-PROMPT.md:67,74` (already say engine-core is not loaded) untouched.

**Tests**
1. `grep -rn "engine-core" --include='*.js' --include='*.html' --exclude-dir={node_modules,dist,dist-dev,.worktrees,_archive} .` → 0 hits (RED today: 4 files on `main`).
2. `npm run check:syntax` — passes; file count drops by 1.
3. `npm run verify:engine-boot` — zero page errors, zero console errors, canvas sized.

---

## U3 — `engine.html` loads `engine-transitions.client.js` twice

**Outcome:** one fetch + one parse of the 670-line module per page load; behaviour identical.

**Current evidence** — `engine.html` (`grep -n 'src="/engine-transitions.client.js"' engine.html`):
```
7066 / 7048:  <script type="module" src="/engine-transitions.client.js"></script>
7067 / 7049:  <script type="module" src="/wizard.js"></script>
7068 / 7050:  <script type="module" src="/personas.js"></script>
7069 / 7051:  <script type="module" src="/engine-transitions.client.js"></script>
```
`engine-transitions.client.js:20` — `if (window.SWRTransitions) return;  // idempotent`. `vite.config.js:669-675` (`strip-absolute-module-scripts`) turns all of these into plain `defer` scripts, so document order = execution order in dev and build alike. `wizard.js:18` / `personas.js:19` have their own idempotent guards and never reference `SWRTransitions`; the only consumer is the inline engine (`engine.html:4794-4856` on the branch), which polls for `window.SWRTransitions` up to 40×100 ms. Removing either include is safe; the second is removed to keep the earliest load.

**Implementation shape:** delete the **second** `engine-transitions.client.js` include (L7051 on `main`). Nothing else on that line.

**Tests**
1. `grep -c 'src="/engine-transitions.client.js"' engine.html` → `1` (RED today: `2`).
2. `npm run verify:transitions` — exit 0.
3. `npm run verify:engine-boot` — zero errors.

---

## U4 — `AGENTS.md` describes the dead copy as the live engine and misstates CI

**Outcome:** a new session reading `AGENTS.md` on `main` learns the engine is the inline script, the `check` count is right, and the CI timeout claim matches `ci.yml`.

**Current evidence** (`main`)
- `AGENTS.md:21` — "`engine-core.client.js` is the extracted bootstrap that exposes `window.SWR` / `Audio` / `Library` / `Layers` / `Story` / `VISUAL_PRESETS`." False: assembled at `engine.html:5426`.
- `AGENTS.md:105` — "`check` **49 steps**". Actual on `main`: `node scripts/run-steps.mjs check --list | head -1` → `check (58 steps)`.
- `AGENTS.md:130` — "with `timeout-minutes: 20`". `grep -n timeout-minutes .github/workflows/ci.yml` → no match.

**Implementation shape** (one `docs(agents):` commit on the Phase 2 branch):
- L21: replace the `engine-core.client.js` sentence with: "The engine itself is the inline `<script type="module">` in `engine.html` (≈L2776–L5530; `window.SWR` assembled at ≈L5426). There is no extracted core module."
- L105: **49** → **58** (Phase 1 separately writes 60 on its branch; the merge conflict on this one line resolves to whatever `--list` prints at merge time).
- L130: per decision D2 — default: delete the `timeout-minutes: 20` clause (doc-only). If D2 says restore it, add `timeout-minutes: 20` under the job in `ci.yml` instead and leave the doc line — that is a CI-policy edit and is called out as such.

**Tests** — `node scripts/run-steps.mjs check --list | head -1` prints the number written at L105; `grep -c "engine-core" AGENTS.md` → 0; `grep -c timeout-minutes AGENTS.md .github/workflows/ci.yml` agree (both 0, or both ≥1).

---

# Execution Structure

## Phase 1 — `feat/slip-sets-1` coherent and CI green (on that branch)

| # | Task | Domain | Agent | Skill | Dependencies | Deliverable |
|---|------|--------|-------|-------|--------------|-------------|
| 1 [CP] | U1: fix `engine-reel.client.js:40` comment; add the audio-path-exists assertion to `scripts/check-reel-unit.mjs`; AGENTS.md reel bullet + 58→60; Commit A with explicit paths | Code | @code-test | Skill("omb-tdd") | D1 decided | commit on `feat/slip-sets-1` |
| 2 | U1 Commit B: D1-A `git add audios/slip-sets-1/*.mp3`, or D1-B upload + rewrite 8 JSON paths | Code | @git-commit | — | 1 | commit on `feat/slip-sets-1` |
| 3 [CP] | U1 tests 1-5 incl. the throwaway-worktree clean `npm run check`; push; confirm CI `completed success` | Code | @code-test | Skill("omb-tdd") | 2 | green CI run id |

## Phase 2 — dead copy + duplicate include removed (new branch from `main`)

| # | Task | Domain | Agent | Skill | Dependencies | Deliverable |
|---|------|--------|-------|-------|--------------|-------------|
| 4 [CP] | U3: delete the second `engine-transitions.client.js` include (`engine.html:7051` on `main`); `verify:transitions` + `verify:engine-boot` | UI | @ui-implement | Skill("omb-orch-ui") | — | `engine.html` |
| 5 | U2: `git rm engine-core.client.js`; apply the 4 comment rewrites verbatim | Code | @ui-implement | Skill("omb-orch-ui") | 4 | deletion + 3 `.js` files |
| 6 | U2 tests 1-3 + U3 test 1 | Code | @code-test | Skill("omb-tdd") | 5 | green output |
| 7 | U4: AGENTS.md L21 / L105 / L130 per D2 | Documentation | @doc-writer | Skill("omb-doc") | 5, D2 decided | `AGENTS.md` |
| 8 [CP] | Review every hunk is add/delete/comment/doc/test; `npm run check:full`; open PR against `main` | Code | @code-review | Skill("omb-pr") | 6, 7 | PR |

Phase 2 does not wait for Phase 1 to merge. When both are in `main`, `AGENTS.md:105` conflicts on one line — resolve to the `--list` output.

# Verification

| Command | Automated pass | When |
|---|---|---|
| `npm run check:reel-unit` | `REEL UNIT: all assertions passed` (incl. new audio-path assertion) | task 1, 2 |
| `npm run verify:engine-boot` | no `✗`; 0 page errors | tasks 3, 4, 6 |
| `npm run build && npm run check:dist-links` | `✓ every internal link resolves in dist` | task 3 |
| `npm run verify:transitions` | exit 0 | task 4 |
| `node scripts/run-steps.mjs check --list \| head -1` | `check (60 steps)` branch / `check (58 steps)` main | tasks 1, 7 |
| `npm run check` | `check: all N steps passed` | tasks 3, 8 |
| `npm run check:full` | all 19 steps pass | task 8 |
| `gh run list --branch <branch> --limit 1` | `completed success` | tasks 3, 8 |

Manual: `http://localhost:5174/engine/` → Network: `engine-transitions.client.js` once, no 404s; Console empty; (Phase 1) the demo reel plays its first track.

# User verification

- **D1 — slip-sets-1 audio (7 MP3, 33 MB):** A) commit to git (deploy ~99 MB / 130 MB; permanent repo weight; precedent: `audios/` is tracked) or B) host externally and rewrite the 8 JSON paths. Plan default: A.
- **D2 — `timeout-minutes: 20`:** AGENTS.md claims it, `ci.yml` lacks it. Delete the doc claim (default, doc-only) or restore the 20-minute timeout in `ci.yml` (CI-policy change; note both failing runs on this branch exceeded 19 min).
- **FYI, no action:** `6a1ba56`'s `feat(fx)` message will keep describing a commit that is mostly reel wiring.
- **FYI, outside this plan:** four stale snapshot branches — `feat/downloads-snapshot-2026-09-11`, `backup/feat-downloads-snapshot-2026-09-11-20260919`, `backup/feat-parallel-snapshot-20260919`, `backup/feat-parallel-snapshot-20260920` — have an `engine.html` that **loads** `engine-core.client.js` (their L1663) with the inline script removed. They must never be rebased onto Phase 2; deleting them is your call.

# Risks

| Risk | Mitigation |
|---|---|
| D1-B chosen but `importSet` rejects absolute URLs | Grep `engine-reel.client.js` / `swr-sets.js` for the audio-path handling before uploading; if it prefix-checks `/audios/`, fall back to D1-A. |
| Phase 2 line numbers drift before execution (7 unmerged branches touch `engine.html`) | Every edit is also specified by content + grep; the executor re-greps and never trusts the number alone. |
| `main` may be CI-red for reasons outside U2-U4 (`branches-ignore: main`, so no run exists) | Task 8 runs `check:full` locally first; if red outside scope, report the failing step and stop — do not widen. |
| D1-A adds 33 MB to every future clone | Accepted by D1; alternative is D1-B. |

Boundary: conforms — no new module, no new global, no change to `window.SWR`.
