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

No necesita servidores ni cuentas: el video y las posiciones viajan **directo
entre los navegadores** (WebRTC, cifrado de punta a punta). Para encontrarse,
los navegadores usan relays públicos de la red Nostr, y ese intercambio va
cifrado con la **clave de la oficina**.

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
