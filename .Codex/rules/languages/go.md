---
paths: "**/*.go,**/go.mod,**/go.sum"
---

# Go Rules

Version: Go 1.23+

## Tooling

- Linting: golangci-lint
- Formatting: gofmt, goimports
- Testing: go test with coverage >= 85%
- Package management: go modules

## Foundational Standards

Canonical: Effective Go — https://go.dev/doc/effective_go

- Use `PascalCase` for exported identifiers; use `camelCase` for unexported identifiers.
- Keep acronyms fully uppercase: `URL`, `ID`, `HTTP` (e.g., `ServeHTTP`, `userID`).
- Use short (1-2 char) receiver names that are consistent within a type (e.g., `func (c *Client)`).
- Name single-method interfaces with an `-er` suffix (e.g., `Reader`, `Formatter`).
- Accept `context.Context` as the first parameter in any function that may block or cancel.
- Return errors; never panic in library code.
- Wrap errors with `fmt.Errorf("operation failed: %w", err)` to preserve the chain.
- Prefer composition over embedding for code reuse.
- Avoid package-level mutable state.
- Use `gofmt`/`goimports` as the authoritative formatter; do not argue with their output.
- Use lowercase single-word package names with no underscores or mixed caps.

## MUST

- Use context.Context as first parameter for functions that may block
- Handle all errors explicitly with proper error wrapping
- Use errgroup for concurrent operations with error handling
- Run golangci-lint before commit
- Use defer for cleanup operations
- Document exported functions and types

## MUST NOT

- Ignore errors with blank identifier (_)
- Use panic for normal error handling
- Use init() for complex initialization logic
- Import packages without alias when names conflict
- Use global variables for state management
- Embed credentials or secrets in code

## File Conventions

- *_test.go for test files
- internal/ for private packages
- cmd/ for main entry points
- pkg/ for public reusable libraries
- Use snake_case for file names

## Testing

- Table-driven tests are preferred
- Use testify/assert or go-cmp for assertions
- Mock external dependencies with interfaces
- Use t.Parallel() for independent tests
