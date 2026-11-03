import './style.css'
import {deskOwner, initials, PEOPLE, personById, type Person} from './config'
import {AREAS, ART, areaAt, collides, deskByNum, DESKS, PX, roomById, ROOMS, SOLIDS, WORLD, zoneAt, type Room} from './map'
import {buildScene} from './scene'
import {drawSimpleMap} from './scene/simple'
import type {Light} from './scene/sprites'
import {BODY_H, DIR_INDEX, FRAME, frameOf, loadAssets, SPRITE_COUNT, type Assets, type Dir} from './assets'
import {Net, type RemotePlayer, type Status} from './net'
import {Call} from './call'
import {Chat} from './chat'
import {findPath} from './path'
import {MiniWindow, miniSupported} from './mini'
import {boot, LOGIN_URL, logoutGoogle, takeLoginError} from './session'
import {Calendar, hhmm} from './calendar'
import {BoardController, deleteBoard, listBoards, newBoardMeta} from './board'
import {linkInfo, netEvents, netLog} from './diag'
import {loadTurn, type TurnInfo} from './turn'
import {hydrateIcons, icon} from './icons'

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
const LS_USER = 'ov.user'
const LS_KEY = 'ov.key'
const LS_VIEW = 'ov.vista'
const LS_LIGHT = 'ov.luz'
const DAY_HOURS = [7, 19] // modo de luz "Según la hora": de día de 7 a 19 (hora de la compu)
const AWAY_AFTER_MS = 10 * 60 * 1000 // 10 minutos sin actividad → ausente
const NEAR_RADIUS = 200
// Charla por cercanía fuera de cubículos y salas (px de mundo; un avatar mide ~48 de ancho).
// Se conecta al acercarse a menos de TALK_IN y se corta recién al alejarse más que TALK_OUT,
// así no se corta y reconecta cuando alguien queda justo en el borde.
const TALK_IN = 120
const TALK_OUT = 170
const DEBUG = new URLSearchParams(location.search).has('debug') // ?debug=1 muestra colisiones y zonas
// Cuánto de la oficina se ve como máximo, en píxeles de arte (el mapa mide 652×320; un cubículo
// mide ~78 de ancho y cada fila ~106 de alto). Más chico = cámara más cerca.
const VIEW_ART = {w: 170, h: 220}

const STATUS_LABEL: Record<Status, string> = {
  available: 'disponible',
  busy: 'ocupado (no molestar)',
  away: 'ausente'
}
const STATUS_COLOR: Record<Status, string> = {available: '#3bb273', busy: '#fa4616', away: '#f2c94c'}
/** "En reunión" (por el calendario) es Ocupado para las llamadas, pero se muestra distinto. */
const statusText = (st: Status, meeting?: boolean) => (st === 'busy' && meeting ? 'en reunión' : STATUS_LABEL[st])

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
  const room = roomById(n)
  if (room) return room.name
  const o = deskOwner(n)
  return o ? `Escritorio de ${o.name}` : `Escritorio ${n} (libre)`
}

// ─── Login ──────────────────────────────────────────────────

/** Cómo entra cada uno: con Google (si el Dashboard lo tiene configurado) o con persona + clave. */
async function bootOffice() {
  const b = await boot()
  if (!b) return // yendo a la dirección oficial
  if (b.kind === 'classic') return setupLogin()
  if (b.kind === 'login') return showGoogleLogin(takeLoginError())
  const person = personById(b.person)
  if (!person) {
    return showGoogleLogin(`Tu cuenta (${b.email}) está autorizada como “${b.person}”, pero esa persona no está en la oficina.`)
  }
  lsSet(LS_KEY, null) // la clave ya no se escribe ni se guarda
  lsSet(LS_USER, person.id)
  // el permiso de notificaciones necesita un clic: se pide con el primero dentro de la oficina
  window.addEventListener(
    'pointerdown',
    () => {
      if ('Notification' in window && Notification.permission === 'default') void Notification.requestPermission().catch(() => {})
    },
    {once: true}
  )
  start(person, b.key, {google: true, calendar: b.calendar}, await loadTurn(b.key))
}

function showGoogleLogin(error: string) {
  $('login-form').hidden = true
  $('login-google').hidden = false
  $<HTMLAnchorElement>('btn-google').href = LOGIN_URL
  $('login-google-error').textContent = error
}

function setupLogin() {
  $('login-google').hidden = true
  $('login-form').hidden = false
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

  $<HTMLFormElement>('login-form').onsubmit = async e => {
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
    const btn = $<HTMLButtonElement>('login-form').querySelector<HTMLButtonElement>('button[type=submit]')
    if (btn) btn.disabled = true
    start(person, key, {google: false, calendar: false}, await loadTurn(key))
  }
}

// ─── Juego ──────────────────────────────────────────────────

function start(me: Person, key: string, auth: {google: boolean; calendar: boolean}, turn: TurnInfo) {
  $('login').hidden = true
  $('app').hidden = false
  hydrateIcons()
  // etiquetas rápidas en la burbuja (reemplazan al tooltip lento del navegador)
  for (const b of document.querySelectorAll<HTMLElement>('#pill button[title]')) {
    b.dataset.tip = b.title.replace(/ \((.+)\)$/, ' · $1')
    b.removeAttribute('title')
  }

  const canvas = $<HTMLCanvasElement>('world')
  const ctx = canvas.getContext('2d')!
  const myDesk = deskByNum(me.desk)
  const pos = {x: myDesk.seat.x, y: myDesk.seat.y}
  // camino que está recorriendo el personaje solo (clic en el mapa o "ir a mi escritorio")
  let route: {x: number; y: number}[] = []
  let walkPhase = 0
  let moving = false
  let myDir: Dir = 'down'
  const remoteDir = new Map<string, Dir>()
  const dirOf = (dx: number, dy: number): Dir =>
    Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up'
  const keys = new Set<string>()

  // ── estado (disponible / ocupado / ausente) ──
  const LS_STATUS = `ov.status.${me.id}`
  let manualStatus: Status = (lsGet(LS_STATUS) as Status) || 'available'
  if (!(manualStatus in STATUS_LABEL)) manualStatus = 'available'
  let lastActivity = Date.now()
  let status: Status = manualStatus
  function renderStatusUI() {
    $('me-dot').style.background = STATUS_COLOR[status]
    const meet = status === 'busy' && inMeeting() ? calendar?.current() : null
    const label = meet ? `En reunión hasta las ${hhmm(new Date(meet.fin).getTime())}` : STATUS_LABEL[status]
    $('pill-me').dataset.tip = `${label[0].toUpperCase()}${label.slice(1)} · B`
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

  // Calendario de Google (se arma más abajo; antes de eso no hay reunión)
  let calendar: Calendar | null = null
  /** En una reunión del calendario y sin un estado elegido a mano (Ocupado o Ausente ganan). */
  const inMeeting = () => manualStatus === 'available' && !!calendar?.current()
  function computeStatus(): Status {
    if (manualStatus !== 'available') return manualStatus
    if (inMeeting()) return 'busy'
    const inConversation = !!call?.inCall
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

  netLog(`Entra ${me.id} · versión ${document.querySelector<HTMLScriptElement>('script[type="module"][src*="assets/index-"]')?.src.split('/').pop() ?? 'dev'} · respaldo: ${turn.source}${turn.note ? ` (${turn.note})` : ''}`)
  const net = new Net(key, turn.servers, {
    onJoin: id => call.onPeerJoined(id),
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
    onStream: (stream, id, meta) => call.onRemoteStream(stream, id, meta),
    onError: msg => toast(msg),
    onChat: m => chat.receive(m),
    onWave: from => receiveWave(from),
    onReact: (from, emoji) => reactions.set(from, {emoji, start: performance.now()})
  })
  let currentZone: number | null = null
  // peerIds con los que estoy charlando por cercanía (fuera de cubículos y salas)
  const talking = new Set<string>()
  const callLabel = (zone: number | null) => {
    if (zone !== null) return zoneLabel(zone)
    const area = areaAt(pos.x, pos.y)
    return area ? `Charla en la ${area.toLowerCase()}` : 'Charla en el pasillo'
  }
  const call = new Call(net, me.id, callLabel, () => status, () => talking)
  // pizarras compartidas en las llamadas (ver src/board.ts)
  const board = new BoardController(net, me, key, call, {
    toast: (msg, ic) => toast(msg, [], ic ?? 'board'),
    changed: () => call.reconcile()
  })
  call.setBoard(() => board.tile())
  board.el.querySelector<HTMLButtonElement>('[data-act=expand]')!.onclick = () => call.setView('present')

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
      toast(`${from.name}: ${short}`, [{label: 'Responder', fn: open}], 'message')
      notify(`Mensaje de ${from.name}`, text, open)
      addActivity('message', `${from.name}: ${short}`, open, true)
    },
    onCommand: text => runCommand(text),
    onOpen: () => setView('chat'),
    onClose: () => view === 'chat' && setView(null)
  })

  // ── panel lateral (pestañas de la barra de íconos) ──
  type View = 'chat' | 'team' | 'activity' | 'calendar' | 'shortcuts' | 'settings'
  const VIEW_TITLE: Record<View, string> = {
    chat: 'Chat',
    team: 'Equipo',
    activity: 'Actividad',
    calendar: 'Calendario',
    shortcuts: 'Atajos y comandos',
    settings: 'Ajustes'
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
    if (v === 'settings') void renderLinks()
    if (v === 'team') renderRoster()
    if (v === 'calendar') calendar?.render($('cal-body'))
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
  const MENUS = ['status-menu', 'react-menu', 'devices', 'view-menu', 'share-menu', 'board-menu']
  function openMenu(id: string | null) {
    for (const m of MENUS) $(m).hidden = m !== id
    $('btn-react').classList.toggle('on', id === 'react-menu')
    $('btn-view').classList.toggle('on', id === 'view-menu')
  }
  const toggleMenu = (id: string) => openMenu($(id).hidden ? id : null)
  document.addEventListener('ov:menu', e => openMenu((e as CustomEvent<string | null>).detail))
  document.addEventListener('pointerdown', e => {
    if (!(e.target as HTMLElement).closest('#pill-wrap, #map-ctrl')) openMenu(null)
  })
  $('pill-me').onclick = () => toggleMenu('status-menu')
  $('btn-react').onclick = () => toggleMenu('react-menu')
  $('btn-nearby').onclick = () => chat.open('nearby')
  // compartir: primero se elige qué (pestaña, ventana o pantalla) y si va con sonido
  $('btn-screen').onclick = () => {
    if ($('call').hidden) toast('Para compartir pantalla, entrá a una llamada (alfombra de un escritorio).')
    else if (call.sharingScreen) call.stopSharing()
    else toggleMenu('share-menu')
  }
  // Compartir → Una pizarra: nueva o una guardada
  $('btn-share-board').onclick = () => {
    if (board.activeId) {
      openMenu(null)
      call.setView('present')
      if (!board.presentingState) toast('Ya hay una pizarra abierta en esta llamada.', [], 'board')
      return
    }
    openMenu('board-menu')
    void renderBoardMenu()
  }
  $('btn-board-new').onclick = () => {
    openMenu(null)
    board.start(newBoardMeta(), true)
    call.setView('present')
  }
  async function renderBoardMenu() {
    const box = $('board-list')
    const note = (t: string) => {
      const p = document.createElement('p')
      p.textContent = t
      box.replaceChildren(p)
    }
    note('Cargando…')
    const list = await listBoards(key)
    if (list === null) return note('El guardado no está configurado en esta oficina: las pizarras se pueden descargar como imagen.')
    if (!list.length) return note('Todavía no hay pizarras guardadas.')
    box.replaceChildren(
      ...list.map(b => {
        const row = document.createElement('div')
        row.className = 'row'
        const open = document.createElement('button')
        const who = personById(b.editedBy)?.name.split(' ')[0] ?? b.editedBy
        const when = new Date(b.editedAt).toLocaleString('es-AR', {day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'})
        open.innerHTML = `<i>${icon('board', 18)}</i><span><b></b><small></small></span>`
        open.querySelector('b')!.textContent = b.title
        open.querySelector('small')!.textContent = `${who} · ${when}`
        open.onclick = () => {
          openMenu(null)
          board.start({id: b.id, title: b.title})
          call.setView('present')
        }
        const del = document.createElement('button')
        del.className = 'del'
        del.title = 'Borrar esta pizarra'
        del.innerHTML = icon('trash', 16)
        del.onclick = async () => {
          if (!confirm(`¿Borrar la pizarra «${b.title}»? No se puede deshacer.`)) return
          if (await deleteBoard(key, b.id)) void renderBoardMenu()
          else toast('No se pudo borrar la pizarra.', [], 'board')
        }
        row.append(open, del)
        return row
      })
    )
  }
  document.addEventListener('ov:toast', e => {
    const d = (e as CustomEvent<{msg: string; actions?: {label: string; fn: () => void}[]; ic?: string; ms?: number}>).detail
    toast(d.msg, d.actions ?? [], d.ic ?? 'info', d.ms)
  })
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
        li.querySelector('.ic')!.innerHTML = icon(a.icon, 18)
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
          if (p) addActivity('user-plus', `${p.name} se conectó`, () => goTo(id))
        }
      }
      for (const id of knownOnline) {
        if (!now.has(id)) {
          const p = personById(id)
          if (p) addActivity('user-minus', `${p.name} se desconectó`)
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
          toast(`Fuiste hasta ${p.name}`, [], 'pin')
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
        else toast(`Enviado a ${p.name}`, [], 'send')
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
        return toast('Estás ocupado (no molestar)', [], 'moon')
      case 'disponible':
        setManualStatus('available')
        return toast('Estás disponible', [], 'check')
      case 'ausente':
        setManualStatus('away')
        return toast('Estás ausente', [], 'minus')
      case 'mic':
        call.toggleMic()
        return toast(call.micOn ? 'Micrófono activado' : 'Micrófono silenciado', [], call.micOn ? 'mic' : 'mic-off')
      case 'cam':
      case 'camara':
        call.toggleCam()
        return toast(call.camOn ? 'Cámara encendida' : 'Cámara apagada', [], call.camOn ? 'video' : 'video-off')
      case 'quien':
      case 'quienes':
      case 'equipo': {
        const lines = [...net.players.values()].map(p => {
          const n = personById(p.person)?.name ?? '?'
          const where = p.zone ? zoneLabel(p.zone) : (areaAt(p.x, p.y)?.toLowerCase() ?? 'pasillo')
          return `${n} (${statusText(p.status, p.meeting)}, ${where})`
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
  let inBoard = false
  window.addEventListener('pointerdown', e => (inBoard = !!(e.target as HTMLElement).closest?.('.tile.board:not(.compact)')), true)
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
    // dibujando en la pizarra, las teclas son de la pizarra (V, flechas, Esc…), no de la oficina
    if (inBoard || (e.target as HTMLElement).closest?.('.tile.board')) return
    if (e.key === 'Escape') {
      if (MENUS.some(m => !$(m).hidden)) openMenu(null)
      else if (!call.exitBig()) setView(null)
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
      '?': () => toggleView('shortcuts'),
      '+': () => setZoom(zoomRel * 1.25),
      '=': () => setZoom(zoomRel * 1.25),
      '-': () => setZoom(zoomRel / 1.25),
      '0': resetView,
      g: toggleOverview,
      l: () => setLightMode(light === 'day' ? 'night' : 'day'),
      p: () => toggleMini()
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
      route = []
      e.preventDefault()
    }
  })
  window.addEventListener('keyup', e => keys.delete(keyName(e)))
  window.addEventListener('blur', () => keys.clear())

  $('btn-home').onclick = () => goHome()
  $('btn-logout').onclick = async () => {
    lsSet(LS_KEY, null)
    net.leave()
    if (auth.google) await logoutGoogle()
    location.reload()
  }
  $('me-name').textContent = me.name
  $('me-role').textContent = me.role
  for (const id of ['me-avatar', 'me-avatar-lg']) {
    $(id).textContent = initials(me.name)
    $(id).style.background = me.color
  }
  renderStatusUI()

  /** Ir caminando a mi escritorio (por las puertas, esquivando muebles). */
  function goHome() {
    walkTo(myDesk.seat)
  }

  /** Caminar hasta un punto buscando el camino; si no hay forma de llegar, va en línea recta. */
  function walkTo(p: {x: number; y: number}) {
    route = findPath(pos, p) ?? [p]
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
        route = []
        return
      }
    }
    walkTo({x: p.x, y: p.y})
  }

  function wave(personId: string) {
    const name = personById(personId)?.name ?? ''
    net.sendWave(me.id, net.peersOf(personId))
    toast(`Saludaste a ${name}`, [], 'wave')
  }

  function receiveWave(fromId: string) {
    const from = personById(fromId)
    if (!from) return
    if (status !== 'busy') beep(990)
    addActivity('wave', `${from.name} te saludó`, () => goTo(from.id), true)
    toast(`${from.name} te saluda`, [
      {label: 'Ir', fn: () => goTo(from.id)},
      {label: 'Responder', fn: () => chat.openDM(from.id)}
    ], 'wave')
    notify('Te saludan', `${from.name} te saluda`, () => goTo(from.id))
  }

  // ── cámara / viewport ──
  // zoom = píxeles de pantalla por píxel de mundo. La vista "normal" (zoomRel = 1) es la de cerca
  // (VIEW_ART, siguiendo al avatar). Se puede alejar hasta ver toda la oficina y acercar hasta
  // MAX_ZOOM_REL. Arrastrar el mapa suelta la cámara; moverse la vuelve a pegar al avatar.
  const MAX_ZOOM_REL = 2.2
  const AUTO_SIMPLE_BELOW = 0.75 // modo Automático: más lejos que esto, vista simplificada
  const UI_MIN = 0.85 // carteles y círculos no se achican más que esto en pantalla al alejarse
  type ViewMode = 'simple' | 'immersive' | 'auto'
  const VIEW_MODES: ViewMode[] = ['simple', 'immersive', 'auto']
  const VIEW_NAMES: Record<ViewMode, string> = {simple: 'Simplificado', immersive: 'Inmersivo', auto: 'Automático'}
  let viewMode: ViewMode = VIEW_MODES.find(m => m === lsGet(LS_VIEW)) ?? 'auto'
  // Luz de la oficina: versión de día o de noche (la escena se arma de nuevo al cambiar)
  type LightMode = Light | 'auto'
  const LIGHT_MODES: LightMode[] = ['day', 'night', 'auto']
  const LIGHT_NAMES: Record<LightMode, string> = {day: 'Día', night: 'Noche', auto: 'Según la hora'}
  let lightMode: LightMode = LIGHT_MODES.find(m => m === lsGet(LS_LIGHT)) ?? 'auto'
  const lightFor = (m: LightMode): Light => {
    if (m !== 'auto') return m
    const h = new Date().getHours()
    return h >= DAY_HOURS[0] && h < DAY_HOURS[1] ? 'day' : 'night'
  }
  let light: Light = lightFor(lightMode)
  let simpleView = false // lo que se está dibujando en este cuadro
  let uiK = 1 // escala extra de personas/globos (vista simplificada muy lejos)
  let plateK = 1 // escala extra de los carteles
  let vw = 0
  let vh = 0
  let zoom = 1
  let camX = 0
  let camY = 0
  let cx = pos.x // centro de la cámara (mundo)
  let cy = pos.y
  let baseArt = 3 // tamaño de un píxel de arte en pantalla, en la vista normal
  let fitArt = 1 // ...cuando entra toda la oficina
  let zoomRel = 1 // zoom pedido, relativo a la vista normal
  let zoomNow = 1 // zoom mostrado: se acerca suave a zoomRel
  let follow = true
  let snapCam = true
  let anchor: {sx: number; sy: number; wx: number; wy: number} | null = null // punto fijo al hacer zoom
  const minZoomRel = () => Math.min(1, fitArt / baseArt)
  const inOverview = () => zoomRel <= minZoomRel() + 0.001
  const isSimple = () => viewMode === 'simple' || (viewMode === 'auto' && zoomNow < AUTO_SIMPLE_BELOW)

  function resize() {
    const dpr = window.devicePixelRatio || 1
    vw = canvas.clientWidth
    vh = canvas.clientHeight
    canvas.width = Math.round(vw * dpr)
    canvas.height = Math.round(vh * dpr)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    // Vista normal, estilo Gather: se ve una parte de la oficina (unos VIEW_ART píxeles de arte),
    // nunca menos que lo necesario para cubrir el lienzo (sin franjas negras). El píxel de arte se
    // redondea HACIA ARRIBA a cuartos de píxel: nítido y sin huecos.
    const close = Math.min(vw / VIEW_ART.w, vh / VIEW_ART.h)
    const cover = Math.max(vw / ART.w, vh / ART.h)
    baseArt = Math.max(1.5, Math.ceil(Math.max(close, cover) * 4) / 4)
    fitArt = Math.min(vw / ART.w, vh / ART.h) * 0.96 // vista general, con un poco de aire
    zoomRel = clamp(zoomRel, minZoomRel(), MAX_ZOOM_REL)
    zoomNow = clamp(zoomNow, minZoomRel(), MAX_ZOOM_REL)
    zoom = (baseArt * zoomNow) / PX
    snapCam = true
    syncMapCtrl()
  }
  new ResizeObserver(resize).observe(canvas)
  resize()

  function setZoom(rel: number, at?: {sx: number; sy: number}) {
    zoomRel = clamp(rel, minZoomRel(), MAX_ZOOM_REL)
    if (!follow) {
      // con la cámara suelta, el punto bajo el mouse (o el centro) queda quieto mientras se hace zoom
      const sx = at?.sx ?? vw / 2
      const sy = at?.sy ?? vh / 2
      const w = screenToWorld(sx, sy)
      anchor = {sx, sy, wx: w.x, wy: w.y}
    }
    syncMapCtrl()
  }
  function setFollow(on: boolean) {
    if (follow === on) return
    follow = on
    anchor = null
    syncMapCtrl()
  }
  /** Vista normal: de cerca y siguiendo al avatar. */
  function resetView() {
    setFollow(true)
    setZoom(1)
  }
  function toggleOverview() {
    if (inOverview()) return resetView()
    setFollow(false)
    setZoom(minZoomRel())
  }

  function updateCamera(dt: number) {
    if (zoomNow !== zoomRel) {
      zoomNow += (zoomRel - zoomNow) * (1 - Math.pow(0.00005, dt))
      if (Math.abs(zoomRel - zoomNow) < 0.002) zoomNow = zoomRel
    }
    zoom = (baseArt * zoomNow) / PX
    const viewW = vw / zoom
    const viewH = vh / zoom
    if (follow) {
      // la cámara alcanza al avatar con un poco de suavidad (y se desliza al volver a seguirlo)
      const k = snapCam ? 1 : 1 - Math.pow(0.0005, dt)
      cx += (pos.x - cx) * k
      cy += (pos.y - cy) * k
    } else if (anchor) {
      cx = anchor.wx - anchor.sx / zoom + viewW / 2
      cy = anchor.wy - anchor.sy / zoom + viewH / 2
      if (zoomNow === zoomRel) anchor = null
    }
    cx = viewW >= WORLD.w ? WORLD.w / 2 : clamp(cx, viewW / 2, WORLD.w - viewW / 2)
    cy = viewH >= WORLD.h ? WORLD.h / 2 : clamp(cy, viewH / 2, WORLD.h - viewH / 2)
    camX = cx - viewW / 2
    camY = cy - viewH / 2
    snapCam = false
  }
  function screenToWorld(sx: number, sy: number) {
    return {x: sx / zoom + camX, y: sy / zoom + camY}
  }

  // ── controles del mapa (abajo a la derecha) ──
  function syncMapCtrl() {
    ;($('btn-zoom-in') as HTMLButtonElement).disabled = zoomRel >= MAX_ZOOM_REL - 0.001
    ;($('btn-zoom-out') as HTMLButtonElement).disabled = inOverview()
    $('btn-overview').classList.toggle('on', inOverview())
    $('btn-overview').dataset.tip = inOverview() ? 'Volver a la vista normal · G' : 'Ver toda la oficina · G'
    // la flecha se destaca cuando la vista no es la normal: un toque y volvés a tu personaje
    $('btn-locate').classList.toggle('cta', !follow || Math.abs(zoomRel - 1) > 0.001)
  }
  $('btn-desk').onclick = () => goHome()
  $('btn-locate').onclick = () => resetView()
  $('btn-zoom-in').onclick = () => setZoom(zoomRel * 1.25)
  $('btn-zoom-out').onclick = () => setZoom(zoomRel / 1.25)
  $('btn-overview').onclick = () => toggleOverview()
  $('btn-view').onclick = () => {
    toggleMenu('view-menu')
    if (!$('view-menu').hidden) drawThumbs()
  }
  for (const b of document.querySelectorAll<HTMLButtonElement>('#view-menu button[data-mode]')) {
    b.onclick = () => {
      viewMode = b.dataset.mode as ViewMode
      lsSet(LS_VIEW, viewMode)
      openMenu(null)
      toast(`Vista: ${VIEW_NAMES[viewMode]}`, [], 'office')
    }
  }
  for (const b of document.querySelectorAll<HTMLButtonElement>('#view-menu button[data-light]')) {
    b.onclick = () => setLightMode(b.dataset.light as LightMode)
  }
  /** Elegir la luz (Día / Noche / Según la hora); se guarda en este navegador. */
  function setLightMode(m: LightMode) {
    lightMode = m
    lsSet(LS_LIGHT, m)
    applyLight()
    toast(`Luz: ${LIGHT_NAMES[m]}${m === 'auto' ? ` (ahora ${LIGHT_NAMES[light].toLowerCase()})` : ''}`, [], light === 'day' ? 'sun' : 'moon')
  }
  /** Rearma la escena si cambió la luz y actualiza el menú. */
  function applyLight() {
    const l = lightFor(lightMode)
    if (l !== light) {
      light = l
      scene = buildScene(assets, light)
    }
    for (const b of document.querySelectorAll<HTMLButtonElement>('#view-menu button[data-light]')) {
      b.classList.toggle('sel', b.dataset.light === lightMode)
    }
    if (!$('view-menu').hidden) drawThumbs()
  }
  setInterval(() => lightMode === 'auto' && applyLight(), 60_000)

  /** Miniaturas del menú de vista, dibujadas con el mapa real (primeros cubículos y el pasillo). */
  function drawThumbs() {
    const crop = {x: 12, y: 22, w: 112, h: 112} // en píxeles de arte
    for (const b of document.querySelectorAll<HTMLButtonElement>('#view-menu button[data-mode]')) {
      const mode = b.dataset.mode as ViewMode
      b.classList.toggle('sel', mode === viewMode)
      const c = b.querySelector('canvas')!
      const t = c.getContext('2d')!
      const s = c.width / crop.w // px de la miniatura por píxel de arte
      const immersive = () => {
        t.imageSmoothingEnabled = false
        t.drawImage(scene, crop.x, crop.y, crop.w, crop.h, 0, 0, c.width, c.height)
      }
      const simple = () => {
        t.save()
        t.scale(s / PX, s / PX)
        t.translate(-crop.x * PX, -crop.y * PX)
        drawSimpleMap(t, s, light)
        t.restore()
      }
      t.fillStyle = '#020003'
      t.fillRect(0, 0, c.width, c.height)
      if (mode === 'simple') simple()
      else if (mode === 'immersive') immersive()
      else {
        // Automático: mitad y mitad
        t.save()
        t.beginPath()
        t.rect(0, 0, c.width / 2, c.height)
        t.clip()
        simple()
        t.restore()
        t.save()
        t.beginPath()
        t.rect(c.width / 2, 0, c.width / 2, c.height)
        t.clip()
        immersive()
        t.restore()
        t.fillStyle = '#ffffff'
        t.fillRect(c.width / 2 - 1, 0, 2, c.height)
      }
    }
  }

  // Clic = caminar hasta ahí · arrastrar = recorrer el mapa · rueda o pellizco = zoom
  let drag: {id: number; x: number; y: number; cx: number; cy: number; moved: boolean} | null = null
  canvas.addEventListener('pointerdown', e => {
    if (e.button !== 0) return
    drag = {id: e.pointerId, x: e.clientX, y: e.clientY, cx, cy, moved: false}
    canvas.setPointerCapture(e.pointerId)
  })
  canvas.addEventListener('pointermove', e => {
    if (!drag || e.pointerId !== drag.id) return
    const dx = e.clientX - drag.x
    const dy = e.clientY - drag.y
    if (!drag.moved) {
      if (Math.hypot(dx, dy) < 6) return
      drag.moved = true
      setFollow(false)
      canvas.classList.add('dragging')
    }
    cx = drag.cx - dx / zoom
    cy = drag.cy - dy / zoom
  })
  const endDrag = (e: PointerEvent) => {
    if (!drag || e.pointerId !== drag.id) return
    if (!drag.moved && e.type === 'pointerup') {
      const r = canvas.getBoundingClientRect()
      walkTo(screenToWorld(e.clientX - r.left, e.clientY - r.top))
    }
    drag = null
    canvas.classList.remove('dragging')
  }
  canvas.addEventListener('pointerup', endDrag)
  canvas.addEventListener('pointercancel', endDrag)
  canvas.addEventListener(
    'wheel',
    e => {
      e.preventDefault()
      const r = canvas.getBoundingClientRect()
      const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY
      // pellizco del trackpad = ctrlKey con pasos chicos; ruedita del mouse = pasos de ~100
      setZoom(zoomRel * Math.exp(-dy * (e.ctrlKey ? 0.01 : 0.0015)), {sx: e.clientX - r.left, sy: e.clientY - r.top})
    },
    {passive: false}
  )
  // Safari no manda el pellizco como rueda, sino como "gesture"
  type Gesture = Event & {scale: number; clientX: number; clientY: number}
  let gestureBase = 1
  canvas.addEventListener('gesturestart', e => {
    e.preventDefault()
    gestureBase = zoomRel
  })
  canvas.addEventListener('gesturechange', e => {
    e.preventDefault()
    const g = e as Gesture
    const r = canvas.getBoundingClientRect()
    setZoom(gestureBase * g.scale, {sx: g.clientX - r.left, sy: g.clientY - r.top})
  })

  // ── bucle ──
  const SPEED = 230
  let lastT = performance.now()
  let lastSlow = 0
  const lastPos = {x: pos.x, y: pos.y}

  /**
   * Mueve el avatar `dt` segundos: con las teclas o siguiendo el camino de un clic / "ir a".
   * Con la pestaña oculta el navegador pausa el dibujo (requestAnimationFrame), así que el latido
   * de segundo plano lo llama en pasos cortos para que una caminata en curso siga y llegue.
   */
  function move(dt: number) {
    let dx = 0
    let dy = 0
    for (const k of keys) {
      dx += MOVE_KEYS[k][0]
      dy += MOVE_KEYS[k][1]
    }
    let stepScale = 1 // para frenar justo en cada punto del camino, sin pasarse
    if (!dx && !dy && route.length) {
      while (route.length && Math.hypot(route[0].x - pos.x, route[0].y - pos.y) < 1) route.shift()
      if (route.length) {
        const tx = route[0].x - pos.x
        const ty = route[0].y - pos.y
        const dist = Math.hypot(tx, ty)
        dx = tx / dist
        dy = ty / dist
        stepScale = Math.min(1, dist / (SPEED * dt))
      }
    }
    moving = false
    if (dx || dy) {
      const len = Math.hypot(dx, dy)
      const vx = (dx / len) * SPEED * dt * stepScale
      const vy = (dy / len) * SPEED * dt * stepScale
      const ox = pos.x
      const oy = pos.y
      if (!collides(pos.x + vx, pos.y)) pos.x += vx
      if (!collides(pos.x, pos.y + vy)) pos.y += vy
      moving = pos.x !== ox || pos.y !== oy
      if (!moving) route = [] // trabado contra algo
      if (moving) {
        walkPhase += dt * 12
        myDir = dirOf(pos.x - ox, pos.y - oy)
      }
    }
  }

  /** Lo que depende de dónde quedó el avatar: cámara, zona (llamada), charla y aviso a los demás. */
  function afterMove(now: number) {
    // si el avatar se movió (caminando, con "ir a" o al escritorio), la cámara lo vuelve a seguir
    if (pos.x !== lastPos.x || pos.y !== lastPos.y) {
      lastPos.x = pos.x
      lastPos.y = pos.y
      setFollow(true)
    }

    const z = zoneAt(pos.x, pos.y)
    const zoneChanged = z !== currentZone
    if (zoneChanged) currentZone = z
    const talkChanged = updateTalk()
    if (zoneChanged) {
      call.setZone(z)
      if (z !== null) {
        const busy = [...net.players.values()].filter(p => p.zone === z && p.status === 'busy')
        for (const b of busy) {
          const n = personById(b.person)?.name ?? 'Alguien'
          toast(b.meeting ? `${n} está en una reunión` : `${n} está ocupado (no molestar)`, [], b.meeting ? 'calendar' : 'moon')
        }
      }
    } else if (talkChanged) {
      call.reconcile()
    }
    if (zoneChanged || talkChanged) {
      document.title = z !== null || talking.size ? '● En llamada — Oficina virtual' : 'Oficina virtual'
      renderRoster()
    }

    net.update(myState(), now)
  }

  function step(now: number) {
    const dt = Math.min(0.05, (now - lastT) / 1000)
    lastT = now
    move(dt)
    afterMove(now)

    // interpolación de los demás. Si avisan de a ratos (su pestaña está oculta y el navegador deja
    // un latido por segundo), caminan parejo hacia el último punto en vez de avanzar a saltos.
    const k = 1 - Math.pow(0.0001, dt)
    for (const p of net.players.values()) {
      const ex = p.x - p.rx
      const ey = p.y - p.ry
      const d = Math.hypot(ex, ey)
      if (p.gap > 400 && d > 0 && d < SPEED * 2) {
        const s = Math.min(d, SPEED * 1.1 * dt)
        p.rx += (ex / d) * s
        p.ry += (ey / d) * s
      } else {
        p.rx += ex * k
        p.ry += ey * k
      }
    }

    if (now - lastSlow > 1000) {
      lastSlow = now
      renderNetStatus()
      refreshStatus()
      net.prune(now)
      call.tick()
      board.sync()
    }

    updateCamera(dt)
    draw(now)
    requestAnimationFrame(step)
  }

  if (DEBUG) (window as unknown as {__ov: unknown}).__ov = {pos, zone: () => currentZone, talking, net, call, board, walkTo}

  /**
   * ¿Con quién estoy lo bastante cerca para charlar? Solo fuera de cubículos y salas, en el mismo
   * ambiente (no a través de paredes) y si los dos están disponibles: ni ocupados ni ausentes
   * (así nadie le prende la cámara a alguien que no está en la compu). Devuelve si cambió algo.
   */
  function updateTalk(): boolean {
    let changed = false
    const free = currentZone === null && status === 'available'
    const myArea = areaAt(pos.x, pos.y)
    for (const p of net.players.values()) {
      const can = free && p.zone === null && p.status === 'available' && areaAt(p.x, p.y) === myArea
      const near = can && Math.hypot(p.x - pos.x, p.y - pos.y) < (talking.has(p.peerId) ? TALK_OUT : TALK_IN)
      if (near === talking.has(p.peerId)) continue
      if (near) talking.add(p.peerId)
      else talking.delete(p.peerId)
      changed = true
    }
    for (const id of talking) {
      if (!net.players.has(id)) {
        talking.delete(id)
        changed = true
      }
    }
    return changed
  }

  function myState() {
    return {
      person: me.id,
      x: Math.round(pos.x),
      y: Math.round(pos.y),
      zone: currentZone,
      mic: call.micOn,
      cam: call.sendingVideo,
      screen: call.sharingScreen,
      meeting: status === 'busy' && inMeeting(),
      board: board.presentingState,
      status
    }
  }

  // latido aunque la pestaña esté en segundo plano (rAF se pausa ahí): sigue la caminata en curso,
  // en pasos cortos (para no atravesar paredes) por todo el tiempo que pasó desde el último
  // (el navegador espacia estos latidos: 1 s, o más si la pestaña lleva mucho oculta)
  setInterval(() => {
    if (document.hidden) {
      const now = performance.now()
      let left = Math.min(120, (now - lastT) / 1000)
      lastT = now
      while (left > 0 && route.length) {
        const d = Math.min(0.05, left)
        move(d)
        left -= d
      }
      moving = false
      afterMove(now)
      refreshStatus()
      net.prune(now)
      updateTalk()
      call.tick()
      board.sync()
    }
  }, 1000)

  // ── dibujo ──
  function draw(now: number) {
    ctx.save()
    ctx.fillStyle = '#020003'
    ctx.fillRect(0, 0, vw, vh)
    ctx.scale(zoom, zoom)
    ctx.translate(-camX, -camY)

    simpleView = isSimple()
    plateK = Math.max(1, UI_MIN / zoom)
    uiK = simpleView ? plateK : 1
    if (simpleView) drawSimpleMap(ctx, baseArt * zoomNow, light)
    else drawScene()

    // ocupación de cada escritorio y quién está conectado
    const occupancy = new Map<number, number>()
    const bump = (z: number | null) => z && occupancy.set(z, (occupancy.get(z) ?? 0) + 1)
    bump(currentZone)
    for (const p of net.players.values()) bump(p.zone)
    const online = new Set([me.id, ...[...net.players.values()].map(p => p.person)])

    for (const d of DESKS) drawDeskState(d.num, occupancy.get(d.num) ?? 0, !!deskOwner(d.num) && online.has(deskOwner(d.num)!.id), now)
    for (const d of DESKS) drawPlate(d.num)
    for (const r of ROOMS) drawRoom(r, occupancy.get(r.id) ?? 0, now)
    for (const a of AREAS) drawRoomPlate(a.name.toUpperCase(), 'SIN SALA · CHARLA POR CERCANÍA', a.plate.x, a.plate.y, false)

    const all: {x: number; y: number; person: Person | undefined; self: boolean; moving: boolean; status: Status; dir: Dir}[] = []
    for (const p of net.players.values()) {
      const vx = p.x - p.rx
      const vy = p.y - p.ry
      const mov = Math.hypot(vx, vy) > 1
      if (mov) remoteDir.set(p.peerId, dirOf(vx, vy))
      all.push({
        x: p.rx,
        y: p.ry,
        person: personById(p.person),
        self: false,
        moving: mov,
        status: p.status,
        dir: remoteDir.get(p.peerId) ?? 'down'
      })
    }
    all.push({x: pos.x, y: pos.y, person: me, self: true, moving, status, dir: myDir})
    drawTalks(now)
    all.sort((a, b) => a.y - b.y)
    for (const a of all) drawAvatar(a.x, a.y, a.person, a.self, a.moving, now, a.status, a.dir)
    for (const a of all) {
      const b = a.person && bubbles.get(a.person.id)
      if (b && b.until > now) scaled(uiK, a.x, a.y, () => drawBubble(a.x, a.y, b.text))
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
          ctx.fillText(r.emoji, a.x, a.y - (assets && !simpleView ? 126 : 58 * uiK) - age / 45)
          ctx.restore()
        }
      }
    }

    if (DEBUG) {
      ctx.strokeStyle = 'rgba(255,0,80,0.9)'
      ctx.lineWidth = 1
      for (const r of SOLIDS) ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1)
      ctx.strokeStyle = 'rgba(0,255,160,0.7)'
      for (const d of DESKS) ctx.strokeRect(d.zone.x + 2, d.zone.y + 2, d.zone.w - 4, d.zone.h - 4)
      // alcance de la charla por cercanía
      ctx.beginPath()
      ctx.arc(pos.x, pos.y, TALK_IN, 0, Math.PI * 2)
      ctx.stroke()
    }

    const goal = route[route.length - 1]
    if (goal) {
      ctx.strokeStyle = 'rgba(150,88,47,0.9)'
      ctx.lineWidth = 1.5
      ctx.beginPath()
      ctx.arc(goal.x, goal.y, 8, 0, Math.PI * 2)
      ctx.stroke()
    }
    ctx.restore()
  }

  // Paleta del mapa (marca: negro violáceo, líneas finas, acento bronce)
  const C = {
    void: '#020003',
    floor: '#0f0c13',
    dot: 'rgba(255,255,255,0.09)',
    wall: '#1b1720',
    hair: 'rgba(255,255,255,0.08)',
    bronze: '#96582f',
    warm: '#fa4616',
    table: '#1e1a23',
    chair: '#2c2732',
    text: '#ffffff',
    muted: 'rgba(255,255,255,0.55)',
    subtle: 'rgba(255,255,255,0.38)'
  }
  const SANS = '"Space Grotesk", system-ui, sans-serif'
  const MONO = '"JetBrains Mono", ui-monospace, monospace'
  function spaced(px: number) {
    // letterSpacing existe en Chrome/Edge/Firefox recientes; en otros se ignora
    ;(ctx as CanvasRenderingContext2D & {letterSpacing?: string}).letterSpacing = `${px}px`
  }

  // Decorado pixel art (estático, se arma una vez) — ver src/scene
  let assets: Assets | null = null
  let scene = buildScene(null, light)
  // Si al abrir falla alguna imagen (un corte de red), se reintenta sola en vez de quedar con círculos
  // toda la sesión: a los 5 s, 15 s, 30 s, 1 min y después cada 2 min, hasta tener todo.
  void (async () => {
    for (let i = 0; ; i++) {
      const a = await loadAssets()
      const have = (x: Assets | null) => (x ? 1 + Object.keys(x.characters).length : 0)
      if (a && have(a) > have(assets)) {
        assets = a
        scene = buildScene(a, light)
      }
      if (assets && Object.keys(assets.characters).length >= SPRITE_COUNT) return
      netLog(`Imágenes incompletas (${assets ? Object.keys(assets.characters).length : 0}/${SPRITE_COUNT} personajes${assets ? '' : ', sin muebles'}): reintento`)
      await new Promise(r => setTimeout(r, ([5, 15, 30, 60][i] ?? 120) * 1000))
    }
  })()
  applyLight() // marca en el menú la luz elegida

  function drawScene() {
    ctx.imageSmoothingEnabled = false
    ctx.drawImage(scene, 0, 0, WORLD.w, WORLD.h)
    ctx.imageSmoothingEnabled = true
  }

  /** Capa dinámica de cada escritorio: pantallas, llamada en curso. */
  function drawDeskState(n: number, people: number, ownerOnline: boolean, now: number) {
    const d = deskByNum(n)
    const owner = deskOwner(n)
    const z = d.zone
    const t = d.tableP
    // pantallas: se encienden cuando el dueño está conectado
    if (owner && ownerOnline) {
      const screens = [t.x + t.w / 2 - 13, t.x + t.w / 2 + 2]
      ctx.save()
      for (const sx of screens) {
        ctx.fillStyle = hexA(owner.color, 0.95)
        ctx.fillRect(sx * PX, (t.y + 2) * PX, 11 * PX, 6 * PX)
        ctx.fillStyle = 'rgba(255,255,255,0.35)'
        ctx.fillRect(sx * PX, (t.y + 2) * PX, 11 * PX, PX)
        ctx.fillRect((sx + 2) * PX, (t.y + 4) * PX, 5 * PX, PX)
      }
      ctx.globalCompositeOperation = 'lighter'
      const gx = (t.x + t.w / 2) * PX
      const gy = (t.y + 5) * PX
      const grad = ctx.createRadialGradient(gx, gy, 0, gx, gy, 70)
      grad.addColorStop(0, hexA(owner.color, 0.35))
      grad.addColorStop(1, hexA(owner.color, 0))
      ctx.fillStyle = grad
      ctx.fillRect(gx - 70, gy - 70, 140, 140)
      ctx.restore()
    }
    // llamada en curso (2+ personas): luz cálida en el cubículo
    if (people >= 2) {
      ctx.save()
      const pulse = 0.08 + Math.sin(now / 400) * 0.025
      ctx.fillStyle = `rgba(255,140,60,${pulse})`
      ctx.fillRect(z.x, z.y, z.w, z.h)
      ctx.strokeStyle = 'rgba(250,70,22,0.7)'
      ctx.shadowColor = 'rgba(250,70,22,0.9)'
      ctx.shadowBlur = 14
      ctx.lineWidth = 2
      ctx.strokeRect(z.x + 4, z.y + 4, z.w - 8, z.h - 8)
      ctx.restore()
      const label = `● ${people} EN LLAMADA`
      ctx.font = `600 10px ${MONO}`
      spaced(1.6)
      const w = ctx.measureText(label).width + 14
      const bx = z.x + z.w / 2
      const by = d.top ? d.door.y * PX - 34 : z.y + 10
      roundRect(bx - w / 2, by, w, 18, 9)
      ctx.fillStyle = 'rgba(10,8,12,0.85)'
      ctx.fill()
      ctx.fillStyle = C.warm
      ctx.textAlign = 'center'
      ctx.fillText(label, bx + 0.8, by + 12.5)
      spaced(0)
    }
  }

  /**
   * Charlas por cercanía: línea punteada cálida entre quienes están hablando y un brillo a sus pies.
   * Las mías salen de `talking`; las de los demás se estiman con sus posiciones.
   */
  function drawTalks(now: number) {
    type Dot = {id: string; x: number; y: number; zone: number | null; status: Status; area: string | null}
    const dots: Dot[] = [{id: 'me', x: pos.x, y: pos.y, zone: currentZone, status, area: areaAt(pos.x, pos.y)}]
    for (const p of net.players.values()) {
      dots.push({id: p.peerId, x: p.rx, y: p.ry, zone: p.zone, status: p.status, area: areaAt(p.x, p.y)})
    }
    const pairs: [Dot, Dot][] = []
    for (let i = 0; i < dots.length; i++) {
      for (let j = i + 1; j < dots.length; j++) {
        const a = dots[i]
        const b = dots[j]
        const linked =
          a.id === 'me'
            ? talking.has(b.id)
            : a.zone === null && b.zone === null && a.status === 'available' && b.status === 'available' &&
              a.area === b.area && Math.hypot(a.x - b.x, a.y - b.y) < TALK_IN
        if (linked) pairs.push([a, b])
      }
    }
    if (!pairs.length) return
    const pulse = 0.55 + Math.sin(now / 400) * 0.15
    ctx.save()
    const lit = new Set<Dot>()
    for (const [a, b] of pairs) {
      lit.add(a)
      lit.add(b)
    }
    ctx.globalCompositeOperation = light === 'day' ? 'source-over' : 'lighter' // sobre piso claro, 'lighter' no se ve
    for (const d of lit) {
      const fy = d.y + 10
      const g = ctx.createRadialGradient(d.x, fy, 0, d.x, fy, 46)
      g.addColorStop(0, `rgba(255,140,60,${0.32 * pulse})`)
      g.addColorStop(1, 'rgba(255,140,60,0)')
      ctx.fillStyle = g
      ctx.beginPath()
      ctx.ellipse(d.x, fy, 46, 18, 0, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.globalCompositeOperation = 'source-over'
    ctx.strokeStyle = `rgba(250,70,22,${pulse})`
    ctx.shadowColor = 'rgba(250,70,22,0.9)'
    ctx.shadowBlur = 8
    ctx.lineWidth = 2
    ctx.setLineDash([6, 7])
    ctx.lineDashOffset = -now / 60
    for (const [a, b] of pairs) {
      ctx.beginPath()
      ctx.moveTo(a.x, a.y + 10)
      ctx.lineTo(b.x, b.y + 10)
      ctx.stroke()
    }
    ctx.restore()
  }

  /** Sala grupal: brillo cuando hay llamada + cartel con cuántos hay. */
  function drawRoom(r: Room, people: number, now: number) {
    const z = r.zone
    if (people >= 2) {
      ctx.save()
      ctx.fillStyle = `rgba(255,140,60,${0.06 + Math.sin(now / 400) * 0.02})`
      ctx.fillRect(z.x, z.y, z.w, z.h)
      ctx.strokeStyle = 'rgba(250,70,22,0.7)'
      ctx.shadowColor = 'rgba(250,70,22,0.9)'
      ctx.shadowBlur = 14
      ctx.lineWidth = 2
      ctx.strokeRect(z.x + 4, z.y + 4, z.w - 8, z.h - 8)
      ctx.restore()
    }
    const sub = people >= 2 ? `● ${people} EN LLAMADA` : people === 1 ? '1 PERSONA · ENTRÁ PARA HABLAR' : 'LLAMADA GRUPAL · ENTRÁ PARA UNIRTE'
    drawRoomPlate(r.name.toUpperCase(), sub, r.plate.x, r.plate.y, people >= 2)
  }

  function drawRoomPlate(title: string, sub: string, cx: number, cy: number, live: boolean) {
    scaled(plateK, cx, cy, () => drawRoomPlateAt(title, sub, cx, cy, live))
  }
  function drawRoomPlateAt(title: string, sub: string, cx: number, cy: number, live: boolean) {
    ctx.textAlign = 'center'
    ctx.font = `700 13px ${SANS}`
    spaced(-0.2)
    const w1 = ctx.measureText(title).width
    ctx.font = `500 9px ${MONO}`
    spaced(1.6)
    const w2 = ctx.measureText(sub).width
    const w = Math.max(w1, w2) + 26
    const h = 36
    roundRect(cx - w / 2, cy - h / 2, w, h, 10)
    ctx.fillStyle = 'rgba(12,8,16,0.8)'
    ctx.fill()
    ctx.strokeStyle = live ? 'rgba(250,70,22,0.7)' : 'rgba(150,88,47,0.55)'
    ctx.lineWidth = 1
    ctx.stroke()
    ctx.font = `700 13px ${SANS}`
    spaced(-0.2)
    ctx.fillStyle = C.text
    ctx.fillText(title, cx, cy - 2)
    ctx.font = `500 9px ${MONO}`
    spaced(1.6)
    ctx.fillStyle = live ? C.warm : C.muted
    ctx.fillText(sub, cx + 0.8, cy + 11)
    spaced(0)
  }

  /** Cartel con nombre y cargo (dinámico, sale de la configuración). */
  function drawPlate(n: number) {
    const d = deskByNum(n)
    scaled(plateK, d.plate.x, d.plate.y, () => drawPlateAt(n))
  }
  function drawPlateAt(n: number) {
    const d = deskByNum(n)
    const owner = deskOwner(n)
    const name = owner ? owner.name.toUpperCase() : 'LIBRE'
    const role = owner ? owner.role.toUpperCase() : `ESCRITORIO ${String(n).padStart(2, '0')}`
    ctx.textAlign = 'center'
    ctx.font = `700 13px ${SANS}`
    spaced(-0.2)
    const w1 = ctx.measureText(name).width
    ctx.font = `500 9px ${MONO}`
    spaced(1.6)
    const w2 = ctx.measureText(role).width
    const w = Math.max(w1, w2) + 26
    const h = 36
    const x = d.plate.x - w / 2
    const y = d.plate.y - h / 2
    roundRect(x, y, w, h, 10)
    ctx.fillStyle = 'rgba(12,8,16,0.78)'
    ctx.fill()
    ctx.strokeStyle = owner ? hexA(owner.color, 0.45) : C.hair
    ctx.lineWidth = 1
    ctx.stroke()
    ctx.font = `700 13px ${SANS}`
    spaced(-0.2)
    ctx.fillStyle = owner ? C.text : C.subtle
    ctx.fillText(name, d.plate.x, y + 16)
    ctx.font = `500 9px ${MONO}`
    spaced(1.6)
    ctx.fillStyle = owner ? C.muted : C.subtle
    ctx.fillText(role, d.plate.x + 0.8, y + 29)
    spaced(0)
  }

  function drawAvatar(
    x: number,
    y: number,
    p: Person | undefined,
    self: boolean,
    mov: boolean,
    now: number,
    st: Status,
    dir: Dir
  ) {
    const sheet = p && assets?.characters[p.sprite]
    if (!sheet || simpleView) return scaled(uiK, x, y, () => drawAvatarCircle(x, y, p, self, mov, now, st))
    // pies en (x, y + 12). Todos los personajes miden lo mismo: el cuerpo de BODY_H píxeles de
    // arte (×PX). Los de LimeZu (16×32) quedan ×PX; los propios, con píxeles más finos.
    const feet = y + 12
    const fr = frameOf(p.sprite)
    const k = (BODY_H * PX) / fr.body
    const w = fr.w * k
    const h = fr.h * k
    ctx.save()
    if (st === 'away') ctx.globalAlpha = 0.5
    // sombra y aro propio
    ctx.fillStyle = 'rgba(0,0,0,0.45)'
    ctx.beginPath()
    ctx.ellipse(x, feet - 2, 17, 6, 0, 0, Math.PI * 2)
    ctx.fill()
    if (self) {
      ctx.save()
      ctx.shadowColor = 'rgba(150,88,47,0.95)'
      ctx.shadowBlur = 14
      ctx.strokeStyle = 'rgba(150,88,47,0.95)'
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.ellipse(x, feet - 2, 22, 8, 0, 0, Math.PI * 2)
      ctx.stroke()
      ctx.restore()
    }
    const row = mov ? 0 : 1
    // un paso completo dura 0,6 s tenga los cuadros que tenga (LimeZu: 6 cuadros → 10 por segundo)
    const fps = mov ? fr.frames / 0.6 : 6
    const frame = Math.floor(now / (1000 / fps)) % fr.frames
    const sx = (DIR_INDEX[dir] * fr.frames + frame) * fr.w
    ctx.imageSmoothingEnabled = false
    ctx.drawImage(sheet, sx, row * fr.h, fr.w, fr.h, Math.round(x - w / 2), Math.round(feet - h), w, h)
    ctx.imageSmoothingEnabled = true
    // etiqueta con el nombre y el estado
    const name = (self ? 'Vos' : (p?.name.split(' ')[0] ?? 'Invitado')).toUpperCase()
    ctx.font = `500 9px ${MONO}`
    spaced(1.4)
    const tw = ctx.measureText(name).width + 26
    const ty = feet - FRAME.h * PX - 4 // misma altura para todos (no depende del cuadro)
    roundRect(x - tw / 2, ty - 16, tw, 18, 9)
    ctx.fillStyle = 'rgba(10,8,12,0.85)'
    ctx.fill()
    ctx.strokeStyle = self ? 'rgba(150,88,47,0.8)' : C.hair
    ctx.lineWidth = 1
    ctx.stroke()
    ctx.globalAlpha = 1
    ctx.fillStyle = STATUS_COLOR[st]
    ctx.beginPath()
    ctx.arc(x - tw / 2 + 9, ty - 7, 3.5, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = '#fff'
    ctx.textAlign = 'center'
    ctx.fillText(name, x + 5.7, ty - 3.5)
    spaced(0)
    ctx.restore()
  }

  function drawAvatarCircle(
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
    if (st === 'away') ctx.globalAlpha = 0.45
    // sombra difusa del color de acento
    ctx.fillStyle = 'rgba(0,0,0,0.45)'
    ctx.beginPath()
    ctx.ellipse(x, y + 15, 13, 4, 0, 0, Math.PI * 2)
    ctx.fill()
    if (self) {
      ctx.save()
      ctx.shadowColor = 'rgba(150,88,47,0.9)'
      ctx.shadowBlur = 16
      ctx.strokeStyle = 'rgba(150,88,47,0.9)'
      ctx.lineWidth = 1.5
      ctx.beginPath()
      ctx.arc(x, y - bob, 21, 0, Math.PI * 2)
      ctx.stroke()
      ctx.restore()
    }
    ctx.fillStyle = color
    ctx.beginPath()
    ctx.arc(x, y - bob, 16, 0, Math.PI * 2)
    ctx.fill()
    ctx.lineWidth = 2
    ctx.strokeStyle = C.void
    ctx.stroke()
    ctx.fillStyle = '#fff'
    ctx.textAlign = 'center'
    ctx.font = `700 12px ${SANS}`
    ctx.fillText(initials(p?.name ?? '?'), x, y - bob + 4)
    // etiqueta con el nombre (vidrio oscuro)
    const name = (self ? 'Vos' : (p?.name.split(' ')[0] ?? 'Invitado')).toUpperCase()
    ctx.font = `500 9px ${MONO}`
    spaced(1.4)
    const w = ctx.measureText(name).width + 16
    roundRect(x - w / 2, y - bob - 44, w, 18, 9)
    ctx.fillStyle = 'rgba(10,8,12,0.82)'
    ctx.fill()
    ctx.strokeStyle = self ? 'rgba(150,88,47,0.7)' : C.hair
    ctx.lineWidth = 1
    ctx.stroke()
    ctx.fillStyle = '#fff'
    ctx.fillText(name, x + 0.7, y - bob - 31.5)
    spaced(0)
    // indicador de estado
    ctx.globalAlpha = 1
    ctx.fillStyle = STATUS_COLOR[st]
    ctx.beginPath()
    ctx.arc(x + 12, y - bob + 11, 5, 0, Math.PI * 2)
    ctx.fill()
    ctx.lineWidth = 2
    ctx.strokeStyle = C.void
    ctx.stroke()
    ctx.restore()
  }

  function drawBubble(x: number, y: number, text: string) {
    const t = text.length > 60 ? text.slice(0, 60) + '…' : text
    ctx.font = `500 13px ${SANS}`
    const w = Math.min(260, ctx.measureText(t).width + 22)
    const h = 28
    const bx = x - w / 2
    const by = y - (assets && !simpleView ? 140 : 86)
    ctx.fillStyle = '#ffffff'
    roundRect(bx, by, w, h, 10)
    ctx.fill()
    ctx.beginPath()
    ctx.moveTo(x - 6, by + h)
    ctx.lineTo(x, by + h + 7)
    ctx.lineTo(x + 6, by + h)
    ctx.fill()
    ctx.fillStyle = C.void
    ctx.textAlign = 'center'
    ctx.save()
    ctx.beginPath()
    ctx.rect(bx + 8, by, w - 16, h)
    ctx.clip()
    ctx.fillText(t, x, by + 18.5)
    ctx.restore()
  }

  /** Dibuja `fn` agrandado `k` veces alrededor de (x, y). */
  function scaled(k: number, x: number, y: number, fn: () => void) {
    if (k === 1) return fn()
    ctx.save()
    ctx.translate(x, y)
    ctx.scale(k, k)
    ctx.translate(-x, -y)
    fn()
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
        ? `Sin conexión a la red (0/${total}). Revisá internet o desactivá bloqueadores de anuncios.`
        : `Conectado a ${open} de ${total} servidores · ves a ${peers} ${peers === 1 ? 'persona' : 'personas'}.`
    $('net-status').dataset.ok = open === 0 ? '0' : '1'
    const online = new Set([...net.players.values()].map(p => p.person))
    $('team-count').textContent = String(online.size + 1)
  }

  // ── diagnóstico de conexión (Ajustes → Conexión) ──
  const TURN_NOTE: Record<string, string> = {
    no_configurado: 'todavía no está configurado',
    'sin Dashboard': 'no se usa en pruebas locales',
    no_autorizado: 'el servidor no reconoció la clave de la oficina',
    'tardó demasiado': 'no respondió a tiempo',
    'error de red': 'no se pudo consultar'
  }
  const turnText = () =>
    turn.source === 'ninguno'
      ? `Servidor de respaldo: ${TURN_NOTE[turn.note] || turn.note || 'no configurado'}. Las conexiones van solo directo.`
      : 'Servidor de respaldo: activo (se usa solo si la conexión directa falla).'
  /** Conexión con cada uno: directa o por el respaldo, demora, y si llegó su estado (si aparece en el mapa). */
  async function collectLinks() {
    const conns = net.connections()
    const ids = new Set([...Object.keys(conns), ...net.players.keys()])
    const out: {id: string; name: string; inMap: boolean; text: string; kind: string; raw: string}[] = []
    for (const id of ids) {
      const p = net.players.get(id)
      const name = (p && personById(p.person)?.name) ?? (p?.person || `Alguien (${id.slice(0, 6)})`)
      const pc = conns[id]
      if (!pc) {
        out.push({id, name, inMap: !!p, text: 'sin conexión abierta', kind: 'mal', raw: 'sin conexión'})
        continue
      }
      const l = await linkInfo(pc)
      const how = l.path === 'directo' ? 'Directo' : l.path === 'respaldo' ? 'Por el servidor de respaldo' : l.state === 'failed' ? 'Falló la conexión' : 'Conectando…'
      const extra = [l.rtt !== null ? `${l.rtt} ms` : '', p ? '' : 'no aparece en el mapa'].filter(Boolean).join(' · ')
      out.push({
        id,
        name,
        inMap: !!p,
        text: extra ? `${how} · ${extra}` : how,
        kind: !p || l.state === 'failed' ? 'mal' : (l.path ?? ''),
        raw: `${l.state} · ${l.path ?? 'sin camino'} (${l.kinds || '-'}) · ${l.rtt ?? '-'} ms`
      })
    }
    return out
  }
  let linksBusy = false
  async function renderLinks() {
    if ($('settings').hidden || linksBusy) return
    linksBusy = true
    try {
      $('net-turn').textContent = turnText()
      const links = await collectLinks()
      $('net-links').replaceChildren(
        ...links.map(l => {
          const li = document.createElement('li')
          li.dataset.k = l.kind
          const b = document.createElement('b')
          b.textContent = l.name
          const sp = document.createElement('span')
          sp.textContent = l.text
          li.append(b, sp)
          return li
        })
      )
    } finally {
      linksBusy = false
    }
  }
  setInterval(() => void renderLinks(), 2000)
  $('btn-diag').onclick = async () => {
    const {open, total} = net.relayStatus()
    const links = await collectLinks()
    const lines = [
      'Oficina virtual — diagnóstico',
      `Fecha: ${new Date().toLocaleString('es-AR')}`,
      `Persona: ${me.id} · zona ${currentZone ?? 'pasillo'} · estado ${status}`,
      `Navegador: ${navigator.userAgent}`,
      `Servidores de señalización: ${open}/${total}`,
      `Respaldo (TURN): ${turn.source}${turn.note ? ` (${turn.note})` : ''}`,
      `En llamada: ${$('call').hidden ? 'no' : `sí (${$('call').dataset.layout})`} · imágenes: ${assets ? Object.keys(assets.characters).length : 0}/${SPRITE_COUNT}`,
      `Calidad de cámara: ${call.qualityText}`,
      '',
      'Conexiones:',
      ...(links.length ? links.map(l => `- ${l.name} [${l.id.slice(0, 6)}]: ${l.raw} · en el mapa: ${l.inMap ? 'sí' : 'NO'}`) : ['- (nadie)']),
      '',
      'Eventos:',
      ...netEvents()
    ]
    const text = lines.join('\n')
    try {
      await navigator.clipboard.writeText(text)
      toast('Diagnóstico copiado: pegalo en el chat con quien mantiene la oficina.', [], 'check')
    } catch {
      const ta = document.createElement('textarea')
      ta.value = text
      document.body.append(ta)
      ta.select()
      const ok = document.execCommand('copy')
      ta.remove()
      toast(ok ? 'Diagnóstico copiado.' : 'No se pudo copiar el diagnóstico.', [], ok ? 'check' : 'info')
    }
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
          const px = isMe ? pos.x : rp!.x
          const py = isMe ? pos.y : rp!.y
          const area = areaAt(px, py)
          const where = zone
            ? zone === p.desk
              ? 'en su escritorio'
              : zoneLabel(zone)
            : area
              ? `en la ${area.toLowerCase()}`
              : 'en el pasillo'
          text = `${statusText(st, isMe ? inMeeting() : rp?.meeting)} · ${where}`
        }
        li.innerHTML = `<span class="dot"></span><span class="n"></span><span class="s"></span><span class="acts"></span>`
        const dot = li.querySelector('.dot') as HTMLElement
        dot.style.background = p.color
        if (here && st) dot.style.boxShadow = `0 0 0 2px var(--panel), 0 0 0 4px ${STATUS_COLOR[st]}`
        li.querySelector('.n')!.textContent = isMe ? `${p.name} (vos)` : p.name
        li.querySelector('.s')!.textContent = text
        if (!isMe && rp) {
          const acts = li.querySelector('.acts')!
          const mk = (ic: string, title: string, fn: () => void) => {
            const b = document.createElement('button')
            b.className = 'act'
            b.innerHTML = icon(ic, 16)
            b.title = title
            b.onclick = e => {
              e.stopPropagation()
              fn()
            }
            acts.appendChild(b)
          }
          mk('wave', `Saludar a ${p.name}`, () => wave(p.id))
          mk('message', `Mensaje a ${p.name}`, () => chat.openDM(p.id))
          mk('pin', `Ir hasta ${p.name}`, () => goTo(p.id))
        }
        return li
      })
    )
  }
  renderRoster()

  // ── avisos ──
  function knock(p: RemotePlayer) {
    const who = personById(p.person)?.name ?? 'Alguien'
    addActivity('door', `${who} pasó por tu escritorio`, goHome, true)
    if (status === 'busy') {
      toast(`${who} pasó por tu escritorio (estás en no molestar)`, [{label: 'Ir a mi escritorio', fn: goHome}], 'door')
      return
    }
    beep()
    toast(`${who} está en tu escritorio`, [{label: 'Ir a mi escritorio', fn: goHome}], 'door')
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

  // ── mini ventana (flota sobre otras pestañas; ver src/mini.ts) ──
  const mini = new MiniWindow({
    me,
    pos: () => pos,
    zone: () => currentZone,
    status: () => status,
    meeting: () => status === 'busy' && inMeeting(),
    players: () => net.players.values(),
    talking: () => talking,
    sameArea: (x, y) => areaAt(x, y) === areaAt(pos.x, pos.y),
    where: () => whereLabel(),
    light: () => light,
    talkIn: TALK_IN,
    call,
    setBusy: busy => setManualStatus(busy ? 'busy' : 'available'),
    onChange: open => {
      $('btn-mini').classList.toggle('on', open)
      $('btn-mini').title = open ? 'Cerrar la mini ventana (P)' : 'Mini ventana (P)'
    }
  })
  function toggleMini() {
    if (!miniSupported()) {
      toast('La mini ventana funciona en Chrome y Edge (Safari y Firefox todavía no la tienen).', [], 'info')
      return
    }
    mini.toggle()
  }
  function whereLabel() {
    if (currentZone === me.desk) return 'En tu escritorio'
    if (currentZone !== null) return zoneLabel(currentZone)
    const area = areaAt(pos.x, pos.y)
    return area ? `En la ${area.toLowerCase()}` : 'En el pasillo'
  }
  $('btn-mini').onclick = () => toggleMini()
  // Chrome la abre sola si cambiás de pestaña en medio de una llamada (cámara o micrófono en uso)
  try {
    navigator.mediaSession?.setActionHandler('enterpictureinpicture' as MediaSessionAction, () => void mini.open(true))
  } catch {
    /* este navegador no tiene esa acción */
  }
  document.addEventListener('visibilitychange', () => !document.hidden && mini.onTabVisible())

  // ── calendario de Google (solo si entraste con Google; ver src/calendar.ts) ──
  calendar = new Calendar(auth.calendar, auth.google, {
    changed: () => {
      refreshStatus()
      renderStatusUI() // el "hasta las…" del estado
      if (view === 'calendar') calendar?.render($('cal-body'))
    },
    toast,
    notify
  })

  // ── versión nueva publicada ──
  // La oficina queda abierta todo el día: sin esto, los cambios no le llegan a nadie hasta que
  // recarga. Cada 5 min (y al volver a la pestaña) compara el archivo del programa publicado con
  // el que está corriendo; si cambió, avisa (no recarga sola para no cortar una llamada).
  const runningBuild = document.querySelector<HTMLScriptElement>('script[type="module"][src*="assets/index-"]')?.src.split('/').pop()
  let updateNoticed = false
  async function checkUpdate() {
    if (!runningBuild || updateNoticed) return
    try {
      const html = await (await fetch(`./index.html?v=${Date.now()}`, {cache: 'no-store'})).text()
      const latest = html.match(/assets\/(index-[\w-]+\.js)/)?.[1]
      if (!latest || latest === runningBuild) return
      updateNoticed = true
      toast(
        'Hay una versión nueva de la oficina.',
        [
          {label: 'Actualizar', fn: () => location.reload()},
          {label: 'Después', fn: () => setTimeout(() => (updateNoticed = false), 30 * 60_000)}
        ],
        'info',
        0
      )
    } catch {
      /* sin conexión: se vuelve a probar más tarde */
    }
  }
  setInterval(() => void checkUpdate(), 5 * 60_000)
  document.addEventListener('visibilitychange', () => !document.hidden && void checkUpdate())

  requestAnimationFrame(step)
}

/** Aviso arriba al centro. `ms` = cuánto dura (0 = queda hasta que se toque un botón). */
function toast(msg: string, actions: {label: string; fn: () => void}[] = [], ic = 'info', ms = 9000) {
  const box = $('toasts')
  const el = document.createElement('div')
  el.className = 'toast'
  const i = document.createElement('i')
  i.className = 'toast-ic'
  i.innerHTML = icon(ic, 18)
  el.appendChild(i)
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
  if (ms > 0) setTimeout(() => el.remove(), ms)
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

void bootOffice()
