---
description: "LangGraph error recovery, bounded loops, subgraphs, and observability patterns"
paths: ["src/deepagents/**", "src/skills/**", "src/ai/**", "src/agents/**", "src/workflows/**", "src/graph/**", "**/agents/**/*.py", "**/graph/**/*.py", "**/runtime/**/*.py", "**/graphs/**/*.py", "langgraph.json"]
---

# LangGraph Error Handling, Loops & Subgraphs

Covers: Error Handling, Loops, Subgraphs, Observability.

See `ai/langgraph.md` for the full topic index.

---

## Error Handling & Recovery

### Required

- Represent recoverable errors in state with a typed `error` field or structured error object.
- Add fallback nodes for critical LLM, tool, retrieval, or validation failures.
- Use retry logic with bounded attempts.
- Use exponential backoff for transient external failures.
- Log errors at graph boundaries and external call boundaries.
- Keep user-facing error messages separate from internal diagnostics.

### Rules

- Do not catch `Exception` without logging or returning a structured error.
- Do not retry forever.
- Do not retry non-idempotent operations unless an idempotency key is used.
- Do not expose stack traces to users.
- Do not let failed tools produce outputs that look successful.
- Prefer explicit fallback nodes such as `handle_tool_error`, `request_clarification`, or `safe_final_response`.

---

## Loops & Recursion

### Required

- Every loop must have a clear exit condition.
- Track loop attempts in state when retrying, reflecting, or revising.
- Set or respect recursion limits for graphs that can cycle.
- Route to `END` or a fallback node when limits are reached.

### Recommended Pattern

```python
MAX_TOOL_ATTEMPTS = 3

def route_after_tool_failure(state: AgentState) -> str:
    attempts = state.get("tool_attempts", 0)
    if attempts >= MAX_TOOL_ATTEMPTS:
        return "handle_tool_failure"
    return "retry_tool"
```

### Rules

- Do not create unbounded self-reflection loops.
- Do not rely on the LLM to decide when an infinite loop should stop.
- Do not increment retry counters in router functions; update counters in nodes.
- Keep retry, repair, and fallback paths visible in graph topology.

---

## Subgraphs & Multi-Agent Workflows

### Required

- Use subgraphs when a workflow section has its own state, tests, and lifecycle.
- Keep handoff contracts explicit.
- Define what state is shared between parent graph and subgraph.
- Add reducers for shared accumulated fields.
- Keep each agent role narrow and named by responsibility.

### Rules

- Do not make every node a subgraph.
- Do not pass the entire parent state into subgraphs unless required.
- Do not let subgraphs mutate parent-level fields accidentally.
- Use `Command.PARENT` intentionally when routing from a subgraph to a parent graph.
- Document multi-agent handoff points and expected state changes.

---

## Observability & Logging

### Required

- Log graph invocation boundaries.
- Log node-level failures.
- Log tool calls with safe metadata.
- Include `thread_id`, workflow name, node name, and request ID where available.
- Redact secrets and sensitive user data from logs.
- Add tracing for production workflows.

### Rules

- Do not log full prompts by default.
- Do not log raw message history when it may contain private data.
- Do not log access tokens, API keys, cookies, passwords, or authorization headers.
- Do not rely only on print statements.
- Prefer structured logs over free-form logs.
- Keep observability code separate from business logic when practical.

---
