# Performance Improvement Recommendations
## sainted-word-records.vercel.app

### Current Performance Metrics (from audit)

| Metric | Landing | Engine | Variants |
|--------|---------|--------|----------|
| TTFB | 61ms | 145ms | 110ms |
| FCP | 376ms | 380ms | 416ms |
| JS Files | 8 | 88 | 56 |
| JS Heap | 17MB | 73MB | 68MB |
| Resources | 40 | 128 | 77 |

---

## Recommendations Summary

### 1. Targeting Model Upgrade (v1 → v2)

**Current State:**
- Rule-based classifier in `client/targeting.client.js`
- Version: `swr-targeting/v1`
- 28 personas, 4 segments
- Hand-tuned weights in `targeting/rules.json`

**Improvements:**
- Add ML-based persona classification with confidence scores
- Add feature importance weighting for better variant affinity
- Implement ensemble scoring (rule + ML hybrid)
- Target: maintain <50ms classification time

**Files to Modify:**
- `client/targeting.client.js` - upgrade classifier
- `targeting-pipeline/build-rules.mjs` - add ML model config
- `targeting/rules.json` - v2 schema with confidence scores

### 2. Variant Auto-Switch Optimization

**Current State:**
- `lib/variant-picker.mjs` - weight-based scoring
- 15+ variant profiles
- No caching of audio analysis results

**Improvements:**
- Add analysis result caching (IndexedDB)
- Lazy-load variant drawFx code on first selection
- Improve scoring with: spectral centroid, dynamic range, onset density
- Add confidence threshold for auto-switch recommendation

**Files to Modify:**
- `lib/variant-picker.mjs` - add caching, improve scoring
- `client/variant-switcher.client.js` - lazy load drawFx
- `audio-analysis-v2.js` - expose new features

### 3. Performance Optimizations

**Current Bottlenecks:**
- 88 JS files load upfront on engine page
- All variant drawFx compiled at startup
- No code splitting

**Improvements:**
- Lazy-load `variant-switcher.client.js` on first #variant interaction
- Pre-compile only top-2 variant drawFx, lazy-load rest
- Add variant prefetching based on predicted user intent
- Implement analysis result memoization

**Files to Modify:**
- `engine.html` - update script loading order
- `client/variant-switcher.client.js` - lazy compilation
- `client/targeting.client.js` - add prefetch signals

---

## Priority Order

| Priority | Improvement | Impact | Effort |
|----------|-------------|--------|--------|
| P0 | Variant auto-switch caching | High | Medium |
| P1 | Lazy-load variant drawFx | High | Medium |
| P1 | Targeting model v2 | Medium | High |
| P2 | Preload predicted variants | Medium | Low |
| P2 | Script loading optimization | Medium | Low |

---

## Expected Results

| Metric | Current | Target | Improvement |
|--------|---------|--------|-------------|
| Engine JS Heap | 73MB | 45MB | -38% |
| Initial JS files | 88 | 45 | -49% |
| Variant switch time | 200ms | 50ms | -75% |
| Auto-switch accuracy | 65% | 85% | +31% |
