"""Convert each <div class="style-card"> on versions.html into a
linkable <a class="style-card" href="...">. The primary href is
read from the first ?look=clean chip inside the card. The chip
row is preserved as the secondary action row.

Run from the repo root. Idempotent: re-running is a no-op.
"""
import re
import sys

path = sys.argv[1] if len(sys.argv) > 1 else 'versions.html'
with open(path, 'r', encoding='utf-8') as f:
    s = f.read()

# 1. Find each <div class="style-card"> block. The pattern uses
#    DOTALL because the body is multi-line.
card_re = re.compile(
    r'<div class="style-card">\s*(.*?)\s*</div>\s*(?=(?:<div class="style-card">|<a class="style-card"|</div>))',
    re.DOTALL
)

def linkify(match):
    body = match.group(1)
    href_m = re.search(r'href="(/versions/[^"?]+)\?look=clean"', body)
    if not href_m:
        # no look chip found. return the original block unchanged.
        return match.group(0)
    href = href_m.group(1)
    return '<a class="style-card" href="' + href + '">\n  ' + body + '\n          </a>'

before = s.count('<div class="style-card">')
new_s = card_re.sub(linkify, s)
after = new_s.count('<a class="style-card"')

with open(path, 'w', encoding='utf-8') as f:
    f.write(new_s)

print(f'before: {before} divs, after: {after} anchors')
