import {deskOwner} from '../config'
import {CORRIDOR, CUBE_PLANTS, DESKS, L, PX, SHELVES, WALLS_ART, WING, type PRect} from '../map'
import type {Light} from './sprites'

/**
 * Vista "simplificada": plano liso de la oficina, sin pixel art ni personajes.
 * Sale de la misma geometría que el resto (map.ts) y se dibuja con vectores en cada cuadro,
 * así queda nítido con cualquier zoom. Las personas, carteles y llamadas los dibuja main.ts.
 */
const NIGHT = {
  floor: '#100c15',
  cell: '#17121d',
  wingFloor: '#130f19',
  wall: '#29222f',
  wallEdge: 'rgba(255,255,255,0.10)',
  furn: '#2b2433',
  furnEdge: 'rgba(255,255,255,0.16)',
  soft: 'rgba(255,255,255,0.035)',
  hair: 'rgba(255,255,255,0.10)',
  plant: '#2f5140',
  bronze: 'rgba(150,88,47,0.75)',
  felt: '#1e4033',
  board: 'rgba(255,255,255,0.18)',
  ownerTint: 0.1
}
/** De día: plano claro (como un plano de arquitectura), paredes oscuras. */
const DAY: typeof NIGHT = {
  floor: '#f1ece4',
  cell: '#faf7f2',
  wingFloor: '#ece5db',
  wall: '#4a4250',
  wallEdge: 'rgba(0,0,0,0.25)',
  furn: '#e0d8cd',
  furnEdge: 'rgba(0,0,0,0.2)',
  soft: 'rgba(0,0,0,0.035)',
  hair: 'rgba(0,0,0,0.14)',
  plant: '#8fc293',
  bronze: 'rgba(150,88,47,0.85)',
  felt: '#3f8a63',
  board: '#ffffff',
  ownerTint: 0.14
}
let K = NIGHT

/** `artPx` = cuántos píxeles de pantalla mide un píxel de arte (para que las líneas midan 1px). */
export function drawSimpleMap(ctx: CanvasRenderingContext2D, artPx: number, light: Light = 'night') {
  K = light === 'day' ? DAY : NIGHT
  const hair = 1 / artPx
  ctx.save()
  ctx.scale(PX, PX) // de acá en adelante, coordenadas en píxeles de arte

  const box = (r: PRect, fill: string | null, stroke: string | null = null, radius = 1.5) => {
    ctx.beginPath()
    ctx.roundRect(r.x, r.y, r.w, r.h, Math.min(radius, r.w / 2, r.h / 2))
    if (fill) {
      ctx.fillStyle = fill
      ctx.fill()
    }
    if (stroke) {
      ctx.strokeStyle = stroke
      ctx.lineWidth = hair
      ctx.stroke()
    }
  }
  const dot = (x: number, y: number, r: number, fill: string, stroke: string | null = null) => {
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.fillStyle = fill
    ctx.fill()
    if (stroke) {
      ctx.strokeStyle = stroke
      ctx.lineWidth = hair
      ctx.stroke()
    }
  }
  const ellipse = (r: PRect, fill: string, stroke: string | null = null) => {
    ctx.beginPath()
    ctx.ellipse(r.x + r.w / 2, r.y + r.h / 2, r.w / 2, r.h / 2, 0, 0, Math.PI * 2)
    ctx.fillStyle = fill
    ctx.fill()
    if (stroke) {
      ctx.strokeStyle = stroke
      ctx.lineWidth = hair
      ctx.stroke()
    }
  }
  const plant = (r: PRect) => dot(r.x + r.w / 2, r.y + r.h / 2, Math.min(r.w, r.h) / 2, K.plant)

  // piso del edificio
  box({x: L.side, y: L.wallTop, w: L.wingRight - L.side, h: L.wallBottom - L.wallTop}, K.floor, null, 0)
  box(WING.juntas.room, 'rgba(150,88,47,0.07)', null, 0)
  box(WING.social.room, K.wingFloor, null, 0)

  // cubículos: tinte del color del dueño
  for (const d of DESKS) {
    const owner = deskOwner(d.num)
    box(d.cell, K.cell, null, 0)
    if (owner) box(d.cell, hexA(owner.color, K.ownerTint), null, 0)
    const t = d.tableP
    box(t, K.furn, owner ? hexA(owner.color, 0.55) : K.furnEdge, 2)
    dot(d.chairP.x, d.chairP.y, 4, K.furn, K.furnEdge)
  }
  CUBE_PLANTS.forEach(plant)
  for (const s of SHELVES) if (s) box(s, K.furn, K.furnEdge)

  // pasillo
  const {lounge, island, coffee, meeting} = CORRIDOR
  ellipse(lounge.rug, K.soft, K.hair)
  for (const c of lounge.chairs) box(c, K.furn, K.furnEdge, 3)
  box(lounge.table, K.furn, K.furnEdge, 3)
  box(lounge.shelf, K.furn, K.furnEdge)
  box(lounge.bench, K.furn, K.furnEdge, 3)
  dot(lounge.lamp.x, lounge.lamp.y + 10, 3, 'rgba(242,201,76,0.55)')
  plant({x: lounge.shelf.x + lounge.shelf.w + 2, y: lounge.shelf.y + 2, w: 9, h: 10})
  box(island.ring, K.soft, K.bronze, 10)
  box(island.desk, K.furn, K.furnEdge, 2)
  for (const s of island.stools) dot(s.x, s.y, 3.5, K.furn, K.furnEdge)
  island.plants.forEach(plant)
  box(coffee.counter, K.furn, K.furnEdge, 2)
  ellipse(meeting.rug, K.soft, K.hair)
  box(meeting.table, K.furn, K.furnEdge, 8)

  // sala de juntas
  const {juntas, social} = WING
  box(juntas.rug, K.soft, K.hair, 3)
  const tb = juntas.table
  for (let i = 0; i < 5; i++) {
    const x = tb.x + 10 + i * ((tb.w - 20) / 4)
    dot(x, tb.y - 5, 4, K.furn, K.furnEdge)
    dot(x, tb.y + tb.h + 5, 4, K.furn, K.furnEdge)
  }
  box(tb, K.furn, K.bronze, 4)
  box(juntas.tv, '#0b090e', K.bronze, 1)
  box(juntas.board, K.board, K.furnEdge, 1)
  juntas.plants.forEach(plant)

  // zona social
  box(social.rug, K.soft, K.hair, 4)
  const puffs = ['rgba(201,120,70,0.75)', 'rgba(138,107,184,0.75)', 'rgba(79,126,166,0.75)']
  social.puffs.forEach((p, i) => dot(p.x, p.y, 5, puffs[i % puffs.length]))
  box(social.bar, K.furn, K.furnEdge, 2)
  for (const s of social.stools) dot(s.x, s.y, 3.5, K.furn, K.furnEdge)
  box(social.pool, K.felt, 'rgba(150,88,47,0.9)', 3)
  for (const a of social.arcades) box(a, K.furn, 'rgba(250,70,22,0.6)', 1.5)
  box(social.kitchen, K.furn, K.furnEdge, 1)
  box(social.fridge, '#3a3440', K.furnEdge, 1.5)
  social.plants.forEach(plant)

  // paredes por encima de todo (los huecos son las puertas)
  for (const w of WALLS_ART) box(w, K.wall, null, 0)
  ctx.strokeStyle = K.wallEdge
  ctx.lineWidth = hair
  for (const w of WALLS_ART) ctx.strokeRect(w.x, w.y, w.w, w.h)

  ctx.restore()
}

function hexA(hex: string, a: number) {
  const n = parseInt(hex.slice(1), 16)
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`
}
