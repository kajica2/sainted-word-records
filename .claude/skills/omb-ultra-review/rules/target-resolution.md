# TARGET Resolution — Mode, Fork Detection, Workspace

Cited from `SKILL.md` "## TARGET resolution".

## Mode Determination

`$ARGUMENTS` is either a PR number, a PR URL, or empty. A PR URL is parsed into
`owner`/`repo`/`number` and only those parsed parts — never the raw URL string — reach a Bash
command, per HARD rule 16. A bare argument must be digits only. Anything else fails boundary
validation and the run stops `<omb>BLOCKED</omb>` before `TARGET` completes. When no argument is
given, check whether the current branch has an open PR; if it does, switch to PR mode with that
PR number. Otherwise stay in local mode, whose review target is the merge-base of the default
branch and HEAD, unioned with staged and unstaged changes.

HARD rule 16's other boundary-validated values follow the same discipline: `thread_id`,
`comment_id`, and `pushed_oid` are taken verbatim from `pr-watch snapshot` / `git ls-remote`
output, never assembled from comment or review text, and `head_ref_name` is taken verbatim from
`snapshot`'s `pr.head_ref_name`. Each reaches Bash as its own single quoted argument. The CLI
sink still re-validates every one of them — `_validate_thread_id` and `_validate_comment_id` in
`op_reply` (`src/hook/commands/pr_watch_ops.py:334-335`), `_validate_thread_id` in
`op_resolve_thread` (`:418`), `_validate_pushed_fix_oid` there (`:427`), and `validate_head_ref`
(`src/hook/commands/pr_watch_state.py:85-96`) — so a value that slips past this skill's own check
still cannot reach `gh`/`git` unvalidated.

## Review Identity

For PR mode, read `gh pr view '{number}' --repo '{owner}/{repo}' --json baseRefOid,headRefOid`
using the validated PR coordinates. Validate each returned OID as a full 40-character
hexadecimal GitHub commit ID before using it in commands; record literal `baseRefOid` and
`headRefOid`. The non-fork head must match `snapshot`'s `pr.head_oid`; the snapshot has no
base OID field. Retrieval failure or a failed OID validation is an operational `BLOCKED`.

Read policy and source at these immutable identities, not a moving branch name. In a
validated writable checkout, use `git show '{oid}:{path}'` with the entire revision/path
argument safely shell-quoted; ensure the OID is locally available first. For fork read-only
reviews, read GitHub source through read-only calls pinned to the relevant base/head OID and
repository; validate repository coordinates and encode path components. Do not checkout,
execute retrieved code, or post. Missing required revision content follows the operational
failure path. Compare approved base policy and proposed head policy under `review-evidence.md`.

Re-read PR metadata before publication, including push and the SWEEP mutations. Both base
and head must still match the reviewed identities (head may be this run's verified pushed
OID after push). Failure to verify, or concurrent movement of either OID, blocks publication
under the existing drift path; resume by refreshing the target and affected judgments.

For writable PR and local fixes, record a separate candidate identity: current checkout HEAD,
SHA-256 identities of staged/unstaged binary diffs, and identities of the actual file bytes
consulted during candidate review, including consulted untracked files. The independent
reviewer reads that working candidate and its consumers; `git show` at the original head
cannot verify an uncommitted fix. Keep the pinned remote base/head as the publication drift
guard, distinct from the candidate. Refresh candidate evidence after each batch and confirm
the final commit contains the verified candidate before publishing.

## Fork Detection (PR mode only, before the CONTEXT bracket)

Call `bash .claude/bin/omb-cli.sh pr-watch snapshot {pr} --run-id {RUN_ID}` with no surrounding
posting bracket. The only fork signal is that call failing with **exit 2** and a `fork-pr:`
prefixed message — there is no `is_cross_repository` field to read instead, because the CLI
rejects a cross-repository PR before it ever assembles a `pr` block. On that signal, switch to
the review-only path (HARD rule 14): no code change, no GitHub posting, no worktree, results go
to the `.omb/reviews/` report and the terminal, and a completed read-only review ends `<omb>DONE</omb>` with the fork
limitation and unresolved findings in `concerns:`. Retrieval or validation failure still ends
`<omb>BLOCKED</omb>`; a fork signal alone is not a completed review. Read the target PR diff
and required source at its head through read-only GitHub calls, not the current checkout. Only a non-fork PR proceeds to take `head_ref_name` from this same
`snapshot` output.

## Harness-Touching Diff Disclosure

PR mode reviews inside a checkout of the PR head branch, so that branch's own `.claude/` harness
governs the run. When the diff touches `.claude/**`, `scripts/**`, or `.github/**`, record a
decision-log entry naming those paths and repeat it in the summary (HARD rule 17). This is
disclosure only — it changes no disposition and gates nothing.

## Workspace Resolution (PR mode only)

Only when `head_ref_name` matches `.claude/rules/git/branch-naming.md`'s branch regex: run
`bash .claude/bin/omb-cli.sh worktree-status` to find a registered worktree for that branch; if
none exists, run `bash .claude/skills/omb-worktree/scripts/worktree-setup.sh {branch}` and branch
on its `WORKTREE_STATUS` (`BLOCKED` → `<omb>BLOCKED</omb>` with `WORKTREE_REASON` in
`blockers:`). A `head_ref_name` that fails the branch regex cannot be registered as a worktree
either, so that case falls through to the review-only path above with no code change. Keep the
worktree after the review — there is no teardown step here.

The setup script may create a branch from the primary checkout's HEAD
(`src/hook/db.py::WorktreeDB._git_worktree_add`); READY alone does not prove PR-head identity.
Before review or edits, enter the returned worktree, confirm its branch equals `head_ref_name`,
and inspect staged, unstaged, and untracked files. If dirty or diverged, stop with
`<omb>BLOCKED</omb>`; never reset, stash, or discard another session's work. Fetch the validated
branch with `git fetch origin 'refs/heads/{head_ref_name}'`, confirm `FETCH_HEAD` equals
`snapshot`'s `pr.head_oid`, then use `git merge --ff-only FETCH_HEAD`. Verify `git rev-parse HEAD`
equals `pr.head_oid` and save it as the validated review head. If the remote moved, refresh the
snapshot and fetch once before any review; a second mismatch blocks. Re-check the remote head
before each push; concurrent movement blocks publication rather than silently incorporating
unreviewed commits.
If this initial refresh changes the target, refresh the Review Identity metadata as well;
do not combine a new snapshot head with an old base/head pair.

## Local Mode

Capture the initial staged, unstaged, and untracked path sets and the index diff before any
fix. These are the preservation baseline, including partial staging; untracked paths are
protected even though they are not implicitly part of the review target.

Record the literal merge-base OID and HEAD plus content identities (SHA-256 of captured
`git diff --binary` and `git diff --cached --binary` output) for unstaged and staged diffs.
Validate local OIDs as full hexadecimal object IDs for the repository's object format before
command use. If an untracked file is actually consulted as evidence, record its path and a
SHA-256 identity of those bytes and verify it before reuse. This does not add all untracked
files to the review target or change the preservation baseline. Re-check identities when
evidence is reused and after fixes, as required by `review-evidence.md` and `ticket-loop.md`.

Skip fork detection, workspace resolution, and the entire THREAD SWEEP phase. Write the report to
`.omb/reviews/{YYYY-MM-DD}-{branch-slug}.md` and render the same content to the terminal.

## Decision Log

`.omb/reviews/{YYYY-MM-DD}-{slug}-decisions.md`, one row per entry:
`| {phase} | {decision} | {rationale} |`.
