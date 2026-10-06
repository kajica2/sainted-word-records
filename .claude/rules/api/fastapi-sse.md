---
paths:
  - "**/src/**/routers/run_*.py"
  - "**/src/**/routers/runs.py"
  - "**/src/**/routers/sse_*.py"
  - "**/src/**/routers/stream_*.py"
---

# FastAPI SSE Endpoint Rules

Conventions for Server-Sent Events endpoints that bridge a Redis Streams data plane to browser
clients. Endpoint responsibilities are strictly limited to: authentication, dispatch, and
`XREAD`-to-SSE conversion. All transport defaults (heartbeat interval, idle timeout, pool sizes,
`MAXLEN`) are authoritative in `db/redis-streams.md`.

**Split:** §1-8 in this file. §9-11 (dispatch, cancel, CORS) → `api/fastapi-sse-endpoints.md`.

---

## 1. SSE Wire Format

**[HARD]** Every SSE event sent to the client MUST include exactly three fields in this order:

```
id: <event-id>
event: <event-type>
data: <JSON-encoded payload>

```

- `id:` — the Redis stream entry ID (e.g., `1714500000000-0`). Enables `Last-Event-ID` resume.
- `event:` — a named event type recognized by the client (e.g., `token`, `tool_call`, `error`, `__end__`).
- `data:` — a JSON string. Single-line; escape newlines in the payload before writing.
- Each event is terminated by a blank line (`\n\n`).
- Do not omit any of the three fields, even when the payload is empty — use `data: {}`.

```python
# Illustrative
def format_sse_event(entry_id: str, event_type: str, payload: dict) -> str:
    data = json.dumps(payload, separators=(",", ":"))
    return f"id: {entry_id}\nevent: {event_type}\ndata: {data}\n\n"
```

---

## 2. Last-Event-ID Resume

**[HARD]** When a client reconnects with a `Last-Event-ID` header, use that value as the
exclusive start position for `XREAD`. Never re-read events the client has already acknowledged.

```python
# Illustrative
from fastapi import Request

def get_xread_start(request: Request) -> str:
    last_id = request.headers.get("last-event-id")
    # "$" means "only new entries from now" (initial connection)
    return last_id if last_id else "$"
```

- Pass the resolved start ID directly to `XREAD COUNT ... BLOCK ... STREAMS {stream_key} {start}`.
- Do not add `+` or other modifiers to the client-provided ID; pass it verbatim.
- If `Last-Event-ID` is `0-0` or empty, start from the beginning of the stream.

---

## 3. Heartbeat

**[HARD]** Send a comment-only heartbeat line at the interval defined in `db/redis-streams.md`:

```
: ping

```

- Use SSE comment syntax (leading `: `). Comments are not dispatched as events to `EventSource`
  listeners, but they keep the HTTP connection alive through proxies and load balancers.
- The heartbeat MUST be sent when `XREAD BLOCK` times out with no new entries (i.e., the
  `BLOCK` timeout equals the heartbeat interval).
- Do not use `event: ping` — that dispatches an unwanted DOM event to the browser.
- `HEARTBEAT = ": ping\n\n"`. Full generator example: see `api/fastapi-sse-endpoints.md`.
- Heartbeat interval default: see `db/redis-streams.md`.

---

## 4. Idle Timeout

When no events and no heartbeats have been exchanged for the idle duration defined in
`db/redis-streams.md`, the generator MUST emit an explicit error event and then close.

```python
# Illustrative
async def sse_generator_with_idle_timeout(stream_key: str, start_id: str):
    last_activity = time.monotonic()
    while True:
        entries = await xread_block(stream_key, start_id, block_ms=HEARTBEAT_INTERVAL_MS)
        now = time.monotonic()
        if not entries:
            if (now - last_activity) > IDLE_TIMEOUT_S:
                yield format_sse_event("0-0", "error", {"code": "idle_timeout"})
                return
            yield HEARTBEAT
            continue
        last_activity = now
        for entry_id, fields in entries:
            yield format_sse_event(entry_id, fields["event"], json.loads(fields["data"]))
            start_id = entry_id
            if fields["event"] == "__end__":
                return
```

- Always emit `event: error` with a `code` field before closing; do not close silently. Idle timeout default: see `db/redis-streams.md`.

---

## 5. Response Headers

Set the following headers on every SSE `StreamingResponse`:

```python
# Illustrative
from fastapi.responses import StreamingResponse

def make_sse_response(generator) -> StreamingResponse:
    return StreamingResponse(
        generator,
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",   # disables nginx buffering
            "Connection": "keep-alive",
        },
    )
```

| Header | Required Value | Purpose |
|--------|----------------|---------|
| `Cache-Control` | `no-cache` | Prevents proxy or browser caching of the event stream |
| `X-Accel-Buffering` | `no` | Disables nginx/Envoy response buffering |
| `Connection` | `keep-alive` | Signals persistent connection to HTTP/1.1 intermediaries |

---

## 6. No In-Process LangGraph Execution

**[HARD]** An SSE endpoint MUST NOT execute LangGraph graphs, invoke agents, or run any AI
inference in-process. SSE endpoint responsibilities are:

1. Authenticate the caller.
2. Verify the requested run exists and belongs to the caller.
3. Open a `XREAD BLOCK` loop on the Redis stream and convert entries to SSE events.

Any work that involves running AI models belongs in a separate background worker process. The
SSE endpoint is a pure relay. Violations turn edge pods into unpredictable long-running compute
nodes and break horizontal scaling.

```python
# Illustrative — correct pattern only
@router.get("/runs/{run_id}/stream")
async def stream_run(run_id: str, request: Request, user=Depends(get_current_user)):
    await authorize_run(user, run_id)
    start_id = get_xread_start(request)
    return make_sse_response(sse_generator(f"stream:run:{run_id}", start_id))
```

---

## 7. Terminal Event Handling

When the generator receives an event with `event: __end__`, it MUST `return` immediately.

```python
# Illustrative
for entry_id, fields in entries:
    yield format_sse_event(entry_id, fields["event"], json.loads(fields["data"]))
    start_id = entry_id
    if fields["event"] == "__end__":
        return   # close the generator; do not yield any further events
```

- Do not yield a synthetic close event after `__end__` — the terminal event itself is the signal.
- The browser `EventSource` fires `close` automatically when the server closes the connection.

## 8. After-TTL Fallback

When `XREAD` returns no stream (key expired or does not exist), attempt a single lookup in the
persistent run store to retrieve the terminal status, emit one final event, then close.

- Perform this check once per connection attempt; do not poll the persistent store.
- If the run record is also absent, emit `event: error` with `code: run_not_found` and close.
- Full illustrative example: see `api/fastapi-sse-endpoints.md`.

## See also

- `api/fastapi-sse-endpoints.md` — dispatch endpoint, cancel endpoint, CORS configuration; full heartbeat and after-TTL code examples
- `ai/langgraph-streaming-transport.md` — LangGraph event publishing, cancel listener, run executor patterns
- `db/redis-streams.md` — authoritative numeric defaults (heartbeat interval, idle timeout, MAXLEN, pool sizes), stream key naming, Pub/Sub control plane
- `api/fastapi-routing.md` — general FastAPI routing conventions and `StreamingResponse` usage
