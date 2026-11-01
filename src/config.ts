// ─────────────────────────────────────────────────────────────
//  CONFIGURACIÓN DE LA OFICINA
//  Para agregar a alguien: sumá una entrada en PEOPLE con un
//  `desk` libre (1 a 12) y un `sprite`: uno de LimeZu (Adam, Alex, Alex_b,
//  Amelia, Bob) o uno propio de CUSTOM_SPRITES en src/assets.ts (Miguel, Nico, Fran, Agus).
// ─────────────────────────────────────────────────────────────

export interface Person {
  id: string
  name: string
  role: string
  color: string
  desk: number // 1..12
  sprite: string // personaje pixel art: Adam, Alex, Alex_b, Amelia, Bob o propio (Miguel, Nico, Fran, Agus)
}

export const PEOPLE: Person[] = [
  {id: 'miguel', name: 'Miguel Marin', role: 'CEO', color: '#b8693a', desk: 1, sprite: 'Miguel'},
  {id: 'nico', name: 'Nico Iannaci', role: 'CEO', color: '#4f7ea6', desk: 2, sprite: 'Nico'},
  {id: 'francisco', name: 'Francisco Di Giorno', role: 'COO', color: '#4f8f6a', desk: 3, sprite: 'Fran'},
  {id: 'carina', name: 'Carina', role: 'Project Manager', color: '#8a6bb8', desk: 4, sprite: 'Amelia'},
  {id: 'agus', name: 'Agus', role: 'Editor', color: '#c9a04f', desk: 5, sprite: 'Agus'}
]

export const DESK_COUNT = 12

// Identificador de la app en la red de conexión. Cambiarlo crea
// una oficina nueva y vacía (nadie de la anterior se verá).
export const APP_ID = 'oficina-virtual-mc-7f3a9c'
export const ROOM_ID = 'oficina-principal'

// Relays de señalización (solo se usan para que los navegadores se
// encuentren; el video y las posiciones viajan directo entre ustedes).
// Todos tienen que usar la misma lista (viene en el código, no hay que tocar nada).
export const RELAY_URLS: string[] = [
  'wss://nos.lol',
  'wss://relay.damus.io',
  'wss://relay.primal.net',
  'wss://nostr.mom',
  'wss://nostr.robosats.org',
  'wss://relay.nostr.dev.br',
  'wss://nostr.stakey.net',
  'wss://relay.degmods.com'
]

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
