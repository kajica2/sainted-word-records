---
title: Be Explicit When Tool Use Is Required in Claude 4.7
impact: HIGH
impactDescription: Prevents silent skip of tool calls that were previously implicit
tags: claude-4-7, tool-use, explicit-instructions, triggering
---

## Be Explicit When Tool Use Is Required in Claude 4.7

Claude 4.7 calls tools less eagerly than 4.6. Where 4.6 would infer that
a file-read or search was needed and call the tool proactively, 4.7 waits
for an explicit instruction. Prompts that said "understand the codebase"
and relied on implicit file reads now produce answers from training knowledge
instead of actual tool calls.

**Incorrect (implicit tool expectation -- 4.7 may answer from memory):**

```text
Understand how we handle database migrations and suggest improvements.
```

**Correct (explicit tool requirement -- 4.7 reads files as directed):**

```text
Use the Read tool to read every file under alembic/versions/.
Then use Grep to search for "op.execute" across the codebase.
Based on those results, suggest improvements to our migration approach.
```

**Common implicit-to-explicit conversions:**

| Implicit phrasing (4.6 worked) | Explicit phrasing (required for 4.7) |
|--------------------------------|--------------------------------------|
| "Check the tests" | "Use Read to read tests/test_auth.py" |
| "Look at the existing code" | "Use Grep to search for `def handle_` in src/" |
| "See if there are any errors" | "Run `ruff check apps/api/` with Bash and read the output" |
| "Verify the fix works" | "Run `pytest tests/test_fix.py -v --timeout=10` with Bash; read the output" |

**Rule:** every tool call the prompt requires should be named explicitly.
Use the tool name (Read, Grep, Bash, Edit) in the instruction. Do not
rely on the model inferring what tool is appropriate.

**Exception:** agents configured with `permissionMode: auto` and a
comprehensive `<tools>` directive may rely on natural-language instructions;
even so, naming the tool reduces ambiguity.

Reference: [Anthropic -- Claude 4.7 Model Card](https://www.anthropic.com/news/claude-4)
