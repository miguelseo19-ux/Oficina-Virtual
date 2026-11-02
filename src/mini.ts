import {initials, personById, type Person} from './config'
import type {Call} from './call'
import {icon} from './icons'
import {PX, WORLD} from './map'
import type {RemotePlayer, Status} from './net'
import {drawSimpleMap} from './scene/simple'
import type {Light} from './scene/sprites'

/**
 * Mini ventana (como la de Gather): una ventanita que queda flotando encima de cualquier pestaña
 * o programa mientras trabajás en otra cosa. Muestra un mini mapa con dónde está cada uno (y si
 * alguien se acerca), las caras de con quién estás en llamada y los botones de micrófono, cámara
 * y no molestar. Tu propia cámara no se muestra: en su lugar va el mapa.
 *
 * Usa Document Picture-in-Picture (Chrome y Edge). Se abre con el botón de la barra o la tecla P y
 * queda abierta hasta que la cerrás. En Chrome, además, se abre sola al cambiar de pestaña en
 * medio de una llamada (acción `enterpictureinpicture` de Media Session); esa se cierra sola al
 * volver a la pestaña de la oficina.
 */

interface DocumentPiP {
  requestWindow(opts?: {width?: number; height?: number}): Promise<Window>
}
const api = () => (window as unknown as {documentPictureInPicture?: DocumentPiP}).documentPictureInPicture
export const miniSupported = () => !!api()

export interface MiniDeps {
  me: Person
  pos: () => {x: number; y: number}
  zone: () => number | null
  status: () => Status
  meeting: () => boolean // en una reunión del calendario (se muestra "En reunión" en vez de "No molestar")
  players: () => Iterable<RemotePlayer>
  talking: () => Set<string>
  sameArea: (x: number, y: number) => boolean // mismo ambiente que yo (no a través de paredes)
  where: () => string
  light: () => Light
  talkIn: number // radio de la charla por cercanía (mundo)
  call: Call
  setBusy: (busy: boolean) => void
  onChange: (open: boolean) => void
}

const VIEW = {w: 760, h: 470} // cuánto mundo se ve en el mini mapa (unos 3 cubículos de ancho)
const NEAR_K = 2.2 // "se está acercando" = a menos de NEAR_K × el radio de charla
const STATUS_COLOR: Record<Status, string> = {available: '#3bb273', busy: '#fa4616', away: '#f2c94c'}
const STATUS_NAME: Record<Status, string> = {available: 'Disponible', busy: 'No molestar', away: 'Ausente'}
const SANS = '"Space Grotesk", system-ui, sans-serif'
const MONO = '"JetBrains Mono", ui-monospace, monospace'

export class MiniWindow {
  private win: Window | null = null
  private auto = false
  private raf = 0
  private timer = 0
  private lastT = 0
  private ctx: CanvasRenderingContext2D | null = null
  private el: {
    canvas: HTMLCanvasElement
    where: HTMLElement
    dot: HTMLElement
    alert: HTMLElement
    vids: HTMLElement
    mic: HTMLButtonElement
    cam: HTMLButtonElement
    busy: HTMLButtonElement
  } | null = null

  constructor(private d: MiniDeps) {}

  get isOpen() {
    return !!this.win
  }

  /** Abre la mini ventana. `auto`: la abrió Chrome al cambiar de pestaña (se cierra al volver). */
  async open(auto = false): Promise<boolean> {
    const pip = api()
    if (!pip) return false
    if (this.win) return true
    let win: Window
    try {
      win = await pip.requestWindow({width: 340, height: 340})
    } catch {
      return false
    }
    this.win = win
    this.auto = auto
    this.build(win)
    win.addEventListener('pagehide', () => this.cleanup())
    this.d.onChange(true)
    return true
  }

  close() {
    this.win?.close()
  }

  toggle() {
    if (this.win) this.close()
    else void this.open()
  }

  /** Volviste a la pestaña de la oficina: si la abrió Chrome solo, se cierra. */
  onTabVisible() {
    if (this.auto) this.close()
  }

  private cleanup() {
    if (this.win) {
      this.win.cancelAnimationFrame(this.raf)
      this.win.clearInterval(this.timer)
    }
    for (const v of this.el?.vids.querySelectorAll('video') ?? []) v.srcObject = null
    this.win = null
    this.el = null
    this.ctx = null
    this.d.onChange(false)
  }

  private build(win: Window) {
    const doc = win.document
    doc.title = 'Oficina virtual'
    const font = document.querySelector<HTMLLinkElement>('link[href*="fonts.googleapis.com/css2"]')
    if (font) doc.head.append(font.cloneNode() as HTMLLinkElement)
    const style = doc.createElement('style')
    style.textContent = CSS
    doc.head.append(style)
    const two = (on: string, off: string) => `<span class="i-on">${icon(on, 18)}</span><span class="i-off">${icon(off, 18)}</span>`
    doc.body.innerHTML = `
      <header>
        <span class="eyebrow">Oficina virtual</span>
        <div class="where"><i class="dot"></i><span></span></div>
        <div class="alert" hidden></div>
      </header>
      <div class="vids" hidden></div>
      <div class="map"><canvas></canvas></div>
      <footer><div class="bar">
        <button data-k="mic" title="Micrófono · M">${two('mic', 'mic-off')}</button>
        <button data-k="cam" title="Cámara · V">${two('video', 'video-off')}</button>
        <button data-k="busy" title="No molestar · B">${icon('moon', 18)}</button>
        <span class="sep"></span>
        <button data-k="back" title="Volver a la oficina">${icon('office', 18)}</button>
      </div></footer>`
    const $ = <T extends HTMLElement>(sel: string) => doc.querySelector(sel) as T
    this.el = {
      canvas: $('canvas'),
      where: $('.where span'),
      dot: $('.where .dot'),
      alert: $('.alert'),
      vids: $('.vids'),
      mic: $('[data-k=mic]'),
      cam: $('[data-k=cam]'),
      busy: $('[data-k=busy]')
    }
    this.ctx = this.el.canvas.getContext('2d')
    const {call} = this.d
    const actions: Record<string, () => void> = {
      mic: () => call.toggleMic(),
      cam: () => call.toggleCam(),
      busy: () => this.d.setBusy(this.d.status() !== 'busy'),
      back: () => {
        window.focus() // la pestaña de la oficina (Chrome la trae al frente)
        this.close()
      }
    }
    for (const b of doc.querySelectorAll<HTMLButtonElement>('button[data-k]')) {
      b.onclick = () => {
        actions[b.dataset.k!]()
        this.sync()
      }
    }
    doc.addEventListener('keydown', e => {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const k = {m: 'mic', v: 'cam', b: 'busy'}[e.key.toLowerCase()]
      if (k) {
        actions[k]()
        this.sync()
      }
    })

    this.lastT = performance.now()
    const loop = (now: number) => {
      if (!this.win) return
      const dt = Math.min(0.1, (now - this.lastT) / 1000)
      this.lastT = now
      // con la pestaña de la oficina oculta su bucle está en pausa: acá se suavizan los movimientos
      if (document.hidden) {
        const k = 1 - Math.pow(0.0001, dt)
        for (const p of this.d.players()) {
          p.rx += (p.x - p.rx) * k
          p.ry += (p.y - p.ry) * k
        }
      }
      this.drawMap(now)
      this.raf = win.requestAnimationFrame(loop)
    }
    this.raf = win.requestAnimationFrame(loop)
    this.timer = win.setInterval(() => this.sync(), 300)
    this.sync()
  }

  /** Textos, botones y videos (no hace falta en cada cuadro). */
  private sync() {
    const el = this.el
    if (!el) return
    const {call, me} = this.d
    const st = this.d.status()
    el.where.textContent = `${this.d.where()} · ${this.d.meeting() ? 'En reunión' : STATUS_NAME[st]}`
    el.dot.style.background = STATUS_COLOR[st]
    el.mic.classList.toggle('off', !call.micOn)
    el.cam.classList.toggle('off', !call.camOn)
    el.busy.classList.toggle('on', st === 'busy')

    const peers = call.peers()
    let alert = ''
    let live = false
    if (peers.length) {
      alert = `En llamada con ${list(peers.map(p => first(p.name)))}`
      live = true
    } else {
      const myZone = this.d.zone()
      const players = [...this.d.players()]
      const visitors = myZone !== me.desk ? players.filter(p => p.zone === me.desk) : []
      if (visitors.length) alert = `${list(visitors.map(nameOf))} ${visitors.length > 1 ? 'están' : 'está'} en tu escritorio`
      else {
        const near = players.filter(p => this.isNear(p))
        if (near.length) alert = `${list(near.map(nameOf))} ${near.length > 1 ? 'se están acercando' : 'se está acercando'}`
      }
    }
    el.alert.hidden = !alert
    el.alert.textContent = alert
    el.alert.classList.toggle('live', live)
    this.syncVids(peers)
  }

  /** Alguien cerca que todavía no está hablando conmigo (en el pasillo o llegando a mi cubículo). */
  private isNear(p: RemotePlayer) {
    if (this.d.talking().has(p.peerId) || p.zone !== null) return false
    const me = this.d.pos()
    if (Math.hypot(p.x - me.x, p.y - me.y) > this.d.talkIn * NEAR_K) return false
    return this.d.zone() !== null || this.d.sameArea(p.x, p.y)
  }

  private syncVids(peers: ReturnType<Call['peers']>) {
    const box = this.el!.vids
    const doc = box.ownerDocument
    box.hidden = !peers.length
    const existing = new Map<string, HTMLElement>()
    for (const t of [...box.children] as HTMLElement[]) existing.set(t.dataset.key!, t)
    for (const p of peers) {
      let t = existing.get(p.key)
      if (!t) {
        t = doc.createElement('div')
        t.className = 'vt'
        t.dataset.key = p.key
        t.innerHTML = '<div class="ph"></div><video autoplay playsinline muted></video><span class="nm"></span>'
        box.append(t)
      }
      existing.delete(p.key)
      const v = t.querySelector('video')!
      v.muted = true // el sonido ya sale de la pestaña de la oficina
      if (v.srcObject !== p.stream) {
        v.srcObject = p.stream
        if (p.stream) void v.play().catch(() => {})
      }
      const ph = t.querySelector('.ph') as HTMLElement
      ph.textContent = initials(p.name)
      ph.style.background = p.color
      t.querySelector('.nm')!.textContent = first(p.name)
      const hasVideo = p.cam && !!p.stream?.getVideoTracks().some(tr => tr.readyState === 'live')
      t.classList.toggle('novideo', !hasVideo)
      t.classList.toggle('speaking', p.speaking)
      t.classList.toggle('muted', !p.mic)
    }
    for (const t of existing.values()) {
      const v = t.querySelector('video')
      if (v) v.srcObject = null
      t.remove()
    }
  }

  // ── mini mapa ──────────────────────────────────────────────
  private drawMap(now: number) {
    const ctx = this.ctx
    const c = this.el?.canvas
    if (!ctx || !c || !this.win) return
    const dpr = this.win.devicePixelRatio || 1
    const w = c.clientWidth
    const h = c.clientHeight
    if (!w || !h) return
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
      c.width = Math.round(w * dpr)
      c.height = Math.round(h * dpr)
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.fillStyle = '#020003'
    ctx.fillRect(0, 0, w, h)

    // cámara centrada en mí, sin salirse de la oficina
    const zoom = Math.max(w / VIEW.w, h / VIEW.h)
    const me = this.d.pos()
    const vw = w / zoom
    const vh = h / zoom
    const camX = WORLD.w > vw ? clamp(me.x - vw / 2, 0, WORLD.w - vw) : (WORLD.w - vw) / 2
    const camY = WORLD.h > vh ? clamp(me.y - vh / 2, 0, WORLD.h - vh) : (WORLD.h - vh) / 2
    ctx.save()
    ctx.scale(zoom, zoom)
    ctx.translate(-camX, -camY)
    drawSimpleMap(ctx, zoom * PX, this.d.light())
    ctx.restore()
    const S = (x: number, y: number) => ({x: (x - camX) * zoom, y: (y - camY) * zoom})
    const m = S(me.x, me.y)

    // radio de charla: si alguien entra acá, empiezan a hablar
    ctx.save()
    ctx.setLineDash([3, 4])
    ctx.strokeStyle = 'rgba(250,70,22,0.45)'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.arc(m.x, m.y, this.d.talkIn * zoom, 0, Math.PI * 2)
    ctx.stroke()
    ctx.restore()

    const talking = this.d.talking()
    const pulse = 0.55 + Math.sin(now / 300) * 0.25
    const players = [...this.d.players()]
    // línea punteada con quienes estoy charlando
    ctx.save()
    ctx.strokeStyle = `rgba(250,70,22,${pulse})`
    ctx.lineWidth = 2
    ctx.setLineDash([5, 5])
    ctx.lineDashOffset = -now / 60
    for (const p of players) {
      if (!talking.has(p.peerId)) continue
      const s = S(p.rx, p.ry)
      ctx.beginPath()
      ctx.moveTo(m.x, m.y)
      ctx.lineTo(s.x, s.y)
      ctx.stroke()
    }
    ctx.restore()

    const pad = 12
    for (const p of players.sort((a, b) => a.ry - b.ry)) {
      const s = S(p.rx, p.ry)
      const off = s.x < pad || s.y < pad || s.x > w - pad || s.y > h - pad
      const x = clamp(s.x, pad, w - pad)
      const y = clamp(s.y, pad, h - pad)
      const person = personById(p.person)
      this.person(ctx, x, y, person, p.status, {off, near: this.isNear(p), talking: talking.has(p.peerId), pulse})
    }
    this.person(ctx, m.x, m.y, this.d.me, this.d.status(), {self: true, pulse})
  }

  private person(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    p: Person | undefined,
    st: Status,
    o: {self?: boolean; off?: boolean; near?: boolean; talking?: boolean; pulse: number}
  ) {
    const r = o.off ? 7 : 10
    ctx.save()
    ctx.globalAlpha = (st === 'away' ? 0.5 : 1) * (o.off ? 0.75 : 1)
    if (o.self) {
      ctx.shadowColor = 'rgba(150,88,47,0.9)'
      ctx.shadowBlur = 10
      ctx.strokeStyle = 'rgba(150,88,47,0.95)'
      ctx.lineWidth = 1.5
      ctx.beginPath()
      ctx.arc(x, y, r + 4, 0, Math.PI * 2)
      ctx.stroke()
      ctx.shadowBlur = 0
    } else if (o.near || o.talking) {
      ctx.strokeStyle = `rgba(250,70,22,${o.pulse})`
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.arc(x, y, r + 3 + (o.near ? o.pulse * 2 : 0), 0, Math.PI * 2)
      ctx.stroke()
    }
    ctx.fillStyle = p?.color ?? '#888'
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.fill()
    ctx.lineWidth = 1.5
    ctx.strokeStyle = '#020003'
    ctx.stroke()
    if (!o.off) {
      ctx.fillStyle = '#fff'
      ctx.textAlign = 'center'
      ctx.font = `700 9px ${SANS}`
      ctx.fillText(initials(p?.name ?? '?'), x, y + 3)
      // estado
      ctx.fillStyle = STATUS_COLOR[st]
      ctx.beginPath()
      ctx.arc(x + 7, y + 7, 3, 0, Math.PI * 2)
      ctx.fill()
      ctx.strokeStyle = '#020003'
      ctx.lineWidth = 1.2
      ctx.stroke()
      // nombre
      const name = (o.self ? 'Vos' : first(p?.name ?? 'Invitado')).toUpperCase()
      ctx.font = `500 8px ${MONO}`
      const tw = ctx.measureText(name).width + 10
      const ty = y - r - 17
      ctx.beginPath()
      ctx.roundRect(x - tw / 2, ty, tw, 12, 6)
      ctx.fillStyle = 'rgba(10,8,12,0.85)'
      ctx.fill()
      ctx.fillStyle = '#fff'
      ctx.fillText(name, x, ty + 8.5)
    }
    ctx.restore()
  }
}

const first = (name: string) => name.split(' ')[0]
const nameOf = (p: RemotePlayer) => first(personById(p.person)?.name ?? 'Alguien')
function list(names: string[]) {
  return names.length > 1 ? `${names.slice(0, -1).join(', ')} y ${names[names.length - 1]}` : names[0]
}
function clamp(v: number, a: number, b: number) {
  return Math.max(a, Math.min(b, v))
}

const CSS = `
*{box-sizing:border-box;margin:0}
html,body{height:100%}
body{background:#020003;color:#fff;font-family:${SANS};display:flex;flex-direction:column;overflow:hidden;user-select:none;-webkit-user-select:none}
header{padding:9px 12px 8px;display:grid;gap:3px;border-bottom:1px solid rgba(150,88,47,.35)}
.eyebrow{font:500 9px ${MONO};letter-spacing:.18em;text-transform:uppercase;color:#96582f}
.where{display:flex;align-items:center;gap:7px;font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.where .dot{width:8px;height:8px;border-radius:50%;flex:none}
.alert{font:600 9.5px ${MONO};letter-spacing:.12em;text-transform:uppercase;color:#fa4616}
.alert.live::before{content:'● '}
.alert[hidden],.vids[hidden]{display:none}
.vids{display:flex;gap:6px;padding:8px 8px 0;justify-content:center}
.vt{position:relative;flex:1 1 0;max-width:150px;aspect-ratio:4/3;border-radius:10px;overflow:hidden;background:#15111c;box-shadow:inset 0 0 0 1px rgba(255,255,255,.08)}
.vt video{width:100%;height:100%;object-fit:cover;display:block}
.vt .ph{position:absolute;inset:0;margin:auto;width:34px;height:34px;border-radius:50%;display:none;place-items:center;font-weight:700;font-size:13px}
.vt.novideo video{visibility:hidden}
.vt.novideo .ph{display:grid}
.vt .nm{position:absolute;left:5px;bottom:4px;font:500 8.5px ${MONO};letter-spacing:.1em;text-transform:uppercase;background:rgba(2,0,3,.72);padding:2px 5px;border-radius:6px}
.vt.muted .nm::after{content:' · sin mic';color:#fa4616}
.vt.speaking{box-shadow:0 0 0 2px #fa4616}
.map{flex:1;min-height:60px;position:relative}
.map canvas{position:absolute;inset:0;width:100%;height:100%;display:block}
footer{display:flex;justify-content:center;padding:8px}
.bar{display:flex;align-items:center;gap:2px;background:#fff;border-radius:999px;padding:4px;box-shadow:0 10px 26px -10px rgba(150,88,47,.6)}
button{border:0;background:none;color:rgba(2,0,3,.62);width:36px;height:36px;border-radius:999px;display:grid;place-items:center;cursor:pointer;font:inherit}
button:hover{background:rgba(2,0,3,.06);color:#020003}
button.on{background:#96582f;color:#fff}
button.off{background:rgba(250,70,22,.12);color:#fa4616}
.i-on,.i-off{display:grid}
.i-off,button.off .i-on{display:none}
button.off .i-off{display:grid}
.sep{width:1px;height:22px;background:rgba(2,0,3,.12);margin:0 3px}
`
