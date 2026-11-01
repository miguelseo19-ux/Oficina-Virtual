import {DESK_COUNT} from './config'

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export interface Desk {
  num: number // 1..12
  zone: Rect // alfombra: estar acá = estar "en la llamada" de ese escritorio
  table: Rect // mueble sólido
  chair: {x: number; y: number}
  seat: {x: number; y: number} // donde aparece el dueño
  top: boolean
}

export const WORLD = {w: 1460, h: 960}
const WALL = 20
const POD_W = 210
const POD_H = 250
const GAP = 20
const PER_ROW = DESK_COUNT / 2

export const DESKS: Desk[] = []
for (let i = 0; i < DESK_COUNT; i++) {
  const top = i < PER_ROW
  const col = i % PER_ROW
  const x = WALL + 30 + col * (POD_W + GAP)
  const y = top ? WALL + 30 : WORLD.h - WALL - 30 - POD_H
  const table = top
    ? {x: x + 35, y: y + 40, w: POD_W - 70, h: 56}
    : {x: x + 35, y: y + POD_H - 96, w: POD_W - 70, h: 56}
  const chairY = top ? table.y + table.h + 22 : table.y - 22
  DESKS.push({
    num: i + 1,
    zone: {x, y, w: POD_W, h: POD_H},
    table,
    chair: {x: x + POD_W / 2, y: chairY},
    seat: {x: x + POD_W / 2, y: top ? chairY + 40 : chairY - 40},
    top
  })
}

// Plantas decorativas (sólidas) en el pasillo
export const PLANTS: Rect[] = [
  {x: WORLD.w / 2 - 260, y: WORLD.h / 2 - 22, w: 44, h: 44},
  {x: WORLD.w / 2 + 216, y: WORLD.h / 2 - 22, w: 44, h: 44}
]

// Sofá / zona común en el centro del pasillo
export const LOUNGE: Rect = {x: WORLD.w / 2 - 120, y: WORLD.h / 2 - 50, w: 240, h: 100}

export const SPAWN = {x: 70, y: WORLD.h / 2}

export const SOLIDS: Rect[] = [
  {x: 0, y: 0, w: WORLD.w, h: WALL},
  {x: 0, y: WORLD.h - WALL, w: WORLD.w, h: WALL},
  {x: 0, y: 0, w: WALL, h: WORLD.h},
  {x: WORLD.w - WALL, y: 0, w: WALL, h: WORLD.h},
  ...DESKS.map(d => d.table),
  ...PLANTS
]

export const PLAYER_SIZE = 26

function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
}

function hitbox(x: number, y: number): Rect {
  const s = PLAYER_SIZE
  return {x: x - s / 2, y: y - s / 2, w: s, h: s}
}

export function collides(x: number, y: number): boolean {
  const box = hitbox(x, y)
  return SOLIDS.some(r => overlaps(box, r))
}

/** Escritorio cuya alfombra contiene el punto, o null. */
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
