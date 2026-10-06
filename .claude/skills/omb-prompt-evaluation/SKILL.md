---
name: omb-prompt-evaluation
description: "Prompt evaluation — binary rubric across 57 items in 11 dimensions, P0-P3 issue tickets with root cause analysis."
user-invocable: true
argument-hint: "<prompt text or file path>"
---

# Prompt Evaluation (Quantitative)

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

Evaluate a prompt using an evidence-anchored binary (PASS/FAIL) rubric across 57 checklist items in 11 dimensions. Each verdict requires quoted evidence from the prompt. Produces a quantitative score sheet and prioritized P0-P3 issue tickets.

## Prerequisite

Load the `omb-prompt-guide` skill for reference guidelines before evaluating.

## Evaluation Workflow

1. **Ingest** — Read the prompt from argument text, file path, or ask the user
2. **Calibrate** — Review the 6 stratified calibration anchors in `rules/calibration-anchors.md` to set scoring baseline
3. **Classify prompt type** — Determine N/A items using the N/A Decision Tree (below)
4. **Score** — For each applicable item: search for observable markers → quote evidence → render PASS/FAIL
5. **Aggregate** — Compute dimension scores and overall score as pass-rate percentages
6. **Classify** — Map FAIL items to P0-P3 priority levels based on impact
7. **Report** — Output the score sheet + issue tickets with quoted evidence

## Scoring Dimensions

| # | Dimension | Items | Weight | Rule File |
|---|-----------|-------|--------|-----------|
| 1 | Clarity | 6 | 15% | `rules/eval-clarity.md` |
| 2 | Structure | 5 | 12% | `rules/eval-structure.md` |
| 3 | Role & Identity | 4 | 10% | `rules/eval-role.md` |
| 4 | Examples | 5 | 10% | `rules/eval-examples.md` |
| 5 | Reasoning | 5 | 10% | `rules/eval-reasoning.md` |
| 6 | Output Control | 6 | 12% | `rules/eval-output.md` |
| 7 | Tool & Agent | 6 | 10% | `rules/eval-tool.md` |
| 8 | Context Management | 4 | 8% | `rules/eval-context.md` |
| 9 | Safety & Guardrails | 7 | 13% | `rules/eval-safety.md` |
| 10 | Claude Code | 5 | 8% | `rules/eval-claude-code.md` |
| 11 | Context Engineering | 4 | 5% | `rules/eval-context-eng.md` |

## Evidence-Anchored Scoring Method

Each checklist item is evaluated with mandatory evidence:

1. **Search** — Scan the prompt for the observable markers listed in the checklist
2. **Quote** — Quote the specific text found (or state "not found")
3. **Verdict** — Render PASS/FAIL based on the evidence, not impression

- **PASS (1)** — Evidence found that satisfies the criterion
- **FAIL (0)** — No evidence found, or evidence contradicts the criterion
- **N/A** — Not applicable per the N/A Decision Tree (excluded from scoring)

```
dimension_score = (pass_count / applicable_count) * 100%
overall_score   = weighted_average(dimension_scores, weights)
```

### Scoring Consistency Protocol

- **Quote before verdict:** Never render PASS/FAIL without first quoting evidence
- **Atomic evaluation:** Evaluate each criterion independently — one item's result must not influence another
- **Calibration check:** For borderline cases, compare against the calibration anchors in `rules/calibration-anchors.md`
- **Evidence in tickets:** Every issue ticket must include the quoted evidence that triggered the FAIL

## N/A Decision Tree

Use this tree to determine which items to mark N/A before scoring:

```
1. Is the prompt for a tool-using or agent system?
   No → N/A all tool.* items

2. Is the prompt for Claude Code (CLAUDE.md, agent, skill)?
   No → N/A all claude-code.* items

3. Does the prompt span multiple context windows or sessions?
   No → N/A context-eng.* items, context.multi-window

4. Does the prompt involve large documents (20k+ tokens)?
   No → N/A context.placement, context.grounding

5. Does the prompt involve sensitive data (keys, PII, credentials)?
   No → N/A safety.data-handling

6. Is this a simple single-turn task?
   Yes → N/A safety.escalation, context.history

7. Capability-gated items (system-prompt-* rules):
   Does the runtime support system prompt injection?
   No → N/A all system-prompt-* items
   Note: system-prompt-* items are N/A when the deployment
   context does not expose a system prompt surface (e.g.,
   direct API usage without a system turn).
```

## Priority Classification (P0-P3)

Failed items are classified into priority tiers based on impact:

| Priority | Severity | Criteria | Action |
|----------|----------|----------|--------|
| **P0** | Critical | Prompt will produce incorrect, unsafe, or fundamentally broken output | Must fix before use |
| **P1** | High | Significant quality degradation or inconsistent behavior | Fix in current iteration |
| **P2** | Medium | Noticeable quality gap but prompt still functional | Fix when possible |
| **P3** | Low | Minor polish; prompt works but could be better | Nice to have |

### Priority Mapping Rules

- **P0**: FAIL in clarity.task-objective, clarity.no-conflicts, safety.boundaries, safety.hallucination-prevention, role.identity-defined, claude-code.verification (for agent prompts)
- **P1**: FAIL in clarity.specificity, clarity.unambiguous, structure.xml-tags, structure.separation, output.format-defined, reasoning.verification, tool.usage-conditions, tool.action-mode, safety.data-handling, safety.escalation, claude-code.claudemd-concise, claude-code.context-management, context-eng.multi-window
- **P2**: FAIL in examples.present, examples.good-bad, examples.format-demo, reasoning.thinking-guidance, reasoning.step-decomposition, reasoning.effort-level-specified, output.length-specified, output.schema-provided, output.no-prefill-dependency, context.placement, context.grounding, tool.parallel-calls, tool.error-behavior, tool.state-tracking, tool.subagent-guidance-explicit-for-4-7, claude-code.subagent-guidance, claude-code.autonomy-calibrated, context-eng.state-persistence, context-eng.token-budget, safety.calibrated, safety.no-aggressive-caps-stacking
- **P3**: FAIL in structure.hierarchy, structure.consistent-naming, role.behavioral-boundaries, examples.tagged, examples.edge-cases, output.markdown-controlled, output.verbosity-appropriate, reasoning.effort-matched, context.multi-window, context.history, context-eng.compaction-guidance, safety.no-instruction-repetition

## De-duplication Matrix

When the same underlying prompt defect is detected by multiple rubric items, apply this matrix to avoid filing duplicate tickets. Score each item independently, but reference the root-cause template when writing remediation text. For template precedence rules (which ticket to promote and which to mark as duplicate), see `omb-prompt-review/SKILL.md`.

| Underlying Defect | Rubric Items | Root-Cause Template | Precedence |
|-------------------|-------------|--------------------|-----------:|
| Missing task objective | clarity.task-objective, clarity.unambiguous, clarity.specificity | "Prompt does not state what the model should produce; reader cannot infer success criterion." | clarity.task-objective wins |
| No output structure | output.format-defined, output.schema-provided, output.length-specified | "Prompt leaves output shape to model discretion; downstream consumers cannot parse reliably." | output.format-defined wins |
| Overloaded emphasis markers | safety.no-aggressive-caps-stacking, safety.calibrated | "Too many ALL-CAPS/CRITICAL/MUST markers dilute signal; model cannot distinguish real constraints from emphasis noise." | safety.no-aggressive-caps-stacking wins |
| Repeated instruction text | safety.no-instruction-repetition, structure.separation | "Same rule stated multiple times wastes tokens and signals uncertain authorship." | safety.no-instruction-repetition wins |
| Subagent delegation unclear | tool.subagent-guidance-explicit-for-4-7, claude-code.subagent-guidance | "Prompt does not specify which tasks to delegate vs handle inline; 4.7 parallel-tool behavior is ambiguous." | tool.subagent-guidance-explicit-for-4-7 wins |
| Effort/complexity mismatch | reasoning.effort-level-specified, reasoning.effort-matched | "Prompt does not declare expected reasoning depth; model may over- or under-think." | reasoning.effort-level-specified wins |
| Prefill output coupling | output.no-prefill-dependency, output.format-defined | "Output correctness depends on a prefill the prompt does not guarantee; portable use breaks." | output.no-prefill-dependency wins |

## Output Format

### Section 1: Score Sheet

```
## Evaluation Score Sheet

**Overall Score: XX% (Grade: X)**
**Pass: XX / XX items | Fail: XX | N/A: XX**

| # | Dimension | Pass | Fail | N/A | Score | Weight | Weighted |
|---|-----------|------|------|-----|-------|--------|----------|
| 1 | Clarity | X | X | X | XX% | 15% | XX% |
| 2 | Structure | X | X | X | XX% | 12% | XX% |
| ... | ... | ... | ... | ... | ... | ... | ... |
| | **Total** | | | | | | **XX%** |
```

### Section 2: Issue Tickets (PP-P0 through PP-P3)

> Ticket format: See `.claude/rules/workflow/09-ticket-schema.md` for canonical schema, field definitions, and prefix conventions.

Each FAIL item produces a ticket with prefix `PP-P{0-3}-{NNN}`. All tickets are created with `Status: OPEN`. Root Cause is required for prompt evaluation tickets.

### Section 3: Summary

```
## Issue Summary

| Priority | Count | Status |
|----------|-------|--------|
| P0 | X | Must fix |
| P1 | X | Should fix |
| P2 | X | Can fix |
| P3 | X | Nice to have |
| **Total** | **X** | |

**Verdict:** PASS (≥80% overall, 0 PP-P0s) | FAIL (otherwise)
```

## Grade Thresholds

| Grade | Score | Condition |
|-------|-------|-----------|
| A | ≥90% | AND 0 P0, 0 P1 |
| B | ≥80% | AND 0 P0 |
| C | ≥65% | AND 0 P0 |
| D | ≥50% | — |
| F | <50% | — |

## How to Use

Read individual evaluation rule files for the complete checklist:

```
rules/eval-clarity.md
rules/eval-structure.md
```

Each rule file contains evidence-anchored PASS/FAIL criteria with:
- **Evidence Required** column: what to quote from the prompt
- **Observable Markers** column: concrete textual patterns for PASS vs FAIL

Also see `rules/calibration-anchors.md` for 6 stratified calibration anchors (system-prompt, agent-prompt, skill-description, CLAUDE.md, tool-using-prompt, simple-task-prompt) to calibrate scoring.
