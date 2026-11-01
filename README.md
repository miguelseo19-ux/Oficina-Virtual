# 🏢 Oficina virtual

Oficina 2D estilo Gather para el equipo (hasta 12 personas):

- Cada persona tiene **su escritorio fijo** con su nombre.
- Te movés con **flechas / WASD** o haciendo **clic** en el mapa.
- Al pararte sobre la **alfombra de un escritorio** se abre automáticamente una
  **videollamada** con quien esté ahí. Al alejarte, se corta sola.
- La cámara y el micrófono solo se encienden cuando hay alguien más en la
  alfombra.
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

## Pantalla

- **Barra de íconos a la izquierda**: Oficina (solo el mapa), Chat,
  Equipo, Actividad (saludos, mensajes, quién pasó por tu escritorio,
  quién se conectó), Calendario, Atajos y Ajustes. Cada una abre un
  panel lateral que se encoge con « o Esc.
- **Burbuja flotante abajo**: tu avatar (tocalo para cambiar el estado),
  micrófono ^, cámara ^ (la flechita elige el dispositivo), reacciones,
  compartir pantalla, chat cercano y volver a tu escritorio.

## Atajos y comandos

Pestaña **⌨️ Atajos** en la barra de la izquierda (o tecla `?`).

| Tecla | Acción |
|---|---|
| Flechas / WASD | Moverte |
| Enter | Abrir el chat |
| H | Ir a mi escritorio |
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

1. Abrir la URL de la oficina (GitHub Pages, ver abajo).
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
