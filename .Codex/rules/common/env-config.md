---
paths:
  - ".env*"
  - "**/config.py"
  - "**/settings.py"
---

# Environment and Configuration

## Environment Variables

- Use `UPPER_SNAKE_CASE`.
- Prefix project-specific variables when useful.
- Validate all required variables at startup.
- Keep secrets out of code, logs, prompts, and client bundles.

Examples:

```text
DATABASE_URL
REDIS_URL
OPENAI_API_KEY
LANGSMITH_API_KEY
APP_ENV
APP_LOG_LEVEL
K8S_NAMESPACE
```

Rules:

- MUST NOT read environment variables throughout the codebase directly.
- MUST centralize settings in a typed config module.
- MUST NOT expose secret env vars to Next.js client code.
- MUST NOT use `NEXT_PUBLIC_` for anything secret.
- MUST NOT commit `.env` files containing real secrets.

## Configuration Ownership

| Config Type | Location |
| --- | --- |
| Local development defaults | `.env.example`, local docs |
| Runtime non-secret config | environment variables / ConfigMaps |
| Runtime secrets | Secret manager / Kubernetes Secret |
| Python settings | `src/core/config.py` |
| Frontend public config | explicit public env variables only |
| K8s deployment config | overlays / Helm values / Kustomize patches |
