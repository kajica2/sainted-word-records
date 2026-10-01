---
fixture: fixture-both-symptoms
expected_templates:
  - OVERENGINEERED
expected_min_priority: P2
---

# Fixture: Both Symptoms (Mode Mixing AND Caps Stacking)

This prompt has BOTH mixed Build+Learn+Critique mode language AND aggressive
CRITICAL/MUST/NEVER stacking. OVERENGINEERED must win by precedence.

## Prompt Under Review

```
You are a Python tutor and code reviewer. Help me with list comprehensions.

CRITICAL: You MUST NEVER use for-loops in any code you produce.
CRITICAL: You MUST always include type annotations on every example.
CRITICAL: You MUST NEVER give incorrect answers under any circumstances.
CRITICAL: You MUST format all code with 4-space indentation.
CRITICAL: You MUST NEVER produce code that has side effects.
CRITICAL: You MUST include error handling in every code block.

First, explain what list comprehensions are and teach me the syntax.
Describe when to use them versus generator expressions.

Then, write a production-ready function that uses list comprehensions to
filter and transform a list of user records.

Also, review the idiomatic Python style and evaluate whether the approach
follows best practices. Assess the readability and judge the code quality.
```

## Expected Outcome

The reviewer MUST produce an OVERENGINEERED ticket (NOT a MODE-CONFUSION ticket) because:

1. **OVERENGINEERED fires first** via Sub-signal A: 6 stacked CRITICAL/MUST/NEVER directives are present, satisfying the caps-stacking threshold.
2. OVERENGINEERED has the highest precedence in the de-dup matrix (OVERENGINEERED > MODE-CONFUSION).
3. Even though mode mixing is also present (Learn: "explain", "teach"; Build: "write a production-ready function"; Critique: "review", "evaluate", "assess", "judge"), MODE-CONFUSION is suppressed because OVERENGINEERED matched first.

### Required ticket structure

The OVERENGINEERED ticket MUST include:
- Evidence listing the 6 CRITICAL/MUST/NEVER lines (Sub-signal A)
- All suppressed items in the Evidence section, including those that would have triggered MODE-CONFUSION: `clarity.task-objective`, `clarity.no-conflicts`, `safety.no-aggressive-caps-stacking`
- Remediation addressing both the caps stacking AND noting the mode mixing as a secondary concern
- Explicit note that MODE-CONFUSION was suppressed due to precedence

### Template precedence check

- OVERENGINEERED: FIRES (Sub-signal A — 6 stacked CRITICAL/MUST/NEVER directives; takes priority)
- MODE-CONFUSION: SUPPRESSED (mode mixing present but overridden by OVERENGINEERED precedence)
- No standalone `clarity.task-objective`, `clarity.no-conflicts`, or `safety.no-aggressive-caps-stacking` tickets
