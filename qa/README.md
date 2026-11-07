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

**A route that does not resolve the same way in preview and in production is a
false finding, so every route in the table is checked in both before it is
added.** A candidate that 404s in production is dropped; one that resolves
differently is fixed or dropped. `/command-center` answered 404 in production
and would have been a finding that named a page that does not exist.

**The surface is deliberately wider than the engine.** Three routes found six
findings; seventeen routes found nine, and four of them were real horizontal
overflows on pages nobody had looked at. Widening the table is what turned the
QA tier from a smoke test into a source of work.

### A finding has to name its cause
The runner captures the error's stack frame and the console message's location,
the HTTP status of every script it loads (a script that 404s is not a
"requestfailed" — only a transport failure is), and the elements that actually
cross the viewport with how far each one overflows. A finding that names a
symptom and no cause is not actionable, and a QA pass that cannot produce
actionable findings is a pass that costs a cycle and returns nothing.

### A finding has to be checked against production
A console error that only appears in the preview is a finding about the
preview. `/versions/neon` logs a WebSocket failure to `ws://127.0.0.1:8787`
because the runner's preview was on a dev host and the product only
auto-connects there — the deployed page emits **zero** console errors.

So the surface is served on **`preview.localhost`**, not `127.0.0.1`. The
product's own guard (`client/visualizer-controller.js`) skips the dev-bridge
connection unless the hostname is a dev host, and `preview.localhost` — which
resolves to loopback in Chromium, per RFC 6761 — is not one. The page then
behaves exactly as it does in production, and the false finding disappears
with **nothing suppressed**:

```
http://127.0.0.1:4173/versions/neon        -> 3 console errors
http://preview.localhost:4173/versions/neon -> 0 console errors
```

`KAI_QA_BASE_URL` overrides the base when you point the runner at another
server; the configured default is the production-shaped one.

## Future phases
1. Separate API contract testing against staging with secret-safe read-only fixtures.
2. Add software-factory task routing: consume errorlog.ndjson, triage, propose branches and draft PRs, with model billing ledger and enforceable daily reservation/cap before requests.
3. Add semantic visual baselines and multi-agent review with explicit approval before changes.
4. Add dedicated worker leases, checkpointing and durable retries for always-on operation. A GitHub Action on PRs is not an always-on service.

## The route table

`swarm.config.json` carries 148 routes. They were derived from the site's
own `vercel.json` rewrites — every source that resolves to a shipped page
— and then checked against the deployed site: a route enters the table
only if the preview and production answer it the same way.

**The preview must apply the rewrites, or the table measures the wrong
document.** `vite preview` resolves `/atlas` on its own, because Vite's
static middleware finds `dist/atlas.html` for the path `/atlas` — but it
answers `/play` with the HOME PAGE, because the real file is
`dist/versions/play.html` and nothing rewrites the path to reach it.
Twenty-six of the 148 routes were therefore measuring the home page
instead of the page they name. The fix is in `vite.config.js`: the
`dev-vercel-rewrites` plugin now hooks `configurePreviewServer` as well as
`configureServer`, so the preview answers the same routes production
does.

The runner now proves it on every run: it reads the home page's title
first, and any route that answers with that title is a **soft 404** — a
200 that is not the page — and is reported as a high-severity finding.

## Accessibility

`qa/a11y.mjs` is the one place axe-core is invoked, and `scripts/check-a11y.mjs`
is the gate that uses it. The gate compares the per-rule instance counts
against `qa/a11y-baseline.json` and fails when any rule's count rises. A
count that falls is reported but is not a failure — it means the baseline
should be lowered with `--update-baseline` once the fix has landed.

The baseline stores the counts, the pages that carry each rule, and one
example element per rule: a count with no location is not a work item.

axe-core is a devDependency on purpose. A gate that fetches its tool from
a CDN is a gate that fails when the network fails, and it cannot tell "the
page has a contrast problem" from "fonts.googleapis.com was slow today".

## Required merge gates
Green existing CI, new QA evidence inspected, no unauthorized production side effects, human review. No auto-merge.
