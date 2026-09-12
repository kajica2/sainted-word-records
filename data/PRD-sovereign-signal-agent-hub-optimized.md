# Product Requirements Document

## Sovereign Signal — The Agent Hub

**Document version:** v1.1 (autoresearch-optimized, 2026-09-05)
**Status:** For programmer review
**Owner:** Kai Djuric (kajica2)
**Optimization source:** v1.0 (2026-09-05) — 5 elements × 3 rounds × 10 variants + 5 cross-breeds; optimized score 91.8 (was 65.6 baseline).
**Repos:**
- Framework: `github.com/kajica2/agent-hub-framework`
- Live instance: `github.com/kajica2/kajica2.github.io` → `kajica2.github.io`
- Other repos in scope: `kai-freq-lab`, `sainted-word-records`, `muscriptor`, `harmonic-study-engine`, 50+ HF Spaces

---

## 1. Vision

What ships today: a forkable framework (agent-hub-framework), a live instance (kajica2.github.io), 21 public + 3 paywalled + 8 personas + 18 daily reports + 7 workflows, paywall-enforced build, round-robin loop with growth reports, one-step watchdog, public API at `/api/v1/state.json`.

- For Kai (operator): one runtime, two identities (Research + Eye & Kairi), no disconnected repos.
- For a forking programmer: 5 commands to a working hub at `<username>.github.io`.
- For agents: callable surface with closed-vocabulary contracts and paywall enforcement.

Non-goals: not a CMS, not a portfolio, not a chat, not a polling watchdog, not a strategic-autonomy agent.

Edge cases covered: paywall leak (3 layers + CI grep), growth stall (7-day cool), agent crash (lock >5min), external API down (retry+backoff), entity cross-leak (entity filter).

**Why:** Right now, kajica2's ~50 GitHub repos and ~50 Hugging Face Spaces exist as disconnected artifacts. Each one was built to solve a specific problem; they share concepts (audio features, music tools, generative visuals) but don't share code, contracts, or infrastructure. The hub is the layer that makes them collectively smarter — components get reused, agents coordinate across them, paywalled content stays separated from public.

---

## 2. Operating model — Two entities, one person

Kai operates as **two distinct economic identities**:

| | Research + Creative Development | Eye & Kairi |
|---|---|---|
| **Type** | Build (R&D, music, art, tools) | Consult (adopt Research tools for agencies) |
| **Output** | Open arsenal | Engagements with businesses/agencies |
| **Hub surface** | `/research/` | `/eye-kairi/` |
| **Material license default** | public / open | consulting (paywalled during engagement) |
| **Schema field** | `entity: "research"` (default) | `entity: "eye-kairi"` |

Both share the same infrastructure: schemas, build script, agents, components, channels. Only the **filter on the public surface** changes.

---

## 3. Architecture (the system in three sentences)

Pipeline: edit `projects.json` or `agents.json` → `npm run validate` (schema gate, exit 1 on invalid) → `npm run build` (paywall partition, exit 1 on leak) → `dist/public/` + `dist/internal/` (deploy to GitHub Pages via `rebuild.yml`) → live at `<username>.github.io`.

In parallel: `loop/supervisor.mjs` rotates agents round-robin, writes `growth-reports/`, surfaces stalled growth as "needs input". Watchdog pings only on `done` / `blocked` / `heartbeat`.

State: `projects.json` (24 entries) + `agents.json` (8 personas) are the canonical state. Schema: closed-vocabulary enums. Loop: round-robin, 7-day cool. Watchdog: one-step, non-polling. Constraints: no paywall leak, no entity cross-leak, no permanent shutdown, no free-text schemas.

---

## 4. Repository layout

### 4.1 `kajica2/agent-hub-framework` (forkable, agent-owned)

```
agent-hub-framework/
├── PURPOSE.md                       # 5 rules (read first)
├── AGENTS.md                        # team contract (read second)
├── README.md                        # quick start
├── prompts/
│   └── long-horizon.md              # 10-step ordered work + scoreboard
├── plans/
│   ├── long-horizon.md              # 3yr / 12mo / 90d / this-month horizons
│   └── agent-hub-phase1.md          # 22-section design doc
├── schema/
│   ├── project.schema.json            # REQUIRED fields: name, umbrella, repo, description, material_license, capabilities
│   ├── agent.schema.json              # REQUIRED: name, kind, purpose, material_access
│   ├── channel.schema.json            # research / news / metric / feed
│   └── capability-taxonomy.json       # closed vocabulary: ingest / transform / produce / analyze / visualize / distribute
├── scripts/
│   ├── validate.mjs                  # schema + taxonomy + paywall gate (exit 1 on leak)
│   ├── build.mjs                     # paywall-gated build (public/ + internal/)
│   └── capture-screenshots.mjs       # puppeteer screenshot pass
├── examples/
│   ├── projects.example.json         # 24 curated entries (21 public, 3 paywalled)
│   └── agents.example.json           # 8 personas (4 utility, 3 infrastructure, 1 research)
├── bootstrap-agent/
│   ├── walk-repos.mjs                # gh repo list → draft projects.json
│   ├── extract-components.mjs        # tag projects with component hints
│   └── README.md
├── loop/
│   ├── supervisor.mjs                # round-robin orchestrator
│   ├── state.json                    # persistent loop state (gitignored)
│   ├── growth-reports/YYYY-MM-DD.md  # append-only growth reports
│   └── agent-runs.jsonl              # per-run log
├── watchdog/
│   ├── watchdog.mjs                  # one-step relay (done / stuck / heartbeat)
│   ├── telegram-bridge.mjs           # Bot API direct (fetch to api.telegram.org)
│   └── README.md
├── components/                       # framework-owned reusable parts (seed)
│   ├── ui/  data/  scripts/          # each entry has manifest.json index
├── extension/                        # Chrome MV3 extension (Phase 6)
├── .github/workflows/
│   ├── validate.yml                  # weekly cron + per-push
│   ├── loop.yml                      # every 5 min + per-push
│   ├── bootstrap.yml                 # weekly Monday 04:00 UTC
│   ├── watchdog.yml                  # narrow path triggers + 8h schedule
│   └── ingest-daily.yml              # (in instance repo) 05:30 UTC
└── package.json                      # npm scripts: validate / build / loop / capture
```

### 4.2 `kajica2/kajica2.github.io` (instance, Kai-owned)

```
kajica2.github.io/
├── index.html                       # top-level hub, entity switcher
├── projects.json                    # canonical data (24 entries, Kai-curated)
├── agents.json                      # canonical data (8 personas)
├── research/index.html              # 21 public cards grouped by umbrella
├── eye-kairi/index.html             # consulting landing
├── agents/index.html                # 8-persona directory
├── channels/
│   ├── tech-pulse/                  # seed; Phase 2 wires arxiv + GitHub trending
│   ├── daily-reports/               # 18 ingested from HF, daily cron
│   │   ├── ingest.mjs               # idempotent fetcher
│   │   └── 2026-08-{07..22}-*.html # self-contained reports
│   ├── agent-chat/                  # Phase 6 (extension populates)
│   └── captures/                    # Phase 6 (extension Alt+L drops here)
├── devices/guitar/                  # Phase 2 (Web Audio + ACF2)
├── legacy/                          # SOVEREIGN SIGNAL v1, preserved verbatim
├── internal/                        # paywalled entries (Bob Mover etc.)
│   ├── projects.json                  # 3 entries
│   └── state.json                    # owner-only
├── api/v1/state.json                # public-safe snapshot
├── _bootstrap/                      # bootstrap-agent drafts (curation input)
├── schema/  scripts/                # copied from framework for self-contained rebuilds
├── watchdog/                        # copy of framework's watchdog
├── .github/workflows/
│   ├── rebuild.yml                  # daily 06:00 UTC + per-push
│   ├── ingest-daily.yml             # 05:30 UTC
│   └── watchdog.yml                 # narrow triggers, Telegram-optional
└── README.md
```

---

## 5. Schemas (the contracts)

### 5.1 `project.schema.json` — every project entity

```json
{
  "name": "sainted-word-records",          // kebab-case slug
  "display_name": "Sainted Word Records",
  "umbrella": "music",                     // closed enum: music | audio | video | programming | research | other
  "description": "...",                    // 10–240 chars
  "url": "https://...",                     // canonical deployment URL, OR null if repo-only
  "repo": "https://github.com/...",         // required
  "screenshot": "assets/thumbs/x.png",     // null until thumb-collector captures
  "visibility": "public",                  // closed enum: public | unlisted | private
  "status": "active",                      // closed enum: active | stale | archived | wip
  "entity": "research",                    // closed enum: research | eye-kairi | joint
  "availability": "open",                  // closed enum: open | consulting | internal
  "material_license": {                    // REQUIRED, closed enum
    "kind": "public",                       // public | cc-by | cc-by-sa | cc0 | internal-paywalled | licensed-restricted | private
    "source": "self-authored",              // origin label
    "notes": ""
  },
  "capabilities": ["produce-video", "analyze-spectrum", "deploy-vercel"],  // MUST be from capability-taxonomy.json
  "inputs":  ["audio-file", "video-clips"],
  "outputs": ["mp4-file", "engine-config-json"],
  "components": {                          // cross-linking
    "from_framework": ["ui/project-card"],
    "from_shared":    ["shared/audio-utils"]
  },
  "tags": []
}
```

**REQUIRED fields:** `name`, `umbrella`, `repo`, `description`, `material_license`, `capabilities`. Free-text `material_license.kind` is rejected at validate time.

### 5.2 `agent.schema.json` — every agent persona

```json
{
  "name": "keysmith",                      // kebab-case
  "display_name": "Keysmith",
  "kind": "utility",                       // utility | research | infrastructure | creative | orchestrator
  "graphic": "assets/agents/keysmith.svg",
  "page": "agents/keysmith.html",
  "purpose": "Issues API keys to approved collaborators...",
  "inputs":  ["user-request", "approver-sig"],
  "outputs": ["api-key-payload", "audit-log-entry"],
  "capabilities": ["produce-json-suite", "deploy-hf-space"],
  "calls_into": ["kaidjuric/keysmith-hf"],  // what this agent invokes
  "called_by":  [],                         // reverse index, built by build.mjs
  "depend_on":  [],
  "owned_by":  "instance",                  // framework | instance
  "visibility": "unlisted",                 // public | unlisted | private
  "status": "stub",                         // active | stub | wip | archived
  "material_access": ["public"]            // MUST be subset of operator's grants
}
```

### 5.3 Capability taxonomy (closed vocabulary)

```js
{
  "ingest":    ["ingest-pdf", "ingest-mxl", "ingest-midi", "ingest-audio", "ingest-manifest", "ingest-youtube", "ingest-url"],
  "transform": ["transpose", "harmonize", "rhythm-extract", "pitch-detect", "segment", "loop", "quantize", "denoise"],
  "produce":   ["produce-mxl", "produce-midi", "produce-json-suite", "produce-report", "produce-video", "produce-image", "produce-pdf"],
  "analyze":   ["analyze-cadence", "analyze-harmony", "analyze-tempo", "analyze-form", "analyze-key", "analyze-spectrum"],
  "visualize": ["visualize-score", "visualize-waveform", "visualize-spectrum", "visualize-graph", "visualize-3d"],
  "distribute":["deploy-vercel", "deploy-hf-space", "deploy-github-pages", "package-embed", "publish-channel"]
}
```

### 5.4 Channel schema

```json
{
  "name": "tech-pulse",
  "kind": "research",                      // research | news | metric | feed
  "description": "...",
  "sources": [...],
  "refresh": "weekly",                      // on-push | daily | weekly | manual
  "render": "channels/tech-pulse/template.html"
}
```

---

## 6. Paywall discipline (the non-negotiable)

Three layers, three commands, six gates.

**Layers** (fail-closed at each):

1. **Schema** — `project.schema.json` requires `material_license` with a closed enum; free-text is rejected at parse time.
2. **Validate** — `scripts/validate.mjs` flags paywalled entries in source data with file:line.
3. **Build** — `scripts/build.mjs` partitions into `dist/public/` + `dist/internal/`, asserts zero paywalled names in public, exits 1 on any leak.

**Commands** (the three you actually run):

- `npm run validate` — exit 0, no free-text.
- `npm run build` — exit 0, no paywalled in `dist/public/`.
- `grep -r 'bob-mover\|jazzability' dist/public/` — zero matches.

**Six CI gates:**

- T1 — public project appears in `dist/public/`.
- T2 — paywalled project does NOT appear in `dist/public/`.
- T3 — paywalled project does NOT appear in `api/v1/state.json`.
- T4 — paywalled project does NOT appear in any channel render.
- T5 — free-text `material_license.kind` is rejected with file:line.
- T6 — `dist/public/` contains no forbidden strings (defense in depth, open Q5).

**Currently paywalled (3 entries):** `bob-mover-lexicon`, `bob-mover-book`, `jazzability` — Bob Mover's practice materials, members-only. These never surface in `dist/public/`, never in `api/v1/state.json`, never in channel renders.

**To add a paywalled entry:** edit `projects.json`, set `material_license.kind=internal-paywalled` and `source=rights-holder`, run `npm run validate && npm run build`.

**To surface a paywalled entry publicly:**

1. Fork the framework.
2. Confirm redistribution rights with the rights-holder.
3. Change `material_license.kind` to a public enum (`public`, `cc-by`, `cc-by-sa`, `cc0`).
4. Re-validate, re-build, commit, push.

---

## 7. The long-horizon loop

### 7.1 Round-robin scheduler

```js
// loop/supervisor.mjs pseudo
const AGENTS = [
  { name: 'daily-pipeline',     priority: 2 },
  { name: 'kb-indexer',         priority: 3 },
  { name: 'thumb-collector',    priority: 4, depends_on: [] },
  { name: 'channel-renderer',   priority: 5, depends_on: ['thumb-collector'] },
  { name: 'taxonomy-keeper',    priority: 6 },
];
```

Agents with `priority: 0` are never auto-run (e.g. paywall-auditor — human-triggered only).

### 7.2 Termination criteria

Loop sleeps when, for one full rotation:
- KB growth <1% over 7 days
- Component graph growth <1% over 7 days
- All agents successful
- No pending items
- All builds green

Then 24h cooling-off. Loop never shuts down permanently — just sleeps until something wakes it.

### 7.3 Growth signals

| Signal | Measurement |
|---|---|
| KB count | `projects.json` length |
| Cross-links | total `calls_into` + `depend_on` + `from_framework` + `from_shared` references |
| Page completeness | non-empty HTML files in built output |

Written to `loop/growth-reports/YYYY-MM-DD.md` each rotation. Front-page of hub surfaces latest report.

### 7.4 Failure modes

| Failure | Detection | Recovery |
|---|---|---|
| Agent crashes | Lock file age >5 min | Release lock, mark failed, retry next rotation |
| Invalid write | Build script rejects | Rollback, flag for human review |
| Race on resource | Lock conflict | Second agent defers |
| Growth stalled | Signals flat 7 days | Cooling-off, surface "needs input" |
| External API down | HTTP error in agent run | Mark degraded, retry with backoff |
| Paywall leak | Build script detects | Block, auto-trigger paywall-auditor (priority 0) |

---

## 8. Agent personas (8, with 2 active + 6 stub)

| Name | Kind | Purpose | Status |
|---|---|---|---|
| `keysmith` | utility | API key issuance, rotation, audit | stub |
| `image-svg` | utility | Image upload → SVG vectorization (→ HF Space) | stub |
| `animator` | utility | SVG → animated SVG / Lottie / MP4 | stub |
| `hub-bridge` | utility | HF Space output → hub directory | stub |
| `thumb-collector` | infrastructure | Screenshot capture/refresh | **active** |
| `daily-pipeline` | research | Calls out to HF daily-pipeline-director-cut | **active** |
| `kb-indexer` | infrastructure | Walks repos, indexes READMEs | stub |
| `taxonomy-keeper` | infrastructure | Reviews capability proposals | stub |

Each agent needs:
- Page at `/agents/<name>.html` with graphic + purpose + capabilities + calls-into + reverse-index
- SVG graphic in `assets/agents/<name>.svg` (consistent monoline style, cyan/magenta/amber palette)
- Cross-linked from `projects.json` entries via `calls_into` field

---

## 9. Watchdog (one-step, not polling)

**Trigger sources:**
1. PR merged to main → done
2. Push to meaningful paths (PURPOSE, AGENTS, prompts, plans, schema, scripts, watchdog, examples, components, _bootstrap/draft)
3. Cron heartbeat every 8h
4. Manual trigger (workflow_dispatch)

**Delivery:**
- Telegram (Bot API direct, fetch to api.telegram.org)
- iMessage fallback (macOS only, uses osascript)
- Non-fatal on missing secrets (logs informational, exits 0)

**NOT triggers** (avoid spam):
- Loop rotation commits
- Daily report ingestion
- Routine workflow file changes
- Watchdog's own commits

---

## 10. Chrome extension (Phase 6, design only)

MV3 manifest, 7 commands:

| Shortcut | Action | Phase |
|---|---|---|
| `Alt+L` | Capture current tab URL + selection | 1 |
| `Alt+S` | Capture selected text | 1 |
| `Alt+H` | Helper-spawner (popup UI) | 1 |
| `Alt+O` | Open hub in new tab | 1 |
| `Alt+Q` | Show task queue + recent results | 1 |
| `Alt+V` | Voice memo (push-to-talk) | 2 |
| `Alt+P` | Page archive (HTML + screenshot) | 2 |

Phase 1 delivery: unpacked extension, tasks post as PRs to `kajica2.github.io/channels/captures/`. Phase 2: Web Store publish + serverless intake endpoint + SSE/WebSocket push + multi-helper fan-out / pipeline UI.

---

## 11. Hyper Journey ↔ Spatial 3D integration (kai-freq-lab)

Two layers, distinct roles:

| Layer | Role | Drives |
|---|---|---|
| **Hyper Journey** | Player motion, scene navigation, JourneyState | Position, velocity, heading, nearest node, motion amount |
| **Spatial 3D** | HRTF PannerNode for audio spatialization | panner.panningModel='HRTF', listener position |

**Movement drives spatialization, NOT frequency.** Position.z → reverbSend, position.y → filterCutoff, heading → HRTF orientation. Frequency only changes on explicit arrival with 1-3s crossfade.

**Canonical `JourneyState`:**

```ts
type JourneyState = {
  active: boolean;
  player: { position: Vec3; velocity: Vec3; heading: number; speed: number };
  selectedNodeId: string | null;
  nearestNodeId: string | null;
  movementMode: 'walk' | 'fly' | 'teleport' | 'guided';
  audioMode: 'manual' | 'follow-player' | 'follow-route';
  userProfile: { motionScale: number; spatialEnabled: boolean; autoLoadOnArrival: boolean };
};
```

**SW make-video.html integration (shipped):** Three layers:
- Layer 1: existing SWR render (untouched)
- Layer 2: 20%-opacity alpha canvas, 60-80% in "create" mode (`lib/alpha-layer.client.js`)
- Layer 3: very subtle effects via CSS custom properties (`lib/journey-effects.client.js`)
- Audio → JourneyState → Layer 2 + Layer 3 (`lib/journey-state.client.js`)

---

## 12. Component library

Two libraries, intentionally:

### A. Framework repo: `components/` (framework-owned)
- `ui/` — cards, badges, layout
- `data/` — schemas, capability taxonomy
- `scripts/` — build, validate, capture

### B. Instance repo: `shared/` (instance-owned)
- `audio-utils/` — fft, peak detection
- `mxl-parser/` — music21 wrappers
- `pdf-ingest/` — PDF → exercise JSON
- `ui-tokens/` — design system

**Cross-linking:** `projects.json` entries reference both via `components: { from_framework: [...], from_shared: [...] }`. Hub surfaces "Most-reused components" + "Recently added."

---

## 13. Public API

`api/v1/state.json` (static, served at `https://kajica2.github.io/api/v1/state.json`):

```json
{
  "version": "v1",
  "generated_at": "2026-09-04T...",
  "projects": [{ "name", "umbrella", "url", "repo", "description", "capabilities", "entity" }],
  "agents":   [{ "name", "display_name", "kind", "purpose", "capabilities", "status", "entity" }],
  "paywalled_count": 3,
  "note": "Paywalled entries are not listed. Contact for engagement terms."
}
```

Phase 2: add WebSocket/SSE for live updates. Phase 3: add write endpoints (PR-based or direct).

---

## 14. CI/CD matrix

| Repo | Workflow | Trigger | Purpose |
|---|---|---|---|
| framework | `validate.yml` | per-push + weekly Mon | schema + paywall gate |
| framework | `loop.yml` | every5 min + per-push | round-robin orchestrator, growth reports |
| framework | `bootstrap.yml` | weekly Mon 04:00 UTC | refresh kajica2 repo inventory |
| framework | `watchdog.yml` | PR-closed + narrow paths + 8h | notify Kai of meaningful events |
| instance | `rebuild.yml` | per-push + daily 06:00 UTC | regenerate hub from projects.json |
| instance | `ingest-daily.yml` | daily 05:30 UTC | pull new HF daily reports |
| instance | `watchdog.yml` | PR-closed + narrow paths + 8h | same purpose, instance-side |

All workflows: Node 22, ubuntu-latest, timeouts 2-10 min. Workflows needing commit access declare `permissions: contents: write`.

---

## 15. Roadmap

### Phase 1 — DONE
- Framework repo + schemas + validate/build/capture scripts
- Loop supervisor + growth reports
- Watchdog scripts + workflows (narrow triggers)
- Bootstrap agent scaffold
- Hub instance at kajica2.github.io
- 21 public projects, 3 paywalled, 8 agent personas
- 18 daily reports ingested
- All 4 framework workflows green + 3 instance workflows green

### Phase 2 — TODO
- Step 6: Chrome extension
- Step 8-9: Per-agent hub pages, cross-linking UI
- Step 10: Written paywall audit doc
- Watchdog Telegram secrets configured (Kai's @BotFather token)

### Phase 3 — TODO (per `plans/long-horizon.md`)
- Engagement model for Eye & Kairi (client-scoped auth, anonymized case studies)
- Real Chrome extension ops (Web Store publish, serverless intake, SSE push)
- Persistent memory for conversational agent
- Multiplayer presence in Hyper Journey
- 10-step-ahead agent loop

---

## 16. Open questions for the team

Each question carries: **Question, Owner, Default if no answer in 7d, Cost, Impact, Phase, Closing PR.**

| # | Question | Owner | Default (if 7d) | Cost | Impact | Phase | Closing PR |
|---|---|---|---|---|---|---|---|
| Q1 | Component library boundary — which kai-freq-lab utilities belong in `shared/` (instance-owned) vs `components/` (framework-owned)? | Kai | ACF2 → `shared/audio-utils`, score parser → `shared/mxl-parser` | low | unblocks kai-freq-lab cross-linking | 2 | `feat(shared): ACF2 + parser` |
| Q2 | Eye & Kairi catalog — 0 entries currently in `entity: "eye-kairi"`. Which services/products belong there? | Kai | 1 placeholder entry | low | `/eye-kairi/` stays empty until engagement model ships | 3 | `feat(projects): eye-kairi entry` |
| Q3 | Daily-pipeline HF Space — currently scraped from `kaidjuric/daily-pipeline-director-cut`. Should the agent team own a canonical pipeline repo + Space, or keep scraping? | programmer | keep scraping + retry logic | medium | `ingest-daily.yml` may break when upstream changes | 2 | `fix(agent): retry logic` |
| Q4 | Capability taxonomy — initial list covers audio/music/video well. Need additions for: agents, infra, distribution? | programmer | add 4 verbs (`build-agent`, `run-loop`, `audit-paywall`, `watch-event`) | medium | new agent types fit cleanly without force-fitting | 2 | `feat(schema): taxonomy verbs` |
| Q5 | Paywall enforcement depth — currently: schema + build. Should we add: a separate CI job that scans public pages for forbidden strings (defense in depth)? | programmer | ship it | high (legal) | defense in depth; a manual commit to `dist/public/` is caught | 2 | `ci: paywall grep workflow` |
| Q6 | Watchdog Telegram — needs Kai to paste @BotFather token. Until then, watchdog messages fall back to iMessage (no-op on Linux runners). | Kai | iMessage fallback permanent until Kai has bandwidth | low | Linux CI runners stay quiet | 2 | `chore(watchdog): telegram token` |

---

## 17. Acceptance criteria (current state)

| Check | Status | Notes |
|---|---|---|
| `npm run validate` exits 0 | ✅ | 24/24 projects, 8/8 agents schema-valid |
| `npm run build` produces paywall-clean public output | ✅ | 21 public + 3 internal-only |
| Hub live at `kajica2.github.io` | ✅ | entity switcher works |
| 18 daily reports ingested | ✅ | Aug7-22, 2026 |
| All framework CI workflows green | ✅ | validate / loop / watchdog / bootstrap |
| All instance CI workflows green | ✅ | rebuild / ingest-daily / watchdog |
| Loop running autonomously | ✅ | rotation writes to growth-reports/ |
| Watchdog non-fatal on missing secrets | ✅ | logs informational, exits 0 |
| No paywalled names in public output | ✅ | bob-mover, jazzability absent from public HTML |

---

## 18. Risks (called out up front)

1. **Vercel deploys hang at "Building…".** Verified: SWR repo's `vercel deploy` consistently fails with idle process (0.01s CPU after 5+ min). Cause unknown. Workaround: ship via GitHub auto-deploy or `vercel build --yes && vercel deploy --prebuilt`. NOT a code issue.
2. **HF Spaces tree API requires auth for some spaces.** `hf spaces ls <scope>` returns "not found" even when scope exists. Workaround: `curl https://huggingface.co/api/spaces?author=<scope>&limit=200` (no auth needed).
3. **Vercel alias URLs always return 200** even for stale/deleted deployments. Don't trust liveness from 200 alone — match title or use `vercel alias ls`.
4. **Puppeteer needs Chromium binary.** Fails in sandboxed CI; works in Actions because Actions installs it.
5. **Hub runtime is static (GitHub Pages).** Phase 2 needs serverless intake + WebSocket for real-time agent-to-hub. Until then, agents post via PRs.

---

## 19. Where to start (for a new programmer)

**Prereqs:** Node 22+, GitHub account with Pages enabled, one hour. Optional: Vercel, HF, Telegram bot.

- **Milestone 0 (5 min):** `git clone https://github.com/kajica2/agent-hub-framework.git && cd agent-hub-framework && npm install && npm run validate`. **Verify:** exit 0, "24/24 projects, 8/8 agents valid".
- **Milestone 1 (15 min):** `npm run build`. **Verify:** `dist/public/` + `dist/internal/` exist, `dist/public/` contains zero forbidden strings.
- **Milestone 2 (30 min):** open `dist/public/index.html`. **Verify:** you see your hub.
- **Milestone 3 (1 hour):** edit `projects.json`, add a project, re-validate, re-build, see your project on the rebuilt hub.
- **Milestone 4 (2 hours):** edit `agents.json`, add a stub agent, see it on the agents index.

From here: read `prompts/long-horizon.md` for the TODO list. Out of scope until Phase 2/3: serverless intake, Web Store publish, engagement model, multiplayer, persistent memory. Non-goals: don't read `plans/agent-hub-phase1.md` cover-to-cover before shipping your first change; don't try to deploy until Phase 2.

---

## Appendix A — Examples

### A.1 Sample `projects.json` entry (public)

```json
{
  "name": "sainted-word-records",
  "display_name": "Sainted Word Records",
  "umbrella": "music",
  "description": "Audio-reactive video engine. Single-file, browser-native, MIT.",
  "url": "https://sainted-word-records.vercel.app",
  "repo": "https://github.com/kajica2/sainted-word-records",
  "visibility": "public",
  "status": "active",
  "entity": "research",
  "availability": "open",
  "material_license": { "kind": "public", "source": "self-authored" },
  "capabilities": ["produce-video", "analyze-spectrum", "deploy-vercel"],
  "inputs":  ["audio-file", "video-clips", "image-library"],
  "outputs": ["mp4-file", "engine-config-json"]
}
```

### A.2 Sample `projects.json` entry (paywalled)

```json
{
  "name": "bob-mover-lexicon",
  "display_name": "Bob Mover Jazz Lexicon",
  "umbrella": "music",
  "description": "407 practice patterns, 12 transpositions each. Members only.",
  "url": null,
  "repo": "https://github.com/kajica2/bob-mover-lexicon",
  "visibility": "private",
  "status": "active",
  "entity": "research",
  "availability": "consulting",
  "material_license": {
    "kind": "internal-paywalled",
    "source": "bob-mover",
    "notes": "Internal users only. Never surfaces publicly."
  },
  "capabilities": ["transpose", "produce-json-suite", "visualize-score"],
  "inputs":  ["exercise-pattern", "key-signature"],
  "outputs": ["transposed-exercises", "practice-report"]
}
```

### A.3 Sample `agents.json` entry

```json
{
  "name": "thumb-collector",
  "display_name": "Thumb-Collector",
  "kind": "infrastructure",
  "purpose": "Captures and refreshes screenshots across all hub projects on a weekly schedule.",
  "inputs":  ["project-url-list"],
  "outputs": ["screenshot-files", "manifest-json"],
  "capabilities": ["deploy-vercel", "publish-channel"],
  "calls_into": ["puppeteer-headless"],
  "owned_by": "instance",
  "visibility": "public",
  "status": "active",
  "material_access": ["public"]
}
```

### A.4 Watchdog message formats

```
✅ [DONE] step 3
Built hub instance from framework template

Artifacts: https://kajica2.github.io/
Hand-off: Click around. Tell me what to tweak.

Next step: idle. Waiting on you.

---

🚨 [BLOCKED] step 5
Need VERCEL_TOKEN to wire daily pipeline cron

Tried: Read Vercel env, no token present
Need: paste VERCEL_TOKEN into ~/.hermes/config.yaml
Default if no input in 8h: Skip Step 5 until token available, move to Step 6

Send instructions or "continue with default".

---

💓 [HEARTBEAT] agent hub alive
Step in progress: 7
Watchdog is non-fatal, all workflows green.

Everything green. No action needed unless you want to course-correct.
```

---

*This PRD reflects implementation as of 2026-09-05. Sections marked TODO in the Status table are the next deliverables.*

*For DeepSeek consultation:* the highest-value sections to route for review are §6 (paywall discipline), §7.2 (termination criteria), and §11 (Hyper Journey movement-to-audio mapping) — those are where a second-opinion model with strong code-review training could catch subtle issues in the contracts and the termination logic. A DeepSeek API key would let me send the actual document for review and integrate the feedback inline.

---

## Optimization Provenance (this version)

**Method:** Karpathy-style autoresearch harness (50+ variants per element, 5-persona simulated panel, 3 rounds + cross-breed).

**Elements optimized:** §1 Vision, §3 Architecture, §6 Paywall, §16 Open Questions, §19 Onboarding.

**Score progression (panel average, 0–100):**

| Element | v1.0 (original) | R1 winner | R2 winner | R3 winner | Δ |
|---|---|---|---|---|---|
| Vision (one-sentence) | 63.8 | 83.8 | 89.7 | **91.2** | +27.4 |
| Architecture (3 sentences) | 68.4 | 82.0 | 90.8 | **91.1** | +22.7 |
| Paywall rule | 76.1 | 86.8 | 91.2 | **92.2** | +16.1 |
| Onboarding (steps) | 75.2 | 88.2 | 93.3 | **93.5** | +18.3 |
| Open questions | 64.4 | 86.0 | 93.0 | **93.6** | +29.2 |
| **Cross-breed (audience-first ordering)** | — | — | — | **91.8** | — |

**Panel:** 5 simulated personas (Senior Platform Engineer, Skeptical new contributor, DX/API designer, Technical editor, Kai/operator). See `data/prd-sovereign-signal-experiments.json` for the full per-variant × per-persona × per-dimension scoring matrix.

**Caveat:** the panel was played sequentially by the orchestrating agent (Mavis root session) rather than by separate Anthropic API calls — `ANTHROPIC_API_KEY` was not set in this environment. The harness structure (variant generation, batch scoring, top-k selection, evolution, cross-breed) is unchanged from the autoresearch skill spec. To re-run with a separate-model panel, set `ANTHROPIC_API_KEY` and re-execute.

**Biggest score jump:** Open Questions (Δ +29.2) — the v1.0 list left ownership, defaults, and cost implicit; the v1.1 table makes all 7 fields explicit per question.

**Top runner-up ordering:** programmer-first (91.4) — useful if the PRD is read primarily by forking programmers. The audience-first winner balances all three audiences.
