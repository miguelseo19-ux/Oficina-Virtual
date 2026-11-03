import {personById, type Person} from './config'
import {netLog} from './diag'
import {icon} from './icons'
import type {Net} from './net'
import {officeProof} from './turn'

/**
 * Pizarras compartidas en las llamadas.
 *
 * - Alguien en una llamada elige Compartir → Pizarra (nueva o una guardada) y la "presenta": va en
 *   su estado (`PlayerState.board`), como la pantalla compartida. A todos los de la llamada se les
 *   abre en grande y todos pueden dibujar a la vez (con el cursor y el nombre de cada uno).
 * - Los trazos viajan directo entre los de la llamada (acción 'board' de Trystero): cada uno manda
 *   solo lo que cambió y Excalidraw mezcla por versión de cada elemento. Quien entra pide todo ('hi').
 * - Se guarda en el Dashboard (/api/office/boards, base de datos): cada 15 s si hubo cambios, al
 *   tocar Guardar y al cerrarla. El servidor también mezcla por versión, así que no importa quién
 *   guarde primero. Sin Dashboard (o sin OFFICE_KEY configurada) se puede dibujar y descargar la
 *   imagen, pero no guardar.
 * - Excalidraw se carga recién al abrir una pizarra (board-view.ts).
 */

export interface BoardElement {
  id: string
  version: number
  versionNonce: number
  isDeleted?: boolean
  [k: string]: unknown
}

export interface MountOptions {
  elements: BoardElement[]
  onLocalChange: (els: BoardElement[]) => void
  onPointer: (x: number, y: number, down: boolean) => void
}

export interface BoardView {
  merge: (els: BoardElement[]) => Promise<void>
  elements: () => BoardElement[]
  setPeers: (peers: {id: string; name: string; color: string; x: number; y: number; down: boolean}[]) => void
  png: () => Promise<Blob | null>
  refresh: () => void
  destroy: () => void
}

export interface BoardMeta {
  id: string
  title: string
}

export interface SavedBoard extends BoardMeta {
  editedBy: string
  editedAt: string
}

type Msg =
  | {k: 'els'; b: string; els: BoardElement[]}
  | {k: 'hi'; b: string}
  | {k: 'ptr'; b: string; x: number; y: number; d: 0 | 1}

const API = '/api/office/boards'
const AUTOSAVE_MS = 15_000
const SEND_EVERY_MS = 80
const POINTER_EVERY_MS = 60
const MAX_ELEMENTS = 5000

// ── Dashboard ───────────────────────────────────────────────

async function api(key: string, path: string, init: RequestInit = {}) {
  const r = await fetch(API + path, {
    ...init,
    headers: {'x-office-proof': await officeProof(key), ...(init.body ? {'content-type': 'application/json'} : {}), ...init.headers},
    cache: 'no-store',
    credentials: 'same-origin'
  })
  // sin Dashboard (prueba local con Vite) la respuesta es la página, no JSON
  if (!(r.headers.get('content-type') ?? '').includes('application/json')) return {ok: false, status: 0, data: null}
  return {ok: r.ok, status: r.status, data: (await r.json()) as Record<string, unknown>}
}

export async function listBoards(key: string): Promise<SavedBoard[] | null> {
  try {
    const r = await api(key, '')
    if (!r.ok || !Array.isArray(r.data?.pizarras)) return null
    return (r.data.pizarras as {id: string; titulo: string; editadaPor: string; editadaEn: string}[]).map(p => ({
      id: p.id,
      title: p.titulo,
      editedBy: p.editadaPor,
      editedAt: p.editadaEn
    }))
  } catch {
    return null
  }
}

async function loadBoard(key: string, id: string): Promise<BoardElement[] | null> {
  try {
    const r = await api(key, `/${encodeURIComponent(id)}`)
    const els = (r.data?.pizarra as {elementos?: unknown} | undefined)?.elementos
    return r.ok && Array.isArray(els) ? (els as BoardElement[]) : null
  } catch {
    return null
  }
}

async function saveBoard(key: string, b: BoardMeta, els: BoardElement[], by: string): Promise<boolean> {
  try {
    const r = await api(key, `/${encodeURIComponent(b.id)}`, {method: 'PUT', body: JSON.stringify({titulo: b.title, elementos: els, por: by})})
    return r.ok
  } catch {
    return false
  }
}

export async function deleteBoard(key: string, id: string): Promise<boolean> {
  try {
    return (await api(key, `/${encodeURIComponent(id)}`, {method: 'DELETE'})).ok
  } catch {
    return false
  }
}

const validEls = (x: unknown): x is BoardElement[] =>
  Array.isArray(x) &&
  x.length <= MAX_ELEMENTS &&
  x.every(e => e && typeof e === 'object' && typeof e.id === 'string' && typeof e.version === 'number' && typeof e.versionNonce === 'number')

export function newBoardMeta(): BoardMeta {
  const d = new Date()
  const when = d.toLocaleString('es-AR', {day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'})
  return {id: crypto.randomUUID(), title: `Pizarra ${when}`}
}

// ── La pizarra abierta en la llamada ────────────────────────

interface CallLike {
  readonly inCall: boolean
  readonly members: Set<string>
}

interface Active extends BoardMeta {
  presenter: string // 'me' o el peerId de quien la presenta
}

export class BoardController {
  /** la pizarra que presento yo (va en mi estado) */
  private presenting: BoardMeta | null = null
  private active: Active | null = null
  private view: BoardView | null = null
  private mounting: Promise<void> | null = null
  private pendingIn: BoardElement[] = []
  private outbox = new Map<string, BoardElement>()
  private sendTimer: number | null = null
  private lastPointer = 0
  private peers = new Map<string, {x: number; y: number; down: boolean; at: number}>()
  private changes = 0 // cambios locales o ajenos sin guardar (contador)
  private savedChanges = 0
  private saving = false
  private syncing = false
  private fresh = new Set<string>() // pizarras nuevas (no hay nada guardado que cargar)
  private lastSaved: Date | null = null
  /** null = todavía no se sabe; false = no hay Dashboard o falta configurarlo (solo descargar) */
  canSave: boolean | null = null
  private send: (m: Msg, opts?: {target?: string | string[]}) => Promise<unknown>

  readonly el: HTMLElement
  private canvasBox: HTMLElement
  private titleInput: HTMLInputElement
  private who: HTMLElement
  private status: HTMLElement
  private btnClose: HTMLButtonElement

  constructor(
    private net: Net,
    private me: Person,
    private key: string,
    private call: CallLike,
    private h: {toast: (msg: string, ic?: string) => void; changed: () => void}
  ) {
    // los elementos de Excalidraw son JSON, pero su tipo es abierto: se declara la acción a mano
    const action = net.room.makeAction('board') as unknown as {
      send: (m: Msg, opts?: {target?: string | string[]}) => Promise<unknown>
      onMessage: ((m: Msg, ctx: {peerId: string}) => void) | null
    }
    this.send = (m, opts) => action.send(m, opts)
    action.onMessage = (m, {peerId}) => this.receive(m, peerId)

    this.el = document.createElement('div')
    this.el.className = 'tile board'
    this.el.innerHTML = `
      <div class="board-bar">
        <i class="board-ic">${icon('board', 18)}</i>
        <input class="board-title" maxlength="80" spellcheck="false" aria-label="Nombre de la pizarra">
        <span class="board-who"></span>
        <span class="board-status"></span>
        <button class="board-btn" data-act="save" title="Guardar ahora">${icon('save', 16)}<span>Guardar</span></button>
        <button class="board-btn" data-act="png" title="Descargar como imagen">${icon('download', 16)}</button>
        <button class="board-btn warn" data-act="close" title="Cerrar la pizarra para todos">Cerrar pizarra</button>
      </div>
      <div class="board-canvas"></div>
      <button class="board-expand" data-act="expand">${icon('board', 18)}<span>Abrir la pizarra en grande</span></button>`
    this.canvasBox = this.el.querySelector('.board-canvas')!
    this.titleInput = this.el.querySelector('.board-title')!
    this.who = this.el.querySelector('.board-who')!
    this.status = this.el.querySelector('.board-status')!
    this.btnClose = this.el.querySelector('[data-act=close]')!
    this.el.querySelector<HTMLButtonElement>('[data-act=save]')!.onclick = () => void this.save(true)
    this.el.querySelector<HTMLButtonElement>('[data-act=png]')!.onclick = () => void this.download()
    this.btnClose.onclick = () => void this.stop()
    this.titleInput.onchange = () => {
      const t = this.titleInput.value.trim().slice(0, 80)
      if (!this.presenting || !t) return void (this.titleInput.value = this.active?.title ?? '')
      this.presenting.title = t
      if (this.active) this.active.title = t
      this.changes++
      this.h.changed()
    }
    new ResizeObserver(() => this.view?.refresh()).observe(this.canvasBox)
    setInterval(() => this.autosave(), AUTOSAVE_MS)
    setInterval(() => this.renderStatus(), 20_000)
    void this.checkSave()
  }

  /** Lo que va en mi estado (PlayerState.board). */
  get presentingState(): BoardMeta | null {
    return this.presenting ? {...this.presenting} : null
  }

  get activeId() {
    return this.active?.id ?? null
  }

  async checkSave() {
    this.canSave = (await listBoards(this.key)) !== null
    this.renderStatus()
    return this.canSave
  }

  /** Presentar una pizarra en la llamada: nueva (`fresh`, no hay nada que cargar) o una guardada. */
  start(meta: BoardMeta, fresh = false) {
    if (!this.call.inCall) return
    if (this.active && this.active.presenter !== 'me') {
      this.h.toast('Ya hay una pizarra abierta en esta llamada.', 'board')
      return
    }
    if (this.active?.id === meta.id) return
    this.presenting = {...meta}
    if (fresh) this.fresh.add(meta.id)
    netLog(`Abro la pizarra «${meta.title}»`)
    this.sync()
    this.h.changed()
  }

  /** Dejar de presentar (guarda antes). */
  async stop() {
    if (!this.presenting) return
    netLog('Cierro la pizarra')
    this.presenting = null
    this.sync()
    this.h.changed()
  }

  /**
   * Qué pizarra corresponde mostrar ahora: la mía si la presento, o la que presenta alguien de mi
   * llamada. Monta o desmonta Excalidraw según haga falta. Barato: se llama seguido.
   */
  sync() {
    if (this.syncing) return // la llamada vuelve a pedir el cuadro mientras se arma: ya se está resolviendo
    this.syncing = true
    try {
      this.syncNow()
    } finally {
      this.syncing = false
    }
  }

  private syncNow() {
    if (this.presenting && !this.call.inCall) {
      netLog('Salí de la llamada: dejo de presentar la pizarra')
      this.presenting = null
      this.h.changed()
    }
    let next: Active | null = null
    if (this.presenting) next = {...this.presenting, presenter: 'me'}
    else {
      for (const id of [...this.call.members].sort()) {
        const b = this.net.players.get(id)?.board
        if (b && typeof b.id === 'string') {
          next = {id: b.id, title: String(b.title ?? 'Pizarra').slice(0, 80), presenter: id}
          break
        }
      }
    }
    if (next?.id !== this.active?.id) {
      this.unmount()
      if (next) this.mount(next)
    } else if (next && this.active) {
      this.active.title = next.title
      this.active.presenter = next.presenter
    }
    this.renderBar()
    // cursores de quienes ya no están en la llamada
    const now = performance.now()
    let gone = false
    for (const [id, p] of this.peers) {
      if (!this.call.members.has(id) || now - p.at > 10_000) {
        this.peers.delete(id)
        gone = true
      }
    }
    if (gone) this.pushPeers()
  }

  /** El cuadro de la pizarra para la llamada (o null si no hay). */
  tile(): {key: string; el: HTMLElement} | null {
    this.sync()
    return this.active ? {key: `board:${this.active.id}`, el: this.el} : null
  }

  private mount(b: Active) {
    this.active = {...b}
    this.changes = this.savedChanges = 0
    this.lastSaved = null
    this.pendingIn = []
    this.outbox.clear()
    this.peers.clear()
    const id = b.id
    this.mounting = (async () => {
      // si la presento yo y está guardada, arranca con lo guardado; si no, se la pido a los demás
      let initial: BoardElement[] = []
      const fresh = this.fresh.delete(id) // recién creada: solo la primera vez no hay nada que cargar
      if (b.presenter === 'me' && this.canSave !== false && !fresh) initial = (await loadBoard(this.key, id)) ?? []
      const {mountBoard} = await import('./board-view')
      if (this.active?.id !== id) return
      this.canvasBox.replaceChildren()
      const host = document.createElement('div')
      host.className = 'board-host'
      this.canvasBox.append(host)
      this.view = mountBoard(host, {
        elements: initial,
        onLocalChange: els => this.queueOut(els),
        onPointer: (x, y, down) => this.pointer(x, y, down)
      })
      if (this.pendingIn.length) {
        await this.view.merge(this.pendingIn)
        this.pendingIn = []
      }
      const target = [...this.call.members]
      // lo que ya tengo (por ejemplo, la pizarra guardada) va a todos; y pido lo que tengan ellos
      const mine = this.view.elements()
      if (mine.length && target.length) void this.send({k: 'els', b: id, els: mine}, {target})
      if (target.length) void this.send({k: 'hi', b: id}, {target})
      netLog(`Pizarra abierta (${initial.length} elementos guardados)`)
    })().catch(e => {
      netLog(`No se pudo abrir la pizarra: ${String(e).slice(0, 120)}`)
      this.h.toast('No se pudo abrir la pizarra. Probá de nuevo.', 'board')
    })
  }

  /** Cierra la pizarra actual: manda lo pendiente, guarda mis cambios sin guardar y desmonta. */
  private unmount() {
    const was = this.active
    if (!was) return
    this.flushOut()
    const view = this.view
    const mounting = this.mounting
    const unsaved = this.changes > this.savedChanges
    this.active = null
    this.view = null
    this.mounting = null
    this.peers.clear()
    void (async () => {
      await mounting
      if (view && unsaved) await this.persist(view, was, false)
      view?.destroy()
    })()
    queueMicrotask(() => this.h.changed())
  }

  // ── red ──

  private queueOut(els: BoardElement[]) {
    for (const e of els) this.outbox.set(e.id, e)
    this.changes++
    this.renderStatus()
    this.sendTimer ??= window.setTimeout(() => this.flushOut(), SEND_EVERY_MS)
  }

  private flushOut() {
    if (this.sendTimer !== null) clearTimeout(this.sendTimer)
    this.sendTimer = null
    if (!this.active || !this.outbox.size) return
    const els = [...this.outbox.values()]
    this.outbox.clear()
    const target = [...this.call.members]
    if (target.length) void this.send({k: 'els', b: this.active.id, els}, {target})
  }

  private pointer(x: number, y: number, down: boolean) {
    const now = performance.now()
    if (!this.active || now - this.lastPointer < POINTER_EVERY_MS) return
    this.lastPointer = now
    const target = [...this.call.members]
    if (target.length) void this.send({k: 'ptr', b: this.active.id, x: Math.round(x), y: Math.round(y), d: down ? 1 : 0}, {target})
  }

  private receive(m: Msg, peerId: string) {
    if (!m || typeof m !== 'object' || !this.active || m.b !== this.active.id) return
    if (!this.call.members.has(peerId)) return
    if (m.k === 'els' && validEls(m.els)) {
      // lo ajeno lo guarda quien lo dibujó (el servidor mezcla); acá solo se muestra
      if (this.view) void this.view.merge(m.els)
      else this.pendingIn.push(...m.els)
    } else if (m.k === 'hi') {
      const els = this.view?.elements() ?? []
      if (els.length) void this.send({k: 'els', b: m.b, els}, {target: peerId})
    } else if (m.k === 'ptr' && Number.isFinite(m.x) && Number.isFinite(m.y)) {
      this.peers.set(peerId, {x: m.x, y: m.y, down: m.d === 1, at: performance.now()})
      this.pushPeers()
    }
  }

  private pushPeers() {
    this.view?.setPeers(
      [...this.peers].map(([id, p]) => {
        const person = personById(this.net.players.get(id)?.person ?? '')
        return {id, name: person?.name.split(' ')[0] ?? 'Invitado', color: person?.color ?? '#888', ...p}
      })
    )
  }

  // ── guardar y descargar ──

  private autosave() {
    if (this.view && this.changes > this.savedChanges) void this.save(false)
  }

  /** Guardar la pizarra abierta (Guardar, cada 15 s con cambios propios). */
  async save(manual: boolean) {
    const b = this.active
    const view = this.view
    if (!b || !view || this.saving) return
    if (this.canSave === false && !(await this.checkSave())) {
      if (manual) this.h.toast('No se puede guardar: la oficina no tiene configurado el guardado. Podés descargarla como imagen.', 'board')
      return
    }
    // un Guardar a mano guarda aunque no haya cambios propios (por ejemplo, lo que dibujaron otros)
    if (manual) this.changes++
    this.saving = true
    this.renderStatus()
    const upTo = this.changes
    const ok = await this.persist(view, b, manual)
    this.saving = false
    if (ok && this.active?.id === b.id) {
      this.savedChanges = Math.max(this.savedChanges, upTo)
      this.lastSaved = new Date()
    }
    this.renderStatus()
  }

  private async persist(view: BoardView, b: BoardMeta, manual: boolean) {
    const ok = await saveBoard(this.key, b, view.elements(), this.me.id)
    if (ok) this.canSave = true
    else if (manual) this.h.toast('No se pudo guardar la pizarra. Se reintenta sola en unos segundos.', 'board')
    return ok
  }

  private async download() {
    const blob = await this.view?.png()
    if (!blob) return this.h.toast('La pizarra está vacía.', 'board')
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `${(this.active?.title ?? 'Pizarra').replace(/[\\/:*?"<>|]+/g, '-')}.png`
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 5000)
  }

  // ── barra ──

  private renderBar() {
    const b = this.active
    if (!b) return
    const mine = b.presenter === 'me'
    if (document.activeElement !== this.titleInput) this.titleInput.value = b.title
    this.titleInput.readOnly = !mine
    this.titleInput.title = mine ? 'Cambiar el nombre' : b.title
    const p = mine ? null : personById(this.net.players.get(b.presenter)?.person ?? '')
    this.who.textContent = mine ? 'la presentás vos' : `de ${p?.name.split(' ')[0] ?? 'otra persona'}`
    this.btnClose.hidden = !mine
    this.renderStatus()
  }

  private renderStatus() {
    if (!this.active) return
    const hh = (d: Date) => d.toLocaleTimeString('es-AR', {hour: '2-digit', minute: '2-digit', hourCycle: 'h23'})
    const pending = this.changes > this.savedChanges
    this.status.textContent =
      this.canSave === false
        ? 'Sin guardado'
        : this.saving
          ? 'Guardando…'
          : pending
            ? this.lastSaved
              ? `Cambios sin guardar · ${hh(this.lastSaved)}`
              : 'Sin guardar'
            : this.lastSaved
              ? `Guardada ${hh(this.lastSaved)}`
              : ''
    this.status.title = this.canSave === false ? 'La oficina no tiene configurado el guardado: podés descargarla como imagen.' : ''
    this.el.querySelector<HTMLButtonElement>('[data-act=save]')!.disabled = this.canSave === false
  }
}
