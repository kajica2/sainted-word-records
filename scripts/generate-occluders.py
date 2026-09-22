#!/usr/bin/env python3
"""Generate media/transitions/occluder-{1,2,3}.webp.

Sprint C3 of feat/asset-curator burndown. Builds 3 transparent-bg silhouette
PNGs:
  - occluder-1.webp: a forearm + hand entering from the left, pointing right
                     (horizontal canvas so the arm fits)
  - occluder-2.webp: a coffee mug (body + handle on right) — upright
  - occluder-3.webp: a head silhouette (front view, simplified) with neck

Each is drawn as solid dark pixels on a transparent background (RGBA).
WebP chosen for size — supports transparency + alpha channel.

Run from repo root:
    python3 scripts/generate-occluders.py
"""

import os
from PIL import Image, ImageDraw


def draw_arm(out_path):
    # Horizontal canvas: forearm + hand entering from the left.
    W, H = 1200, 700
    img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    # Upper arm + shoulder (left third of canvas, thick vertical bar)
    d.rounded_rectangle([60, 250, 380, 480], radius=60, fill=(20, 20, 20, 255))
    # Forearm + elbow (middle third, slightly thinner horizontal)
    d.polygon([
        (350, 280),  # top-left at shoulder
        (760, 300),  # top-right at wrist
        (770, 430),  # bottom-right
        (370, 460),  # bottom-left
    ], fill=(20, 20, 20, 255))
    # Hand (oval at end of forearm)
    d.ellipse([730, 270, 920, 460], fill=(20, 20, 20, 255))
    # Four fingers (small bumps on right edge of hand)
    for i, dy in enumerate([0, 35, 70, 105]):
        d.ellipse([900, 290 + dy, 990, 340 + dy], fill=(20, 20, 20, 255))
    # Thumb (slightly above, angled)
    d.ellipse([870, 240, 950, 320], fill=(20, 20, 20, 255))
    img.save(out_path, "WEBP", quality=95, method=6)
    print(f"wrote {out_path} ({os.path.getsize(out_path)} bytes, {W}x{H})")


def draw_mug(out_path):
    W, H = 600, 800
    img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    # Body — slight taper (narrower at top)
    d.polygon([
        (180, 220),       # top-left
        (440, 220),       # top-right
        (460, 660),       # bottom-right
        (160, 660),       # bottom-left
    ], fill=(20, 20, 20, 255))
    # Base
    d.rectangle([150, 660, 470, 700], fill=(20, 20, 20, 255))
    # Handle (donut) — drawn as outer ellipse, then carved out
    # Outer handle outline
    d.ellipse([420, 340, 580, 540], outline=(20, 20, 20, 255), width=28)
    # Inner carve-out (transparent) so the handle has a hole
    d.ellipse([460, 380, 540, 500], fill=(0, 0, 0, 0))
    # Top rim accent
    d.ellipse([175, 215, 445, 250], outline=(20, 20, 20, 255), width=4)
    img.save(out_path, "WEBP", quality=95, method=6)
    print(f"wrote {out_path} ({os.path.getsize(out_path)} bytes, {W}x{H})")


def draw_head(out_path):
    # Front-facing head silhouette (simplified): single oval + neck + shoulders.
    W, H = 700, 900
    img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    # Head — clean oval, top half of canvas
    d.ellipse([170, 80, 530, 480], fill=(20, 20, 20, 255))
    # Neck — short rectangular bridge
    d.rectangle([270, 460, 430, 620], fill=(20, 20, 20, 255))
    # Shoulders — wide trapezoid at bottom
    d.polygon([
        (90, 700), (610, 700),
        (640, 880), (60, 880),
    ], fill=(20, 20, 20, 255))
    img.save(out_path, "WEBP", quality=95, method=6)
    print(f"wrote {out_path} ({os.path.getsize(out_path)} bytes, {W}x{H})")


def main():
    os.makedirs("media/transitions", exist_ok=True)
    draw_arm("media/transitions/occluder-1.webp")
    draw_mug("media/transitions/occluder-2.webp")
    draw_head("media/transitions/occluder-3.webp")


if __name__ == "__main__":
    main()
