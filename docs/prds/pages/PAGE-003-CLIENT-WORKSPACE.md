# PAGE-003: CLIENT-WORKSPACE.md

# PRD: Client Workspace

## Overview
Isolated project spaces per client with branding, history, and approvals.

## Context
Studio tier users manage multiple clients. Each client needs a branded, contained view of their projects.

## Layout
```
┌─────────────────────────────────────────┐
│  CLIENT HEADER: [Logo] Client Name      │
│  Tabs: Projects | Brand | Team | Billing │
├─────────────────────────────────────────┤
│                                         │
│  PROJECT LIST                           │
│  ┌────────┐ ┌────────┐ ┌────────┐      │
│  │ [thumb]│ │ [thumb]│ │ [thumb]│      │
│  │ Draft  │ │ Review │ │Approved│      │
│  └────────┘ └────────┘ └────────┘      │
│                                         │
│  REVIEW PANEL (when project selected)   │
│  [Video player] + [Comment pins]        │
│  [Approve] [Request Changes] [Download]   │
│                                         │
└─────────────────────────────────────────┘
```

## Features

### Per-Client Settings
- Logo, colors, fonts pre-loaded
- All renders for client in one view
- Approval workflow: draft → sent → approved → delivered

### Review Interface
- Video player with comment pins
- Client can: approve, request changes, download final
- Version history: v1, v2, v3 with diff view

## UI Specification

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Client — SWR</title>
  <link rel="stylesheet" href="/shared/styles/tokens.css">
  <link rel="stylesheet" href="/shared/styles/components.css">
  <style>
    .client-layout {
      display: grid;
      grid-template-rows: auto 1fr;
      height: 100vh;
    }
    .client-header {
      background: var(--bg-elevated);
      padding: 16px 24px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      border-bottom: 1px solid var(--border-subtle);
    }
    .client-brand {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .client-logo {
      width: 40px;
      height: 40px;
      border-radius: 8px;
      background: var(--bg-surface);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 1.2rem;
    }
    .client-name {
      font-weight: 700;
      font-size: 1.1rem;
    }
    .client-tabs {
      display: flex;
      gap: 4px;
    }
    .client-tab {
      padding: 8px 16px;
      border: none;
      background: transparent;
      color: var(--text-secondary);
      cursor: pointer;
      border-radius: var(--radius-sm);
      font-weight: 500;
    }
    .client-tab.active {
      background: var(--accent-primary);
      color: white;
    }
    .client-main {
      display: grid;
      grid-template-columns: 1fr 400px;
      overflow: hidden;
    }
    .projects-area {
      padding: 24px;
      overflow-y: auto;
    }
    .review-panel {
      background: var(--bg-elevated);
      border-left: 1px solid var(--border-subtle);
      padding: 24px;
      overflow-y: auto;
    }
    .status-pipeline {
      display: flex;
      gap: 8px;
      margin-bottom: 24px;
    }
    .status-step {
      flex: 1;
      text-align: center;
      padding: 12px;
      border-radius: var(--radius-md);
      font-size: 0.8rem;
      font-weight: 600;
    }
    .status-step.active {
      background: var(--accent-primary);
      color: white;
    }
    .status-step.inactive {
      background: var(--bg-surface);
      color: var(--text-muted);
    }
    .video-player {
      aspect-ratio: 9/16;
      background: #000;
      border-radius: var(--radius-md);
      display: flex;
      align-items: center;
      justify-content: center;
      color: var(--text-muted);
      margin-bottom: 16px;
    }
    .comment-pins {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .comment-item {
      padding: 12px;
      background: var(--bg-surface);
      border-radius: var(--radius-sm);
      font-size: 0.85rem;
    }
    .comment-meta {
      font-size: 0.75rem;
      color: var(--text-muted);
      margin-top: 4px;
    }
    .action-buttons {
      display: flex;
      gap: 8px;
      margin-top: 16px;
    }
  </style>
</head>
<body>

<div class="client-layout">
  
  <header class="client-header">
    <div class="client-brand">
      <div class="client-logo">🏢</div>
      <span class="client-name">Acme Records</span>
    </div>
    <nav class="client-tabs">
      <button class="client-tab active">Projects</button>
      <button class="client-tab">Brand</button>
      <button class="client-tab">Team</button>
      <button class="client-tab">Billing</button>
    </nav>
  </header>
  
  <main class="client-main">
    
    <!-- Projects -->
    <section class="projects-area">
      <div class="status-pipeline">
        <div class="status-step active">Draft</div>
        <div class="status-step">Sent</div>
        <div class="status-step">Approved</div>
        <div class="status-step">Delivered</div>
      </div>
      
      <div class="projects-grid" id="clientProjects">
        <!-- Populated by JS -->
      </div>
    </section>
    
    <!-- Review -->
    <aside class="review-panel">
      <div class="video-player">▶ Preview</div>
      
      <h3 style="font-size:0.8rem; text-transform:uppercase; color:var(--text-secondary); margin-bottom:12px;">
        Comments
      </h3>
      <div class="comment-pins" id="commentPins">
        <div class="comment-item">
          Love the color palette! Can we make the text bigger?
          <div class="comment-meta">Alex — 2h ago · Frame 124</div>
        </div>
        <div class="comment-item">
          The drop at 0:32 needs more impact.
          <div class="comment-meta">Sam — 5h ago · Frame 960</div>
        </div>
      </div>
      
      <div class="action-buttons">
        <button class="btn btn-success flex-1">✓ Approve</button>
        <button class="btn btn-warning flex-1">✎ Changes</button>
        <button class="btn btn-secondary flex-1">⬇ Download</button>
      </div>
    </aside>
    
  </main>
  
</div>

<script>
const clientProjects = [
  { id: 1, title: "Single Promo", status: "draft", thumb: "🎵" },
  { id: 2, title: "Album Teaser", status: "review", thumb: "💿" },
  { id: 3, title: "Tour Visuals", status: "approved", thumb: "🎉" }
];

function renderClientProjects() {
  const grid = document.getElementById('clientProjects');
  grid.innerHTML = clientProjects.map(p => `
    <div class="project-card" style="background:var(--bg-surface); border-radius:var(--radius-md); padding:16px; cursor:pointer;">
      <div style="font-size:2rem; margin-bottom:8px;">${p.thumb}</div>
      <div style="font-weight:600;">${p.title}</div>
      <div style="font-size:0.75rem; color:var(--text-muted); text-transform:uppercase;">${p.status}</div>
    </div>
  `).join('');
}

renderClientProjects();
</script>

</body>
</html>
```

## Acceptance Criteria
- [ ] Client sees only their projects
- [ ] Approval status updates in real-time (local state)
- [ ] Shareable link works without login
- [ ] Version diff shows side-by-side comparison

## Dependencies
- PRD-004 (typography) for text in previews
- PRD-009 (client review) for comment pins
```
