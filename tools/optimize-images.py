"""
智价宝 - 图片优化工具
把 assets/img 下的 PNG 转换为体积更小的 WebP（并保留一张压缩后的 JPG 供社交平台 og:image 使用）。
原历史问题：8 张商品图 + 首页背景图合计约 4.2MB，首屏需要下载 1.4MB 背景图。
运行：npm run optimize:images   （需要 Python 3 与 Pillow）
注意：输出统一使用 ASCII 标记，避免在 GBK 控制台报编码错误。
"""
import sys
from pathlib import Path

from PIL import Image

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:  # pragma: no cover
    pass

ROOT = Path(__file__).resolve().parent.parent
IMG = ROOT / "assets" / "img"

# 商品图：宽度上限 900px，质量 80
PRODUCTS = [
    "product-fan", "product-cup", "product-bookmark", "product-pin",
    "product-tea", "product-sachet", "product-bell", "product-postcard",
]


def convert(name, max_width, quality, suffix):
    """把 name.png 转换为 name+suffix，返回 (原字节数, 新字节数)。"""
    src = IMG / f"{name}.png"
    if not src.exists():
        print(f"  skip {name}.png (not found)")
        return 0, 0
    target = IMG / f"{name}{suffix}"
    with Image.open(src) as im:
        im = im.convert("RGB")
        if im.width > max_width:
            height = round(im.height * max_width / im.width)
            im = im.resize((max_width, height), Image.LANCZOS)
        if suffix == ".webp":
            im.save(target, "WEBP", quality=quality, method=6)
        else:
            im.save(target, "JPEG", quality=quality, optimize=True, progressive=True)
    return src.stat().st_size, target.stat().st_size


def main():
    total_before = total_after = 0
    print("product images -> WebP")
    for name in PRODUCTS:
        before, after = convert(name, 900, 80, ".webp")
        if before:
            total_before += before
            total_after += after
            print(f"  [ok] {name}.png {before // 1024}KB -> {name}.webp {after // 1024}KB")

    print("hero background -> WebP (first paint) and JPG (og:image)")
    for suffix, quality, width in ((".webp", 78, 1600), (".jpg", 80, 1200)):
        before, after = convert("hero-bg", width, quality, suffix)
        if before:
            total_before += before
            total_after += after
            print(f"  [ok] hero-bg.png {before // 1024}KB -> hero-bg{suffix} {after // 1024}KB")

    if total_before:
        saved = 100 - round(total_after / total_before * 100)
        print(f"\ntotal: {total_before // 1024}KB -> {total_after // 1024}KB (saved about {saved}%)")
    print("next: delete the original PNG files and update references "
          "(styles.css / site-data.js / server/db.mjs / index.html og:image)")


if __name__ == "__main__":
    main()
