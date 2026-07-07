"""Composite Kontext-edited variant frames back onto their base portrait.

The RealisticPortrait player lip-syncs by opacity-stacking full frames, so
every variant must be pixel-identical to the base outside the edited region.
Kontext preserves composition well but not to the pixel — this pastes only a
feathered ellipse (mouth for m1-m3, eye band for blink) from the edit onto
the base, killing any global drift/shimmer.

Usage:
  uv run --with pillow python composite_variants.py <base.png> <edit.png> \
      <cx> <cy> <rx> <ry> <out.png>
"""

import sys

from PIL import Image, ImageDraw, ImageFilter


def main() -> None:
    base_path, edit_path = sys.argv[1:3]
    cx, cy, rx, ry = (int(v) for v in sys.argv[3:7])
    out = sys.argv[7]
    base = Image.open(base_path).convert("RGB")
    edit = Image.open(edit_path).convert("RGB")
    if edit.size != base.size:
        edit = edit.resize(base.size, Image.LANCZOS)
    mask = Image.new("L", base.size, 0)
    ImageDraw.Draw(mask).ellipse((cx - rx, cy - ry, cx + rx, cy + ry), fill=255)
    mask = mask.filter(ImageFilter.GaussianBlur(10))
    base.paste(edit, (0, 0), mask)
    base.save(out)
    print(f"wrote {out} (ellipse {cx},{cy} r {rx}x{ry})")


if __name__ == "__main__":
    main()
