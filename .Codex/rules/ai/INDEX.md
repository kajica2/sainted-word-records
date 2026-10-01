---
description: "AI Rules"
paths: ["src/deepagents/**", "src/skills/**", "src/ai/**", "src/agents/**", "src/workflows/**", "src/graph/**", "**/agents/**/*.py", "**/graph/**/*.py", "**/runtime/**/*.py", "**/graphs/**/*.py", "langgraph.json", ".claude/agents/**", ".claude/rules/**"]
---

# AI Rules

## Files

### LangGraph (mother + splits)
- `langgraph.md` — Mother index: Quick Reference + topic index pointing to splits
- `langgraph-fundamentals.md` — Core Principles, State Schema, Graph Construction, Node Design
- `langgraph-routing-tools.md` — Routing & Edges, Command Usage, Tool Definitions, LLM Calls
- `langgraph-streaming-hitl.md` — Streaming, Persistence, HITL
- `langgraph-errors-loops-subgraphs.md` — Error Handling & Recovery, Loops & Recursion, Subgraphs & Multi-Agent Workflows, Observability & Logging
- `langgraph-testing-organization.md` — Testing, Security & Privacy, File Organization, Naming Conventions, Code Review Checklist, Anti-Patterns, Preferred Defaults
- `langgraph-streaming-transport.md` — Mother: cross-pod transport layer overview, chunk → wire event mapping, Quick Reference HARD rules, anti-patterns. Defers numeric defaults to `db/redis-streams.md`
- `langgraph-streaming-transport-publisher.md` — Split: event publisher abstract pattern (Redis Streams `XADD` + Pub/Sub for control plane)
- `langgraph-streaming-transport-runtime.md` — Split: cancel listener as dedicated asyncio task, run executor with guaranteed terminal events, internal HTTP dispatch pattern

### DeepAgents (mother + splits)
- `deepagents.md` — Mother index: Quick Reference + topic index pointing to splits
- `deepagents-core.md` — Core Principles, File Organization, Agent Factory
- `deepagents-model-runtime-prompt.md` — Model Configuration, Runtime Context, System Prompt
- `deepagents-tools-hitl.md` — Tools, Tool Approval & HITL
- `deepagents-filesystem-backends.md` — Built-in Filesystem Tools, Backends, Filesystem Permissions
- `deepagents-skills-subagents.md` — Memory, Skills, Subagents, Async Subagents
- `deepagents-middleware-streaming.md` — Middleware, Structured Output, Streaming, Sandboxes & Code Execution
- `deepagents-operations.md` — Error Handling & Recovery, Security & Privacy, Observability, Testing, Anti-Patterns, Preferred Defaults

## Triggers

Inject these rules when working on: LangGraph, DeepAgents, agents, workflows, `src/ai/**`,
`src/agents/**`, `src/workflows/**`, `src/graph/**`, `langchain`, `langgraph`, `deepagents`,
`create_deep_agent`, `StateGraph`, `interrupt`, `checkpointer`,
Redis Streams + SSE for LangGraph runs, `XADD`, `XREAD`, cancel listener,
event publisher, run executor.

## See also

- `../INDEX.md` (root)
- `../common/INDEX.md` (always-load manifest)
- `../common/design-patterns.md` (pattern selection + framework-idiom precedence)
- `../harness/INDEX.md` (harness agent configuration)
