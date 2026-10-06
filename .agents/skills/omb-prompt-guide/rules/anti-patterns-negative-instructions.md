---
title: Prefer Positive-Form Instructions Over "Don't" Lists
impact: MEDIUM
impactDescription: Reduces behavioral ambiguity; tells Claude what to do rather than leaving the positive space undefined
tags: anti-patterns, negative-instructions, positive-form, clarity
---

## Prefer Positive-Form Instructions Over "Don't" Lists

Negative instructions ("don't do X") tell Claude what to avoid but leave the desired
behavior undefined. Claude must infer the positive intent, and that inference is not
always correct. A list of "don't" rules also grows without bound as edge cases accumulate,
whereas a positive description of the desired output is inherently bounded.

**When negative instructions are acceptable:**
- A small number of hard constraints that genuinely have no positive equivalent:
  "Do not output user PII under any circumstance."
- A clarifying exclusion appended to an otherwise positive instruction:
  "Write a 3-bullet summary. Do not include the author's name."

**When negative instructions are a sign of under-specification:**
- 5+ "don't" rules in succession usually means the positive behavior has not been defined.
- "Don't make it too long" -- what length is correct? Specify it.
- "Don't use jargon" -- for which audience? Specify the audience.

**Incorrect (list of negatives; positive behavior undefined):**

```text
Don't use markdown headers.
Don't write more than one paragraph.
Don't include examples.
Don't use technical terms.
Don't start with a greeting.
```

**Correct (positive description of desired output):**

```text
Respond in plain prose, one paragraph, no more than 5 sentences. Use language a
non-technical executive can read without a glossary. Begin directly with the finding.
```

Reference: `foundation-specificity.md` for quantifying the positive constraints that replace
vague negatives.
