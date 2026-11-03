/**
 * Registro de lo que pasa con las conexiones (para "Copiar diagnóstico" en Ajustes → Conexión).
 * Guarda los últimos eventos en memoria; no se manda a ningún lado ni incluye direcciones IP.
 */
const MAX = 120
const events: string[] = []
const t0 = Date.now()

export function netLog(msg: string) {
  const s = Math.round((Date.now() - t0) / 1000)
  const hh = String(Math.floor(s / 3600)).padStart(2, '0')
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0')
  const ss = String(s % 60).padStart(2, '0')
  events.push(`+${hh}:${mm}:${ss} ${msg}`)
  if (events.length > MAX) events.splice(0, events.length - MAX)
}

export function netEvents(): string[] {
  return [...events]
}

/** Cómo va la conexión con una persona, leído de las estadísticas de WebRTC. */
export interface LinkInfo {
  state: RTCPeerConnectionState
  /** 'directo' (red local o internet) o 'respaldo' (pasa por el servidor TURN); null si todavía no hay camino */
  path: 'directo' | 'respaldo' | null
  /** tipo de candidato local y remoto (host / srflx / prflx / relay) */
  kinds: string
  rtt: number | null // ms
}

export async function linkInfo(pc: RTCPeerConnection): Promise<LinkInfo> {
  const info: LinkInfo = {state: pc.connectionState, path: null, kinds: '', rtt: null}
  try {
    const stats = await pc.getStats()
    let pair: RTCIceCandidatePairStats | undefined
    stats.forEach(r => {
      if (r.type === 'transport' && r.selectedCandidatePairId) pair = stats.get(r.selectedCandidatePairId)
    })
    if (!pair) {
      stats.forEach(r => {
        const c = r as RTCIceCandidatePairStats & {selected?: boolean}
        if (r.type === 'candidate-pair' && (c.selected || (c.nominated && c.state === 'succeeded'))) pair ??= c
      })
    }
    if (!pair) return info
    const local = stats.get(pair.localCandidateId) as {candidateType?: string} | undefined
    const remote = stats.get(pair.remoteCandidateId) as {candidateType?: string} | undefined
    const lt = local?.candidateType ?? '?'
    const rt = remote?.candidateType ?? '?'
    info.kinds = `${lt}/${rt}`
    info.path = lt === 'relay' || rt === 'relay' ? 'respaldo' : 'directo'
    if (typeof pair.currentRoundTripTime === 'number') info.rtt = Math.round(pair.currentRoundTripTime * 1000)
  } catch {
    /* conexión cerrada */
  }
  return info
}
