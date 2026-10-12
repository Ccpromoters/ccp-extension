"""Generate the extension icons (PNG) with PyMuPDF. Run:
    uv run --with pymupdf python scripts/make-icons.py
"""
import pathlib
import pymupdf

OUT = pathlib.Path(__file__).resolve().parent.parent / "icons"
OUT.mkdir(exist_ok=True)

NAVY = (0.11, 0.23, 0.40)   # #1C3B66
ACCENT = (0.96, 0.62, 0.11) # #F59E1C


def draw(size: int) -> None:
    doc = pymupdf.open()
    page = doc.new_page(width=size, height=size)
    r = pymupdf.Rect(0, 0, size, size)
    page.draw_rect(r, color=None, fill=NAVY, radius=0.22)
    # accent bar at the bottom
    bar = pymupdf.Rect(size * 0.18, size * 0.78, size * 0.82, size * 0.86)
    page.draw_rect(bar, color=None, fill=ACCENT, radius=0.5)
    # "CCP" text
    fs = size * 0.40
    text = "CCP"
    tw = pymupdf.get_text_length(text, fontname="helv", fontsize=fs)
    x = (size - tw) / 2
    y = size * 0.62
    page.insert_text((x, y), text, fontname="helv", fontsize=fs, color=(1, 1, 1))
    pix = page.get_pixmap(dpi=72, alpha=True)
    pix.save(OUT / f"icon{size}.png")
    doc.close()


for s in (16, 32, 48, 128):
    draw(s)
print("icons written to", OUT)
