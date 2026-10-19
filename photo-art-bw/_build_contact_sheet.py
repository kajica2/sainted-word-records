#!/usr/bin/env python3
"""Build a 2x4 contact sheet from the 8 generated photos."""
from PIL import Image, ImageDraw, ImageFont
from pathlib import Path

DIR = Path("/Users/kaidejuricmasscmbook/Documents/sainted-word-records/photo-art-bw")
ORDER = [
    "01_bus_steep_hill.jpg",
    "02_tram_crosswalk_motion.jpg",
    "03_cha_chaan_teng_lady.jpg",
    "04_alleyway_night_rain.jpg",
    "05_bamboo_scaffolding.jpg",
    "06_market_vendor_hands.jpg",
    "07_rooftop_laundry.png",      # came back as PNG
    "08_tram_tracks_overhead.jpg",
]

TILE = 1024          # each photo is 1024x1024
BORDER = 6           # thin white border between tiles
OUTER_PAD = 24       # outer cream paper margin
LABEL_H = 0          # we will skip labels; numbers visible via filename only
COLS, ROWS = 4, 2

# Reference style: cream/off-white paper background, not pure white
PAPER = (244, 240, 230)  # warm off-white, matches zine paper feel

W = COLS * TILE + (COLS - 1) * BORDER + 2 * OUTER_PAD
H = ROWS * TILE + (ROWS - 1) * BORDER + 2 * OUTER_PAD

sheet = Image.new("RGB", (W, H), PAPER)
draw = ImageDraw.Draw(sheet)

for idx, name in enumerate(ORDER):
    r, c = divmod(idx, COLS)
    x = OUTER_PAD + c * (TILE + BORDER)
    y = OUTER_PAD + r * (TILE + BORDER)
    img = Image.open(DIR / name).convert("RGB").resize((TILE, TILE), Image.LANCZOS)
    sheet.paste(img, (x, y))

# Add subtle crop marks at each corner of each tile (very thin, dark grey)
# — echoes darkroom contact print / zine registration marks
mark_color = (90, 90, 90)
mark_len = 10
for idx in range(len(ORDER)):
    r, c = divmod(idx, COLS)
    x = OUTER_PAD + c * (TILE + BORDER)
    y = OUTER_PAD + r * (TILE + BORDER)
    # top-left
    draw.line([(x - mark_len - 2, y), (x - 2, y)], fill=mark_color, width=1)
    draw.line([(x, y - mark_len - 2), (x, y - 2)], fill=mark_color, width=1)
    # top-right
    draw.line([(x + TILE + 2, y), (x + TILE + mark_len + 2, y)], fill=mark_color, width=1)
    draw.line([(x + TILE, y - mark_len - 2), (x + TILE, y - 2)], fill=mark_color, width=1)
    # bottom-left
    draw.line([(x - mark_len - 2, y + TILE), (x - 2, y + TILE)], fill=mark_color, width=1)
    draw.line([(x, y + TILE + 2), (x, y + TILE + mark_len + 2)], fill=mark_color, width=1)
    # bottom-right
    draw.line([(x + TILE + 2, y + TILE), (x + TILE + mark_len + 2, y + TILE)], fill=mark_color, width=1)
    draw.line([(x + TILE, y + TILE + 2), (x + TILE, y + TILE + mark_len + 2)], fill=mark_color, width=1)

out = DIR / "00_contact_sheet_2x4.jpg"
# 150 DPI at 16:9-ish contact-sheet size; save high-quality JPEG
sheet.save(out, "JPEG", quality=95, dpi=(150, 150))
print(f"Wrote {out}  ({W}x{H})")
