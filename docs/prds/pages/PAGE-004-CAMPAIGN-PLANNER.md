# PAGE-004: CAMPAIGN-PLANNER.md

# PRD: Campaign / Release Planner

## Overview
Connect music video creation to release strategy.

## Context
Musicians don't just need one video — they need a content calendar around a single release.

## Layout
```
┌─────────────────────────────────────────┐
│  RELEASE: [Song Title] — [Date]         │
│  Platform: [Spotify link]               │
├─────────────────────────────────────────┤
│                                         │
│  TIMELINE                               │
│  ├─ 7 days before: Teaser 3s (TikTok)   │
│  ├─ 5 days before: Behind scenes (Stories)│
│  ├─ 3 days before: Hook 15s (Reels)     │
│  ├─ 1 day before: Countdown (Instagram)  │
│  ├─ Release day: Full video (YouTube)    │
│  └─ +1 day: Thank you (Stories)         │
│                                         │
│  [Generate All] [Export Calendar]        │
│                                         │
└─────────────────────────────────────────┘
```

## Features

### Release Setup
- Song link (Spotify, Apple Music, etc.)
- Release date
- Target platforms

### Auto-Generated Calendar
| Days Before | Content | Format | Platform |
|-------------|---------|--------|----------|
| 7 | Teaser 3s | 9:16 | TikTok |
| 5 | Behind scenes | 9:16 | Stories |
| 3 | Hook 15s | 9:16 | Reels |
| 1 | Countdown | 1:1 | Instagram |
| 0 | Full video | 16:9 | YouTube |
| +1 | Thank you | 9:16 | Stories |

### Status Tracking
Each deliverable: not started → in progress → rendered → scheduled → posted

## UI Specification

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Campaign — SWR</title>
  <link rel="stylesheet" href="/shared/styles/tokens.css">
  <link rel="stylesheet" href="/shared/styles/components.css">
  <style>
    .campaign-layout {
      max-width: 1000px;
      margin: 0 auto;
      padding: 24px;
    }
    .release-header {
      background: var(--bg-surface);
      border-radius: var(--radius-lg);
      padding: 24px;
      margin-bottom: 24px;
    }
    .release-title {
      font-size: 1.5rem;
      font-weight: 700;
      margin-bottom: 8px;
    }
    .release-meta {
      display: flex;
      gap: 16px;
      color: var(--text-secondary);
      font-size: 0.9rem;
    }
    .timeline {
      position: relative;
      padding-left: 32px;
    }
    .timeline::before {
      content: '';
      position: absolute;
      left: 8px;
      top: 0;
      bottom: 0;
      width: 2px;
      background: var(--border-medium);
    }
    .timeline-item {
      position: relative;
      margin-bottom: 24px;
      padding: 20px;
      background: var(--bg-surface);
      border-radius: var(--radius-md);
      border: 2px solid transparent;
    }
    .timeline-item.active {
      border-color: var(--accent-primary);
    }
    .timeline-dot {
      position: absolute;
      left: -28px;
      top: 24px;
      width: 16px;
      height: 16px;
      border-radius: 50%;
      background: var(--bg-surface);
      border: 2px solid var(--accent-primary);
    }
    .timeline-dot.done {
      background: var(--accent-success);
      border-color: var(--accent-success);
    }
    .timeline-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 12px;
    }
    .timeline-day {
      font-size: 0.75rem;
      font-weight: 700;
      text-transform: uppercase;
      color: var(--accent-primary);
    }
    .timeline-status {
      padding: 4px 12px;
      border-radius: 20px;
      font-size: 0.75rem;
      font-weight: 600;
    }
    .timeline-content {
      display: grid;
      grid-template-columns: 120px 1fr;
      gap: 16px;
      align-items: center;
    }
    .timeline-thumb {
      aspect-ratio: 9/16;
      background: var(--bg-hover);
      border-radius: var(--radius-sm);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 1.5rem;
    }
    .timeline-details h3 {
      font-size: 1rem;
      margin-bottom: 8px;
    }
    .timeline-specs {
      display: flex;
      gap: 12px;
      font-size: 0.8rem;
      color: var(--text-secondary);
    }
    .timeline-actions {
      display: flex;
      gap: 8px;
      margin-top: 16px;
    }
  </style>
</head>
<body>

<div class="campaign-layout">
  
  <!-- Release Header -->
  <div class="release-header">
    <div class="release-title">Summer Vibes</div>
    <div class="release-meta">
      <span>🎵 Spotify: spotify.link/abc123</span>
      <span>📅 Release: Oct 15, 2026</span>
      <span>🏷️ Label: Acme Records</span>
    </div>
  </div>
  
  <!-- Timeline -->
  <div class="timeline" id="campaignTimeline">
    <!-- Populated by JS -->
  </div>
  
  <!-- Actions -->
  <div style="display:flex; gap:12px; margin-top:24px;">
    <button class="btn btn-primary btn-lg">Generate All Videos</button>
    <button class="btn btn-secondary btn-lg">Export Calendar (ICS)</button>
  </div>
  
</div>

<script>
const campaignItems = [
  { day: "-7", label: "7 days before", title: "Teaser", format: "9:16", platform: "TikTok", duration: "3s", status: "done", thumb: "🎬" },
  { day: "-5", label: "5 days before", title: "Behind the Scenes", format: "9:16", platform: "Stories", duration: "15s", status: "done", thumb: "📸" },
  { day: "-3", label: "3 days before", title: "Hook", format: "9:16", platform: "Reels", duration: "15s", status: "active", thumb: "🎵" },
  { day: "-1", label: "1 day before", title: "Countdown", format: "1:1", platform: "Instagram", duration: "5s", status: "pending", thumb: "⏰" },
  { day: "0", label: "Release day", title: "Full Video", format: "16:9", platform: "YouTube", duration: "3:42", status: "pending", thumb: "🎉" },
  { day: "+1", label: "1 day after", title: "Thank You", format: "9:16", platform: "Stories", duration: "10s", status: "pending", thumb: "🙏" }
];

function renderTimeline() {
  const container = document.getElementById('campaignTimeline');
  container.innerHTML = campaignItems.map(item => `
    <div class="timeline-item ${item.status === 'active' ? 'active' : ''}">
      <div class="timeline-dot ${item.status === 'done' ? 'done' : ''}"></div>
      <div class="timeline-header">
        <span class="timeline-day">${item.label}</span>
        <span class="timeline-status status-${item.status}">${item.status}</span>
      </div>
      <div class="timeline-content">
        <div class="timeline-thumb">${item.thumb}</div>
        <div class="timeline-details">
          <h3>${item.title}</h3>
          <div class="timeline-specs">
            <span>${item.format}</span>
            <span>${item.duration}</span>
            <span>${item.platform}</span>
          </div>
          <div class="timeline-actions">
            <button class="btn btn-sm btn-primary">Create</button>
            <button class="btn btn-sm btn-secondary">Preview</button>
          </div>
        </div>
      </div>
    </div>
  `).join('');
}

renderTimeline();
</script>

</body>
</html>
```

## Acceptance Criteria
- [ ] Calendar generates 6+ deliverables per release
- [ ] Platform specs auto-applied (9:16 for TikTok, etc.)
- [ ] Status syncs with project state
- [ ] Export calendar as PDF or ICS

## Dependencies
- PRD-006 (hook generator) for auto-generated content
```
