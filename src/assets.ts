/**
 * Assets pixel art de LimeZu ("Modern Interiors", versión gratuita, uso no comercial).
 * Ver public/assets/limezu/CREDITOS.txt
 *
 * Personajes: cada hoja tiene 2 filas de 24 cuadros de 16×32
 *   fila 0 = caminar · fila 1 = reposo animado
 *   6 cuadros por dirección, en orden: derecha, arriba, izquierda, abajo
 */
const BASE = import.meta.env.BASE_URL + 'assets/limezu/'

export const CHARACTER_SPRITES = ['Adam', 'Alex', 'Alex_b', 'Amelia', 'Bob'] as const
export type CharacterSprite = (typeof CHARACTER_SPRITES)[number]

export const FRAME = {w: 16, h: 32, perDir: 6}
/** Alto del cuerpo visible en un cuadro de LimeZu: todos los personajes se dibujan a esta altura. */
export const BODY_H = 23

/**
 * Personajes propios (public/assets/personajes/<nombre>.png): misma grilla que LimeZu
 * (2 filas: caminar / reposo; 4 direcciones × `frames` cuadros) pero con cuadros de w×h y el
 * cuerpo de `body` px de alto. Se generan con scripts/armar_skin.py, que imprime esta línea.
 */
export interface SpriteFrame {
  w: number
  h: number
  body: number
  frames: number // cuadros por dirección
}
export const CUSTOM_SPRITES: Record<string, SpriteFrame> = {
  Nico: {w: 33, h: 43, body: 40, frames: 4},
  Fran: {w: 25, h: 44, body: 40, frames: 4},
  Agus: {w: 24, h: 44, body: 40, frames: 4},
  Miguel: {w: 32, h: 42, body: 40, frames: 4},
  Carina: {w: 30, h: 45, body: 40, frames: 4}
}

/** Tamaño de cuadro, de cuerpo y cantidad de cuadros de un personaje (LimeZu o propio). */
export function frameOf(sprite: string): SpriteFrame {
  return CUSTOM_SPRITES[sprite] ?? {w: FRAME.w, h: FRAME.h, body: BODY_H, frames: FRAME.perDir}
}
export type Dir = 'right' | 'up' | 'left' | 'down'
export const DIR_INDEX: Record<Dir, number> = {right: 0, up: 1, left: 2, down: 3}

/** Recortes del atlas de muebles (public/assets/limezu/props.png). */
export const PROPS = {
  bigPlant: {x: 0, y: 0, w: 14, h: 23},
  smallPlant: {x: 16, y: 0, w: 12, h: 14},
  tree: {x: 30, y: 0, w: 18, h: 31},
  palm: {x: 50, y: 0, w: 23, h: 31},
  floorLamp: {x: 75, y: 0, w: 13, h: 33},
  corkboard: {x: 90, y: 0, w: 26, h: 13},
  landscape: {x: 118, y: 0, w: 21, h: 13},
  globe: {x: 141, y: 0, w: 13, h: 21},
  paintA: {x: 156, y: 0, w: 13, h: 15},
  paintC: {x: 171, y: 0, w: 13, h: 15}
} as const
export type PropName = keyof typeof PROPS

export interface Assets {
  props: HTMLImageElement
  characters: Record<string, HTMLImageElement>
}

function load(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('No se pudo cargar ' + src))
    img.src = src
  })
}

/** Carga todo; si algo falla, la app sigue con el dibujo generado por código. */
export async function loadAssets(): Promise<Assets | null> {
  try {
    const custom = Object.keys(CUSTOM_SPRITES)
    const [props, ...chars] = await Promise.all([
      load(BASE + 'props.png'),
      ...CHARACTER_SPRITES.map(n => load(`${BASE}characters/${n}.png`)),
      // un personaje propio que no carga no tira abajo el resto: esa persona usa el círculo
      ...custom.map(n => load(`${import.meta.env.BASE_URL}assets/personajes/${n}.png`).catch(() => null))
    ])
    const characters: Record<string, HTMLImageElement> = {}
    ;[...CHARACTER_SPRITES, ...custom].forEach((n, i) => {
      const img = chars[i]
      if (img) characters[n] = img
    })
    return {props, characters}
  } catch (e) {
    console.warn(e)
    return null
  }
}

/** Dibuja un recorte del atlas con la base (pies) en (x, bottom), centrado en x. */
export function drawProp(g: CanvasRenderingContext2D, a: Assets, name: PropName, x: number, bottom: number) {
  const r = PROPS[name]
  g.drawImage(a.props, r.x, r.y, r.w, r.h, Math.round(x - r.w / 2), Math.round(bottom - r.h), r.w, r.h)
}
