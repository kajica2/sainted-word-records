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

# LangGraph Streaming Transport — Runtime

Covers: Cancel Listener, Run Executor Skeleton, Internal HTTP Dispatch Pattern.

See `ai/langgraph-streaming-transport.md` for the full topic index and HARD rules.

---

## 5. Cancel Listener

**[HARD]** The cancel listener MUST be a dedicated `asyncio.Task`. It MUST have its own
`try/except` block. Never inline cancel handling inside the main execution loop.

```python
# Illustrative — adapt to your stack
import asyncio
from typing import Any


async def _listen_for_cancel(run_id: str, control_client: Any) -> bool:
    """Subscribe to the control channel and return True when cancel arrives.

    Uses a dedicated connection from the control pool (see db/redis-streams.md).
    """
    try:
        async with control_client.subscribe(f"control:run:{run_id}") as channel:
            async for message in channel:
                if message.get("signal") == "cancel":
                    return True
    except asyncio.CancelledError:
        # Task was cancelled externally — treat as normal shutdown
        return False
    except Exception:
        # Log and treat as no-cancel to avoid blocking the executor
        return False
    return False


def start_cancel_listener(run_id: str, control_client: Any) -> asyncio.Task[bool]:
    """Spawn the cancel listener as an independent asyncio task."""
    return asyncio.create_task(
        _listen_for_cancel(run_id, control_client),
        name=f"cancel-listener:{run_id}",
    )
```

### Rules

- **[HARD]** Never `await` the cancel task inline inside the streaming loop. Check via
  `cancel_task.done()` or use `asyncio.wait` with `FIRST_COMPLETED`.
- **[HARD]** Always cancel and await the listener task in the `finally` block of the run
  executor (see §6) to prevent task leaks.
- The cancel listener uses the **control pool** (Pub/Sub connection), not the data pool.
  See `db/redis-streams.md` for dual-pool requirements.

---

## 6. Run Executor Skeleton

The run executor drives `graph.astream`, publishes events, and guarantees terminal event
emission via `try/finally`.

```python
# Illustrative — adapt to your stack
import asyncio
from typing import Any


async def execute_run(
    run_id: str,
    graph: Any,          # Compiled LangGraph graph
    input_state: dict,
    publisher: Any,      # EventPublisher (§4 in publisher split)
    control_client: Any, # Control-plane Redis client
) -> None:
    """Execute a run, publish events, and guarantee __end__ emission."""
    cancel_task = start_cancel_listener(run_id, control_client)

    try:
        async for chunk in graph.astream(
            input_state,
            stream_mode=["messages", "updates"],
            version="v2",
        ):
            # Check for cancel signal before processing each chunk
            if cancel_task.done() and cancel_task.result():
                await publisher.publish("error", {"message": "run cancelled", "node": ""})
                return

            wire_event, data = _map_chunk_to_wire_event(chunk)
            if wire_event:
                await publisher.publish(wire_event, data)

    except Exception as exc:
        await publisher.publish("error", {"message": str(exc), "node": ""})
        raise
    finally:
        # Guarantee terminal event and TTL regardless of success or failure
        await publisher.publish("__end__", {"run_id": run_id})
        await publisher.set_expiry()

        # Clean up cancel listener to prevent task leak
        cancel_task.cancel()
        try:
            await cancel_task
        except asyncio.CancelledError:
            pass
```

### Rules

- **[HARD]** `__end__` MUST be emitted in the `finally` block, not only on the happy path.
- **[HARD]** `set_expiry()` MUST be called in the same `finally` block, after `__end__`.
- If cancel is detected, emit an `error` event before returning so SSE consumers can close
  cleanly. Do not swallow the cancellation without notifying consumers.

---

## 7. Internal HTTP Dispatch Pattern

The HTTP dispatch endpoint receives an authenticated run-creation request, persists the run
record, and offloads execution to a background task. It does **not** execute the graph
in-process.

```python
# Illustrative — adapt to your stack
from fastapi import BackgroundTasks
from typing import Any


async def dispatch_run(
    run_id: str,
    input_state: dict,
    run_store: Any,           # RunStore — persists run metadata
    background_tasks: BackgroundTasks,
    executor_factory: Any,    # Callable that produces an execute_run coroutine
) -> dict:
    """Persist the run and enqueue background execution. Returns 202."""
    await run_store.insert(run_id=run_id, status="QUEUED", input=input_state)

    background_tasks.add_task(
        executor_factory(run_id, input_state)
    )

    return {"run_id": run_id, "status": "QUEUED"}
```

### Rules

- The dispatch endpoint MUST respond `202 Accepted` before graph execution begins.
- The dispatch endpoint MUST NOT start `graph.astream` in the request handler coroutine.
- `BackgroundTasks` (or equivalent task queue) is the correct handoff mechanism from the HTTP
  layer to the execution layer.
- If the background task fails before emitting `__end__`, the Reaper pattern (see
  `db/redis-streams.md`) is responsible for synthesizing a terminal event.

---

## See Also

- `ai/langgraph-streaming-transport.md` — Mother: Layer Note, Scope, Chunk → Wire Event
  Mapping table, Quick Reference HARD rules, Anti-Patterns, See Also.
- `ai/langgraph-streaming-transport-publisher.md` — Event Publisher Abstract Pattern.
- `api/fastapi-sse.md` — SSE wire format, Last-Event-ID resume, heartbeat contract,
  in-process execution prohibition.
- `db/redis-streams.md` — SSOT for numeric defaults, dual-pool requirements, Reaper pattern.
