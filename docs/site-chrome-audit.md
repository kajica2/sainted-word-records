# Site chrome & IA audit — 2026-09-29

Audit of every shipped page's global header/footer, the information architecture
around them, and the fixes applied. Companion gate: `npm run check:site-chrome`
(`scripts/check-site-chrome.mjs`) — it fails the `check` group if any page
regresses on the rules below.

## What was wrong

- **No shared footer existed.** `lib/nav.client.js` shipped a header component
  only; footers were 100 bespoke copies (four different class names inside the
  gallery family alone) with per-page link drift.
- **The "shared sticky top nav" rendered below the content on 12 pages** —
  `<swr-nav>` is a custom element that appends where it sits, and the element
  had been appended at the end of `<body>` (`marketplace`, `make-video`,
  `enhance`, `director-mode`, `404`, `offline`, `video_single`, the eleven
  `landing-personas-v*` registers).
- **52 pages loaded `/lib/nav.client.js` and mounted nothing** (the script only
  upgrades a real `<swr-nav>` element), so they had no shared header at all:
  `artists/*`, `personas/v/*`, `shop`, `photo`, `ar-gif`, `tutorial-30s`,
  `terms`, `login`, and the swr launch docs.
- **Full-viewport renderers had no exit.** The five core variants formed a
  closed `neon→film→grid→smoke→hallucination→neon` loop; `versions/music_video.html`
  and `versions/music_video_mtv.html` contained no `<a>` element at all.
- **Mobile had no menu.** At ≤720px `components.css` simply did
  `.swr-nav__links { display: none }` — no burger, no drawer, no navigation.
- **No skip link, and 73 pages had no `<main>` landmark** for one to target.
- **Nine pages belonged to no IA slot**: `gallery-director-mode` (a 27-variant
  catalogue duplicating `/versions`, zero inbound links), `engine-ar-loop`,
  `video_single`, `persona-demo` (already 301-shadowed), and five internal
  launch docs (`swr-stripe-setup`, `swr-dm-templates`, `swr-social-content`,
  `swr-campaign-launch-plan`, `swr-watermark-plan`) that were publicly
  reachable — including a Stripe runbook — while appearing in no nav, footer or
  tools list.
- `/versions.html` skipped five pages that ship (Console, BACHDROP, the
  music-video gallery, the MTV cut, the visual-languages index) and advertised a
  stale "25 self-contained engine variants".
- `shop.html` pointed readers at the internal `swr-stripe-setup.html` runbook;
  `landing.html` linked `./HOWTO-30s-VIDEO.md`, which does not exist.

## The chrome contract (now enforced)

| Surface | Header | Footer |
|---|---|---|
| Public content pages (105) | `<swr-nav>` as the first child of `<body>` | `<swr-footer>` |
| App surfaces (`engine`, `dashboard` + the 25 version renderers) | own chrome | none, but a `← Site` exit link is required |
| Footer-exempt content (the 11 `landing-personas-v*` registers, `personas`, `spit`, `make-video`, `enhance`, `photo`, `ar-gif`, `share-view`, `404`) | shared | own footer or none — each for a structural reason recorded in `scripts/check-site-chrome.mjs` |
| Not deployed / not public (`tools/`, `auth/`, `scripts/_*`, `market-study`, `profit-plan`, `persona-library`, `swr-intro-10s`) | excluded | excluded |

Enforced per content page: nav mounted at the top of `<body>` exactly once,
footer mounted, `design-tokens.css` + `components.css` + both client scripts,
non-empty **unique** `<title>`, meta description, `<main>` landmark. App
surfaces must carry an exit link. Every declared redirect must exist in
`vercel.json`.

## Redirect map (all 301, generated into `vercel.json`)

| From | To | Why |
|---|---|---|
| `/persona-demo` | `/personas` | removed from the IA; content preserved in `_archive/` |
| `/gallery-director-mode` | `/versions` | removed from the IA; content preserved in `_archive/` |
| `/gallery/director-mode` | `/versions` | removed from the IA; content preserved in `_archive/` |
| `/engine-ar-loop` | `/ar-gif` | removed from the IA; content preserved in `_archive/` |
| `/video_single` | `/versions` | removed from the IA; content preserved in `_archive/` |
| `/swr-campaign-launch-plan` | `/swr-app` | removed from the IA; content preserved in `_archive/` |
| `/swr-dm-templates` | `/swr-app` | removed from the IA; content preserved in `_archive/` |
| `/swr-social-content` | `/swr-app` | removed from the IA; content preserved in `_archive/` |
| `/swr-stripe-setup` | `/swr-app` | removed from the IA; content preserved in `_archive/` |
| `/swr-watermark-plan` | `/swr-app` | removed from the IA; content preserved in `_archive/` |

## Fixes applied

1. **`lib/footer.client.js` (new)** — `<swr-footer>`, rendered from
   `site-map.json`'s new `footerNav` block (tagline, four IA columns, social,
   plus legal + sitemap in the bottom bar). No destination is hardcoded in any
   page.
2. **`lib/nav.client.js`** — skip link to `#main` (the component assigns the id
   to the page's `<main>` when missing), keyboard-operable dropdowns
   (`aria-expanded`, focus + Escape), and a burger + drawer at ≤720px that
   replaces the old "hide all links" rule.
3. **`lib/components.css`** — skip link, burger, drawer, focus-visible rings,
   and a footer grid that fits 3–5 columns (`auto-fit`).
4. **`scripts/migrate-html.mjs`** — gained `--add-nav` (mount/move the nav to
   the top of `<body>`), `--apply-footer` (replace a bespoke footer **only when
   every link it carries is served by the shared one**, otherwise report and
   leave it), `--add-footer`. Idempotent; used for 100+ pages.
5. **`scripts/add-main-landmark.mjs` (new)** — converts each page's existing
   content wrapper into `<main>` **in place** (class/id preserved, so no CSS
   selector changes) rather than re-parenting content.
6. **`versions/_site-exit-inject.js` (new)** — the `← Site` link on all 24
   renderers, marker-guarded and idempotent.
7. **`scripts/check-site-chrome.mjs` (new)** — the gate, in the `check` group.
8. **IA** — `/atlas` added to the Learn nav dropdown and the footer's Learn
   column; `Enhance` added to the Engine nav dropdown and footer; `Shot list`
   added to Tools (with its missing rewrite); the `director-mode` nav child
   removed with the page; `/versions.html` now indexes every shipped page.
9. **Navigation trim (2026-09-29, after the audit)** — the owner removed
   *Make a video*, *Photo studio*, *Enhance*, *Atlas*, *Galleries* (with its 21
   children), *Artists* and *Shop* from the navigation. They are **unlisted, not
   removed**: \`site-map.json\` gained an \`unlisted\` array that both
   \`scripts/generate-vercel-rewrites.mjs\` (so the pretty routes keep working)
   and \`vite.config.js\`'s rootFiles (so the files still reach \`dist/\`) read.
   Nav now reads Engine · Personas · Persona Variants · Learn. The pages stay
   in \`sitemap.xml\` (128 URLs) and every one still returns 200.
10. **SEO metadata** — every shipped page now carries `og:title`,
   `og:description`, `og:type` and `twitter:card` derived verbatim from its
   own title/description (59 pages gained the full block, 50 gained the missing
   card line), the images created at runtime for hero frames and the AR preview
   gained `alt` text, and every page has a `<main>` landmark for its skip link.
10. **`sitemap.html` route mapping** — the DISCOVERED list was rendered by
   stripping `.html` from each filename, which 404s for three families
   (`gallery-ai.html` is served at `/gallery/ai`, `artists/vodolija/index.html`
   at `/artists/vodolija/`, `landing.html`/`index.html` at `/`) and for pages
   with no rewrite at all. Measured live: 25 of the page's 144 links 404'd. All
   105 discovered entries now map to a route that resolves.
11. **Broken/leaky links** — `shop.html`'s runbook reference reworded,
   `landing.html`'s dead `HOWTO-30s-VIDEO.md` link replaced with
   `/tutorial-30s`, `gallery.html`'s dead "Loops Gallery" card (no `href`)
   replaced with the live music-video gallery, `share-view.html` gained a meta
   description, `versions/index.html` gained a unique title.

## Audit table (every shipped page)

Counts: 148 pages — headers {"shared nav":112,"none":8,"own chrome":28}, footers {"shared footer":90,"own footer":43,"none":15}.
"discovered only" means the page is reachable through its hub rather than
directly from a nav/footer slot (gallery children, atlas chapters, persona
variants, artist profiles).


**Marketing & content**

| Route | File | Header | Footer | In IA | Action |
|---|---|---|---|---|---|
| `/` | `landing.html` | shared nav | shared footer | discovered only | shared header + footer |
| `/404` | `404.html` | shared nav | shared footer | — | shared header + footer |
| `/about` | `about.html` | shared nav | shared footer | href, href | shared header + footer |
| `/ar-gif` | `ar-gif.html` | shared nav | own footer | href | shared header; footer exempt (documented) |
| `/campaign` | `campaign.html` | shared nav | shared footer | href, href | shared header + footer |
| `/changelog` | `changelog.html` | shared nav | shared footer | href, href | shared header + footer |
| `/director-mode-sainted-word` | `director-mode-sainted-word.html` | shared nav | shared footer | — | shared header + footer |
| `/engine-demos` | `engine-demos.html` | shared nav | shared footer | href | shared header + footer |
| `/enhance` | `enhance.html` | shared nav | none | href, href | shared header; footer exempt (documented) |
| `/interactive-howto` | `interactive-howto.html` | shared nav | shared footer | href, href | shared header + footer |
| `/intro` | `intro.html` | shared nav | shared footer | href, href, href | shared header + footer |
| `/make-video` | `make-video.html` | shared nav | own footer | href, href | shared header; footer exempt (documented) |
| `/market-study` | `market-study.html` | shared nav | own footer | — | shared header |
| `/marketplace` | `marketplace.html` | shared nav | shared footer | href, href, href | shared header + footer |
| `/offline` | `offline.html` | shared nav | none | — | shared header |
| `/photo` | `photo.html` | shared nav | none | href, href | shared header; footer exempt (documented) |
| `/portfolio` | `portfolio.html` | shared nav | shared footer | href, href | shared header + footer |
| `/press` | `press.html` | shared nav | shared footer | href, href | shared header + footer |
| `/profit-plan` | `profit-plan.html` | shared nav | own footer | — | shared header |
| `/share-view` | `share-view.html` | shared nav | none | href | shared header; footer exempt (documented) |
| `/shop` | `shop.html` | shared nav | shared footer | href, href | shared header + footer |
| `/spit` | `spit.html` | shared nav | own footer | href | shared header; footer exempt (documented) |
| `/status` | `status.html` | shared nav | shared footer | href, href | shared header + footer |
| `/swr-app` | `swr-app.html` | shared nav | shared footer | href | shared header + footer |
| `/swr-intro-10s` | `swr-intro-10s.html` | none | none | discovered only | shared header |
| `/thanks` | `thanks.html` | shared nav | shared footer | href | shared header + footer |
| `/tutorial-30s` | `tutorial-30s.html` | shared nav | shared footer | href, href | shared header + footer |
| `/versions` | `versions.html` | shared nav | shared footer | href, href | shared header + footer |

**Gallery family**

| Route | File | Header | Footer | In IA | Action |
|---|---|---|---|---|---|
| `/gallery` | `gallery.html` | shared nav | shared footer | href, href, href | shared header + footer |
| `/gallery/ai` | `gallery-ai.html` | shared nav | shared footer | href | shared header + footer |
| `/gallery/albums` | `gallery-albums.html` | shared nav | shared footer | href | shared header + footer |
| `/gallery/artist` | `gallery-artist.html` | shared nav | shared footer | href | shared header + footer |
| `/gallery/bachdrop` | `gallery-bachdrop.html` | shared nav | shared footer | href | shared header + footer |
| `/gallery/bio` | `gallery-bio.html` | shared nav | shared footer | href | shared header + footer |
| `/gallery/brutalist` | `gallery-brutalist.html` | shared nav | shared footer | href | shared header + footer |
| `/gallery/cosmic` | `gallery-cosmic.html` | shared nav | shared footer | href | shared header + footer |
| `/gallery/darkfuture` | `gallery-darkfuture.html` | shared nav | shared footer | href | shared header + footer |
| `/gallery/generative` | `gallery-generative.html` | shared nav | shared footer | href | shared header + footer |
| `/gallery/glyphs` | `gallery-glyphs.html` | shared nav | shared footer | href | shared header + footer |
| `/gallery/music` | `gallery-music.html` | shared nav | shared footer | href | shared header + footer |
| `/gallery/photoexp` | `gallery-photoexp.html` | shared nav | shared footer | href | shared header + footer |
| `/gallery/point4brand` | `gallery-point4brand.html` | shared nav | shared footer | href | shared header + footer |
| `/gallery/posters` | `gallery-posters.html` | shared nav | shared footer | href | shared header + footer |
| `/gallery/tshirts` | `gallery-tshirts.html` | shared nav | shared footer | href | shared header + footer |
| `/gallery/videofx` | `gallery-videofx.html` | shared nav | shared footer | href | shared header + footer |
| `/gallery/vintage` | `gallery-vintage.html` | shared nav | shared footer | href | shared header + footer |
| `/gallery/vr` | `gallery-vr.html` | shared nav | shared footer | href | shared header + footer |

**Versions — content pages**

| Route | File | Header | Footer | In IA | Action |
|---|---|---|---|---|---|
| `/versions/console` | `versions/console.html` | shared nav | shared footer | — | shared header + footer |
| `/versions/gallery` | `versions/gallery.html` | shared nav | shared footer | discovered only | shared header + footer |
| `/versions/music-video-gallery` | `versions/music-video-gallery.html` | shared nav | shared footer | href | shared header + footer |
| `/visual-languages` | `versions/index.html` | shared nav | shared footer | href | shared header + footer |

**Versions — renderers (app surfaces)**

| Route | File | Header | Footer | In IA | Action |
|---|---|---|---|---|---|
| `/versions/aurora` | `versions/aurora.html` | own chrome | own footer | discovered only | app surface kept + site-exit link |
| `/versions/bachdrop` | `versions/bachdrop.html` | own chrome | own footer | discovered only | app surface kept + site-exit link |
| `/versions/baroque` | `versions/baroque.html` | own chrome | own footer | discovered only | app surface kept + site-exit link |
| `/versions/chrome` | `versions/chrome.html` | own chrome | own footer | discovered only | app surface kept + site-exit link |
| `/versions/collage` | `versions/collage.html` | own chrome | own footer | discovered only | app surface kept + site-exit link |
| `/versions/echo-manifold` | `versions/echo-manifold.html` | own chrome | none | — | app surface kept + site-exit link |
| `/versions/eclipse` | `versions/eclipse.html` | own chrome | own footer | discovered only | app surface kept + site-exit link |
| `/versions/film` | `versions/film.html` | own chrome | own footer | discovered only | app surface kept + site-exit link |
| `/versions/fractal` | `versions/fractal.html` | own chrome | own footer | discovered only | app surface kept + site-exit link |
| `/versions/glitch` | `versions/glitch.html` | own chrome | own footer | discovered only | app surface kept + site-exit link |
| `/versions/grid` | `versions/grid.html` | own chrome | own footer | discovered only | app surface kept + site-exit link |
| `/versions/hallucination` | `versions/hallucination.html` | own chrome | own footer | discovered only | app surface kept + site-exit link |
| `/versions/kraft` | `versions/kraft.html` | own chrome | own footer | discovered only | app surface kept + site-exit link |
| `/versions/mosaic` | `versions/mosaic.html` | own chrome | own footer | discovered only | app surface kept + site-exit link |
| `/versions/music-video` | `versions/music_video.html` | own chrome | own footer | discovered only | app surface kept + site-exit link |
| `/versions/music-video-mtv` | `versions/music_video_mtv.html` | own chrome | own footer | — | app surface kept + site-exit link |
| `/versions/neon` | `versions/neon.html` | own chrome | own footer | discovered only | app surface kept + site-exit link |
| `/versions/phosphor` | `versions/phosphor.html` | own chrome | own footer | discovered only | app surface kept + site-exit link |
| `/versions/pulse` | `versions/pulse.html` | own chrome | own footer | discovered only | app surface kept + site-exit link |
| `/versions/smoke` | `versions/smoke.html` | own chrome | own footer | discovered only | app surface kept + site-exit link |
| `/versions/spectrum` | `versions/spectrum.html` | own chrome | own footer | discovered only | app surface kept + site-exit link |
| `/versions/tape` | `versions/tape.html` | own chrome | own footer | discovered only | app surface kept + site-exit link |
| `/versions/typography` | `versions/typography.html` | own chrome | own footer | discovered only | app surface kept + site-exit link |
| `/versions/void` | `versions/void.html` | own chrome | own footer | discovered only | app surface kept + site-exit link |
| `/versions/watercolor` | `versions/watercolor.html` | own chrome | own footer | discovered only | app surface kept + site-exit link |

**Engine / Console (app surfaces)**

| Route | File | Header | Footer | In IA | Action |
|---|---|---|---|---|---|
| `/dashboard` | `dashboard.html` | own chrome | none | href | app surface kept + site-exit link |
| `/engine` | `engine.html` | shared nav | own footer | href, href, href | app surface kept + site-exit link |

**Personas**

| Route | File | Header | Footer | In IA | Action |
|---|---|---|---|---|---|
| `/landing-personas-v1-editorial` | `landing-personas-v1-editorial.html` | shared nav | own footer | — | shared header; footer exempt (documented) |
| `/landing-personas-v10-neon` | `landing-personas-v10-neon.html` | shared nav | own footer | — | shared header; footer exempt (documented) |
| `/landing-personas-v11-zine` | `landing-personas-v11-zine.html` | shared nav | own footer | discovered only | shared header; footer exempt (documented) |
| `/landing-personas-v2-dark` | `landing-personas-v2-dark.html` | shared nav | own footer | — | shared header; footer exempt (documented) |
| `/landing-personas-v3-friendly` | `landing-personas-v3-friendly.html` | shared nav | own footer | — | shared header; footer exempt (documented) |
| `/landing-personas-v4-dashboard` | `landing-personas-v4-dashboard.html` | shared nav | own footer | — | shared header; footer exempt (documented) |
| `/landing-personas-v5-brutalist` | `landing-personas-v5-brutalist.html` | shared nav | own footer | — | shared header; footer exempt (documented) |
| `/landing-personas-v6-wireframe` | `landing-personas-v6-wireframe.html` | shared nav | own footer | — | shared header; footer exempt (documented) |
| `/landing-personas-v7-riso` | `landing-personas-v7-riso.html` | shared nav | own footer | — | shared header; footer exempt (documented) |
| `/landing-personas-v8-broadcast` | `landing-personas-v8-broadcast.html` | shared nav | own footer | — | shared header; footer exempt (documented) |
| `/landing-personas-v9-cassette` | `landing-personas-v9-cassette.html` | shared nav | own footer | — | shared header; footer exempt (documented) |
| `/persona-library` | `persona-library.html` | own chrome | own footer | href | shared header |
| `/personas` | `personas.html` | shared nav | own footer | href, href | shared header; footer exempt (documented) |
| `/personas/v` | `personas/v/index.html` | shared nav | shared footer | href, href | shared header + footer |
| `/personas/v/clubstrobe` | `personas/v/clubstrobe.html` | shared nav | shared footer | discovered only | shared header + footer |
| `/personas/v/filmfilm` | `personas/v/filmfilm.html` | shared nav | shared footer | discovered only | shared header + footer |
| `/personas/v/filter` | `personas/v/filter.html` | shared nav | shared footer | discovered only | shared header + footer |
| `/personas/v/fx` | `personas/v/fx.html` | shared nav | shared footer | discovered only | shared header + footer |
| `/personas/v/grid` | `personas/v/grid.html` | shared nav | shared footer | discovered only | shared header + footer |
| `/personas/v/hallucination` | `personas/v/hallucination.html` | shared nav | shared footer | discovered only | shared header + footer |
| `/personas/v/liquidglass` | `personas/v/liquidglass.html` | shared nav | shared footer | discovered only | shared header + footer |
| `/personas/v/mask` | `personas/v/mask.html` | shared nav | shared footer | discovered only | shared header + footer |
| `/personas/v/morphaanchor` | `personas/v/morphaanchor.html` | shared nav | shared footer | discovered only | shared header + footer |
| `/personas/v/morphaecho` | `personas/v/morphaecho.html` | shared nav | shared footer | discovered only | shared header + footer |
| `/personas/v/morphaflow` | `personas/v/morphaflow.html` | shared nav | shared footer | discovered only | shared header + footer |
| `/personas/v/morphafracture` | `personas/v/morphafracture.html` | shared nav | shared footer | discovered only | shared header + footer |
| `/personas/v/morphavoid` | `personas/v/morphavoid.html` | shared nav | shared footer | discovered only | shared header + footer |
| `/personas/v/neon` | `personas/v/neon.html` | shared nav | shared footer | discovered only | shared header + footer |
| `/personas/v/neonwash` | `personas/v/neonwash.html` | shared nav | shared footer | discovered only | shared header + footer |
| `/personas/v/pearlhaze` | `personas/v/pearlhaze.html` | shared nav | shared footer | discovered only | shared header + footer |
| `/personas/v/poster` | `personas/v/poster.html` | shared nav | shared footer | discovered only | shared header + footer |
| `/personas/v/raw` | `personas/v/raw.html` | shared nav | shared footer | discovered only | shared header + footer |
| `/personas/v/smoke` | `personas/v/smoke.html` | shared nav | shared footer | discovered only | shared header + footer |
| `/personas/v/trainstage1` | `personas/v/trainstage1.html` | shared nav | shared footer | discovered only | shared header + footer |
| `/personas/v/trainstage2` | `personas/v/trainstage2.html` | shared nav | shared footer | discovered only | shared header + footer |
| `/personas/v/trainstage3` | `personas/v/trainstage3.html` | shared nav | shared footer | discovered only | shared header + footer |
| `/personas/v/vhsvibe` | `personas/v/vhsvibe.html` | shared nav | shared footer | discovered only | shared header + footer |

**Artists**

| Route | File | Header | Footer | In IA | Action |
|---|---|---|---|---|---|
| `/artists` | `artists/index.html` | shared nav | shared footer | href, href | shared header + footer |
| `/artists/ana-maric` | `artists/ana-maric.html` | shared nav | shared footer | discovered only | shared header + footer |
| `/artists/dusan-popov` | `artists/dusan-popov.html` | shared nav | shared footer | discovered only | shared header + footer |
| `/artists/kira-lindqvist` | `artists/kira-lindqvist.html` | shared nav | shared footer | discovered only | shared header + footer |
| `/artists/marko-ilic` | `artists/marko-ilic.html` | shared nav | shared footer | discovered only | shared header + footer |
| `/artists/nina-volkova` | `artists/nina-volkova.html` | shared nav | shared footer | discovered only | shared header + footer |
| `/artists/vodolija` | `artists/vodolija.html` | shared nav | shared footer | discovered only | shared header + footer |
| `/artists/vodolija` | `artists/vodolija/index.html` | shared nav | shared footer | discovered only | shared header + footer |

**Atlas (book)**

| Route | File | Header | Footer | In IA | Action |
|---|---|---|---|---|---|
| `/atlas` | `atlas.html` | shared nav | shared footer | href, href | shared header + footer |
| `/atlas/200-steps` | `atlas-200-steps.html` | shared nav | shared footer | — | shared header + footer |
| `/atlas/architect` | `atlas-architect.html` | shared nav | shared footer | — | shared header + footer |
| `/atlas/checklist` | `atlas-checklist.html` | shared nav | shared footer | — | shared header + footer |
| `/atlas/crisis` | `atlas-crisis.html` | shared nav | shared footer | — | shared header + footer |
| `/atlas/final-insight` | `atlas-final-insight.html` | shared nav | shared footer | — | shared header + footer |
| `/atlas/forge` | `atlas-forge.html` | shared nav | shared footer | — | shared header + footer |
| `/atlas/integration` | `atlas-integration.html` | shared nav | shared footer | — | shared header + footer |
| `/atlas/legacy` | `atlas-legacy.html` | shared nav | shared footer | — | shared header + footer |
| `/atlas/life-stages` | `atlas-life-stages.html` | shared nav | shared footer | — | shared header + footer |

**Tools & hubs**

| Route | File | Header | Footer | In IA | Action |
|---|---|---|---|---|---|
| `/lab/media-input` | `lab/media-input.html` | shared nav | shared footer | href | shared header + footer |
| `/packs` | `packs.html` | shared nav | shared footer | href, href | shared header + footer |
| `/shotlist` | `shotlist/index.html` | shared nav | shared footer | href | shared header + footer |
| `/sitemap` | `sitemap.html` | shared nav | shared footer | href | shared header + footer |
| `/terms.html` | `terms.html` | shared nav | shared footer | href | shared header + footer |

**Legal**

| Route | File | Header | Footer | In IA | Action |
|---|---|---|---|---|---|
| `/legal/privacy.html` | `legal/privacy.html` | shared nav | shared footer | href | shared header + footer |
| `/legal/terms.html` | `legal/terms.html` | shared nav | shared footer | href | shared header + footer |

**Auth**

| Route | File | Header | Footer | In IA | Action |
|---|---|---|---|---|---|
| `/auth/login` | `auth/login.html` | none | none | discovered only | shared header |
| `/auth/verify` | `auth/verify.html` | none | none | discovered only | shared header |
| `/login` | `login.html` | none | none | href | shared header |

**Dev tools**

| Route | File | Header | Footer | In IA | Action |
|---|---|---|---|---|---|
| `/tools/hf-publish` | `tools/hf-publish.html` | none | none | discovered only | shared header |
| `/tools/manifest-editor` | `tools/manifest-editor.html` | none | none | discovered only | shared header |
| `/tools/mobile` | `tools/mobile/index.html` | own chrome | none | discovered only | shared header |

**Dev fixtures (not shipped)**

| Route | File | Header | Footer | In IA | Action |
|---|---|---|---|---|---|
| `/scripts/_analyze-stub` | `scripts/_analyze-stub.html` | none | none | — | shared header |
| `/scripts/_grade-smoke-fixture` | `scripts/_grade-smoke-fixture.html` | none | none | — | shared header |


## QA results (production, after deploy)

| Check | Result |
|---|---|
| Live redirects (`/persona-demo`, `/gallery-director-mode`, `/gallery/director-mode`, `/engine-ar-loop`, `/video_single`, `/swr-stripe-setup`, `/swr-dm-templates`) | **7/7 301** to their declared targets |
| Live chrome on 10 routes across every family (`/gallery`, `/atlas`, `/shop`, `/gallery-ai.html`, `/versions.html`, `/versions/console.html`, `/landing.html`, `/personas/v/raw.html`, `/sitemap.html`, `/legal/privacy.html`) | **10/10** — nav rendered at the top of `<body>`, 6 nav links, 29 footer links, OG tags, 0 page errors |
| Renderer exit link (`/versions/hallucination.html`) | present, `← Site` → `/` |
| Mobile drawer live at 390px (`/gallery`) | burger visible, drawer opens with 46 links, no horizontal overflow |
| `npm run check` (44 steps, includes `check:site-chrome`) | 44/44 |
| `npm run check:dist-links` | 4/4 (257 rewrites) |
| `npm run verify:site-nav` | 13/13 |
| Browser sweep, 18 pages × every family, desktop + 390px | 18/18 |
| Skip link + keyboard dropdown (browser) | first tab stop is "Skip to content" → `#main`; focus opens the Galleries dropdown (`aria-expanded`), Escape closes it |
| `verify:automix` | all green locally (a CI run of the same commit timed out on a loaded runner; the sibling run on that commit passed and the local re-run passed in 30s) |
