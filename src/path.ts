import {collides, PX, WORLD} from './map'

/**
 * Búsqueda de camino (A*) sobre una grilla armada con las mismas colisiones del mapa (map.ts),
 * para que el personaje camine hasta un punto esquivando paredes y muebles (y entrando por las
 * puertas) en vez de teletransportarse o trabarse contra un vidrio.
 */
type Pt = {x: number; y: number}

const CELL = 4 * PX // 4 píxeles de arte = 12 de mundo
const GW = Math.ceil(WORLD.w / CELL)
const GH = Math.ceil(WORLD.h / CELL)
let free: Uint8Array | null = null // 1 = el personaje entra parado en el centro de la celda

function grid(): Uint8Array {
  if (free) return free
  free = new Uint8Array(GW * GH)
  for (let j = 0; j < GH; j++) {
    for (let i = 0; i < GW; i++) free[j * GW + i] = collides((i + 0.5) * CELL, (j + 0.5) * CELL) ? 0 : 1
  }
  return free
}

const cellOf = (p: Pt) => ({i: clampI(Math.floor(p.x / CELL), GW), j: clampI(Math.floor(p.y / CELL), GH)})
const center = (k: number): Pt => ({x: ((k % GW) + 0.5) * CELL, y: (Math.floor(k / GW) + 0.5) * CELL})
function clampI(v: number, n: number) {
  return Math.max(0, Math.min(n - 1, v))
}

/** Celda libre más cercana (búsqueda en anillos), por si el punto cae sobre un mueble. */
function nearestFree(p: Pt): number | null {
  const g = grid()
  const {i, j} = cellOf(p)
  for (let r = 0; r < 12; r++) {
    let best: number | null = null
    let bestD = Infinity
    for (let dj = -r; dj <= r; dj++) {
      for (let di = -r; di <= r; di++) {
        if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue
        const ii = i + di
        const jj = j + dj
        if (ii < 0 || jj < 0 || ii >= GW || jj >= GH || !g[jj * GW + ii]) continue
        const c = center(jj * GW + ii)
        const d = Math.hypot(c.x - p.x, c.y - p.y)
        if (d < bestD) {
          bestD = d
          best = jj * GW + ii
        }
      }
    }
    if (best !== null) return best
  }
  return null
}

/** ¿Se puede ir en línea recta de a a b sin chocar? (muestrea cada pocos píxeles) */
function clear(a: Pt, b: Pt): boolean {
  const d = Math.hypot(b.x - a.x, b.y - a.y)
  const n = Math.ceil(d / 6)
  for (let s = 1; s <= n; s++) {
    if (collides(a.x + ((b.x - a.x) * s) / n, a.y + ((b.y - a.y) * s) / n)) return false
  }
  return true
}

/**
 * Camino de `from` a `to` como lista de puntos (sin incluir `from`), o null si no hay forma de
 * llegar. Si `to` cae sobre un mueble, termina en el lugar libre más cercano.
 */
export function findPath(from: Pt, to: Pt): Pt[] | null {
  const g = grid()
  const start = nearestFree(from)
  const goal = nearestFree(to)
  if (start === null || goal === null) return null
  const goalPt = collides(to.x, to.y) ? center(goal) : to
  if (clear(from, goalPt)) return [goalPt]

  // A* con 8 direcciones (en diagonal solo si los dos lados están libres)
  const n = GW * GH
  const gScore = new Float32Array(n).fill(Infinity)
  const came = new Int32Array(n).fill(-1)
  const closed = new Uint8Array(n)
  const gi = goal % GW
  const gj = Math.floor(goal / GW)
  const h = (k: number) => {
    const dx = Math.abs((k % GW) - gi)
    const dy = Math.abs(Math.floor(k / GW) - gj)
    return dx + dy + (Math.SQRT2 - 2) * Math.min(dx, dy)
  }
  const heap = new Heap()
  gScore[start] = 0
  heap.push(start, h(start))
  let found = false
  while (heap.size) {
    const k = heap.pop()
    if (k === goal) {
      found = true
      break
    }
    if (closed[k]) continue
    closed[k] = 1
    const ki = k % GW
    const kj = Math.floor(k / GW)
    for (let dj = -1; dj <= 1; dj++) {
      for (let di = -1; di <= 1; di++) {
        if (!di && !dj) continue
        const ii = ki + di
        const jj = kj + dj
        if (ii < 0 || jj < 0 || ii >= GW || jj >= GH) continue
        const nk = jj * GW + ii
        if (!g[nk] || closed[nk]) continue
        if (di && dj && (!g[kj * GW + ii] || !g[jj * GW + ki])) continue // no cortar esquinas
        const cost = gScore[k] + (di && dj ? Math.SQRT2 : 1)
        if (cost < gScore[nk]) {
          gScore[nk] = cost
          came[nk] = k
          heap.push(nk, cost + h(nk))
        }
      }
    }
  }
  if (!found) return null

  const cells: Pt[] = []
  for (let k = goal; k !== start && k !== -1; k = came[k]) cells.push(center(k))
  cells.reverse()
  cells[cells.length - 1] = goalPt

  // Suavizado: desde cada punto, saltar al más lejano que se vea en línea recta
  const out: Pt[] = []
  let at = from
  let idx = 0
  while (idx < cells.length) {
    let far = idx
    for (let t = cells.length - 1; t > idx; t--) {
      if (clear(at, cells[t])) {
        far = t
        break
      }
    }
    at = cells[far]
    out.push(at)
    idx = far + 1
  }
  return out
}

/** Montículo binario mínimo (prioridad → celda). */
class Heap {
  private k: number[] = []
  private p: number[] = []
  get size() {
    return this.k.length
  }
  push(key: number, pri: number) {
    const {k, p} = this
    let i = k.length
    k.push(key)
    p.push(pri)
    while (i > 0) {
      const up = (i - 1) >> 1
      if (p[up] <= p[i]) break
      ;[k[up], k[i]] = [k[i], k[up]]
      ;[p[up], p[i]] = [p[i], p[up]]
      i = up
    }
  }
  pop(): number {
    const {k, p} = this
    const top = k[0]
    const lk = k.pop()!
    const lp = p.pop()!
    if (k.length) {
      k[0] = lk
      p[0] = lp
      let i = 0
      for (;;) {
        const l = 2 * i + 1
        const r = l + 1
        let m = i
        if (l < k.length && p[l] < p[m]) m = l
        if (r < k.length && p[r] < p[m]) m = r
        if (m === i) break
        ;[k[m], k[i]] = [k[i], k[m]]
        ;[p[m], p[i]] = [p[i], p[m]]
        i = m
      }
    }
    return top
  }
}
