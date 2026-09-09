# PRD: Photo Studio — "Still Motion"

## Overview
A dedicated page for photographers and visual artists to transform static images into living, audio-reactive motion pieces. Not video editing — photo animation. Breathing life into stills through subtle motion, reactive overlays, and cinematic transitions.

## Context
Photographers have thousands of images sitting in galleries. They need: portfolio pieces that stand out, social content from existing work, client deliverables with motion, and album art that moves. This page treats the photograph as sacred — the image is never obscured, only enhanced with living atmosphere.

## Philosophy
- **The photograph is the hero**
- **Motion serves the image, never competes**
- **Stillness is a choice, not a default**
- **Every photo has a pulse waiting to be found**

---

## 1. Personas

| Persona | Goal | Pain Point |
|---------|------|-----------|
| **Wedding photographer** | Turn ceremony photos into living album | Clients want "video" but only booked photo |
| **Music photographer** | Animate concert shots for artist promo | Static images get lost on social feeds |
| **Fine art photographer** | Create immersive gallery installations | Need subtle motion, not video |
| **Portrait photographer** | Deliver "moving portraits" to clients | Competitors offer video, they don't |
| **Real estate photographer** | Make property photos breathe | Static rooms feel dead online |
| **Social media creator** | Batch-animate photos for content calendar | Manually making reels from photos is tedious |
| **Album artist** | Create moving cover art | Need loopable, platform-native formats |

---

## 2. Core Value Propositions

1. **"Your best photo, now breathing"**
2. **"Animate a thousand images in one session"**
3. **"The photo stays perfect — the atmosphere moves"**
4. **"From gallery wall to Instagram story, one export"**

---

## 3. Page Structure

```
┌─────────────────────────────────────────┐
│  HEADER: 📸 Photo Studio · SWR          │
│  [Import] [Gallery] [Batch] [Export]     │
├─────────────────────────────────────────┤
│                                         │
│  ┌─────────────┐  ┌─────────────────┐  │
│  │  GALLERY    │  │   PREVIEW STAGE  │  │
│  │  PANEL      │  │                  │  │
│  │             │  │  ┌───────────┐  │  │
│  │ ┌─────┐     │  │  │           │  │  │
│  │ │ IMG │     │  │  │  PHOTO    │  │  │
│  │ └─────┘     │  │  │  +        │  │  │
│  │ ┌─────┐     │  │  │  MOTION   │  │  │
│  │ │ IMG │     │  │  │  LAYERS   │  │  │
│  │ └─────┘     │  │  │           │  │  │
│  │ ┌─────┐     │  │  └───────────┘  │  │
│  │ │ IMG │     │  │                  │  │
│  │ └─────┘     │  │  [Play] [Loop]   │  │
│  │             │  │  [Duration: 5s]   │  │
│  └─────────────┘  └─────────────────┘  │
│                                         │
│  ┌─────────────┐  ┌─────────────────┐  │
│  │ MOTION PANEL │  │ ATMOSPHERE PANEL │  │
│  │              │  │                  │  │
│  │ Parallax     │  │ Light leak       │  │
│  │ [Depth map]  │  │ [Color shift]    │  │
│  │              │  │                  │  │
│  │ Ken Burns    │  │ Grain            │  │
│  │ [Start] [End]│  │ [Amount]         │  │
│  │              │  │                  │  │
│  │ Loop         │  │ Dust               │  │
│  │ [Seamless]   │  │ [Particles]        │  │
│  │              │  │                  │  │
│  │ Morph        │  │ Vignette pulse     │  │
│  │ [Subtle]     │  │ [Breathe]          │  │
│  └─────────────┘  └─────────────────┘  │
│                                         │
│  EXPORT: Format | Duration | Quality    │
│  [MP4 loop] [GIF] [Cinemagraph] [Live]  │
│                                         │
└─────────────────────────────────────────┘
```

---

## 4. Detailed Specifications

### 4.1 Gallery Panel — Image Management

```html
<div class="gallery-panel">
  <div class="gallery-header">
    <h3>📸 Photos</h3>
    <button class="btn btn-sm" onclick="importPhotos()">+ Import</button>
  </div>
  
  <div class="import-zone" id="photoImport">
    <div class="import-icon">🖼</div>
    <div>Drop photos or click to browse</div>
    <div class="import-hint">JPG, PNG, RAW, TIFF — up to 50 files</div>
  </div>
  
  <div class="photo-grid" id="photoGrid">
    <!-- Thumbnails generated from loaded images -->
  </div>
  
  <div class="batch-bar">
    <label class="batch-toggle">
      <input type="checkbox" id="batchMode">
      <span>Batch mode: apply to all selected</span>
    </label>
    <span class="batch-count" id="batchCount">0 selected</span>
  </div>
</div>
```

```css
.gallery-panel {
  width: 260px;
  background: #11141a;
  display: flex;
  flex-direction: column;
  border-right: 1px solid rgba(255,255,255,0.06);
}

.gallery-header {
  padding: 16px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-bottom: 1px solid rgba(255,255,255,0.06);
}

.gallery-header h3 {
  font-size: 0.8rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: #a0a8b8;
}

.import-zone {
  margin: 16px;
  padding: 32px 16px;
  border: 2px dashed rgba(255,255,255,0.1);
  border-radius: 12px;
  text-align: center;
  cursor: pointer;
  transition: all 200ms ease;
}

.import-zone:hover, .import-zone.drag-over {
  border-color: #d4a574;
  background: rgba(212,165,116,0.05);
}

.import-icon {
  font-size: 2.5rem;
  margin-bottom: 12px;
  opacity: 0.7;
}

.import-hint {
  font-size: 0.75rem;
  color: #6b7280;
  margin-top: 6px;
}

.photo-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 8px;
  padding: 0 16px 16px;
  overflow-y: auto;
  flex: 1;
}

.photo-thumb {
  aspect-ratio: 1;
  border-radius: 8px;
  overflow: hidden;
  cursor: pointer;
  position: relative;
  border: 2px solid transparent;
  transition: all 150ms ease;
}

.photo-thumb:hover {
  transform: scale(1.03);
}

.photo-thumb.active {
  border-color: #d4a574;
  box-shadow: 0 0 0 3px rgba(212,165,116,0.2);
}

.photo-thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.photo-thumb .thumb-badge {
  position: absolute;
  top: 4px;
  right: 4px;
  padding: 2px 6px;
  background: rgba(0,0,0,0.7);
  border-radius: 10px;
  font-size: 0.65rem;
  color: #f0f2f5;
}

.photo-thumb .select-check {
  position: absolute;
  top: 4px;
  left: 4px;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  border: 2px solid rgba(255,255,255,0.5);
  background: rgba(0,0,0,0.3);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.7rem;
}

.photo-thumb .select-check.checked {
  background: #d4a574;
  border-color: #d4a574;
}

.batch-bar {
  padding: 12px 16px;
  border-top: 1px solid rgba(255,255,255,0.06);
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.batch-toggle {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  font-size: 0.85rem;
  color: #a0a8b8;
}

.batch-toggle input {
  display: none;
}

.batch-toggle span::before {
  content: '☐ ';
  opacity: 0.5;
}

.batch-toggle:has(input:checked) span::before {
  content: '☑ ';
  opacity: 1;
  color: #d4a574;
}

.batch-count {
  font-size: 0.8rem;
  color: #6b7280;
  font-family: 'SF Mono', monospace;
}
```

---

### 4.2 Preview Stage — Photo + Motion

```html
<div class="preview-stage">
  <div class="stage-frame">
    <!-- Base photo -->
    <img id="basePhoto" src="" alt="Selected photo">
    
    <!-- Motion canvas (parallax, particles, etc.) -->
    <canvas id="motionCanvas" width="1080" height="1350"></canvas>
    
    <!-- Atmosphere canvas (light leak, grain, dust) -->
    <canvas id="atmoCanvas" width="1080" height="1350"></canvas>
    
    <!-- Vignette overlay -->
    <div class="vignette-layer" id="vignetteLayer"></div>
    
    <!-- Export frame guides -->
    <div class="export-guides" id="exportGuides">
      <div class="guide-9-16"></div>
      <div class="guide-4-5"></div>
      <div class="guide-1-1"></div>
    </div>
  </div>
  
  <!-- Playback controls -->
  <div class="stage-controls">
    <button class="play-btn" id="playBtn" onclick="togglePlayback()">▶</button>
    
    <div class="duration-control">
      <label>Duration</label>
      <div class="duration-options">
        <button class="dur-btn" data-dur="3">3s</button>
        <button class="dur-btn active" data-dur="5">5s</button>
        <button class="dur-btn" data-dur="10">10s</button>
        <button class="dur-btn" data-dur="15">15s</button>
        <button class="dur-btn" data-dur="loop">∞ loop</button>
      </div>
    </div>
    
    <div class="loop-toggle">
      <label class="toggle">
        <input type="checkbox" id="seamlessLoop" checked>
        <span class="toggle-switch"></span>
        <span>Seamless loop</span>
      </label>
    </div>
  </div>
</div>
```

```css
.preview-stage {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 24px;
  gap: 20px;
  background: #0a0d12;
}

.stage-frame {
  position: relative;
  width: 480px;
  height: 600px; /* 4:5 default, adjustable */
  background: #000;
  border-radius: 8px;
  overflow: hidden;
  box-shadow: 0 24px 80px rgba(0,0,0,0.5);
}

#basePhoto {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

#motionCanvas,
#atmoCanvas {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
}

#motionCanvas {
  mix-blend-mode: normal;
}

#atmoCanvas {
  mix-blend-mode: screen;
  opacity: 0.4;
}

.vignette-layer {
  position: absolute;
  inset: 0;
  pointer-events: none;
  box-shadow: inset 0 0 150px rgba(0,0,0,0.4);
  transition: box-shadow 2s ease;
}

.export-guides {
  position: absolute;
  inset: 0;
  pointer-events: none;
  opacity: 0;
  transition: opacity 200ms ease;
}

.export-guides.active {
  opacity: 1;
}

.guide-9-16,
.guide-4-5,
.guide-1-1 {
  position: absolute;
  border: 1px dashed rgba(255,255,255,0.3);
  display: none;
}

.guide-9-16 {
  left: 15%;
  right: 15%;
  top: 0;
  bottom: 0;
}

.guide-4-5 {
  left: 5%;
  right: 5%;
  top: 5%;
  bottom: 5%;
}

.guide-1-1 {
  top: 10%;
  left: 10%;
  right: 10%;
  bottom: 10%;
}

.stage-controls {
  display: flex;
  align-items: center;
  gap: 24px;
}

.play-btn {
  width: 56px;
  height: 56px;
  border-radius: 50%;
  background: linear-gradient(135deg, #d4a574, #b8956a);
  border: none;
  color: #0a0d12;
  font-size: 1.3rem;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: transform 150ms ease;
}

.play-btn:hover {
  transform: scale(1.05);
}

.duration-control {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.duration-control label {
  font-size: 0.7rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: #a0a8b8;
}

.duration-options {
  display: flex;
  gap: 6px;
}

.dur-btn {
  padding: 8px 14px;
  background: #1a1e28;
  border: 1px solid rgba(255,255,255,0.1);
  border-radius: 8px;
  color: #a0a8b8;
  cursor: pointer;
  font-size: 0.85rem;
  transition: all 150ms ease;
}

.dur-btn:hover {
  color: #f0f2f5;
}

.dur-btn.active {
  background: linear-gradient(135deg, #d4a574, #b8956a);
  color: #0a0d12;
  border-color: transparent;
  font-weight: 600;
}

.loop-toggle {
  padding-left: 16px;
  border-left: 1px solid rgba(255,255,255,0.1);
}
```

---

### 4.3 Motion Panel — Photo Animation

```html
<div class="panel motion-panel">
  <div class="panel-header">
    <h3>✨ Motion</h3>
  </div>
  
  <div class="panel-body">
    <!-- Parallax -->
    <div class="motion-section">
      <h4>Parallax Depth</h4>
      <div class="depth-upload" id="depthUpload">
        <span>Upload depth map or auto-generate</span>
        <button class="btn btn-sm" onclick="generateDepth()">Auto</button>
      </div>
      
      <div class="depth-controls hidden" id="depthControls">
        <label>Intensity</label>
        <input type="range" min="0" max="100" value="40" id="parallaxIntensity">
        
        <label>Direction</label>
        <div class="direction-pad">
          <button onclick="setParallaxDir('up')">↑</button>
          <button onclick="setParallaxDir('left')">←</button>
          <button onclick="setParallaxDir('right')">→</button>
          <button onclick="setParallaxDir('down')">↓</button>
        </div>
      </div>
    </div>
    
    <!-- Ken Burns -->
    <div class="motion-section">
      <h4>Ken Burns</h4>
      <div class="kb-controls">
        <div class="kb-frame start">
          <label>Start</label>
          <div class="crop-box" id="kbStart"></div>
        </div>
        <div class="kb-frame end">
          <label>End</label>
          <div class="crop-box" id="kbEnd"></div>
        </div>
      </div>
      <label class="kb-ease">
        Easing
        <select id="kbEase">
          <option>Linear</option>
          <option selected>Ease In Out</option>
          <option>Ease Out</option>
        </select>
      </label>
    </div>
    
    <!-- Loop -->
    <div class="motion-section">
      <h4>Loop</h4>
      <div class="loop-types">
        <button class="loop-btn active" data-loop="yoyo">↔ Yoyo</button>
        <button class="loop-btn" data-loop="reset">↻ Reset</button>
        <button class="loop-btn" data-loop="hold">⏸ Hold</button>
      </div>
    </div>
    
    <!-- Morph -->
    <div class="motion-section">
      <h4>Morph</h4>
      <div class="morph-subtle">
        <label class="toggle">
          <input type="checkbox" id="breathingCheck" checked>
          <span class="toggle-switch"></span>
          <span>Breathing (subtle zoom)</span>
        </label>
        <label class="toggle">
          <input type="checkbox" id="swayCheck">
          <span class="toggle-switch"></span>
          <span>Sway (gentle rotation)</span>
        </label>
      </div>
    </div>
  </div>
</div>
```

```css
.motion-panel {
  width: 260px;
  background: #11141a;
  border-right: 1px solid rgba(255,255,255,0.06);
}

.motion-section {
  margin-bottom: 24px;
}

.motion-section h4 {
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: #a0a8b8;
  margin-bottom: 12px;
  display: flex;
  align-items: center;
  gap: 8px;
}

.depth-upload {
  padding: 16px;
  background: #1a1e28;
  border-radius: 10px;
  border: 2px dashed rgba(255,255,255,0.1);
  text-align: center;
  font-size: 0.85rem;
  color: #a0a8b8;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.depth-controls {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-top: 12px;
}

.depth-controls label {
  font-size: 0.75rem;
  color: #a0a8b8;
}

.direction-pad {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 4px;
  width: 80px;
}

.direction-pad button {
  padding: 8px;
  background: #1a1e28;
  border: 1px solid rgba(255,255,255,0.1);
  border-radius: 6px;
  color: #a0a8b8;
  cursor: pointer;
  font-size: 0.9rem;
}

.direction-pad button:nth-child(1) { grid-column: 2; }
.direction-pad button:nth-child(2) { grid-column: 1; grid-row: 2; }
.direction-pad button:nth-child(3) { grid-column: 3; grid-row: 2; }
.direction-pad button:nth-child(4) { grid-column: 2; grid-row: 3; }

.kb-controls {
  display: flex;
  gap: 12px;
  margin-bottom: 12px;
}

.kb-frame {
  flex: 1;
}

.kb-frame label {
  font-size: 0.75rem;
  color: #a0a8b8;
  margin-bottom: 6px;
  display: block;
}

.crop-box {
  aspect-ratio: 4/3;
  background: #1a1e28;
  border-radius: 8px;
  border: 2px dashed rgba(255,255,255,0.2);
  position: relative;
  overflow: hidden;
}

.crop-box img {
  position: absolute;
  opacity: 0.5;
}

.crop-box .crop-region {
  position: absolute;
  border: 2px solid #d4a574;
  background: rgba(212,165,116,0.1);
  cursor: move;
}

.loop-types {
  display: flex;
  gap: 6px;
}

.loop-btn {
  flex: 1;
  padding: 10px;
  background: #1a1e28;
  border: 1px solid rgba(255,255,255,0.1);
  border-radius: 8px;
  color: #a0a8b8;
  cursor: pointer;
  font-size: 0.8rem;
  transition: all 150ms ease;
}

.loop-btn.active {
  background: linear-gradient(135deg, #d4a574, #b8956a);
  color: #0a0d12;
  border-color: transparent;
  font-weight: 600;
}

.morph-subtle {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
```

---

### 4.4 Atmosphere Panel — Texture & Light

```html
<div class="panel atmo-panel">
  <div class="panel-header">
    <h3>🌫 Atmosphere</h3>
  </div>
  
  <div class="panel-body">
    <!-- Light leak -->
    <div class="atmo-section">
      <h4>Light Leak</h4>
      <div class="light-presets">
        <button class="light-btn" data-light="warm">🟠 Warm</button>
        <button class="light-btn" data-light="cool">🔵 Cool</button>
        <button class="light-btn" data-light="film">🟡 Film</button>
        <button class="light-btn" data-light="none" onclick="clearLight()">✕</button>
      </div>
      <input type="range" min="0" max="100" value="25" id="lightIntensity">
    </div>
    
    <!-- Grain -->
    <div class="atmo-section">
      <h4>Grain</h4>
      <div class="grain-types">
        <button class="grain-btn active" data-grain="fine">Fine</button>
        <button class="grain-btn" data-grain="medium">Medium</button>
        <button class="grain-btn" data-grain="coarse">Coarse</button>
      </div>
      <input type="range" min="0" max="100" value="20" id="grainAmount">
    </div>
    
    <!-- Dust -->
    <div class="atmo-section">
      <h4>Dust & Particles</h4>
      <label class="toggle">
        <input type="checkbox" id="dustCheck">
        <span class="toggle-switch"></span>
        <span>Floating dust</span>
      </label>
      <label class="toggle">
        <input type="checkbox" id="bokehCheck">
        <span class="toggle-switch"></span>
        <span>Bokeh orbs</span>
      </label>
    </div>
    
    <!-- Vignette -->
    <div class="atmo-section">
      <h4>Vignette</h4>
      <div class="vignette-styles">
        <button class="vig-btn" data-vig="none">None</button>
        <button class="vig-btn active" data-vig="soft">Soft</button>
        <button class="vig-btn" data-vig="hard">Hard</button>
        <button class="vig-btn" data-vig="color">Color</button>
      </div>
      <label class="vig-pulse">
        <input type="checkbox" id="vigPulse" checked>
        <span>Breathing vignette</span>
      </label>
    </div>
    
    <!-- Color shift -->
    <div class="atmo-section">
      <h4>Color Shift</h4>
      <div class="shift-controls">
        <div class="shift-hue">
          <label>Hue drift</label>
          <input type="range" min="-30" max="30" value="0" id="hueDrift">
        </div>
        <div class="shift-sat">
          <label>Saturation pulse</label>
          <input type="range" min="-20" max="20" value="0" id="satPulse">
        </div>
      </div>
    </div>
  </div>
</div>
```

```css
.atmo-panel {
  width: 260px;
  background: #11141a;
  border-left: 1px solid rgba(255,255,255,0.06);
}

.atmo-section {
  margin-bottom: 24px;
}

.atmo-section h4 {
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: #a0a8b8;
  margin-bottom: 12px;
}

.light-presets {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 6px;
  margin-bottom: 10px;
}

.light-btn {
  padding: 10px 4px;
  background: #1a1e28;
  border: 1px solid rgba(255,255,255,0.1);
  border-radius: 8px;
  color: #a0a8b8;
  cursor: pointer;
  font-size: 0.75rem;
  transition: all 150ms ease;
}

.light-btn:hover {
  color: #f0f2f5;
}

.grain-types {
  display: flex;
  gap: 6px;
  margin-bottom: 10px;
}

.grain-btn {
  flex: 1;
  padding: 8px;
  background: #1a1e28;
  border: 1px solid rgba(255,255,255,0.1);
  border-radius: 8px;
  color: #a0a8b8;
  cursor: pointer;
  font-size: 0.8rem;
}

.grain-btn.active {
  background: linear-gradient(135deg, #d4a574, #b8956a);
  color: #0a0d12;
  border-color: transparent;
  font-weight: 600;
}

.vignette-styles {
  display: flex;
  gap: 4px;
  margin-bottom: 10px;
}

.vig-btn {
  flex: 1;
  padding: 8px 4px;
  background: #1a1e28;
  border: 1px solid rgba(255,255,255,0.1);
  border-radius: 6px;
  color: #a0a8b8;
  cursor: pointer;
  font-size: 0.75rem;
}

.vig-btn.active {
  background: #d4a574;
  color: #0a0d12;
  font-weight: 600;
}

.vig-pulse {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.85rem;
  color: #a0a8b8;
  margin-top: 8px;
}

.shift-controls {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.shift-hue,
.shift-sat {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.shift-hue label,
.shift-sat label {
  font-size: 0.75rem;
  color: #a0a8b8;
}
```

---

### 4.5 Export Panel — Format Options

```html
<div class="export-panel">
  <h3>⬇ Export</h3>
  
  <div class="export-formats">
    <button class="format-card active" data-format="mp4-loop">
      <span class="format-icon">🎬</span>
      <span class="format-name">MP4 Loop</span>
      <span class="format-desc">Seamless, social-ready</span>
    </button>
    <button class="format-card" data-format="gif">
      <span class="format-icon">🎞</span>
      <span class="format-name">GIF</span>
      <span class="format-desc">Short, shareable</span>
    </button>
    <button class="format-card" data-format="cinemagraph">
      <span class="format-icon">✨</span>
      <span class="format-name">Cinemagraph</span>
      <span class="format-desc">Mostly still, some motion</span>
    </button>
    <button class="format-card" data-format="live-photo">
      <span class="format-icon">📱</span>
      <span class="format-name">Live Photo</span>
      <span class="format-desc">iOS native format</span>
    </button>
  </div>
  
  <div class="export-settings">
    <div class="setting-row">
      <label>Resolution</label>
      <select id="exportRes">
        <option>Source (max)</option>
        <option>4K</option>
        <option selected>1080p</option>
        <option>720p</option>
      </select>
    </div>
    
    <div class="setting-row">
      <label>Frame Rate</label>
      <select id="exportFps">
        <option>60 fps</option>
        <option selected>30 fps</option>
        <option>24 fps (cinematic)</option>
      </select>
    </div>
    
    <div class="setting-row">
      <label>Quality</label>
      <input type="range" min="50" max="100" value="90" id="exportQuality">
    </div>
  </div>
  
  <div class="batch-export" id="batchExport">
    <span class="batch-label">Batch: <strong id="batchNum">12</strong> photos</span>
    <button class="btn btn-export" onclick="exportBatch()">
      Export All
      <span class="est-size">~340 MB</span>
    </button>
  </div>
</div>
```

```css
.export-panel {
  padding: 20px;
  background: #11141a;
  border-top: 1px solid rgba(255,255,255,0.06);
}

.export-panel h3 {
  font-size: 0.8rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: #a0a8b8;
  margin-bottom: 16px;
}

.export-formats {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 10px;
  margin-bottom: 20px;
}

.format-card {
  padding: 16px;
  background: #1a1e28;
  border: 2px solid transparent;
  border-radius: 12px;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 6px;
  transition: all 150ms ease;
}

.format-card:hover {
  background: #222838;
}

.format-card.active {
  border-color: #d4a574;
  background: rgba(212,165,116,0.05);
}

.format-icon {
  font-size: 1.5rem;
}

.format-name {
  font-weight: 700;
  font-size: 0.9rem;
}

.format-desc {
  font-size: 0.75rem;
  color: #6b7280;
}

.export-settings {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-bottom: 20px;
}

.setting-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.setting-row label {
  font-size: 0.85rem;
  color: #a0a8b8;
}

.setting-row select,
.setting-row input {
  width: 120px;
  padding: 8px;
  background: #0a0d12;
  border: 1px solid rgba(255,255,255,0.1);
  border-radius: 8px;
  color: #f0f2f5;
  font-size: 0.85rem;
}

.batch-export {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px;
  background: #1a1e28;
  border-radius: 12px;
}

.batch-label {
  font-size: 0.9rem;
  color: #a0a8b8;
}

.batch-label strong {
  color: #d4a574;
}

.btn-export {
  padding: 12px 24px;
  background: linear-gradient(135deg, #d4a574, #b8956a);
  color: #0a0d12;
  border: none;
  border-radius: 10px;
  font-weight: 700;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
}

.est-size {
  font-size: 0.75rem;
  opacity: 0.7;
  font-weight: 400;
}
```

---

## 5. Photo Animation Engine

```javascript
class PhotoMotionEngine {
  constructor(photoCanvas, atmoCanvas, baseImage) {
    this.photoCanvas = photoCanvas;
    this.atmoCanvas = atmoCanvas;
    this.photoCtx = photoCanvas.getContext('2d');
    this.atmoCtx = atmoCanvas.getContext('2d');
    this.baseImage = baseImage;
    
    this.time = 0;
    this.duration = 5;
    this.loopMode = 'yoyo';
    this.isPlaying = false;
    
    // Motion params
    this.parallax = { intensity: 0.4, direction: 'up', depthMap: null };
    this.kenBurns = { start: {x:0.1, y:0.1, w:0.8, h:0.8}, end: {x:0.2, y:0.15, w:0.6, h:0.6} };
    this.breathing = { enabled: true, amount: 0.02, speed: 0.5 };
    this.sway = { enabled: false, amount: 0.5, speed: 0.3 };
    
    // Atmosphere
    this.lightLeak = { type: 'warm', intensity: 0.25 };
    this.grain = { type: 'fine', amount: 0.2 };
    this.dust = { enabled: false, count: 30 };
    this.bokeh = { enabled: false, count: 10 };
    this.vignette = { style: 'soft', pulse: true, intensity: 0.3 };
    this.colorShift = { hue: 0, sat: 0, speed: 0.1 };
    
    // Pre-render grain texture
    this.grainCanvas = this.generateGrain();
  }
  
  // ========== DEPTH & PARALLAX ==========
  
  async generateDepthMap() {
    // Use ML model or simple edge detection fallback
    // For now: simple luminance-based fake depth
    const w = this.baseImage.width;
    const h = this.baseImage.height;
    const depthCanvas = document.createElement('canvas');
    depthCanvas.width = w;
    depthCanvas.height = h;
    const ctx = depthCanvas.getContext('2d');
    
    ctx.drawImage(this.baseImage, 0, 0);
    const imageData = ctx.getImageData(0, 0, w, h);
    const data = imageData.data;
    
    // Luminance as depth proxy (bright = closer)
    for (let i = 0; i < data.length; i += 4) {
      const lum = 0.299 * data[i] + 0.587 * data[i+1] + 0.114 * data[i+2];
      data[i] = lum;     // R
      data[i+1] = lum;   // G
      data[i+2] = lum;   // B
    }
    
    ctx.putImageData(imageData, 0, 0);
    this.parallax.depthMap = depthCanvas;
  }
  
  renderParallax(ctx, w, h, progress) {
    if (!this.parallax.depthMap) return;
    
    const dir = this.parallax.direction;
    const intensity = this.parallax.intensity;
    const offset = Math.sin(progress * Math.PI * 2) * intensity * 50;
    
    let ox = 0, oy = 0;
    if (dir === 'up') oy = -offset;
    if (dir === 'down') oy = offset;
    if (dir === 'left') ox = -offset;
    if (dir === 'right') ox = offset;
    
    // Multi-layer parallax based on depth
    ctx.drawImage(this.baseImage, ox * 0.5, oy * 0.5, w, h);
    
    // Depth-displaced layer
    if (this.parallax.depthMap) {
      ctx.globalAlpha = 0.5;
      ctx.drawImage(this.parallax.depthMap, ox, oy, w, h);
      ctx.globalAlpha = 1;
    }
  }
  
  // ========== KEN BURNS ==========
  
  renderKenBurns(ctx, w, h, progress) {
    const ease = this.easeInOutCubic(progress);
    const s = this.kenBurns.start;
    const e = this.kenBurns.end;
    
    const x = s.x + (e.x - s.x) * ease;
    const y = s.y + (e.y - s.y) * ease;
    const cw = s.w + (e.w - s.w) * ease;
    const ch = s.h + (e.h - s.h) * ease;
    
    ctx.drawImage(
      this.baseImage,
      x * this.baseImage.width,
      y * this.baseImage.height,
      cw * this.baseImage.width,
      ch * this.baseImage.height,
      0, 0, w, h
    );
  }
  
  easeInOutCubic(t) {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  }
  
  // ========== BREATHING & SWAY ==========
  
  renderBreathing(ctx, w, h, time) {
    if (!this.breathing.enabled) return;
    
    const scale = 1 + Math.sin(time * this.breathing.speed) * this.breathing.amount;
    const dx = (w - w * scale) / 2;
    const dy = (h - h * scale) / 2;
    
    ctx.save();
    ctx.translate(w/2, h/2);
    ctx.scale(scale, scale);
    ctx.translate(-w/2, -h/2);
    ctx.drawImage(this.baseImage, 0, 0, w, h);
    ctx.restore();
  }
  
  renderSway(ctx, w, h, time) {
    if (!this.sway.enabled) return;
    
    const angle = Math.sin(time * this.sway.speed) * this.sway.amount * (Math.PI / 180);
    
    ctx.save();
    ctx.translate(w/2, h/2);
    ctx.rotate(angle);
    ctx.translate(-w/2, -h/2);
    ctx.drawImage(this.baseImage, 0, 0, w, h);
    ctx.restore();
  }
  
  // ========== ATMOSPHERE ==========
  
  generateGrain() {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 512;
    const ctx = canvas.getContext('2d');
    
    const imageData = ctx.createImageData(512, 512);
    const data = imageData.data;
    
    for (let i = 0; i < data.length; i += 4) {
      const v = Math.random() * 255;
      data[i] = v;
      data[i+1] = v;
      data[i+2] = v;
      data[i+3] = 255;
    }
    
    ctx.putImageData(imageData, 0, 0);
    return canvas;
  }
  
  renderGrain(ctx, w, h) {
    if (this.grain.amount <= 0) return;
    
    ctx.save();
    ctx.globalAlpha = this.grain.amount;
    
    // Random offset each frame for animated grain
    const ox = Math.random() * 100;
    const oy = Math.random() * 100;
    
    ctx.fillStyle = ctx.createPattern(this.grainCanvas, 'repeat');
    ctx.translate(ox, oy);
    ctx.fillRect(-ox, -oy, w, h);
    
    ctx.restore();
  }
  
  renderLightLeak(ctx, w, h, time) {
    if (!this.lightLeak.type || this.lightLeak.type === 'none') return;
    
    const colors = {
      warm: '255, 160, 60',
      cool: '100, 150, 255',
      film: '255, 220, 100'
    };
    
    const rgb = colors[this.lightLeak.type] || colors.warm;
    const intensity = this.lightLeak.intensity;
    
    // Corner leak
    const gradient = ctx.createRadialGradient(w * 0.8, 0, 0, w * 0.8, 0, w * 0.6);
    gradient.addColorStop(0, `rgba(${rgb}, ${intensity * 0.5})`);
    gradient.addColorStop(0.5, `rgba(${rgb}, ${intensity * 0.2})`);
    gradient.addColorStop(1, 'transparent');
    
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, w, h);
    
    // Flicker
    const flicker = Math.sin(time * 3) * 0.1 + 0.9;
    ctx.fillStyle = `rgba(${rgb}, ${intensity * 0.05 * flicker})`;
    ctx.fillRect(0, 0, w, h);
  }
  
  renderDust(ctx, w, h, time) {
    if (!this.dust.enabled) return;
    
    ctx.save();
    ctx.globalAlpha = 0.6;
    
    for (let i = 0; i < this.dust.count; i++) {
      const x = (Math.sin(time * 0.1 + i * 100) * 0.5 + 0.5) * w;
      const y = ((time * 20 + i * 50) % (h + 40)) - 20;
      const size = 1 + Math.sin(i) * 1.5;
      
      ctx.beginPath();
      ctx.arc(x, y, size, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,255,255,0.4)';
      ctx.fill();
    }
    
    ctx.restore();
  }
  
  renderBokeh(ctx, w, h, time) {
    if (!this.bokeh.enabled) return;
    
    ctx.save();
    
    for (let i = 0; i < this.bokeh.count; i++) {
      const x = (Math.sin(time * 0.05 + i * 1.5) * 0.5 + 0.5) * w;
      const y = (Math.cos(time * 0.03 + i * 2) * 0.5 + 0.5) * h;
      const size = 20 + Math.sin(i) * 15;
      const blur = size * 0.5;
      
      const gradient = ctx.createRadialGradient(x, y, 0, x, y, size);
      gradient.addColorStop(0, `rgba(255,220,180,0.15)`);
      gradient.addColorStop(1, 'transparent');
      
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(x, y, size, 0, Math.PI * 2);
      ctx.fill();
    }
    
    ctx.restore();
  }
  
  renderVignette(ctx, w, h, time) {
    if (this.vignette.style === 'none') return;
    
    const intensity = this.vignette.intensity;
    const pulse = this.vignette.pulse ? 1 + Math.sin(time * 0.5) * 0.1 : 1;
    
    const gradient = ctx.createRadialGradient(w/2, h/2, h * 0.3, w/2, h/2, h * 0.8);
    gradient.addColorStop(0, 'transparent');
    
    if (this.vignette.style === 'soft') {
      gradient.addColorStop(0.7, `rgba(0,0,0,${intensity * 0.2 * pulse})`);
      gradient.addColorStop(1, `rgba(0,0,0,${intensity * pulse})`);
    } else if (this.vignette.style === 'hard') {
      gradient.addColorStop(0.5, 'transparent');
      gradient.addColorStop(1, `rgba(0,0,0,${intensity * pulse})`);
    } else if (this.vignette.style === 'color') {
      gradient.addColorStop(0.7, `rgba(40,20,10,${intensity * 0.3 * pulse})`);
      gradient.addColorStop(1, `rgba(40,20,10,${intensity * pulse})`);
    }
    
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, w, h);
  }
  
  renderColorShift(ctx, w, h, time) {
    if (this.colorShift.hue === 0 && this.colorShift.sat === 0) return;
    
    const hueShift = Math.sin(time * this.colorShift.speed) * this.colorShift.hue;
    const satShift = Math.sin(time * this.colorShift.speed * 1.3) * this.colorShift.sat;
    
    ctx.save();
    ctx.globalCompositeOperation = 'hue';
    ctx.fillStyle = `hsla(${hueShift}, ${100 + satShift}%, 50%, 0.1)`;
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
  }
  
  // ========== MAIN RENDER ==========
  
  render() {
    if (!this.isPlaying) return;
    
    const w = this.photoCanvas.width;
    const h = this.photoCanvas.height;
    const now = performance.now() / 1000;
    this.time += 1/60;
    
    // Loop progress 0-1
    let progress = (this.time % this.duration) / this.duration;
    
    if (this.loopMode === 'yoyo') {
      progress = progress < 0.5 ? progress * 2 : 2 - progress * 2;
    } else if (this.loopMode === 'hold') {
      progress = Math.min(progress, 1);
    }
    
    // Photo layer
    this.photoCtx.clearRect(0, 0, w, h);
    
    // Base image with Ken Burns
    this.renderKenBurns(this.photoCtx, w, h, progress);
    
    // Breathing overlay
    this.renderBreathing(this.photoCtx, w, h, now);
    
    // Sway
    this.renderSway(this.photoCtx, w, h, now);
    
    // Parallax
    this.renderParallax(this.photoCtx, w, h, progress);
    
    // Atmosphere layer
    this.atmoCtx.clearRect(0, 0, w, h);
    
    this.renderLightLeak(this.atmoCtx, w, h, now);
    this.renderGrain(this.atmoCtx, w, h);
    this.renderDust(this.atmoCtx, w, h, now);
    this.renderBokeh(this.atmoCtx, w, h, now);
    this.renderVignette(this.atmoCtx, w, h, now);
    this.renderColorShift(this.atmoCtx, w, h, now);
    
    requestAnimationFrame(() => this.render());
  }
  
  play() {
    this.isPlaying = true;
    this.time = 0;
    this.render();
  }
  
  pause() {
    this.isPlaying = false;
  }
  
  export() {
    // Return canvas.captureStream() for recording
    return this.photoCanvas.captureStream(30);
  }
}
```

---

## 6. Complete Page HTML

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Photo Studio — SWR Still Motion</title>
  <style>
    /* [All CSS from sections 4.1-4.5 combined] */
    /* Base */
    :root {
      --bg-base: #0a0d12;
      --bg-elevated: #11141a;
      --bg-surface: #1a1e28;
      --bg-hover: #222838;
      --text-primary: #f0f2f5;
      --text-secondary: #a0a8b8;
      --text-muted: #6b7280;
      --accent: #d4a574;
      --radius: 10px;
    }
    
    * { margin: 0; padding: 0; box-sizing: border-box; }
    
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: var(--bg-base);
      color: var(--text-primary);
      height: 100vh;
      overflow: hidden;
    }
    
    /* Layout */
    .photo-app {
      display: grid;
      grid-template-columns: 260px 1fr 260px;
      grid-template-rows: auto 1fr auto;
      grid-template-areas:
        "header header header"
        "gallery stage look"
        "gallery stage export";
      height: 100vh;
      gap: 1px;
      background: rgba(255,255,255,0.06);
    }
    
    /* Header */
    .photo-header {
      grid-area: header;
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 12px 20px;
      background: var(--bg-elevated);
    }
    
    .photo-brand {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    
    .photo-logo {
      width: 36px;
      height: 36px;
      background: linear-gradient(135deg, #d4a574, #b8956a);
      border-radius: 8px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 1.2rem;
    }
    
    .photo-brand h1 {
      font-size: 1rem;
      font-weight: 800;
    }
    
    .photo-brand span {
      font-size: 0.65rem;
      color: var(--text-muted);
    }
    
    .header-actions {
      display: flex;
      gap: 8px;
    }
    
    .btn {
      padding: 8px 16px;
      border-radius: var(--radius);
      border: none;
      font-size: 0.85rem;
      font-weight: 600;
      cursor: pointer;
      transition: all 150ms ease;
      font-family: inherit;
    }
    
    .btn-sm { padding: 6px 12px; font-size: 0.8rem; }
    .btn-ghost { background: transparent; color: var(--text-secondary); border: 1px solid rgba(255,255,255,0.1); }
    .btn-ghost:hover { background: var(--bg-hover); color: var(--text-primary); }
    
    /* [All remaining CSS from sections above] */
    /* ... */
    
    .hidden { display: none !important; }
  </style>
</head>
<body>

<div class="photo-app">
  
  <!-- HEADER -->
  <header class="photo-header">
    <div class="photo-brand">
      <div class="photo-logo">📸</div>
      <div>
        <h1>Photo Studio</h1>
        <span>Still Motion</span>
      </div>
    </div>
    <div class="header-actions">
      <button class="btn btn-ghost btn-sm" onclick="importPhotos()">+ Import</button>
      <button class="btn btn-ghost btn-sm" onclick="showGallery()">Gallery</button>
      <button class="btn btn-ghost btn-sm" onclick="exportCurrent()">Export</button>
    </div>
  </header>
  
  <!-- GALLERY PANEL -->
  <div class="panel gallery-panel">
    <div class="gallery-header">
      <h3>📸 Photos</h3>
      <button class="btn btn-sm btn-ghost" onclick="importPhotos()">+</button>
    </div>
    
    <div class="import-zone" id="photoImport">
      <div class="import-icon">🖼</div>
      <div>Drop photos or click to browse</div>
      <div class="import-hint">JPG, PNG, RAW, TIFF — up to 50 files</div>
    </div>
    
    <div class="photo-grid hidden" id="photoGrid"></div>
    
    <div class="batch-bar hidden" id="batchBar">
      <label class="batch-toggle">
        <input type="checkbox" id="batchMode">
        <span>Batch mode</span>
      </label>
      <span class="batch-count" id="batchCount">0 selected</span>
    </div>
  </div>
  
  <!-- PREVIEW STAGE -->
  <div class="preview-stage">
    <div class="stage-frame">
      <img id="basePhoto" src="" alt="Photo" style="display:none;">
      <canvas id="motionCanvas" width="1080" height="1350"></canvas>
      <canvas id="atmoCanvas" width="1080" height="1350"></canvas>
      <div class="vignette-layer" id="vignetteLayer"></div>
    </div>
    
    <div class="stage-controls">
      <button class="play-btn" id="playBtn" onclick="togglePlayback()">▶</button>
      
      <div class="duration-control">
        <label>Duration</label>
        <div class="duration-options">
          <button class="dur-btn" data-dur="3" onclick="setDuration(3)">3s</button>
          <button class="dur-btn active" data-dur="5" onclick="setDuration(5)">5s</button>
          <button class="dur-btn" data-dur="10" onclick="setDuration(10)">10s</button>
          <button class="dur-btn" data-dur="15" onclick="setDuration(15)">15s</button>
          <button class="dur-btn" data-dur="loop" onclick="setDuration('loop')">∞</button>
        </div>
      </div>
      
      <div class="loop-toggle">
        <label class="toggle">
          <input type="checkbox" id="seamlessLoop" checked>
          <span class="toggle-switch"></span>
          <span>Seamless</span>
        </label>
      </div>
    </div>
  </div>
  
  <!-- LOOK PANEL (placeholder for motion + atmosphere) -->
  <div style="grid-area: look; display:flex; flex-direction:column; gap:1px;">
    <!-- MOTION -->
    <div class="panel motion-panel">
      <div class="panel-header"><h3>✨ Motion</h3></div>
      <div class="panel-body">
        <!-- [Motion controls from 4.3] -->
      </div>
    </div>
    <!-- ATMOSPHERE -->
    <div class="panel atmo-panel">
      <div class="panel-header"><h3>🌫 Atmosphere</h3></div>
      <div class="panel-body">
        <!-- [Atmosphere controls from 4.4] -->
      </div>
    </div>
  </div>
  
  <!-- EXPORT PANEL -->
  <div class="panel export-panel">
    <!-- [Export from 4.5] -->
  </div>
  
</div>

<script>
// ======== STATE ========
let engine = null;
let currentPhoto = null;
let photos = [];
let selectedPhotos = new Set();

// ======== IMPORT ========
function importPhotos() {
  const input = document.createElement('input');
  input.type = 'file';
  input.multiple = true;
  input.accept = 'image/*';
  input.onchange = (e) => handleFiles(e.target.files);
  input.click();
}

function handleFiles(files) {
  if (!files.length) return;
  
  document.getElementById('photoImport').classList.add('hidden');
  document.getElementById('photoGrid').classList.remove('hidden');
  document.getElementById('batchBar').classList.remove('hidden');
  
  Array.from(files).forEach(file => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        photos.push({ file, img, id: Date.now() + Math.random() });
        renderGallery();
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

function renderGallery() {
  const grid = document.getElementById('photoGrid');
  grid.innerHTML = photos.map(p => `
    <div class="photo-thumb ${selectedPhotos.has(p.id) ? 'active' : ''}" 
         onclick="selectPhoto(${p.id})"
         data-id="${p.id}">
      <img src="${p.img.src}">
      <div class="select-check ${selectedPhotos.has(p.id) ? 'checked' : ''}" 
           onclick="event.stopPropagation(); toggleSelect(${p.id})">✓</div>
    </div>
  `).join('');
}

function selectPhoto(id) {
  const photo = photos.find(p => p.id === id);
  if (!photo) return;
  
  currentPhoto = photo;
  
  // Show in stage
  const baseImg = document.getElementById('basePhoto');
  baseImg.src = photo.img.src;
  baseImg.style.display = 'block';
  
  // Init engine
  const motionCanvas = document.getElementById('motionCanvas');
  const atmoCanvas = document.getElementById('atmoCanvas');
  
  motionCanvas.width = photo.img.naturalWidth;
  motionCanvas.height = photo.img.naturalHeight;
  atmoCanvas.width = photo.img.naturalWidth;
  atmoCanvas.height = photo.img.naturalHeight;
  
  engine = new PhotoMotionEngine(motionCanvas, atmoCanvas, photo.img);
  
  // Auto-generate depth
  engine.generateDepthMap();
  
  // Start preview
  engine.play();
  document.getElementById('playBtn').textContent = '⏸';
}

function toggleSelect(id) {
  if (selectedPhotos.has(id)) {
    selectedPhotos.delete(id);
  } else {
    selectedPhotos.add(id);
  }
  document.getElementById('batchCount').textContent = selectedPhotos.size + ' selected';
  renderGallery();
}

// ======== PLAYBACK ========
function togglePlayback() {
  if (!engine) return;
  
  const btn = document.getElementById('playBtn');
  if (engine.isPlaying) {
    engine.pause();
    btn.textContent = '▶';
  } else {
    engine.play();
    btn.textContent = '⏸';
  }
}

function setDuration(sec) {
  if (!engine) return;
  engine.duration = sec === 'loop' ? 5 : sec;
  engine.loopMode = sec === 'loop' ? 'yoyo' : document.getElementById('seamlessLoop').checked ? 'yoyo' : 'reset';
  
  document.querySelectorAll('.dur-btn').forEach(b => b.classList.remove('active'));
  event.target.classList.add('active');
}

// ======== EXPORT ========
function exportCurrent() {
  if (!engine) return;
  console.log('Exporting...');
  // Use engine.export() for stream, record with MediaRecorder
}

// ======== DRAG AND DROP ========
const importZone = document.getElementById('photoImport');
importZone.addEventListener('dragover', e => { e.preventDefault(); importZone.classList.add('drag-over'); });
importZone.addEventListener('dragleave', () => importZone.classList.remove('drag-over'));
importZone.addEventListener('drop', e => {
  e.preventDefault();
  importZone.classList.remove('drag-over');
  handleFiles(e.dataTransfer.files);
});

// ======== INIT ========
console.log('Photo Studio ready');
</script>

</body>
</html>
```

---

## 7. Hermes Prompt

```
You are building "Photo Studio" — an image-first creative engine for 
Sainted Word Records, a browser-native visual platform.

PAGE: Photo Studio — "Still Motion"

CONTEXT:
- Target: Photographers, visual artists, social creators with image libraries
- Core concept: Animate static photos into living motion pieces
- The photograph is sacred — never obscured, only enhanced with atmosphere
- Output: seamless loops, cinemagraphs, live photos, social-native formats

REQUIREMENTS:
1. Gallery panel: drag-drop import, thumbnail grid, batch selection
2. Preview stage: photo display with motion canvas + atmosphere canvas layered
3. Motion panel: parallax (depth map), Ken Burns (start/end crop), 
   loop modes (yoyo/reset/hold), morph (breathing, sway)
4. Atmosphere panel: light leak (warm/cool/film), grain (fine/medium/coarse), 
   dust particles, bokeh orbs, vignette (soft/hard/color + pulse), 
   color shift (hue drift, saturation pulse)
5. Export panel: MP4 loop, GIF, cinemagraph, Live Photo formats; 
   resolution, frame rate, quality; batch export

MOTION ENGINE:
- PhotoMotionEngine class handles all rendering
- Ken Burns: ease-in-out crop animation between start/end rectangles
- Parallax: luminance-based depth map with directional displacement
- Breathing: subtle sine-wave zoom
- Sway: gentle rotation oscillation
- All loop seamlessly with configurable duration

ATMOSPHERE ENGINE:
- Light leak: corner gradient with flicker
- Grain: procedurally generated, animated offset each frame
- Dust: floating particles with drift
- Bokeh: large soft orbs with slow movement
- Vignette: radial gradient with breathing pulse
- Color shift: subtle hue/saturation oscillation

DESIGN:
- Warm, film-photography aesthetic (amber, cream, darkroom tones)
- Typography: classic serif for headers, clean sans for UI
- Respect for the image: minimal chrome, maximum photo visibility
- Dark theme to make photos pop

TECHNICAL:
- Canvas 2D for all rendering (no WebGL needed for this subtlety)
- Image loading via FileReader + Image object
- Export via canvas.captureStream() + MediaRecorder
- Batch processing with Web Workers for performance

OUTPUT: Single HTML file with inline CSS and JS. Self-contained.
```

---

*End of Photo Studio PRD. Image-first creative engine for bringing still photographs to life.*