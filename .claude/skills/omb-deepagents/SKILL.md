---
name: omb-deepagents
description: "Deep Agents hub — create_deep_agent harness, backends/memory (State/Store/Composite), subagents, planning, and HITL. Use when building any Deep Agents application."
user-invocable: true
argument-hint: "[core|memory|orchestration]"
allowed-tools: Read, Grep, Glob
---

# Deep Agents Hub

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

Deep Agents is a batteries-included agent framework built on LangChain/LangGraph. It provides task planning, filesystem context management, subagent delegation, persistent memory, and human-in-the-loop — all configured via `create_deep_agent()` without hand-wiring graph topology.

## Which framework?

Deep Agents is the right choice when your task is open-ended, multi-step, and requires breaking work into sub-tasks, managing files across a session, or loading domain-specific skills on demand. For precise custom graph control use LangGraph; for simple single-purpose agents use plain LangChain. Full guide: read `omb-langchain` `references/framework-selection.md`.

## When to read each reference

| If you need... | Read |
|----------------|------|
| `create_deep_agent()` / harness config / `SKILL.md` format / built-in tools / common fixes | `references/core.md` |
| Memory / persistence / filesystem / backends (`StateBackend` / `StoreBackend` / `CompositeBackend`) | `references/memory.md` |
| Subagents / task planning / `TodoListMiddleware` / HITL / approval workflows | `references/orchestration.md` |

## References

- `references/core.md` — `create_deep_agent()`, full configuration, `SKILL.md` format, built-in tools, skills backends, common fixes
- `references/memory.md` — `StateBackend`, `StoreBackend`, `CompositeBackend`, `FilesystemBackend`, cross-session memory, production stores
- `references/orchestration.md` — Subagent delegation, custom subagents, `TodoListMiddleware`, HITL (`interrupt_on`), approve/reject/edit patterns
