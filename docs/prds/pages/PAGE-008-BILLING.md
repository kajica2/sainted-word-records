# PAGE-008: BILLING.md

# PRD: Billing & Credits

## Overview
Transparent usage and payment management.

## Context
Users need to understand credit costs, top up, and manage team spending.

## Layout
```
┌─────────────────────────────────────────┐
│  BILLING | Credits | Invoices | Team    │
├─────────────────────────────────────────┤
│                                         │
│  CURRENT BALANCE: 23 credits             │
│  [Top Up 50] [Top Up 150] [Top Up 500] │
│                                         │
│  USAGE HISTORY                          │
│  ├─ 1080p render "Song"     · 1 credit │
│  ├─ 4K render "Wedding"      · 3 credits│
│  ├─ Custom preset upload      · 5 credits│
│  └─ Team member invite        · 0 credits│
│                                         │
│  INVOICES                               │
│  ├─ Sep 2026 — $12.00 (Creator)        │
│  └─ Aug 2026 — $36.00 (Studio)         │
│                                         │
│  TEAM (Studio tier)                     │
│  ├─ You (Admin)                        │
│  ├─ Alex (Creator)                     │
│  └─ Sam (Viewer)                       │
│                                         │
└─────────────────────────────────────────┘
```

## Features

### Credit System

| Action | Credit Cost |
|--------|-------------|
| 720p render (Free) | 0 |
| 1080p render | 1 |
| 4K render | 3 |
| Custom preset upload | 5 |

### Top-Up
- Credit packs: 50 ($12), 150 ($28), 500 ($60)
- Never expire
- Stack with subscription credits

### Team Management
- Invite by email
- Roles: admin, creator, viewer
- Usage per member

## UI Specification

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Billing — SWR</title>
  <link rel="stylesheet" href="/shared/styles/tokens.css">
  <link rel="stylesheet" href="/shared/styles/components.css">
  <style>
    .billing-layout {
      max-width: 800px;
      margin: 0 auto;
      padding: 24px;
    }
    .credit-balance {
      background: linear-gradient(135deg, rgba(99,102,241,0.1), rgba(236,72,153,0.1));
      border: 1px solid var(--border-medium);
      border-radius: var(--radius-lg);
      padding: 32px;
      text-align: center;
      margin-bottom: 32px;
    }
    .balance-amount {
      font-size: 3rem;
      font-weight: 700;
      color: var(--text-primary);
    }
    .balance-label {
      font-size: 0.9rem;
      color: var(--text-secondary);
      margin-top: 8px;
    }
    .topup-options {
      display: flex;
      gap: 12px;
      justify-content: center;
      margin-top: 20px;
    }
    .topup-card {
      padding: 16px 24px;
      background: var(--bg-surface);
      border: 2px solid var(--border-medium);
      border-radius: var(--radius-md);
      cursor: pointer;
      text-align: center;
      transition: all 150ms ease;
    }
    .topup-card:hover {
      border-color: var(--accent-primary);
    }
    .topup-card .credits {
      font-size: 1.5rem;
      font-weight: 700;
    }
    .topup-card .price {
      font-size: 0.9rem;
      color: var(--accent-success);
      margin-top: 4px;
    }
    .billing-section {
      margin-bottom: 32px;
    }
    .billing-section h2 {
      font-size: 0.8rem;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--text-secondary);
      margin-bottom: 16px;
    }
    .usage-table {
      width: 100%;
      border-collapse: collapse;
    }
    .usage-table th,
    .usage-table td {
      padding: 12px;
      text-align: left;
      border-bottom: 1px solid var(--border-subtle);
      font-size: 0.9rem;
    }
    .usage-table th {
      color: var(--text-secondary);
      font-weight: 600;
      font-size: 0.75rem;
      text-transform: uppercase;
    }
    .credit-cost {
      color: var(--accent-primary);
      font-weight: 600;
    }
    .invoice-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 12px;
      background: var(--bg-surface);
      border-radius: var(--radius-md);
      margin-bottom: 8px;
    }
    .team-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
      gap: 12px;
    }
    .team-member {
      padding: 16px;
      background: var(--bg-surface);
      border-radius: var(--radius-md);
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .member-avatar {
      width: 40px;
      height: 40px;
      border-radius: 50%;
      background: var(--accent-primary);
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 700;
      color: white;
    }
    .member-info {
      flex: 1;
    }
    .member-name {
      font-weight: 600;
    }
    .member-role {
      font-size: 0.8rem;
      color: var(--text-secondary);
    }
  </style>
</head>
<body>

<div class="billing-layout">
  
  <!-- Balance -->
  <div class="credit-balance">
    <div class="balance-amount">23</div>
    <div class="balance-label">credits remaining</div>
    <div class="topup-options">
      <div class="topup-card" onclick="topUp(50)">
        <div class="credits">50</div>
        <div class="price">$12</div>
      </div>
      <div class="topup-card" onclick="topUp(150)">
        <div class="credits">150</div>
        <div class="price">$28</div>
      </div>
      <div class="topup-card" onclick="topUp(500)">
        <div class="credits">500</div>
        <div class="price">$60</div>
      </div>
    </div>
  </div>
  
  <!-- Usage -->
  <div class="billing-section">
    <h2>Usage History</h2>
    <table class="usage-table">
      <thead>
        <tr>
          <th>Action</th>
          <th>Project</th>
          <th>Date</th>
          <th>Cost</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>1080p Render</td>
          <td>Summer Vibes</td>
          <td>Sep 8, 2026</td>
          <td class="credit-cost">-1</td>
        </tr>
        <tr>
          <td>4K Render</td>
          <td>Wedding First Dance</td>
          <td>Sep 5, 2026</td>
          <td class="credit-cost">-3</td>
        </tr>
        <tr>
          <td>Custom Preset</td>
          <td>Neon Nights</td>
          <td>Sep 1, 2026</td>
          <td class="credit-cost">-5</td>
        </tr>
      </tbody>
    </table>
  </div>
  
  <!-- Invoices -->
  <div class="billing-section">
    <h2>Invoices</h2>
    <div class="invoice-row">
      <span>Sep 2026 — Creator Plan</span>
      <span>$12.00</span>
      <button class="btn btn-sm btn-secondary">Download PDF</button>
    </div>
    <div class="invoice-row">
      <span>Aug 2026 — Studio Plan</span>
      <span>$36.00</span>
      <button class="btn btn-sm btn-secondary">Download PDF</button>
    </div>
  </div>
  
  <!-- Team -->
  <div class="billing-section">
    <h2>Team</h2>
    <div class="team-grid">
      <div class="team-member">
        <div class="member-avatar">Y</div>
        <div class="member-info">
          <div class="member-name">You</div>
          <div class="member-role">Admin</div>
        </div>
      </div>
      <div class="team-member">
        <div class="member-avatar">A</div>
        <div class="member-info">
          <div class="member-name">Alex</div>
          <div class="member-role">Creator</div>
        </div>
      </div>
      <div class="team-member">
        <div class="member-avatar">S</div>
        <div class="member-info">
          <div class="member-name">Sam</div>
          <div class="member-role">Viewer</div>
        </div>
      </div>
    </div>
  </div>
  
</div>

<script>
function topUp(credits) {
  console.log('Top up:', credits);
  // Stripe checkout flow
}
</script>

</body>
</html>
```

## Acceptance Criteria
- [ ] Credit balance visible in header
- [ ] Invoice PDF downloadable
- [ ] Team member can be removed and credits reclaimed
- [ ] Payment via Stripe (PCI compliant, SWR never sees card)

## Dependencies
- Stripe Checkout
- PDF generation library
```
