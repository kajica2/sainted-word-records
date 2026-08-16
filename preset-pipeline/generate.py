#!/usr/bin/env python3
"""
generate.py — Daily preset spec generator.

Reads curated inspiration seeds (shaders, palettes, motion) and produces
1-2 valid preset specs per run. Appends to presets/ and rewrites manifest.json.

Use:
    python3 generate.py                # produces 1-2 new presets
    python3 generate.py --count 3      # produces 3 new presets
    python3 generate.py --dry-run      # don't write anything, just print

The combination is a 3-axis blend: pick one shader seed, one palette seed,
one motion seed. Each seed has a parameter signature; the preset's `fx_state`
is interpolated between the three weighted seeds. The combo's emergent name
comes from the three seed names fused.

No LLM call in v1 — the template-based blender is deterministic and fast.
Phase 1.5 will add an LLM "novelty pass" that mutates the blended preset
with fresh audio-reactivity rules. The output format is identical.
"""

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import random
import re
import sys
from dataclasses import dataclass, asdict, field
from pathlib import Path
from typing import Any

HERE = Path(__file__).parent
# Presets live in a sibling folder (../presets) so the engine can fetch
# /presets/manifest.json same-origin from the deployed engine.
PRESETS_DIR = HERE.parent / "presets"
MANIFEST_PATH = PRESETS_DIR / "manifest.json"

# --- canonical 15 fx_state keys (must match engine/personas.js) -----------
FX_KEYS = [
    "liquid", "pearl", "glitch", "grain", "chroma", "bloom", "vignette",
    "sepia", "glow", "grayscale", "blur", "mut", "mutAlgo", "temp",
    "posterize",
]
NUMERIC_FX = {k: (0.0, 1.0) for k in FX_KEYS if k != "posterize"}
POSTERIZE_RANGE = (1, 16)
AUDIO_BANDS = ("bass", "mid", "treble", "onset")
FAMILIES = ("GENERATIVE", "MORPHA", "TRAIN", "CSSFX")


# --- inspiration seeds ----------------------------------------------------

@dataclass
class ShaderSeed:
    name: str
    description: str
    fx_bias: dict[str, float]   # dominant fx_state values
    motion_bias: dict[str, float]
    audio_bias: dict[str, list[str]]


@dataclass
class PaletteSeed:
    name: str
    description: str
    primary: str
    secondary: str
    accent: str
    bg: str


@dataclass
class MotionSeed:
    name: str
    description: str
    rotation_speed: float
    scale_pulse: float
    pan_x: float
    pan_y: float
    audio_bias: dict[str, list[str]]


SHADER_SEEDS: list[ShaderSeed] = [
    ShaderSeed(
        name="curl-noise",
        description="Soft divergent flow with bass-pumped bloom.",
        fx_bias={"bloom": 0.6, "chroma": 0.5, "vignette": 0.3, "grain": 0.3,
                 "liquid": 0.4, "pearl": 0.2, "glitch": 0.08, "sepia": 0.0,
                 "glow": 0.2, "grayscale": 0.0, "blur": 0.1, "mut": 0.0,
                 "mutAlgo": 0.0, "temp": 0.0, "posterize": 4},
        motion_bias={"rotation_speed": 0.05, "scale_pulse": 0.10, "pan_x": 0.0, "pan_y": 0.0},
        audio_bias={"bass": ["chroma", "bloom"], "mid": ["rotation_speed"],
                    "treble": ["grain"], "onset": ["scale_pulse"]},
    ),
    ShaderSeed(
        name="halftone-grid",
        description="Hard monochrome cells with high posterize.",
        fx_bias={"posterize": 12, "grayscale": 0.7, "vignette": 0.5,
                 "bloom": 0.0, "chroma": 0.0, "grain": 0.4,
                 "liquid": 0.0, "pearl": 0.0, "glitch": 0.0, "sepia": 0.0,
                 "glow": 0.0, "blur": 0.0, "mut": 0.0, "mutAlgo": 0.0,
                 "temp": 0.0},
        motion_bias={"rotation_speed": 0.0, "scale_pulse": 0.0, "pan_x": 0.0, "pan_y": 0.0},
        audio_bias={"bass": ["posterize"], "mid": ["vignette"],
                    "treble": ["grain"], "onset": ["scale_pulse"]},
    ),
    ShaderSeed(
        name="reaction-diffusion",
        description="Organic Turing patterns with mid-band glissando.",
        fx_bias={"liquid": 0.6, "pearl": 0.4, "glow": 0.3, "chroma": 0.3,
                 "grain": 0.2, "vignette": 0.2,
                 "glitch": 0.0, "sepia": 0.0, "grayscale": 0.0, "blur": 0.0,
                 "mut": 0.0, "mutAlgo": 0.0, "temp": 0.0, "posterize": 6,
                 "bloom": 0.3},
        motion_bias={"rotation_speed": 0.02, "scale_pulse": 0.05, "pan_x": 0.0, "pan_y": 0.0},
        audio_bias={"bass": ["bloom", "glow"], "mid": ["rotation_speed"],
                    "treble": ["grain"], "onset": ["pearl"]},
    ),
    ShaderSeed(
        name="metaball-blob",
        description="Soft morphing blobs with chromatic edges.",
        fx_bias={"liquid": 0.8, "chroma": 0.5, "glow": 0.4, "bloom": 0.4,
                 "blur": 0.2, "pearl": 0.3,
                 "glitch": 0.0, "grain": 0.0, "vignette": 0.1, "sepia": 0.0,
                 "grayscale": 0.0, "mut": 0.0, "mutAlgo": 0.0, "temp": 0.0,
                 "posterize": 5},
        motion_bias={"rotation_speed": 0.08, "scale_pulse": 0.20, "pan_x": 0.0, "pan_y": 0.0},
        audio_bias={"bass": ["scale_pulse", "bloom"], "mid": ["rotation_speed"],
                    "treble": ["chroma"], "onset": ["pearl"]},
    ),
    ShaderSeed(
        name="ascii-rain",
        description="Monospace character cells with low framerate feel.",
        fx_bias={"posterize": 8, "grayscale": 0.9, "grain": 0.5, "vignette": 0.4,
                 "sepia": 0.3,
                 "liquid": 0.0, "pearl": 0.0, "glitch": 0.2, "chroma": 0.0,
                 "bloom": 0.0, "glow": 0.0, "blur": 0.0, "mut": 0.0,
                 "mutAlgo": 0.0, "temp": 0.0},
        motion_bias={"rotation_speed": 0.0, "scale_pulse": 0.0, "pan_x": 0.0, "pan_y": 0.0},
        audio_bias={"bass": ["posterize"], "mid": ["grain"],
                    "treble": ["glitch"], "onset": ["scale_pulse"]},
    ),
    ShaderSeed(
        name="voronoi-cells",
        description="Sharp cell boundaries with bass-pumped scale.",
        fx_bias={"posterize": 6, "bloom": 0.4, "glow": 0.3, "chroma": 0.4,
                 "vignette": 0.3,
                 "liquid": 0.0, "pearl": 0.0, "glitch": 0.1, "sepia": 0.0,
                 "grayscale": 0.0, "blur": 0.0, "mut": 0.0, "mutAlgo": 0.0,
                 "temp": 0.0, "grain": 0.0},
        motion_bias={"rotation_speed": 0.03, "scale_pulse": 0.15, "pan_x": 0.0, "pan_y": 0.0},
        audio_bias={"bass": ["scale_pulse"], "mid": ["rotation_speed"],
                    "treble": ["grain"], "onset": ["chroma"]},
    ),
    ShaderSeed(
        name="fractal-mandel",
        description="Recursive zoom with bass-driven depth.",
        fx_bias={"chroma": 0.6, "bloom": 0.5, "glow": 0.3, "vignette": 0.4,
                 "pearl": 0.3,
                 "liquid": 0.0, "glitch": 0.0, "sepia": 0.0,
                 "grayscale": 0.0, "blur": 0.0, "mut": 0.0, "mutAlgo": 0.0,
                 "temp": 0.0, "posterize": 5, "grain": 0.0},
        motion_bias={"rotation_speed": 0.0, "scale_pulse": 0.30, "pan_x": 0.0, "pan_y": 0.0},
        audio_bias={"bass": ["scale_pulse", "bloom"], "mid": ["chroma"],
                    "treble": ["glow"], "onset": ["pearl"]},
    ),
    ShaderSeed(
        name="plasma",
        description="Flowing color gradients, classic synthwave palette.",
        fx_bias={"chroma": 0.7, "bloom": 0.6, "glow": 0.5, "vignette": 0.3,
                 "pearl": 0.2, "liquid": 0.4,
                 "glitch": 0.0, "sepia": 0.0, "grayscale": 0.0, "blur": 0.0,
                 "mut": 0.0, "mutAlgo": 0.0, "temp": 0.05, "posterize": 8,
                 "grain": 0.1},
        motion_bias={"rotation_speed": 0.06, "scale_pulse": 0.18, "pan_x": 0.0, "pan_y": 0.0},
        audio_bias={"bass": ["bloom", "scale_pulse"], "mid": ["rotation_speed", "chroma"],
                    "treble": ["glow"], "onset": ["pearl"]},
    ),
    ShaderSeed(
        name="tunnel",
        description="Flying through a depth tunnel, bass-pumped perspective.",
        fx_bias={"chroma": 0.5, "glow": 0.4, "vignette": 0.7, "bloom": 0.3,
                 "blur": 0.1,
                 "liquid": 0.2, "pearl": 0.0, "glitch": 0.0, "sepia": 0.0,
                 "grayscale": 0.0, "mut": 0.0, "mutAlgo": 0.0, "temp": 0.0,
                 "posterize": 4, "grain": 0.2},
        motion_bias={"rotation_speed": 0.02, "scale_pulse": 0.40, "pan_x": 0.0, "pan_y": 0.0},
        audio_bias={"bass": ["scale_pulse", "bloom"], "mid": ["chroma"],
                    "treble": ["glow"], "onset": ["vignette"]},
    ),
    ShaderSeed(
        name="particle-swarm",
        description="Particles reacting to beats and onsets, dispersed swarm.",
        fx_bias={"glow": 0.6, "bloom": 0.5, "chroma": 0.4, "grain": 0.3,
                 "vignette": 0.4,
                 "liquid": 0.3, "pearl": 0.0, "glitch": 0.1, "sepia": 0.0,
                 "grayscale": 0.0, "blur": 0.1, "mut": 0.0, "mutAlgo": 0.0,
                 "temp": 0.0, "posterize": 3},
        motion_bias={"rotation_speed": 0.10, "scale_pulse": 0.25, "pan_x": 0.15, "pan_y": 0.10},
        audio_bias={"bass": ["scale_pulse", "bloom"], "mid": ["pan_x", "pan_y"],
                    "treble": ["glow"], "onset": ["scale_pulse", "pan_x"]},
    ),
]


PALETTE_SEEDS: list[PaletteSeed] = [
    PaletteSeed("annihilation-aurora", "Annihilation (2018) — pink + cyan aurora",
                "#d462a4", "#4cd4d4", "#d4a24c", "#0a0a0c"),
    PaletteSeed("barry-lyon-gold", "High-key gold/black minimalism",
                "#d4a24c", "#1a1a1a", "#f5e6c0", "#0a0a0c"),
    PaletteSeed("dune-arrakis", "Desert orange + cool blue",
                "#e8945a", "#5a7fa8", "#f5d4a0", "#1a0a05"),
    PaletteSeed("matrix-mono", "Green-on-black terminal",
                "#5ec27a", "#0a0a0c", "#8be8a0", "#000000"),
    PaletteSeed("akira-red", "Akira red + steel",
                "#e85a4f", "#3a4a5a", "#f5a0a0", "#0a0a0c"),
    PaletteSeed("midsommar-bloom", "Midsommar pale + flower pink",
                "#f5d0c0", "#d462a4", "#f5e6c0", "#faf0e0"),
    PaletteSeed("blade-rainbow", "Blade Runner neon pink + teal",
                "#ff3d92", "#00e5ff", "#f5a524", "#0a0d12"),
    PaletteSeed("vapor-mono", "Vaporwave pastel + cyan",
                "#f5a0d4", "#4cd4d4", "#a0d4f5", "#1a0a25"),
]


MOTION_SEEDS: list[MotionSeed] = [
    MotionSeed("slow-drift-orbit", "Slow orbital rotation, soft scale pulse",
               0.05, 0.10, 0.0, 0.0,
               {"bass": ["rotation_speed"], "onset": ["scale_pulse"]}),
    MotionSeed("snap-pan-x", "Sudden left/right pans on each onset",
               0.0, 0.0, 0.30, 0.0,
               {"onset": ["pan_x"], "bass": ["pan_x"]}),
    MotionSeed("snap-pan-y", "Vertical snap on each onset",
               0.0, 0.0, 0.0, 0.30,
               {"onset": ["pan_y"]}),
    MotionSeed("breath-scale", "Slow inhale/exhale scale, no rotation",
               0.0, 0.25, 0.0, 0.0,
               {"bass": ["scale_pulse"], "mid": ["scale_pulse"]}),
    MotionSeed("static-grid", "No motion, let the shader do the work",
               0.0, 0.0, 0.0, 0.0,
               {}),
    MotionSeed("counter-spin", "Slow counter-rotation, breath scale",
               -0.03, 0.15, 0.0, 0.0,
               {"bass": ["scale_pulse"], "onset": ["rotation_speed"]}),
    MotionSeed("lateral-drift", "Constant slow lateral pan",
               0.0, 0.0, 0.10, 0.05,
               {"bass": ["pan_x"], "onset": ["pan_y"]}),
]


# --- blending --------------------------------------------------------------

def blend_fx_state(s: ShaderSeed, weight: float) -> dict[str, float]:
    """For v1 the shader is the dominant signal — weight is informational.
       Future: weight blends between seeds."""
    out: dict[str, float] = {}
    for k in FX_KEYS:
        v = s.fx_bias.get(k, 0.0)
        if k == "posterize":
            v = max(1, min(16, int(round(v))))
        else:
            v = max(0.0, min(1.0, float(v)))
        out[k] = v
    return out


def blend_motion(s: MotionSeed) -> dict[str, float]:
    return {
        "rotation_speed": s.rotation_speed,
        "scale_pulse": s.scale_pulse,
        "pan_x": s.pan_x,
        "pan_y": s.pan_y,
    }


def blend_audio_reactivity(shader: ShaderSeed, motion: MotionSeed) -> dict[str, list[str]]:
    out: dict[str, list[str]] = {b: [] for b in AUDIO_BANDS}
    for band, names in shader.audio_bias.items():
        for n in names:
            if n not in out[band]:
                out[band].append(n)
    for band, names in motion.audio_bias.items():
        for n in names:
            if n not in out[band]:
                out[band].append(n)
    # ensure every preset reacts to bass somehow
    if not out["bass"]:
        out["bass"].append("scale_pulse")
    return out


def slugify(s: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")
    return s or "preset"


def make_name(shader: ShaderSeed, palette: PaletteSeed, motion: MotionSeed, rng: random.Random) -> str:
    """Name is deterministic from the seed triple so it never collides with
       a different triple's preset. Lead word from each axis, palette first
       for visual hierarchy, with the motion family as a suffix."""
    palette_word = palette.name.split("-")[0].title()
    shader_word = shader.name.split("-")[0].title()
    motion_word = motion.name.split("-")[0].title()
    return f"{palette_word} {shader_word} {motion_word}"


def make_thumbnail_svg(p: PaletteSeed, rng: random.Random) -> str:
    """A tiny 80x80 inline SVG that suggests the personality."""
    w = h = 80
    cx, cy = 40, 40
    # pick a few decorative arcs and a circle in the palette
    r1 = rng.randint(15, 30)
    r2 = rng.randint(5, 12)
    return (
        f'<svg width="{w}" height="{h}" viewBox="0 0 {w} {h}" xmlns="http://www.w3.org/2000/svg">'
        f'<rect width="{w}" height="{h}" fill="{p.bg}"/>'
        f'<circle cx="{cx}" cy="{cy}" r="{r1}" fill="{p.primary}" opacity="0.8"/>'
        f'<circle cx="{cx+rng.randint(-15,15)}" cy="{cy+rng.randint(-15,15)}" r="{r2}" fill="{p.secondary}" opacity="0.7"/>'
        f'<circle cx="{cx}" cy="{cy}" r="{max(2, r2//2)}" fill="{p.accent}"/>'
        f'</svg>'
    )


def make_tags(shader: ShaderSeed, palette: PaletteSeed, motion: MotionSeed) -> list[str]:
    tags = []
    for s in (shader, palette, motion):
        first = s.name.split("-")[0].lower()
        if first and first not in tags:
            tags.append(first)
    return tags[:5]


# --- manifest --------------------------------------------------------------

def load_manifest() -> dict[str, Any]:
    if MANIFEST_PATH.exists():
        with MANIFEST_PATH.open() as f:
            return json.load(f)
    return {"version": 1, "updated_at": None, "presets": [], "count": 0}


def write_manifest(m: dict[str, Any]) -> None:
    m["updated_at"] = dt.datetime.now(dt.timezone.utc).isoformat()
    m["count"] = len(m["presets"])
    with MANIFEST_PATH.open("w") as f:
        json.dump(m, f, indent=2)


# --- generation ------------------------------------------------------------

def build_preset(seed: tuple[ShaderSeed, PaletteSeed, MotionSeed], rng: random.Random) -> dict[str, Any]:
    shader, palette, motion = seed
    today = dt.date.today().isoformat()
    name = make_name(shader, palette, motion, rng)
    slug = slugify(name)
    # ensure unique-ish id
    pid = f"swr-preset-{today}-{slug}"
    # inspiration weights
    w_shader = round(rng.uniform(0.4, 0.6), 2)
    w_palette = round(rng.uniform(0.2, 0.4), 2)
    # Normalize so weights sum to exactly 1.0. If the floor of 0.1 on motion
    # pushes the sum past 1.0, scale all three down proportionally.
    w_motion = round(max(0.1, 1.0 - w_shader - w_palette), 2)
    total = w_shader + w_palette + w_motion
    if total > 1.0:
        scale = 1.0 / total
        w_shader = round(w_shader * scale, 2)
        w_palette = round(w_palette * scale, 2)
        w_motion = round(1.0 - w_shader - w_palette, 2)
    fx = blend_fx_state(shader, w_shader)
    mot = blend_motion(motion)
    audio = blend_audio_reactivity(shader, motion)
    family = rng.choice(("GENERATIVE", "MORPHA"))
    return {
        "id": pid,
        "schema": "swr-preset/v1",
        "created_at": dt.datetime.now(dt.timezone.utc).isoformat(),
        "name": name,
        "family": family,
        "description": f"{name}: {shader.description} Paired with {palette.description}.",
        "inspiration": [
            {"kind": "shader_ref",  "name": shader.name,  "weight": w_shader},
            {"kind": "palette_ref", "name": palette.name, "weight": w_palette},
            {"kind": "motion_ref",  "name": motion.name,  "weight": w_motion},
        ],
        "fx_state": fx,
        "motion": mot,
        "palette": {
            "primary":   palette.primary,
            "secondary": palette.secondary,
            "accent":    palette.accent,
            "bg":        palette.bg,
        },
        "audio_reactivity": audio,
        "preview": {
            "thumbnail_svg": make_thumbnail_svg(palette, rng),
            "tags": make_tags(shader, palette, motion),
        },
    }


def validate_preset(p: dict[str, Any]) -> list[str]:
    """Return a list of error messages. Empty list = valid."""
    errs: list[str] = []
    required = ("id", "schema", "created_at", "name", "family", "description",
                "inspiration", "fx_state", "motion", "palette",
                "audio_reactivity", "preview")
    for f in required:
        if f not in p:
            errs.append(f"missing field: {f}")
    if p.get("schema") != "swr-preset/v1":
        errs.append(f"schema must be 'swr-preset/v1', got {p.get('schema')!r}")
    if p.get("family") not in FAMILIES:
        errs.append(f"family must be one of {FAMILIES}, got {p.get('family')!r}")
    if not re.match(r"^swr-preset-\d{4}-\d{2}-\d{2}-[a-z0-9-]+$", p.get("id", "")):
        errs.append(f"id {p.get('id')!r} does not match expected pattern")
    fx = p.get("fx_state", {})
    for k in FX_KEYS:
        if k not in fx:
            errs.append(f"fx_state missing key: {k}")
    if "posterize" in fx and not (1 <= fx["posterize"] <= 16):
        errs.append("posterize must be 1..16")
    for k, v in fx.items():
        if k == "posterize":
            continue
        if not (0.0 <= float(v) <= 1.0):
            errs.append(f"fx_state.{k} out of [0,1]: {v}")
    pal = p.get("palette", {})
    for k in ("primary", "secondary", "accent", "bg"):
        if not re.match(r"^#[0-9a-fA-F]{6}$", str(pal.get(k, ""))):
            errs.append(f"palette.{k} not a 6-digit hex: {pal.get(k)!r}")
    ar = p.get("audio_reactivity", {})
    for band in AUDIO_BANDS:
        if band not in ar:
            errs.append(f"audio_reactivity missing band: {band}")
        elif not isinstance(ar[band], list):
            errs.append(f"audio_reactivity.{band} must be a list")
    if not ar.get("bass"):
        errs.append("audio_reactivity.bass must have at least one entry")
    svg = p.get("preview", {}).get("thumbnail_svg", "")
    if not svg.startswith("<svg"):
        errs.append("preview.thumbnail_svg must start with <svg")
    if len(svg) > 4096:
        errs.append(f"preview.thumbnail_svg too large: {len(svg)} bytes (max 4096)")
    insp_w_sum = sum(i.get("weight", 0) for i in p.get("inspiration", []))
    if not (0.5 <= insp_w_sum <= 1.0):
        errs.append(f"inspiration weights must sum to [0.5, 1.0], got {insp_w_sum}")
    return errs


def pick_seed(rng: random.Random, used_ids: set[str]) -> tuple[ShaderSeed, PaletteSeed, MotionSeed]:
    """Pick a fresh shader/palette/motion combo that doesn't collide with an existing id slug."""
    while True:
        s = rng.choice(SHADER_SEEDS)
        p = rng.choice(PALETTE_SEEDS)
        m = rng.choice(MOTION_SEEDS)
        today = dt.date.today().isoformat()
        slug = slugify(make_name(s, p, m, rng))
        if f"swr-preset-{today}-{slug}" not in used_ids:
            return (s, p, m)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--count", type=int, default=2, help="how many presets to generate")
    ap.add_argument("--seed", type=int, default=None, help="RNG seed (for reproducibility)")
    ap.add_argument("--dry-run", action="store_true", help="don't write anything, just print")
    args = ap.parse_args()
    rng = random.Random(args.seed)
    PRESETS_DIR.mkdir(parents=True, exist_ok=True)
    manifest = load_manifest()
    used_ids = {p["id"] for p in manifest.get("presets", [])}
    new_presets: list[dict[str, Any]] = []
    for _ in range(args.count):
        seed = pick_seed(rng, used_ids)
        p = build_preset(seed, rng)
        errs = validate_preset(p)
        if errs:
            print(f"validation failed for {p.get('id')}:", file=sys.stderr)
            for e in errs:
                print(f"  - {e}", file=sys.stderr)
            return 1
        used_ids.add(p["id"])
        new_presets.append(p)
    for p in new_presets:
        path = PRESETS_DIR / f"{p['id'].split('swr-preset-')[1]}.json"
        with path.open("w") as f:
            json.dump(p, f, indent=2)
        manifest.setdefault("presets", []).append(p)
        print(f"  wrote {path.name}")
    if not args.dry_run:
        write_manifest(manifest)
        print(f"manifest now has {manifest['count']} preset(s)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
