---
paths: "**/*.js,**/*.mjs,**/*.cjs,**/package.json"
---

# JavaScript Rules

Version: ES2024+ / Node.js 22 LTS

## Tooling

- Linting: ESLint 9 or Biome
- Formatting: Prettier or Biome
- Testing: Vitest or Jest
- Runtime: Node.js, Bun 1.x, or Deno 2.x

## Foundational Standards

Canonical: TC39 + Airbnb JavaScript Style Guide — https://github.com/airbnb/javascript

- Use `camelCase` for variables and functions; `PascalCase` for classes and constructors.
- Never use `var`; prefer `const`, fall back to `let` only when reassignment is needed.
- Use `===` and `!==` instead of `==` and `!=`.
- Use ESM (`import`/`export`) over CommonJS (`require`/`module.exports`) where possible.
- Prefer arrow functions for callbacks and anonymous functions.
- Use optional chaining (`?.`) and nullish coalescing (`??`) (ES2020+).
- Enable `'use strict'` at the top of CommonJS modules; ESM files are strict by default.
- Do not rely on implicit globals; declare all variables explicitly.
- Use `async/await` over raw Promise chains for sequential async logic.
- Use template literals over string concatenation.
- Use trailing commas in multiline array and object literals.

## MUST

- Use ESM modules over CommonJS
- Use async/await for asynchronous operations
- Use optional chaining (?.) and nullish coalescing (??)
- Validate user inputs at system boundaries
- Use const by default, let when reassignment needed
- Handle all Promise rejections

## MUST NOT

- Use var (use const/let instead)
- Use == for comparison (use === instead)
- Leave unhandled Promise rejections
- Use eval() or Function() constructor
- Mutate function arguments directly
- Use synchronous file I/O in async contexts

## File Conventions

- *.test.js or *.spec.js for test files
- index.js for barrel exports
- Use camelCase for functions and variables
- Use PascalCase for classes
- Use kebab-case for file names

## Testing

- Use Vitest for modern projects
- Use Testing Library for UI components
- Mock modules with vi.mock() or jest.mock()
- Use msw for HTTP mocking
