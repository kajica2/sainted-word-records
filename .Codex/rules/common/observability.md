---
paths:
  - "**/*.py"
  - "**/*.ts"
---

# Observability

## Logging

- Use structured logs.
- Include request ID, actor ID where safe, tenant ID where applicable, service name, and operation name.
- Include LangGraph thread ID or agent run ID for AI workflows.
- Include Kubernetes pod metadata where available.
- Redact sensitive data.

Rules:

- MUST NOT log full prompts by default.
- MUST NOT log raw authorization headers.
- MUST NOT log passwords, API keys, tokens, cookies, private keys, or session values.
- MUST NOT log full database records containing private data unless explicitly needed and redacted.

## Metrics and Tracing

Track at least:

- HTTP request rate, latency, and error count.
- Database query latency and connection pool saturation.
- Redis latency and hit/miss rates.
- Agent run count, tool-call count, failure count, and token/model usage where available.
- Queue/stream lag when Redis Streams or workers are used.
- Kubernetes pod restarts and readiness failures.

Rules:

- MUST NOT add high-cardinality labels such as raw user text, email addresses, or full URLs with sensitive query parameters.
- MUST NOT depend on logs alone for production health.
