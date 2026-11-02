/**
 * Ingreso a la oficina con la cuenta de Google.
 *
 * El servidor es el Dashboard (repo Dashboard, rutas /api/office/*): la oficina vive en
 * www.myconsulting.cloud/office, así que comparte dominio y la cookie de sesión (cifrada y
 * httpOnly) viaja sola. El Dashboard comprueba que la cuenta sea del equipo y devuelve quién sos
 * y la clave de la sala: nadie la escribe.
 *
 * Mientras Google no esté configurado en el Dashboard (responde 503), o al probar en la compu
 * (localhost sin Dashboard), se usa el login de antes: elegir la persona y escribir la clave.
 */

export const OFFICIAL_URL = 'https://www.myconsulting.cloud/office'
const OFFICIAL_HOSTS = ['www.myconsulting.cloud', 'myconsulting.cloud']
const LOCAL_HOSTS = ['localhost', '127.0.0.1']
export const LOGIN_URL = '/api/office/auth/login'

export type Boot =
  | {kind: 'google'; person: string; email: string; key: string; calendar: boolean}
  | {kind: 'login'} // Google configurado, sin sesión: botón "Entrar con Google"
  | {kind: 'classic'} // Google sin configurar o prueba local: persona + clave

/** Qué pantalla mostrar al abrir. null = se está yendo a la dirección oficial. */
export async function boot(): Promise<Boot | null> {
  const host = location.hostname
  if (!OFFICIAL_HOSTS.includes(host) && !LOCAL_HOSTS.includes(host)) {
    // GitHub Pages y la dirección de Vercel: el ingreso con Google solo anda en el dominio
    location.replace(OFFICIAL_URL + location.search + location.hash)
    return null
  }
  try {
    const r = await fetch('/api/office/session', {cache: 'no-store', credentials: 'same-origin'})
    // sin Dashboard (servidor de desarrollo de Vite) la respuesta es la página, no JSON
    if (!(r.headers.get('content-type') ?? '').includes('application/json')) return {kind: 'classic'}
    const d = (await r.json()) as {ok?: boolean; persona?: string; email?: string; clave?: string; calendario?: boolean}
    if (r.ok && d.ok && d.persona && d.clave) {
      return {kind: 'google', person: d.persona, email: d.email ?? '', key: d.clave, calendar: !!d.calendario}
    }
    if (r.status === 401) return {kind: 'login'}
    return {kind: 'classic'}
  } catch {
    return {kind: 'classic'}
  }
}

/** Mensaje para el error con el que vuelve Google (?error=…), y lo saca de la dirección. */
export function takeLoginError(): string {
  const q = new URLSearchParams(location.search)
  const code = q.get('error')
  if (!code) return ''
  const email = q.get('email') ?? ''
  q.delete('error')
  q.delete('email')
  const rest = q.toString()
  history.replaceState(null, '', location.pathname + (rest ? `?${rest}` : '') + location.hash)
  switch (code) {
    case 'no_autorizado':
      return `La cuenta ${email} no está en el equipo de la oficina. Entrá con tu cuenta de trabajo o pedí que la agreguen.`
    case 'cancelado':
      return 'Cancelaste el ingreso con Google.'
    case 'no_configurado':
      return ''
    default:
      return 'No se pudo completar el ingreso con Google. Probá de nuevo.'
  }
}

export async function logoutGoogle() {
  try {
    await fetch('/api/office/auth/logout', {method: 'POST', credentials: 'same-origin'})
  } catch {
    /* igual se recarga */
  }
}
