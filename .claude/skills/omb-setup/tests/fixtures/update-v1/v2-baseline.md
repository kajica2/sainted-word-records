<!-- AGENTS.md bridge (optional): uncomment to unify cross-tool agent guidance
     @AGENTS.md
-->
<!-- omb:setup v2 | 2025-12-01 -->

# payment-service

## WHY
FastAPI microservice for payment processing and webhook delivery.
Handles Stripe events, manages transaction ledger, and dispatches
notifications to downstream subscribers.

## WHAT
- `src/` — application source code (FastAPI app, models, routers, workers)
- `tests/` — automated test suites (pytest, async test client)
- `docs/` — human documentation
- `docs/wiki/` — project blueprint (machine-consumable)
- `.claude/rules/` — detailed conventions (progressive disclosure)

## HOW
| Purpose   | Command |
|-----------|---------|
| Dev       | uvicorn src.api.main:app --reload --port 8080 |
| Test      | pytest tests/ -v --cov=src --cov-report=term-missing |
| Lint      | ruff check src/ tests/ |
| Typecheck | pyright src/ |
| Build     | docker build -t payment-service:local . |
| DB migrate | alembic upgrade head |

## HARD Rules
Universal (positive form):
- [HARD] Load secrets, tokens, and API keys from environment variables only
- [HARD] Claim completion only after fresh verification evidence (run proof → read output → claim)
- [HARD] Submit work through a separate review pass before merge
- [HARD] Validate inputs at every system boundary (API, IPC, CLI, file I/O)
- [HARD] Write user-facing documents (PR body, commit body, docs, wiki) in the language set by `OMB_DOCUMENTATION_LANGUAGE` (default `en`); keep code, identifiers, file paths, and PR/commit **titles** in English

Project-specific:
- [HARD] Acquire `payment:{id}:lock` (Redis SETNX, TTL 30s) before mutating any payment state
- [HARD] Keep Celery workers on `DATABASE_WORKER_URL`, never the API database URL

## Gotchas / Non-obvious Patterns
<!-- User-editable. Record project quirks Claude cannot infer from the code.
     Good entries:
       - "auth middleware must run before body parser (legacy reason X)"
       - "we use snake_case for DB columns but camelCase in API responses"
     Add new items via direct edit. Longer lessons → `omb:wiki update`.
     CREATE mode emits this as an intentionally empty stub — do not fail empty-section checks here. -->

- **Webhook ordering**: Do NOT parallelize — `ordinal` must increment monotonically per `payment_id` (incident-42, double-charge Q3 2025).
- **TTL flush timing**: Refresh tokens at least 60 s before TTL expiry, not at expiry. Add `X-Token-Expires-At` header.
- **LEGACY_INVOICE_FORMAT**: Deprecated as of 2025-11; do NOT remove until PAYM-881 closed (~40 enterprise accounts affected).
- **Celery Beat schedule**: New periodic tasks go in `src/worker/schedules.py`, not inline in the task file.

## Gold Standard References
<!-- User-editable. Point to exemplar files whose style should be copied.
     The agent learns patterns better from one concrete file than from paragraphs of prose.
     Example entries:
       - `src/api/routers/health.py` — router structure and error handling
       - `apps/web/src/components/ui/button.tsx` — component convention
     CREATE mode emits this as an intentionally empty stub — do not fail empty-section checks here. -->

- `src/api/routers/payments.py` — canonical router: dependency injection, error handling, response envelope
- `src/models/payment.py` — SQLAlchemy 2.0 Mapped[] annotation style and UUID PK pattern
- `tests/api/test_payments.py` — async test client usage with rolled-back transactions

## Reference Index (progressive disclosure)
<!-- Load only when relevant to the current task.
     Rows with "(if present)" are emitted only when the referenced path exists at generation time. -->

| Topic | Path |
|-------|------|
| Language conventions | `.claude/rules/languages/` |
| Workflow (plan/impl/verify/test/PR) | `.claude/rules/workflow/` |
| Git & commit/branch rules | `.claude/rules/git/` |
| Tool usage (LSP / Chrome / Pencil) | `.claude/rules/tools/` |

## Memory & Lesson Capture
- Facts / preferences / decisions → auto-memory (already enforced by system; do not duplicate here)
- Lesson learned / recurring gotcha → `omb:wiki update`
- Information lookup → `omb:wiki read <topic>`
- **Recurring incident pattern**: always check `ordinal` monotonicity in payment state mutations before assuming they are safe to run concurrently
