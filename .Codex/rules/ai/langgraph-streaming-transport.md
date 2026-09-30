---
paths:
  - "**/src/**/runtime/run_*.py"
  - "**/src/**/runtime/event_*.py"
  - "**/src/**/runtime/cancel_*.py"
  - "**/src/**/runtime/runtime_*.py"
  - "**/src/**/agents/**/run_executor.py"
  - "**/src/**/agents/**/event_publisher.py"
  - "**/src/**/langgraph/**/stream*.py"
---

# LangGraph Cross-Pod Streaming Transport

## Topic Index

| Topic | File |
|-------|------|
| Event Publisher Abstract Pattern | `ai/langgraph-streaming-transport-publisher.md` |
| Cancel Listener, Run Executor Skeleton, Internal HTTP Dispatch Pattern | `ai/langgraph-streaming-transport-runtime.md` |

---

## 1. Layer Note

This file governs **cross-pod transport** only: how a LangGraph runtime publishes events to a
message broker and how a cancel signal travels back.

In-process `astream` patterns (stream modes, chunk filtering, HITL, subgraph streaming) are
governed by `ai/langgraph-streaming-hitl.md`. Do not duplicate that guidance here.

---

## 2. Scope / When NOT to Apply

**In scope:** server-to-client unidirectional streaming via SSE, brokered through Redis Streams
(data plane) and Redis Pub/Sub (control plane), in a multi-pod deployment.

**Out of scope — separate models:**

- **Bidirectional WebSocket** — distinct protocol; this rule does not govern it.
- **React Server Components `<Suspense>`** — Next.js 14+ in-process primitive; handled by
  `ui/nextjs.md`.
- **Non-Redis brokers (NATS, Kafka, in-memory)** — equivalent patterns are possible. Adopt this
  rule's semantics (data plane vs. control plane, MAXLEN+TTL equivalents) but defer to your
  broker's documentation for implementation specifics.

---

## 3. LangGraph `astream` Chunk → Wire Event Mapping

Each chunk produced by `graph.astream(...)` maps to a typed wire event before being published
to the data-plane stream. The table below defines the canonical mapping.

| `astream` chunk type | Wire `event` field | `data` payload shape |
|----------------------|--------------------|----------------------|
| `messages` — partial token | `token` | `{"content": "<str>", "node": "<str>"}` |
| `updates` — tool invocation request | `tool_call` | `{"name": "<str>", "args": {…}}` |
| `updates` — tool result message | `tool_result` | `{"name": "<str>", "output": {…}}` |
| `updates` — node state delta | `graph_node` | `{"node": "<str>", "delta": {…}}` |
| `updates` — error field set in state | `error` | `{"message": "<str>", "node": "<str>"}` |
| sentinel: run finished | `__end__` | `{"run_id": "{run_id}"}` |

---

## Quick Reference — HARD Rules

- **[HARD]** Every published event MUST include a string `run_id` field and a string `event`
  field matching one of the types above (or a registered extension type).
- **[HARD]** The `__end__` sentinel MUST be emitted exactly once per run, even on error. Use
  `try/finally` to guarantee emission (see `ai/langgraph-streaming-transport-runtime.md` §6).
- **[HARD]** The cancel listener MUST be a dedicated `asyncio.Task` with its own `try/except`.
  Never inline cancel handling inside the main execution loop.
- **[HARD]** Never `await` the cancel task inline inside the streaming loop. Check via
  `cancel_task.done()` or use `asyncio.wait` with `FIRST_COMPLETED`.
- **[HARD]** `__end__` MUST be emitted in the `finally` block, not only on the happy path.
- **[HARD]** `set_expiry()` MUST be called in the same `finally` block, after `__end__`.
- Filter `astream` chunks by type before constructing wire events. Do not forward raw chunk
  objects to the broker.

---

## Anti-Patterns

```python
# Bad: cancel listener inlined in the streaming loop
async for chunk in graph.astream(input_state):
    msg = await redis.subscribe(f"control:run:{run_id}")  # blocks loop
    if msg == "cancel":
        break

# Bad: __end__ only on the happy path
async for chunk in graph.astream(input_state):
    await publisher.publish(event, data)
await publisher.publish("__end__", {"run_id": run_id})  # skipped on exception

# Bad: graph.astream called inside the SSE request handler
@router.get("/runs/{run_id}/stream")
async def stream_run(run_id: str):
    async def generate():
        async for chunk in graph.astream(...):  # in-process execution — forbidden
            yield f"data: {chunk}\n\n"
    return StreamingResponse(generate())

# Bad: single shared Redis pool for both data and control planes
shared_pool = ConnectionPool(max_connections=...)  # mixing data + control — use dual pools
```

---

## 8. See Also

- `db/redis-streams.md` — Data-plane streams vs. control-plane Pub/Sub decision rule, dual
  connection pools, stream key naming, MAXLEN+EXPIRE invariants, Reaper pattern. **This is the
  SSOT for all numeric defaults referenced by this file.**
- `api/fastapi-sse.md` — SSE wire format, Last-Event-ID resume, heartbeat contract, in-process
  execution prohibition.
- `ai/langgraph-streaming-hitl.md` — In-process `astream` layer: stream modes, chunk filtering,
  HITL interrupts, subgraph streaming.
- `ai/langgraph-streaming-transport-publisher.md` — Event Publisher Abstract Pattern (full).
- `ai/langgraph-streaming-transport-runtime.md` — Cancel Listener, Run Executor Skeleton,
  Internal HTTP Dispatch Pattern.
