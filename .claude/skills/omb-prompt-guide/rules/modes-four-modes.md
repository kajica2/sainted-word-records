---
title: Four Modes of Prompting (Overview + Declaration)
impact: HIGH
impactDescription: Prevents mode confusion; focuses Claude on one cognitive task at a time
tags: modes, build, debug, rewrite, learn, mode-declaration
---

## Four Modes of Prompting (Overview + Declaration)

Every prompt session has one primary intent. Mixing modes in the same prompt forces Claude
to juggle conflicting cognitive objectives, which degrades quality across all of them. The
Four Modes framework names the four distinct intents and asks authors to declare which mode
they are in at the top of each prompt or session.

**The four modes:**

- **Build** -- Synthesize new content, code, or prompts from requirements. Claude optimizes
  for creation and completeness. Cross-ref: `modes-build.md`.
- **Debug** -- Diagnose and explain why something is failing. Claude optimizes for root-cause
  accuracy. Cross-ref: `modes-debug.md`.
- **Rewrite** -- Improve existing content while preserving intent and structure. Claude
  optimizes for targeted revision. Cross-ref: `modes-rewrite.md`.
- **Learn** -- Extract generalizable knowledge from examples or outputs. Claude optimizes
  for insight and transferability. Cross-ref: `modes-learn.md`.

**Mode-declaration header pattern:**

Place a short header line at the very top of the prompt (or in the system prompt for
agentic sessions) that names the active mode. This gives Claude an immediate frame before
it reads any context, reducing mode-confusion errors on long or ambiguous inputs.

```text
MODE: Build
```

or, for agentic sessions:

```text
<mode>Build</mode>
```

**Incorrect (mode missing -- Claude must infer intent):**

```text
Here is the authentication module. It is failing in production. Also explain how OAuth2
works and draft a new session-management approach.
```

**Correct (mode declared -- intent is unambiguous):**

```text
MODE: Debug

Here is the authentication module. It is failing in production with a 401 on every
third request. Identify the root cause. Do not propose a rewrite; focus only on the
failing path.
```

Reference: Anti-Patterns > `anti-patterns-mode-mixing.md` for the corresponding failure pattern.
