---
paths: "**/*.java,**/pom.xml,**/build.gradle,**/build.gradle.kts"
---

# Java Rules

Version: Java 21 LTS

## Tooling

- Build: Maven or Gradle
- Linting: Checkstyle, SpotBugs
- Testing: JUnit 5, Mockito
- Coverage: JaCoCo >= 85%

## Foundational Standards

Canonical: Google Java Style Guide — https://google.github.io/styleguide/javaguide.html

- Use 2-space indentation; never tabs.
- Limit lines to 100 columns.
- Declare one top-level class per file.
- Always use braces for blocks, even for single-statement `if`/`else`/`for` bodies.
- Do not use wildcard imports (`import java.util.*`).
- Use `PascalCase` for class and interface names; `camelCase` for methods and fields.
- Use `UPPER_SNAKE_CASE` for constants (`static final` fields).
- Use all-lowercase reverse-DNS notation for package names (e.g., `com.example.auth`).
- Declare fields before constructors and methods within a class.
- Mark fields and local variables `final` wherever possible to prefer immutability.
- Add the `@Override` annotation whenever a method overrides a superclass method.
- Write Javadoc on all public classes, methods, and fields.

## MUST

- Use records for immutable data classes
- Use pattern matching with switch expressions
- Use virtual threads for concurrent I/O operations
- Close resources with try-with-resources
- Use Optional for nullable return values
- Document public APIs with Javadoc

## MUST NOT

- Use raw types (always parameterize generics)
- Catch Exception or Throwable (catch specific exceptions)
- Use null for empty collections (return empty collection)
- Ignore InterruptedException
- Use public fields (use accessors or records)
- Store secrets in source code

## File Conventions

- *Test.java for test files
- One public class per file
- Package name matches directory structure
- Use PascalCase for classes
- Use camelCase for methods and variables

## Testing

- Use JUnit 5 with @ParameterizedTest
- Use Mockito for mocking
- Use AssertJ for fluent assertions
- Use Testcontainers for integration tests
