---
description: "DeepAgents tool definitions, tool approval, and human-in-the-loop patterns"
paths: ["src/deepagents/**", "src/skills/**", "src/ai/**", "src/agents/**", "src/workflows/**", "src/graph/**", "**/agents/**/*.py", "**/graph/**/*.py", "**/runtime/**/*.py", "**/graphs/**/*.py", "langgraph.json"]
---

# DeepAgents Tools & Human-in-the-Loop

Covers: Tools, Tool Approval & Human-in-the-Loop.

See `ai/deepagents.md` for the full topic index.

---

## Tools

### Required

- Use typed arguments for every tool.
- Give every tool a precise name and a docstring that states when to use it.
- Validate all tool inputs before side effects.
- Return structured data for application tools whenever downstream logic depends on the result.
- Represent recoverable failures as structured error results.
- Use idempotency keys for tools that mutate external systems.
- Keep destructive tools behind human approval or strict authorization checks.

### Recommended Pattern

```python
from typing_extensions import TypedDict
from langchain_core.tools import tool


class TicketResult(TypedDict):
    ok: bool
    ticket_id: str | None
    error: str | None


@tool
def create_support_ticket(
    user_id: str,
    title: str,
    description: str,
    idempotency_key: str,
) -> TicketResult:
    """Create a support ticket for a user-reported issue.

    Use this only when the user explicitly asks to create or escalate a support issue.
    """
    if not user_id.strip():
        return {"ok": False, "ticket_id": None, "error": "user_id is required"}
    if not title.strip():
        return {"ok": False, "ticket_id": None, "error": "title is required"}
    if not idempotency_key.strip():
        return {"ok": False, "ticket_id": None, "error": "idempotency_key is required"}

    try:
        ticket_id = ticket_client.create_ticket(
            user_id=user_id,
            title=title,
            description=description,
            idempotency_key=idempotency_key,
        )
        return {"ok": True, "ticket_id": ticket_id, "error": None}
    except TicketClientError as exc:
        return {"ok": False, "ticket_id": None, "error": str(exc)}
```

### Rules

- Do not expose broad tools such as `run_sql`, `call_api`, `execute_shell`, or `send_request` without strict allowlists.
- Do not let tools trust model-generated arguments blindly.
- Do not return stack traces, secrets, raw tokens, cookies, authorization headers, or database errors.
- Do not silently coerce invalid inputs.
- Do not perform destructive actions from tools unless the request is explicit and authorized.
- Do not let custom tools bypass filesystem permissions. Permission rules only cover built-in filesystem tools.
- Prefer many focused tools over one generic tool that can do anything.

---

## Tool Approval & Human-in-the-Loop

### Required

- Use `interrupt_on` for sensitive tools.
- Always provide a checkpointer when human approval is required.
- Use the same `thread_id` when resuming an interrupted agent.
- Configure allowed decisions per tool according to risk.
- Use `approve`/`reject` for highly sensitive tools where argument editing would be unsafe.
- Validate edited arguments before executing the tool.

### Recommended Pattern

```python
from deepagents import create_deep_agent
from langgraph.checkpoint.memory import MemorySaver

checkpointer = MemorySaver()

agent = create_deep_agent(
    model="anthropic:claude-sonnet-4-6",
    tools=[send_email, delete_file, read_file],
    interrupt_on={
        "send_email": {"allowed_decisions": ["approve", "reject"]},
        "delete_file": True,
        "read_file": False,
    },
    checkpointer=checkpointer,
)

config = {"configurable": {"thread_id": "conversation-123"}}
```

### Rules

- Do not use human-in-the-loop without checkpointing.
- Do not resume an interrupt with a new `thread_id`.
- Do not allow `edit` for tools where edited arguments could create an unsafe action.
- Do not put irreversible side effects before approval.
- Do not wrap approval interrupts in broad `try/except` blocks that hide failed resumes.
- Do not assume subagent tool calls are automatically low risk. Configure subagent `interrupt_on` deliberately.

---
