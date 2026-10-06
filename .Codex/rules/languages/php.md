---
paths: "**/*.php,**/composer.json,**/composer.lock"
---

# PHP Rules

Version: PHP 8.3+

## Tooling

- Package management: Composer
- Linting: PHP_CodeSniffer, PHPStan level 9
- Formatting: PHP-CS-Fixer
- Testing: PHPUnit >= 85% coverage

## Foundational Standards

Canonical: PSR-12 Extended Coding Style — https://www.php-fig.org/psr/psr-12/

- Begin every PHP file with `<?php` on its own line; never use the short tag `<?`.
- Add `declare(strict_types=1);` immediately after the opening `<?php` tag.
- Use 4-space indentation; never tabs.
- Place the opening brace of a class or method on its own line (Allman style).
- Use `PascalCase` for class, interface, trait, and enum names.
- Use `camelCase` for method names.
- Use `SCREAMING_SNAKE_CASE` for constants.
- Always declare visibility (`public`, `protected`, `private`) on every method and property.
- Place a blank line after the `namespace` declaration.
- Group `use` import statements together after the namespace; separate groups with a blank line.
- Place one class, interface, or trait per file.
- Keep trait usage minimal; prefer composition.

## MUST

- Use strict types (declare(strict_types=1))
- Use typed properties and return types
- Use constructor property promotion
- Use named arguments for clarity
- Use readonly properties for immutability
- Handle exceptions with proper types

## MUST NOT

- Use @ error suppression operator
- Use global variables
- Mix HTML and PHP logic directly
- Use deprecated functions
- Ignore PHPStan errors
- Store credentials in code

## File Conventions

- *Test.php for test files
- PSR-4 autoloading structure
- Use PascalCase for classes
- Use camelCase for methods
- One class per file

## Testing

- Use PHPUnit with data providers
- Use Mockery or PHPUnit mocks
- Use Pest for expressive tests
- Use database transactions for isolation
