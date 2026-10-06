# Design System: Sainted Word Records

## 1. Visual Theme & Atmosphere

**Atmosphere**: "parchment-on-warm-charcoal editorial studio." This is a working studio, not a gallery-airy showcase or a cockpit-dense dashboard. The surfaces breathe — warm sand in light mode, deep espresso in dark mode, with a single hot magenta accent for punctuation.

**Contrast pairs**:
- Light: warm sand `#faf7f2` (primary surface) ↔ deep espresso ink `#1a1612`
- Dark: warm charcoal `#0e0c0a` (primary surface) ↔ cream ink `#f5ead8`

**Accent**: Magma `#e6306b` is the single saturated hue that punctuates every interaction. It lives in the brand dot, the recording pulse, and the primary CTA. It is never diluted — it is the loudest color in the palette.

**Density**: 4 (Daily App Balanced) — three-column feature grids collapse to one column under 820px; the `versions/` family holds three columns. Lists breathe.

**Variance**: 7 (Offset Asymmetric) — Hero is a 1.05fr/1fr two-column grid with an eyebrow above the title; the engine-mini counterweight sits on the right. Footer columns are auto-fit. No centered heroes in the marketing set.

**Motion**: 5 (Fluid CSS) — pulse on the brand dot, `.reveal` fade-up, button `-1px` translateY on hover, FX/HOLD_MS timers in the engine. No spring physics. This site runs on CSS transitions and one `pulse 2s infinite` keyframe. No cinematic choreography.

This is a working studio, not a product page — every shipped surface has shipped CSS behind it.

---

## 2. Color Palette & Roles

### Light Theme

| Role | Token | Hex | Usage |
|------|-------|-----|-------|
| Parchment Canvas | `--bg` | `#faf7f2` | Primary surface, page ground |
| Sand Surface | `--bg-2` | `#f1ebe1` | Alt sections, stat strips |
| Bone Card | `--bg-3` | `#ffffff` | Cards, eyebrows, engine-mini frame |
| Espresso Ink | `--ink` | `#1a1612` | Primary text, primary CTA fill |
| Walnut Ink | `--ink-2` | `#4a4035` | Body secondary, lede copy |
| Tobacco Muted | `--muted` | `#8a7a66` | Metadata, captions |
| Sandstone Line | `--line` | `#ddd3c2` | Borders, dividers |
| Sandstone Line Alt | `--line-2` | `#c9beaa` | Input borders, subtle dividers |
| Magma Accent | `--accent` | `#e6306b` | Primary CTA, hover, brand dot, recording pulse |
| Ember Accent | `--accent-2` | `#ff8a3a` | Secondary gradient stop, never used alone for CTAs |
| Moss Accent | `--accent-3` | `#1c8c64` | Success states, "ready" pill |
| Carbon Code | `--code-bg` | `#1a1612` | Terminal background |
| Cream Code Ink | `--code-ink` | `#f5ead8` | Terminal text |
| Code Line | `--code-line` | `#2c2419` | Terminal line highlight |
| Code Comment | `--code-comment` | `#6a5d4a` | Terminal comments |
| Code Key | `--code-key` | `#ff8a3a` | Terminal keywords |
| Code String | `--code-str` | `#1c8c64` | Terminal strings |
| Code Function | `--code-fn` | `#e6306b` | Terminal functions |

### Dark Theme

| Role | Token | Hex | Usage |
|------|-------|-----|-------|
| Espresso Canvas | `--bg` | `#0e0c0a` | Primary surface, page ground |
| Charcoal Surface | `--bg-2` | `#161310` | Alt sections, panels |
| Walnut Card | `--bg-3` | `#1d1815` | Cards, modals |
| Cream Ink | `--ink` | `#f5ead8` | Primary text |
| Sand Ink | `--ink-2` | `#d4c7b3` | Body secondary |
| Tobacco Muted | `--muted` | `#8a7a66` | Metadata |
| Espresso Line | `--line` | `#2c2419` | Borders |
| Espresso Line Alt | `--line-2` | `#3a3022` | Input borders |
| Hot Magma | `--accent` | `#ff2d8a` | Primary CTA, hover, brand dot |
| Hot Ember | `--accent-2` | `#ffaa3a` | Gradient partner |
| Neon Moss | `--accent-3` | `#00ffa3` | Success states |
| Deep Carbon | `--code-bg` | `#0a0805` | Terminal background |
| Cream Code Ink | `--code-ink` | `#f5ead8` | Terminal text |
| Code Line | `--code-line` | `#1d1815` | Terminal line highlight |
| Code Comment | `--code-comment` | `#6a5d4a` | Terminal comments |
| Code Key | `--code-key` | `#ffaa3a` | Terminal keywords |
| Code String | `--code-str` | `#00ffa3` | Terminal strings |
| Code Function | `--code-fn` | `#ff2d8a` | Terminal functions |

### Accent Rules

**Magma Accent is the only saturated hue that may carry a gradient.** It is paired with Ember in the single 135deg linear-gradient reserved for one hot action per surface (recording button, take-save active). All other surfaces are flat.

The dark-mode accent (`#ff2d8a`) is deliberately bumped brighter than light-mode (`#e6306b`) — the same hue, more luminosity against dark backgrounds. This is not a separate accent; it is the same semantic accent adapted per theme.

---

## 3. Typography Rules

### Font Stack

**Display**: Fraunces — variable `opsz` 9..144, weight 300..900, italic axis. Used for hero titles (`hero__title`, 44–76px `clamp`), brand mark, version names. Italic + Magma for accent emphasis (`<em>`). Track-tight letter-spacing -0.025em on hero.

**Body**: Geist — weight 300..700. Body at 14–18px, lede at 18px/1.55, secondary text at 14–15px. Max content width 65ch on ledes.

**Mono**: Geist Mono — 400..600. Eyebrows, stat numbers, version tags, code, BPM/Key/length readouts in Spit. Tracking 0.08–0.12em, uppercase 11–12px on labels; tabular numerals on any data row.

### Banned Typefaces

- **Inter** — explicitly banned in design tokens (`'Geist', ui-sans-serif, system-ui` chain)
- **system-ui as primary** — fallback only, not primary face
- **Generic serifs** (Times/Georgia/Palatino) — remain fallbacks only, never primary
- **Emoji as UI typography** — see Anti-Patterns section

### Type Scale (from tokens)

- `--space-1` = 4px
- `--space-2` = 8px
- `--space-3` = 12px
- `--space-4` = 16px
- `--space-5` = 24px
- `--space-6` = 32px
- `--space-7` = 48px
- `--space-8` = 64px
- `--space-9` = 96px

Vertical rhythm: section padding `clamp(48px, 8vw, 88px)`

---

## 4. Component Stylings

### Buttons

**Primary** (`.btn.btn--primary`):
- Pill radius (`--radius-pill` = 999px)
- Padding 11×20px
- Font 14px/600
- No shadow at rest
- Background: Espresso Ink → Magma Accent on hover
- Transform: `translateY(-1px)` on hover
- Transition: 180ms ease

**Ghost** (`.btn.btn--ghost`):
- Transparent fill
- 1px Sandstone Line border → Espresso border on hover
- No glow, no outer ring

### Cards / Tiles

**Feature / Version / Tile** (`.feature`, `.ver`, `.tile`):
- 12px radius (`--radius`)
- 1px Sandstone Line border
- No shadow at rest
- `--shadow-2` only when lifted (engine-mini)
- Hover: border → Magma Accent, `-2px` translateY

### Pills / Eyebrows

- Pill radius (999px)
- 1px line border
- `--bg-3` fill
- Geist Mono 11px, tracking 0.08em, uppercase
- Used for status (No Beat / Mic Off / ● REC) and version tags

### Inputs / Selects

- 8–10px padding
- 8px radius
- `--bg` fill
- `--line-2` border
- Espresso text
- Focus ring: 2px Magma Accent with 2px offset (`.swr-nav a:focus-visible`)
- No floating labels

### Loaders

- Skeletal shimmer matching the cell's exact height
- In Spit, the waveform is a static canvas (60px tall) — the project's "loader face"
- No spinners, no circles

### Empty States

- Dropzone (Spit): 2px dashed line
- Emoji-free icon — 🥁 is the **one** exception the codebase uses for the dropzone specifically; it is a behavioral affordance, not UI chrome
- All other empty states use SVG or text, never emoji

### Code Surfaces

- `--code-bg` fill
- `--code-ink` text
- Accent colors per token:
  - `--code-key` = Ember (keywords)
  - `--code-str` = Moss (strings)
  - `--code-fn` = Magma (functions)
  - `--code-comment` = Tobacco Muted

---

## 5. Layout Principles

### Containment

- `.wrap` max-width 1180px centered
- 32px gutter
- 20px under 720px

### Hero

- Grid: `1.05fr 1fr`
- 56px gap
- Collapses to 1fr under 920px
- **Asymmetric by design** — left column holds eyebrow + display title + lede + CTA row; right column holds the engine-mini

### Feature Grid

- 3 equal columns (`repeat(3, 1fr)`)
- 20px gap
- Collapses to 1 column under 820px
- This pattern is **sanctioned only** on `landing.html` features + `versions` family
- New features: default is 2-column zig-zag or asymmetric split, not 3-up

### Footer

- `auto-fit minmax(180px, 1fr)`
- 48px gap
- Collapses to 1fr under 720px with 32px gap

### Full-ViewPort Apps

These surfaces override the wrap with `100vh`, install their own chrome, and **do NOT mount the shared nav/footer**:
- `engine.html`
- `dashboard.html`
- `spit.html`
- `make-video.html`
- `enhance.html`
- `photo.html`
- `ar-gif.html`
- `tiktok.html`
- `swr-app.html`

### Mobile

- Every multi-column layout collapses to 1 column under 820px
- No horizontal scroll
- All tap targets ≥ 44px (`.swr-nav__cta`, `.btn` are already ≥ 44px tall)

---

## 6. Motion & Interaction

### Hover Lift

- Primary CTA: `-1px` translateY, 180ms ease
- Cards: `-2px` translateY, 180ms ease
- Defined in `lib/design-tokens.css` (`--transition: 0.18s ease`)

### Brand Pulse

- `.nav__brand .dot` runs `pulse 2s infinite`
- Single expanding box-shadow, accent at 50% opacity decaying to 0
- **The only perpetual loop on shared chrome**

### Reveal

- `.reveal` fades from `opacity: 0; translateY(20px)` to `opacity: 1; translateY(0)` over 600ms
- Used on landing for sections that mount in view

### Recording Pulse

- `spit-rec-blink` keyframes, 0.9s `ease-in-out infinite`
- Magma at 35% opacity at 50%
- **State-driven pulse** (REC on/off), not decorative

### Engine Motion

- FX hold durations (HOLD_MS_PUNCH 220ms, HOLD_MS_BLACK 800ms, etc.) are **timer-driven**, not CSS animation
- The runtime drives motion; CSS transitions handle interpolation

### Hardware Acceleration

- Existing code uses `transform` and `opacity` exclusively
- Document as the rule: never animate `left`, `top`, `width`, `height` — always use `transform`

---

## 7. Anti-Patterns (Banned)

### No Emojis as UI Chrome

- Codebase uses 🌊/👊/🏄 as **labelled radio option icons only** inside `.spit-reaction-mode` and `.spit-fx-btn`, never as buttons, headings, or status
- Dropzone 🥁 is the **one terminal affordance exception** (`.spit-drop-icon`)
- Enhance page fix-icons 🌊 also follow this pattern — labelled radio option icons in any reactive-mode control set; not buttons, headings, or status
- Ban emoji elsewhere — use SVG or text

### No Inter Font

- Explicitly banned in design tokens (`'Geist', ui-sans-serif, system-ui` chain)
- system-ui is fallback, not primary
- **Exception**: `dashboard.html`, `marketplace.html`, `swr-app.html` are third-party-vibe surfaces that ship with Tailwind + Inter as primary; do not propagate that pattern to a new page.
- **Exception**: the `personas.html` index imports 9 families (Fraunces + Geist + Geist Mono + Space Grotesk + DM Serif Display + DM Sans + Geist + JetBrains Mono + Archivo Black) for the persona-fixture displays; not a model for new pages.

### No Pure Black `#000000`

- `--bg` in dark mode is `#0e0c0a` (espresso), not black
- Engine stages use `#000` for **canvas only** — the single sanctioned black (canvas, not chrome)

### No Neon / Outer Glow Shadows

- Shadows in tokens are tinted to ink hue at 4–12% opacity
- No `0 0 20px var(--accent)` exists in the codebase
- **Indicator LEDs** ≤10px diameter with `box-shadow: 0 0 8px var(--accent)` are sanctioned on engine.html, artists/*.html, personas/v/*.html, and versions/*.html; no other outer-glow use is permitted

### No Oversaturated Accents

- Accent palette max saturation ~75% (Magma `#e6306b` = 78% saturation in HSL)
- Dark-mode accent bumps to `#ff2d8a` (76%)
- **80% saturation ceiling as a hard rule**

### No Gradient Text on Display

- Display headlines use solid `var(--ink)` or solid `var(--accent)` italic emphasis
- No `background-clip: text` exists in the codebase
- Verified: grep returns zero hits

### No Custom Mouse Cursors

- Codebase has no `cursor:` rules beyond `pointer` on buttons

### No Overlapping Stacked Elements

- Verified by absence of `position: absolute` decorative overlays outside the engine stage and modal dialogs
- Exception: stage overlays, `spit-punch-fx`

### No Generic Placeholders

- No "John Doe / Acme / Nexus" — copy in shipped pages is project-specific (Kai Djuric, Sainted Word Records, SWR Freestyle Studio)

### No AI Copywriting Clichés

- Grep `landing.html` for `elevate|seamless|unleash|next-gen|instantly|effortlessly|revolutionary|transform` returns zero marketing hits
- The only `transform` hits are CSS
- **Copy is direct, technical, often lowercase, never exclamatory**
- Headlines favor "drop a song, get a music video" — verb-first imperatives, no adjective bloat

### No Filler UI Text

- No "scroll to explore," no bouncing chevrons, no "click to learn more" tooltips
- The engine stage is the demo

### No 3-Column Feature Grid Invented on New Pages

- Pattern is sanctioned only on `landing.html` features + `versions` family
- New pages must justify a 3-up before shipping it; default is 2-column zig-zag or asymmetric split

### No Centered Hero Sections on Marketing Pages

- `landing.html` is asymmetric by design
- The centered-hero rule applies with variance > 4

### No Broken Unsplash Links

- Codebase uses local `verify-screenshots/*.png`, `press/og-card.png`, and inline SVG favicons
- No external image hosts

### No Fake Round Numbers

- Version copy uses concrete counts ("24 preset looks", "5 core variants")
- Never "100+ assets" or "99.9% uptime"

---

*This file encodes the existing system semantically. No token rename, no rewrite of `design-tokens.css`. It is sized to be pasted directly into Stitch as the visual source of truth.*
