# Git Workflow Setup — Reference Templates

Used by Phase 8 (Step 8.2) of `omb-setup`. Contains hook scripts, CI workflow YAML, and
the canonical GitHub label table. Referenced via `@references/git-setup.md` or read directly.

---

## Shell Hook Templates

### `.git/hooks/pre-commit`

```bash
#!/usr/bin/env bash
set -euo pipefail

# oh-my-braincrew pre-commit hook
# Install: cp scripts/pre-commit .git/hooks/pre-commit && chmod +x .git/hooks/pre-commit

STAGED=$(git diff --cached --name-only --diff-filter=ACMR)

if [ -z "$STAGED" ]; then
  exit 0
fi

# Python block — include if Python detected
PY_FILES=$(echo "$STAGED" | grep '\.py$' || true)
if [ -n "$PY_FILES" ]; then
  echo "Running ruff..."
  echo "$PY_FILES" | xargs ruff check || exit 1
fi

# TypeScript/JavaScript block — include if TS/JS detected
TS_FILES=$(echo "$STAGED" | grep -E '\.(ts|tsx|js|jsx)$' || true)
if [ -n "$TS_FILES" ]; then
  echo "Running eslint..."
  echo "$TS_FILES" | xargs npx eslint --no-error-on-unmatched-pattern || exit 1
fi
```

After writing, run `chmod +x .git/hooks/pre-commit`.

Also store a copy at `scripts/pre-commit` and create `scripts/install-hooks.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail
# Install git hooks for this project
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cp "$SCRIPT_DIR/pre-commit" .git/hooks/pre-commit
chmod +x .git/hooks/pre-commit
echo "Git hooks installed."
```

Run `chmod +x scripts/install-hooks.sh` after writing.

### `.git/hooks/commit-msg`

```bash
#!/usr/bin/env bash
# oh-my-braincrew commit-msg hook — enforces conventional commit format
set -euo pipefail

COMMIT_MSG=$(cat "$1")
PATTERN='^(feat|fix|refactor|test|docs|chore|ci|perf|style|build)(\([a-z0-9-]+\))?: .{1,72}$'

if ! echo "$COMMIT_MSG" | grep -qE "$PATTERN"; then
  echo "ERROR: Commit message does not follow conventional commit format."
  echo "Expected: type(scope): description (max 72 chars)"
  echo "Types: feat, fix, refactor, test, docs, chore, ci, perf, style, build"
  echo ""
  echo "Your message: $COMMIT_MSG"
  exit 1
fi
```

Run `chmod +x .git/hooks/commit-msg` after writing.

---

## pre-commit Framework Config

### `.pre-commit-config.yaml`

```yaml
# oh-my-braincrew pre-commit configuration
repos:
  # Python block — include if Python detected
  - repo: https://github.com/astral-sh/ruff-pre-commit
    rev: v0.4.0
    hooks:
      - id: ruff
        args: [--fix]
      - id: ruff-format

  # TypeScript/JavaScript block — include if TS/JS detected
  - repo: local
    hooks:
      - id: eslint
        name: eslint
        entry: npx eslint
        language: node
        types_or: [javascript, ts, tsx]
        pass_filenames: true
```

After writing, run `pre-commit install` and report the result.

---

## GitHub Actions Workflow Templates

### PR CI — delegate to CI sub-skills

For PR CI workflows, invoke the appropriate CI sub-skill based on detected stack:
- Python: `Skill("omb-ci-python")` → `.github/workflows/ci-python.yml`
- TypeScript: `Skill("omb-ci-typescript")` → `.github/workflows/ci-typescript.yml`
- Infra: `Skill("omb-ci-infra")` → `.github/workflows/ci-infra.yml`

Fallback inline templates if CI sub-skills are unavailable:

**Python CI** (`.github/workflows/ci-python.yml`):
```yaml
name: Python CI
on:
  pull_request:
    branches: [main]
jobs:
  lint-test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: "3.12"
      - run: pip install ruff pytest
      - run: ruff check .
      - run: pytest tests/ -v
```

**TypeScript CI** (`.github/workflows/ci-typescript.yml`):
```yaml
name: TypeScript CI
on:
  pull_request:
    branches: [main]
jobs:
  lint-test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "20"
          cache: npm
      - run: npm ci
      - run: npx eslint .
      - run: npx tsc --noEmit
      - run: npx vitest run
```

### Commit Lint (`.github/workflows/commit-lint.yml`)

```yaml
name: Commit Lint
on:
  pull_request:
    types: [opened, synchronize, edited]
jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - name: Check PR title
        uses: amannn/action-semantic-pull-request@v5
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        with:
          types: |
            feat
            fix
            refactor
            test
            docs
            chore
            ci
            perf
            style
            build
```

### Slack Notifications (`.github/workflows/notify-slack.yml`)

```yaml
name: Slack Notifications
on:
  pull_request:
    types: [opened, closed, ready_for_review]
  issues:
    types: [opened, closed]
jobs:
  notify:
    runs-on: ubuntu-latest
    steps:
      - name: Send Slack notification
        uses: slackapi/slack-github-action@v1.26.0
        with:
          payload: |
            {
              "text": "[${{ github.repository }}] ${{ github.event_name }}: ${{ github.event.pull_request.title || github.event.issue.title }}",
              "attachments": [{ "color": "good", "text": "${{ github.event.pull_request.html_url || github.event.issue.html_url }}" }]
            }
        env:
          SLACK_WEBHOOK_URL: ${{ secrets.SLACK_WEBHOOK_URL }}
          SLACK_WEBHOOK_TYPE: INCOMING_WEBHOOK
```

After writing: remind the user to add `SLACK_WEBHOOK_URL` to GitHub Secrets
(`Repository → Settings → Secrets and variables → Actions → New repository secret`).

---

## Canonical GitHub Label Table

Use `gh label create "{name}" --color "{color}" --description "{description}" --force` for each.
The `--force` flag is idempotent: creates if missing, updates if different.

| Label | Color | Description |
|-------|-------|-------------|
| `Feature` | `a2eeef` | New feature or capability |
| `Bugfix` | `d73a4a` | Bug fix |
| `Refactor` | `f9d0c4` | Code restructuring |
| `Test` | `bfd4f2` | Test additions or modifications |
| `Docs` | `0075ca` | Documentation only |
| `Chore` | `cfd3d7` | Maintenance, dependency updates |
| `CI` | `e6e6e6` | CI/CD pipeline changes |
| `Improvements` | `fbca04` | Performance and quality improvements |
| `Style` | `c5def5` | Code style/formatting |
| `Build` | `d4c5f9` | Build system changes |

Report a sync result table after running (Created / Updated / Up-to-date per label).
