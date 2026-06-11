#!/usr/bin/env python3
"""Generate macOS app icons from icns/snowbo.png."""

from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageChops, ImageDraw

ICNS_DIR = Path(__file__).resolve().parent
ICONS_DIR = ICNS_DIR.parent
SOURCE = ICNS_DIR / "icon.png"

# macOS Big Sur+ icon grid (1024 reference canvas)
CANVAS = 1024
ICON_SIZE = 824
GUTTER = (CANVAS - ICON_SIZE) // 2  # 100px padding on each side
CORNER_RADIUS = 185.4

BORDER_WIDTH = 2.0
BORDER_COLOR = (0, 0, 0, 46)
HIGHLIGHT_COLOR = (255, 255, 255, 64)

ICONSET_SIZES: dict[str, int] = {
    "icon_16x16.png": 16,
    "icon_16x16@2x.png": 32,
    "icon_32x32.png": 32,
    "icon_32x32@2x.png": 64,
    "icon_128x128.png": 128,
    "icon_128x128@2x.png": 256,
    "icon_256x256.png": 256,
    "icon_256x256@2x.png": 512,
    "icon_512x512.png": 512,
    "icon_512x512@2x.png": 1024,
}

ROOT_SIZES: dict[str, int] = {
    "32x32.png": 32,
    "128x128.png": 128,
    "128x128@2x.png": 256,
    "logo.png": 120,
}


def rounded_rect_mask(size: int, radius: float) -> Image.Image:
    mask = Image.new("L", (size, size), 0)
    draw = ImageDraw.Draw(mask)
    draw.rounded_rectangle((0, 0, size - 1, size - 1), radius=radius, fill=255)
    return mask


def load_source(source: Path) -> Image.Image:
    return Image.open(source).convert("RGBA")


def render_icon(source: Image.Image, output_size: int) -> Image.Image:
    scale = output_size / CANVAS
    canvas_size = output_size
    icon_size = max(1, round(ICON_SIZE * scale))
    corner_radius = CORNER_RADIUS * scale
    gutter = (canvas_size - icon_size) // 2
    border_width = max(1, round(BORDER_WIDTH * scale))

    content = source.resize((icon_size, icon_size), Image.Resampling.LANCZOS)
    squircle = rounded_rect_mask(icon_size, corner_radius)

    red, green, blue, alpha = content.split()
    masked_alpha = ImageChops.multiply(alpha, squircle)
    icon = Image.merge("RGBA", (red, green, blue, masked_alpha))

    canvas = Image.new("RGBA", (canvas_size, canvas_size), (0, 0, 0, 0))
    canvas.alpha_composite(icon, (gutter, gutter))

    overlay = Image.new("RGBA", (canvas_size, canvas_size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    box = (gutter, gutter, gutter + icon_size - 1, gutter + icon_size - 1)
    draw.rounded_rectangle(box, radius=corner_radius, outline=BORDER_COLOR, width=border_width)

    inset = border_width + max(1, round(1 * scale))
    highlight_box = (
        gutter + inset,
        gutter + inset,
        gutter + icon_size - 1 - inset,
        gutter + icon_size - 1 - inset,
    )
    draw.rounded_rectangle(
        highlight_box,
        radius=max(0.0, corner_radius - inset),
        outline=HIGHLIGHT_COLOR,
        width=max(1, round(1 * scale)),
    )

    return Image.alpha_composite(canvas, overlay)


def save_png(img: Image.Image, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if img.mode != "RGBA":
        img = img.convert("RGBA")
    img.save(path, format="PNG", optimize=True)


def save_ico(source: Image.Image, path: Path) -> None:
    sizes = [16, 24, 32, 48, 64, 128, 256]
    images = [render_icon(source, size) for size in sizes]
    images[0].save(
        path,
        format="ICO",
        sizes=[(size, size) for size in sizes],
        append_images=images[1:],
    )


def main() -> None:
    if not SOURCE.exists():
        raise SystemExit(f"Missing source icon: {SOURCE}")

    source = load_source(SOURCE)
    iconset_dir = ICONS_DIR / "icon.iconset"

    for filename, size in ICONSET_SIZES.items():
        save_png(render_icon(source, size), iconset_dir / filename)

    for filename, size in ROOT_SIZES.items():
        save_png(render_icon(source, size), ICONS_DIR / filename)

    save_ico(source, ICONS_DIR / "icon.ico")
    print(f"Generated icons from {SOURCE.name} -> {ICONS_DIR}")


if __name__ == "__main__":
    main()