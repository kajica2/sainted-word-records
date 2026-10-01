---
title: Define a Deferred-Tool Contract for Partial Tool Lists
impact: MEDIUM
impactDescription: Prevents hallucinated tool calls or silent failures when the full tool list is not available at prompt time
tags: system-prompt, tool-discovery, deferred-tools, capability-gated
---

## Define a Deferred-Tool Contract for Partial Tool Lists

Traceability: plan Section 2.2.3 row 2 - source passage: Section 12 "Tool Discovery" block on deferred tools.
Harness deficiency: `tool-explicit-instructions.md` assumes all tools are declared upfront in the tool
block; no existing rule covers the deferred-tool pattern.

**When NOT to apply:**

This rule is N/A when all tools the model may use are declared in the tool block at prompt time.
The deferred-tool pattern is only necessary when some tools are injected later (for example, user-
installed MCP servers, plugin-loaded capabilities, or runtime-specific tools). If the tool list is
complete and static, use `tool-explicit-instructions.md` instead.

---

When a runtime injects tools after the system prompt is set (deferred / dynamic tool loading), the
model needs explicit guidance on how to discover and use tools it was not told about at prompt time.
Without this contract, the model either ignores new tools or invents incorrect parameter schemas.

**Incorrect (no deferred-tool contract - model ignores runtime-injected tools):**

```text
System: "You have access to various tools to help users."
```

When new tools appear at runtime, the model has no instructions for discovering them, verifying
parameters, or signaling when a required tool is missing.

**Correct (deferred-tool contract):**

```text
System: "You have access to a set of tools. Additional tools may be
made available during the conversation.

<tool_discovery>
When you need to perform an action and are unsure whether a suitable
tool exists:
1. Check the current tool list before attempting the action.
2. If a tool exists but its parameters are unclear, read its
   description carefully before calling it.
3. If no tool covers the required action, state what capability is
   missing rather than attempting the action without a tool or
   fabricating a call.
4. Never invent tool names or parameters that are not in the current
   tool list.
</tool_discovery>"
```

**With explicit fallback for missing tools:**

```text
<tool_discovery>
If a user requests an action that requires a tool not currently
available, respond: "I don't have the [capability] tool available
right now. If you install or enable it, I can help with that request."
Do not attempt workarounds that bypass the missing tool.
</tool_discovery>
```

Reference: [Anthropic - Tool Use Overview](https://platform.claude.com/docs/en/build-with-claude/tool-use/overview)
