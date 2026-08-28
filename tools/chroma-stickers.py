# Punch magenta key to alpha for Deep Field geeked stickers.
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SRC = Path(r"C:\Users\blyat\.grok\sessions\C:\Users\blyat\Win11Backdrop\01a01c71-3706-7ea3-8fe7-509425b3536e\images")
if not SRC.exists():
    matches = list(Path(r"C:\Users\blyat\.grok\sessions").glob("**/images/7.jpg"))
    SRC = matches[0].parent if matches else SRC

OUT = ROOT / "src" / "Backdrop" / "web" / "themes" / "deep-field" / "stickers"
OUT.mkdir(parents=True, exist_ok=True)

MAP = {
    "4.jpg": "rage.png",
    "5.jpg": "anxious.png",
    "2.jpg": "shiba.png",
    "1.jpg": "grin.png",
    "6.jpg": "chad.png",
    "3.jpg": "cat.png",
    "7.jpg": "trololo.png",
}


def is_key(r: int, g: int, b: int) -> bool:
    return r > 175 and g < 85 and b > 100 and (r - g) > 90


def punch(src: Path, dest: Path) -> None:
    im = Image.open(src).convert("RGBA")
    px = im.load()
    w, h = im.size
    seen = set()
    stack = [(0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1)]
    cut = 0
    while stack:
        x, y = stack.pop()
        if (x, y) in seen or x < 0 or y < 0 or x >= w or y >= h:
            continue
        seen.add((x, y))
        r, g, b, a = px[x, y]
        if not is_key(r, g, b):
            continue
        px[x, y] = (r, g, b, 0)
        cut += 1
        stack.extend(((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)))
    im.save(dest)
    print(dest.name, im.size, "cut", round(100 * cut / (w * h), 1), "%")


def main() -> None:
    print("src", SRC)
    for name, out in MAP.items():
        punch(SRC / name, OUT / out)


if __name__ == "__main__":
    main()
