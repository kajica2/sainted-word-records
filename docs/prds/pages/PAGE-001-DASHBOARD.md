# PAGE-001: DASHBOARD.md

# PRD: Dashboard — Mission Control

## Overview
Post-login landing page. Unified view of all projects, activity, and quick actions.

## Context
SWR is a browser-native audio-reactive video engine. This is the first page users see after opening the app or logging in.

## Layout
```
┌─────────────────────────────────────────┐
│  HEADER: Brand | Search | Notifications | Profile │
├─────────────────────────────────────────┤
│                                         │
│  ┌─────────────┐  ┌─────────────────┐   │
│  │ QUICK START │  │ RECENT PROJECTS │   │
│  │             │  │                 │   │
│  │ New Project │  │ [thumb] [thumb] │   │
│  │ Continue    │  │ [thumb] [thumb] │   │
│  │ Browse      │  │                 │   │
│  │ Templates   │  └─────────────────┘   │
│  └─────────────┘                        │
│                                         │
│  ┌─────────────┐  ┌─────────────────┐   │
│  │   STATS     │  │  ACTIVITY FEED  │   │
│  │ Renders: 47 │  │ • Exported "Song"│   │
│  │ Minutes: 89 │  │ • Client approved│   │
│  │ Credits: 23 │  │ • New preset    │   │
│  └─────────────┘  └─────────────────┘   │
│                                         │
└─────────────────────────────────────────┘
```

## Sections

### Quick Start
- Button: "New Project" → opens engine with blank canvas
- Button: "Continue Last" → opens most recent project
- Button: "Browse Templates" → navigates to Marketplace

### Recent Projects
- Grid of 4-6 project thumbnails
- Each card: thumbnail, title, last modified, status badge
- Status: draft | in-review | approved | delivered
- Click to open project

### Stats (monthly)
- Renders created: number
- Export minutes: total duration
- Remaining credits: if on paid tier
- Presets used: most frequent

### Activity Feed
- Chronological list:
  - "Exported '[Song]' in 9:16"
  - "Client approved '[Project]'"
  - "New preset available: Liquid Glass"
  - "Team member [Name] joined"
- Timestamp: relative ("2h ago")

## Data Model

```javascript
interface DashboardState {
  recentProjects: Project[];
  monthlyStats: {
    renders: number;
    minutes: number;
    credits: number;
    topPreset: string;
  };
  activity: ActivityItem[];
  notifications: Notification[];
}
```

## UI Specification

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Dashboard — SWR</title>
  <link rel="stylesheet" href="/shared/styles/tokens.css">
  <link rel="stylesheet" href="/shared/styles/components.css">
  <style>
    .dashboard {
      max-width: 1400px;
      margin: 0 auto;
      padding: 24px;
    }
    .dashboard-grid {
      display: grid;
      grid-template-columns: 280px 1fr;
      grid-template-rows: auto auto;
      gap: 24px;
    }
    .quick-start {
      background: var(--bg-surface);
      border-radius: var(--radius-lg);
      padding: 24px;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .quick-start h2 {
      font-size: 0.75rem;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--text-secondary);
    }
    .quick-btn {
      padding: 16px;
      background: var(--bg-hover);
      border: 1px solid var(--border-medium);
      border-radius: var(--radius-md);
      color: var(--text-primary);
      text-align: left;
      cursor: pointer;
      transition: all 150ms ease;
    }
    .quick-btn:hover {
      background: var(--bg-active);
      border-color: var(--accent-primary);
    }
    .quick-btn .label {
      font-weight: 600;
      font-size: 0.95rem;
    }
    .quick-btn .hint {
      font-size: 0.8rem;
      color: var(--text-muted);
      margin-top: 4px;
    }
    .projects-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
      gap: 16px;
    }
    .project-card {
      aspect-ratio: 9/16;
      background: var(--bg-surface);
      border-radius: var(--radius-md);
      overflow: hidden;
      position: relative;
      cursor: pointer;
      border: 2px solid transparent;
      transition: all 150ms ease;
    }
    .project-card:hover {
      border-color: var(--accent-primary);
      transform: translateY(-2px);
    }
    .project-card .thumb {
      width: 100%;
      height: 70%;
      background: linear-gradient(135deg, var(--bg-hover), var(--bg-active));
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 2rem;
    }
    .project-card .meta {
      padding: 12px;
    }
    .project-card .title {
      font-weight: 600;
      font-size: 0.85rem;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .project-card .date {
      font-size: 0.75rem;
      color: var(--text-muted);
      margin-top: 4px;
    }
    .status-badge {
      position: absolute;
      top: 8px;
      right: 8px;
      padding: 4px 8px;
      border-radius: 20px;
      font-size: 0.65rem;
      font-weight: 700;
      text-transform: uppercase;
    }
    .status-draft { background: rgba(107,114,128,0.2); color: #9ca3af; }
    .status-review { background: rgba(245,158,11,0.2); color: #f59e0b; }
    .status-approved { background: rgba(16,185,129,0.2); color: #10b981; }
    .status-delivered { background: rgba(99,102,241,0.2); color: #6366f1; }
    .stats-row {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 16px;
      margin-top: 24px;
    }
    .stat-card {
      background: var(--bg-surface);
      border-radius: var(--radius-md);
      padding: 20px;
    }
    .stat-card .value {
      font-size: 1.8rem;
      font-weight: 700;
      color: var(--text-primary);
    }
    .stat-card .label {
      font-size: 0.75rem;
      color: var(--text-secondary);
      text-transform: uppercase;
      letter-spacing: 0.05em;
      margin-top: 8px;
    }
    .activity-list {
      background: var(--bg-surface);
      border-radius: var(--radius-lg);
      padding: 20px;
      max-height: 300px;
      overflow-y: auto;
    }
    .activity-item {
      display: flex;
      align-items: flex-start;
      gap: 12px;
      padding: 12px 0;
      border-bottom: 1px solid var(--border-subtle);
    }
    .activity-item:last-child {
      border-bottom: none;
    }
    .activity-icon {
      width: 32px;
      height: 32px;
      border-radius: 8px;
      background: var(--bg-hover);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 0.9rem;
      flex-shrink: 0;
    }
    .activity-text {
      flex: 1;
      font-size: 0.85rem;
      color: var(--text-primary);
      line-height: 1.4;
    }
    .activity-time {
      font-size: 0.75rem;
      color: var(--text-muted);
      flex-shrink: 0;
    }
  </style>
</head>
<body>

<header class="platform-header">
  <div class="brand">
    <div class="brand-icon">⚡</div>
    <span>Sainted Word Records</span>
  </div>
  <div class="header-search">
    <input type="text" placeholder="Search projects, songs, clients...">
  </div>
  <div class="header-actions">
    <button class="btn btn-ghost">🔔</button>
    <div class="avatar">K</div>
  </div>
</header>

<main class="dashboard">
  <div class="dashboard-grid">
    
    <!-- Quick Start -->
    <section class="quick-start">
      <h2>Quick Start</h2>
      <button class="quick-btn" onclick="newProject()">
        <div class="label">New Project</div>
        <div class="hint">Start from scratch with your song</div>
      </button>
      <button class="quick-btn" onclick="continueLast()">
        <div class="label">Continue Last</div>
        <div class="hint">"Summer Vibes — Neon Draft"</div>
      </button>
      <button class="quick-btn" onclick="browseTemplates()">
        <div class="label">Browse Templates</div>
        <div class="hint">Start from a preset pack</div>
      </button>
    </section>
    
    <!-- Recent Projects -->
    <section>
      <h2 style="font-size:0.75rem; text-transform:uppercase; letter-spacing:0.08em; color:var(--text-secondary); margin-bottom:16px;">
        Recent Projects
      </h2>
      <div class="projects-grid" id="projectsGrid">
        <!-- Populated by JS -->
      </div>
    </section>
    
  </div>
  
  <!-- Stats -->
  <div class="stats-row">
    <div class="stat-card">
      <div class="value" id="statRenders">47</div>
      <div class="label">Renders This Month</div>
    </div>
    <div class="stat-card">
      <div class="value" id="statMinutes">89</div>
      <div class="label">Export Minutes</div>
    </div>
    <div class="stat-card">
      <div class="value" id="statCredits">23</div>
      <div class="label">Credits Remaining</div>
    </div>
    <div class="stat-card">
      <div class="value" id="statPreset">Neon</div>
      <div class="label">Top Preset</div>
    </div>
  </div>
  
  <!-- Activity -->
  <section style="margin-top:24px;">
    <h2 style="font-size:0.75rem; text-transform:uppercase; letter-spacing:0.08em; color:var(--text-secondary); margin-bottom:16px;">
      Activity
    </h2>
    <div class="activity-list" id="activityList">
      <!-- Populated by JS -->
    </div>
  </section>
  
</main>

<script>
// Mock data — replace with IndexedDB
const projects = [
  { id: 1, title: "Summer Vibes", thumb: "🎵", date: "2h ago", status: "draft" },
  { id: 2, title: "Midnight Drive", thumb: "🚗", date: "Yesterday", status: "review" },
  { id: 3, title: "Wedding First Dance", thumb: "💒", date: "3 days ago", status: "approved" },
  { id: 4, title: "Club Promo", thumb: "🎉", date: "1 week ago", status: "delivered" }
];

const activities = [
  { icon: "📤", text: "Exported 'Summer Vibes' in 9:16 Vertical", time: "2h ago" },
  { icon: "✅", text: "Client approved 'Midnight Drive'", time: "5h ago" },
  { icon: "🎨", text: "New preset available: Liquid Glass", time: "1d ago" },
  { icon: "👤", text: "Team member Alex joined Studio", time: "2d ago" }
];

function renderProjects() {
  const grid = document.getElementById('projectsGrid');
  grid.innerHTML = projects.map(p => `
    <div class="project-card" onclick="openProject(${p.id})">
      <div class="thumb">${p.thumb}</div>
      <div class="meta">
        <div class="title">${p.title}</div>
        <div class="date">${p.date}</div>
      </div>
      <span class="status-badge status-${p.status}">${p.status}</span>
    </div>
  `).join('');
}

function renderActivity() {
  const list = document.getElementById('activityList');
  list.innerHTML = activities.map(a => `
    <div class="activity-item">
      <div class="activity-icon">${a.icon}</div>
      <div class="activity-text">${a.text}</div>
      <div class="activity-time">${a.time}</div>
    </div>
  `).join('');
}

function newProject() { window.location.href = '/app'; }
function continueLast() { window.location.href = '/app?project=last'; }
function browseTemplates() { window.location.href = '/platform/marketplace.html'; }
function openProject(id) { window.location.href = `/app?project=${id}`; }

renderProjects();
renderActivity();
</script>

</body>
</html>
```

## Acceptance Criteria
- [ ] Load time < 2 seconds on 4G
- [ ] Projects searchable by name, client, date
- [ ] Stats update in real-time (local calculation)
- [ ] Notifications dismissible and persistent

## Dependencies
- PRD-002 (stylesheet fix) for base styles
- PRD-004 (typography) for text rendering in thumbnails
```
