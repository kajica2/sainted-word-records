"""Mix an additional take onto a base track (overdub).

The engine's Media Source panel already accepts an external audio file as
the master clock. This helper produces that file by laying a recorded take
over (or next to) the song.
"""
from __future__ import annotations

from pathlib import Path
from typing import Any

import numpy as np

from .io import DEFAULT_SR, load_audio, save_wav


def overdub(
    base_path: str | Path,
    add_path: str | Path,
    *,
    out_path: str | Path,
    offset_ms: float = 0.0,
    add_gain: float = 1.0,
    base_gain: float = 1.0,
    sample_rate: int = DEFAULT_SR,
    replace: bool = False,
) -> dict[str, Any]:
    """Mix `add` onto `base` starting at `offset_ms`.

    When `replace` is True the base is silenced under the take window
    (useful for dialogue/overdub). Otherwise both layers sum.
    """
    base, sr = load_audio(base_path, sample_rate=sample_rate)
    add, _ = load_audio(add_path, sample_rate=sample_rate)

    offset = max(0, int(round((offset_ms / 1000.0) * sr)))
    total = max(len(base), offset + len(add))
    out = np.zeros(total, dtype=np.float32)
    out[: len(base)] = base * float(base_gain)

    end = offset + len(add)
    if replace:
        out[offset:end] = 0.0
    out[offset:end] += add * float(add_gain)

    peak = float(np.max(np.abs(out))) if out.size else 0.0
    if peak > 1.0:
        out = out / peak

    path = save_wav(out_path, out, sr)
    return {
        'path': str(path),
        'sample_rate': sr,
        'duration_s': round(out.size / float(sr), 3),
        'offset_ms': float(offset_ms),
        'base_gain': float(base_gain),
        'add_gain': float(add_gain),
        'replace': bool(replace),
        'peak': round(float(np.max(np.abs(out))) if out.size else 0.0, 4),
    }
