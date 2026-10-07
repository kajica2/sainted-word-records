---
paths:
  - "**/src/**/redis_clients.py"
  - "**/src/**/redis_streams*.py"
  - "**/src/**/background/pubsub_*.py"
  - "**/src/**/background/stream_*.py"
  - "**/src/**/background/redis_*.py"
  - "**/src/**/background/run_reaper.py"
---

# Redis Streams & Pub/Sub — Streaming Transport Rules

Conventions for Redis Streams and Pub/Sub used in server→client streaming pipelines
(e.g., LangGraph run events forwarded to an SSE edge layer in a multi-pod environment).

## Topic Index

§1–§5, §8–§9 in this file. §6 Multi-Reader Pattern and §7 Reaper Pattern in
`db/redis-streams-consumers.md` (same `paths:` — auto-loads together).

---

## 1. Data-Plane vs Control-Plane Decision Rule

**[HARD]** Route traffic by plane before writing any code:

| Plane | Transport | Rationale |
|-------|-----------|-----------|
| Data plane — events, persistable output (tokens, tool calls, status) | Redis Streams (`XADD` / `XREAD`) | Durable, multi-reader, supports Last-Event-ID resume |
| Control plane — cancel signals, liveness pings | Redis Pub/Sub | Low-latency fire-and-forget; no durability needed |

Do not mix planes on a single key or channel. Do not use Pub/Sub for events that consumers
may miss during a brief reconnect. Do not use Streams for ephemeral control signals where
durability adds no value.

---

## 2. Dual ConnectionPool

**[HARD]** Two separate connection pools are required. Sharing a single pool across planes
introduces head-of-line blocking between high-throughput event writes and low-latency
cancel signals.

```python
# Illustrative
import redis.asyncio as aioredis

data_pool = aioredis.ConnectionPool.from_url(
    redis_url,
    max_connections=200,   # SSOT — do not override in other files
    decode_responses=True,
)

control_pool = aioredis.ConnectionPool.from_url(
    redis_url,
    max_connections=500,   # SSOT — do not override in other files
    decode_responses=True,
)

data_client = aioredis.Redis(connection_pool=data_pool)
control_client = aioredis.Redis(connection_pool=control_pool)
```

Rules:
- `data_client` handles all `XADD`, `XREAD`, `EXPIRE`, and stream management commands.
- `control_client` handles all `PUBLISH` and `SUBSCRIBE` commands.
- Pool sharing between planes is forbidden even when the same Redis instance is used.
- Pool sizes above are the defaults; scale up only with documented load justification.

---

## 3. Key and Channel Naming

Use a two-part prefix scheme that makes plane membership immediately visible in monitoring
and `redis-cli` inspection:

| Object | Pattern | Example |
|--------|---------|---------|
| Stream (data plane) | `stream:run:{run_id}` | `stream:run:550e8400-e29b-41d4-a716` |
| Control channel (control plane) | `control:run:{run_id}` | `control:run:550e8400-e29b-41d4-a716` |

Rules:
- `{run_id}` MUST be a stable, collision-resistant identifier (UUID v4 or equivalent).
- Do not embed mutable state (status, timestamp) in the key name.
- Do not abbreviate the `stream:` or `control:` prefix — partial matches in scans must be
  unambiguous.
- Namespace the prefix when multiple services share a Redis instance
  (e.g., `svc-a:stream:run:{run_id}`).

---

## 4. Numeric Defaults (SSOT)

**This file is the single authoritative source for all numeric defaults listed below.**
Other domain files (`ai/langgraph-streaming-transport.md`, `api/fastapi-sse.md`, etc.)
MUST cross-link here rather than re-stating these values. Any change to a value below
requires updating only this file.

| Parameter | Value | Applied At |
|-----------|-------|------------|
| Stream max length (`MAXLEN ~`) | **5 000** entries | Every `XADD` call |
| Stream TTL after terminal event (`EXPIRE`) | **1 800 s** (30 min) | Immediately after `__end__` or error event |
| SSE idle timeout (no new entries) | **600 s** (10 min) | SSE generator loop; see `api/fastapi-sse.md` |
| Data pool `max_connections` | **200** | `data_pool` constructor |
| Control pool `max_connections` | **500** | `control_pool` constructor |
| Heartbeat interval (recommended) | **15 s** | SSE generator loop; see `api/fastapi-sse.md` |

Notes:
- `MAXLEN ~` (approximate trimming) is used intentionally to reduce trimming overhead.
  Exact trimming (`MAXLEN` without `~`) is permitted only when deterministic bounded storage
  is required by an SLA.
- TTL of 1 800 s is a floor for well-behaved runs. Long-running executions should reset the
  TTL periodically via `EXPIRE` refreshes before the terminal event arrives.
- Idle timeout of 600 s governs SSE connection teardown — it is a transport concern, not a
  Redis concern. It is listed here as SSOT to keep all transport timing in one place.

---

## 5. Invariants

**[HARD]** The following two conditions MUST hold for every stream write path. Absence of
either is a PR-blocking finding during code review.

### 5.1 Every `XADD` carries MAXLEN

```python
# Illustrative
await data_client.xadd(
    f"stream:run:{run_id}",
    {"event": "token", "data": chunk},
    maxlen=5000,      # SSOT value from §4 — import as constant, do not inline literal
    approximate=True,
)
```

Do not call `XADD` without `maxlen`. Streams without a length cap grow unbounded and will
exhaust Redis memory under load.

### 5.2 `EXPIRE` is set after every terminal event

A terminal event is any event that ends the run: `__end__`, `error`, or a synthetic
reaper-generated terminal (see `db/redis-streams-consumers.md` §7).

```python
# Illustrative
STREAM_TTL_S = 1800  # import from central constants module, value defined in §4

async def publish_terminal_event(run_id: str, event_type: str, payload: dict) -> None:
    stream_key = f"stream:run:{run_id}"
    await data_client.xadd(
        stream_key,
        {"event": event_type, **payload},
        maxlen=5000,
        approximate=True,
    )
    # HARD: set TTL immediately after terminal event
    await data_client.expire(stream_key, STREAM_TTL_S)
```

Do not defer `EXPIRE` to a background job. Set it in the same async call sequence as
the terminal `XADD`. If the process crashes between them, the reaper
(`db/redis-streams-consumers.md` §7) handles eventual cleanup.

---

## 8. Anti-Patterns

```python
# Bad: shared pool for both planes — head-of-line blocking
shared_client = aioredis.Redis.from_url(redis_url)
await shared_client.xadd(stream_key, event_data)       # data plane
await shared_client.publish(control_channel, "cancel")  # control plane — wrong

# Bad: XADD without MAXLEN — stream grows unbounded
await data_client.xadd(stream_key, {"event": "token", "data": chunk})

# Bad: EXPIRE set in a fire-and-forget background task after terminal XADD
asyncio.create_task(set_expire_later(stream_key))  # crash window between XADD and EXPIRE

# Bad: in-memory queue as substitute for Redis Streams in multi-pod deployment
run_event_queues: dict[str, asyncio.Queue] = {}  # not visible to other pods

# Bad: hardcoding numeric defaults instead of importing from central constants
await data_client.xadd(stream_key, data, maxlen=10000)  # diverges from SSOT in §4

# Bad: sharing cursor state across SSE connections
shared_cursor = "0"
async def read(run_id):
    global shared_cursor  # wrong — each connection needs its own cursor
    ...
```

---

## 9. See Also

- `db/redis-streams-consumers.md` — §6 Multi-Reader Pattern + §7 Reaper Pattern.
- `ai/langgraph-streaming-transport.md` — LangGraph `astream` → wire event mapping,
  event publisher abstraction, cancel listener, run executor skeleton.
- `api/fastapi-sse.md` — SSE wire format, Last-Event-ID resume, heartbeat, idle timeout.
