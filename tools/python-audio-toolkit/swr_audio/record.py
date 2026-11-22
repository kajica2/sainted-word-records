"""Microphone recording — fixed duration and VAD (Matin recording/*).

PyAudio is optional. When it is missing, callers get a clear
`(env skip: pyaudio)` style error so CI stays green without PortAudio.
"""
from __future__ import annotations

from pathlib import Path
from typing import Any

import numpy as np

from .io import DEFAULT_SR, save_wav

CHUNK = 1024
SILENCE_THRESHOLD = 1000  # Matin voice_activity_recorder peak units (int16 space)
SILENCE_CHUNKS = 50       # ~3s at 16kHz / 1024


class MicUnavailable(RuntimeError):
    """Raised when PyAudio / PortAudio / input device is not available."""


def _pyaudio():
    try:
        import pyaudio  # type: ignore
    except ImportError as exc:
        raise MicUnavailable(
            '(env skip: pyaudio) install PortAudio + '
            '`pip install -r tools/python-audio-toolkit/requirements-record.txt`'
        ) from exc
    return pyaudio


def record_fixed(
    seconds: float = 5.0,
    *,
    sample_rate: int = DEFAULT_SR,
    out_path: str | Path | None = None,
) -> dict[str, Any]:
    """Record a fixed-duration take from the default input device."""
    pa = _pyaudio()
    p = pa.PyAudio()
    stream = None
    try:
        stream = p.open(
            format=pa.paInt16,
            channels=1,
            rate=sample_rate,
            input=True,
            frames_per_buffer=CHUNK,
        )
        frames: list[np.ndarray] = []
        n_chunks = max(1, int(seconds * sample_rate / CHUNK))
        for _ in range(n_chunks):
            data = np.frombuffer(stream.read(CHUNK, exception_on_overflow=False), dtype=np.int16)
            frames.append(data)
        pcm = np.concatenate(frames) if frames else np.zeros(0, dtype=np.int16)
    except Exception as exc:  # device / PortAudio failures
        raise MicUnavailable(f'(env skip: mic) {exc}') from exc
    finally:
        if stream is not None:
            stream.stop_stream()
            stream.close()
        p.terminate()

    samples = pcm.astype(np.float32) / 32768.0
    result: dict[str, Any] = {
        'mode': 'fixed',
        'seconds': float(seconds),
        'sample_rate': sample_rate,
        'samples': int(samples.size),
        'duration_s': round(samples.size / float(sample_rate), 3),
        'peak': round(float(np.max(np.abs(samples))) if samples.size else 0.0, 4),
    }
    if out_path is not None:
        result['path'] = str(save_wav(out_path, samples, sample_rate))
    result['audio'] = samples
    return result


def record_vad(
    *,
    sample_rate: int = DEFAULT_SR,
    silence_threshold: float = SILENCE_THRESHOLD,
    silence_chunks: int = SILENCE_CHUNKS,
    max_seconds: float = 60.0,
    out_path: str | Path | None = None,
) -> dict[str, Any]:
    """Record from first speech until sustained silence (Matin VAD)."""
    pa = _pyaudio()
    p = pa.PyAudio()
    stream = None
    audio = np.zeros(0, dtype=np.int16)
    try:
        stream = p.open(
            format=pa.paInt16,
            channels=1,
            rate=sample_rate,
            input=True,
            frames_per_buffer=CHUNK,
        )
        is_recording = False
        silence_counter = 0
        max_chunks = max(1, int(max_seconds * sample_rate / CHUNK))
        for _ in range(max_chunks):
            data = np.frombuffer(stream.read(CHUNK, exception_on_overflow=False), dtype=np.int16)
            peak = float(np.average(np.abs(data)) * 2)
            if peak > silence_threshold and not is_recording:
                is_recording = True
                silence_counter = 0
                audio = np.zeros(0, dtype=np.int16)
            if is_recording:
                audio = np.append(audio, data)
                if peak < silence_threshold:
                    silence_counter += 1
                else:
                    silence_counter = 0
                if silence_counter > silence_chunks:
                    break
        if not is_recording:
            raise MicUnavailable('(env skip: mic) no speech detected before timeout')
    except MicUnavailable:
        raise
    except Exception as exc:
        raise MicUnavailable(f'(env skip: mic) {exc}') from exc
    finally:
        if stream is not None:
            stream.stop_stream()
            stream.close()
        p.terminate()

    samples = audio.astype(np.float32) / 32768.0
    result: dict[str, Any] = {
        'mode': 'vad',
        'sample_rate': sample_rate,
        'samples': int(samples.size),
        'duration_s': round(samples.size / float(sample_rate), 3),
        'peak': round(float(np.max(np.abs(samples))) if samples.size else 0.0, 4),
    }
    if out_path is not None:
        result['path'] = str(save_wav(out_path, samples, sample_rate))
    result['audio'] = samples
    return result


def record_from_pcm_file(
    pcm_path: str | Path,
    *,
    sample_rate: int = DEFAULT_SR,
    out_path: str | Path | None = None,
    label: str = 'file-take',
) -> dict[str, Any]:
    """Promote an existing PCM/WAV as an “additional audio” take (no mic).

    Useful in CI and headless agents: drop a WAV, get the same take metadata
    shape the mic recorders return.
    """
    from .io import load_audio

    samples, sr = load_audio(pcm_path, sample_rate=sample_rate)
    result: dict[str, Any] = {
        'mode': 'file',
        'label': label,
        'source': str(pcm_path),
        'sample_rate': sr,
        'samples': int(samples.size),
        'duration_s': round(samples.size / float(sr), 3),
        'peak': round(float(np.max(np.abs(samples))) if samples.size else 0.0, 4),
    }
    if out_path is not None:
        result['path'] = str(save_wav(out_path, samples, sr))
    result['audio'] = samples
    return result
