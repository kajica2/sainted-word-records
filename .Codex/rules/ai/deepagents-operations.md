---
description: "DeepAgents error handling, security, observability, and testing rules"
paths: ["src/deepagents/**", "src/skills/**", "src/ai/**", "src/agents/**", "src/workflows/**", "src/graph/**", "**/agents/**/*.py", "**/graph/**/*.py", "**/runtime/**/*.py", "**/graphs/**/*.py", "langgraph.json"]
---

# DeepAgents Operations

Covers: Error Handling & Recovery, Security & Privacy, Observability, Testing, Anti-Patterns, Preferred Defaults.

See `ai/deepagents.md` for the full topic index.

---

## Error Handling & Recovery

### Required

- Tools must return clear errors for recoverable failures.
- Agent factories must validate required configuration.
- Human approval flows must handle approval, rejection, editing, and resume failures.

### Rules

- Do not let failed tools return values that look successful.
- Do not retry forever.
- Do not expose internal stack traces to users.
- Do not swallow exceptions in middleware or tool wrappers without logging and structured error handling.

---

## Security & Privacy

### Required

- Enforce authorization in tools, middleware, backends, and application code.
- Treat model output, retrieved documents, user uploads, memory files, and tool outputs as untrusted input.
- Use allowlists for external actions, filesystem paths, network destinations, and commands.
- Require approval for sensitive external effects.
- Redact secrets before prompts, logs, streams, traces, memory, and files.

### Rules

- Do not let prompt injection from documents or tool results override system or developer rules.
- Do not store credentials in memory, skills, checkpoints, filesystem artifacts, traces, or logs.
- Do not rely on a prompt instruction like "never do X" as the only safeguard.
- Do not grant subagents broader permissions than the main agent unless explicitly justified.

---

## Observability

### Required

- Trace production agents with LangSmith or the project's tracing system.
- Include agent name, thread ID, user ID or safe surrogate, subagent name, tool name, and request ID.
- Log tool calls with safe metadata.
- Log approvals, rejections, edited arguments, and rejected side effects.
- Redact sensitive data from logs and traces.

### Rules

- Do not log raw prompts or complete message history by default.
- Do not log authorization headers, cookies, API keys, access tokens, passwords, or private keys.
- Do not use print statements as the only observability mechanism.

---

## Testing

### Required

- Unit test every non-trivial custom tool.
- Unit test permission helpers and backend route helpers.
- Integration test at least one complete agent path.
- Test human approval flows with approve, reject, and edit decisions.
- Test streaming handlers with main-agent and subagent chunks.
- Use fake models, fake stores, fake tools, and local checkpointers for deterministic tests.

### Recommended Tests

```python
def test_build_permissions_denies_fallback_access():
    permissions = build_permissions()
    assert permissions[-1].paths == ["/**"]
    assert permissions[-1].mode == "deny"


def test_create_ticket_requires_idempotency_key():
    result = create_support_ticket.invoke({
        "user_id": "user-1",
        "title": "Bug",
        "description": "Something failed",
        "idempotency_key": "",
    })
    assert result["ok"] is False
```

### Rules

- Do not call real LLMs in unit tests.
- Do not call production APIs in tests.
- Do not assert only that an agent returns "something." Assert tool calls, state, structured output, or safety behavior.

---

## Anti-Patterns

```python
# Bad: universal tool that can do anything
@tool
def call_internal_api(method: str, url: str, body: dict) -> dict:
    return requests.request(method, url, json=body).json()

# Bad: no custom prompt, no permissions, no approvals
agent = create_deep_agent(
    model="openai:gpt-5.4",
    tools=[send_email, delete_file, run_shell],
)

# Bad: unrestricted local shell backend
agent = create_deep_agent(
    model="anthropic:claude-sonnet-4-6",
    backend=LocalShellBackend(root_dir="/"),
)

# Bad: shared mutable middleware state
class CountingMiddleware(AgentMiddleware):
    def __init__(self):
        self.count = 0  # shared across concurrent requests

    def before_agent(self, state, runtime):
        self.count += 1
        return {}
```

---

## Preferred Defaults

- Prefer `create_deep_agent` for long-horizon, tool-heavy, context-heavy agents.
- Prefer explicit model configuration.
- Prefer custom system prompts for every production agent.
- Prefer narrow typed tools.
- Prefer structured tool results.
- Prefer deny-by-default filesystem permissions for production.
- Prefer `CompositeBackend` when scratch files, memory, and skills have different lifecycles.
- Prefer `StoreBackend` for durable memory.
- Prefer skills over always-loaded long instructions.
- Prefer subagents for context isolation and specialized work.
- Prefer async subagents only for long-running or parallelizable work.
- Prefer `response_format` for machine-readable output.
- Prefer `subgraphs=True` and `version="v2"` when streaming subagent progress.
- Prefer checkpointers for human-in-the-loop and resumable workflows.
- Prefer tests with fake models, fake tools, fake stores, and isolated checkpointers.
