# PAGE-010: HELP-LEARN.md

# PRD: Help & Learn

## Overview
Interactive tutorials and community.

## Context
The engine is powerful but opaque. A Learn page reduces support burden and increases user success.

## Layout
```
┌─────────────────────────────────────────┐
│  LEARN | Tutorials | Preset Anatomy |    │
│         Showcase | Community             │
├─────────────────────────────────────────┤
│  GETTING STARTED                        │
│  ┌────────┐ ┌────────┐ ┌────────┐      │
│  │ Your   │ │ Advanced│ │ Live   │      │
│  │ First  │ │ Stems   │ │ VJ     │      │
│  │ Video  │ │         │ │ Setup  │      │
│  └────────┘ └────────┘ └────────┘      │
│                                         │
│  PRESET ANATOMY                         │
│  "Neon" uses 3 layers...                │
│  [Interactive deconstruction]            │
│                                         │
│  SHOWCASE                               │
│  ┌────────┐ ┌────────┐ ┌────────┐      │
│  │ [vid]  │ │ [vid]  │ │ [vid]  │      │
│  │ "Song" │ │ "Song" │ │ "Song" │      │
│  └────────┘ └────────┘ └────────┘      │
│                                         │
│  MONTHLY CHALLENGE                      │
│  "Best use of Film preset"              │
│  [Submit] [Vote]                        │
└─────────────────────────────────────────┘
```

## Features

### Guided Walkthroughs
- "Your first music video" — 5 steps, pre-loaded demo song
- "Advanced: stem separation" — when available
- "Live performance setup" — VJ mode

### Preset Anatomy
Interactive deconstruction:
- "This preset uses 3 layers..."
- "The bass drives the zoom..."
- "The snare triggers the glitch..."

### Community
- Forum integration (Discourse embed)
- "Showcase" — user-submitted videos
- Monthly challenge: "Best use of Film preset"

## UI Specification

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Learn — SWR</title>
  <link rel="stylesheet" href="/shared/styles/tokens.css">
  <link rel="stylesheet" href="/shared/styles/components.css">
  <style>
    .learn-layout {
      max-width: 1200px;
      margin: 0 auto;
      padding: 24px;
    }
    .learn-tabs {
      display: flex;
      gap: 4px;
      margin-bottom: 32px;
    }
    .learn-tab {
      padding: 8px 16px;
      border: none;
      background: transparent;
      color: var(--text-secondary);
      cursor: pointer;
      border-radius: var(--radius-sm);
      font-weight: 500;
    }
    .learn-tab.active {
      color: var(--accent-primary);
    }
    .tutorials-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
      gap: 20px;
      margin-bottom: 40px;
    }
    .tutorial-card {
      background: var(--bg-surface);
      border-radius: var(--radius-lg);
      overflow: hidden;
      cursor: pointer;
      transition: all 150ms ease;
    }
    .tutorial-card:hover {
      transform: translateY(-4px);
    }
    .tutorial-thumb {
      aspect-ratio: 16/9;
      background: linear-gradient(135deg, var(--accent-primary), var(--accent-secondary));
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 3rem;
    }
    .tutorial-info {
      padding: 20px;
    }
    .tutorial-badge {
      display: inline-block;
      padding: 4px 10px;
      background: rgba(99,102,241,0.1);
      color: var(--accent-primary);
      border-radius: 20px;
      font-size: 0.75rem;
      font-weight: 700;
      text-transform: uppercase;
      margin-bottom: 8px;
    }
    .tutorial-title {
      font-weight: 700;
      font-size: 1.1rem;
      margin-bottom: 8px;
    }
    .tutorial-desc {
      font-size: 0.9rem;
      color: var(--text-secondary);
      line-height: 1.5;
    }
    .anatomy-section {
      background: var(--bg-surface);
      border-radius: var(--radius-lg);
      padding: 24px;
      margin-bottom: 40px;
    }
    .layer-stack {
      display: flex;
      flex-direction: column;
      gap: 8px;
      margin-top: 16px;
    }
    .layer-item {
      display: grid;
      grid-template-columns: 40px 1fr 100px;
      gap: 12px;
      align-items: center;
      padding: 12px;
      background: var(--bg-hover);
      border-radius: var(--radius-md);
    }
    .layer-number {
      width: 32px;
      height: 32px;
      border-radius: 50%;
      background: var(--accent-primary);
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 700;
      font-size: 0.85rem;
    }
    .layer-detail {
      font-size: 0.9rem;
    }
    .layer-reactor {
      font-size: 0.8rem;
      color: var(--accent-success);
      font-family: var(--font-mono);
    }
    .showcase-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
      gap: 16px;
    }
    .showcase-card {
      aspect-ratio: 9/16;
      background: var(--bg-surface);
      border-radius: var(--radius-md);
      overflow: hidden;
      position: relative;
    }
    .showcase-card .play-overlay {
      position: absolute;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      background: rgba(0,0,0,0.3);
      opacity: 0;
      transition: opacity 150ms ease;
    }
    .showcase-card:hover .play-overlay {
      opacity: 1;
    }
    .challenge-banner {
      background: linear-gradient(135deg, rgba(245,158,11,0.1), rgba(239,68,68,0.1));
      border: 1px solid var(--border-medium);
      border-radius: var(--radius-lg);
      padding: 24px;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
  </style>
</head>
<body>

<div class="learn-layout">
  
  <h1>Learn</h1>
  
  <div class="learn-tabs">
    <button class="learn-tab active">Tutorials</button>
    <button class="learn-tab">Preset Anatomy</button>
    <button class="learn-tab">Showcase</button>
    <button class="learn-tab">Community</button>
  </div>
  
  <!-- Tutorials -->
  <section class="tutorials-grid">
    <div class="tutorial-card" onclick="startTutorial('first')">
      <div class="tutorial-thumb">▶</div>
      <div class="tutorial-info">
        <span class="tutorial-badge">Beginner</span>
        <div class="tutorial-title">Your First Music Video</div>
        <div class="tutorial-desc">5 steps from song drop to export. Pre-loaded demo included.</div>
      </div>
    </div>
    <div class="tutorial-card" onclick="startTutorial('stems')">
      <div class="tutorial-thumb">🎛</div>
      <div class="tutorial-info">
        <span class="tutorial-badge">Advanced</span>
        <div class="tutorial-title">Stem Separation</div>
        <div class="tutorial-desc">Isolate drums, bass, vocals for richer reactivity.</div>
      </div>
    </div>
    <div class="tutorial-card" onclick="startTutorial('vj')">
      <div class="tutorial-thumb">🎚</div>
      <div class="tutorial-info">
        <span class="tutorial-badge">Pro</span>
        <div class="tutorial-title">Live VJ Setup</div>
        <div class="tutorial-desc">Configure scenes, MIDI, and multi-output for performances.</div>
      </div>
    </div>
  </section>
  
  <!-- Preset Anatomy -->
  <div class="anatomy-section">
    <h2>Preset Anatomy: Neon</h2>
    <p style="color:var(--text-secondary); margin-bottom:16px;">
      Deconstruct how this preset reacts to your audio.
    </p>
    <div class="layer-stack">
      <div class="layer-item">
        <div class="layer-number">1</div>
        <div class="layer-detail">Base gradient — slow hue shift</div>
        <div class="layer-reactor">bass → hue</div>
      </div>
      <div class="layer-item">
        <div class="layer-number">2</div>
        <div class="layer-detail">Particle burst — on snare</div>
        <div class="layer-reactor">snare → particles</div>
      </div>
      <div class="layer-item">
        <div class="layer-number">3</div>
        <div class="layer-detail">Scanline overlay — persistent</div>
        <div class="layer-reactor">none</div>
      </div>
    </div>
  </div>
  
  <!-- Showcase -->
  <h2 style="margin-bottom:16px;">Community Showcase</h2>
  <div class="showcase-grid">
    <div class="showcase-card">
      <div style="width:100%;height:100%;background:linear-gradient(135deg,#6366f1,#ec4899);"></div>
      <div class="play-overlay">▶</div>
    </div>
    <div class="showcase-card">
      <div style="width:100%;height:100%;background:linear-gradient(135deg,#f59e0b,#ef4444);"></div>
      <div class="play-overlay">▶</div>
    </div>
    <div class="showcase-card">
      <div style="width:100%;height:100%;background:linear-gradient(135deg,#10b981,#3b82f6);"></div>
      <div class="play-overlay">▶</div>
    </div>
  </div>
  
  <!-- Challenge -->
  <div class="challenge-banner" style="margin-top:40px;">
    <div>
      <h3>Monthly Challenge</h3>
      <p style="color:var(--text-secondary); margin-top:8px;">
        "Best use of Film preset" — Submit by Sep 30
      </p>
    </div>
    <button class="btn btn-primary">Submit Entry</button>
  </div>
  
</div>

<script>
function startTutorial(id) {
  console.log('Start tutorial:', id);
}
</script>

</body>
</html>
```

## Acceptance Criteria
- [ ] Tutorial completes without errors on first try
- [ ] Preset anatomy updates when preset changes
- [ ] Showcase loads 20 videos in 3 seconds
- [ ] Challenge submission form validates video URL

## Dependencies
- Video embed (YouTube/Vimeo iframe)
- Forum embed (Discourse)
```

---

# SHARED: TOKENS.md

```markdown
# SWR Design Tokens

## Colors

```css
:root {
  /* Backgrounds */
  --bg-base: #0a0d12;
  --bg-elevated: #11141a;
  --bg-surface: #1a1e28;
  --bg-hover: #222838;
  --bg-active: #2a3040;
  
  /* Text */
  --text-primary: #f0f2f5;
  --text-secondary: #a0a8b8;
  --text-muted: #6b7280;
  
  /* Accents */
  --accent-primary: #6366f1;
  --accent-secondary: #8b5cf6;
  --accent-success: #10b981;
  --accent-warning: #f59e0b;
  --accent-danger: #ef4444;
  --accent-info: #3b82f6;
  
  /* Borders */
  --border-subtle: rgba(255,255,255,0.06);
  --border-medium: rgba(255,255,255,0.1);
  --border-strong: rgba(255,255,255,0.15);
  
  /* Spacing */
  --space-xs: 4px;
  --space-sm: 8px;
  --space-md: 12px;
  --space-lg: 16px;
  --space-xl: 24px;
  --space-2xl: 32px;
  
  /* Radius */
  --radius-sm: 6px;
  --radius-md: 10px;
  --radius-lg: 14px;
  --radius-xl: 20px;
  
  /* Typography */
  --font-mono: 'SF Mono', Monaco, 'Cascadia Code', monospace;
  
  /* Shadows */
  --shadow-sm: 0 1px 2px rgba(0,0,0,0.3);
  --shadow-md: 0 4px 12px rgba(0,0,0,0.4);
  --shadow-glow: 0 0 20px rgba(99,102,241,0.3);
  
  /* Transitions */
  --transition-fast: 150ms ease;
  --transition-medium: 250ms ease;
}
```

## Typography Scale

| Token | Size | Weight | Use |
|-------|------|--------|-----|
| `text-hero` | 1.5rem | 700 | Page titles |
| `text-title` | 1.1rem | 600 | Card titles |
| `text-body` | 0.9rem | 400 | Body copy |
| `text-small` | 0.8rem | 400 | Labels, hints |
| `text-caption` | 0.75rem | 600 | Badges, tags |
| `text-mono` | 0.85rem | 400 | Code, data |

## Breakpoints

| Name | Width | Behavior |
|------|-------|----------|
| `mobile` | < 768px | Single column, stacked nav |
| `tablet` | 768–1200px | Two column, hidden sidebar |
| `desktop` | 1200–1600px | Three column, full layout |
| `wide` | > 1600px | Spacious, max-width containers |

## Z-Index Scale

| Layer | Z-Index | Use |
|-------|---------|-----|
| `base` | 0 | Content |
| `elevated` | 10 | Cards, panels |
| `dropdown` | 100 | Menus, selects |
| `sticky` | 200 | Headers, sidebars |
| `modal` | 300 | Dialogs, overlays |
| `toast` | 400 | Notifications |
| `tooltip` | 500 | Hover hints |
```

---

# SHARED: COMPONENTS.md

```markdown
# SWR Component Library

## Button

```html
<button class="btn [btn-primary|btn-secondary|btn-success|btn-warning|btn-danger|btn-ghost] [btn-sm|btn-lg] [btn-block]">
  <span>Icon</span>
  Label
</button>
```

Variants:
- `btn-primary`: CTA, main action
- `btn-secondary`: Cancel, back
- `btn-success`: Approve, complete
- `btn-warning`: Caution, review
- `btn-danger`: Delete, remove
- `btn-ghost`: Low emphasis

Sizes: `btn-sm`, default, `btn-lg`

## Toggle Switch

```html
<label class="toggle">
  <input type="checkbox">
  <span class="toggle-switch"></span>
  <span>Label text</span>
</label>
```

## Range Slider

```html
<div class="range-wrap">
  <input type="range" min="0" max="100" value="50">
  <span class="range-value">50</span>
</div>
```

## Panel / Card

```html
<div class="panel">
  <div class="panel-header">
    <span class="panel-title">Title</span>
    <button class="btn btn-sm btn-secondary">Action</button>
  </div>
  <div class="panel-body">
    Content
  </div>
</div>
```

## Badge

```html
<span class="badge [badge-online|badge-beta|badge-pro|badge-success|badge-warning]">Label</span>
```

## Drop Zone

```html
<div class="drop-zone">
  <div class="drop-zone-icon">📁</div>
  <div class="drop-zone-text">Drop files here</div>
  <div class="drop-zone-hint">or click to browse</div>
</div>
```

## Progress Bar

```html
<div class="progress-bar">
  <div class="progress-fill" style="width:45%;"></div>
  <div class="progress-handle" style="left:45%;"></div>
</div>
```

## Status Badge

| Status | Class | Color |
|--------|-------|-------|
| Draft | `status-draft` | Gray |
| Review | `status-review` | Amber |
| Approved | `status-approved` | Green |
| Delivered | `status-delivered` | Purple |
```

---

# FILE STRUCTURE

```
sainted-word-records/
├── app/                          # Engine (current /app)
│   ├── index.html
│   ├── app.css                   # ← FIX FIRST
│   ├── app.js
│   └── ...
├── platform/                     # Post-login pages (NEW)
│   ├── index.html                # Dashboard (PAGE-001)
│   ├── assets.html               # Asset Manager (PAGE-002)
│   ├── client.html               # Client Workspace (PAGE-003)
│   ├── campaign.html             # Release Planner (PAGE-004)
│   ├── live.html                 # Control Room (PAGE-005)
│   ├── marketplace.html          # Preset Store (PAGE-006)
│   ├── analytics.html            # Performance (PAGE-007)
│   ├── billing.html              # Credits & Payment (PAGE-008)
│   ├── settings.html             # Studio Profile (PAGE-009)
│   └── learn.html                # Tutorials (PAGE-010)
├── shared/                       # Cross-page (NEW)
│   ├── styles/
│   │   ├── tokens.css            # Design tokens
│   │   ├── components.css        # Component library
│   │   └── layout.css            # Grid system
│   ├── components/
│   │   ├── header.js             # Platform header
│   │   ├── sidebar.js            # Navigation
│   │   ├── video-player.js       # Universal player
│   │   └── comment-pins.js       # Review comments
│   └── utils/
│       ├── storage.js            # IndexedDB wrapper
│       ├── export.js             # Render & download
│       └── state.js              # Event-driven store
├── versions/                     # Single-file variants
│   └── music_video.html          # Standalone pro
└── ...
```

---

# HERMES PROMPT TEMPLATE

When pasting to Hermes/Codex/Cursor:

```
You are implementing a page for Sainted Word Records, a browser-native 
audio-reactive video engine. The repository is at 
https://github.com/kajica2/sainted-word-records.

PAGE: [PAGE-00X: Title]

CONTEXT:
- Current engine at /app has stylesheet issues (PRD-002)
- This page is part of the post-login platform
- All pages share /shared/styles/tokens.css and components.css

REQUIREMENTS:
[Paste from PRD above]

UI SPECIFICATION:
[Paste HTML/CSS from PRD above]

ACCEPTANCE CRITERIA:
[Paste from PRD above]

CONSTRAINTS:
- Zero backend — all processing in browser
- Use CSS variables from tokens.css
- Use component classes from components.css
- Preserve single-file aspiration for engine variants
- No external JS frameworks (vanilla JS only)
- IndexedDB for persistence
```

---
