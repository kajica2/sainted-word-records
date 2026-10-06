---
title: Remove Redundant Progress Scaffolding for Claude 4.7
impact: MEDIUM
impactDescription: Eliminates duplicate status narration; keeps prompts lean
tags: claude-4-7, progress-updates, scaffolding, verbosity
---

## Remove Redundant Progress Scaffolding for Claude 4.7

Claude 4.7 emits built-in user-facing progress updates during long operations.
Prompts that carried explicit "announce what you are about to do" instructions
for earlier models now produce duplicated narration: one from the prompt
scaffolding and one from the model's built-in updates.

Remove "say what you are about to do" boilerplate. Let the model's native
progress mechanism carry that burden.

**Incorrect (redundant narration instructions -- causes duplication on 4.7):**

```text
Before each step, tell the user what you are about to do.
After completing each step, summarize what you did.
Keep the user informed of your progress throughout the task.
Announce when you start reading a file.
```

**Correct (let 4.7 handle progress natively -- no scaffolding needed):**

```text
Read src/api/auth.py, identify all unauthenticated endpoints,
then add JWT validation to each one.
```

**What 4.7 emits automatically:**
- Step transitions during multi-step tasks
- Tool-use status (reading, writing, running)
- Completion signals at natural task boundaries

**What still belongs in prompts:**
- Domain-specific status language ("report findings as PASS/FAIL")
- Custom output structure for the final result
- Suppress-update directives if silent execution is needed

**Migration checklist:**
- [ ] Remove "Before each step, say..." instructions
- [ ] Remove "After completing X, tell the user..." scaffolding
- [ ] Remove "Keep the user informed of progress" boilerplate
- [ ] Keep structured output format specs (they are not progress narration)

Reference: [Anthropic -- Claude 4.7 Release Notes](https://www.anthropic.com/news/claude-4)
