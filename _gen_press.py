#!/usr/bin/env python3
"""
_gen_press.py — refresh the press kit's hero + og-card PNGs to match the
new keyart palette + add a light-variant logo.

Outputs:
  press/hero.png         — 1920x1080 wide hero (was: outdated)
  press/og-card.png      — 1200x630 social card (refreshed)
  press/logo-light.svg   — light variant of the existing press logo
"""

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont, ImageFilter
import sys
sys.path.insert(0, ".")

from _gen_keyart import base_field, blend_over, load_presets

PRESETS = load_presets()


# ----------------------------------------------------------------------
# Press hero (1920x1080) — wide composition with all 19 engine tiles
# ----------------------------------------------------------------------

def press_hero():
    """Hero: a row of mini-tile cards, each showing an engine key art.
    Designed for press kits / press page headers.
    """
    import math
    W, H = 1920, 1080
    img = base_field(((8, 8, 12), (16, 14, 22)))
    draw = ImageDraw.Draw(img, "RGBA")

    # Title at top
    font_paths = [
        "/System/Library/Fonts/Supplemental/Arial Black.ttf",
        "/Library/Fonts/Arial Black.ttf",
        "/System/Library/Fonts/Helvetica.ttc",
    ]
    title_font = sub_font = badge_font = None
    for p in font_paths:
        if Path(p).exists():
            try:
                title_font = ImageFont.truetype(p, 130)
                sub_font = ImageFont.truetype(p, 36)
                badge_font = ImageFont.truetype(p, 28)
                break
            except Exception:
                continue
    if title_font is None:
        title_font = ImageFont.load_default()

    title = "SAINTED WORD RECORDS"
    tb = draw.textbbox((0, 0), title, font=title_font)
    tw, th = tb[2] - tb[0], tb[3] - tb[1]
    tx = (W - tw) // 2
    ty = 80
    # Glow under the wordmark
    glow = Image.new("RGBA", img.size, (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    for r in range(150, 30, -2):
        a = max(0, int(180 * (1 - r / 150) ** 1.5))
        gd.ellipse([tx - 60, ty - r, tx + tw + 60, ty + th + r],
                   outline=(245, 165, 36, a), width=3)
    glow = glow.filter(ImageFilter.GaussianBlur(12))
    img = Image.alpha_composite(img.convert("RGBA"), glow).convert("RGB")
    draw = ImageDraw.Draw(img, "RGBA")
    draw.text((tx + 6, ty + 6), title, font=title_font, fill=(0, 0, 0, 200))
    draw.text((tx, ty), title, font=title_font, fill=(255, 255, 255, 255))

    sub = "An audio-reactive video engine · 19 FX presets · 1 web page"
    # Trim sub to fit width with margin
    while True:
        sb = draw.textbbox((0, 0), sub, font=sub_font)
        if sb[2] - sb[0] <= W - 80:
            break
        if " " in sub:
            sub = " ".join(sub.split(" ")[:-1])
        else:
            sub = sub[:-1]
    if sub != "An audio-reactive video engine · 19 FX presets · 1 web page":
        sub = sub.rstrip(".") + "..."
    sb = draw.textbbox((0, 0), sub, font=sub_font)
    sw = sb[2] - sb[0]
    sx = (W - sw) // 2
    sy = ty + th + 30
    draw.text((sx + 2, sy + 2), sub, font=sub_font, fill=(0, 0, 0, 180))
    draw.text((sx, sy), sub, font=sub_font, fill=(245, 165, 36, 255))

    # 19 engine tiles in a 5x4 grid (one empty cell)
    engines = list(PRESETS.keys())
    cols = 5
    rows = 4
    tile_w = 320
    tile_h = 170
    gap_x = 20
    gap_y = 20
    grid_w = cols * tile_w + (cols - 1) * gap_x
    grid_h = rows * tile_h + (rows - 1) * gap_y
    ox = (W - grid_w) // 2
    oy = sy + 80
    for i, key in enumerate(engines):
        col = i % cols
        row = i // cols
        x0 = ox + col * (tile_w + gap_x)
        y0 = oy + row * (tile_h + gap_y)
        tile = Image.open(f"keyart/{key}.png").resize(
            (tile_w, tile_h), Image.Resampling.LANCZOS)
        img.paste(tile, (x0, y0))
        # subtle inner border
        draw = ImageDraw.Draw(img, "RGBA")
        draw.rectangle([x0, y0, x0 + tile_w - 1, y0 + tile_h - 1],
                       outline=(255, 255, 255, 30), width=1)
    return img


# ----------------------------------------------------------------------
# Og card (1200x630) — single hero with the SWR wordmark
# ----------------------------------------------------------------------

def press_og_card():
    """Social-share card — aurora ribbon background + bold wordmark."""
    import math
    W, H = 1200, 630
    img = base_field(((20, 12, 38), (40, 20, 70)))
    glow = Image.new("RGB", img.size, (0, 0, 0))
    gd = ImageDraw.Draw(glow, "RGBA")
    ribbons = [
        (60, 180, (255, 179, 186)),
        (170, 290, (179, 255, 217)),
        (300, 420, (212, 179, 255)),
        (430, 540, (186, 225, 255)),
    ]
    for y0, y1, col in ribbons:
        for y in range(y0, y1):
            x_off = int(60 * math.sin(y / 24))
            gd.ellipse([x_off - 400, y - 36, x_off + W + 400, y + 36],
                       fill=col + (160,))
    glow = glow.filter(ImageFilter.GaussianBlur(14))
    img = blend_over(img, glow, alpha=0.95)

    # Heavy black overlay for type legibility
    overlay = Image.new("RGB", img.size, (0, 0, 0))
    img = blend_over(img, overlay, alpha=0.45)

    draw = ImageDraw.Draw(img, "RGBA")
    font_paths = [
        "/System/Library/Fonts/Supplemental/Arial Black.ttf",
        "/Library/Fonts/Arial Black.ttf",
        "/System/Library/Fonts/Helvetica.ttc",
    ]
    title_font = sub_font = None
    for p in font_paths:
        if Path(p).exists():
            try:
                title_font = ImageFont.truetype(p, 110)
                sub_font = ImageFont.truetype(p, 30)
                break
            except Exception:
                continue

    # Two-line title
    line1 = "SAINTED"
    line2 = "WORD RECORDS"
    for line, dy in [(line1, 130), (line2, 260)]:
        tb = draw.textbbox((0, 0), line, font=title_font)
        tw = tb[2] - tb[0]
        tx = (W - tw) // 2
        # Glow
        glow = Image.new("RGBA", img.size, (0, 0, 0, 0))
        gd = ImageDraw.Draw(glow)
        for r in range(60, 6, -2):
            a = max(0, int(180 * (1 - r / 60) ** 1.5))
            gd.rectangle([tx - 30, dy - r, tx + tw + 30, dy + 120 + r],
                         outline=(245, 165, 36, a), width=2)
        glow = glow.filter(ImageFilter.GaussianBlur(8))
        img = Image.alpha_composite(img.convert("RGBA"), glow).convert("RGB")
        draw = ImageDraw.Draw(img, "RGBA")
        draw.text((tx + 5, dy + 5), line, font=title_font, fill=(0, 0, 0, 220))
        draw.text((tx, dy), line, font=title_font, fill=(255, 255, 255, 255))

    sub = "Audio-reactive video engine · Sainted Word Records"
    sb = draw.textbbox((0, 0), sub, font=sub_font)
    sw = sb[2] - sb[0]
    sx = (W - sw) // 2
    sy = 460
    draw.text((sx + 2, sy + 2), sub, font=sub_font, fill=(0, 0, 0, 200))
    draw.text((sx, sy), sub, font=sub_font, fill=(245, 165, 36, 255))

    return img


# ----------------------------------------------------------------------
# Light logo variant
# ----------------------------------------------------------------------

LOGO_LIGHT_SVG = '''<?xml version="1.0" encoding="UTF-8"?>
<!-- SWR wordmark — light-mode variant. Inverse of logo.svg. -->
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 480 120" role="img" aria-label="Sainted Word Records">
  <defs>
    <linearGradient id="g" x1="0" x2="1" y1="0" y2="0">
      <stop offset="0" stop-color="#c47e10"/>
      <stop offset="1" stop-color="#a47520"/>
    </linearGradient>
  </defs>
  <!-- Two-cycle audio waveform -->
  <g stroke="url(#g)" stroke-width="4" fill="none" stroke-linecap="round">
    <path d="M 20 60 Q 50 30, 80 60 T 140 60"/>
    <path d="M 20 60 Q 50 90, 80 60 T 140 60" opacity="0.55"/>
  </g>
  <circle cx="140" cy="60" r="6" fill="#008cb3"/>
  <g font-family="-apple-system, 'SF Pro Display', 'Inter', sans-serif" font-weight="800" letter-spacing="2">
    <text x="170" y="55" font-size="22" fill="#a47520">SAINTED WORD</text>
    <text x="170" y="90" font-size="38" fill="#1a1a1f">RECORDS</text>
  </g>
</svg>
'''


def main():
    Path("press").mkdir(exist_ok=True)
    hero = press_hero()
    hero.save("press/hero.png", optimize=True)
    print("  press/hero.png (1920x1080)")
    og = press_og_card()
    og.save("press/og-card.png", optimize=True)
    print("  press/og-card.png (1200x630)")
    Path("press/logo-light.svg").write_text(LOGO_LIGHT_SVG)
    print("  press/logo-light.svg")


if __name__ == "__main__":
    main()
