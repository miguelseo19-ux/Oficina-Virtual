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

## Agregar o cambiar personas

Editar `src/config.ts` → lista `PEOPLE`. Cada persona tiene un `desk` del 1 al
12 (1–6 fila de arriba, 7–12 fila de abajo). Al subir el cambio a `main`, la
página se vuelve a publicar sola en ~1 minuto.

## Publicación (GitHub Pages)

El workflow `.github/workflows/deploy.yml` compila y publica en cada push a
`main`. La primera vez hay que activarlo en GitHub:
**Settings → Pages → Source: GitHub Actions**.

La URL queda como `https://<usuario>.github.io/<repositorio>/`.

## Desarrollo local

```bash
npm install
npm run dev
```

## Problemas de conexión

- **No veo a nadie**: verificar que todos usen exactamente la misma clave.
- **Veo a la persona en el mapa pero no hay video/audio**: algunas redes
  corporativas bloquean conexiones directas. Se soluciona agregando un servidor
  TURN (por ejemplo, el plan gratuito de Cloudflare Calls TURN) en
  `TURN_SERVERS` de `src/config.ts`.
- **Los relays públicos fallan**: se pueden fijar relays específicos en
  `RELAY_URLS` de `src/config.ts`.
