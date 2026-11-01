"""
Arma la hoja de sprites de un personaje propio a partir de una imagen con 4 vistas
(2×2: frente | espalda / mira a la izquierda | mira a la derecha), fondo transparente.

Uso (necesita Pillow y numpy):
    python3 scripts/armar_skin.py scripts/skins/Nico.png public/assets/personajes/Nico.png

Salida: misma grilla que los personajes de LimeZu (ver src/assets.ts): 2 filas
(caminar / reposo) × 24 cuadros, 6 por dirección en orden derecha, arriba, izquierda,
abajo; pero con cuadros de CUSTOM_FRAME (más grandes) y el cuerpo de BODY px de alto.
Como la imagen trae una sola pose por dirección, al caminar el personaje rebota 1 px.
"""
import sys

import numpy as np
from PIL import Image

BODY = 40  # alto del cuerpo en la hoja (en src/assets.ts → CUSTOM_SPRITES[...].body)
FW, FH = 26, 44  # tamaño de cada cuadro (en src/assets.ts → CUSTOM_SPRITES[...].w / .h)
ORDER = ['right', 'up', 'left', 'down']
QUAD = {'down': (0, 0), 'up': (0, 1), 'left': (1, 0), 'right': (1, 1)}
WALK_BOB = [0, 1, 1, 0, 1, 1]  # px hacia arriba en cada cuadro de la caminata


def views(src):
    h, w = src.height // 2, src.width // 2
    out = {}
    for d, (r, c) in QUAD.items():
        q = src.crop((c * w, r * h, (c + 1) * w, (r + 1) * h))
        ys, xs = np.where(np.array(q)[..., 3] > 128)
        q = q.crop((xs.min(), ys.min(), xs.max() + 1, ys.max() + 1))
        nw = max(1, round(q.width * BODY / q.height))
        out[d] = q.convert('RGBa').resize((nw, BODY), Image.LANCZOS).convert('RGBA')
    return out


def pixel_art(vs, colors=32):
    """Paleta común para las 4 vistas y alfa binario (bordes nítidos)."""
    strip = Image.new('RGBA', (sum(v.width for v in vs.values()), BODY))
    x = 0
    for v in vs.values():
        strip.paste(v, (x, 0))
        x += v.width
    pal = strip.convert('RGB').quantize(colors=colors, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)
    out, x = {}, 0
    for d, v in vs.items():
        rgb = np.array(strip.convert('RGB').quantize(palette=pal, dither=Image.Dither.NONE).convert('RGB'))[:, x:x + v.width]
        a = np.array(v)[..., 3]
        px = np.zeros((BODY, v.width, 4), np.uint8)
        px[..., :3] = rgb
        px[..., 3] = np.where(a >= 110, 255, 0)
        out[d] = Image.fromarray(px)
        x += v.width
    return out


def main(src_path, out_path):
    vs = pixel_art(views(Image.open(src_path).convert('RGBA')))
    sheet = Image.new('RGBA', (FW * 24, FH * 2), (0, 0, 0, 0))
    for di, d in enumerate(ORDER):
        v = vs[d]
        assert v.width <= FW, f'la vista {d} mide {v.width} de ancho; agrandar FW'
        for f in range(6):
            for row, bob in ((0, WALK_BOB[f]), (1, 0)):
                x = (di * 6 + f) * FW + (FW - v.width) // 2
                y = row * FH + FH - BODY - bob  # pies en la última fila del cuadro
                sheet.alpha_composite(v, (x, y))
    sheet.save(out_path, optimize=True)
    print(f'{out_path}: {sheet.width}×{sheet.height}, cuadros de {FW}×{FH}, cuerpo de {BODY} px')


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
