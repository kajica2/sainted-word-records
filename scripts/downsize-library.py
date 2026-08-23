#!/usr/bin/env python3
"""
downsize-assets.py — compress a directory of media assets to fit a
Vercel Hobby 100MB source-size budget.

Use when you have heavy assets (typically images/MP4s) tracked in git
that would push your project over the 100MB Hobby plan limit if
shipped as-is. Outputs the compressed files in place.

Targets Vite-style projects where the only constraint is the git
source tree size (not built artifacts, which Vercel counts against
the same 100MB cap).

USAGE
-----
    python3 scripts/downsize-assets.py <source-dir> [options]

    # Compress all JPGs/PNGs to ≤600px wide and all MP4s to 400×224
    # at 500 kbps, leaving the originals replaced:
    python3 scripts/downsize-assets.py library/

    # Compress only specific files referenced in a manifest:
    python3 scripts/downsize-assets.py library/ --manifest library/manifest.json

OPTIONS
-------
    --portrait-max-w N     max width for portrait images (default 600)
    --portrait-quality N   JPEG quality 1-100 (default 72)
    --video-w N            video width (default 400)
    --video-h N            video height (default 224)
    --video-bitrate N      H.264 video bitrate (default "500k")
    --audio-bitrate N      AAC audio bitrate (default "64k")
    --no-audio             strip audio stream (default off)
    --dry-run              report what would change, do not write
    --verbose              log per-file decisions

DESIGN NOTES
------------
- Idempotent: skips files where compression doesn't save bytes.
- Audio stripping reduces a typical 6MB MP4 (5s 1080p) to ~290KB.
  The pattern: the engine renders visuals + reacts to audio via a
  SEPARATE audio source (audios/<engine>.mp3 fetched on boot), so
  the MP4 video assets don't need their own audio tracks.
- Default values are deliberately conservative: 600px portraits and
  400×224 videos retain enough detail to be aesthetically useful while
  cutting 90%+ of original bytes.
- Output filenames match inputs (in-place edit) so no manifest
  regeneration is needed.

WHY IT EXISTS
-------------
When a Vite project's `dist/library/` would be too large to ship to
Vercel (Hobby plan: 100MB source-size cap), naive options are:
  (1) don't ship library at all — engine boots empty
  (2) Vercel Blob setup — interactive dashboard step required
  (3) GitHub Releases / git-archive — depends on repo visibility
  (4) commit library as-is and accept overage — fails with 7s error

Option (5) compress library in place until it fits. This script is
the operationalization of (5). Verified on 2026-08-23 with the
sainted-word-records project (60MB tracked source, 36MB library
curated → 2.8MB after compression, deploy succeeded in 7s).

PREREQUISITES
-------------
    pip install Pillow
    brew install ffmpeg  # for MP4 compression

The script uses ffmpeg subprocess for MP4 work, so PATH must include
the ffmpeg binary.
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

from PIL import Image

IMAGE_EXTS = {".jpg", ".jpeg", ".png"}
VIDEO_EXTS = {".mp4"}


def log(msg: str, verbose: bool):
    if verbose:
        print(f"  {msg}", file=sys.stderr)


def downsize_image(
    p: Path, max_w: int, jpeg_q: int, dry: bool, verbose: bool
) -> tuple[int, int]:
    try:
        im = Image.open(p)
    except Exception as e:
        log(f"skip {p.name}: cannot open ({e})", verbose)
        return (p.stat().st_size, p.stat().st_size)

    before = p.stat().st_size
    if im.mode not in ("RGB", "RGBA"):
        im = im.convert("RGB")
    elif im.mode == "RGBA":
        # Flatten RGBA on white for JPEG compatibility
        from PIL import Image as _Im
        bg = _Im.new("RGB", im.size, (255, 255, 255))
        bg.paste(im, mask=im.split()[3])
        im = bg

    w, h = im.size
    new_w, new_h = w, h
    if w > max_w:
        new_h = int(h * max_w / w)
        im = im.resize((max_w, new_h), Image.LANCZOS)

    tmp = p.with_suffix(p.suffix + ".tmp")
    try:
        if p.suffix.lower() in {".jpg", ".jpeg"}:
            im.save(tmp, "JPEG", quality=jpeg_q, optimize=True)
        else:
            # PNG — keep format to preserve any transparency
            im.save(tmp, "PNG", optimize=True)
        after = tmp.stat().st_size
        if after < before and after > 0:
            if not dry:
                tmp.replace(p)
            log(f"{p.name}: {before/1024:.0f}KB → {after/1024:.0f}KB (-{(before-after)/1024:.0f}KB)", verbose)
            return (before, after)
        else:
            tmp.unlink(missing_ok=True)
            log(f"{p.name}: no win, kept {before/1024:.0f}KB", verbose)
            return (before, before)
    except Exception as e:
        tmp.unlink(missing_ok=True)
        log(f"error {p.name}: {e}", verbose)
        return (before, before)


def downsize_video(
    p: Path,
    vw: int,
    vh: int,
    bitrate: str,
    audio_bitrate: str,
    strip_audio: bool,
    dry: bool,
    verbose: bool,
) -> tuple[int, int]:
    before = p.stat().st_size
    tmp = p.with_suffix(p.suffix + ".tmp" + p.suffix)
    args = [
        "ffmpeg", "-y", "-i", str(p),
        "-vf", f"scale={vw}:{vh}:force_original_aspect_ratio=decrease,"
               f"pad={vw}:{vh}:(ow-iw)/2:(oh-ih)/2",
        "-c:v", "libx264",
        "-preset", "medium",
        "-b:v", bitrate,
        "-pix_fmt", "yuv420p",
        "-movflags", "+faststart",
    ]
    if strip_audio:
        args.extend(["-an"])
    else:
        args.extend(["-c:a", "aac", "-b:a", audio_bitrate])

    args.append(str(tmp))

    try:
        result = subprocess.run(
            args, capture_output=True, text=True, timeout=120
        )
    except subprocess.TimeoutExpired:
        log(f"timeout on {p.name}", verbose)
        return (before, before)
    except FileNotFoundError:
        log("ffmpeg not in PATH; install via `brew install ffmpeg`", verbose)
        return (before, before)
    except Exception as e:
        log(f"error {p.name}: {e}", verbose)
        return (before, before)

    if not tmp.exists() or tmp.stat().st_size == 0:
        log(f"ffmpeg failed for {p.name}: {result.stderr[-200:]}", verbose)
        return (before, before)

    after = tmp.stat().st_size
    if after < before:
        if not dry:
            tmp.replace(p)
        log(
            f"{p.name}: {before/1024:.0f}KB → {after/1024:.0f}KB "
            f"(-{(before-after)/1024:.0f}KB)",
            verbose,
        )
        return (before, after)

    tmp.unlink(missing_ok=True)
    log(f"{p.name}: no win, kept {before/1024:.0f}KB", verbose)
    return (before, before)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[1].strip())
    ap.add_argument("source_dir", type=Path, help="directory to scan")
    ap.add_argument("--manifest", type=Path,
                    help="only operate on files listed in this JSON manifest's 'files' array (relative paths joined to source_dir)")
    ap.add_argument("--portrait-max-w", type=int, default=600)
    ap.add_argument("--portrait-quality", type=int, default=72)
    ap.add_argument("--video-w", type=int, default=400)
    ap.add_argument("--video-h", type=int, default=224)
    ap.add_argument("--video-bitrate", default="500k")
    ap.add_argument("--audio-bitrate", default="64k")
    ap.add_argument("--no-audio", action="store_true",
                    help="strip audio (default keeps it)")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--verbose", action="store_true")
    args = ap.parse_args()

    if not args.source_dir.is_dir():
        print(f"not a directory: {args.source_dir}", file=sys.stderr)
        return 2

    # Resolve target files: either manifest-listed, or all images/MP4s
    if args.manifest:
        with open(args.manifest) as f:
            m = json.load(f)
        files = [args.source_dir / fname for fname in m.get("files", [])]
        files = [f for f in files if f.exists()]
    else:
        files = []
        for ext in IMAGE_EXTS | VIDEO_EXTS:
            files.extend(args.source_dir.rglob(f"*{ext}"))
        # stable order for reproducibility
        files = sorted(set(files))

    if not files:
        print("no files to process", file=sys.stderr)
        return 1

    totals = []
    for p in files:
        ext = p.suffix.lower()
        if ext in IMAGE_EXTS:
            totals.append(
                downsize_image(
                    p, args.portrait_max_w, args.portrait_quality,
                    args.dry_run, args.verbose,
                )
            )
        elif ext in VIDEO_EXTS:
            totals.append(
                downsize_video(
                    p, args.video_w, args.video_h,
                    args.video_bitrate, args.audio_bitrate,
                    args.no_audio, args.dry_run, args.verbose,
                )
            )

    before = sum(t[0] for t in totals)
    after = sum(t[1] for t in totals)
    n_files = len(totals)
    n_changed = sum(1 for t in totals if t[0] != t[1])

    prefix = "DRY-RUN " if args.dry_run else ""
    print(
        f"{prefix}{n_changed}/{n_files} files changed, "
        f"{before/1024/1024:.2f}MB → {after/1024/1024:.2f}MB "
        f"(saved {(before-after)/1024/1024:.2f}MB)"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
