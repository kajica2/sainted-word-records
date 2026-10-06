---
title: Do Not Push Claude 4.7 to Act When Clarification Is Better
impact: MEDIUM
impactDescription: Aligns with Claude 4.7 literal-instruction defaults; prevents irreversible actions on ambiguous inputs
tags: anti-patterns, overeagerness, clarification, autonomy, claude-4-7
---

## Do Not Push Claude 4.7 to Act When Clarification Is Better

Claude 4.7 follows literal instructions more strictly than prior versions. A prompt that
tells Claude to "proceed without asking questions" or "default to action always" can produce
irreversible side effects when the input is genuinely ambiguous. The model will act on its
best interpretation rather than surface the ambiguity.

**When action-first is correct:**
- The input domain is well-defined and the range of ambiguity is low.
- A wrong action is easily reversible (e.g., generating text that can be discarded).
- You have explicitly listed the actions that require no confirmation.

**When clarification-first is correct:**
- The action is irreversible (file deletion, external API call, data mutation).
- The input contains conflicting or underspecified requirements.
- The task touches a domain where a wrong assumption causes downstream cascades.

**Do not use blanket action-first instructions for agents with broad tool access.**
Scope the action-first permission to specific, low-risk action types.

**Incorrect (blanket action-first with broad irreversible permissions):**

```text
You have full access to the production database. Always proceed without asking for
confirmation. Do not slow down the workflow with clarifying questions.
```

**Correct (action-first scoped to low-risk; clarification required for irreversible):**

```text
Default to action for read operations and draft generation. For any write, delete, or
external API call, confirm the action and expected outcome with the user before proceeding.
If input is ambiguous for a write operation, ask one targeted clarifying question.
```

Reference: `tool-proactive-vs-conservative.md` for the action-first vs. ask-first choice
framework; `claude-4-7-literal-instruction.md` for Claude 4.7 literal-compliance defaults.
