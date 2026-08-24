#!/usr/bin/env python3
"""
Apply the color-motion upgrade to all 13 engine study pages:

  1. Add alpha:1, mutate:0 fields to layer constructor(s).
  2. Extend L.render() inline template with 4 new sliders (ct/br/α/mt).
  3. Bind new inputs to layer fields in the input loop.
  4. Apply mutate jitter inside the reactor evaluator loop.
  5. Apply alpha multiplier inside the drawLayer / draw path.

Three inline-template shapes exist across the 13 engines:

  A. blend/op/sc/hue     — 10 engines (default 4 sliders)
  B. blend/opacity/scale — 1 engine  (grid; no hue slider)
  C. blend/opacity/scale/hue — 1 engine (hallucination; opacity max=1.5)
  D. blend/opacity/scale/hue + roman numerals + dice — 1 engine (film)

This script handles A, B, C, D plus the small structural variants
(eclipse uses spaces, smoke has "drop files" UI, etc.).

Idempotent: detects existing alpha/mutate fields and skips the patch.

Run from the project root:
    python3 _apply_color_motion_upgrade.py
"""

from __future__ import annotations
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
ENGINES = [
    "aurora", "chrome", "eclipse", "film", "fractal",
    "glitch", "grid", "hallucination", "neon", "pulse",
    "smoke", "void", "watercolor",
]

# ---------------------------------------------------------------------------
# Patches per engine shape. Each patch is (old_string, new_string, label,
# expect_count). expect_count = -1 means "any non-zero" (use replace_all).
# ---------------------------------------------------------------------------

# 1. Layer constructor — add alpha:1, mutate:0 after contrast:1.
#    Anchor on `brightness:N, contrast:N,` — present in every layer init.
#    Match both `brightness:1, contrast:1,` (most engines) and
#    `brightness: 1, contrast: 1,` (eclipse), and the named-preset
#    variants like `brightness:1.05, contrast:0.85,` (chromatic presets).
CONSTRUCTOR_PATCH = re.compile(
    r"(brightness:\s*[-\d.]+,\s*contrast:\s*[-\d.]+,)(\s*\n)"
    r"(\s*reactors:\s*)",
)

def patch_constructor(text: str) -> tuple[str, int]:
    """Insert `alpha:1, mutate:0,` immediately after `contrast:N,`."""
    count = 0
    def repl(m: re.Match) -> str:
        nonlocal count
        count += 1
        return f"{m.group(1)}{m.group(2)}          alpha:1, mutate:0,{m.group(2)}{m.group(3)}"
    new = CONSTRUCTOR_PATCH.sub(repl, text)
    return new, count


# 2a. Template add — Shape A (10 engines): append 4 sliders after <label>hue</label>.
SHAPE_A_TEMPLATE_OLD = (
    "<div class=\"r\"><label>hue</label><input type=\"range\" "
    "min=\"-180\" max=\"180\" step=\"1\" /></div>`;"
)
SHAPE_A_TEMPLATE_NEW = (
    "<div class=\"r\"><label>hue</label><input type=\"range\" "
    "min=\"-180\" max=\"180\" step=\"1\" /></div>"
    "<div class=\"r\"><label>ct</label><input type=\"range\" "
    "min=\"0.1\" max=\"2.5\" step=\"0.01\" /></div>"
    "<div class=\"r\"><label>br</label><input type=\"range\" "
    "min=\"0.1\" max=\"2.5\" step=\"0.01\" /></div>"
    "<div class=\"r\"><label>α</label><input type=\"range\" "
    "min=\"0\" max=\"1.5\" step=\"0.01\" /></div>"
    "<div class=\"r\"><label>mt</label><input type=\"range\" "
    "min=\"0\" max=\"1\" step=\"0.01\" /></div>`;"
)

# 2b. Template add — Shape C (hallucination): same as A but opacity max=1.5.
# Identical pattern, so use the same patch.

# 2c. Template add — Shape D (film): roman-numeral + dice button + opacity/scale/hue.
SHAPE_D_TEMPLATE_OLD = (
    "<div class=\"r\"><label>hue</label><input type=\"range\" "
    "min=\"-180\" max=\"180\" step=\"1\" /></div>`;"
)
SHAPE_D_TEMPLATE_NEW = (
    "<div class=\"r\"><label>hue</label><input type=\"range\" "
    "min=\"-180\" max=\"180\" step=\"1\" /></div>"
    "<div class=\"r\"><label>ct</label><input type=\"range\" "
    "min=\"0.1\" max=\"2.5\" step=\"0.01\" /></div>"
    "<div class=\"r\"><label>br</label><input type=\"range\" "
    "min=\"0.1\" max=\"2.5\" step=\"0.01\" /></div>"
    "<div class=\"r\"><label>α</label><input type=\"range\" "
    "min=\"0\" max=\"1.5\" step=\"0.01\" /></div>"
    "<div class=\"r\"><label>mt</label><input type=\"range\" "
    "min=\"0\" max=\"1\" step=\"0.01\" /></div>`;"
)

# 2d. Shape B (grid): 3 sliders, no hue. Append 4 sliders after the scale row.
SHAPE_B_TEMPLATE_OLD = (
    "<div class=\"r\"><label>scale</label><input type=\"range\" "
    "min=\"0.5\" max=\"1.5\" step=\"0.01\" /></div>`;"
)
SHAPE_B_TEMPLATE_NEW = (
    "<div class=\"r\"><label>scale</label><input type=\"range\" "
    "min=\"0.5\" max=\"1.5\" step=\"0.01\" /></div>"
    "<div class=\"r\"><label>ct</label><input type=\"range\" "
    "min=\"0.1\" max=\"2.5\" step=\"0.01\" /></div>"
    "<div class=\"r\"><label>br</label><input type=\"range\" "
    "min=\"0.1\" max=\"2.5\" step=\"0.01\" /></div>"
    "<div class=\"r\"><label>α</label><input type=\"range\" "
    "min=\"0\" max=\"1.5\" step=\"0.01\" /></div>"
    "<div class=\"r\"><label>mt</label><input type=\"range\" "
    "min=\"0\" max=\"1\" step=\"0.01\" /></div>`;"
)


# 3a. Bindings — Shape A (long-form, spaced style).
# Pattern matches `ins[0].value = l.opacity; ins[1].value = l.baseScale; ins[2].value = l.hue;`
SHAPE_A_BIND_OLD_SPACED = (
    "          ins[0].value = l.opacity; ins[1].value = l.baseScale; ins[2].value = l.hue;\n"
    "          d.querySelector('select').addEventListener('change', e => l.blend = e.target.value);\n"
    "          ins[0].addEventListener('input', e => l.opacity = +e.target.value);\n"
    "          ins[1].addEventListener('input', e => l.baseScale = +e.target.value);\n"
    "          ins[2].addEventListener('input', e => l.hue = +e.target.value);\n"
)
SHAPE_A_BIND_NEW_SPACED = (
    "          ins[0].value = l.opacity; ins[1].value = l.baseScale; ins[2].value = l.hue;\n"
    "          ins[3].value = l.contrast; ins[4].value = l.brightness; ins[5].value = l.alpha; ins[6].value = l.mutate;\n"
    "          d.querySelector('select').addEventListener('change', e => l.blend = e.target.value);\n"
    "          ins[0].addEventListener('input', e => l.opacity = +e.target.value);\n"
    "          ins[1].addEventListener('input', e => l.baseScale = +e.target.value);\n"
    "          ins[2].addEventListener('input', e => l.hue = +e.target.value);\n"
    "          ins[3].addEventListener('input', e => l.contrast = +e.target.value);\n"
    "          ins[4].addEventListener('input', e => l.brightness = +e.target.value);\n"
    "          ins[5].addEventListener('input', e => l.alpha = +e.target.value);\n"
    "          ins[6].addEventListener('input', e => l.mutate = +e.target.value);\n"
)

# 3a-compact — same logic but no spaces around `=` (compact style for film/grid/hallucination/smoke).
SHAPE_A_BIND_OLD_COMPACT = (
    "          ins[0].value=l.opacity; ins[1].value=l.baseScale; ins[2].value=l.hue;\n"
    "          d.querySelector('select').addEventListener('change', e=>l.blend=e.target.value);\n"
    "          ins[0].addEventListener('input', e=>l.opacity=+e.target.value);\n"
    "          ins[1].addEventListener('input', e=>l.baseScale=+e.target.value);\n"
    "          ins[2].addEventListener('input', e=>l.hue=+e.target.value);\n"
)
SHAPE_A_BIND_NEW_COMPACT = (
    "          ins[0].value=l.opacity; ins[1].value=l.baseScale; ins[2].value=l.hue;\n"
    "          ins[3].value=l.contrast; ins[4].value=l.brightness; ins[5].value=l.alpha; ins[6].value=l.mutate;\n"
    "          d.querySelector('select').addEventListener('change', e=>l.blend=e.target.value);\n"
    "          ins[0].addEventListener('input', e=>l.opacity=+e.target.value);\n"
    "          ins[1].addEventListener('input', e=>l.baseScale=+e.target.value);\n"
    "          ins[2].addEventListener('input', e=>l.hue=+e.target.value);\n"
    "          ins[3].addEventListener('input', e=>l.contrast=+e.target.value);\n"
    "          ins[4].addEventListener('input', e=>l.brightness=+e.target.value);\n"
    "          ins[5].addEventListener('input', e=>l.alpha=+e.target.value);\n"
    "          ins[6].addEventListener('input', e=>l.mutate=+e.target.value);\n"
)

# 3b. Bindings — Shape B (grid): only 2 sliders (opacity, scale). New indices
#     shift to ins[0]=opacity, ins[1]=scale, ins[2]=ct, ins[3]=br, ins[4]=α, ins[5]=mt.
SHAPE_B_BIND_OLD_SPACED = (
    "          ins[0].value = l.opacity; ins[1].value = l.baseScale;\n"
    "          d.querySelector('select').addEventListener('change', e => l.blend = e.target.value);\n"
    "          ins[0].addEventListener('input', e => l.opacity = +e.target.value);\n"
    "          ins[1].addEventListener('input', e => l.baseScale = +e.target.value);\n"
)
SHAPE_B_BIND_NEW_SPACED = (
    "          ins[0].value = l.opacity; ins[1].value = l.baseScale;\n"
    "          ins[2].value = l.contrast; ins[3].value = l.brightness; ins[4].value = l.alpha; ins[5].value = l.mutate;\n"
    "          d.querySelector('select').addEventListener('change', e => l.blend = e.target.value);\n"
    "          ins[0].addEventListener('input', e => l.opacity = +e.target.value);\n"
    "          ins[1].addEventListener('input', e => l.baseScale = +e.target.value);\n"
    "          ins[2].addEventListener('input', e => l.contrast = +e.target.value);\n"
    "          ins[3].addEventListener('input', e => l.brightness = +e.target.value);\n"
    "          ins[4].addEventListener('input', e => l.alpha = +e.target.value);\n"
    "          ins[5].addEventListener('input', e => l.mutate = +e.target.value);\n"
)

# 3b-compact (grid).
SHAPE_B_BIND_OLD_COMPACT = (
    "          ins[0].value=l.opacity; ins[1].value=l.baseScale;\n"
    "          d.querySelector('select').addEventListener('change', e=>l.blend=e.target.value);\n"
    "          ins[0].addEventListener('input', e=>l.opacity=+e.target.value);\n"
    "          ins[1].addEventListener('input', e=>l.baseScale=+e.target.value);\n"
)
SHAPE_B_BIND_NEW_COMPACT = (
    "          ins[0].value=l.opacity; ins[1].value=l.baseScale;\n"
    "          ins[2].value=l.contrast; ins[3].value=l.brightness; ins[4].value=l.alpha; ins[5].value=l.mutate;\n"
    "          d.querySelector('select').addEventListener('change', e=>l.blend=e.target.value);\n"
    "          ins[0].addEventListener('input', e=>l.opacity=+e.target.value);\n"
    "          ins[1].addEventListener('input', e=>l.baseScale=+e.target.value);\n"
    "          ins[2].addEventListener('input', e=>l.contrast=+e.target.value);\n"
    "          ins[3].addEventListener('input', e=>l.brightness=+e.target.value);\n"
    "          ins[4].addEventListener('input', e=>l.alpha=+e.target.value);\n"
    "          ins[5].addEventListener('input', e=>l.mutate=+e.target.value);\n"
)


# 4. Reactor jitter — insert mutate jitter just after the reactor's `v` is
#    computed, before target switch. The anchor: `v = ease(r.ease, clamp(...))`.
REACTOR_JITTER_OLD = (
    "        v = ease(r.ease, clamp(v,0,1)) * r.scale * sens;\n"
)
REACTOR_JITTER_NEW = (
    "        v = ease(r.ease, clamp(v,0,1)) * r.scale * sens;\n"
    "        if (l.mutate > 0) v += (_rnd() - 0.5) * 2 * l.mutate * Math.abs(r.scale);\n"
)

# 5. Draw alpha — replace `r.opacity` final assignment with `r.opacity * l.alpha`.
#    Anchor: `ctx.globalAlpha = clamp(r.opacity, 0, 1);` (most engines).
DRAW_ALPHA_OLD = (
    "      ctx.globalAlpha = clamp(r.opacity, 0, 1);\n"
)
DRAW_ALPHA_NEW = (
    "      ctx.globalAlpha = clamp(r.opacity * (l.alpha ?? 1), 0, 1);\n"
)

# 5b. Smoke-style: `ctx.globalAlpha = clamp(r.opacity * 0.6, 0, 1); // smoke is more transparent`
DRAW_ALPHA_OLD_SMOKE = (
    "      ctx.globalAlpha = clamp(r.opacity * 0.6, 0, 1); // smoke is more transparent\n"
)
DRAW_ALPHA_NEW_SMOKE = (
    "      ctx.globalAlpha = clamp(r.opacity * 0.6 * (l.alpha ?? 1), 0, 1); // smoke is more transparent\n"
)


# ---------------------------------------------------------------------------
# Per-engine dispatch
# ---------------------------------------------------------------------------

def classify(name: str, text: str) -> str:
    """Return 'A' (default 4-slider) / 'B' (grid 3-slider) / 'D' (film)."""
    if "['I','II','III','IV','V','VI']" in text:
        return "D"
    if name == "grid":
        return "B"
    return "A"


def apply_engine(name: str, text: str) -> tuple[str, dict]:
    log = {"constructor": 0, "template": 0, "bind": 0, "reactor": 0, "alpha": 0}

    # Idempotency guard — skip if already patched
    if "l.mutate" in text and "alpha:1, mutate:0" in text:
        return text, {"already_patched": True}

    shape = classify(name, text)

    # 1. Constructor
    text, log["constructor"] = patch_constructor(text)

    # 2. Template
    if shape in ("A", "C"):
        old, new = SHAPE_A_TEMPLATE_OLD, SHAPE_A_TEMPLATE_NEW
    elif shape == "D":
        old, new = SHAPE_D_TEMPLATE_OLD, SHAPE_D_TEMPLATE_NEW
    elif shape == "B":
        old, new = SHAPE_B_TEMPLATE_OLD, SHAPE_B_TEMPLATE_NEW
    else:
        old, new = "", ""
    if old in text:
        text = text.replace(old, new, 1)
        log["template"] = 1

    # 3. Bindings — try spaced first, then compact.
    candidates = (
        (SHAPE_A_BIND_OLD_SPACED, SHAPE_A_BIND_NEW_SPACED, "A-spaced"),
        (SHAPE_A_BIND_OLD_COMPACT, SHAPE_A_BIND_NEW_COMPACT, "A-compact"),
        (SHAPE_B_BIND_OLD_SPACED, SHAPE_B_BIND_NEW_SPACED, "B-spaced"),
        (SHAPE_B_BIND_OLD_COMPACT, SHAPE_B_BIND_NEW_COMPACT, "B-compact"),
    )
    bind_applied = False
    for old, new, label in candidates:
        if shape == "B" and "A-" in label:
            continue  # don't try A variants for grid
        if shape != "B" and "B-" in label:
            continue  # don't try B variants for non-grid
        if old in text:
            text = text.replace(old, new, 1)
            log["bind"] = 1
            log["bind_mode"] = label
            bind_applied = True
            break
    if not bind_applied:
        # Lenient regex fallback.
        pattern = re.compile(
            r"(\s+)ins\[0\]\.value\s*=\s*l\.opacity;\s*ins\[1\]\.value\s*=\s*l\.baseScale;\s*(?:ins\[2\]\.value\s*=\s*l\.hue;\s*)?"
            r"d\.querySelector\('select'\)\.addEventListener\('change'.*?l\.hue\s*=\s*\+e\.target\.value;",
            re.DOTALL,
        )
        m = pattern.search(text)
        if m:
            block = m.group(0)
            new_block = block + (
                "\n          ins[3].addEventListener('input', e => l.contrast = +e.target.value);"
                "\n          ins[4].addEventListener('input', e => l.brightness = +e.target.value);"
                "\n          ins[5].addEventListener('input', e => l.alpha = +e.target.value);"
                "\n          ins[6].addEventListener('input', e => l.mutate = +e.target.value);"
            )
            text = text.replace(block, new_block, 1)
            log["bind"] = 1
            log["bind_mode"] = "regex"

    # 4. Reactor jitter (replace all — many engines apply reactors twice for
    #    add() and remap() paths).
    text2 = text.replace(REACTOR_JITTER_OLD, REACTOR_JITTER_NEW)
    log["reactor"] = text2.count(REACTOR_JITTER_NEW) - text.count(REACTOR_JITTER_NEW)
    if log["reactor"] < 0:
        log["reactor"] = 0
    if text2 != text:
        text = text2
        log["reactor"] = text.count(REACTOR_JITTER_NEW)

    # 5. Draw alpha — try plain first, then smoke variant.
    if DRAW_ALPHA_OLD in text:
        text = text.replace(DRAW_ALPHA_OLD, DRAW_ALPHA_NEW, 1)
        log["alpha"] = 1
    elif DRAW_ALPHA_OLD_SMOKE in text:
        text = text.replace(DRAW_ALPHA_OLD_SMOKE, DRAW_ALPHA_NEW_SMOKE, 1)
        log["alpha"] = 1
        log["alpha_mode"] = "smoke"

    return text, log


def main() -> int:
    root = ROOT / "versions"
    failures: list[str] = []
    for name in ENGINES:
        path = root / f"{name}.html"
        if not path.exists():
            print(f"  SKIP  {name}: not found")
            continue
        text = path.read_text()
        new, log = apply_engine(name, text)
        if new != text:
            path.write_text(new)
            print(f"  PATCH {name:14s}  ctor={log['constructor']}  tpl={log['template']}  bind={log['bind']}  reactor={log['reactor']}  alpha={log['alpha']}")
        else:
            print(f"  NONE  {name:14s}  {log}")
        # Sanity: at minimum the constructor + template + bind must land
        for key in ("constructor", "template", "bind", "alpha"):
            if log.get(key, 0) == 0 and log.get("already_patched") is not True:
                failures.append(f"{name}: missing {key}")
    if failures:
        print("\nFAILURES:")
        for f in failures:
            print(f"  - {f}")
        return 1
    print("\nAll 13 engines patched.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
