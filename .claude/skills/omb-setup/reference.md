# omb-setup Reference

Reference material for the `omb-setup` skill. Contains templates, schemas, explore prompts, and merge strategy.

---

## Section 1: Templates

All 6 project templates with full directory trees, dependency lists, and configuration details.

### fastapi

```
<project-name>/
├── src/
│   └── api/
│       ├── __init__.py
│       ├── main.py              # FastAPI app entry point
│       ├── config.py            # Settings via pydantic-settings
│       ├── dependencies.py      # Shared dependencies
│       └── routers/
│           ├── __init__.py
│           └── health.py        # Health check endpoint
├── tests/
│   ├── __init__.py
│   ├── conftest.py              # Fixtures (TestClient, DB session)
│   └── test_health.py
├── alembic/
│   ├── env.py
│   ├── script.py.mako
│   └── versions/
├── alembic.ini
├── pyproject.toml               # Project metadata, dependencies, tool config
├── Dockerfile                   # Multi-stage build
├── docker-compose.yml           # App + PostgreSQL + Redis
├── .dockerignore
├── .github/
│   └── workflows/
│       └── ci.yml               # Generated via omb-ci-python skill
├── .gitignore
├── .env.example
└── CLAUDE.md
```

Key configuration in `pyproject.toml`:
- Build system: hatchling
- Dependencies: fastapi, uvicorn, pydantic-settings, sqlalchemy, alembic
- Dev dependencies: pytest, pytest-cov, pytest-asyncio, ruff, pyright, httpx
- Ruff config: line-length 100, select rules (E, F, I, UP, B, SIM)
- Pyright: strict mode

### react

```
<project-name>/
├── src/
│   ├── components/
│   │   └── ui/                  # Reusable UI primitives
│   ├── hooks/
│   │   └── use-media-query.ts   # Example custom hook
│   ├── pages/
│   │   └── home.tsx
│   ├── lib/
│   │   └── utils.ts             # Utility functions
│   ├── styles/
│   │   └── globals.css          # Tailwind directives
│   ├── types/
│   │   └── index.ts             # Shared type definitions
│   ├── App.tsx
│   ├── main.tsx                 # Entry point
│   └── vite-env.d.ts
├── public/
│   └── favicon.svg
├── index.html
├── package.json
├── tsconfig.json
├── tsconfig.node.json
├── vite.config.ts
├── vitest.config.ts
├── tailwind.config.ts
├── postcss.config.js
├── eslint.config.js             # Flat config
├── .github/
│   └── workflows/
│       └── ci.yml               # Generated via omb-ci-typescript skill
├── .gitignore
└── CLAUDE.md
```

Key dependencies:
- react, react-dom, react-router-dom
- tailwindcss, postcss, autoprefixer
- Dev: typescript, vite, vitest, @testing-library/react, eslint, @typescript-eslint/parser

### electron

```
<project-name>/
├── src/
│   ├── main/
│   │   ├── index.ts             # Main process entry
│   │   ├── window.ts            # Window management
│   │   └── ipc.ts               # IPC handlers
│   ├── renderer/
│   │   ├── index.html
│   │   ├── main.tsx             # Renderer entry point
│   │   ├── App.tsx
│   │   ├── components/
│   │   ├── hooks/
│   │   └── styles/
│   │       └── globals.css
│   └── preload/
│       └── index.ts             # Context bridge
├── resources/
│   └── icon.png
├── package.json
├── tsconfig.json
├── tsconfig.node.json
├── vite.config.ts               # Renderer bundling
├── electron-builder.config.js   # Build/packaging config
├── eslint.config.js
├── vitest.config.ts
├── .github/
│   └── workflows/
│       └── ci.yml
├── .gitignore
└── CLAUDE.md
```

Key dependencies:
- electron, electron-builder
- vite, @vitejs/plugin-react
- Dev: typescript, vitest, eslint

`electron-builder.config.js` should include:
- appId, productName, directories (output: dist-electron)
- macOS: dmg + zip targets
- Windows: nsis target
- Linux: AppImage + deb targets

### fullstack

```
<project-name>/
├── apps/
│   ├── api/                     # FastAPI backend (fastapi template)
│   │   ├── src/api/
│   │   ├── tests/
│   │   ├── alembic/
│   │   ├── pyproject.toml
│   │   └── Dockerfile
│   └── web/                     # React frontend (react template)
│       ├── src/
│       ├── package.json
│       ├── vite.config.ts
│       └── vitest.config.ts
├── packages/
│   └── shared/                  # Shared types/constants
│       ├── src/
│       │   └── index.ts
│       ├── package.json
│       └── tsconfig.json
├── infra/
│   ├── docker-compose.yml       # Full stack compose
│   └── terraform/               # Optional IaC
├── package.json                 # Workspace root (npm workspaces)
├── turbo.json                   # Turborepo config
├── .github/
│   └── workflows/
│       ├── ci-api.yml
│       └── ci-web.yml
├── .gitignore
└── CLAUDE.md
```

The root `package.json` uses npm workspaces pointing to `apps/*` and `packages/*`. `turbo.json` defines the task pipeline (lint, test, build).

### fullstack-ai

```
<project-name>/
├── apps/
│   ├── api/                         # FastAPI backend
│   │   ├── src/api/
│   │   │   ├── __init__.py
│   │   │   ├── main.py              # FastAPI app entry point
│   │   │   ├── config.py            # Settings via pydantic-settings
│   │   │   ├── dependencies.py      # Shared dependencies (DB session, etc.)
│   │   │   ├── routers/
│   │   │   │   ├── __init__.py
│   │   │   │   ├── health.py        # Health check endpoint
│   │   │   │   └── chat.py          # AI chat endpoint (streaming)
│   │   │   └── models/
│   │   │       ├── __init__.py
│   │   │       └── base.py          # SQLAlchemy Base + mixins
│   │   ├── tests/
│   │   │   ├── __init__.py
│   │   │   ├── conftest.py          # Fixtures (TestClient, DB session, mock LLM)
│   │   │   ├── test_health.py
│   │   │   └── test_chat.py
│   │   ├── alembic/
│   │   │   ├── env.py
│   │   │   ├── script.py.mako
│   │   │   └── versions/
│   │   ├── alembic.ini
│   │   ├── pyproject.toml
│   │   └── Dockerfile
│   ├── ai/                          # LangGraph AI service
│   │   ├── src/<package_name>/
│   │   │   ├── __init__.py
│   │   │   ├── graph.py             # StateGraph definition + .compile()
│   │   │   ├── state.py             # State schemas (TypedDict + add_messages)
│   │   │   ├── tools.py             # @tool definitions
│   │   │   ├── context.py           # Runtime config @dataclass
│   │   │   ├── prompts.py           # System prompt constants
│   │   │   └── utils.py             # Helper utilities
│   │   ├── tests/
│   │   │   ├── __init__.py
│   │   │   ├── conftest.py          # Fixtures (graph instance, mock tools)
│   │   │   └── test_graph.py
│   │   ├── langgraph.json           # LangGraph CLI configuration
│   │   ├── pyproject.toml
│   │   └── Dockerfile
│   └── web/                         # React TypeScript frontend
│       ├── src/
│       │   ├── components/
│       │   │   └── ui/              # Reusable UI primitives
│       │   ├── hooks/
│       │   │   ├── use-media-query.ts
│       │   │   └── use-chat.ts      # AI chat hook (streaming)
│       │   ├── pages/
│       │   │   └── home.tsx
│       │   ├── lib/
│       │   │   ├── utils.ts
│       │   │   └── api-client.ts    # Typed API client
│       │   ├── styles/
│       │   │   └── globals.css      # Tailwind directives
│       │   ├── types/
│       │   │   └── index.ts         # Shared type definitions
│       │   ├── App.tsx
│       │   ├── main.tsx
│       │   └── vite-env.d.ts
│       ├── public/
│       │   └── favicon.svg
│       ├── index.html
│       ├── package.json
│       ├── tsconfig.json
│       ├── tsconfig.node.json
│       ├── vite.config.ts
│       ├── vitest.config.ts
│       ├── tailwind.config.ts
│       ├── postcss.config.js
│       └── eslint.config.js
├── packages/
│   └── shared/                      # Shared types/constants
│       ├── src/
│       │   └── index.ts
│       ├── package.json
│       └── tsconfig.json
├── infra/
│   ├── docker-compose.yml           # Full stack: API + AI + Web + PostgreSQL + Redis
│   └── terraform/                   # Optional IaC
├── package.json                     # Workspace root (npm workspaces)
├── turbo.json                       # Turborepo config
├── .github/
│   └── workflows/
│       ├── ci-api.yml
│       ├── ci-ai.yml
│       └── ci-web.yml
├── .gitignore
├── .env.example
└── CLAUDE.md
```

Monorepo with 3 apps:
- **apps/api**: FastAPI backend with SQLAlchemy 2.0 async ORM, Alembic migrations, PostgreSQL
- **apps/ai**: LangGraph AI service with StateGraph, tools, and prompts
- **apps/web**: React TypeScript frontend with Vite, Tailwind, streaming chat support

Key configuration:
- Root `package.json` uses npm workspaces pointing to `apps/web`, `packages/*`
- `turbo.json` defines task pipeline (lint, test, build) for JS/TS packages
- Python apps (api, ai) managed independently via `pyproject.toml` each
- `docker-compose.yml` orchestrates all services + PostgreSQL + Redis

**apps/api/pyproject.toml**:
- Build system: hatchling
- Dependencies: fastapi, uvicorn, pydantic-settings, sqlalchemy[asyncio], asyncpg, alembic, redis
- Dev dependencies: pytest, pytest-cov, pytest-asyncio, ruff, pyright, httpx

**apps/ai/pyproject.toml**:
- Build system: hatchling
- Dependencies: use versions from `omb-langchain` skill (`references/dependencies.md`)
- Dev dependencies: pytest, pytest-cov, pytest-asyncio, ruff, pyright, `langgraph-cli[inmem]`

**apps/web/package.json**:
- Dependencies: react, react-dom, react-router-dom
- Dependencies: tailwindcss, postcss, autoprefixer
- Dev: typescript, vite, vitest, @testing-library/react, eslint, @typescript-eslint/parser

**apps/ai/langgraph.json**:
```json
{
  "dependencies": ["."],
  "graphs": {
    "agent": "./src/<package_name>/graph.py:graph"
  },
  "env": "../.env"
}
```

### langgraph

```
<project-name>/
├── src/<package_name>/
│   ├── __init__.py
│   ├── graph.py           # StateGraph definition + .compile()
│   ├── state.py           # State schemas (TypedDict + add_messages)
│   ├── tools.py           # @tool definitions
│   ├── context.py         # Runtime config @dataclass
│   ├── prompts.py         # System prompt constants
│   └── utils.py           # Helper utilities
├── tests/
│   ├── __init__.py
│   ├── conftest.py        # Fixtures (graph instance, mock tools)
│   └── test_graph.py
├── langgraph.json         # LangGraph configuration (required for CLI)
├── pyproject.toml         # Project metadata, dependencies, tool config
├── Makefile               # test, lint, format, dev commands
├── Dockerfile             # Multi-stage build
├── .env.example           # API keys template
├── .gitignore
└── CLAUDE.md
```

Key configuration in `langgraph.json`:
```json
{
  "dependencies": ["."],
  "graphs": {
    "agent": "./src/<package_name>/graph.py:graph"
  },
  "env": ".env"
}
```

Key configuration in `pyproject.toml`:
- Build system: hatchling
- Dependencies: use versions from `omb-langchain` skill (`references/dependencies.md`)
- Dev dependencies: pytest, pytest-cov, pytest-asyncio, ruff, pyright, `langgraph-cli[inmem]`
- Ruff config: line-length 100, select rules (E, F, I, UP, B, SIM)
- Pyright: strict mode

### langgraph-multi

```
<project-name>/
├── src/
│   ├── orchestrator/          # Main orchestrator graph
│   │   ├── __init__.py
│   │   ├── agent.py           # Orchestrator StateGraph + .compile()
│   │   ├── state.py           # Orchestrator state schema
│   │   ├── prompt.py          # Orchestrator system prompt
│   │   └── tools.py           # Orchestrator tools
│   ├── agents/                # Subagent modules
│   │   ├── __init__.py
│   │   └── <agent_name>/      # One directory per subagent
│   │       ├── __init__.py
│   │       ├── agent.py       # Subagent graph + .compile()
│   │       ├── state.py       # Subagent state schema
│   │       ├── prompt.py      # Subagent system prompt
│   │       └── tools.py       # Subagent tools
│   └── shared/                # Shared utilities across agents
│       ├── __init__.py
│       ├── models.py          # Shared Pydantic models / schemas
│       └── config.py          # Shared configuration
├── tests/
│   ├── __init__.py
│   ├── conftest.py
│   ├── test_orchestrator.py
│   └── test_<agent_name>.py
├── langgraph.json             # Multiple graph endpoints
├── pyproject.toml
├── Makefile
├── Dockerfile
├── .env.example
├── .gitignore
└── CLAUDE.md
```

Key configuration in `langgraph.json`:
```json
{
  "dependencies": ["."],
  "graphs": {
    "orchestrator": "./src/orchestrator/agent.py:graph",
    "<agent_name>": "./src/agents/<agent_name>/agent.py:graph"
  },
  "env": ".env"
}
```

---

## Section 2: Shared Policy Template

Select the target using SKILL.md Phase 7.1 before rendering. For SHARED CREATE and
SHARED UPDATE, write the policy body below to AGENTS.md. Root CLAUDE.md is a thin
active bridge, with any existing Claude-specific content preserved below it:

```markdown
@AGENTS.md
```

If `.claude/CLAUDE.md` already imports the root shared file, preserve that integration
instead of adding a duplicate root import. Never copy this bridge into AGENTS.md.

For LEGACY UPDATE only, render the policy body in the existing CLAUDE file using
Section 5's v1/v2 migration rules. Preserve the existing commented/removed bridge choice.
Legacy sample fixtures remain examples of this compatibility mode, not fresh defaults.
Shared-mode merging preserves unknown sections and custom rules; header replacement
must not discard user content. QA and line counts target the selected policy file.

```markdown
<!-- omb:setup v2 | {{date}} -->

# {{project_name}}

## WHY
{{project_purpose}}
<!-- 1-3줄: 프로젝트 목적, 주 사용자, 핵심 기술 제약 -->

## WHAT
- `src/` — {{role}}
- `tests/` — {{role}}
- `docs/` — human documentation
- `openwiki/` — project blueprint (machine-consumable)
- `.claude/rules/` — detailed conventions (progressive disclosure)

## HOW
| Purpose   | Command |
|-----------|---------|
| Dev       | {{dev_cmd}} |
| Test      | {{test_cmd}} |
| Lint      | {{lint_cmd}} |
| Typecheck | {{typecheck_cmd}} |
| Build     | {{build_cmd}} |
| {{project_slot_label}} | {{project_slot_cmd}} |

## HARD Rules
Universal (positive form):
- [HARD] Load secrets, tokens, and API keys from environment variables only
- [HARD] Claim completion only after fresh verification evidence (run proof → read output → claim)
- [HARD] Submit work through a separate review pass before merge
- [HARD] Validate inputs at every system boundary (API, IPC, CLI, file I/O)
- [HARD] Write user-facing documents (PR body, commit body, docs, wiki) in the language set by `OMB_DOCUMENTATION_LANGUAGE` (default `en`); keep code, identifiers, file paths, and PR/commit **titles** in English
- [HARD] Run only diff-targeted tests during development; run the full suite only for CI, release, or an explicit user request

## Coding Principles

Directional guidance — HARD Rules win on conflict. Details: `.claude/rules/common/coding-principles.md`.

- **Think Before Coding** — "State the problem and success criterion before writing a single line."
- **Simplicity First** — "The simplest solution that works — not the most general one."
- **Surgical Changes** — "Every line in the diff must trace back to a plan requirement."
- **Goal-Driven Execution** — "Every step has a verifiable success signal — run it before claiming done."

Project-specific:
{{project_hard_rules}}
<!-- 0-5 items; omit the block entirely (including this sub-header) if none -->

## Gotchas / Non-obvious Patterns

## Gold Standard References

## Reference Index (progressive disclosure)

| Topic | Path |
|-------|------|
| Rules root index (progressive disclosure entry) | `.claude/rules/INDEX.md` |
| Common rules manifest | `.claude/rules/common/INDEX.md` |
| Blueprint wiki | `openwiki/index.md` (if present) |
| Architecture docs | `docs/architecture/` (if present) |
| Local overrides (gitignored) | `CLAUDE.local.md` (if present) |

## Memory & Lesson Capture
- Facts / preferences / decisions → auto-memory (already enforced by system; do not duplicate here)
- Lesson learned / recurring gotcha → `omb:wiki update`
- Information lookup → `omb:wiki read <topic>`
```

### Template Variables Reference

| 변수명 | 설명 | 예시 | 필수여부 |
|--------|------|------|----------|
| `{{date}}` | 생성 날짜 | `2026-04-11` | 필수 |
| `{{project_name}}` | 프로젝트명 | `my-awesome-app` | 필수 |
| `{{project_purpose}}` | 프로젝트의 WHY (1-3 lines) | `FastAPI backend for order management` | 필수 |
| `{{role}}` | WHAT bullets 역할 설명 | `application source code` | 필수 |
| `{{dev_cmd}}` | 개발 서버 실행 커맨드 | `uvicorn src.api.main:app --reload` | 필수 |
| `{{test_cmd}}` | 테스트 실행 커맨드 | `pytest tests/ -v --timeout=10  # full — CI/release only; dev runs are diff-targeted` | 필수 |
| `{{lint_cmd}}` | 린트 실행 커맨드 | `ruff check . && pyright` | 필수 |
| `{{typecheck_cmd}}` | 타입체크 실행 커맨드 | `pyright` | 필수 |
| `{{build_cmd}}` | 빌드 실행 커맨드 | `docker build -t app .` | 필수 |
| `{{project_slot_label}}` | HOW 표 추가 슬롯 라벨 | `DB migrate` | 선택 |
| `{{project_slot_cmd}}` | HOW 표 추가 슬롯 커맨드 | `alembic upgrade head` | 선택 (slot_label과 쌍) |
| `{{project_hard_rules}}` | 0-5 프로젝트 특유 HARD Rules (positive form) | `- [HARD] Route all DB calls through the async session factory` | 선택 |

---

## Section 3: Stack-to-Slot Mapping

| Template | DEV_CMD | BUILD_CMD | TEST_CMD | LINT_CMD | EXTRA |
|----------|---------|-----------|----------|----------|-------|
| fastapi | `uvicorn src.api.main:app --reload` | `docker build -t app .` | `pytest tests/ -v --timeout=10  # full — CI/release only; dev runs are diff-targeted` | `ruff check . && pyright` | — |
| react | `npm run dev` | `npm run build` | `npx vitest run  # full — CI/release only; dev runs are diff-targeted` | `npx eslint . && npx tsc --noEmit` | — |
| electron | `npm run dev` | `npm run build` | `npx vitest run  # full — CI/release only; dev runs are diff-targeted` | `npx eslint . && npx tsc --noEmit` | `npm run package` |
| fullstack | `turbo dev` | `turbo build` | `turbo test  # full — CI/release only; dev runs are diff-targeted` | `turbo lint` | — |
| fullstack-ai | `turbo dev` (web) / `uvicorn` (api) / `langgraph dev` (ai) | `turbo build` (web) / `docker build` (api, ai) | `pytest apps/api/tests/ -v --timeout=10 && pytest apps/ai/tests/ -v --timeout=10 && cd apps/web && npx vitest run  # full — CI/release only; dev runs are diff-targeted` | `ruff check apps/api/ apps/ai/ && pyright apps/api/ apps/ai/ && cd apps/web && npx eslint . && npx tsc --noEmit` | `docker-compose up` (full stack) |
| langgraph | `langgraph dev` | `langgraph build -t app` | `pytest tests/ -v --timeout=10  # full — CI/release only; dev runs are diff-targeted` | `ruff check . && pyright` | `langgraph up` (Docker, port 8123) |
| langgraph-multi | `langgraph dev` | `langgraph build -t app` | `pytest tests/ -v --timeout=10  # full — CI/release only; dev runs are diff-targeted` | `ruff check . && pyright` | `langgraph up` (Docker, port 8123) |

---

## Section 4: Language Convention Tables

### Python
- Import style: `from module import name` (no wildcard imports)
- Type hints: required on all function signatures (Pyright strict)
- String formatting: f-strings preferred
- Async: use `async/await` for I/O-bound operations
- Naming: `snake_case` for functions/variables, `PascalCase` for classes

### TypeScript
- Strict mode: `"strict": true` in tsconfig.json
- Import style: named imports preferred over default exports
- Type annotations: explicit return types on public functions
- Prefer `const` over `let`, no `var`
- Naming: `camelCase` for variables/functions, `PascalCase` for types/classes/components

### Go
- Format: `gofmt` enforced
- Error handling: explicit error checks, no `_` for errors
- Naming: short, clear names per Go conventions
- Testing: table-driven tests

---

## Section 5: Merge Strategy (UPDATE mode)

### 5.1 Marker Detection

Pseudocode for detecting v1 vs v2 vs fresh CREATE:

```
detect_marker:
  if file contains "<!-- omb:setup v1 |":  path = V1_MIGRATE
  elif file contains "<!-- omb:setup v2 |": path = V2_UPDATE
  else:                                      path = CREATE
```

### 5.2 V1 → V2 Migration Pseudocode (5 steps)

```
V1_MIGRATE:
  1. Copy current file to ${file}.bak
  2. Collect user content:
     - Entire body of "Project-Specific Notes" section
     - Any user-added paragraphs under removed sections
       (Testing Strategy, Error Handling, Code Conventions, Tech Stack)
     - Push into migration_scratch (verbatim, with original sub-headers)
  3. Write fresh v2 template from scratch using CREATE-mode generator
     (do NOT in-place edit — v1 and v2 are not positionally isomorphic)
  4. Append migration_scratch into "Gotchas / Non-obvious Patterns"
     under the line:
       <!-- Migrated from v1: review and prune -->
  5. Leave HARD Rules Project-specific sub-block empty (user populates
     via Phase 3 Step 3.3 on next setup, or manually)
```

### 5.3 V2 → V2 Update Pseudocode (header-anchored)

```
V2_UPDATE:
  - Split input file by lines starting with `## ` (section header markers)
  - For each AUTO-REPLACEABLE header
    (`## WHY`, `## WHAT`, `## HOW`, `## Coding Principles`, `## Reference Index (progressive disclosure)`):
      replace body from the header line to the line before the next `## ` header
      with freshly generated content from the CREATE-mode template
  - For `## HARD Rules`:
      replace ONLY the block under the `Universal (positive form):` sub-header,
      stop at the line prefix-matching `Project-specific:` — preserve from
      `Project-specific:` onward verbatim (including the 0-5 project rules)
  - Preserved headers (never touched):
      `## Gotchas / Non-obvious Patterns`
      `## Gold Standard References`
      `## Memory & Lesson Capture`
```

### 5.4 Legacy Marker Removal

Earlier v2 templates embedded HTML comment markers on generated section bodies as anchors for UPDATE-mode section replacement. The markers were removed (2026-04-18) because no parser consumed them and they wasted tokens on every session load. UPDATE mode now uses header-based anchoring (see §5.3). A negative grep check in `SKILL.md` Additional Static Checks enforces that the generated `CLAUDE.md` remains marker-free.

### 5.5 Preserved Sections (V2 → V2 UPDATE only)

Never overwritten during V2 UPDATE:
- `## Gotchas / Non-obvious Patterns`
- `## Gold Standard References`
- `## HARD Rules` inner `Project-specific:` sub-block (outside the pair markers)
- `## Memory & Lesson Capture`

### 5.6 AGENTS.md Bridge — Shared and Legacy Modes

1. **SHARED CREATE**: Put shared policy in AGENTS.md and create root CLAUDE.md with
   active `@AGENTS.md`, outside comments and code blocks. If `.claude/CLAUDE.md`
   already supplies the equivalent import, preserve it without duplicate loading.
2. **SHARED UPDATE, active bridge**: Detect this BEFORE legacy version markers and
   no-marker append logic. Update shared policy in AGENTS.md; preserve the bridge and
   Claude-only content. Apply all policy QA to AGENTS.md and separately validate imports.
3. **LEGACY UPDATE, commented bridge intact**: Preserve it verbatim; use §5.2/§5.3
   in the existing CLAUDE file. Recommend `omb:deep-setup` for deliberate semantic migration.
4. **LEGACY UPDATE, bridge removed**: Do not re-insert it automatically. Preserve user
   integration choices. A shadowing AGENTS.override.md or ambiguous import conflict
   defers affected shared changes; report it instead of claiming Codex coverage.

Resolve imports relative to their containing file, not cwd. Validate target existence,
cycles, duplicate paths, preserved user policy, and actual line/byte counts after writes.

### 5.7 Head-block Regex and v1/v2 Marker Disambiguation

- Bridge block regex (anchored at file start): `^<!-- AGENTS\.md bridge[\s\S]*?-->\n?`
- v2 marker regex: `^<!-- omb:setup v2 \| ([\d\-]+) -->$`
- v1 marker regex: `^<!-- omb:setup v1 \| ([\d\-]+) -->$`
- Disambiguation rule: opening token after `<!-- ` — `AGENTS.md bridge` vs `omb:setup v1` vs `omb:setup v2`. In v2 schema the bridge block always precedes the v2 marker line.

---

## Section 6: Gitignore Entries

### Common (all templates)
```
.omb/.lint-passed
.env
.env.*
!.env.example
*.log
.DS_Store
```

### Python
```
__pycache__/
*.py[cod]
*.egg-info/
dist/
.ruff_cache/
.mypy_cache/
.pyright/
.pytest_cache/
htmlcov/
.coverage
```

### TypeScript / Node.js
```
node_modules/
dist/
.turbo/
*.tsbuildinfo
coverage/
```

### Electron
```
dist-electron/
out/
```

---

## Section 7: Convention Presets

Popular conventions proposed during setup Step 3.3. Each category has 2-4 options with a recommended default per template.

### Category Definitions

#### 1. Project Structure
Applies to: **all templates**

| Option | Description |
|--------|-------------|
| **Feature-based (Recommended)** | Group files by feature/domain (e.g., `src/auth/`, `src/billing/`). Scales well, reduces cross-cutting imports. |
| Layer-based | Group files by type (e.g., `src/controllers/`, `src/services/`, `src/models/`). Simple but creates wide directories. |
| Hybrid | Feature folders with shared layer directories (e.g., `src/features/auth/` + `src/shared/utils/`). |

#### 2. API Style
Applies to: **fastapi, fullstack, fullstack-ai**

| Option | Description |
|--------|-------------|
| **REST resource-oriented (Recommended)** | Plural noun URLs (`/users`, `/orders/{id}`), HTTP verbs for actions, consistent response envelope. |
| RPC-style | Action-based URLs (`/createUser`, `/getOrders`). Simpler for internal APIs, less discoverable. |
| GraphQL | Single endpoint, client-driven queries. Best for complex nested data and multiple consumers. |

#### 3. State Management
Applies to: **react, electron, fullstack, fullstack-ai**

| Option | Description |
|--------|-------------|
| **Zustand (Recommended)** | Minimal boilerplate, no providers needed, works with React Server Components. |
| React Context + useReducer | Built-in, no dependencies. Good for small/medium apps with limited global state. |
| Redux Toolkit | Full-featured, DevTools, middleware. Best for large apps with complex state flows. |
| Jotai | Atomic state model, fine-grained reactivity. Good for independent pieces of state. |

#### 4. CSS Methodology
Applies to: **react, electron, fullstack, fullstack-ai**

| Option | Description |
|--------|-------------|
| **Tailwind utility-first (Recommended)** | Utility classes in JSX, design tokens via config. Fast iteration, consistent spacing/colors. |
| CSS Modules | Scoped CSS files per component. Good for teams familiar with traditional CSS. |
| Styled Components / Emotion | CSS-in-JS, dynamic styles based on props. Good for complex theming. |

#### 5. Error Handling
Applies to: **all templates**

| Option | Description |
|--------|-------------|
| **Typed error classes (Recommended)** | Custom error hierarchy (e.g., `NotFoundError`, `ValidationError`). Explicit, catchable by type. |
| Result/Either pattern | Return `Result<T, E>` instead of throwing. Functional style, forces callers to handle errors. |
| HTTP codes + structured JSON | Rely on HTTP status codes with consistent error response shape `{ error, message, details }`. |

#### 6. Testing Strategy
Applies to: **all templates**

| Option | Description |
|--------|-------------|
| **TDD strict (Recommended)** | Red-green-improve cycle. Write failing test first, then implement. Enforced via `omb-tdd` skill. |
| Test-after | Write implementation first, then add tests. Faster initial velocity, risk of undertesting. |
| Integration-first | Prioritize integration/E2E tests over unit tests. Good for API-heavy projects. |

#### 7. Git Workflow
Applies to: **all templates**

| Option | Description |
|--------|-------------|
| **Trunk-based (Recommended)** | Short-lived feature branches (< 5 days), squash merge to main. Simple, fast CI feedback. |
| GitHub Flow | Feature branches + PR reviews + merge. Standard for open-source and team projects. |
| Git Flow | develop/release/hotfix branches. Formal release process, best for versioned software. |

#### 8. API Versioning
Applies to: **fastapi, fullstack, fullstack-ai**

| Option | Description |
|--------|-------------|
| **URL path versioning (Recommended)** | `/v1/users`, `/v2/users`. Explicit, easy to route, cacheable. Most common pattern. |
| Header-based | `Accept: application/vnd.api+json;version=2`. Cleaner URLs, harder to test in browser. |
| No versioning | Single version, breaking changes handled via deprecation. Simplest for internal APIs. |

#### 9. Database Naming
Applies to: **fastapi, fullstack, fullstack-ai**

| Option | Description |
|--------|-------------|
| **snake_case plural (Recommended)** | `users`, `order_items`, `payment_methods`. PostgreSQL convention, ORM-friendly. |
| snake_case singular | `user`, `order_item`. Matches model class names. Popular in some ORMs. |
| Prefixed | `tbl_users`, `tbl_orders`. Disambiguates in complex schemas. Less common in modern stacks. |

#### 10. Logging
Applies to: **all templates**

| Option | Description |
|--------|-------------|
| **Structured JSON (Recommended)** | JSON log lines with `structlog` (Python) or `pino` (Node.js). Machine-parseable, searchable. |
| Plain text | Human-readable logs. Simple for development, harder to parse in production. |
| OpenTelemetry | Traces + metrics + logs unified. Best for distributed systems and observability platforms. |

### Template Presets

Default convention selections per template. Only applicable categories are included.

#### fastapi

| Category | Default |
|----------|---------|
| Project Structure | Feature-based |
| API Style | REST resource-oriented |
| Error Handling | Typed error classes |
| Testing Strategy | TDD strict |
| Git Workflow | Trunk-based |
| API Versioning | URL path versioning |
| Database Naming | snake_case plural |
| Logging | Structured JSON |

#### react

| Category | Default |
|----------|---------|
| Project Structure | Feature-based |
| State Management | Zustand |
| CSS Methodology | Tailwind utility-first |
| Error Handling | Typed error classes |
| Testing Strategy | TDD strict |
| Git Workflow | Trunk-based |
| Logging | Structured JSON |

#### electron

| Category | Default |
|----------|---------|
| Project Structure | Feature-based |
| State Management | Zustand |
| CSS Methodology | Tailwind utility-first |
| Error Handling | Typed error classes |
| Testing Strategy | TDD strict |
| Git Workflow | Trunk-based |
| Logging | Structured JSON |

#### fullstack

| Category | Default |
|----------|---------|
| Project Structure | Feature-based |
| API Style | REST resource-oriented |
| State Management | Zustand |
| CSS Methodology | Tailwind utility-first |
| Error Handling | Typed error classes |
| Testing Strategy | TDD strict |
| Git Workflow | Trunk-based |
| API Versioning | URL path versioning |
| Database Naming | snake_case plural |
| Logging | Structured JSON |

#### fullstack-ai

| Category | Default |
|----------|---------|
| Project Structure | Feature-based |
| API Style | REST resource-oriented |
| State Management | Zustand |
| CSS Methodology | Tailwind utility-first |
| Error Handling | Typed error classes |
| Testing Strategy | TDD strict |
| Git Workflow | Trunk-based |
| API Versioning | URL path versioning |
| Database Naming | snake_case plural |
| Logging | Structured JSON |

#### langgraph

| Category | Default |
|----------|---------|
| Project Structure | Feature-based |
| Error Handling | Typed error classes |
| Testing Strategy | TDD strict |
| Git Workflow | Trunk-based |
| Logging | Structured JSON |

#### langgraph-multi

| Category | Default |
|----------|---------|
| Project Structure | Feature-based |
| Error Handling | Typed error classes |
| Testing Strategy | TDD strict |
| Git Workflow | Trunk-based |
| Logging | Structured JSON |

### Convention Defaults Summary Format

When building `{{convention_defaults_summary}}` for Step 3.3a, use this format:

```
- Project Structure: Feature-based (group by feature/domain)
- API Style: REST resource-oriented (plural URLs, HTTP verbs)
- State Management: Zustand (minimal boilerplate)
- CSS Methodology: Tailwind utility-first (utility classes, design tokens)
- Error Handling: Typed error classes (custom hierarchy)
- Testing Strategy: TDD strict (red-green-improve)
- Git Workflow: Trunk-based (short-lived branches, squash merge)
- API Versioning: URL path (/v1/users)
- Database Naming: snake_case plural (users, order_items)
- Logging: Structured JSON (structlog/pino)
```

Only include categories that apply to the selected template.
