/**
 * Arma el decorado estático de la oficina en un lienzo de baja resolución
 * (ART.w × ART.h). Se dibuja una sola vez y después se escala ×PX con
 * "nearest neighbor" para el look de 16 bits.
 *
 * Capas (de abajo hacia arriba):
 *   1. piso            2. paredes y ventanas      3. objetos fijos
 *   4. iluminación cálida + neones
 * Las capas dinámicas (estado de escritorios, carteles, avatares) se dibujan
 * aparte, en src/main.ts, encima de esta imagen.
 */
import {deskOwner} from '../config'
import {ART, CORRIDOR, CUBE_PLANTS, DESKS, L, SHELVES} from '../map'
import {
  armchair,
  bookshelf,
  chair,
  cityWindow,
  coffeeMachine,
  desk,
  ellipse,
  floor,
  floorLamp,
  glow,
  hangingPlant,
  laptop,
  mix,
  neon,
  PAL,
  picture,
  plant,
  rect,
  roundTable,
  roundRug,
  rug,
  stool,
  whiteboard,
  chamfer
} from './sprites'
import {roundOutline, type G} from './pixel'

export function buildScene(): HTMLCanvasElement {
  const cv = document.createElement('canvas')
  cv.width = ART.w
  cv.height = ART.h
  const g = cv.getContext('2d')!
  g.imageSmoothingEnabled = false

  drawFloor(g)
  drawWalls(g)
  for (const d of DESKS) drawCubicle(g, d)
  drawFrontWalls(g)
  drawCorridor(g)
  drawLighting(g)
  return cv
}

// ── 1. Piso ────────────────────────────────────────────────
function drawFloor(g: G) {
  rect(g, 0, 0, ART.w, ART.h, PAL.wallDark)
  floor(g, L.side, L.wallTop, ART.w - 2 * L.side, L.wallBottom - L.wallTop, 7)
  // los cubículos un poco más oscuros que el pasillo
  for (const d of DESKS) rect(g, d.cell.x, d.cell.y, d.cell.w, d.cell.h, 'rgba(8,4,14,0.28)')
  // sombra bajo la pared superior
  rect(g, L.side, L.wallTop, ART.w - 2 * L.side, 2, 'rgba(0,0,0,0.45)')
}

// ── 2. Paredes y ventanas ──────────────────────────────────
function drawWalls(g: G) {
  // pared superior: tapa, franja de ventanas, muro del fondo de cada cubículo
  rect(g, 0, 0, ART.w, 3, PAL.wallDark)
  rect(g, 0, 3, ART.w, 1, PAL.trim)
  for (const d of DESKS.filter(d => d.top)) {
    cityWindow(g, d.cell.x + 2, 4, d.cell.w - 4, 7, d.num * 13)
    rect(g, d.cell.x, 11, d.cell.w, 11, PAL.wallFace)
    rect(g, d.cell.x, 11, d.cell.w, 1, PAL.trim)
    for (let x = d.cell.x + 6; x < d.cell.x + d.cell.w; x += 12) rect(g, x, 12, 1, 9, PAL.wallFaceDk)
    rect(g, d.cell.x, 21, d.cell.w, 1, PAL.wallFaceDk)
  }
  // columnas entre cubículos (arriba) con planta colgante
  for (const d of DESKS.filter(d => d.top)) {
    const px = d.cell.x + d.cell.w
    if (d.num % 6 === 0) continue
    rect(g, px, 3, L.partition, 19, PAL.wallCap)
    rect(g, px, 3, 1, 19, PAL.wallCapHi)
    hangingPlant(g, px + 2, 3, 7, d.num * 7)
  }
  // paredes laterales con ventanas en el pasillo
  for (const side of [0, ART.w - L.side]) {
    rect(g, side, 0, L.side, ART.h, PAL.wallDark)
    const inner = side === 0 ? L.side - 2 : side
    rect(g, inner, L.wallTop, 2, L.wallBottom - L.wallTop, PAL.wallCap)
    cityWindow(g, side + 3, L.corridor.y + 6, L.side - 6, L.corridor.h - 12, side + 99)
    rect(g, side + 2, L.corridor.y + 5, L.side - 4, 1, PAL.trim)
    rect(g, side + 2, L.corridor.y + L.corridor.h - 6, L.side - 4, 1, PAL.trim)
  }
  // pared inferior: tapa con paneles de vidrio
  rect(g, 0, L.wallBottom, ART.w, ART.h - L.wallBottom, PAL.wallDark)
  rect(g, 0, L.wallBottom, ART.w, 2, PAL.wallCap)
  for (const d of DESKS.filter(d => !d.top)) {
    rect(g, d.cell.x + 4, L.wallBottom + 5, d.cell.w - 8, 8, PAL.glass)
    rect(g, d.cell.x + 4, L.wallBottom + 5, d.cell.w - 8, 1, PAL.glassHi)
    for (let x = d.cell.x + 4; x < d.cell.x + d.cell.w - 4; x += 16) rect(g, x, L.wallBottom + 5, 1, 8, PAL.wallDark)
    rect(g, d.cell.x + 18, L.wallBottom + 15, d.cell.w - 36, 1, PAL.warm)
  }
  // tabiques entre cubículos
  for (const d of DESKS) {
    if (d.num % 6 === 0) continue
    const x = d.cell.x + d.cell.w
    rect(g, x, d.cell.y, L.partition, d.cell.h, PAL.wallCap)
    rect(g, x, d.cell.y, 1, d.cell.h, PAL.wallCapHi)
    rect(g, x + L.partition - 1, d.cell.y, 1, d.cell.h, PAL.wallFaceDk)
  }
}

// ── 3a. Cubículos ──────────────────────────────────────────
const NEON_COLORS = ['#b06cff', '#ff6a3d', '#5ee0ff', '#ff5fa2', '#ffb347', '#7dffb0']

function drawCubicle(g: G, d: (typeof DESKS)[number]) {
  const owner = deskOwner(d.num)
  const rugColor = owner?.color ?? '#5e5266'
  const cx = d.cell.x + d.cell.w / 2
  rug(g, d.rugP.x, d.rugP.y, d.rugP.w, d.rugP.h, rugColor)
  if (d.top) {
    // decoración en el muro del fondo (genérica; varía por escritorio)
    const kind = (d.num - 1) % 6
    neon(g, kind, cx, 16, NEON_COLORS[kind])
    picture(g, d.cell.x + 6, 13, 9, 6)
    bookshelf(g, d.cell.x + d.cell.w - 18, 13, 14, 8, d.num * 31)
  }
  desk(g, d.tableP.x, d.tableP.y, d.tableP.w, d.tableP.h, d.num * 17)
  chair(g, d.chairP.x, d.chairP.y)
  const p = CUBE_PLANTS[d.num - 1]
  plant(g, p.x, p.y, p.w, p.h, d.num * 23)
  if (!d.top) {
    const s = SHELVES[d.num - 1]
    if (s) bookshelf(g, s.x, s.y, s.w, s.h, d.num * 41)
  }
}

// ── 2b. Paredes de vidrio con puertas ──────────────────────
function drawFrontWalls(g: G) {
  for (const row of [L.topFront.y, L.botFront.y]) {
    const doors = DESKS.filter(d => d.door.y === row).map(d => d.door)
    let x = L.side
    const segs: [number, number][] = []
    for (const dr of doors) {
      segs.push([x, dr.x])
      x = dr.x + dr.w
    }
    segs.push([x, ART.w - L.side])
    for (const [a, b] of segs) {
      const w = b - a
      rect(g, a, row, w, 2, PAL.wallCap)
      rect(g, a, row, w, 1, PAL.wallCapHi)
      rect(g, a, row + 2, w, 5, PAL.glass)
      rect(g, a, row + 2, w, 1, PAL.glassHi)
      for (let gx = a + 3; gx < b - 1; gx += 9) {
        rect(g, gx, row + 3, 1, 3, PAL.glassHi)
        rect(g, gx + 1, row + 3, 1, 1, PAL.glassHi)
      }
      rect(g, a, row + 7, w, 1, PAL.wallDark)
      // tira de luz cálida bajo el vidrio
      rect(g, a + 3, row + 8, Math.max(0, w - 6), 1, PAL.warm)
    }
    // marcos de puertas
    for (const dr of doors) {
      rect(g, dr.x - 1, row, 1, 8, PAL.trim)
      rect(g, dr.x + dr.w, row, 1, 8, PAL.trim)
      rect(g, dr.x, row + 7, dr.w, 1, 'rgba(0,0,0,0.35)')
    }
    // columnas con aplique de luz (entre cubículos)
    for (const d of DESKS.filter(dd => dd.door.y === row)) {
      if (d.num % 6 === 0) continue
      const px = d.cell.x + d.cell.w
      rect(g, px, row - 1, L.partition, 9, PAL.wallCapHi)
      rect(g, px + 1, row + 2, 2, 3, PAL.lamp)
    }
  }
}

// ── 3b. Pasillo ────────────────────────────────────────────
function drawCorridor(g: G) {
  const {lounge, island, coffee, meeting} = CORRIDOR
  // Rincón de descanso
  const lr = lounge.rug
  roundRug(g, lr.x + lr.w / 2, lr.y + lr.h / 2, lr.w / 2, lr.h / 2, '#6a4a5a')
  bookshelf(g, lounge.shelf.x, lounge.shelf.y, lounge.shelf.w, lounge.shelf.h, 77)
  plant(g, lounge.shelf.x + lounge.shelf.w + 2, lounge.shelf.y - 2, 9, 14, 5)
  for (const c of lounge.chairs) armchair(g, c.x, c.y, c.w, c.h)
  roundTable(g, lounge.table.x + lounge.table.w / 2, lounge.table.y + lounge.table.h / 2, lounge.table.w / 2, lounge.table.h / 2)
  rect(g, lounge.table.x + 6, lounge.table.y + 3, 2, 2, PAL.paper)
  floorLamp(g, lounge.lamp.x, lounge.lamp.y)
  // banco junto a la ventana
  const b = lounge.bench
  rect(g, b.x, b.y, b.w, b.h, PAL.shelfDk)
  rect(g, b.x + 1, b.y + 1, b.w - 2, b.h - 2, PAL.purpleDk)
  for (let y = b.y + 4; y < b.y + b.h - 4; y += 14) chamfer(g, b.x + 2, y, b.w - 4, 8, PAL.purple)
  rect(g, b.x + 3, b.y + 22, 4, 4, PAL.orangeHi)
  // pasillo central: camino de alfombra
  neon(g, 3, lounge.shelf.x + 11, lounge.shelf.y - 5, '#b06cff')

  // Isla central con anillo de neón
  const ring = island.ring
  roundRug(g, ring.x + ring.w / 2, ring.y + ring.h / 2, ring.w / 2, ring.h / 2, '#3c3446')
  roundOutline(g, ring.x + 6, ring.y + 4, ring.w - 12, ring.h - 8, 8, PAL.warm)
  const dk = island.desk
  rect(g, dk.x + 2, dk.y + dk.h, dk.w - 4, 2, 'rgba(0,0,0,0.5)')
  chamfer(g, dk.x, dk.y, dk.w, dk.h, PAL.deskEdge, 3)
  chamfer(g, dk.x + 1, dk.y + 1, dk.w - 2, dk.h - 5, mix(PAL.deskTop, '#000000', 0.2), 3)
  for (let i = 0; i < 3; i++) rect(g, dk.x + 6, dk.y + 4 + i * 4, dk.w - 12, 1, PAL.deskEdge)
  laptop(g, dk.x + dk.w / 2 - 4, dk.y + 4)
  plant(g, dk.x + 14, dk.y - 6, 10, 14, 61)
  rect(g, dk.x + dk.w - 18, dk.y + 3, 1, 6, PAL.metalDk)
  ellipse(g, dk.x + dk.w - 18, dk.y + 3, 3, 2, PAL.lamp)
  rect(g, dk.x + dk.w - 30, dk.y + 6, 5, 4, PAL.paper)
  island.stools.forEach((s, i) => stool(g, s.x, s.y, i === 1 ? PAL.cream : PAL.orange))
  for (const p of island.plants) {
    rect(g, p.x + 1, p.y + p.h - 5, p.w - 2, 5, '#cfc6b8')
    plant(g, p.x, p.y - 4, p.w, p.h, p.x)
  }

  // Barra de café
  const ct = coffee.counter
  rect(g, ct.x, ct.y + ct.h, ct.w, 2, 'rgba(0,0,0,0.5)')
  rect(g, ct.x, ct.y, ct.w, ct.h, '#2b2230')
  rect(g, ct.x, ct.y, ct.w, 5, '#4a3a44')
  rect(g, ct.x, ct.y, ct.w, 1, '#5c4a55')
  for (let x = ct.x + 4; x < ct.x + ct.w; x += 12) rect(g, x, ct.y + 7, 8, 8, '#251d29')
  coffeeMachine(g, ct.x + 3, ct.y - 6)
  for (let i = 0; i < 5; i++) rect(g, ct.x + 16 + i * 4, ct.y + 1, 2, 3, i % 2 ? PAL.paper : PAL.cream)
  rect(g, ct.x + ct.w - 9, ct.y - 3, 5, 6, '#7a5a40')
  rect(g, ct.x + ct.w - 9, ct.y - 3, 5, 1, PAL.metal)
  // letrero de taza en neón
  const nx = ct.x + ct.w / 2 + 6
  const ny = ct.y - 9
  const c = '#ffb347'
  rect(g, nx - 3, ny, 6, 1, c)
  rect(g, nx - 3, ny, 1, 4, c)
  rect(g, nx + 2, ny, 1, 4, c)
  rect(g, nx - 2, ny + 4, 4, 1, c)
  rect(g, nx + 3, ny + 1, 1, 2, c)
  for (let i = -2; i <= 1; i += 2) rect(g, nx + i, ny - 3, 1, 2, c)
  glow(g, nx, ny + 1, 12, c, 0.4)

  // Sala de reuniones informal
  const mr = meeting.rug
  roundRug(g, mr.x + mr.w / 2, mr.y + mr.h / 2, mr.w / 2, mr.h / 2, '#5a4a70')
  const mt = meeting.table
  const mcx = mt.x + mt.w / 2
  const mcy = mt.y + mt.h / 2
  for (const [dx, dy] of [[0, -13], [0, 12], [-14, 0], [14, 0]]) {
    chamfer(g, mcx + dx - 4, mcy + dy - 3, 8, 7, PAL.purpleDk)
    chamfer(g, mcx + dx - 3, mcy + dy - 3, 6, 5, PAL.purple)
  }
  roundTable(g, mcx, mcy, mt.w / 2, mt.h / 2)
  laptop(g, mcx - 4, mcy - 4)
  whiteboard(g, meeting.board.x, meeting.board.y, meeting.board.w, meeting.board.h)
  plant(g, mr.x + mr.w - 8, mr.y + mr.h - 10, 10, 14, 91)
  // lámpara colgante
  ellipse(g, meeting.pendant.x, meeting.pendant.y - 22, 4, 2, '#2b2230')
  rect(g, meeting.pendant.x - 3, meeting.pendant.y - 21, 6, 1, PAL.lamp)
}

// ── 4. Iluminación ─────────────────────────────────────────
function drawLighting(g: G) {
  // tono ambiente: oscurecer y llevar a violeta
  g.fillStyle = 'rgba(14, 6, 28, 0.28)'
  g.fillRect(0, 0, ART.w, ART.h)
  // luz bajo las paredes de vidrio
  for (const row of [L.topFront.y, L.botFront.y]) {
    for (let x = L.side + 20; x < ART.w - L.side; x += 39) glow(g, x, row + 9, 22, PAL.warm, 0.13)
  }
  // apliques en columnas
  for (const d of DESKS) {
    if (d.num % 6 === 0) continue
    const px = d.cell.x + d.cell.w + 2
    glow(g, px, (d.top ? L.topFront.y : L.botFront.y) + 3, 16, PAL.lamp, 0.25)
  }
  // lámparas de escritorio
  for (const d of DESKS) glow(g, d.tableP.x + d.tableP.w - 4, d.tableP.y + 3, 16, PAL.lamp, 0.22)
  // pasillo
  const {lounge, island, meeting} = CORRIDOR
  glow(g, lounge.lamp.x, lounge.lamp.y + 2, 36, PAL.lamp, 0.3)
  glow(g, island.desk.x + island.desk.w - 18, island.desk.y + 3, 30, PAL.lamp, 0.28)
  glow(g, meeting.pendant.x, meeting.pendant.y - 18, 40, PAL.lamp, 0.24)
  // ventanas laterales: luz fría de la ciudad
  glow(g, 10, L.corridor.y + 50, 40, '#6a5aff', 0.12)
  glow(g, ART.w - 10, L.corridor.y + 50, 40, '#6a5aff', 0.12)
  // anillo de la isla
  const r = island.ring
  for (let x = r.x + 14; x < r.x + r.w - 10; x += 22) {
    glow(g, x, r.y + 4, 12, PAL.warm, 0.12)
    glow(g, x, r.y + r.h - 4, 12, PAL.warm, 0.12)
  }
}
