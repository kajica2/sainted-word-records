---
paths:
  - "**/src/**/routers/run_*.py"
  - "**/src/**/routers/runs.py"
  - "**/src/**/routers/sse_*.py"
  - "**/src/**/routers/stream_*.py"
---

# FastAPI SSE Endpoint Rules — Dispatch, Cancel & CORS

Covers §9 Dispatch Endpoint Pattern, §10 Cancel Endpoint, §11 CORS Configuration, plus
full illustrative code examples deferred from the mother file.

See `api/fastapi-sse.md` for §1-8 (wire format, resume, heartbeat, idle timeout, headers,
no in-process LangGraph, terminal events, after-TTL fallback).

---

## Full Heartbeat Generator (illustrative reference)

Complete example of a heartbeat generator loop referenced in §3 of the mother file:

```python
# Illustrative
HEARTBEAT = ": ping\n\n"

async def sse_generator(stream_key: str, start_id: str):
    while True:
        entries = await xread_block(stream_key, start_id, block_ms=HEARTBEAT_INTERVAL_MS)
        if not entries:
            yield HEARTBEAT
            continue
        for entry_id, fields in entries:
            yield format_sse_event(entry_id, fields["event"], json.loads(fields["data"]))
            start_id = entry_id
            if fields["event"] == "__end__":
                return
```

Heartbeat interval default: see `db/redis-streams.md`.

---

## Full After-TTL Fallback Generator (illustrative reference)

Complete example for the after-TTL fallback referenced in §8 of the mother file:

```python
# Illustrative
async def sse_generator_with_fallback(stream_key: str, start_id: str, run_id: str):
    exists = await redis_client.exists(stream_key)
    if not exists:
        terminal = await run_store.get_terminal_status(run_id)
        if terminal:
            yield format_sse_event("0-0", terminal["event"], terminal["payload"])
        else:
            yield format_sse_event("0-0", "error", {"code": "run_not_found"})
        return
    async for event in sse_generator(stream_key, start_id):
        yield event
```

---

## 9. Dispatch Endpoint Pattern

`POST /api/runs` is the entry point for starting a new run. It MUST:

1. Authenticate the caller.
2. Validate the request body (run parameters, input payload).
3. Insert a run record in the persistent store with status `PENDING`.
4. Dispatch the run to the background worker (e.g., via a task queue, message broker, or
   internal HTTP call to the AI service).
5. Return HTTP `202 Accepted` with the run ID — do not wait for the run to complete.

```python
# Illustrative
from fastapi import APIRouter, Depends, status
from fastapi.responses import JSONResponse

router = APIRouter()

@router.post("/runs", status_code=status.HTTP_202_ACCEPTED)
async def create_run(
    body: RunRequest,
    user=Depends(get_current_user),
) -> JSONResponse:
    run_id = await run_store.create(user_id=user.id, params=body.params)
    await dispatch_run(run_id, body.input)
    return JSONResponse({"run_id": run_id}, status_code=202)
```

- Never return `200 OK` from a dispatch endpoint; `202` communicates that processing is async.
- The run ID returned here is what the client passes to the SSE endpoint.

---

## 10. Cancel Endpoint

`POST /api/runs/{run_id}/cancel` MUST publish a cancel signal to the Pub/Sub control channel
exactly once. Publishing is idempotent — repeated cancel requests are safe.

```python
# Illustrative
@router.post("/runs/{run_id}/cancel", status_code=status.HTTP_202_ACCEPTED)
async def cancel_run(
    run_id: str,
    user=Depends(get_current_user),
) -> JSONResponse:
    await authorize_run(user, run_id)
    await pubsub_client.publish(f"control:run:{run_id}", "cancel")
    return JSONResponse({"status": "cancel_requested"}, status_code=202)
```

- Do not wait for the worker to acknowledge the cancel before responding.
- The worker is responsible for listening on `control:run:{run_id}` and stopping gracefully.
- Channel naming convention is authoritative in `db/redis-streams.md`.

---

## 11. CORS Configuration

SSE endpoints are cross-origin by design when the frontend is on a different origin.

```python
# Illustrative
from fastapi.middleware.cors import CORSMiddleware

app.add_middleware(
    CORSMiddleware,
    allow_origins=["https://app.example.com"],   # replace with actual frontend origin(s)
    allow_credentials=True,
    allow_methods=["GET", "POST"],
    allow_headers=["Authorization", "Content-Type", "Last-Event-ID"],
)
```

Requirements:

| Setting | Required Value | Reason |
|---------|----------------|--------|
| `allow_credentials` | `True` | Enables cookies and `Authorization` headers on cross-origin requests |
| `Last-Event-ID` in `allow_headers` | Required | Browser sends this header on reconnect; blocked by default CORS policy |
| `allow_origins` | Explicit list | Never use `"*"` when `allow_credentials=True` |

---

## See also

- `api/fastapi-sse.md` — mother file: wire format, Last-Event-ID resume, heartbeat, idle timeout, response headers, no in-process LangGraph, terminal events, after-TTL fallback
- `db/redis-streams.md` — authoritative numeric defaults (heartbeat interval, idle timeout, MAXLEN, pool sizes), stream key naming, Pub/Sub control plane
- `ai/langgraph-streaming-transport.md` — LangGraph event publishing, cancel listener, run executor patterns
