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

## Gotchas / Non-obvious Patterns
<!-- User-editable. Record project quirks Claude cannot infer from the code.
     Good entries:
       - "auth middleware must run before body parser (legacy reason X)"
       - "we use snake_case for DB columns but camelCase in API responses"
     Add new items via direct edit. Longer lessons → `omb:wiki update`.
     CREATE mode emits this as an intentionally empty stub — do not fail empty-section checks here. -->

<!-- Migrated from v1: review and prune -->
### Project-Specific Notes (migrated)

#### Webhook Delivery Ordering

The legacy Stripe integration assumes webhooks arrive in strict delivery order.
**Do NOT parallelize webhook processing** — the `webhook_events` table has an
`ordinal` column that must increment monotonically per `payment_id`. Race conditions
here caused double-charges in Q3 2025 (incident-42). Use the Redis distributed lock
(`payment:{id}:lock`) before updating any payment state.

#### TTL Flush Before Expiry

The session token cache in Redis uses a 15-minute TTL. The token refresh endpoint
(`POST /api/v1/auth/refresh`) **must flush and re-issue the token at least 60 seconds
before TTL expiry** — not at expiry. Downstream mobile clients poll every 30 seconds
and a race window caused auth failures for ~2% of sessions (reported 2025-11-14).
Add a `X-Token-Expires-At` header so clients can preemptively refresh.

#### Feature Flag: LEGACY_INVOICE_FORMAT

`LEGACY_INVOICE_FORMAT=true` activates the pre-2024 PDF invoice template for
enterprise customers still on the old billing portal. **This flag is deprecated as of
2025-11.** All new tenants default to the v2 template. Migration plan is tracked in
Jira PAYM-881. Do NOT remove the flag until PAYM-881 is closed — removing it will
break invoices for ~40 enterprise accounts.

#### Celery Beat Schedule

The `cleanup_expired_sessions` task runs every 5 minutes via Celery Beat. The beat
schedule is defined in `src/worker/schedules.py`, not in `celery.conf`. If you add a
new periodic task, register it there — not inline in the task definition file.

#### Database Connection Pooling

The async SQLAlchemy engine is configured with `pool_size=10, max_overflow=20`.
In production, we observed connection exhaustion during load spikes when Celery
workers and the API server shared the same pool. **Keep Celery workers on a
separate DB connection string** (`DATABASE_WORKER_URL`) to isolate pool pressure.
This is set in `src/worker/config.py`.

## Gold Standard References
<!-- User-editable. Point to exemplar files whose style should be copied.
     The agent learns patterns better from one concrete file than from paragraphs of prose.
     Example entries:
       - `src/api/routers/health.py` — router structure and error handling
       - `apps/web/src/components/ui/button.tsx` — component convention
     CREATE mode emits this as an intentionally empty stub — do not fail empty-section checks here. -->

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
