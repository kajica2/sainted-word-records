# Register consolidation — what changed and what is left

**Status: partially implemented 2026-09-29** (owner decision on PR #134).

- **Archived:** `landing-personas-v7-riso.html`, `v8-broadcast`, `v9-cassette`,
  `v10-neon`, `v11-zine` — 70,761 bytes / 1,248 lines — each 301 → `/personas`.
- **Kept:** `v1-editorial`, `v2-dark`, `v3-friendly`, `v4-dashboard`,
  `v5-brutalist`, `v6-wireframe` — 234,946 bytes / 5,809 lines.
- **Not done:** nothing was consolidated into one page (Option A below is still
  the open question if the register set is meant to keep growing).
- **New gate:** `npm run check:register-data`
  (`scripts/check-register-data.mjs`, a member of the `check` group) fails if a
  remaining register's inlined persona data drifts from `personas.json`.

The eleven `landing-personas-v*` registers were eleven one-off visual
treatments of **the same eight personas** from `personas.json`. The register is
the *skin*, not the data. Six remain:

| # | File | Skin |
| --- | --- | --- |
| v1 | `landing-personas-v1-editorial.html` | quarterly magazine, 8 profiles |
| v2 | `landing-personas-v2-dark.html` | TTY / terminal boot log |
| v3 | `landing-personas-v3-friendly.html` | member directory with categories |
| v4 | `landing-personas-v4-dashboard.html` | filterable dashboard table |
| v5 | `landing-personas-v5-brutalist.html` | `PERSONAS.TXT` ASCII art |
| v6 | `landing-personas-v6-wireframe.html` | low-poly 3D wireframe gallery |
| ~~v7~~ | `landing-personas-v7-riso.html` | risograph print — **archived** |
| ~~v8~~ | `landing-personas-v8-broadcast.html` | TV network slate — **archived** |
| ~~v9~~ | `landing-personas-v9-cassette.html` | mixtape J-card — **archived** |
| ~~v10~~ | `landing-personas-v10-neon.html` | late-night sign shop — **archived** |
| ~~v11~~ | `landing-personas-v11-zine.html` | cut-and-paste punk zine — **archived** |

## What was implemented

1. `site-map.json`: the five files went in `archived`, with a `redirects` entry
   each (`/landing-personas-v7-riso` … `/landing-personas-v11-zine` →
   `/personas`).
2. `node scripts/archive-pages.mjs` moved them to `_archive/` (gitignored — the
   repo's sanctioned mechanism; content is recoverable from git history), then
   `node scripts/generate-vercel-rewrites.mjs` emitted three 301s per register
   (`/path`, `/path/`, `/path.html`), before any 404 guard, so first-match-wins
   cannot shadow them.
3. `node scripts/generate-site-manifest.mjs` dropped the five from `discovered`
   (135 entries / 139 deployable pages).
4. `personas.html` lost the five footer links. They were **removed rather than
   repointed**: all five live in the same `<ul>`, and repointing would have put
   five links to `/personas` in a column that already links `/personas`.
5. `vite.config.js` `rootFiles` and `check-site-chrome.mjs` `FOOTER_OPTIONAL`
   lost their five entries; AGENTS.md, `.kai/conventions/testing.md` and this
   doc were updated.
6. `scripts/check-register-data.mjs` added (see below).

### Revert

Delete the five `redirects` entries in `site-map.json`, restore the files from
`_archive/` (or `git show <sha>:landing-personas-v7-riso.html > …`), re-add the
five footer links in `personas.html`, the five `vite.config.js` `rootFiles`
entries and the five `FOOTER_OPTIONAL` entries, then re-run
`scripts/generate-vercel-rewrites.mjs` and
`scripts/generate-site-manifest.mjs`.

## Evidence (measured on `main` @ `55deadb`, before the archive)

| File | Bytes | Lines | Inbound link occurrences | Distinct inbound sources | Persona data | Unique content |
| --- | --- | --- | --- | --- | --- | --- |
| `landing-personas-v1-editorial.html` | 26,393 | 779 | 12 | 11 | inline copy of `personas.json` | 0 unique data |
| `landing-personas-v2-dark.html` | 31,559 | 829 | 7 | 6 | inline copy (identical to canonical) | 0 unique data |
| `landing-personas-v3-friendly.html` | 29,678 | 845 | 7 | 6 | inline copy (+ local `tagline`) | 0 unique data |
| `landing-personas-v4-dashboard.html` | 44,925 | 1,059 | 7 | 6 | inline copy (identical to canonical) | 0 unique data |
| `landing-personas-v5-brutalist.html` | 49,071 | 1,010 | 7 | 6 | inline copy (+ 7 local `sample_*`) | 0 unique data |
| `landing-personas-v6-wireframe.html` | 53,320 | 1,281 | 7 | 6 | inline copy (+ local `primitive`) | 0 unique data |
| `landing-personas-v7-riso.html` | 12,856 | 222 | 1 | 1 | inline copy (+ local `byline`) | 0 unique data |
| `landing-personas-v8-broadcast.html` | 14,738 | 261 | 1 | 1 | inline copy (+ local `byline`) | 0 unique data |
| `landing-personas-v9-cassette.html` | 14,921 | 255 | 1 | 1 | inline copy (+ local `byline`) | 0 unique data |
| `landing-personas-v10-neon.html` | 13,609 | 248 | 1 | 1 | inline copy (+ local `byline`) | 0 unique data |
| `landing-personas-v11-zine.html` | 14,637 | 257 | 1 | 1 | inline copy (+ local `byline`) | 0 unique data |
| **total** | **305,707** | **7,057** | — | — | 2,673 B of source data | — |

"Inbound link occurrences" counts every `href="…"` in another tracked `.html`
file that points at the register, relative or absolute, with or without
`.html`, minus the register's own self-references. (No `src="…"` in the tree
points at a register, so an `href`-only count is the whole count.)

## Findings

1. **There is no unique content to lose.** Every register renders the same 8
   personas. The bytes differ in *style*: each register is bespoke markup (ASCII
   art, a terminal transcript, a table, a 3D scene), not a skin over one
   template. 305 KB of pages carried 2.7 KB of source data; the archive removed
   23% of the bytes.
2. **The set split into a cross-linked six and five orphans.** v1–v6 each link
   to the *other five* registers from their footers — a complete mesh. v7–v11
   each linked to exactly one, v1, labelled "← all 6 registers" (v11: "← ALL 6
   REGISTERS") — the label was never updated when v7–v11 were added, and the
   archive trips none of the mesh edges, which is why it needed no footer edits
   in v1–v6.
3. **`personas.html` was the only inbound source for v7–v11.** It carries 6
   register cards (V1–V6 only), and its copy says "8 personas · **6** visual
   registers · 1 source of truth" / "**6** character presets" — the registry
   page never acknowledged v7–v11. That is the strongest independent support for
   archiving exactly those five.
4. **The six cards carry an inert `data-archived="true"`.** No CSS selector and
   no script in the repo reads that attribute (the same inert marker appears
   once in `landing.html`), so the cards render as live links.
5. **All eleven render from an inlined copy of `personas.json` — none hardcodes
   the profiles in markup.** *(Corrected 2026-09-29: an earlier revision of this
   doc claimed v3 and v7–v11 hardcoded their data. They do not — each carries a
   `<script type="application/json" id="personas-data">` node and renders from
   it.)* What actually differs is drift in that copy:
   - v2 and v4 are byte-identical to `personas.json`;
   - v1, v7–v11, v3, v5 and v6 add register-local presentation fields
     (`byline`, `tagline`, `sample_*`, `primitive`) — allowed, it is the
     family's idiom for local flavour;
   - v5 and v6 spell `best_fit: false` where the canonical data omits the key
     (behaviourally identical; both are falsy);
   - **all eleven canonical fields — `name`, `body`, `icon`, `best_fit`, `tool`
     for all 8 personas, in order — match `personas.json` exactly.** The gate
     added with this change (finding 8) pins that, so the divergence can no
     longer grow silently. v3's `tagline` is the same kind of local extra as
     v6's `primitive`, so it was left in place rather than deleted.
6. **The ticket's "17–32 inbound links each" is not reproducible.** No counting
   method tried reproduces it: attribute-level links are 1–12 occurrences from
   1–11 sources; counting every textual mention of the filename, in `.html`,
   `.js`, `.json` and `.md`, gives 4–15. The figure only approaches 17+ if
   build/gate metadata counts as "links" — the `vite.config.js` `rootFiles`
   entry, the `site-map.json` `discovered` entry and the `check-site-chrome.mjs`
   `FOOTER_OPTIONAL` line are 3 of those, and none of them is a hyperlink.
7. **The footer exemption is wider than this ticket assumed.** The registers are
   waived from the shared footer in `scripts/check-site-chrome.mjs`
   (`FOOTER_OPTIONAL`) on the cross-link rationale, which per finding 2 applies
   to the six that remain.
8. **Nothing gated the data copies.** `scripts/check-register-data.mjs` (added
   here, `npm run check:register-data`, a member of the `check` group) fails if
   any remaining register's canonical fields drift from `personas.json`. Local
   extras are allowed; a changed `name`/`body`/`icon`/`best_fit`/`tool`, a
   missing persona or a reordering is not.

## Option A — one page + a register switcher (still open)

Keep one route (`/personas/registers`) that renders the register selected by a
`#v5-brutalist`-style fragment (or `?register=v5-brutalist`) behind a segmented
control, with the 8 personas read from `personas.json` and the six remaining
skins kept as inline `<template>` blocks.

1. Extract the six `<body>` skins verbatim into `<template id="skin-vN">`
   blocks in one page; the persona data comes from the injected
   `personas-data` node (or `fetch('/personas.json')`).
2. Render `#skin-v1` unless the fragment names another; on change, swap the
   template content and apply the skin's `<style>` block.
3. `site-map.json`: `redirects` from each old URL → `/personas/registers#vN`;
   drop the six from `vite.config.js` `rootFiles` and `FOOTER_OPTIONAL`; run
   `scripts/generate-vercel-rewrites.mjs` and `archive-pages.mjs`.
4. Re-run `npm run check` (the register gate then has no registers to check and
   says so), `npm run check:site-chrome`,
   `npm run build && npm run check:dist-links`, `npm run verify:site-nav`.

Cost: high — 5,809 lines of markup to fold in, and the 3D/wireframe and ASCII
skins assume they own the document. Payoff: one page, one data source, no
drift, and the register set becomes extensible by adding a template.

## Risks

- **Indexed URLs.** The five archived registers are 301'd, never 404'd, so any
  external link follows to `/personas`. `sitemap.xml` and `site-map.json` are
  regenerated in the same change (finding: `sitemap.html` renders `discovered`,
  so a stale entry is a live dead link — the failure mode #135 fixed).
- **The registry is a marketing surface.** `personas.html` presented the eleven
  registers as a deliverable of the persona work; the six that remain still do.
  Consolidating further is the owner's call, not a code-quality one.
- **Option A concentrates risk.** One page carrying six skins means one syntax
  error takes down all six registers at once, and the page will be large
  (~200 KB of inline markup) unless skins are lazy-mounted.
- **`check-site-chrome.mjs`'s `FOOTER_OPTIONAL` and `vite.config.js` `rootFiles`
  are hand-maintained.** Any further archiving step must edit both, or the
  archived files keep shipping and the footer gate stops matching reality.
- **`_archive/` is gitignored.** Archiving removes the files from the repo (the
  sanctioned mechanism); recovery is from git history or the local `_archive/`
  directory, not from a fresh checkout.

## Method

Reproduce the table from the repo root:

```sh
# inbound link occurrences (occ) and distinct sources (srcs), self excluded
for f in landing-personas-v*.html; do
  stem=${f%.html}; occ=0; srcs=0
  for g in *.html; do
    [ "$g" = "$f" ] && continue
    n=$(grep -o "href=\"[^\"]*$stem[^\"]*\"" "$g" | wc -l | tr -d ' ')
    occ=$((occ+n)); [ "$n" -gt 0 ] && srcs=$((srcs+1))
  done
  echo "$f occ=$occ srcs=$srcs"
done

# persona data source: the inlined node, and whether its canonical fields drift
node scripts/check-register-data.mjs --verbose

# size
wc -c -l landing-personas-v*.html
```

The table is exactly that output plus `git ls-files 'landing-personas-v*.html'`,
`personas.json` (8 personas) and the persona-label presence check (8/8 in every
register). The archived five live in `_archive/`; their sizes in the table are
from the pre-archive files.
