---
description: "LangGraph & Agent Workflow Rules"
paths: ["src/deepagents/**", "src/skills/**", "src/ai/**", "src/agents/**", "src/workflows/**", "src/graph/**", "**/agents/**/*.py", "**/graph/**/*.py", "**/runtime/**/*.py", "**/graphs/**/*.py", "langgraph.json"]
---

# LangGraph & Agent Workflow Rules

Mandatory conventions for LangGraph-based AI, agent, workflow, and graph code.

Apply to files under: `src/ai/**`, `src/agents/**`, `src/workflows/**`, `src/graph/**`.

## Topic Index

| Topic | File |
|-------|------|
| Core Principles, State Schema, Graph Construction, Node Design | `ai/langgraph-fundamentals.md` |
| Routing & Edges, Command Usage, Tool Definitions, LLM Calls | `ai/langgraph-routing-tools.md` |
| Streaming, Persistence, HITL | `ai/langgraph-streaming-hitl.md` |
| Error Handling, Loops, Subgraphs, Observability | `ai/langgraph-errors-loops-subgraphs.md` |
| Testing, Security, File Org, Naming, Code Review, Anti-Patterns, Preferred Defaults | `ai/langgraph-testing-organization.md` |

## Quick Reference

**State**: Use `TypedDict`. Use `Annotated[..., reducer]` for accumulating fields. Use `add_messages` for message history.

**Graphs**: `StateGraph(StateType)` → `add_node` → `add_edge` / `add_conditional_edges` → `compile()`. Keep in a named factory function.

**Nodes**: One responsibility. Return partial state dict. Never mutate state in place.

**Routing**: Pure functions returning `Literal[...]`. Map every return value to a node or `END`. Add fallback routes.

**Command**: Only when update + routing must happen in one node. Annotate destination types.

**Tools**: `@tool`, typed args, validate inputs, return `TypedDict` results, idempotency keys for mutations.

**Checkpointing**: Required for HITL, retries, durable execution. Stable `thread_id` per conversation.

**HITL**: `interrupt()` + checkpointer + `Command(resume=...)` with the same `thread_id`.

**Loops**: Always bounded. Track attempts in state. Route to fallback when limit reached.

**Testing**: Fake models, fake tools, fresh checkpointer per test. Test nodes, routers, error paths, HITL flows.
