---
description: "DeepAgents model configuration, runtime context, and system prompt patterns"
paths: ["src/deepagents/**", "src/skills/**", "src/ai/**", "src/agents/**", "src/workflows/**", "src/graph/**", "**/agents/**/*.py", "**/graph/**/*.py", "**/runtime/**/*.py", "**/graphs/**/*.py", "langgraph.json"]
---

# DeepAgents Model, Runtime & Prompt

Covers: Model Configuration, Runtime Context, System Prompt.

See `ai/deepagents.md` for the full topic index.

---

## Model Configuration

### Required

- Use a LangChain chat model that supports tool calling.
- Prefer provider-qualified model strings such as `openai:gpt-5.4` or `anthropic:claude-sonnet-4-6`.
- Use `init_chat_model(...)` when you need provider-specific parameters.
- Keep model selection explicit and testable.
- Use lower-temperature or deterministic settings for routing, extraction, or regulated workflows.

### Recommended Pattern

```python
from langchain.chat_models import init_chat_model
from deepagents import create_deep_agent

model = init_chat_model(
    model="anthropic:claude-sonnet-4-6",
    temperature=0,
    max_tokens=4096,
)

agent = create_deep_agent(
    model=model,
    system_prompt="You are a careful research assistant.",
)
```

### Rules

- Do not use models without tool-calling support for DeepAgents workflows.
- Do not let users freely select arbitrary models without validating provider, capability, and cost.
- Do not change models at runtime through global variables. Use runtime context and middleware.

---

## Runtime Context

### Required

- Use `context_schema` for per-run configuration: user ID, org ID, roles, feature flags, locale, and safe connection handles.
- Treat runtime context as configuration for tools and middleware, not as ordinary prompt text.
- Add dynamic prompt middleware only when runtime context must affect the model's instructions.
- Keep runtime context serializable or otherwise safe for the runtime path that consumes it.

### Recommended Pattern

```python
from dataclasses import dataclass
from deepagents import create_deep_agent


@dataclass
class AgentContext:
    user_id: str
    org_id: str
    role: str


agent = create_deep_agent(
    model="openai:gpt-5.4",
    context_schema=AgentContext,
)

result = agent.invoke(
    {"messages": [{"role": "user", "content": "Summarize my open tickets."}]},
    context=AgentContext(user_id="user-123", org_id="org-456", role="support_admin"),
)
```

### Rules

- Do not assume runtime context is automatically visible to the model.
- Do not put API keys, tokens, or raw credentials into prompts.
- Do not put user role or permission decisions only in the prompt. Enforce them in tools, middleware, backend policy hooks, or permission rules.

---

## System Prompt

### Required

- Provide a custom `system_prompt` for every production Deep Agent.
- Define the agent's role, domain, quality bar, safety constraints, and final output expectations.
- Keep the prompt concise enough to avoid crowding out task context.
- Let the built-in DeepAgents prompt handle generic planning, filesystem, and subagent behavior.
- Put always-applicable project conventions in memory files.
- Put workflow-specific long instructions in skills.

### Recommended Prompt Shape

```python
MAIN_SYSTEM_PROMPT = """
You are a senior research agent for the product analytics team.

Operating rules:
- Prefer verified sources over guesses.
- Use subagents for independent research tracks.
- Save intermediate research notes under /workspace/research-notes/.
- Final answers must include assumptions, evidence, and next steps.
- Ask for human approval before sending external messages or modifying customer-visible data.
""".strip()
```

### Rules

- Do not paste massive manuals into the system prompt.
- Do not use vague role prompts like "You are helpful." for production agents.
- Do not put secrets, credentials, or hidden implementation details in user-visible prompt paths.
- Do not rely on prompt text to prevent unsafe tool calls. Use tool validation, permissions, interrupts, and sandboxes.
