#!/usr/bin/env python3
"""
analyze_reel_audio.py — study the audio before composing a timeline.

Reads every audio/track, computes an RMS-energy envelope at ~50ms windows,
finds onsets (energy jumps above an adaptive threshold), estimates BPM from
inter-onset intervals, and identifies natural "story beats":
  - first onset          (song starts)
  - intro silence/lift   (low-RMS region after the first drop)
  - vocal-onset estimate  (first big mid-band jump)
  - BPM estimate         (median inter-onset interval)
  - suggested panel cuts (at natural energy boundaries)

Outputs JSON to stdout so the timeline composer can consume it.
"""
import json
import os
import glob
import subprocess
import struct
import sys
from statistics import median

WINDOW_S = 0.05            # 50ms analysis windows
SR = 8000                  # decoded sample rate
ONSET_RATIO = 1.6          # window / local-average threshold for onset
MIN_ONSET_GAP_S = 0.18     # refractory period between onsets
INTRO_SILENCE_DB = -38.0   # anything below this counts as silence
SILENCE_MIN_S = 0.5        # min duration to count as an intro silence


def decode_mp3(path):
    r = subprocess.run([
        'ffmpeg', '-v', 'error', '-i', path,
        '-f', 's16le', '-acodec', 'pcm_s16le',
        '-ac', '1', '-ar', str(SR), '-'
    ], capture_output=True, timeout=30)
    if r.returncode != 0:
        return None
    # Decode as signed 16-bit little-endian
    n = len(r.stdout) // 2
    samples = struct.unpack(f'<{n}h', r.stdout[:n * 2])
    return samples


def rms_envelope(samples, win):
    n = len(samples) // win
    env = []
    for i in range(n):
        chunk = samples[i * win:(i + 1) * win]
        if not chunk:
            break
        s = sum(x * x for x in chunk) / win
        env.append((s ** 0.5) / 32768.0)  # 0..1
    return env


def find_onsets(env, sr=SR):
    win = int(WINDOW_S * sr / (sr * WINDOW_S))  # already 50ms in samples
    # Adaptive threshold: local mean over a 400ms trailing window.
    traila = max(1, int(0.4 / WINDOW_S))
    onsets = []  # list of (time_s, rms_value)
    for i, v in enumerate(env):
        lo = max(0, i - traila)
        local = env[lo:i] or [0]
        avg = sum(local) / len(local)
        if v > avg * ONSET_RATIO and v > 0.05:
            t_s = i * WINDOW_S
            if not onsets or (t_s - onsets[-1][0]) > MIN_ONSET_GAP_S:
                onsets.append((t_s, v))
    return onsets


def estimate_bpm(onsets):
    if len(onsets) < 4:
        return None
    intervals = [b[0] - a[0] for a, b in zip(onsets, onsets[1:])]
    # Restrict to plausible beat intervals (0.25–1.0s → 60–240 BPM)
    intervals = [iv for iv in intervals if 0.25 <= iv <= 1.0]
    if len(intervals) < 4:
        return None
    med = median(intervals)
    return round(60.0 / med, 1) if med > 0 else None


def find_intro_silence(env):
    """First contiguous low-RMS region at the start of the track."""
    if not env:
        return None
    silence_idx = []
    # Use 0.05 RMS as the silence threshold (empirical for these loops).
    for i, v in enumerate(env):
        if v < 0.05:
            silence_idx.append(i)
    if not silence_idx:
        return 0.0
    # Consecutive run from the start.
    run_end = 0
    for i, idx in enumerate(silence_idx):
        if idx != i:
            break
        run_end = i + 1
    dur = run_end * WINDOW_S
    return dur if dur >= SILENCE_MIN_S else 0.0


def find_story_beats(env, bpm, onsets):
    """Pick three natural 'story beat' times: intro_end, vocal_onset, climax.

    intro_end   — first time RMS rises above 30% of max (intro releases)
    vocal_onset — first time RMS jumps from < 0.2 to > 0.4 within 200ms
    climax      — peak RMS time (audio climax)
    """
    if not env:
        return None
    n = len(env)
    max_rms = max(env) or 1
    # intro_end
    intro_end = None
    for i, v in enumerate(env):
        if v > 0.3 * max_rms:
            intro_end = round(i * WINDOW_S, 2)
            break
    # vocal_onset: look for a jump from low to high RMS
    vocal_onset = None
    for i in range(1, n):
        if env[i] > 0.4 and env[i - 1] < 0.2:
            vocal_onset = round(i * WINDOW_S, 2)
            break
    # climax: peak RMS
    peak_idx = max(range(n), key=lambda i: env[i])
    climax = round(peak_idx * WINDOW_S, 2)
    return {
        'intro_end_s': intro_end,
        'vocal_onset_s': vocal_onset,
        'climax_s': climax,
    }


def analyze(path):
    samples = decode_mp3(path)
    if not samples:
        return None
    env = rms_envelope(samples, int(SR * WINDOW_S))
    onsets = find_onsets(env)
    bpm = estimate_bpm(onsets)
    beats = find_story_beats(env, bpm, onsets)
    return {
        'path': path,
        'duration_s': round(len(samples) / SR, 2),
        'bpm': bpm,
        'onset_count': len(onsets),
        'first_onset_s': round(onsets[0][0], 2) if onsets else None,
        'beats': beats,
        'rms_max': round(max(env) or 0, 3),
        'rms_mean': round(sum(env) / len(env), 3),
    }


def score_for_storyboard(a):
    """Score a track for the rooftop-at-night storyboard.

    Storyboard wants: slow intro, atmospheric, vocal arrives at 4s, cue for
    match-cut around first vocal, then dissolve on vocal completion. Shorter
    tracks with a clear vocal onset score higher.
    """
    if not a or not a.get('bpm'):
        return 0
    beats = a.get('beats') or {}
    score = 0
    # 1. BPM in a contemplative/slow range: 60–100
    bpm = a['bpm']
    if 60 <= bpm <= 100:
        score += 30
    elif 100 < bpm <= 130:
        score += 15
    # 2. vocal_onset exists and lands in 2–6s window (matches the 0:04 cut)
    vo = beats.get('vocal_onset_s')
    if vo is not None:
        if 2.5 <= vo <= 6:
            score += 40
        elif 1.5 <= vo <= 8:
            score += 25
        else:
            score += 5
    # 3. climax at least 5s in (room for the dissolve to land)
    cl = beats.get('climax_s')
    if cl is not None and cl >= 5:
        score += 20
    # 4. intro_end in 1–3s (atmospheric lift before vocals)
    ie = beats.get('intro_end_s')
    if ie is not None and 1 <= ie <= 3.5:
        score += 10
    return score


def main():
    results = []
    for path in sorted(glob.glob('audios/*.mp3')):
        a = analyze(path)
        if a:
            a['score'] = score_for_storyboard(a)
            results.append(a)
    results.sort(key=lambda x: x['score'], reverse=True)
    print(json.dumps(results, indent=2))


if __name__ == '__main__':
    main()