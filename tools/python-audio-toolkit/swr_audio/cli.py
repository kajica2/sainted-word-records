#!/usr/bin/env python3
"""CLI for the SWR Python audio toolkit.

Examples:
  python -m swr_audio process audios/neon.mp3 --plots out/audio-toolkit
  python -m swr_audio record --seconds 5 --out data/audio-takes/take.wav
  python -m swr_audio record --vad --out data/audio-takes/vad.wav
  python -m swr_audio take --from audios/aurora.mp3 --out data/audio-takes/aurora-take.wav
  python -m swr_audio overdub --base song.wav --add take.wav --out mix.wav
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

# Allow `python tools/python-audio-toolkit/swr_audio/cli.py …` without install.
_ROOT = Path(__file__).resolve().parents[1]
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))


def _dump(obj: dict, as_json: bool) -> None:
    # Strip large in-memory arrays before printing.
    clean = {k: v for k, v in obj.items() if k != 'audio'}
    if as_json:
        print(json.dumps(clean, indent=2))
    else:
        for k, v in clean.items():
            if isinstance(v, (dict, list)) and k in ('fft', 'spectrogram', 'plots'):
                print(f'{k}: {json.dumps(v)[:200]}…' if len(json.dumps(v)) > 200 else f'{k}: {v}')
            else:
                print(f'{k}: {v}')


def cmd_process(args: argparse.Namespace) -> int:
    from swr_audio.process import process_file

    result = process_file(
        args.input,
        sample_rate=args.rate,
        full_fft=args.full_fft,
        plot_dir=args.plots,
    )
    if args.out_json:
        Path(args.out_json).parent.mkdir(parents=True, exist_ok=True)
        Path(args.out_json).write_text(json.dumps(result, indent=2) + '\n', encoding='utf-8')
        print(f'wrote {args.out_json}')
    else:
        _dump(result, as_json=True)
    return 0


def cmd_record(args: argparse.Namespace) -> int:
    from swr_audio.record import MicUnavailable, record_fixed, record_vad

    out = args.out or 'data/audio-takes/take.wav'
    try:
        if args.vad:
            result = record_vad(
                sample_rate=args.rate,
                max_seconds=args.max_seconds,
                out_path=out,
            )
        else:
            result = record_fixed(
                seconds=args.seconds,
                sample_rate=args.rate,
                out_path=out,
            )
    except MicUnavailable as exc:
        print(str(exc), file=sys.stderr)
        return 0 if args.env_skip else 2
    _dump(result, as_json=args.json)
    return 0


def cmd_take(args: argparse.Namespace) -> int:
    """Promote a file as an additional-audio take (no microphone)."""
    from swr_audio.record import record_from_pcm_file

    out = args.out or 'data/audio-takes/file-take.wav'
    result = record_from_pcm_file(
        args.source,
        sample_rate=args.rate,
        out_path=out,
        label=args.label or Path(args.source).stem,
    )
    _dump(result, as_json=args.json)
    return 0


def cmd_overdub(args: argparse.Namespace) -> int:
    from swr_audio.mix import overdub

    result = overdub(
        args.base,
        args.add,
        out_path=args.out,
        offset_ms=args.offset_ms,
        add_gain=args.add_gain,
        base_gain=args.base_gain,
        sample_rate=args.rate,
        replace=args.replace,
    )
    _dump(result, as_json=args.json)
    return 0


def cmd_selftest(args: argparse.Namespace) -> int:
    """Synthetic signal gate — no mic, no network."""
    import numpy as np

    from swr_audio.io import save_wav, load_audio
    from swr_audio.mix import overdub
    from swr_audio.process import analyze_signal, process_file
    from swr_audio.record import record_from_pcm_file

    sr = 16000
    t = np.arange(sr * 2) / sr
    # 440 Hz tone + quieter 880 Hz burst in the second half
    tone = 0.4 * np.sin(2 * np.pi * 440 * t)
    tone[sr:] += 0.3 * np.sin(2 * np.pi * 880 * t[sr:])
    take = 0.5 * np.sin(2 * np.pi * 220 * np.arange(sr // 2) / sr)

    out_dir = Path(args.out_dir or 'out/audio-toolkit/selftest')
    out_dir.mkdir(parents=True, exist_ok=True)
    base_path = out_dir / 'base.wav'
    take_path = out_dir / 'take.wav'
    mix_path = out_dir / 'mix.wav'
    save_wav(base_path, tone, sr)
    save_wav(take_path, take, sr)

    analysis = analyze_signal(tone, sr)
    assert analysis['duration_s'] == 2.0, analysis
    assert analysis['fft']['peak_hz'] is not None
    assert 400 < float(analysis['fft']['peak_hz']) < 480, analysis['fft']
    assert analysis['spectrogram']['frames'] > 0
    assert 'bass' in analysis['spectrogram']['bands']

    file_result = process_file(base_path, sample_rate=sr, plot_dir=out_dir / 'plots')
    assert 'plots' in file_result
    for key in ('waveform', 'spectrogram', 'fft'):
        assert Path(file_result['plots'][key]).is_file(), key

    take_meta = record_from_pcm_file(take_path, out_path=out_dir / 'promoted.wav')
    assert take_meta['mode'] == 'file'
    assert Path(take_meta['path']).is_file()

    mix = overdub(base_path, take_path, out_path=mix_path, offset_ms=500)
    mixed, _ = load_audio(mix_path, sample_rate=sr)
    assert mixed.size >= tone.size
    assert mix['duration_s'] >= 2.0

    summary = {
        'ok': True,
        'analysis_peak_hz': analysis['fft']['peak_hz'],
        'plots': file_result['plots'],
        'take': take_meta['path'],
        'mix': mix['path'],
    }
    print(json.dumps(summary, indent=2))
    print('audio toolkit selftest: PASS')
    return 0


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog='swr-audio',
        description='Enhanced audio processing & additional-audio recording '
                    '(adapted from Matin-python/Python-Audio-Processing-Toolkit)',
    )
    sub = p.add_subparsers(dest='cmd', required=True)

    sp = sub.add_parser('process', help='Analyze a song (FFT, spectrogram, onsets, BPM)')
    sp.add_argument('input', help='Audio file (mp3/wav/…)')
    sp.add_argument('--rate', type=int, default=16000)
    sp.add_argument('--full-fft', action='store_true')
    sp.add_argument('--plots', help='Directory for waveform/spectrogram/FFT PNGs')
    sp.add_argument('--out-json', help='Write full analysis JSON here')
    sp.set_defaults(func=cmd_process)

    sr = sub.add_parser('record', help='Record additional audio from the microphone')
    sr.add_argument('--seconds', type=float, default=5.0, help='Fixed duration (default 5)')
    sr.add_argument('--vad', action='store_true', help='Voice-activity start/stop')
    sr.add_argument('--max-seconds', type=float, default=60.0)
    sr.add_argument('--rate', type=int, default=16000)
    sr.add_argument('--out', default='data/audio-takes/take.wav')
    sr.add_argument('--json', action='store_true')
    sr.add_argument('--env-skip', action='store_true',
                    help='Exit 0 when mic/PyAudio is unavailable (CI)')
    sr.set_defaults(func=cmd_record)

    st = sub.add_parser('take', help='Promote a file as an additional-audio take (no mic)')
    st.add_argument('--from', dest='source', required=True, help='Source audio file')
    st.add_argument('--out', default='data/audio-takes/file-take.wav')
    st.add_argument('--label', default='')
    st.add_argument('--rate', type=int, default=16000)
    st.add_argument('--json', action='store_true')
    st.set_defaults(func=cmd_take)

    so = sub.add_parser('overdub', help='Mix an additional take onto a base track')
    so.add_argument('--base', required=True)
    so.add_argument('--add', required=True)
    so.add_argument('--out', required=True)
    so.add_argument('--offset-ms', type=float, default=0.0)
    so.add_argument('--add-gain', type=float, default=1.0)
    so.add_argument('--base-gain', type=float, default=1.0)
    so.add_argument('--replace', action='store_true')
    so.add_argument('--rate', type=int, default=16000)
    so.add_argument('--json', action='store_true')
    so.set_defaults(func=cmd_overdub)

    ss = sub.add_parser('selftest', help='Synthetic DSP/overdub gate (no mic)')
    ss.add_argument('--out-dir', default='out/audio-toolkit/selftest')
    ss.set_defaults(func=cmd_selftest)

    return p


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    return int(args.func(args))


if __name__ == '__main__':
    raise SystemExit(main())
