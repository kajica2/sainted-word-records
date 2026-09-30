---
paths:
  - "tests/**/*.py"
  - "**/*.test.ts"
  - "**/*.test.tsx"
  - "**/*.spec.ts"
---

# Testing Strategy

## Test-Execution Timeouts

All test execution follows the timeout discipline in `.claude/rules/testing/test-execution.md` (SSOT):

- pytest: per-test `--timeout=10` (pytest-timeout), hook-enforced.
- vitest: built-in 5s `testTimeout`; always `vitest run`, never bare watch mode.
- Bash tool `timeout`: 60s per test file, 120s per full suite.
- Background runs MUST set a runner-level timeout — no timeout-less background test runs.
- Test selection is diff-targeted per `.claude/rules/testing/test-execution.md` (SSOT) — do not run a repository-wide or domain-wide suite during development.

## Backend Tests

- Use pytest or the existing backend test framework.
- Test FastAPI routers with dependency overrides.
- Test services directly.
- Test repositories against an isolated test database or well-scoped integration fixture.
- Test migrations where project tooling supports it.
- Test Redis integrations with fake Redis or disposable Redis depending on behavior.

Rules:

- MUST NOT call production databases, Redis, LLMs, or external APIs in tests.
- MUST NOT rely on test ordering.
- MUST NOT leave test data shared across tests unless explicitly scoped.

## AI Tests

- Unit test graph nodes and routers.
- Use fake models and fake tools for deterministic tests.
- Test tool validation and error paths.
- Test interrupt/resume paths.
- Test loop exit conditions.
- Test prompt output parsers with representative examples.

Rules:

- MUST NOT rely on live model responses for deterministic unit tests.
- MUST NOT assert exact natural-language output unless the wording is contractually required.
- MUST NOT skip safety and fallback path tests.

## Frontend Tests

- Use Vitest and Testing Library.
- Test accessible behavior.
- Test loading, empty, success, and error states.
- Test user interactions.
- Mock API clients at the boundary.

Rules:

- MUST NOT primarily rely on snapshots.
- MUST NOT test implementation details.
- MUST NOT duplicate backend service tests in UI tests.

## Electron Tests

- Test IPC handlers separately from renderer components.
- Test preload API exposure shape.
- Test renderer behavior without granting Node APIs.
- Use end-to-end tests for critical desktop flows when project tooling supports it.

Rules:

- MUST NOT run tests that require unsafe Electron settings.
- MUST NOT skip validation tests for privileged IPC channels.

## Kubernetes / Deployment Tests

- Validate manifests in CI.
- Check required labels, resources, probes, and security context.
- Test rollout assumptions in staging.
- Test migration jobs separately from application deployments.

Rules:

- MUST NOT merge production manifest changes that remove probes, resource requests, or secret references without review.
- MUST NOT deploy unpinned or mutable image tags to production.
