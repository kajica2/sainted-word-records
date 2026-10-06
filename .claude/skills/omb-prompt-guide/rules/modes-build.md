---
title: Build Mode -- Synthesize New Content
impact: HIGH
impactDescription: Directs creative energy toward output completeness; prevents debug/critique bleed
tags: modes, build, synthesis, creation
---

## Build Mode -- Synthesize New Content

Use Build mode when you need Claude to create something that does not yet exist: a prompt,
a module, a plan, a document. In Build mode Claude should optimize for completeness and
internal consistency, not for explaining its own process.

**When to use Build mode:**
- Writing a new prompt or prompt library entry
- Generating code from a specification
- Drafting a document, plan, or schema from requirements

**Declare it explicitly** at the top of the prompt so Claude does not slip into Debug or
Critique behavior mid-response. Pair with specificity rules (`foundation-specificity.md`)
to give Claude concrete constraints: target audience, format, length, acceptance criteria.

**Incorrect (no mode declared; instruction is ambiguous between Build and Critique):**

```text
Look at our existing login prompt and then write a better one.
```

**Correct (Build mode declared; requirements explicit):**

```text
MODE: Build

Write a new login-flow prompt for a FastAPI backend agent. Requirements:
- Role: backend security engineer
- Input: LoginRequest schema (email, password)
- Output: LoginResponse (JWT token) or 401 with reason
- Max 3 tool calls allowed
- No interactive clarification; proceed with best judgment

Do not critique the existing prompt; produce the new one directly.
```

Reference: `foundation-specificity.md` for quantifying constraints in Build prompts.
