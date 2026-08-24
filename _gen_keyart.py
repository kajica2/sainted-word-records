#!/usr/bin/env python3
"""
_gen_keyart.py — generate per-engine key art (SVG + PNG).

For each of the 19 engines, produces:
  - keyart/<engine>.svg     — vector, source of truth
  - keyart/<engine>.png     — 1200x630 rasterised (og:image ratio)

Design rules:
  - Title wordmark (uppercase engine name) bottom-right.
  - "SWR" tag bottom-left.
  - Palette pulled from versions-presets.js tints.
  - Motif is a deterministic Pillow-drawn version of the GLSL effect
    motif (scanlines / grid / neon halo / smoke wisps / etc.).
  - Subtle noise overlay for grain.
  - 16:9 safe area preserved.
"""

import json
import math
import random
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

# ----------------------------------------------------------------------
# Pull palette from versions-presets.js (so the art matches the shader)
# ----------------------------------------------------------------------

def load_presets(path="versions-presets.js"):
    """Pull the PRESETS dict out of the JS file as a Python dict.

    The JS file is structured so each entry is <key>: { ... }, with simple
    scalars and a `tint: [r, g, b]` array. We parse block-by-block via brace
    counting instead of line-by-line so multi-line regexes (etc.) don't
    confuse the counter.
    """
    import re
    src = Path(path).read_text()
    start = src.find("const PRESETS = {")
    assert start > 0
    # Slice from the opening `{` and find its matching `}` by counting.
    body_start = src.find("{", start)
    depth = 0
    end = body_start
    for i, ch in enumerate(src[body_start:], body_start):
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                end = i
                break
    body = src[body_start:end + 1]
    presets = {}
    # Find each top-level entry: `key: { ... }` at depth 1 inside `body`.
    i = 1  # skip the outer `{`
    n = len(body)
    while i < n:
        # Skip whitespace and commas
        while i < n and body[i] in " \t\n\r,":
            i += 1
        if i >= n:
            break
        # Read key (until `:`)
        kstart = i
        while i < n and body[i] != ":":
            i += 1
        if i >= n:
            break
        key = body[kstart:i].strip()
        i += 1  # past `:`
        # Skip whitespace
        while i < n and body[i] in " \t\n\r":
            i += 1
        if i >= n or body[i] != "{":
            # not an object — skip
            break
        # Find matching `}` for this entry
        depth = 1
        j = i + 1
        while j < n and depth > 0:
            if body[j] == "{":
                depth += 1
            elif body[j] == "}":
                depth -= 1
            j += 1
        entry = body[i + 1:j - 1]
        # Parse scalars and tint array from the entry text
        preset = {}
        for k in ("label", "desc"):
            m = re.search(rf"\b{k}\s*:\s*'([^']*)'", entry)
            if m:
                preset[k] = m.group(1)
        for k in ("temp", "mut", "mutAlgo", "posterize", "vignette",
                  "chroma", "grain", "sepia", "glow", "grayscale",
                  "blur", "effect"):
            m = re.search(rf"\b{k}\s*:\s*([\-\d.]+)", entry)
            if m:
                preset[k] = float(m.group(1))
        tm = re.search(r"tint\s*:\s*\[([\d.\-,\s]+)\]", entry)
        if tm:
            preset["tint"] = [float(x.strip()) for x in tm.group(1).split(",")]
        presets[key] = preset
        i = j
    return presets


PRESETS = load_presets()


def tint_hex(key, idx=0):
    """Pull a 0..1 RGB triple from a preset and convert to hex."""
    p = PRESETS[key]
    c = p["tint"][idx]
    return tuple(int(round(c * 255)) for c in p["tint"])


def hexstr(rgb):
    return "#{:02x}{:02x}{:02x}".format(*rgb)


# ----------------------------------------------------------------------
# Per-engine motif drawers (deterministic, simple Pillow primitives)
# ----------------------------------------------------------------------

W, H = 1200, 630
SAFE = (60, 60, 1140, 530)


def base_field(bg):
    """Vertical gradient field, bg = (top, bottom) tuple of RGB."""
    img = Image.new("RGB", (W, H), bg[0])
    px = img.load()
    for y in range(H):
        t = y / max(H - 1, 1)
        r = int(bg[0][0] * (1 - t) + bg[1][0] * t)
        g = int(bg[0][1] * (1 - t) + bg[1][1] * t)
        b = int(bg[0][2] * (1 - t) + bg[1][2] * t)
        for x in range(W):
            px[x, y] = (r, g, b)
    return img


def add_grain(img, amount=0.04):
    """Fine grayscale film-grain layer to be composited at low alpha."""
    rng = random.Random(0xC0FFEE)
    noise = Image.new("L", img.size, 128)
    px = noise.load()
    n = int(amount * img.size[0] * img.size[1])
    for _ in range(n):
        x = rng.randrange(img.size[0])
        y = rng.randrange(img.size[1])
        # Light +/- delta on top of mid-grey 128
        px[x, y] = rng.randint(0, 255)
    noise = noise.filter(ImageFilter.GaussianBlur(0.4))
    rgb = Image.merge("RGB", (noise, noise, noise))
    return rgb


def blend_over(base, layer, alpha=1.0):
    base = base.convert("RGBA")
    layer = layer.convert("RGBA")
    if alpha < 1.0:
        a = layer.split()[3].point(lambda v: int(v * alpha))
        layer.putalpha(a)
    return Image.alpha_composite(base, layer).convert("RGB")


def draw_wordmark(img, label, subtitle=None):
    """Title wordmark in the lower-right; SWR badge in lower-left."""
    draw = ImageDraw.Draw(img, "RGBA")
    # Try to find a system font
    title_font = None
    sub_font = None
    badge_font = None
    font_paths = [
        "/System/Library/Fonts/Supplemental/Arial Black.ttf",
        "/System/Library/Fonts/Supplemental/Arial.ttf",
        "/Library/Fonts/Arial Black.ttf",
        "/Library/Fonts/Arial.ttf",
        "/System/Library/Fonts/Helvetica.ttc",
    ]
    for p in font_paths:
        if Path(p).exists():
            try:
                title_font = ImageFont.truetype(p, 92)
                sub_font = ImageFont.truetype(p, 22)
                badge_font = ImageFont.truetype(p, 30)
                break
            except Exception:
                continue
    if title_font is None:
        title_font = ImageFont.load_default()
        sub_font = ImageFont.load_default()
        badge_font = ImageFont.load_default()

    # SWR badge bottom-left
    bx, by = 60, H - 90
    draw.rounded_rectangle([bx, by, bx + 130, by + 56], radius=4, fill=(20, 20, 28, 200),
                           outline=(245, 165, 36, 255), width=2)
    draw.text((bx + 16, by + 10), "SWR", font=badge_font, fill=(245, 165, 36, 255))

    # Title bottom-right (measure first so we can place subtitle above with
    # the same right-edge alignment, then clip subtitle to the available
    # width so long descriptions don't run off the canvas).
    text = label.upper()
    tb = draw.textbbox((0, 0), text, font=title_font)
    tw, th = tb[2] - tb[0], tb[3] - tb[1]
    tx = W - 60 - tw
    ty = H - 60 - th
    # subtle shadow
    draw.text((tx + 4, ty + 4), text, font=title_font, fill=(0, 0, 0, 200))
    draw.text((tx, ty), text, font=title_font, fill=(255, 255, 255, 255))

    if subtitle:
        # Trim subtitle so it fits within the title width (right-aligned).
        max_w = tw
        s = subtitle
        while s and draw.textbbox((0, 0), s, font=sub_font)[2] > max_w:
            # Drop a word at a time; fall back to char-trim if even one word is too wide.
            if " " in s:
                parts = s.split(" ")
                if len(parts) == 1:
                    break
                s = " ".join(parts[:-1])
            else:
                s = s[:-1]
        if s != subtitle:
            s = s.rstrip(",.") + "..."
        sb = draw.textbbox((0, 0), s, font=sub_font)
        sw = sb[2] - sb[0]
        sx = W - 60 - sw
        sy = ty - 30
        draw.text((sx + 2, sy + 2), s, font=sub_font, fill=(0, 0, 0, 180))
        draw.text((sx, sy), s, font=sub_font, fill=(255, 255, 255, 220))


# ----------------------------------------------------------------------
# Per-engine motif functions
# ----------------------------------------------------------------------

def motif_film(img):
    # Warm sepia field with scanlines + dust speckles — kept bright enough
    # that the wordmark has somewhere legible to sit.
    img = base_field(((60, 36, 16), (180, 130, 80)))
    draw = ImageDraw.Draw(img, "RGBA")
    # Soft warm vignette (lighter than before so the centre stays visible)
    for r in range(420, 80, -8):
        a = max(0, 80 - int((r / 420) * 80))
        draw.ellipse([W / 2 - r, H / 2 - r, W / 2 + r, H / 2 + r],
                     outline=(40, 24, 12, a), width=4)
    # Scanlines
    for y in range(0, H, 3):
        draw.line([(0, y), (W, y)], fill=(0, 0, 0, 60), width=1)
    # Dust speckles (bright + dark)
    rng = random.Random(0xFEED)
    for _ in range(280):
        x, y = rng.randrange(W), rng.randrange(H)
        s = rng.choice([1, 1, 2, 2, 3])
        v = rng.choice([(255, 235, 200), (0, 0, 0)])
        draw.ellipse([x, y, x + s, y + s], fill=v + (220,))
    # Sepia overlay
    sep = Image.new("RGB", img.size, (210, 165, 110))
    img = blend_over(img, sep, alpha=0.18)
    return img


def motif_grid(img):
    img = base_field(((245, 245, 245), (210, 210, 215)))
    draw = ImageDraw.Draw(img, "RGBA")
    # 16:9 grid
    for x in range(0, W, W // 24):
        draw.line([(x, 0), (x, H)], fill=(0, 0, 0, 80), width=1)
    for y in range(0, H, H // 14):
        draw.line([(0, y), (W, y)], fill=(0, 0, 0, 80), width=1)
    # Heavy posterize: downsample to 4 shades
    pal = img.quantize(colors=4).convert("RGB")
    img = pal
    # Heavy border
    draw = ImageDraw.Draw(img, "RGBA")
    draw.rectangle([0, 0, W - 1, H - 1], outline=(0, 0, 0, 255), width=8)
    return img


def motif_neon(img):
    img = base_field(((8, 4, 14), (16, 6, 28)))
    glow = Image.new("RGB", img.size, (0, 0, 0))
    draw_g = ImageDraw.Draw(glow, "RGBA")
    # Concentric magenta/cyan rings
    cx, cy = W // 2, H // 2
    for r in range(60, 460, 16):
        col = (255, 80, 200) if r % 32 == 0 else (0, 229, 255)
        draw_g.ellipse([cx - r, cy - r, cx + r, cy + r],
                       outline=col + (180,), width=3)
    glow = glow.filter(ImageFilter.GaussianBlur(14))
    img = blend_over(img, glow, alpha=0.9)
    # bright dot at center
    draw = ImageDraw.Draw(img, "RGBA")
    draw.ellipse([cx - 30, cy - 30, cx + 30, cy + 30], fill=(255, 220, 255, 255))
    # Chromatic stripes
    for y in range(0, H, 40):
        draw.line([(0, y), (W, y)], fill=(255, 0, 200, 24), width=2)
    return img


def motif_smoke(img):
    img = base_field(((245, 232, 210), (220, 195, 160)))
    draw = ImageDraw.Draw(img, "RGBA")
    rng = random.Random(0x5)
    for _ in range(40):
        cx = rng.randrange(-50, W + 50)
        cy = rng.randrange(-50, H + 50)
        r = rng.randrange(80, 220)
        # Wisp color
        v = rng.choice([(210, 180, 130), (240, 220, 180)])
        draw.ellipse([cx - r, cy - r, cx + r, cy + r], fill=v + (60,))
    img = img.filter(ImageFilter.GaussianBlur(28))
    # Add some highlights
    draw = ImageDraw.Draw(img, "RGBA")
    for _ in range(8):
        cx = rng.randrange(W)
        cy = rng.randrange(H)
        r = rng.randrange(60, 140)
        draw.ellipse([cx - r, cy - r, cx + r, cy + r],
                     fill=(255, 245, 225, 90))
    img = img.filter(ImageFilter.GaussianBlur(20))
    return img


def motif_hallucination(img):
    img = base_field(((20, 0, 35), (50, 0, 30)))
    draw = ImageDraw.Draw(img, "RGBA")
    # RGB-split stripes
    for y in range(0, H, 4):
        shift = int(15 * math.sin(y / 30))
        col = rng_color = (255, 0, 200, 90)
        draw.line([(shift, y), (W + shift, y)], fill=col, width=2)
    for y in range(0, H, 4):
        shift = int(-15 * math.cos(y / 30))
        draw.line([(shift, y), (W + shift, y)], fill=(0, 220, 255, 90), width=2)
    # Strong scanlines
    for y in range(0, H, 2):
        draw.line([(0, y), (W, y)], fill=(0, 0, 0, 110), width=1)
    img = img.filter(ImageFilter.GaussianBlur(1.4))
    return img


def motif_eclipse(img):
    img = base_field(((0, 0, 0), (10, 8, 18)))
    draw = ImageDraw.Draw(img, "RGBA")
    cx, cy = W // 2, H // 2
    # Corona ring (radial)
    corona = Image.new("RGB", img.size, (0, 0, 0))
    cd = ImageDraw.Draw(corona, "RGBA")
    for r in range(120, 280, 6):
        a = max(0, int(255 - (r - 120) * 1.5))
        cd.ellipse([cx - r, cy - r * 0.7, cx + r, cy + r * 0.7],
                   outline=(255, 200, 100, a), width=3)
    corona = corona.filter(ImageFilter.GaussianBlur(8))
    img = blend_over(img, corona, alpha=0.9)
    # Black sun disk
    draw = ImageDraw.Draw(img, "RGBA")
    draw.ellipse([cx - 100, cy - 100, cx + 100, cy + 100], fill=(0, 0, 0, 255))
    return img


def motif_aurora(img):
    # Bright pastel ribbons over a deep purple-navy field. Stronger contrast
    # than before so the ribbons actually read on the gradient.
    img = base_field(((20, 12, 38), (40, 20, 70)))
    glow = Image.new("RGB", img.size, (0, 0, 0))
    gd = ImageDraw.Draw(glow, "RGBA")
    # Stacked ribbons: 4 bands at different y-offsets and hues
    ribbons = [
        (60, 180, (255, 179, 186)),  # pink
        (170, 290, (179, 255, 217)),  # mint
        (300, 420, (212, 179, 255)),  # violet
        (430, 540, (186, 225, 255)),  # sky
    ]
    for y0, y1, col in ribbons:
        for y in range(y0, y1):
            x_off = int(60 * math.sin(y / 24))
            gd.ellipse([x_off - 400, y - 36, x_off + W + 400, y + 36],
                       fill=col + (160,))
    glow = glow.filter(ImageFilter.GaussianBlur(14))
    img = blend_over(img, glow, alpha=0.95)
    return img


def motif_chrome(img):
    img = base_field(((60, 65, 80), (180, 190, 205)))
    draw = ImageDraw.Draw(img, "RGBA")
    # Specular highlight band (diagonal)
    for i in range(40):
        y0 = 60 + i * 13
        a = int(180 * math.exp(-((i - 20) ** 2) / 80))
        draw.polygon([(0, y0), (W, y0 - 35), (W, y0 + 35), (0, y0 + 70)],
                     fill=(255, 255, 255, a))
    img = img.filter(ImageFilter.GaussianBlur(2))
    # Vignette
    draw = ImageDraw.Draw(img, "RGBA")
    for r in range(500, 60, -6):
        a = max(0, int(255 - (r / 500) * 255))
        draw.ellipse([W / 2 - r, H / 2 - r, W / 2 + r, H / 2 + r],
                     outline=(0, 0, 0, a), width=4)
    return img


def motif_fractal(img):
    img = base_field(((15, 8, 35), (35, 18, 65)))
    glow = Image.new("RGB", img.size, (0, 0, 0))
    gd = ImageDraw.Draw(glow, "RGBA")
    cx, cy = W // 2, H // 2
    # Domain-warped ridges: polar petals
    for r in range(20, 380, 3):
        for ang_deg in range(0, 360, 4):
            ang = math.radians(ang_deg)
            warp = 0.15 * math.sin(ang * 5 + r / 30)
            rr = r * (1 + warp)
            x = cx + rr * math.cos(ang)
            y = cy + rr * math.sin(ang)
            col_idx = (ang_deg + r) % 360
            if col_idx < 60:
                col = (200, 100, 255)
            elif col_idx < 120:
                col = (255, 130, 220)
            elif col_idx < 180:
                col = (255, 200, 100)
            elif col_idx < 240:
                col = (120, 220, 255)
            else:
                col = (180, 100, 255)
            gd.ellipse([x - 1.5, y - 1.5, x + 1.5, y + 1.5], fill=col + (140,))
    glow = glow.filter(ImageFilter.GaussianBlur(2))
    img = blend_over(img, glow, alpha=0.9)
    return img


def motif_glitch(img):
    # Datamosh: horizontal slice displacement with RGB-split colour bands.
    # The previous version pasted shifted slices over the field but left
    # black gaps at the margins; this version paints the slice as a wide
    # enough rect that the shift still covers the full canvas.
    img = base_field(((20, 25, 30), (45, 55, 65)))
    draw = ImageDraw.Draw(img, "RGBA")
    rng = random.Random(0x61170)
    slices = 28
    sl_h = H // slices
    for i in range(slices):
        y0 = i * sl_h
        offset = rng.randint(-60, 60)
        # Pick a colour band per slice — cyan/magenta/white/orange split
        col = rng.choice([(255, 80, 200), (80, 255, 200), (80, 200, 255),
                          (240, 240, 240), (255, 200, 80)])
        # Wide rect that extends past the canvas on both sides
        draw.rectangle([-200, y0, W + 200, y0 + sl_h - 1], fill=col + (210,))
        # Slight horizontal gradient across the slice
        for x in range(0, W + 200, 60):
            a = rng.randint(20, 80)
            draw.rectangle([x, y0, x + 30, y0 + sl_h - 1],
                           fill=col + (a,))
    # Translate the whole field by a small horizontal amount — the datamosh feel
    shifted = img.transform(img.size, Image.AFFINE,
                            (1, 0, 18, 0, 1, 0), resample=Image.BILINEAR)
    img = shifted
    return img


def motif_pulse(img):
    img = base_field(((5, 8, 20), (10, 18, 35)))
    glow = Image.new("RGB", img.size, (0, 0, 0))
    gd = ImageDraw.Draw(glow, "RGBA")
    cx, cy = W // 2, H // 2
    # Concentric pulse rings
    rings = [(80, 230, 1.0), (140, 200, 0.8), (200, 160, 0.6),
             (260, 120, 0.45), (320, 90, 0.3), (380, 60, 0.2)]
    for r, alpha, thick in rings:
        gd.ellipse([cx - r, cy - r * 0.7, cx + r, cy + r * 0.7],
                   outline=(100, 220, 255, int(alpha * 255)), width=int(18 * thick))
    glow = glow.filter(ImageFilter.GaussianBlur(3))
    img = blend_over(img, glow, alpha=0.95)
    # Strong vignette
    draw = ImageDraw.Draw(img, "RGBA")
    for r in range(500, 80, -6):
        a = max(0, int(255 - (r / 500) * 200))
        draw.ellipse([W / 2 - r, H / 2 - r, W / 2 + r, H / 2 + r],
                     outline=(0, 0, 0, a), width=3)
    return img


def motif_void(img):
    img = base_field(((0, 0, 0), (4, 6, 12)))
    draw = ImageDraw.Draw(img, "RGBA")
    rng = random.Random(0xDEAD0)
    # Sparse star field
    for _ in range(160):
        x, y = rng.randrange(W), rng.randrange(H)
        s = rng.choice([1, 1, 1, 2, 2, 3])
        v = rng.choice([(200, 220, 255), (255, 255, 255),
                        (180, 200, 255), (220, 240, 255)])
        draw.ellipse([x, y, x + s, y + s], fill=v + (220,))
    # Heavy vignette
    for r in range(520, 80, -4):
        a = max(0, int(255 - (r / 520) * 255))
        draw.ellipse([W / 2 - r, H / 2 - r, W / 2 + r, H / 2 + r],
                     outline=(0, 0, 0, a), width=4)
    return img


def motif_watercolor(img):
    img = base_field(((245, 230, 220), (255, 240, 230)))
    draw = ImageDraw.Draw(img, "RGBA")
    rng = random.Random(0xA9E00)
    # Pigment pools — soft elliptical blobs, mostly desaturated
    palette = [(220, 130, 110), (110, 180, 200), (240, 200, 100),
               (180, 130, 200), (130, 200, 170), (230, 160, 180)]
    for _ in range(28):
        cx = rng.randrange(W)
        cy = rng.randrange(H)
        rx = rng.randrange(80, 240)
        ry = rng.randrange(60, 180)
        col = rng.choice(palette)
        draw.ellipse([cx - rx, cy - ry, cx + rx, cy + ry], fill=col + (180,))
    img = img.filter(ImageFilter.GaussianBlur(8))
    # Pigment edges (sharp dark rims)
    edges = img.filter(ImageFilter.FIND_EDGES)
    edges = edges.convert("RGBA")
    edge_alpha = edges.split()[0].point(lambda v: min(255, int(v * 1.6)))
    edges.putalpha(edge_alpha)
    img = blend_over(img, edges, alpha=0.35)
    return img


# Stub-engine motifs: minimal but distinct.
def motif_stub(key, tint):
    """For stub pages: a single accent shape on a near-black field, plus the engine name in big caps."""
    img = base_field(((12, 12, 16), (22, 22, 28)))
    glow = Image.new("RGB", img.size, (0, 0, 0))
    gd = ImageDraw.Draw(glow, "RGBA")
    cx, cy = W // 2, H // 2
    # Soft accent halo
    for r in range(360, 60, -8):
        a = max(0, int(255 - (r / 360) * 255))
        gd.ellipse([cx - r, cy - r, cx + r, cy + r],
                   outline=tint + (a,), width=2)
    glow = glow.filter(ImageFilter.GaussianBlur(20))
    img = blend_over(img, glow, alpha=0.85)
    return img


MOTIF_DISPATCH = {
    "film": motif_film,
    "grid": motif_grid,
    "neon": motif_neon,
    "smoke": motif_smoke,
    "hallucination": motif_hallucination,
    "eclipse": motif_eclipse,
    "aurora": motif_aurora,
    "chrome": motif_chrome,
    "fractal": motif_fractal,
    "glitch": motif_glitch,
    "pulse": motif_pulse,
    "void": motif_void,
    "watercolor": motif_watercolor,
}

STUBS = {"baroque", "gallery", "kraft", "mosaic", "phosphor", "tape"}


# ----------------------------------------------------------------------
# Main
# ----------------------------------------------------------------------

def main():
    out_svg = Path("keyart")
    out_png = Path("keyart")
    out_svg.mkdir(exist_ok=True)
    out_png.mkdir(exist_ok=True)

    for key in PRESETS:
        tint = tuple(int(round(c * 255)) for c in PRESETS[key]["tint"])
        if key in MOTIF_DISPATCH:
            img = MOTIF_DISPATCH[key](None)
        else:
            img = motif_stub(key, tint)
        img = blend_over(img, add_grain(img, amount=0.06), alpha=0.12)
        draw_wordmark(img, PRESETS[key]["label"], PRESETS[key]["desc"])
        # Save PNG
        img.save(out_png / f"{key}.png", optimize=True)
        # Save a simple SVG that just references the PNG (we don't try to
        # convert pixel art back to vectors — that's lossy and not the goal).
        svg = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 630">
  <image href="{key}.png" width="1200" height="630" />
</svg>
'''
        (out_svg / f"{key}.svg").write_text(svg)
        print(f"  {key}: keyart/{key}.{{svg,png}}  tint={tint}")

    # Composite master OG (matches site root /og.png reference) — use aurora
    master = Image.open(out_png / "aurora.png")
    master.save("og.png", optimize=True)
    master.save("og.png", optimize=True)  # idempotent
    print("  og.png refreshed (aurora key art)")


if __name__ == "__main__":
    main()
