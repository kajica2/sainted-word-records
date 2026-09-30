---
description: "LangGraph in-process streaming, checkpointing, and human-in-the-loop interrupt patterns"
paths: ["src/deepagents/**", "src/skills/**", "src/ai/**", "src/agents/**", "src/workflows/**", "src/graph/**", "**/agents/**/*.py", "**/graph/**/*.py", "**/runtime/**/*.py", "**/graphs/**/*.py", "langgraph.json"]
---

# LangGraph Streaming, Persistence & HITL

Covers: Streaming, Persistence/Checkpointing, Interrupts/HITL.

See `ai/langgraph.md` for the full topic index.

---

## Streaming

> **Layer note (defer):** This section covers in-process `astream` patterns only. Cross-pod transport (LangGraph → Redis → SSE → frontend, multi-pod K8s) is governed by `ai/langgraph-streaming-transport.md`. See also `db/redis-streams.md` (data/control plane SSOT) and `api/fastapi-sse.md` (SSE wire format).

### Required

- Use `stream` / `astream` for graph-level streaming.
- Use stream modes intentionally: `updates`, `messages`, `custom`, or combinations.
- Filter streamed chunks by type before handling them.
- Keep UI streaming logic outside core graph node logic.
- Handle partial tokens, node updates, interrupts, and final outputs separately.

### Recommended Pattern

```python
async for chunk in graph.astream(
    input_state,
    config=config,
    stream_mode=["messages", "updates"],
    version="v2",
):
    if chunk["type"] == "messages":
        message_chunk, metadata = chunk["data"]
        handle_token(message_chunk, metadata)

    elif chunk["type"] == "updates":
        handle_node_update(chunk["data"])
```

### Rules

- Do not assume every stream chunk is an LLM token.
- Do not mix token streaming with persistence handling in the same function.
- Do not emit sensitive state fields through custom streaming events.
- Use `subgraphs=True` when nested graph streaming or nested interrupt detection is required.
- Prefer `version="v2"` for new streaming code.

---

## Persistence, Checkpointing & Threads

### Required

- Use a checkpointer for workflows that need memory, retries, interrupts, human approval, or durable execution.
- Provide a stable `thread_id` in `config["configurable"]["thread_id"]` for persistent graph runs.
- Use durable checkpointers in production.
- Use in-memory checkpointers only for tests, local experiments, or short-lived demos.
- Keep checkpointed state serializable.
- Treat `thread_id` as the execution identity for a conversation or workflow instance.

### Recommended Pattern

```python
config = {"configurable": {"thread_id": conversation_id}}
result = graph.invoke(input_state, config=config)
```

### Rules

- Do not reuse the same `thread_id` across unrelated users, conversations, or workflow instances.
- Do not generate a new `thread_id` when resuming an interrupted workflow.
- Do not persist secrets in graph state or checkpoints.
- Do not rely on checkpointing to compensate for non-idempotent side effects.
- Use explicit state migrations when changing persisted state schemas.
- Keep state schema changes backward-compatible where existing checkpoints may still resume.

---

## Interrupts & Human-in-the-Loop

### Required

- Use `interrupt()` for human approval, human editing, or external input required mid-graph.
- Compile graphs that use interrupts with a checkpointer.
- Resume interrupts with `Command(resume=...)`.
- Resume with the same `thread_id`.
- Keep interrupt payloads JSON-serializable.
- Make code before `interrupt()` idempotent because the node may restart when resumed.

### Recommended Pattern

```python
from langgraph.types import interrupt, Command


def request_approval(state: AgentState) -> dict:
    approval = interrupt({
        "type": "approval_request",
        "message": "Approve sending this response?",
        "draft": state["draft_response"],
    })
    return {"approved": bool(approval)}


# Resume later:
graph.invoke(
    Command(resume=True),
    config={"configurable": {"thread_id": conversation_id}},
)
```

### Rules

- Do not wrap `interrupt()` calls in broad `try/except`.
- Do not conditionally skip interrupt calls in a way that changes their order between runs.
- Do not pass functions, class instances, database handles, or complex unserializable objects to `interrupt()`.
- Do not perform non-idempotent writes immediately before `interrupt()`.
- Prefer placing irreversible side effects after approval interrupts.
- For parallel interrupts, map resume values to the correct interrupt identifiers.
- Validate human-provided resume values before using them.

---
