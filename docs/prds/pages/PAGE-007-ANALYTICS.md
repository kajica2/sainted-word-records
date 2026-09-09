# PAGE-007: ANALYTICS.md

# PRD: Analytics — Performance Dashboard

## Overview
Post-release data for creators. Close the feedback loop.

## Context
The engine creates content but doesn't show what performs. Analytics justifies creative decisions.

## Layout
```
┌─────────────────────────────────────────┐
│  ANALYTICS | Overview | Videos | A/B   │
├─────────────────────────────────────────┤
│  CONNECT: YouTube | TikTok | Instagram   │
├─────────────────────────────────────────┤
│  ┌─────────┐ ┌─────────┐ ┌─────────┐   │
│  │ Views   │ │ Watch   │ │ Retention│  │
│  │ 45.2K   │ │ 2:14    │ │ 68%     │   │
│  └─────────┘ └─────────┘ └─────────┘   │
├─────────────────────────────────────────┤
│  RETENTION GRAPH                        │
│  ████████████████████░░░░░░░░░░░░░░░░   │
│  0s    30s    60s    90s   120s   150s  │
├─────────────────────────────────────────┤
│  A/B TESTS: Hook A vs Hook B            │
│  ┌────────┐ ┌────────┐                   │
│  │ 78%    │ │ 82%    │  ← Winner        │
│  │completion│ │completion│                   │
│  └────────┘ └────────┘                   │
└─────────────────────────────────────────┘
```

## Features

### Platform Integration
Connect to:
- YouTube Analytics API
- TikTok Analytics (manual upload)
- Instagram Insights (manual upload)

### Metrics
- Views, watch time, audience retention
- A/B test: Hook A vs Hook B completion rate
- Best-performing preset (anonymized community data)

### Reports
"Weekly Summary" email:
- Renders created: 12
- Most used preset: Neon
- Top performing video: "Song" — 45K views

## UI Specification

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Analytics — SWR</title>
  <link rel="stylesheet" href="/shared/styles/tokens.css">
  <link rel="stylesheet" href="/shared/styles/components.css">
  <style>
    .analytics-layout {
      max-width: 1200px;
      margin: 0 auto;
      padding: 24px;
    }
    .connect-bar {
      display: flex;
      gap: 12px;
      margin-bottom: 24px;
    }
    .platform-pill {
      padding: 8px 16px;
      background: var(--bg-surface);
      border: 1px solid var(--border-medium);
      border-radius: 20px;
      font-size: 0.85rem;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .platform-pill.connected {
      border-color: var(--accent-success);
      color: var(--accent-success);
    }
    .stats-row {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 16px;
      margin-bottom: 24px;
    }
    .stat-card-large {
      background: var(--bg-surface);
      border-radius: var(--radius-lg);
      padding: 24px;
    }
    .stat-card-large .value {
      font-size: 2.5rem;
      font-weight: 700;
      color: var(--text-primary);
    }
    .stat-card-large .label {
      font-size: 0.85rem;
      color: var(--text-secondary);
      margin-top: 8px;
    }
    .retention-chart {
      background: var(--bg-surface);
      border-radius: var(--radius-lg);
      padding: 24px;
      height: 300px;
      display: flex;
      align-items: flex-end;
      gap: 4px;
    }
    .retention-bar {
      flex: 1;
      background: var(--accent-primary);
      border-radius: 4px 4px 0 0;
      min-height: 20px;
      opacity: 0.8;
    }
    .retention-bar:hover {
      opacity: 1;
    }
    .ab-tests {
      margin-top: 24px;
    }
    .ab-card {
      background: var(--bg-surface);
      border-radius: var(--radius-lg);
      padding: 20px;
      display: grid;
      grid-template-columns: 1fr 1fr 80px;
      gap: 16px;
      align-items: center;
      margin-bottom: 16px;
    }
    .ab-variant {
      text-align: center;
    }
    .ab-variant .thumb {
      aspect-ratio: 9/16;
      background: var(--bg-hover);
      border-radius: var(--radius-md);
      margin-bottom: 8px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 1.5rem;
    }
    .ab-variant .metric {
      font-size: 1.5rem;
      font-weight: 700;
    }
    .ab-variant .label {
      font-size: 0.8rem;
      color: var(--text-secondary);
    }
    .ab-winner {
      text-align: center;
      color: var(--accent-success);
    }
  </style>
</head>
<body>

<div class="analytics-layout">
  
  <h1>Analytics</h1>
  
  <!-- Platform Connect -->
  <div class="connect-bar">
    <div class="platform-pill connected">
      <span>✓</span> YouTube Connected
    </div>
    <div class="platform-pill">
      <span>○</span> TikTok Connect
    </div>
    <div class="platform-pill">
      <span>○</span> Instagram Connect
    </div>
  </div>
  
  <!-- Stats -->
  <div class="stats-row">
    <div class="stat-card-large">
      <div class="value">45.2K</div>
      <div class="label">Total Views</div>
    </div>
    <div class="stat-card-large">
      <div class="value">2:14</div>
      <div class="label">Avg. Watch Time</div>
    </div>
    <div class="stat-card-large">
      <div class="value">68%</div>
      <div class="label">Avg. Retention</div>
    </div>
  </div>
  
  <!-- Retention -->
  <div class="retention-chart" id="retentionChart">
    <!-- Populated by JS -->
  </div>
  <div style="display:flex; justify-content:space-between; margin-top:8px; font-size:0.8rem; color:var(--text-muted);">
    <span>0s</span><span>30s</span><span>60s</span><span>90s</span><span>120s</span><span>150s</span>
  </div>
  
  <!-- A/B Tests -->
  <div class="ab-tests">
    <h2 style="font-size:1rem; margin-bottom:16px;">A/B Tests</h2>
    
    <div class="ab-card">
      <div class="ab-variant">
        <div class="thumb">🎬 A</div>
        <div class="metric">78%</div>
        <div class="label">completion</div>
      </div>
      <div class="ab-variant">
        <div class="thumb">🎬 B</div>
        <div class="metric">82%</div>
        <div class="label">completion</div>
      </div>
      <div class="ab-winner">
        <div style="font-size:2rem;">🏆</div>
        <div style="font-size:0.8rem; font-weight:700;">WINNER</div>
      </div>
    </div>
  </div>
  
</div>

<script>
// Retention data: percentage at each 10s bucket
const retentionData = [100, 95, 88, 82, 76, 71, 68, 65, 62, 58, 55, 52, 48, 45, 42, 38];

function renderRetention() {
  const chart = document.getElementById('retentionChart');
  const maxVal = Math.max(...retentionData);
  
  chart.innerHTML = retentionData.map(val => `
    <div class="retention-bar" style="height:${(val / maxVal * 100)}%;" title="${val}%"></div>
  `).join('');
}

renderRetention();
</script>

</body>
</html>
```

## Acceptance Criteria
- [ ] YouTube API connects with OAuth
- [ ] Retention graph shows 10-second buckets
- [ ] A/B test results statistically significant (p < 0.05)
- [ ] Weekly email generates and sends

## Dependencies
- YouTube Data API v3
- OAuth 2.0 flow
- Email service (SendGrid or similar)
```
