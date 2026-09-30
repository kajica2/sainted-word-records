---
name: omb-evaluation-plan
description: "Plan quality evaluation — 44 evidence-anchored checks for code locations, implementation shapes, execution handoffs, verification, and density."
---

# Plan Evaluation (Quantitative)

## Usage Contract

This is a read-only rubric loaded by `plan-evaluator`. Evaluate the supplied plan against the
adaptive contract in `.claude/rules/workflow/01-plan.md`. Treat the plan as an executable
code-change map, not a report with mandatory numbered headings.

Do not invent repository facts or pass an item from impression. Quote plan evidence before every
PASS/FAIL and verify repository claims against actual files. A missing fixed section number is not
a defect; missing executable information is.

<role>
You are a plan quality evaluator. Score all applicable checks below, build an outcome traceability
matrix, verify repository citations and delegation references, and create one EP ticket per FAIL.
The four governing qualities are location, change shape, proof, and density.
</role>

## Evaluation Workflow

<execution_order>
1. Read the plan and `.claude/rules/workflow/01-plan.md`.
2. Identify each stated outcome/problem/change unit and every Execution Structure task.
3. Build an outcome traceability matrix: outcome -> current evidence -> implementation shape -> task -> test/pass condition.
4. Apply the N/A rules, then score all applicable items with quoted evidence.
5. Verify cited `file:line`/`file::symbol`, affected callers, `@agent`, and `Skill()` references.
6. Compute weighted scores and create EP-P0..P3 tickets for every FAIL.
7. Return the matrix, score sheet, tickets, summary, and standard result envelope.
</execution_order>

## Scoring Dimensions

| # | Dimension | Items | Weight | Focus |
|---|-----------|-------|--------|-------|
| 1 | Intent and Scope | 5 | 10% | Specific outcome, decisions, non-goals, traceability |
| 2 | Repository Evidence | 6 | 18% | Verified locations, symbols, current behavior, callers/tests |
| 3 | Implementation Shape | 7 | 18% | Exact edits, contracts, boundaries, compatibility, deletion proof |
| 4 | Execution Handoff | 6 | 14% | Concrete task rows, deliverables, dependencies, domain split |
| 5 | Delegation Integrity | 4 | 8% | Valid agents/skills and appropriate ownership |
| 6 | TDD and Verification | 6 | 14% | Named tests, RED gaps, commands, pass gates, boundary checks |
| 7 | Sequencing and Release | 4 | 8% | Phase order, parallelism, critical path, rollout/rollback |
| 8 | Documentation and Risk | 3 | 5% | Stale SoT paths, concrete risks, unresolved assumptions |
| 9 | Density and Completeness | 3 | 5% | No boilerplate, no duplication/placeholders, executable coverage |

## Checklist (44 items)

### 1. Intent and Scope (5)

| ID | PASS evidence | FAIL signal |
|----|---------------|-------------|
| intent.outcome | Specific observable outcome/problem is stated | Generic "implement feature" or solution-only title |
| intent.decisions | Governing decision/invariant is stated when needed | Cross-cutting contract is implicit or contradictory |
| intent.non-goals | Scope boundary/non-goal is stated when drift is plausible | Material adjacent work has no boundary |
| intent.assumptions | High-impact assumptions are marked verified/unverified with evidence | Assumptions presented as facts |
| intent.trace | Every outcome maps to evidence, shape, task, and proof in evaluator matrix | Any outcome is unmapped |

### 2. Repository Evidence (6)

| ID | PASS evidence | FAIL signal |
|----|---------------|-------------|
| evidence.location | Every existing-code change has exact `file:line-range` or `file::symbol` | Vague path/module reference |
| evidence.exists | Spot-checked paths, lines, and symbols exist | Citation is stale, invented, or points elsewhere |
| evidence.current | Current behavior/root cause is supported by code or runtime evidence | Unsupported diagnosis or unexplained seam |
| evidence.excerpt | Small current excerpt is included when it materially clarifies the seam | Complex change depends on prose alone |
| evidence.callers | Signature/schema/event/IPC/CLI/file-format changes name affected producers/consumers | Downstream call sites omitted |
| evidence.tests | Existing tests/fixtures/mocks nearest the seam are identified | Plan ignores relevant existing coverage |

### 3. Implementation Shape (7)

| ID | PASS evidence | FAIL signal |
|----|---------------|-------------|
| shape.operations | Exact files/symbols to create/modify/delete are named | "Update backend/frontend" |
| shape.logic | Target control/data flow or algorithm is concrete | Multiple materially different implementations fit the prose |
| shape.contract | Changed types, schemas, signatures, events, routes, IPC, CLI, or runtime DB contracts are explicit; runtime DB edits declare ORM choice | Boundary contract or applicable ORM choice is implied |
| shape.validation | Input/error/security behavior is defined at changed boundaries | Happy path only |
| shape.compatibility | Mixed-version/replay/migration compatibility is defined when applicable | Protocol/data change ignores skew |
| shape.pattern | Proposed placement follows verified neighboring/framework patterns with rationale | New abstraction ignores local seam |
| shape.cleanup | Deletions/dead-code removal name proof of zero callers and ordering | Cleanup is speculative or premature |

### 4. Execution Handoff (6)

| ID | PASS evidence | FAIL signal |
|----|---------------|-------------|
| task.table | One parseable `# Execution Structure` phase table exists | No machine-readable handoff |
| task.concrete | Every row names a change unit and concrete file/symbol slice | Bare verbs such as "implement" |
| task.domain | Every row maps to exactly one valid domain | Fullstack/multi-domain row |
| task.deliverable | Every row lists exact output files/artifacts | Generic "implementation" deliverable |
| task.dependencies | Dependencies use task IDs or explicit `—` | Missing/ambiguous ordering |
| task.coverage | Every change unit appears in tasks exactly once per domain slice | Missing work or duplicate TODO/phase work |

For `shape.contract`, plans that touch only migration files under `migrations/` or `alembic/`
are exempt from declaring a runtime ORM. They still must define migration and rollback behavior.

### 5. Delegation Integrity (4)

| ID | PASS evidence | FAIL signal |
|----|---------------|-------------|
| agent.assigned | Every task has one appropriate `@agent` | Missing or multiple owners |
| agent.valid | Every `@agent` exists under `.claude/agents/omb/` | Invented/stale agent |
| skill.valid | Every `Skill()` exists and matches the task domain | Missing/invented/wrong orchestration skill |
| agent.separation | Cross-domain work is split across domain owners | One agent owns unrelated domain edits |

### 6. TDD and Verification (6)

| ID | PASS evidence | FAIL signal |
|----|---------------|-------------|
| test.files | Exact test files are named for every behavior change | Generic "add tests" |
| test.cases | Named cases specify inputs/conditions and observable outputs | Scenario list has no assertions |
| test.red | Bug/behavior changes state the current RED failure/gap | No proof test would catch old behavior |
| test.commands | Repository-valid targeted TDD commands are listed; full suites appear only for CI, release, or an explicit user request | Generic commands or unapproved repository/domain-wide development suites |
| test.gates | Each phase has an observable pass condition | Completion defined by file creation alone |
| test.boundary | Live/manual matrix exists only when unit/integration tests cannot prove runtime boundary behavior | Required cross-boundary proof missing or gratuitous manual QA |

### 7. Sequencing and Release (4)

| ID | PASS evidence | FAIL signal |
|----|---------------|-------------|
| phase.order | Producers/contracts precede dependent consumers and verification | Impossible/circular order |
| phase.parallel | Independent work is grouped; dependent work is separated | Needless serialization or unsafe parallelism |
| phase.critical | Critical path is marked when multiple phases exist | Key dependency chain is hidden |
| release.safety | Migration/protocol/production work includes rollout/rollback or explicit N/A rationale | Irreversible release step is unplanned |

### 8. Documentation and Risk (3)

| ID | PASS evidence | FAIL signal |
|----|---------------|-------------|
| docs.sot | Exact stale `docs/`/`openwiki/` paths and actions are named, or concise N/A reason | Generic "update docs" or silent stale SoT |
| risk.concrete | Risks are specific to proposed changes with actionable mitigations | Generic risk padding |
| risk.verify | High-impact unresolved assumptions are listed for user verification | Hidden blocker or excessive low-value questions |

### 9. Density and Completeness (3)

| ID | PASS evidence | FAIL signal |
|----|---------------|-------------|
| density.signal | Content changes an implementation/review decision | Request restatement, framework tutorial, generic stack inventory |
| density.unique | Tasks and decisions appear once; adaptive sections are used | Duplicate TODO/phase tables or repeated rationale |
| complete.ready | No unresolved high-impact placeholder; implementer can start without rediscovery | `{}`, `TBD`, `TODO`, `...`, or missing executable core |

## Evidence-Anchored Scoring

For each applicable item output: `Evidence: "..." -> PASS|FAIL (reason)`. Use `"not found"`
when absent. Verify at least one citation per change unit and every citation implicated in a P0/P1
decision. Score = PASS / applicable items; N/A is excluded. Overall score is the weighted sum of
dimension scores.

## N/A Rules

- Greenfield change: `evidence.current`, `evidence.excerpt`, and `evidence.tests` may be N/A only
  with exact new target paths and a stated greenfield reason.
- No changed external contract/data/release boundary: `shape.compatibility` and `release.safety` may be N/A.
- Single-phase work: `phase.parallel` and `phase.critical` may be N/A.
- Docs-only/config-only work: source-code TDD checks may be N/A, but exact validation commands and pass gates remain required.
- No stale SoT document: `docs.sot` PASSes with one concise N/A reason.
- Deletion not proposed: `shape.cleanup` is N/A.
- Do not mark density or executable-core checks N/A.

## Priority Mapping

| Priority | Criteria |
|----------|----------|
| P0 | Missing executable core or a defect likely to produce incorrect/unsafe implementation |
| P1 | Major location/change-shape/proof/ordering gap that forces rediscovery or divergent implementation |
| P2 | Local gap that is recoverable without redesign |
| P3 | Cosmetic or minor density issue |

Default mapping:

- **P0:** `intent.outcome`, `evidence.exists`, `shape.contract`, `shape.validation` (security boundary), `task.table`, `task.coverage`, `complete.ready`
- **P1:** `intent.trace`, `evidence.location`, `evidence.current`, `evidence.callers`, `shape.operations`, `shape.logic`, `shape.compatibility`, `task.concrete`, `task.domain`, `task.deliverable`, `task.dependencies`, `agent.assigned`, `agent.valid`, `skill.valid`, `test.files`, `test.cases`, `test.red`, `test.commands`, `test.gates`, `phase.order`, `release.safety`, `docs.sot`
- **P2:** all other functional checks
- **P3:** `density.signal` or `density.unique` when the excess does not obscure execution; promote to P1 when boilerplate hides or contradicts executable work

## Output Format

1. **Outcome Traceability Matrix**

```markdown
| Outcome / Change Unit | Current Evidence | Implementation Shape | Task(s) | Test / Pass Condition | Status |
|-----------------------|------------------|----------------------|---------|-----------------------|--------|
```

2. **Score Sheet** — 9 dimensions with Pass/Fail/N/A, score, weight, weighted score.
3. **Issue Tickets** — one `EP-P{0-3}-{NNN}` per FAIL using `.claude/rules/workflow/09-ticket-schema.md`.
4. **Summary** — overall score/grade, P0-P3 counts, and `PASS | CONDITIONAL PASS | FAIL`.

Grade thresholds: A >=90, B >=80, C >=65, D >=50, F <50. PASS requires score >=80 and
0 P0/P1; CONDITIONAL PASS requires score 65-79 and 0 P0/P1; otherwise FAIL.

## Output Contract

End with the standard review envelope from `.claude/rules/common/output-contract.md`:

<omb>DONE</omb>

```result
verdict: PASS | FAIL
summary: {evidence-anchored evaluation summary}
score: {overall percentage}
grade: {A/B/C/D/F}
p0_count: {number}
p1_count: {number}
p2_count: {number}
p3_count: {number}
artifacts:
  - evaluation report (inline)
changed_files: []
concerns:
  - {borderline evidence decisions or empty list}
blockers: []
retryable: false
next_step_hint: if FAIL, pass tickets to plan-improver; otherwise deliver the plan
```
