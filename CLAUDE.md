# Oficina virtual — contexto para Claude Code

Oficina 2D estilo Gather para un equipo chico (5 personas hoy, 12 escritorios).
Todo el texto de la app y los mensajes al usuario van **en español rioplatense**.

## Cómo funciona
- **Sin servidor propio.** Vite + TypeScript, se publica en GitHub Pages desde la
  carpeta `docs/` (rama `main`, carpeta `/docs`) y en Vercel (`vercel.json`:
  compila en cada push a `main` y sirve `docs/`). `base: './'` en Vite hace que
  ande en los dos (subcarpeta en Pages, raíz en Vercel): no cambiarlo.
- **Dominio**: el link del equipo es `https://www.myconsulting.cloud/office` (y `/oficina-virtual`).
  Lo sirve el repo **Dashboard** (Next.js en Vercel): rewrite en su `next.config.mjs` hacia
  GitHub Pages + excepción en su `middleware.ts`. El script del principio de `index.html` agrega
  `<base href="…/">` cuando la URL no termina en `/`: sin él, `./assets/…` iría a la raíz del dominio.
- **Tiempo real P2P** con `trystero` (señalización por relays Nostr públicos, lista
  fija en `src/config.ts` → `RELAY_URLS`). Posiciones, chat, saludos y reacciones
  viajan por data channels; el video por WebRTC directo.
- **Clave de la oficina** = `password` de Trystero (no está en el código). Con el ingreso con Google
  la entrega el Dashboard (`OFFICE_KEY`) a las cuentas de `OFFICE_PEOPLE`; mientras no esté
  configurado (503) o en localhost, sigue el login de persona + clave (`setupLogin`).
- **Ingreso con Google y calendario**: servidor = Dashboard, rutas `/api/office/*` (auth/login,
  auth/callback, session, calendar, auth/logout; sesión cifrada en cookie httpOnly). En la
  oficina: `src/session.ts` (`boot()`: google / login / classic; redirige otros dominios a
  `myconsulting.cloud/office`) y `src/calendar.ts` ("En reunión" = status `busy` + `meeting` en
  `PlayerState`).
- **Llamada por proximidad**: estar dentro de un cubículo (`DESKS[].zone`) o de una
  sala (`ROOMS`) = estar en la videollamada de esa zona (`src/call.ts`). Fuera de
  ellos, charla por cercanía: `updateTalk()` en `main.ts` arma el set `talking`
  (mismo `areaAt`, ambos disponibles, se conecta a < `TALK_IN` y se corta a >
  `TALK_OUT`) y `Call` lo usa cuando `zone === null`.
- **Versión nueva**: la pestaña queda abierta todo el día, así que `checkUpdate()` en `main.ts`
  compara cada 5 min (y al volver a la pestaña) el `assets/index-*.js` publicado con el que corre
  y, si cambió, muestra un aviso fijo con "Actualizar" (no recarga sola para no cortar llamadas).
- Probar con 2 personas sin tocar los relays públicos: levantar un relay Nostr local
  y abrir con `?relay=ws://localhost:7777` (si no, quien esté conectado con la clave
  real ve un aviso de "otra clave").

## Archivos clave
| Archivo | Qué hace |
|---|---|
| `src/config.ts` | Personas (nombre, cargo, color, escritorio, `sprite`), relays, TURN |
| `src/map.ts` | **Fuente de verdad** de la geometría en "píxeles de arte" (652×320, ×3 = mundo): cubículos, puertas, pasillo, ala derecha (sala de juntas con llamada + zona social sin llamada de sala, solo charla por cercanía), colisiones, `zoneAt`, `areaAt` |
| `src/scene/*` | Escena pixel art generada por código (pixel.ts primitivas, sprites.ts, index.ts arma el lienzo estático). `simple.ts`: plano liso de la vista *Simplificado* (vectores, desde `map.ts`, incluye `WALLS_ART`). Dos versiones, de noche y de día (`Light`): `buildScene(assets, light)` cambia la paleta (`PAL` ← `NIGHT`/`DAY` en sprites.ts, con `setLight`), el cielo de las ventanas y la iluminación (`drawLighting` / `drawDaylight`); un color nuevo de mueble va en las dos paletas |
| `src/assets.ts` | Carga sprites de LimeZu (`public/assets/limezu/`): personajes 16×32 animados y atlas de muebles. Personajes propios en `CUSTOM_SPRITES` (`public/assets/personajes/`, cuadros y cantidad de poses propios, se dibujan a la altura `BODY_H` de LimeZu, un paso = 0,6 s); se generan con `scripts/armar_skin.py` desde una imagen con una fila de poses de caminata por dirección (`scripts/skins/`; fondo transparente o liso) |
| `src/main.ts` | Login, bucle de juego, cámara (`zoomRel` relativo a la vista de cerca, `follow`, arrastre, rueda/pellizco, vista general), modos de vista (Simplificado/Inmersivo/Automático, `ov.vista` en localStorage), luz (Día/Noche/Según la hora de `DAY_HOURS`, `ov.luz`, tecla L), capa dinámica del mapa, avatares, paneles, comandos `/ir`, atajos |
| `src/mini.ts` | Mini ventana flotante (Document Picture-in-Picture, solo Chrome/Edge): mini mapa con `drawSimpleMap`, avisos de cercanía/visitas, videos de la llamada (`Call.peers()`), mic/cámara/no molestar. Botón `#btn-mini` o tecla P; Chrome la abre sola al cambiar de pestaña en llamada (Media Session `enterpictureinpicture`) |
| `src/path.ts` | Búsqueda de camino (A*) sobre la grilla de colisiones de `map.ts`, con suavizado. La usan el clic en el mapa y "ir a mi escritorio" (`walkTo` en `main.ts`) |
| `src/net.ts` | Capa Trystero (state, chat, wave, react) |
| `src/call.ts` | Video/audio, dispositivos, compartir pantalla, quién habla. Vistas de la llamada (`data-layout` en `#call`: `side` al costado, `grid` en grande sobre la oficina con `fitGrid()`, `present` pantalla compartida en grande + caras al costado; `ov.llamada.vista`). La pantalla va como otra transmisión con metadata `{screen: true}` y el estado `screen` en `PlayerState` |
| `src/session.ts` | Ingreso: decide al abrir entre sesión de Google, botón "Entrar con Google" o login de clave; logout |
| `src/calendar.ts` | Calendario de Google: reuniones de hoy/mañana, "En reunión" automático, avisos, panel lateral |
| `src/chat.ts` | Chat General / Cerca / privados (historial en localStorage) |
| `src/icons.ts` | Íconos SVG de línea fina (no usar emojis como íconos) |
| `src/style.css` | Marca *Private Session II*: negro `#020003`, bronce `#96582f`, naranja `#fa4616`, Space Grotesk + JetBrains Mono, títulos en MAYÚSCULAS |

## Comandos
- `npm install` — dependencias
- `npm run dev` — servidor local (abrir la URL que muestra)
- `npm run build` — typecheck + compila a `docs/` (hay que commitear `docs/` para publicar)
- Después de `npm run build`, asegurarse de que exista `docs/.nojekyll`.

## Pruebas y depuración
- `?debug=1` en la URL: dibuja colisiones (rojo) y zonas (verde) y expone `window.__ov.pos`.
- `?relay=ws://localhost:7777` usa un relay propio (útil si los públicos están bloqueados).
- Para probar varias personas: abrir varias ventanas (o perfiles) con la misma clave y distinta persona.

## Reglas del proyecto
- Mantener la geometría en `map.ts` y que dibujo, colisiones y zonas salgan de ahí.
- Verificar que los 12 escritorios y las salas sigan siendo alcanzables al mover muebles.
- Assets de LimeZu: versión gratuita, **uso no comercial** (decisión del equipo). Crédito en Ajustes y en `public/assets/limezu/CREDITOS.txt`.
- Commits en español, descriptivos. Publicar = `npm run build` + commit + push a `main`.

## Pendientes conocidos
- Personajes sentados al llegar a su escritorio (el pack trae animaciones `sit`).
- Ingreso con Google + calendario: código listo; falta configurar Google Cloud y las variables en
  Vercel (Dashboard). Probar el ingreso real una vez configurado.
- Si alguna red bloquea P2P: agregar TURN en `TURN_SERVERS`.
- Posible futuro: estilo 3D/isométrico con assets KayKit (ver conversación: empezar pre-renderizando a sprites 2D).
- Los archivos `Modern_Interiors_Free_v2.2.zip` y `MetroCity 2.0.rar` en la raíz del repo: pendiente decidir si se eliminan.
