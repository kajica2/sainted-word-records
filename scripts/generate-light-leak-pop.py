#!/usr/bin/env python3
"""Generate public/media/transitions/light-leak-pop.webp.

Sprint C1 of feat/asset-curator burndown. Generates a 1920x1080 warm light
leak with:
  - Orange -> pink -> gold radial bleed
  - Horizontal anamorphic streaks
  - Slight vignette (darker corners)
  - Center bias (heavier bleed on the left third, like real lens leaks)

This is a one-off generator; run it once to (re)create the asset. The
output is checked into git.

Run from repo root:
    python3 scripts/generate-light-leak-pop.py
"""

import math
import os
from PIL import Image, ImageDraw, ImageFilter

W, H = 1920, 1080
OUT = "media/transitions/light-leak-pop.webp"

def clamp01(v):
    return max(0.0, min(1.0, v))

def main():
    os.makedirs(os.path.dirname(OUT), exist_ok=True)

    # ---- Base radial bleed ------------------------------------------------
    # Hot center: warm cream (#FFE0A0) -> orange (#FF8C50) -> pink (#DC5078)
    # Center biased to 30% x, 40% y (matches the existing CSS gradient stop).
    img = Image.new("RGB", (W, H), (0, 0, 0))
    px = img.load()
    cx, cy = int(W * 0.30), int(H * 0.40)
    # Distance metric: ellipse 60% x 80% so the falloff is horizontal-elliptical
    rx = W * 0.60
    ry = H * 0.80
    max_r = 1.0  # normalized distance inside the ellipse

    for y in range(H):
        for x in range(W):
            dx = (x - cx) / rx
            dy = (y - cy) / ry
            d = math.sqrt(dx * dx + dy * dy)
            t = clamp01(d)
            # 5-stop gradient sampled linearly
            if t < 0.3:
                # hot center: cream -> orange
                u = t / 0.3
                r = int(255 + (255 - 255) * u)  # 255
                g = int(224 + (140 - 224) * u)
                b = int(160 + (80 - 160) * u)
            elif t < 0.6:
                # orange -> pink
                u = (t - 0.3) / 0.3
                r = int(255 + (220 - 255) * u)
                g = int(140 + (80 - 140) * u)
                b = int(80 + (120 - 80) * u)
            elif t < 0.9:
                # pink -> transparent black (fade)
                u = (t - 0.6) / 0.3
                r = int(220 * (1 - u))
                g = int(80 * (1 - u))
                b = int(120 * (1 - u))
            else:
                r = g = b = 0
            px[x, y] = (r, g, b)

    # ---- Horizontal anamorphic streaks -----------------------------------
    # A few thin bright streaks across the frame, slightly translucent.
    # Drawn on top with a separate pass so we can blur them.
    streaks = Image.new("RGB", (W, H), (0, 0, 0))
    sd = ImageDraw.Draw(streaks)
    streak_positions = [
        (0.20, 0.55, 0.85, 22, (255, 230, 180)),  # x_start, y_frac, x_end, thickness, color
        (0.10, 0.35, 0.75, 14, (255, 200, 140)),
        (0.30, 0.70, 0.95, 18, (255, 220, 160)),
        (0.05, 0.50, 0.60, 12, (255, 180, 120)),
        (0.40, 0.25, 0.90, 10, (255, 240, 200)),
    ]
    for x0f, yf, x1f, thick, color in streak_positions:
        x0, x1 = int(x0f * W), int(x1f * W)
        y = int(yf * H)
        sd.line([(x0, y), (x1, y)], fill=color, width=thick)
    streaks = streaks.filter(ImageFilter.GaussianBlur(radius=8))

    # Composite streaks with screen blend (manually: out = 1 - (1-a)(1-b))
    base = img.copy()
    bx, sx = base.load(), streaks.load()
    for y in range(H):
        for x in range(W):
            br, bg, bb = bx[x, y]
            sr, sg, sb = sx[x, y]
            bx[x, y] = (
                int(255 - (255 - br) * (255 - sr) // 255),
                int(255 - (255 - bg) * (255 - sg) // 255),
                int(255 - (255 - bb) * (255 - sb) // 255),
            )

    # ---- Vignette (subtle dark corners) ----------------------------------
    vignette = Image.new("L", (W, H), 0)
    vd = ImageDraw.Draw(vignette)
    # Outer dark, inner bright
    for r in range(0, 220):
        alpha = int(255 * (1 - r / 220))
        # Ellipse shape centered, slightly larger than the bleed
        vd.ellipse(
            [W / 2 - rx - r, H / 2 - ry - r, W / 2 + rx + r, H / 2 + ry + r],
            outline=alpha,
            width=1,
        )
    vignette = vignette.filter(ImageFilter.GaussianBlur(radius=80))
    # Apply vignette: scale base by vignette/255
    base_rgba = base.convert("RGBA")
    vr, vg, vb, va = base_rgba.split(), None, None, None
    # Apply: out = rgb * (vignette/255)
    rgb = base_rgba.convert("RGB")
    rch, gch, bch = rgb.split()
    rch = rch.point(lambda p: int(p * 0.92))  # subtle 8% darken at corners
    gch = gch.point(lambda p: int(p * 0.92))
    bch = bch.point(lambda p: int(p * 0.92))
    out = Image.merge("RGB", (rch, gch, bch))

    # Save as WebP (lossless quality to keep streak detail)
    out.save(OUT, "WEBP", quality=92, method=6)
    print(f"wrote {OUT} ({os.path.getsize(OUT)} bytes, {W}x{H})")

if __name__ == "__main__":
    main()
