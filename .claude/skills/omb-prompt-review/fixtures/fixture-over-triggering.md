---
fixture: fixture-over-triggering
expected_templates:
  - OVERENGINEERED
expected_min_priority: P2
---

# Fixture: Over-triggering (Aggressive CRITICAL/MUST/NEVER Stacking)

This prompt has 7 stacked CRITICAL/MUST/NEVER directives with no mode mixing.
All language is in a single Build mode.

## Prompt Under Review

```
You are a Python code generator. Generate a data processing function.

CRITICAL: You MUST always validate all inputs before processing.
CRITICAL: You MUST NEVER return None under any circumstances.
CRITICAL: You MUST include type hints on every function signature.
CRITICAL: You MUST add docstrings to every function.
CRITICAL: You MUST handle all exceptions and log them.
CRITICAL: You MUST NEVER use global variables.
CRITICAL: You MUST follow PEP 8 formatting in all generated code.

Write a function that takes a list of integers, filters out negative numbers,
and returns the sum of the remaining values. Include a brief comment above
the function explaining what it does.
```

## Expected Outcome

The reviewer MUST produce an OVERENGINEERED template ticket (Sub-signal A) because:

1. The prompt has **7 stacked CRITICAL/MUST/NEVER directives** — well above the threshold of 5.
2. No mode mixing is present: all language uses Build markers ("Generate", "Write a function").
3. The directives create redundancy and cognitive load without adding meaningful constraints beyond normal Python best practices.

The OVERENGINEERED ticket MUST include Sub-signal A in the diagnosis.

### Required ticket structure

The OVERENGINEERED ticket MUST include:
- Evidence listing the 7 CRITICAL/MUST/NEVER lines as a group
- Rubric items that fired and are now suppressed: at minimum `safety.no-aggressive-caps-stacking` and `safety.calibrated`
- Remediation: reduce to 2-3 targeted rules, replace caps with specific behavioral instructions
- Fix direction citing Sub-signal A

### Template precedence check

- OVERENGINEERED: FIRES (Sub-signal A — 7 stacked CRITICAL/MUST/NEVER directives)
- MODE-CONFUSION: DOES NOT FIRE (no mixed-mode language; all Build markers)
- No standalone `safety.no-aggressive-caps-stacking` or `safety.calibrated` tickets (suppressed by template)
