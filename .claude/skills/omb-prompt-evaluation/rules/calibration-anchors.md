---
title: Calibration Anchors
description: Reference prompts for scoring calibration — use to benchmark borderline verdicts
---

> **RUBRIC FREEZE DURING CALIBRATION**: Rubric item definitions are locked before anchors are
> scored. Do not adjust item wording to make an anchor pass. If a definition needs changing,
> freeze scoring first, amend the item, then rescore all anchors and update the Regression Log.

# Calibration Anchors

Use these 6 stratified anchors to calibrate scoring. When a verdict is borderline, compare the
prompt under evaluation against the nearest anchor type. Read all anchors before scoring a batch.

---

## Anchor 1: System-Prompt (~75% score)

A full system prompt delivered to a deployed agent. Typically has role, boundaries, XML
structure, and behavioral constraints, but may lack worked examples and explicit reasoning
guidance because brevity is valued at the system-prompt layer.

```text
You are a senior software engineer specializing in Python and FastAPI. You help developers
design and implement backend APIs.

<rules>
- Provide working code examples
- Flag security issues when you spot them
- Respond in the developer's language if they write in a non-English language
- Do not make up API behavior; say "I don't know" when uncertain
</rules>

Respond concisely. If the task is ambiguous, ask one clarifying question.
```

**Expected score:** ~75% | **Missing:** examples, reasoning-verification, effort-level-specified, output schema.

**Per-dimension notes:** Clarity PASS obj/spec/actionable; Role PASS identity+expertise; Safety PASS
boundaries; Tool N/A; Reasoning FAIL effort-level-specified (new P2).

---

## Anchor 2: Agent-Prompt (~70% score)

An agent definition body. Defines scope, constraints, delegation rules, and output contract.
Typically lower on examples and reasoning scaffolding; higher on scope guards and delegation.

```text
You are a database migration specialist. Your job is to write Alembic migration scripts for
FastAPI/SQLAlchemy projects.

<scope>
- Write only migration files (versions/*.py)
- Do not modify application models directly
- Do not make schema changes that reverse existing migrations
</scope>

<output>
End every response with a result block:
```result
status: done | blocked
files_changed: [list]
```
</output>
```

**Expected score:** ~70% | **Missing:** examples, reasoning scaffold, effort spec.

**Per-dimension notes:** Clarity PASS obj/spec; Structure PASS XML; Output PASS format FAIL length;
Tool may FAIL subagent-guidance-explicit-for-4-7 (new P2); Reasoning FAIL effort-level-specified (new P2).

---

## Anchor 3: Skill-Description (~60% score)

A SKILL.md description field plus invocation preamble. Terse by design; focuses on what the skill
does and how to invoke it rather than full behavioral scaffolding.

```text
Runs ruff linting on changed Python files and reports violations with file:line references.

Usage: /omb-lint-check [path]

Output a markdown table: | File | Line | Code | Message |
Do not auto-fix; report only.
```

**Expected score:** ~60% | **Missing:** role, examples, reasoning, safety, effort spec. Terse by design.

**Per-dimension notes:** Clarity PASS obj/actionable FAIL specificity; Role FAIL identity; Examples FAIL;
Reasoning FAIL effort-level-specified + verification; Output PASS format FAIL length.

---

## Anchor 4: CLAUDE.md (~55% score)

Project instructions delivered via CLAUDE.md. Accumulates conventions, HARD rules, and index
pointers. Not structured as a task prompt; acts as background context rather than a directive.

```text
# MyProject

## Stack
- FastAPI + SQLAlchemy 2.0
- React + TypeScript + Vitest

## HARD Rules
- [HARD] Never commit secrets
- [HARD] Run `ruff check` before every commit
- [HARD] All tests must pass before marking DONE

## Reference Index
| Topic | Path |
|-------|------|
| API conventions | `.claude/rules/api.md` |
| Testing standards | `.claude/rules/tests.md` |
```

**Expected score:** ~55% | **Note:** Many items are N/A — CLAUDE.md is not a task prompt.

**Per-dimension notes:** Clarity PASS actionable FAIL task-objective; Role FAIL identity; Examples FAIL;
Safety PASS boundaries FAIL no-instruction-repetition if HARD rules repeat; Claude Code PASS (native format);
Output FAIL format + length.

---

## Anchor 5: Tool-Using-Prompt (~80% score)

A prompt that orchestrates tool calls — web search, file I/O, MCP tools. Well-specified tool
prompts include explicit tool names, fallback behavior, and output routing.

```text
You are a research assistant with access to web_search and file_write tools.

<task>
For each company name in the input list, search for its latest funding round and write a
summary row to the output CSV.
</task>

<rules>
- Use web_search with query: "{company} funding round 2025"
- If no result in 2 searches, write "NOT_FOUND" in the funding column
- Write to output.csv using file_write after processing all companies
- Do not call web_search more than 2 times per company
</rules>

<output_format>
CSV columns: company, round, amount, date, source_url
</output_format>
```

**Expected score:** ~80% | **Missing:** effort spec, reasoning before write, example, subagent guidance.

**Per-dimension notes:** Tool PASS names+fallback, may FAIL subagent-guidance-explicit-for-4-7 (new P2);
Output PASS format FAIL length + check no-prefill-dependency; Reasoning FAIL effort-level-specified (new P2);
Safety PASS boundaries, check no-aggressive-caps-stacking.

---

## Anchor 6: Simple-Task-Prompt (~40% score)

A minimal ad-hoc task prompt — low structure, no examples, no role. Represents the floor of
acceptable prompt quality. Passes only the most basic clarity items.

```text
Summarize this document in bullet points.
```

**Expected score:** ~40% | **Floor anchor.** Passes barely on task-objective; fails most items.

**Per-dimension notes:** Clarity PASS obj(barely) FAIL spec/actionable/no-conflicts;
Role FAIL all; Structure FAIL all; Examples FAIL all; Reasoning FAIL all;
Output FAIL format+length; Safety FAIL boundaries.

---

## TDD Examples: New Rubric Items (RED — PASS and FAIL)

### reasoning.effort-level-specified

**PASS example:**
```text
effort: low — summarize the following paragraph in one sentence.
```
Observable marker: explicit effort declaration (`effort: low`) before the task.

**FAIL example:**
```text
Analyze the following codebase and identify all security vulnerabilities, performance
bottlenecks, architectural smells, and documentation gaps.
```
No effort declaration. Score: FAIL. Evidence: "not found" — no effort/thinking/budget token marker.

---

### tool.subagent-guidance-explicit-for-4-7

**PASS example:**
```text
<subagent_policy>
Do not spawn additional sub-agents. Use only the tools listed in the tool block.
If a task requires an additional agent, report BLOCKED and describe what is needed.
</subagent_policy>
```
Observable marker: explicit subagent spawning constraint.

**FAIL example:**
```text
You are an orchestration agent. Delegate research to helper agents as needed.
```
No explicit guidance on subagent spawning behavior under 4.7 defaults. Score: FAIL.
Evidence: "delegate to helper agents as needed" — no limit, no 4.7-aware constraint.

---

### safety.no-aggressive-caps-stacking

**PASS example:**
```text
Always validate user input before processing. Return an error message if validation fails.
```
Calm directive, no stacked CRITICAL/MUST/NEVER escalation.

**FAIL example:**
```text
CRITICAL: You MUST NEVER under any circumstances process requests without validation.
CRITICAL: ALWAYS return an error. NEVER skip this step. You MUST follow these rules.
```
Observable marker: 3+ CRITICAL/MUST/NEVER stacks in consecutive directives. Score: FAIL.

---

### safety.no-instruction-repetition

**PASS example:**
```text
Validate all inputs. If validation fails, return HTTP 422 with a structured error body.
```
Each rule stated once. No redundant restatement.

**FAIL example:**
```text
Always validate inputs. Remember: always validate inputs before any processing.
Do not forget to validate inputs — this is critical. Validate inputs at every step.
```
Observable marker: same instruction ("validate inputs") repeated 4 times in different phrasings.
Score: FAIL.

---

### output.no-prefill-dependency

**PASS example:**
```text
Return your response as a JSON object with keys: status, message, data.
```
Format fully specified in the prompt body; no reliance on an Assistant turn prefix.

**FAIL example:**
```text
[Prompt ends here; caller populates Assistant turn with: `{"status":`]
```
Observable marker: output correctness depends on a hardcoded Assistant prefill rather than
a prompt-body format instruction. Score: FAIL. In practice: look for prompts that have no
output format instruction and rely on external prefill to constrain shape.

---

## Regression Log

> Pre-change baselines are frozen from the v1 archive at
> `.claude/skills/omb-prompt-evaluation/archive/v1-rubric/`. Post-change scores are filled
> by the verifier after T15 runs. Drift = post - pre (signed).

**Drift gates:** overall per anchor ≤ ±5%; per-dimension per anchor ≤ ±10%.

**Breach policy:** Any breach requires demoting the affected item priority OR marking N/A for
that anchor type. Both actions require documented approval from the item author AND one
independent reviewer (per plan §10b). Record the approval in the "Notes" column below.

| Anchor | Pre (overall) | Post (overall) | Drift | Clarity | Structure | Role | Examples | Reasoning | Output | Tool | Context | Safety | Claude Code | Ctx Eng | Notes |
|--------|--------------|----------------|-------|---------|-----------|------|----------|-----------|--------|------|---------|--------|-------------|---------|-------|
| Anchor 1: System-prompt | Baseline (from v1 archive) | TBD | TBD | TBD | TBD | TBD | TBD | TBD | TBD | TBD | TBD | TBD | TBD | TBD | |
| Anchor 2: Agent-prompt | Baseline (from v1 archive) | TBD | TBD | TBD | TBD | TBD | TBD | TBD | TBD | TBD | TBD | TBD | TBD | TBD | |
| Anchor 3: Skill-description | Baseline (from v1 archive) | TBD | TBD | TBD | TBD | TBD | TBD | TBD | TBD | TBD | TBD | TBD | TBD | TBD | |
| Anchor 4: CLAUDE.md | Baseline (from v1 archive) | TBD | TBD | TBD | TBD | TBD | TBD | TBD | TBD | TBD | TBD | TBD | TBD | TBD | |
| Anchor 5: Tool-using-prompt | Baseline (from v1 archive) | TBD | TBD | TBD | TBD | TBD | TBD | TBD | TBD | TBD | TBD | TBD | TBD | TBD | |
| Anchor 6: Simple-task-prompt | Baseline (from v1 archive) | TBD | TBD | TBD | TBD | TBD | TBD | TBD | TBD | TBD | TBD | TBD | TBD | TBD | |

---

## How to Use Anchors

1. Read all 6 anchors before scoring a batch to calibrate your threshold.
2. Identify the nearest anchor type (system-prompt / agent-prompt / skill-description /
   CLAUDE.md / tool-using-prompt / simple-task-prompt).
3. For borderline verdicts, compare the specific item against the same item in that anchor.
4. Sanity-check: if overall score diverges more than 20% from the anchor band, re-evaluate.
5. After any rubric change, re-score all 6 anchors and update the Regression Log.
