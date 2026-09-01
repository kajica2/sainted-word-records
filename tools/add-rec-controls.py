#!/usr/bin/env python3
"""
Add #rec-quality and #rec-fps select controls next to the existing
#rec-dur select in every variant header. The new Recorder.start() code
reads from these IDs to control bitrate and frame rate.

Idempotent — checks for the marker class 'swr-rec-fps-ctl' before adding.
"""

import os, re

VERSIONS_DIR = 'versions'
MARKER = 'swr-rec-extra-ctl-v2'

NEW_CONTROLS = '''      <select id="rec-fps" class="swr-rec-extra-ctl-v2" style="font-size:9px; padding:3px 4px; background:var(--panel-2); color:var(--ink); border:1px solid var(--line); border-radius:3px; font:9px ui-monospace;" title="Recording frame rate">
        <option value="24">24fps</option>
        <option value="30" selected>30fps</option>
        <option value="60">60fps</option>
      </select>
      <select id="rec-quality" class="swr-rec-extra-ctl-v2" style="font-size:9px; padding:3px 4px; background:var(--panel-2); color:var(--ink); border:1px solid var(--line); border-radius:3px; font:9px ui-monospace;" title="Recording quality (video bitrate)">
        <option value="low">3 Mbps</option>
        <option value="med">6 Mbps</option>
        <option value="high" selected>12 Mbps</option>
      </select>
'''

def improve_file(path):
    with open(path, 'r', encoding='utf-8') as f:
        content = f.read()
    if MARKER in content:
        return 'already added'
    if 'id="rec-dur"' not in content:
        return 'no rec-dur'
    # Insert the new selects immediately BEFORE the rec-dur select
    needle = '      <select id="rec-dur"'
    idx = content.find(needle)
    if idx < 0:
        return 'no rec-dur (search)'
    new_content = content[:idx] + NEW_CONTROLS + content[idx:]
    with open(path, 'w', encoding='utf-8') as f:
        f.write(new_content)
    return 'patched'

def main():
    targets = sorted(f for f in os.listdir(VERSIONS_DIR) if f.endswith('.html'))
    for fname in targets:
        path = os.path.join(VERSIONS_DIR, fname)
        with open(path) as f:
            if 'id="rec"' not in f.read():
                continue
        result = improve_file(path)
        print(f'  {fname}: {result}')

if __name__ == '__main__':
    main()
