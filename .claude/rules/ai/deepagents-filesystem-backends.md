---
description: "DeepAgents built-in filesystem tools, backends, and filesystem permissions"
paths: ["src/deepagents/**", "src/skills/**", "src/ai/**", "src/agents/**", "src/workflows/**", "src/graph/**", "**/agents/**/*.py", "**/graph/**/*.py", "**/runtime/**/*.py", "**/graphs/**/*.py", "langgraph.json"]
---

# DeepAgents Filesystem, Backends & Permissions

Covers: Built-in Filesystem Tools, Backends, Filesystem Permissions.

See `ai/deepagents.md` for the full topic index.

---

## Built-in Filesystem Tools

Deep Agents expose: `ls`, `read_file`, `write_file`, `edit_file`, `glob`, `grep`, `execute` (sandbox only).

### Required

- Treat the built-in filesystem as the agent's working memory and artifact space.
- Choose the backend intentionally.
- Use permissions to constrain read/write access.
- Route persistent memory and scratch workspace to different backends when needed.
- Keep sensitive files outside the agent-accessible filesystem.

### Rules

- Do not allow unrestricted writes to the repository or host filesystem.
- Do not expose `.env`, credentials, private keys, deployment configs, or secrets through readable paths.
- Do not use `LocalShellBackend` in production unless the environment is tightly controlled and isolated.
- Do not assume default state-backed files persist across unrelated threads.
- Do not store large unbounded artifacts in state-backed files without cleanup rules.
- Do not let subagents write to shared paths unless the main agent is expected to use those files.

---

## Backends

### Recommended Backends

- Use `StateBackend` for short-lived scratch files within a thread.
- Use `FilesystemBackend` only when the agent needs controlled access to a local directory.
- Use `StoreBackend` for long-term memory or durable cross-thread files.
- Use `CompositeBackend` to route `/workspace/`, `/memories/`, `/skills/`, and other paths to different storage systems.
- Use sandbox backends for code execution or shell-like work.

### Recommended Pattern

```python
from deepagents.backends import CompositeBackend, StateBackend, StoreBackend


def build_backend():
    return CompositeBackend(
        default=StateBackend(),
        routes={
            "/workspace/": StateBackend(),
            "/memories/": StoreBackend(namespace=lambda rt: (rt.context.user_id,)),
        },
    )
```

### Rules

- Do not use a local filesystem backend without an absolute, scoped `root_dir`.
- Do not use one backend for everything when scratch files and memory have different lifecycles.
- Do not persist user-specific memory in a namespace shared by all users.
- Do not share organization-level policy memory as writable user memory.
- Do not use shell-capable backends without sandboxing, audit logging, and explicit approval for risky operations.

---

## Filesystem Permissions

### Required

- Define permissions for every production agent that has filesystem access.
- Use deny-by-default patterns for sensitive deployments.
- Explicitly protect secrets and configuration files.
- Remember that permissions apply to built-in filesystem tools, not arbitrary custom tools, MCP tools, or sandbox command execution.
- Use backend policy hooks for custom validation, audit logging, content inspection, rate limits, or custom tool control.

### Recommended Pattern

```python
from deepagents import FilesystemPermission


def build_permissions():
    return [
        FilesystemPermission(
            operations=["read", "write"],
            paths=["/workspace/**"],
            mode="allow",
        ),
        FilesystemPermission(
            operations=["read"],
            paths=["/memories/**", "/skills/**"],
            mode="allow",
        ),
        FilesystemPermission(
            operations=["write"],
            paths=["/memories/**", "/skills/**"],
            mode="deny",
        ),
        FilesystemPermission(
            operations=["read", "write"],
            paths=["/**"],
            mode="deny",
        ),
    ]
```

### Rules

- Put specific allow or deny rules before broad fallback rules.
- Add an explicit `/**` fallback deny rule when the agent must be constrained.
- Deny access to `.env`, secrets, credentials, private keys, and deployment files.
- Do not assume unmatched permission rules deny access. Add a fallback deny when needed.
- Do not use filesystem permissions as the only security boundary for code execution.
