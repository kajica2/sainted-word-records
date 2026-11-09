#!/usr/bin/env python3
"""Build Color Tales default character crops, WebP, and two-color SVG pages (crop-only)."""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "color-tales"
PAGES_DIR = OUT / "pages"
SRC_A = ROOT / "color-tales/source/characters-a.jpg"
SRC_B = ROOT / "color-tales/source/characters-b.jpg"

NAMES = (
    ("chef", "Chef boy", "Noodles and chopsticks."),
    ("cat-face", "Cat face", "Bold whiskers and stare."),
    ("girl", "Girl and leaves", "Leaves and curved lines."),
    ("sitting-cat", "Sitting cat", "Patterns and tail."),
)

# Fractions trimmed from left, top, right, bottom (no inpainting). None = skip variant.
CROP_INSETS: dict[tuple[str, str], tuple[float, float, float, float] | None] = {
    ("chef", "a"): (0.0, 0.0, 0.20, 0.20),
    ("chef", "b"): (0.0, 0.0, 0.20, 0.10),
    ("cat-face", "a"): (0.0, 0.0, 0.05, 0.05),
    ("cat-face", "b"): (0.0, 0.0, 0.05, 0.05),
    ("girl", "a"): (0.0, 0.0, 0.05, 0.05),
    ("girl", "b"): (0.0, 0.0, 0.05, 0.05),
    ("sitting-cat", "a"): (0.0, 0.0, 0.16, 0.13),
    ("sitting-cat", "b"): None,
}

DROP_REASONS: dict[tuple[str, str], str] = {
    ("sitting-cat", "b"): "LEA/logo overlaps the tail; no crop clears it without cutting the character.",
}


def luminance(r, g, b):
    return 0.299 * r + 0.587 * g + 0.114 * b


def frame_crop_box(im: Image.Image) -> tuple[int, int, int, int]:
    arr = np.array(im.convert("RGB"), dtype=np.int16)
    h, w, _ = arr.shape
    lum = 0.299 * arr[:, :, 0] + 0.587 * arr[:, :, 1] + 0.114 * arr[:, :, 2]

    def dark_frac(vals):
        return (vals < 80).mean()

    top = next((y for y in range(h) if dark_frac(lum[y, :]) > 0.15), 0)
    bottom = next((y for y in range(h - 1, top, -1) if dark_frac(lum[y, :]) > 0.12), h - 1)
    left = next((x for x in range(w) if dark_frac(lum[:, x]) > 0.15), 0)
    right = next((x for x in range(w - 1, left, -1) if dark_frac(lum[:, x]) > 0.12), w - 1)
    pad = max(4, int(min(w, h) * 0.012))
    return left + pad, top + pad, right - pad, bottom - pad


def split_grid(im: Image.Image) -> list[Image.Image]:
    w, h = im.size
    hw, hh = w // 2, h // 2
    gutter = max(2, int(min(w, h) * 0.008))
    boxes = [
        (0, 0, hw - gutter, hh - gutter),
        (hw + gutter, 0, w, hh - gutter),
        (0, hh + gutter, hw - gutter, h),
        (hw + gutter, hh + gutter, w, h),
    ]
    return [im.crop(b) for b in boxes]


def apply_crop_insets(tile: Image.Image, insets: tuple[float, float, float, float]) -> Image.Image:
    left, top, right, bottom = insets
    w, h = tile.size
    box = (
        int(w * left),
        int(h * top),
        max(int(w * left) + 32, int(w * (1 - right))),
        max(int(h * top) + 32, int(h * (1 - bottom))),
    )
    return tile.crop(box)


def validation_issues(im: Image.Image, *, hero: bool = False) -> list[str]:
    """Reject flat beige patches, stock logo strips, or corner ® marks."""
    arr = np.array(im.convert("RGB"))
    h, w, _ = arr.shape
    issues: list[str] = []

    br = arr[int(h * 0.72) :, int(w * 0.48) :].astype(float)
    if br.size:
        std = br.reshape(-1, 3).std(axis=0).mean()
        mean = br.mean()
        if std < 14 and 140 < mean < 200:
            issues.append("flat_beige_patch")

    if hero:
        strip = arr[int(h * 0.84) :, int(w * 0.52) :]
    else:
        strip = arr[int(h * 0.88) :, int(w * 0.45) :]
    lum = 0.299 * strip[:, :, 0] + 0.587 * strip[:, :, 1] + 0.114 * strip[:, :, 2]
    for row in lum:
        if len(row) and (row > 225).mean() > (0.42 if hero else 0.35):
            issues.append("logo_text_strip")
            break

    corner = arr[int(h * 0.8) :, int(w * 0.78) :]
    clum = 0.299 * corner[:, :, 0] + 0.587 * corner[:, :, 1] + 0.114 * corner[:, :, 2]
    dark = (clum < 55).sum()
    if 8 < dark < 120:
        issues.append("corner_r_mark")

    return issues


def refine_two_color(im: Image.Image, threshold: int = 165, max_dim: int = 480) -> str:
    im = im.convert("RGB")
    scale = min(1.0, max_dim / max(im.size))
    if scale < 1:
        im = im.resize(
            (max(1, int(im.width * scale)), max(1, int(im.height * scale))),
            Image.Resampling.LANCZOS,
        )
    w, h = im.size
    arr = np.array(im, dtype=np.float64)
    mask = np.zeros((h, w), dtype=np.uint8)
    for y in range(h):
        for x in range(w):
            r, g, b = arr[y, x]
            if luminance(r, g, b) < threshold:
                mask[y, x] = 1
    for _ in range(1):
        nxt = mask.copy()
        for y in range(1, h - 1):
            for x in range(1, w - 1):
                window = mask[y - 1 : y + 2, x - 1 : x + 2]
                nxt[y, x] = 1 if window.sum() >= 5 else mask[y, x]
        mask = nxt
    stride = max(1, min(w, h) // 120)
    paths: list[str] = []
    for y in range(0, h, stride):
        open_run = False
        start = 0
        for x in range(w):
            on = mask[y, x] == 1
            if on and not open_run:
                open_run = True
                start = x
            if (not on or x == w - 1) and open_run:
                end = x if on else x - 1
                if end > start:
                    paths.append(f"M{start} {y}H{end + 1}v{stride}H{start}Z")
                open_run = False
    path_d = " ".join(paths)
    paper, ink = "#fffdf5", "#2a3d36"
    inner = (
        f'<rect width="100%" height="100%" fill="{paper}"/>'
        + (f'<path d="{path_d}" fill="{ink}" fill-rule="evenodd"/>' if path_d else "")
    )
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" '
        f'width="{w}" height="{h}">{inner}</svg>'
    )


def sanitize_svg(svg: str) -> str:
    if "<svg" not in svg.lower():
        raise ValueError("invalid svg")
    return re.sub(r"<script[\s>]", "<!--script", svg, flags=re.I)


def build_hero(tiles_a: list[Image.Image]) -> Image.Image:
    """2×2 mosaic from cleaned variant-A crops (no sheet-level watermark)."""
    top_w = max(tiles_a[0].width, tiles_a[1].width)
    bot_w = max(tiles_a[2].width, tiles_a[3].width)
    top_h = max(tiles_a[0].height, tiles_a[1].height)
    bot_h = max(tiles_a[2].height, tiles_a[3].height)
    gutter = 8
    canvas = Image.new(
        "RGB",
        (top_w + bot_w + gutter, top_h + bot_h + gutter),
        (245, 253, 255),
    )
    positions = [
        (0, 0),
        (top_w + gutter, 0),
        (0, top_h + gutter),
        (top_w + gutter, top_h + gutter),
    ]
    for tile, (x, y) in zip(tiles_a, positions):
        canvas.paste(tile, (x, y))
    canvas.thumbnail((1200, 1200), Image.Resampling.LANCZOS)
    return canvas


def process_sheet(src: Path, variant: str, hero_tiles: list[Image.Image] | None) -> list[dict]:
    im = Image.open(src).convert("RGB")
    im = im.crop(frame_crop_box(im))
    tiles = split_grid(im)
    entries = []
    for tile, (slug, title, hint) in zip(tiles, NAMES):
        key = (slug, variant)
        insets = CROP_INSETS.get(key)
        if insets is None:
            print(f"  drop {slug}-{variant}: {DROP_REASONS.get(key, 'crop unsafe')}", file=sys.stderr)
            continue
        cropped = apply_crop_insets(tile, insets)
        issues = validation_issues(cropped)
        if issues:
            print(
                f"  drop {slug}-{variant}: validation failed after crop: {', '.join(issues)}",
                file=sys.stderr,
            )
            continue
        tid = f"{slug}-{variant}"
        webp_path = PAGES_DIR / f"{tid}.webp"
        svg_path = PAGES_DIR / f"{tid}.svg"
        cropped.save(webp_path, "WEBP", quality=82, method=6)
        svg = sanitize_svg(refine_two_color(cropped))
        svg_path.write_text(svg, encoding="utf-8")
        svg_issues = validation_issues(
            Image.new("RGB", (cropped.width, cropped.height), (255, 253, 245))
        )
        if svg_issues and "flat_beige" in "".join(svg_issues):
            print(f"  warn {tid} svg sidecar check odd: {svg_issues}", file=sys.stderr)
        entries.append(
            {
                "id": tid,
                "title": f"{title} ({variant.upper()})",
                "hint": hint,
                "webp": f"/color-tales/pages/{tid}.webp",
                "svg": svg,
                "svgPath": f"/color-tales/pages/{tid}.svg",
            }
        )
        if variant == "a" and hero_tiles is not None:
            hero_tiles.append(cropped)
    return entries


def verify_all_outputs(pages: list[dict]) -> list[str]:
    problems = []
    for e in pages:
        webp = ROOT / e["webp"].lstrip("/")
        svg = ROOT / e["svgPath"].lstrip("/")
        if not webp.is_file() or not svg.is_file():
            problems.append(f"missing {e['id']}")
            continue
        issues = validation_issues(Image.open(webp))
        if issues:
            problems.append(f"{e['id']}.webp: {', '.join(issues)}")
        text = svg.read_text(encoding="utf-8")
        if re.search(r"\bLEA\b|iqea|®", text, re.I):
            problems.append(f"{e['id']}.svg: forbidden text")
    hero = OUT / "characters.webp"
    # Hero is a mosaic of tiles that already passed validation (gutter margins are not art).
    if hero.is_file():
        hero_im = Image.open(hero)
        arr = np.array(hero_im.convert("RGB"))
        h, w, _ = arr.shape
        br = arr[int(h * 0.72) :, int(w * 0.48) :].astype(float)
        if br.size:
            std = br.reshape(-1, 3).std(axis=0).mean()
            mean = br.mean()
            if std < 14 and 140 < mean < 200:
                problems.append("characters.webp: flat_beige_patch")
    return problems


def main() -> int:
    if not SRC_A.is_file() or not SRC_B.is_file():
        print("Source JPGs missing", file=sys.stderr)
        return 1
    PAGES_DIR.mkdir(parents=True, exist_ok=True)

    hero_tiles: list[Image.Image] = []
    pages = process_sheet(SRC_A, "a", hero_tiles) + process_sheet(SRC_B, "b", None)
    if len(hero_tiles) != 4:
        print(f"Expected 4 hero tiles, got {len(hero_tiles)}", file=sys.stderr)
        return 1

    build_hero(hero_tiles).save(OUT / "characters.webp", "WEBP", quality=82, method=6)

    # Remove stale outputs (e.g. dropped sitting-cat-b)
    keep = {f"{e['id']}.webp" for e in pages} | {f"{e['id']}.svg" for e in pages}
    for path in PAGES_DIR.glob("*"):
        if path.name not in keep:
            path.unlink()

    problems = verify_all_outputs(pages)
    if problems:
        for p in problems:
            print(f"VERIFY FAIL: {p}", file=sys.stderr)
        return 1

    bundle = {
        "pages": [
            {
                "id": e["id"],
                "title": e["title"],
                "hint": e["hint"],
                "webp": e["webp"],
                "svgPath": e["svgPath"],
            }
            for e in pages
        ],
        "hero": "/color-tales/characters.webp",
        "dropped": [
            {"id": f"{slug}-{variant}", "reason": reason}
            for (slug, variant), reason in DROP_REASONS.items()
        ],
    }
    (OUT / "default-pages.json").write_text(json.dumps(bundle, indent=2) + "\n", encoding="utf-8")

    js_lines = [
        "/* generated by scripts/build-color-tales-characters.py — do not edit */",
        "(function () {",
        "  const PAGES = "
        + json.dumps([[e["title"], e["hint"], {"svg": e["svg"]}] for e in pages], ensure_ascii=False)
        + ";",
        "  window.SWR_COLOR_TALES_DEFAULT_PAGES = PAGES;",
        "})();",
    ]
    (OUT / "default-pages.bundle.js").write_text("\n".join(js_lines) + "\n", encoding="utf-8")

    sw_path = OUT / "sw-color-tales.js"
    sw = sw_path.read_text(encoding="utf-8")
    static_shell = [
        "/color-tales",
        "/color-tales/",
        "/color-tales.html",
        "/color-tales/color-tales.css",
        "/color-tales/color-tales-worker.js",
        "/color-tales/default-characters-placeholder.svg",
        "/color-tales/characters.webp",
        "/color-tales/default-pages.bundle.js",
        "/color-tales/color-tales-manifest.webmanifest",
        "/color-tales/sw-color-tales.js",
        "/client/color-tales-constants.client.js",
        "/client/color-tales-speed.client.js",
        "/client/color-tales-two-color.client.js",
        "/client/color-tales-segment.client.js",
        "/client/color-tales-scheduler.client.js",
        "/client/color-tales-sanitize.client.js",
        "/client/color-tales-storage.client.js",
        "/client/color-tales-export.client.js",
        "/client/color-tales-coverage.client.js",
        "/client/color-tales-paint.client.js",
        "/client/color-tales-audio.client.js",
        "/client/color-tales-record.client.js",
        "/client/color-tales-runtime.client.js",
        "/lib/design-tokens.css",
        "/lib/components.css",
        "/lib/nav.client.js",
        "/lib/footer.client.js",
    ]
    page_urls = [u for e in pages for u in (e["webp"], e["svgPath"])]
    flat_shell = static_shell + page_urls
    shell_js = ",\n  ".join(f"'{u}'" for u in flat_shell)
    sw = re.sub(r"const CACHE = 'swr-color-tales-v\d+'", "const CACHE = 'swr-color-tales-v4'", sw)
    sw = re.sub(
        r"const SHELL = \[[\s\S]*?\];",
        f"const SHELL = [\n  {shell_js},\n];",
        sw,
        count=1,
    )
    sw_path.write_text(sw, encoding="utf-8")

    print(f"✓ {len(pages)} pages, characters.webp (mosaic), dropped: {list(DROP_REASONS)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
