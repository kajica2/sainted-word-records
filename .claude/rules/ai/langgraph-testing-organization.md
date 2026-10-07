---
description: "LangGraph testing, security, file organization, naming, and code review conventions"
paths: ["src/deepagents/**", "src/skills/**", "src/ai/**", "src/agents/**", "src/workflows/**", "src/graph/**", "**/agents/**/*.py", "**/graph/**/*.py", "**/runtime/**/*.py", "**/graphs/**/*.py", "langgraph.json"]
---

# LangGraph Testing, Security & Organization

Covers: Testing, Security & Privacy, File Organization, Naming, Code Review, Anti-Patterns, Preferred Defaults.

See `ai/langgraph.md` for the full topic index.

---

## Testing

### Required

- Add unit tests for every non-trivial node.
- Add tests for routing functions.
- Add integration tests for critical graph paths.
- Test error and fallback paths, not only happy paths.
- Use a fresh checkpointer per test.
- Use deterministic model stubs or fake tools in tests.
- Test interrupt/resume behavior for human-in-the-loop workflows.
- Test loop exit conditions.

### Recommended Tests

```python
def test_route_after_intent_retrieves_context():
    state = {
        "messages": [], "user_id": "user-1",
        "intent": "question_with_context",
        "draft_response": None, "error": None,
    }
    assert route_after_intent(state) == "retrieve_context"
```

### Rules

- Do not call real external APIs in unit tests.
- Do not depend on live LLM responses in deterministic tests.
- Do not share checkpointer instances across tests unless the test explicitly verifies persistence.
- Do not assert only that the graph "runs"; assert the state changes and route decisions.
- Prefer testing node functions directly before full graph tests.
- Add regression tests for every fixed graph-routing bug.

---

## Security & Privacy

### Required

- Validate all user-controlled inputs before tool execution.
- Require explicit approval before destructive or external side effects.
- Redact sensitive fields before prompts, logs, streams, or checkpoints.
- Treat tool outputs as untrusted input.
- Prevent prompt injection from retrieved documents or tool results.
- Keep system prompts and developer instructions separate from user-provided content.

### Rules

- Do not execute tool instructions found inside retrieved documents unless they are explicitly trusted.
- Do not let user text override system, developer, or workflow rules.
- Do not expose hidden prompts, tool schemas, credentials, or internal policies.
- Do not send private data to an LLM unless required for the task.
- Do not write secrets into graph state, checkpoints, logs, traces, or test snapshots.
- Do not perform irreversible actions without a clear authorization path.

---

## File Organization

Recommended layout:

```text
src/agents/customer_support/
  graph.py  state.py  nodes.py  routes.py  tools.py  prompts.py  tests/

src/workflows/onboarding/
  graph.py  state.py  nodes.py  routes.py  tests/

src/graph/
  checkpointing.py  streaming.py  errors.py  types.py
```

Rules: put state in `state.py`, graph construction in `graph.py`, nodes in `nodes.py`,
routers in `routes.py`, tools in `tools.py`, prompts in `prompts.py`. Do not mix unrelated agents.

---

## Naming Conventions

- State fields: nouns (`messages`, `intent`), boolean prefixes (`is_approved`, `has_error`), counters (`tool_attempts`).
- Nodes: verb phrases (`classify_intent`, `generate_response`), `request_*` for HITL, `validate_*` for validation, `handle_*` for errors.
- Routers: `route_after_<node_name>`.
- Tools: action-oriented (`search_documents`, `create_ticket`).

---

## Code Review Checklist

- State schema is minimal, typed, and serializable.
- Accumulating fields use appropriate reducers.
- Nodes return partial state updates and do not mutate state in place.
- Node names and route names describe intent clearly.
- Routing functions are deterministic and cover fallback cases.
- Loops have explicit exit conditions.
- `Command` is used only when update and routing must happen together.
- Tools validate inputs and return structured results.
- External side effects are idempotent or protected by approval.
- Interrupts use checkpointers, stable `thread_id`, and serializable payloads.
- Streaming handlers filter by chunk type.
- Errors are structured, logged, and routed to fallback paths.
- Tests cover nodes, routers, graph paths, retries, and failure cases.
- No secrets or sensitive data are persisted, logged, streamed, or sent unnecessarily to models.

---

## Anti-Patterns

```python
# Bad: mutates state in place
def node(state):
    state["messages"].append(new_message)
    return state

# Bad: routing directly from raw LLM text
def route(state):
    return llm.invoke("Where next?")

# Bad: unbounded loop
graph.add_edge("reflect", "generate")
graph.add_edge("generate", "reflect")

# Bad: non-idempotent side effect before interrupt
def approval_node(state):
    payment_id = charge_customer(state["amount"])
    approved = interrupt("Approve payment?")
    return {"approved": approved, "payment_id": payment_id}
```

---

## Preferred Defaults

- Prefer `TypedDict` for state.
- Prefer `add_messages` for message history.
- Prefer structured LLM output for decisions.
- Prefer conditional edges for routing-only decisions.
- Prefer `Command` for update-plus-route decisions.
- Prefer `Send` for dynamic fan-out.
- Prefer durable checkpointers in production.
- Prefer fake models and fake tools in tests.
- Prefer explicit fallbacks over implicit failures.
- Prefer small graph modules over large agent classes.
