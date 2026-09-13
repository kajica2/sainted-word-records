# PAGE-005: LIVE-CONTROL-ROOM.md

# PRD: Live Event Control Room

## Overview
Full VJ control for performances, weddings, corporate events.

## Context
The Perform mode in /app is a start, but a dedicated control room page enables professional live visual performance.

## Layout
```
┌─────────────────────────────────────────┐
│  SET LIST: Song 1 → Song 2 → Song 3...  │
│  [Import from Spotify] [Manual Add]     │
├─────────────────────────────────────────┤
│  ┌─────────┐ ┌─────────┐ ┌─────────┐   │
│  │ OUTPUT 1│ │ OUTPUT 2│ │ OUTPUT 3│   │
│  │ Main    │ │ Side    │ │ LED Wall│   │
│  │ 16:9    │ │ 16:9    │ │ 3:1     │   │
│  └─────────┘ └─────────┘ └─────────┘   │
├─────────────────────────────────────────┤
│  CUE LIST: Intro → Build → Drop → Break │
│  [Scene A] [Scene B] [Scene C] [Scene D]│
├─────────────────────────────────────────┤
│  CONTROLS: Tap BPM | Black | Freeze |   │
│            Strobe | Record Set          │
└─────────────────────────────────────────┘
```

## Features

### Set List Import
- Import from Spotify playlist, Apple Music, or manual entry
- Each song: title, artist, duration, BPM (if known)

### Cue List
Per song:
- Intro → Scene A (calm)
- Build → Scene B (energy rising)
- Drop → Scene C (peak)
- Break → Scene D (minimal)
- Outro → Scene E (fade)

### Multi-Output
- Main screen (16:9 or custom)
- Side screens (optional)
- LED wall (custom aspect, e.g., 3:1, 4:1)

## UI Specification

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Live — SWR Control Room</title>
  <link rel="stylesheet" href="/shared/styles/tokens.css">
  <link rel="stylesheet" href="/shared/styles/components.css">
  <style>
    .control-room {
      display: grid;
      grid-template-rows: auto auto 1fr auto;
      height: 100vh;
      gap: 1px;
      background: var(--border-subtle);
    }
    .setlist-bar {
      background: var(--bg-elevated);
      padding: 12px 24px;
      display: flex;
      align-items: center;
      gap: 16px;
      overflow-x: auto;
    }
    .setlist-song {
      padding: 8px 16px;
      background: var(--bg-surface);
      border-radius: var(--radius-md);
      font-size: 0.85rem;
      white-space: nowrap;
      cursor: pointer;
      border: 2px solid transparent;
    }
    .setlist-song.active {
      border-color: var(--accent-primary);
    }
    .setlist-song .bpm {
      font-size: 0.75rem;
      color: var(--text-muted);
    }
    .outputs-row {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 1px;
      background: var(--border-subtle);
    }
    .output-window {
      background: var(--bg-base);
      aspect-ratio: 16/9;
      display: flex;
      align-items: center;
      justify-content: center;
      color: var(--text-muted);
      position: relative;
    }
    .output-window.led-wall {
      aspect-ratio: 3/1;
    }
    .output-label {
      position: absolute;
      top: 8px;
      left: 8px;
      padding: 4px 8px;
      background: rgba(0,0,0,0.6);
      border-radius: 4px;
      font-size: 0.75rem;
      color: var(--text-secondary);
    }
    .cue-section {
      background: var(--bg-elevated);
      padding: 16px 24px;
    }
    .cue-list {
      display: flex;
      gap: 8px;
      margin-top: 12px;
    }
    .cue {
      padding: 12px 20px;
      background: var(--bg-surface);
      border-radius: var(--radius-md);
      text-align: center;
      cursor: pointer;
      min-width: 100px;
    }
    .cue .phase {
      font-size: 0.75rem;
      color: var(--text-muted);
      text-transform: uppercase;
    }
    .cue .scene {
      font-weight: 700;
      margin-top: 4px;
    }
    .controls-bar {
      background: var(--bg-elevated);
      padding: 16px 24px;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .tap-button {
      width: 120px;
      height: 120px;
      border-radius: 50%;
      background: var(--bg-surface);
      border: 4px solid var(--border-medium);
      color: var(--text-primary);
      font-size: 1.2rem;
      font-weight: 700;
      cursor: pointer;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
    }
    .tap-button:active {
      background: var(--accent-primary);
      border-color: var(--accent-primary);
    }
    .emergency-row {
      display: flex;
      gap: 12px;
    }
    .record-btn {
      padding: 12px 24px;
      background: var(--accent-danger);
      color: white;
      border: none;
      border-radius: var(--radius-md);
      font-weight: 700;
      cursor: pointer;
    }
  </style>
</head>
<body>

<div class="control-room">
  
  <!-- Set List -->
  <div class="setlist-bar">
    <button class="btn btn-sm btn-secondary">Import Playlist</button>
    <div class="setlist-song active">
      <div>Summer Vibes</div>
      <div class="bpm">124 BPM</div>
    </div>
    <div class="setlist-song">
      <div>Midnight Drive</div>
      <div class="bpm">128 BPM</div>
    </div>
    <div class="setlist-song">
      <div>First Dance</div>
      <div class="bpm">90 BPM</div>
    </div>
    <button class="btn btn-sm btn-secondary">+ Add</button>
  </div>
  
  <!-- Outputs -->
  <div class="outputs-row">
    <div class="output-window">
      <span class="output-label">Main · 16:9</span>
      ▶ Output 1
    </div>
    <div class="output-window">
      <span class="output-label">Side · 16:9</span>
      ▶ Output 2
    </div>
    <div class="output-window led-wall">
      <span class="output-label">LED Wall · 3:1</span>
      ▶ Output 3
    </div>
  </div>
  
  <!-- Cues -->
  <div class="cue-section">
    <h3 style="font-size:0.75rem; text-transform:uppercase; color:var(--text-secondary);">
      Cues: Summer Vibes
    </h3>
    <div class="cue-list">
      <div class="cue">
        <div class="phase">Intro</div>
        <div class="scene">Scene A</div>
      </div>
      <div class="cue">
        <div class="phase">Build</div>
        <div class="scene">Scene B</div>
      </div>
      <div class="cue">
        <div class="phase">Drop</div>
        <div class="scene">Scene C</div>
      </div>
      <div class="cue">
        <div class="phase">Break</div>
        <div class="scene">Scene D</div>
      </div>
      <div class="cue">
        <div class="phase">Outro</div>
        <div class="scene">Scene E</div>
      </div>
    </div>
  </div>
  
  <!-- Controls -->
  <div class="controls-bar">
    <button class="tap-button" id="tapBpm">
      <span>TAP</span>
      <span style="font-size:0.8rem; color:var(--text-muted);">124 BPM</span>
    </button>
    
    <div class="emergency-row">
      <button class="emergency-btn black">⬛ BLACK</button>
      <button class="emergency-btn freeze">⏸ FREEZE</button>
      <button class="emergency-btn strobe">⚡ STROBE</button>
    </div>
    
    <button class="record-btn">● Record Set</button>
  </div>
  
</div>

<script>
let tapTimes = [];
document.getElementById('tapBpm').addEventListener('click', () => {
  tapTimes.push(performance.now());
  if (tapTimes.length >= 4) {
    const intervals = tapTimes.slice(1).map((t, i) => t - tapTimes[i]);
    const avg = intervals.reduce((a, b) => a + b) / intervals.length;
    const bpm = Math.round(60000 / avg);
    document.querySelector('#tapBpm span:last-child').textContent = bpm + ' BPM';
    tapTimes = [];
  }
});
</script>

</body>
</html>
```

## Acceptance Criteria
- [ ] Set list of 20 songs loads in 5 seconds
- [ ] Cue transitions execute within 1 frame (33ms at 30fps)
- [ ] 3 simultaneous outputs at 1080p each
- [ ] Set recording exports as single MP4 with audio

## Dependencies
- PRD-008 (live/VJ mode) for scene system
- Web MIDI API for controller support
```
