import {getRelaySockets, joinRoom, selfId} from 'trystero'
import {APP_ID, RELAY_URLS, ROOM_ID, TURN_SERVERS} from './config'

export type Status = 'available' | 'busy' | 'away'

export type PlayerState = {
  person: string
  x: number
  y: number
  zone: number | null
  mic: boolean
  cam: boolean
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
  onLeave: (peerId: string) => void
  onStream: (stream: MediaStream, peerId: string) => void
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
  private last: PlayerState | null = null
  private lastSentAt = 0

  constructor(password: string, private ev: NetEvents) {
    // ?relay=wss://... permite probar con un relay propio sin recompilar
    const override = new URLSearchParams(location.search).getAll('relay')
    const urls = override.length ? override : RELAY_URLS
    this.room = joinRoom(
      {
        appId: APP_ID,
        password,
        ...(urls.length ? {relayConfig: {urls}} : {}),
        ...(TURN_SERVERS.length ? {turnConfig: TURN_SERVERS} : {})
      },
      ROOM_ID,
      {
        onJoinError: d => {
          const e = String(d.error ?? '')
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

    this.room.onPeerJoin = peerId => {
      if (this.last) void this.sendState(this.last, {target: peerId})
    }
    this.room.onPeerLeave = peerId => {
      this.players.delete(peerId)
      ev.onLeave(peerId)
    }
    this.room.onPeerStream = (stream, peerId) => ev.onStream(stream, peerId)
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
      this.last.status !== s.status ||
      Math.abs(this.last.x - s.x) > 0.5 ||
      Math.abs(this.last.y - s.y) > 0.5
    const zoneChanged =
      !this.last ||
      this.last.zone !== s.zone ||
      this.last.mic !== s.mic ||
      this.last.cam !== s.cam ||
      this.last.status !== s.status
    if ((changed && now - this.lastSentAt > 80) || zoneChanged || now - this.lastSentAt > 2000) {
      this.last = {...s}
      this.lastSentAt = now
      void this.sendState(this.last)
    }
  }

  /** Borra jugadores sin señales por 90s (respaldo si la conexión no avisó al cerrarse). */
  prune(now: number) {
    for (const [id, p] of this.players) {
      if (now - p.lastSeen > 90_000) {
        this.players.delete(id)
        this.ev.onLeave(id)
      }
    }
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
