"""Kiki preset finalize: anti-drift composite every variant onto base, webp-encode.

Mirrors core PIPELINE_PY composite (feathered ellipse, GaussianBlur(10)).
Regions come from regions.json next to this script:
  {"mouth": [cx, cy, rx, ry], "eyes": [...], "face": [...]}
Run: uv run --with pillow python finalize_kiki.py
"""
import json, os, subprocess, sys
from PIL import Image, ImageDraw, ImageFilter

OUT = os.path.expanduser("~/mentoros-imagegen/out/kiki")
ART = os.path.join(OUT, "art")  # staged webp set, copied to userData afterwards
REGIONS = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "kiki_regions.json")))

# frame name -> (region key, output webp name)
FRAMES = {
    "m1": ("mouth", "portrait-m1.webp"),
    "m2": ("mouth", "portrait-m2.webp"),
    "m3": ("mouth", "portrait-m3.webp"),
    "blink": ("eyes", "portrait-blink.webp"),
    "think": ("face", "anim-think-0.webp"),
    "smile": ("face", "anim-smile-0.webp"),
    "annoyed": ("face", "anim-annoyed-0.webp"),
    "angry": ("face", "anim-angry-0.webp"),
    "surprised": ("face", "anim-surprised-0.webp"),
    "laugh": ("face", "anim-laugh-0.webp"),
}

def sad(a, b):
    pa, pb = a.load(), b.load()
    w, h = a.size
    total = 0
    for y in range(0, h, 2):
        for x in range(0, w, 2):
            total += abs(pa[x, y] - pb[x, y])
    return total

def estimate_shift(base, edit, exclude):
    """Coarse-to-fine global translation (edit -> base), excluding the edited
    region from the match. Returns (dx, dy) to shift edit by, in natural px."""
    cx, cy, rx, ry = exclude
    best = (0, 0)
    for size, radius in ((160, 8), (512, 3)):
        s = size / base.size[0]
        bg = base.resize((size, size)).convert("L")
        eg = edit.resize((size, size)).convert("L")
        # mask out the edited region by painting both with mid-gray
        from PIL import ImageDraw as _ID
        box = (int((cx - rx) * s) - 2, int((cy - ry) * s) - 2,
               int((cx + rx) * s) + 2, int((cy + ry) * s) + 2)
        for im in (bg, eg):
            _ID.Draw(im).rectangle(box, fill=128)
        center = (round(best[0] * s), round(best[1] * s)) if size != 160 else (0, 0)
        scores = {}
        m = radius + max(abs(center[0]), abs(center[1]))
        bc = bg.crop((m, m, size - m, size - m))
        for dy in range(center[1] - radius, center[1] + radius + 1):
            for dx in range(center[0] - radius, center[0] + radius + 1):
                ec = eg.crop((m + dx, m + dy, size - m + dx, size - m + dy))
                scores[(dx, dy)] = sad(bc, ec) + (abs(dx) + abs(dy))  # tie-break toward 0
        (dx, dy) = min(scores, key=scores.get)
        best = (dx / s, dy / s)
    return (round(best[0]), round(best[1]))

def composite(base, edit_p, cx, cy, rx, ry):
    edit = Image.open(edit_p).convert("RGB")
    if edit.size != base.size:
        edit = edit.resize(base.size, Image.LANCZOS)
    dx, dy = estimate_shift(base, edit, (cx, cy, rx, ry))
    if (dx, dy) != (0, 0):
        shifted = base.copy()  # base fills the exposed border
        shifted.paste(edit, (-dx, -dy))
        edit = shifted
        print(f"  drift corrected: dx={dx} dy={dy}")
    mask = Image.new("L", base.size, 0)
    ImageDraw.Draw(mask).ellipse((cx - rx, cy - ry, cx + rx, cy + ry), fill=255)
    mask = mask.filter(ImageFilter.GaussianBlur(10))
    out = base.copy()
    out.paste(edit, (0, 0), mask)
    return out

def cwebp(src, dst):
    subprocess.run(["cwebp", "-q", "82", src, "-o", dst], check=True, capture_output=True)

os.makedirs(ART, exist_ok=True)
base = Image.open(os.path.join(OUT, "base.png")).convert("RGB")
cwebp(os.path.join(OUT, "base.png"), os.path.join(ART, "portrait-base.webp"))

for name, (region, webp_name) in FRAMES.items():
    src = os.path.join(OUT, f"{name}.png")
    if not os.path.exists(src):
        print(f"skip {name}: missing"); continue
    cx, cy, rx, ry = REGIONS[region]
    comp = composite(base, src, cx, cy, rx, ry)
    comp_p = os.path.join(OUT, f"comp-{name}.png")
    comp.save(comp_p)
    cwebp(comp_p, os.path.join(ART, webp_name))
    print(f"done {name} -> {webp_name}")

full_p = os.path.join(OUT, "full.png")
if os.path.exists(full_p):
    im = Image.open(full_p).convert("RGB")
    w, h = im.size
    target = 2.0 / 3.0
    if w / h > target:
        nw = int(round(h * target)); x = (w - nw) // 2
        im = im.crop((x, 0, x + nw, h))
    elif w / h < target:
        nh = int(round(w / target)); y = (h - nh) // 2
        im = im.crop((0, y, w, y + nh))
    if max(im.size) > 1536:
        s = 1536.0 / max(im.size)
        im = im.resize((int(round(im.size[0] * s)), int(round(im.size[1] * s))), Image.LANCZOS)
    tmp = os.path.join(OUT, "full-crop.png"); im.save(tmp)
    cwebp(tmp, os.path.join(ART, "full.webp"))
    print("done full -> full.webp")

small = base.resize((16, 16), Image.LANCZOS)
px = list(small.getdata()); n = len(px)
accent = "#%02x%02x%02x" % (sum(p[0] for p in px)//n, sum(p[1] for p in px)//n, sum(p[2] for p in px)//n)
print(json.dumps({"accent": accent}))
