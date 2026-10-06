---
paths: "**/*.swift,**/Package.swift,**/*.xcodeproj/**"
---

# Swift Rules

Version: Swift 6+

## Tooling

- Build: Xcode or Swift Package Manager
- Linting: SwiftLint
- Testing: XCTest or Swift Testing
- Formatting: swift-format

## Foundational Standards

Canonical: Swift API Design Guidelines — https://www.swift.org/documentation/api-design-guidelines/

- Use `camelCase` for variables, functions, and methods; `PascalCase` for types and protocols.
- Omit needless words from names: prefer `remove(at:)` over `removeElement(at:)`.
- Label closure arguments so that call sites read as English sentences.
- Design APIs so that fluent usage reads grammatically (e.g., `list.insert(x, at: i)`).
- Prefer `let` over `var`; use `var` only when mutation is required.
- Prefer value types (structs, enums) over reference types (classes) by default.
- Design with protocols for abstraction; extend types via protocol conformances.
- Use `guard`-let for early-exit precondition checks to reduce nesting.
- Omit `self.` unless required (e.g., inside a closure capturing `self`).
- Group related functionality in extensions rather than in one large type definition.

## MUST

- Use Swift Concurrency (async/await, actors)
- Use Codable for JSON serialization
- Use property wrappers appropriately (@State, @Binding)
- Handle errors with do-catch or Result
- Use guard for early returns
- Document public APIs with documentation comments

## MUST NOT

- Force unwrap optionals (!) without safety check
- Use implicitly unwrapped optionals unless required
- Block the main actor with synchronous calls
- Ignore compiler warnings
- Use stringly-typed APIs
- Create retain cycles in closures (use [weak self])

## File Conventions

- *Tests.swift for test files
- One type per file for public types
- Use PascalCase for types and protocols
- Use camelCase for properties and methods
- Group related functionality with extensions

## Testing

- Use XCTest or Swift Testing framework
- Use async tests for concurrent code
- Mock dependencies with protocols
- Use snapshot testing for UI
