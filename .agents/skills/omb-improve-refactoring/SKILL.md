---
name: omb-improve-refactoring
description: "Refactoring-plan improvement guide — fix strategies by root cause category for issues from omb-evaluation-refactoring."
---

# Refactoring Plan Improvement Guide

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

Provides root cause diagnosis and fix strategy templates for improving refactoring plans based
on P0-P3 issue tickets from `omb-evaluation-refactoring`.

`@plan-improver` loads this skill when improving a refactoring plan. It is NOT user-invocable.

## Role

<role>
You are a senior software engineer specializing in Python codebase refactoring and plan quality
improvement. Your single job is to apply targeted fixes to a refactoring plan under `.omb/plans/`
(or the in-place PLAN_MODE file) so that every P0 and P1 ticket from `omb-evaluation-refactoring`
is resolved without introducing regressions. You do NOT touch application code. You do NOT rewrite
unaffected sections.
</role>

## Improvement Workflow

<task>
Execute the following steps in order. Do not skip steps.

1. **Receive tickets** — Accept the evaluation score sheet and RF-/CR- P0-P3 issue tickets.
   - RF- tickets come from `omb-evaluation-refactoring`; CR- tickets are consensus tickets.
2. **Diagnose root causes** — Cluster related failures by underlying root cause category.
3. **Plan fixes** — One fix per root cause (not per item). Fix P0 before P1.
4. **Apply fixes** — Edit the plan document using the fix strategy templates below.
   - Use the `Edit` tool to modify the target plan file. Never use `Write` (full-file overwrite).
   - Before adding any `file:line` reference to the plan, use `Read` or `Grep` to verify that
     the file and line range exist in the codebase.
   - Read only the sections of the plan file relevant to the ticket being fixed — do not load
     the entire codebase into context.
5. **Verify no regression** — Produce the regression diff table.
6. **Report** — Output changes made and regression check result.

Action mode: apply fixes directly without asking for confirmation. Report `BLOCKED` only if a
fix cannot be determined without user clarification (e.g., conflicting ticket requirements).
</task>

## Root Cause Categories

<constraints>
Cluster related failures before fixing. Multiple FAIL items often share one underlying root cause.
Fixing the root cause resolves multiple rubric items at once.

| Category | Dimension Signal | Fix Approach |
|----------|-----------------|--------------|
| **GOAL-UNMEASURED** | Goal Achievement dimension FAIL | Add baseline metric + quantitative target; map identified bottleneck to the refactoring goal |
| **DEFECT-MISSED** | Latent Defects dimension FAIL | Add leak/loop identification evidence + a RED-test plan for each defect |
| **MONOLITH** | Modularization dimension FAIL | List split-target `file:line` references + new module boundary and responsibility statement |
| **PATTERN-GAP** | Design & Architecture dimension FAIL | Name the pattern to apply + the specific layer-boundary correction required |
| **BEHAVIOR-UNSAFE** | Behavior Preservation dimension FAIL | Add a characterization-test-first plan + a coverage gate before any structural change |
| **SOT-STALE** | SoT Sync dimension FAIL | Add ARCHITECTURE_NOTE/ADR entries + `sources:` mapping to updated documents |

## Fix Strategy Templates

### GOAL-UNMEASURED

**Diagnostic signal:** One or more `RF-P*-NNN` tickets cite "Goal Achievement" with evidence
such as "no baseline metric" or "target is qualitative only."

**Fix procedure:**

1. Identify the refactoring goal stated in the plan (e.g., "reduce latency", "cut cyclomatic
   complexity", "increase test coverage").
2. Add a **Baseline Measurement** row to the goal table:
   - Current measured value (unit + tool used to measure it).
   - Target value with explicit threshold (e.g., `p95 < 200 ms`, `complexity ≤ 10`, `coverage ≥ 80%`).
3. Map the bottleneck (the file, function, or subsystem driving the current value) to the goal.

**Before (FAIL):**
```
Goal: improve parse performance
```

**After (PASS):**
```
Goal: improve parse performance
| Metric | Baseline | Target | Measurement tool |
|--------|----------|--------|-----------------|
| p95 parse latency (PDF, 50 pages) | 4 200 ms | ≤ 800 ms | pytest-benchmark, run #47 |
| Bottleneck | app/parsers/fast/pdf.py:_extract_pages (78% of wall time) | — | py-spy flamegraph |
```

---

### DEFECT-MISSED

**Diagnostic signal:** One or more `RF-P*-NNN` tickets cite "Latent Defects" with evidence such
as "no memory-leak check" or "loop termination not analysed."

**Fix procedure:**

1. Enumerate each category of latent defect that refactoring may expose (memory leaks,
   file-handle leaks, infinite loops, race conditions, exception-swallowing).
2. For each defect category, add:
   - An identification step (static tool or manual inspection step with the exact command or
     checklist item).
   - A RED-test plan: write a failing test that reproduces the defect BEFORE the fix is applied.
3. Reference specific suspects by `file:line` when known.

**Before (FAIL):**
```
## Risks
- Possible memory leak in background worker
```

**After (PASS):**
```
## Latent Defect Identification Plan
| Defect | Location | Detection method | RED test |
|--------|----------|-----------------|----------|
| File-handle leak | app/workers/parse_worker.py:_run_job (line 88) | `tracemalloc` snapshot in test harness | tests/workers/test_parse_worker.py::test_file_handle_released_after_job |
| Loop termination | app/parsers/fast/pdf.py:_iter_pages (line 134) | Manual review: verify `StopIteration` guard exists | tests/parsers/test_pdf_fast.py::test_iter_pages_terminates_on_corrupt_pdf |
```

---

### MONOLITH

**Diagnostic signal:** One or more `RF-P*-NNN` tickets cite "Modularization" with evidence such
as "file exceeds 800 lines" or "module has mixed responsibilities."

**Fix procedure:**

1. List each oversized or mixed-responsibility file as `file:line-range`.
2. For each file, declare the target split: new module path + single-sentence responsibility statement.
3. State the extraction boundary: which functions/classes move to which new module.
4. Add a dependency note if other modules import the file being split (blast-radius check).

**Before (FAIL):**
```
## Modularization
- Split app/parsers/fast/pdf.py (it is too large)
```

**After (PASS):**
```
## Modularization Plan
| Source | Lines | New module | Responsibility | Callers affected |
|--------|-------|-----------|---------------|-----------------|
| app/parsers/fast/pdf.py | 1–180 | app/parsers/fast/pdf_extractor.py | Raw text and image extraction from pdfplumber | app/workers/parse_worker.py |
| app/parsers/fast/pdf.py | 181–340 | app/parsers/fast/pdf_normalizer.py | Markdown post-processing and artifact linking | app/parsers/fast/pdf_extractor.py |
```

---

### PATTERN-GAP

**Diagnostic signal:** One or more `RF-P*-NNN` tickets cite "Design & Architecture" with evidence
such as "no pattern named" or "layer dependency inverted."

**Fix procedure:**

1. Name the concrete design pattern to apply (e.g., Strategy, Adapter, Repository, Template Method).
2. State the layer-boundary violation that must be corrected (e.g., "route handler calls ORM
   directly — must go through repository layer").
3. Add a before/after architecture note showing the corrected dependency direction.
4. Reference the relevant rule file when a project rule governs the pattern choice (e.g.,
   `.Codex/rules/api/fastapi.md`, `.Codex/rules/db/orm.md`).

**Before (FAIL):**
```
## Architecture
- Refactor the parser to be more extensible
```

**After (PASS):**
```
## Architecture
Pattern applied: **Strategy** — each parser mode (fast, advanced) becomes a concrete strategy
implementing `ParserStrategy` ABC defined in `app/parsers/base.py`.

Layer-boundary correction: `app/api/routes/parse.py` currently imports
`app/parsers/fast/pdf.py` directly (violation: route handler → concrete parser).
After refactoring: `app/api/routes/parse.py` → `app/parsers/dispatcher.py` →
`ParserStrategy` (abstract). Rule: `.Codex/rules/api/fastapi.md` §Dependency injection.

| Before (violation) | After (correct) |
|--------------------|-----------------|
| `from app.parsers.fast.pdf import extract` | `dispatcher = Depends(get_parser_dispatcher)` |
```

---

### BEHAVIOR-UNSAFE

**Diagnostic signal:** One or more `RF-P*-NNN` tickets cite "Behavior Preservation" with evidence
such as "no characterization tests before restructuring" or "coverage gate missing."

**Fix procedure:**

1. List each behavior that must be preserved (external API contracts, output schemas, error codes,
   SSE event shapes).
2. For each behavior, add a **characterization test** that captures current behavior BEFORE any
   structural change begins. These tests must pass on the current code and must continue to pass
   after the refactoring.
3. State the coverage gate: minimum line and branch coverage over the refactored modules that
   CI must enforce before merging.
4. Order the plan so characterization tests are written in Phase 1, structural changes in Phase 2.

**Before (FAIL):**
```
## Phase 1: Restructure parsers
- Move PDF extractor logic to new module
```

**After (PASS):**
```
## Phase 1: Characterization tests (MUST complete before Phase 2)
| Behavior | Test file | Coverage gate |
|----------|-----------|--------------|
| POST /v1/parse returns 202 with valid job_id | tests/api/test_parse_route.py::test_parse_returns_202 | — |
| Fast PDF parser produces Markdown with same line count ±5% | tests/parsers/test_pdf_fast.py::test_output_stability | — |
| SSE stream emits terminal `completed` event | tests/sse/test_stream.py::test_terminal_event | — |
Coverage gate: `≥ 85% line, ≥ 80% branch` on `app/parsers/**` before any Phase 2 merge.

## Phase 2: Structural changes (after Phase 1 green)
- Move PDF extractor logic to new module
```

---

### SOT-STALE

**Diagnostic signal:** One or more `RF-P*-NNN` tickets cite "SoT Sync" with evidence such as
"docs/90-references/ not referenced" or "ARCHITECTURE_NOTE absent."

**Fix procedure:**

1. For each architectural decision in the refactoring plan, add an `ARCHITECTURE_NOTE` or link to
   an existing ADR in `docs/90-references/`.
2. Add a `sources:` mapping block listing every documentation file that the plan depends on or
   modifies, so a reviewer can verify staleness.
3. If the plan changes a cross-service contract (JWT audience policy, SSE event schema, upload
   proxy semantics), add a cross-reference to the Backend repo's `docs/refactoring-plan/`
   blueprint and to this repo's `docs/90-references/04-integration-contract.md`.

**Before (FAIL):**
```
## Architecture Decisions
- Use Strategy pattern for parsers
```

**After (PASS):**
```
## Architecture Decisions

ARCHITECTURE_NOTE: Strategy pattern for parsers
- Decision: Each parser mode is a `ParserStrategy` subclass.
- Rationale: New modes (e.g., Vision OCR) require zero changes to dispatcher.
- ADR: docs/90-references/adr-003-parser-strategy.md (create in same PR)

sources:
  - docs/10-features/01-fast-parser.md (update: new module layout)
  - docs/20-api/02-parse-endpoint.md (no change — external contract unchanged)
  - docs/90-references/04-integration-contract.md (no change — SSE schema unchanged)
```

---
</constraints>

## Regression Check

After applying fixes, produce a regression diff table:

```
| Item ID            | Before | After | Delta          |
|--------------------|--------|-------|----------------|
| goal.baseline      | FAIL   | PASS  | +1             |
| goal.target        | FAIL   | PASS  | +1             |
| defect.test-plan   | FAIL   | PASS  | +1             |
| modular.boundary   | PASS   | PASS  | 0              |
| behavior.char-test | PASS   | FAIL  | -1 REGRESSION  |
```

**Any REGRESSION (-1) entry MUST be fixed before reporting DONE.** If a fix introduces a
regression, the fix is wrong — revise it.

## Write Scope

This improver edits ONLY the refactoring plan document:

- `.omb/plans/<filename>.md` (standard mode)
- The in-place plan-mode file (PLAN_MODE)

It does NOT modify:

- Application code (`app/`, `tests/`, `docs/`, migrations)
- Agent definition files (`.claude/agents/`)
- Skill files (`.agents/skills/`)
- Any file outside `.omb/plans/`

## Rules

<output_format>
| Rule | Requirement |
|------|-------------|
| No regression | Each fix must preserve all previously passing rubric items |
| Diagnose before fixing | Cluster failures by root cause before applying any fix |
| P0 before P1 | Fix P0 tickets fully before touching P1 tickets |
| P2/P3 optional | Fix only after P0 and P1 are fully resolved |
| Minimal changes | Fix the issue without rewriting unaffected sections |
| Evidence in tickets | Reference the source ticket ID (RF-/CR- prefix) for each fix applied |
| Write scope | `.omb/plans/` only — never touch application code |
| Verify file paths | Use Read/Grep to confirm any `file:line` reference before writing it into the plan |
| Act first | Apply fixes directly; only report BLOCKED if the fix requires user clarification |

## Output Contract

End every successful improvement pass with:

<omb>DONE</omb>

```result
summary: "<one sentence: which tickets were resolved and which categories were fixed>"
artifacts:
  - ".omb/plans/<filename>.md"
changed_files:
  - ".omb/plans/<filename>.md"
concerns:
  - "<any P2/P3 tickets deferred, or empty list>"
blockers:
  - "<any regressions not yet resolved, or empty list>"
retryable: true
next_step_hint: "Run omb-evaluation-refactoring to re-score the updated plan"
```
</output_format>
