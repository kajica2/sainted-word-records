# Third-party notice

This directory adapts patterns from
[Matin-python/Python-Audio-Processing-Toolkit](https://github.com/Matin-python/Python-Audio-Processing-Toolkit)
(MIT License, © 2026 MohammadReza Bakhshandeh).

The upstream project ships interactive demo scripts (PyAudio mic capture,
Matplotlib `plt.show()` windows). Sainted Word Records wraps those DSP and
recording ideas as a **callable CLI / library** so they can:

- process existing songs offline (FFT, spectrogram summary, envelope, onsets)
- record **additional** audio takes (fixed duration or voice-activity)
- overdub a take onto a base track for Media Source “external audio”

See `LICENSE.Matin-python.txt` for the upstream license text.
