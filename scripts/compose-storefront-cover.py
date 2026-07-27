import hashlib
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont, ImageOps


INK = "#182236"
GREEN = "#37C995"


def selected_font(size, bold=False):
    candidates = [
        Path("C:/Windows/Fonts/arialbd.ttf" if bold else "C:/Windows/Fonts/arial.ttf"),
        Path("C:/Windows/Fonts/segoeuib.ttf" if bold else "C:/Windows/Fonts/segoeui.ttf"),
    ]
    for candidate in candidates:
        if candidate.exists():
            return ImageFont.truetype(str(candidate), size=size)
    return ImageFont.load_default()


def text_width(draw, value, font):
    left, _, right, _ = draw.textbbox((0, 0), value or " ", font=font)
    return right - left


def wrap_lines(draw, value, font, maximum_width):
    words = str(value or "").split()
    lines = []
    current = ""
    for word in words:
        candidate = f"{current} {word}".strip()
        if not current or text_width(draw, candidate, font) <= maximum_width:
            current = candidate
        else:
            lines.append(current)
            current = word
    if current:
        lines.append(current)
    return lines or [""]


def fitted_title(draw, value, maximum_width, maximum_lines):
    for size in range(58, 31, -1):
        font = selected_font(size, True)
        lines = wrap_lines(draw, value, font, maximum_width)
        if len(lines) <= maximum_lines:
            return font, lines
    font = selected_font(31, True)
    return font, wrap_lines(draw, value, font, maximum_width)[:maximum_lines]


def fitted_subtitle(draw, value, maximum_width, maximum_lines=2):
    for size in range(25, 18, -1):
        font = selected_font(size)
        lines = wrap_lines(draw, value, font, maximum_width)
        no_widow = len(lines) == 1 or len(lines[-1].split()) >= 2
        if len(lines) <= maximum_lines and no_widow:
            return font, lines
    font = selected_font(18)
    return font, wrap_lines(draw, value, font, maximum_width)[:maximum_lines]


def compose(source_path, output_path, title, subtitle):
    with Image.open(source_path) as source:
        background = ImageOps.fit(source.convert("RGB"), (1024, 1024), method=Image.Resampling.LANCZOS)
    image = background.convert("RGBA")
    overlay = Image.new("RGBA", image.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    draw.rounded_rectangle((72, 102, 952, 922), radius=34, fill=(247, 249, 252, 236))
    draw.rounded_rectangle((72, 102, 92, 922), radius=10, fill=(55, 201, 149, 255))
    draw.text((128, 160), "EDITABLE DIGITAL TOOLKIT", fill=GREEN, font=selected_font(22, True))
    title_font, title_lines = fitted_title(draw, title, 740, 6)
    draw.multiline_text(
        (128, 224),
        "\n".join(title_lines),
        fill=INK,
        font=title_font,
        spacing=9,
    )
    title_height = draw.textbbox((0, 0), "Ag", font=title_font)[3]
    title_bottom = 224 + len(title_lines) * title_height + max(0, len(title_lines) - 1) * 9
    rule_y = min(760, title_bottom + 42)
    draw.rectangle((128, rule_y, 820, rule_y + 3), fill=(24, 34, 54, 80))
    subtitle_font, subtitle_lines = fitted_subtitle(draw, subtitle, 760)
    draw.multiline_text((128, rule_y + 30), "\n".join(subtitle_lines), fill="#5C6B80", font=subtitle_font, spacing=7)
    draw.text((128, 850), "PANTHEON PRODUCT EDITION", fill="#5C6B80", font=selected_font(17, True))
    composed = Image.alpha_composite(image, overlay).convert("RGB")
    output_path.parent.mkdir(parents=True, exist_ok=True)
    composed.save(output_path, format="PNG", optimize=True)
    with Image.open(output_path) as reopened:
        reopened.verify()


def main():
    if len(sys.argv) != 5:
        raise SystemExit("Usage: compose-storefront-cover.py <source> <output> <title> <subtitle>")
    source_path = Path(sys.argv[1]).resolve()
    output_path = Path(sys.argv[2]).resolve()
    title = " ".join(str(sys.argv[3]).split())[:240]
    subtitle = " ".join(str(sys.argv[4]).split())[:320]
    if not source_path.is_file() or not title or not subtitle:
        raise ValueError("A valid source image, product title, and customer promise are required")
    compose(source_path, output_path, title, subtitle)
    print(hashlib.sha256(output_path.read_bytes()).hexdigest())


if __name__ == "__main__":
    main()
