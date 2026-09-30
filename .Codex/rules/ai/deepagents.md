---
description: "LangChain DeepAgents Rules"
paths: ["src/deepagents/**", "src/skills/**", "src/ai/**", "src/agents/**", "src/workflows/**", "src/graph/**", "**/agents/**/*.py", "**/graph/**/*.py", "**/runtime/**/*.py", "**/graphs/**/*.py", "langgraph.json"]
---

# LangChain DeepAgents Rules

Mandatory conventions for code that builds or customizes agents with `deepagents` and LangChain.

Applies to: DeepAgents SDK code, custom tools, middleware, filesystem backends, skills, memory, subagents, and human-in-the-loop workflows.

## Topic Index

| Topic | File |
|-------|------|
| Core Principles, File Organization, Agent Factory | `ai/deepagents-core.md` |
| Model Configuration, Runtime Context, System Prompt | `ai/deepagents-model-runtime-prompt.md` |
| Tools, Tool Approval & HITL | `ai/deepagents-tools-hitl.md` |
| Built-in Filesystem Tools, Backends, Filesystem Permissions | `ai/deepagents-filesystem-backends.md` |
| Memory, Skills, Subagents, Async Subagents | `ai/deepagents-skills-subagents.md` |
| Middleware, Structured Output, Streaming, Sandboxes | `ai/deepagents-middleware-streaming.md` |
| Error Handling, Security, Observability, Testing, Anti-Patterns, Preferred Defaults | `ai/deepagents-operations.md` |

## Quick Reference

**When to use DeepAgents**: planning, long-horizon execution, filesystem-backed context, skills, memory, subagents. Use LangGraph for custom graph topology; use plain LangChain agents for simple loops.

**Agent factory**: Named function returning compiled agent. Pass model, tools, system_prompt, backend, permissions, skills, memory, checkpointer explicitly.

**Tools**: Typed args, precise docstrings, validate inputs, return `TypedDict`, idempotency keys for mutations. Narrow, focused tools over broad ones.

**Filesystem**: Choose `StateBackend` (scratch), `StoreBackend` (durable), `CompositeBackend` (mixed). Always define permissions; add `/**` deny fallback.

**Permissions**: `FilesystemPermission` — allow or deny by path/operation. Put specific rules before broad fallback deny.

**HITL**: `interrupt_on` per tool + checkpointer + stable `thread_id` for resume. Validate edited args.

**Skills**: One folder per skill, `SKILL.md` with `name`/`description` frontmatter. Focused on one workflow.

**Subagents**: Narrow responsibility, minimal tools, concise output. Configure `interrupt_on` deliberately.

**Streaming**: `subgraphs=True`, `version="v2"`, filter chunks by type and namespace.

**Testing**: Fake models, fake tools, fake stores, fresh checkpointers. Test tools, permissions, subagents, HITL, streaming, and error paths.
