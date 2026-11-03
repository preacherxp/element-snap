"""Draws the toolbar icons: teal tile, black frame, white card with a hard shadow.

Run from the repo root: python3 icons/make-icons.py icons
"""
import os
import struct
import sys
import zlib

TEAL, BLACK, WHITE = (0, 169, 143), (0, 0, 0), (255, 255, 255)


def pixel(u, v):
    # u, v are coordinates on a 16-unit grid
    if u < 1.5 or v < 1.5 or u > 14.5 or v > 14.5:
        return BLACK
    if 4 <= u < 10.5 and 4 <= v < 10.5:
        return WHITE if 5.5 <= u < 9 and 5.5 <= v < 9 else BLACK
    if 6 <= u < 12.5 and 6 <= v < 12.5:
        return BLACK
    return TEAL


def write_png(size, path):
    rows = b"".join(
        b"\0" + bytes(c for x in range(size) for c in pixel((x + 0.5) * 16 / size, (y + 0.5) * 16 / size))
        for y in range(size)
    )

    def chunk(kind, data):
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)

    with open(path, "wb") as f:
        f.write(b"\x89PNG\r\n\x1a\n")
        f.write(chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0)))
        f.write(chunk(b"IDAT", zlib.compress(rows, 9)))
        f.write(chunk(b"IEND", b""))


out = sys.argv[1] if len(sys.argv) > 1 else "icons"
os.makedirs(out, exist_ok=True)
for size in (16, 32, 48, 128):
    write_png(size, os.path.join(out, f"{size}.png"))
