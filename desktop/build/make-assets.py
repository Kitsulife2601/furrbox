# Generates the FurrBox installer artwork (same paw + glow as the boot animation).
# Run: python desktop/build/make-assets.py  -> icon.ico, installerSidebar.bmp, installerHeader.bmp
import math
import os
import random

from PIL import Image, ImageDraw, ImageFilter, ImageFont

OUT = os.path.dirname(os.path.abspath(__file__))
ACCENT = (76, 194, 255)
VIOLET = (167, 139, 250)
BG_TOP = (6, 7, 11)
BG_BOTTOM = (13, 22, 36)
FONT = "C:/Windows/Fonts/segoeuib.ttf"
FONT_REG = "C:/Windows/Fonts/segoeui.ttf"


def cubic(p0, p1, p2, p3, steps=24):
    for i in range(1, steps + 1):
        t = i / steps
        mt = 1 - t
        yield (
            mt**3 * p0[0] + 3 * mt * mt * t * p1[0] + 3 * mt * t * t * p2[0] + t**3 * p3[0],
            mt**3 * p0[1] + 3 * mt * mt * t * p1[1] + 3 * mt * t * t * p2[1] + t**3 * p3[1],
        )


def pad_polygon():
    # Same path as the splash SVG (viewBox 0..100), converted to absolute cubic segments.
    segs = [
        ((50, 48), (37, 48), (24, 61), (22, 74)),
        ((22, 74), (20, 85), (28, 91), (37, 89)),
        ((37, 89), (42, 88), (46, 86), (50, 86)),
        ((50, 86), (54, 86), (58, 88), (63, 89)),
        ((63, 89), (72, 91), (80, 85), (78, 74)),
        ((78, 74), (76, 61), (63, 48), (50, 48)),
    ]
    pts = [segs[0][0]]
    for s in segs:
        pts.extend(cubic(*s))
    return pts


TOES = [(20, 42, 9, 12, -20), (38, 24, 10, 13, -6), (62, 24, 10, 13, 6), (80, 42, 9, 12, 20)]


def paw_mask(size):
    """Paw shape as an L mask of `size` px (viewBox 100 scaled)."""
    k = size / 100
    mask = Image.new("L", (size, size), 0)
    d = ImageDraw.Draw(mask)
    d.polygon([(x * k, y * k) for x, y in pad_polygon()], fill=255)
    for cx, cy, rx, ry, rot in TOES:
        pts = []
        for i in range(72):
            a = 2 * math.pi * i / 72
            x, y = rx * math.cos(a), ry * math.sin(a)
            r = math.radians(rot)
            pts.append(((cx + x * math.cos(r) - y * math.sin(r)) * k, (cy + x * math.sin(r) + y * math.cos(r)) * k))
        d.polygon(pts, fill=255)
    return mask


def gradient(w, h, top, bottom):
    img = Image.new("RGB", (w, h))
    d = ImageDraw.Draw(img)
    for y in range(h):
        t = y / max(1, h - 1)
        d.line([(0, y), (w, y)], fill=tuple(round(top[i] + (bottom[i] - top[i]) * t) for i in range(3)))
    return img


def glow(img, cx, cy, radius, color, strength):
    layer = Image.new("RGB", img.size, (0, 0, 0))
    ImageDraw.Draw(layer).ellipse([cx - radius, cy - radius, cx + radius, cy + radius], fill=color)
    layer = layer.filter(ImageFilter.GaussianBlur(radius * 0.6))
    return Image.blend(img, Image.composite(layer, img, Image.new("L", img.size, 255)), strength)


def add_glow_add(img, cx, cy, radius, color, strength):
    layer = Image.new("RGB", img.size, (0, 0, 0))
    ImageDraw.Draw(layer).ellipse([cx - radius, cy - radius, cx + radius, cy + radius], fill=tuple(int(c * strength) for c in color))
    layer = layer.filter(ImageFilter.GaussianBlur(radius * 0.7))
    from PIL import ImageChops

    return ImageChops.add(img, layer)


def stamp_paw(img, x, y, size, color=ACCENT, halo=True):
    mask = paw_mask(size)
    if halo:
        pad = size // 3
        big = Image.new("L", (size + 2 * pad, size + 2 * pad), 0)
        big.paste(mask, (pad, pad))
        soft = big.filter(ImageFilter.GaussianBlur(size * 0.1)).point(lambda v: int(v * 0.6))
        img.paste(Image.new("RGB", soft.size, color), (x - pad, y - pad), soft)
    img.paste(Image.new("RGB", (size, size), color), (x, y), mask)


def ring(img, cx, cy, r, width, color, start=-60, end=210):
    d = ImageDraw.Draw(img)
    d.arc([cx - r, cy - r, cx + r, cy + r], start=start, end=end, fill=color, width=width)


def stars(img, count, seed=7):
    rnd = random.Random(seed)
    d = ImageDraw.Draw(img)
    w, h = img.size
    for _ in range(count):
        x, y = rnd.uniform(0, w), rnd.uniform(0, h)
        r = rnd.uniform(0.6, 1.6) * (w / 164)
        v = rnd.randint(90, 200)
        d.ellipse([x - r, y - r, x + r, y + r], fill=(v, v, min(255, v + 20)))


def sidebar():
    S = 4
    w, h = 164 * S, 314 * S
    img = gradient(w, h, BG_TOP, BG_BOTTOM)
    stars(img, 30)
    img = add_glow_add(img, w * 0.5, h * 0.36, w * 0.55, ACCENT, 0.35)
    img = add_glow_add(img, w * 0.7, h * 0.62, w * 0.4, VIOLET, 0.22)
    cx, cy = w // 2, int(h * 0.36)
    ring(img, cx, cy, int(w * 0.33), 3 * S, ACCENT)
    ring(img, cx, cy, int(w * 0.33), 3 * S, (40, 60, 110), start=210, end=300)
    size = int(w * 0.38)
    stamp_paw(img, cx - size // 2, cy - size // 2 + S * 2, size)
    d = ImageDraw.Draw(img)
    font = ImageFont.truetype(FONT, 25 * S)
    text = "FurrBox"
    tw = d.textlength(text, font=font)
    d.text(((w - tw) / 2, h * 0.58), text, font=font, fill=(240, 246, 255))
    small = ImageFont.truetype(FONT_REG, 9 * S)
    for i, line in enumerate(["Dein Team-Desktop", "mit Discord-Anbindung"]):
        lw = d.textlength(line, font=small)
        d.text(((w - lw) / 2, h * 0.58 + 36 * S + i * 13 * S), line, font=small, fill=(154, 161, 173))
    bar_w = int(w * 0.5)
    d.rounded_rectangle([(w - bar_w) // 2, int(h * 0.86), (w + bar_w) // 2, int(h * 0.86) + 2 * S], radius=S, fill=ACCENT)
    return img.resize((164, 314), Image.LANCZOS)


def header():
    S = 4
    w, h = 150 * S, 57 * S
    img = Image.new("RGB", (w, h), (255, 255, 255))
    size = int(h * 0.62)
    stamp_paw(img, w - size - 12 * S, (h - size) // 2, size, halo=False)
    d = ImageDraw.Draw(img)
    font = ImageFont.truetype(FONT, 15 * S)
    tw = d.textlength("FurrBox", font=font)
    d.text((w - size - 18 * S - tw, (h - 20 * S) / 2 - 2 * S), "FurrBox", font=font, fill=(14, 20, 32))
    return img.resize((150, 57), Image.LANCZOS)


def icon():
    S = 4
    n = 256 * S
    base = Image.new("RGBA", (n, n), (0, 0, 0, 0))
    tile = gradient(n, n, (10, 14, 24), (18, 32, 54))
    tile = add_glow_add(tile, n * 0.5, n * 0.45, n * 0.45, ACCENT, 0.3)
    size = int(n * 0.6)
    stamp_paw(tile, (n - size) // 2, (n - size) // 2 + n // 40, size)
    mask = Image.new("L", (n, n), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, n - 1, n - 1], radius=int(n * 0.22), fill=255)
    base.paste(tile, (0, 0), mask)
    return base.resize((256, 256), Image.LANCZOS)


sidebar().save(os.path.join(OUT, "installerSidebar.bmp"))
sidebar().save(os.path.join(OUT, "uninstallerSidebar.bmp"))
header().save(os.path.join(OUT, "installerHeader.bmp"))
ico = icon()
ico.save(os.path.join(OUT, "icon.ico"), sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
ico.save(os.path.join(OUT, "icon-preview.png"))
print("ok")
