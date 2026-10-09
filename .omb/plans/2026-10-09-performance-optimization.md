# Performance Optimization Plan
## Variant Auto-Switch + Targeting Model v2

**Date:** 2026-10-09
**Target:** sainted-word-records.vercel.app
**Scope:** Engine performance, targeting model upgrade, variant auto-switch

---

## Problem Statement

Current engine performance issues:
- Engine page loads 88 JS files upfront (73MB heap)
- No caching of audio analysis results
- Targeting classifier is rule-based v1
- Variant drawFx compiled at startup, not lazy-loaded

---

## Change Units

### CU-1: Variant Auto-Switch Caching

**Current Evidence:**
- `lib/variant-picker.mjs:1-30` - pure function picker, no caching
- `client/variant-switcher.client.js:40-80` - loads all variants upfront

**Implementation Shape:**
```
lib/variant-picker.mjs:
- add `cacheAnalysis(analysis)` → IndexedDB
- add `getCachedAnalysis(src)` → cached or null
- modify `pick()` to check cache first

client/variant-switcher.client.js:
- lazy-load variant drawFx via dynamic import
- add `prefetchVariant(id)` method
- cache compiled drawFx in Map
```

**Test:**
- `check-variant-picker-unit.mjs` - add cache hit/miss tests
- `verify-variant-cache-smoke.mjs` - verify IndexedDB caching works

---

### CU-2: Lazy-Load Variant drawFx

**Current Evidence:**
- `client/variant-switcher.client.js:100-150` - `activate()` compiles all drawFx
- `engine.html:1700-1730` - script loading order

**Implementation Shape:**
```
client/variant-switcher.client.js:
- modify activate() to compile only requested variant
- add variant cache: Map<id, {compiled, canvas}>
- lazy fetch /versions/{id}.html only when needed
- prefetch top-2 variants on page load
```

**Test:**
- `check-variants-unit.mjs` - verify lazy compilation
- Measure: initial JS files should drop from 88 to ~50

---

### CU-3: Targeting Model v2 (Confidence Scoring)

**Current Evidence:**
- `client/targeting.client.js:50-80` - VERSION = 'swr-targeting/v1'
- `targeting/rules.json` - personaToVariant mapping (rule-based)

**Implementation Shape:**
```
client/targeting.client.js:
- bump VERSION to 'swr-targeting/v2'
- add `classifyWithConfidence()` → {personaId, confidence, alternatives}
- modify `maybeReorderVariants()` to use confidence weights
- add signal: 'classification_confidence'

targeting-pipeline/build-rules.mjs:
- add confidence thresholds to VARIANT_AFFINITY
- emit v2 schema with confidence scores per mapping

targeting/rules.json:
- v2 schema: {personaToVariants: {variant: {score, confidence}}}
```

**Test:**
- `check-targeting-unit.mjs` - verify confidence scoring
- `verify-targeting-smoke.mjs` - verify v2 API compatibility

---

### CU-4: Script Loading Optimization

**Current Evidence:**
- `engine.html:1724-1730` - targeting loads before variant-switcher
- All 88 JS files load synchronously on page load

**Implementation Shape:**
```
engine.html:
- add `defer` to variant-switcher.client.js
- add dynamic import: `import('/client/variant-switcher.client.js')` on first #variant interaction
- move targeting to non-blocking (already defer, verify)

Optimize:
- Only load automix-runtime.client.js when needed
- Lazy-load storyboard modules on demand
```

**Test:**
- Measure: initial JS files load should drop to ~45
- Heap reduction: 73MB → 45MB target

---

## Execution Structure

| Step | Agent | Skill | Dependencies | Deliverable |
|------|-------|-------|--------------|--------------|
| 1 | @omb-tdd | omb-tdd | CU-1 specs | TDD for variant caching |
| 2 | @omb-codex-run | omb-codex-run | CU-1, step 1 | Implement cache in variant-picker |
| 3 | @omb-tdd | omb-tdd | CU-2 specs | TDD for lazy load |
| 4 | @omb-codex-run | omb-codex-run | CU-2, step 3 | Implement lazy variant loading |
| 5 | @omb-tdd | omb-tdd | CU-3 specs | TDD for v2 model |
| 6 | @omb-codex-run | omb-codex-run | CU-3, step 5 | Implement v2 targeting |
| 7 | @omb-tdd | omb-tdd | CU-4 specs | TDD for script loading |
| 8 | @omb-codex-run | omb-codex-run | CU-4, step 7 | Implement script optimization |
| 9 | @omb-verify | omb-verify | all steps | Verify performance metrics |

---

## Verification Commands

```bash
# Unit tests
npm run check-variant-picker-unit
npm run check-targeting-unit
npm run check-variants-unit

# Smoke tests  
npm run verify-variant-cache-smoke
npm run verify-targeting-smoke

# Performance validation
# Expected: JS files 88 → 45, Heap 73MB → 45MB
```

---

## Non-Goals

- No changes to automix-runtime (out of scope)
- No ML model training (rule-based v2 is lightweight)
- No breaking API changes (backward compatible)

---

## Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| Cache invalidation | Medium | Use src + duration hash as key |
| Lazy-load latency | Medium | Prefetch top-2 variants |
| v2 breaking older clients | Low | Graceful fallback to v1 |

---

## Timeline

- CU-1 (Caching): 1 day
- CU-2 (Lazy-load): 1 day
- CU-3 (v2 Model): 2 days
- CU-4 (Script loading): 1 day

**Total: 5 days**
