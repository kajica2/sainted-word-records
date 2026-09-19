#!/usr/bin/env python3
"""
tools/bulk-add-user-media.py — bulk-add the persistent user media grid
(Media Manager / SWR_MEDIA) to every version page that has a per-version
#lib but doesn't yet mount the Media Manager UI.

Modifies each target page to:
  1. Load lib/user-media.css  via <link> in <head>
  2. Load lib/media-store.client.js + lib/user-media-mount.client.js via
     <script defer> near the end of <body>
  3. Insert the markup block inside the lib's <div class="body"> after
     <div id="lib"></div>:
       <div id="swr-user-media" class="swr-user-media">
         <div class="head">…My Media…+ Add…Clear…</div>
         <input type="file" id="swr-user-media-input" multiple …>
         <div id="swr-user-media-grid" …></div>
       </div>

The script is idempotent: re-running on a partially-patched file is a
no-op (each insertion is gated on a sentinel). Already-patched files
are detected via the #swr-user-media-input id and skipped.

Run from repo root: `python3 tools/bulk-add-user-media.py`
To preview without writing: `python3 tools/bulk-add-user-media.py --dry-run`
"""
import argparse
import re
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent

# Targets: version pages with a per-version lib (id="lib") that haven't
# been patched yet. Hard-coded list (not auto-discovered) so we don't
# accidentally hit pages that intentionally don't have a library.
TARGETS = [
    'versions/aurora.html',
    'versions/chrome.html',
    'versions/eclipse.html',
    'versions/film.html',
    'versions/fractal.html',
    'versions/glitch.html',
    'versions/grid.html',
    'versions/hallucination.html',
    'versions/music_video.html',
    'versions/music_video_mtv.html',
    'versions/neon.html',
    'versions/smoke.html',
    'versions/void.html',
    'versions/watercolor.html',
]

# Patches to insert. Strings are raw HTML (no leading/trailing whitespace
# padding — each insertion script handles its own indentation).

CSS_LINK = (
    '  <link rel="stylesheet" href="../lib/user-media.css">'
)

# Script tags: defer so DOMContentLoaded fires after both scripts load.
# media-store.client.js first (defines window.SWR_MEDIA), then the
# mount script (consumes it).
SCRIPT_TAGS = (
    '  <script src="../lib/media-store.client.js" defer></script>\n'
    '  <script src="../lib/user-media-mount.client.js" defer></script>'
)

# Markup that goes inside <div class="body"> right after <div id="lib"></div>.
# Indented 8 spaces to match the surrounding <div class="body">…</div> block.
MARKUP = (
    '\n'
    '        <div id="swr-user-media" class="swr-user-media">\n'
    '          <div class="head" style="padding:6px 8px 4px;">\n'
    '            <h2 style="font-size:10px;letter-spacing:.14em;">My Media</h2>\n'
    '            <label for="swr-user-media-input" class="tbtn" style="padding:3px 6px;font-size:9px;cursor:pointer;">+ Add</label>\n'
    '            <button type="button" id="swr-user-media-clear" class="tbtn" style="padding:3px 6px;font-size:9px;color:#f55;cursor:pointer;">Clear</button>\n'
    '          </div>\n'
    '          <input type="file" id="swr-user-media-input" multiple accept="image/*,video/*" style="display:none" />\n'
    '          <div id="swr-user-media-grid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(56px,1fr));gap:3px;padding:6px 8px;"></div>\n'
    '        </div>'
)


def patch_html(html: str) -> tuple[str, list[str]]:
    """Apply the three insertions to a version page. Returns
    (new_html, list_of_changes_applied). Empty list = file already patched.
    """
    changes = []

    # 1. CSS link in <head> — insert right before </head> if not present.
    if 'href="../lib/user-media.css"' not in html:
        if '</head>' in html:
            html = html.replace(
                '</head>',
                f'{CSS_LINK}\n</head>',
                1,
            )
            changes.append('css-link')
        else:
            return html, ['error:no </head>']

    # 2. Script tags near end of <body> — insert right before </body>
    #    if not present. Idempotent via a sentinel substring.
    if '../lib/user-media-mount.client.js' not in html:
        if '</body>' in html:
            html = html.replace(
                '</body>',
                f'{SCRIPT_TAGS}\n</body>',
                1,
            )
            changes.append('script-tags')
        else:
            return html, changes + ['error:no </body>']

    # 3. Markup inside the lib's <div class="body">, after <div id="lib"></div>.
    #    The structural anchor is the lib's body div. We look for the
    #    lib's <input type="file" id="asset-input" /> then the next
    #    <div class="body"><div id="lib"></div> sequence and inject right
    #    after <div id="lib"></div>.
    if 'id="swr-user-media-input"' not in html:
        # Match the lib's body. We anchor on <div id="lib"></div> (the lib
        # inside .body) and insert MARKUP right after it.
        anchor = '<div id="lib"></div>'
        # Match either <div id="lib"></div></div> (closed) or with whitespace.
        pattern = re.compile(r'(<div id="lib"></div>)(\s*</div>)')
        match = pattern.search(html)
        if not match:
            return html, changes + ['error:no #lib anchor']
        # Insert MARKUP between the lib div and the body-close </div>.
        replacement = match.group(1) + MARKUP + match.group(2)
        html = html[: match.start()] + replacement + html[match.end():]
        changes.append('markup')

    return html, changes


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n\n')[0])
    ap.add_argument(
        '--dry-run',
        action='store_true',
        help='Preview the changes without writing files.',
    )
    args = ap.parse_args()

    if not TARGETS:
        print('No targets defined — nothing to do.', file=sys.stderr)
        return 0

    print(f'Bulk-adding user-media grid to {len(TARGETS)} version pages')
    print(f'Repo root: {REPO}')
    print(f'Mode: {"DRY-RUN" if args.dry_run else "WRITE"}')
    print()

    ok = 0
    skipped = 0
    errored = 0

    for rel in TARGETS:
        path = REPO / rel
        if not path.exists():
            print(f'  ✗ {rel}: file missing')
            errored += 1
            continue

        html = path.read_text(encoding='utf-8')
        new_html, changes = patch_html(html)

        if not changes:
            print(f'  · {rel}: already patched (skipped)')
            skipped += 1
            continue

        if any(c.startswith('error:') for c in changes):
            print(f'  ✗ {rel}: {changes}')
            errored += 1
            continue

        if args.dry_run:
            print(f'  ~ {rel}: would apply {", ".join(changes)}')
            ok += 1
            continue

        path.write_text(new_html, encoding='utf-8')
        print(f'  ✓ {rel}: applied {", ".join(changes)}')
        ok += 1

    print()
    print(f'Done. {ok} patched, {skipped} skipped, {errored} errored.')
    return 0 if errored == 0 else 1


if __name__ == '__main__':
    sys.exit(main())
