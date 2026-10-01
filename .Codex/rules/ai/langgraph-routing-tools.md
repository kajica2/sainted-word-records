---
description: "LangGraph Routing, Tools & LLM Calls"
paths: ["src/deepagents/**", "src/skills/**", "src/ai/**", "src/agents/**", "src/workflows/**", "src/graph/**", "**/agents/**/*.py", "**/graph/**/*.py", "**/runtime/**/*.py", "**/graphs/**/*.py", "langgraph.json"]
---

# LangGraph Routing, Tools & LLM Calls

Covers: Routing & Edges, Command Usage, Tool Definitions, LLM Calls.

See `ai/langgraph.md` for the full topic index.

---

## Routing & Edges

### Required

- Use `add_conditional_edges` for branching.
- Routing functions must be pure and deterministic.
- Routing functions should return a `Literal[...]` value when practical.
- Every routing return value must be mapped to a valid node or `END`.
- Use `END` for terminal states.
- Add explicit fallback routes for unknown, invalid, or error states.

### Recommended Pattern

```python
from typing import Literal
from langgraph.graph import END


RouteAfterIntent = Literal["retrieve_context", "generate_response", "end"]


def route_after_intent(state: AgentState) -> RouteAfterIntent:
    if state.get("error"):
        return "end"

    intent = state.get("intent")

    if intent == "question_with_context":
        return "retrieve_context"

    if intent == "simple_question":
        return "generate_response"

    return "end"
```

### Rules

- Do not route based on unvalidated free-form LLM text.
- Normalize LLM routing outputs into enums or `Literal` values first.
- Do not create cycles unless there is a clear exit condition.
- Every loop must track an attempt count, recursion budget, or explicit termination condition.
- Use `Command` only when a node must both update state and control the next destination.
- Use conditional edges when routing does not need to update state.
- Use `Send` for dynamic fan-out/map-reduce style workflows where each branch receives different state.

---

## `Command` Usage

Use `Command` only when a node needs to update state and route in the same step.

### Recommended Pattern

```python
from typing import Literal
from langgraph.types import Command


def validate_result(state: AgentState) -> Command[Literal["generate_response", "retry_tool"]]:
    if state.get("error"):
        return Command(
            update={"error": state["error"]},
            goto="retry_tool",
        )

    return Command(
        update={"error": None},
        goto="generate_response",
    )
```

### Rules

- Always annotate `Command` return types with possible destination node names.
- Do not combine `Command(goto=...)` with static outgoing edges unless multiple downstream nodes must run.
- Do not pass `Command(update=...)` as graph input to continue a normal conversation.
- Use plain input dictionaries for new user turns.
- Use `Command(resume=...)` only to resume after `interrupt()`.
- Keep `Command` logic simple; complex routing belongs in a named router function.

---

## Tool Definitions

### Required

- Define tools with `@tool`.
- Every tool must have a clear docstring describing what it does and when to use it.
- Tool arguments must be typed.
- Validate tool inputs before executing side effects.
- Return structured data, not loose prose.
- Represent tool failures as structured error results unless the caller should fail hard.
- Keep tools independent from graph state unless explicitly designed as LangGraph tools returning `Command`.

### Recommended Pattern

```python
from typing_extensions import TypedDict
from langchain_core.tools import tool


class SearchResult(TypedDict):
    ok: bool
    items: list[dict]
    error: str | None


@tool
def search_knowledge_base(query: str, limit: int = 5) -> SearchResult:
    """Search the internal knowledge base for relevant documents."""
    if not query.strip():
        return {"ok": False, "items": [], "error": "query must not be empty"}

    if limit < 1 or limit > 20:
        return {"ok": False, "items": [], "error": "limit must be between 1 and 20"}

    try:
        items = knowledge_base.search(query=query, limit=limit)
        return {"ok": True, "items": items, "error": None}
    except Exception as exc:
        return {"ok": False, "items": [], "error": str(exc)}
```

### Rules

- Do not return raw exceptions from tools.
- Do not expose secrets or internal stack traces in tool output.
- Do not let tools perform destructive actions without validation and explicit caller intent.
- Do not let tools silently coerce invalid inputs.
- Do not return free-form text when downstream nodes need structured fields.
- Use idempotency keys for tools that write data, send messages, create tickets, charge money, or mutate external systems.

---

## LLM Calls

### Required

- Keep prompts versioned, named, and testable.
- Use structured output for classification, routing, extraction, and validation.
- Set model parameters intentionally.
- Use low temperature for deterministic routing or extraction.
- Validate all LLM outputs before using them for routing, tool calls, or persistence.
- Keep LLM calls isolated in nodes or dedicated model wrappers.

### Rules

- Do not route directly from arbitrary natural-language model output.
- Do not trust LLM-generated JSON without parsing and validation.
- Do not place large prompt strings inline inside complex functions.
- Do not let prompts depend on hidden global state.
- Do not expose chain-of-thought. Ask for concise reasoning summaries or decision fields instead.
- Do not include secrets, credentials, private keys, or unnecessary PII in prompts.
- Prefer explicit schemas over prompt-only formatting instructions.
