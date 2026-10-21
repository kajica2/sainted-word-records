#!/usr/bin/env python3
"""Organize Midjourney session_3 images into SWR media packs (packs/<family>/).

Groups by the prompt name encoded in each MJ filename, converts PNG -> webp,
writes a 1280x720 cover per pack, and merges the result into packs/manifest.json
(schema swr-library-packs/v1).
"""
import collections
import json
import os
import re
import subprocess
import sys

SRC = os.path.expanduser(os.environ.get(
    "MJ_SESSION_DIR", "~/Downloads/midjourney_session_3 (2)"))
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PACKS = os.path.join(ROOT, "packs")
MANIFEST = os.path.join(PACKS, "manifest.json")

MAXW = 1280
QUALITY = 62

UUID = re.compile(r"_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}_(\d)$")
MJ = re.compile(r"^httpss\.mj\.run[A-Za-z0-9_-]*?_(?=[A-Za-z])")

# Ordered rules: first match wins. Matched case-insensitively against the
# normalized name. Needles are deliberately SHORT and mid-word: MJ truncates its
# slug at 64 chars, so names arrive cut mid-phrase ("..._LIGHTING_Dim_twiligh",
# "..._by__jeff_S"), which a whole-word needle misses.
RULES = [
    ("metatron_multi-layered_holographic", "metatron-holographic"),
    ("hasenbvlasdt", "ufo-portrait"),
    ("camera_style_wide-angle_static_shot", "wide-angle-low-angle"),
    ("slow_pan_revealing_something_disturb", "slow-pan-disturbing"),
    ("scan_of_the_ocean_showing", "ocean-scan-spectra"),
    ("lighting_dim_twiligh", "twilight-shotlist"),
    ("by__jef", "santiago-instagram"),
    ("jacques_bourboulon_instag", "santiago-instagram"),
    ("--chaos_", "chaos-map"),
    ("uv1frq", "chaos-map"),
    ("hand_sketch_city_map_of_belgrade", "belgrade-hand-map"),
    ("oriental_fantasy_golden_section", "oriental-fantasy"),
    ("ice_sculpture_on_the_surface", "ice-sculpture"),
    ("building_in_istanbul", "istanbul-bw"),
]


def prompt_name(stem):
    """Strip the mj.run CDN prefix and the trailing <uuid>_<n> grid suffix."""
    s = MJ.sub("", stem)
    out = UUID.sub("", s)
    if out == s:  # truncated mid-uuid — strip what is left of it
        out = re.sub(r"_[0-9]{1}$", "", out)
        out = re.sub(r"_[0-9a-f]{4,8}(-[0-9a-f]*)*$", "", out)
    return out


def sort_key(path):
    stem = os.path.basename(path)[:-4]
    m = UUID.search(stem)
    return (stem[:m.start()] if m else stem, int(m.group(1)) if m else 0)


def family_of(name):
    low = name.lower()
    for needle, slug in RULES:
        if needle in low:
            return slug
    return "unsorted"


def to_webp(src, dst, width=MAXW, quality=QUALITY):
    subprocess.run(
        ["cwebp", "-quiet", "-q", str(quality), "-resize", str(width), "0", src, "-o", dst],
        check=True,
    )


def make_cover(src, dst):
    """1280x720 centre-cropped cover, matching the other packs' covers.

    Homebrew ffmpeg has no libwebp encoder, so ffmpeg crops to a temp PNG and
    cwebp does the encode.
    """
    tmp = dst + ".tmp.png"
    subprocess.run(
        ["ffmpeg", "-v", "error", "-y", "-i", src,
         "-vf", "scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720",
         "-frames:v", "1", tmp],
        check=True,
    )
    to_webp(tmp, dst, width=1280, quality=70)
    os.remove(tmp)


def main():
    files = sorted(f for f in os.listdir(SRC) if f.lower().endswith(".png"))
    groups = collections.defaultdict(list)
    for f in files:
        groups[family_of(prompt_name(f[:-4]))].append(os.path.join(SRC, f))

    manifest = json.load(open(MANIFEST))
    packs, covers = manifest["packs"], manifest["covers"]
    summary = []

    for slug in sorted(groups):
        members = sorted(groups[slug], key=sort_key)
        outdir = os.path.join(PACKS, slug)
        os.makedirs(outdir, exist_ok=True)

        entries = []
        for i, src in enumerate(members, 1):
            name = f"{slug}-{i:02d}.webp"
            to_webp(src, os.path.join(outdir, name))
            entries.append(f"{slug}/{name}")

        cover_rel = f"{slug}/cover.webp"
        make_cover(members[0], os.path.join(PACKS, cover_rel))

        packs[slug] = entries
        covers[slug] = cover_rel

        size = sum(os.path.getsize(os.path.join(PACKS, e)) for e in entries)
        size += os.path.getsize(os.path.join(PACKS, cover_rel))
        summary.append((slug, len(entries), size))
        print(f"{slug:26s} {len(entries):4d} imgs  {size / 1e6:6.2f} MB", flush=True)

    manifest["generated_at"] = "2026-10-20T00:00:00+02:00"
    with open(MANIFEST, "w") as fh:
        json.dump(manifest, fh, indent=2)
        fh.write("\n")

    total = sum(s for _, _, s in summary)
    print(f"\n{len(summary)} packs · {len(files)} images · {total / 1e6:.2f} MB", file=sys.stderr)


if __name__ == "__main__":
    main()
