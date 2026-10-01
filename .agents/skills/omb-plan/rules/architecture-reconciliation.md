# Architecture and SoT Reconciliation (Step 1.7)

Procedure for `omb-plan` Step 1.7. Performed by the **main session**, not a sub-agent —
zero new agent spawns. Runs once per plan, after change units are drafted and before the
review loop.

## Procedure

1. **Layer mapping.** For each change unit, map the files/symbols it touches to the layer
   rows they belong to, using the layer-ownership table in
   `.claude/rules/common/architectural-boundaries.md` (cite by path — do not copy the
   table into the plan or into this file).
2. **Dependency-direction check.** Judge whether any change unit crosses a layer boundary
   in the wrong direction. Examples: UI calling a repository directly, skipping the API
   client/router layers; an AI tool bypassing the service layer to touch the ORM. Flag
   each violation found.
3. **State ownership.** When a change unit introduces new state, assign its owner using
   the state-ownership table in `.claude/rules/common/architectural-boundaries.md` (cite
   by path): Postgres, Redis, a React hook, or a LangGraph checkpoint.
4. **Stack decision cross-check.** Cross-check the change against the stack decision
   table in `.claude/rules/common/stack-selection.md` (cite by path). If the plan
   introduces raw SQL, it requires an ORM Exception Protocol declaration per
   `.claude/rules/db/orm.md` (cite by path). A missing declaration is not just a review
   gap: the `raw_sql_guard` hook blocks undeclared raw-SQL writes at implementation time,
   so an undeclared exception here becomes a runtime execution failure downstream.
5. **Wiki constraints cross-check.** Cross-check the plan against the relevant constraint pages discovered through `openwiki/index.md`
   TL;DR that `omb-context` already summarizes — see `.claude/skills/omb-context/SKILL.md`.

## Output Format

Emit one `<architecture_conformance>` block per plan. Classify every finding from steps
2-5 as exactly one of:

- `conforms` — no boundary or ownership issue found.
- `intentional-deviation` — a boundary is crossed on purpose; state the rationale inline.
- `unresolved-conflict` — a boundary violation, ownership ambiguity, or stack mismatch
  with no accepted rationale.

Only `unresolved-conflict` findings are treated as P0. Escalate each one via
`AskUserQuestion` before the plan proceeds to review.

**Length-budget guard:** when every change unit classifies as `conforms`, the plan body
carries exactly one line for this step: `Boundary: conforms`. Do not expand the
`<architecture_conformance>` block into the plan body when there is nothing to report.
