#!/usr/bin/env python3
"""Generate PWA icons for かんたんメモ."""
import math
import os
import struct
import zlib

HERE = os.path.dirname(os.path.abspath(__file__))


def chunk(tag: bytes, data: bytes) -> bytes:
    crc = zlib.crc32(tag + data) & 0xFFFFFFFF
    return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", crc)


def write_png(path: str, w: int, h: int, rgba: bytes) -> None:
    raw = b""
    stride = w * 4
    for y in range(h):
        raw += b"\x00" + rgba[y * stride : (y + 1) * stride]
    png = (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(raw, 9))
        + chunk(b"IEND", b"")
    )
    with open(path, "wb") as f:
        f.write(png)


def lerp(a, b, t):
    return a + (b - a) * t


def mix(c1, c2, t):
    return tuple(int(lerp(c1[i], c2[i], t)) for i in range(4))


def clamp(v, lo=0.0, hi=1.0):
    return lo if v < lo else hi if v > hi else v


def sdf_roundrect(x, y, cx, cy, hw, hh, r):
    ax = abs(x - cx) - hw + r
    ay = abs(y - cy) - hh + r
    ox = ax if ax > 0 else 0.0
    oy = ay if ay > 0 else 0.0
    inside = ax if ax > ay else ay
    if inside > 0:
        inside = 0.0
    return math.sqrt(ox * ox + oy * oy) + inside - r


def sdf_circle(x, y, cx, cy, r):
    return math.sqrt((x - cx) ** 2 + (y - cy) ** 2) - r


def cover(sdf, aa=1.2):
    return clamp(0.5 - sdf / aa)


def overlay(dst, src, a):
    if a <= 0:
        return dst
    ia = 1 - a
    return (
        int(src[0] * a + dst[0] * ia),
        int(src[1] * a + dst[1] * ia),
        int(src[2] * a + dst[2] * ia),
        int(min(255, dst[3] + src[3] * a)),
    )


def draw_icon(size: int, maskable: bool = False) -> bytes:
    px = bytearray(size * size * 4)
    # Keep extra padding for maskable (safe zone ~80%)
    pad = size * 0.18 if maskable else size * 0.06
    cx = cy = size / 2
    hw = hh = size / 2 - pad
    radius = size * 0.22

    top = (232, 118, 86, 255)  # coral
    bot = (201, 84, 62, 255)
    paper = (255, 252, 247, 255)
    line = (224, 150, 130, 255)
    check = (90, 145, 118, 255)
    ink = (55, 48, 42, 255)
    shadow = (90, 40, 28, 255)

    aa = max(1.0, size / 256)

    for y in range(size):
        for x in range(size):
            i = (y * size + x) * 4
            t = y / max(1, size - 1)
            bg = mix(top, bot, t)

            # drop shadow
            sh = cover(sdf_roundrect(x, y + size * 0.03, cx, cy, hw, hh, radius), aa * 2)
            col = overlay(bg, shadow, sh * 0.22)

            body = cover(sdf_roundrect(x, y, cx, cy, hw, hh, radius), aa)
            col = overlay(col, bg, 0)  # keep bg
            # actually paint body using gradient already in bg
            out = (
                int(lerp(0, col[0], body)),
                int(lerp(0, col[1], body)),
                int(lerp(0, col[2], body)),
                int(body * 255),
            )
            # If maskable, fill opaque background first
            if maskable:
                out = overlay((245, 239, 231, 255), bg, body)
                out = (out[0], out[1], out[2], 255)

            # paper
            p_hw, p_hh = hw * 0.46, hh * 0.52
            p_cx, p_cy = cx + size * 0.02, cy + size * 0.04
            p_r = size * 0.06
            paper_a = cover(sdf_roundrect(x, y, p_cx, p_cy, p_hw, p_hh, p_r), aa)
            out = overlay(out, paper, paper_a)

            # ruled lines
            if paper_a > 0.4:
                left = p_cx - p_hw * 0.7
                right = p_cx + p_hw * 0.7
                for k, gy in enumerate((-0.12, 0.02, 0.16)):
                    ly = p_cy + p_hh * gy * 2
                    if abs(y - ly) < aa * 1.2 and left <= x <= right:
                        out = overlay(out, line, 0.7 * paper_a)

            # check circle
            c_cx = cx - size * 0.16
            c_cy = cy - size * 0.14
            c_r = size * 0.13
            ca = cover(sdf_circle(x, y, c_cx, c_cy, c_r), aa)
            out = overlay(out, check, ca)
            inner = cover(sdf_circle(x, y, c_cx, c_cy, c_r * 0.78), aa)
            out = overlay(out, paper, inner * 0.15)

            # check mark
            # two segments: (dx,dy) around center
            def in_check(px, py):
                # transform to check-local
                lx = (px - c_cx) / c_r
                ly = (py - c_cy) / c_r
                # short arm
                # line from (-0.35,0.05) to (-0.08,0.32)
                def dist_seg(x0, y0, x1, y1, qx, qy):
                    vx, vy = x1 - x0, y1 - y0
                    wx, wy = qx - x0, qy - y0
                    den = vx * vx + vy * vy
                    t = 0 if den == 0 else clamp((wx * vx + wy * vy) / den)
                    dx, dy = qx - (x0 + vx * t), qy - (y0 + vy * t)
                    return math.sqrt(dx * dx + dy * dy)

                d1 = dist_seg(-0.38, 0.02, -0.08, 0.34, lx, ly)
                d2 = dist_seg(-0.08, 0.34, 0.42, -0.32, lx, ly)
                return min(d1, d2)

            ck = cover(in_check(x, y) * c_r - size * 0.018, aa)
            out = overlay(out, (255, 255, 255, 255), ck * ca)

            px[i : i + 4] = bytes(out)

    return bytes(px)


def main():
    configs = [
        ("icon-192.png", 192, False),
        ("icon-512.png", 512, False),
        ("apple-touch-icon.png", 180, False),
        ("icon-512-maskable.png", 512, True),
    ]
    for name, size, maskable in configs:
        path = os.path.join(HERE, name)
        print(f"writing {path} ({size}px)")
        write_png(path, size, size, draw_icon(size, maskable))


if __name__ == "__main__":
    main()
