import {initials, personById} from './config'
import type {Net, RemotePlayer, Status} from './net'

const LS_CAM = 'ov.dev.cam'
const LS_MIC = 'ov.dev.mic'
const LS_SPK = 'ov.dev.spk'
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

/**
 * Videollamada por proximidad.
 * - Dentro de un cubículo o una sala: se ven y escuchan todos los que están en esa zona.
 * - Fuera de ellos (pasillo, zona social): se habla con quienes están cerca (`nearby`).
 * Al alejarse, la llamada se corta sola.
 */
export class Call {
  private zone: number | null = null
  private local: MediaStream | null = null
  private acquiring: Promise<void> | null = null
  private releaseTimer: number | null = null
  private sentTo = new Set<string>()
  private remote = new Map<string, MediaStream>()
  private screenTrack: MediaStreamTrack | null = null
  private camTrack: MediaStreamTrack | null = null
  micOn = true
  camOn = true

  private panel = document.getElementById('call')!
  private tiles = document.getElementById('tiles')!
  private title = document.getElementById('call-title')!
  private btnMic = document.getElementById('btn-mic') as HTMLButtonElement
  private btnCam = document.getElementById('btn-cam') as HTMLButtonElement
  private btnScreen = document.getElementById('btn-screen') as HTMLButtonElement
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
    this.btnScreen.onclick = () => void this.toggleScreen()
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
    if (this.screenTrack) {
      // compartiendo pantalla: la nueva cámara se usa al dejar de compartir
      old?.stop()
    } else if (old) {
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
    for (const v of this.tiles.querySelectorAll<HTMLVideoElement>('.tile:not(.self) video')) this.applySink(v)
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

  /** ¿Los demás me ven? (cámara encendida o compartiendo pantalla) */
  get sendingVideo() {
    return !!this.screenTrack || (!!this.camTrack && this.camOn)
  }

  /** ¿Hay una llamada abierta con alguien? */
  get inCall() {
    return !this.panel.hidden
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
    if (desired.size > 0) this.render(desired)
  }

  onRemoteStream(stream: MediaStream, peerId: string) {
    this.remote.set(peerId, stream)
    this.reconcile()
  }

  onPeerGone(peerId: string) {
    this.remote.delete(peerId)
    this.sentTo.delete(peerId)
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
    this.panel.hidden = true
    this.tiles.replaceChildren()
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

  async toggleScreen() {
    if (this.screenTrack) return this.stopScreen(true)
    if (!this.local) return
    let track: MediaStreamTrack
    try {
      const s = await navigator.mediaDevices.getDisplayMedia({video: true, audio: false})
      track = s.getVideoTracks()[0]
    } catch {
      return
    }
    if (!this.local) {
      track.stop()
      return
    }
    this.screenTrack = track
    track.onended = () => this.stopScreen(true)
    const targets = [...this.sentTo]
    if (this.camTrack) {
      this.local.removeTrack(this.camTrack)
      this.local.addTrack(track)
      if (targets.length) void this.net.room.replaceTrack(this.camTrack, track, {target: targets})
    } else {
      this.local.addTrack(track)
      if (targets.length) this.net.room.addTrack(track, this.local, {target: targets})
    }
    this.btnScreen.classList.add('on')
    this.reconcile()
  }

  private stopScreen(restore: boolean) {
    const track = this.screenTrack
    if (!track) return
    this.screenTrack = null
    this.btnScreen.classList.remove('on')
    track.onended = null
    track.stop()
    if (!restore || !this.local) return
    const targets = [...this.sentTo]
    this.local.removeTrack(track)
    if (this.camTrack) {
      this.local.addTrack(this.camTrack)
      if (targets.length) void this.net.room.replaceTrack(track, this.camTrack, {target: targets})
    } else if (targets.length) {
      this.net.room.removeTrack(track, {target: targets})
    }
    this.reconcile()
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
      cam: !!this.screenTrack || (!!this.camTrack && this.camOn),
      mic: this.micOn
    })
    const others = [...inZone]
      .map(id => this.net.players.get(id))
      .filter((p): p is RemotePlayer => !!p)
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
    }

    const existing = new Map<string, HTMLElement>()
    for (const el of [...this.tiles.children] as HTMLElement[]) existing.set(el.dataset.key!, el)

    for (const w of wanted) {
      let tile = existing.get(w.key)
      if (!tile) {
        tile = document.createElement('div')
        tile.className = 'tile'
        tile.dataset.key = w.key
        tile.innerHTML = `<div class="ph"></div><video autoplay playsinline></video><span class="label"></span>`
        this.tiles.appendChild(tile)
      }
      existing.delete(w.key)
      const video = tile.querySelector('video')!
      const ph = tile.querySelector('.ph') as HTMLElement
      tile.querySelector('.label')!.textContent = w.name
      ph.textContent = initials(w.name === 'Vos' ? (mePerson?.name ?? '?') : w.name)
      ph.style.background = w.color
      video.muted = w.self
      tile.classList.toggle('self', w.self)
      tile.classList.toggle('mirror', w.self && !this.screenTrack)
      if (video.srcObject !== w.stream) {
        video.srcObject = w.stream
        if (w.stream) void video.play().catch(() => {})
      }
      if (!w.self) this.applySink(video)
      const hasVideo = w.cam && !!w.stream?.getVideoTracks().some(t => t.readyState === 'live')
      tile.classList.toggle('novideo', !hasVideo)
      tile.classList.toggle('waiting', !w.self && !w.stream)
      tile.classList.toggle('muted', !w.mic)
    }
    for (const el of existing.values()) {
      const v = el.querySelector('video')
      if (v) v.srcObject = null
      this.dropAnalyser(el.dataset.key!)
      el.remove()
    }
    const n = others.length
    this.notice.dataset.alone = n === 0 ? '1' : ''
    this.tiles.dataset.count = String(wanted.length)
  }

  /** Refresca estados visuales (cámara apagada, etc.) — barato, se llama ~1/s. */
  tick() {
    this.reconcile()
  }
}
