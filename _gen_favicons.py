#!/usr/bin/env python3
"""
_gen_favicons.py — generate the brand favicon set + per-engine favicons.

Outputs:
  favicon.svg                     — vector SWR monogram (modern browsers)
  favicon.ico                     — multi-size ICO (16+32+48)
  apple-touch-icon.png            — 180x180 with safe-area padding
  icon-192.png / icon-512.png     — PWA icons
  icon-maskable-512.png           — maskable PWA variant
  icons/engine-<name>.png         — per-engine 32x32 favicon (small accent)

The brand mark is a circular monogram with a centred "S" over a glowing
amber ring — matches the SWR badge used in the keyart series.
"""

import struct
import zlib
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont, ImageFilter


# ----------------------------------------------------------------------
# Brand mark drawer — re-used at multiple sizes
# ----------------------------------------------------------------------

def brand_mark(size=512, ring_color=(245, 165, 36), bg_color=(10, 13, 18),
               letter="S", letter_color=(255, 255, 255),
               glow_color=(245, 165, 36)):
    """Draw the SWR mark at any size. Returns a PIL Image (RGBA)."""
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img, "RGBA")
    # Soft outer glow (radial)
    glow = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    cx, cy = size // 2, size // 2
    for r in range(size // 2, size // 8, -2):
        a = max(0, int(255 * (1 - r / (size // 2)) ** 2 * 0.7))
        gd.ellipse([cx - r, cy - r, cx + r, cy + r],
                   outline=glow_color + (a,), width=2)
    glow = glow.filter(ImageFilter.GaussianBlur(max(1, size // 64)))
    img = Image.alpha_composite(img, glow)
    # Solid bg circle
    draw = ImageDraw.Draw(img, "RGBA")
    pad = max(4, size // 16)
    draw.ellipse([pad, pad, size - pad, size - pad], fill=bg_color + (255,))
    # Amber ring
    draw.ellipse([pad + 2, pad + 2, size - pad - 2, size - pad - 2],
                 outline=ring_color + (255,), width=max(2, size // 48))
    # Letter
    font_paths = [
        "/System/Library/Fonts/Supplemental/Arial Black.ttf",
        "/System/Library/Fonts/Supplemental/Arial.ttf",
        "/Library/Fonts/Arial Black.ttf",
        "/Library/Fonts/Arial.ttf",
        "/System/Library/Fonts/Helvetica.ttc",
    ]
    f = None
    for p in font_paths:
        if Path(p).exists():
            try:
                f = ImageFont.truetype(p, int(size * 0.55))
                break
            except Exception:
                continue
    if f is None:
        f = ImageFont.load_default()
    bbox = draw.textbbox((0, 0), letter, font=f)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    tx = (size - tw) // 2 - bbox[0]
    ty = (size - th) // 2 - bbox[1]
    # Subtle shadow
    draw.text((tx + max(1, size // 128), ty + max(1, size // 128)),
              letter, font=f, fill=(0, 0, 0, 180))
    draw.text((tx, ty), letter, font=f, fill=letter_color + (255,))
    return img


# ----------------------------------------------------------------------
# SVG monogram (vector source)
# ----------------------------------------------------------------------

FAVICON_SVG = '''<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">
  <defs>
    <radialGradient id="glow" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#f5a524" stop-opacity="0.6" />
      <stop offset="60%" stop-color="#f5a524" stop-opacity="0.15" />
      <stop offset="100%" stop-color="#f5a524" stop-opacity="0" />
    </radialGradient>
    <linearGradient id="ring" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#f5a524" />
      <stop offset="100%" stop-color="#d4a24c" />
    </linearGradient>
  </defs>
  <circle cx="32" cy="32" r="30" fill="url(#glow)" />
  <circle cx="32" cy="32" r="26" fill="#0a0d12" />
  <circle cx="32" cy="32" r="26" fill="none" stroke="url(#ring)" stroke-width="2.5" />
  <text x="32" y="32" text-anchor="middle" dominant-baseline="central"
        font-family="Arial Black, Arial, Helvetica, sans-serif" font-weight="900"
        font-size="32" fill="#ffffff">S</text>
</svg>
'''


# ----------------------------------------------------------------------
# Minimal ICO writer (PNG-encoded entries are supported by all modern browsers)
# ----------------------------------------------------------------------

def write_ico(path, sizes):
    """Write a multi-size ICO from a list of (size, PNG-bytes) tuples."""
    out = bytearray()
    # ICONDIR
    out += struct.pack("<HHH", 0, 1, len(sizes))
    offset = 6 + 16 * len(sizes)
    entries = bytearray()
    payloads = bytearray()
    for size, png in sizes:
        w = size if size < 256 else 0
        h = size if size < 256 else 0
        entries += struct.pack("<BBBBHHII", w, h, 0, 0, 1, 32,
                                len(png), offset + len(payloads))
        payloads += png
    out += entries + payloads
    Path(path).write_bytes(out)


# ----------------------------------------------------------------------
# Main
# ----------------------------------------------------------------------

def main():
    root = Path(".")

    # --- favicon.svg ---------------------------------------------------
    (root / "favicon.svg").write_text(FAVICON_SVG)
    print("  favicon.svg")

    # --- favicon.ico (16, 32, 48) --------------------------------------
    ico_sizes = []
    for sz in (16, 32, 48):
        im = brand_mark(size=sz * 8).resize((sz, sz), Image.Resampling.LANCZOS)
        from io import BytesIO
        buf = BytesIO()
        im.save(buf, format="PNG", optimize=True)
        ico_sizes.append((sz, buf.getvalue()))
    write_ico(root / "favicon.ico", ico_sizes)
    print("  favicon.ico (16/32/48)")

    # --- apple-touch-icon.png (180×180, no transparency, white padding) ---
    at = brand_mark(size=720).resize((180, 180), Image.Resampling.LANCZOS).convert("RGB")
    bg = Image.new("RGB", (180, 180), (255, 255, 255))
    bg.paste(at, (0, 0))
    bg.save(root / "apple-touch-icon.png", optimize=True)
    print("  apple-touch-icon.png (180)")

    # --- PWA icons (192, 512, maskable 512) ---------------------------
    icons = root / "icons"
    icons.mkdir(exist_ok=True)
    for sz, fname in [(192, "icon-192.png"), (512, "icon-512.png"),
                       (512, "icon-maskable-512.png")]:
        im = brand_mark(size=sz * 2)
        im.save(icons / fname, optimize=True)
        print(f"  icons/{fname}")

    # --- per-engine favicons (32x32, accent-coloured ring) -------------
    import sys
    sys.path.insert(0, ".")
    from _gen_keyart import load_presets
    presets = load_presets()
    for key, p in presets.items():
        ring = tuple(int(round(c * 255)) for c in p["tint"])
        im = brand_mark(size=128, ring_color=ring).resize((32, 32), Image.Resampling.LANCZOS)
        im.save(icons / f"engine-{key}.png", optimize=True)
    print(f"  icons/engine-<engine>.png ({len(presets)} per-engine)")

    # --- Summary ---
    print(f"\nTotal assets written under {icons}")


if __name__ == "__main__":
    main()
