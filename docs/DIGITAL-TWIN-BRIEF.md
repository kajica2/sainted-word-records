# Digital Twin Brief — Sained Word Records

**Created:** 2026-10-09  
**Status:** Consolidation of open issues + digital twin scope definition

---

## Part 1: Open Issues Summary

### Issue #202 — Artist Booking Platform Direction
**Labels:** enhancement  
**Created:** 2026-10-08

A direction request for an artist booking platform. Contains an attachment (screenshot/wireframe) showing the proposed UI/UX direction.

**Action needed:** Review attachment, define scope for artist booking feature.

---

### Issue #121 — Engine Upgrade: Preset Picker, Pipeline, Releases
**Labels:** enhancement  
**Created:** 2026-09-28

Comprehensive upgrade to the preset management interface. Eight main areas:

1. **Split page functions** — Separate preset picker, live system status, and release history into tabs/sections
2. **Clearer preset card** — Better information architecture with ID, date, description, tags, audio mapping, FX state
3. **User controls** — Search, filter, sort, favorites, collections, deep links, thumbnails, keyboard shortcuts
4. **Jargon clarification** — Fix units display (FX keys, manifest health, production status, pipeline rate)
5. **Accessibility** — Label icon-only buttons, focus states, ARIA, reduced-motion, mobile swipe
6. **Pipeline improvements** — Show run status, manual trigger, schema validation, fallback, caching, health endpoint
7. **Release notes** — Timeline view, filters, badges, breaking changes, migration notes
8. **Future features** — Preset editor, A/B compare, export, shareable links, BPM/key display, offline PWA, community remix

**Priority fixes:**
- Split preset picker vs status vs changelog
- Rewrite preset card with clear labels
- Add search/filter/favorites + deep links
- Pipeline observability + error states
- Accessibility + keyboard support

---

### Issue #75 — Canvas.captureStream() Black Frames (Headless)
**Labels:** bug  
**Created:** 2026-09-12  
**Status:** **FIXED** (per comments 2026-10-09)

**Root cause:** `fx-postprocess.js` line 403 — WebGL canvas created with `preserveDrawingBuffer: false`

**Fix applied:** Changed to `preserveDrawingBuffer: true`

**Verification needed:** Run `scripts/diag-gradient-diff.mjs` reproducer; test in-page REC on `versions/*.html`

**Note:** Issue still shows as OPEN in GitHub but has fix comments. Should be closed.

---

## Part 2: Digital Twin — Local Development Mirror

### What Was Dropped

Three files were removed in commit `b57d141` (2026-10-09) as "digital-twin work outside this PR scope":

| File | Purpose |
|------|---------|
| `tools/local-dns.mjs` | Local DNS server answering `sainted-word.test` → `127.0.0.1` |
| `tools/local-dns.config.json` | DNS configuration (subdomains, forward rules) |
| `tools/local-dns-system.sh` | System setup script (`/etc/resolver/` stub) |

### What Currently Exists

| Component | Status |
|-----------|--------|
| Vite dev server | `http://127.0.0.1:5174/` |
| `dev-vercel-rewrites` plugin | ✅ Active (dev-only) — mirrors production routes locally |
| `allowedHosts` in vite.config.js | ✅ Lists `sainted-word.test` + subdomains (ready for future use) |
| Local nameserver | ❌ Dropped |

### The Gap

- **Production:** `https://sainted-word.test/*`
- **Dev:** `http://127.0.0.1:5174/*` (works for all routes via rewrite plugin)
- **Digital twin:** `http://sainted-word.test:5174/*` (requires nameserver)

Without the nameserver, developers cannot test:
- Real hostname-dependent behavior (cookies, CORS, localStorage domain)
- Production-accurate URL structures
- Subdomain-specific routing (if any future features use subdomains)

### Required for Digital Twin

```
┌─────────────────────────────────────────────────────────────┐
│                    DIGITAL TWIN ARCHITECTURE                │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│   ┌─────────────┐     ┌────────────────────────────┐     │
│   │   macOS     │     │     /etc/resolver/         │     │
│   │  Resolver   │────▶│  nameserver 127.0.0.1      │     │
│   └─────────────┘     │  port 53                   │     │
│        ▲              └────────────┬───────────────┘     │
│        │                           │                      │
│        │                    ┌──────▼──────┐             │
│        │                    │ local-dns.mjs │             │
│        │                    │ (UDP port 53) │             │
│        │                    └──────┬──────┘             │
│        │                           │                      │
│        │              ┌───────────┴───────────┐          │
│        │              │                       │          │
│   Query:         ┌────▼────┐           ┌──────▼─────┐    │
│   sainted-word   │ .test   │           │  *.test    │    │
│   *.test         │ exact   │           │  forward   │    │
│                  └────┬────┘           └──────┬─────┘    │
│                       │                       │          │
│                       ▼                       ▼          │
│              ┌────────────────┐    ┌─────────────────┐   │
│              │ 127.0.0.1:5174 │    │ System DNS      │   │
│              │ (Vite dev)     │    │ (real queries)  │   │
│              └────────────────┘    └─────────────────┘   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### Implementation Checklist

- [ ] Re-add `tools/local-dns.mjs` (612 lines, handles DNS queries for `.test` TLD)
- [ ] Re-add `tools/local-dns.config.json` (subdomain config)
- [ ] Re-add `tools/local-dns-system.sh` (creates `/etc/resolver/sainted-word.test` stub)
- [ ] Update `vite.config.js` — ensure `server.proxy` or middleware handles port 5174
- [ ] Document setup in `AGENTS.md` (remove "not in this PR" note)
- [ ] Test: `curl http://sainted-word.test:5174/` returns same as `curl http://127.0.0.1:5174/`

### Why It Matters

1. **Dev/prod parity** — Every route that works in production should work locally with the same hostname
2. **Testing** — E2E tests can run against `sainted-word.test` instead of `localhost`
3. **Future features** — Any subdomain-based features (e.g., `artist.sainted-word.test`) need the nameserver to work locally

---

## Part 3: Consolidated Action Items

### Immediate (This Sprint)

| Priority | Item | Owner |
|----------|------|-------|
| P0 | Close issue #75 (already fixed) | — |
| P1 | Review issue #202 attachment, define artist booking scope | — |
| P2 | Plan issue #121 engine upgrade — break into milestones | — |

### Technical Debt

| Item | Status | Notes |
|------|--------|-------|
| Digital twin nameserver | ❌ Not implemented | Files exist in git history, can be restored |
| Dev hostname parity | ⚠️ Partial | Rewrite plugin works, but only on `127.0.0.1` |

### Future Scope

- Restore digital twin tooling in a dedicated PR
- Add subdomain support for future features (artist booking, marketplace seller portals)
- Consider CI integration for E2E tests against `sainted-word.test`

---

## References

- Commit `c47adc2` — Original digital twin + dev-vercel-rewrites
- Commit `b57d141` — Dropped digital twin tooling
- Commit `878403b` — Fixed AGENTS.md after drop
- `vite.config.js:833-840` — `allowedHosts` configuration
- `AGENTS.md:90-91` — Documentation of dropped files
