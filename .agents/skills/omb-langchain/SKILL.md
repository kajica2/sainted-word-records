---
name: omb-langchain
description: "LangChain hub — create_agent, tools, middleware (HITL/error), RAG pipelines, dependency versions, and framework selection. Use for any LangChain build, RAG system, or LangChain/LangGraph/DeepAgents choice."
user-invocable: true
argument-hint: "[fundamentals|dependencies|middleware|rag|framework-selection]"
allowed-tools: Read, Grep, Glob
---

# LangChain Hub

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

LangChain is the foundation layer for building agents, tool-calling loops, RAG pipelines, and model chains. This hub consolidates all LangChain-specific guidance — from `create_agent()` basics through HITL middleware — plus the framework selection guide when you need to choose between LangChain, LangGraph, and Deep Agents.

## Which framework? (LangChain vs LangGraph vs Deep Agents)

Use LangChain for focused, single-purpose agents and RAG. Use LangGraph when you need custom graph topology and loops. Use Deep Agents when you need planning, file management, subagents, and skills out of the box. Full decision table and profiles: read `references/framework-selection.md`.

## When to read each reference

| If you need... | Read |
|----------------|------|
| `create_agent()` / tools / agent loop / structured output | `references/fundamentals.md` |
| Middleware / HITL / error handling / `HumanInTheLoopMiddleware` | `references/middleware.md` |
| RAG / document loaders / text splitters / embeddings / vector stores | `references/rag.md` |
| Package versions / install / dependency management / `langchain-community` pinning | `references/dependencies.md` |
| Which framework to use (LangChain vs LangGraph vs Deep Agents) | `references/framework-selection.md` |

## References

- `references/fundamentals.md` — `create_agent`, tools, structured output, model config, common fixes
- `references/middleware.md` — `HumanInTheLoopMiddleware`, HITL patterns, Command resume, custom middleware
- `references/rag.md` — RAG pipeline, document loaders, text splitters, vector stores (Chroma/FAISS/Pinecone), retrieval
- `references/dependencies.md` — Package versions, environment requirements, framework choice, project templates, versioning policy
- `references/framework-selection.md` — LangChain vs LangGraph vs Deep Agents decision guide, profiles, mixing layers, quick reference
