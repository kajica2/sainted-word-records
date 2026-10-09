# Site Sweep Plan

## Executive Summary

Comprehensive plan for auditing the Sainted Word Records site for broken links, broken pages, and inconsistencies.

---

## Sweep Results

### Live Site Issues Found

| Issue | Status | Fix Applied |
|-------|--------|-------------|
| `/engine-personas` → 404 | Fixed on deploy | Local removes the broken link |
| Atlas pages removed from nav | Keep removed | Per commit cabf69e - move to artist/member content later |

### Fixed During Sweep

| Issue | Fix |
|-------|-----|
| `marketplace-claim.html` missing `og:image` | Added og:image pointing to press/og-card.png |
| `versions/temple-of-control.html` no exit link | Added ← Site exit link |

### Pre-existing Regression (Not From Sweep)

| Test | Issue | Owner |
|------|-------|-------|
| `check:variant-switcher-unit` | neon fails with 404 | Commit cabf69e - variant-switcher.client.js prefetch race |

---

## Current Check Status

| Check | Status |
|-------|--------|
| `check:dist-links` | ✓ 4/4 |
| `check:site-chrome` | ✓ (fixed) |
| `check:sitemap` | ✓ |
| `check:variant-switcher-unit` | ✗ neon 404 (pre-existing) |

---

## Recommended Next Actions

### Immediate (Before Deploy)

1. **git add** new files:
   - `versions/temple-of-control.html`
   - `marketplace-claim.html`

2. **Commit** the sweep fixes:
   - vercel.json (+2 rewrites for temple-of-control)
   - site-map.json (temple-of-control in unlisted)
   - sitemap.xml
   - marketplace-claim.html (og:image fix)
   - versions/temple-of-control.html (exit link + tracked)

3. **Deploy** — fixes `/engine-personas` 404, adds Early Access

### Future Work (Backlog)

1. Fix `check:variant-switcher-unit` neon failure (pre-existing regression from cabf69e)
2. Add bare-relative href coverage to `check-dist-links.mjs`
3. Add `footerNav` bucket to href validation
4. Add HTTP-level live site crawl

---

## Known Gaps in Static Analysis

1. **Bare-relative / parent-relative hrefs** — not parsed by LINK_RE
2. **footerNav / unlisted buckets** — not collected in href pass
3. **Redirect destinations** — never validated
4. **Runtime links** — no HTTP crawl of live site
