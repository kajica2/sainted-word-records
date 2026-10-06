# Required Herdr substages

Applies only when the goal's selector enabled Herdr. The shared Claude launcher tries
TeamClaude first and permits only its bounded native-Claude fallback. No cross-kind
fallback, same host no-op, or
legacy availability/clean-tree skip is allowed. The host invokes the bound skill names;
the goal never calls Agent directly. Keep parent phase enums unchanged.

## Persisted handoff and resume

At WORKTREE bind `herdr_state_file` to the absolute primary-root
`.omb/goal/{final-branch-slug}-herdr.json`, link it from DECISION_LOG and result artifacts,
and initialize it before PLAN_REVIEW. Do not add fields to existing hook/DB schemas.
Write this separate artifact after every substage transition and before external dispatch:

- version, run identity, selected `agent_kind`, absolute `cwd`, `plan_path`, `plan_digest`;
- parent phase and substage, `retry_count` and consumed parent-phase budget;
- Evaluation artifact, verdict and evaluated digest; amendment pre/post digest and table;
- existing Verify artifact and candidate identity; required checks/results;
- each Herdr `request_id`, session/tab/Pane IDs, request/report paths, candidate identity,
  verdict, completion status, remediation dispositions and next incomplete action.

Use the bound HERDR_RESULT_CONTRACT for exact report and candidate identity fields.
Persist request identity returned by the delegated skill, not a guessed completed result.
On timeout recover that recorded request through the bound management skill before any
resubmission; never create a duplicate tab merely because output is delayed. Missing state,
wrong cwd/kind/Plan, malformed report, or a changed candidate means BLOCKED with a precise
resume action, not presumed success. Preserve completed evidence and consumed counts on
resume; do not reset a retry counter or replay a completed dispatch. If dispatch completion
is uncertain, reconcile the management ledger before proceeding.

When a delegated turn switches to async wait, persist wait_mode=async, poll_task_id and
deadlines in herdr_state_file and yield; the poller's completion resumes the same substage.

### 1. Existing Evaluation

Within PLAN_REVIEW, use the existing Plan draft/review/improvement/Evaluation workflow.
Require its documented passing evaluator/review evidence and no unresolved mandatory
findings, bound to the evaluated Plan digest. A DONE tag alone without that evidence is
insufficient. Repeat incomplete review/improvement within the parent retry cap from
pipeline-contract.md. Required Evaluation failure at exhaustion is always BLOCKED;
never classify it as a quality concern to advance. Herdr review and RUN cannot start yet.

### 2. Herdr Plan review

After Evaluation passes, call the bound HERDR_REVIEW_SKILL with
`--bypass --{agent_kind} --target plan --plan-only {absolute plan_path}`. Pass the original requirements,
acceptance criteria, validated cwd/baseline, and Evaluation artifact as structured handoff
context. The reviewer runs with mutation_policy=plan_only: it may edit only the Plan,
never source, commits or pushes. When post_plan_digest differs from plan_digest, record the
delegate's fixed findings as Herdr amendments and record `evaluation not rerun after Herdr
amendments` on post_plan_digest; that digest is the amended Plan digest checked before RUN.

Accept only a complete matching report under HERDR_RESULT_CONTRACT. This reviewer runs
under mutation_policy=plan_only, so its APPROVE is never `self_fixed_pending_reverify`
(HERDR_RESULT_CONTRACT step 5 exempts plan_only Plan review — its Plan edit is already
the recorded Herdr amendment above, not a pending re-check): APPROVE advances directly.
REJECT with supported findings invokes the bound PLAN_REVIEW_SKILL using
`--apply-findings-only {absolute report_path} --bypass {absolute plan_path}`.
Verify the returned `finding ID -> disposition -> Plan file:line -> evidence` table and
pre/post digests. Unresolved mandatory findings are BLOCKED. Preserve the old Evaluation
score only on its original digest.

No automatic Herdr Plan re-review. Do not call the ordinary evaluation/review workflow or
follow its re-evaluation next-step hint after amendments. Return from the narrow mode to
this substage's completion check, not the start of PLAN_REVIEW.

### 3. Implementation

RUN uses the final amended Plan path and digest with its existing `--worktree --bypass`
invocation. Confirm the bytes match the recorded final digest immediately before dispatch.
Do not delegate implementation to Herdr. A changed Plan requires reconciliation rather
than reusing approval for another document.

### 4. Existing Verify

Within VERIFY, complete the ordinary VERIFY_SKILL `--bypass {absolute plan_path}` first,
including its checks and fixes. Require successful required checks and no unresolved
mandatory defects. Record its report and candidate identity. Herdr Verify, DOC and PR
cannot run while that gate is incomplete.

### 5. Herdr Verify

Before every HERDR_VERIFY_SKILL call, including the fresh Herdr Verify after remediation,
commit any pending changes in the goal worktree (the one bound at WORKTREE and used by
stage 3's `--worktree` RUN) as a local checkpoint commit `chore(goal): checkpoint before
Herdr Verify` with the repository's git identity and normal hooks (never `--no-verify`) and
no push, so the pipeline-owned worktree is clean and Herdr Verify runs in place without
dirty-checkout isolation. A failed checkpoint commit (for example a pre-commit hook failure)
is BLOCKED, never a fall-through into isolation.

Call the bound HERDR_VERIFY_SKILL with `--bypass --{agent_kind} --no-push {absolute plan_path}` and
the original requirements, final Plan, cwd and current candidate identity. A matching
complete PASS with required coverage advances directly only when it declared no
changed_files and no commits. The verifier runs with mutation_policy=full and
push_policy=none; PR creation pushes.

If it changed source, the report is `self_fixed_pending_reverify` (HERDR_RESULT_CONTRACT
step 5): do not accept its PASS. Run mapped checks for its declared changed files, then
dispatch one more Herdr Verify on the recomputed post_candidate_identity with the same
`--no-push` invocation, charged to the existing VERIFY retry budget (not a new unbounded
loop). Accept the pipeline's PASS only when that re-verify call itself declares
changed_files=[] and no commits — proving the candidate needed no further fix; a re-verify
that again reports changed_files is a second self-fix and repeats this same paragraph,
still charged to the same budget, until the budget is exhausted (then BLOCKED) or an
empty-changed_files PASS is observed. Otherwise (the report is not a matching complete
PASS — incomplete, stale, or RETRY) start a fresh Herdr Verify charged to the VERIFY
budget. A supported FAIL invokes VERIFY_SKILL
`--remediate-findings {absolute report_path} --bypass {absolute plan_path}`. This mode
uses existing domain implementers.

After remediation, require mapped checks and a fresh Herdr Verify on the new candidate,
using the same selected kind. Charge remediation/reverification cycles to the existing
VERIFY retry budget; do not create another unbounded loop or reset it on resume. Preserve
the existing Verify result as evidence for its original candidate and record the mapped
checks for subsequent changes. New cross-cutting changes require the affected existing
checks before Herdr verification. Never reuse a stale PASS or infer PASS from fixes alone.
Required failure, evidence gaps, or exhausted budget is BLOCKED; earlier consensus cannot
waive unmet requirements. Skipping Plan re-evaluation does not skip code verification.

### 6. Remaining work

Only when both verification obligations and remediation checks are satisfied proceed to
DOC and PR. Expose selected kind, request/report/Pane identity, all candidate digests and
any live limitations in the decision log. Herdr tabs close after validated collection
under delegation §6; retained tabs follow management policy; finishing this workflow
does not authorize closing unrelated sessions.
