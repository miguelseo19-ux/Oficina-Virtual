// ─────────────────────────────────────────────────────────────
//  CONFIGURACIÓN DE LA OFICINA
//  Para agregar a alguien: sumá una entrada en PEOPLE con un
//  `desk` libre (1 a 12). No hace falta tocar nada más.
// ─────────────────────────────────────────────────────────────

export interface Person {
  id: string
  name: string
  role: string
  color: string
  desk: number // 1..12
}

export const PEOPLE: Person[] = [
  {id: 'miguel', name: 'Miguel Marin', role: 'CEO', color: '#e4572e', desk: 1},
  {id: 'nico', name: 'Nico Iannaci', role: 'CEO', color: '#2e86ab', desk: 2},
  {id: 'francisco', name: 'Francisco Di Giorno', role: 'COO', color: '#3bb273', desk: 3},
  {id: 'carina', name: 'Carina', role: 'Project Manager', color: '#9b5de5', desk: 4},
  {id: 'agus', name: 'Agus', role: 'Editor', color: '#f2a541', desk: 5}
]

export const DESK_COUNT = 12

// Identificador de la app en la red de conexión. Cambiarlo crea
// una oficina nueva y vacía (nadie de la anterior se verá).
export const APP_ID = 'oficina-virtual-mc-7f3a9c'
export const ROOM_ID = 'oficina-principal'

// Relays de señalización (solo se usan para que los navegadores se
// encuentren; el video y las posiciones viajan directo entre ustedes).
// Vacío = usa los relays públicos por defecto de la librería.
export const RELAY_URLS: string[] = []

// Servidores TURN opcionales, solo hacen falta si alguien está en
// una red corporativa muy cerrada y no logra ver/escuchar a otros.
// Ver README → "Problemas de conexión".
export const TURN_SERVERS: RTCIceServer[] = []

export function personById(id: string): Person | undefined {
  return PEOPLE.find(p => p.id === id)
}

export function deskOwner(desk: number): Person | undefined {
  return PEOPLE.find(p => p.desk === desk)
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map(w => w[0]?.toUpperCase() ?? '')
    .join('')
}
