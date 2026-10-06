---
description: "DeepAgents memory, skills, and subagent design rules"
paths: ["src/deepagents/**", "src/skills/**", "src/ai/**", "src/agents/**", "src/workflows/**", "src/graph/**", "**/agents/**/*.py", "**/graph/**/*.py", "**/runtime/**/*.py", "**/graphs/**/*.py", "langgraph.json"]
---

# DeepAgents Skills & Subagents

Covers: Memory, Skills, Subagents, Async Subagents.

See `ai/deepagents.md` for the full topic index.

---

## Memory

### Required

- Use `memory=[...]` only for context that should persist or apply across conversations.
- Keep memory files short, stable, and high signal.
- Use memory for project conventions, user preferences, agent identity, and critical persistent guidance.
- Use skills for detailed workflows, long procedural instructions, or specialized capabilities.
- Route memory files to a durable backend when they must survive across threads or deployments.

### Rules

- Do not put large manuals in always-loaded memory.
- Do not store secrets, credentials, access tokens, or unnecessary PII in memory.
- Do not make organization policies writable by end-user agents.
- Do not mix user-scoped, agent-scoped, and organization-scoped memory in one namespace.

---

## Skills

### Required

- Use skills for reusable, on-demand capabilities.
- Each skill must live in its own folder and include a `SKILL.md` file.
- Each `SKILL.md` must include frontmatter with at least `name` and `description`.
- Keep each skill focused on one workflow, domain, or capability.
- Reference all supporting scripts, docs, templates, or assets from the `SKILL.md` file.
- Keep skill descriptions precise because the agent uses them to decide when to load the skill.

### Recommended `SKILL.md`

```markdown
---
name: code-review
description: Use this skill when reviewing Python agent, LangChain, LangGraph, or DeepAgents code for correctness, safety, maintainability, and production readiness.
allowed-tools: read_file, grep, glob
---

# Code Review Skill

## Purpose
Review agent code for correctness, safety boundaries, observability, and test coverage.

## Workflow
1. Identify the agent factory and custom tools.
2. Check prompt, tool, backend, permission, and subagent configuration.
3. Verify tests cover tool errors, interrupts, subagents, and streaming.
4. Return findings grouped by severity.

## References
- `checklist.md`: Detailed review checklist.
```

### Rules

- Do not create broad overlapping skills such as `general-dev`, `research`, and `analysis` that all match the same requests.
- Do not rely on skills for always-required behavior. Use system prompt or memory for always-required behavior.
- Do not put secrets or credentials in skill files.
- Do not let user-editable skills override security policy.

---

## Subagents

### Required

- Use subagents to isolate detailed work, specialized instructions, large tool outputs, or different model/tool requirements.
- Give each subagent a unique, descriptive name.
- Write an action-oriented `description` that clearly tells the main agent when to delegate.
- Give each subagent a detailed `system_prompt` with scope, tools, constraints, and output format.
- Keep each subagent's tools minimal.

### Recommended Pattern

```python
research_subagent = {
    "name": "researcher",
    "description": (
        "Use this subagent for multi-step research that requires searching, "
        "reading many sources, and returning a concise evidence-backed summary."
    ),
    "system_prompt": """
You are a focused research subagent.
Rules:
- Gather evidence before concluding.
- Keep intermediate notes inside your own context.
- Return only the final summary, citations, and unresolved questions.
- Do not perform user-visible actions.
""".strip(),
    "tools": [web_search, fetch_document],
    "model": "openai:gpt-5.4",
}
```

### Rules

- Do not use subagents for simple one-step tasks.
- Do not give every subagent every tool.
- Do not assume subagents inherit every main-agent setting. Configure tools, middleware, skills, permissions, and interrupts deliberately.
- Do not let subagents return huge transcripts. Require concise final results.
- Do not delegate destructive or external side effects to subagents without approval gates.

---

## Async Subagents

### Required

- Use async subagents only for long-running, parallelizable, or steerable background work.
- Treat async subagents as a preview feature unless the project has pinned and validated the exact `deepagents` version.
- Track task IDs and statuses explicitly.
- Define cancellation and timeout behavior.

### Rules

- Do not use async subagents for short tasks where synchronous subagents are clearer.
- Do not launch unbounded background tasks.
- Do not let the main agent report completion before required async results have been checked.

---
