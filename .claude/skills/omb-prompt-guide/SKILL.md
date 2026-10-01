---
name: omb-prompt-guide
description: "Prompt engineering guide — system prompts, agent instructions, CLAUDE.md. 72 rules for writing Claude prompts."
user-invocable: true
argument-hint: "[prompt type or topic]"
---

# Prompt Engineering Guide

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

Comprehensive guide for writing effective prompts for Claude, based on Anthropic's official best practices (Claude 4.7, April 2026). Contains **72 rules** across 15 categories (plus `_template.md` and `_sections.md` scaffolding = 74 files total), prioritized by impact.

## When to Apply

Reference these guidelines when:
- Writing system prompts or agent instructions
- Authoring skill descriptions (SKILL.md)
- Creating CLAUDE.md or rules files
- Designing tool descriptions
- Writing orchestration instructions for sub-agents
- Reviewing or improving existing prompts

## Rule Categories by Priority

| Priority | Category | Impact | Prefix | Rules |
|----------|----------|--------|--------|-------|
| 1 | Foundations | CRITICAL | `foundation-` | 5 |
| 2 | Structure | CRITICAL | `structure-` | 4 |
| 3 | Role & Identity | HIGH | `role-` | 3 |
| 4 | Examples & Demonstrations | HIGH | `example-` | 4 |
| 5 | Reasoning & Thinking | HIGH | `reasoning-` | 5 |
| 6 | Output Control | MEDIUM-HIGH | `output-` | 5 |
| 7 | Tool & Agent Prompting | MEDIUM-HIGH | `tool-` | 5 |
| 8 | Long Context & Multi-Turn | MEDIUM | `context-` | 4 |
| 9 | Safety & Guardrails | MEDIUM | `safety-` | 5 |
| 10 | Claude Code Specific | HIGH | `claude-code-` | 5 |
| 11 | Context Engineering | MEDIUM-HIGH | `context-eng-` | 3 |
| 12 | Four Modes | HIGH | `modes-` | 5 |
| 13 | Anti-Patterns | HIGH | `anti-patterns-` | 5 |
| 14 | Migration (4.6 → 4.7) | MEDIUM | `migration-` | 2 |
| 15 | System-Prompt Patterns | HIGH | `system-prompt-` | 5 |
| — | Claude 4.7 Calibration (expanded) | HIGH | `claude-4-7-` | 7 |

## Quick Reference

### 1. Foundations (CRITICAL)

- `foundation-clarity` — Be clear and direct; say exactly what you want
- `foundation-specificity` — Quantify constraints with concrete numbers and boundaries
- `foundation-context-first` — Provide context and motivation before instructions
- `foundation-explain-why` — Explain the reason behind constraints and rules
- `foundation-audience` — Define who will consume the output

### 2. Structure (CRITICAL)

- `structure-xml-tags` — Use XML tags for clear semantic boundaries
- `structure-component-ordering` — Follow the 10-component framework order
- `structure-separation` — Separate role, task, rules, and format concerns
- `structure-hierarchy` — Nest complex structures with parent-child tags

### 3. Role & Identity (HIGH)

- `role-system-prompt` — System prompt defines WHO; user prompt defines WHAT
- `role-expertise` — Define specific expertise, experience, and domain
- `role-persona-boundaries` — Set behavioral boundaries for the role

### 4. Examples & Demonstrations (HIGH)

- `example-multishot` — Provide 1-5 input-output examples for consistency
- `example-good-bad-pairs` — Show both correct and incorrect with explanations
- `example-edge-cases` — Include edge case examples to prevent brittle behavior
- `example-output-format` — Demonstrate desired format through example, not description

### 5. Reasoning & Thinking (HIGH)

- `reasoning-chain-of-thought` — Ask Claude to think step-by-step for complex problems
- `reasoning-extended-thinking` — Use thinking blocks for multi-step analysis
- `reasoning-step-by-step` — Break complex tasks into numbered sequential steps
- `reasoning-self-critique` — Ask Claude to verify its own output before finalizing
- `reasoning-effort-parameter` — Match effort level to task complexity

### 6. Output Control (MEDIUM-HIGH)

- `output-format-spec` — Explicitly define the output structure
- `output-length-control` — Specify word, sentence, or paragraph counts
- `output-structured-data` — Provide exact schemas for structured output
- `output-markdown-control` — Control markdown and formatting usage explicitly
- `output-verbosity-tuning` — Tune Claude's natural verbosity level

### 7. Tool & Agent Prompting (MEDIUM-HIGH)

- `tool-explicit-instructions` — Tell Claude exactly when and how to use each tool
- `tool-parallel-calls` — Instruct independent tool calls to run in parallel
- `tool-error-handling` — Define failure behavior for tool calls
- `tool-proactive-vs-conservative` — Choose between action-first and ask-first modes
- `tool-state-tracking` — Maintain structured state for multi-step agent tasks

### 8. Long Context & Multi-Turn (MEDIUM)

- `context-document-placement` — Place long documents before instructions
- `context-long-context-tips` — Use quoting and grounding for large inputs
- `context-multi-window` — Save progress across context windows
- `context-conversation-history` — Include relevant conversation history

### 9. Safety & Guardrails (MEDIUM)

- `safety-boundaries` — Define explicit MUST NOT rules
- `safety-hallucination-prevention` — Require investigation before answering
- `safety-refusal-calibration` — Avoid making Claude overcautious
- `safety-data-handling` — Set rules for sensitive data handling
- `safety-agent-constraints` — Define sub-agent boundaries and escalation rules

### 10. Claude Code Specific (HIGH)

- `claude-code-verification` — Give Claude a way to verify its own work (tests, screenshots, expected outputs)
- `claude-code-claudemd` — Write an effective CLAUDE.md (concise, non-obvious rules only)
- `claude-code-context-management` — Manage context window aggressively (/clear, /compact, subagents)
- `claude-code-subagent-delegation` — Delegate research to subagents to preserve main context
- `claude-code-autonomy-safety` — Balance autonomy and safety with a reversibility framework

### 11. Context Engineering (MEDIUM-HIGH)

- `context-eng-multi-window` — Design for multi-context-window workflows with state recovery
- `context-eng-state-persistence` — Use structured state files (JSON, markdown, git) for long tasks
- `context-eng-token-budget` — Optimize token utility with scoped reads and strategic compaction

### 12. Four Modes (HIGH)

- `modes-four-modes` — Overview: declare one of Build, Debug, Learn, or Rewrite per session
- `modes-build` — Build mode: generate new code from scratch with full scaffolding
- `modes-debug` — Debug mode: diagnose and fix existing code with root-cause analysis
- `modes-learn` — Learn mode: explain concepts and code without writing production changes
- `modes-rewrite` — Rewrite mode: restructure existing code while preserving behavior

### 13. Anti-Patterns (HIGH)

- `anti-patterns-mode-mixing` — Avoid mixing multiple mode intents in a single prompt
- `anti-patterns-negative-instructions` — Replace "do not X" with explicit positive alternatives
- `anti-patterns-over-triggering` — Avoid tool-use instructions that fire on every turn
- `anti-patterns-overeagerness` — Constrain autonomy to prevent unsolicited side-effects
- `anti-patterns-repetition` — Eliminate redundant rules that restate other rules verbatim

### 14. Migration (4.6 to 4.7) (MEDIUM)

- `migration-budget-tokens-to-effort` — Replace deprecated `budget_tokens` with `effort` parameter
- `migration-prefill-deprecated` — Remove assistant-prefill patterns no longer supported in 4.7

### 15. System-Prompt Patterns (HIGH)

- `system-prompt-copyright-limits` — Restrict reproduction of copyrighted material in outputs
- `system-prompt-reminder-framework` — Inject compact reminders rather than re-injecting full context
- `system-prompt-request-evaluation` — Teach Claude to classify requests before responding
- `system-prompt-search-first` — Require information retrieval before synthesis or generation
- `system-prompt-tool-discovery` — Describe tools in the system prompt for reliable selection

### Claude 4.7 Calibration (HIGH)

- `claude-4-7-effort-levels` — Map low/medium/high/max effort to expected depth and token use
- `claude-4-7-harness-migration-checklist` — Step-by-step checklist for migrating harness prompts to 4.7
- `claude-4-7-high-res-images` — Prompt adjustments for high-resolution image inputs
- `claude-4-7-literal-instruction` — 4.7 follows instructions more literally; add intent context
- `claude-4-7-subagent-tuning` — Tune subagent delegation prompts for 4.7 compliance behavior
- `claude-4-7-tool-use-triggering` — Adjust thresholds to prevent over- and under-triggering in 4.7
- `claude-4-7-user-facing-updates` — Changes visible to end-users when upgrading from 4.6 to 4.7

## Prompt Templates

### Comprehensive (10-Component Framework)

Use for complex, high-stakes, or reusable prompts:

```xml
<system_prompt>Role with specific expertise</system_prompt>
<tone>Communication style</tone>
<background>All relevant context</background>
<task>
  <objective>What to accomplish</objective>
  <constraints>Requirements and boundaries</constraints>
  <success_criteria>How to measure success</success_criteria>
</task>
<rules>MUST / MUST NOT / CONSIDER</rules>
<examples>Good and bad examples</examples>
<thinking>Key questions to consider</thinking>
<format>Output structure specification</format>
```

### Minimal (4-Component Framework)

Use for straightforward tasks:

```xml
<system_prompt>Role identity</system_prompt>
<task>What needs to be done</task>
<rules>Key constraints</rules>
<format>Output structure</format>
```

## How to Use

Read individual rule files for detailed explanations and examples:

```
rules/foundation-clarity.md
rules/structure-xml-tags.md
```

Each rule file contains:
- Brief explanation of why the rule matters
- Incorrect prompt example with explanation
- Correct prompt example with explanation
- Additional context and references
