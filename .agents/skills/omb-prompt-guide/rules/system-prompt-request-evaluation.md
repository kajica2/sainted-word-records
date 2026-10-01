---
title: Add a Request-Routing Decision Tree When Multiple Output Tools Are Available
impact: MEDIUM
impactDescription: Prevents the model from defaulting to the wrong output path when multiple tools could each satisfy a request
tags: system-prompt, routing, request-evaluation, tool-selection, capability-gated
---

## Add a Request-Routing Decision Tree When Multiple Output Tools Are Available

Traceability: plan Section 2.2.3 row 5 - source passage: Section 18 "Request Evaluation Checklist" (3-step:
visual? -> MCP fit? -> file?). Harness deficiency: no existing rule teaches request-routing decision
trees; `tool-parallel-calls.md` talks about execution, not pre-execution routing.

**When NOT to apply:**

This rule is N/A for single-output-path agents - agents that have exactly one way to produce their
output (only text, only a file write, only a single tool). The routing decision tree is only
necessary when 2 or more output-producing tools are available and the model must choose between them
(for example: visual render vs. file export vs. MCP artifact).

---

When a system prompt gives the model access to multiple output-producing tools (visual rendering,
MCP artifact creation, file writing, plain text), the model will pick a default without explicit
routing guidance - often the wrong one. A concise decision tree in the system prompt routes
requests deterministically.

**Incorrect (no routing guidance - model picks arbitrarily):**

```text
System: "You have access to: image_render, mcp_create_artifact, write_file,
and can respond with plain text. Help the user with their requests."
```

The model may generate an image for a request that should be a file, or write plain text for a
request that expects an interactive artifact.

**Correct (explicit request-routing decision tree):**

```text
System: "You have access to: image_render, mcp_create_artifact,
write_file, and plain text output.

<request_routing>
Before responding, evaluate the request:

1. Does the request require a visual or diagram?
   YES -> use image_render.

2. Does the request produce interactive or structured content that
   a downstream tool will consume?
   YES -> use mcp_create_artifact.

3. Does the request produce a file the user will save or run?
   YES -> use write_file.

4. None of the above -> respond with plain text.

Apply the first matching branch. Do not use multiple output tools
for a single response unless the user explicitly asks for both.
</request_routing>"
```

**Minimal version (two-tool routing):**

```text
<request_routing>
Use image_render when the user asks for a diagram, chart, or visual.
For everything else, respond with plain text.
</request_routing>
```

**Design tips:**

- Order branches from most-specific to most-general. The final branch should always be the plain
  text fallback.
- Restrict to at most 5 branches - longer trees are harder to follow and increase decision
  latency.
- If two tools can both satisfy a request, add a tiebreaker condition (prefer the simpler tool).

Reference: [Anthropic - Tool Use Overview](https://platform.claude.com/docs/en/build-with-claude/tool-use/overview)
