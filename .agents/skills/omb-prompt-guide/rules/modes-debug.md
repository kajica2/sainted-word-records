---
title: Debug Mode -- Diagnose Failing Prompts
impact: HIGH
impactDescription: Focuses Claude on root-cause analysis rather than unsolicited rewrites
tags: modes, debug, diagnosis, root-cause
---

## Debug Mode -- Diagnose Failing Prompts

Use Debug mode when a prompt, piece of code, or agent behavior is not producing the
expected result and you need to understand why. In Debug mode Claude should optimize
for accurate diagnosis, not for proposing full rewrites unless you explicitly ask for one.

**When to use Debug mode:**
- A prompt returns off-format or incomplete output
- An agent tool call fires when it should not (or does not fire when it should)
- An LLM output is factually wrong or truncated unexpectedly

**Pair with context-first rules** (`foundation-context-first.md`): place all relevant
inputs -- the failing prompt, the actual output, the expected output, and any error
messages -- before your diagnostic instruction. Claude diagnoses with full context in view.

**Incorrect (no mode; Claude improvises between explaining and rewriting):**

```text
My summarization prompt keeps returning one-line outputs even for 10-page documents.
What should I do?
```

**Correct (Debug mode; context provided before the diagnostic instruction):**

```text
MODE: Debug

Failing prompt:
<prompt>
Summarize the document above in plain English.
</prompt>

Actual output: "The document covers financial topics." (one line)
Expected output: 3-5 bullet points covering each major finding.
Model: claude-sonnet-4-6, temperature 1.0.

Identify the root cause. Do not rewrite the prompt; explain why the current instruction
produces truncated output and what specific wording drives the failure.
```

Reference: `foundation-context-first.md` for the context-placement pattern used above.
