# PAGE-006: MARKETPLACE.md

# PRD: Marketplace — Preset Exchange

## Overview
Buy, sell, and share presets, template packs, and visual assets.

## Context
Creators want to monetize their presets. Users want professional looks without building from scratch.

## Layout
```
┌─────────────────────────────────────────┐
│  MARKETPLACE | Browse | My Packs | Sell │
├─────────────────────────────────────────┤
│  Filters: Genre | Mood | Price | Rating│
├─────────────────────────────────────────┤
│  ┌────────┐ ┌────────┐ ┌────────┐    │
│  │ [prev] │ │ [prev] │ │ [prev] │    │
│  │ Pack   │ │ Pack   │ │ Pack   │    │
│  │ $10    │ │ Free   │ │ $25    │    │
│  └────────┘ └────────┘ └────────┘    │
│                                         │
│  Featured: "Wedding 2026" by Creator     │
│  Top Downloaded | New Arrivals           │
└─────────────────────────────────────────┘
```

## Features

### Preset Packs
- Creator uploads: preset JSON + preview video + description
- Categories: genre (techno, lo-fi, wedding), mood (dark, bright, nostalgic)
- Pricing: free, $5, $10, $25

### Revenue Share
- Creator: 70%
- Platform: 30%

### Rating & Review
- 5-star rating
- Written review
- "Most downloaded this week"

## UI Specification

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Marketplace — SWR</title>
  <link rel="stylesheet" href="/shared/styles/tokens.css">
  <link rel="stylesheet" href="/shared/styles/components.css">
  <style>
    .marketplace-layout {
      max-width: 1200px;
      margin: 0 auto;
      padding: 24px;
    }
    .marketplace-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 24px;
    }
    .marketplace-tabs {
      display: flex;
      gap: 4px;
      background: var(--bg-surface);
      padding: 4px;
      border-radius: var(--radius-md);
    }
    .marketplace-tab {
      padding: 8px 16px;
      border: none;
      background: transparent;
      color: var(--text-secondary);
      cursor: pointer;
      border-radius: var(--radius-sm);
      font-weight: 500;
    }
    .marketplace-tab.active {
      background: var(--accent-primary);
      color: white;
    }
    .filters-bar {
      display: flex;
      gap: 12px;
      margin-bottom: 24px;
      flex-wrap: wrap;
    }
    .filter-chip {
      padding: 6px 14px;
      background: var(--bg-surface);
      border: 1px solid var(--border-medium);
      border-radius: 20px;
      font-size: 0.85rem;
      cursor: pointer;
    }
    .filter-chip.active {
      background: var(--accent-primary);
      border-color: var(--accent-primary);
      color: white;
    }
    .packs-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
      gap: 20px;
    }
    .pack-card {
      background: var(--bg-surface);
      border-radius: var(--radius-lg);
      overflow: hidden;
      border: 2px solid transparent;
      transition: all 150ms ease;
      cursor: pointer;
    }
    .pack-card:hover {
      border-color: var(--accent-primary);
      transform: translateY(-4px);
    }
    .pack-preview {
      aspect-ratio: 16/9;
      background: linear-gradient(135deg, var(--bg-hover), var(--bg-active));
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 3rem;
    }
    .pack-info {
      padding: 16px;
    }
    .pack-title {
      font-weight: 700;
      font-size: 1rem;
      margin-bottom: 4px;
    }
    .pack-creator {
      font-size: 0.85rem;
      color: var(--text-secondary);
    }
    .pack-meta {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-top: 12px;
    }
    .pack-price {
      font-weight: 700;
      font-size: 1.1rem;
      color: var(--accent-success);
    }
    .pack-price.free {
      color: var(--accent-primary);
    }
    .pack-rating {
      font-size: 0.85rem;
      color: var(--accent-warning);
    }
    .featured-banner {
      background: linear-gradient(135deg, rgba(99,102,241,0.1), rgba(236,72,153,0.1));
      border: 1px solid var(--border-medium);
      border-radius: var(--radius-lg);
      padding: 24px;
      margin-bottom: 24px;
      display: grid;
      grid-template-columns: 1fr 200px;
      gap: 24px;
      align-items: center;
    }
  </style>
</head>
<body>

<div class="marketplace-layout">
  
  <div class="marketplace-header">
    <h1>Marketplace</h1>
    <div class="marketplace-tabs">
      <button class="marketplace-tab active">Browse</button>
      <button class="marketplace-tab">My Packs</button>
      <button class="marketplace-tab">Sell</button>
    </div>
  </div>
  
  <!-- Featured -->
  <div class="featured-banner">
    <div>
      <h2>Wedding Collection 2026</h2>
      <p style="color:var(--text-secondary); margin-top:8px;">
        12 romantic presets, 5 overlay packs, and 3 title templates. 
        Perfect for first dances, ceremonies, and reception visuals.
      </p>
      <button class="btn btn-primary mt-sm">View Collection — $25</button>
    </div>
    <div style="font-size:4rem;">💒</div>
  </div>
  
  <!-- Filters -->
  <div class="filters-bar">
    <button class="filter-chip active">All</button>
    <button class="filter-chip">Techno</button>
    <button class="filter-chip">Lo-Fi</button>
    <button class="filter-chip">Wedding</button>
    <button class="filter-chip">Dark</button>
    <button class="filter-chip">Bright</button>
    <button class="filter-chip">Free</button>
    <button class="filter-chip">Paid</button>
  </div>
  
  <!-- Packs -->
  <div class="packs-grid" id="packsGrid">
    <!-- Populated by JS -->
  </div>
  
</div>

<script>
const packs = [
  { id: 1, title: "Neon Nights", creator: "PixelPusha", price: 10, rating: 4.8, reviews: 124, thumb: "🌃", featured: false },
  { id: 2, title: "Film Grain Pro", creator: "CineSWR", price: 0, rating: 4.5, reviews: 89, thumb: "🎞", featured: false },
  { id: 3, title: "Club Strobe Pack", creator: "VJ_Kai", price: 15, rating: 4.9, reviews: 256, thumb: "⚡", featured: false },
  { id: 4, title: "Lo-Fi Study", creator: "ChillVibes", price: 5, rating: 4.7, reviews: 67, thumb: "📚", featured: false }
];

function renderPacks() {
  const grid = document.getElementById('packsGrid');
  grid.innerHTML = packs.map(p => `
    <div class="pack-card" onclick="viewPack(${p.id})">
      <div class="pack-preview">${p.thumb}</div>
      <div class="pack-info">
        <div class="pack-title">${p.title}</div>
        <div class="pack-creator">by ${p.creator}</div>
        <div class="pack-meta">
          <span class="pack-price ${p.price === 0 ? 'free' : ''}">
            ${p.price === 0 ? 'Free' : '$' + p.price}
          </span>
          <span class="pack-rating">★ ${p.rating} (${p.reviews})</span>
        </div>
      </div>
    </div>
  `).join('');
}

function viewPack(id) {
  console.log('View pack:', id);
}

renderPacks();
</script>

</body>
</html>
```

## Acceptance Criteria
- [ ] Pack installs in < 3 seconds
- [ ] Preview video plays before purchase
- [ ] Revenue tracked and displayed to creator
- [ ] Review system prevents spam

## Dependencies
- Payment processing (Stripe)
- File upload and storage
```
