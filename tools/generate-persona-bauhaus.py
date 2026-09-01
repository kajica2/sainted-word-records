#!/usr/bin/env python3
"""
Generate 20 transparent PNGs for the preset library — Bauhaus geometric style,
matches the existing persona/ naming convention (p36-raw-1.png … p45-hallucination-2.png).

Each pair (-1 / -2) is a sibling: same variant world, slightly different beat.
Two images per variant × 10 variants = 20 files.

Style (Bauhaus geometric):
- Solid blocks of color (no gradients), thin and thick rules, primary palette
  variants: red / yellow / blue / black / off-white (per variant)
- Strong geometric primitives: circles, half-circles, triangles, rectangles,
  parallel rules, the occasional spiral
- Strict 8-column grid, mathematical composition
- Fully transparent background (PNG alpha channel = 0 everywhere except the marks)

Files written to library/persona/ following the existing naming scheme. Idempotent.
"""

import math, os, random
from PIL import Image, ImageDraw

OUT_DIR = 'library/persona'
os.makedirs(OUT_DIR, exist_ok=True)

W, H = 1280, 720

# 10 variant worlds — each gets a primary palette + a tiny motif
VARIANTS = [
    # (slug, base palette, motif glyph)
    ('raw',          {'bg': None,    'a': '#0b0b0b', 'b': '#ffffff', 'c': '#d6d6d6'}, 'monochrome rule grid'),
    ('poster',       {'bg': None,    'a': '#e63027', 'b': '#0b0b0b', 'c': '#f4f0e6'}, 'bold stacked blocks'),
    ('mask',         {'bg': None,    'a': '#0b0b0b', 'b': '#f5b921', 'c': '#e63027'}, 'half-disc with rules'),
    ('fx',           {'bg': None,    'a': '#1c4ad8', 'b': '#ffffff', 'c': '#f5b921'}, 'parallel diagonals'),
    ('filter',       {'bg': None,    'a': '#0b0b0b', 'b': '#7d3cff', 'c': '#1c4ad8'}, 'concentric arcs'),
    ('neon',         {'bg': None,    'a': '#ff2bd6', 'b': '#1c4ad8', 'c': '#0b0b0b'}, 'overlapping triangles'),
    ('film',         {'bg': None,    'a': '#c9923a', 'b': '#2b1d0e', 'c': '#f4f0e6'}, 'sepia circle stack'),
    ('grid',         {'bg': None,    'a': '#0b0b0b', 'b': '#ffffff', 'c': '#7d3cff'}, 'orthogonal hatch'),
    ('smoke',        {'bg': None,    'a': '#efe9dd', 'b': '#a08f72', 'c': '#3a2f1f'}, 'soft circle field'),
    ('hallucination',{'bg': None,    'a': '#ff2bd6', 'b': '#7d3cff', 'c': '#1c4ad8'}, 'rotating radial rays'),
]

START_NUM = 36  # p36..p45

def transparent_canvas():
    return Image.new('RGBA', (W, H), (0, 0, 0, 0))

def hex_to_rgb(h):
    h = h.lstrip('#')
    return tuple(int(h[i:i+2], 16) for i in (0, 2, 4))

# ---- composition helpers ----------------------------------------------

def col_block(draw, x, y, w, h, color, alpha=255):
    draw.rectangle([x, y, x+w, y+h], fill=hex_to_rgb(color) + (alpha,))

def line(draw, x0, y0, x1, y1, color, weight=2, alpha=255):
    draw.line([x0, y0, x1, y1], fill=hex_to_rgb(color) + (alpha,), width=weight)

def circle(draw, cx, cy, r, color, alpha=255, outline=None, outline_w=2):
    box = [cx-r, cy-r, cx+r, cy+r]
    if outline:
        draw.ellipse(box, outline=hex_to_rgb(outline) + (alpha,), width=outline_w)
    else:
        draw.ellipse(box, fill=hex_to_rgb(color) + (alpha,))

def half_disc(draw, cx, cy, r, color, alpha=255, direction='down'):
    if direction == 'down':
        box = [cx-r, cy-r, cx+r, cy+r]
        draw.pieslice(box, 0, 180, fill=hex_to_rgb(color) + (alpha,))
    elif direction == 'up':
        box = [cx-r, cy-r, cx+r, cy+r]
        draw.pieslice(box, 180, 360, fill=hex_to_rgb(color) + (alpha,))
    elif direction == 'left':
        box = [cx-r, cy-r, cx+r, cy+r]
        draw.pieslice(box, 90, 270, fill=hex_to_rgb(color) + (alpha,))
    elif direction == 'right':
        box = [cx-r, cy-r, cx+r, cy+r]
        draw.pieslice(box, 270, 90, fill=hex_to_rgb(color) + (alpha,))

def triangle(draw, points, color, alpha=255):
    draw.polygon(points, fill=hex_to_rgb(color) + (alpha,))

def grid_lines(draw, x0, y0, x1, y1, cols, rows, color, weight=2, alpha=255):
    for c in range(cols + 1):
        x = x0 + (x1 - x0) * c / cols
        line(draw, x, y0, x, y1, color, weight, alpha)
    for r in range(rows + 1):
        y = y0 + (y1 - y0) * r / rows
        line(draw, x0, y, x1, y, color, weight, alpha)

# ---- variant composers (each returns a fresh RGBA image) --------------

def compose_raw(seed):
    rng = random.Random(seed)
    img = transparent_canvas()
    d = ImageDraw.Draw(img)
    # 8 vertical rules, slightly varied weights
    for i in range(8):
        x = (i + 0.5) * (W / 8)
        w = rng.choice([1, 1, 2, 3, 4])
        line(d, x, 0, x, H, '#0b0b0b', w, 255)
    # One big circle, off-centre
    circle(d, int(W*0.7), int(H*0.45), int(H*0.32), '#ffffff', 255, outline='#0b0b0b', outline_w=4)
    return img

def compose_poster(seed):
    rng = random.Random(seed)
    img = transparent_canvas()
    d = ImageDraw.Draw(img)
    # Three stacked rectangles, slightly off-grid
    rects = [
        (int(W*0.08), int(H*0.10), int(W*0.62), int(H*0.40), '#e63027'),
        (int(W*0.30), int(H*0.34), int(W*0.85), int(H*0.62), '#f4f0e6'),
        (int(W*0.18), int(H*0.56), int(W*0.78), int(H*0.84), '#0b0b0b'),
    ]
    for x0, y0, x1, y1, c in rects:
        col_block(d, x0, y0, x1-x0, y1-y0, c, 255)
    # Yellow disc as accent
    circle(d, int(W*0.78), int(H*0.22), 60, '#f5b921', 255)
    return img

def compose_mask(seed):
    rng = random.Random(seed)
    img = transparent_canvas()
    d = ImageDraw.Draw(img)
    # Big half-disc
    half_disc(d, int(W*0.5), int(H*0.5), int(H*0.40), '#f5b921', 255, direction='down')
    # Two thick horizontal rules across
    line(d, 0, int(H*0.22), W, int(H*0.22), '#0b0b0b', 6)
    line(d, 0, int(H*0.78), W, int(H*0.78), '#0b0b0b', 6)
    # A small red circle in the upper-right
    circle(d, int(W*0.82), int(H*0.20), 36, '#e63027', 255)
    return img

def compose_fx(seed):
    rng = random.Random(seed)
    img = transparent_canvas()
    d = ImageDraw.Draw(img)
    # Parallel diagonals across the canvas
    for i in range(14):
        y = int(H * (i - 2) / 14)
        line(d, 0, y, W, y + int(W * 0.18), '#1c4ad8', rng.choice([2, 3, 4, 5]), rng.choice([180, 220, 255]))
    # Yellow disc top-right
    circle(d, int(W*0.86), int(H*0.18), 56, '#f5b921', 255)
    return img

def compose_filter(seed):
    rng = random.Random(seed)
    img = transparent_canvas()
    d = ImageDraw.Draw(img)
    cx, cy = int(W*0.5), int(H*0.55)
    # Concentric half-discs
    for i, r in enumerate([320, 260, 200, 140, 80, 30]):
        c = ['#7d3cff', '#1c4ad8', '#7d3cff', '#1c4ad8', '#7d3cff', '#1c4ad8'][i]
        half_disc(d, cx, cy, r, c, 255, direction='up')
    # A small black square accent
    col_block(d, int(W*0.78), int(H*0.10), 60, 60, '#0b0b0b', 255)
    return img

def compose_neon(seed):
    rng = random.Random(seed)
    img = transparent_canvas()
    d = ImageDraw.Draw(img)
    # Two overlapping triangles
    t1 = [(int(W*0.15), int(H*0.85)), (int(W*0.85), int(H*0.85)), (int(W*0.5), int(H*0.15))]
    t2 = [(int(W*0.20), int(H*0.20)), (int(W*0.90), int(H*0.20)), (int(W*0.55), int(H*0.90))]
    triangle(d, t1, '#ff2bd6', 200)
    triangle(d, t2, '#1c4ad8', 200)
    # Where they overlap (intersection approximated as central rect)
    col_block(d, int(W*0.35), int(H*0.55), int(W*0.30), int(H*0.10), '#7d3cff', 180)
    return img

def compose_film(seed):
    rng = random.Random(seed)
    img = transparent_canvas()
    d = ImageDraw.Draw(img)
    # Three concentric circles, sepia
    cx, cy = int(W*0.5), int(H*0.5)
    for r, c in [(280, '#c9923a'), (210, '#2b1d0e'), (140, '#f4f0e6'), (70, '#c9923a')]:
        circle(d, cx, cy, r, c, 200)
    # Heavy rule across bottom
    line(d, 0, int(H*0.85), W, int(H*0.85), '#2b1d0e', 8)
    return img

def compose_grid(seed):
    rng = random.Random(seed)
    img = transparent_canvas()
    d = ImageDraw.Draw(img)
    # 6×3 grid of small black squares, varying alpha
    cols, rows = 12, 6
    cw = W / cols
    ch = H / rows
    for c in range(cols):
        for r in range(rows):
            if rng.random() < 0.45:
                col_block(d, int(c*cw + 4), int(r*ch + 4), int(cw - 8), int(ch - 8), '#0b0b0b', 255)
    # Purple accent bar across
    col_block(d, 0, int(H*0.46), W, 24, '#7d3cff', 255)
    return img

def compose_smoke(seed):
    rng = random.Random(seed)
    img = transparent_canvas()
    d = ImageDraw.Draw(img)
    # Soft circle field, decreasing alpha at edges
    n = 36
    for i in range(n):
        cx = rng.randint(-50, W+50)
        cy = rng.randint(-50, H+50)
        r = rng.randint(40, 140)
        a = rng.randint(40, 110)
        circle(d, cx, cy, r, '#a08f72', a)
    # A few dark accent circles
    for i in range(8):
        cx = rng.randint(0, W)
        cy = rng.randint(0, H)
        r = rng.randint(15, 35)
        circle(d, cx, cy, r, '#3a2f1f', 200)
    return img

def compose_hallucination(seed):
    rng = random.Random(seed)
    img = transparent_canvas()
    d = ImageDraw.Draw(img)
    # Radial rays from a center point
    cx, cy = int(W*0.5), int(H*0.5)
    n = 24
    palette = ['#ff2bd6', '#7d3cff', '#1c4ad8', '#ff2bd6']
    for i in range(n):
        a0 = (i / n) * 360 + seed * 13
        a1 = a0 + (360 / n) * 0.6
        # Draw a thin wedge using polygon
        r = 600
        p0 = (cx, cy)
        p1 = (cx + r * math.cos(math.radians(a0)), cy + r * math.sin(math.radians(a0)))
        p2 = (cx + r * math.cos(math.radians(a1)), cy + r * math.sin(math.radians(a1)))
        triangle(d, [p0, p1, p2], palette[i % 4], 80)
    # Center disc
    circle(d, cx, cy, 60, '#ffffff', 220, outline='#0b0b0b', outline_w=3)
    return img

COMPOSERS = {
    'raw': compose_raw,
    'poster': compose_poster,
    'mask': compose_mask,
    'fx': compose_fx,
    'filter': compose_filter,
    'neon': compose_neon,
    'film': compose_film,
    'grid': compose_grid,
    'smoke': compose_smoke,
    'hallucination': compose_hallucination,
}

def main():
    for i, (slug, palette, motif) in enumerate(VARIANTS):
        num = START_NUM + i
        for pair, seed in [(1, num * 7), (2, num * 11 + 3)]:
            path = os.path.join(OUT_DIR, f'p{num}-{slug}-{pair}.png')
            composer = COMPOSERS[slug]
            img = composer(seed)
            img.save(path, 'PNG')
            print(f'  wrote {path} ({img.size}, RGBA)')
    print('done')

if __name__ == '__main__':
    main()
