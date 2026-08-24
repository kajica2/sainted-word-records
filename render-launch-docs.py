"""
Render the 5 SWR marketing/launch .md files into styled HTML pages.

Output: 5 standalone HTML files at the project root:
  - swr-campaign-launch-plan.html
  - swr-dm-templates.html
  - swr-social-content.html
  - swr-stripe-setup.html
  - swr-watermark-plan.html

Design system: matches the rest of the site (about.html, intro.html, etc.)
  - dark theme: --bg-0 #0a0d12, --ink #e8e6e0, --gold #d4a24c, --amber #f5a524, --cyan #00e5ff
  - ui-sans-serif body
  - same .top nav (brand + sibling links)
  - 680px max-width main column

Markdown rendering is intentionally minimal — just enough to handle:
  - # H1, ## H2, ### H3
  - paragraphs
  - unordered + ordered lists
  - tables (GFM-style pipe tables)
  - fenced code blocks
  - inline `code`, **bold**, *italic*, [link](url)
  - blockquotes (lines starting with >)
  - horizontal rules (---)

This is NOT a full CommonMark renderer; it covers what these 5 docs need.
"""

import re
from pathlib import Path

ROOT = Path('/Users/kajicadjuric/Documents/autodashboard/products/sainted-word-records')
SRC = Path('/Users/kajicadjuric/Documents/autodashboard/products')

# (file, output_name, html_title, h1, lede, slug)
DOCS = [
    ('swr-campaign-launch-plan.md', 'swr-campaign-launch-plan.html',
     'Campaign launch plan · Sainted Word Records',
     'Campaign launch plan',
     'Curated media sets and tiered pricing for the 7-day soft launch of SWR Visualizers.',
     'campaign-launch-plan'),
    ('swr-dm-templates.md', 'swr-dm-templates.html',
     'DM & email outreach templates · Sainted Word Records',
     'DM & email outreach templates',
     'Eight copy-paste templates for initial outreach, follow-ups, genre pitches, and label contacts.',
     'dm-templates'),
    ('swr-social-content.md', 'swr-social-content.html',
     'Social content pack · Sainted Word Records',
     'Social content pack',
     'Ready-to-post copy for TikTok, Instagram, Reddit, and Twitter/X — captions, hooks, and shot lists.',
     'social-content'),
    ('swr-stripe-setup.md', 'swr-stripe-setup.html',
     'Stripe payment links setup · Sainted Word Records',
     'Stripe payment links setup',
     '10-minute walkthrough: create products, generate payment links, plug them into campaign.html.',
     'stripe-setup'),
    ('swr-watermark-plan.md', 'swr-watermark-plan.html',
     'Watermark design plan · Sainted Word Records',
     'Watermark design plan',
     'Three concept directions, technical specs, and implementation notes for the SWR output watermark.',
     'watermark-plan'),
]

# Top nav — primary project links + secondary sibling-doc links
SIBLING_NAV_HTML = '''    <nav class="top">
      <a class="brand" href="/">SWR</a>
      <div class="primary">
        <a href="/engine">Engine</a>
        <a href="/campaign.html">Pricing</a>
        <a href="/personas.html">Personas</a>
        <a href="/press.html">Press</a>
        <a href="/intro.html">Intro</a>
        <a href="/about.html">About</a>
      </div>
      <div class="siblings">
        <a href="/swr-campaign-launch-plan.html">Launch plan</a>
        <a href="/swr-dm-templates.html">Outreach</a>
        <a href="/swr-social-content.html">Social</a>
        <a href="/swr-stripe-setup.html">Stripe</a>
        <a href="/swr-watermark-plan.html">Watermark</a>
      </div>
    </nav>'''


def render_inline(text):
    """Render inline markdown: code, bold, italic, links."""
    # Escape HTML first
    s = text.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')
    # Inline code first (so we don't process markdown inside it)
    s = re.sub(r'`([^`]+)`', r'<code>\1</code>', s)
    # Bold
    s = re.sub(r'\*\*([^*]+)\*\*', r'<strong>\1</strong>', s)
    # Italic (single *...*, careful not to match **)
    s = re.sub(r'(?<!\*)\*([^*]+)\*(?!\*)', r'<em>\1</em>', s)
    # Links [text](url)
    s = re.sub(r'\[([^\]]+)\]\(([^)]+)\)', r'<a href="\2">\1</a>', s)
    return s


def render_md_to_html(md):
    """Convert markdown to HTML blocks. Returns HTML string (no <html> shell)."""
    lines = md.split('\n')
    out = []
    i = 0
    n = len(lines)

    def is_table_start(idx):
        if idx >= n or idx + 1 >= n:
            return False
        if '|' not in lines[idx]:
            return False
        if not re.match(r'^\s*\|?[\s\-:|]+\|?\s*$', lines[idx + 1]):
            return False
        return True

    def render_table(start):
        nonlocal i
        header_cells = [c.strip() for c in lines[i].strip().strip('|').split('|')]
        i += 1  # separator
        sep = lines[i].strip().strip('|')
        aligns = []
        for cell in sep.split('|'):
            cell = cell.strip()
            if cell.startswith(':') and cell.endswith(':'):
                aligns.append('center')
            elif cell.endswith(':'):
                aligns.append('right')
            elif cell.startswith(':'):
                aligns.append('left')
            else:
                aligns.append('')
        i += 1
        out.append('<table>')
        out.append('<thead><tr>')
        for h in header_cells:
            out.append(f'<th>{render_inline(h)}</th>')
        out.append('</tr></thead>')
        out.append('<tbody>')
        while i < n and lines[i].strip() and '|' in lines[i] and not lines[i].lstrip().startswith('#'):
            cells = [c.strip() for c in lines[i].strip().strip('|').split('|')]
            out.append('<tr>')
            for j, c in enumerate(cells):
                a = aligns[j] if j < len(aligns) else ''
                style = f' style="text-align:{a}"' if a else ''
                out.append(f'<td{style}>{render_inline(c)}</td>')
            out.append('</tr>')
            i += 1
        out.append('</tbody>')
        out.append('</table>')

    def render_list(start, ordered):
        nonlocal i
        tag = 'ol' if ordered else 'ul'
        out.append(f'<{tag}>')
        while i < n:
            line = lines[i]
            stripped = line.lstrip()
            if stripped == '':
                if i + 1 < n and re.match(r'^\s*[-*]\s+|^\s*\d+\.\s+', lines[i + 1]):
                    i += 1
                    continue
                break
            m = re.match(r'^\s*[-*]\s+(.*)$', line) if not ordered else re.match(r'^\s*\d+\.\s+(.*)$', line)
            if not m:
                break
            content = m.group(1)
            out.append(f'<li>{render_inline(content)}</li>')
            i += 1
        out.append(f'</{tag}>')

    def render_code_block():
        nonlocal i
        i += 1
        out.append('<pre><code>')
        while i < n and not lines[i].lstrip().startswith('```'):
            out.append(lines[i].replace('<', '&lt;').replace('>', '&gt;'))
            i += 1
        out.append('</code></pre>')
        if i < n:
            i += 1

    while i < n:
        line = lines[i]
        stripped = line.strip()

        if stripped == '':
            i += 1
            continue

        m = re.match(r'^(#{1,6})\s+(.*)$', stripped)
        if m:
            level = len(m.group(1))
            text = render_inline(m.group(2))
            anchor = re.sub(r'[^a-z0-9]+', '-', m.group(2).lower()).strip('-')
            out.append(f'<h{level} id="{anchor}">{text}</h{level}>')
            i += 1
            continue

        if re.match(r'^\s*---+\s*$', line):
            out.append('<hr>')
            i += 1
            continue

        if stripped.startswith('```'):
            render_code_block()
            continue

        if is_table_start(i):
            render_table(i)
            continue

        if stripped.startswith('>'):
            quote_lines = []
            while i < n and (lines[i].strip().startswith('>') or lines[i].strip() == ''):
                if lines[i].strip().startswith('>'):
                    quote_lines.append(lines[i].strip()[1:].lstrip())
                i += 1
            text = ' '.join(quote_lines)
            out.append(f'<blockquote>{render_inline(text)}</blockquote>')
            continue

        m = re.match(r'^\s*[-*]\s+(.*)$', stripped)
        if m:
            render_list(i, ordered=False)
            continue
        m = re.match(r'^\s*\d+\.\s+(.*)$', stripped)
        if m:
            render_list(i, ordered=True)
            continue

        para = [stripped]
        i += 1
        while i < n and lines[i].strip() != '' and not re.match(r'^(#{1,6}\s|---+\s*$|```|>\s|^\s*[-*]\s|^\s*\d+\.\s)', lines[i]):
            para.append(lines[i].strip())
            i += 1
        out.append(f'<p>{render_inline(" ".join(para))}</p>')

    return '\n'.join(out)


def page_html(slug, title, h1, lede, body_html):
    canonical = f'https://sainted-word-records.vercel.app/swr-{slug}.html'
    return f'''<!doctype html>
<html lang="en" data-theme="dark">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>{title}</title>
  <meta name="description" content="{lede}" />
  <meta name="color-scheme" content="dark" />
  <meta name="author" content="Kai Djuric" />
  <link rel="icon" href="/favicon.ico" />
  <link rel="canonical" href="{canonical}" />
  <meta property="og:title" content="{title}" />
  <meta property="og:description" content="{lede}" />
  <meta property="og:type" content="article" />
  <meta property="og:url" content="{canonical}" />
  <meta property="og:image" content="https://sainted-word-records.vercel.app/og.png" />
  <meta name="twitter:card" content="summary_large_image" />
  <style>
    :root {{
      --bg-0:#0a0d12; --bg-1:#111114; --bg-2:#16161b;
      --ink:#e8e6e0; --muted:#7a7a82; --muted-2:#4a4a52;
      --line:#1f1f25; --line-2:#2a2a32;
      --gold:#d4a24c; --amber:#f5a524; --cyan:#00e5ff;
    }}
    *{{box-sizing:border-box}}
    html,body{{margin:0;background:var(--bg-0);color:var(--ink);font:15px/1.65 ui-sans-serif,system-ui,-apple-system,"Inter",sans-serif;-webkit-font-smoothing:antialiased}}
    body{{padding:0 24px 80px}}
    nav.top{{max-width:1080px;margin:0 auto;padding:20px 0;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px;font-size:13px;border-bottom:1px solid var(--line);margin-bottom:48px}}
    nav.top a{{color:var(--muted);text-decoration:none;margin:0 8px}}
    nav.top a:hover{{color:var(--ink)}}
    nav.top .brand{{color:var(--gold);font-weight:700;letter-spacing:.06em;margin-right:24px}}
    nav.top .primary a, nav.top .siblings a{{font-size:12px}}
    nav.top .siblings{{border-left:1px solid var(--line-2);padding-left:14px;margin-left:6px}}
    main{{max-width:680px;margin:0 auto}}
    h1{{font:36px/1.15 ui-sans-serif,system-ui,sans-serif;margin:0 0 16px;font-weight:700;letter-spacing:-.01em}}
    h2{{font:18px/1.3 ui-sans-serif,system-ui,sans-serif;margin:48px 0 12px;font-weight:600;color:var(--gold);text-transform:uppercase;letter-spacing:.08em}}
    h3{{font:15px/1.3 ui-sans-serif,system-ui,sans-serif;margin:32px 0 8px;font-weight:600;color:var(--ink)}}
    p{{color:#c5c3bd;margin:0 0 16px}}
    p.lede{{font-size:18px;color:var(--ink);line-height:1.55}}
    a{{color:var(--amber);text-decoration:none;border-bottom:1px solid transparent}}
    a:hover{{border-bottom-color:var(--amber)}}
    ul,ol{{padding-left:20px;color:#c5c3bd}}
    li{{margin:6px 0}}
    li>ul,li>ol{{margin:8px 0 4px}}
    blockquote{{margin:24px 0;padding:20px 24px;border-left:3px solid var(--gold);background:var(--bg-1);color:var(--ink);font-style:italic;border-radius:0 6px 6px 0}}
    code{{font:13px/1.5 ui-monospace,Menlo,Consolas,monospace;background:var(--bg-2);color:var(--cyan);padding:1px 6px;border-radius:3px}}
    pre{{background:var(--bg-1);border:1px solid var(--line);border-radius:6px;padding:16px;overflow-x:auto;margin:16px 0}}
    pre code{{background:transparent;padding:0;color:var(--ink)}}
    table{{width:100%;border-collapse:collapse;margin:16px 0;font-size:13px}}
    th,td{{text-align:left;padding:8px 10px;border-bottom:1px solid var(--line)}}
    th{{color:var(--gold);font-weight:600;text-transform:uppercase;letter-spacing:.04em;font-size:11px}}
    tr:hover td{{background:var(--bg-1)}}
    hr{{border:0;border-top:1px solid var(--line);margin:48px 0}}
    .meta{{margin-top:48px;padding:16px 20px;background:var(--bg-1);border:1px solid var(--line);border-radius:8px;font-size:12px;color:var(--muted)}}
    .meta b{{color:var(--ink)}}
    @media (max-width: 720px) {{
      nav.top{{flex-direction:column;align-items:flex-start}}
      nav.top .siblings{{border-left:none;padding-left:0;margin-left:0}}
    }}
  </style>
</head>
<body>
{SIBLING_NAV_HTML}
  <main>
    <h1>{h1}</h1>
    <p class="lede">{lede}</p>
{body_html}
    <div class="meta"><b>Internal documentation.</b> Last updated 2026-08-13.</div>
  </main>
</body>
</html>
'''


# Build all 5 pages
for src_name, out_name, title, h1, lede, slug in DOCS:
    md = (SRC / src_name).read_text()
    # If the source's first non-blank line is an H1, drop it — the page
    # template already renders the page title as <h1>. The first H1 in
    # the body would otherwise duplicate it.
    lines = md.split('\n')
    while lines and lines[0].strip() == '':
        lines.pop(0)
    if lines and lines[0].startswith('# '):
        lines.pop(0)
    md = '\n'.join(lines)
    body_html = render_md_to_html(md)
    out_path = ROOT / out_name
    html = page_html(slug, title, h1, lede, body_html)
    out_path.write_text(html)
    print(f'  wrote {out_name} ({len(html):,} bytes)')

# Update vite.config.js rootFiles
vc = (ROOT / 'vite.config.js').read_text()
added = 0
for _, out_name, _, _, _, _ in DOCS:
    if f"'{out_name}'" not in vc:
        marker = "'versions.client.js',"
        if marker in vc:
            vc = vc.replace(marker, f"'{out_name}',\n    {marker}", 1)
            added += 1
(ROOT / 'vite.config.js').write_text(vc)
print(f'  added {added} entries to vite.config.js')
