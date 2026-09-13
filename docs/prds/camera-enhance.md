# PRD: Camera Enhance — Clean Video Processing for Camera-Shot Footage

## Overview
A dedicated page for enhancing, stabilizing, and stylizing real-world video footage shot on phones, DSLRs, or action cameras. No holographic effects, no synthetic 3D — just professional-grade video processing that makes camera footage look cinematic, consistent, and platform-ready.

## Context
Most SWR users will shoot video on their phones. They need: stabilization, color correction, noise reduction, smooth slow-mo, cinematic crop, and clean audio-reactive overlays that complement (not overpower) the real footage. This page treats the camera as the primary source, not an optional add-on.

## Philosophy
- **Enhance reality, don't replace it**
- **Fix phone footage problems**: shake, noise, flat color, bad audio
- **Match platform look**: TikTok vertical, YouTube cinematic, Instagram warm
- **One-take friendly**: minimal controls, maximum output quality

---

## 1. Personas

| Persona | Goal | Pain Point |
|---------|------|-----------|
| **Phone filmmaker** | Make iPhone footage look cinematic | Shaky, noisy, flat color |
| **Vlogger** | Consistent look across episodes | Different lighting every shoot |
| **Music video director** | Stylize performance footage | Needs to match song energy |
| **Event shooter** | Stabilize handheld ceremony footage | Too shaky to use |
| **Real estate creator** | Smooth walkthrough videos | Bouncy footage, bad exposure |
| **Fitness instructor** | Clean workout videos with reactive metrics | Raw footage looks amateur |

---

## 2. Core Value Propositions

1. **"Fix your phone footage in 30 seconds"**
2. **"Match any look — film, vintage, modern, platform-native"**
3. **"Stabilize, denoise, color-correct, export — all in browser"**
4. **"Reactive graphics that respect your real world"**

---

## 3. Page Structure

```
┌─────────────────────────────────────────┐
│  HEADER: 📷 Camera Enhance · SWR          │
├─────────────────────────────────────────┤
│                                         │
│  ┌─────────────┐  ┌─────────────────┐  │
│  │ SOURCE PANEL │  │   PREVIEW STAGE  │  │
│  │              │  │                  │  │
│  │ [Upload      │  │  ┌───────────┐  │  │
│  │  video]      │  │  │           │  │  │
│  │              │  │  │  CAMERA   │  │  │
│  │ ──────────── │  │  │  FOOTAGE  │  │  │
│  │ Source info   │  │  │  +        │  │  │
│  │ Resolution    │  │  │  CLEAN    │  │  │
│  │ FPS           │  │  │  OVERLAY  │  │  │
│  │ Duration      │  │  │           │  │  │
│  │              │  │  └───────────┘  │  │
│  │ ──────────── │  │                  │  │
│  │ Fix controls  │  │  [Play/Pause]   │  │
│  │ [Stabilize]   │  │  [Scrubber]      │  │
│  │ [Denoise]     │  │                  │  │
│  │ [Smooth]      │  │                  │  │
│  │              │  └─────────────────┘  │
│  └─────────────┘                       │
│                                         │
│  ┌─────────────┐  ┌─────────────────┐  │
│  │ LOOK PANEL   │  │ EXPORT PANEL     │  │
│  │              │  │                  │  │
│  │ [Film]       │  │ Format: 9:16     │  │
│  │ [Clean]      │  │ Quality: 4K      │  │
│  │ [Warm]       │  │ ─────────────    │  │
│  │ [Cool]       │  │ Burn-in options: │  │
│  │ [Mono]       │  │ [Logo] [Titles]  │  │
│  │ [Vintage]    │  │ [Subtitles]      │  │
│  │ [Custom]     │  │ ─────────────    │  │
│  │              │  │ [Export Video]   │  │
│  └─────────────┘  └─────────────────┘  │
│                                         │
└─────────────────────────────────────────┘
```

---

## 4. Detailed Specifications

### 4.1 Source Panel — Upload & Analysis

```html
<div class="panel source-panel">
  <div class="panel-header">
    <span class="panel-title">📷 Source</span>
  </div>
  
  <div class="panel-body">
    <div class="video-dropzone" id="videoDrop">
      <div class="drop-icon">📹</div>
      <div class="drop-text">Drop video or click to browse</div>
      <div class="drop-hint">MP4, MOV, MKV — up to 4GB</div>
    </div>
    
    <div class="source-info hidden" id="sourceInfo">
      <div class="info-row">
        <span class="info-label">Resolution</span>
        <span class="info-value" id="srcResolution">3840 × 2160</span>
      </div>
      <div class="info-row">
        <span class="info-label">Frame Rate</span>
        <span class="info-value" id="srcFps">60 fps</span>
      </div>
      <div class="info-row">
        <span class="info-label">Duration</span>
        <span class="info-value" id="srcDuration">0:42</span>
      </div>
      <div class="info-row">
        <span class="info-label">Codec</span>
        <span class="info-value" id="srcCodec">H.264</span>
      </div>
      <div class="info-row">
        <span class="info-label">Bitrate</span>
        <span class="info-value" id="srcBitrate">50 Mbps</span>
      </div>
      
      <div class="source-thumbnail">
        <canvas id="srcThumbnail" width="280" height="158"></canvas>
      </div>
    </div>
    
    <div class="fix-section hidden" id="fixSection">
      <h3>Fix</h3>
      
      <label class="toggle-fix">
        <input type="checkbox" id="stabilizeCheck" checked>
        <span class="fix-icon">🎯</span>
        <span class="fix-label">
          <strong>Stabilize</strong>
          <span>Reduce shake & jitter</span>
        </span>
      </label>
      
      <label class="toggle-fix">
        <input type="checkbox" id="denoiseCheck">
        <span class="fix-icon">🧹</span>
        <span class="fix-label">
          <strong>Denoise</strong>
          <span>Clean low-light grain</span>
        </span>
      </label>
      
      <label class="toggle-fix">
        <input type="checkbox" id="smoothCheck">
        <span class="fix-icon">🌊</span>
        <span class="fix-label">
          <strong>Smooth Motion</strong>
          <span>Optical flow interpolation</span>
        </span>
      </label>
      
      <label class="toggle-fix">
        <input type="checkbox" id="exposeCheck" checked>
        <span class="fix-icon">☀️</span>
        <span class="fix-label">
          <strong>Auto Exposure</strong>
          <span>Balance highlights & shadows</span>
        </span>
      </label>
    </div>
  </div>
</div>
```

```css
.source-panel {
  width: 280px;
}

.video-dropzone {
  padding: 32px 20px;
  border: 2px dashed rgba(255,255,255,0.15);
  border-radius: 14px;
  text-align: center;
  cursor: pointer;
  transition: all 200ms ease;
}

.video-dropzone:hover, .video-dropzone.drag-over {
  border-color: #f59e0b;
  background: rgba(245,158,11,0.05);
}

.drop-icon { font-size: 2.5rem; margin-bottom: 12px; }
.drop-text { font-size: 0.9rem; color: #a0a8b8; }
.drop-hint { font-size: 0.75rem; color: #6b7280; margin-top: 6px; }

.source-info {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.info-row {
  display: flex;
  justify-content: space-between;
  padding: 8px 0;
  border-bottom: 1px solid rgba(255,255,255,0.06);
}

.info-label {
  font-size: 0.8rem;
  color: #6b7280;
}

.info-value {
  font-size: 0.8rem;
  color: #f0f2f5;
  font-family: 'SF Mono', monospace;
}

.source-thumbnail {
  margin-top: 12px;
  border-radius: 8px;
  overflow: hidden;
  background: #000;
}

.source-thumbnail canvas {
  width: 100%;
  display: block;
}

.fix-section h3 {
  font-size: 0.7rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: #a0a8b8;
  margin: 20px 0 12px;
}

.toggle-fix {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 12px;
  background: #1a1e28;
  border-radius: 10px;
  margin-bottom: 8px;
  cursor: pointer;
  transition: all 150ms ease;
  border: 2px solid transparent;
}

.toggle-fix:hover {
  background: #222838;
}

.toggle-fix:has(input:checked) {
  border-color: #f59e0b;
}

.toggle-fix input {
  display: none;
}

.fix-icon {
  width: 36px;
  height: 36px;
  border-radius: 8px;
  background: #222838;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1.1rem;
  flex-shrink: 0;
}

.fix-label {
  display: flex;
  flex-direction: column;
}

.fix-label strong {
  font-size: 0.9rem;
  color: #f0f2f5;
}

.fix-label span {
  font-size: 0.8rem;
  color: #6b7280;
  margin-top: 2px;
}
```

---

### 4.2 Preview Stage — Clean Overlay System

```html
<div class="preview-stage">
  <div class="stage-container">
    <!-- Video element (camera footage) -->
    <video id="previewVideo" autoplay loop muted playsinline></video>
    
    <!-- Clean overlay canvas (reactive but subtle) -->
    <canvas id="overlayCanvas" width="1080" height="1920"></canvas>
    
    <!-- Frame guides -->
    <div class="frame-guides" id="frameGuides">
      <div class="guide-line horizontal" style="top:33%"></div>
      <div class="guide-line horizontal" style="top:66%"></div>
      <div class="guide-line vertical" style="left:33%"></div>
      <div class="guide-line vertical" style="left:66%"></div>
      <div class="guide-safe"></div>
    </div>
    
    <!-- Burn-in elements -->
    <div class="burn-in" id="burnInLayer">
      <div class="burn-logo hidden" id="burnLogo">SWR</div>
      <div class="burn-title hidden" id="burnTitle">Morning Walk</div>
      <div class="burn-subtitle hidden" id="burnSubtitle">Tokyo, March 2026</div>
    </div>
  </div>
  
  <!-- Transport -->
  <div class="stage-transport">
    <button class="tr-btn" onclick="seek(-10)">⏮ 10s</button>
    <button class="tr-btn play" id="playBtn" onclick="togglePlay()">▶</button>
    <button class="tr-btn" onclick="seek(10)">10s ⏭</button>
    
    <div class="scrubber" id="scrubber">
      <div class="scrub-progress" id="scrubProgress"></div>
      <div class="scrub-handle" id="scrubHandle"></div>
    </div>
    
    <span class="time-display" id="stageTime">0:00 / 0:42</span>
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
  padding: 20px;
  gap: 16px;
  min-height: 0;
}

.stage-container {
  position: relative;
  width: 340px;
  height: 604px; /* 9:16 from 1080x1920 */
  background: #000;
  border-radius: 16px;
  overflow: hidden;
  box-shadow: 0 20px 60px rgba(0,0,0,0.4);
}

#previewVideo {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

#overlayCanvas {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  mix-blend-mode: screen;
  opacity: 0.6; /* Subtle by default */
}

.frame-guides {
  position: absolute;
  inset: 0;
  pointer-events: none;
  opacity: 0;
  transition: opacity 200ms ease;
}

.frame-guides.active {
  opacity: 1;
}

.guide-line {
  position: absolute;
  background: rgba(255,255,255,0.3);
}

.guide-line.horizontal {
  left: 0;
  right: 0;
  height: 1px;
}

.guide-line.vertical {
  top: 0;
  bottom: 0;
  width: 1px;
}

.guide-safe {
  position: absolute;
  top: 10%;
  left: 10%;
  right: 10%;
  bottom: 10%;
  border: 1px dashed rgba(255,255,255,0.2);
}

.burn-in {
  position: absolute;
  inset: 0;
  pointer-events: none;
}

.burn-logo {
  position: absolute;
  top: 24px;
  left: 24px;
  font-size: 0.75rem;
  font-weight: 700;
  color: rgba(255,255,255,0.7);
  letter-spacing: 0.1em;
}

.burn-title {
  position: absolute;
  bottom: 80px;
  left: 24px;
  right: 24px;
  font-size: 1.4rem;
  font-weight: 700;
  color: white;
  text-shadow: 0 2px 12px rgba(0,0,0,0.5);
  line-height: 1.2;
}

.burn-subtitle {
  position: absolute;
  bottom: 56px;
  left: 24px;
  font-size: 0.85rem;
  color: rgba(255,255,255,0.7);
}

.stage-transport {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  max-width: 340px;
}

.tr-btn {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  border: none;
  background: #1a1e28;
  color: #f0f2f5;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.8rem;
  flex-shrink: 0;
}

.tr-btn.play {
  width: 48px;
  height: 48px;
  background: linear-gradient(135deg, #f59e0b, #ef4444);
  font-size: 1rem;
}

.scrubber {
  flex: 1;
  height: 4px;
  background: #1a1e28;
  border-radius: 2px;
  position: relative;
  cursor: pointer;
}

.scrub-progress {
  height: 100%;
  background: linear-gradient(90deg, #f59e0b, #ef4444);
  border-radius: 2px;
  width: 0%;
}

.scrub-handle {
  position: absolute;
  top: 50%;
  width: 12px;
  height: 12px;
  background: white;
  border-radius: 50%;
  transform: translate(-50%, -50%);
  left: 0%;
  box-shadow: 0 2px 8px rgba(0,0,0,0.3);
}

.time-display {
  font-family: 'SF Mono', monospace;
  font-size: 0.8rem;
  color: #a0a8b8;
  flex-shrink: 0;
}
```

---

### 4.3 Look Panel — Cinematic Color Grading

```html
<div class="panel look-panel">
  <div class="panel-header">
    <span class="panel-title">🎨 Look</span>
  </div>
  
  <div class="panel-body">
    <!-- Preset looks -->
    <div class="look-grid">
      <button class="look-card active" data-look="clean" onclick="selectLook(this, 'clean')">
        <div class="look-preview" style="background: linear-gradient(135deg, #e8e4e0, #d4cfc7);"></div>
        <span class="look-name">Clean</span>
      </button>
      
      <button class="look-card" data-look="film" onclick="selectLook(this, 'film')">
        <div class="look-preview" style="background: linear-gradient(135deg, #c4a77d, #8b7355);"></div>
        <span class="look-name">Film</span>
      </button>
      
      <button class="look-card" data-look="warm" onclick="selectLook(this, 'warm')">
        <div class="look-preview" style="background: linear-gradient(135deg, #f5d0a9, #e8b87d);"></div>
        <span class="look-name">Warm</span>
      </button>
      
      <button class="look-card" data-look="cool" onclick="selectLook(this, 'cool')">
        <div class="look-preview" style="background: linear-gradient(135deg, #a8c8ec, #7da8d1);"></div>
        <span class="look-name">Cool</span>
      </button>
      
      <button class="look-card" data-look="mono" onclick="selectLook(this, 'mono')">
        <div class="look-preview" style="background: linear-gradient(135deg, #a0a0a0, #606060);"></div>
        <span class="look-name">Mono</span>
      </button>
      
      <button class="look-card" data-look="vintage" onclick="selectLook(this, 'vintage')">
        <div class="look-preview" style="background: linear-gradient(135deg, #d4a574, #b8956a);"></div>
        <span class="look-name">Vintage</span>
      </button>
      
      <button class="look-card" data-look="neon" onclick="selectLook(this, 'neon')">
        <div class="look-preview" style="background: linear-gradient(135deg, #6366f1, #ec4899);"></div>
        <span class="look-name">Neon</span>
      </button>
      
      <button class="look-card" data-look="custom" onclick="selectLook(this, 'custom')">
        <div class="look-preview" style="background: linear-gradient(135deg, #22c55e, #3b82f6);"></div>
        <span class="look-name">Custom</span>
      </button>
    </div>
    
    <!-- Custom sliders (shown for Custom) -->
    <div class="custom-looks hidden" id="customLooks">
      <div class="slider-row">
        <label>Exposure</label>
        <input type="range" min="-50" max="50" value="0" oninput="updateParam('exposure', this.value)">
      </div>
      <div class="slider-row">
        <label>Contrast</label>
        <input type="range" min="-50" max="50" value="0" oninput="updateParam('contrast', this.value)">
      </div>
      <div class="slider-row">
        <label>Saturation</label>
        <input type="range" min="-50" max="50" value="0" oninput="updateParam('saturation', this.value)">
      </div>
      <div class="slider-row">
        <label>Highlights</label>
        <input type="range" min="-50" max="50" value="0" oninput="updateParam('highlights', this.value)">
      </div>
      <div class="slider-row">
        <label>Shadows</label>
        <input type="range" min="-50" max="50" value="0" oninput="updateParam('shadows', this.value)">
      </div>
      <div class="slider-row">
        <label>Temperature</label>
        <input type="range" min="-50" max="50" value="0" oninput="updateParam('temperature', this.value)">
      </div>
      <div class="slider-row">
        <label>Tint</label>
        <input type="range" min="-50" max="50" value="0" oninput="updateParam('tint', this.value)">
      </div>
      <div class="slider-row">
        <label>Grain</label>
        <input type="range" min="0" max="100" value="0" oninput="updateParam('grain', this.value)">
      </div>
      <div class="slider-row">
        <label>Vignette</label>
        <input type="range" min="0" max="100" value="0" oninput="updateParam('vignette', this.value)">
      </div>
    </div>
    
    <!-- Overlay intensity -->
    <div class="overlay-control">
      <label>Reactive Overlay</label>
      <div class="range-wrap">
        <input type="range" min="0" max="100" value="30" id="overlayIntensity" oninput="updateOverlay(this.value)">
        <span class="range-value">30</span>
      </div>
      <div class="overlay-modes">
        <button class="ov-mode active" onclick="selectOverlayMode(this, 'subtle')">Subtle</button>
        <button class="ov-mode" onclick="selectOverlayMode(this, 'mood')">Mood</button>
        <button class="ov-mode" onclick="selectOverlayMode(this, 'energy')">Energy</button>
        <button class="ov-mode" onclick="selectOverlayMode(this, 'off')">Off</button>
      </div>
    </div>
  </div>
</div>
```

```css
.look-panel {
  width: 280px;
}

.look-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 10px;
  margin-bottom: 20px;
}

.look-card {
  padding: 10px;
  background: #1a1e28;
  border-radius: 10px;
  border: 2px solid transparent;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 8px;
  transition: all 150ms ease;
}

.look-card:hover {
  background: #222838;
}

.look-card.active {
  border-color: #f59e0b;
}

.look-preview {
  aspect-ratio: 16/10;
  border-radius: 6px;
}

.look-name {
  font-size: 0.8rem;
  font-weight: 600;
  text-align: center;
}

.custom-looks {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-bottom: 20px;
  padding: 16px;
  background: #1a1e28;
  border-radius: 10px;
}

.slider-row {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.slider-row label {
  font-size: 0.75rem;
  color: #a0a8b8;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.slider-row input[type="range"] {
  width: 100%;
  -webkit-appearance: none;
  height: 4px;
  background: #222838;
  border-radius: 2px;
  outline: none;
}

.slider-row input[type="range"]::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 14px;
  height: 14px;
  background: linear-gradient(135deg, #f59e0b, #ef4444);
  border-radius: 50%;
  cursor: pointer;
}

.overlay-control {
  padding: 16px;
  background: #1a1e28;
  border-radius: 10px;
}

.overlay-control > label {
  font-size: 0.75rem;
  color: #a0a8b8;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  display: block;
  margin-bottom: 10px;
}

.overlay-modes {
  display: flex;
  gap: 6px;
  margin-top: 12px;
}

.ov-mode {
  flex: 1;
  padding: 8px;
  background: #0a0d12;
  border: 1px solid rgba(255,255,255,0.1);
  border-radius: 6px;
  color: #a0a8b8;
  cursor: pointer;
  font-size: 0.75rem;
  transition: all 150ms ease;
}

.ov-mode:hover {
  color: #f0f2f5;
}

.ov-mode.active {
  background: linear-gradient(135deg, #f59e0b, #ef4444);
  color: white;
  border-color: transparent;
}
```

---

### 4.4 Export Panel — Platform Output

```html
<div class="panel export-panel">
  <div class="panel-header">
    <span class="panel-title">⬇ Export</span>
  </div>
  
  <div class="panel-body">
    <div class="format-select">
      <label>Format</label>
      <select id="exportFormat" onchange="updateFormat()">
        <option value="9:16">Vertical 9:16 — TikTok/Reels</option>
        <option value="1:1">Square 1:1 — Instagram</option>
        <option value="4:5">Portrait 4:5 — Instagram</option>
        <option value="16:9" selected>Landscape 16:9 — YouTube</option>
        <option value="2.39:1">Cinema 2.39:1</option>
      </select>
    </div>
    
    <div class="quality-select">
      <label>Quality</label>
      <select id="exportQuality">
        <option value="1080">1080p</option>
        <option value="4K" selected>4K (source)</option>
      </select>
    </div>
    
    <div class="burn-options">
      <label>Burn In</label>
      
      <label class="burn-toggle">
        <input type="checkbox" id="burnLogoCheck" onchange="toggleBurn('logo', this.checked)">
        <span class="burn-icon">🏷</span>
        <span>Logo watermark</span>
      </label>
      
      <label class="burn-toggle">
        <input type="checkbox" id="burnTitleCheck" onchange="toggleBurn('title', this.checked)">
        <span class="burn-icon">T</span>
        <span>Title card</span>
      </label>
      
      <label class="burn-toggle">
        <input type="checkbox" id="burnSubtitleCheck" onchange="toggleBurn('subtitle', this.checked)">
        <span class="burn-icon">t</span>
        <span>Subtitle</span>
      </label>
      
      <label class="burn-toggle">
        <input type="checkbox" id="burnDateCheck">
        <span class="burn-icon">📅</span>
        <span>Date stamp</span>
      </label>
      
      <label class="burn-toggle">
        <input type="checkbox" id="burnLocationCheck">
        <span class="burn-icon">📍</span>
        <span>Location</span>
      </label>
    </div>
    
    <div class="audio-options">
      <label>Audio</label>
      <select id="audioOption">
        <option value="original">Original only</option>
        <option value="reactive">Original + reactive music</option>
        <option value="replace">Replace with track</option>
      </select>
    </div>
    
    <button class="btn btn-export" onclick="exportVideo()">
      <span>⬇</span>
      Export Video
    </button>
    
    <div class="export-meta">
      Estimated: 45 seconds · 340 MB
    </div>
  </div>
</div>
```

```css
.export-panel {
  width: 280px;
}

.format-select,
.quality-select,
.audio-options {
  margin-bottom: 16px;
}

.format-select label,
.quality-select label,
.burn-options > label,
.audio-options label {
  display: block;
  font-size: 0.7rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: #a0a8b8;
  margin-bottom: 8px;
}

.format-select select,
.quality-select select,
.audio-options select {
  width: 100%;
  padding: 10px;
  background: #0a0d12;
  border: 1px solid rgba(255,255,255,0.1);
  border-radius: 10px;
  color: #f0f2f5;
  font-size: 0.85rem;
}

.burn-options {
  margin-bottom: 16px;
}

.burn-toggle {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px;
  background: #1a1e28;
  border-radius: 8px;
  margin-bottom: 6px;
  cursor: pointer;
  font-size: 0.85rem;
  color: #a0a8b8;
}

.burn-toggle input {
  display: none;
}

.burn-icon {
  width: 28px;
  height: 28px;
  border-radius: 6px;
  background: #222838;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.9rem;
  flex-shrink: 0;
}

.burn-toggle:has(input:checked) {
  color: #f0f2f5;
}

.burn-toggle:has(input:checked) .burn-icon {
  background: linear-gradient(135deg, #f59e0b, #ef4444);
}

.btn-export {
  width: 100%;
  padding: 14px;
  background: linear-gradient(135deg, #f59e0b, #ef4444);
  color: white;
  border: none;
  border-radius: 10px;
  font-size: 1rem;
  font-weight: 700;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  transition: all 150ms ease;
}

.btn-export:hover {
  transform: translateY(-2px);
  box-shadow: 0 8px 24px rgba(245,158,11,0.3);
}

.export-meta {
  text-align: center;
  font-size: 0.8rem;
  color: #6b7280;
  margin-top: 12px;
}
```

---

### 4.5 Clean Overlay Render System

```javascript
class CleanOverlay {
  constructor(canvas, video) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.video = video;
    this.mode = 'subtle'; // subtle | mood | energy | off
    this.intensity = 0.3;
    this.audioAnalyser = null;
  }
  
  setAudioSource(analyser) {
    this.audioAnalyser = analyser;
  }
  
  setMode(mode) {
    this.mode = mode;
  }
  
  setIntensity(val) {
    this.intensity = val / 100;
  }
  
  render() {
    if (this.mode === 'off') return;
    
    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;
    
    // Clear with transparency
    ctx.clearRect(0, 0, w, h);
    
    // Get audio data if available
    let audioData = null;
    if (this.audioAnalyser) {
      const freq = new Uint8Array(this.audioAnalyser.frequencyBinCount);
      this.audioAnalyser.getByteFrequencyData(freq);
      audioData = {
        bass: this.avg(freq, 0, 10) / 255,
        mid: this.avg(freq, 10, 50) / 255,
        high: this.avg(freq, 50, 100) / 255,
        energy: this.avg(freq, 0, 100) / 255
      };
    }
    
    switch(this.mode) {
      case 'subtle':
        this.renderSubtle(ctx, w, h, audioData);
        break;
      case 'mood':
        this.renderMood(ctx, w, h, audioData);
        break;
      case 'energy':
        this.renderEnergy(ctx, w, h, audioData);
        break;
    }
    
    requestAnimationFrame(() => this.render());
  }
  
  renderSubtle(ctx, w, h, audio) {
    // Very gentle: soft gradient shift, tiny corner accents
    
    const time = performance.now() / 1000;
    const energy = audio ? audio.energy : 0.3;
    
    // Soft vignette pulse
    const vignette = ctx.createRadialGradient(w/2, h/2, h*0.3, w/2, h/2, h*0.8);
    const alpha = 0.05 + energy * 0.1 * this.intensity;
    vignette.addColorStop(0, 'transparent');
    vignette.addColorStop(1, `rgba(0,0,0,${alpha})`);
    
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, w, h);
    
    // Tiny corner accent (top-right)
    const accentSize = 40 + (audio ? audio.bass * 20 : 0);
    const gradient = ctx.createLinearGradient(w - accentSize, 0, w, accentSize);
    gradient.addColorStop(0, 'transparent');
    gradient.addColorStop(1, `rgba(245, 158, 11, ${0.1 * this.intensity})`);
    
    ctx.beginPath();
    ctx.moveTo(w - accentSize, 0);
    ctx.lineTo(w, 0);
    ctx.lineTo(w, accentSize);
    ctx.closePath();
    ctx.fillStyle = gradient;
    ctx.fill();
  }
  
  renderMood(ctx, w, h, audio) {
    // Color wash that matches the look + audio energy
    
    const energy = audio ? audio.energy : 0.3;
    const time = performance.now() / 1000;
    
    // Large soft orbs
    const orbX = w * (0.3 + Math.sin(time * 0.2) * 0.2);
    const orbY = h * (0.4 + Math.cos(time * 0.15) * 0.2);
    const orbSize = 300 + energy * 200;
    
    const orb = ctx.createRadialGradient(orbX, orbY, 0, orbX, orbY, orbSize);
    const hue = 30 + energy * 30; // Warm range
    orb.addColorStop(0, `hsla(${hue}, 70%, 60%, ${0.08 * this.intensity})`);
    orb.addColorStop(1, 'transparent');
    
    ctx.fillStyle = orb;
    ctx.fillRect(0, 0, w, h);
    
    // Bottom glow
    const bottomGlow = ctx.createLinearGradient(0, h * 0.7, 0, h);
    bottomGlow.addColorStop(0, 'transparent');
    bottomGlow.addColorStop(1, `hsla(${hue}, 50%, 40%, ${0.1 * this.intensity})`);
    
    ctx.fillStyle = bottomGlow;
    ctx.fillRect(0, h * 0.7, w, h * 0.3);
  }
  
  renderEnergy(ctx, w, h, audio) {
    // More active: bars, waveforms, but still clean
    
    if (!audio) return;
    
    const barCount = 4;
    const barWidth = w / barCount;
    const maxHeight = h * 0.15;
    
    for (let i = 0; i < barCount; i++) {
      const energy = [audio.bass, audio.mid, audio.high, audio.energy][i];
      const height = energy * maxHeight * this.intensity;
      
      const x = i * barWidth;
      const y = h - height;
      
      const gradient = ctx.createLinearGradient(0, h, 0, y);
      gradient.addColorStop(0, 'rgba(245, 158, 11, 0.3)');
      gradient.addColorStop(1, 'rgba(239, 68, 68, 0.1)');
      
      ctx.fillStyle = gradient;
      ctx.fillRect(x + barWidth * 0.2, y, barWidth * 0.6, height);
    }
    
    // Center cross-hair pulse
    const crossSize = 20 + audio.bass * 30 * this.intensity;
    ctx.strokeStyle = `rgba(255,255,255,${0.05 + audio.energy * 0.1})`;
    ctx.lineWidth = 1;
    
    ctx.beginPath();
    ctx.moveTo(w/2 - crossSize, h/2);
    ctx.lineTo(w/2 + crossSize, h/2);
    ctx.moveTo(w/2, h/2 - crossSize);
    ctx.lineTo(w/2, h/2 + crossSize);
    ctx.stroke();
  }
  
  avg(data, start, end) {
    let sum = 0;
    for (let i = start; i < end; i++) sum += data[i];
    return sum / (end - start);
  }
}
```

---

## 5. Look Preset Definitions

```javascript
const lookPresets = {
  clean: {
    brightness: 0,
    contrast: 0,
    saturation: 0,
    highlights: 0,
    shadows: 0,
    temperature: 0,
    tint: 0,
    grain: 0,
    vignette: 0,
    description: 'Neutral, faithful to source'
  },
  
  film: {
    brightness: -5,
    contrast: 15,
    saturation: -10,
    highlights: -20,
    shadows: 15,
    temperature: 5,
    tint: 0,
    grain: 25,
    vignette: 30,
    description: 'Kodak Portra-inspired warmth'
  },
  
  warm: {
    brightness: 5,
    contrast: 5,
    saturation: 10,
    highlights: 10,
    shadows: 10,
    temperature: 25,
    tint: 5,
    grain: 0,
    vignette: 15,
    description: 'Golden hour, inviting'
  },
  
  cool: {
    brightness: 0,
    contrast: 10,
    saturation: -5,
    highlights: 15,
    shadows: -10,
    temperature: -20,
    tint: -5,
    grain: 0,
    vignette: 10,
    description: 'Crisp, modern, editorial'
  },
  
  mono: {
    brightness: 0,
    contrast: 20,
    saturation: -100,
    highlights: 10,
    shadows: 20,
    temperature: 0,
    tint: 0,
    grain: 35,
    vignette: 40,
    description: 'High contrast black & white'
  },
  
  vintage: {
    brightness: -10,
    contrast: -5,
    saturation: -20,
    highlights: -15,
    shadows: 20,
    temperature: 30,
    tint: 10,
    grain: 45,
    vignette: 50,
    description: 'Faded, nostalgic, lo-fi'
  },
  
  neon: {
    brightness: -5,
    contrast: 25,
    saturation: 20,
    highlights: -10,
    shadows: 25,
    temperature: -10,
    tint: -15,
    grain: 15,
    vignette: 35,
    description: 'Cyberpunk, night city'
  },
  
  custom: {
    brightness: 0,
    contrast: 0,
    saturation: 0,
    highlights: 0,
    shadows: 0,
    temperature: 0,
    tint: 0,
    grain: 0,
    vignette: 0,
    description: 'Your own look'
  }
};
```

---

## 6. Complete Page HTML

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Camera Enhance — SWR</title>
  <style>
    /* [All CSS from sections above combined] */
    :root {
      --bg-base: #0a0d12;
      --bg-elevated: #11141a;
      --bg-surface: #1a1e28;
      --bg-hover: #222838;
      --text-primary: #f0f2f5;
      --text-secondary: #a0a8b8;
      --text-muted: #6b7280;
      --accent: #f59e0b;
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
    
    .enhance-app {
      display: grid;
      grid-template-columns: 280px 1fr 280px;
      grid-template-rows: auto 1fr auto;
      grid-template-areas:
        "header header header"
        "source stage look"
        "source stage export";
      height: 100vh;
      gap: 1px;
      background: rgba(255,255,255,0.06);
    }
    
    .enhance-header {
      grid-area: header;
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 12px 20px;
      background: var(--bg-elevated);
    }
    
    .enhance-brand {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    
    .enhance-logo {
      width: 36px;
      height: 36px;
      background: linear-gradient(135deg, #f59e0b, #ef4444);
      border-radius: 8px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 1.2rem;
    }
    
    .enhance-brand h1 {
      font-size: 1rem;
      font-weight: 800;
    }
    
    .enhance-brand span {
      font-size: 0.65rem;
      color: var(--text-muted);
    }
    
    .panel {
      background: var(--bg-elevated);
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }
    
    .source-panel { grid-area: source; }
    .look-panel { grid-area: look; }
    .export-panel { grid-area: export; }
    
    .panel-header {
      padding: 14px 20px;
      border-bottom: 1px solid rgba(255,255,255,0.06);
      flex-shrink: 0;
    }
    
    .panel-title {
      font-size: 0.7rem;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      font-weight: 700;
      color: var(--text-secondary);
    }
    
    .panel-body {
      padding: 20px;
      overflow-y: auto;
      flex: 1;
    }
    
    /* [Rest of CSS from all sections above] */
    /* ... (truncated for brevity, use full CSS from sections 4.1-4.4) ... */
    
    .preview-stage {
      grid-area: stage;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 20px;
      gap: 16px;
    }
    
    .stage-container {
      position: relative;
      width: 340px;
      height: 604px;
      background: #000;
      border-radius: 16px;
      overflow: hidden;
      box-shadow: 0 20px 60px rgba(0,0,0,0.4);
    }
    
    #previewVideo {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      object-fit: cover;
    }
    
    #overlayCanvas {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      pointer-events: none;
      mix-blend-mode: screen;
      opacity: 0.6;
    }
    
    .hidden { display: none !important; }
  </style>
</head>
<body>

<div class="enhance-app">
  
  <!-- HEADER -->
  <header class="enhance-header">
    <div class="enhance-brand">
      <div class="enhance-logo">📷</div>
      <div>
        <h1>Camera Enhance</h1>
        <span>Clean video processing</span>
      </div>
    </div>
  </header>
  
  <!-- SOURCE PANEL -->
  <div class="panel source-panel">
    <div class="panel-header">
      <span class="panel-title">📷 Source</span>
    </div>
    <div class="panel-body">
      <div class="video-dropzone" id="videoDrop">
        <div class="drop-icon">📹</div>
        <div class="drop-text">Drop video or click to browse</div>
        <div class="drop-hint">MP4, MOV, MKV — up to 4GB</div>
      </div>
      
      <div class="source-info hidden" id="sourceInfo">
        <div class="info-row">
          <span class="info-label">Resolution</span>
          <span class="info-value" id="srcResolution">--</span>
        </div>
        <div class="info-row">
          <span class="info-label">Frame Rate</span>
          <span class="info-value" id="srcFps">--</span>
        </div>
        <div class="info-row">
          <span class="info-label">Duration</span>
          <span class="info-value" id="srcDuration">--</span>
        </div>
        <div class="info-row">
          <span class="info-label">Codec</span>
          <span class="info-value" id="srcCodec">--</span>
        </div>
      </div>
      
      <div class="fix-section hidden" id="fixSection">
        <h3>Fix</h3>
        <label class="toggle-fix">
          <input type="checkbox" id="stabilizeCheck" checked>
          <span class="fix-icon">🎯</span>
          <span class="fix-label"><strong>Stabilize</strong><span>Reduce shake</span></span>
        </label>
        <label class="toggle-fix">
          <input type="checkbox" id="denoiseCheck">
          <span class="fix-icon">🧹</span>
          <span class="fix-label"><strong>Denoise</strong><span>Clean grain</span></span>
        </label>
        <label class="toggle-fix">
          <input type="checkbox" id="smoothCheck">
          <span class="fix-icon">🌊</span>
          <span class="fix-label"><strong>Smooth</strong><span>Motion interpolation</span></span>
        </label>
      </div>
    </div>
  </div>
  
  <!-- PREVIEW STAGE -->
  <div class="preview-stage">
    <div class="stage-container">
      <video id="previewVideo" autoplay loop muted playsinline></video>
      <canvas id="overlayCanvas" width="1080" height="1920"></canvas>
      
      <div class="burn-in" id="burnInLayer">
        <div class="burn-logo hidden" id="burnLogo">SWR</div>
        <div class="burn-title hidden" id="burnTitle"></div>
        <div class="burn-subtitle hidden" id="burnSubtitle"></div>
      </div>
    </div>
    
    <div class="stage-transport">
      <button class="tr-btn" onclick="seek(-10)">⏮</button>
      <button class="tr-btn play" id="playBtn" onclick="togglePlay()">▶</button>
      <button class="tr-btn" onclick="seek(10)">⏭</button>
      <div class="scrubber" id="scrubber"><div class="scrub-progress"></div></div>
      <span class="time-display">0:00 / 0:00</span>
    </div>
  </div>
  
  <!-- LOOK PANEL -->
  <div class="panel look-panel">
    <div class="panel-header">
      <span class="panel-title">🎨 Look</span>
    </div>
    <div class="panel-body">
      <div class="look-grid">
        <button class="look-card active" onclick="selectLook(this, 'clean')">
          <div class="look-preview" style="background:linear-gradient(135deg,#e8e4e0,#d4cfc7)"></div>
          <span class="look-name">Clean</span>
        </button>
        <button class="look-card" onclick="selectLook(this, 'film')">
          <div class="look-preview" style="background:linear-gradient(135deg,#c4a77d,#8b7355)"></div>
          <span class="look-name">Film</span>
        </button>
        <button class="look-card" onclick="selectLook(this, 'warm')">
          <div class="look-preview" style="background:linear-gradient(135deg,#f5d0a9,#e8b87d)"></div>
          <span class="look-name">Warm</span>
        </button>
        <button class="look-card" onclick="selectLook(this, 'cool')">
          <div class="look-preview" style="background:linear-gradient(135deg,#a8c8ec,#7da8d1)"></div>
          <span class="look-name">Cool</span>
        </button>
        <button class="look-card" onclick="selectLook(this, 'mono')">
          <div class="look-preview" style="background:linear-gradient(135deg,#a0a0a0,#606060)"></div>
          <span class="look-name">Mono</span>
        </button>
        <button class="look-card" onclick="selectLook(this, 'vintage')">
          <div class="look-preview" style="background:linear-gradient(135deg,#d4a574,#b8956a)"></div>
          <span class="look-name">Vintage</span>
        </button>
        <button class="look-card" onclick="selectLook(this, 'neon')">
          <div class="look-preview" style="background:linear-gradient(135deg,#6366f1,#ec4899)"></div>
          <span class="look-name">Neon</span>
        </button>
        <button class="look-card" onclick="selectLook(this, 'custom')">
          <div class="look-preview" style="background:linear-gradient(135deg,#22c55e,#3b82f6)"></div>
          <span class="look-name">Custom</span>
        </button>
      </div>
      
      <div class="overlay-control">
        <label>Reactive Overlay</label>
        <div class="range-wrap">
          <input type="range" min="0" max="100" value="30" id="overlayIntensity" oninput="updateOverlay(this.value)">
          <span class="range-value">30</span>
        </div>
        <div class="overlay-modes">
          <button class="ov-mode active" onclick="selectOverlayMode(this, 'subtle')">Subtle</button>
          <button class="ov-mode" onclick="selectOverlayMode(this, 'mood')">Mood</button>
          <button class="ov-mode" onclick="selectOverlayMode(this, 'energy')">Energy</button>
          <button class="ov-mode" onclick="selectOverlayMode(this, 'off')">Off</button>
        </div>
      </div>
    </div>
  </div>
  
  <!-- EXPORT PANEL -->
  <div class="panel export-panel">
    <div class="panel-header">
      <span class="panel-title">⬇ Export</span>
    </div>
    <div class="panel-body">
      <div class="format-select">
        <label>Format</label>
        <select id="exportFormat">
          <option value="9:16">Vertical 9:16</option>
          <option value="16:9" selected>Landscape 16:9</option>
        </select>
      </div>
      
      <div class="burn-options">
        <label>Burn In</label>
        <label class="burn-toggle">
          <input type="checkbox" onchange="toggleBurn('logo', this.checked)">
          <span class="burn-icon">🏷</span>
          <span>Logo watermark</span>
        </label>
        <label class="burn-toggle">
          <input type="checkbox" onchange="toggleBurn('title', this.checked)">
          <span class="burn-icon">T</span>
          <span>Title card</span>
        </label>
      </div>
      
      <button class="btn btn-export" onclick="exportVideo()">⬇ Export Video</button>
    </div>
  </div>
  
</div>

<script>
// ======== STATE ========
let currentVideo = null;
let overlay = null;

// ======== UPLOAD ========
const videoDrop = document.getElementById('videoDrop');
videoDrop.addEventListener('dragover', (e) => {
  e.preventDefault();
  videoDrop.classList.add('drag-over');
});
videoDrop.addEventListener('dragleave', () => {
  videoDrop.classList.remove('drag-over');
});
videoDrop.addEventListener('drop', (e) => {
  e.preventDefault();
  videoDrop.classList.remove('drag-over');
  loadVideo(e.dataTransfer.files[0]);
});
videoDrop.addEventListener('click', () => {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'video/*';
  input.onchange = (e) => loadVideo(e.target.files[0]);
  input.click();
});

function loadVideo(file) {
  if (!file) return;
  
  const url = URL.createObjectURL(file);
  const video = document.getElementById('previewVideo');
  video.src = url;
  
  video.onloadedmetadata = () => {
    // Show info
    document.getElementById('videoDrop').classList.add('hidden');
    document.getElementById('sourceInfo').classList.remove('hidden');
    document.getElementById('fixSection').classList.remove('hidden');
    
    document.getElementById('srcResolution').textContent = `${video.videoWidth} × ${video.videoHeight}`;
    document.getElementById('srcFps').textContent = '30 fps'; // Not exposed in API
    document.getElementById('srcDuration').textContent = formatTime(video.duration);
    document.getElementById('srcCodec').textContent = file.type.split('/')[1].toUpperCase();
    
    // Init overlay
    const canvas = document.getElementById('overlayCanvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    overlay = new CleanOverlay(canvas, video);
    overlay.render();
  };
  
  currentVideo = video;
}

function formatTime(s) {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

// ======== LOOKS ========
function selectLook(btn, look) {
  document.querySelectorAll('.look-card').forEach(c => c.classList.remove('active'));
  btn.classList.add('active');
  console.log('Look:', look);
}

function updateOverlay(val) {
  document.querySelector('.overlay-control .range-value').textContent = val;
  if (overlay) overlay.setIntensity(val);
}

function selectOverlayMode(btn, mode) {
  document.querySelectorAll('.ov-mode').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  if (overlay) overlay.setMode(mode);
}

// ======== BURN IN ========
function toggleBurn(type, show) {
  const el = document.getElementById('burn' + type.charAt(0).toUpperCase() + type.slice(1));
  if (el) el.classList.toggle('hidden', !show);
}

// ======== TRANSPORT ========
function togglePlay() {
  const video = document.getElementById('previewVideo');
  const btn = document.getElementById('playBtn');
  
  if (video.paused) {
    video.play();
    btn.textContent = '⏸';
  } else {
    video.pause();
    btn.textContent = '▶';
  }
}

function seek(seconds) {
  const video = document.getElementById('previewVideo');
  if (video) video.currentTime += seconds;
}

function exportVideo() {
  console.log('Exporting...');
  // Would use MediaRecorder on canvas with video + overlay composited
}

// ======== CLEAN OVERLAY CLASS ========
// [Embed full CleanOverlay class from section 4.5]

// ======== INIT ========
console.log('Camera Enhance ready');
</script>

</body>
</html>
```

---

## 7. Hermes Prompt

```
You are building "Camera Enhance" — a clean video processing page for 
Sainted Word Records, a browser-native video engine.

PAGE: Camera Enhance — No Holograms, Camera-First

CONTEXT:
- Users shoot video on phones/DSLRs and need professional enhancement
- No synthetic 3D, no holographic effects, no particle explosions
- Goal: fix phone footage problems (shake, noise, flat color) and 
  apply subtle, tasteful reactive overlays that complement real world

REQUIREMENTS:
1. Source panel: video upload with metadata display, fix toggles 
   (stabilize, denoise, smooth motion, auto-expose)
2. Preview stage: 9:16 video player with clean overlay canvas on top
3. Look panel: 8 presets (Clean, Film, Warm, Cool, Mono, Vintage, 
   Neon, Custom) with full color grading sliders
4. Overlay system: 4 modes (Off, Subtle, Mood, Energy) that react 
   to optional audio input — soft vignettes, color washes, gentle 
   bars — never overpowering the real footage
5. Export panel: format select, quality, burn-in options (logo, 
   title, subtitle, date, location), audio options
6. Burn-in elements: rendered to final output, positioned safely

DESIGN CONSTRAINTS:
- Warm, film-like color palette (amber, cream, soft contrast)
- Real-world photography aesthetic, not digital/synthetic
- Overlays at 30% opacity max by default
- Typography: clean, modern, Swiss-inspired
- No neon, no glitch, no cyberpunk — unless "Neon" look selected

TECHNICAL:
- Video element for playback, Canvas 2D for overlays
- Optional: Web Audio API for reactive overlays if user adds music
- MediaRecorder for export compositing video + overlay + burn-in
- All processing client-side, zero backend

OUTPUT: Single HTML file with inline CSS and JS. Self-contained.
```

---

*End of Camera Enhance PRD. Clean, professional video processing for real-world camera footage — no holograms, no synthetic 3D, just enhancement.*