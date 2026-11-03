import {TURN_SERVERS} from './config'
import {netLog} from './diag'

/**
 * Servidor de respaldo (TURN) para cuando la conexión directa entre dos compus no anda (algunos
 * wifi, routers o redes de empresa): el video y los datos pasan por él en vez de ir directo. Las
 * conexiones directas se siguen prefiriendo; el respaldo solo se usa si no hay otra.
 *
 * Las credenciales las genera el Dashboard (/api/office/turn, servicio TURN de Cloudflare) y vencen
 * solas. Se piden con una prueba de que conocés la clave de la oficina (un hash, no la clave). Sin
 * Dashboard (prueba local) o sin configurar, la oficina anda como antes: solo conexión directa.
 */
export interface TurnInfo {
  servers: RTCIceServer[]
  /** 'servidor' = credenciales del Dashboard; 'config' = TURN_SERVERS fijos; 'ninguno' */
  source: 'servidor' | 'config' | 'ninguno'
  /** por qué no hay respaldo del Dashboard (para el diagnóstico) */
  note: string
  expires: number | null
}

const TIMEOUT_MS = 4000

export async function turnProof(key: string): Promise<string> {
  const data = new TextEncoder().encode(`oficina-virtual:turn:${key}`)
  const hash = await crypto.subtle.digest('SHA-256', data)
  return [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, '0')).join('')
}

export async function loadTurn(key: string): Promise<TurnInfo> {
  const base: TurnInfo = {
    servers: [...TURN_SERVERS],
    source: TURN_SERVERS.length ? 'config' : 'ninguno',
    note: '',
    expires: null
  }
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  try {
    const r = await fetch('/api/office/turn', {
      headers: {'x-office-proof': await turnProof(key)},
      cache: 'no-store',
      credentials: 'same-origin',
      signal: ctrl.signal
    })
    // sin Dashboard (servidor de desarrollo de Vite) la respuesta es la página, no JSON
    if (!(r.headers.get('content-type') ?? '').includes('application/json')) return {...base, note: 'sin Dashboard'}
    const d = (await r.json()) as {ok?: boolean; iceServers?: RTCIceServer[]; vence?: number; error?: {codigo?: string}}
    if (!r.ok || !d.ok || !Array.isArray(d.iceServers) || !d.iceServers.length) {
      const note = d.error?.codigo ?? `HTTP ${r.status}`
      netLog(`Servidor de respaldo no disponible: ${note}`)
      return {...base, note}
    }
    netLog(`Servidor de respaldo listo (${d.iceServers.length} entradas)`)
    return {servers: [...base.servers, ...d.iceServers], source: 'servidor', note: '', expires: d.vence ?? null}
  } catch (e) {
    const note = ctrl.signal.aborted ? 'tardó demasiado' : 'error de red'
    netLog(`Servidor de respaldo: ${note} (${String(e).slice(0, 80)})`)
    return {...base, note}
  } finally {
    clearTimeout(timer)
  }
}
