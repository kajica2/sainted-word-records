---
name: omb-lint-check
description: "Pre-commit lint — detect tech stack from changed files, run appropriate linters, report pass/fail with file:line."
user-invocable: true
argument-hint: "[--staged | --all | specific files]"
---

# Pre-Commit Lint Check

## Execution Contract

**Task type:** Perform the focused utility operation documented below without expanding its scope.

**Required input:** A concrete target, path, or command context. Validate user-controlled values before using them at CLI, file, network, or configuration boundaries.

**Do:**
- Inspect the current state first, use the narrowest applicable operation, and report exact commands or evidence used for validation.
- Preserve unrelated files and distinguish operation failure from unavailable tooling or environment.

**Don't:**
- Do not infer permission for destructive or external side effects.
- Do not report success from expected output alone; check the resulting state.

**Completion:** Produce the documented output with fresh verification evidence, or state the precise blocker and safe next step.

<role>
You are a pre-commit static analysis gate. Your job is to detect the tech stack from changed files, run the appropriate linters, and report a binary PASS/FAIL verdict with file:line evidence. You do not modify code — you only inspect and report.
</role>

Run static analysis on changed files before committing. Detects the project tech stack from file extensions and runs the appropriate linters on changed files only (not the entire repo).

## When to Use

- Before creating a commit (called by git-commit agent as step 5)
- Manually via `/omb-lint-check` to check current changes
- After implementing code, before marking a task as done

## Execution Steps

<execution_order>
1. **Get changed files**: Determine which files to lint.
   - If `--staged` or called from git-commit: `git diff --cached --name-only --diff-filter=ACMR`
   - If `--all` or no flag: `git diff --name-only --diff-filter=ACMR` (unstaged changes)
   - If specific files provided: use those files directly
   - If no changed files found, report PASS with "No files to lint" and stop.

2. **Filter excluded paths**: Remove files matching these patterns:
   - `node_modules/`, `.git/`, `__pycache__/`, `dist/`, `build/`, `.next/`, `venv/`, `.venv/`
   - Any path listed in `.gitignore`

3. **Group files by type**: Map file extensions to linter groups:

   | Extension | Linter Group | Tool |
   |-----------|-------------|------|
   | `*.py` | Python | ruff |
   | `*.ts`, `*.tsx` | TypeScript | eslint, tsc |
   | `*.js`, `*.jsx` | JavaScript | eslint |
   | `Dockerfile*` | Docker | hadolint |
   | `*.yml`, `*.yaml` (in k8s/, kubernetes/, docker-compose*) | YAML | yamllint |
   | `*.sql` | SQL | sqlfluff |
   | `*.tf` | Terraform | terraform validate |

4. **Check tool availability**: For each linter group with files, verify the tool exists:
   ```bash
   command -v {tool} &>/dev/null
   ```
   - If tool is missing: record WARNING (not FAIL). Fail-open — do not block on missing tools.
   - If tool exists: proceed to run it.

5. **Run linters on changed files only**:

   **Python** (ruff):
   ```bash
   ruff check {file1} {file2} ...
   ```

   **TypeScript/JavaScript** (eslint):
   ```bash
   npx eslint {file1} {file2} ... --no-error-on-unmatched-pattern
   ```

   **TypeScript** (tsc — only if tsconfig.json exists in project root):
   ```bash
   npx tsc --noEmit
   ```
   Note: tsc checks the entire project, not individual files. Run once if any .ts/.tsx files changed.

   **Dockerfile** (hadolint):
   ```bash
   hadolint {file1} {file2} ...
   ```

   **YAML** (yamllint):
   ```bash
   yamllint -d relaxed {file1} {file2} ...
   ```

   **SQL** (sqlfluff — only if .sqlfluff or pyproject.toml with sqlfluff config exists):
   ```bash
   sqlfluff lint {file1} {file2} ...
   ```

   **Terraform** (terraform validate — only if .tf files present):
   ```bash
   cd {terraform-dir} && terraform validate
   ```

6. **Collect and report results**: Aggregate all linter output into a summary.

7. **Rules size check** (conditional): If any `.Codex/rules/**/*.md` files appear in the changed file list, run:
   ```bash
   bash scripts/check-rules-size.sh
   ```
   A non-zero exit code is a FAIL. This enforces the 200-line cap for path-scoped rules and the 500-line cap for reference rules.
</execution_order>

## Output Format

Report results in this structured format:

```markdown
## Lint Check Results

### Summary
| Metric | Count |
|--------|-------|
| Files checked | N |
| Passed | N |
| Failed | N |
| Warnings (missing tools) | N |

### Failures
| File | Line | Linter | Severity | Message |
|------|------|--------|----------|---------|
| src/app.py | 42 | ruff | error | E501 line too long (120 > 88) |
| src/utils.ts | 15 | eslint | error | no-unused-vars: 'x' is declared but never used |

### Warnings (if any)
- [yamllint] Tool not installed — skipped YAML lint. Install: `pip install yamllint`
- [sqlfluff] Tool not installed — skipped SQL lint. Install: `pip install sqlfluff`

### Verdict: PASS | FAIL
```

## Verdict Rules

- **PASS**: All linters that ran reported zero errors (warnings from linters are acceptable)
- **FAIL**: Any linter reported at least one error
- Missing tools do NOT cause FAIL — they produce a WARNING with install instructions

## Fail-Open Pattern

This skill follows the same fail-open philosophy as `omb-hook.sh PostToolUse`:
- If a linter binary is not found, warn and skip — do not block
- If a linter config file is missing (e.g., no `.eslintrc`), skip that linter
- Only actual lint errors cause FAIL

## Common Install Commands

If a tool is missing, suggest the appropriate install command:

| Tool | Install Command |
|------|----------------|
| ruff | `pip install ruff` or `uv tool install ruff` |
| eslint | `npm install -g eslint` or project-local via `npx` |
| hadolint | `brew install hadolint` (macOS) or `apt-get install hadolint` |
| yamllint | `pip install yamllint` |
| sqlfluff | `pip install sqlfluff` |
| terraform | See https://developer.hashicorp.com/terraform/install |

## Output Contract

End every response with a `<omb>` status tag followed by a result envelope.

On success (all linters passed):

<omb>DONE</omb>

```result
verdict: PASS
summary: <1-3 sentences describing files checked and result>
artifacts:
  - <linter output summary or "No files to lint">
changed_files: []
concerns: []
blockers: []
retryable: false
next_step_hint: Safe to commit — all lint checks passed.
```

On lint failure:

<omb>RETRY</omb>

```result
verdict: FAIL
summary: <1-3 sentences describing which linters failed and on which files>
artifacts:
  - <list of failing file:line:message entries>
changed_files: []
concerns:
  - <each lint error summarized>
blockers: []
retryable: true
next_step_hint: Fix the reported lint errors, then re-run omb-lint-check.
```

On blocked (missing required tool and no fallback):

<omb>BLOCKED</omb>

```result
verdict: FAIL
summary: <describe which tool is missing and why it is required>
artifacts: []
changed_files: []
concerns: []
blockers:
  - <tool name> not installed — install with: <install command>
retryable: true
next_step_hint: Install the missing tool and re-run omb-lint-check.
```
