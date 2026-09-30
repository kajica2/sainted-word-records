---
name: omb-langgraph
description: "LangGraph hub — StateGraph, nodes/edges, Command/Send, persistence/checkpointers, time travel, and human-in-the-loop interrupts. Use for any LangGraph workflow or approval loop. (SSE transport: see omb-langgraph-streaming-transport.)"
user-invocable: true
argument-hint: "[fundamentals|hitl|persistence]"
allowed-tools: Read, Grep, Glob
---

# LangGraph Hub

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

LangGraph models agent workflows as directed state machines. This hub covers everything needed to build, run, and persist LangGraph graphs — from `StateGraph` construction through human-in-the-loop interrupts and cross-thread memory.

## Which framework?

LangGraph gives you full control over graph topology: nodes, edges, loops, and parallel fan-out via `Send`. Use it when you need precise control flow. For batteries-included planning, file management, and subagents, prefer Deep Agents. For simple single-purpose agents, use plain LangChain. Full guide: read `omb-langchain` `references/framework-selection.md`.

> SSE streaming transport is a separate skill `omb-langgraph-streaming-transport` (not folded into this hub).

## When to read each reference

| If you need... | Read |
|----------------|------|
| `StateGraph` / nodes / edges / `Command` / `Send` / streaming / error handling | `references/fundamentals.md` |
| `interrupt()` / approval loop / validation loop / multiple interrupts / error 4-tier | `references/hitl.md` |
| Checkpointer / `thread_id` / time travel / state history / `Store` / subgraph scoping | `references/persistence.md` |

## References

- `references/fundamentals.md` — `StateGraph`, state schemas, reducers, nodes, edges, `Command`, `Send`, invoke/stream, error handling
- `references/hitl.md` — `interrupt()`, `Command(resume=...)`, approval workflow, validation loop, multiple interrupts, idempotency rules
- `references/persistence.md` — Checkpointers (`InMemorySaver`/`PostgresSaver`), `thread_id`, time travel, `update_state`, `Store`, subgraph checkpointer scoping
