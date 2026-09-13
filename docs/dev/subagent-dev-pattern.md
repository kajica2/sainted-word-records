# Plan — Sub-Agent-Driven Development Sprint Pattern

> **Goal:** Establish a repeatable, reliable sprint pattern for
> sub-agent-driven development based on lessons from the 22-PR
> sprint that cleared the audit queue (PRs #25-#67, 2026-09-08/09).

## Why this plan

The 2026-09-08/09 sprint shipped 22 PRs in ~16 hours of clock time
(across two sessions) using sub-agent-driven-development. ~60% of
sub-agent dispatches completed cleanly; ~40% had one of these
failure modes:

| Failure mode | Frequency | Resolution |
|--------------|-----------|-------------|
| Timeout at 600s with work actually done | ~3 dispatches | Verify working tree directly; commit manually |
| Phase 2 subagent reports Phase 1 incomplete (false negative) | ~2 dispatches | Verify working tree state; commit Phase 2 manually |
| Phase 2 subagent reports gate "fails" but it actually passed | ~1 dispatch | Re-run gate independently |
| Subagent modifies files outside scope | ~1 dispatch | Re-read working tree; reset targeted files |

These are all **avoidable with better orchestration**. This plan
defines a hardened pattern.

## The pattern

### Step 1 — Plan the work

**Owner**: human + AI planner (one short session).

Produce a `.hermes/plans/YYYY-MM-DD_HHMMSS-<slug>.md` document
with:

- Goal (one sentence)
- Current context / assumptions (3-5 bullets)
- Architecture / proposed approach (2-3 sentences)
- Step-by-step tasks (5-8 tasks, each <30 min)
- Tests / validation (smoke assertion targets)
- Risks / tradeoffs / out-of-scope list
- Cross-references

**Why**: every dispatch needs a written plan to ground the
sub-agent. Sub-agents without plans produce code that doesn't fit
the codebase (see the 5 stale smoke failures we eventually traced
back to the `</script>` bug introduced by a sub-agent).

### Step 2 — Slice into phases

Split the plan into **2 phases**:

- **Phase 1**: code changes + smoke assertions
- **Phase 2**: full gate + commit + push + PR + merge + doc sync

**Why**: phase 2 depends on phase 1's working tree state. If the
sub-agent hits the 600s timeout while doing phase 2, you can't
verify what shipped. Separating phases lets you commit + PR phase
1 manually even if phase 2 stalls.

### Step 3 — Dispatch phase 1

Use `delegate_task` with a sub-agent whose prompt includes:

- "Read the plan at `<path>` first"
- "Follow the plan's Tasks 1-N in order"
- "Stay focused on Tasks 1-N only" (explicit scope boundary)
- "Don't do the gate/docs/commit/PR/merge step — that's a follow-up sub-agent"
- "CRITICAL: <known gotcha>" (e.g., the `</script>` escape)
- "Return: which tasks completed, smoke assertion count (was N, target N+1), any blockers"

**Why**: explicit scope + critical reminders reduce wasted work.
Sub-agents without scope boundaries often run the gate + commit
+ PR + merge themselves, which makes Phase 2 redundant.

### Step 4 — Verify phase 1

**Owner**: AI (always, even if sub-agent reports success).

After the sub-agent reports "complete":
1. `git status` — confirm what's modified
2. `grep -n` for the new code — confirm it landed in the right place
3. Run the smoke gate (`npm run check:syntax` + 9 unit suites + 2 smokes)
4. **If gate green** → proceed to phase 2
5. **If subagent reported failure but work is there** → ignore the subagent's report and proceed (happens ~10% of the time)
6. **If work is missing** → re-dispatch or fix manually

**Why**: the subagent's batch-completion message has been wrong
about 15% of the time in this sprint. Always verify.

### Step 5 — Dispatch phase 2

Use `delegate_task` with a sub-agent whose prompt includes:

- "Read the working tree state first to confirm Phase 1 has landed"
- "If anything's missing, report it and STOP — don't try to fix it"
- "Tasks: full gate, commit, push, open PR, merge, doc sync"
- "Return: file paths modified, commit SHA, merged PR number"

**Why**: phase 2 is mechanical (commit + push + merge). The risk
is that the subagent might be tempted to "fix" missing pieces
instead of stopping. Explicit "if missing, STOP" prevents that.

### Step 6 — Run the gate independently (one more time)

**Owner**: AI.

Even after phase 2 merges successfully, run the full gate:

```bash
npm run check:syntax
# 9 unit suites in a loop
node scripts/test-api.mjs
node scripts/check-mv-smoke.mjs
node scripts/check-automix-smoke.mjs
```

**Why**: phase 2 might have introduced a regression. The gate is
fast (~30 seconds) and catching a regression at merge time is
much cheaper than catching it in the next sprint.

### Step 7 — Update docs

Doc updates can happen in any phase. Recommended split:

- **Phase 2a (in phase 2 subagent)**: update the doc that
  directly references the new feature (e.g., `docs/music-video.md`
  for a new `SWR_X` global). One-liner: "update §3 + §9".
- **Phase 2b (separate subagent)**: update `docs/prds/PRD-AUDIT.md`
  to mark the PRD as shipped. Different file, different concerns.
- **Phase 2c (post-merge)**: update `docs/SPRINT-SUMMARY.md` if
  the work clears a milestone or is part of a larger arc.

**Why**: doc updates are often forgotten if not explicitly scoped.
Splitting them into multiple files lets each phase succeed
independently.

## Sub-agent prompt template

```text
[CONTEXT]
Repo: <repo-path>. Node 20+, npm only. AGENTS.md rules apply:
2-space indent, single quotes, no TypeScript, ESM, conventional
commits, branch from main (don't push to main directly), verify
with the gate before claiming done. The `check:manifest` step
locally fails without LIBRARY_BLOB_URL — that's expected, not a
regression.

[WORKING TREE STATE]
The current main HEAD is <sha>. <N> files are modified by Phase 1.
Verify with `git status` before starting.

[PLAN]
Read the plan at <path> first. Follow the plan's Tasks 1-N in
order. Each task has copy-pasteable code and a verification
command. Don't invent steps not in the plan.

[CRITICAL REMINDERS]
<known gotchas specific to this work>

[SCOPE BOUNDARY]
Stay focused on Tasks 1-N only. Don't do:
- The full gate across all unit suites (a follow-up subagent does this)
- Doc updates (a separate subagent does this)
- Commit + push + PR + merge (the follow-up subagent does this)
If you find yourself doing these, STOP and report back.

[EXPECTED OUTPUT]
A concise final report with:
- Which tasks completed (1-N)
- Files modified (with `git diff --stat`)
- Smoke assertion count (was X, target Y)
- Any blockers encountered
```

## Recovery patterns

When the sub-agent reports success but the work is wrong:

1. **Phase 1 work missing**: re-dispatch phase 1 with explicit
   pointers to what to redo. Add a "confirm the file is at HEAD~1"
   step.
2. **Phase 1 work right but Phase 2 subagent missed something**:
   do phase 2 manually. Subagents are bad at multi-task follow-ups
   after a delay.
3. **Gate red after merge**: revert the merge commit, fix the
   issue, re-merge. Don't ship a red gate.

When the sub-agent times out:

1. **Check `git status`** — work may be there even if subagent
   didn't report it.
2. **Verify with the gate** — work may be correct even if
   subagent didn't finish reporting.
3. **Commit + PR manually** — don't wait for a second subagent
   that may also timeout.
4. **Pattern**: when one subagent times out, the next will too
   if it has the same scope. Reduce scope, not just retry.

When the sub-agent reports gate failure but the gate is green:

1. **Re-run the gate independently** — subagents sometimes
   report stale state.
2. **Check the smoke trace carefully** — sometimes it's a port
   collision (EADDRINUSE), not a real failure.
3. **Clean up port 5181/5180** before re-running if you see
   EADDRINUSE.

## Communication protocol

When a sub-agent dispatches its own Phase 2 sub-agent (like
the Phase 2 subagent for /photo dispatched its own follow-up),
verify both finished. The protocol:

1. Check both `delegation/live/` directories
2. Verify both phases are merged to main
3. If Phase 2 sub-agent never finished, manually do Phase 2

## Don'ts

- ❌ Don't dispatch a single mega-PR with 10+ tasks. Subagents
  drift on long tasks.
- ❌ Don't have subagent do the gate if you don't trust the
  report. Always re-run.
- ❌ Don't include "verify with smoke" as the last task in a
  plan — that's an implicit commitment to a phase 2 subagent.
- ❌ Don't batch subagents that depend on each other in
  parallel. Phase 1 → wait → Phase 2.

## Dos

- ✅ Do split work into Phase 1 (code + smoke) and Phase 2 (gate + commit + PR + merge + docs).
- ✅ Do include critical gotchas in the subagent prompt (e.g., the `</script>` escape).
- ✅ Do verify the working tree state after every sub-agent batch.
- ✅ Do re-run the gate after a successful merge.
- ✅ Do document the sprint via SPRINT-SUMMARY.md after a milestone.

## Templates

Save these to `.hermes/templates/`:

### `.hermes/templates/phase1.md`

```text
Phase 1 of the <feature> plan: implement code + smoke assertion.

The plan is at <path>. Follow the plan's Tasks 1-N in order.
Each task has copy-pasteable code and a verification command.
Don't invent steps not in the plan.

Tasks 1-N only. Do NOT do:
- The full gate across all unit suites (a follow-up subagent does this)
- Doc updates (a separate subagent does this)
- Commit + push + PR + merge (the follow-up subagent does this)

If a task fails, debug and fix it. Don't punt to a follow-up.

Critical reminders:
- <known gotchas>

Return a concise final report with:
- Which tasks completed
- Files modified
- Smoke assertion count (was N, target N+1)
- Any blockers
```

### `.hermes/templates/phase2.md`

```text
Phase 2 of the <feature> plan: full gate, commit, push, PR, merge.

First: read the working tree state to confirm Phase 1 has landed.
Run `git status` and `git diff --stat`. If anything's missing,
STOP and report — don't try to fix it.

Tasks (in order):
1. Run the full gate (check:syntax + 9 unit suites + test-api +
   check-mv-smoke + check-automix-smoke)
2. Commit the staged changes
3. Push the branch
4. Open a PR
5. Merge the PR (auto-merge or `gh pr merge`)
6. Doc sync: update <doc-path> with the new feature

Return:
- File paths modified
- Commit SHA
- Merged PR number
- Vercel deploy state (if visible)
```

### `.hermes/templates/docsync.md`

```text
Doc sync for PR #N (the <feature> feature).

Update <doc-path>:
- §3 (Public API surface): add new <GLOBAL> table
- §9 (post-2026 additions list): add new PR entry
- §10 (Cross-references): add PR + plan link

Optional: update <audit-doc> to mark the corresponding PRD as
"partial ship" with the PR number.

Commit + push + open PR + merge. Single-commit doc-only change.
```

## Rollout checklist (per sprint)

- [ ] Plans written for the sprint (one per feature)
- [ ] Each plan split into Phase 1 / Phase 2
- [ ] Phase 1 sub-agent dispatched with template
- [ ] Working tree verified after Phase 1
- [ ] Phase 2 sub-agent dispatched (gate + commit + PR + merge + docs)
- [ ] Gate re-run independently after merge
- [ ] SPRINT-SUMMARY.md updated if a milestone was hit

## Future improvements

Things this pattern doesn't solve yet:

- **Parallel dispatching**: phase 2 subagents for different PRs
  can run in parallel, but the gate becomes a bottleneck (one
  port at a time). Punt: serial phase 2s for now.
- **Incremental doc updates**: when a PR ships a small change that
  doesn't warrant its own doc-sync PR (e.g., one-line CSS fix), the
  pattern over-documents. Punt: small changes can bundle doc into
  the same PR.
- **Cross-PR coordination**: when 2 PRs touch the same doc section,
  they conflict in main. Punt: always run a docs-only merge commit
  at the end of a sprint to reconcile.
