import {netLog} from './diag'
import {officeProof} from './turn'

/**
 * Servidor de video (Cloudflare Realtime "Serverless SFU"), para que la llamada aguante 720p.
 *
 * Sin servidor, cada uno manda su cámara a cada uno de los demás (5 envíos en una llamada de 6).
 * Con él, cada uno tiene UNA conexión con Cloudflare: sube su cámara una vez, en tres calidades
 * (simulcast: a = 720p, b = 360p, c = 180p), y baja la de los demás en la calidad que pida según
 * el tamaño en que la ve. Las llamadas a la API pasan por el Dashboard (/api/office/sfu), que
 * guarda el secreto.
 *
 * Cada uno anuncia en su estado su sesión, qué publica y de quiénes ya le está llegando el video
 * por acá (`PlayerState.sfu = {s, t, r}`); quién recibe a quién lo decide la oficina (los de la
 * misma llamada). El cambio de conexión directa a servidor es "conectar antes de cortar": quien
 * manda sigue mandando directo hasta que el otro lo anota en `r`. Todas las negociaciones van en
 * fila (una oferta/respuesta por vez). Si algo falla (la API, la conexión, o una cámara que no
 * llega), se avisa con `onFail` y la llamada vuelve a la conexión directa.
 */

export type TrackName = 'cam' | 'mic' | 'scr' | 'scra'

/** Calidades de la cámara publicadas (de mejor a peor: el servidor cae a la siguiente si falta una). */
export const CAM_LAYERS: RTCRtpEncodingParameters[] = [
  {rid: 'a', scaleResolutionDownBy: 1, maxBitrate: 1_700_000, maxFramerate: 30},
  {rid: 'b', scaleResolutionDownBy: 2, maxBitrate: 500_000, maxFramerate: 30},
  {rid: 'c', scaleResolutionDownBy: 4, maxBitrate: 150_000, maxFramerate: 15}
]
const SCREEN_KBPS = 3000

interface Pull {
  peer: string
  name: TrackName
  remote: string // sesión de quien publica
  mid: string
  rid: string | null
  track: MediaStreamTrack | null
  since: number
  ok: boolean // ya llegaron bytes
}

interface Hooks {
  onTrack: (peer: string, name: TrackName, track: MediaStreamTrack) => void
  onFail: (why: string) => void
  /** Empezó a llegar media de alguna pista pedida (para mostrarla y avisar en el estado). */
  onFlow: () => void
}

type Sdp = {type: 'offer' | 'answer'; sdp: string}
type ApiResp = {
  errorCode?: string
  errorDescription?: string
  sessionId?: string
  requiresImmediateRenegotiation?: boolean
  sessionDescription?: Sdp
  tracks?: {mid?: string; trackName?: string; sessionId?: string; errorCode?: string; errorDescription?: string}[]
}

export class Sfu {
  /** null = sin consultar; false = el Dashboard no lo tiene configurado */
  available: boolean | null = null
  session: string | null = null
  failed: string | null = null
  private pc: RTCPeerConnection | null = null
  private starting: Promise<void> | null = null
  private chain: Promise<unknown> = Promise.resolve()
  private published = new Map<TrackName, {mid: string; tx: RTCRtpTransceiver}>()
  private pulls = new Map<string, Pull>() // `${peer}:${name}`
  private byMid = new Map<string, string>()
  private generation = 0
  private checking = false
  private retryAt = new Map<string, number>() // `${peer}:${name}` → cuándo volver a pedir una pista que falló

  constructor(
    private key: string,
    private iceServers: RTCIceServer[],
    private h: Hooks
  ) {}

  async check() {
    try {
      const r = await fetch('/api/office/sfu', {headers: {'x-office-proof': await officeProof(this.key)}, cache: 'no-store'})
      this.available = r.ok && (r.headers.get('content-type') ?? '').includes('application/json')
    } catch {
      this.available = false
    }
    netLog(`Servidor de video: ${this.available ? 'disponible' : 'no disponible'}`)
    return this.available
  }

  get active() {
    return !!this.session && !this.failed
  }

  /** Lo que va en mi estado: mi sesión, qué publico y de quiénes ya recibo bien por acá. */
  get state(): {s: string; t: TrackName[]; r: string[]} | null {
    return this.active && this.published.size ? {s: this.session!, t: [...this.published.keys()], r: this.receiving()} : null
  }

  /**
   * Personas de las que ya me llega TODO lo que les pido de cámara y micrófono por el servidor.
   * Recién ahí se muestra lo del servidor y se le avisa que corte lo directo: con solo la imagen
   * podría quedarse sin sonido.
   */
  receiving(): string[] {
    const out: string[] = []
    for (const peer of this.peers()) {
      const av = (['cam', 'mic'] as const).map(n => this.pulls.get(`${peer}:${n}`)).filter((p): p is Pull => !!p)
      if (av.length && av.every(p => p.ok)) out.push(peer)
    }
    return out
  }

  /** ¿Ya llega esta pista de esta persona? */
  flowing(peer: string, name: TrackName) {
    const p = this.pulls.get(`${peer}:${name}`)
    return !!p?.ok && !!p.track
  }

  get pulling() {
    return this.pulls.size
  }

  /** ¿Ya publico esta pista? (aunque en este momento esté reemplazándose) */
  has(name: TrackName) {
    return this.published.has(name)
  }

  publishedTrack(name: TrackName) {
    return this.published.get(name)?.tx.sender.track ?? null
  }

  // ── conexión ──

  /**
   * Una llamada a la API (por el Dashboard). Un error general (HTTP o `errorCode` arriba) siempre
   * corta. Con `perTrack` (pedir, cerrar o cambiar pistas de otros), Cloudflare puede contestar bien
   * y marcar error en una sola pista (por ejemplo, de alguien que justo se fue): eso lo resuelve
   * quien llama, no es una falla del servidor.
   */
  private async api(body: Record<string, unknown>, perTrack = false): Promise<ApiResp> {
    const t0 = performance.now()
    const r = await fetch('/api/office/sfu', {
      method: 'POST',
      headers: {'x-office-proof': await officeProof(this.key), 'content-type': 'application/json'},
      body: JSON.stringify(body),
      cache: 'no-store'
    })
    const d = (await r.json().catch(() => ({}))) as ApiResp
    const ms = performance.now() - t0
    if (ms > 2000) netLog(`Servidor de video: ${String(body.op)} tardó ${(ms / 1000).toFixed(1).replace('.', ',')} s`)
    const trackErr = d.tracks?.find(t => t.errorCode)
    const bad = d.errorCode ?? (perTrack ? undefined : trackErr?.errorCode)
    if (!r.ok || bad) throw new Error(`${String(body.op)}: ${bad ?? `HTTP ${r.status}`} ${d.errorDescription ?? trackErr?.errorDescription ?? ''}`.trim())
    if (trackErr) netLog(`Servidor de video: ${String(body.op)}: ${trackErr.errorCode} ${trackErr.errorDescription ?? ''}`.trim())
    return d
  }

  /**
   * Las negociaciones van de a una: si no, las ofertas y respuestas se pisan. Si mientras tanto
   * se cerró la sesión (apagar el servidor, salir de la llamada), el trabajo queda cancelado y
   * su error no cuenta como falla del servidor.
   */
  private queue<T>(job: () => Promise<T>): Promise<T> {
    const gen = this.generation
    const run = this.chain.then(async () => {
      if (gen !== this.generation || this.failed) throw new Error('cancelado')
      try {
        return await job()
      } catch (e) {
        if (gen !== this.generation) throw new Error('cancelado')
        throw e
      }
    })
    this.chain = run.catch(() => {})
    return run
  }

  /** Crea la sesión (una conexión con Cloudflare) si no la hay. */
  start(): Promise<void> {
    if (this.session || this.failed) return Promise.resolve()
    this.starting ??= (async () => {
      const gen = this.generation
      const pc = new RTCPeerConnection({iceServers: [{urls: 'stun:stun.cloudflare.com:3478'}, ...this.iceServers], bundlePolicy: 'max-bundle'})
      this.pc = pc
      pc.ontrack = e => {
        const k = this.byMid.get(e.transceiver.mid ?? '')
        const p = k ? this.pulls.get(k) : undefined
        if (!p) return
        p.track = e.track
        this.h.onTrack(p.peer, p.name, e.track)
      }
      pc.onconnectionstatechange = () => {
        if (pc !== this.pc) return
        netLog(`Servidor de video: conexión ${pc.connectionState}`)
        if (pc.connectionState === 'failed') this.fail('la conexión con el servidor de video falló')
      }
      try {
        const d = await this.api({op: 'session'})
        if (gen !== this.generation) {
          pc.close() // se cerró mientras se creaba: esta sesión ya no sirve
          throw new Error('cancelado')
        }
        if (!d.sessionId) throw new Error('session: sin id')
        this.session = d.sessionId
        netLog(`Servidor de video: sesión ${d.sessionId.slice(0, 8)}`)
      } catch (e) {
        if (gen === this.generation) this.fail(String(e))
        throw e
      } finally {
        if (gen === this.generation) this.starting = null
      }
    })()
    return this.starting
  }

  /** Cierra todo (al salir de la llamada). Se puede volver a empezar. */
  close() {
    this.generation++
    this.retryAt.clear()
    this.pc?.close()
    this.pc = null
    this.starting = null
    this.session = null
    this.published.clear()
    this.pulls.clear()
    this.byMid.clear()
    this.chain = Promise.resolve()
  }

  /** Volver a intentar en la próxima llamada (o al prenderlo a mano) aunque antes haya fallado. */
  reset() {
    this.close()
    this.failed = null
  }

  private fail(why: string) {
    if (this.failed) return
    this.failed = why
    netLog(`Servidor de video falló: ${why.slice(0, 160)} → conexión directa`)
    this.close()
    this.h.onFail(why)
  }

  private async answerOffer(offer: Sdp) {
    const pc = this.pc!
    await pc.setRemoteDescription(offer)
    await pc.setLocalDescription(await pc.createAnswer())
    await this.api({op: 'renegotiate', sesion: this.session, respuesta: pc.localDescription})
  }

  // ── publicar ──

  /** Publica pistas propias (cámara con 3 calidades; el resto, una). */
  publish(items: {name: TrackName; track: MediaStreamTrack}[]) {
    const todo = items.filter(i => !this.published.has(i.name))
    if (!todo.length) return Promise.resolve()
    return this.queue(async () => {
      const pc = this.pc!
      const txs = todo.map(i =>
        pc.addTransceiver(i.track, {
          direction: 'sendonly',
          sendEncodings: i.name === 'cam' ? CAM_LAYERS.map(l => ({...l})) : i.name === 'scr' ? [{maxBitrate: SCREEN_KBPS * 1000}] : undefined
        })
      )
      await pc.setLocalDescription(await pc.createOffer())
      const d = await this.api({op: 'push', sesion: this.session, oferta: pc.localDescription, pistas: txs.map((t, i) => ({mid: t.mid, nombre: todo[i].name}))})
      if (!d.sessionDescription) throw new Error('push: sin respuesta')
      await pc.setRemoteDescription(d.sessionDescription)
      txs.forEach((tx, i) => this.published.set(todo[i].name, {mid: tx.mid!, tx}))
      netLog(`Servidor de video: publico ${todo.map(i => i.name).join(', ')}`)
    }).catch(e => this.onError(e))
  }

  /** Deja de publicar (por ejemplo, la pantalla al dejar de compartir). */
  unpublish(names: TrackName[]) {
    const items = names.map(n => [n, this.published.get(n)] as const).filter((x): x is [TrackName, {mid: string; tx: RTCRtpTransceiver}] => !!x[1])
    if (!items.length) return Promise.resolve()
    for (const [n] of items) this.published.delete(n)
    return this.queue(async () => {
      const pc = this.pc!
      for (const [, p] of items) p.tx.stop()
      await pc.setLocalDescription(await pc.createOffer())
      const d = await this.api({op: 'close', sesion: this.session, mids: items.map(([, p]) => p.mid), oferta: pc.localDescription})
      if (d.sessionDescription?.type === 'answer') await pc.setRemoteDescription(d.sessionDescription)
    }).catch(e => this.onError(e))
  }

  /** Cambiar de cámara o micrófono sin renegociar. */
  async replace(name: TrackName, track: MediaStreamTrack) {
    const p = this.published.get(name)
    if (p) await p.tx.sender.replaceTrack(track).catch(() => {})
  }

  /** Calidad máxima que mando (con "Baja" a mano no se manda la de 720p). */
  setTopLayer(on: boolean) {
    const s = this.published.get('cam')?.tx.sender
    if (!s) return
    const params = s.getParameters()
    if (!params.encodings?.length || params.encodings[0].active === on) return
    params.encodings[0].active = on
    void s.setParameters(params).catch(() => {})
  }

  // ── recibir ──

  /**
   * Deja recibiendo de `peer` exactamente estas pistas (de su sesión `remote`), con la calidad
   * pedida para la cámara. Lo que sobra se cierra.
   */
  want(peer: string, remote: string, names: TrackName[], camRid: string) {
    const add: {name: TrackName; rid: string | null}[] = []
    const drop: Pull[] = []
    for (const [k, p] of this.pulls) {
      if (p.peer !== peer) continue
      if (p.remote !== remote || !names.includes(p.name)) {
        drop.push(p)
        this.pulls.delete(k)
      }
    }
    const now = performance.now()
    for (const n of names) {
      const p = this.pulls.get(`${peer}:${n}`)
      if (!p) {
        if ((this.retryAt.get(`${peer}:${n}`) ?? 0) <= now) add.push({name: n, rid: n === 'cam' ? camRid : null})
      } else if (n === 'cam' && p.rid !== camRid && p.mid) this.updateRid(p, camRid)
    }
    if (drop.length) this.closePulls(drop)
    if (add.length) this.pull(peer, remote, add)
  }

  /** Dejar de recibir todo de `peer` (salió de la llamada). */
  forget(peer: string) {
    const drop = [...this.pulls].filter(([, p]) => p.peer === peer)
    for (const [k] of drop) this.pulls.delete(k)
    if (drop.length) this.closePulls(drop.map(([, p]) => p))
  }

  /** Peers de los que estoy recibiendo algo. */
  peers(): Set<string> {
    return new Set([...this.pulls.values()].map(p => p.peer))
  }

  private pull(peer: string, remote: string, items: {name: TrackName; rid: string | null}[]) {
    // se anotan ya (sin mid) para no pedirlas dos veces mientras se negocia
    const pending = items.map(i => {
      const p: Pull = {peer, name: i.name, remote, mid: '', rid: i.rid, track: null, since: performance.now(), ok: false}
      this.pulls.set(`${peer}:${i.name}`, p)
      return p
    })
    void this.queue(async () => {
      const d = await this.api({op: 'pull', sesion: this.session, pistas: items.map(i => ({sesion: remote, nombre: i.name, ...(i.rid ? {rid: i.rid} : {})}))}, true)
      const got = new Set<Pull>()
      ;(d.tracks ?? []).forEach((t, i) => {
        const p = pending.find(x => x.name === t.trackName) ?? pending[i]
        if (!p || t.errorCode || !t.mid) return
        got.add(p)
        p.mid = t.mid
        p.since = performance.now()
        if (this.pulls.get(`${p.peer}:${p.name}`) === p) this.byMid.set(t.mid, `${p.peer}:${p.name}`)
      })
      // las que no se pudieron pedir (por ejemplo, la persona justo se fue): se reintentan en unos
      // segundos y mientras tanto se la recibe por conexión directa
      for (const p of pending) {
        if (got.has(p)) continue
        const k = `${p.peer}:${p.name}`
        if (this.pulls.get(k) === p) this.pulls.delete(k)
        this.retryAt.set(k, performance.now() + 5000)
      }
      if (d.requiresImmediateRenegotiation && d.sessionDescription) await this.answerOffer(d.sessionDescription)
      netLog(`Servidor de video: recibo ${items.map(i => i.name + (i.rid ? `(${i.rid})` : '')).join(', ')} de ${peer.slice(0, 6)}`)
      // si pedí algo que ya no quiero (cambió mientras se negociaba), se cierra
      const stale = pending.filter(p => this.pulls.get(`${p.peer}:${p.name}`) !== p && p.mid)
      if (stale.length) this.closePulls(stale)
    }).catch(e => {
      for (const p of pending) if (this.pulls.get(`${p.peer}:${p.name}`) === p) this.pulls.delete(`${p.peer}:${p.name}`)
      this.onError(e)
    })
  }

  private updateRid(p: Pull, rid: string) {
    p.rid = rid
    void this.queue(async () => {
      const d = await this.api({op: 'update', sesion: this.session, pistas: [{mid: p.mid, sesion: p.remote, nombre: p.name, rid}]}, true)
      if (d.requiresImmediateRenegotiation && d.sessionDescription) await this.answerOffer(d.sessionDescription)
    }).catch(e => this.onError(e))
  }

  private closePulls(list: Pull[]) {
    const mids = list.map(p => p.mid).filter(Boolean)
    for (const m of mids) this.byMid.delete(m)
    if (!mids.length) return
    void this.queue(async () => {
      const d = await this.api({op: 'close', sesion: this.session, mids}, true)
      if (d.requiresImmediateRenegotiation && d.sessionDescription?.type === 'offer') await this.answerOffer(d.sessionDescription)
    }).catch(e => {
      // no poder cerrar lo que ya no recibo no afecta la llamada: queda anotado y sigue
      if (!String(e).includes('cancelado')) netLog(`Servidor de video: no se pudo cerrar (${String(e).slice(0, 100)})`)
    })
  }

  /**
   * Control (~1 vez por segundo): marca las pistas pedidas por las que ya llegan bytes (eso habilita
   * mostrarlas y cortar la conexión directa). Si hace más de 10 s que pedí cámaras (o micrófonos)
   * y no llega ninguna, el servidor no anda para nosotros → volver a la conexión directa. Si llegan
   * las de otros y falta una, el problema es de esa persona: a ella la sigo recibiendo directo (no
   * la anoto en `r`) y no se corta el servidor para todos.
   */
  async watchdog() {
    if (!this.active || !this.pc || this.checking) return
    this.checking = true
    const pc = this.pc
    let changed = false
    const stuck = new Map<TrackName, Pull>()
    try {
      const now = performance.now()
      for (const [k, p] of [...this.pulls]) {
        if (p.ok || !p.mid) continue
        const tx = pc.getTransceivers().find(t => t.mid === p.mid)
        let bytes = 0
        try {
          ;(await tx?.receiver.getStats())?.forEach(s => {
            if (s.type === 'inbound-rtp') bytes += (s as RTCInboundRtpStreamStats).bytesReceived ?? 0
          })
        } catch {
          /* cerrada */
        }
        if (pc !== this.pc || this.pulls.get(k) !== p) continue // cambió mientras se medía
        if (bytes > 0) {
          p.ok = true
          changed = true
        } else if ((p.name === 'cam' || p.name === 'mic') && now - p.since > 10_000 && !stuck.has(p.name)) {
          stuck.set(p.name, p)
        }
      }
    } finally {
      this.checking = false
    }
    for (const [name, p] of stuck) {
      if (![...this.pulls.values()].some(x => x.name === name && x.ok)) {
        return this.fail(`no llega ${name === 'cam' ? 'ninguna cámara' : 'ningún micrófono'} por el servidor de video (la primera pedida, de ${p.peer.slice(0, 6)})`)
      }
    }
    if (changed) this.h.onFlow()
  }

  private onError(e: unknown) {
    const msg = String(e)
    if (msg.includes('cancelado')) return
    this.fail(msg)
  }
}
