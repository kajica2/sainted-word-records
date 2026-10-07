---
fixture: fixture-clean
expected_templates: []
expected_min_priority: P2
---

# Fixture: Clean (Well-Formed Prompt)

This prompt is well-formed. It uses a single declared mode, has no caps stacking,
and follows structural best practices. Neither OVERENGINEERED nor MODE-CONFUSION
should fire. The overall grade should be B or better.

## Prompt Under Review

```xml
<role>
You are a Python code generator specializing in data processing utilities.
</role>

<task>
Build a function that filters a list of integers and returns the sum of
positive values only.
</task>

<rules>
- Return 0 if the input list is empty.
- Raise ValueError if input is not a list.
- Include type hints on the function signature.
</rules>

<examples>
<example>
Input: [1, -2, 3, -4, 5]
Output: 9
</example>
<example>
Input: []
Output: 0
</example>
</examples>

<format>
Return only the Python function. No explanation. No usage example outside
the function body.
</format>
```

## Expected Outcome

Neither OVERENGINEERED nor MODE-CONFUSION should fire because:

1. **No mode mixing**: the prompt uses Build markers exclusively ("Build a function", "Return").
2. **No caps stacking**: there are no CRITICAL/MUST/NEVER directives. The three rules use lowercase imperative language.
3. **Single declared objective**: the task is clear, specific, and unambiguous.
4. **Well-structured**: XML tags present (`<role>`, `<task>`, `<rules>`, `<examples>`, `<format>`).
5. **Concrete examples**: two input-output examples are provided.

### Expected score range

Overall grade: B (80%) or better.
No P0 or P1 tickets expected.
Any tickets raised should be P2 or P3 only (advisory).

### Template precedence check

- OVERENGINEERED: DOES NOT FIRE
- MODE-CONFUSION: DOES NOT FIRE
- Any item-level tickets that fire will be P2 or P3 (cosmetic/advisory)
