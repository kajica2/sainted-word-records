# PAGE-002: ASSET-MANAGER.md

# PRD: Asset Manager — DAM Lite

## Overview
Organize all media: songs, video clips, images, fonts, brand kits.

## Context
SWR auto-classifies uploaded media by motion, luma, and hue. This page surfaces that metadata for browsing and management.

## Layout
```
┌─────────────────────────────────────────┐
│  HEADER: Brand | Search | Upload | Grid/List toggle │
├─────────────────────────────────────────┤
│  SIDEBAR: Filters                       │
│  ├─ Type: Songs | Clips | Images | Fonts │
│  ├─ Motion: High | Medium | Low         │
│  ├─ Luma: Bright | Mid | Dark           │
│  ├─ Hue: Warm | Cool | Neutral | Mixed  │
│  └─ Used in: [Project dropdown]         │
├─────────────────────────────────────────┤
│  MAIN: Asset Grid                       │
│  ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐     │
│  │ 🎵  │ │ 🎬  │ │ 🖼  │ │ 🎵  │     │
│  └─────┘ └─────┘ └─────┘ └─────┘     │
│  [thumb] [thumb] [thumb] [thumb]      │
└─────────────────────────────────────────┘
```

## Features

### Song Library
| Column | Data |
|--------|------|
| Title | filename or user-edited |
| Duration | mm:ss |
| BPM | detected |
| Key | detected |
| Analyzed | yes/no |
| Used in | 3 projects |

### Clip Library
Auto-classified tags:
- **Motion:** high / medium / low
- **Luma:** bright / mid / dark
- **Hue:** warm / cool / neutral / mixed
- **Edge density:** high / low

### Collections
Folder system for projects, clients, or moods.

## UI Specification

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Assets — SWR</title>
  <link rel="stylesheet" href="/shared/styles/tokens.css">
  <link rel="stylesheet" href="/shared/styles/components.css">
  <style>
    .assets-layout {
      display: grid;
      grid-template-columns: 260px 1fr;
      height: 100vh;
    }
    .filters-sidebar {
      background: var(--bg-elevated);
      padding: 24px;
      border-right: 1px solid var(--border-subtle);
      overflow-y: auto;
    }
    .filter-group {
      margin-bottom: 24px;
    }
    .filter-group h3 {
      font-size: 0.7rem;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--text-secondary);
      margin-bottom: 12px;
    }
    .filter-option {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 12px;
      border-radius: var(--radius-sm);
      cursor: pointer;
      color: var(--text-secondary);
      font-size: 0.85rem;
    }
    .filter-option:hover {
      background: var(--bg-hover);
      color: var(--text-primary);
    }
    .filter-option.active {
      background: rgba(99,102,241,0.1);
      color: var(--accent-primary);
    }
    .filter-option .count {
      margin-left: auto;
      font-size: 0.75rem;
      color: var(--text-muted);
    }
    .assets-main {
      padding: 24px;
      overflow-y: auto;
    }
    .assets-toolbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 24px;
    }
    .view-toggle {
      display: flex;
      background: var(--bg-surface);
      border-radius: var(--radius-md);
      padding: 4px;
    }
    .view-btn {
      padding: 8px 12px;
      border: none;
      background: transparent;
      color: var(--text-secondary);
      cursor: pointer;
      border-radius: var(--radius-sm);
    }
    .view-btn.active {
      background: var(--accent-primary);
      color: white;
    }
    .assets-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
      gap: 16px;
    }
    .asset-card {
      background: var(--bg-surface);
      border-radius: var(--radius-md);
      overflow: hidden;
      cursor: pointer;
      border: 2px solid transparent;
      transition: all 150ms ease;
    }
    .asset-card:hover {
      border-color: var(--accent-primary);
    }
    .asset-card .preview {
      aspect-ratio: 16/9;
      background: var(--bg-hover);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 2.5rem;
    }
    .asset-card .info {
      padding: 12px;
    }
    .asset-card .name {
      font-weight: 600;
      font-size: 0.85rem;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .asset-card .meta {
      font-size: 0.75rem;
      color: var(--text-muted);
      margin-top: 4px;
    }
    .asset-card .tags {
      display: flex;
      gap: 4px;
      margin-top: 8px;
      flex-wrap: wrap;
    }
    .tag {
      padding: 2px 8px;
      border-radius: 10px;
      font-size: 0.65rem;
      background: var(--bg-hover);
      color: var(--text-secondary);
    }
  </style>
</head>
<body>

<div class="assets-layout">
  
  <!-- Filters -->
  <aside class="filters-sidebar">
    <div class="filter-group">
      <h3>Type</h3>
      <div class="filter-option active" data-filter="all">
        <span>All Assets</span>
        <span class="count">247</span>
      </div>
      <div class="filter-option" data-filter="songs">
        <span>🎵 Songs</span>
        <span class="count">12</span>
      </div>
      <div class="filter-option" data-filter="clips">
        <span>🎬 Clips</span>
        <span class="count">198</span>
      </div>
      <div class="filter-option" data-filter="images">
        <span>🖼 Images</span>
        <span class="count">32</span>
      </div>
      <div class="filter-option" data-filter="fonts">
        <span>🔤 Fonts</span>
        <span class="count">5</span>
      </div>
    </div>
    
    <div class="filter-group">
      <h3>Motion</h3>
      <div class="filter-option" data-filter="motion-high">
        <span>High</span>
        <span class="count">45</span>
      </div>
      <div class="filter-option" data-filter="motion-med">
        <span>Medium</span>
        <span class="count">89</span>
      </div>
      <div class="filter-option" data-filter="motion-low">
        <span>Low</span>
        <span class="count">64</span>
      </div>
    </div>
    
    <div class="filter-group">
      <h3>Luma</h3>
      <div class="filter-option" data-filter="luma-bright">
        <span>Bright</span>
        <span class="count">34</span>
      </div>
      <div class="filter-option" data-filter="luma-mid">
        <span>Mid</span>
        <span class="count">112</span>
      </div>
      <div class="filter-option" data-filter="luma-dark">
        <span>Dark</span>
        <span class="count">52</span>
      </div>
    </div>
    
    <div class="filter-group">
      <h3>Hue</h3>
      <div class="filter-option" data-filter="hue-warm">
        <span>Warm</span>
        <span class="count">67</span>
      </div>
      <div class="filter-option" data-filter="hue-cool">
        <span>Cool</span>
        <span class="count">54</span>
      </div>
      <div class="filter-option" data-filter="hue-neutral">
        <span>Neutral</span>
        <span class="count">77</span>
      </div>
    </div>
  </aside>
  
  <!-- Main -->
  <main class="assets-main">
    <div class="assets-toolbar">
      <h1>Assets</h1>
      <div class="view-toggle">
        <button class="view-btn active">⊞ Grid</button>
        <button class="view-btn">☰ List</button>
      </div>
    </div>
    
    <div class="assets-grid" id="assetsGrid">
      <!-- Populated by JS -->
    </div>
  </main>
  
</div>

<script>
const assets = [
  { id: 1, name: "Summer Vibes.mp3", type: "song", thumb: "🎵", duration: "3:42", bpm: 124, key: "A min", tags: ["analyzed"] },
  { id: 2, name: "Neon City Loop", type: "clip", thumb: "🎬", duration: "0:08", motion: "high", luma: "bright", hue: "cool", tags: ["motion-high", "luma-bright", "hue-cool"] },
  { id: 3, name: "Film Grain Overlay", type: "clip", thumb: "🎬", duration: "0:05", motion: "low", luma: "mid", hue: "neutral", tags: ["motion-low", "luma-mid", "hue-neutral"] },
  { id: 4, name: "Concert Crowd", type: "clip", thumb: "🎬", duration: "0:12", motion: "high", luma: "dark", hue: "warm", tags: ["motion-high", "luma-dark", "hue-warm"] }
];

function renderAssets(filter = 'all') {
  const grid = document.getElementById('assetsGrid');
  const filtered = filter === 'all' ? assets : assets.filter(a => 
    a.tags?.includes(filter) || a.type === filter.replace('s', '').replace('e', '')
  );
  
  grid.innerHTML = filtered.map(a => `
    <div class="asset-card" onclick="selectAsset(${a.id})">
      <div class="preview">${a.thumb}</div>
      <div class="info">
        <div class="name">${a.name}</div>
        <div class="meta">${a.duration || ''} ${a.bpm ? '· ' + a.bpm + ' BPM' : ''}</div>
        <div class="tags">
          ${(a.tags || []).slice(0, 3).map(t => `<span class="tag">${t}</span>`).join('')}
        </div>
      </div>
    </div>
  `).join('');
}

// Filter click handlers
document.querySelectorAll('.filter-option').forEach(opt => {
  opt.addEventListener('click', () => {
    document.querySelectorAll('.filter-option').forEach(o => o.classList.remove('active'));
    opt.classList.add('active');
    renderAssets(opt.dataset.filter);
  });
});

function selectAsset(id) {
  console.log('Selected asset:', id);
}

renderAssets();
</script>

</body>
</html>
```

## Acceptance Criteria
- [ ] 1000 clips load without performance degradation
- [ ] Filter by 3+ tags simultaneously
- [ ] Drag and drop to collections
- [ ] Duplicate detection: "This file already exists in 'Wedding 2026'"

## Dependencies
- PRD-002 (stylesheet fix)
- IndexedDB for asset storage
```
