# omb-refactoring Pipeline Contract (Delta)

Declares only what `omb-refactoring` changes relative to `omb-goal`'s autonomous pipeline. Every
other mechanic — the retry cap, the disagreement-consensus classification, `--bypass` semantics, the
decision-log format, and the terminal-status interpretation table — is single-sourced in
`.claude/skills/omb-goal/rules/pipeline-contract.md`. This file cites that contract rather than
restating its literals.

## Phase Order

`omb-refactoring` inserts one new phase, `ARCHITECT`, between `WORKTREE` and `PLAN`:

```text
Preflight -> INTERVIEW -> GATE -> WORKTREE -> ARCHITECT -> PLAN -> PLAN_REVIEW -> RUN -> VERIFY -> DOC -> PR-PREP -> PR -> DONE
```

`PR-PREP` is an internal artifact-publish transition, not part of the external chain contract. The
external-chain-compatible literal that stays interoperable with `omb-goal`'s own phase list is:

```text
Preflight -> INTERVIEW -> GATE -> WORKTREE -> ARCHITECT -> PLAN -> PLAN_REVIEW -> RUN -> VERIFY -> DOC -> PR -> DONE
```

Every phase other than `ARCHITECT` and `PR-PREP` keeps the identical name, `Skill()` target, and
terminal-status interpretation `omb-goal`'s contract already defines.

## Branch Type

`omb-refactoring` fixes the worktree branch type to `refactor/` — there is no user-facing
`--worktree` flag and no branch-type inference from the goal text. `WORKTREE` uses the identical
monotonic collision ladder `omb-goal`'s contract describes, substituting `refactor/` for `{type}`.

## --research Routing

`--research` reaches exactly one phase:

| Phase | Receives `--research`? |
|---|---|
| INTERVIEW | No |
| WORKTREE | No |
| ARCHITECT | Yes |
| PLAN | No |
| PLAN_REVIEW | No |
| RUN | No |
| VERIFY | No |
| DOC | No |
| PR | No |

`omb-refactoring` does not run the research pass itself — it is owned entirely by `omb-architect`'s
Step 2, bounded to at most 3 query results per `.claude/rules/workflow/00-research.md`.

## --codex Routing

This explicit legacy override preserves refactoring's PLAN-only delegation semantics.
Refactoring does not inherit goal's Herdr selector semantics, Herdr substages or
selected-mode Evaluation/amendment exceptions. `--codex` reaches these two phases:

| Phase | Receives `--codex`? |
|---|---|
| INTERVIEW | No |
| WORKTREE | No |
| ARCHITECT | No |
| PLAN | Yes |
| PLAN_REVIEW | Yes |
| RUN | No |
| VERIFY | No |
| DOC | No |
| PR | No |

Gating and fallback are entirely owned by the downstream `omb-plan` and `omb-plan-review`
skills — `omb-refactoring` does not inject a Codex preflight itself. Its existing VERIFY
rubric remains unchanged; no Herdr stage is implied by inheritance.

## Architect Artifact Handoff

`ARCHITECT` produces `.omb/architect/{date}-{slug}.md`, cross-checked against the first `artifacts:`
entry in `omb-architect`'s result envelope for path equality, existence, and non-emptiness. The
confirmed path becomes `architect_file` and is threaded into `PLAN` (`— architect design:
{architect_file}`) and republished by `PR-PREP` alongside the plan and todo files. `PLAN` derives its
measurable-goal, target-architecture, migration-order, and behavior-preservation sections from
`architect_file` rather than re-deriving them from scratch.

## VERIFY Refactoring Rubric Gate

After `omb-verify` returns, `omb-refactoring` adds a refactoring-specific gate `omb-goal` does not
have: `@plan-evaluator` runs in `mode: post-implementation`, loading `omb-evaluation-refactoring`
against the main-session-captured implementation diff, `plan_file`, and `architect_file`. Any open
`RF-P0`/`RF-P1` ticket routes into a repair loop that mirrors `omb-verify`'s own Fix TODO mechanics
(`.claude/skills/omb-verify/SKILL.md:442-569` Step 6-8) without re-invoking `omb-verify` itself. An
absent or empty implementation-diff file is treated as fail-closed (`RF-P0`), never as an
empty-changeset pass. Retry-cap exhaustion with open `RF-P0`/`RF-P1` findings is always `(c)`
unrecoverable, mirroring the EV-P0/EV-P1 rule in `omb-goal`'s contract.

## Inherited Contract

Everything not listed above is inherited verbatim from
`.claude/skills/omb-goal/rules/pipeline-contract.md`:

- The `--bypass` semantics.
- The per-phase retry cap and its enforcement.
- The `(a)` resolvable-downstream / `(b)` quality-concern / `(c)` unrecoverable disagreement-consensus
  classification and its recording obligation.
- The decision-log entry format (`## D-{NNN}` heading, 5-column table).
- The `Design-Contract Invariants` (no conversation after GATE, fresh-worktree contract, no merge, no
  plan-mode entry).

This file does not restate any of those numeric defaults, category definitions, or table formats —
consult the cited contract directly.
