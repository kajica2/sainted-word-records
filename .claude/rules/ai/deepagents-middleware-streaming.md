---
description: "DeepAgents middleware, structured output, streaming, and sandbox execution rules"
paths: ["src/deepagents/**", "src/skills/**", "src/ai/**", "src/agents/**", "src/workflows/**", "src/graph/**", "**/agents/**/*.py", "**/graph/**/*.py", "**/runtime/**/*.py", "**/graphs/**/*.py", "langgraph.json"]
---

# DeepAgents Middleware & Streaming

Covers: Middleware, Structured Output, Streaming, Sandboxes & Code Execution.

See `ai/deepagents.md` for the full topic index.

---

## Middleware

### Required

- Use middleware for cross-cutting behavior: dynamic model selection, dynamic prompts, tracing, retries, PII handling, tool wrapping, or custom state updates.
- Keep middleware small and focused.
- Use graph state for per-thread counters and accumulated values.
- Avoid shared mutable attributes in middleware.

### Recommended Pattern

```python
from langchain.agents.middleware import wrap_model_call, ModelRequest, ModelResponse
from langchain.chat_models import init_chat_model
from typing import Callable


@wrap_model_call
def select_model_by_context(
    request: ModelRequest,
    handler: Callable[[ModelRequest], ModelResponse],
) -> ModelResponse:
    model_name = request.runtime.context.model_name
    model = init_chat_model(model_name)
    return handler(request.override(model=model))
```

### Rules

- Do not mutate `self.x`, module-level counters, shared lists, or shared dicts from middleware hooks.
- Do not log raw prompts, private message history, secrets, or full tool outputs by default.
- Do not add middleware that changes model, tools, or prompts without tests.

---

## Structured Output

### Required

- Use `response_format` when callers need predictable machine-readable results.
- Prefer Pydantic models, dataclasses, TypedDicts, or explicit JSON schemas over prompt-only formatting.
- Use structured output for classification, extraction, decision records, and subagent summaries.

### Recommended Pattern

```python
from pydantic import BaseModel, Field
from deepagents import create_deep_agent


class ResearchReport(BaseModel):
    summary: str = Field(description="Concise answer to the user's question")
    evidence: list[str] = Field(description="Key evidence items or source references")
    open_questions: list[str] = Field(default_factory=list)


agent = create_deep_agent(
    model="openai:gpt-5.4",
    system_prompt="Return a structured research report.",
    response_format=ResearchReport,
)
```

### Rules

- Do not parse free-form final answers when structured output is available.
- Do not use overly complex schemas that are harder for the model to satisfy than the task itself.

---

## Streaming

### Required

- Use graph-level streaming for user-facing progress updates.
- Use `subgraphs=True` when the UI needs subagent events.
- Prefer `version="v2"` for new streaming handlers.
- Filter chunks by type and namespace before rendering.

### Recommended Pattern

```python
for chunk in agent.stream(
    {"messages": [{"role": "user", "content": "Research AI safety governance."}]},
    stream_mode="updates",
    subgraphs=True,
    version="v2",
):
    if chunk["type"] != "updates":
        continue
    namespace = chunk.get("ns") or ()
    is_subagent = any(segment.startswith("tools:") for segment in namespace)
    if is_subagent:
        handle_subagent_update(namespace, chunk["data"])
    else:
        handle_main_agent_update(chunk["data"])
```

### Rules

- Do not assume every stream chunk is a token.
- Do not render raw tool outputs directly to end users.
- Do not stream private filesystem contents, memory files, prompts, or credentials.

---

## Sandboxes & Code Execution

### Required

- Use sandboxes for code execution, shell commands, browser automation, or untrusted file operations.
- Treat `execute` as high risk.
- Require explicit approval for commands that modify files, access networks, install packages, deploy services, delete data, or touch credentials.
- Set timeouts and resource limits.

### Rules

- Do not run model-generated shell commands on the host by default.
- Do not mount secrets into a sandbox unless strictly required and scoped.
- Do not give a sandbox write access to the entire repository unless necessary.
- Do not use local shell execution as a production sandbox.

---

