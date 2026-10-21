#!/usr/bin/env python3
"""Publish the still packs into the SWR marketplace as curated .swr-set docs.

The curated marketplace (marketplace.html) is the free store: entries are
plain JSON served from /marketplace/curated/ and install client-side into the
engine, with no checkout and no price field. shop.html + Stripe is the paid
side, which is not what "for free" asks for.

One set per still pack, three photo layers each (a still pack reads as a
sequence in the engine), an engine + fx preset matched to how the pack actually
looks, and the pack's own audio track.

Deterministic: ids derive from the pack slug, so re-running this regenerates
byte-identical files rather than churning the curated index.

  python3 scripts/publish-packs-to-store.py [--dry-run]
"""
import argparse
import json
import os
import re
import sys
import uuid

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PACKS = os.path.join(ROOT, "packs")
CURATED = os.path.join(ROOT, "marketplace", "curated")
INDEX = os.path.join(CURATED, "index.json")
AUDIOS = os.path.join(ROOT, "audios")
STILL_RE = re.compile(r"\.(webp|png|jpe?g|avif)$", re.I)

AUTHOR = "SWR"
CREATED_AT = "2026-10-20T00:00:00Z"

# Stable namespace so ids are a pure function of the pack slug.
NS = uuid.UUID("6f1d0a2e-3c47-5b98-9a11-d4e7f2b60c53")
ID_BASE = 100  # curated ids 1..18 are taken; start well clear

# Per pack: engine, blurb, tags, bpm, key/scale, fx. Chosen from the photos
# themselves, not at random — these are near-monochrome glitch/documentary
# frames, so posterize/chroma/grayscale carry the look.
PRESETS = {
    "dancers": dict(
        audio="film", engine="film", bpm=92, key="F", scale="minor",
        tags=["dance", "silhouette", "stage", "monochrome"],
        description="Stage-lit dancer silhouettes in black and white. Best for "
                    "slow builds, halftime, anything that breathes before it breaks.",
        fx=dict(temp=-0.25, mut=0, mutAlgo=0, posterize=0, vignette=0.7, chroma=0.05,
                grain=0.3, sepia=0, glow=0.45, grayscale=0.35, blur=0.1,
                liquid=0, pearl=0, glitch=0)),
    "metatron-holographic": dict(
        audio="glitch", engine="glitch", bpm=174, key="C", scale="minor",
        tags=["glitch", "holographic", "layered", "breakcore"],
        description="Multi-layered holographic construction over hard geometry. "
                    "Built for breakcore, glitch and anything that breaks rules on purpose.",
        fx=dict(temp=0, mut=0, mutAlgo=0, posterize=0.2, vignette=0.35, chroma=0.55,
                grain=0.3, sepia=0, glow=0.5, grayscale=0.15, blur=0,
                liquid=0, pearl=0.15, glitch=0)),
    "twilight-shotlist": dict(
        audio="tape", engine="tape", bpm=84, key="D", scale="dorian",
        tags=["twilight", "shotlist", "blue-grey", "cinematic"],
        description="A dim-twilight shot list — corridors, doorways, silhouettes, "
                    "one held close-up. Long takes, no cuts.",
        fx=dict(temp=-0.35, mut=0, mutAlgo=0, posterize=0, vignette=0.75, chroma=0.1,
                grain=0.35, sepia=0, glow=0.3, grayscale=0.4, blur=0.15,
                liquid=0, pearl=0, glitch=0)),
    "ufo-portrait": dict(
        audio="eclipse", engine="eclipse", bpm=100, key="A", scale="minor",
        tags=["portrait", "ufo", "night", "eclipse"],
        description="Portrait photography with lights in the background. Slow, "
                    "wide, and a little wrong.",
        fx=dict(temp=-0.2, mut=0, mutAlgo=0, posterize=0, vignette=0.65, chroma=0.2,
                grain=0.25, sepia=0.1, glow=0.55, grayscale=0.2, blur=0.1,
                liquid=0, pearl=0, glitch=0)),
    "santiago-instagram": dict(
        audio="mosaic", engine="collage", bpm=120, key="G", scale="mixolydian",
        tags=["collage", "poster", "photography", "instagram"],
        description="Photographers' hands at the poster — a gallery of instants "
                    "rebuilt as collage. Good for art-directed transitions.",
        fx=dict(temp=-0.1, mut=0, mutAlgo=0, posterize=0.1, vignette=0.4, chroma=0.25,
                grain=0.4, sepia=0.2, glow=0.35, grayscale=0.25, blur=0.05,
                liquid=0, pearl=0, glitch=0)),
    "slow-pan-disturbing": dict(
        audio="hallucination", engine="hallucination", bpm=138, key="E", scale="phrygian",
        tags=["slow-pan", "unease", "found-footage", "experimental"],
        description="A slow pan across something you are not supposed to notice. "
                    "Unsettling without ever being loud.",
        fx=dict(temp=-0.15, mut=0.15, mutAlgo=1, posterize=0, vignette=0.7, chroma=0.3,
                grain=0.45, sepia=0, glow=0.3, grayscale=0.3, blur=0.2,
                liquid=0, pearl=0.1, glitch=0)),
    "wide-angle-low-angle": dict(
        audio="chrome", engine="chrome", bpm=110, key="B", scale="minor",
        tags=["wide-angle", "low-angle", "chrome", "industrial"],
        description="Wide-angle static frames shot slightly from below. Room to "
                    "put type across the bottom third.",
        fx=dict(temp=0, mut=0, mutAlgo=0, posterize=0.15, vignette=0.5, chroma=0.35,
                grain=0.2, sepia=0, glow=0.6, grayscale=0.3, blur=0,
                liquid=0, pearl=0, glitch=0)),
    "belgrade-hand-map": dict(
        audio="mosaic", engine="mosaic", bpm=96, key="E", scale="phrygian",
        tags=["map", "belgrade", "hand-drawn", "architecture"],
        description="Hand-sketched city maps of Belgrade, ink over paper. Warm "
                    "enough to sit under spoken word.",
        fx=dict(temp=0.15, mut=0, mutAlgo=0, posterize=0.25, vignette=0.35, chroma=0.1,
                grain=0.35, sepia=0.3, glow=0.25, grayscale=0.3, blur=0,
                liquid=0, pearl=0, glitch=0)),
    "chaos-map": dict(
        audio="fractal", engine="fractal", bpm=150, key="C", scale="minor",
        tags=["map", "chaos", "wallpaper", "fractal"],
        description="Chaos-20 maps run to wallpaper depth. Long, tiling, and "
                    "happy to sit behind a whole track.",
        fx=dict(temp=0, mut=0, mutAlgo=0, posterize=0.3, vignette=0.3, chroma=0.45,
                grain=0.25, sepia=0, glow=0.5, grayscale=0.2, blur=0,
                liquid=0.1, pearl=0, glitch=0)),
    "ocean-scan-spectra": dict(
        audio="phosphor", engine="phosphor", bpm=88, key="B", scale="minor",
        tags=["ocean", "spectral", "scan", "infrared"],
        description="The ocean read through six spectra — infrared to gamma. "
                    "Cold, layered, geological.",
        fx=dict(temp=-0.4, mut=0, mutAlgo=0, posterize=0.2, vignette=0.5, chroma=0.5,
                grain=0.2, sepia=0, glow=0.65, grayscale=0.15, blur=0.05,
                liquid=0.15, pearl=0, glitch=0)),
    "oriental-fantasy": dict(
        audio="watercolor", engine="watercolor", bpm=76, key="A", scale="pentatonic",
        tags=["oriental", "fantasy", "golden-section", "daylight"],
        description="Daytime oriental fantasy composed on the golden section. "
                    "The one pack in here that wants light.",
        fx=dict(temp=0.25, mut=0, mutAlgo=0, posterize=0, vignette=0.3, chroma=0.2,
                grain=0.2, sepia=0.35, glow=0.5, grayscale=0, blur=0.15,
                liquid=0, pearl=0.2, glitch=0)),
    "ice-sculpture": dict(
        # aurora, not temple-of-control: the latter is a page with no track in
        # /audios, and the generator's audio check is what catches that.
        audio="aurora", engine="aurora", bpm=70, key="D", scale="minor",
        tags=["ice", "sculpture", "reflection", "slow"],
        description="An ice sculpture on a reflective surface, shot close. "
                    "Built for the slowest tracks you own.",
        fx=dict(temp=-0.45, mut=0, mutAlgo=0, posterize=0, vignette=0.5, chroma=0.15,
                grain=0.15, sepia=0, glow=0.55, grayscale=0.3, blur=0.1,
                liquid=0.2, pearl=0.1, glitch=0)),
    "istanbul-bw": dict(
        audio="kraft", engine="kraft", bpm=94, key="C", scale="major",
        tags=["istanbul", "architecture", "black-and-white", "documentary"],
        description="A black-and-white building study from Istanbul. One frame, "
                    "and it holds.",
        fx=dict(temp=-0.15, mut=0, mutAlgo=0, posterize=0.2, vignette=0.45, chroma=0.05,
                grain=0.4, sepia=0.15, glow=0.3, grayscale=0.45, blur=0.05,
                liquid=0, pearl=0, glitch=0)),
}

LAYERS_PER_SET = 3

# str.title() mangles these ("Ufo Portrait", "3d"). Curated set names are
# display text, so they get the real casing rather than Title Case.
ACRONYMS = {"ufo": "UFO", "ai": "AI", "dj": "DJ", "3d": "3D", "hd": "HD",
            "idm": "IDM", "cd": "CD", "ny": "NY", "la": "LA", "bw": "B&W"}


def display_name(slug):
    out = []
    for w in slug.replace("-", " ").split():
        out.append(ACRONYMS.get(w.lower(), w[:1].upper() + w[1:]))
    return " ".join(out)


def build_id(slug):
    """Deterministic uuid-shaped id, from the slug alone."""
    return str(uuid.uuid5(NS, slug))


def pick_files(files, n):
    """Even spread across the pack so three layers are not three neighbours."""
    if len(files) <= n:
        return list(files)
    step = len(files) / n
    return [files[int(i * step)] for i in range(n)]


def build_set(slug, files, sizes):
    p = PRESETS[slug]
    audio_name = f"{p['audio']}.mp3"
    audio_path = os.path.join(AUDIOS, audio_name)
    if not os.path.exists(audio_path):
        sys.exit(f"pack {slug}: no audio track at audios/{audio_name}")

    layers = []
    for i, rel in enumerate(pick_files(files, LAYERS_PER_SET), 1):
        layers.append({
            "id": f"L{i}",
            "name": f"Plate {i:02d}",
            "blend": "source-over",
            "opacity": 1.0 if i == 1 else 0.55,
            "baseScale": 1.0,
            "hue": 0,
            "brightness": 1.0,
            "contrast": 1.0 + 0.05 * (i - 1),
            "pos": {"x": 0, "y": 0, "rot": 0},
            "rotOffset": 0,
            "reactors": [],
            "modulators": [],
            "asset": {
                "name": os.path.basename(rel),
                "mimeType": "image/webp",
                "size": sizes[rel],
                "url": "/packs/" + rel,
            },
        })

    return {
        "schemaVersion": 1,
        "id": build_id(slug),
        "name": display_name(slug),
        "author": AUTHOR,
        "description": p["description"],
        "tags": p["tags"],
        "createdAt": CREATED_AT,
        "engine": p["engine"],
        "audio": {
            "name": audio_name,
            "mimeType": "audio/mpeg",
            "size": os.path.getsize(audio_path),
            "url": "/audios/" + audio_name,
        },
        "fx": p["fx"],
        "layers": layers,
        "settings": {"bpm": p["bpm"], "key": p["key"], "scale": p["scale"]},
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    manifest = json.load(open(os.path.join(PACKS, "manifest.json")))
    missing = sorted(set(PRESETS) - set(manifest["packs"]))
    if missing:
        sys.exit(f"presets reference packs that do not exist: {missing}")

    index = json.load(open(INDEX))
    existing_files = {s["file"].split("/")[-1] for s in index["sets"]}
    written = []

    for slug, allfiles in manifest["packs"].items():
        if slug not in PRESETS:
            continue
        files = [f for f in allfiles if STILL_RE.search(f)]
        if not files:
            continue
        sizes = {f: os.path.getsize(os.path.join(PACKS, f)) for f in files}

        doc = build_set(slug, files, sizes)
        fname = f"pack-{slug}.swr-set.json"
        if not args.dry_run:
            with open(os.path.join(CURATED, fname), "w") as fh:
                json.dump(doc, fh, indent=2, ensure_ascii=False)
                fh.write("\n")
        if fname not in existing_files:
            index["sets"].append({
                "file": f"/marketplace/curated/{fname}",
                "id": doc["id"],
                "name": doc["name"],
                "engine": doc["engine"],
            })
            existing_files.add(fname)
        else:
            # Refresh rather than skip: the set file is the source of truth, so
            # a renamed pack (or a fixed ACRONYM) must reach the index too.
            for entry in index["sets"]:
                if entry["file"].split("/")[-1] == fname:
                    entry.update(id=doc["id"], name=doc["name"], engine=doc["engine"])
                    break
        written.append((slug, fname, len(files), doc["engine"]))
        print(f"  {slug:24s} -> {fname:34s} engine={doc['engine']:20s} {len(files)} photos")

    index["sets"].sort(key=lambda s: s["name"].lower())
    index["count"] = len(index["sets"])
    index["generatedAt"] = CREATED_AT
    if not args.dry_run:
        with open(INDEX, "w") as fh:
            json.dump(index, fh, indent=2, ensure_ascii=False)
            fh.write("\n")

    print(f"\n{len(written)} packs published · curated index now {index['count']} sets")


if __name__ == "__main__":
    main()
