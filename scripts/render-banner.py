#!/usr/bin/env python3
"""
Render the README banner to PNG.

The SVG beside it is the source of truth and renders on GitHub. npm sanitises
SVG out of README markdown, so the npm page needs raster. Rather than keep two
designs in step by hand, this draws the same thing from the same numbers.

    python3 scripts/render-banner.py
"""
from __future__ import annotations

from pathlib import Path
import math

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "assets" / "banner.png"

# Brand triad, identical to the extension.
MIDNIGHT = (8, 9, 11)
FIELD_TOP = (16, 18, 23)
SNAP = (255, 201, 0)
CLOUD = (245, 243, 239)
DIM = (176, 174, 168)

SCALE = 2  # retina; the markdown renders it at half width
# Width chosen so the tier row ends near the right edge. A banner with a
# third of it empty reads as unfinished rather than spacious.
W, H = 860 * SCALE, 252 * SCALE

REG = "/System/Library/Fonts/Supplemental/Arial.ttf"
BOLD = "/System/Library/Fonts/Supplemental/Arial Bold.ttf"
MONO = "/System/Library/Fonts/Menlo.ttc"


def font(path: str, size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(path, size * SCALE)


def rounded(draw: ImageDraw.ImageDraw, box, radius, **kw) -> None:
    draw.rounded_rectangle(box, radius=radius * SCALE, **kw)


image = Image.new("RGB", (W, H), MIDNIGHT)
draw = ImageDraw.Draw(image, "RGBA")

# A vertical wash, then a soft warm glow behind the mark. Drawn as bands
# because a true gradient is not worth a dependency for 260 pixels.
for y in range(H):
    t = y / H
    draw.line(
        [(0, y), (W, y)],
        fill=tuple(round(FIELD_TOP[i] + (MIDNIGHT[i] - FIELD_TOP[i]) * t) for i in range(3)),
    )

glow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
gd = ImageDraw.Draw(glow)
cx, cy = 180 * SCALE, 60 * SCALE
for r in range(520 * SCALE, 0, -8 * SCALE):
    alpha = round(26 * (1 - r / (520 * SCALE)) ** 2)
    gd.ellipse([cx - r, cy - r, cx + r, cy + r], fill=(*SNAP, alpha))
image = Image.alpha_composite(image.convert("RGBA"), glow).convert("RGB")
draw = ImageDraw.Draw(image, "RGBA")

# ── aperture mark ──
mx, my, ms = 64 * SCALE, 82 * SCALE, 96 * SCALE
rounded(draw, [mx, my, mx + ms, my + ms], 22, fill=SNAP)

ring = 27 * SCALE
ox, oy = mx + ms // 2, my + ms // 2
draw.ellipse([ox - ring, oy - ring, ox + ring, oy + ring], outline=MIDNIGHT, width=5 * SCALE)
for i in range(6):
    angle = math.radians(i * 60 - 90)
    draw.line(
        [
            (ox + math.cos(angle) * ring, oy + math.sin(angle) * ring),
            (ox + math.cos(angle) * ring * 0.33, oy + math.sin(angle) * ring * 0.33),
        ],
        fill=MIDNIGHT,
        width=5 * SCALE,
    )

# ── wordmark ──
name_font = font(BOLD, 46)
x = 196 * SCALE
draw.text((x, 72 * SCALE), "omnisnap", font=name_font, fill=CLOUD)
x += draw.textlength("omnisnap", font=name_font)
draw.text((x, 72 * SCALE), "-mcp", font=name_font, fill=SNAP)

draw.text(
    (197 * SCALE, 134 * SCALE),
    "Selectors that don't rot, and a page your agent can actually see.",
    font=font(REG, 19),
    fill=DIM,
)

# ── the three tiers ──
tier_font = font(MONO, 13)
tx = 197 * SCALE
for label, accent in [
    ("it reads", True),
    ("it moves the camera", False),
    ("it asks before it acts", False),
]:
    width = round(draw.textlength(label, font=tier_font)) + 32 * SCALE
    rounded(
        draw,
        [tx, 184 * SCALE, tx + width, 214 * SCALE],
        8,
        fill=(*SNAP, 30) if accent else (*CLOUD, 18),
        outline=(*SNAP, 90) if accent else (*CLOUD, 46),
        width=SCALE,
    )
    draw.text((tx + 16 * SCALE, 191 * SCALE), label, font=tier_font, fill=SNAP if accent else DIM)
    tx += width + 12 * SCALE

image.save(OUT, "PNG", optimize=True)
print(f"{OUT.relative_to(ROOT)}  {OUT.stat().st_size // 1024}KB  {image.width}x{image.height}")
