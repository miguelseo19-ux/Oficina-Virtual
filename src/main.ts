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
import {Net, type RemotePlayer, type Status} from './net'
import {Call} from './call'
import {Chat} from './chat'

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
const LS_USER = 'ov.user'
const LS_KEY = 'ov.key'
const AWAY_AFTER_MS = 10 * 60 * 1000 // 10 minutos sin actividad → ausente
const NEAR_RADIUS = 200

const STATUS_LABEL: Record<Status, string> = {
  available: 'disponible',
  busy: 'ocupado (no molestar)',
  away: 'ausente'
}
const STATUS_COLOR: Record<Status, string> = {available: '#3bb273', busy: '#e5484d', away: '#f2c94c'}

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

  // ── estado (disponible / ocupado / ausente) ──
  const LS_STATUS = `ov.status.${me.id}`
  let manualStatus: Status = (lsGet(LS_STATUS) as Status) || 'available'
  if (!(manualStatus in STATUS_LABEL)) manualStatus = 'available'
  let lastActivity = Date.now()
  let status: Status = manualStatus
  function renderStatusUI() {
    $('me-dot').style.background = STATUS_COLOR[status]
    $('pill-me').title = `Tu estado: ${STATUS_LABEL[status]} (B)`
    for (const b of document.querySelectorAll<HTMLButtonElement>('#status-menu [data-status]')) {
      b.classList.toggle('sel', b.dataset.status === manualStatus)
    }
  }
  for (const b of document.querySelectorAll<HTMLButtonElement>('#status-menu [data-status]')) {
    b.onclick = () => {
      setManualStatus(b.dataset.status as Status)
      openMenu(null)
    }
  }
  const markActive = () => {
    lastActivity = Date.now()
    if (status === 'away' && manualStatus === 'available') refreshStatus()
  }
  for (const ev of ['keydown', 'pointerdown', 'pointermove', 'wheel']) {
    window.addEventListener(ev, markActive, {passive: true})
  }
  document.addEventListener('visibilitychange', () => !document.hidden && markActive())

  function computeStatus(): Status {
    if (manualStatus !== 'available') return manualStatus
    const inConversation = currentZone !== null && call?.active && !$('call').hidden
    if (!inConversation && Date.now() - lastActivity > AWAY_AFTER_MS) return 'away'
    return 'available'
  }
  function refreshStatus() {
    const next = computeStatus()
    if (next === status) return
    status = next
    renderStatusUI()
    call.reconcile()
    renderRoster()
  }

  const net = new Net(key, {
    onPlayer: (p, prevZone) => {
      if (p.zone === me.desk && prevZone !== me.desk && currentZone !== me.desk) knock(p)
      trackPresence()
      call.reconcile()
      renderRoster()
      chat.refresh()
    },
    onLeave: id => {
      call.onPeerGone(id)
      trackPresence()
      renderRoster()
      chat.refresh()
    },
    onStream: (stream, id) => call.onRemoteStream(stream, id),
    onError: msg => toast(msg),
    onChat: m => chat.receive(m),
    onWave: from => receiveWave(from),
    onReact: (from, emoji) => reactions.set(from, {emoji, start: performance.now()})
  })
  let currentZone: number | null = null
  const call = new Call(net, me.id, zoneLabel, () => status)

  // burbujas de chat "cerca" sobre los personajes
  const bubbles = new Map<string, {text: string; until: number}>()
  const chat = new Chat(me, net, {
    nearbyPeers: () =>
      [...net.players.values()]
        .filter(p => (currentZone !== null && p.zone === currentZone) || Math.hypot(p.x - pos.x, p.y - pos.y) < NEAR_RADIUS)
        .map(p => p.peerId),
    onNearbyMessage: (from, text) => bubbles.set(from, {text, until: performance.now() + 6000}),
    onDirectMessage: (from, text, open) => {
      if (status !== 'busy') beep(660)
      const short = text.length > 80 ? text.slice(0, 80) + '…' : text
      toast(`💬 ${from.name}: ${short}`, [{label: 'Responder', fn: open}])
      notify(`💬 ${from.name}`, text, open)
      addActivity('💬', `${from.name}: ${short}`, open, true)
    },
    onCommand: text => runCommand(text),
    onOpen: () => setView('chat'),
    onClose: () => view === 'chat' && setView(null)
  })

  // ── panel lateral (pestañas de la barra de íconos) ──
  type View = 'chat' | 'team' | 'activity' | 'calendar' | 'shortcuts' | 'settings'
  const VIEW_TITLE: Record<View, string> = {
    chat: '💬 Chat',
    team: '👥 Equipo',
    activity: '🔔 Actividad',
    calendar: '📅 Calendario',
    shortcuts: '⌨️ Atajos y comandos',
    settings: '⚙️ Ajustes'
  }
  let view: View | null = null
  /** null = Oficina (panel encogido, solo el mapa). */
  function setView(v: View | null) {
    view = v
    $('side').hidden = v === null
    for (const id of Object.keys(VIEW_TITLE) as View[]) {
      if (id === 'chat') {
        if (v !== 'chat') chat.hide()
      } else $(id).hidden = id !== v
    }
    if (v) $('side-title').textContent = VIEW_TITLE[v]
    for (const b of document.querySelectorAll<HTMLButtonElement>('.rail-btn')) {
      b.classList.toggle('active', (b.dataset.view === 'office' && v === null) || b.dataset.view === v)
    }
    if (v === 'activity') markActivityRead()
    if (v === 'team') renderRoster()
  }
  function toggleView(v: View) {
    if (view === v) return setView(null)
    if (v === 'chat') chat.open()
    else setView(v)
  }
  for (const b of document.querySelectorAll<HTMLButtonElement>('.rail-btn')) {
    b.onclick = () => (b.dataset.view === 'office' ? setView(null) : toggleView(b.dataset.view as View))
  }
  $('side-collapse').onclick = () => setView(null)

  // ── menús de la burbuja (estado / reacciones / dispositivos) ──
  const MENUS = ['status-menu', 'react-menu', 'devices']
  function openMenu(id: string | null) {
    for (const m of MENUS) $(m).hidden = m !== id
    $('btn-react').classList.toggle('on', id === 'react-menu')
  }
  const toggleMenu = (id: string) => openMenu($(id).hidden ? id : null)
  document.addEventListener('ov:menu', e => openMenu((e as CustomEvent<string | null>).detail))
  document.addEventListener('pointerdown', e => {
    if (!(e.target as HTMLElement).closest('#pill-wrap')) openMenu(null)
  })
  $('pill-me').onclick = () => toggleMenu('status-menu')
  $('btn-react').onclick = () => toggleMenu('react-menu')
  $('btn-nearby').onclick = () => chat.open('nearby')
  $('btn-screen').onclick = () => {
    if ($('call').hidden) toast('Para compartir pantalla, entrá a una llamada (alfombra de un escritorio).')
    else void call.toggleScreen()
  }
  $('btn-open-devices').onclick = () => call.openDevices(true)

  // ── reacciones ──
  const REACTIONS = ['👋', '👍', '❤️', '😂', '🎉', '✋']
  const reactions = new Map<string, {emoji: string; start: number}>()
  function react(emoji: string) {
    reactions.set(me.id, {emoji, start: performance.now()})
    net.sendReact(me.id, emoji)
  }
  $('react-menu').replaceChildren(
    ...REACTIONS.map((r, i) => {
      const b = document.createElement('button')
      b.textContent = r
      b.title = `Tecla ${i + 1}`
      b.onclick = () => {
        react(r)
        openMenu(null)
      }
      return b
    })
  )

  // ── actividad ──
  type Act = {icon: string; text: string; ts: number; action?: () => void; unread: boolean}
  const activity: Act[] = []
  let knownOnline = new Set<string>()
  let presenceReady = false
  setTimeout(() => (presenceReady = true), 4000) // no anunciar a los que ya estaban al entrar
  function addActivity(icon: string, text: string, action?: () => void, important = false) {
    activity.unshift({icon, text, ts: Date.now(), action, unread: important && view !== 'activity'})
    if (activity.length > 60) activity.length = 60
    renderActivity()
  }
  function markActivityRead() {
    for (const a of activity) a.unread = false
    renderActivity()
  }
  function renderActivity() {
    const n = activity.filter(a => a.unread).length
    $('activity-badge').hidden = n === 0
    $('activity-badge').textContent = String(n)
    const list = $('activity-list')
    if (!activity.length) {
      list.innerHTML = '<li class="empty" style="display:block">Acá vas a ver saludos, mensajes y quién pasó por tu escritorio.</li>'
      return
    }
    list.replaceChildren(
      ...activity.map(a => {
        const li = document.createElement('li')
        if (a.unread) li.classList.add('unread')
        li.innerHTML = '<span class="ic"></span><div><div class="t"></div><div class="w"></div></div>'
        li.querySelector('.ic')!.textContent = a.icon
        li.querySelector('.t')!.textContent = a.text
        const d = new Date(a.ts)
        li.querySelector('.w')!.textContent = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
        if (a.action) {
          li.classList.add('click')
          li.onclick = a.action
        }
        return li
      })
    )
  }
  renderActivity()
  function trackPresence() {
    const now = new Set([...net.players.values()].map(p => p.person))
    if (presenceReady) {
      for (const id of now) {
        if (!knownOnline.has(id)) {
          const p = personById(id)
          if (p) addActivity('🟢', `${p.name} se conectó`, () => goTo(id))
        }
      }
      for (const id of knownOnline) {
        if (!now.has(id)) {
          const p = personById(id)
          if (p) addActivity('⚪', `${p.name} se desconectó`)
        }
      }
    }
    knownOnline = now
  }

  function setManualStatus(st: Status) {
    manualStatus = st
    lsSet(LS_STATUS, st)
    lastActivity = Date.now()
    refreshStatus()
  }

  // ── comandos del chat ("/ir migue", "/ocupado"…) ──
  const norm = (t: string) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()
  function findPerson(q: string): Person | undefined {
    const n = norm(q)
    if (!n) return undefined
    const others = PEOPLE.filter(p => p.id !== me.id)
    return (
      others.find(p => norm(p.name) === n) ??
      others.find(p => norm(p.name).split(/\s+/).some(w => w.startsWith(n))) ??
      others.find(p => norm(p.name).includes(n))
    )
  }
  function runCommand(raw: string) {
    const [cmdRaw, ...rest] = raw.slice(1).split(/\s+/)
    const cmd = norm(cmdRaw)
    const needPerson = (fn: (p: Person) => void) => {
      const p = findPerson(rest[0] ?? '')
      if (!p) return toast(rest[0] ? `No encontré a "${rest[0]}"` : 'Falta el nombre. Ej: /ir migue')
      if (!net.peersOf(p.id).length) return toast(`${p.name} no está conectado`)
      fn(p)
    }
    switch (cmd) {
      case 'ir':
      case 'ira':
        return needPerson(p => {
          goTo(p.id)
          chat.close()
          toast(`📍 Fuiste hasta ${p.name}`)
        })
      case 'saludar':
      case 'hola':
        return needPerson(p => wave(p.id))
      case 'msj':
      case 'mensaje':
      case 'dm': {
        const p = findPerson(rest[0] ?? '')
        const text = rest.slice(1).join(' ').trim()
        if (!p || !text) return toast('Uso: /msj nombre texto')
        chat.sendTo(`dm:${p.id}`, text)
        if (!net.peersOf(p.id).length) toast(`${p.name} no está conectado: no le va a llegar`)
        else toast(`💬 Enviado a ${p.name}`)
        return
      }
      case 'escritorio':
      case 'casa':
      case 'home':
        goHome()
        chat.close()
        return
      case 'ocupado':
      case 'busy':
        setManualStatus('busy')
        return toast('🔴 Estás ocupado (no molestar)')
      case 'disponible':
        setManualStatus('available')
        return toast('🟢 Estás disponible')
      case 'ausente':
        setManualStatus('away')
        return toast('🟡 Estás ausente')
      case 'mic':
        call.toggleMic()
        return toast(call.micOn ? '🎙️ Micrófono activado' : '🔇 Micrófono silenciado')
      case 'cam':
      case 'camara':
        call.toggleCam()
        return toast(call.camOn ? '📷 Cámara encendida' : '📷 Cámara apagada')
      case 'quien':
      case 'quienes':
      case 'equipo': {
        const lines = [...net.players.values()].map(p => {
          const n = personById(p.person)?.name ?? '?'
          const where = p.zone ? zoneLabel(p.zone) : 'pasillo'
          return `${n} (${STATUS_LABEL[p.status]}, ${where})`
        })
        return toast(lines.length ? `Conectados: ${lines.join(' · ')}` : 'No hay nadie más conectado')
      }
      case 'ayuda':
      case 'help':
      case 'comandos':
        return setView('shortcuts')
      default:
        toast(`Comando desconocido: /${cmdRaw}. Escribí /ayuda`)
    }
  }

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
    // Ctrl/Cmd+Shift+A / V funcionan siempre (como en Gather)
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && !e.altKey) {
      const k = e.key.toLowerCase()
      if (k === 'a') {
        call.toggleMic()
        e.preventDefault()
        return
      }
      if (k === 'v') {
        call.toggleCam()
        e.preventDefault()
        return
      }
    }
    if (e.key === 'Escape') {
      if (MENUS.some(m => !$(m).hidden)) openMenu(null)
      else setView(null)
      return
    }
    if ((e.target as HTMLElement).closest('input,select,textarea')) return
    if (e.ctrlKey || e.metaKey || e.altKey) return
    if (e.key === 'Enter') {
      chat.open()
      e.preventDefault()
      return
    }
    const single = e.key.length === 1 ? e.key.toLowerCase() : ''
    const shortcuts: Record<string, () => void> = {
      h: goHome,
      m: () => call.toggleMic(),
      v: () => call.toggleCam(),
      b: () => setManualStatus(manualStatus === 'busy' ? 'available' : 'busy'),
      e: () => toggleView('team'),
      '?': () => toggleView('shortcuts')
    }
    REACTIONS.forEach((r, i) => (shortcuts[String(i + 1)] = () => react(r)))
    if (shortcuts[single] && !e.repeat) {
      shortcuts[single]()
      e.preventDefault()
      return
    }
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
  $('me-role').textContent = me.role
  for (const id of ['me-avatar', 'me-avatar-lg']) {
    $(id).textContent = initials(me.name)
    $(id).style.background = me.color
  }
  renderStatusUI()

  function goHome() {
    pos.x = myDesk.seat.x
    pos.y = myDesk.seat.y
    target = null
  }

  /** Aparecer al lado de una persona (si está en una alfombra, entrás a su llamada). */
  function goTo(personId: string) {
    const p = [...net.players.values()].find(pl => pl.person === personId)
    if (!p) return
    const offsets = [
      [0, 40], [40, 0], [-40, 0], [0, -40], [40, 40], [-40, 40], [40, -40], [-40, -40], [0, 70], [70, 0], [-70, 0]
    ]
    for (const [ox, oy] of offsets) {
      const x = p.x + ox
      const y = p.y + oy
      if (!collides(x, y)) {
        pos.x = x
        pos.y = y
        target = null
        return
      }
    }
    target = {x: p.x, y: p.y}
  }

  function wave(personId: string) {
    const name = personById(personId)?.name ?? ''
    net.sendWave(me.id, net.peersOf(personId))
    toast(`👋 Saludaste a ${name}`)
  }

  function receiveWave(fromId: string) {
    const from = personById(fromId)
    if (!from) return
    if (status !== 'busy') beep(990)
    addActivity('👋', `${from.name} te saludó`, () => goTo(from.id), true)
    toast(`👋 ${from.name} te saluda`, [
      {label: 'Ir', fn: () => goTo(from.id)},
      {label: 'Responder', fn: () => chat.openDM(from.id)}
    ])
    notify('👋 Te saludan', `${from.name} te saluda`, () => goTo(from.id))
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
      if (z !== null) {
        const busy = [...net.players.values()].filter(p => p.zone === z && p.status === 'busy')
        for (const b of busy) toast(`🔴 ${personById(b.person)?.name ?? 'Alguien'} está ocupado (no molestar)`)
      }
      document.title = z ? '● En llamada — Oficina virtual' : 'Oficina virtual'
      renderRoster()
    }

    net.update(myState(), now)

    // interpolación de los demás
    const k = 1 - Math.pow(0.0001, dt)
    for (const p of net.players.values()) {
      p.rx += (p.x - p.rx) * k
      p.ry += (p.y - p.ry) * k
    }

    if (now - lastSlow > 1000) {
      lastSlow = now
      renderNetStatus()
      refreshStatus()
      net.prune(now)
      call.tick()
    }

    updateCamera()
    draw(now)
    requestAnimationFrame(step)
  }

  function myState() {
    return {
      person: me.id,
      x: Math.round(pos.x),
      y: Math.round(pos.y),
      zone: currentZone,
      mic: call.micOn,
      cam: call.sendingVideo,
      status
    }
  }

  // latido aunque la pestaña esté en segundo plano (rAF se pausa ahí)
  setInterval(() => {
    if (document.hidden) {
      const now = performance.now()
      net.update(myState(), now)
      refreshStatus()
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

    const all: {x: number; y: number; person: Person | undefined; self: boolean; moving: boolean; status: Status}[] = []
    for (const p of net.players.values()) {
      all.push({
        x: p.rx,
        y: p.ry,
        person: personById(p.person),
        self: false,
        moving: Math.hypot(p.x - p.rx, p.y - p.ry) > 1,
        status: p.status
      })
    }
    all.push({x: pos.x, y: pos.y, person: me, self: true, moving, status})
    all.sort((a, b) => a.y - b.y)
    for (const a of all) drawAvatar(a.x, a.y, a.person, a.self, a.moving, now, a.status)
    for (const a of all) {
      const b = a.person && bubbles.get(a.person.id)
      if (b && b.until > now) drawBubble(a.x, a.y, b.text)
      else if (b && a.person) bubbles.delete(a.person.id)
      const r = a.person && reactions.get(a.person.id)
      if (r) {
        const age = now - r.start
        if (age > 2600) reactions.delete(a.person!.id)
        else {
          ctx.save()
          ctx.globalAlpha = age < 2000 ? 1 : 1 - (age - 2000) / 600
          ctx.font = '30px system-ui, "Apple Color Emoji", "Segoe UI Emoji", sans-serif'
          ctx.textAlign = 'center'
          ctx.fillText(r.emoji, a.x, a.y - 58 - age / 45)
          ctx.restore()
        }
      }
    }

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
    const talking = people >= 2
    ctx.lineWidth = talking ? 3 + Math.sin(now / 250) * 1 : people > 0 ? 2.5 : 2
    ctx.setLineDash(people > 0 ? [] : [8, 6])
    ctx.strokeStyle = hexA(color, talking ? 0.95 : people > 0 ? 0.7 : 0.45)
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
    if (people >= 2) {
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

  function drawAvatar(
    x: number,
    y: number,
    p: Person | undefined,
    self: boolean,
    mov: boolean,
    now: number,
    st: Status
  ) {
    const color = p?.color ?? '#888'
    const bob = mov ? Math.abs(Math.sin(self ? walkPhase : now / 80)) * 3 : 0
    ctx.save()
    if (st === 'away') ctx.globalAlpha = 0.5
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
    // indicador de estado
    ctx.globalAlpha = 1
    ctx.fillStyle = STATUS_COLOR[st]
    ctx.beginPath()
    ctx.arc(x + 12, y - bob + 11, 6, 0, Math.PI * 2)
    ctx.fill()
    ctx.lineWidth = 2
    ctx.strokeStyle = '#fff'
    ctx.stroke()
    if (st === 'away') {
      ctx.fillStyle = '#2b2f3a'
      ctx.font = '700 11px system-ui, sans-serif'
      ctx.fillText('z', x + 22, y - bob - 6)
    }
    ctx.restore()
  }

  function drawBubble(x: number, y: number, text: string) {
    const t = text.length > 60 ? text.slice(0, 60) + '…' : text
    ctx.font = '13px system-ui, sans-serif'
    const w = Math.min(260, ctx.measureText(t).width + 18)
    const h = 26
    const bx = x - w / 2
    const by = y - 80
    ctx.fillStyle = '#fff'
    ctx.strokeStyle = 'rgba(0,0,0,.15)'
    ctx.lineWidth = 1
    roundRect(bx, by, w, h, 12)
    ctx.fill()
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(x - 6, by + h)
    ctx.lineTo(x, by + h + 7)
    ctx.lineTo(x + 6, by + h)
    ctx.fill()
    ctx.fillStyle = '#1f222b'
    ctx.textAlign = 'center'
    ctx.save()
    ctx.beginPath()
    ctx.rect(bx + 6, by, w - 12, h)
    ctx.clip()
    ctx.fillText(t, x, by + 17)
    ctx.restore()
  }

  function roundRect(x: number, y: number, w: number, h: number, r: number) {
    ctx.beginPath()
    ctx.roundRect(x, y, w, h, r)
  }

  function renderNetStatus() {
    const {open, total} = net.relayStatus()
    const peers = net.players.size
    $('net-dot').style.background = open === 0 ? 'var(--danger)' : 'var(--ok)'
    $('net-status').textContent =
      open === 0
        ? `🔴 Sin conexión a la red (0/${total}). Revisá internet o desactivá bloqueadores de anuncios.`
        : `🟢 Conectado a ${open} de ${total} servidores · ves a ${peers} ${peers === 1 ? 'persona' : 'personas'}.`
    const online = new Set([...net.players.values()].map(p => p.person))
    $('team-count').textContent = String(online.size + 1)
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
        const st: Status | null = isMe ? status : (rp?.status ?? null)
        li.className = here ? 'on' : 'off'
        let text = 'desconectado'
        if (here && st) {
          const where = zone ? (zone === p.desk ? 'en su escritorio' : zoneLabel(zone)) : 'en el pasillo'
          text = `${STATUS_LABEL[st]} · ${where}`
        }
        li.innerHTML = `<span class="dot"></span><span class="n"></span><span class="s"></span><span class="acts"></span>`
        const dot = li.querySelector('.dot') as HTMLElement
        dot.style.background = p.color
        if (here && st) dot.style.boxShadow = `0 0 0 2px var(--panel), 0 0 0 4px ${STATUS_COLOR[st]}`
        li.querySelector('.n')!.textContent = isMe ? `${p.name} (vos)` : p.name
        li.querySelector('.s')!.textContent = text
        if (!isMe && rp) {
          const acts = li.querySelector('.acts')!
          const mk = (icon: string, title: string, fn: () => void) => {
            const b = document.createElement('button')
            b.className = 'act'
            b.textContent = icon
            b.title = title
            b.onclick = e => {
              e.stopPropagation()
              fn()
            }
            acts.appendChild(b)
          }
          mk('👋', `Saludar a ${p.name}`, () => wave(p.id))
          mk('💬', `Mensaje a ${p.name}`, () => chat.openDM(p.id))
          mk('📍', `Ir hasta ${p.name}`, () => goTo(p.id))
        }
        return li
      })
    )
  }
  renderRoster()

  // ── avisos ──
  function knock(p: RemotePlayer) {
    const who = personById(p.person)?.name ?? 'Alguien'
    addActivity('🚪', `${who} pasó por tu escritorio`, goHome, true)
    if (status === 'busy') {
      toast(`${who} pasó por tu escritorio (estás en no molestar)`, [{label: 'Ir a mi escritorio', fn: goHome}])
      return
    }
    beep()
    toast(`${who} está en tu escritorio`, [{label: 'Ir a mi escritorio', fn: goHome}])
    notify('Oficina virtual', `${who} está en tu escritorio`, goHome)
  }

  /** Notificación del sistema solo si la pestaña está en segundo plano y no estás ocupado. */
  function notify(title: string, body: string, onClick: () => void) {
    if (!document.hidden || status === 'busy') return
    if (!('Notification' in window) || Notification.permission !== 'granted') return
    try {
      const n = new Notification(title, {body})
      n.onclick = () => {
        window.focus()
        onClick()
        n.close()
      }
    } catch {
      /* ignore */
    }
  }

  requestAnimationFrame(step)
}

function toast(msg: string, actions: {label: string; fn: () => void}[] = []) {
  const box = $('toasts')
  const el = document.createElement('div')
  el.className = 'toast'
  const span = document.createElement('span')
  span.textContent = msg
  el.appendChild(span)
  for (const a of actions) {
    const b = document.createElement('button')
    b.textContent = a.label
    b.onclick = () => {
      a.fn()
      el.remove()
    }
    el.appendChild(b)
  }
  box.appendChild(el)
  setTimeout(() => el.remove(), 9000)
}

let audioCtx: AudioContext | null = null
function beep(freq = 880) {
  try {
    audioCtx ??= new AudioContext()
    const o = audioCtx.createOscillator()
    const g = audioCtx.createGain()
    o.frequency.value = freq
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
