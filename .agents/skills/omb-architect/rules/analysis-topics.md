# Analysis Topics and Per-Agent Prompt

Cited by `.claude/skills/omb-architect/SKILL.md` Step 3. Do not duplicate this table
back into `SKILL.md`.

## 9 Analysis Topics

Each agent provides evidence-based findings on ALL 9 topics. For topics outside the
agent's domain, state `"No findings from my perspective."`.

| # | Topic | Focus | Primary evidence type |
|---|-------|-------|-----------------------|
| 1 | GOAL-FIT | Whether the scope's current shape serves the stated goal; hotspots that block it | `file:line` from the hotspots Markdown or inventory JSON |
| 2 | LATENT-DEFECTS | Infinite loops, memory/connection leaks, unreleased resources, race conditions | `file:line` with defect category |
| 3 | MODULARIZATION | Files/functions over threshold, god-files, mixed responsibilities per `.claude/rules/common/file-size-rules.md` | inventory `files[]`/`functions[]`/`package_smells[]` entries |
| 4 | DESIGN-PATTERNS | Missing/misused patterns, layer-boundary violations per `.claude/rules/common/architectural-boundaries.md` and `.claude/rules/common/design-patterns.md` | import/dependency evidence or `file:line` |
| 5 | SOT-DRIFT | Code vs `docs/` or `openwiki/` mismatches; stale ADRs; cross-service contract drift | doc path + description of mismatch |
| 6 | BEHAVIOR-RISK | Areas likely to break; test-coverage gaps on the scope; missing integration tests | test file path or "no test found" |
| 7 | SECURITY | Input validation gaps, secret handling, auth/authz boundaries touched by the scope | `file:line` with OWASP-style category |
| 8 | UTILITY-EXTRACTION | Duplicate functions (`duplicates[]`), repeated logic worth extracting to a shared module | inventory `duplicates[]` entries |
| 9 | NAMING | Naming-convention violations (`naming_violations[]`) and inconsistent naming across the scope | inventory `naming_violations[]` entries |

## Per-Agent Prompt Template

Fill `{agent-role}` and `{agent-strengths}` per the agent's own definition file. `name` carries
the same value as `subagent_type` (SKILL.md HARD rule #8).

```
Agent({
  subagent_type: "{agent-name}",
  name: "{agent-name}",
  run_in_background: true,
  prompt: "<analysis_context>
Scope: {scope}
Goal: {goal}
Interview summary: {interview_summary_path_or_none}
Inventory JSON (absolute path): {inventory_json_path}
Hotspots Markdown (absolute path): {hotspots_md_path}
Rules manifest: .claude/rules/common/INDEX.md
Prior Art (if research_mode=true): {prior_art_list_or_none}
</analysis_context>

<role>
You are {agent-role}. Your analysis strengths: {agent-strengths}.
Read the inventory JSON and hotspots Markdown with the Read tool before analyzing.
Focus your findings on areas where your domain expertise is most relevant.
For topics outside your domain, state 'No findings from my perspective.'
</role>

<task>
Analyze the scope against the 9 analysis topics above. For EACH finding:
1. State the topic number and name (e.g., '2. LATENT-DEFECTS').
2. Cite file:line evidence, or the specific inventory JSON entry it came from.
3. Assign severity: BLOCKING or NON-BLOCKING.
4. State the impact on the goal in one sentence.
</task>

<output_format>
For each topic:

### {N}. {TOPIC NAME}

| # | Finding | Severity | file:line | Goal Impact |
|---|---------|----------|-----------|-------------|
| 1 | {finding} | BLOCKING | app/foo.py:42 | {one sentence} |

Limit findings to at most 5 per topic; one line per finding row.

End with the standard omb output envelope per .claude/rules/common/output-contract.md.
</output_format>"
})
```

## Specializations

**`@core-critique`** (critical; veto power per `rules/consensus.md`):

```
<specialization>
Apply pre-mortem analysis: assume the design will fail — identify the top 3 failure
modes. Verify every claim against the inventory JSON and hotspots Markdown before
rendering a verdict. Your BLOCKING findings carry veto power (minimum P1 in consensus
regardless of vote count).
</specialization>
```

**`@code-debug`** (Topic 2 focus):

```
<specialization>
Focus exclusively on Topic 2 (LATENT-DEFECTS). Scan for:
- Infinite loops: every `while True` / recursive call without a verified bounded exit.
- Memory leaks: module-level unbounded lists/dicts; generators vs full list
  materialization.
- Connection leaks: bare `open()`, `connect()`, HTTP client construction outside a
  `with` block.
- Race conditions: shared mutable state accessed from concurrent coroutines without
  locks.
- Error-swallowing: bare `except:` or `except Exception: pass` that discards
  exceptions silently.
Assign BLOCKING to any defect classified P0 in
`.claude/skills/omb-evaluation-refactoring/SKILL.md`.
</specialization>
```

**`@security-audit`** (Topic 7 focus):

```
<specialization>
Focus primarily on Topic 7 (SECURITY). Check for missing input validation at system
boundaries, secrets read from anywhere other than environment variables, and
authorization checks that the scope's design would bypass or weaken. Assign BLOCKING to
any OWASP Top 10 category finding.
</specialization>
```

**`@wiki-reviewer`** (conditional — only when `openwiki/index.md` exists; Topic 5
focus):

```
<specialization>
Focus exclusively on Topic 5 (SOT-DRIFT). Check openwiki/ blueprint against the scope:
- Identify wiki notes whose `sources:` reference files in the scope.
- Flag mismatches between wiki descriptions and current code structure.
- Identify cross-service contracts the scope's redesign may affect.
Use the WP-P{0-3}-{NNN} ticket prefix for every finding (see `rules/consensus.md`).
</specialization>
```

**Wait for:** `<omb>DONE</omb>` from every resolved team member (per the watchdog
protocol in `SKILL.md`) before proceeding to Step 4.
