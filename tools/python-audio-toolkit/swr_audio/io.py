"""Load / save mono PCM for the toolkit.

MP3 and other compressed formats go through ffmpeg (already required by the
repo). WAV uses the stdlib `wave` module so process/overdub work without
PyAudio.
"""
from __future__ import annotations

import subprocess
import wave
from pathlib import Path

import numpy as np

DEFAULT_SR = 16000


def load_audio(path: str | Path, sample_rate: int = DEFAULT_SR) -> tuple[np.ndarray, int]:
    """Decode any ffmpeg-readable file to float32 mono in [-1, 1]."""
    path = Path(path)
    if not path.is_file():
        raise FileNotFoundError(path)

    if path.suffix.lower() == '.wav':
        return _load_wav(path, sample_rate)

    cmd = [
        'ffmpeg', '-v', 'error', '-i', str(path),
        '-f', 's16le', '-acodec', 'pcm_s16le',
        '-ac', '1', '-ar', str(sample_rate), '-',
    ]
    proc = subprocess.run(cmd, capture_output=True, timeout=120)
    if proc.returncode != 0:
        err = (proc.stderr or b'').decode('utf-8', 'replace')[:400]
        raise RuntimeError(f'ffmpeg failed for {path}: {err}')
    n = len(proc.stdout) // 2
    if n == 0:
        raise RuntimeError(f'no samples decoded from {path}')
    samples = np.frombuffer(proc.stdout, dtype='<i2').astype(np.float32) / 32768.0
    return samples, sample_rate


def _load_wav(path: Path, sample_rate: int) -> tuple[np.ndarray, int]:
    with wave.open(str(path), 'rb') as wf:
        nch = wf.getnchannels()
        sw = wf.getsampwidth()
        sr = wf.getframerate()
        nframes = wf.getnframes()
        raw = wf.readframes(nframes)

    if sw == 2:
        data = np.frombuffer(raw, dtype='<i2').astype(np.float32) / 32768.0
    elif sw == 1:
        data = (np.frombuffer(raw, dtype=np.uint8).astype(np.float32) - 128.0) / 128.0
    else:
        raise RuntimeError(f'unsupported WAV sample width {sw} in {path}')

    if nch > 1:
        data = data.reshape(-1, nch).mean(axis=1)

    if sr != sample_rate and len(data) > 1:
        # Lightweight linear resample — enough for analysis / overdub.
        duration = len(data) / float(sr)
        target_n = max(1, int(round(duration * sample_rate)))
        x_old = np.linspace(0.0, 1.0, num=len(data), endpoint=False)
        x_new = np.linspace(0.0, 1.0, num=target_n, endpoint=False)
        data = np.interp(x_new, x_old, data).astype(np.float32)
        sr = sample_rate

    return data.astype(np.float32), sr


def save_wav(path: str | Path, samples: np.ndarray, sample_rate: int = DEFAULT_SR) -> Path:
    """Write mono float/int samples as 16-bit PCM WAV."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    arr = np.asarray(samples, dtype=np.float32)
    arr = np.clip(arr, -1.0, 1.0)
    pcm = (arr * 32767.0).astype(np.int16)
    with wave.open(str(path), 'wb') as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(int(sample_rate))
        wf.writeframes(pcm.tobytes())
    return path


def float_to_int16(samples: np.ndarray) -> np.ndarray:
    arr = np.clip(np.asarray(samples, dtype=np.float32), -1.0, 1.0)
    return (arr * 32767.0).astype(np.int16)
