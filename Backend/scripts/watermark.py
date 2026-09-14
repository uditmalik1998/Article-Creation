#!/usr/bin/env python3
"""
SRM image watermarker.

Reads JPEG/PNG bytes from stdin, draws a small white label in the bottom-right
corner containing every non-empty SRM field passed via --data (JSON), and writes
the resulting PNG bytes to stdout.

Called from Node via child_process.spawn — see Backend/src/utils/runPythonWatermark.ts.

Exit codes:
  0  success (PNG on stdout)
  1  invalid arguments / JSON parse error
  2  could not decode the input image
  3  unexpected error during drawing or encoding
"""

import argparse
import io
import json
import sys
import traceback
from datetime import date
from PIL import Image, ImageDraw, ImageFont


def _build_lines(row):
    """Turn an article row (dict) into label lines, skipping empty/None values.

    Kept compact: only the fields a buyer/approver actually scans for —
    Article #, Presentation, Vendor, Category, Design, Fabric, Colors, Rate,
    plus the stamping Date. Division/Sub-Div/MC/HSN/Season/Year/MRP are
    intentionally omitted so the strip stays short.
    """
    lines = []

    def add(label, value, formatter=None):
        if value is None:
            return
        if isinstance(value, str) and not value.strip():
            return
        if formatter is not None:
            value = formatter(value)
        lines.append(f"{label}: {value}")

    # Article number (only present after SAP RFC succeeds)
    add("Article", row.get("article_number"))

    ppt = row.get("presentation_no")
    lines.append(f"PPT No.: {str(ppt).strip() if ppt and str(ppt).strip() else '-'}")

    vendor_code = row.get("vendor_code")
    vendor_name = row.get("vendor_name")
    if vendor_code:
        vendor = vendor_code
        if vendor_name and str(vendor_name).strip():
            vendor = f"{vendor_code} / {vendor_name}"
        lines.append(f"Vendor: {vendor}")

    add("Category", row.get("major_category"))
    add("Design No.", row.get("design_number"))
    add("Colors", row.get("no_of_colors"))
    add("Cost", row.get("rate"), formatter=lambda v: f"Rs {v}")
    # Some callers send `price` (SRM), others `rate` (DB). Only add Cost if rate wasn't already shown.
    if row.get("price") is not None and row.get("rate") is None:
        add("Cost", row.get("price"), formatter=lambda v: f"Rs {v}")

    add("Approved By", row.get("approved_by"))

    # Date — prefer caller-supplied (e.g. 'date' or 'presentation_received_date'),
    # fall back to today's local date. Always YYYY-MM-DD, never includes time.
    date_raw = row.get("date") or row.get("presentation_received_date")
    date_short = str(date_raw)[:10] if date_raw else date.today().isoformat()
    lines.append(f"Date: {date_short}")

    return lines


def _truncate_for_width(draw, text, font, max_width):
    """Add an ellipsis if `text` does not fit inside `max_width` pixels."""
    if draw.textlength(text, font=font) <= max_width:
        return text
    while text and draw.textlength(text + "...", font=font) > max_width:
        text = text[:-1]
    return text + "..." if text else "..."


def _load_font(size):
    """Try to load a TrueType font for nicer rendering; fall back to bitmap default."""
    candidates = [
        # Windows
        "C:/Windows/Fonts/arial.ttf",
        "C:/Windows/Fonts/segoeui.ttf",
        # Linux
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
        # macOS
        "/Library/Fonts/Arial.ttf",
    ]
    for path in candidates:
        try:
            return ImageFont.truetype(path, size)
        except (OSError, IOError):
            continue
    return ImageFont.load_default()


def _save(img, fmt):
    """Encode `img` to bytes in `fmt` ('jpeg' or 'png'). JPEG uses quality 90."""
    out = io.BytesIO()
    if fmt == "jpeg":
        # JPEG cannot store an alpha channel — make sure we are RGB.
        if img.mode != "RGB":
            img = img.convert("RGB")
        img.save(out, format="JPEG", quality=90, optimize=True)
    else:
        img.save(out, format="PNG")
    return out.getvalue()


def watermark(image_bytes, row, fmt="png"):
    img = Image.open(io.BytesIO(image_bytes))
    # Auto-rotate per EXIF, then drop EXIF so output is uniform
    try:
        from PIL import ImageOps
        img = ImageOps.exif_transpose(img)
    except Exception:
        pass
    img = img.convert("RGB")

    width, height = img.size

    lines = _build_lines(row)
    if not lines:
        # Nothing to draw — return the (re-encoded) image unchanged
        return _save(img, fmt)

    # ── Extend-canvas layout ──────────────────────────────────────────────────
    # Add a solid-white strip BELOW the original photo and write the label
    # there. Strip height is AUTO-FIT to the content (no wasted whitespace) —
    # font size is proportional to the source image height instead.
    font_size = max(14, min(32, int(height * 0.013)))
    line_h = int(font_size * 1.35)
    pad_x = max(14, font_size)
    pad_y = max(14, int(font_size * 0.7))

    # 1-3 columns based on field count to keep the strip compact.
    n_cols = 3 if len(lines) >= 7 else (2 if len(lines) >= 4 else 1)
    rows_per_col = (len(lines) + n_cols - 1) // n_cols
    block_h = rows_per_col * line_h

    # Strip height = exactly what's needed to fit the text block + padding.
    strip_h = block_h + 2 * pad_y
    new_h = height + strip_h

    # Build the taller canvas: original photo on top, white strip below.
    canvas = Image.new("RGB", (width, new_h), (255, 255, 255))
    canvas.paste(img, (0, 0))

    draw = ImageDraw.Draw(canvas)
    # Thin grey separator line so the strip is visually distinct from the photo.
    draw.line([(0, height), (width, height)], fill=(180, 180, 180), width=1)

    inner_w = width - 2 * pad_x
    col_w = inner_w // n_cols if n_cols > 0 else inner_w
    text_max_w = max(60, col_w - 12)

    font = _load_font(font_size)
    strip_y0 = height
    text_top = strip_y0 + pad_y

    for i, line in enumerate(lines):
        col = i // rows_per_col
        row_in_col = i % rows_per_col
        x = pad_x + col * col_w
        y = text_top + row_in_col * line_h
        fitted = _truncate_for_width(draw, line, font, text_max_w)
        draw.text((x, y), fitted, fill=(34, 34, 34), font=font)

    return _save(canvas, fmt)


def main():
    parser = argparse.ArgumentParser(description="Stamp SRM/article data on an image.")
    parser.add_argument("--data", required=True, help="JSON-encoded row.")
    parser.add_argument(
        "--format",
        choices=("png", "jpeg"),
        default="png",
        help="Output encoding. Use 'jpeg' for article-master bucket uploads (small files); 'png' for SRM-time VLM input (lossless).",
    )
    try:
        args = parser.parse_args()
        row = json.loads(args.data) if args.data else {}
        if not isinstance(row, dict):
            raise ValueError("--data must be a JSON object")
    except (json.JSONDecodeError, ValueError) as err:
        sys.stderr.write(f"Bad --data argument: {err}\n")
        sys.exit(1)

    try:
        image_bytes = sys.stdin.buffer.read()
        if not image_bytes:
            sys.stderr.write("No image bytes received on stdin\n")
            sys.exit(2)
    except Exception as err:
        sys.stderr.write(f"Failed reading stdin: {err}\n")
        sys.exit(2)

    try:
        output_bytes = watermark(image_bytes, row, fmt=args.format)
    except Exception as err:
        sys.stderr.write(f"Watermark failed: {err}\n")
        traceback.print_exc(file=sys.stderr)
        sys.exit(3)

    sys.stdout.buffer.write(output_bytes)


if __name__ == "__main__":
    main()
