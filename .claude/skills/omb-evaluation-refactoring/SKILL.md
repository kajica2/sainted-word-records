---
name: omb-evaluation-refactoring
description: "Refactoring quality rubric — binary scoring across 6 dimensions (~32 items). Used for goal refinement and parallel analysis scoring in refactoring workflows."
---

# Refactoring Evaluation (Quantitative)

## Usage Contract

**Task type:** Apply the domain guidance below to the caller's active task; this skill is a reference, not an independent workflow.

**Required input:** A concrete question, design, file, diff, or implementation decision within this skill's domain.

**Do:**
- Select only the relevant rules, reconcile them with repository-specific instructions, and cite concrete evidence when evaluating existing work.
- State assumptions and applicability limits when the available context is incomplete.

**Don't:**
- Do not invent repository facts, tool results, versions, or requirements.
- Do not apply examples mechanically when the project's source of truth conflicts with them.

**Completion:** Return actionable guidance or a checked result in the caller's requested format; identify any unresolved evidence gap explicitly.

<role>
You are a refactoring quality evaluator. Your job is to score a refactoring proposal or completed refactoring against a 32-item evidence-anchored rubric across 6 dimensions. You cite `file:line` references before every code verdict, quote plan text before every proposal verdict, and generate RF-P0 through RF-P3 tickets for every FAIL. You never render a verdict without concrete evidence. You apply this rubric both as a goal-refinement checklist (before implementation begins) and as a scoring instrument (after implementation completes).
</role>

Evaluate a refactoring proposal or implementation using an evidence-anchored binary (PASS/FAIL) rubric across ~32 checklist items in 6 dimensions. Each verdict requires quoted evidence from the plan document or cited `file:line` references in the codebase. Produces a quantitative score sheet and prioritized RF-P0 through RF-P3 issue tickets.

This skill is loaded by `@plan-evaluator` in `mode: post-implementation` as the omb-refactoring
VERIFY rubric gate, and by `omb-architect` as a self-check loader for the goal-refinement gate.
It is NOT user-invocable.

> **Effort level: high.** Evaluate exhaustively — search all observable markers before scoring each item. Do not accept absence of evidence after a surface scan; re-read the relevant sections before marking FAIL.

## Dual Use

This rubric serves two roles in the refactoring pipeline:

1. **Goal-refinement gate** — Run before implementation. Score the refactoring goal proposal against Dimensions 1–3 and 5–6. A score below 65% in any of these dimensions blocks implementation and requires goal revision.
2. **Post-implementation scoring** — Run after implementation completes. Score all 6 dimensions against the actual codebase changes.

## Evaluation Workflow

<execution_order>
1. **Determine mode** — Identify whether this is a goal-refinement run (proposal only) or post-implementation run (code + plan)
2. **Ingest** — Read the refactoring proposal or plan document from the provided file path; collect changed files via `git diff --name-only` if post-implementation. If `git diff` is unavailable or returns an error, report `"git diff unavailable — all post-implementation items requiring file:line evidence are scored N/A for this run"` and treat those items as N/A. When collecting file evidence for multiple checklist items that reference different files, read those files in parallel. Read only the changed files listed by `git diff --name-only`; do not load entire unchanged files — use targeted reads around observable markers. When the caller supplies a diff file path, read that file instead of running git diff --name-only.
3. **Classify scope** — Apply the N/A Decision Tree to mark non-applicable items
4. **Score** — For each applicable item: locate observable markers → quote evidence (plan text) or cite `file:line` → render PASS/FAIL. Maintain a running score tally in the score sheet format, updating pass/fail counts per dimension as you score each item.
5. **Aggregate** — Compute dimension scores and overall score as pass-rate percentages
6. **Classify** — Map FAIL items to RF-P0 through RF-P3 priority levels
7. **Report** — Output the score sheet + issue tickets with quoted evidence
</execution_order>

## Scoring Dimensions

| # | Dimension | Items | Weight | Focus |
|---|-----------|-------|--------|-------|
| 1 | Goal Achievement | 5 | 20% | Measurable goal, baseline metric, bottleneck evidence, success criterion |
| 2 | Latent Defects | 6 | 20% | Infinite loops, memory leaks, connection leaks, race conditions, error-swallowing |
| 3 | Modularization | 5 | 18% | God-file/function identification, split boundaries, single-responsibility enforcement |
| 4 | Design & Architecture | 5 | 17% | Pattern soundness, layer-boundary adherence, dependency direction |
| 5 | Behavior Preservation | 6 | 15% | Characterization tests, coverage maintained, regression prevention, rollback plan |
| 6 | SoT Sync | 5 | 10% | Docs/wiki drift addressed, ADR present when required, architecture notes updated |

## Checklist Items

### 1. Goal Achievement (5 items, 20%)

Evidence requirement: quote the goal statement or performance metric from the proposal. For post-implementation, cite `file:line` where metric is measured or enforced.

| ID | Item | Observable Markers | Priority if FAIL |
|----|------|--------------------|-----------------|
| `goal.measurable` | The refactoring goal is expressed as a measurable outcome | Proposal contains a concrete metric (e.g., latency p95, lines-of-code count, cyclomatic complexity target, test coverage delta) — NOT a vague phrase like "improve readability" | **P0** |
| `goal.baseline` | A baseline measurement is recorded before the refactoring | Proposal cites a concrete before-state value (profiling data, static-analysis count, coverage %) | P1 |
| `goal.bottleneck` | The identified bottleneck is directly tied to the stated goal | Proposal maps each bottleneck to the goal metric — no bottleneck is listed without explaining how fixing it moves the goal metric | P1 |
| `goal.success-criterion` | A binary success criterion is defined | Proposal contains a testable pass/fail gate for the goal (e.g., "p95 < 200 ms", "no file > 300 lines", "coverage ≥ 85%") | P1 |
| `goal.scope-bounded` | The refactoring scope is bounded — affected modules or files are listed | Proposal enumerates the target files, modules, or layers; does not say "entire codebase" without listing what that means | P2 |

### 2. Latent Defects (6 items, 20%)

Evidence requirement: cite `file:line` where the defect is present (post-implementation) or where the proposal identifies and addresses the defect (goal-refinement). If a defect category is not applicable to the target codebase, mark N/A with justification.

| ID | Item | Observable Markers | Priority if FAIL |
|----|------|--------------------|-----------------|
| `defect.infinite-loop` | All loops and recursive calls have explicit bounded exit conditions | Every `while True` / `loop forever` pattern has a break condition; recursive calls have a depth guard or a finite-domain termination proof cited in comments or tests | **P0** — if an identified P0 loop defect is left unaddressed after the refactoring |
| `defect.memory-leak` | Objects, buffers, and large data structures are explicitly released or bounded | No unbounded accumulation in module-level lists/dicts; generators used instead of full list materialization where appropriate; large objects explicitly `del`-ed or scoped | P1 |
| `defect.connection-leak` | All resource handles (DB connections, file handles, HTTP sessions) use context managers or explicit `close()` | No bare `open()`, `connect()`, or client construction outside a `with` block or explicit try/finally; connection pools have size limits | **P0** — if an identified P0 connection-leak is left unaddressed |
| `defect.race-condition` | Shared mutable state accessed from concurrent code is protected | Async tasks that share state use locks, queues, or immutable data; no bare global variable mutation from two coroutines without coordination | P1 |
| `defect.error-swallowing` | Bare `except:` or `except Exception: pass` blocks are eliminated | No `except` block that silently discards the exception; every catch either re-raises, logs with context, or converts to a structured error result | P1 |
| `defect.identification-evidence` | The proposal explicitly identifies latent defects found during analysis | Proposal contains a table or list of discovered defects with `file:line` references; absence of defects is stated explicitly as "no defects found" with tool evidence | P1 |

### 3. Modularization (5 items, 18%)

Evidence requirement: cite `file:line` for god-file/function violations; quote the proposed split boundaries from the plan.

| ID | Item | Observable Markers | Priority if FAIL |
|----|------|--------------------|-----------------|
| `mod.god-file` | No file exceeds 500 lines after the refactoring | `wc -l` or static-analysis output shows all target files ≤ 500 lines; files above 500 lines are explicitly exempted with justification | P1 |
| `mod.god-function` | No function exceeds 50 lines after the refactoring | Static analysis (e.g., `ruff`, `pylint`) reports no function above 50 lines in changed files; exceptions documented | P1 |
| `mod.split-boundaries` | Split boundaries are defined at cohesion seams, not arbitrary line counts | Proposal identifies the domain/responsibility at each split boundary; split is not purely "every 200 lines" without rationale | P1 |
| `mod.single-responsibility` | Each new module has a single stated responsibility | Each resulting file/module has a one-sentence docstring or comment stating its responsibility; the responsibility does not span multiple unrelated concerns | P2 |
| `mod.util-ban` | No new god-files named `utils`, `helpers`, or `common` are introduced | No new file with name matching `utils.py`, `helpers.py`, `helpers.ts`, `common.ts`, `misc.py` (or similar) is created; shared utilities are placed in purpose-named modules | P2 |

### 4. Design & Architecture (5 items, 17%)

Evidence requirement: cite `file:line` for pattern violations; quote the design rationale from the proposal.

| ID | Item | Observable Markers | Priority if FAIL |
|----|------|--------------------|-----------------|
| `design.pattern-sound` | Applied design patterns are appropriate to the problem and correctly implemented | Proposal names the pattern(s) used and explains why each fits; post-implementation code matches the canonical structure of the named pattern | P1 |
| `design.layer-boundary` | Layer boundaries are not crossed (e.g., route handlers do not contain business logic; models do not import from route modules) | No import from a higher layer into a lower layer; route handlers delegate to service/use-case functions rather than embedding SQL or domain logic inline | P1 |
| `design.dependency-direction` | Dependencies flow in one direction — from outer layers toward inner layers | No circular imports; no domain/service module importing from api/transport modules | P1 |
| `design.abstraction-level` | Abstractions are introduced only where there is more than one caller or a concrete future use | No single-caller ABC or Protocol introduced speculatively; no premature interface extraction | P2 |
| `design.pattern-rationale` | A rationale is given for each introduced abstraction or pattern | Proposal or code comments explain why the pattern was chosen over a simpler alternative; "it seemed cleaner" is not acceptable rationale | P2 |

### 5. Behavior Preservation (6 items, 15%)

Evidence requirement: cite test file paths and coverage numbers; quote the characterization test plan from the proposal.

| ID | Item | Observable Markers | Priority if FAIL |
|----|------|--------------------|-----------------|
| `behavior.char-tests` | A characterization test plan is present before implementation begins | Proposal includes a section listing which existing behaviors will be captured as golden-output or snapshot tests before any code is changed | **P0** |
| `behavior.coverage-maintained` | Test coverage on the refactored modules does not decrease | Coverage report before vs. after shows no regression in line or branch coverage for changed files; target is coverage ≥ pre-refactoring baseline | P1 |
| `behavior.regression-suite` | A regression test command is documented and passes | Proposal or implementation notes include a concrete `pytest`/`vitest` command that exercises the refactored code; the command passes in CI | P1 |
| `behavior.no-silent-behavior-change` | Public API signatures, return types, and error codes are unchanged | `git diff` on public interface files shows no removed parameters, no changed return types, no changed exception types; or all changes are explicitly listed as intentional in the proposal | P1 |
| `behavior.rollback-plan` | A rollback strategy is defined | Proposal identifies the last known-good git ref and the steps to revert; for DB-touching refactors, a migration rollback step is included | P2 |
| `behavior.integration-test` | At least one integration or end-to-end test exercises the refactored code path | A test that crosses at least two layers (e.g., API → service → DB) is present and passes | P2 |

### 6. SoT Sync (5 items, 10%)

Evidence requirement: cite doc file paths and specific stale sections; quote the ADR plan from the proposal.

| ID | Item | Observable Markers | Priority if FAIL |
|----|------|--------------------|-----------------|
| `sot.docs-drift` | Documentation drift caused by the refactoring is identified and addressed | Proposal lists which `docs/` files reference the refactored modules and marks each as "no change needed" or "update required"; post-implementation, updated files are present in the diff | P1 |
| `sot.wiki-drift` | Wiki notes referencing refactored code are identified and updated | Proposal lists any `openwiki/**` pages whose Claims cite changed source files; those notes are updated or marked for update | P2 |
| `sot.adr-present` | An Architecture Decision Record is present when the refactoring introduces a new pattern, changes a layer boundary, or changes a module's public API | An ADR file exists in `docs/90-references/` (or equivalent) documenting the decision, context, and rationale; its absence is acceptable only if no pattern, boundary, or API change occurred | P1 |
| `sot.arch-note` | Architecture notes or diagrams referencing the changed modules are updated | Any Mermaid diagram, architecture note, or integration contract document that depicts the changed modules reflects the post-refactoring structure | P2 |
| `sot.cross-service` | Cross-service contracts are unaffected or explicitly renegotiated | If the refactoring touches a module that is part of a cross-service contract (JWT auth, SSE schema, upload proxy), the relevant blueprint document in `docs/90-references/` is updated or explicitly noted as unaffected | P1 |

## Evidence-Anchored Scoring Method

Apply this method to every checklist item:

1. **Search** — Locate the observable markers listed in the item row
2. **Quote** — Quote the specific plan text (goal-refinement mode) or cite `file:line` with description (post-implementation mode). If absent, write `"not found"`
3. **Verdict** — Render PASS or FAIL based solely on the evidence, not impression

```
PASS (1)  — Evidence found that satisfies the criterion
FAIL (0)  — Evidence absent or contradicts the criterion
N/A       — Not applicable per the N/A Decision Tree (excluded from denominator)
```

```
dimension_score = (pass_count / applicable_count) * 100%
overall_score   = weighted_average(dimension_scores, weights)
```

### Scoring Consistency Protocol

- **Quote before verdict.** Never render PASS/FAIL without first quoting or citing evidence.
- **Atomic evaluation.** Evaluate each criterion independently — one item's result must not influence another.
- **Evidence in tickets.** Every issue ticket must include the evidence (quoted text or `file:line`) that triggered the FAIL.
- **No impression-based verdicts.** If evidence is ambiguous, write what was found and explain why it fails the criterion rather than defaulting to PASS.

<na_decision_tree>

## N/A Decision Tree

```
1. Is the refactoring purely cosmetic (rename, reformat, no structural change)?
   Yes → N/A for mod.god-file, mod.god-function, design.layer-boundary,
              behavior.char-tests, sot.adr-present

2. Does the refactoring touch no concurrent code?
   Yes → N/A defect.race-condition

3. Does the refactoring touch no resource handles (files, DB connections, HTTP clients)?
   Yes → N/A defect.connection-leak

4. Does the refactoring touch no cross-service contracts?
   Yes → N/A sot.cross-service

5. Is this a goal-refinement run (no code written yet)?
   Yes → Skip all post-implementation items that require file:line evidence;
         score only items where plan-text evidence is sufficient.
         Items that require post-implementation code evidence are marked N/A.

6. Was git diff unavailable (reported in step 2)?
   Yes → N/A all post-implementation items requiring file:line evidence.
```

</na_decision_tree>

## Priority Classification

| Priority | Severity | Criteria |
|----------|----------|----------|
| **P0** | Critical | Refactoring is unsafe or produces incorrect behavior; must fix before proceeding |
| **P1** | High | Significant quality gap or missing safety net; should fix before delivery |
| **P2** | Medium | Noticeable gap but refactoring is still deliverable with a documented caveat |
| **P3** | Low | Minor polish; no functional or safety impact |

### Mandatory P0 Conditions

These items MUST be classified P0 when they FAIL — do not downgrade them:

- `goal.measurable` — Without a measurable goal, correctness of the refactoring cannot be verified.
- `behavior.char-tests` — Without a characterization test plan, behavior regressions cannot be detected.
- `defect.infinite-loop` — When an infinite-loop defect is identified AND left unaddressed after the refactoring.
- `defect.connection-leak` — When a connection-leak defect is identified AND left unaddressed after the refactoring.

### Priority Mapping

- **P0**: `goal.measurable`, `behavior.char-tests`, plus any identified-but-unaddressed P0 latent defect (`defect.infinite-loop`, `defect.connection-leak`)
- **P1**: `goal.baseline`, `goal.bottleneck`, `goal.success-criterion`, `mod.god-file`, `mod.god-function`, `mod.split-boundaries`, `design.pattern-sound`, `design.layer-boundary`, `design.dependency-direction`, `behavior.coverage-maintained`, `behavior.regression-suite`, `behavior.no-silent-behavior-change`, `defect.memory-leak`, `defect.race-condition`, `defect.error-swallowing`, `defect.identification-evidence`, `sot.docs-drift`, `sot.adr-present`, `sot.cross-service`
- **P2**: `goal.scope-bounded`, `mod.single-responsibility`, `mod.util-ban`, `design.abstraction-level`, `design.pattern-rationale`, `behavior.rollback-plan`, `behavior.integration-test`, `sot.wiki-drift`, `sot.arch-note`
- **P3**: Cosmetic or stylistic issues not represented in the rubric above

## Ticket Format

Each FAIL item produces one ticket. Use the canonical format from `.claude/rules/workflow/09-ticket-schema.md` with prefix `RF`.

```markdown
### RF-P{0-3}-{NNN}: {Title}

| Field | Value |
|-------|-------|
| **Dimension** | {dimension name} |
| **Item** | `{checklist_id}` — {human-readable name} |
| **Evidence** | {quoted plan text or `file:line` — "description"} |
| **Impact** | {what goes wrong if unfixed — one sentence} |
| **Remediation** | {specific fix with concrete example} |
| **Status** | OPEN |
```

Root Cause is optional for RF tickets. Include it only when the root cause is non-obvious and helps the implementer fix the issue.

## Output Format

### Section 1: Score Sheet

```
## Refactoring Evaluation Score Sheet

**Mode:** Goal-Refinement | Post-Implementation
**Overall Score: XX% (Grade: X)**
**Pass: XX / XX items | Fail: XX | N/A: XX**

| # | Dimension | Pass | Fail | N/A | Score | Weight | Weighted |
|---|-----------|------|------|-----|-------|--------|----------|
| 1 | Goal Achievement | X | X | X | XX% | 20% | XX% |
| 2 | Latent Defects | X | X | X | XX% | 20% | XX% |
| 3 | Modularization | X | X | X | XX% | 18% | XX% |
| 4 | Design & Architecture | X | X | X | XX% | 17% | XX% |
| 5 | Behavior Preservation | X | X | X | XX% | 15% | XX% |
| 6 | SoT Sync | X | X | X | XX% | 10% | XX% |
|   | **Total** | | | | | | **XX%** |
```

### Section 2: Issue Tickets (RF-P0 through RF-P3)

Emit one ticket per FAIL item. Order tickets P0 first, then P1, P2, P3. Within each priority, use sequential NNN numbering starting at 001.

### Section 3: Summary

```
## Issue Summary

| Priority | Count | Status |
|----------|-------|--------|
| P0 | X | Must fix |
| P1 | X | Should fix |
| P2 | X | Can fix |
| P3 | X | Nice to have |

**Verdict:** PASS | CONDITIONAL PASS | FAIL
```

## Grade Thresholds

| Grade | Score | Additional Condition |
|-------|-------|---------------------|
| A | ≥ 90% | 0 P0, 0 P1 |
| B | ≥ 80% | 0 P0 |
| C | ≥ 65% | 0 P0 |
| D | ≥ 50% | — |
| F | < 50% | — |

<output_contract>

## Output Contract

This skill is an evaluation skill. The `verdict:` field in the result envelope uses the values `PASS` or `FAIL` (per the agent-type table in `.claude/rules/common/output-contract.md` — evaluation skills use `PASS | FAIL`). Use the exact markdown table formats shown in each section template above.

On PASS (score ≥ 80%, 0 P0, 0 P1):

<omb>DONE</omb>

```result
verdict: PASS
summary: <1-3 sentences: overall score, grade, and key passing dimensions>
artifacts:
  - <refactoring proposal or plan file path evaluated>
changed_files: []
overall_score: <e.g. "84% (Grade B)">
ticket_summary: "P0: 0 | P1: 0 | P2: N | P3: N"
concerns:
  - <any P2/P3 issues worth noting, or empty list>
blockers: []
retryable: false
next_step_hint: Refactoring passes quality gate — proceed to implementation or PR.
```

On FAIL (any P0 or P1 present, or score < 65%):

<omb>RETRY</omb>

```result
verdict: FAIL
summary: <1-3 sentences: score, grade, and which dimensions failed most>
artifacts:
  - <refactoring proposal or plan file path evaluated>
changed_files: []
overall_score: <e.g. "54% (Grade D)">
ticket_summary: "P0: N | P1: N | P2: N | P3: N"
concerns:
  - <highest-priority issues summarized>
blockers:
  - <P0 ticket IDs that must be fixed before proceeding>
retryable: true
next_step_hint: Fix P0/P1 issues and re-evaluate. P0 mandatory-fix conditions: goal.measurable and behavior.char-tests.
```

On CONDITIONAL PASS (0 P0, 0 P1, score 65–79%):

<omb>DONE</omb>

```result
verdict: PASS
summary: <1-3 sentences noting conditional pass status and P2/P3 gaps>
artifacts:
  - <refactoring proposal or plan file path evaluated>
changed_files: []
overall_score: <e.g. "71% (Grade C)">
ticket_summary: "P0: 0 | P1: 0 | P2: N | P3: N"
concerns:
  - <P2/P3 issues that should be addressed>
blockers: []
retryable: false
next_step_hint: Proceed with awareness of P2/P3 gaps noted in concerns.
```

</output_contract>
