import {initials, personById} from './config'
import {netLog} from './diag'
import {icon} from './icons'
import type {Net, RemotePlayer, Status} from './net'

const LS_CAM = 'ov.dev.cam'
const LS_MIC = 'ov.dev.mic'
const LS_SPK = 'ov.dev.spk'
const LS_VIEW = 'ov.llamada.vista'
const LS_SHARE_AUDIO = 'ov.compartir.sonido'
/** Qué se comparte: una pestaña del navegador, una ventana o toda la pantalla (nombres de getDisplayMedia). */
type Surface = 'browser' | 'window' | 'monitor'
const SURFACE_TEXT: Record<Surface, string> = {browser: 'una pestaña', window: 'una ventana', monitor: 'toda tu pantalla'}

/**
 * Sonido al compartir: solo Chrome y Edge lo mandan. El de una pestaña anda en todas las compus;
 * el de toda la pantalla (sonido del sistema), en Windows y ChromeOS. Safari y Firefox no comparten sonido.
 */
const uaData = (navigator as Navigator & {userAgentData?: {brands?: {brand: string}[]; platform?: string}}).userAgentData
const canShareAudio = !!uaData?.brands?.some(b => /Chromium|Google Chrome|Microsoft Edge/.test(b.brand))
const systemAudio = canShareAudio && /Windows|Chrome OS|ChromeOS/i.test(uaData?.platform ?? '')
/** Cómo se ve la llamada: al costado de la oficina, en grande encima de ella, o la pantalla compartida en grande. */
type Layout = 'side' | 'grid' | 'present'
function pref(k: string) {
  try {
    return localStorage.getItem(k) || ''
  } catch {
    return ''
  }
}
function savePref(k: string, v: string) {
  try {
    localStorage.setItem(k, v)
  } catch {
    /* ignore */
  }
}
const AUDIO_BASE = {echoCancellation: true, noiseSuppression: true}
const VIDEO_BASE = {width: {ideal: 640}, height: {ideal: 360}, frameRate: {ideal: 24}}
const canPickSpeaker = 'setSinkId' in HTMLMediaElement.prototype

/** Aviso abajo en la oficina (los muestra main.ts). */
function say(msg: string, actions: {label: string; fn: () => void}[] = []) {
  document.dispatchEvent(new CustomEvent('ov:toast', {detail: {msg, actions, ic: 'screen', ms: 14000}}))
}

/**
 * Videollamada por proximidad.
 * - Dentro de un cubículo o una sala: se ven y escuchan todos los que están en esa zona.
 * - Fuera de ellos (pasillo, zona social): se habla con quienes están cerca (`nearby`).
 * Al alejarse, la llamada se corta sola.
 *
 * Vista (botones del encabezado; se recuerda en cada navegador): al costado de la oficina o en
 * grande encima de ella, con todas las cámaras del mismo tamaño. Si alguien comparte pantalla, a
 * los demás se les muestra en grande con las caras en una columna al costado (como en Zoom).
 * La pantalla viaja como otra transmisión (metadata {screen: true}), así la cámara sigue andando.
 */
export class Call {
  private zone: number | null = null
  private local: MediaStream | null = null
  private acquiring: Promise<void> | null = null
  private releaseTimer: number | null = null
  private sentTo = new Set<string>()
  private remote = new Map<string, MediaStream>()
  private screen: MediaStream | null = null // mi pantalla compartida
  private screenKind: Surface = 'monitor'
  private screenSentTo = new Set<string>()
  private remoteScreens = new Map<string, MediaStream>()
  private pcs = new Map<string, RTCPeerConnection>() // conexión con cada uno (para notar si se rearmó)
  private screenMuted = new Set<string>() // pantallas de otros que silenciaste (id de la transmisión)
  private shareAudio = pref(LS_SHARE_AUDIO) !== '0'
  private camTrack: MediaStreamTrack | null = null
  private view: 'side' | 'grid' = pref(LS_VIEW) === 'grid' ? 'grid' : 'side'
  private layout: Layout = 'side'
  private dismissed = new Set<string>() // pantallas que achicaste (id de la transmisión)
  private shownScreens: string[] = []
  micOn = true
  camOn = true

  private panel = document.getElementById('call')!
  private tiles = document.getElementById('tiles')!
  private screensBox = document.getElementById('screens')!
  private sharing = document.getElementById('call-sharing')!
  private title = document.getElementById('call-title')!
  private btnMic = document.getElementById('btn-mic') as HTMLButtonElement
  private btnCam = document.getElementById('btn-cam') as HTMLButtonElement
  private btnScreen = document.getElementById('btn-screen') as HTMLButtonElement
  private shareWhat = document.getElementById('share-what')!
  private btnShareSound = document.getElementById('btn-share-sound') as HTMLButtonElement
  private notice = document.getElementById('call-notice')!
  private hint = document.getElementById('call-hint')!
  private devPanel = document.getElementById('devices')!
  private selCam = document.getElementById('sel-cam') as HTMLSelectElement
  private selMic = document.getElementById('sel-mic') as HTMLSelectElement
  private selSpk = document.getElementById('sel-spk') as HTMLSelectElement
  private camId = pref(LS_CAM)
  private micId = pref(LS_MIC)
  private spkId = pref(LS_SPK)

  private analysers = new Map<string, {stream: MediaStream; an: AnalyserNode; src: MediaStreamAudioSourceNode}>()
  private audioCtx: AudioContext | null = null
  private levels = new Uint8Array(2048)
  private lastSpoke = new Map<string, number>()

  constructor(
    private net: Net,
    private me: string,
    private label: (zone: number | null) => string,
    private myStatus: () => Status,
    private nearby: () => Iterable<string>
  ) {
    setInterval(() => this.updateSpeaking(), 100)
    this.btnMic.onclick = () => this.toggleMic()
    this.btnCam.onclick = () => this.toggleCam()
    for (const b of document.querySelectorAll<HTMLButtonElement>('#call-views [data-view]')) {
      b.onclick = () => this.setView(b.dataset.view as Layout)
    }
    document.getElementById('btn-stop-share')!.onclick = () => this.stopScreen(true)
    this.btnShareSound.onclick = () => this.toggleShareSound()
    // menú "Compartir": qué (pestaña / ventana / pantalla) y si va con sonido
    for (const b of document.querySelectorAll<HTMLButtonElement>('#share-menu [data-surface]')) {
      b.onclick = () => {
        document.dispatchEvent(new CustomEvent('ov:menu', {detail: null}))
        void this.startScreen(b.dataset.surface as Surface)
      }
    }
    const audioBox = document.getElementById('share-audio') as HTMLInputElement
    audioBox.checked = canShareAudio && this.shareAudio
    audioBox.disabled = !canShareAudio
    audioBox.onchange = () => {
      this.shareAudio = audioBox.checked
      savePref(LS_SHARE_AUDIO, this.shareAudio ? '1' : '0')
    }
    document.getElementById('share-audio-note')!.textContent = !canShareAudio
      ? 'Tu navegador no lo permite: usá Chrome o Edge'
      : systemAudio
        ? 'De una pestaña o de toda la pantalla'
        : 'Anda siempre desde una pestaña'
    new ResizeObserver(() => this.fitGrid()).observe(this.tiles)
    for (const b of document.querySelectorAll<HTMLElement>('[data-open-devices]')) {
      b.addEventListener('click', e => {
        e.stopPropagation()
        this.openDevices(this.devPanel.hidden)
      })
    }
    this.selCam.onchange = () => void this.switchCam(this.selCam.value)
    this.selMic.onchange = () => void this.switchMic(this.selMic.value)
    this.selSpk.onchange = () => this.setSpeaker(this.selSpk.value)
    if (!canPickSpeaker) (document.getElementById('spk-row') as HTMLElement).hidden = true
    navigator.mediaDevices?.addEventListener?.('devicechange', () => {
      if (!this.devPanel.hidden) void this.fillDevices()
    })
  }

  // ── elegir cámara / micrófono / parlante ───────────────────

  /** Muestra u oculta el menú para elegir cámara / micrófono / parlante. */
  openDevices(show = true) {
    document.dispatchEvent(new CustomEvent('ov:menu', {detail: show ? 'devices' : null}))
    if (show) void this.fillDevices()
  }

  private async fillDevices() {
    let devices: MediaDeviceInfo[] = []
    try {
      devices = await navigator.mediaDevices.enumerateDevices()
    } catch {
      return
    }
    const fill = (sel: HTMLSelectElement, kind: MediaDeviceKind, current: string, fallback: string) => {
      const list = devices.filter(d => d.kind === kind && d.deviceId)
      sel.replaceChildren(
        ...list.map((d, i) => {
          const o = document.createElement('option')
          o.value = d.deviceId
          o.textContent = d.label || `${fallback} ${i + 1}`
          return o
        })
      )
      if (!list.length) {
        const o = document.createElement('option')
        o.textContent = `No se encontró ${fallback.toLowerCase()}`
        o.value = ''
        sel.appendChild(o)
      }
      if (current && list.some(d => d.deviceId === current)) sel.value = current
    }
    const curCam = this.camTrack?.getSettings().deviceId || this.camId
    const curMic = this.local?.getAudioTracks()[0]?.getSettings().deviceId || this.micId
    fill(this.selCam, 'videoinput', curCam, 'Cámara')
    fill(this.selMic, 'audioinput', curMic, 'Micrófono')
    fill(this.selSpk, 'audiooutput', this.spkId, 'Parlante')
  }

  private async switchCam(id: string) {
    if (!id) return
    this.camId = id
    savePref(LS_CAM, id)
    if (!this.local) return
    let track: MediaStreamTrack
    try {
      const s = await navigator.mediaDevices.getUserMedia({video: {...VIDEO_BASE, deviceId: {exact: id}}})
      track = s.getVideoTracks()[0]
    } catch {
      this.notice.textContent = 'No se pudo usar esa cámara (¿la está usando otra app?).'
      return
    }
    if (!this.local) return track.stop()
    this.notice.textContent = ''
    track.enabled = this.camOn
    const old = this.camTrack
    this.camTrack = track
    const targets = [...this.sentTo]
    if (old) {
      this.local.removeTrack(old)
      this.local.addTrack(track)
      if (targets.length) await this.net.room.replaceTrack(old, track, {target: targets})
      old.stop()
    } else {
      this.local.addTrack(track)
      if (targets.length) this.net.room.addTrack(track, this.local, {target: targets})
    }
    this.reconcile()
    this.refreshSelfTile()
  }

  private async switchMic(id: string) {
    if (!id) return
    this.micId = id
    savePref(LS_MIC, id)
    if (!this.local) return
    let track: MediaStreamTrack
    try {
      const s = await navigator.mediaDevices.getUserMedia({audio: {...AUDIO_BASE, deviceId: {exact: id}}})
      track = s.getAudioTracks()[0]
    } catch {
      this.notice.textContent = 'No se pudo usar ese micrófono.'
      return
    }
    if (!this.local) return track.stop()
    this.notice.textContent = ''
    track.enabled = this.micOn
    const old = this.local.getAudioTracks()[0]
    const targets = [...this.sentTo]
    if (old) {
      this.local.removeTrack(old)
      this.local.addTrack(track)
      if (targets.length) await this.net.room.replaceTrack(old, track, {target: targets})
      old.stop()
    } else {
      this.local.addTrack(track)
      if (targets.length) this.net.room.addTrack(track, this.local, {target: targets})
    }
    this.refreshSelfTile()
  }

  private setSpeaker(id: string) {
    this.spkId = id
    savePref(LS_SPK, id)
    for (const v of this.panel.querySelectorAll<HTMLVideoElement>('.tile:not(.self) video')) this.applySink(v)
  }

  private applySink(v: HTMLVideoElement) {
    if (!canPickSpeaker || !this.spkId) return
    const el = v as HTMLVideoElement & {setSinkId: (id: string) => Promise<void>; sinkId?: string}
    if (el.sinkId !== this.spkId) void el.setSinkId(this.spkId).catch(() => {})
  }

  /** Fuerza a la vista propia a tomar las pistas nuevas (y al indicador de voz). */
  private refreshSelfTile() {
    const v = this.tiles.querySelector<HTMLVideoElement>('.tile.self video')
    if (v && this.local) {
      v.srcObject = null
      v.srcObject = this.local
      void v.play().catch(() => {})
    }
    this.dropAnalyser('self')
  }

  /** ¿Los demás me ven la cara? */
  get sendingVideo() {
    return !!this.camTrack && this.camOn
  }

  get sharingScreen() {
    return !!this.screen
  }

  /** Esc en la vista grande: volver al costado. Devuelve si hizo algo. */
  exitBig(): boolean {
    if (this.panel.hidden || this.layout === 'side') return false
    this.setView('side')
    return true
  }

  /** Cambiar la vista. Al elegir costado o grande con una pantalla compartida, se achica esa pantalla. */
  setView(v: Layout) {
    if (v === 'present') this.dismissed.clear()
    else {
      this.view = v
      savePref(LS_VIEW, v)
      for (const id of this.shownScreens) this.dismissed.add(id)
    }
    this.reconcile()
  }

  /** ¿Hay una llamada abierta con alguien? */
  get inCall() {
    return !this.panel.hidden
  }

  /** Con quiénes estoy hablando ahora (sin mí), para la mini ventana. */
  peers(): {key: string; name: string; color: string; stream: MediaStream | null; cam: boolean; mic: boolean; speaking: boolean}[] {
    if (this.panel.hidden) return []
    const now = performance.now()
    return [...this.wanted()]
      .map(id => this.net.players.get(id))
      .filter((p): p is RemotePlayer => !!p)
      .map(p => {
        const person = personById(p.person)
        return {
          key: p.peerId,
          name: person?.name ?? 'Invitado',
          color: person?.color ?? '#888',
          stream: this.remote.get(p.peerId) ?? null,
          cam: p.cam !== false,
          mic: p.mic !== false,
          speaking: p.mic !== false && now - (this.lastSpoke.get(p.peerId) ?? 0) < 600
        }
      })
  }

  setZone(zone: number | null) {
    if (zone === this.zone) return
    this.zone = zone
    // Al cambiar de lugar, si no queda nadie con quien hablar, se corta en el acto.
    if (this.wanted().size === 0) this.hangUp()
    else this.reconcile()
  }

  /** Con quién hablar ahora: los de mi cubículo/sala o, fuera de ellos, los que están cerca. */
  private wanted(): Set<string> {
    const out = new Set<string>()
    // "Ocupado" = no molestar: no entra ni recibe llamadas
    if (this.myStatus() === 'busy') return out
    if (this.zone !== null) {
      for (const p of this.net.players.values()) {
        if (p.zone === this.zone && p.status !== 'busy') out.add(p.peerId)
      }
    } else {
      for (const id of this.nearby()) if (this.net.players.has(id)) out.add(id)
    }
    return out
  }

  private async ensureLocal() {
    if (this.local || this.acquiring) return this.acquiring ?? undefined
    this.acquiring = (async () => {
      this.notice.textContent = ''
      const tryGet = async (c: MediaStreamConstraints) => {
        try {
          return await navigator.mediaDevices.getUserMedia(c)
        } catch {
          return null
        }
      }
      // 1) con la cámara/micrófono elegidos, 2) predeterminados, 3) solo audio
      let stream = await tryGet({
        audio: {...AUDIO_BASE, ...(this.micId ? {deviceId: {exact: this.micId}} : {})},
        video: {...VIDEO_BASE, ...(this.camId ? {deviceId: {exact: this.camId}} : {})}
      })
      if (!stream && (this.camId || this.micId)) stream = await tryGet({audio: AUDIO_BASE, video: VIDEO_BASE})
      if (!stream) {
        stream = await tryGet({audio: AUDIO_BASE})
        this.notice.textContent = stream
          ? 'Sin cámara: solo audio.'
          : 'No hay permiso de micrófono/cámara. Habilitalo en el candado de la barra de direcciones.'
      }
      this.acquiring = null
      if (this.wanted().size === 0) {
        // se fue (o quedó solo) mientras pedíamos permisos
        stream?.getTracks().forEach(t => t.stop())
        return
      }
      if (stream) {
        this.local = stream
        this.camTrack = stream.getVideoTracks()[0] ?? null
        stream.getAudioTracks().forEach(t => (t.enabled = this.micOn))
        if (this.camTrack) this.camTrack.enabled = this.camOn
      }
      this.reconcile()
    })()
    return this.acquiring
  }

  /**
   * Recalcula a quién mandarle video. Llamar cuando cambia cualquier jugador.
   * La cámara/micrófono solo se encienden cuando hay alguien más con quien
   * hablar; si te quedás solo, se apagan a los pocos segundos.
   */
  reconcile() {
    const desired = this.wanted()

    if (desired.size > 0) {
      if (this.releaseTimer !== null) {
        clearTimeout(this.releaseTimer)
        this.releaseTimer = null
      }
      if (!this.local) void this.ensureLocal()
      this.title.textContent = this.label(this.zone)
      this.hint.textContent = this.zone === null ? 'Alejate unos pasos para cortar.' : 'Alejate de la alfombra para cortar.'
      this.panel.hidden = false
    } else if (!this.panel.hidden || this.local || this.acquiring) {
      this.panel.hidden = true
      this.tiles.replaceChildren()
      this.screensBox.replaceChildren()
      document.body.classList.remove('call-big')
      if ((this.local || this.acquiring) && this.releaseTimer === null) {
        this.releaseTimer = window.setTimeout(() => {
          this.releaseTimer = null
          if (this.wanted().size === 0) this.releaseMedia()
        }, 4000)
      }
    }

    if (this.local) {
      for (const id of desired) {
        if (!this.sentTo.has(id)) {
          this.net.room.addStream(this.local, {target: id})
          this.sentTo.add(id)
        }
      }
    }
    for (const id of [...this.sentTo]) {
      if (!desired.has(id)) {
        if (this.local && this.net.players.has(id)) {
          try {
            this.net.room.removeStream(this.local, {target: id})
          } catch {
            /* peer ya desconectado */
          }
        }
        this.sentTo.delete(id)
      }
    }
    // mi pantalla compartida va aparte, a los mismos
    if (this.screen) {
      for (const id of desired) {
        if (!this.screenSentTo.has(id)) {
          this.net.room.addStream(this.screen, {target: id, metadata: {screen: true}})
          this.screenSentTo.add(id)
        }
      }
    }
    for (const id of [...this.screenSentTo]) {
      if (!desired.has(id)) {
        if (this.screen && this.net.players.has(id)) {
          try {
            this.net.room.removeStream(this.screen, {target: id})
          } catch {
            /* peer ya desconectado */
          }
        }
        this.screenSentTo.delete(id)
      }
    }
    if (desired.size > 0) this.render(desired)
  }

  onRemoteStream(stream: MediaStream, peerId: string, meta?: unknown) {
    if ((meta as {screen?: boolean} | undefined)?.screen === true) this.remoteScreens.set(peerId, stream)
    else this.remote.set(peerId, stream)
    // video y sonido llegan por separado a la misma transmisión: redibujar cuando entra o sale una pista
    stream.onaddtrack = stream.onremovetrack = () => this.reconcile()
    this.reconcile()
  }

  /**
   * Conexión nueva con alguien (la primera, o una que se rearmó sola después de un corte). Si se
   * rearmó, lo que le mandábamos iba por la conexión vieja: se olvida para volver a mandarle cámara
   * y pantalla, y se descarta lo que llegaba de él si ya terminó (llega de nuevo por la nueva).
   */
  onPeerJoined(peerId: string) {
    const pc = this.net.connections()[peerId]
    const prev = this.pcs.get(peerId)
    if (pc) this.pcs.set(peerId, pc)
    if (pc && prev === pc) return // la misma conexión de antes: no hay nada que reenviar
    const again = this.sentTo.has(peerId) || this.screenSentTo.has(peerId)
    this.sentTo.delete(peerId)
    this.screenSentTo.delete(peerId)
    for (const m of [this.remote, this.remoteScreens]) {
      const s = m.get(peerId)
      if (s && !s.getTracks().some(t => t.readyState === 'live')) m.delete(peerId)
    }
    if (again) netLog(`Conexión rearmada con ${this.net.who(peerId)}: le vuelvo a mandar cámara${this.screen ? ' y pantalla' : ''}`)
    this.reconcile()
  }

  onPeerGone(peerId: string) {
    this.pcs.delete(peerId)
    this.remote.delete(peerId)
    this.remoteScreens.delete(peerId)
    this.sentTo.delete(peerId)
    this.screenSentTo.delete(peerId)
    this.reconcile()
  }

  /** Apaga cámara/micrófono y deja de enviar video. */
  private releaseMedia() {
    if (this.local) {
      for (const id of this.sentTo) {
        try {
          this.net.room.removeStream(this.local, {target: id})
        } catch {
          /* ignore */
        }
      }
    }
    this.sentTo.clear()
    this.stopScreen(false)
    this.local?.getTracks().forEach(t => t.stop())
    this.local = null
    this.camTrack = null
  }

  private hangUp() {
    if (this.releaseTimer !== null) {
      clearTimeout(this.releaseTimer)
      this.releaseTimer = null
    }
    this.releaseMedia()
    if (!document.getElementById('share-menu')!.hidden) document.dispatchEvent(new CustomEvent('ov:menu', {detail: null}))
    this.panel.hidden = true
    this.tiles.replaceChildren()
    this.screensBox.replaceChildren()
    document.body.classList.remove('call-big')
    for (const k of [...this.analysers.keys()]) this.dropAnalyser(k)
  }

  // ── indicador de quién habla ───────────────────────────────

  private dropAnalyser(key: string) {
    const a = this.analysers.get(key)
    if (!a) return
    try {
      a.src.disconnect()
    } catch {
      /* ignore */
    }
    this.analysers.delete(key)
  }

  private updateSpeaking() {
    if (this.panel.hidden) return
    for (const tile of [...this.tiles.children] as HTMLElement[]) {
      if (tile.classList.contains('screen')) continue // el sonido de una pantalla no es alguien hablando
      const key = tile.dataset.key!
      const stream = (tile.querySelector('video') as HTMLVideoElement).srcObject as MediaStream | null
      const muted = tile.classList.contains('muted')
      if (!stream || !stream.getAudioTracks().length) {
        tile.classList.remove('speaking')
        continue
      }
      let a = this.analysers.get(key)
      if (a && a.stream !== stream) {
        this.dropAnalyser(key)
        a = undefined
      }
      if (!a) {
        try {
          this.audioCtx ??= new AudioContext()
          if (this.audioCtx.state === 'suspended') void this.audioCtx.resume()
          const src = this.audioCtx.createMediaStreamSource(stream)
          const an = this.audioCtx.createAnalyser()
          an.fftSize = 2048
          src.connect(an)
          a = {stream, an, src}
          this.analysers.set(key, a)
        } catch {
          continue
        }
      }
      a.an.getByteTimeDomainData(this.levels)
      let sum = 0
      for (const v of this.levels) sum += (v - 128) ** 2
      const rms = Math.sqrt(sum / this.levels.length)
      const now = performance.now()
      if (!muted && rms > 6) this.lastSpoke.set(key, now)
      // mantiene el resaltado 600ms para que no parpadee entre palabras
      tile.classList.toggle('speaking', !muted && now - (this.lastSpoke.get(key) ?? 0) < 600)
    }
  }

  // ── controles ──────────────────────────────────────────────

  toggleMic() {
    this.micOn = !this.micOn
    this.local?.getAudioTracks().forEach(t => (t.enabled = this.micOn))
    this.btnMic.classList.toggle('off', !this.micOn)
    this.btnMic.dataset.tip = this.micOn ? 'Silenciar · M' : 'Activar micrófono · M'
  }

  toggleCam() {
    this.camOn = !this.camOn
    if (this.camTrack) this.camTrack.enabled = this.camOn
    this.btnCam.classList.toggle('off', !this.camOn)
    this.btnCam.dataset.tip = this.camOn ? 'Apagar cámara · V' : 'Encender cámara · V'
  }

  /** Deja de compartir (si estás compartiendo). Para empezar se elige qué en el menú "Compartir". */
  stopSharing() {
    this.stopScreen(true)
  }

  /**
   * Comparte una pestaña, una ventana o toda la pantalla. `surface` solo preselecciona esa opción en
   * la ventana del navegador (Chrome y Edge; Safari y Firefox muestran la suya); lo que se terminó
   * eligiendo sale de la pista. Tiene que llamarse desde un clic.
   */
  async startScreen(surface: Surface) {
    if (this.screen || !this.local) return
    if (!navigator.mediaDevices?.getDisplayMedia) {
      say('Este navegador no permite compartir pantalla. Probá con Chrome o Edge en la compu.')
      return
    }
    const wantAudio = canShareAudio && this.shareAudio
    const options = (audio: boolean) =>
      ({
        video: {displaySurface: surface, frameRate: {ideal: 30}},
        // sonido tal cual (sin filtros de voz) y sin la propia oficina, para que no vuelva el eco de la llamada
        audio: audio ? {echoCancellation: false, noiseSuppression: false, autoGainControl: false, restrictOwnAudio: true} : false,
        selfBrowserSurface: 'exclude', // no ofrecer la pestaña de la oficina (efecto espejo)
        surfaceSwitching: 'include', // Chrome: "Compartir esta pestaña" para cambiar sin cortar
        systemAudio: 'include',
        monitorTypeSurfaces: 'include',
        preferCurrentTab: false
      }) as DisplayMediaStreamOptions
    let s: MediaStream
    try {
      s = await navigator.mediaDevices.getDisplayMedia(options(wantAudio))
    } catch (e) {
      // cancelaste la ventana del navegador o no diste permiso: no se hace nada
      if (!wantAudio || !(e instanceof TypeError || (e as DOMException)?.name === 'NotSupportedError')) return
      try {
        s = await navigator.mediaDevices.getDisplayMedia(options(false))
      } catch {
        return
      }
    }
    const track = s.getVideoTracks()[0]
    if (!this.local || !track || this.screen) {
      s.getTracks().forEach(t => t.stop())
      return
    }
    const audio = s.getAudioTracks()[0]
    const chosen = (track.getSettings() as {displaySurface?: string}).displaySurface
    this.screenKind = chosen === 'browser' || chosen === 'window' || chosen === 'monitor' ? chosen : surface
    // con sonido suele ser un video: priorizar que se mueva fluido; sin sonido, que el texto se lea nítido
    track.contentHint = audio ? 'motion' : 'detail'
    this.screen = s
    netLog(`Comparto ${SURFACE_TEXT[this.screenKind]} (${audio ? 'con' : 'sin'} sonido) con ${this.screenSentTo.size + this.wanted().size} personas`)
    track.onended = () => this.stopScreen(true) // "Dejar de compartir" del navegador
    this.btnScreen.classList.add('on')
    this.updateSharingBar()
    if (wantAudio && !audio) {
      const tab = this.screenKind === 'browser'
      say(
        tab
          ? 'Compartís sin sonido: para incluirlo, volvé a compartir y dejá tildado «Compartir también el audio de la pestaña».'
          : `Compartís ${SURFACE_TEXT[this.screenKind]} sin sonido: en esta compu el sonido solo se puede compartir desde una pestaña.`,
        tab
          ? []
          : [
              {
                label: 'Compartir una pestaña',
                fn: () => {
                  this.stopScreen(true)
                  void this.startScreen('browser') // sigue dentro del clic: el navegador lo permite
                }
              }
            ]
      )
    }
    this.reconcile() // se la manda a todos los de la llamada
  }

  /** Pausa o vuelve a mandar el sonido de lo que compartís (sin dejar de compartir la imagen). */
  private toggleShareSound() {
    const a = this.screen?.getAudioTracks()[0]
    if (!a) return
    a.enabled = !a.enabled
    this.updateSharingBar()
  }

  private updateSharingBar() {
    const a = this.screen?.getAudioTracks()[0]
    const sound = !a ? 'sin sonido' : a.enabled ? 'con sonido' : 'sonido en pausa'
    this.shareWhat.textContent = `Compartís ${SURFACE_TEXT[this.screenKind]} · ${sound}`
    this.btnShareSound.hidden = !a
    if (a) {
      this.btnShareSound.innerHTML = icon(a.enabled ? 'volume' : 'volume-off', 16)
      this.btnShareSound.title = a.enabled ? 'Pausar el sonido que compartís' : 'Volver a mandar el sonido'
      this.btnShareSound.classList.toggle('off', !a.enabled)
    }
  }

  /** Deja de compartir. `update`: refrescar la llamada (no hace falta al cortarla). */
  private stopScreen(update: boolean) {
    const s = this.screen
    if (!s) return
    netLog('Dejo de compartir')
    this.screen = null
    this.btnScreen.classList.remove('on')
    for (const id of this.screenSentTo) {
      try {
        this.net.room.removeStream(s, {target: id})
      } catch {
        /* peer ya desconectado */
      }
    }
    this.screenSentTo.clear()
    for (const t of s.getTracks()) {
      t.onended = null
      t.stop()
    }
    if (update) this.reconcile()
  }

  // ── UI ─────────────────────────────────────────────────────

  private render(inZone: Set<string>) {
    const wanted: {
      key: string
      name: string
      color: string
      stream: MediaStream | null
      self: boolean
      cam: boolean
      mic: boolean
    }[] = []
    const mePerson = personById(this.me)
    wanted.push({
      key: 'self',
      name: 'Vos',
      color: mePerson?.color ?? '#888',
      stream: this.local,
      self: true,
      cam: this.sendingVideo,
      mic: this.micOn
    })
    const others = [...inZone]
      .map(id => this.net.players.get(id))
      .filter((p): p is RemotePlayer => !!p)
    const screens: {key: string; name: string; stream: MediaStream}[] = []
    for (const p of others) {
      const person = personById(p.person)
      wanted.push({
        key: p.peerId,
        name: person?.name ?? 'Invitado',
        color: person?.color ?? '#888',
        stream: this.remote.get(p.peerId) ?? null,
        self: false,
        cam: p.cam !== false,
        mic: p.mic !== false
      })
      const scr = this.remoteScreens.get(p.peerId)
      if (p.screen && scr?.getVideoTracks().some(t => t.readyState === 'live')) {
        screens.push({key: `scr:${p.peerId}`, name: `Pantalla de ${(person?.name ?? 'Invitado').split(' ')[0]}`, stream: scr})
      }
    }

    // Vista: si hay una pantalla compartida que no achicaste, va en grande
    this.shownScreens = screens.map(s => s.stream.id)
    for (const id of [...this.dismissed]) if (!this.shownScreens.includes(id)) this.dismissed.delete(id)
    this.layout = screens.some(s => !this.dismissed.has(s.stream.id)) ? 'present' : this.view
    this.panel.dataset.layout = this.layout
    document.body.classList.toggle('call-big', this.layout !== 'side')
    for (const b of document.querySelectorAll<HTMLButtonElement>('#call-views [data-view]')) {
      b.classList.toggle('sel', b.dataset.view === this.layout)
      if (b.dataset.view === 'present') b.hidden = !screens.length
    }
    this.sharing.hidden = !this.screen

    const existing = new Map<string, HTMLElement>()
    for (const el of [...this.tiles.children, ...this.screensBox.children] as HTMLElement[]) existing.set(el.dataset.key!, el)
    const tile = (key: string) => {
      let t = existing.get(key)
      if (!t) {
        t = document.createElement('div')
        t.className = 'tile'
        t.dataset.key = key
        t.innerHTML = `<div class="ph"></div><video autoplay playsinline></video><span class="label"></span>`
      }
      existing.delete(key)
      return t
    }
    const setStream = (video: HTMLVideoElement, stream: MediaStream | null) => {
      if (video.srcObject !== stream) {
        video.srcObject = stream
        if (stream) void video.play().catch(() => {})
      }
    }

    const faceTiles: HTMLElement[] = []
    for (const w of wanted) {
      const t = tile(w.key)
      faceTiles.push(t)
      const video = t.querySelector('video')!
      const ph = t.querySelector('.ph') as HTMLElement
      t.querySelector('.label')!.textContent = w.name
      ph.textContent = initials(w.name === 'Vos' ? (mePerson?.name ?? '?') : w.name)
      ph.style.background = w.color
      video.muted = w.self
      t.classList.toggle('self', w.self)
      t.classList.toggle('mirror', w.self)
      setStream(video, w.stream)
      if (!w.self) this.applySink(video)
      const hasVideo = w.cam && !!w.stream?.getVideoTracks().some(tr => tr.readyState === 'live')
      t.classList.toggle('novideo', !hasVideo)
      t.classList.toggle('waiting', !w.self && !w.stream)
      t.classList.toggle('muted', !w.mic)
    }
    const screenTiles: HTMLElement[] = []
    for (const s of screens) {
      const t = tile(s.key)
      screenTiles.push(t)
      t.classList.add('screen')
      t.querySelector('.label')!.textContent = s.name
      const video = t.querySelector('video')!
      // si comparte con sonido, se escucha (por el parlante elegido); cada uno lo puede silenciar
      const id = s.stream.id
      const hasSound = s.stream.getAudioTracks().some(tr => tr.readyState === 'live')
      const muted = this.screenMuted.has(id)
      video.muted = !hasSound || muted
      setStream(video, s.stream)
      this.applySink(video)
      let snd = t.querySelector<HTMLButtonElement>('.tile-snd')
      if (hasSound && !snd) {
        snd = document.createElement('button')
        snd.className = 'tile-snd'
        t.append(snd)
      } else if (!hasSound && snd) {
        snd.remove()
        snd = null
      }
      if (snd && snd.dataset.muted !== String(muted)) {
        snd.dataset.muted = String(muted)
        snd.innerHTML = icon(muted ? 'volume-off' : 'volume', 16)
        snd.title = muted ? 'Escuchar el sonido de la pantalla' : 'Silenciar el sonido de la pantalla'
        snd.classList.toggle('off', muted)
        snd.onclick = () => {
          if (muted) this.screenMuted.delete(id)
          else this.screenMuted.add(id)
          this.reconcile()
        }
      }
    }
    for (const id of [...this.screenMuted]) if (!this.shownScreens.includes(id)) this.screenMuted.delete(id)
    for (const el of existing.values()) {
      const v = el.querySelector('video')
      if (v) v.srcObject = null
      this.dropAnalyser(el.dataset.key!)
      el.remove()
    }
    // En grande con pantalla: la pantalla en su lugar y las caras al costado.
    // Si no: la pantalla es un cuadro más (primero) junto a las caras.
    if (this.layout === 'present') {
      place(this.screensBox, screenTiles)
      place(this.tiles, faceTiles)
    } else {
      place(this.screensBox, [])
      place(this.tiles, [...screenTiles, ...faceTiles])
    }
    const n = others.length
    this.notice.dataset.alone = n === 0 ? '1' : ''
    this.tiles.dataset.count = String(this.tiles.children.length)
    this.fitGrid()
  }

  /**
   * Vista en grande: todos los cuadros del mismo tamaño, lo más grandes que entren (prueba cada
   * cantidad de columnas y se queda con la que deja el cuadro 16:9 más ancho).
   */
  private fitGrid() {
    const box = this.tiles
    const n = box.children.length
    if (this.layout !== 'grid' || this.panel.hidden || !n) {
      box.style.removeProperty('--tw')
      return
    }
    const W = box.clientWidth
    const H = box.clientHeight
    const gap = 12
    let best = 0
    for (let cols = 1; cols <= n; cols++) {
      const rows = Math.ceil(n / cols)
      best = Math.max(best, Math.min((W - gap * (cols - 1)) / cols, ((H - gap * (rows - 1)) / rows) * (16 / 9)))
    }
    box.style.setProperty('--tw', `${Math.max(120, Math.floor(best))}px`)
  }

  /** Refresca estados visuales (cámara apagada, etc.) — barato, se llama ~1/s. */
  tick() {
    this.reconcile()
  }
}

/** Deja los elementos de `box` en este orden (mueve solo lo necesario: los videos siguen andando). */
function place(box: HTMLElement, list: HTMLElement[]) {
  list.forEach((el, i) => {
    if (box.children[i] !== el) box.insertBefore(el, box.children[i] ?? null)
  })
  while (box.children.length > list.length) box.lastElementChild!.remove()
}
