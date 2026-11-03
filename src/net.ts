import {getRelaySockets, joinRoom, selfId} from 'trystero'
import {APP_ID, RELAY_URLS, ROOM_ID} from './config'
import {netLog} from './diag'

export type Status = 'available' | 'busy' | 'away'

export type PlayerState = {
  person: string
  x: number
  y: number
  zone: number | null
  mic: boolean
  cam: boolean
  screen?: boolean // compartiendo pantalla (va como otra transmisión, con metadata {screen: true})
  meeting?: boolean // en una reunión de su calendario de Google (status 'busy' + esto = "En reunión")
  status: Status
}

export type ChatMsg = {
  id: string
  ch: 'general' | 'nearby' | 'dm'
  from: string // person id
  to: string | null // person id (solo dm)
  text: string
  ts: number
}

export type RemotePlayer = PlayerState & {
  peerId: string
  // posición dibujada (interpolada hacia x/y)
  rx: number
  ry: number
  lastSeen: number
}

type Room = ReturnType<typeof joinRoom>

export interface NetEvents {
  onPlayer: (p: RemotePlayer, prevZone: number | null | undefined) => void
  /** se conectó (o se volvió a conectar) con alguien: hay que volver a mandarle cámara y pantalla */
  onJoin: (peerId: string) => void
  onLeave: (peerId: string) => void
  onStream: (stream: MediaStream, peerId: string, meta?: unknown) => void
  onError: (msg: string) => void
  onChat: (msg: ChatMsg, peerId: string) => void
  onWave: (fromPerson: string, peerId: string) => void
  onReact: (fromPerson: string, emoji: string) => void
}

export class Net {
  readonly room: Room
  readonly selfId = selfId
  readonly players = new Map<string, RemotePlayer>()
  private sendState: (s: PlayerState, opts?: {target?: string}) => Promise<unknown>
  private chatAction: {send: (m: ChatMsg, opts?: {target?: string | string[]}) => Promise<unknown>}
  private reactAction: {send: (m: {from: string; emoji: string}) => Promise<unknown>}
  private waveAction: {send: (m: {from: string}, opts?: {target?: string | string[]}) => Promise<unknown>}
  private askAction: {send: (m: 1, opts?: {target?: string | string[]}) => Promise<unknown>}
  private asked = new Map<string, number>()
  private last: PlayerState | null = null
  private lastSentAt = 0

  /** `turn`: servidores de respaldo (ver turn.ts); vacío = solo conexión directa. */
  constructor(password: string, turn: RTCIceServer[], private ev: NetEvents) {
    // ?relay=wss://... permite probar con un relay propio sin recompilar
    const override = new URLSearchParams(location.search).getAll('relay')
    const urls = override.length ? override : RELAY_URLS
    this.room = joinRoom(
      {
        appId: APP_ID,
        password,
        ...(urls.length ? {relayConfig: {urls}} : {}),
        ...(turn.length ? {turnConfig: turn} : {})
      },
      ROOM_ID,
      {
        onJoinError: d => {
          const e = String(d.error ?? '')
          netLog(`Error al conectar: ${e.slice(0, 160)}`)
          ev.onError(
            /password|decrypt/i.test(e)
              ? 'Alguien intentó conectarse con otra clave de oficina.'
              : 'No se pudo conectar con un compañero (puede ser la red). Ver README.'
          )
        }
      }
    )

    const action = this.room.makeAction<PlayerState>('state')
    this.sendState = (s, opts) => action.send(s, opts)
    action.onMessage = (data, {peerId}) => this.receive(data, peerId)

    const chat = this.room.makeAction<ChatMsg>('chat')
    chat.onMessage = (m, {peerId}) => {
      if (m && typeof m.text === 'string' && typeof m.from === 'string') ev.onChat(m, peerId)
    }
    this.chatAction = chat

    const wave = this.room.makeAction<{from: string}>('wave')
    wave.onMessage = (m, {peerId}) => {
      if (m && typeof m.from === 'string') ev.onWave(m.from, peerId)
    }
    this.waveAction = wave

    const react = this.room.makeAction<{from: string; emoji: string}>('react')
    react.onMessage = m => {
      if (m && typeof m.from === 'string' && typeof m.emoji === 'string' && m.emoji.length <= 8) ev.onReact(m.from, m.emoji)
    }
    this.reactAction = react

    // "mandame tu estado": para quien está conectado pero no aparece en el mapa
    const ask = this.room.makeAction<1>('ask')
    ask.onMessage = (_, {peerId}) => {
      if (this.last) void this.sendState(this.last, {target: peerId})
    }
    this.askAction = ask

    this.room.onPeerJoin = peerId => {
      netLog(`Conectado con ${short(peerId)}`)
      if (this.last) void this.sendState(this.last, {target: peerId})
      void this.askAction.send(1, {target: peerId})
      ev.onJoin(peerId)
    }
    this.room.onPeerLeave = peerId => {
      netLog(`Se fue ${this.who(peerId)}`)
      this.players.delete(peerId)
      this.asked.delete(peerId)
      ev.onLeave(peerId)
    }
    this.room.onPeerStream = (stream, peerId, meta) => {
      const scr = (meta as {screen?: boolean} | undefined)?.screen === true
      netLog(`Llegó ${scr ? 'la pantalla' : 'la cámara'} de ${this.who(peerId)} (${stream.getTracks().map(t => t.kind).join('+')})`)
      ev.onStream(stream, peerId, meta)
    }
  }

  /** Nombre para el diagnóstico (id corto si todavía no mandó su estado). */
  who(peerId: string) {
    return this.players.get(peerId)?.person ?? short(peerId)
  }

  /** Conexiones abiertas con cada uno (peerId → conexión), para el diagnóstico. */
  connections(): Record<string, RTCPeerConnection> {
    try {
      return this.room.getPeers() as Record<string, RTCPeerConnection>
    } catch {
      return {}
    }
  }

  private receive(s: PlayerState, peerId: string) {
    if (!s || typeof s.x !== 'number' || typeof s.person !== 'string') return
    const prev = this.players.get(peerId)
    const p: RemotePlayer = {
      ...s,
      status: s.status === 'busy' || s.status === 'away' ? s.status : 'available',
      peerId,
      rx: prev?.rx ?? s.x,
      ry: prev?.ry ?? s.y,
      lastSeen: performance.now()
    }
    this.players.set(peerId, p)
    this.ev.onPlayer(p, prev?.zone)
  }

  /** Llamar en cada frame; solo envía si cambió algo (máx ~12/s) o cada 2s como latido. */
  update(s: PlayerState, now: number) {
    const changed =
      !this.last ||
      this.last.zone !== s.zone ||
      this.last.mic !== s.mic ||
      this.last.cam !== s.cam ||
      !!this.last.screen !== !!s.screen ||
      !!this.last.meeting !== !!s.meeting ||
      this.last.status !== s.status ||
      Math.abs(this.last.x - s.x) > 0.5 ||
      Math.abs(this.last.y - s.y) > 0.5
    const zoneChanged =
      !this.last ||
      this.last.zone !== s.zone ||
      this.last.mic !== s.mic ||
      this.last.cam !== s.cam ||
      !!this.last.screen !== !!s.screen ||
      !!this.last.meeting !== !!s.meeting ||
      this.last.status !== s.status
    if ((changed && now - this.lastSentAt > 80) || zoneChanged || now - this.lastSentAt > 2000) {
      this.last = {...s}
      this.lastSentAt = now
      void this.sendState(this.last)
    }
  }

  /**
   * Borra jugadores sin señales por 90s (respaldo si la conexión no avisó al cerrarse). Antes de eso,
   * a quien está conectado pero no mandó su estado (no aparece en el mapa) o lleva >10s callado
   * (el latido es cada 2s) se le pide que lo mande, como mucho cada 5s.
   */
  prune(now: number) {
    for (const [id, p] of this.players) {
      if (now - p.lastSeen > 90_000) {
        netLog(`${p.person} sin señales hace 90 s: lo saco del mapa`)
        this.players.delete(id)
        this.ev.onLeave(id)
      } else if (now - p.lastSeen > 10_000) this.ask(id, now, `${p.person} callado hace ${Math.round((now - p.lastSeen) / 1000)} s`)
    }
    for (const id of Object.keys(this.connections())) {
      if (!this.players.has(id)) this.ask(id, now, `${short(id)} conectado pero sin estado`)
    }
  }

  private ask(id: string, now: number, why: string) {
    if (now - (this.asked.get(id) ?? -Infinity) < 5000) return
    this.asked.set(id, now)
    netLog(`Pido estado: ${why}`)
    void this.askAction.send(1, {target: id}).catch(() => {})
  }

  /** Todas las conexiones (pestañas) de una persona. */
  peersOf(person: string): string[] {
    return [...this.players.values()].filter(p => p.person === person).map(p => p.peerId)
  }

  /** Envía un mensaje de chat; sin `targets` va a todos. */
  sendChat(m: ChatMsg, targets?: string[]) {
    if (targets && targets.length === 0) return
    void this.chatAction.send(m, targets ? {target: targets} : undefined)
  }

  sendWave(from: string, targets: string[]) {
    if (targets.length) void this.waveAction.send({from}, {target: targets})
  }

  sendReact(from: string, emoji: string) {
    void this.reactAction.send({from, emoji})
  }

  /** Cuántos servidores de señalización están conectados. */
  relayStatus(): {open: number; total: number} {
    const socks = Object.values((getRelaySockets() ?? {}) as Record<string, WebSocket>)
    return {open: socks.filter(w => w?.readyState === WebSocket.OPEN).length, total: socks.length}
  }

  leave() {
    void this.room.leave()
  }
}

const short = (peerId: string) => peerId.slice(0, 6)
