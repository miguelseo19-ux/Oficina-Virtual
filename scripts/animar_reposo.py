"""
Reposo animado para un personaje propio, como los de LimeZu: quieto, "respira" (el cuerpo sube un
poco un momento y vuelve, con los pies fijos). Sin esto, la fila de reposo repite la misma pose y
el personaje queda congelado.

Reescribe la fila de reposo (la 2.ª) de una hoja ya armada con REPOSO cuadros por dirección, a
partir de la pose de reposo (el primer cuadro de esa fila en cada dirección). La caminata no se toca.

Uso (necesita Pillow y numpy):
    python3 scripts/animar_reposo.py public/assets/personajes/Nico.png --cuadros 4

--cuadros = cuadros de caminata por dirección (`frames` en CUSTOM_SPRITES de src/assets.ts).
Al final imprime la línea para CUSTOM_SPRITES, con `idle`. armar_skin.py ya lo aplica solo.
"""
import argparse

import numpy as np
from PIL import Image

# Cuánto sube el cuerpo en cada cuadro de reposo (en píxeles de la hoja; el cuerpo mide 40). Se
# dibujan 6 por segundo, como los de LimeZu, que suben 1 de sus 23 píxeles dos cuadros de cada seis.
LIFT = [0, 0, 1, 2, 1, 0]
REPOSO = len(LIFT)
FEET = 5  # filas de abajo que quedan fijas (zapatos y tobillos)
ORDER = 4  # direcciones en la hoja: derecha, arriba, izquierda, abajo


def breathe(rest, lift):
    """La pose de reposo con el cuerpo `lift` filas más arriba: los pies quedan donde están y la
    pierna se estira repitiendo la fila de arriba de los tobillos."""
    if lift == 0:
        return rest.copy()
    ys = np.where(rest[..., 3].any(axis=1))[0]
    top, bottom = ys.min(), ys.max()
    assert top >= lift, f'no hay lugar arriba para subir {lift} (la figura empieza en la fila {top})'
    ank = bottom - FEET + 1  # desde esta fila hacia abajo, fijo
    out = np.zeros_like(rest)
    out[ank:] = rest[ank:]
    out[: ank - lift] = rest[lift:ank]
    out[ank - lift : ank] = rest[ank - 1]
    return out


def animate(sheet, frames, fw, fh):
    """Hoja nueva: caminata igual; reposo con REPOSO cuadros por dirección."""
    a = np.array(sheet.convert('RGBA'))
    out = np.zeros((fh * 2, fw * ORDER * max(frames, REPOSO), 4), np.uint8)
    out[:fh, : fw * ORDER * frames] = a[:fh, : fw * ORDER * frames]
    for d in range(ORDER):
        rest = a[fh : 2 * fh, d * frames * fw : (d * frames + 1) * fw]
        for f, lift in enumerate(LIFT):
            x = (d * REPOSO + f) * fw
            out[fh : 2 * fh, x : x + fw] = breathe(rest, lift)
    return Image.fromarray(out)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('hoja')
    ap.add_argument('--cuadros', type=int, required=True, help='cuadros de caminata por dirección')
    args = ap.parse_args()
    sheet = Image.open(args.hoja).convert('RGBA')
    fh = sheet.height // 2
    assert sheet.width % (ORDER * args.cuadros) == 0, 'el ancho de la hoja no coincide con --cuadros'
    fw = sheet.width // (ORDER * args.cuadros)
    a = np.array(sheet)
    first = a[fh:, :fw]
    assert all((a[fh:, k * fw : (k + 1) * fw] == first).all() for k in range(args.cuadros)), (
        'la fila de reposo ya está animada (o --cuadros no es el de la hoja)'
    )
    animate(sheet, args.cuadros, fw, fh).save(args.hoja, optimize=True)
    name = args.hoja.rsplit('/', 1)[-1].rsplit('.', 1)[0]
    print(f'{args.hoja}: reposo con {REPOSO} cuadros por dirección')
    print(f'CUSTOM_SPRITES en src/assets.ts →  {name}: {{w: {fw}, h: {fh}, body: 40, frames: {args.cuadros}, idle: {REPOSO}}}')


if __name__ == '__main__':
    main()
