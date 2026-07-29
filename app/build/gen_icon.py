# CodeMgr 图标生成器
# 概念：深色圆角 tile + 青绿"雷达"纹样——呼应首屏"端口雷达"与品牌色（#0f1419 底 / #2dd4bf accent）。
# 用法：py app/build/gen_icon.py
# 产出：icon.ico（256/128/64/48/32/16 多尺寸）、icon.png（256）、tray-icon.png（32，透明底纯纹样）

from PIL import Image, ImageDraw

BASE_TOP = (26, 32, 40)      # #1a2028
BASE_BOT = (15, 20, 25)      # #0f1419
ACCENT = (45, 212, 191)      # #2dd4bf

SS = 1024  # 超采样画布


def lerp(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))


def rounded_mask(size, radius):
    m = Image.new("L", (size, size), 0)
    d = ImageDraw.Draw(m)
    d.rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=255)
    return m


def base_tile(size=SS):
    """深色圆角 tile（竖向微渐变）。"""
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    grad = Image.new("RGBA", (size, size))
    gd = ImageDraw.Draw(grad)
    for y in range(size):
        gd.line([(0, y), (size, y)], fill=lerp(BASE_TOP, BASE_BOT, y / size) + (255,))
    img.paste(grad, (0, 0), rounded_mask(size, int(size * 0.21)))
    return img


def draw_radar(img, simplified=False):
    """在 tile 上画雷达纹样。simplified=True 用于 ≤32px（少元素、粗线条）。"""
    size = img.width
    cx, cy = size * 0.5, size * 0.56
    overlay = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(overlay)

    if simplified:
        rings = [(0.30, 110)]
        lw = int(size * 0.055)
    else:
        rings = [(0.15, 70), (0.255, 90), (0.36, 120)]
        lw = int(size * 0.020)

    # 同心环
    for r, alpha in rings:
        R = size * r
        d.ellipse([cx - R, cy - R, cx + R, cy + R],
                  outline=ACCENT + (alpha,), width=lw)

    # 扫描扇形（指向右上，-75° ~ -15°）+ 前缘亮线
    if not simplified:
        R_out = size * 0.36
        d.pieslice([cx - R_out, cy - R_out, cx + R_out, cy + R_out],
                   start=-75, end=-15, fill=ACCENT + (38,))
    R_edge = size * (0.30 if simplified else 0.36)
    import math
    ang = math.radians(-42)
    ex, ey = cx + R_edge * math.cos(ang), cy + R_edge * math.sin(ang)
    d.line([cx, cy, ex, ey], fill=ACCENT + (255,),
           width=int(size * (0.045 if simplified else 0.022)))

    # 目标点（前缘末端）：辉光 + 实心点
    dot_r = size * (0.075 if simplified else 0.045)
    d.ellipse([ex - dot_r * 1.9, ey - dot_r * 1.9, ex + dot_r * 1.9, ey + dot_r * 1.9],
              fill=ACCENT + (70,))
    d.ellipse([ex - dot_r, ey - dot_r, ex + dot_r, ey + dot_r],
              fill=ACCENT + (255,))

    # 中心点
    c_r = size * (0.045 if simplified else 0.026)
    d.ellipse([cx - c_r, cy - c_r, cx + c_r, cy + c_r], fill=ACCENT + (230,))

    return Image.alpha_composite(img, overlay)


def make_variant(size, simplified):
    img = draw_radar(base_tile(SS), simplified)
    return img.resize((size, size), Image.LANCZOS)


def make_tray(size=32):
    """托盘图标：透明底、纯雷达纹样（深/浅任务栏都可见）。"""
    img = Image.new("RGBA", (SS, SS), (0, 0, 0, 0))
    img = draw_radar(img, simplified=True)
    return img.resize((size, size), Image.LANCZOS)


def main():
    sizes = [256, 128, 64, 48, 32, 16]
    imgs = [make_variant(s, simplified=(s <= 32)) for s in sizes]
    out = __file__.rsplit("/", 1)[0].rsplit("\\", 1)[0]
    imgs[0].save(f"{out}/icon.ico", format="ICO",
                 append_images=imgs[1:], sizes=[(s, s) for s in sizes])
    imgs[0].save(f"{out}/icon.png")          # 256px，electron-builder/文档用
    make_tray(32).save(f"{out}/tray-icon.png")
    print("written:", [f"{s}x{s}" for s in sizes], "-> icon.ico / icon.png / tray-icon.png")


if __name__ == "__main__":
    main()
