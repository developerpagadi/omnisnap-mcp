#!/usr/bin/env python3
"""
Render the tool map: three tiers, decided by who has to agree.

One picture rather than three paragraphs. The tier a tool sits in is the
single most important thing about it, and a table buries that under names.

    python3 scripts/render-tiers.py
"""
from __future__ import annotations

from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "assets" / "tiers.png"

MIDNIGHT = (8, 9, 11)
PANEL = (18, 20, 25)
SNAP = (255, 201, 0)
CLOUD = (245, 243, 239)
DIM = (160, 158, 152)
ROSE = (244, 63, 94)

SCALE = 2
# Tall enough for the longest column, wide enough for three plus margins:
# 3 x 250 + 2 x 20 + 2 x 40 = 870.
W, H = 880 * SCALE, 552 * SCALE
REG = "/System/Library/Fonts/Supplemental/Arial.ttf"
BOLD = "/System/Library/Fonts/Supplemental/Arial Bold.ttf"
MONO = "/System/Library/Fonts/Menlo.ttc"

f = lambda path, size: ImageFont.truetype(path, size * SCALE)

TIERS = [
    (
        SNAP,
        "It reads",
        "nothing changes",
        [
            "annotate_interactive", "collect_selectors", "get_page_object",
            "verify_selectors", "read_page", "capture_page", "capture_element",
            "capture_matrix", "get_diagnostics", "watch_page", "audit_page",
            "get_design_tokens", "measure_accessibility", "inspect_element",
            "diff_capture", "list_tabs", "omnisnap_status",
        ],
    ),
    (
        CLOUD,
        "It moves the camera",
        "what is on screen, not what the page contains",
        ["scroll_to", "set_viewport", "set_color_scheme", "hover", "focus_element"],
    ),
    (
        ROSE,
        "It asks before it acts",
        "you approve, in the page",
        ["propose_action", "await_user_selection"],
    ),
]

image = Image.new("RGB", (W, H), MIDNIGHT)
draw = ImageDraw.Draw(image, "RGBA")

draw.text((40 * SCALE, 30 * SCALE), "24 tools, three tiers", font=f(BOLD, 26), fill=CLOUD)
draw.text(
    (40 * SCALE, 64 * SCALE),
    "The tier is decided by who has to agree to it.",
    font=f(REG, 15),
    fill=DIM,
)

x = 40 * SCALE
column = 250 * SCALE
gap = 20 * SCALE

for accent, title, caption, tools in TIERS:
    top = 108 * SCALE
    draw.rounded_rectangle(
        [x, top, x + column, H - 40 * SCALE], radius=14 * SCALE, fill=PANEL,
        outline=(*accent, 70), width=SCALE,
    )

    # A coloured rule rather than an icon: it reads at any size and needs no
    # licence.
    draw.rounded_rectangle(
        [x + 20 * SCALE, top + 22 * SCALE, x + 20 * SCALE + 42 * SCALE, top + 26 * SCALE],
        radius=2 * SCALE, fill=accent,
    )

    draw.text((x + 20 * SCALE, top + 40 * SCALE), title, font=f(BOLD, 17), fill=accent)

    # The caption wraps by hand; two short lines beat one clipped one.
    words, line, lines = caption.split(), "", []
    for word in words:
        trial = f"{line} {word}".strip()
        if draw.textlength(trial, font=f(REG, 12)) > column - 44 * SCALE:
            lines.append(line)
            line = word
        else:
            line = trial
    lines.append(line)
    cy = top + 66 * SCALE
    for entry in lines:
        draw.text((x + 20 * SCALE, cy), entry, font=f(REG, 12), fill=DIM)
        cy += 17 * SCALE

    ty = cy + 14 * SCALE
    for tool in tools:
        draw.text((x + 20 * SCALE, ty), tool, font=f(MONO, 11), fill=CLOUD if accent is SNAP else DIM)
        ty += 17 * SCALE

    x += column + gap

image.save(OUT, "PNG", optimize=True)
print(f"{OUT.relative_to(ROOT)}  {OUT.stat().st_size // 1024}KB  {image.width}x{image.height}")
