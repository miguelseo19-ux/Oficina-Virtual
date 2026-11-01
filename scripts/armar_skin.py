"""
Arma la hoja de sprites de un personaje propio a partir de una imagen con su caminata.

Formato de la imagen: una FILA por dirección y en cada fila las poses
de la caminata de izquierda a derecha (por ejemplo 4: pie adelante, piernas juntas, el otro
pie adelante, piernas juntas). No hace falta que estén en una grilla pareja: cada figura se
detecta por el espacio vacío que la rodea. Si falta un costado, se arma espejando el otro.

Fondo: transparente o de un color liso (por ejemplo negro). Si es liso, se borra como con un
balde de pintura desde los bordes: solo el fondo conectado con el borde de la imagen, así las
partes del personaje del mismo color (una remera negra, las sombras) quedan intactas.

Uso (necesita Pillow y numpy):
    python3 scripts/armar_skin.py scripts/skins/Nico.png public/assets/personajes/Nico.png \\
        --filas abajo,arriba,izquierda

Salida: misma grilla que los personajes de LimeZu (ver src/assets.ts): 2 filas
(caminar / reposo) × 4 direcciones (derecha, arriba, izquierda, abajo) × N cuadros.
Reposo = la segunda pose (piernas juntas). Al final imprime la línea para CUSTOM_SPRITES.
"""
import argparse

import numpy as np
from PIL import Image, ImageDraw, ImageOps

BODY = 40  # alto del cuerpo en la hoja, en la pose de reposo
ORDER = ['right', 'up', 'left', 'down']
NAMES = {'abajo': 'down', 'arriba': 'up', 'izquierda': 'left', 'derecha': 'right'}
ALPHA_MIN = 110  # por debajo, transparente (bordes nítidos, sin halo)


def remove_flat_background(src, tol=2):
    """Si la imagen no tiene transparencia, borra el fondo liso conectado con los bordes."""
    a = np.array(src)
    if (a[..., 3] < 255).any():
        return src  # ya tiene transparencia
    rgb = a[..., :3].astype(int)
    bg = rgb[0, 0]
    cand = (np.abs(rgb - bg).max(axis=2) <= tol)
    mask = Image.fromarray(np.where(cand, 255, 0).astype(np.uint8)).copy()  # copy: si no, queda de solo lectura y el balde no pinta
    h, w = cand.shape
    border = [(x, 0) for x in range(w)] + [(x, h - 1) for x in range(w)] + [(0, y) for y in range(h)] + [(w - 1, y) for y in range(h)]
    for xy in border:
        if mask.getpixel(xy) == 255:
            ImageDraw.floodfill(mask, xy, 128)
    a[..., 3] = np.where(np.array(mask) == 128, 0, 255)
    print(f'fondo liso {tuple(bg)} borrado desde los bordes ({(a[..., 3] == 0).mean():.0%} de la imagen)')
    return Image.fromarray(a)


def bands(v, min_gap=10):
    """Tramos donde v es verdadero: [(inicio, fin), ...]. Une los separados por menos de
    min_gap (pedazos de una misma figura, como una suela separada por una línea vacía)."""
    out, start = [], None
    for i, x in enumerate(v):
        if x and start is None:
            start = i
        elif not x and start is not None:
            out.append((start, i))
            start = None
    if start is not None:
        out.append((start, len(v)))
    merged = []
    for b in out:
        if merged and b[0] - merged[-1][1] < min_gap:
            merged[-1] = (merged[-1][0], b[1])
        else:
            merged.append(b)
    return merged


def figures(src):
    """Recorta cada figura: lista de filas, cada una con sus poses (de izquierda a derecha)."""
    a = np.array(src)
    m = a[..., 3] > 128
    rows = []
    for y0, y1 in bands(m.any(axis=1)):
        poses = []
        for x0, x1 in bands(m[y0:y1].any(axis=0)):
            sub = m[y0:y1, x0:x1]
            if sub.sum() < 0.002 * m.size:
                continue  # mota suelta de ruido, no es una figura
            ys, _ = np.where(sub)
            top, bot = y0 + ys.min(), y0 + ys.max() + 1
            head = m[top:top + (bot - top) * 35 // 100, x0:x1]
            hx = x0 + np.where(head)[1].mean()  # centro de la cabeza: el ancla horizontal
            poses.append({'img': src.crop((x0, top, x1, bot)), 'hx': hx - x0})
        if poses:
            rows.append(poses)
    return rows


def scale_row(poses):
    """Misma escala para toda la fila: la pose de reposo (la 2.ª) mide BODY de alto."""
    k = BODY / poses[1]['img'].height
    out = []
    for p in poses:
        im = p['img']
        w, h = max(1, round(im.width * k)), max(1, round(im.height * k))
        small = im.convert('RGBa').resize((w, h), Image.LANCZOS).convert('RGBA')
        out.append({'img': small, 'hx': p['hx'] * k})
    return out


def common_palette(all_poses, colors=48):
    """Una sola paleta para todas las poses (que los colores no titilen al animar). 48 colores con
    ajuste k-means: con menos, los colores chicos (una camiseta blanca) se funden con la piel."""
    strip = Image.new('RGBA', (sum(p['img'].width for p in all_poses), max(p['img'].height for p in all_poses)))
    x = 0
    for p in all_poses:
        strip.paste(p['img'], (x, 0))
        x += p['img'].width
    pal = strip.convert('RGB').quantize(colors=colors, method=Image.Quantize.MEDIANCUT, kmeans=4, dither=Image.Dither.NONE)
    for p in all_poses:
        rgb = np.array(p['img'].convert('RGB').quantize(palette=pal, dither=Image.Dither.NONE).convert('RGB'))
        alpha = np.array(p['img'])[..., 3]
        px = np.zeros((*alpha.shape, 4), np.uint8)
        px[..., :3] = rgb
        px[..., 3] = np.where(alpha >= ALPHA_MIN, 255, 0)
        p['img'] = Image.fromarray(px)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('src')
    ap.add_argument('out')
    ap.add_argument('--filas', default='abajo,arriba,izquierda', help='dirección de cada fila de la imagen')
    args = ap.parse_args()

    rows = figures(remove_flat_background(Image.open(args.src).convert('RGBA')))
    dirs = [NAMES[n.strip()] for n in args.filas.split(',')]
    assert len(dirs) == len(rows), f'la imagen tiene {len(rows)} filas y --filas nombra {len(dirs)}'
    n = len(rows[0])
    assert all(len(r) == n for r in rows), f'todas las filas tienen que tener las mismas poses: {[len(r) for r in rows]}'

    by_dir = {d: scale_row(r) for d, r in zip(dirs, rows)}
    common_palette([p for r in by_dir.values() for p in r])
    for a, b in (('left', 'right'), ('right', 'left')):
        if a in by_dir and b not in by_dir:
            by_dir[b] = [{'img': ImageOps.mirror(p['img']), 'hx': p['img'].width - p['hx']} for p in by_dir[a]]
    assert set(by_dir) == set(ORDER), f'faltan direcciones: {set(ORDER) - set(by_dir)}'

    # Cuadro: entra la pose más ancha (centrada en la cabeza) y la más alta (pies abajo de todo)
    poses = [p for r in by_dir.values() for p in r]
    half = max(max(p['hx'], p['img'].width - p['hx']) for p in poses)
    fw = int(np.ceil(half * 2)) + 2
    fh = max(p['img'].height for p in poses) + 2

    sheet = Image.new('RGBA', (fw * n * 4, fh * 2), (0, 0, 0, 0))
    for di, d in enumerate(ORDER):
        row = by_dir[d]
        tallest = max(p['img'].height for p in row)
        for f in range(n):
            for sheet_row, p in ((0, row[f]), (1, row[1])):  # fila 1 = reposo (2.ª pose)
                x = (di * n + f) * fw + round(fw / 2 - p['hx'])
                # la cabeza queda a la misma altura en todas las poses de la dirección (como en la
                # imagen original); la pose más alta apoya los pies en la última fila del cuadro
                y = sheet_row * fh + fh - tallest
                sheet.alpha_composite(p['img'], (x, y))
    sheet.save(args.out, optimize=True)
    name = args.out.rsplit('/', 1)[-1].rsplit('.', 1)[0]
    print(f'{args.out}: {sheet.width}×{sheet.height}, {n} cuadros por dirección de {fw}×{fh}')
    print(f'CUSTOM_SPRITES en src/assets.ts →  {name}: {{w: {fw}, h: {fh}, body: {BODY}, frames: {n}}}')


if __name__ == '__main__':
    main()
