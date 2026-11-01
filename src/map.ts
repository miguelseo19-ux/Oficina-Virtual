import {DESK_COUNT} from './config'

/**
 * Geometría de la oficina — ÚNICA fuente de verdad.
 * Se diseña en "píxeles de arte" (P) y se convierte a coordenadas de mundo
 * multiplicando por PX. De acá salen tanto el dibujo (src/scene) como las
 * colisiones y las zonas de llamada, así nunca se desalinean.
 */
export const PX = 3
export const ART = {w: 488, h: 320} // tamaño del lienzo pixel art
export const WORLD = {w: ART.w * PX, h: ART.h * PX}

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

/** Rectángulo en píxeles de arte (para dibujar). */
export type PRect = Rect

const toWorld = (r: PRect): Rect => ({x: r.x * PX, y: r.y * PX, w: r.w * PX, h: r.h * PX})

// ── Estructura general (en píxeles de arte) ─────────────────
export const L = {
  wallTop: 22, // pared superior (ventanas + muro del fondo de los cubículos)
  side: 12, // paredes laterales
  topRow: {y: 22, h: 76}, // interior de los cubículos de arriba
  topFront: {y: 98, h: 8}, // pared de vidrio de los cubículos de arriba
  corridor: {y: 106, h: 106},
  botFront: {y: 212, h: 8},
  botRow: {y: 220, h: 78},
  wallBottom: 298, // pared inferior (hasta ART.h)
  cubW: 74,
  partition: 4,
  door: 24 // ancho de la puerta de cada cubículo
}

export interface Desk {
  num: number // 1..12 (ID estable, lo usa toda la app)
  top: boolean
  cell: PRect // interior del cubículo (arte)
  zone: Rect // estar acá = estar en la llamada de ese escritorio (mundo)
  table: Rect // mueble sólido (mundo)
  tableP: PRect
  chairP: {x: number; y: number}
  rugP: PRect
  monitorsP: PRect // zona de las pantallas (para el brillo dinámico)
  seat: {x: number; y: number} // donde aparece el dueño (mundo)
  plate: {x: number; y: number} // cartel con nombre (mundo)
  door: PRect // hueco en la pared de vidrio
}

const PER_ROW = DESK_COUNT / 2
export const DESKS: Desk[] = []
for (let i = 0; i < DESK_COUNT; i++) {
  const top = i < PER_ROW
  const col = i % PER_ROW
  const x0 = L.side + col * (L.cubW + L.partition)
  const row = top ? L.topRow : L.botRow
  const cell = {x: x0, y: row.y, w: L.cubW, h: row.h}
  const cx = x0 + L.cubW / 2
  // escritorio contra la pared del fondo (arriba) o al medio (abajo, la puerta está arriba)
  const deskY = top ? row.y + 8 : row.y + 18
  const tableP = {x: cx - 23, y: deskY, w: 46, h: 15}
  const chairP = {x: cx, y: deskY + 20}
  const rugP = {x: x0 + 8, y: deskY + 9, w: L.cubW - 16, h: top ? 40 : 42}
  const frontY = top ? L.topFront.y : L.botFront.y
  DESKS.push({
    num: i + 1,
    top,
    cell,
    zone: toWorld(cell),
    table: toWorld(tableP),
    tableP,
    chairP,
    rugP,
    monitorsP: {x: cx - 15, y: deskY + 1, w: 30, h: 7},
    seat: {x: cx * PX, y: (deskY + 29) * PX},
    plate: {x: cx * PX, y: (top ? row.y + row.h - 9 : row.y + row.h - 8) * PX},
    door: {x: cx - L.door / 2, y: frontY, w: L.door, h: 8}
  })
}

// ── Mobiliario del pasillo (arte) ───────────────────────────
const C = L.corridor
export const CORRIDOR = {
  lounge: {
    rug: {x: 44, y: C.y + 30, w: 72, h: 48},
    chairs: [
      {x: 50, y: C.y + 44, w: 13, h: 12},
      {x: 96, y: C.y + 44, w: 13, h: 12}
    ],
    table: {x: 72, y: C.y + 50, w: 16, h: 10},
    shelf: {x: 40, y: C.y + 20, w: 22, h: 12},
    lamp: {x: 124, y: C.y + 30},
    bench: {x: L.side, y: C.y + 24, w: 10, h: 58}
  },
  island: {
    ring: {x: 178, y: C.y + 30, w: 132, h: 54},
    desk: {x: 192, y: C.y + 40, w: 104, h: 20},
    stools: [
      {x: 214, y: C.y + 68},
      {x: 244, y: C.y + 68},
      {x: 274, y: C.y + 68}
    ],
    plants: [
      {x: 160, y: C.y + 40, w: 12, h: 14},
      {x: 316, y: C.y + 40, w: 12, h: 14}
    ]
  },
  coffee: {
    counter: {x: 346, y: C.y + 16, w: 52, h: 18}
  },
  meeting: {
    rug: {x: 412, y: C.y + 36, w: 58, h: 52},
    table: {x: 432, y: C.y + 54, w: 18, h: 16},
    board: {x: 455, y: C.y + 22, w: 18, h: 16},
    pendant: {x: 441, y: C.y + 50}
  }
}

export const SPAWN = {x: 30 * PX, y: (C.y + C.h / 2) * PX}

// ── Colisiones (mundo) ──────────────────────────────────────
function wallsWithDoors(y: number, h: number, doors: PRect[]): PRect[] {
  const out: PRect[] = []
  let x = L.side
  for (const d of doors) {
    out.push({x, y, w: d.x - x, h})
    x = d.x + d.w
  }
  out.push({x, y, w: ART.w - L.side - x, h})
  return out
}

const topDoors = DESKS.filter(d => d.top).map(d => d.door)
const botDoors = DESKS.filter(d => !d.top).map(d => d.door)
const partitions: PRect[] = []
for (let col = 1; col < PER_ROW; col++) {
  const x = L.side + col * (L.cubW + L.partition) - L.partition
  partitions.push({x, y: L.topRow.y, w: L.partition, h: L.topRow.h})
  partitions.push({x, y: L.botRow.y, w: L.partition, h: L.botRow.h})
}

/** Plantas decorativas (sólidas) dentro de los cubículos. */
export const CUBE_PLANTS: PRect[] = DESKS.map(d => ({
  x: d.cell.x + 2,
  y: d.top ? d.cell.y + 4 : d.cell.y + d.cell.h - 14,
  w: 8,
  h: 10
}))

/** Bibliotecas de pie en los cubículos de abajo (sólidas). Índice = num - 1. */
export const SHELVES: (PRect | null)[] = DESKS.map(d =>
  d.top ? null : {x: d.cell.x + d.cell.w - 18, y: d.cell.y + 2, w: 14, h: 8}
)

const solidsP: PRect[] = [
  {x: 0, y: 0, w: ART.w, h: L.wallTop}, // pared superior
  {x: 0, y: L.wallBottom, w: ART.w, h: ART.h - L.wallBottom}, // pared inferior
  {x: 0, y: 0, w: L.side, h: ART.h},
  {x: ART.w - L.side, y: 0, w: L.side, h: ART.h},
  ...wallsWithDoors(L.topFront.y, L.topFront.h, topDoors),
  ...wallsWithDoors(L.botFront.y, L.botFront.h, botDoors),
  ...partitions,
  ...DESKS.map(d => d.tableP),
  ...CUBE_PLANTS,
  ...(SHELVES.filter(Boolean) as PRect[]),
  CORRIDOR.lounge.shelf,
  CORRIDOR.lounge.bench,
  ...CORRIDOR.lounge.chairs,
  CORRIDOR.lounge.table,
  CORRIDOR.island.desk,
  ...CORRIDOR.island.plants,
  ...CORRIDOR.island.stools.map(s => ({x: s.x - 4, y: s.y - 3, w: 8, h: 6})),
  CORRIDOR.coffee.counter,
  {x: CORRIDOR.lounge.shelf.x + CORRIDOR.lounge.shelf.w + 2, y: CORRIDOR.lounge.shelf.y + 2, w: 9, h: 10}, // planta del rincón
  {x: CORRIDOR.lounge.lamp.x - 2, y: CORRIDOR.lounge.lamp.y + 8, w: 5, h: 5}, // lámpara de pie
  {x: CORRIDOR.meeting.rug.x + CORRIDOR.meeting.rug.w - 8, y: CORRIDOR.meeting.rug.y + CORRIDOR.meeting.rug.h - 6, w: 10, h: 8},
  CORRIDOR.meeting.table,
  CORRIDOR.meeting.board
]

export const SOLIDS: Rect[] = solidsP.map(toWorld)
export const SOLIDS_ART: PRect[] = solidsP // para depurar

export const PLAYER_SIZE = 24

function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
}

function hitbox(x: number, y: number): Rect {
  const s = PLAYER_SIZE
  // los pies cuentan más que la cabeza: caja baja para que se pueda pasar "por delante" de los muebles
  return {x: x - s / 2, y: y - s / 4, w: s, h: s * 0.75}
}

export function collides(x: number, y: number): boolean {
  const box = hitbox(x, y)
  return SOLIDS.some(r => overlaps(box, r))
}

/** Escritorio (cubículo) que contiene el punto, o null. */
export function zoneAt(x: number, y: number): number | null {
  for (const d of DESKS) {
    const z = d.zone
    if (x >= z.x && x <= z.x + z.w && y >= z.y && y <= z.y + z.h) return d.num
  }
  return null
}

export function deskByNum(n: number): Desk {
  return DESKS[n - 1]
}
