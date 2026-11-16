"""Gera os ícones do Conversor de Extratos OFX (PNG para o site/app e ICO para atalhos).

Uso: python scripts/gerar-icones.py
"""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

RAIZ = Path(__file__).resolve().parent.parent
VERDE = (15, 107, 92, 255)
VERDE_CLARO = (227, 241, 238, 255)
BRANCO = (255, 255, 255, 255)


def fonte(tamanho):
    for nome in ("segoeuib.ttf", "arialbd.ttf", "DejaVuSans-Bold.ttf"):
        try:
            return ImageFont.truetype(nome, tamanho)
        except OSError:
            continue
    return ImageFont.load_default()


def desenhar(lado=1024):
    img = Image.new("RGBA", (lado, lado), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([0, 0, lado - 1, lado - 1], radius=int(lado * 0.22), fill=VERDE)

    # folha com canto dobrado
    x0, y0, x1, y1 = lado * 0.27, lado * 0.17, lado * 0.73, lado * 0.83
    dobra = lado * 0.13
    d.polygon([(x0, y0), (x1 - dobra, y0), (x1, y0 + dobra), (x1, y1), (x0, y1)], fill=BRANCO)
    d.polygon([(x1 - dobra, y0), (x1 - dobra, y0 + dobra), (x1, y0 + dobra)], fill=VERDE_CLARO)

    # linhas de lançamentos
    for i in range(3):
        y = y0 + lado * (0.17 + i * 0.075)
        d.rounded_rectangle([x0 + lado * 0.06, y, x1 - lado * (0.06 + 0.06 * (i % 2)), y + lado * 0.03],
                            radius=lado * 0.015, fill=VERDE_CLARO)

    # selo OFX
    f = fonte(int(lado * 0.17))
    texto = "OFX"
    caixa = d.textbbox((0, 0), texto, font=f)
    w, h = caixa[2] - caixa[0], caixa[3] - caixa[1]
    cx, cy = lado / 2, y0 + lado * 0.5
    pad = lado * 0.04
    d.rounded_rectangle([cx - w / 2 - pad, cy - h / 2 - pad, cx + w / 2 + pad, cy + h / 2 + pad],
                        radius=lado * 0.04, fill=VERDE)
    d.text((cx - w / 2 - caixa[0], cy - h / 2 - caixa[1]), texto, font=f, fill=BRANCO)
    return img


def main():
    base = desenhar()
    (RAIZ / "app").mkdir(exist_ok=True)
    (RAIZ / "build").mkdir(exist_ok=True)
    for lado in (192, 512):
        base.resize((lado, lado), Image.LANCZOS).save(RAIZ / "app" / f"icone-{lado}.png")
    base.resize((512, 512), Image.LANCZOS).save(RAIZ / "build" / "icon.png")
    base.save(RAIZ / "app" / "icone.ico", sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
    print("ícones gerados")


if __name__ == "__main__":
    main()
