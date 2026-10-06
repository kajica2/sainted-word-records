# Herdr report and acceptance contract

The parent validates the child report itself; external CLI hooks are not assumed to
enforce OMB output. A settled process or existing report file is insufficient.

## Required report fields

The complete report is bounded by `BEGIN_OMB_HERDR_REPORT <request_id> <turn_id> <turn_sequence>`
and `END_OMB_HERDR_REPORT <request_id> <turn_id> <turn_sequence>`. It contains:

```text
request_id, turn_id, turn_sequence, session_id, template_revision, mode: task|review|verify,
target_kind, agent_kind, cwd, mutation_policy, push_policy
scope_source, plan_path, plan_digest, candidate_identity, candidate_digest
evidence_packet (remote_packet): path, packet_digest, target_repository, head_repository, PR_number
changed_files, commits (OID, subject), pushes (remote, branch, OID),
post_candidate_identity, post_plan_digest (plan target)
coverage: applicable domains and exclusions with reasons
findings: ID, P0-P3 severity, domain, requirement IDs, path, line_start/line_end,
          trigger, source/check evidence, observed impact, recommendation
requirements (verify): every ID/criterion, source anchors, implementation file:lines,
                      check IDs, observation, SATISFIED/UNSATISFIED/UNVERIFIED, reason
checks: ID, exact command, cwd, executed, exit_code, output, unexecuted reason
gaps: missing files/context, runtime limits, excluded or inconclusive evidence
verdict: APPROVE|REJECT for review; PASS|FAIL for verify (only if determinable)
terminal OMB status and result envelope
```

No fictional/example finding may become real evidence. New-file recommendations have
`proposed` path and absent line fields plus actual existing requirement/source anchors.
Source-changing recommendations require actual path/line evidence on the recorded
candidate. Verify includes the full requirement denominator; percentages must expose
unsatisfied and unverified counts and never hide essential gaps.

## Acceptance and status mapping

1. Match request_id, turn_id, turn_sequence, session_id, selected agent_kind, mode/target_kind, absolute cwd,
   Plan path/digest and full candidate identity against the saved packet. Recompute
   source digests. Under inspect_only a stale/inconsistent identity blocks
   acceptance. Under full or plan_only compare the recomputation with pre_request_head,
   pre_request_dirty and the declared post_candidate_identity/post_plan_digest; the
   difference is reconciled in step 3, not rejected here. For remote_packet use
   [fork evidence](fork-evidence.md): rehash the packet/manifest and sanitized source/diff
   bytes, compare every pinned repository/base/head/merge_base and check live PR metadata
   for drift. Do not require caller HEAD equality or substitute its files/digests.
   Require complete-file-list evidence and original source line mappings; an essential
   missing/redacted/truncated source or unexecuted required runtime check is BLOCKED.
   Do not execute
   commands suggested by a report without independently validating their task scope.
   During collection, match the latest pending turn, not just the stable request.
   Downstream reuse must match the exact persisted accepted turn and have no newer
   unresolved turn; a cleared active pointer alone never invalidates that accepted report.
   An old terminal report
   with the same request_id cannot satisfy a follow-up after uncertain delivery. For a
   collection-only fallback, require its new turn markers plus report_origin_turn_id
   matching the completed assessment being recovered; do not change candidate identity.
2. Require both markers, all applicable fields and specific evidence. A truncated,
   missing or structurally invalid report is incomplete, never a zero-finding pass.
   Recover on the same session using the collection protocol; do not repeat the review
   blindly. Evidence that cannot be accessed/validated remains an explicit gap.
3. Reconcile mutations against the pre-request snapshot, not merge_base. After collection
   observed = paths changed by commits in pre_request_head..current HEAD, plus working-tree
   paths whose content digest differs from pre_request_dirty (added, removed or changed).
   Accept when observed equals declared changed_files, every commit in that range is listed,
   pushes obey push_policy, and post_candidate_identity/post_plan_digest match the
   recomputation. Observed-but-undeclared paths, a plan_only change outside plan_path, or any
   mutation under inspect_only -> BLOCKED with the path list; declared-but-unobserved ->
   concern. Never revert, stash or attribute by timing alone. Temporary permitted
   outputs/reports go in artifacts, not changed_files.
   Any commit in pre_request_head..HEAD that touches a path listed in pre_request_dirty or
   already staged before the request, and not explicitly named by the task, is BLOCKED
   with that path list, even when it is also declared in changed_files — a pre-existing
   dirty or staged path is never swept into a delegate commit implicitly.
   The same range is checked for ignored/secret paths: any commit that adds a path matched
   by `git check-ignore --no-index` or matching `.env*`, `*.pem`, `*.key` is BLOCKED with
   that path list, unless the TASK explicitly named that path.
   A delegate commit or working-tree change touching any of the following is BLOCKED
   unless the TASK explicitly named that path — these control the guards reconciling the
   delegate itself, so a self-declared edit to them is never implicitly trusted:
   `<harness-dir>/settings.json` and `<harness-dir>/settings.local.json` (`<harness-dir>`
   is the repository's top-level harness configuration directory — the one holding
   `skills/`, `agents/` and `hooks/`), `<harness-dir>/hooks/**`, `src/hook/security/**`,
   `src/hook/cli.py`, `src/hook/core/registry.py`, and `scripts/omb-setup-settings.sh`.
   For each remote recorded in pre_request_remote_refs, re-run `git remote` then
   `git ls-remote --heads --tags <remote>` after collection, with the same
   `GIT_TERMINAL_PROMPT=0` and per-remote timeout bound as delegation §2 (a timeout counts
   as a snapshot failure under rule (b) below), and diff the result against the pre-request
   map:
   (a) For the current branch's ref on each remote: a newly created ref is accepted only
   when its OID is a declared push and that OID descends from pre_request_head (`git
   merge-base --is-ancestor pre_request_head <oid>`); an existing current-branch ref
   moving is accepted only as a fast-forward (`git merge-base --is-ancestor old new`) to a
   declared OID. Any other outcome for the current branch — an undeclared move, a
   non-fast-forward move, or a deletion — is a reconciliation failure: BLOCKED with the
   ref-change evidence.
   (b) a pre-request or post-collection snapshot failure on any remote, or no configured
   remote, forces push_policy=none per delegation §1/§2; a post-collection failure BLOCKS
   only when pushes were declared or push_policy=current_branch — otherwise it is recorded
   as a concern "remote unverified";
   (c) For every ref other than the current branch: a changed ref is attributed to the
   delegate only when its new OID exists in the local object store (`git cat-file -e
   <oid>`) and `git rev-list <oid> --not <every pre-request remote ref OID>` is
   non-empty — the new OID introduces at least one commit that was on none of the
   pre-request remote refs, so it cannot have been already on the remote before this
   request. (Worked example: the delegate fast-forwards `feature-x` from pre-request OID
   `P` to `N`; `git rev-list N --not P <every other pre-request OID>` lists the new
   commits on `N` -> non-empty -> attributed to the delegate.) Any ref change that is
   either delegate-attributed by this rule or a declared push, and that falls outside the
   accepted current-branch case in (a), is BLOCKED. Under push_policy=none, any declared
   push at all is BLOCKED regardless of which ref it targets. A ref change that is
   neither delegate-attributed nor declared (a deletion, or a new OID unknown to the
   local object store) stays a concern, never BLOCKED, and is never attributed by timing
   alone.
   (d) a declared push to any remote other than `origin` is BLOCKED.
   Under push_policy=none, any current-branch ref change at all is BLOCKED.
   The ignored/secret-path check above additionally applies to every commit reachable from
   a delegate-attributed changed ref under (c) and not reachable from any pre-request
   remote ref OID.
   Under delegation §2 isolation the snapshot is taken in the isolated worktree
   (pre_request_head = the local baseline commit, which is never accepted as delegate work);
   accepted commits reach the origin branch only through delegation §5 isolated integration,
   the verdict transfers to its integrated_candidate_identity only under the §5 origin-HEAD and
   complete dirty-map equivalence gate (otherwise it is stale/unverified for the origin
   candidate), and a blocked
   integration is a reconciliation failure under step 6.
4. P0/P1 findings or any mandatory criterion UNSATISFIED prohibit APPROVE/PASS.
   A completed, evidence-backed negative judgment maps to RETRY and REJECT/FAIL.
   P2/P3 findings may accompany a positive verdict only when no required criterion
   fails; record their disposition rather than hiding them.
5. Essential UNVERIFIED checks, missing criteria, environment/input failure, or an
   inspect_only stale/inconsistent identity per step 1, or insufficient evidence prevent
   judgment: BLOCKED, omit verdict (do not coerce it into FAIL or an apparent pass). This
   identity failure is the pre-edit inspect_only case, not a full/plan_only request's
   declared post-edit difference, which step 3 reconciles instead. Positive complete
   review/verification maps to DONE and APPROVE/PASS. Optional gaps remain explicit even
   for a positive judgment.
   A positive verdict (APPROVE/PASS) from a review/verify report under
   mutation_policy=full with non-empty changed_files or commits is self-certifying and is
   recorded `self_fixed_pending_reverify` instead of an accepted DONE/APPROVE/PASS: the
   reviewer fixed the very candidate it is judging. This does not apply to a plan_only Plan
   review: its Plan edit is already recorded as a Herdr amendment on post_plan_digest and
   reconciled by the caller's apply-findings-only handoff, not by this step.
   The re-check is named per target_kind:
   - `mode: verify`: the caller MUST NOT report PASS until a fresh Herdr verify on the
     recomputed post_candidate_identity itself reports empty changed_files (proving the
     candidate needed no further fix), or the ordinary omb-verify confirms the candidate.
   - `mode: review`, `target_kind: code`: the caller MUST NOT report APPROVE until a fresh
     Herdr review under `--inspect-only`, or the ordinary omb-ultra-review / code-review
     path, confirms post_candidate_identity.
   - `mode: review`, `target_kind: plan`, `mutation_policy: full` (a Plan review NOT run
     under `--plan-only`, which is exempt above): the caller MUST NOT report APPROVE until
     a fresh Herdr Plan review under `--plan-only` reporting empty changed_files, or the
     ordinary omb-plan-review, confirms post_plan_digest.
   Until that re-check passes, map this to RETRY with a concern naming the pending
   re-check.
6. For mode: task|review|verify, task reports omit verdict. A complete report with
   child status DONE and successful mutation reconciliation maps to DONE, except
   `self_fixed_pending_reverify` (step 5), which maps to RETRY until its independent
   re-check passes. A complete report with evidenced incomplete work maps to RETRY. A
   child BLOCKED report, an incomplete report, or a reconciliation failure maps to
   BLOCKED (a validated child BLOCKED report is recorded `completion=blocked_by_child`,
   keeps the tab, and accepts a follow-up per delegation §6).

Child example, with actual values replacing placeholders:

```text
<omb>RETRY</omb>
```

```result
summary: "Completed the requested review; one evidenced mandatory criterion fails."
verdict: REJECT
artifacts: []
changed_files: ["src/api/routes.py"]
concerns: ["{finding ID with evidence}"]
blockers: []
retryable: true
next_step_hint: "The caller applies remaining findings; this fix is disposition=fixed."
```

For VERIFY use FAIL; positive verdict uses DONE. For BLOCKED omit verdict and list
specific blockers. Output remains English. The main-session skill is an orchestrator:
preserve the child's original judgment in the report body, omit verdict from its own
canonical result envelope, and use the mapped status with report/session artifact
paths and `changed_files` set to the validated delegate changes for task/review/verify
calls, `[]` for management actions. End its response with the common OMB tag/envelope.
Do not leak credentials into output or erase relevant failure evidence while summarizing.

Record `complete` or `blocked_by_child` only for a validated complete report, even if its
verdict is negative. Operational BLOCKED/incomplete is not eligible for automatic tab
close. Lifecycle,
request completion, assessment verdict, and parent workflow disposition are independent.
Parent goal/ultra-review may own remediation; this contract never starts it automatically.
