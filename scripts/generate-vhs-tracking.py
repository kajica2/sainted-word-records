#!/usr/bin/env python3
"""Generate media/transitions/vhs-tracking.svg.

Sprint C2 of feat/asset-curator burndown. Builds a 1920x1080 SVG with:
  - 8 distinct glitch strips at irregular y positions
  - Each strip made of multiple horizontal segments at different x offsets
  - RGB shift: cyan (#0ff) / magenta (#f0f) / white (#fff) / black (#000)
  - Scanline filter overlay for texture

The CSS animation still drives the roll (translateY keyframes) — this SVG
is the static source image composited with screen blend, giving much
richer glitch detail than the prior flat linear-gradient.

Run from repo root:
    python3 scripts/generate-vhs-tracking.py
"""

import os
import random

random.seed(73)  # deterministic output for reproducible builds

W, H = 1920, 1080
OUT = "media/transitions/vhs-tracking.svg"

# 8 strips at irregular y positions (% of height). vhs-tracking keeps the
# full-height composition so the CSS roll animation moves the whole image
# smoothly top->bottom without revealing empty space.
STRIP_Y_FRAC = [0.04, 0.18, 0.27, 0.41, 0.55, 0.66, 0.79, 0.93]
# Height of each strip in px (irregular).
STRIP_HEIGHTS = [10, 14, 6, 12, 8, 16, 9, 7]

# RGB shift palette
COLORS = ["#0ff", "#f0f", "#fff", "#000", "#0af", "#f0a"]


def strip_segments(y, h):
    """Build a list of horizontal segments for one glitch strip.

    Each strip is a horizontal band at y..y+h. We split it into 4–7
    horizontal segments at irregular x positions, each in one of the RGB
    colors. The segment widths vary for the "tracking error" look.
    """
    segs = []
    n_segs = random.randint(4, 7)
    x = 0
    while x < W and len(segs) < n_segs:
        # width up to ~30% of W but biased short
        w = random.randint(40, int(W * 0.32))
        if x + w > W:
            w = W - x
        if w <= 0:
            break
        color = random.choice(COLORS)
        opacity = round(random.uniform(0.55, 1.0), 2)
        segs.append((x, w, color, opacity))
        # gap between segments (sometimes 0 for a continuous strip)
        gap = 0 if random.random() < 0.3 else random.randint(0, 80)
        x += w + gap
    return segs


def build_svg():
    parts = []
    parts.append(
        f'<svg xmlns="http://www.w3.org/2000/svg" '
        f'viewBox="0 0 {W} {H}" width="{W}" height="{H}" '
        f'preserveAspectRatio="none">'
    )

    # ---- Defs: scanline filter + RGB shift noise pattern ---------------
    parts.append('<defs>')
    # Scanline texture: alternating thin dark/light horizontal lines.
    parts.append(
        '<pattern id="scanlines" patternUnits="userSpaceOnUse" '
        'width="4" height="4">'
        '<rect width="4" height="2" fill="rgba(255,255,255,0.06)"/>'
        '<rect y="2" width="4" height="2" fill="rgba(0,0,0,0.18)"/>'
        '</pattern>'
    )
    # Vertical noise stripes: every 3px a faint vertical line.
    parts.append(
        '<pattern id="vnoise" patternUnits="userSpaceOnUse" '
        'width="3" height="1">'
        '<rect width="1" height="1" fill="rgba(255,255,255,0.08)"/>'
        '</pattern>'
    )
    parts.append('</defs>')

    # ---- Background transparent — the CSS sets overlay bg + screen blend.

    # ---- 8 glitch strips ----------------------------------------------
    for y_frac, h in zip(STRIP_Y_FRAC, STRIP_HEIGHTS):
        y = int(y_frac * H)
        for x, w, color, opacity in strip_segments(y, h):
            parts.append(
                f'<rect x="{x}" y="{y}" width="{w}" height="{h}" '
                f'fill="{color}" opacity="{opacity}"/>'
            )

    # ---- Subtle vertical noise + scanlines overlay --------------------
    # Drawn last so they sit on top of the strips. Low opacity so the
    # screen-blend does the heavy lifting.
    parts.append(
        f'<rect x="0" y="0" width="{W}" height="{H}" '
        'fill="url(#scanlines)" opacity="0.5"/>'
    )
    parts.append(
        f'<rect x="0" y="0" width="{W}" height="{H}" '
        'fill="url(#vnoise)" opacity="0.3"/>'
    )

    parts.append("</svg>")
    return "".join(parts)


def main():
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    svg = build_svg()
    with open(OUT, "w", encoding="utf-8") as f:
        f.write(svg)
    print(f"wrote {OUT} ({os.path.getsize(OUT)} bytes, {W}x{H})")


if __name__ == "__main__":
    main()
