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

# LangGraph Streaming Transport — Event Publisher

Covers: Event Publisher Abstract Pattern.

See `ai/langgraph-streaming-transport.md` for the full topic index and HARD rules.

---

## 4. Event Publisher Abstract Pattern

The publisher is responsible for accepting a typed wire event and writing it to the data-plane
stream. Numeric defaults (MAXLEN, TTL, pool sizes, idle timeout) are defined in
`db/redis-streams.md` (SSOT) — cross-link there; do not duplicate them here.

```python
# Illustrative — adapt to your stack
from __future__ import annotations

import json
from typing import Any


class EventPublisher:
    """Publishes wire events to the data-plane stream for a single run."""

    def __init__(self, run_id: str, stream_client: Any) -> None:
        # Illustrative — stream_client wraps a Redis Streams connection
        self._run_id = run_id
        self._client = stream_client

    async def publish(self, event: str, data: dict[str, Any]) -> None:
        """Write one wire event to the data-plane stream.

        MAXLEN and stream key naming follow db/redis-streams.md.
        """
        payload = {
            "run_id": self._run_id,
            "event": event,
            "data": json.dumps(data),
        }
        await self._client.xadd_with_maxlen(
            key=f"stream:run:{self._run_id}",
            fields=payload,
            # maxlen value — see db/redis-streams.md (SSOT)
        )

    async def set_expiry(self) -> None:
        """Apply TTL to the stream key after the run terminates.

        TTL value — see db/redis-streams.md (SSOT).
        """
        await self._client.expire(
            key=f"stream:run:{self._run_id}",
            # seconds — see db/redis-streams.md (SSOT)
        )
```

### Rules

- The publisher MUST NOT contain graph execution logic. Its sole responsibility is I/O.
- Apply MAXLEN on every `XADD` call. Apply EXPIRE after the terminal `__end__` event.
- Use the stream key naming convention from `db/redis-streams.md`:
  `stream:run:{run_id}` for data, `control:run:{run_id}` for cancel signals.

---

## See Also

- `ai/langgraph-streaming-transport.md` — Mother: Layer Note, Scope, Chunk → Wire Event
  Mapping table, Quick Reference HARD rules, Anti-Patterns, See Also.
- `ai/langgraph-streaming-transport-runtime.md` — Cancel Listener, Run Executor Skeleton,
  Internal HTTP Dispatch Pattern.
- `db/redis-streams.md` — SSOT for numeric defaults: MAXLEN, TTL, dual connection pool,
  key naming, Reaper pattern.
