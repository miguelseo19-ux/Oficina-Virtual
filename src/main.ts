import './style.css'
import {deskOwner, initials, PEOPLE, personById, type Person} from './config'
import {
  collides,
  deskByNum,
  DESKS,
  LOUNGE,
  PLANTS,
  WORLD,
  zoneAt
} from './map'
import {Net, type RemotePlayer} from './net'
import {Call} from './call'

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
const LS_USER = 'ov.user'
const LS_KEY = 'ov.key'

function lsGet(k: string) {
  try {
    return localStorage.getItem(k)
  } catch {
    return null
  }
}
function lsSet(k: string, v: string | null) {
  try {
    if (v === null) localStorage.removeItem(k)
    else localStorage.setItem(k, v)
  } catch {
    /* modo privado */
  }
}

function zoneLabel(n: number) {
  const o = deskOwner(n)
  return o ? `Escritorio de ${o.name}` : `Escritorio ${n} (libre)`
}

// ─── Login ──────────────────────────────────────────────────

function setupLogin() {
  const sel = $<HTMLSelectElement>('login-user')
  for (const p of PEOPLE) {
    const o = document.createElement('option')
    o.value = p.id
    o.textContent = `${p.name} — ${p.role}`
    sel.appendChild(o)
  }
  const savedUser = lsGet(LS_USER)
  const savedKey = lsGet(LS_KEY)
  if (savedUser && personById(savedUser)) sel.value = savedUser
  if (savedKey) $<HTMLInputElement>('login-key').value = savedKey

  $<HTMLFormElement>('login-form').onsubmit = e => {
    e.preventDefault()
    const person = personById(sel.value)
    const key = $<HTMLInputElement>('login-key').value.trim()
    if (!person) return
    if (key.length < 4) {
      $('login-error').textContent = 'La clave debe tener al menos 4 caracteres.'
      return
    }
    lsSet(LS_USER, person.id)
    lsSet(LS_KEY, key)
    if ('Notification' in window && Notification.permission === 'default') {
      void Notification.requestPermission().catch(() => {})
    }
    start(person, key)
  }
}

// ─── Juego ──────────────────────────────────────────────────

function start(me: Person, key: string) {
  $('login').hidden = true
  $('app').hidden = false

  const canvas = $<HTMLCanvasElement>('world')
  const ctx = canvas.getContext('2d')!
  const myDesk = deskByNum(me.desk)
  const pos = {x: myDesk.seat.x, y: myDesk.seat.y}
  let target: {x: number; y: number} | null = null
  let walkPhase = 0
  let moving = false
  const keys = new Set<string>()

  const net = new Net(key, {
    onPlayer: (p, prevZone) => {
      if (p.zone === me.desk && prevZone !== me.desk && currentZone !== me.desk) knock(p)
      call.reconcile()
      renderRoster()
    },
    onLeave: id => {
      call.onPeerGone(id)
      renderRoster()
    },
    onStream: (stream, id) => call.onRemoteStream(stream, id),
    onError: msg => toast(msg)
  })
  const call = new Call(net, me.id, zoneLabel)
  let currentZone: number | null = null

  window.addEventListener('beforeunload', () => net.leave())

  // ── entrada ──
  const MOVE_KEYS: Record<string, [number, number]> = {
    ArrowUp: [0, -1],
    ArrowDown: [0, 1],
    ArrowLeft: [-1, 0],
    ArrowRight: [1, 0],
    w: [0, -1],
    s: [0, 1],
    a: [-1, 0],
    d: [1, 0]
  }
  const keyName = (e: KeyboardEvent) => (e.key.length === 1 ? e.key.toLowerCase() : e.key)
  window.addEventListener('keydown', e => {
    if ((e.target as HTMLElement).closest('input,select,textarea')) return
    const k = keyName(e)
    if (MOVE_KEYS[k]) {
      keys.add(k)
      target = null
      e.preventDefault()
    }
  })
  window.addEventListener('keyup', e => keys.delete(keyName(e)))
  window.addEventListener('blur', () => keys.clear())

  canvas.addEventListener('pointerdown', e => {
    const r = canvas.getBoundingClientRect()
    target = screenToWorld(e.clientX - r.left, e.clientY - r.top)
  })

  $('btn-home').onclick = () => goHome()
  $('btn-logout').onclick = () => {
    lsSet(LS_KEY, null)
    net.leave()
    location.reload()
  }
  $('me-name').textContent = me.name
  $('me-avatar').textContent = initials(me.name)
  $('me-avatar').style.background = me.color

  function goHome() {
    pos.x = myDesk.seat.x
    pos.y = myDesk.seat.y
    target = null
  }

  // ── cámara / viewport ──
  let vw = 0
  let vh = 0
  let zoom = 1
  let camX = 0
  let camY = 0
  function resize() {
    const dpr = window.devicePixelRatio || 1
    vw = canvas.clientWidth
    vh = canvas.clientHeight
    canvas.width = Math.round(vw * dpr)
    canvas.height = Math.round(vh * dpr)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    zoom = Math.min(1.15, Math.max(0.55, Math.min(vw / 1100, vh / 760)))
  }
  new ResizeObserver(resize).observe(canvas)
  resize()

  function updateCamera() {
    const viewW = vw / zoom
    const viewH = vh / zoom
    camX = viewW >= WORLD.w ? (WORLD.w - viewW) / 2 : clamp(pos.x - viewW / 2, 0, WORLD.w - viewW)
    camY = viewH >= WORLD.h ? (WORLD.h - viewH) / 2 : clamp(pos.y - viewH / 2, 0, WORLD.h - viewH)
  }
  function screenToWorld(sx: number, sy: number) {
    return {x: sx / zoom + camX, y: sy / zoom + camY}
  }

  // ── bucle ──
  const SPEED = 230
  let lastT = performance.now()
  let lastSlow = 0

  function step(now: number) {
    const dt = Math.min(0.05, (now - lastT) / 1000)
    lastT = now

    let dx = 0
    let dy = 0
    for (const k of keys) {
      dx += MOVE_KEYS[k][0]
      dy += MOVE_KEYS[k][1]
    }
    if (!dx && !dy && target) {
      const tx = target.x - pos.x
      const ty = target.y - pos.y
      const dist = Math.hypot(tx, ty)
      if (dist < 4) target = null
      else {
        dx = tx / dist
        dy = ty / dist
      }
    }
    moving = false
    if (dx || dy) {
      const len = Math.hypot(dx, dy)
      const vx = (dx / len) * SPEED * dt
      const vy = (dy / len) * SPEED * dt
      const ox = pos.x
      const oy = pos.y
      if (!collides(pos.x + vx, pos.y)) pos.x += vx
      if (!collides(pos.x, pos.y + vy)) pos.y += vy
      moving = pos.x !== ox || pos.y !== oy
      if (!moving) target = null // trabado contra algo
      if (moving) walkPhase += dt * 12
    }

    const z = zoneAt(pos.x, pos.y)
    if (z !== currentZone) {
      currentZone = z
      call.setZone(z)
      document.title = z ? '● En llamada — Oficina virtual' : 'Oficina virtual'
      renderRoster()
    }

    net.update(
      {person: me.id, x: Math.round(pos.x), y: Math.round(pos.y), zone: currentZone, mic: call.micOn, cam: call.sendingVideo},
      now
    )

    // interpolación de los demás
    const k = 1 - Math.pow(0.0001, dt)
    for (const p of net.players.values()) {
      p.rx += (p.x - p.rx) * k
      p.ry += (p.y - p.ry) * k
    }

    if (now - lastSlow > 1000) {
      lastSlow = now
      renderNetStatus()
      net.prune(now)
      call.tick()
    }

    updateCamera()
    draw(now)
    requestAnimationFrame(step)
  }

  // latido aunque la pestaña esté en segundo plano (rAF se pausa ahí)
  setInterval(() => {
    if (document.hidden) {
      const now = performance.now()
      net.update(
        {person: me.id, x: Math.round(pos.x), y: Math.round(pos.y), zone: currentZone, mic: call.micOn, cam: call.sendingVideo},
        now
      )
      net.prune(now)
      call.tick()
    }
  }, 1000)

  // ── dibujo ──
  function draw(now: number) {
    ctx.save()
    ctx.fillStyle = '#2b2f3a'
    ctx.fillRect(0, 0, vw, vh)
    ctx.scale(zoom, zoom)
    ctx.translate(-camX, -camY)

    drawFloor()

    // ocupación de cada escritorio
    const occupancy = new Map<number, number>()
    const bump = (z: number | null) => z && occupancy.set(z, (occupancy.get(z) ?? 0) + 1)
    bump(currentZone)
    for (const p of net.players.values()) bump(p.zone)

    for (const d of DESKS) drawDesk(d.num, occupancy.get(d.num) ?? 0, now)
    drawLounge()
    for (const pl of PLANTS) drawPlant(pl.x + pl.w / 2, pl.y + pl.h / 2)

    const all: {x: number; y: number; person: Person | undefined; self: boolean; moving: boolean}[] = []
    for (const p of net.players.values()) {
      all.push({
        x: p.rx,
        y: p.ry,
        person: personById(p.person),
        self: false,
        moving: Math.hypot(p.x - p.rx, p.y - p.ry) > 1
      })
    }
    all.push({x: pos.x, y: pos.y, person: me, self: true, moving})
    all.sort((a, b) => a.y - b.y)
    for (const a of all) drawAvatar(a.x, a.y, a.person, a.self, a.moving, now)

    if (target) {
      ctx.strokeStyle = 'rgba(255,255,255,.6)'
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.arc(target.x, target.y, 8, 0, Math.PI * 2)
      ctx.stroke()
    }
    ctx.restore()
  }

  function drawFloor() {
    ctx.fillStyle = '#e9dcc6'
    ctx.fillRect(0, 0, WORLD.w, WORLD.h)
    ctx.strokeStyle = 'rgba(120,90,50,.08)'
    ctx.lineWidth = 1
    for (let y = 0; y < WORLD.h; y += 32) {
      ctx.beginPath()
      ctx.moveTo(0, y)
      ctx.lineTo(WORLD.w, y)
      ctx.stroke()
    }
    // paredes
    ctx.fillStyle = '#4a4e5a'
    ctx.fillRect(0, 0, WORLD.w, 20)
    ctx.fillRect(0, WORLD.h - 20, WORLD.w, 20)
    ctx.fillRect(0, 0, 20, WORLD.h)
    ctx.fillRect(WORLD.w - 20, 0, 20, WORLD.h)
  }

  function drawDesk(n: number, people: number, now: number) {
    const d = deskByNum(n)
    const owner = deskOwner(n)
    const color = owner?.color ?? '#9aa0a6'
    const z = d.zone
    // alfombra
    roundRect(z.x, z.y, z.w, z.h, 18)
    ctx.fillStyle = hexA(color, owner ? 0.16 : 0.1)
    ctx.fill()
    ctx.lineWidth = people > 0 ? 3 + Math.sin(now / 250) * 1 : 2
    ctx.setLineDash(people > 0 ? [] : [8, 6])
    ctx.strokeStyle = hexA(color, people > 0 ? 0.9 : 0.45)
    ctx.stroke()
    ctx.setLineDash([])

    // mesa
    const t = d.table
    ctx.fillStyle = 'rgba(0,0,0,.12)'
    roundRect(t.x + 3, t.y + 5, t.w, t.h, 8)
    ctx.fill()
    ctx.fillStyle = '#a47148'
    roundRect(t.x, t.y, t.w, t.h, 8)
    ctx.fill()
    // monitor
    const mx = t.x + t.w / 2
    const my = d.top ? t.y + 16 : t.y + t.h - 16
    ctx.fillStyle = '#23262e'
    roundRect(mx - 26, my - 9, 52, 18, 3)
    ctx.fill()
    ctx.fillStyle = hexA(color, 0.85)
    ctx.fillRect(mx - 22, my - 6, 44, 12)
    // silla
    ctx.fillStyle = '#3d4250'
    ctx.beginPath()
    ctx.arc(d.chair.x, d.chair.y, 14, 0, Math.PI * 2)
    ctx.fill()

    // cartel
    const label = owner ? owner.name : `Libre · ${n}`
    const sub = owner ? owner.role : ''
    const ly = d.top ? z.y + z.h - 30 : z.y + 24
    ctx.textAlign = 'center'
    ctx.font = '600 15px system-ui, sans-serif'
    ctx.fillStyle = owner ? '#2b2f3a' : '#7a7f88'
    ctx.fillText(label, z.x + z.w / 2, ly)
    if (sub) {
      ctx.font = '12px system-ui, sans-serif'
      ctx.fillStyle = '#5f6470'
      ctx.fillText(sub, z.x + z.w / 2, ly + 16)
    }
    if (people > 0) {
      ctx.font = '600 11px system-ui, sans-serif'
      ctx.fillStyle = hexA(color, 1)
      ctx.fillText(`● ${people} en llamada`, z.x + z.w / 2, d.top ? z.y + 22 : z.y + z.h - 12)
    }
  }

  function drawLounge() {
    const l = LOUNGE
    roundRect(l.x, l.y, l.w, l.h, 40)
    ctx.fillStyle = '#c9b79c'
    ctx.fill()
    ctx.fillStyle = '#6c8ead'
    roundRect(l.x + 20, l.y + 10, l.w - 40, 22, 10)
    ctx.fill()
    ctx.fillStyle = '#8a6a4a'
    roundRect(l.x + l.w / 2 - 40, l.y + 48, 80, 34, 8)
    ctx.fill()
    ctx.textAlign = 'center'
    ctx.font = '12px system-ui, sans-serif'
    ctx.fillStyle = '#5f6470'
    ctx.fillText('Pasillo', l.x + l.w / 2, l.y + l.h + 18)
  }

  function drawPlant(x: number, y: number) {
    ctx.fillStyle = '#7b5e3b'
    ctx.beginPath()
    ctx.arc(x, y, 16, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = '#4f8a4b'
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2
      ctx.beginPath()
      ctx.arc(x + Math.cos(a) * 11, y + Math.sin(a) * 11, 11, 0, Math.PI * 2)
      ctx.fill()
    }
  }

  function drawAvatar(x: number, y: number, p: Person | undefined, self: boolean, mov: boolean, now: number) {
    const color = p?.color ?? '#888'
    const bob = mov ? Math.abs(Math.sin(self ? walkPhase : now / 80)) * 3 : 0
    ctx.fillStyle = 'rgba(0,0,0,.2)'
    ctx.beginPath()
    ctx.ellipse(x, y + 14, 14, 5, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = color
    ctx.beginPath()
    ctx.arc(x, y - bob, 16, 0, Math.PI * 2)
    ctx.fill()
    ctx.lineWidth = self ? 3 : 2
    ctx.strokeStyle = self ? '#fff' : 'rgba(255,255,255,.7)'
    ctx.stroke()
    ctx.fillStyle = '#fff'
    ctx.textAlign = 'center'
    ctx.font = '700 12px system-ui, sans-serif'
    ctx.fillText(initials(p?.name ?? '?'), x, y - bob + 4)
    // nombre
    const name = self ? `${p?.name ?? ''} (vos)` : (p?.name ?? 'Invitado')
    ctx.font = '600 12px system-ui, sans-serif'
    const w = ctx.measureText(name).width + 12
    ctx.fillStyle = 'rgba(30,32,40,.78)'
    roundRect(x - w / 2, y - bob - 42, w, 18, 9)
    ctx.fill()
    ctx.fillStyle = '#fff'
    ctx.fillText(name, x, y - bob - 29)
  }

  function roundRect(x: number, y: number, w: number, h: number, r: number) {
    ctx.beginPath()
    ctx.roundRect(x, y, w, h, r)
  }

  function renderNetStatus() {
    const {open, total} = net.relayStatus()
    const peers = net.players.size
    $('net-status').textContent =
      open === 0
        ? `🔴 Sin conexión a la red (0/${total}). Revisá internet o desactivá bloqueadores.`
        : `🟢 Red: ${open}/${total} servidores · ${peers} ${peers === 1 ? 'persona conectada' : 'personas conectadas'}`
  }

  // ── lista de presentes ──
  function renderRoster() {
    const list = $('roster')
    const online = new Map<string, RemotePlayer>()
    for (const p of net.players.values()) online.set(p.person, p)
    list.replaceChildren(
      ...PEOPLE.map(p => {
        const li = document.createElement('li')
        const isMe = p.id === me.id
        const rp = online.get(p.id)
        const here = isMe || !!rp
        const zone = isMe ? currentZone : rp?.zone
        li.className = here ? 'on' : 'off'
        const status = !here ? 'desconectado' : zone ? (zone === p.desk ? 'en su escritorio · en llamada' : `en llamada · ${zoneLabel(zone)}`) : 'conectado'
        li.innerHTML = `<span class="dot" style="background:${p.color}"></span><span class="n"></span><span class="s"></span>`
        li.querySelector('.n')!.textContent = isMe ? `${p.name} (vos)` : p.name
        li.querySelector('.s')!.textContent = status
        if (!isMe && rp) {
          li.title = `Ir a donde está ${p.name}`
          li.classList.add('click')
          li.onclick = () => {
            target = {x: rp.x, y: rp.y + 30}
          }
        }
        return li
      })
    )
  }
  renderRoster()

  // ── avisos ──
  function knock(p: RemotePlayer) {
    const who = personById(p.person)?.name ?? 'Alguien'
    beep()
    toast(`${who} está en tu escritorio`, 'Ir a mi escritorio', goHome)
    if (document.hidden && 'Notification' in window && Notification.permission === 'granted') {
      try {
        const n = new Notification('Oficina virtual', {body: `${who} está en tu escritorio`})
        n.onclick = () => {
          window.focus()
          goHome()
          n.close()
        }
      } catch {
        /* ignore */
      }
    }
  }

  requestAnimationFrame(step)
}

function toast(msg: string, action?: string, onAction?: () => void) {
  const box = $('toasts')
  const el = document.createElement('div')
  el.className = 'toast'
  const span = document.createElement('span')
  span.textContent = msg
  el.appendChild(span)
  if (action && onAction) {
    const b = document.createElement('button')
    b.textContent = action
    b.onclick = () => {
      onAction()
      el.remove()
    }
    el.appendChild(b)
  }
  box.appendChild(el)
  setTimeout(() => el.remove(), 9000)
}

let audioCtx: AudioContext | null = null
function beep() {
  try {
    audioCtx ??= new AudioContext()
    const o = audioCtx.createOscillator()
    const g = audioCtx.createGain()
    o.frequency.value = 880
    g.gain.setValueAtTime(0.0001, audioCtx.currentTime)
    g.gain.exponentialRampToValueAtTime(0.2, audioCtx.currentTime + 0.02)
    g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.4)
    o.connect(g).connect(audioCtx.destination)
    o.start()
    o.stop(audioCtx.currentTime + 0.45)
  } catch {
    /* ignore */
  }
}

function clamp(v: number, a: number, b: number) {
  return Math.max(a, Math.min(b, v))
}
function hexA(hex: string, a: number) {
  const n = parseInt(hex.slice(1), 16)
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`
}

setupLogin()
