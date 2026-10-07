# TICKET-LOOP — Validity, Fix Routing, Iteration Cap, Commit and Push

Cited from `SKILL.md` "## TICKET-LOOP".

## Ticket Schema

IDs, priority definitions, and consensus/veto rules: `.claude/rules/workflow/09-ticket-schema.md`
(cite, do not restate). Evaluation tickets use `UR-P{0-3}-{NNN}`; consensus tickets use
`UC-P{0-3}-{NNN}`.

## Per-Ticket Processing

1. Read the cited `file:line` directly and judge validity against HARD rule 3's one-sentence
   test: the cited code must actually show the defect, and the fix must be in scope for this
   change. Disagreement among reviewers is resolved by `@core-critique`'s judgment.
   Apply `review-evidence.md`'s source roles, finding records, and Validity and Gaps gate;
   include supporting evidence, counterevidence, and missing essential evidence in the judgment.
2. Valid → route the fix to the matching `@{domain}-implement` agent (spawn block and routing
   precedent: `.claude/skills/omb-verify/SKILL.md:504-548`, cited in `SKILL.md`'s "## Fix
   execution spawn" — do not duplicate the spawn block here).
3. Invalid or already satisfied → record the source evidence and reason; no code change is
   needed. In PR mode reply to the originating item with `declined` and a `Not adopting:`
   explanation; the summary alone does not answer a thread.
4. Review-only mode produces findings and dispositions without delegating fixes or commits.
   If a local fix overlaps pre-existing changes, preserve those bytes and mark it `needs-human`
   with the precise proposed change instead of guessing which hunks belong to the user.
5. After each fix batch, run mapped tests and applicable lint, formatting, and type checks.
   Give the changed diff and results to an independent reviewer from the REVIEW team; a fixer
   cannot approve its own change. Recompute unresolved tickets from that review, not the fixer's
   claim. Failed required checks remain unresolved tickets and prevent commit/push until fixed.
   State unavailable checks as verification gaps; do not report them as passed.

After fixes, the independent reviewer revalidates changed evidence and relevant consumers
against the working candidate identity in `target-resolution.md`, including deleted, moved,
or renamed sources and their references. Read the candidate's current bytes, not only the
original committed head. Compare its diff and consulted-content identities between batches;
changes require renewed impact judgments. Separately check the pinned remote base/head for
publication drift. Reuse unaffected evidence only while its consulted content identity still
matches. Preserve stale records and link revalidated replacements under `review-evidence.md`.
Required evidence gaps follow that rule's mode-specific termination, independently of the
ticket's existing priority or a permitted P3 deferral.

## Iteration Cap

Maximum 5 iterations (HARD rule 4). In PR mode, before each iteration, read `fix_count`
from the run state and compute `effective_fix_count = fix_count + pending_fix_batches`.
`pending_fix_batches` counts attempted fix batches not yet journaled by this run. Increment
`pending_fix_batches` before delegating a batch, so a failed attempt still consumes budget.
Do not start another batch when the effective count reaches `OMB_PR_WATCH_MAX_FIXES`
(`.claude/rules/workflow/13-pr-watch.md`, numeric default not restated). Local mode is bounded
by the iteration cap alone; review-only mode never enters the fix loop.

Keep the pending batch ledger outside `outbox_dir`, which `end` deletes. During SWEEP, record
one `fix` event per attempted batch and remove that entry from the pending count only after
confirming it exists in the state journal. Do not retry a `record` blindly: `apply_event`
increments `fix_count` on each call, so first reconcile the batch's unique `key` in the journal.
Do not edit `state.json` directly. If work stops before SWEEP, preserve the pending ledger and
report the unrecorded attempts; resume must include them in the effective count.

At the end of each iteration, check all P0-P3 tickets. No unresolved P0-P2 ticket remains is the
blocking-ticket criterion; P3-only work still receives a fix or an explicit deferral with a
reason before exit. A cap never turns an unresolved P0-P2 ticket into a successful result.

## Commit and Push

Commit and push once after the fix loop has completed verification and independent review;
do not publish intermediate batches. A loop that stops with blocking findings leaves its fixes
uncommitted and records the remaining work. Bind successful batch events to the one final
verified `pushed_oid`; failed or no-op attempts retain `pushed_oid: null` and empty `thread_ids`.

Commit only verified changes owned by this run. If local mode started with any staged,
unstaged, or untracked changes, do not stage or commit: leave safe fixes unstaged, preserve
partial staging and the original index, and list both fixes and deferred overlapping work in
the report. Do not unstage user changes merely to satisfy the empty-index precondition.
If no source change is needed, skip commit and push; do not create an empty commit.

For a clean-entry local run or a writable PR run, follow HARD rule 5:

1. `git diff --cached --quiet` to confirm the index is empty before delegating.
2. Delegate the commit to `@git-commit` in commit mode with an explicit list of this run's changed paths, excluding reports and unrelated files.
3. Confirm the current branch still equals the validated `head_ref_name` and the remote
   still equals the last reviewed or pushed head. A drift blocks push.
   Re-check both PR base/head metadata via `target-resolution.md`'s Review Identity before
   publication; an unavailable or moved target blocks publication until review is refreshed.
4. Push from the main session with an explicit refspec:
   `git push origin HEAD:refs/heads/{head_ref_name}` — never a bare `git push`, and never
   `@git-commit` PR mode (it would run `gh pr create`).
5. Confirm the pushed oid with `git ls-remote` before using it as `pushed_oid` in the fix event.

Local mode uses step 1-2 only and never pushes. No secret value is ever written into the commit
body (HARD rule 12).
# Selected Herdr completion gate

A selected Herdr review in `herdr-review.md` must complete before this loop advances to
SWEEP. Feed supported findings through this file's same validity, domain-fix and budget
rules; preserve fork review-only completion. No fresh counter or lease spans Herdr work.
