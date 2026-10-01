# Autoresearch Mode for SWR Preset Pipeline

Inspired by [karpathy/autoresearch](https://github.com/karpathy/autoresearch) — AI agents running autonomous research on a fixed time budget.

## Philosophy

> Give an agent a simple setup and let it experiment. You wake up to a log of experiments and (hopefully) improved results.

Autoresearch principles applied to SWR:
- **Single editable file** — Agent only touches preset JSON, not the engine
- **Fixed time budget** — Each experiment runs for a fixed duration, making results comparable
- **One metric** — Composite quality score that can improve over time
- **Wake up to results** — Commit-driven loop: mutate → verify → score → commit if improved

## Current State

The preset pipeline today:
1. `generate.py` picks random seeds (shader + palette + motion)
2. Outputs JSON to `presets/YYYY-MM-DD-<slug>.json`
3. `verify.mjs` checks schema compliance
4. Human reviews and commits

**Gap**: No feedback loop, no quality score, no autonomous improvement.

## Proposal

Add an autonomous experiment loop that:
1. Takes existing presets as input
2. Applies LLM-guided mutations
3. Scores each variant against a quality metric
4. Commits only if quality improves

```
┌─────────────────────────────────────────────────────────────────┐
│                     AUTORESEARCH LOOP                            │
├─────────────────────────────────────────────────────────────────┤
│  input: top 5 user-favorite presets (from usage signals)       │
│         OR top 5 highest-quality presets (from quality_score)   │
│                          ↓                                      │
│  LLM mutation pass: tweak fx_state values, swap palette,       │
│                      reassign audio_reactivity bands             │
│                          ↓                                      │
│  generate candidate preset JSON                                  │
│                          ↓                                      │
│  verify.mjs: schema compliance gate (30s max)                  │
│                          ↓                                      │
│  quality_score: composite metric (60s max)                     │
│     = 0.4 * novelty + 0.3 * schema + 0.3 * completeness      │
│                          ↓                                      │
│  if score > baseline: commit + push                             │
│     else: discard                                               │
│                          ↓                                      │
│  wake up to: new preset committed, quality_score improved        │
└─────────────────────────────────────────────────────────────────┘
```

## Implementation

### 1. Quality Score (NEW)

```python
def quality_score(preset: dict) -> float:
    """Composite quality metric. Higher = better."""
    
    # Schema score (did it pass verify.mjs?)
    schema_score = 1.0 if verify.mjs passes else 0.0
    
    # Completeness (all optional fields present?)
    has_preview = 'preview' in preset and preset['preview'].get('thumbnail_svg')
    has_photo = 'photo' in preset
    completeness = 0.5 + 0.25 * has_preview + 0.25 * has_photo
    
    # Novelty (how different from existing presets?)
    # Cosine similarity of fx_state vector to nearest existing preset
    # 1.0 = completely novel, 0.0 = duplicate
    novelty = compute_novelty(preset, existing_presets)
    
    return 0.4 * novelty + 0.3 * schema_score + 0.3 * completeness
```

**Why these weights:**
- Novelty (0.4) — We want new presets to be genuinely different
- Schema (0.3) — Must be valid, but that's baseline
- Completeness (0.3) — Prefer rich presets with preview/photo

### 2. LLM Mutation Pass (NEW)

```python
def mutate_preset(parent: dict, instruction: str) -> dict:
    """Apply LLM-guided mutation to a preset."""
    
    prompt = f"""
    You are an autonomous research agent improving visual presets.
    
    Parent preset:
    {json.dumps(parent, indent=2)}
    
    Instruction: {instruction}
    
    Mutate the preset by:
    1. Tweak 2-3 fx_state values by ±0.1-0.2
    2. Optionally swap palette colors
    3. Optionally reassign audio_reactivity bands
    
    Output valid JSON. Do not change id, schema, or created_at.
    """
    
    response = llm.generate(prompt)
    return json.loads(response)
```

**Instructions variants:**
- "Increase visual complexity" → boost `chroma`, `glitch`, `grain`
- "Make it calmer" → reduce `glitch`, increase `liquid`, `pearl`
- "More bass-reactive" → reassign `bass` to more fx_state keys
- "Softer colors" → shift palette toward lower saturation

### 3. Time Budgets (NEW)

| Stage | Budget | Rationale |
|-------|--------|-----------|
| LLM mutation | 10s | Fast generation |
| verify.mjs | 30s | Schema check |
| quality_score | 60s | Similarity computation |
| **Total per experiment** | **100s** | ~6 experiments/minute |

**Apply to existing verify scripts:**
```bash
# Add --timeout flag to each verify-*.mjs
timeout 60s node verify-automix.mjs
timeout 60s node verify-story-graph.mjs
```

### 4. Commit Discipline (NEW)

```
# Agent workflow
1. Pick parent preset (highest quality OR random favorite)
2. Generate mutation instruction
3. Mutate → verify → score
4. If score > baseline:
     git add presets/NAME.json
     git commit -m "autoresearch: mutation from PARENT_ID, score=0.X"
     git push
   else:
     log "discarded: score=0.X < baseline=0.Y"
```

## File Changes

```
preset-pipeline/
├── AUTORESEARCH_MODE.md     ← this file
├── generate.py              ← add mutate_preset()
├── verify.mjs               ← add --quality-score flag
├── quality.py      (NEW)    ← quality_score() implementation
├── mutate.py       (NEW)    ← LLM mutation wrapper
└── autoresearch.sh (NEW)    ← autonomous loop entry point
```

## Usage

```bash
# Run one autonomous experiment
./autoresearch.sh

# Run N experiments (default: 10)
./autoresearch.sh --count 10

# Run with specific parent preset
./autoresearch.sh --parent swr-preset-2026-09-15-aurora-bloom

# Dry-run (don't commit)
./autoresearch.sh --dry-run
```

## Cron Integration

```bash
# Run autoresearch loop every hour, log to out/autoresearch.log
0 * * * * cd /Users/kajicadjuric/Documents/sainted-word-records/preset-pipeline && ./autoresearch.sh >> ../out/autoresearch.log 2>&1
```

## Metrics to Track

| Metric | Source | Target |
|--------|--------|--------|
| quality_score | quality.py | ↑ over time |
| experiments/hour | autoresearch.sh | ≥ 6 |
| novelty_score | quality.py | ≥ 0.7 |
| schema_pass_rate | verify.mjs | ≥ 0.95 |

## Comparison: Autoresearch vs SWR

| Aspect | Karpathy Autoresearch | SWR Preset Autoresearch |
|--------|----------------------|--------------------------|
| Editable file | train.py | preset JSON |
| Metric | val_bpb | quality_score |
| Time budget | 5 min | 100 sec |
| Experiments/hour | ~12 | ~6 |
| Feedback | log file | git commits |
| Human role | writes program.md | reviews commits |

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| LLM generates invalid JSON | verify.mjs gate rejects |
| Quality score gaming | Novelty component prevents duplicates |
| Too many commits | Limit to 1 commit per hour via cron |
| Schema drift | verify.mjs must pass before commit |

## Future: Usage-Based Mutation

Once Phase 3 ships (engine tracks persona use locally):
```
# Mutate from user's actual favorite, not global top
parent = get_user_favorite_preset(user_id)
instruction = f"Make it more {user_preference}"
```

## References

- [karpathy/autoresearch](https://github.com/karpathy/autoresearch) — inspiration
- [preset-pipeline/README.md](./README.md) — existing pipeline docs
- [preset-pipeline/SCHEMA.md](./SCHEMA.md) — preset spec
