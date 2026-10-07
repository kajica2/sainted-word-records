---
description: "LangGraph Fundamentals"
paths: ["src/deepagents/**", "src/skills/**", "src/ai/**", "src/agents/**", "src/workflows/**", "src/graph/**", "**/agents/**/*.py", "**/graph/**/*.py", "**/runtime/**/*.py", "**/graphs/**/*.py", "langgraph.json"]
---

# LangGraph Fundamentals

Covers: Core Principles, State Schema, Graph Construction, Node Design.

See `ai/langgraph.md` for the full topic index.

---

## Core Principles

- Treat every LangGraph workflow as a deterministic state machine.
- Keep graph state minimal, serializable, and easy to inspect.
- Separate state mutation, routing, tool execution, and LLM prompting.
- Prefer explicit node and edge names over generic names like `step`, `handler`, or `process`.
- Avoid hidden side effects inside nodes unless they are idempotent and logged.
- Design every graph so it can be tested node-by-node and resumed from checkpoints.
- Do not introduce new agent behavior without tests for the graph path, routing decision, or tool contract.

---

## State Schema

### Required

- Define graph state with `TypedDict` unless runtime validation is explicitly needed.
- Use `Pydantic` models only when validation, parsing, or external API boundaries require them.
- Annotate every state field with a precise type.
- Use `Annotated[..., reducer]` for fields that accumulate values.
- Use `add_messages` for chat message history.
- Keep state fields stable and intentionally named.
- Document non-obvious fields with short comments.

### Recommended State Pattern

```python
from typing import Annotated
from typing_extensions import TypedDict
from langgraph.graph.message import add_messages
from langchain_core.messages import BaseMessage


class AgentState(TypedDict):
    messages: Annotated[list[BaseMessage], add_messages]
    user_id: str
    intent: str | None
    draft_response: str | None
    error: str | None
```

### Rules

- Do not store large raw documents, full API payloads, or unbounded logs in graph state.
- Do not store secrets, API keys, access tokens, credentials, or raw PII in graph state.
- Do not use vague state keys such as `data`, `result`, `context`, or `payload` unless they are strongly typed and documented.
- Do not mutate state in place. Return partial state updates from nodes.
- Do not return the full state unless the node intentionally updates every field.
- Keep accumulated fields append-only unless there is a clear reducer or overwrite strategy.
- Use explicit `None` for unknown values instead of missing keys when downstream nodes depend on the field.

---

## Graph Construction

### Required

- Build graphs with `StateGraph(StateType)`.
- Add nodes with descriptive snake_case names.
- Add `START` and `END` edges explicitly.
- Compile the graph before exporting or invoking it.
- Keep graph construction in a dedicated factory function such as `build_agent_graph()` or `create_workflow_graph()`.
- Return the compiled graph from the factory unless tests need access to the uncompiled builder.

### Recommended Pattern

```python
from langgraph.graph import StateGraph, START, END


def build_agent_graph():
    graph = StateGraph(AgentState)

    graph.add_node("classify_intent", classify_intent)
    graph.add_node("retrieve_context", retrieve_context)
    graph.add_node("generate_response", generate_response)

    graph.add_edge(START, "classify_intent")
    graph.add_conditional_edges(
        "classify_intent",
        route_after_intent,
        {
            "retrieve_context": "retrieve_context",
            "generate_response": "generate_response",
            "end": END,
        },
    )
    graph.add_edge("retrieve_context", "generate_response")
    graph.add_edge("generate_response", END)

    return graph.compile()
```

### Rules

- Do not construct graphs at import time if they require runtime dependencies.
- Do not hide graph wiring inside unrelated service classes.
- Do not use anonymous lambdas for production nodes.
- Do not add static edges from a node that also returns `Command(goto=...)` unless both destinations must run.
- Prefer one graph factory per workflow.
- Keep graph topology readable enough that a reviewer can understand the flow without running the code.

---

## Node Design

### Required

- Each node must be a small function that accepts `state` and returns a partial state update.
- Node names must describe business intent, not implementation detail.
- Each node should have one responsibility.
- Nodes must be easy to unit test independently.
- Nodes that call LLMs, tools, databases, or external APIs must make that dependency explicit.
- Nodes must return dictionaries with only the fields they update.
- Nodes must not silently swallow errors.

### Good Node Names

- `classify_intent`
- `retrieve_user_profile`
- `generate_answer`
- `validate_tool_result`
- `request_human_approval`
- `summarize_conversation`
- `route_after_tool_call`

### Bad Node Names

- `process`, `run`, `handler`, `agent`, `step1`, `llm`, `do_work`

### Recommended Pattern

```python
def classify_intent(state: AgentState) -> dict:
    """Classify the user's current intent from the message history."""
    messages = state["messages"]

    intent = intent_classifier.invoke({"messages": messages})

    return {
        "intent": intent,
        "error": None,
    }
```

### Rules

- Do not mutate `state["messages"]` or other state fields in place.
- Do not mix routing decisions with heavy business logic unless returning `Command` is necessary.
- Do not perform multiple unrelated external calls in one node.
- Do not bury prompt templates inside complex node logic.
- Do not create global mutable state inside node modules.
- Do not make nodes depend on implicit environment variables without validation at graph creation time.
- Avoid side effects before interrupts. If unavoidable, make them idempotent.
