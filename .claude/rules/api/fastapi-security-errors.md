---
description: FastAPI authentication, authorization, CORS, and error envelope rules
paths:
  - "apps/api/**/auth/**/*.py"
  - "apps/api/**/security/**/*.py"
  - "apps/api/**/middleware/**/*.py"
  - "apps/api/**/errors.py"
  - "apps/api/**/exceptions.py"
  - "src/api/**/auth/**/*.py"
  - "src/api/**/security/**/*.py"
  - "src/api/**/middleware/**/*.py"
  - "**/api/**/*.py"
---

# FastAPI Security and Error Rules

## Authentication and Authorization

- Auth dependencies must validate token signature, expiry, issuer, audience, and required scopes before returning a principal.
- Authorization must be checked at the route, dependency, or service policy boundary before data access.
- Do not duplicate role checks inside every endpoint body. Use dependency composition or policy services.
- Never put JWT signing secrets, API keys, or OAuth client secrets in code or frontend-visible configuration.
- CORS must use explicit origin allowlists. Wildcard origins with credentials are banned.

## Input and Output Safety

- Validate every external boundary: path, query, headers, body, cookies, and uploaded metadata.
- Do not pass user-controlled strings directly into SQL identifiers, sort clauses, filesystem paths, shell commands, redirects, or templates.
- Do not log tokens, passwords, raw request bodies containing PII, or full exception details for user-caused errors.
- For file uploads, enforce size, content type, extension, storage path, and malware-scan policy where applicable.

## Error Contract

- Use one stable error envelope for expected API errors.
- Translate domain exceptions into HTTP errors in exception handlers or a narrow API boundary.
- Use 400 for malformed domain input, 401 for unauthenticated, 403 for unauthorized, 404 for missing resources, 409 for conflicts, and 422 for framework validation.
- Never expose stack traces, raw database exceptions, secret values, or internal object identifiers to clients.
- Include machine-readable error codes when clients need branching behavior.

## Review Checklist

- Is each protected route covered by auth and authorization tests?
- Are error responses documented in OpenAPI when clients must handle them?
- Are logs useful for operators without exposing secrets or unnecessary PII?
