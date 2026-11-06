# KAI SWARM — Phase 1 (bounded QA)

Policy: `qa/swarm.config.json`. This phase is **read-only** and runs zero paid model calls. It does not trigger production deploys, update screenshot baselines, merge branches, or mutate secrets.

## Fixed constraints
- Bounded autonomy; maximum **2** parallel Playwright contexts.
- User cap **$2 per day** for model APIs. **Not a billing enforcement integration yet**: no agent/model API requests occur in this phase, so model spend by this workflow is $0. GitHub Actions infrastructure costs are separate.
- Missions: visual, API, regression, security, creative.
- Security: currently policy assertions only. A comprehensive dependency/auth/code security audit requires subsequent integration.
- Creative: screenshots are gathered for human/agent assessment; a model has not performed artistic judgment.
- API: `/api/manifest?action=health` is a serverless endpoint; the Vite static preview generally cannot run it, so a 404 is informational rather than success. For deployed API contract checks, point the QA base URL to an authorized staging deployment.

## Integration with existing systems
- Existing `.github/workflows/ci.yml` remains unchanged, including its curated Puppeteer checks.
- Existing `software-factory/swr-agent.mjs` and model routing remain unchanged.
- GitHub Actions workflow `kai-swarm-qa.yml` runs on same-repository PRs targeting main and manual dispatch.
- Run outputs: `qa-results/screenshots/*.png`, `report.json`, `errorlog.ndjson`, `REVISION_REPORT.md`.
- Outputs are uploaded as Actions artifacts, not committed.

## Local run
```sh
npm ci
npx playwright install chromium
npm run build
npm run preview -- --host 127.0.0.1
# In another terminal
node qa/swarm-runner.mjs
```
### The route table is not decoration
`routes[].path` is resolved by the server the runner points at, and the servers
disagree on the trailing slash. `vite preview` resolves `/engine` to
`dist/engine.html`, but there is no `dist/engine/index.html`, so `/engine/`
fell through to preview's SPA fallback and served **the home page** — the
engine app was never tested, and the two "engine" findings were duplicates of
the home-page ones. The dev server and Vercel both rewrite `/engine/` to
`/engine.html`, so the runner uses the slash-less form every server resolves
to the same file.

### A finding has to name its cause
The runner captures the error's stack frame and the console message's location,
the HTTP status of every script it loads (a script that 404s is not a
"requestfailed" — only a transport failure is), and the elements that actually
cross the viewport with how far each one overflows. A finding that names a
symptom and no cause is not actionable, and a QA pass that cannot produce
actionable findings is a pass that costs a cycle and returns nothing.

## Future phases
1. Separate API contract testing against staging with secret-safe read-only fixtures.
2. Add software-factory task routing: consume errorlog.ndjson, triage, propose branches and draft PRs, with model billing ledger and enforceable daily reservation/cap before requests.
3. Add semantic visual baselines and multi-agent review with explicit approval before changes.
4. Add dedicated worker leases, checkpointing and durable retries for always-on operation. A GitHub Action on PRs is not an always-on service.

## Required merge gates
Green existing CI, new QA evidence inspected, no unauthorized production side effects, human review. No auto-merge.
