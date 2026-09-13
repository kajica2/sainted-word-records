# PAGE-009: SETTINGS.md

# PRD: Settings / Studio Profile

## Overview
Defaults and integrations for power users.

## Context
Every studio has preferred formats, colors, workflows. Settings centralize these.

## Layout
```
┌─────────────────────────────────────────┐
│  SETTINGS | Profile | Export | Shortcuts  │
│             Integrations | Data           │
├─────────────────────────────────────────┤
│  BRAND DEFAULTS                         │
│  Logo: [upload]  Primary: [#6366f1]     │
│  Font: [Inter]   Secondary: [#8b5cf6]   │
│                                         │
│  EXPORT DEFAULTS                        │
│  Format: 9:16    Codec: MP4             │
│  Quality: 12 Mbps  FPS: 30               │
│                                         │
│  INTEGRATIONS                           │
│  YouTube: ✓ Connected                   │
│  Dropbox: ○ Connect                     │
│  Frame.io: ○ Connect                    │
│                                         │
│  KEYBOARD SHORTCUTS                     │
│  Space: Play/Pause  [edit]              │
│  B: Blackout  [edit]                    │
│                                         │
│  DATA                                   │
│  [Export all projects] [Delete account] │
└─────────────────────────────────────────┘
```

## Features

### Brand Defaults
- Default logo, colors, fonts for all new projects
- Default export: format, codec, bitrate

### Integrations
- YouTube: upload direct (OAuth)
- Dropbox, Google Drive: save exports
- Frame.io: send for review
- Spotify for Artists: link releases

### Shortcuts
Custom keyboard mapping:
```
Space: Play/Pause
B: Blackout
F: Freeze
1-8: Scene pads
```

### Data Export
"Download all my projects" — GDPR compliance.

## UI Specification

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Settings — SWR</title>
  <link rel="stylesheet" href="/shared/styles/tokens.css">
  <link rel="stylesheet" href="/shared/styles/components.css">
  <style>
    .settings-layout {
      max-width: 800px;
      margin: 0 auto;
      padding: 24px;
    }
    .settings-tabs {
      display: flex;
      gap: 4px;
      margin-bottom: 32px;
      border-bottom: 1px solid var(--border-subtle);
      padding-bottom: 12px;
    }
    .settings-tab {
      padding: 8px 16px;
      border: none;
      background: transparent;
      color: var(--text-secondary);
      cursor: pointer;
      border-radius: var(--radius-sm);
      font-weight: 500;
    }
    .settings-tab.active {
      color: var(--accent-primary);
    }
    .settings-section {
      margin-bottom: 40px;
    }
    .settings-section h2 {
      font-size: 0.8rem;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--text-secondary);
      margin-bottom: 20px;
    }
    .form-row {
      display: grid;
      grid-template-columns: 200px 1fr;
      gap: 16px;
      align-items: center;
      margin-bottom: 16px;
    }
    .form-row label {
      font-size: 0.9rem;
      color: var(--text-primary);
    }
    .color-picker-row {
      display: flex;
      gap: 12px;
      align-items: center;
    }
    .color-swatch {
      width: 40px;
      height: 40px;
      border-radius: var(--radius-md);
      border: 2px solid var(--border-medium);
      cursor: pointer;
    }
    .integration-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 16px;
      background: var(--bg-surface);
      border-radius: var(--radius-md);
      margin-bottom: 12px;
    }
    .integration-info {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .integration-icon {
      width: 40px;
      height: 40px;
      border-radius: 8px;
      background: var(--bg-hover);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 1.2rem;
    }
    .shortcut-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 12px 16px;
      background: var(--bg-surface);
      border-radius: var(--radius-sm);
      margin-bottom: 8px;
    }
    .shortcut-key {
      padding: 4px 12px;
      background: var(--bg-hover);
      border-radius: 6px;
      font-family: var(--font-mono);
      font-size: 0.85rem;
    }
    .danger-zone {
      border: 1px solid var(--accent-danger);
      border-radius: var(--radius-lg);
      padding: 24px;
      margin-top: 32px;
    }
    .danger-zone h2 {
      color: var(--accent-danger);
    }
  </style>
</head>
<body>

<div class="settings-layout">
  
  <h1>Settings</h1>
  
  <div class="settings-tabs">
    <button class="settings-tab active">Profile</button>
    <button class="settings-tab">Export</button>
    <button class="settings-tab">Integrations</button>
    <button class="settings-tab">Shortcuts</button>
    <button class="settings-tab">Data</button>
  </div>
  
  <!-- Brand -->
  <div class="settings-section">
    <h2>Brand Defaults</h2>
    <div class="form-row">
      <label>Studio Logo</label>
      <input type="file" accept="image/*">
    </div>
    <div class="form-row">
      <label>Primary Color</label>
      <div class="color-picker-row">
        <div class="color-swatch" style="background:#6366f1;"></div>
        <input type="text" value="#6366f1" style="width:100px;">
      </div>
    </div>
    <div class="form-row">
      <label>Secondary Color</label>
      <div class="color-picker-row">
        <div class="color-swatch" style="background:#8b5cf6;"></div>
        <input type="text" value="#8b5cf6" style="width:100px;">
      </div>
    </div>
    <div class="form-row">
      <label>Default Font</label>
      <select>
        <option>Inter</option>
        <option>SF Pro</option>
        <option>Roboto</option>
        <option>Custom...</option>
      </select>
    </div>
  </div>
  
  <!-- Export -->
  <div class="settings-section">
    <h2>Export Defaults</h2>
    <div class="form-row">
      <label>Format</label>
      <select>
        <option>9:16 Vertical</option>
        <option>1:1 Square</option>
        <option>16:9 Wide</option>
      </select>
    </div>
    <div class="form-row">
      <label>Codec</label>
      <select>
        <option>MP4 (H.264)</option>
        <option>WebM (VP9)</option>
      </select>
    </div>
    <div class="form-row">
      <label>Bitrate</label>
      <select>
        <option>3 Mbps</option>
        <option>6 Mbps</option>
        <option selected>12 Mbps</option>
      </select>
    </div>
    <div class="form-row">
      <label>Frame Rate</label>
      <select>
        <option>24 fps</option>
        <option selected>30 fps</option>
        <option>60 fps</option>
      </select>
    </div>
  </div>
  
  <!-- Integrations -->
  <div class="settings-section">
    <h2>Integrations</h2>
    <div class="integration-row">
      <div class="integration-info">
        <div class="integration-icon">📺</div>
        <div>
          <div style="font-weight:600;">YouTube</div>
          <div style="font-size:0.85rem; color:var(--text-muted);">Upload directly to channel</div>
        </div>
      </div>
      <button class="btn btn-success btn-sm">Connected</button>
    </div>
    <div class="integration-row">
      <div class="integration-info">
        <div class="integration-icon">📦</div>
        <div>
          <div style="font-weight:600;">Dropbox</div>
          <div style="font-size:0.85rem; color:var(--text-muted);">Auto-save exports</div>
        </div>
      </div>
      <button class="btn btn-primary btn-sm">Connect</button>
    </div>
    <div class="integration-row">
      <div class="integration-info">
        <div class="integration-icon">🎬</div>
        <div>
          <div style="font-weight:600;">Frame.io</div>
          <div style="font-size:0.85rem; color:var(--text-muted);">Send for client review</div>
        </div>
      </div>
      <button class="btn btn-primary btn-sm">Connect</button>
    </div>
  </div>
  
  <!-- Shortcuts -->
  <div class="settings-section">
    <h2>Keyboard Shortcuts</h2>
    <div class="shortcut-row">
      <span>Play / Pause</span>
      <span class="shortcut-key">Space</span>
    </div>
    <div class="shortcut-row">
      <span>Blackout</span>
      <span class="shortcut-key">B</span>
    </div>
    <div class="shortcut-row">
      <span>Freeze</span>
      <span class="shortcut-key">F</span>
    </div>
    <div class="shortcut-row">
      <span>Scene 1</span>
      <span class="shortcut-key">1</span>
    </div>
    <div class="shortcut-row">
      <span>Scene 2</span>
      <span class="shortcut-key">2</span>
    </div>
  </div>
  
  <!-- Danger Zone -->
  <div class="danger-zone">
    <h2>Data & Privacy</h2>
    <p style="color:var(--text-secondary); margin-bottom:16px;">
      Export all your projects, renders, and settings. Or permanently delete your account.
    </p>
    <div style="display:flex; gap:12px;">
      <button class="btn btn-secondary">Export All Data</button>
      <button class="btn btn-danger">Delete Account</button>
    </div>
  </div>
  
</div>

</body>
</html>
```

## Acceptance Criteria
- [ ] Defaults apply to every new project
- [ ] YouTube upload succeeds with valid OAuth
- [ ] Keyboard shortcuts editable and persistent
- [ ] Data export includes all projects, renders, settings

## Dependencies
- OAuth 2.0 providers
- ZIP generation for data export
```
