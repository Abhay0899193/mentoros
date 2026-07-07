"""Make feathered ellipse masks for FLUX Fill (white = regenerate).

Usage:
  uv run --with pillow python make_masks.py <W> <H> <cx> <cy> <rx> <ry> <out.png>

Coordinates are in the source image's pixel space. The ellipse edge is
feathered ~8px so the inpainted region blends without a seam.
"""

import sys

from PIL import Image, ImageDraw, ImageFilter


def main() -> None:
    w, h, cx, cy, rx, ry = (int(v) for v in sys.argv[1:7])
    out = sys.argv[7]
    mask = Image.new("L", (w, h), 0)
    draw = ImageDraw.Draw(mask)
    draw.ellipse((cx - rx, cy - ry, cx + rx, cy + ry), fill=255)
    mask = mask.filter(ImageFilter.GaussianBlur(8))
    # Re-solidify the core so feathering only softens the rim.
    core = Image.new("L", (w, h), 0)
    ImageDraw.Draw(core).ellipse(
        (cx - rx + 10, cy - ry + 10, cx + rx - 10, cy + ry - 10), fill=255
    )
    mask.paste(255, (0, 0), core)
    mask.save(out)
    print(f"wrote {out} ({w}x{h}, ellipse {cx},{cy} r {rx}x{ry})")


if __name__ == "__main__":
    main()
