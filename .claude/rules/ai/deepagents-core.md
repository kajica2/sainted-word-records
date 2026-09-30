---
description: "DeepAgents core principles, file organization, and agent factory patterns"
paths: ["src/deepagents/**", "src/skills/**", "src/ai/**", "src/agents/**", "src/workflows/**", "src/graph/**", "**/agents/**/*.py", "**/graph/**/*.py", "**/runtime/**/*.py", "**/graphs/**/*.py", "langgraph.json"]
---

# DeepAgents Core

Covers: Core Principles, File Organization, Agent Factory.

See `ai/deepagents.md` for the full topic index.

---

## Core Principles

- Treat a Deep Agent as a production agent harness, not a simple prompt wrapper.
- Use DeepAgents when the task needs planning, long-horizon execution, filesystem-backed context, skills, memory, or subagents.
- Use plain `langchain.agents.create_agent` for simple tool-calling loops.
- Use raw LangGraph only when the workflow topology must be custom and explicit.
- Keep the Deep Agent configuration declarative and easy to inspect.
- Put safety boundaries in tools, permissions, backends, and sandboxes. Do not rely on the model to self-police.
- Keep prompts focused on role, behavior, constraints, and output quality. Do not duplicate built-in planning/filesystem/subagent instructions unless extending them deliberately.
- Prefer small, typed, validated tools over large generic tools.
- Prefer constrained subagents over giving the main agent every tool and every instruction.
- Design every agent so it can be streamed, traced, resumed, and tested.

---

## Recommended File Organization

```text
src/agents/research_agent/
  agent.py       # create_deep_agent factory
  prompts.py     # system prompts and subagent prompts
  tools.py       # custom @tool definitions
  middleware.py  # custom middleware only when needed
  subagents.py   # subagent specs
  backends.py    # filesystem/backend configuration
  permissions.py # filesystem permission rules
  schemas.py     # response_format and tool schemas
  tests/

src/deepagents/
  backends.py    # shared backend factories
  permissions.py # shared permission helpers
  streaming.py   # shared streaming adapters
  hitl.py        # human approval helpers
  testing.py     # fake tools/models/checkpointers

src/skills/
  langgraph_docs/SKILL.md
  code_review/SKILL.md
```

### Rules

- Put `create_deep_agent(...)` calls in `agent.py` or a clearly named factory module.
- Put reusable custom tools in `tools.py`.
- Put subagent dictionaries in `subagents.py`.
- Put long system prompts in `prompts.py`, not inline inside agent factories.
- Put filesystem permission rules in `permissions.py`.
- Put skills under `src/skills/<skill_name>/SKILL.md`.
- Do not mix unrelated agents, tools, prompts, and subagents in one large module.

---

## Agent Factory

### Required

- Create agents through a named factory function.
- Return the compiled Deep Agent from the factory.
- Use `create_deep_agent` directly unless the project has a shared wrapper.
- Pass model, tools, system prompt, subagents, backend, permissions, skills, memory, checkpointer, and store explicitly.
- Keep environment-variable reads outside tool execution when possible.
- Validate required environment variables at factory construction time.
- Do not create production agents with hidden global mutable configuration.

### Recommended Pattern

```python
from deepagents import create_deep_agent

from .backends import build_backend
from .permissions import build_permissions
from .prompts import MAIN_SYSTEM_PROMPT
from .subagents import build_subagents
from .tools import search_documents, create_ticket


def build_support_agent(*, checkpointer, store=None):
    """Build the customer support Deep Agent."""
    return create_deep_agent(
        model="anthropic:claude-sonnet-4-6",
        tools=[search_documents, create_ticket],
        system_prompt=MAIN_SYSTEM_PROMPT,
        subagents=build_subagents(),
        backend=build_backend(),
        permissions=build_permissions(),
        skills=["src/skills/customer_support"],
        memory=["/memories/AGENTS.md"],
        checkpointer=checkpointer,
        store=store,
        name="customer-support-agent",
    )
```

### Rules

- Do not instantiate agents at import time if construction depends on secrets, stores, or runtime configuration.
- Do not pass broad wildcard tool lists unless every tool is safe and relevant.
- Do not create one universal agent with all project tools. Create specialized agents or subagents.
- Do not rely on default settings when production behavior depends on persistence, permissions, or approvals.

---
