/** Primitivas para dibujar pixel art en un lienzo de baja resolución. */

export type G = CanvasRenderingContext2D

export function rect(g: G, x: number, y: number, w: number, h: number, c: string) {
  if (w <= 0 || h <= 0) return
  g.fillStyle = c
  g.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h))
}

export function dot(g: G, x: number, y: number, c: string) {
  rect(g, x, y, 1, 1, c)
}

/** Elipse "dura" (sin antialias), fila por fila. */
export function ellipse(g: G, cx: number, cy: number, rx: number, ry: number, c: string) {
  g.fillStyle = c
  for (let y = -ry; y <= ry; y++) {
    const t = 1 - (y * y) / (ry * ry)
    if (t < 0) continue
    const hw = Math.round(rx * Math.sqrt(t))
    g.fillRect(Math.round(cx - hw), Math.round(cy + y), hw * 2, 1)
  }
}

/** Contorno de elipse de 1px. */
export function ellipseOutline(g: G, cx: number, cy: number, rx: number, ry: number, c: string) {
  g.fillStyle = c
  const steps = Math.ceil((rx + ry) * 4)
  for (let i = 0; i < steps; i++) {
    const a = (i / steps) * Math.PI * 2
    g.fillRect(Math.round(cx + Math.cos(a) * rx), Math.round(cy + Math.sin(a) * ry), 1, 1)
  }
}

/** Rectángulo con esquinas recortadas (look 16 bits). */
export function chamfer(g: G, x: number, y: number, w: number, h: number, c: string, k = 1) {
  rect(g, x + k, y, w - 2 * k, h, c)
  rect(g, x, y + k, w, h - 2 * k, c)
}

/** Contorno de rectángulo redondeado de 1px. */
export function roundOutline(g: G, x: number, y: number, w: number, h: number, r: number, c: string) {
  rect(g, x + r, y, w - 2 * r, 1, c)
  rect(g, x + r, y + h - 1, w - 2 * r, 1, c)
  rect(g, x, y + r, 1, h - 2 * r, c)
  rect(g, x + w - 1, y + r, 1, h - 2 * r, c)
  // esquinas escalonadas
  for (let i = 0; i < r; i++) {
    const d = r - i
    dot(g, x + i, y + d, c)
    dot(g, x + w - 1 - i, y + d, c)
    dot(g, x + i, y + h - 1 - d, c)
    dot(g, x + w - 1 - i, y + h - 1 - d, c)
  }
}

/** Generador pseudoaleatorio con semilla (el decorado sale siempre igual). */
export function rng(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function pick<T>(r: () => number, xs: T[]): T {
  return xs[Math.floor(r() * xs.length)]
}

/** Mezcla dos colores hex. */
export function mix(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1), 16)
  const pb = parseInt(b.slice(1), 16)
  const ch = (sh: number) => Math.round(((pa >> sh) & 255) * (1 - t) + ((pb >> sh) & 255) * t)
  return '#' + [16, 8, 0].map(sh => ch(sh).toString(16).padStart(2, '0')).join('')
}

/** Halo de luz (se aplica con 'lighter'). */
export function glow(g: G, x: number, y: number, r: number, color: string, alpha: number) {
  const n = parseInt(color.slice(1), 16)
  const rgb = `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`
  const grad = g.createRadialGradient(x, y, 0, x, y, r)
  grad.addColorStop(0, `rgba(${rgb},${alpha})`)
  grad.addColorStop(0.45, `rgba(${rgb},${alpha * 0.4})`)
  grad.addColorStop(1, `rgba(${rgb},0)`)
  const prev = g.globalCompositeOperation
  g.globalCompositeOperation = 'lighter'
  g.fillStyle = grad
  g.fillRect(x - r, y - r, r * 2, r * 2)
  g.globalCompositeOperation = prev
}
