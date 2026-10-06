---
paths: "**/*.kt,**/*.kts,**/build.gradle.kts"
---

# Kotlin Rules

Version: Kotlin 2.0+

## Tooling

- Build: Gradle with Kotlin DSL
- Linting: ktlint or detekt
- Testing: JUnit 5, MockK
- Coverage: Kover >= 85%

## Foundational Standards

Canonical: Kotlin Coding Conventions — https://kotlinlang.org/docs/coding-conventions.html

- Use 4-space indentation; limit lines to 120 columns.
- Prefer `val` over `var`; use `var` only when mutation is necessary.
- Use `PascalCase` for class, object, and interface names; `camelCase` for functions, properties, and variables.
- Use `SCREAMING_SNAKE_CASE` for true constants (`const val`).
- Name files `PascalCase.kt` when a file contains a single top-level class.
- Use trailing lambdas: move the last lambda argument outside parentheses.
- Use named arguments when passing boolean parameters to improve call-site clarity.
- Prefer extension functions over utility classes for adding behavior.
- Use `data class` for value types; use `object` for singletons.
- Declare nullable types only when `null` is a meaningful value; use the Elvis operator for defaults.
- Prefer immutable collection interfaces (`List`, `Map`) over mutable ones in public APIs.

## MUST

- Use data classes for DTOs and value objects
- Use sealed classes for restricted hierarchies
- Use coroutines for async operations
- Use extension functions for utilities
- Prefer immutability (val over var)
- Use null safety features (?., ?:, !!)

## MUST NOT

- Use !! without prior null check
- Use lateinit for nullable types
- Suppress warnings without justification
- Use Java-style getters/setters
- Block the main thread with runBlocking in production
- Use mutable collections in public APIs

## File Conventions

- *Test.kt for test files
- Multiple classes allowed per file if related
- Use PascalCase for classes
- Use camelCase for functions and properties
- Use SCREAMING_CASE for constants

## Testing

- Use JUnit 5 with Kotlin extensions
- Use MockK for mocking (Kotlin-native)
- Use Kotest for property-based testing
- Use Testcontainers for integration tests
