---
name: omb-langgraph-streaming-transport
description: "LangGraph backend-to-frontend SSE streaming in multi-pod K8s (no-sticky). Redis Streams (data plane), Pub/Sub (control plane), dual pools, Last-Event-ID resume, heartbeat, cancel listener. In-process astream/HITL/persistence: see omb-langgraph hub."
---

# LangGraph Streaming Transport — Quick Reference

## Usage Contract

**Task type:** Apply the domain guidance below to the caller's active task; this skill is a reference, not an independent workflow.

**Required input:** A concrete question, design, file, diff, or implementation decision within this skill's domain.

**Do:**
- Select only the relevant rules, reconcile them with repository-specific instructions, and cite concrete evidence when evaluating existing work.
- State assumptions and applicability limits when the available context is incomplete.

**Don't:**
- Do not invent repository facts, tool results, versions, or requirements.
- Do not apply examples mechanically when the project's source of truth conflicts with them.

**Completion:** Return actionable guidance or a checked result in the caller's requested format; identify any unresolved evidence gap explicitly.

This skill points to the five rule files that govern cross-pod streaming. Load the rule that matches the layer you are touching. Numeric defaults are owned by `db/redis-streams.md` (SSOT) — never hard-code them elsewhere.

## When to invoke

- Designing or reviewing a LangGraph backend → frontend live event stream.
- Multi-pod K8s deployment with no sticky sessions.
- Redis available as the cross-pod transport.
- Server-to-client SSE (unidirectional).

## When NOT to invoke

- In-process `astream` only, single process — use `ai/langgraph-streaming-hitl.md`.
- Bidirectional WebSocket protocol — out of scope.
- React Server Components `<Suspense>` initial-render streaming — different primitive.
- Non-Redis broker (NATS/Kafka/in-memory) — equivalent patterns possible; adopt the same data/control-plane semantics.

## HARD rules (14)

1. **Data plane** = Redis Streams (durable, replayable). **Control plane** = Pub/Sub (live, ephemeral). Do not invert.
2. **Dual ConnectionPool** — separate `data_pool` and `control_pool`. Sharing forbidden.
3. Every `XADD` carries `MAXLEN`. Missing MAXLEN = PR-blocking.
4. After the terminal event, set `EXPIRE` on the stream key. Missing EXPIRE = PR-blocking.
5. **Cancel listener** runs as a dedicated `asyncio.create_task` with its own try/except. Never inline inside the run loop.
6. **Run executor** wraps execution in try/finally to guarantee a terminal event (`__end__` or error) is published.
7. **SSE wire format**: every frame carries `id:`, `event:`, `data:`. All three. Always.
8. **Last-Event-ID** header drives `XREAD BLOCK` resume. Required for reconnect correctness.
9. **Heartbeat** as `: ping\n\n` comment frames. Interval default in `db/redis-streams.md`.
10. **No in-process LangGraph** inside SSE handlers. SSE endpoint = auth + dispatch + `XREAD`-to-SSE only.
11. **No SSE proxy through Next.js Route Handlers.** EventSource connects directly to the backend.
12. **No sticky sessions.** Reconnect must succeed against any edge pod.
13. Numeric defaults (MAXLEN, EXPIRE, idle timeout, pool sizes) live in `db/redis-streams.md`. Other files cross-link.
14. Code examples in rule files are `# Illustrative` only. Generic identifiers (`{run_id}`, `RunStore`, `Agent`).

## Decision table

| Question | Answer |
|----------|--------|
| Where do tokens / tool events go? | Redis Streams (data plane) |
| Where do cancel signals go? | Pub/Sub (control plane) |
| What header drives SSE resume? | `Last-Event-ID` |
| Where is heartbeat sent? | SSE endpoint (`: ping\n\n`) |
| What handles `__end__`? | Generator returns; SSE closes |
| What if stream TTL expired? | Fallback to persistent store, return terminal once, close |
| Where do numeric defaults live? | `db/redis-streams.md` (SSOT) |
| Can SSE handler run LangGraph? | No. Dispatch only. |
| Can EventSource go through Next.js? | No. Direct to backend. |

## Anti-patterns

- Sharing one Redis pool for data and control planes (head-of-line blocking).
- `XADD` without `MAXLEN` (unbounded stream growth).
- Cancel listener inline inside the run loop (cancel never delivered during long graph nodes).
- SSE handler calling `agent.astream(...)` directly (couples HTTP edge to graph runtime; breaks no-sticky).
- Proxying SSE through Next.js Route Handlers (buffering, cold-start, broken `Last-Event-ID` propagation).
- EventSource with custom `Authorization` header (browser API does not allow it — use credentialed cookies).
- Hard-coding MAXLEN / TTL / idle timeout outside `db/redis-streams.md`.

## References

- `.claude/rules/ai/langgraph-streaming-transport.md` (mother) + `-publisher.md` + `-runtime.md` — chunk-to-wire mapping, event publisher, cancel listener, run executor
- `.claude/rules/db/redis-streams.md` (mother / SSOT) + `redis-streams-consumers.md` — Streams + Pub/Sub contract, dual pools, numeric defaults, multi-reader + reaper
- `.claude/rules/api/fastapi-sse.md` (mother) + `fastapi-sse-endpoints.md` — SSE wire format, Last-Event-ID, heartbeat, dispatcher and cancel endpoints
- `.claude/rules/infra/kubernetes.md` — runtime/edge separation, no-sticky, ingress timeout, preStop, HPA
- `.claude/rules/ui/nextjs.md` + `.claude/rules/ui/react.md` — EventSource direct connection + reusable hook
- `.claude/rules/ai/langgraph-streaming-hitl.md` — in-process layer (deferred from this skill)
