import {icon} from './icons'
import {LOGIN_URL} from './session'

/**
 * Calendario de Google en la oficina (solo si entraste con Google).
 *
 * - Pide tus reuniones de hoy y mañana al Dashboard (/api/office/calendar) cada 5 minutos.
 * - Durante una reunión (evento con horario, no marcado "disponible") quedás "En reunión": cuenta
 *   como Ocupado (no te entran llamadas de la oficina) y los demás lo ven así.
 * - Avisa 5 minutos antes y al empezar, con "Unirse" si la reunión tiene link. Una reunión se puede
 *   ignorar (no te pone en reunión); se recuerda en este navegador.
 */

export interface CalEvent {
  id: string
  titulo: string
  inicio: string
  fin: string
  todoElDia: boolean
  link: string | null
  ocupado: boolean
}

type State = 'off' | 'loading' | 'ok' | 'permiso' | 'reconectar' | 'error'

interface Hooks {
  /** cambió la reunión actual o la lista (recalcular estado, redibujar) */
  changed: () => void
  toast: (msg: string, actions: {label: string; fn: () => void}[], ic: string, ms?: number) => void
  notify: (title: string, body: string, onClick: () => void) => void
}

const REFRESH_MS = 5 * 60_000
const REMIND_BEFORE_MS = 5 * 60_000
const LS_IGNORED = 'ov.cal.ignoradas'

export class Calendar {
  state: State
  events: CalEvent[] = []
  private updated: Date | null = null
  private ignored: Set<string>
  private reminded = new Set<string>()
  private lastCurrent: string | null = null

  /** `enabled`: hay sesión de Google con permiso de calendario. `google`: entró con Google. */
  constructor(
    enabled: boolean,
    google: boolean,
    private h: Hooks
  ) {
    this.state = enabled ? 'loading' : google ? 'permiso' : 'off'
    this.ignored = new Set(readIgnored())
    if (!enabled) return
    void this.refresh()
    setInterval(() => void this.refresh(), REFRESH_MS)
    setInterval(() => this.tick(), 20_000)
  }

  async refresh() {
    const now = new Date()
    const from = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const to = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 2)
    try {
      const r = await fetch(`/api/office/calendar?desde=${from.toISOString()}&hasta=${to.toISOString()}`, {
        cache: 'no-store',
        credentials: 'same-origin'
      })
      const d = (await r.json()) as {ok?: boolean; eventos?: CalEvent[]; error?: {codigo?: string}}
      if (r.ok && d.ok) {
        this.events = d.eventos ?? []
        this.state = 'ok'
        this.updated = new Date()
      } else if (d.error?.codigo === 'reconectar') this.state = 'reconectar'
      else if (d.error?.codigo === 'sin_permiso') this.state = 'permiso'
      else if (this.state !== 'ok') this.state = 'error' // si ya había datos, se siguen usando
    } catch {
      if (this.state !== 'ok') this.state = 'error'
    }
    this.tick()
    this.h.changed()
  }

  /** La reunión en la que estás ahora (la que te pone "En reunión"), o null. */
  current(now = Date.now()): CalEvent | null {
    return (
      this.events.find(e => e.ocupado && !this.ignored.has(e.id) && start(e) <= now && now < end(e)) ?? null
    )
  }

  ignore(id: string, on = true) {
    if (on) this.ignored.add(id)
    else this.ignored.delete(id)
    writeIgnored([...this.ignored].filter(i => this.events.some(e => e.id === i)).concat(on ? [id] : []))
    this.tick()
    this.h.changed()
  }

  /** Avisos (5 min antes y al empezar) y cambio de "En reunión". */
  private tick() {
    const now = Date.now()
    for (const e of this.events) {
      if (e.todoElDia || !e.ocupado || this.ignored.has(e.id)) continue
      const s = start(e)
      const join = e.link ? [{label: 'Unirse', fn: () => window.open(e.link!, '_blank', 'noopener')}] : []
      if (s - now <= REMIND_BEFORE_MS && s - now > 60_000 && !this.reminded.has(`${e.id}:antes`)) {
        this.reminded.add(`${e.id}:antes`)
        const min = Math.round((s - now) / 60_000)
        this.h.toast(`«${e.titulo}» empieza en ${min} min.`, join, 'calendar', 20_000)
        this.h.notify('Oficina virtual', `«${e.titulo}» empieza en ${min} min`, () => e.link && window.open(e.link, '_blank'))
      }
      // al empezar (o al abrir la oficina en medio de la reunión, si empezó hace poco)
      if (s <= now && now - s < 10 * 60_000 && now < end(e) && !this.reminded.has(`${e.id}:empieza`)) {
        this.reminded.add(`${e.id}:empieza`)
        this.reminded.add(`${e.id}:antes`)
        this.h.toast(
          `Estás en «${e.titulo}» hasta las ${hhmm(end(e))}: en la oficina figurás En reunión y no te entran llamadas.`,
          [...join, {label: 'Ignorar', fn: () => this.ignore(e.id)}],
          'calendar',
          20_000
        )
      }
    }
    const cur = this.current(now)?.id ?? null
    if (cur !== this.lastCurrent) {
      this.lastCurrent = cur
      this.h.changed()
    }
  }

  /** Panel lateral "Calendario". */
  render(box: HTMLElement) {
    box.replaceChildren()
    const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = '') => {
      const n = document.createElement(tag)
      if (cls) n.className = cls
      if (text) n.textContent = text
      return n
    }
    const empty = (title: string, body: string, action?: HTMLElement) => {
      const w = el('div', 'cal-empty')
      const big = el('div', 'big')
      big.innerHTML = icon('calendar', 30)
      w.append(big, el('h3', '', title), el('p', 'muted', body))
      if (action) w.append(action)
      box.append(w)
    }
    const connect = (label: string) => {
      const a = el('a', 'cal-connect', label)
      a.href = LOGIN_URL
      return a
    }
    if (this.state === 'off') {
      return empty(
        'Calendario',
        'Se activa cuando la oficina usa el ingreso con Google: ahí vas a ver tus reuniones y tu estado cambia solo a En reunión.'
      )
    }
    if (this.state === 'permiso') {
      return empty('Calendario', 'Para ver tus reuniones, la oficina necesita permiso para leer tu Google Calendar.', connect('Conectar calendario'))
    }
    if (this.state === 'reconectar') {
      return empty('Calendario', 'Google pidió volver a conectar tu calendario.', connect('Volver a conectar'))
    }
    if (this.state === 'loading') return empty('Calendario', 'Cargando tus reuniones…')
    if (this.state === 'error') return empty('Calendario', 'No se pudo leer tu calendario. Se reintenta solo en unos minutos.')

    const now = Date.now()
    const today = new Date()
    const days = [0, 1].map(i => new Date(today.getFullYear(), today.getMonth(), today.getDate() + i))
    const cur = this.current(now)
    days.forEach((day, i) => {
      const next = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1).getTime()
      const list = this.events.filter(e => start(e) < next && end(e) > day.getTime() && (i === 0 ? end(e) > now - 60 * 60_000 : true))
      const label = day.toLocaleDateString('es-AR', {weekday: 'long', day: 'numeric', month: 'long'})
      box.append(el('span', 'eyebrow', `${i === 0 ? 'Hoy' : 'Mañana'} · ${label}`))
      if (!list.length) {
        box.append(el('p', 'muted small', i === 0 ? 'No tenés más reuniones hoy.' : 'Sin reuniones.'))
        return
      }
      const ul = el('ul', 'cal-list')
      for (const e of list) {
        const li = el('li', 'cal-ev')
        const past = end(e) <= now
        const isNow = !e.todoElDia && start(e) <= now && now < end(e)
        li.classList.toggle('past', past)
        li.classList.toggle('now', isNow)
        const time = el('div', 'cal-time')
        if (e.todoElDia) time.textContent = 'Todo el día'
        else time.append(el('span', '', hhmm(start(e))), el('span', '', hhmm(end(e))))
        const info = el('div', 'cal-info')
        info.append(el('b', '', e.titulo))
        const ignored = this.ignored.has(e.id)
        const tag = isNow ? (cur?.id === e.id ? 'Ahora · En reunión' : ignored ? 'Ahora · Ignorada' : 'Ahora') : !e.ocupado && !e.todoElDia ? 'Disponible' : ''
        if (tag) info.append(el('small', '', tag))
        li.append(time, info)
        const acts = el('div', 'cal-acts')
        if (e.link && !past) {
          const a = el('a', 'cal-join', 'Unirse')
          a.href = e.link
          a.target = '_blank'
          a.rel = 'noopener'
          acts.append(a)
        }
        if (e.ocupado && !past) {
          const b = el('button', 'cal-ignore', ignored ? 'Tener en cuenta' : 'Ignorar')
          b.title = ignored ? 'Que vuelva a ponerte En reunión' : 'Que no te ponga En reunión'
          b.onclick = () => this.ignore(e.id, !ignored)
          acts.append(b)
        }
        li.append(acts)
        ul.append(li)
      }
      box.append(ul)
    })
    const foot = el('p', 'muted small cal-foot', this.updated ? `Actualizado ${hhmm(this.updated.getTime())} · ` : '')
    const again = el('button', 'cal-refresh', 'Actualizar')
    again.onclick = () => void this.refresh()
    foot.append(again)
    box.append(foot)
  }
}

/** Inicio y fin en ms; los de todo el día vienen como AAAA-MM-DD (fecha local). */
function start(e: CalEvent) {
  return parse(e.inicio)
}
function end(e: CalEvent) {
  return parse(e.fin)
}
function parse(s: string) {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s)
  return d ? new Date(+d[1], +d[2] - 1, +d[3]).getTime() : new Date(s).getTime()
}
export function hhmm(ms: number) {
  return new Date(ms).toLocaleTimeString('es-AR', {hour: '2-digit', minute: '2-digit', hourCycle: 'h23'})
}
function readIgnored(): string[] {
  try {
    return JSON.parse(localStorage.getItem(LS_IGNORED) ?? '[]') as string[]
  } catch {
    return []
  }
}
function writeIgnored(ids: string[]) {
  try {
    localStorage.setItem(LS_IGNORED, JSON.stringify([...new Set(ids)].slice(-50)))
  } catch {
    /* ignore */
  }
}
