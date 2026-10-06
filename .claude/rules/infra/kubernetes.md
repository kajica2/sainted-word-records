---
paths: ["k8s/**", "kubernetes/**", "helm/**", "manifests/**"]
---

# Kubernetes Conventions

## Resource Limits
- ALWAYS set `resources.requests` and `resources.limits` for CPU and memory
- Requests = expected usage, Limits = maximum allowed
- Start conservative and adjust based on metrics
- Use `LimitRange` and `ResourceQuota` at namespace level

## Security Contexts
- `runAsNonRoot: true` — never run containers as root
- `readOnlyRootFilesystem: true` — mount writable dirs explicitly
- `allowPrivilegeEscalation: false`
- Drop all capabilities, add only what is needed: `drop: ["ALL"]`

## Network Policies
- Default deny all ingress and egress per namespace
- Explicitly allow required traffic with NetworkPolicy rules
- Label pods consistently for policy selectors

## Health Probes
- `livenessProbe`: restarts container if unhealthy (use for deadlock detection)
- `readinessProbe`: removes from service if not ready (use for startup/dependencies)
- `startupProbe`: for slow-starting containers to avoid premature restarts
- Set `initialDelaySeconds`, `periodSeconds`, `failureThreshold` appropriately

## Rollout Strategy
- Use `RollingUpdate` with `maxSurge: 1` and `maxUnavailable: 0` for zero-downtime
- Set `minReadySeconds` to avoid marking pods ready too early
- Use `PodDisruptionBudget` for high-availability workloads

## RBAC
- Principle of least privilege — grant only what is needed
- Use `Role` for namespace-scoped, `ClusterRole` for cluster-scoped
- Bind service accounts to roles, not users
- Audit RBAC bindings periodically

## Streaming Workloads (SSE + Redis Transport)

For multi-pod deployments serving Server-Sent Events backed by Redis Streams (e.g., LangGraph runs streamed to a Next.js/React frontend):

- **Separate runtime and edge deployments.** Long-running graph execution belongs in a `runtime` Deployment; SSE-facing HTTP belongs in an `edge` Deployment. Different scaling profiles, different probes.
- **No sticky sessions.** SSE consumers reconnect to any edge pod and resume via `Last-Event-ID` against the shared Redis Stream. Configure the Service with default routing — never enable session affinity for SSE traffic.
- **Ingress timeouts.** Raise `proxy-read-timeout` / equivalent above the SSE idle timeout (defined in `db/redis-streams.md`) plus the heartbeat margin. A short ingress timeout silently severs healthy long-lived connections.
- **Disable response buffering** at the ingress layer (`X-Accel-Buffering: no` is set by the app — the ingress must respect it). Buffering breaks SSE delivery latency.
- **`preStop` hook on edge pods.** Drain in-flight SSE generators gracefully: send a terminal error event, close the response, then exit. Skipping `preStop` causes mid-stream truncation during rolling updates.
- **HPA on active connection count, not CPU alone.** SSE pods are I/O-bound; CPU is a poor signal. Export an active-stream gauge and scale on it.
- **Probe design.** `readinessProbe` checks Redis connectivity (both data and control pools). `livenessProbe` is conservative — do not flap pods that hold open SSE connections.
- **PodDisruptionBudget.** Set `minAvailable` so rolling updates and node drains do not collapse SSE capacity.

See `db/redis-streams.md` for the data/control plane contract and `api/fastapi-sse.md` for the wire format and dispatcher pattern enforced at the application layer.
