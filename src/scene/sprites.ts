/**
 * Sprites pixel art generados por código. Cada función dibuja un objeto en
 * coordenadas de "píxeles de arte". Son modulares: se pueden reemplazar uno
 * por uno por sprites dibujados a mano (PNG) sin tocar el resto.
 */
import {chamfer, dot, ellipse, ellipseOutline, glow, mix, pick, rect, rng, roundOutline, type G} from './pixel'

export const PAL = {
  // piso
  wood: ['#2c1f19', '#30221b', '#281c16', '#2e211a'],
  woodSeam: '#1c130f',
  woodHi: '#3a2a21',
  // paredes
  wallCap: '#3d3449',
  wallCapHi: '#51465f',
  wallFace: '#272031',
  wallFaceDk: '#1e1827',
  wallDark: '#15111c',
  trim: '#463c55',
  // vidrio
  glass: '#22324a',
  glassHi: '#43638a',
  glassDk: '#1a2638',
  // cielo nocturno
  sky: ['#1b1238', '#241848', '#2f1e5c'],
  city: ['#100b1e', '#150f28', '#1b1432'],
  cityLit: ['#ffcf6b', '#b48cff', '#7fd6ff', '#ff9a6a'],
  // luces
  warm: '#ff9a3c',
  warmHi: '#ffd08a',
  lamp: '#ffd27a',
  // muebles
  deskTop: '#6b4632',
  deskGrain: '#5c3c2a',
  deskEdge: '#45291c',
  bezel: '#14121a',
  screenOff: '#1d2232',
  chairSeat: '#24212c',
  chairBack: '#302c3a',
  shelf: '#3f2a20',
  shelfDk: '#2b1c15',
  books: ['#9c4a3a', '#3f6d8a', '#c2a24f', '#5b8a5a', '#7a5a9a', '#b8693a', '#d9d2c5'],
  pot: '#5c4a40',
  potDk: '#3f322c',
  leaf: ['#1f4d2b', '#2c6b38', '#3f8a46', '#5fae55'],
  orange: '#c3662b',
  orangeDk: '#8c4520',
  orangeHi: '#e08a48',
  cream: '#d8c7a6',
  purple: '#8a6bb8',
  purpleDk: '#634a8a',
  metal: '#8f8c9c',
  metalDk: '#55525f',
  paper: '#e8e2d4',
  neon: ['#b06cff', '#ff6a3d', '#ffb347', '#5ee0ff', '#ff5fa2', '#7dffb0']
}

// ── Piso de madera tipo parquet ────────────────────────────
export function floor(g: G, x0: number, y0: number, w: number, h: number, seed = 1) {
  const r = rng(seed)
  for (let by = y0; by < y0 + h; by += 8) {
    for (let bx = x0; bx < x0 + w; bx += 8) {
      const horiz = ((bx - x0) / 8 + (by - y0) / 8) % 2 === 0
      for (let k = 0; k < 2; k++) {
        const c = pick(r, PAL.wood)
        if (horiz) {
          rect(g, bx, by + k * 4, 8, 4, c)
          rect(g, bx, by + k * 4 + 3, 8, 1, PAL.woodSeam)
          if (r() < 0.35) rect(g, bx + 1 + Math.floor(r() * 4), by + k * 4 + 1, 2, 1, PAL.woodHi)
        } else {
          rect(g, bx + k * 4, by, 4, 8, c)
          rect(g, bx + k * 4 + 3, by, 1, 8, PAL.woodSeam)
          if (r() < 0.35) rect(g, bx + k * 4 + 1, by + 1 + Math.floor(r() * 4), 1, 2, PAL.woodHi)
        }
      }
    }
  }
}

// ── Ventana con ciudad nocturna ────────────────────────────
export function cityWindow(g: G, x: number, y: number, w: number, h: number, seed: number) {
  const r = rng(seed)
  // cielo en bandas
  const band = Math.ceil(h / 3)
  PAL.sky.forEach((c, i) => rect(g, x, y + i * band, w, band, c))
  // estrellas
  for (let i = 0; i < w / 6; i++) dot(g, x + Math.floor(r() * w), y + Math.floor(r() * (h / 2)), '#6a5aa8')
  // edificios
  let bx = x
  while (bx < x + w) {
    const bw = 3 + Math.floor(r() * 5)
    const bh = Math.floor(h * (0.35 + r() * 0.55))
    const c = pick(r, PAL.city)
    rect(g, bx, y + h - bh, Math.min(bw, x + w - bx), bh, c)
    for (let wy = y + h - bh + 1; wy < y + h - 1; wy += 2) {
      for (let wx = bx + 1; wx < Math.min(bx + bw, x + w) - 1; wx += 2) {
        if (r() < 0.28) dot(g, wx, wy, pick(r, PAL.cityLit))
      }
    }
    bx += bw
  }
  // marco y reflejo
  rect(g, x, y, w, 1, PAL.trim)
  rect(g, x, y + h - 1, w, 1, PAL.wallDark)
  for (let mx = x; mx < x + w; mx += 12) rect(g, mx, y, 1, h, PAL.wallDark)
}

// ── Plantas ────────────────────────────────────────────────
export function plant(g: G, x: number, y: number, w: number, h: number, seed: number) {
  const r = rng(seed)
  const potH = Math.max(3, Math.round(h * 0.35))
  const potW = Math.max(4, w - 2)
  const px = x + (w - potW) / 2
  const py = y + h - potH
  // follaje: manchas superpuestas de oscuro a claro
  const cx = x + w / 2
  const cy = py - 1
  for (let i = 0; i < 4; i++) {
    const c = PAL.leaf[i]
    for (let k = 0; k < 5 - i; k++) {
      const a = r() * Math.PI * 2
      const d = r() * (w / 2.2) * (1 - i * 0.18)
      ellipse(g, cx + Math.cos(a) * d, cy - h * 0.25 + Math.sin(a) * d * 0.8, Math.max(1, w / 4 - i * 0.4), Math.max(1, w / 5 - i * 0.3), c)
    }
  }
  // maceta
  rect(g, px, py, potW, potH, PAL.pot)
  rect(g, px - 1, py, potW + 2, 1, mix(PAL.pot, '#ffffff', 0.15))
  rect(g, px, py + potH - 1, potW, 1, PAL.potDk)
}

/** Planta colgante sobre una pared. */
export function hangingPlant(g: G, x: number, y: number, len: number, seed: number) {
  const r = rng(seed)
  rect(g, x - 2, y, 5, 3, PAL.pot)
  for (let v = -3; v <= 3; v++) {
    const l = len * (0.5 + r() * 0.5)
    for (let i = 0; i < l; i++) {
      const c = PAL.leaf[1 + Math.floor(r() * 3)]
      dot(g, x + v + Math.round(Math.sin(i * 0.7 + v) * 0.6), y + 2 + i, c)
      if (r() < 0.3) dot(g, x + v + 1, y + 2 + i, PAL.leaf[3])
    }
  }
}

// ── Escritorio con dos monitores ───────────────────────────
export function desk(g: G, x: number, y: number, w: number, h: number, seed: number) {
  const r = rng(seed)
  rect(g, x + 1, y + h, w - 2, 2, 'rgba(0,0,0,0.45)') // sombra
  rect(g, x, y, w, h, PAL.deskTop)
  for (let i = 0; i < 4; i++) rect(g, x + 2, y + 3 + i * 3, w - 4, 1, PAL.deskGrain)
  rect(g, x, y, w, 1, mix(PAL.deskTop, '#ffffff', 0.12))
  rect(g, x, y + h - 3, w, 3, PAL.deskEdge)
  // monitores
  const mw = 13
  const mx1 = x + w / 2 - mw - 1
  const mx2 = x + w / 2 + 1
  for (const mx of [mx1, mx2]) {
    rect(g, mx, y + 1, mw, 8, PAL.bezel)
    rect(g, mx + 1, y + 2, mw - 2, 6, PAL.screenOff)
    rect(g, mx + mw / 2 - 1, y + 9, 3, 1, PAL.bezel)
  }
  // teclado, mouse, taza, papeles
  rect(g, x + w / 2 - 6, y + 10, 12, 2, '#2b2935')
  rect(g, x + w / 2 - 5, y + 10, 10, 1, '#3a3846')
  rect(g, x + w / 2 + 8, y + 10, 2, 2, '#3a3846')
  rect(g, x + 4, y + 8, 3, 3, PAL.paper)
  dot(g, x + 7, y + 9, PAL.paper)
  if (r() < 0.6) rect(g, x + w - 8, y + 2, 5, 4, PAL.paper)
  // lámpara de escritorio
  rect(g, x + w - 4, y + 3, 1, 5, PAL.metalDk)
  rect(g, x + w - 6, y + 2, 4, 2, PAL.lamp)
}

export function chair(g: G, cx: number, cy: number) {
  rect(g, cx - 4, cy - 5, 8, 3, PAL.chairBack)
  rect(g, cx - 3, cy - 6, 6, 1, mix(PAL.chairBack, '#ffffff', 0.1))
  chamfer(g, cx - 4, cy - 2, 8, 5, PAL.chairSeat)
  rect(g, cx - 3, cy + 3, 6, 1, '#141218')
}

// ── Alfombras ──────────────────────────────────────────────
export function rug(g: G, x: number, y: number, w: number, h: number, color: string) {
  const base = mix(color, '#1a1218', 0.66)
  const border = mix(color, '#1a1218', 0.38)
  const pattern = mix(color, '#1a1218', 0.52)
  rect(g, x, y, w, h, base)
  roundOutline(g, x, y, w, h, 1, border)
  roundOutline(g, x + 2, y + 2, w - 4, h - 4, 1, pattern)
  for (let i = x + 5; i < x + w - 5; i += 4) {
    dot(g, i, y + 4, pattern)
    dot(g, i + 2, y + h - 5, pattern)
  }
  // flecos
  for (let i = x + 2; i < x + w - 2; i += 2) {
    dot(g, i, y - 1, border)
    dot(g, i, y + h, border)
  }
}

export function roundRug(g: G, cx: number, cy: number, rx: number, ry: number, color: string) {
  ellipse(g, cx, cy, rx, ry, mix(color, '#1a1218', 0.5))
  ellipseOutline(g, cx, cy, rx - 1, ry - 1, mix(color, '#1a1218', 0.2))
  ellipseOutline(g, cx, cy, rx - 4, ry - 3, mix(color, '#1a1218', 0.35))
}

// ── Decoración de pared ────────────────────────────────────
export function bookshelf(g: G, x: number, y: number, w: number, h: number, seed: number) {
  const r = rng(seed)
  rect(g, x, y, w, h, PAL.shelfDk)
  rect(g, x, y, w, 1, PAL.shelf)
  const rows = Math.max(1, Math.floor((h - 1) / 4))
  for (let row = 0; row < rows; row++) {
    const sy = y + 1 + row * 4
    let bx = x + 1
    while (bx < x + w - 1) {
      if (r() < 0.12) {
        bx += 2
        continue
      }
      const bh = 2 + Math.floor(r() * 2)
      rect(g, bx, sy + 3 - bh, 1, bh, pick(r, PAL.books))
      bx += 1
    }
    rect(g, x, sy + 3, w, 1, PAL.shelf)
  }
}

export function picture(g: G, x: number, y: number, w: number, h: number) {
  rect(g, x, y, w, h, '#3a2a22')
  rect(g, x + 1, y + 1, w - 2, h - 2, '#ff8c5a')
  rect(g, x + 1, y + 1, w - 2, Math.ceil((h - 2) / 2), '#7a4aa8')
  rect(g, x + 1, y + h - 3, w - 2, 2, '#2b1d3d')
  dot(g, x + w - 3, y + 2, '#ffd27a')
}

/** Letrero de neón (formas genéricas, no dependen de ningún usuario). */
export function neon(g: G, kind: number, cx: number, cy: number, color: string) {
  const d = (x: number, y: number) => dot(g, cx + x, cy + y, color)
  const line = (x1: number, y1: number, x2: number, y2: number) => {
    const n = Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1))
    for (let i = 0; i <= n; i++) d(Math.round(x1 + ((x2 - x1) * i) / n), Math.round(y1 + ((y2 - y1) * i) / n))
  }
  switch (kind % 6) {
    case 0: // </>
      line(-6, 0, -3, -3); line(-6, 0, -3, 3); line(-1, 3, 1, -3); line(6, 0, 3, -3); line(6, 0, 3, 3)
      break
    case 1: // rayo
      line(1, -4, -2, 0); line(-2, 0, 2, 0); line(2, 0, -1, 4)
      break
    case 2: // montañas
      line(-6, 3, -2, -2); line(-2, -2, 1, 1); line(1, 1, 3, -1); line(3, -1, 6, 3); line(-6, 3, 6, 3)
      break
    case 3: // fantasmita
      line(-3, -1, -3, 3); line(3, -1, 3, 3); line(-2, -3, 2, -3); d(-3, -2); d(3, -2)
      d(-2, 3); d(0, 3); d(2, 3); d(-1, 0); d(1, 0)
      break
    case 4: // corazón
      d(-2, -2); d(-1, -2); d(1, -2); d(2, -2); d(-3, -1); d(0, -1); d(3, -1)
      line(-3, 0, 0, 3); line(3, 0, 0, 3)
      break
    default: // estrella
      line(0, -4, 0, 4); line(-4, 0, 4, 0); line(-2, -2, 2, 2); line(-2, 2, 2, -2)
  }
  glow(g, cx, cy, 12, color, 0.35)
}

// ── Muebles del pasillo ────────────────────────────────────
export function armchair(g: G, x: number, y: number, w: number, h: number) {
  rect(g, x + 1, y + h, w - 2, 1, 'rgba(0,0,0,0.4)')
  chamfer(g, x, y, w, h, PAL.orangeDk, 2)
  chamfer(g, x + 2, y + 1, w - 4, 4, PAL.orange)
  chamfer(g, x + 2, y + 5, w - 4, h - 7, PAL.orangeHi)
  rect(g, x, y + 3, 2, h - 4, PAL.orange)
  rect(g, x + w - 2, y + 3, 2, h - 4, PAL.orange)
}

export function roundTable(g: G, cx: number, cy: number, rx: number, ry: number) {
  ellipse(g, cx, cy + 2, rx, ry, 'rgba(0,0,0,0.4)')
  ellipse(g, cx, cy, rx, ry, PAL.deskEdge)
  ellipse(g, cx, cy - 1, rx - 1, ry - 1, PAL.deskTop)
}

export function floorLamp(g: G, x: number, y: number) {
  rect(g, x - 2, y + 12, 5, 1, PAL.metalDk)
  rect(g, x, y + 3, 1, 9, PAL.metalDk)
  chamfer(g, x - 3, y, 7, 4, PAL.lamp)
  rect(g, x - 2, y + 3, 5, 1, PAL.warm)
}

export function stool(g: G, cx: number, cy: number, c: string) {
  ellipse(g, cx, cy + 1, 4, 3, 'rgba(0,0,0,0.4)')
  ellipse(g, cx, cy, 4, 3, mix(c, '#000000', 0.3))
  ellipse(g, cx, cy - 1, 3, 2, c)
}

export function laptop(g: G, x: number, y: number) {
  rect(g, x, y, 8, 5, PAL.metalDk)
  rect(g, x + 1, y + 1, 6, 3, '#6a7cff')
  rect(g, x - 1, y + 5, 10, 2, PAL.metal)
}

export function coffeeMachine(g: G, x: number, y: number) {
  rect(g, x, y, 9, 9, PAL.metal)
  rect(g, x + 1, y + 1, 7, 3, PAL.metalDk)
  dot(g, x + 2, y + 2, '#ff6a3d')
  rect(g, x + 3, y + 5, 3, 2, '#141218')
  rect(g, x + 3, y + 7, 3, 1, PAL.paper)
}

export function whiteboard(g: G, x: number, y: number, w: number, h: number) {
  rect(g, x + 2, y + h, 1, 3, PAL.metalDk)
  rect(g, x + w - 3, y + h, 1, 3, PAL.metalDk)
  rect(g, x, y, w, h, PAL.metal)
  rect(g, x + 1, y + 1, w - 2, h - 2, '#eceae4')
  const notes = ['#ffd27a', '#ff9a6a', '#9fe0a0', '#b8a8ff']
  let n = 0
  for (let ny = y + 3; ny < y + h - 3; ny += 4) {
    for (let nx = x + 3; nx < x + w - 3; nx += 4) rect(g, nx, ny, 3, 3, notes[n++ % notes.length])
  }
}

export { glow, rect, dot, ellipse, mix, chamfer }
