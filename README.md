# 🏢 Oficina virtual

Oficina 2D estilo Gather para el equipo (hasta 12 personas):

- Cada persona tiene **su escritorio fijo** con su nombre.
- Te movés con **flechas / WASD** o haciendo **clic** en el mapa: el personaje
  va caminando solo, buscando el camino (entra y sale por las puertas).
- **Ir a mi escritorio** (botón, tecla `H` o `/escritorio`) también va
  caminando, no te teletransporta. Cualquier flecha corta la caminata.
- Al pararte sobre la **alfombra de un escritorio** se abre automáticamente una
  **videollamada** con quien esté ahí. Al alejarte, se corta sola.
- La cámara y el micrófono solo se encienden cuando hay alguien más en la
  alfombra.
- **Charla por cercanía**: fuera de los cubículos y las salas (pasillo, rincones,
  zona social), si te acercás a pocos pasos de alguien se abre la videollamada
  entre ustedes, y se corta al alejarte. En el mapa, una línea punteada naranja
  une a quienes están charlando. No conecta a través de paredes y no incluye a
  quien está *Ocupado* o *Ausente*.
- Si alguien llega a tu escritorio y no estás, te avisa con sonido y
  notificación ("Ir a mi escritorio").
- Botones para silenciar micrófono, apagar cámara y compartir pantalla.
- El video de quien está hablando se resalta en verde.
- Botón ⚙️ en la llamada para elegir **cámara, micrófono y parlante/auriculares**
  (se puede cambiar en plena conversación y queda guardado para la próxima vez;
  elegir parlante funciona en Chrome y Edge).
- **Estado**: 🟢 Disponible, 🔴 Ocupado (no molestar: no entrás ni recibís
  llamadas y no suenan avisos) o 🟡 Ausente. Después de 10 minutos sin tocar la
  oficina pasás a "Ausente" solo, y volvés a "Disponible" al mover el mouse.
- **Chat** (botón 💬 o tecla Enter): canal *General* para todo el equipo,
  *Cerca* para quienes están al lado tuyo en el mapa (aparece como globito
  sobre el personaje) y mensajes *privados*. Los mensajes llegan solo a quienes
  están conectados en ese momento; cada uno guarda su historial en su navegador.
- En la lista del equipo, junto a cada persona conectada:
  👋 **saludar** (le suena un aviso), 💬 **mensaje privado** y
  📍 **ir hasta** esa persona (si está en una alfombra, entrás a su llamada).

No necesita servidores ni cuentas: el video y las posiciones viajan **directo
entre los navegadores** (WebRTC, cifrado de punta a punta). Para encontrarse,
los navegadores usan relays públicos de la red Nostr, y ese intercambio va
cifrado con la **clave de la oficina**.

## Marca

Sigue el branding de *Private Session II*: fondo negro `#020003`, acento
bronce `#96582f`, naranja `#fa4616` para alertas, tipografías **Space Grotesk**
(textos) y **JetBrains Mono** (etiquetas y datos), títulos en mayúsculas,
bordes de 1px casi invisibles y vidrio esmerilado en lo flotante. Los íconos
son SVG de línea fina (estilo SF Regular) en `src/icons.ts`.

## Entorno pixel art (16 bits)

El mapa es una escena pixel art generada por código (sin imágenes externas):

| Archivo | Qué hace |
|---|---|
| `src/map.ts` | **Fuente de verdad** de la geometría, en "píxeles de arte" (488×320, ×3 en el mundo): cubículos, puertas, tabiques, pasillo, muebles. De acá salen las **colisiones** y las **zonas de llamada**. |
| `src/scene/pixel.ts` | Primitivas de pixel art (rectángulos, elipses sin antialias, halos de luz). |
| `src/scene/sprites.ts` | Catálogo de sprites: piso de parquet, ventanas con ciudad, escritorio con monitores, silla, alfombras, plantas, bibliotecas, neones, sillones, isla, barra de café, mesa de reuniones, pizarra. |
| `src/scene/index.ts` | Arma el decorado estático una sola vez (piso → paredes → objetos → luz). |
| `src/main.ts` | Capa dinámica por encima: pantallas que se encienden si el dueño está conectado, brillo "en llamada", carteles con nombre y cargo (desde `config.ts`), avatares, globitos y reacciones. |

Para ver colisiones (rojo) y zonas de llamada (verde): agregar `?debug=1` a la URL.

### Assets de LimeZu

Personajes animados y parte del mobiliario vienen de **Modern Interiors**
(versión gratuita) de [LimeZu](https://limezu.itch.io/moderninteriors), con
licencia de **uso no comercial**. Están recortados en `public/assets/limezu/`
(ver `CREDITOS.txt`) y se cargan con `src/assets.ts`. Si no cargan, la app usa
el dibujo generado por código.

- Cada persona elige su personaje con `sprite` en `src/config.ts`
  (`Adam`, `Alex`, `Alex_b`, `Amelia`, `Bob`).
- Hojas de personaje: 2 filas (caminar / reposo) × 24 cuadros de 16×32,
  6 por dirección (derecha, arriba, izquierda, abajo).

**Para mayor fidelidad** se pueden reemplazar sprites uno por uno por PNG
dibujados a mano (mismas medidas): escritorio con monitores (46×15), silla,
plantas (8×10 y 12×14), sillones (13×12), barra de café (52×18), mesa redonda,
pizarra, ventanas con skyline, piso en tileset de 8×8 y avatares con animación
de caminar (4 direcciones).

## Distribución

- **Oficina principal**: 6 cubículos arriba y 6 abajo (cada uno con su
  videollamada), pasillo con rincón de descanso, isla central, barra de café
  y mesa informal.
- **Ala derecha** (un cuarto del mapa), con dos puertas desde el pasillo:
  - **Sala de juntas**: mesa de conferencias para el equipo. Entrar = unirse a
    la **videollamada grupal** de la sala.
  - **Zona social**: cocina, bar con banquetas y zona de juegos (pool, arcade,
    puffs, dardos). No tiene llamada de sala: se charla por cercanía.

Las salas con llamada están en `ROOMS` y las zonas sin llamada de sala en `AREAS`
(`src/map.ts`).

## Pantalla

- **Barra de íconos a la izquierda**: Oficina (solo el mapa), Chat,
  Equipo, Actividad (saludos, mensajes, quién pasó por tu escritorio,
  quién se conectó), Calendario, Atajos y Ajustes. Cada una abre un
  panel lateral que se encoge con « o Esc.
- **Burbuja flotante abajo**: tu avatar (tocalo para cambiar el estado),
  micrófono ^, cámara ^ (la flechita elige el dispositivo), reacciones,
  compartir pantalla, chat cercano y volver a tu escritorio.

## Vista del mapa

Controles abajo a la derecha, como en Gather:

- **Escritorio**: ir a tu escritorio.
- **Flecha**: volver a la vista normal (de cerca, siguiendo a tu personaje). Se
  resalta cuando estás mirando otra parte o con otro zoom.
- **+ / −**: acercar y alejar (también con la rueda del mouse o pellizcando el
  trackpad, y con las teclas `+` y `-`).
- **Mapa**: ver toda la oficina de una (tecla `G`); tocalo de nuevo para volver.
- **⋯**: modo de vista. *Simplificado* (plano liso con cuadros y las personas
  como círculos), *Inmersivo* (pixel art con personajes) o *Automático*
  (simplificado al alejarte, inmersivo de cerca). Se recuerda en cada navegador.

Arrastrando el mapa con el mouse recorrés la oficina; en cuanto movés a tu
personaje, la cámara lo vuelve a seguir.

## Atajos y comandos

Pestaña **⌨️ Atajos** en la barra de la izquierda (o tecla `?`).

| Tecla | Acción |
|---|---|
| Flechas / WASD | Moverte |
| Enter | Abrir el chat |
| H | Ir a mi escritorio |
| + / − (o rueda / pellizco) | Acercar / alejar |
| Arrastrar el mapa | Recorrer la oficina |
| G | Ver toda la oficina |
| 0 | Volver a la vista normal (sigue a tu personaje) |
| M · Ctrl+Shift+A | Micrófono |
| V · Ctrl+Shift+V | Cámara |
| B | Ocupado ↔ Disponible |
| E | Ver el equipo |
| 1 … 6 | Reacciones 👋 👍 ❤️ 😂 🎉 ✋ |
| Esc | Cerrar paneles |

Comandos en el chat: `/ir nombre`, `/saludar nombre`, `/msj nombre texto`,
`/escritorio`, `/ocupado`, `/disponible`, `/ausente`, `/mic`, `/cam`,
`/quien`, `/ayuda`.

## Cómo usarla

1. Abrir la URL de la oficina (Vercel o GitHub Pages, ver abajo).
2. Elegir tu nombre y escribir la **clave de la oficina** (la misma para todos;
   se acuerda entre ustedes y se comparte por fuera, por ejemplo por WhatsApp).
3. Aceptar el permiso de cámara/micrófono cuando el navegador lo pida.

> Quien entra con otra clave queda en una oficina separada y no ve a nadie.
> Recomendado: Chrome, Edge o Firefox actualizados, en computadora.

## Subir a GitHub y publicar (sin instalar nada)

1. Descomprimir `oficina-virtual.zip`.
2. Abrir el repo en GitHub → **Add file → Upload files**.
3. Arrastrar **todo el contenido** de la carpeta descomprimida (la carpeta
   `docs`, la carpeta `src` y los archivos sueltos) y tocar **Commit changes**.
4. Ir a **Settings → Pages**:
   - *Source*: **Deploy from a branch**
   - *Branch*: **main** y carpeta **/docs** → **Save**
5. En 1–2 minutos la oficina queda en
   `https://<usuario>.github.io/<repositorio>/` (el link aparece arriba en esa
   misma pantalla de Pages).

> El repo tiene que ser **público** para usar GitHub Pages gratis. Igual nadie
> puede entrar sin la clave de la oficina (la clave no está en el código).

La carpeta `docs/` es la versión ya compilada que se publica. La carpeta `src/`
es el código fuente.

## Publicar en Vercel

`vercel.json` ya deja todo configurado: Vercel instala, corre `npm run build` y
publica la carpeta `docs/`.

1. Entrar a [vercel.com](https://vercel.com) con **Continue with GitHub**.
2. **Add New… → Project** → importar el repo `Oficina-Virtual` (si no aparece,
   tocar *Adjust GitHub App Permissions* y darle acceso a ese repo).
3. Dejar la configuración que detecta (Vite, salida `docs`) → **Deploy**.
4. La oficina queda en `https://<proyecto>.vercel.app`. Ese es el link para el
   equipo.

Cada push a `main` vuelve a publicar solo. Las otras ramas generan versiones de
prueba que, por defecto, piden iniciar sesión en Vercel.

GitHub Pages puede seguir andando en paralelo: las dos URLs llevan a **la misma
oficina** (mismo `APP_ID`/`ROOM_ID` y la misma clave), así que no importa por
cuál entre cada uno. Lo que guarda cada navegador (persona elegida, dispositivos,
historial del chat) es por dominio: la primera vez en Vercel hay que elegirlos de
nuevo.

## Agregar o cambiar personas

Editar `src/config.ts` → lista `PEOPLE`. Cada persona tiene un `desk` del 1 al
12 (1–6 fila de arriba, 7–12 fila de abajo). Después hay que recompilar para
actualizar `docs/`:

```bash
npm install
npm run build
```

y subir la carpeta `docs/` actualizada.

## Desarrollo local

```bash
npm install
npm run dev
```

## Problemas de conexión

- **No veo a nadie**: verificar que todos usen exactamente la misma clave.
- **Veo a la persona en el mapa pero no hay video/audio**: algunas redes
  corporativas bloquean conexiones directas. Se soluciona agregando un servidor
  TURN (por ejemplo, el plan gratuito de Cloudflare TURN) en `TURN_SERVERS` de
  `src/config.ts`.
- **Los relays públicos fallan**: se pueden fijar relays específicos en
  `RELAY_URLS` de `src/config.ts`.
