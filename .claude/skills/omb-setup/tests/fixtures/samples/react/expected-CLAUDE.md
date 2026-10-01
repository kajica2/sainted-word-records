<!-- AGENTS.md bridge (optional): uncomment to unify cross-tool agent guidance
     @AGENTS.md
-->
<!-- omb:setup v2 | 2026-04-18 -->

# sample-react

## WHY
React SPA for admin dashboard.

## WHAT
- `src/` — application source code
- `tests/` — automated test suites
- `docs/` — human documentation
- `docs/wiki/` — project blueprint (machine-consumable)
- `.claude/rules/` — detailed conventions (progressive disclosure)

## HOW
| Purpose   | Command |
|-----------|---------|
| Dev       | npm run dev |
| Test      | npx vitest run |
| Lint      | npx eslint . |
| Typecheck | npx tsc --noEmit |
| Build     | npm run build |

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

## Gotchas / Non-obvious Patterns

## Gold Standard References

## Reference Index (progressive disclosure)

| Topic | Path |
|-------|------|
| Rules root index (progressive disclosure entry) | `.claude/rules/INDEX.md` |
| Common rules manifest | `.claude/rules/common/INDEX.md` |
| Blueprint wiki | `docs/wiki/index.md` (if present) |
| Architecture docs | `docs/architecture/` (if present) |
| Local overrides (gitignored) | `CLAUDE.local.md` (if present) |

## Memory & Lesson Capture
- Facts / preferences / decisions → auto-memory (already enforced by system; do not duplicate here)
- Lesson learned / recurring gotcha → `omb:wiki update`
- Information lookup → `omb:wiki read <topic>`
