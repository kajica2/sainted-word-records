---
description: "File and Function Size Rules"
paths: ["**/*.py", "**/*.ts", "**/*.tsx", "**/*.js", "**/*.jsx", ".omb/**", ".claude/**"]
---

# File and Function Size Rules

These are project-wide defaults. Language-specific rules may be stricter.

- Functions should usually be under 50 lines.
- Files should usually be 200-400 lines.
- Files above 800 lines require strong justification or splitting.
- Components should be split by responsibility, not by arbitrary line count.
- Services should expose small public methods.
- Graph nodes should be small and individually testable.

Rules:

- MUST NOT create god files such as `utils.py`, `helpers.ts`, or `services.ts` containing unrelated code.
- MUST NOT create giant React components with data loading, transformation, layout, and form logic all together.
- MUST NOT create API routers that contain service logic, query logic, and response mapping all together.
- MUST NOT hide complexity in one-line nested expressions.

## Dependency and Package Rules

### General

- Follow the existing lockfile and package manager.
- Add dependencies only when they solve a clear problem.
- Prefer maintained, typed, widely used libraries.
- Avoid introducing overlapping libraries for the same purpose.
- Keep runtime dependencies separate from dev dependencies.

Rules:

- MUST NOT add a new package for trivial utilities.
- MUST NOT add multiple state-management, validation, or HTTP-client libraries without a project decision.
- MUST NOT bypass lockfile updates.
- MUST NOT use deprecated packages for new code.

### Python

- Keep dependencies in the project-approved dependency file.
- Pin or constrain versions according to the project policy.
- Prefer async-compatible libraries for async services.

### TypeScript / JavaScript

- Keep dependencies in the workspace-approved package file.
- Prefer typed libraries or packages with maintained type definitions.
- Avoid CommonJS-only packages in ESM-first code unless necessary.
