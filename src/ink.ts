import {personById} from './config'
import {icon} from './icons'
import type {Net} from './net'

/**
 * Anotar sobre una pantalla compartida (como "Anotar" en Zoom).
 *
 * - Cualquiera de la llamada toca "Anotar" en el cuadro de una pantalla y dibuja encima: lápiz
 *   (queda hasta que se borra) o puntero láser (se desvanece solo). Todos ven los trazos en vivo,
 *   cada uno con su color y su nombre en la punta mientras dibuja.
 * - Quien comparte ve su propia pantalla en la llamada ("Tu pantalla") con las anotaciones: el
 *   navegador no puede dibujar sobre su pantalla real.
 * - Los puntos se guardan relativos a la imagen compartida (0..1, sin las franjas negras), así
 *   coinciden aunque cada uno la vea de otro tamaño.
 * - Los trazos se identifican con el id de la transmisión de la pantalla (es el mismo para todos):
 *   al dejar de compartir y volver a compartir, se empieza de cero. Viajan por la acción 'ink' a
 *   los de la llamada; quien llega tarde los pide ('hi'). No se guardan.
 */

type Mode = 'pen' | 'laser'

interface Stroke {
  id: string
  by: string // peerId del autor
  c: string
  w: number // grosor relativo al ancho de la imagen
  m: Mode
  pts: number[] // x, y, x, y… (0..1)
  t: number // última vez que creció (performance.now)
  done: boolean
}

type Msg =
  | {k: 'pts'; sid: string; id: string; c: string; w: number; m: Mode; pts: number[]}
  | {k: 'end'; sid: string; id: string}
  | {k: 'undo'; sid: string; id: string}
  | {k: 'clear'; sid: string; all: boolean}
  | {k: 'hi'; sid: string}
  | {k: 'all'; sid: string; strokes: Omit<Stroke, 't'>[]}

interface Surface {
  sid: string
  owner: string // peerId de quien comparte
  tile: HTMLElement
  video: HTMLVideoElement
  canvas: HTMLCanvasElement
  btn: HTMLButtonElement
}

const PALETTE = ['#fa4616', '#f2c94c', '#3bb273', '#2d9cdb', '#ffffff']
const PEN_W = 0.0045
const LASER_W = 0.006
const LASER_HOLD_MS = 900
const LASER_FADE_MS = 700
const SEND_EVERY_MS = 40
const MAX_STROKES = 1500
const MAX_POINTS = 4000

const isColor = (c: unknown): c is string => typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c)
const clamp01 = (v: number) => Math.min(1, Math.max(0, v))

/** Dónde queda la imagen dentro del cuadro (el video se ve entero, con franjas si hace falta). */
function contentRect(video: HTMLVideoElement, w: number, h: number) {
  const vw = video.videoWidth
  const vh = video.videoHeight
  if (!vw || !vh) return {x: 0, y: 0, w, h}
  const s = Math.min(w / vw, h / vh)
  return {x: (w - vw * s) / 2, y: (h - vh * s) / 2, w: vw * s, h: vh * s}
}

export class Ink {
  private strokes = new Map<string, Map<string, Stroke>>() // sid → (autor:id → trazo)
  private surfaces = new Map<HTMLElement, Surface>()
  private asked = new Set<string>()
  private active: Surface | null = null // dónde estoy anotando
  private mode: Mode = 'pen'
  private color: string
  private drawing: Stroke | null = null
  private pending: number[] = []
  private sendTimer: number | null = null
  private seq = 0
  private mine: string[] = [] // mis trazos (para deshacer), del más viejo al más nuevo
  private raf = 0
  private send: (m: Msg, opts?: {target?: string | string[]}) => Promise<unknown>
  private bar: HTMLElement

  constructor(
    private net: Net,
    me: string,
    private members: () => Set<string>,
    private h: {onInkOnMine: (peerId: string) => void; wantBig: () => void}
  ) {
    this.color = personById(me)?.color ?? PALETTE[0]
    const action = net.room.makeAction('ink') as unknown as {
      send: (m: Msg, opts?: {target?: string | string[]}) => Promise<unknown>
      onMessage: ((m: Msg, ctx: {peerId: string}) => void) | null
    }
    this.send = (m, opts) => action.send(m, opts)
    action.onMessage = (m, {peerId}) => this.receive(m, peerId)
    this.bar = this.buildBar()
  }

  // ── cuadros de pantalla ──

  /** Prepara (o actualiza) la capa de anotaciones de un cuadro de pantalla compartida. */
  attach(tile: HTMLElement, sid: string, video: HTMLVideoElement, owner: string) {
    let s = this.surfaces.get(tile)
    if (!s) {
      const canvas = document.createElement('canvas')
      canvas.className = 'ink'
      const btn = document.createElement('button')
      btn.className = 'tile-ink'
      btn.innerHTML = `${icon('pen', 15)}<span>Anotar</span>`
      btn.title = 'Dibujar sobre esta pantalla (lo ven todos)'
      tile.append(canvas, btn)
      s = {sid, owner, tile, video, canvas, btn}
      this.surfaces.set(tile, s)
      const surf = s
      btn.onclick = () => (this.active === surf ? this.stop() : this.start(surf))
      canvas.addEventListener('pointerdown', e => this.down(surf, e))
      canvas.addEventListener('pointermove', e => this.move(surf, e))
      canvas.addEventListener('pointerup', () => this.up())
      canvas.addEventListener('pointercancel', () => this.up())
      video.addEventListener('resize', () => this.paint())
    }
    if (s.sid !== sid) {
      if (this.active === s) this.stop()
      s.sid = sid
    }
    s.owner = owner
    s.video = video
    // quien llega tarde pide lo que ya está dibujado
    if (!this.asked.has(sid)) {
      this.asked.add(sid)
      const target = [...this.members()]
      if (target.length) void this.send({k: 'hi', sid}, {target})
    }
    this.paint()
  }

  detach(tile: HTMLElement) {
    const s = this.surfaces.get(tile)
    if (!s) return
    if (this.active === s) this.stop()
    s.canvas.remove()
    s.btn.remove()
    this.surfaces.delete(tile)
  }

  /** Olvida las anotaciones de pantallas que ya no se comparten. */
  prune(live: Set<string>) {
    for (const sid of [...this.strokes.keys()]) if (!live.has(sid)) this.strokes.delete(sid)
    for (const sid of [...this.asked]) if (!live.has(sid)) this.asked.delete(sid)
  }

  // ── anotar ──

  private start(s: Surface) {
    if (this.active) this.stop()
    this.active = s
    s.tile.classList.add('inking')
    s.btn.classList.add('on')
    s.btn.querySelector('span')!.textContent = 'Listo'
    s.tile.append(this.bar)
    this.renderBar()
    this.h.wantBig()
  }

  stop() {
    const s = this.active
    if (!s) return
    this.up()
    this.active = null
    s.tile.classList.remove('inking')
    s.btn.classList.remove('on')
    s.btn.querySelector('span')!.textContent = 'Anotar'
    this.bar.remove()
  }

  get annotating() {
    return !!this.active
  }

  private point(s: Surface, e: PointerEvent): [number, number] {
    const r = s.canvas.getBoundingClientRect()
    const c = contentRect(s.video, r.width, r.height)
    return [clamp01((e.clientX - r.left - c.x) / c.w), clamp01((e.clientY - r.top - c.y) / c.h)]
  }

  private down(s: Surface, e: PointerEvent) {
    if (this.active !== s || e.button !== 0) return
    e.preventDefault()
    s.canvas.setPointerCapture(e.pointerId)
    const [x, y] = this.point(s, e)
    const st: Stroke = {
      id: `${++this.seq}`,
      by: this.net.selfId,
      c: this.color,
      w: this.mode === 'laser' ? LASER_W : PEN_W,
      m: this.mode,
      pts: [x, y],
      t: performance.now(),
      done: false
    }
    this.drawing = st
    this.store(s.sid, st)
    if (st.m === 'pen') this.mine.push(st.id)
    this.pending = [x, y]
    this.queue()
    this.paint()
  }

  private move(s: Surface, e: PointerEvent) {
    const st = this.drawing
    if (!st || this.active !== s || st.pts.length >= MAX_POINTS * 2) return
    const [x, y] = this.point(s, e)
    const n = st.pts.length
    if (Math.hypot(x - st.pts[n - 2], y - st.pts[n - 1]) < 0.0015) return
    st.pts.push(x, y)
    st.t = performance.now()
    this.pending.push(x, y)
    this.queue()
    this.paint()
  }

  private up() {
    const st = this.drawing
    if (!st || !this.active) return
    this.flush() // lo que quedaba del trazo, antes de soltarlo
    this.drawing = null
    st.done = true
    st.t = performance.now()
    this.broadcast({k: 'end', sid: this.active.sid, id: st.id})
    this.paint()
  }

  private queue() {
    this.sendTimer ??= window.setTimeout(() => this.flush(), SEND_EVERY_MS)
  }

  private flush() {
    if (this.sendTimer !== null) clearTimeout(this.sendTimer)
    this.sendTimer = null
    const st = this.drawing
    if (!st || !this.active || !this.pending.length) return
    const pts = this.pending.map(v => Math.round(v * 10000) / 10000)
    this.pending = []
    this.broadcast({k: 'pts', sid: this.active.sid, id: st.id, c: st.c, w: st.w, m: st.m, pts})
  }

  private broadcast(m: Msg) {
    const target = [...this.members()]
    if (target.length) void this.send(m, {target})
  }

  private undo() {
    const s = this.active
    if (!s) return
    const map = this.strokes.get(s.sid)
    while (this.mine.length) {
      const id = this.mine.pop()!
      if (map?.delete(`${this.net.selfId}:${id}`)) {
        this.broadcast({k: 'undo', sid: s.sid, id})
        break
      }
    }
    this.paint()
  }

  private clear(all: boolean) {
    const s = this.active
    if (!s) return
    this.wipe(s.sid, all ? null : this.net.selfId)
    this.mine = []
    this.broadcast({k: 'clear', sid: s.sid, all})
    this.paint()
  }

  private wipe(sid: string, by: string | null) {
    const map = this.strokes.get(sid)
    if (!map) return
    for (const [k, st] of map) if (by === null || st.by === by) map.delete(k)
  }

  private store(sid: string, st: Stroke) {
    let map = this.strokes.get(sid)
    if (!map) this.strokes.set(sid, (map = new Map()))
    if (map.size >= MAX_STROKES && !map.has(`${st.by}:${st.id}`)) return
    map.set(`${st.by}:${st.id}`, st)
  }

  // ── red ──

  private receive(m: Msg, peerId: string) {
    if (!m || typeof m !== 'object' || typeof m.sid !== 'string' || !this.members().has(peerId)) return
    const map = this.strokes.get(m.sid)
    const owner = [...this.surfaces.values()].find(s => s.sid === m.sid)?.owner
    if (m.k === 'pts') {
      if (!Array.isArray(m.pts) || m.pts.length > 2000 || !m.pts.every(Number.isFinite) || typeof m.id !== 'string') return
      if (!isColor(m.c) || (m.m !== 'pen' && m.m !== 'laser')) return
      const key = `${peerId}:${m.id}`
      let st = map?.get(key)
      if (!st) {
        st = {id: m.id, by: peerId, c: m.c, w: Math.min(0.03, Math.max(0.001, Number(m.w) || PEN_W)), m: m.m, pts: [], t: 0, done: false}
        this.store(m.sid, st)
        if (owner === this.net.selfId) this.h.onInkOnMine(peerId)
      }
      if (st.pts.length < MAX_POINTS * 2) st.pts.push(...m.pts.map(clamp01))
      st.t = performance.now()
    } else if (m.k === 'end') {
      const st = map?.get(`${peerId}:${m.id}`)
      if (st) {
        st.done = true
        st.t = performance.now()
      }
    } else if (m.k === 'undo') {
      map?.delete(`${peerId}:${m.id}`)
    } else if (m.k === 'clear') {
      // borrar todo solo lo puede quien comparte; si no, se borra lo de quien lo pidió
      this.wipe(m.sid, m.all && peerId === owner ? null : peerId)
    } else if (m.k === 'hi') {
      const mine = [...(map?.values() ?? [])].filter(s => s.m === 'pen' && s.by === this.net.selfId)
      if (mine.length) void this.send({k: 'all', sid: m.sid, strokes: mine.map(({t: _t, ...s}) => s)}, {target: peerId})
    } else if (m.k === 'all' && Array.isArray(m.strokes)) {
      for (const s of m.strokes.slice(0, MAX_STROKES)) {
        if (!s || typeof s.id !== 'string' || !isColor(s.c) || !Array.isArray(s.pts) || !s.pts.every(Number.isFinite)) continue
        // cada uno manda lo suyo: el autor es quien lo manda
        this.store(m.sid, {id: s.id, by: peerId, c: s.c, w: Math.min(0.03, Math.max(0.001, Number(s.w) || PEN_W)), m: 'pen', pts: s.pts.slice(0, MAX_POINTS * 2).map(clamp01), t: performance.now(), done: true})
      }
    }
    this.paint()
  }

  // ── dibujo ──

  private paint() {
    if (!this.raf) this.raf = requestAnimationFrame(() => this.frame())
  }

  private frame() {
    this.raf = 0
    const now = performance.now()
    let animate = false
    for (const s of this.surfaces.values()) {
      const map = this.strokes.get(s.sid)
      const cv = s.canvas
      const dpr = window.devicePixelRatio || 1
      const w = cv.clientWidth
      const h = cv.clientHeight
      if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
        cv.width = Math.round(w * dpr)
        cv.height = Math.round(h * dpr)
      }
      const g = cv.getContext('2d')!
      g.setTransform(dpr, 0, 0, dpr, 0, 0)
      g.clearRect(0, 0, w, h)
      if (!map?.size || !w || !h) continue
      const r = contentRect(s.video, w, h)
      for (const [key, st] of map) {
        let alpha = 1
        if (st.m === 'laser') {
          const age = st.done ? now - st.t : 0
          if (age > LASER_HOLD_MS + LASER_FADE_MS) {
            map.delete(key)
            continue
          }
          alpha = age > LASER_HOLD_MS ? 1 - (age - LASER_HOLD_MS) / LASER_FADE_MS : 1
          animate = true
        }
        this.stroke(g, st, r, alpha)
        // nombre en la punta mientras alguien (otro) dibuja
        if (st.by !== this.net.selfId && now - st.t < 1500 && st.pts.length >= 2) {
          animate = true
          this.tag(g, st, r, Math.min(1, (1500 - (now - st.t)) / 400))
        }
      }
    }
    if (animate) this.paint()
  }

  private stroke(g: CanvasRenderingContext2D, st: Stroke, r: {x: number; y: number; w: number; h: number}, alpha: number) {
    const p = st.pts
    if (p.length < 2) return
    const X = (i: number) => r.x + p[i] * r.w
    const Y = (i: number) => r.y + p[i + 1] * r.h
    g.save()
    g.globalAlpha = alpha
    g.lineCap = 'round'
    g.lineJoin = 'round'
    g.strokeStyle = st.c
    g.lineWidth = Math.max(2, st.w * r.w)
    if (st.m === 'laser') {
      g.shadowColor = st.c
      g.shadowBlur = 14
    }
    g.beginPath()
    g.moveTo(X(0), Y(0))
    if (p.length === 2) g.lineTo(X(0) + 0.01, Y(0))
    for (let i = 2; i < p.length - 2; i += 2) {
      // curva suave por los puntos medios
      g.quadraticCurveTo(X(i), Y(i), (X(i) + X(i + 2)) / 2, (Y(i) + Y(i + 2)) / 2)
    }
    if (p.length > 2) g.lineTo(X(p.length - 2), Y(p.length - 2))
    g.stroke()
    g.restore()
  }

  private tag(g: CanvasRenderingContext2D, st: Stroke, r: {x: number; y: number; w: number; h: number}, alpha: number) {
    const person = personById(this.net.players.get(st.by)?.person ?? '')
    const name = person?.name.split(' ')[0] ?? 'Invitado'
    const x = r.x + st.pts[st.pts.length - 2] * r.w + 10
    const y = r.y + st.pts[st.pts.length - 1] * r.h + 10
    g.save()
    g.globalAlpha = alpha
    g.font = '600 11px "Space Grotesk", system-ui, sans-serif'
    const tw = g.measureText(name).width
    g.fillStyle = st.c
    g.beginPath()
    g.roundRect(x, y, tw + 12, 18, 9)
    g.fill()
    g.fillStyle = st.c.toLowerCase() === '#ffffff' || st.c.toLowerCase() === '#f2c94c' ? '#020003' : '#ffffff'
    g.fillText(name, x + 6, y + 13)
    g.restore()
  }

  // ── barra de herramientas (una sola, va al cuadro donde estoy anotando) ──

  private buildBar() {
    const bar = document.createElement('div')
    bar.className = 'ink-bar'
    const mine = this.color
    const colors = [mine, ...PALETTE.filter(c => c.toLowerCase() !== mine.toLowerCase())].slice(0, 5)
    bar.innerHTML =
      colors.map(c => `<button class="ink-color" data-color="${c}" style="--c:${c}" title="Color"></button>`).join('') +
      `<span class="ink-sep"></span>
       <button class="ink-tool" data-mode="pen" title="Lápiz: queda hasta que se borra">${icon('pen', 16)}</button>
       <button class="ink-tool" data-mode="laser" title="Puntero láser: se borra solo">${icon('locate', 16)}</button>
       <span class="ink-sep"></span>
       <button class="ink-act" data-act="undo" title="Deshacer mi último trazo">${icon('undo', 16)}</button>
       <button class="ink-act" data-act="mine" title="Borrar mis trazos">${icon('eraser', 16)}</button>
       <button class="ink-act" data-act="all" title="Borrar todo (solo quien comparte)">${icon('trash', 16)}</button>`
    bar.addEventListener('pointerdown', e => e.stopPropagation())
    for (const b of bar.querySelectorAll<HTMLButtonElement>('.ink-color')) {
      b.onclick = () => {
        this.color = b.dataset.color!
        this.renderBar()
      }
    }
    for (const b of bar.querySelectorAll<HTMLButtonElement>('.ink-tool')) {
      b.onclick = () => {
        this.mode = b.dataset.mode as Mode
        this.renderBar()
      }
    }
    bar.querySelector<HTMLButtonElement>('[data-act=undo]')!.onclick = () => this.undo()
    bar.querySelector<HTMLButtonElement>('[data-act=mine]')!.onclick = () => this.clear(false)
    bar.querySelector<HTMLButtonElement>('[data-act=all]')!.onclick = () => this.clear(true)
    return bar
  }

  private renderBar() {
    for (const b of this.bar.querySelectorAll<HTMLButtonElement>('.ink-color')) b.classList.toggle('sel', b.dataset.color === this.color)
    for (const b of this.bar.querySelectorAll<HTMLButtonElement>('.ink-tool')) b.classList.toggle('sel', b.dataset.mode === this.mode)
    this.bar.querySelector<HTMLButtonElement>('[data-act=all]')!.hidden = this.active?.owner !== this.net.selfId
    if (this.active) this.active.canvas.dataset.mode = this.mode
  }
}
