# Python Audio Toolkit

Enhanced offline audio signal processing and **additional audio** recording
for Sainted Word Records.

## Why

Browser analysis (`audio-analysis-v2.js`) drives the live engine. Batch and
lab work also need a **local Python path** that can:

1. Deep-inspect a track (FFT, spectrogram bands, envelope, onsets, BPM)
2. Capture an extra mic take (voiceover / overdub / room tone)
3. Mix that take onto the song as a WAV the Media Source panel can load

This wraps
[Matin-python/Python-Audio-Processing-Toolkit](https://github.com/Matin-python/Python-Audio-Processing-Toolkit)
(MIT) into `tools/python-audio-toolkit/` — same DSP ideas, callable CLI,
CI-safe selftest.

## Install

```bash
npm run audio:toolkit:install
# mic extras (optional):
# sudo apt-get install portaudio19-dev   # or brew install portaudio
# pip install -r tools/python-audio-toolkit/requirements-record.txt
```

## Commands

| npm script | CLI | Notes |
|------------|-----|-------|
| `audio:process` | `process <file>` | JSON analysis; `--plots` writes PNGs |
| `audio:record` | `record` | Mic take; `--vad` for speech gate; `--env-skip` in CI |
| `audio:take` | `take --from <file>` | File → take without a mic |
| `audio:overdub` | `overdub --base … --add … --out …` | Mix for external audio |
| `check:audio-toolkit` | `selftest` | Synthetic gate |

## Engine handoff

1. Record or promote a take → `data/audio-takes/*.wav`
2. Overdub onto the song → `out/audio-toolkit/*.wav`
3. In `/engine` or `/versions/neon`, open **Media Source** → choose
   **external audio** → load the overdub WAV

The preview and export already record whatever `Audio.analyser` hears, so
the additional layer rides along once it is the external clock.

## Attribution

See `tools/python-audio-toolkit/NOTICE.md` and
`tools/python-audio-toolkit/LICENSE.Matin-python.txt`.
