---
description: PR creation rules and conventions
paths: [".omb/**", ".claude/skills/**", ".claude/agents/**", ".claude/rules/**", ".github/**"]
---

# PR Creation Rules

## Required Previous Step

`omb:pr` follows `omb:doc`.

Before creating a PR, confirm documentation status:

- `omb:doc` completed, or was explicitly skipped with rationale.
- `omb:wiki` was run inside `omb:doc`, run separately, or marked not applicable with rationale.
- Any docs or wiki blockers are resolved.

If documentation or wiki work remains incomplete, stop PR creation and return to `omb:doc` or `omb:wiki`.

## Branch Naming

PR source branches must follow `{type}/{short-kebab-description}`.

Valid types: `feat`, `fix`, `refactor`, `test`, `docs`, `chore`, `ci`, `perf`, `style`, `build`.

See `git/branch-naming.md` for full rules and examples.

## Conventional Commits

Format: `type(scope): description`.

Examples:

- `feat(auth): add OAuth2 login flow`
- `fix(api): handle null response from payment provider`
- `refactor(db): migrate to SQLAlchemy 2.0 async syntax`

Breaking changes require `BREAKING CHANGE:` in the commit footer.

For detailed commit message structure, see `git/commit-template.md`.

## Language Support

PR body language follows `OMB_DOCUMENTATION_LANGUAGE`.

- `en` default: English headers and body text.
- `ko`: Korean headers and body text. Technical terms, file paths, commands, and code references stay in English.
- PR title is always English in conventional commit format.

<!-- Keep in sync with .claude/agents/omb/git-commit.md <pr_template>. -->

## Required PR Sections

Always include these sections, localized when `OMB_DOCUMENTATION_LANGUAGE` requires it.

```markdown
## Context Block

| Key | Value |
|-----|-------|
| Type | {feat/fix/refactor/...} |
| Scope | {module or area} |
| Base | {base branch} |
| Branch | {source branch} |
| Diff | +{additions} / -{deletions} |
| Files | {N} changed |

## Summary

- WHAT: {concrete description of what changed}
- WHY: {problem or requirement that triggered this}
- HOW: {key design choice or approach}
- IMPACT: {affected consumers or services}
- RISK: {Low/Medium/High with justification}

## Motivation / Context

### Problem Statement
{What was wrong, broken, or missing.}

### Trigger
{Issue, audit, user report, incident, or explicit request.}

### Prior State
{How things worked before this change.}

## Changes

| File | Action | Description | Design Rationale |
|------|--------|-------------|------------------|
| `{path}` | Add/Modify/Delete | {what changed} | {why this approach} |

## Test Plan

| # | Type | Command | Expected Result | Status |
|---|------|---------|-----------------|--------|
| 1 | {Unit/Integration/Manual/Lint/Type} | `{command}` | {expected} | {pass/pending} |

## Related Issues
{Closes #N, Refs #N, or "None"}

## Checklist
- [ ] Branch name follows naming convention.
- [ ] Commit messages follow the conventional commit template.
- [ ] Type check passes.
- [ ] Linter passes.
- [ ] No secrets committed.
- [ ] Documentation updated if needed.
- [ ] No unrelated changes bundled.
- [ ] Impact analysis completed when needed.
- [ ] Rollback strategy documented when risk is Medium or High.
```

## Optional Sections

Include only when the condition is met.

- Dependency and Impact Analysis: required when the diff touches public APIs, shared modules, config, or DB schemas.
- Rollback Strategy: required when risk is Medium or High.
- Architecture: required when the diff touches three or more directories or adds new modules/APIs; use a small Mermaid diagram.
- Screenshots: required when the diff modifies UI components, CSS, or visual output.
- Breaking Changes: required when API signatures change, exports are removed, or defaults change.
- Reviewer Notes: use for non-obvious decisions or trade-offs.

## Changelog Format

```markdown
## [version] - YYYY-MM-DD
### Added
### Changed
### Fixed
### Removed
```

## PR Review Checklist

- PR title follows conventional commit format.
- Branch name follows naming convention.
- Description explains why, not just what.
- PR has one logical responsibility.
- No unrelated changes are bundled.
- All CI checks pass before review.
- Draft PR is used while work is still in progress.
- Ideal PR size is under 400 changed lines; over 800 changed lines needs justification.
