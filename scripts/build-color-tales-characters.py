#!/usr/bin/env python3
"""Build Color Tales default character crops, WebP, and two-color SVG pages."""

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
  # trim outer black border ~3% inset
    pad = max(4, int(min(w, h) * 0.012))
    return left + pad, top + pad, right - pad, bottom - pad


def replace_bottom_right_watermark(im: Image.Image, frac_w=0.18, frac_h=0.11) -> Image.Image:
    arr = np.array(im.convert("RGB"), dtype=np.uint8)
    h, w, _ = arr.shape
    x0 = int(w * (1 - frac_w))
    y0 = int(h * (1 - frac_h))
    sample = arr[y0 - 12 : y0, x0 : w - 2]
    if sample.size == 0:
        return im
    fill = np.median(sample.reshape(-1, 3), axis=0).astype(np.uint8)
    arr[y0:h, x0:w] = fill
    return Image.fromarray(arr)


def remove_small_dark_marks(im: Image.Image, chef: bool) -> Image.Image:
    """Drop ®-sized dark marks in the chef quadrant (bottom-right of tile)."""
    if not chef:
        return im
    arr = np.array(im.convert("RGB"), dtype=np.uint8)
    h, w, _ = arr.shape
    x0, y0 = int(w * 0.62), int(h * 0.72)
    region = arr[y0:h, x0:w]
    lum = 0.299 * region[:, :, 0] + 0.587 * region[:, :, 1] + 0.114 * region[:, :, 2]
    blue = arr[max(0, y0 - 24) : y0, max(0, x0 - 40) : x0]
    if blue.size:
        fill = np.median(blue.reshape(-1, 3), axis=0).astype(np.uint8)
    else:
        fill = np.array([151, 139, 124], dtype=np.uint8)
    mask = lum < 95
    region[mask] = fill
    arr[y0:h, x0:w] = region
    return Image.fromarray(arr)


def clean_sitting_cat_watermark(im: Image.Image) -> Image.Image:
    arr = np.array(im.convert("RGB"), dtype=np.uint8)
    h, w, _ = arr.shape
    x0, y0 = int(w * 0.55), int(h * 0.78)
    sample = arr[int(h * 0.35) : int(h * 0.65), int(w * 0.35) : int(w * 0.65)]
    fill = np.median(sample.reshape(-1, 3), axis=0).astype(np.uint8)
    region = arr[y0:h, x0:w]
    lum = 0.299 * region[:, :, 0] + 0.587 * region[:, :, 1] + 0.114 * region[:, :, 2]
    # grey watermark text / logos
    mask = (lum > 140) & (lum < 230)
    region[mask] = fill
    lum2 = 0.299 * region[:, :, 0] + 0.587 * region[:, :, 1] + 0.114 * region[:, :, 2]
    mask2 = lum2 < 100
    region[mask2] = fill
    arr[y0:h, x0:w] = region
    return Image.fromarray(arr)


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


def refine_two_color(im: Image.Image, threshold: int = 165, max_dim: int = 480) -> str:
    im = im.convert("RGB")
    scale = min(1.0, max_dim / max(im.size))
    if scale < 1:
        im = im.resize((max(1, int(im.width * scale)), max(1, int(im.height * scale))), Image.Resampling.LANCZOS)
    w, h = im.size
    arr = np.array(im, dtype=np.float64)
    mask = np.zeros((h, w), dtype=np.uint8)
    for y in range(h):
        for x in range(w):
            r, g, b = arr[y, x]
            if luminance(r, g, b) < threshold:
                mask[y, x] = 1
    # smooth
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


def process_sheet(src: Path, variant: str) -> list[dict]:
    im = Image.open(src).convert("RGB")
    im = replace_bottom_right_watermark(im)
    box = frame_crop_box(im)
    im = im.crop(box)
    tiles = split_grid(im)
    entries = []
    for tile, (slug, title, hint) in zip(tiles, NAMES):
        if slug == "chef":
            tile = remove_small_dark_marks(tile, chef=True)
        if slug == "sitting-cat":
            tile = clean_sitting_cat_watermark(tile)
        tid = f"{slug}-{variant}"
        webp_path = PAGES_DIR / f"{tid}.webp"
        svg_path = PAGES_DIR / f"{tid}.svg"
        tile.save(webp_path, "WEBP", quality=82, method=6)
        svg = sanitize_svg(refine_two_color(tile))
        svg_path.write_text(svg, encoding="utf-8")
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
    return entries


def main() -> int:
    if not SRC_A.is_file() or not SRC_B.is_file():
        print("Source JPGs missing", file=sys.stderr)
        return 1
    PAGES_DIR.mkdir(parents=True, exist_ok=True)
    pages = process_sheet(SRC_A, "a") + process_sheet(SRC_B, "b")
    # Hero sheet: cleaned A grid resized for lightweight reference
    hero = Image.open(SRC_A).convert("RGB")
    hero = replace_bottom_right_watermark(hero)
    hero = hero.crop(frame_crop_box(hero))
    hero.thumbnail((1200, 1200), Image.Resampling.LANCZOS)
    hero.save(OUT / "characters.webp", "WEBP", quality=82, method=6)

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
    }
    (OUT / "default-pages.json").write_text(json.dumps(bundle, indent=2) + "\n", encoding="utf-8")

  # JS bundle for offline-first load (embedded SVG, no extra fetch)
    js_lines = [
        "/* generated by scripts/build-color-tales-characters.py — do not edit */",
        "(function () {",
        "  const PAGES = " + json.dumps(
            [[e["title"], e["hint"], {"svg": e["svg"]}] for e in pages],
            ensure_ascii=False,
        ) + ";",
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
    sw = re.sub(r"const CACHE = 'swr-color-tales-v\d+'", "const CACHE = 'swr-color-tales-v3'", sw)
    sw = re.sub(
        r"const SHELL = \[[\s\S]*?\];",
        f"const SHELL = [\n  {shell_js},\n];",
        sw,
        count=1,
    )
    sw_path.write_text(sw, encoding="utf-8")

    print(f"✓ {len(pages)} pages, characters.webp, default-pages.bundle.js")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
