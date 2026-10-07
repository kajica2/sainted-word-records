# omb-goal Pipeline Contract

Single source of truth for the `omb-goal` autonomous end-to-end pipeline. `omb-goal/SKILL.md`
cites this file by path rather than restating its literals — same split as
`.claude/skills/omb-plan/rules/architecture-reconciliation.md` cites
`.claude/rules/common/architectural-boundaries.md`.

## Phase Order

The pipeline runs the following phases in fixed order. No phase is skipped or reordered:

```text
PREFLIGHT -> INTERVIEW -> GATE -> WORKTREE -> PLAN -> PLAN_REVIEW -> RUN -> VERIFY -> DOC -> PR -> DONE
```

- `PREFLIGHT` — validate that the session is not in plan mode; existing worktrees are ignored.
- `INTERVIEW` — collect requirements via `Skill("omb-interview")`.
- `GATE` — the last point where the pipeline may ask the user a clarifying question before
  autonomous execution begins.
- `WORKTREE` — create exactly one worktree via `Skill("omb-worktree")`.
- `PLAN` — author the implementation plan via `Skill("omb-plan")`.
- `PLAN_REVIEW` — multi-agent plan review via `Skill("omb-plan-review")`.
- `RUN` — execute the plan via `Skill("omb-run")`.
- `VERIFY` — post-implementation verification via `Skill("omb-verify")`.
- `DOC` — documentation pass via `Skill("omb-doc")`.
- `PR` — PR creation via `Skill("omb-pr")`.
- `DONE` — terminal success state; the pipeline stops here.

### Terminal-Status Interpretation

Each chained skill returns a status tag per `.claude/rules/common/output-contract.md`. The
pipeline interprets each phase's terminal status as follows, citing the canonical verdict
table in `.claude/skills/omb-verify/SKILL.md` (Step 9, "Verdict Rules") for the `VERIFY`
phase specifically:

| Phase status | Meaning | Pipeline action |
|---|---|---|
| `<omb>DONE</omb>` | Phase succeeded | Advance to the next phase |
| `<omb>RETRY</omb>` | Phase failed but is retryable | Re-run the phase, subject to the per-phase retry cap |
| `<omb>BLOCKED</omb>` | Phase cannot proceed without human input | Stop the pipeline and surface the blocker |

In a selected Herdr parent phase, a successful child completes only its recorded
substage. Advance the parent phase only after all its required substages complete;
RETRY resumes the incomplete substage under the same parent budget.

## `--bypass` Semantics

In the omb-goal pipeline, `--bypass` means: suppress next-step prompts AND auto-resolve
lifecycle prompts to the non-destructive default (keep).

`omb-goal` keeps `--bypass` flowing to every chained skill rather than stripping it before the
first downstream call, because the whole point of the goal pipeline is next-step-prompt
suppression across the entire chain, not just at the entry point.

## Herdr selector routing

`--codex` / `--claude` are mutually exclusive and require Herdr with that CLI. No selector
preserves existing behavior. No raw selector reaches PLAN or the existing PLAN_REVIEW;
the goal performs capability preflight and dedicated skills own Pane dispatch.

| Parent phase | Selected behavior |
|---|---|
| PLAN | Existing authoring, no CLI-selector propagation |
| PLAN_REVIEW | Existing Evaluation until pass, then separate Herdr Plan review and amendment only |
| VERIFY | Existing Verify, then separate Herdr Verify, repairs and fresh checks |
| INTERVIEW / WORKTREE / RUN / DOC / PR | Existing owners unchanged |

The exact substages, persistent evidence and resume rules are in `herdr-stages.md`.
Do not add external parent phase enums. Never bypass a required selected stage because
the same CLI hosts the parent, the tree is clean, or Herdr is unavailable.

## Retry Cap (HARD)

The per-phase retry cap is 3.

There is no environment variable to tune this cap. When a phase exhausts its retry cap, the
pipeline classifies the exhaustion per the Disagreement-Consensus Classification below.

Enforced by: `tests/harness/test_goal_pipeline_contract.py` (case 5).

## Disagreement-Consensus Classification (HARD)

Exhausted phases are classified as (a) resolvable-downstream, (b) quality-concern, or (c) unrecoverable.

- **(a) resolvable-downstream** — the exhausted phase's failure can be addressed by a later
  phase (for example, a `PLAN_REVIEW` disagreement that `RUN` can absorb via scope
  clarification).
- **(b) quality-concern** — the exhausted phase produced a result that is usable but
  suboptimal; the pipeline proceeds with a logged caveat.
- **(c) unrecoverable** — the exhausted phase blocks all forward progress.

Classifications (a) and (b) MUST be recorded in the decision log. Classification (c) emits
`<omb>BLOCKED</omb>` and stops the pipeline.

A `VERIFY` phase that ends with unresolved EV-P0/EV-P1 findings MUST be classified (c)
unrecoverable; (a)/(b) are not permitted for it.

With a Herdr selector, required Evaluation failure, unresolved mandatory amendments,
incomplete existing Verify, or failed/incomplete Herdr verification also MUST be (c).
The ordinary retry action resumes only the incomplete persisted substage; it cannot
restart successful Evaluation after Herdr amendments or reset consumed retry counts.
Plan amendments explicitly skip re-evaluation; code repairs require mapped checks and
fresh Herdr verification. These overrides do not change the flagless goal path.

Enforced by: `tests/harness/test_goal_pipeline_contract.py` (case 9) and the `omb:plan-review`
gate, which is the phase most likely to produce a disagreement-consensus exhaustion.

## Decision Log Contract (HARD)

Location is two-stage keyed. `PREFLIGHT` binds the decision log path under the goal-derived
slug: `{INVOCATION_PROJECT_ROOT}/.omb/goal/{slug}-decisions.md`. Once `WORKTREE` resolves the
uniquified branch name (see the Fresh-worktree contract above), it re-keys the decision log to
`{INVOCATION_PROJECT_ROOT}/.omb/goal/{final-branch-slug}-decisions.md`, renaming any file
`PREFLIGHT` already created. From that point forward the re-keyed path is absolute and
binding for the remainder of the run; the pipeline MUST NOT write the decision log anywhere
else.

Entry format — each decision gets its own heading and a 5-column table:

```markdown
## D-{NNN}: {title}

| Phase | Decision | Alternatives | Rationale | Ticket refs |
|---|---|---|---|---|
| {phase name} | {what was decided} | {alternatives considered} | {why this choice} | {ticket IDs, or "none"} |
```

The table header is exactly: `Phase | Decision | Alternatives | Rationale | Ticket refs`.

If the decision log file is missing, the PR render is BLOCKED. This is not a silent
"no overrides" fallback — a missing decision log at PR-render time is treated as a pipeline
defect, because every (a)/(b) classification recorded during the run must be traceable in the
final PR body.

Enforced by: `tests/harness/test_goal_pipeline_contract.py` (case 10).

## Design-Contract Invariants (behavioral, not statically enforceable)

These invariants describe the pipeline's intended behavior. They are not enforced by a test
oracle in this repository; they are gated by a manual LIGHT pilot run at review time.

- **No conversation after GATE.** `AskUserQuestion` is permitted only during `GATE` and inside
  the `INTERVIEW` phase itself. No phase after `GATE` may prompt the user
  interactively — the pipeline runs autonomously from `WORKTREE` through `PR`.
- **Fresh-worktree contract.** Existing active worktrees are never inspected, cleaned, or reused.
  `WORKTREE` always creates one new worktree under a uniquified branch name, and downstream
  phases bind to it explicitly through cwd and explicit artifact paths.
- **No merge.** The pipeline's terminal success condition is an open PR, not a merged one.
  Worktree teardown belongs to `omb-pr-watch` on the delegated path (probe succeeded) or to
  `omb-pr` Step 6's legacy branch (probe failed), never to `omb-goal` itself.
- **No plan-mode entry.** The pipeline never enters Claude Code plan mode; `PREFLIGHT`
  detects plan mode and blocks if present.
