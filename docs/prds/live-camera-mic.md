# PRD: Live Camera & Mic Recording Integration

## Overview
Full camera and microphone integration across all SWR pages where live performance, recording, or real-time reaction is appropriate. This is not an add-on — it's a core system that enables new categories of content creation.

## Context
SWR's engine is audio-reactive. Currently it reacts to pre-recorded audio files. Adding live camera + mic input transforms the tool from a "music video renderer" into a "performance capture studio" — unlocking: live freestyles, reaction videos, karaoke-style performances, vlogs with reactive backgrounds, ASMR with visual triggers, and more.

---

## 1. Pages Requiring Camera/Mic

| Page | Camera Use | Mic Use | Recording |
|------|-----------|---------|-----------|
| **Spit Live** (`/spit`) | Optional face-in-corner | **Primary: freestyle vocals** | **Yes: performance video** |
| **TikTok Studio** (`/tiktok`) | Optional face overlay | **Primary: lip sync / duet** | **Yes: reaction video** |
| **Live Control Room** (`/live`) | Stage feed / crowd | Venue mix or MC mic | **Yes: full set** |
| **Music Video Engine** (`/app`) | Not needed | Not needed | Render only |
| **Dashboard** | Not needed | Not needed | — |
| **Asset Manager** | Not needed | Not needed | — |
| **Client Review** | Not needed | Not needed | — |

**Decision rule:** Camera/mic only on **creation/performance** pages, never on **management/review** pages.

---

## 2. Unified MediaInput API

```javascript
/**
 * SWR MediaInput — Unified camera + mic access
 * Zero-backend, all browser-native APIs
 */

class SWRMediaInput {
  constructor(options = {}) {
    this.video = {
      stream: null,
      track: null,
      enabled: false,
      deviceId: null,
      facingMode: 'user', // 'user' | 'environment'
      resolution: options.videoResolution || { width: 1280, height: 720 },
      frameRate: options.videoFrameRate || 30
    };
    
    this.audio = {
      stream: null,
      track: null,
      enabled: false,
      deviceId: null,
      sampleRate: 48000,
      echoCancellation: options.echoCancellation ?? false,
      noiseSuppression: options.noiseSuppression ?? false,
      autoGainControl: options.autoGainControl ?? false
    };
    
    this.analyser = null;
    this.audioContext = null;
    this.recordedChunks = [];
    this.mediaRecorder = null;
    this.onFrame = null; // Callback for video frame processing
  }
  
  // ========== CAMERA ==========
  
  async startCamera(preferredDevice = null) {
    try {
      const constraints = {
        video: {
          width: { ideal: this.video.resolution.width },
          height: { ideal: this.video.resolution.height },
          frameRate: { ideal: this.video.frameRate },
          facingMode: this.video.facingMode
        }
      };
      
      if (preferredDevice || this.video.deviceId) {
        constraints.video.deviceId = { exact: preferredDevice || this.video.deviceId };
      }
      
      this.video.stream = await navigator.mediaDevices.getUserMedia(constraints);
      this.video.track = this.video.stream.getVideoTracks()[0];
      this.video.enabled = true;
      
      // Get actual settings
      const settings = this.video.track.getSettings();
      this.video.resolution = { width: settings.width, height: settings.height };
      this.video.deviceId = settings.deviceId;
      
      return {
        success: true,
        stream: this.video.stream,
        resolution: this.video.resolution,
        deviceInfo: await this.getDeviceInfo('videoinput', this.video.deviceId)
      };
      
    } catch (err) {
      return { success: false, error: err.name, message: err.message };
    }
  }
  
  stopCamera() {
    if (this.video.track) {
      this.video.track.stop();
      this.video.track = null;
    }
    if (this.video.stream) {
      this.video.stream.getTracks().forEach(t => t.stop());
      this.video.stream = null;
    }
    this.video.enabled = false;
  }
  
  async switchCamera() {
    const devices = await this.getDevices('videoinput');
    const currentIndex = devices.findIndex(d => d.deviceId === this.video.deviceId);
    const nextIndex = (currentIndex + 1) % devices.length;
    const nextDevice = devices[nextIndex];
    
    this.stopCamera();
    this.video.facingMode = nextDevice.label.includes('back') ? 'environment' : 'user';
    return this.startCamera(nextDevice.deviceId);
  }
  
  // ========== MICROPHONE ==========
  
  async startMic(preferredDevice = null) {
    try {
      const constraints = {
        audio: {
          sampleRate: { ideal: this.audio.sampleRate },
          echoCancellation: this.audio.echoCancellation,
          noiseSuppression: this.audio.noiseSuppression,
          autoGainControl: this.audio.autoGainControl,
          channelCount: 1 // Mono for analysis, stereo for recording if available
        }
      };
      
      if (preferredDevice || this.audio.deviceId) {
        constraints.audio.deviceId = { exact: preferredDevice || this.audio.deviceId };
      }
      
      this.audio.stream = await navigator.mediaDevices.getUserMedia(constraints);
      this.audio.track = this.audio.stream.getAudioTracks()[0];
      this.audio.enabled = true;
      
      // Set up analysis
      await this.setupAudioAnalysis();
      
      const settings = this.audio.track.getSettings();
      this.audio.deviceId = settings.deviceId;
      
      return {
        success: true,
        stream: this.audio.stream,
        analyser: this.analyser,
        deviceInfo: await this.getDeviceInfo('audioinput', this.audio.deviceId)
      };
      
    } catch (err) {
      return { success: false, error: err.name, message: err.message };
    }
  }
  
  stopMic() {
    if (this.audio.track) {
      this.audio.track.stop();
      this.audio.track = null;
    }
    if (this.audio.stream) {
      this.audio.stream.getTracks().forEach(t => t.stop());
      this.audio.stream = null;
    }
    this.audio.enabled = false;
    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }
  }
  
  // ========== AUDIO ANALYSIS ==========
  
  async setupAudioAnalysis() {
    this.audioContext = new (window.AudioContext || window.webkitAudioContext)({
      sampleRate: this.audio.sampleRate
    });
    
    this.analyser = this.audioContext.createAnalyser();
    this.analyser.fftSize = 2048;
    this.analyser.smoothingTimeConstant = 0.8;
    
    const source = this.audioContext.createMediaStreamSource(this.audio.stream);
    source.connect(this.analyser);
    
    // Don't connect to destination — we use monitor for that
    return this.analyser;
  }
  
  getAudioData() {
    if (!this.analyser) return null;
    
    const frequencyData = new Uint8Array(this.analyser.frequencyBinCount);
    const timeData = new Uint8Array(this.analyser.frequencyBinCount);
    
    this.analyser.getByteFrequencyData(frequencyData);
    this.analyser.getByteTimeDomainData(timeData);
    
    // Extract features
    return {
      frequency: frequencyData,
      time: timeData,
      bass: this.averageRange(frequencyData, 0, 10),
      lowMid: this.averageRange(frequencyData, 10, 40),
      mid: this.averageRange(frequencyData, 40, 100),
      high: this.averageRange(frequencyData, 100, 200),
      presence: this.averageRange(frequencyData, 60, 80),
      energy: this.averageRange(frequencyData, 0, 200),
      // Voice-specific
      voiceFundamental: this.detectPitch(timeData),
      // Transient detection
      transient: this.detectTransient(frequencyData)
    };
  }
  
  averageRange(data, start, end) {
    let sum = 0;
    for (let i = start; i < end && i < data.length; i++) sum += data[i];
    return sum / (end - start);
  }
  
  detectTransient(data) {
    const current = this.averageRange(data, 0, 20);
    const diff = current - (this._lastTransient || 0);
    this._lastTransient = current;
    return diff > 30 ? current : 0;
  }
  
  detectPitch(timeData) {
    // Simple zero-crossing for fundamental frequency
    let crossings = 0;
    for (let i = 1; i < timeData.length; i++) {
      if ((timeData[i-1] < 128 && timeData[i] >= 128) ||
          (timeData[i-1] >= 128 && timeData[i] < 128)) {
        crossings++;
      }
    }
    const duration = timeData.length / this.audioContext.sampleRate;
    return crossings / (2 * duration); // Hz
  }
  
  // ========== MONITORING ==========
  
  async startMonitor() {
    // Create monitor output so performer can hear themselves + beat
    if (!this.audioContext) return;
    
    const monitorGain = this.audioContext.createGain();
    monitorGain.gain.value = 0.7; // Prevent feedback
    monitorGain.connect(this.audioContext.destination);
    
    // Beat mix would connect here too
    return monitorGain;
  }
  
  // ========== RECORDING ==========
  
  async startRecording(canvas = null, options = {}) {
    const streams = [];
    
    // Video from camera
    if (this.video.stream) {
      streams.push(...this.video.stream.getVideoTracks());
    }
    
    // Video from canvas (reactive visuals)
    if (canvas) {
      const canvasStream = canvas.captureStream(options.canvasFps || 30);
      streams.push(...canvasStream.getVideoTracks());
    }
    
    // Audio from mic + beat mix
    if (this.audio.stream) {
      streams.push(...this.audio.stream.getAudioTracks());
    }
    
    // Beat audio (if playing)
    if (options.beatDestination) {
      streams.push(...options.beatDestination.stream.getAudioTracks());
    }
    
    const mixedStream = new MediaStream(streams);
    
    // Determine codec
    const mimeType = MediaRecorder.isTypeMime('video/webm;codecs=vp9,opus')
      ? 'video/webm;codecs=vp9,opus'
      : 'video/webm;codecs=vp8,opus';
    
    this.mediaRecorder = new MediaRecorder(mixedStream, {
      mimeType,
      videoBitsPerSecond: options.videoBitrate || 8000000,
      audioBitsPerSecond: options.audioBitrate || 128000
    });
    
    this.recordedChunks = [];
    this.mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) this.recordedChunks.push(e.data);
    };
    
    this.mediaRecorder.start(options.timeslice || 100);
    
    return {
      success: true,
      state: this.mediaRecorder.state,
      mimeType
    };
  }
  
  async stopRecording() {
    return new Promise((resolve) => {
      if (!this.mediaRecorder || this.mediaRecorder.state === 'inactive') {
        resolve(null);
        return;
      }
      
      this.mediaRecorder.onstop = () => {
        const blob = new Blob(this.recordedChunks, { 
          type: this.mediaRecorder.mimeType 
        });
        
        const url = URL.createObjectURL(blob);
        
        resolve({
          blob,
          url,
          size: blob.size,
          duration: this.mediaRecorder.duration // Approximate
        });
      };
      
      this.mediaRecorder.stop();
    });
  }
  
  // ========== DEVICE MANAGEMENT ==========
  
  async getDevices(kind = null) {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return kind 
      ? devices.filter(d => d.kind === kind)
      : devices;
  }
  
  async getDeviceInfo(kind, deviceId) {
    const devices = await this.getDevices(kind);
    return devices.find(d => d.deviceId === deviceId) || null;
  }
  
  async requestPermissions() {
    // Trigger permission prompt by requesting both
    try {
      await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      return { camera: true, mic: true };
    } catch (err) {
      return { camera: false, mic: false, error: err.message };
    }
  }
  
  // ========== CLEANUP ==========
  
  destroy() {
    this.stopCamera();
    this.stopMic();
    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      this.mediaRecorder.stop();
    }
    this.recordedChunks = [];
  }
}
```

---

## 3. Camera Preview Component

```html
<!-- Reusable camera preview with controls -->
<div class="camera-preview" id="cameraPreview">
  <video class="camera-feed" id="cameraFeed" autoplay playsinline muted></video>
  
  <!-- Overlay controls -->
  <div class="camera-controls">
    <button class="cam-btn" id="camSwitch" onclick="switchCamera()" title="Switch camera">
      🔄
    </button>
    <button class="cam-btn" id="camMute" onclick="toggleVideo()" title="Toggle video">
      📹
    </button>
    <div class="cam-indicator" id="camIndicator">
      <span class="rec-dot"></span> LIVE
    </div>
  </div>
  
  <!-- Face guide -->
  <div class="face-guide" id="faceGuide">
    <div class="guide-frame"></div>
    <div class="guide-text">Center your face</div>
  </div>
</div>
```

```css
.camera-preview {
  position: relative;
  width: 100%;
  height: 100%;
  background: #000;
  border-radius: var(--radius-lg);
  overflow: hidden;
}

.camera-feed {
  width: 100%;
  height: 100%;
  object-fit: cover;
  transform: scaleX(-1); /* Mirror for selfie feel */
}

.camera-controls {
  position: absolute;
  top: 12px;
  right: 12px;
  display: flex;
  gap: 8px;
  z-index: 10;
}

.cam-btn {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: rgba(0,0,0,0.6);
  backdrop-filter: blur(10px);
  border: 1px solid rgba(255,255,255,0.2);
  color: white;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.9rem;
  transition: all 150ms ease;
}

.cam-btn:hover {
  background: rgba(255,255,255,0.2);
}

.cam-indicator {
  padding: 6px 12px;
  background: rgba(0,0,0,0.6);
  backdrop-filter: blur(10px);
  border-radius: 16px;
  font-size: 0.7rem;
  font-weight: 700;
  color: #ff0050;
  display: flex;
  align-items: center;
  gap: 6px;
}

.rec-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #ff0050;
  animation: blink 1s infinite;
}

@keyframes blink {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.3; }
}

.face-guide {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  pointer-events: none;
  opacity: 0;
  transition: opacity 300ms ease;
}

.face-guide.active {
  opacity: 1;
}

.guide-frame {
  width: 200px;
  height: 250px;
  border: 2px dashed rgba(255,255,255,0.3);
  border-radius: 50% 50% 45% 45%;
}

.guide-text {
  margin-top: 16px;
  font-size: 0.85rem;
  color: rgba(255,255,255,0.6);
}

/* Size variants */
.camera-preview.small { width: 160px; height: 120px; }
.camera-preview.medium { width: 320px; height: 240px; }
.camera-preview.large { width: 480px; height: 360px; }
.camera-preview.full { width: 100%; height: 100%; }
```

---

## 4. Mic Level Meter Component

```html
<!-- Reusable mic level with waveform -->
<div class="mic-meter" id="micMeter">
  <div class="waveform-display" id="waveformDisplay">
    <canvas id="waveformCanvas" width="200" height="40"></canvas>
  </div>
  
  <div class="level-bars">
    <div class="level-bar" data-threshold="0"></div>
    <div class="level-bar" data-threshold="10"></div>
    <div class="level-bar" data-threshold="20"></div>
    <div class="level-bar" data-threshold="30"></div>
    <div class="level-bar" data-threshold="40"></div>
    <div class="level-bar" data-threshold="50"></div>
    <div class="level-bar" data-threshold="60"></div>
    <div class="level-bar" data-threshold="70"></div>
    <div class="level-bar" data-threshold="80"></div>
    <div class="level-bar" data-threshold="90"></div>
    <div class="level-bar peak" data-threshold="100"></div>
  </div>
  
  <div class="meter-labels">
    <span>-∞</span>
    <span>-12</span>
    <span>0</span>
    <span>+6</span>
  </div>
  
  <div class="clip-indicator" id="clipIndicator">CLIP</div>
</div>
```

```css
.mic-meter {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 16px;
  background: var(--bg-surface);
  border-radius: var(--radius-md);
}

.waveform-display {
  height: 40px;
  background: var(--bg-base);
  border-radius: var(--radius-sm);
  overflow: hidden;
}

.waveform-display canvas {
  width: 100%;
  height: 100%;
}

.level-bars {
  display: flex;
  gap: 2px;
  height: 24px;
  align-items: flex-end;
}

.level-bar {
  flex: 1;
  background: var(--bg-hover);
  border-radius: 2px 2px 0 0;
  transition: background 50ms ease, height 50ms ease;
  min-height: 4px;
}

.level-bar.active {
  background: linear-gradient(180deg, #10b981, #059669);
}

.level-bar.active.warm {
  background: linear-gradient(180deg, #f59e0b, #d97706);
}

.level-bar.active.hot {
  background: linear-gradient(180deg, #ef4444, #dc2626);
}

.level-bar.peak.active.hot {
  animation: peak-flash 0.2s ease;
}

@keyframes peak-flash {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}

.meter-labels {
  display: flex;
  justify-content: space-between;
  font-size: 0.65rem;
  color: var(--text-muted);
  font-family: var(--font-mono);
}

.clip-indicator {
  text-align: center;
  font-size: 0.75rem;
  font-weight: 700;
  color: #ef4444;
  opacity: 0;
  transition: opacity 150ms ease;
}

.clip-indicator.active {
  opacity: 1;
}
```

```javascript
class MicMeter {
  constructor(canvasId, analyser) {
    this.canvas = document.getElementById(canvasId);
    this.ctx = this.canvas.getContext('2d');
    this.analyser = analyser;
    this.dataArray = new Uint8Array(analyser.frequencyBinCount);
    this.isRunning = false;
  }
  
  start() {
    this.isRunning = true;
    this.draw();
  }
  
  stop() {
    this.isRunning = false;
  }
  
  draw() {
    if (!this.isRunning) return;
    
    this.analyser.getByteTimeDomainData(this.dataArray);
    
    // Draw waveform
    this.ctx.fillStyle = '#0a0d12';
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    
    this.ctx.beginPath();
    this.ctx.strokeStyle = '#ff6b00';
    this.ctx.lineWidth = 2;
    
    const sliceWidth = this.canvas.width / this.dataArray.length;
    let x = 0;
    
    for (let i = 0; i < this.dataArray.length; i++) {
      const v = this.dataArray[i] / 128.0;
      const y = v * this.canvas.height / 2;
      
      if (i === 0) this.ctx.moveTo(x, y);
      else this.ctx.lineTo(x, y);
      
      x += sliceWidth;
    }
    
    this.ctx.stroke();
    
    // Update level bars
    const rms = this.calculateRMS(this.dataArray);
    const db = 20 * Math.log10(rms);
    const normalized = Math.max(0, (db + 60) / 60 * 100); // -60dB to 0dB
    
    const bars = document.querySelectorAll('.level-bar');
    bars.forEach(bar => {
      const threshold = parseInt(bar.dataset.threshold);
      const isActive = normalized >= threshold;
      
      bar.classList.toggle('active', isActive);
      bar.classList.toggle('warm', isActive && threshold >= 60);
      bar.classList.toggle('hot', isActive && threshold >= 90);
      
      // Dynamic height
      if (isActive) {
        const heightPercent = Math.min(100, (normalized - threshold) * 2 + 20);
        bar.style.height = `${heightPercent}%`;
      } else {
        bar.style.height = '4px';
      }
    });
    
    // Clip detection
    const maxValue = Math.max(...this.dataArray);
    const isClipping = maxValue > 250; // Near 0dBFS
    
    document.getElementById('clipIndicator').classList.toggle('active', isClipping);
    
    requestAnimationFrame(() => this.draw());
  }
  
  calculateRMS(data) {
    let sum = 0;
    for (let i = 0; i < data.length; i++) {
      const x = (data[i] - 128) / 128.0;
      sum += x * x;
    }
    return Math.sqrt(sum / data.length);
  }
}
```

---

## 5. Page-Specific Integration

### 5.1 Spit Live (`/spit`) — Full Integration

```html
<!-- Spit Live with camera + mic -->
<div class="spit-layout">
  
  <!-- Main stage: reactive canvas -->
  <div class="stage-reactive">
    <canvas id="reactiveCanvas" width="1080" height="1920"></canvas>
  </div>
  
  <!-- Camera picture-in-picture (optional) -->
  <div class="camera-pip" id="cameraPip">
    <div class="camera-preview small">
      <video id="pipVideo" autoplay playsinline muted></video>
      <div class="camera-controls">
        <button class="cam-btn" onclick="switchCamera()">🔄</button>
        <button class="cam-btn" onclick="togglePip()">✕</button>
      </div>
    </div>
  </div>
  
  <!-- Mic panel with meter -->
  <div class="mic-section">
    <div class="mic-meter" id="spitMicMeter">
      <!-- MicMeter component -->
    </div>
    <button class="btn btn-tiktok" onclick="toggleRecord()">● REC</button>
  </div>
  
</div>
```

**Camera placement options:**
- **Off** (default): Pure reactive visuals, voice only
- **Picture-in-picture**: Small corner overlay, MC visible
- **Background**: Full camera feed with reactive overlay
- **Green screen**: Camera with chroma key replacement

```javascript
// Spit Live camera modes
const cameraModes = {
  off: { enabled: false, pip: false },
  pip: { enabled: true, pip: true, position: 'bottom-right', size: 'small' },
  background: { enabled: true, pip: false, full: true },
  greenscreen: { enabled: true, pip: false, chromaKey: '#00ff00' }
};

function setCameraMode(mode) {
  const config = cameraModes[mode];
  
  if (!config.enabled) {
    mediaInput.stopCamera();
    document.getElementById('cameraPip').classList.add('hidden');
    return;
  }
  
  if (config.pip) {
    mediaInput.startCamera().then(result => {
      const video = document.getElementById('pipVideo');
      video.srcObject = result.stream;
      document.getElementById('cameraPip').classList.remove('hidden');
    });
  }
  
  if (config.full) {
    // Camera as background, reactive overlay on top
    mediaInput.startCamera({ width: 1080, height: 1920 }).then(result => {
      // Draw camera frame to canvas background each frame
      const video = document.createElement('video');
      video.srcObject = result.stream;
      video.play();
      
      function drawCameraBackground() {
        const canvas = document.getElementById('reactiveCanvas');
        const ctx = canvas.getContext('2d');
        ctx.drawImage(video, 0, 0, 1080, 1920);
        requestAnimationFrame(drawCameraBackground);
      }
      
      drawCameraBackground();
    });
  }
}
```

---

### 5.2 TikTok Studio (`/tiktok`) — Lip Sync / Duet

```html
<!-- TikTok Studio with camera for reactions -->
<div class="tiktok-camera-section">
  <div class="camera-layout">
    
    <!-- Left: reactive visuals -->
    <div class="reactive-side">
      <canvas id="tiktokCanvas" width="540" height="960"></canvas>
    </div>
    
    <!-- Right: camera feed -->
    <div class="camera-side">
      <div class="camera-preview large">
        <video id="reactionCamera" autoplay playsinline></video>
        
        <!-- Reaction controls -->
        <div class="reaction-controls">
          <button class="react-btn" onclick="setReaction('duet')">Duet</button>
          <button class="react-btn" onclick="setReaction('react')">React</button>
          <button class="react-btn" onclick="setReaction('stitch')">Stitch</button>
        </div>
      </div>
    </div>
    
  </div>
</div>
```

**Reaction modes:**
- **Duet**: Split screen — original on left, you on right
- **React**: Full original with your face in corner
- **Stitch**: Your clip follows original, with transition

---

### 5.3 Live Control Room (`/live`) — Stage Feed

```html
<!-- Live event with camera inputs -->
<div class="control-room">
  
  <!-- Main output -->
  <div class="output-main">
    <canvas id="mainOutput" width="1920" height="1080"></canvas>
  </div>
  
  <!-- Camera feeds -->
  <div class="camera-feeds">
    <div class="feed" id="feed1">
      <div class="camera-preview medium">
        <video id="stageCam1" autoplay playsinline></video>
        <span class="feed-label">Stage Left</span>
      </div>
    </div>
    <div class="feed" id="feed2">
      <div class="camera-preview medium">
        <video id="stageCam2" autoplay playsinline></video>
        <span class="feed-label">Stage Right</span>
      </div>
    </div>
    <div class="feed" id="feed3">
      <div class="camera-preview medium">
        <video id="crowdCam" autoplay playsinline></video>
        <span class="feed-label">Crowd</span>
      </div>
    </div>
  </div>
  
  <!-- Mic from venue -->
  <div class="venue-mic">
    <div class="mic-meter" id="venueMicMeter"></div>
    <button onclick="toggleVenueMic()">Venue Mic</button>
  </div>
  
</div>
```

---

## 6. Permission Handling

```javascript
class PermissionManager {
  constructor() {
    this.states = {
      camera: 'prompt', // 'prompt' | 'granted' | 'denied'
      microphone: 'prompt'
    };
  }
  
  async checkPermissions() {
    try {
      // Query permissions if available (not all browsers support)
      if (navigator.permissions) {
        const camPerm = await navigator.permissions.query({ name: 'camera' });
        const micPerm = await navigator.permissions.query({ name: 'microphone' });
        
        this.states.camera = camPerm.state;
        this.states.microphone = micPerm.state;
        
        camPerm.onchange = () => { this.states.camera = camPerm.state; };
        micPerm.onchange = () => { this.states.microphone = micPerm.state; };
      }
    } catch (e) {
      // Fallback: try getUserMedia and catch
    }
    
    return this.states;
  }
  
  async requestWithUI() {
    // Show custom permission UI before native prompt
    const modal = document.createElement('div');
    modal.className = 'permission-modal';
    modal.innerHTML = `
      <div class="permission-content">
        <h2>Enable Camera & Microphone</h2>
        <p>SWR needs access to create your performance video.</p>
        <ul>
          <li>🎤 Microphone: captures your vocals</li>
          <li>📹 Camera (optional): adds your face to the video</li>
        </ul>
        <p class="privacy-note">Everything stays on your device. Nothing is uploaded.</p>
        <div class="permission-actions">
          <button onclick="this.closest('.permission-modal').remove()">Skip Camera</button>
          <button class="btn-primary" onclick="grantPermissions()">Enable Both</button>
        </div>
      </div>
    `;
    
    document.body.appendChild(modal);
    
    return new Promise((resolve) => {
      window.grantPermissions = async () => {
        modal.remove();
        const media = new SWRMediaInput();
        const result = await media.requestPermissions();
        resolve(result);
      };
    });
  }
  
  renderBlockedState(type) {
    const container = document.getElementById(`${type}-container`);
    container.innerHTML = `
      <div class="blocked-state">
        <div class="blocked-icon">🔒</div>
        <h3>${type === 'camera' ? 'Camera' : 'Microphone'} Blocked</h3>
        <p>Please allow access in your browser settings:</p>
        <ol>
          <li>Click the 🔒 icon in your address bar</li>
          <li>Find "${type === 'camera' ? 'Camera' : 'Microphone'}"</li>
          <li>Change to "Allow"</li>
          <li>Refresh the page</li>
        </ol>
        <button onclick="location.reload()">Refresh</button>
      </div>
    `;
  }
}
```

```css
.permission-modal {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.8);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  backdrop-filter: blur(10px);
}

.permission-content {
  background: var(--bg-surface);
  border-radius: var(--radius-xl);
  padding: 40px;
  max-width: 480px;
  text-align: center;
}

.permission-content h2 {
  font-size: 1.4rem;
  margin-bottom: 16px;
}

.permission-content ul {
  text-align: left;
  margin: 20px 0;
  padding-left: 20px;
  color: var(--text-secondary);
}

.privacy-note {
  padding: 12px;
  background: rgba(16,185,129,0.1);
  border-radius: var(--radius-md);
  color: var(--accent-success);
  font-size: 0.9rem;
  margin: 16px 0;
}

.permission-actions {
  display: flex;
  gap: 12px;
  margin-top: 24px;
}

.permission-actions button {
  flex: 1;
  padding: 12px;
  border-radius: var(--radius-md);
  border: none;
  cursor: pointer;
  font-size: 0.9rem;
}

.permission-actions .btn-primary {
  background: linear-gradient(135deg, #ff6b00, #ff0050);
  color: white;
  font-weight: 600;
}

.blocked-state {
  text-align: center;
  padding: 40px;
}

.blocked-icon {
  font-size: 3rem;
  margin-bottom: 16px;
}

.blocked-state h3 {
  margin-bottom: 12px;
}

.blocked-state ol {
  text-align: left;
  margin: 16px 0;
  padding-left: 20px;
  color: var(--text-secondary);
  line-height: 1.8;
}
```

---

## 7. Complete Integration Example: Spit Live

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Spit Live — SWR Freestyle Studio</title>
  <style>
    /* [Include all CSS from MediaInput, CameraPreview, MicMeter, PermissionManager] */
    
    :root {
      --bg-base: #0a0d12;
      --bg-elevated: #11141a;
      --bg-surface: #1a1e28;
      --bg-hover: #222838;
      --text-primary: #f0f2f5;
      --text-secondary: #a0a8b8;
      --text-muted: #6b7280;
      --accent-primary: #ff6b00;
      --accent-secondary: #ff0050;
      --radius-sm: 6px;
      --radius-md: 10px;
      --radius-lg: 14px;
      --radius-xl: 20px;
      --font-mono: 'SF Mono', Monaco, monospace;
    }
    
    * { margin: 0; padding: 0; box-sizing: border-box; }
    
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: var(--bg-base);
      color: var(--text-primary);
      -webkit-font-smoothing: antialiased;
      height: 100vh;
      overflow: hidden;
    }
    
    /* Layout */
    .spit-app {
      display: grid;
      grid-template-rows: auto 1fr auto;
      grid-template-columns: 280px 1fr 280px;
      grid-template-areas:
        "header header header"
        "beat stage mic"
        "transport transport transport";
      height: 100vh;
      gap: 1px;
      background: var(--border-subtle);
    }
    
    @media (max-width: 1200px) {
      .spit-app {
        grid-template-columns: 1fr;
        grid-template-areas:
          "header"
          "stage"
          "beat"
          "mic"
          "transport";
        overflow-y: auto;
        height: auto;
      }
    }
    
    /* Header */
    .spit-header {
      grid-area: header;
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 12px 20px;
      background: var(--bg-elevated);
    }
    
    .spit-brand {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    
    .spit-logo {
      width: 36px;
      height: 36px;
      background: linear-gradient(135deg, #ff6b00, #ff0050);
      border-radius: 8px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 1.2rem;
      box-shadow: 0 0 16px rgba(255,107,0,0.3);
    }
    
    .spit-brand h1 {
      font-size: 1rem;
      font-weight: 800;
      line-height: 1;
    }
    
    .spit-sub {
      font-size: 0.65rem;
      color: var(--text-muted);
      font-family: var(--font-mono);
    }
    
    .spit-status {
      display: flex;
      gap: 10px;
    }
    
    .status-pill {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 5px 12px;
      background: var(--bg-surface);
      border-radius: 16px;
      font-size: 0.75rem;
      color: var(--text-secondary);
    }
    
    .status-pill .dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: var(--text-muted);
    }
    
    .status-pill.active .dot { background: var(--accent-success); }
    .status-pill.recording .dot { background: #ff0050; animation: blink 1s infinite; }
    
    @keyframes blink {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.3; }
    }
    
    .spit-actions {
      display: flex;
      gap: 8px;
    }
    
    .btn {
      padding: 8px 16px;
      border-radius: var(--radius-md);
      border: none;
      font-size: 0.85rem;
      font-weight: 600;
      cursor: pointer;
      transition: all 150ms ease;
      font-family: inherit;
    }
    
    .btn-ghost {
      background: transparent;
      color: var(--text-secondary);
      border: 1px solid var(--border-medium);
    }
    
    .btn-ghost:hover {
      background: var(--bg-hover);
      color: var(--text-primary);
    }
    
    .btn-rec {
      background: linear-gradient(135deg, #ff0050, #ff6b00);
      color: white;
      padding: 10px 20px;
    }
    
    .btn-rec:hover {
      transform: scale(1.05);
      box-shadow: 0 0 20px rgba(255,0,80,0.4);
    }
    
    .btn-rec.recording {
      animation: rec-pulse 1s infinite;
    }
    
    @keyframes rec-pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.7; }
    }
    
    /* Panels */
    .panel {
      background: var(--bg-elevated);
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }
    
    .beat-panel { grid-area: beat; }
    .mic-panel { grid-area: mic; }
    
    .panel-header {
      padding: 14px 20px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      border-bottom: 1px solid rgba(255,255,255,0.06);
      flex-shrink: 0;
    }
    
    .panel-title {
      font-size: 0.7rem;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      font-weight: 700;
      color: var(--text-secondary);
      display: flex;
      align-items: center;
      gap: 8px;
    }
    
    .panel-body {
      padding: 20px;
      overflow-y: auto;
      flex: 1;
    }
    
    /* Beat panel */
    .beat-dropzone {
      padding: 32px 16px;
      border: 2px dashed rgba(255,255,255,0.1);
      border-radius: var(--radius-lg);
      text-align: center;
      cursor: pointer;
      transition: all 200ms ease;
    }
    
    .beat-dropzone:hover, .beat-dropzone.drag-over {
      border-color: #ff6b00;
      background: rgba(255,107,0,0.05);
    }
    
    .beat-drop-icon { font-size: 2rem; margin-bottom: 8px; }
    .beat-drop-text { font-size: 0.85rem; color: var(--text-secondary); }
    .beat-drop-hint { font-size: 0.75rem; color: var(--text-muted); margin-top: 4px; }
    
    .beat-loaded { display: none; }
    .beat-loaded.active { display: flex; flex-direction: column; gap: 14px; }
    
    .beat-waveform {
      height: 44px;
      background: var(--bg-base);
      border-radius: var(--radius-sm);
      overflow: hidden;
    }
    
    .beat-meta { text-align: center; }
    .beat-title { font-weight: 700; font-size: 0.85rem; margin-bottom: 2px; }
    .beat-stats {
      font-size: 0.75rem;
      color: var(--text-secondary);
      font-family: var(--font-mono);
    }
    
    .beat-transport {
      display: flex;
      justify-content: center;
      gap: 8px;
    }
    
    .transport-btn {
      width: 32px;
      height: 32px;
      border-radius: 50%;
      border: none;
      background: var(--bg-hover);
      color: var(--text-primary);
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 0.85rem;
    }
    
    .transport-btn.play {
      width: 44px;
      height: 44px;
      background: linear-gradient(135deg, #ff6b00, #ff0050);
      font-size: 1rem;
    }
    
    .visual-pills {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }
    
    .visual-pill {
      padding: 6px 14px;
      border-radius: 16px;
      border: 1px solid rgba(255,255,255,0.1);
      background: var(--bg-base);
      color: var(--text-secondary);
      cursor: pointer;
      font-size: 0.8rem;
      transition: all 150ms ease;
    }
    
    .visual-pill.active {
      background: linear-gradient(135deg, #ff6b00, #ff0050);
      color: white;
      border-color: transparent;
    }
    
    /* Mic panel */
    .mic-level {
      display: flex;
      gap: 2px;
      align-items: center;
    }
    
    .level-bar {
      width: 3px;
      height: 14px;
      background: linear-gradient(180deg, #ff6b00, #ff0050);
      border-radius: 2px;
      transition: opacity 100ms ease;
    }
    
    .level-bar.dim { opacity: 0.2; }
    
    .mic-input-select,
    .mic-gain,
    .mic-monitor,
    .mic-reactive,
    .mic-enhance,
    .camera-toggle {
      margin-bottom: 16px;
    }
    
    .mic-input-select label,
    .mic-gain label,
    .mic-reactive > label,
    .camera-toggle > label {
      display: block;
      font-size: 0.7rem;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: var(--text-secondary);
      margin-bottom: 8px;
    }
    
    select, input[type="range"] {
      width: 100%;
      padding: 8px;
      background: var(--bg-base);
      border: 1px solid rgba(255,255,255,0.1);
      border-radius: var(--radius-md);
      color: var(--text-primary);
      font-size: 0.85rem;
    }
    
    .range-wrap {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    
    input[type="range"] {
      flex: 1;
      -webkit-appearance: none;
      height: 4px;
      background: var(--bg-hover);
      border-radius: 2px;
      outline: none;
    }
    
    input[type="range"]::-webkit-slider-thumb {
      -webkit-appearance: none;
      width: 14px;
      height: 14px;
      background: linear-gradient(135deg, #ff6b00, #ff0050);
      border-radius: 50%;
      cursor: pointer;
    }
    
    .range-value {
      font-family: var(--font-mono);
      font-size: 0.75rem;
      color: var(--text-secondary);
      min-width: 28px;
    }
    
    .toggle {
      display: flex;
      align-items: center;
      gap: 10px;
      cursor: pointer;
      font-size: 0.85rem;
      color: var(--text-secondary);
    }
    
    .toggle input { display: none; }
    
    .toggle-switch {
      width: 36px;
      height: 20px;
      background: var(--bg-hover);
      border-radius: 10px;
      position: relative;
      transition: background 150ms ease;
      border: 1px solid rgba(255,255,255,0.1);
      flex-shrink: 0;
    }
    
    .toggle-switch::after {
      content: '';
      position: absolute;
      top: 2px;
      left: 2px;
      width: 14px;
      height: 14px;
      border-radius: 50%;
      background: var(--text-muted);
      transition: all 150ms ease;
    }
    
    .toggle input:checked + .toggle-switch {
      background: linear-gradient(135deg, #ff6b00, #ff0050);
      border-color: transparent;
    }
    
    .toggle input:checked + .toggle-switch::after {
      left: 18px;
      background: white;
    }
    
    .reactive-modes {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    
    .reactive-mode {
      display: grid;
      grid-template-columns: 36px 1fr;
      gap: 6px 10px;
      padding: 10px;
      background: var(--bg-base);
      border: 2px solid transparent;
      border-radius: var(--radius-md);
      cursor: pointer;
      text-align: left;
      transition: all 150ms ease;
    }
    
    .reactive-mode.active {
      border-color: #ff6b00;
      background: rgba(255,107,0,0.05);
    }
    
    .mode-icon {
      grid-row: span 2;
      width: 36px;
      height: 36px;
      border-radius: 8px;
      background: var(--bg-hover);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 1.1rem;
    }
    
    .mode-name { font-weight: 700; font-size: 0.85rem; }
    .mode-desc { font-size: 0.75rem; color: var(--text-secondary); }
    
    /* Camera toggle */
    .camera-options {
      display: none;
      margin-top: 12px;
      padding: 12px;
      background: var(--bg-base);
      border-radius: var(--radius-md);
    }
    
    .camera-options.active {
      display: block;
    }
    
    .cam-mode-btn {
      width: 100%;
      padding: 10px;
      margin-bottom: 8px;
      background: var(--bg-hover);
      border: 1px solid rgba(255,255,255,0.1);
      border-radius: var(--radius-sm);
      color: var(--text-secondary);
      cursor: pointer;
      text-align: left;
      font-size: 0.85rem;
    }
    
    .cam-mode-btn.active {
      border-color: #ff6b00;
      color: var(--text-primary);
    }
    
    /* Stage */
    .spit-stage {
      grid-area: stage;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 20px;
      gap: 16px;
      background: var(--bg-base);
      position: relative;
    }
    
    .stage-canvas-wrapper {
      position: relative;
      width: 320px;
      height: 568px;
      background: #000;
      border-radius: var(--radius-xl);
      overflow: hidden;
      box-shadow: 0 16px 60px rgba(0,0,0,0.5);
    }
    
    #reactiveCanvas {
      width: 100%;
      height: 100%;
    }
    
    .layer-indicators {
      position: absolute;
      top: 12px;
      left: 12px;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    
    .layer-badge {
      padding: 5px 10px;
      background: rgba(0,0,0,0.6);
      backdrop-filter: blur(8px);
      border-radius: 16px;
      font-size: 0.7rem;
      font-weight: 600;
      display: flex;
      align-items: center;
      gap: 5px;
    }
    
    .layer-badge.beat-layer { color: #ff6b00; }
    .layer-badge.vocal-layer { color: #00f2ea; }
    
    .pulse-dot {
      width: 5px;
      height: 5px;
      border-radius: 50%;
      background: currentColor;
      animation: pulse 1.5s infinite;
    }
    
    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.3; }
    }
    
    /* Camera PIP */
    .camera-pip {
      position: absolute;
      bottom: 80px;
      right: 20px;
      width: 120px;
      height: 160px;
      border-radius: var(--radius-md);
      overflow: hidden;
      border: 2px solid rgba(255,255,255,0.2);
      background: #000;
      display: none;
    }
    
    .camera-pip.active {
      display: block;
    }
    
    .camera-pip video {
      width: 100%;
      height: 100%;
      object-fit: cover;
      transform: scaleX(-1);
    }
    
    .pip-controls {
      position: absolute;
      top: 4px;
      right: 4px;
      display: flex;
      gap: 4px;
    }
    
    .pip-btn {
      width: 24px;
      height: 24px;
      border-radius: 50%;
      background: rgba(0,0,0,0.6);
      border: none;
      color: white;
      cursor: pointer;
      font-size: 0.7rem;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    
    /* FX */
    .fx-tray {
      display: flex;
      gap: 6px;
      flex-wrap: wrap;
      justify-content: center;
      max-width: 360px;
    }
    
    .fx-btn {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 3px;
      padding: 10px 14px;
      background: var(--bg-surface);
      border: 2px solid rgba(255,255,255,0.1);
      border-radius: var(--radius-md);
      color: var(--text-secondary);
      cursor: pointer;
      min-width: 64px;
      transition: all 150ms ease;
    }
    
    .fx-btn:hover {
      border-color: #ff6b00;
      color: var(--text-primary);
    }
    
    .fx-btn.active {
      background: linear-gradient(135deg, #ff6b00, #ff0050);
      color: white;
      border-color: transparent;
    }
    
    .fx-icon { font-size: 1.3rem; }
    .fx-name { font-size: 0.65rem; font-weight: 600; text-transform: uppercase; }
    
    /* Transport */
    .transport-bar {
      grid-area: transport;
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 12px 20px;
      background: var(--bg-elevated);
      border-top: 1px solid rgba(255,255,255,0.06);
    }
    
    .transport-main {
      display: flex;
      gap: 6px;
      align-items: center;
    }
    
    .time-display {
      font-family: var(--font-mono);
      font-size: 0.95rem;
      color: var(--text-secondary);
    }
    
    .time-sep { margin: 0 6px; opacity: 0.5; }
    
    .transport-rec {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 6px;
    }
    
    .rec-timer {
      font-family: var(--font-mono);
      font-size: 0.8rem;
      color: #ff0050;
    }
    
    .transport-save { display: flex; gap: 6px; }
    
    .btn-success { background: var(--accent-success); color: white; }
    .btn-secondary { background: var(--bg-hover); color: var(--text-primary); border: 1px solid rgba(255,255,255,0.1); }
    
    .hidden { display: none !important; }
  </style>
</head>
<body>

<div class="spit-app">
  
  <!-- HEADER -->
  <header class="spit-header">
    <div class="spit-brand">
      <div class="spit-logo">⚡</div>
      <div>
        <h1>SPIT LIVE</h1>
        <span class="spit-sub">SWR Freestyle Studio</span>
      </div>
    </div>
    
    <div class="spit-status">
      <div class="status-pill" id="beatStatus">
        <span class="dot"></span> No Beat
      </div>
      <div class="status-pill" id="micStatus">
        <span class="dot"></span> Mic
      </div>
      <div class="status-pill" id="camStatus">
        <span class="dot"></span> Cam
      </div>
      <div class="status-pill recording hidden" id="recStatus">
        <span class="dot pulse"></span> REC
      </div>
    </div>
    
    <div class="spit-actions">
      <button class="btn btn-ghost" onclick="document.getElementById('beatFile').click()">Load Beat</button>
      <input type="file" id="beatFile" accept="audio/*" class="hidden" onchange="loadBeat(this.files[0])">
      <button class="btn btn-rec" id="recBtn" onclick="toggleRecord()">● REC</button>
    </div>
  </header>
  
  <!-- BEAT PANEL -->
  <div class="panel beat-panel">
    <div class="panel-header">
      <span class="panel-title">🥁 Beat</span>
      <button class="btn btn-ghost" style="padding:6px 12px; font-size:0.75rem;">Browse</button>
    </div>
    <div class="panel-body">
      <div class="beat-dropzone" id="beatDrop">
        <div class="beat-drop-icon">🎵</div>
        <div class="beat-drop-text">Drop beat or click to load</div>
        <div class="beat-drop-hint">MP3, WAV, MP4</div>
      </div>
      
      <div class="beat-loaded" id="beatLoaded">
        <div class="beat-waveform">
          <canvas id="waveformCanvas" width="240" height="44"></canvas>
        </div>
        <div class="beat-meta">
          <div class="beat-title" id="beatTitle">Untitled Beat</div>
          <div class="beat-stats">
            <span id="beatBpm">-- BPM</span>
            <span>·</span>
            <span id="beatKey">--</span>
          </div>
        </div>
        <div class="beat-transport">
          <button class="transport-btn">⏮</button>
          <button class="transport-btn play" id="beatPlayBtn" onclick="toggleBeat()">▶</button>
          <button class="transport-btn">⏭</button>
        </div>
        <div>
          <label style="font-size:0.75rem; color:var(--text-secondary); text-transform:uppercase; display:block; margin-bottom:10px;">Beat Visual Style</label>
          <div class="visual-pills">
            <button class="visual-pill active" onclick="selectVisual(this, 'pocket')">Pocket</button>
            <button class="visual-pill" onclick="selectVisual(this, 'ride')">Ride</button>
            <button class="visual-pill" onclick="selectVisual(this, 'chop')">Chop</button>
            <button class="visual-pill" onclick="selectVisual(this, 'ghost')">Ghost</button>
          </div>
        </div>
      </div>
    </div>
  </div>
  
  <!-- STAGE -->
  <div class="spit-stage">
    <div class="stage-canvas-wrapper">
      <canvas id="reactiveCanvas" width="1080" height="1920"></canvas>
      
      <div class="layer-indicators">
        <div class="layer-badge beat-layer">
          <span class="pulse-dot"></span> Beat
        </div>
        <div class="layer-badge vocal-layer">
          <span class="pulse-dot"></span> Vocal
        </div>
      </div>
      
      <!-- Camera PIP -->
      <div class="camera-pip" id="cameraPip">
        <video id="pipVideo" autoplay playsinline muted></video>
        <div class="pip-controls">
          <button class="pip-btn" onclick="switchCamera()">🔄</button>
          <button class="pip-btn" onclick="toggleCamera()">✕</button>
        </div>
      </div>
    </div>
    
    <div class="fx-tray">
      <button class="fx-btn" onclick="triggerFx('punch')">
        <span class="fx-icon">👊</span>
        <span class="fx-name">Punch</span>
      </button>
      <button class="fx-btn" onclick="triggerFx('flow')">
        <span class="fx-icon">🌊</span>
        <span class="fx-name">Flow</span>
      </button>
      <button class="fx-btn" onclick="triggerFx('ride')">
        <span class="fx-icon">🎢</span>
        <span class="fx-name">Ride</span>
      </button>
      <button class="fx-btn" onclick="triggerFx('stutter')">
        <span class="fx-icon">✂️</span>
        <span class="fx-name">Stutter</span>
      </button>
      <button class="fx-btn" onclick="triggerFx('echo')">
        <span class="fx-icon">📢</span>
        <span class="fx-name">Echo</span>
      </button>
      <button class="fx-btn" onclick="triggerFx('black')">
        <span class="fx-icon">⬛</span>
        <span class="fx-name">Black</span>
      </button>
    </div>
  </div>
  
  <!-- MIC PANEL -->
  <div class="panel mic-panel">
    <div class="panel-header">
      <span class="panel-title">🎤 Mic</span>
      <div class="mic-level" id="micLevelDisplay">
        <span class="level-bar"></span>
        <span class="level-bar"></span>
        <span class="level-bar"></span>
        <span class="level-bar"></span>
        <span class="level-bar"></span>
        <span class="level-bar dim"></span>
        <span class="level-bar dim"></span>
        <span class="level-bar dim"></span>
        <span class="level-bar dim"></span>
        <span class="level-bar dim"></span>
      </div>
    </div>
    <div class="panel-body">
      <div class="mic-input-select">
        <label>Input Source</label>
        <select id="micSource" onchange="changeMic(this.value)">
          <option value="">Select microphone...</option>
        </select>
      </div>
      
      <div class="mic-gain">
        <label>Gain</label>
        <div class="range-wrap">
          <input type="range" id="micGain" min="0" max="100" value="65" oninput="updateGain(this.value)">
          <span class="range-value" id="gainValue">65</span>
        </div>
      </div>
      
      <div class="mic-monitor">
        <label class="toggle">
          <input type="checkbox" id="micMonitor" checked onchange="toggleMonitor(this.checked)">
          <span class="toggle-switch"></span>
          Monitor
        </label>
      </div>
      
      <div class="mic-reactive">
        <label>Vocal Reactivity</label>
        <div class="reactive-modes">
          <button class="reactive-mode active" onclick="selectReactive(this, 'punch')">
            <span class="mode-icon">👊</span>
            <span class="mode-name">Punch</span>
            <span class="mode-desc">Hard cuts on plosives</span>
          </button>
          <button class="reactive-mode" onclick="selectReactive(this, 'flow')">
            <span class="mode-icon">🌊</span>
            <span class="mode-name">Flow</span>
            <span class="mode-desc">Smooth rides the pocket</span>
          </button>
          <button class="reactive-mode" onclick="selectReactive(this, 'ride')">
            <span class="mode-icon">🎢</span>
            <span class="mode-name">Ride</span>
            <span class="mode-desc">Follows every inflection</span>
          </button>
        </div>
      </div>
      
      <div class="mic-enhance">
        <label class="toggle">
          <input type="checkbox" id="vocalEnhance" checked>
          <span class="toggle-switch"></span>
          Vocal Enhancer
        </label>
      </div>
      
      <div class="camera-toggle">
        <label class="toggle">
          <input type="checkbox" id="cameraToggle" onchange="toggleCameraMode(this.checked)">
          <span class="toggle-switch"></span>
          Enable Camera
        </label>
        <div class="camera-options" id="cameraOptions">
          <button class="cam-mode-btn active" onclick="setCameraMode('pip')">Picture-in-Picture</button>
          <button class="cam-mode-btn" onclick="setCameraMode('background')">Full Background</button>
          <button class="cam-mode-btn" onclick="setCameraMode('greenscreen')">Green Screen</button>
        </div>
      </div>
    </div>
  </div>
  
  <!-- TRANSPORT -->
  <div class="transport-bar">
    <div class="transport-main">
      <button class="transport-btn" style="width:auto; padding:0 10px; border-radius:16px; font-size:0.75rem;">⏮ 30s</button>
      <button class="transport-btn play" onclick="togglePlay()">▶</button>
      <button class="transport-btn" style="width:auto; padding:0 10px; border-radius:16px; font-size:0.75rem;">30s ⏭</button>
    </div>
    
    <div class="time-display">
      <span id="currentTime">0:00</span>
      <span class="time-sep">/</span>
      <span id="totalTime">0:00</span>
    </div>
    
    <div class="transport-rec">
      <button class="btn btn-rec" id="mainRecBtn" onclick="toggleRecord()">● REC</button>
      <div class="rec-timer" id="recTimer">00:00</div>
    </div>
    
    <div class="transport-save">
      <button class="btn btn-secondary" onclick="saveSession()">💾 Save</button>
      <button class="btn btn-success" onclick="exportVideo()">⬇ Export</button>
    </div>
  </div>
  
</div>

<script>
// ======== SWRMediaInput Class (from section 2) ========
// [Embed full SWRMediaInput class here]

// ======== STATE ========
const state = {
  media: null,
  isPlaying: false,
  isRecording: false,
  recStartTime: null,
  recInterval: null,
  beatAudio: null,
  beatBuffer: null,
  visualStyle: 'pocket',
  vocalMode: 'punch',
  cameraMode: 'off'
};

// ======== INIT ========
async function init() {
  state.media = new SWRMediaInput({
    videoResolution: { width: 1280, height: 720 },
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: false
  });
  
  // Populate mic devices
  await populateDevices();
  
  // Start with mic
  await initMic();
  
  // Start render loop
  renderLoop();
}

async function populateDevices() {
  const devices = await navigator.mediaDevices.enumerateDevices();
  
  const micSelect = document.getElementById('micSource');
  micSelect.innerHTML = '<option value="">Select microphone...</option>';
  
  devices.filter(d => d.kind === 'audioinput').forEach(device => {
    const option = document.createElement('option');
    option.value = device.deviceId;
    option.textContent = device.label || `Microphone ${micSelect.length}`;
    micSelect.appendChild(option);
  });
}

async function initMic() {
  const result = await state.media.startMic();
  
  if (result.success) {
    document.getElementById('micStatus').classList.add('active');
    document.getElementById('micStatus').innerHTML = '<span class="dot"></span> Mic On';
    
    // Start level meter
    updateMicLevel();
  } else {
    console.error('Mic failed:', result.error);
  }
}

function updateMicLevel() {
  if (!state.media.analyser) return;
  
  const data = new Uint8Array(state.media.analyser.frequencyBinCount);
  state.media.analyser.getByteFrequencyData(data);
  
  const avg = data.reduce((a, b) => a + b) / data.length;
  const level = Math.min(Math.floor(avg / 25), 10);
  
  const bars = document.querySelectorAll('#micLevelDisplay .level-bar');
  bars.forEach((bar, i) => {
    bar.classList.toggle('dim', i >= level);
  });
  
  requestAnimationFrame(updateMicLevel);
}

// ======== BEAT ========
function loadBeat(file) {
  if (!file) return;
  
  const reader = new FileReader();
  reader.onload = async (e) => {
    const arrayBuffer = e.target.result;
    
    // Decode
    const audioCtx = new AudioContext();
    state.beatBuffer = await audioCtx.decodeAudioData(arrayBuffer.slice(0));
    
    // Show loaded state
    document.getElementById('beatDrop').classList.add('hidden');
    document.getElementById('beatLoaded').classList.add('active');
    document.getElementById('beatTitle').textContent = file.name.replace(/\.[^/.]+$/, '');
    document.getElementById('beatStatus').classList.add('active');
    document.getElementById('beatStatus').innerHTML = '<span class="dot"></span> Beat Loaded';
    
    // Detect BPM (mock)
    document.getElementById('beatBpm').textContent = Math.floor(Math.random() * 40 + 80) + ' BPM';
    
    // Draw waveform
    drawWaveform();
  };
  reader.readAsArrayBuffer(file);
}

function drawWaveform() {
  const canvas = document.getElementById('waveformCanvas');
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  
  ctx.fillStyle = '#ff6b00';
  for (let i = 0; i < 60; i++) {
    const h = Math.random() * 36 + 4;
    ctx.fillRect(i * 4 + 1, (44 - h) / 2, 2, h);
  }
}

function toggleBeat() {
  const btn = document.getElementById('beatPlayBtn');
  const isPlaying = btn.textContent === '⏸';
  
  if (isPlaying) {
    btn.textContent = '▶';
    if (state.beatAudio) {
      state.beatAudio.stop();
      state.beatAudio = null;
    }
  } else {
    btn.textContent = '⏸';
    if (state.beatBuffer) {
      const ctx = new AudioContext();
      state.beatAudio = ctx.createBufferSource();
      state.beatAudio.buffer = state.beatBuffer;
      state.beatAudio.connect(ctx.destination);
      state.beatAudio.start();
    }
  }
}

// ======== CAMERA ========
async function toggleCameraMode(enabled) {
  const options = document.getElementById('cameraOptions');
  options.classList.toggle('active', enabled);
  
  if (!enabled) {
    state.media.stopCamera();
    document.getElementById('cameraPip').classList.remove('active');
    document.getElementById('camStatus').classList.remove('active');
    state.cameraMode = 'off';
    return;
  }
  
  // Default to PIP
  setCameraMode('pip');
}

async function setCameraMode(mode) {
  state.cameraMode = mode;
  
  // Update UI
  document.querySelectorAll('.cam-mode-btn').forEach(b => b.classList.remove('active'));
  event.target.classList.add('active');
  
  if (mode === 'off') {
    state.media.stopCamera();
    document.getElementById('cameraPip').classList.remove('active');
    return;
  }
  
  const result = await state.media.startCamera(mode === 'pip' ? null : { width: 1080, height: 1920 });
  
  if (result.success) {
    document.getElementById('camStatus').classList.add('active');
    document.getElementById('camStatus').innerHTML = '<span class="dot"></span> Cam On';
    
    if (mode === 'pip') {
      const video = document.getElementById('pipVideo');
      video.srcObject = result.stream;
      document.getElementById('cameraPip').classList.add('active');
    }
  }
}

async function switchCamera() {
  const result = await state.media.switchCamera();
  if (result.success) {
    document.getElementById('pipVideo').srcObject = result.stream;
  }
}

function toggleCamera() {
  toggleCameraMode(false);
  document.getElementById('cameraToggle').checked = false;
}

// ======== VISUALS ========
const canvas = document.getElementById('reactiveCanvas');
const ctx = canvas.getContext('2d');

function renderLoop() {
  const time = performance.now() / 1000;
  
  // Background
  ctx.fillStyle = '#0a0d12';
  ctx.fillRect(0, 0, 1080, 1920);
  
  // Beat reactive
  const beatPulse = Math.sin(time * 3) * 0.5 + 0.5;
  
  // Base gradient
  const gradient = ctx.createRadialGradient(540, 960, 0, 540, 960, 900);
  gradient.addColorStop(0, `hsla(${20 + beatPulse * 20}, 70%, 15%, 1)`);
  gradient.addColorStop(1, '#0a0d12');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 1080, 1920);
  
  // Beat circle
  ctx.beginPath();
  ctx.arc(540, 700, 250 + beatPulse * 60, 0, Math.PI * 2);
  ctx.strokeStyle = `rgba(255, 107, 0, ${0.2 + beatPulse * 0.4})`;
  ctx.lineWidth = 6;
  ctx.stroke();
  
  // Vocal reactive (if mic active)
  if (state.media.analyser) {
    const data = new Uint8Array(state.media.analyser.frequencyBinCount);
    state.media.analyser.getByteFrequencyData(data);
    const energy = data.slice(0, 50).reduce((a, b) => a + b) / 50;
    
    // Energy ring
    const ringSize = 180 + (energy / 255) * 200;
    ctx.beginPath();
    ctx.arc(540, 700, ringSize, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(0, 242, 234, ${energy / 255 * 0.6})`;
    ctx.lineWidth = 4;
    ctx.stroke();
    
    // Plosive flash
    const plosive = data.slice(5, 25).reduce((a, b) => a + b) / 20;
    if (plosive > 180) {
      ctx.fillStyle = `rgba(255, 0, 80, ${(plosive - 180) / 75 * 0.3})`;
      ctx.fillRect(0, 0, 1080, 1920);
    }
  }
  
  // Center text
  ctx.fillStyle = 'white';
  ctx.font = 'bold 72px -apple-system, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('SPIT LIVE', 540, 1000);
  
  ctx.font = '400 32px -apple-system, sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  ctx.fillText(state.beatBuffer ? 'Beat loaded · Press REC' : 'Drop a beat to start', 540, 1050);
  
  requestAnimationFrame(renderLoop);
}

// ======== FX ========
function triggerFx(fx) {
  document.querySelectorAll('.fx-btn').forEach(b => b.classList.remove('active'));
  event.currentTarget.classList.add('active');
  
  if (fx === 'black') {
    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, 1080, 1920);
    setTimeout(() => {
      ctx.fillStyle = 'black';
      ctx.fillRect(0, 0, 1080, 1920);
    }, 50);
  }
  
  console.log('FX:', fx);
}

// ======== CONTROLS ========
function selectVisual(btn, style) {
  document.querySelectorAll('.visual-pill').forEach(p => p.classList.remove('active'));
  btn.classList.add('active');
  state.visualStyle = style;
}

function selectReactive(btn, mode) {
  document.querySelectorAll('.reactive-mode').forEach(m => m.classList.remove('active'));
  btn.classList.add('active');
  state.vocalMode = mode;
}

function updateGain(val) {
  document.getElementById('gainValue').textContent = val;
  // Apply to media input
  if (state.media.audio.track) {
    // Web Audio gain node would go here
  }
}

function toggleMonitor(checked) {
  console.log('Monitor:', checked);
}

function changeMic(deviceId) {
  if (!deviceId) return;
  state.media.stopMic();
  state.media.startMic(deviceId).then(result => {
    if (result.success) updateMicLevel();
  });
}

// ======== RECORDING ========
async function toggleRecord() {
  if (state.isRecording) {
    stopRecording();
  } else {
    startRecording();
  }
}

async function startRecording() {
  state.isRecording = true;
  state.recStartTime = Date.now();
  
  document.getElementById('recBtn').classList.add('recording');
  document.getElementById('mainRecBtn').classList.add('recording');
  document.getElementById('recStatus').classList.remove('hidden');
  
  // Start MediaRecorder
  const result = await state.media.startRecording(canvas, {
    canvasFps: 30,
    videoBitrate: 8000000,
    audioBitrate: 128000
  });
  
  console.log('Recording started:', result);
  
  // Timer
  recInterval = setInterval(() => {
    const elapsed = Math.floor((Date.now() - state.recStartTime) / 1000);
    const m = Math.floor(elapsed / 60).toString().padStart(2, '0');
    const s = (elapsed % 60).toString().padStart(2, '0');
    document.getElementById('recTimer').textContent = `${m}:${s}`;
  }, 1000);
}

async function stopRecording() {
  state.isRecording = false;
  clearInterval(recInterval);
  
  document.getElementById('recBtn').classList.remove('recording');
  document.getElementById('mainRecBtn').classList.remove('recording');
  document.getElementById('recStatus').classList.add('hidden');
  
  const result = await state.media.stopRecording();
  
  if (result) {
    // Offer download
    const a = document.createElement('a');
    a.href = result.url;
    a.download = `spit-live-${Date.now()}.webm`;
    a.click();
    
    console.log('Exported:', result.size, 'bytes');
  }
}

// ======== UTILS ========
function togglePlay() {
  state.isPlaying = !state.isPlaying;
}

function saveSession() {
  console.log('Saving session...');
}

function exportVideo() {
  if (state.isRecording) {
    stopRecording();
  } else {
    // Export last recording or prompt to record
    console.log('Export...');
  }
}

// ======== DRAG AND DROP ========
const beatDrop = document.getElementById('beatDrop');
beatDrop.addEventListener('dragover', (e) => {
  e.preventDefault();
  beatDrop.classList.add('drag-over');
});
beatDrop.addEventListener('dragleave', () => {
  beatDrop.classList.remove('drag-over');
});
beatDrop.addEventListener('drop', (e) => {
  e.preventDefault();
  beatDrop.classList.remove('drag-over');
  loadBeat(e.dataTransfer.files[0]);
});

// ======== INIT ========
init();
</script>

</body>
</html>
```

---

## 8. Hermes Prompt

```
You are integrating live camera and microphone recording into 
Sainted Word Records, a browser-native audio-reactive video engine.

SYSTEM: SWRMediaInput

Implement a unified MediaInput class that handles:
1. Camera access: getUserMedia with device selection, resolution, facing mode
2. Microphone access: getUserMedia with device selection, processing constraints
3. Audio analysis: AnalyserNode for frequency, time domain, feature extraction
4. Recording: MediaRecorder combining canvas + camera + mic streams
5. Permission handling: graceful degradation, blocked state UI

PAGES TO INTEGRATE:

1. SPIT LIVE (/spit) — Hip-hop freestyle studio
   - Camera: optional PIP, background, or green screen
   - Mic: primary input, freestyle vocals
   - Recording: performance capture with dual reactive layers

2. TIKTOK STUDIO (/tiktok) — TikTok creator page
   - Camera: reaction videos, duets, stitches
   - Mic: lip sync guide, duet vocals
   - Recording: reaction format with original audio + camera

3. LIVE CONTROL ROOM (/live) — VJ performance
   - Camera: stage feeds, crowd shots, multiple inputs
   - Mic: venue mix or MC microphone
   - Recording: full set capture with multi-angle

CONSTRAINTS:
- Zero backend, all browser APIs
- getUserMedia, MediaRecorder, Web Audio API, Canvas 2D
- Graceful degradation: camera optional, mic required for recording
- Mobile support: iOS Safari limitations (no background recording, user gesture required)

DELIVERABLE:
1. SWRMediaInput class (standalone, reusable)
2. CameraPreview component (HTML/CSS/JS)
3. MicMeter component (waveform + level bars)
4. PermissionManager (permission UI + blocked states)
5. Integration into Spit Live page (full HTML with all components)

DESIGN:
- Dark theme, orange/pink/cyan accents
- Large touch targets for performance use
- Clear visual feedback: recording indicators, level meters, stream status
- Mobile-first for camera pages, desktop-flexible for others
```

---

*End of Live Camera & Mic Recording PRD. Complete system for real-time performance capture across all SWR creation pages.*