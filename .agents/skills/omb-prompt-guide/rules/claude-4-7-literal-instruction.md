---
title: Use Precise Directives with Claude 4.7 (More Literal Instruction Following)
impact: HIGH
impactDescription: Prevents silent under-execution caused by vague or hedged phrasing
tags: claude-4-7, literal-instructions, directives, precision
---

## Use Precise Directives with Claude 4.7 (More Literal Instruction Following)

Claude 4.7 follows instructions more literally than 4.6. Where 4.6 would
infer intent and fill gaps, 4.7 executes the directive as written. Vague
hedges ("if possible", "try to", "feel free to") are treated as optional,
not as polite imperatives. Write directives that specify exactly what must
happen.

**Incorrect (vague hedge -- 4.7 may skip the step):**

```text
You may want to check for existing tests before writing new ones.
Feel free to add type hints if it seems useful.
Try to keep the response concise.
```

**Correct (precise directives -- 4.7 executes as written):**

```text
Before writing any new tests, read the existing test files under tests/.
Add Python type hints to every function signature you create or modify.
Respond in at most 3 sentences.
```

**Anti-patterns to eliminate when migrating from 4.6 prompts:**

| 4.6 phrasing (hedged) | 4.7 replacement (precise) |
|-----------------------|---------------------------|
| "if possible, validate input" | "Validate all inputs. Raise ValueError if invalid." |
| "you may want to run tests" | "Run the tests covering your changed files before claiming done." |
| "feel free to refactor" | "Refactor the function to under 30 lines." |
| "try to use the tool" | "Use the Read tool to read the file." |

**Rule of thumb:** every directive in a 4.7 prompt should be answerable with
"yes it happened" or "no it did not". Phrasing that cannot be verified should
be rewritten as a concrete, checkable action.

Reference: [Anthropic -- Claude 4.7 Model Card](https://www.anthropic.com/news/claude-4)
