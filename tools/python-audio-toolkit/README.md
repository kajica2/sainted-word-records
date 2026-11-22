# SWR Python Audio Toolkit

Local DSP + additional-audio recording for Sainted Word Records, adapted from
[Matin-python/Python-Audio-Processing-Toolkit](https://github.com/Matin-python/Python-Audio-Processing-Toolkit)
(MIT).

Upstream demos are interactive Matplotlib / PyAudio scripts. This package
turns the same ideas into a **CLI the repo can gate**:

| Command | What it does |
|---------|----------------|
| `process` | FFT, spectrogram bands, RMS envelope, onsets, BPM → JSON (+ optional PNGs) |
| `record` | Record an **additional** mic take (fixed duration or VAD) → WAV |
| `take` | Promote any file as a take without a microphone (CI / headless) |
| `overdub` | Mix a take onto a base song for Media Source “external audio” |
| `selftest` | Synthetic signal gate — no mic, no network |

## Install

```bash
# Core (process / take / overdub / selftest)
pip install -r tools/python-audio-toolkit/requirements.txt

# Optional mic recording (needs PortAudio system package)
#   Debian/Ubuntu: sudo apt-get install portaudio19-dev
#   macOS: brew install portaudio
pip install -r tools/python-audio-toolkit/requirements-record.txt
```

Or via npm:

```bash
npm run audio:toolkit:install
```

## Usage

```bash
# Analyze a demo song + write plots
npm run audio:process -- audios/neon.mp3 --plots out/audio-toolkit --out-json out/audio-toolkit/neon.json

# Record 5s of additional audio (mic)
npm run audio:record -- --seconds 5 --out data/audio-takes/take.wav

# Voice-activity recording
npm run audio:record -- --vad --out data/audio-takes/vad.wav --env-skip

# Promote a file as a take, then overdub onto a song
npm run audio:take -- --from audios/aurora.mp3 --out data/audio-takes/aurora-take.wav
npm run audio:overdub -- --base audios/neon.mp3 --add data/audio-takes/aurora-take.wav \
  --out out/audio-toolkit/neon-overdub.wav --offset-ms 0
```

Drop the overdub WAV into the engine’s **Media Source → external audio** slot.

## Gate

```bash
npm run check:audio-toolkit
```

Runs `selftest` (synthetic tone → FFT peak ≈ 440 Hz, spectrogram bands, plots,
file take, overdub). Mic recording is env-skipped when PyAudio is absent.
