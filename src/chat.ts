import {initials, PEOPLE, personById, type Person} from './config'
import type {ChatMsg, Net} from './net'

/**
 * Chat de texto:
 *  - General: lo ve todo el equipo conectado.
 *  - Cerca: solo quienes están cerca tuyo en el mapa (o en tu misma alfombra).
 *  - Privados: uno a uno.
 * Los mensajes viajan directo entre navegadores: solo los reciben quienes
 * están conectados en ese momento. Cada uno guarda su historial en su navegador.
 */

const MAX_PER_CHANNEL = 200

type Channel = string // 'general' | 'nearby' | 'dm:<personId>'

interface Hooks {
  nearbyPeers: () => string[]
  onNearbyMessage: (fromPerson: string, text: string) => void
  onDirectMessage: (from: Person, text: string, open: () => void) => void
  /** Comandos que empiezan con "/" (no se envían como mensaje). */
  onCommand: (text: string) => void
  /** El panel lateral debe mostrar el chat / se cerró el chat. */
  onOpen: () => void
  onClose: () => void
}

export class Chat {
  private history: Record<Channel, ChatMsg[]> = {}
  private unread: Record<Channel, number> = {}
  private seen = new Set<string>()
  private active: Channel = 'general'
  private storeKey: string

  private panel = document.getElementById('chat')!
  private channelsEl = document.getElementById('chat-channels')!
  private log = document.getElementById('chat-log')!
  private title = document.getElementById('chat-title')!
  private input = document.getElementById('chat-input') as HTMLInputElement
  private badge = document.getElementById('chat-badge')!

  constructor(
    private me: Person,
    private net: Net,
    private hooks: Hooks
  ) {
    this.storeKey = `ov.chat.${me.id}`
    try {
      const raw = localStorage.getItem(this.storeKey)
      if (raw) this.history = JSON.parse(raw)
    } catch {
      this.history = {}
    }
    for (const list of Object.values(this.history)) for (const m of list) this.seen.add(m.id)

    ;(document.getElementById('chat-form') as HTMLFormElement).onsubmit = e => {
      e.preventDefault()
      this.send()
    }
    this.input.addEventListener('keydown', e => {
      if (e.key === 'Escape') this.close()
    })
    this.renderChannels()
    this.renderBadge()
  }

  get isOpen() {
    return !this.panel.hidden
  }

  toggle() {
    if (this.isOpen) this.close()
    else this.open()
  }

  open(ch?: Channel) {
    if (ch) this.active = ch
    this.hooks.onOpen()
    this.panel.hidden = false
    this.unread[this.active] = 0
    this.renderChannels()
    this.renderLog()
    this.renderBadge()
    setTimeout(() => this.input.focus(), 0)
  }

  openDM(personId: string) {
    this.open(`dm:${personId}`)
  }

  close() {
    const wasOpen = this.isOpen
    this.panel.hidden = true
    this.input.blur()
    if (wasOpen) this.hooks.onClose()
  }

  /** Ocultar sin avisar (otra pestaña del panel ocupa el lugar). */
  hide() {
    this.panel.hidden = true
    this.input.blur()
  }

  /** Mensaje recibido de otra persona. */
  receive(m: ChatMsg) {
    if (this.seen.has(m.id)) return
    if (m.ch === 'dm' && m.to !== this.me.id) return
    if (m.text.length > 2000) m.text = m.text.slice(0, 2000)
    const ch: Channel = m.ch === 'dm' ? `dm:${m.from}` : m.ch
    this.store(ch, m)

    const visible = this.isOpen && this.active === ch
    if (!visible) this.unread[ch] = (this.unread[ch] ?? 0) + 1
    if (visible) this.renderLog()
    this.renderChannels()
    this.renderBadge()

    if (m.ch === 'nearby') this.hooks.onNearbyMessage(m.from, m.text)
    if (m.ch === 'dm' && !visible) {
      const from = personById(m.from)
      if (from) this.hooks.onDirectMessage(from, m.text, () => this.openDM(from.id))
    }
  }

  private send() {
    const text = this.input.value.trim()
    if (!text) return
    this.input.value = ''
    if (text.startsWith('/')) {
      this.hooks.onCommand(text)
      return
    }
    this.sendTo(this.active, text)
  }

  /** Envía un mensaje a un canal ('general', 'nearby' o 'dm:<id>'). */
  sendTo(ch: Channel, text: string) {
    const isDM = ch.startsWith('dm:')
    const to = isDM ? ch.slice(3) : null
    const m: ChatMsg = {
      id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      ch: isDM ? 'dm' : (ch as 'general' | 'nearby'),
      from: this.me.id,
      to,
      text,
      ts: Date.now()
    }
    this.store(ch, m)
    if (ch === 'general') this.net.sendChat(m)
    else if (ch === 'nearby') {
      this.net.sendChat(m, this.hooks.nearbyPeers())
      this.hooks.onNearbyMessage(this.me.id, text)
    } else if (to) this.net.sendChat(m, this.net.peersOf(to))
    if (this.isOpen && this.active === ch) this.renderLog()
    this.renderChannels()
  }

  private store(ch: Channel, m: ChatMsg) {
    this.seen.add(m.id)
    const list = (this.history[ch] ??= [])
    list.push(m)
    if (list.length > MAX_PER_CHANNEL) list.splice(0, list.length - MAX_PER_CHANNEL)
    try {
      localStorage.setItem(this.storeKey, JSON.stringify(this.history))
    } catch {
      /* lleno o modo privado */
    }
  }

  /** Refresca la lista (se llama cuando alguien se conecta/desconecta). */
  refresh() {
    if (this.isOpen) this.renderChannels()
  }

  // ── UI ─────────────────────────────────────────────────────

  private channelName(ch: Channel) {
    if (ch === 'general') return '# General'
    if (ch === 'nearby') return '📍 Cerca'
    return personById(ch.slice(3))?.name ?? 'Privado'
  }

  private renderChannels() {
    const online = new Set([...this.net.players.values()].map(p => p.person))
    const items: {ch: Channel; label: string; color?: string; online?: boolean}[] = [
      {ch: 'general', label: '# General'},
      {ch: 'nearby', label: '📍 Cerca'},
      ...PEOPLE.filter(p => p.id !== this.me.id).map(p => ({
        ch: `dm:${p.id}`,
        label: p.name,
        color: p.color,
        online: online.has(p.id)
      }))
    ]
    this.channelsEl.replaceChildren(
      ...items.map(it => {
        const b = document.createElement('button')
        b.className = 'ch' + (it.ch === this.active ? ' active' : '') + (it.online === false ? ' off' : '')
        if (it.color) {
          const dot = document.createElement('span')
          dot.className = 'ch-dot'
          dot.style.background = it.color
          b.appendChild(dot)
        }
        const name = document.createElement('span')
        name.className = 'ch-name'
        name.textContent = it.label
        b.appendChild(name)
        const n = this.unread[it.ch] ?? 0
        if (n > 0) {
          const u = document.createElement('span')
          u.className = 'ch-unread'
          u.textContent = String(n)
          b.appendChild(u)
        }
        b.onclick = () => this.open(it.ch)
        return b
      })
    )
  }

  private renderLog() {
    const ch = this.active
    this.title.textContent =
      ch === 'nearby'
        ? '📍 Cerca — lo leen solo quienes están cerca tuyo en el mapa'
        : ch === 'general'
          ? '# General — todo el equipo conectado'
          : `Privado con ${this.channelName(ch)}`
    const list = this.history[ch] ?? []
    if (!list.length) {
      const p = document.createElement('p')
      p.className = 'chat-empty'
      p.textContent = 'Todavía no hay mensajes. Solo los reciben quienes están conectados en el momento.'
      this.log.replaceChildren(p)
      return
    }
    this.log.replaceChildren(
      ...list.map(m => {
        const who = personById(m.from)
        const row = document.createElement('div')
        row.className = 'msg' + (m.from === this.me.id ? ' mine' : '')
        const av = document.createElement('span')
        av.className = 'msg-av'
        av.style.background = who?.color ?? '#888'
        av.textContent = initials(who?.name ?? '?')
        const body = document.createElement('div')
        body.className = 'msg-body'
        const head = document.createElement('div')
        head.className = 'msg-head'
        head.textContent = `${m.from === this.me.id ? 'Vos' : (who?.name ?? 'Alguien')} · ${hhmm(m.ts)}`
        const text = document.createElement('div')
        text.className = 'msg-text'
        text.textContent = m.text
        body.append(head, text)
        row.append(av, body)
        return row
      })
    )
    this.log.scrollTop = this.log.scrollHeight
  }

  private renderBadge() {
    const total = Object.values(this.unread).reduce((a, b) => a + b, 0)
    this.badge.hidden = total === 0
    this.badge.textContent = total > 99 ? '99+' : String(total)
  }
}

function hhmm(ts: number) {
  const d = new Date(ts)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}
