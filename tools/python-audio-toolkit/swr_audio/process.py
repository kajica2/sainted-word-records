"""Enhanced signal processing adapted from the Matin toolkit demos.

Upstream scripts plot FFT / spectrogram interactively. Here we return the
same quantities as JSON-friendly summaries the engine / batch tools can use,
plus onset / BPM helpers aligned with `scripts/analyze_reel_audio.py`.
"""
from __future__ import annotations

from pathlib import Path
from statistics import median
from typing import Any

import numpy as np

from .io import DEFAULT_SR, load_audio

WINDOW_S = 0.05
ONSET_RATIO = 1.6
MIN_ONSET_GAP_S = 0.18


def rms_envelope(samples: np.ndarray, sample_rate: int, window_s: float = WINDOW_S) -> np.ndarray:
    win = max(1, int(sample_rate * window_s))
    n = len(samples) // win
    if n == 0:
        return np.zeros(0, dtype=np.float32)
    trimmed = samples[: n * win].reshape(n, win)
    env = np.sqrt(np.mean(trimmed * trimmed, axis=1)).astype(np.float32)
    return env


def find_onsets(env: np.ndarray, window_s: float = WINDOW_S) -> list[tuple[float, float]]:
    if env.size == 0:
        return []
    trail = max(1, int(0.4 / window_s))
    onsets: list[tuple[float, float]] = []
    for i, v in enumerate(env):
        lo = max(0, i - trail)
        local = env[lo:i]
        avg = float(local.mean()) if local.size else 0.0
        if v > avg * ONSET_RATIO and v > 0.05:
            t_s = i * window_s
            if not onsets or (t_s - onsets[-1][0]) > MIN_ONSET_GAP_S:
                onsets.append((t_s, float(v)))
    return onsets


def estimate_bpm(onsets: list[tuple[float, float]]) -> float | None:
    if len(onsets) < 4:
        return None
    intervals = [b[0] - a[0] for a, b in zip(onsets, onsets[1:])]
    intervals = [iv for iv in intervals if 0.25 <= iv <= 1.0]
    if len(intervals) < 4:
        return None
    med = median(intervals)
    return round(60.0 / med, 1) if med > 0 else None


def fft_magnitude(samples: np.ndarray, sample_rate: int) -> dict[str, Any]:
    """One-sided magnitude spectrum (Matin voice_processing / fixed_time)."""
    n = len(samples)
    if n < 8:
        return {'freqs_hz': [], 'magnitude': [], 'peak_hz': None, 'peak_mag': 0.0}
    # Cap FFT size for large files while keeping spectral shape.
    max_n = min(n, sample_rate * 8)
    chunk = samples[:max_n]
    windowed = chunk * np.hanning(len(chunk))
    spec = np.fft.rfft(windowed)
    mag = np.abs(spec).astype(np.float64)
    freqs = np.fft.rfftfreq(len(chunk), d=1.0 / sample_rate)
    # Downsample to ≤512 bins for JSON.
    bins = min(512, len(mag))
    idx = np.linspace(0, len(mag) - 1, bins).astype(int)
    mag_ds = mag[idx]
    freqs_ds = freqs[idx]
    peak_i = int(np.argmax(mag))
    return {
        'freqs_hz': [round(float(f), 2) for f in freqs_ds],
        'magnitude': [round(float(m), 4) for m in mag_ds],
        'peak_hz': round(float(freqs[peak_i]), 2),
        'peak_mag': round(float(mag[peak_i]), 4),
    }


def spectrogram_summary(samples: np.ndarray, sample_rate: int) -> dict[str, Any]:
    """Compact spectrogram stats via SciPy (Matin plt.specgram equivalent)."""
    try:
        from scipy import signal
    except ImportError as exc:  # pragma: no cover
        raise RuntimeError('scipy is required for spectrogram analysis') from exc

    n = len(samples)
    if n < 256:
        return {'frames': 0, 'bands': {}, 'energy_db': []}

    nperseg = min(1024, n // 4 or 256)
    freqs, times, Sxx = signal.spectrogram(
        samples, fs=sample_rate, nperseg=nperseg, noverlap=nperseg // 2
    )
    # Band energies (mean power)
    def band_power(lo: float, hi: float) -> float:
        mask = (freqs >= lo) & (freqs < hi)
        if not np.any(mask):
            return 0.0
        return float(np.mean(Sxx[mask, :]))

    bands = {
        'sub': band_power(20, 60),
        'bass': band_power(60, 250),
        'mid': band_power(250, 2000),
        'treble': band_power(2000, 6000),
        'air': band_power(6000, min(12000, sample_rate / 2)),
    }
    # Per-frame total energy (dB), downsampled
    frame_e = np.mean(Sxx, axis=0) + 1e-12
    frame_db = 10.0 * np.log10(frame_e)
    bins = min(128, len(frame_db))
    idx = np.linspace(0, len(frame_db) - 1, bins).astype(int)
    return {
        'frames': int(len(times)),
        'duration_s': round(float(times[-1]) if len(times) else 0.0, 3),
        'bands': {k: round(v, 8) for k, v in bands.items()},
        'energy_db': [round(float(v), 2) for v in frame_db[idx]],
    }


def analyze_signal(samples: np.ndarray, sample_rate: int = DEFAULT_SR) -> dict[str, Any]:
    samples = np.asarray(samples, dtype=np.float32)
    env = rms_envelope(samples, sample_rate)
    onsets = find_onsets(env)
    bpm = estimate_bpm(onsets)
    fft = fft_magnitude(samples, sample_rate)
    spec = spectrogram_summary(samples, sample_rate)
    peak = float(np.max(np.abs(samples))) if samples.size else 0.0
    return {
        'sample_rate': int(sample_rate),
        'samples': int(samples.size),
        'duration_s': round(samples.size / float(sample_rate), 3) if sample_rate else 0.0,
        'peak': round(peak, 4),
        'rms_mean': round(float(env.mean()) if env.size else 0.0, 4),
        'rms_max': round(float(env.max()) if env.size else 0.0, 4),
        'onset_count': len(onsets),
        'first_onset_s': round(onsets[0][0], 3) if onsets else None,
        'bpm': bpm,
        'fft': {
            'peak_hz': fft['peak_hz'],
            'peak_mag': fft['peak_mag'],
            # Keep full arrays only when short — CLI can request --full-fft.
            'bins': len(fft['freqs_hz']),
        },
        'spectrogram': spec,
        'source': 'python-audio-toolkit',
        'upstream': 'https://github.com/Matin-python/Python-Audio-Processing-Toolkit',
    }


def process_file(
    path: str | Path,
    sample_rate: int = DEFAULT_SR,
    *,
    full_fft: bool = False,
    plot_dir: str | Path | None = None,
) -> dict[str, Any]:
    samples, sr = load_audio(path, sample_rate=sample_rate)
    result = analyze_signal(samples, sr)
    result['path'] = str(path)
    if full_fft:
        result['fft'] = fft_magnitude(samples, sr)
    if plot_dir is not None:
        result['plots'] = write_plots(samples, sr, plot_dir, stem=Path(path).stem)
    return result


def write_plots(
    samples: np.ndarray,
    sample_rate: int,
    out_dir: str | Path,
    *,
    stem: str = 'audio',
) -> dict[str, str]:
    """Write waveform / spectrogram / FFT PNGs (non-interactive Matplotlib)."""
    import matplotlib

    matplotlib.use('Agg')
    import matplotlib.pyplot as plt

    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    paths: dict[str, str] = {}

    # Waveform (Matin voice_processing first plot)
    fig, ax = plt.subplots(figsize=(10, 3))
    t = np.arange(len(samples)) / float(sample_rate)
    # Downsample plot for large files
    step = max(1, len(samples) // 20000)
    ax.plot(t[::step], samples[::step], color='#ff2d8a', linewidth=0.6)
    ax.set_title(f'Waveform — {stem}')
    ax.set_xlabel('Time (s)')
    ax.set_ylabel('Amplitude')
    wave_path = out / f'{stem}-waveform.png'
    fig.tight_layout()
    fig.savefig(wave_path, dpi=120)
    plt.close(fig)
    paths['waveform'] = str(wave_path)

    # Spectrogram (epsilon avoids log10(0) warnings on silent frames)
    fig, ax = plt.subplots(figsize=(10, 4))
    plot_samples = samples + 1e-9
    ax.specgram(plot_samples, Fs=sample_rate, cmap='magma')
    ax.set_title(f'Spectrogram — {stem}')
    ax.set_xlabel('Time (s)')
    ax.set_ylabel('Frequency (Hz)')
    spec_path = out / f'{stem}-spectrogram.png'
    fig.tight_layout()
    fig.savefig(spec_path, dpi=120)
    plt.close(fig)
    paths['spectrogram'] = str(spec_path)

    # FFT magnitude
    fft = fft_magnitude(samples, sample_rate)
    fig, ax = plt.subplots(figsize=(10, 3))
    ax.plot(fft['freqs_hz'], fft['magnitude'], color='#7cf0ff', linewidth=0.8)
    ax.set_title(f'FFT — {stem}')
    ax.set_xlabel('Frequency (Hz)')
    ax.set_ylabel('|X|')
    fft_path = out / f'{stem}-fft.png'
    fig.tight_layout()
    fig.savefig(fft_path, dpi=120)
    plt.close(fig)
    paths['fft'] = str(fft_path)

    return paths
