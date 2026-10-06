# samples — Smoke Test Fixtures

Three template-family smoke test fixtures for the `omb-setup` v2 CLAUDE.md generator.
Each subdirectory covers one of the three major stack families supported by the harness.

## Fixture Index

| Directory | Template | Stack Family | Overall Result |
|-----------|----------|-------------|----------------|
| `fastapi/` | fastapi | Python backend | ALL PASS |
| `react/` | react | TypeScript frontend | ALL PASS |
| `fullstack-ai/` | fullstack-ai | LangGraph AI | ALL PASS |

## Per-Fixture File Inventory

Each subdirectory contains:

| File | Description |
|------|-------------|
| Project files | Minimal stack-representative source (see table below) |
| `answers.json` | Non-interactive answers for the template's `omb-setup` run |
| `expected-CLAUDE.md` | Hand-constructed expected CLAUDE.md output per v2 schema |
| `SMOKE_RESULT.md` | Static check results (7 checks) recorded by harness-implement |

### Project Files per Fixture

| Fixture | Project Files |
|---------|--------------|
| `fastapi/` | `pyproject.toml` — declares `fastapi`, `pytest`, `ruff`, `pyright` |
| `react/` | `package.json` — Vite + React TS with `dev`/`test`/`lint`/`typecheck`/`build` scripts |
| `fullstack-ai/` | `package.json` — Turborepo root with `workspaces: ["apps/*"]`; `apps/ai/pyproject.toml` — declares `langgraph`, `langchain-core`, `langchain-anthropic` |

## Static Check Summary (7 checks per fixture)

| # | Check | fastapi | react | fullstack-ai |
|---|-------|---------|-------|-------------|
| 1 | Line count ≤ 150 | 66 PASS | 62 PASS | 68 PASS |
| 2 | No legacy AUTO-GENERATED markers (= 0) | 0 PASS | 0 PASS | 0 PASS |
| 3 | No `{{` placeholders | 0 PASS | 0 PASS | 0 PASS |
| 4 | No forbidden sections | 0 PASS | 0 PASS | 0 PASS |
| 5 | `- [HARD]` lines ≥ 5 | 7 PASS | 6 PASS | 8 PASS |
| 6 | OMB_DOCUMENTATION_LANGUAGE = 1 | 1 PASS | 1 PASS | 1 PASS |
| 7 | `.claude/rules/git/` reference ≥ 1 | 1 PASS | 1 PASS | 1 PASS |

**All 3 fixtures × 7 checks = 21 checks: ALL PASS**

## Key Differences Between Fixtures

### fastapi
- Python-only project (`pyproject.toml` only, no `package.json`)
- HOW commands use Python-native tooling: `uvicorn`, `pytest`, `ruff check .`, `pyright`, `docker build`
- 1 project-specific HARD rule (DB session factory)
- Extra slot: `DB migrate / alembic upgrade head`

### react
- TypeScript SPA (`package.json` only, no Python files)
- HOW commands use npm scripts: `npm run dev`, `npx vitest run`, `npx eslint .`, `npx tsc --noEmit`, `npm run build`
- **No project-specific HARD rules** — `Project-specific:` sub-block omitted entirely (including sub-header)
- **No extra slot row** — HOW table has exactly 5 standard rows

### fullstack-ai
- Turborepo monorepo with `workspaces: ["apps/*"]`; Python AI service at `apps/ai/`
- HOW commands use Turbo: `turbo dev`, `turbo test`, `turbo lint`, `turbo typecheck`, `turbo build`
- 2 project-specific HARD rules (LangGraph state + LLM response sanitization)
- Extra slot: `LangGraph dev / cd apps/ai && langgraph dev`
- WHAT section reflects 3-app structure: `apps/api/src/`, `apps/ai/src/`, `apps/web/src/`

## Verification Commands

To re-verify any fixture locally:

```bash
cd .claude/skills/omb-setup/tests/fixtures/samples/<fixture>

# Run all 7 static checks
wc -l expected-CLAUDE.md
grep -c "AUTO-GENERATED" expected-CLAUDE.md
grep "{{" expected-CLAUDE.md | wc -l
grep -cE "omb Commands|Worktree Management|\.omb/ Directory|Testing Strategy|Commit Conventions|Error Handling|Quality Gates" expected-CLAUDE.md || echo 0
grep -c "^- \[HARD\]" expected-CLAUDE.md
grep -c "OMB_DOCUMENTATION_LANGUAGE" expected-CLAUDE.md
grep -c "\.claude/rules/git/" expected-CLAUDE.md
```

Expected outputs: `≤150`, `0`, `0`, `0`, `≥5`, `1`, `≥1`

## Change History

- **2026-04-18**: Legacy `<!-- AUTO-GENERATED -->` markers (5 plain + 1 START/END pair) removed from
  the v2 template. Check 2 replaced with a negative-invariant check (`grep -c "AUTO-GENERATED" = 0`).
  Line counts dropped by 7 lines per fixture.
- **2026-08-31**: Added a new Universal `- [HARD]` rule ("Run only diff-targeted tests during
  development...") to the generated-CLAUDE.md template (`reference.md` Section 2) per the
  diff-targeted-test-execution SSOT (`.claude/rules/testing/test-execution.md`). Line counts and
  `- [HARD]` counts both increase by 1 per fixture (fastapi 65→66, react 61→62, fullstack-ai 67→68;
  HARD rules 6→7, 5→6, 7→8).
