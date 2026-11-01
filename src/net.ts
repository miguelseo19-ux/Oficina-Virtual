import {getRelaySockets, joinRoom, selfId} from 'trystero'
import {APP_ID, RELAY_URLS, ROOM_ID, TURN_SERVERS} from './config'

export type PlayerState = {
  person: string
  x: number
  y: number
  zone: number | null
  mic: boolean
  cam: boolean
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
}

export class Net {
  readonly room: Room
  readonly selfId = selfId
  readonly players = new Map<string, RemotePlayer>()
  private sendState: (s: PlayerState, opts?: {target?: string}) => Promise<unknown>
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
      Math.abs(this.last.x - s.x) > 0.5 ||
      Math.abs(this.last.y - s.y) > 0.5
    const zoneChanged =
      !this.last || this.last.zone !== s.zone || this.last.mic !== s.mic || this.last.cam !== s.cam
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

  /** Cuántos servidores de señalización están conectados. */
  relayStatus(): {open: number; total: number} {
    const socks = Object.values((getRelaySockets() ?? {}) as Record<string, WebSocket>)
    return {open: socks.filter(w => w?.readyState === WebSocket.OPEN).length, total: socks.length}
  }

  leave() {
    void this.room.leave()
  }
}
