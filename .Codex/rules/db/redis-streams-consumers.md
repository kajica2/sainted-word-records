---
paths:
  - "**/src/**/redis_clients.py"
  - "**/src/**/redis_streams*.py"
  - "**/src/**/background/pubsub_*.py"
  - "**/src/**/background/stream_*.py"
  - "**/src/**/background/redis_*.py"
  - "**/src/**/background/run_reaper.py"
---

# Redis Streams — Consumer Patterns

Consumer-side patterns for Redis Streams in server→client streaming pipelines.

**Numeric defaults (MAXLEN, EXPIRE, idle timeout, pool sizes, heartbeat) are defined
exclusively in `db/redis-streams.md` §4.** Do not re-state or override them here.

---

## 6. Multi-Reader Pattern

Redis Streams support multiple independent consumers reading from the same stream with
no coordination. Each consumer maintains its own last-seen entry ID.

```python
# Illustrative — independent SSE connection reading the same stream
async def read_stream_from(
    run_id: str,
    last_id: str = "0",
) -> AsyncIterator[dict]:
    stream_key = f"stream:run:{run_id}"
    current_id = last_id
    while True:
        entries = await data_client.xread(
            {stream_key: current_id},
            count=50,
            block=5000,  # ms; tune per latency requirement
        )
        if not entries:
            continue
        for _, records in entries:
            for entry_id, fields in records:
                current_id = entry_id
                yield fields
```

Rules:
- Do not use Consumer Groups unless ordered, at-most-once delivery is required. Plain
  `XREAD` is simpler and correct for broadcast streaming.
- Each SSE connection owns its own `current_id` cursor — never share cursor state across
  connections.
- Resume after reconnect by passing the `Last-Event-ID` header value as `last_id`; see
  `api/fastapi-sse.md` for the SSE layer contract.

---

## 7. Reaper Pattern

A background reaper detects stalled runs and emits a synthetic terminal event so that
waiting consumers are not blocked indefinitely.

Detection logic:

1. Query persistent storage for runs with status `RUNNING`.
2. For each such run, check the stream's last entry timestamp via `XINFO STREAM`.
3. If the elapsed time since the last entry exceeds the idle timeout (see
   `db/redis-streams.md` §4), the run is considered stalled.

Recovery action:

```python
# Illustrative
async def reap_stalled_run(run_id: str) -> None:
    """Emit a synthetic error terminal event for a stalled run."""
    await publish_terminal_event(
        run_id=run_id,
        event_type="error",
        payload={"reason": "run_timed_out", "synthetic": "true"},
    )
    # Optionally update persistent storage status to FAILED
```

Rules:
- The reaper MUST use `publish_terminal_event` (see `db/redis-streams.md` §5.2) — never
  write raw `XADD` without the invariants (MAXLEN + EXPIRE).
- Run the reaper on a schedule shorter than the idle timeout to bound consumer wait time.
- Reaper logic belongs in a dedicated module (e.g., `background/run_reaper.py`), not
  inline with the event publisher.
- The reaper is an availability mechanism — it does not replace proper cancellation via
  the control plane (see `db/redis-streams.md` §1).

---

## See Also

- `db/redis-streams.md` — mother file: data/control plane decision rule, dual
  ConnectionPool, key naming, numeric defaults SSOT (§4), XADD/EXPIRE invariants (§5),
  anti-patterns (§8).
- `api/fastapi-sse.md` — SSE wire format, Last-Event-ID resume, heartbeat, idle timeout.
- `ai/langgraph-streaming-transport.md` — LangGraph `astream` → wire event mapping,
  cancel listener, run executor skeleton.
