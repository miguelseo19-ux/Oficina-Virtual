/**
 * Íconos de línea fina (estilo SF Regular): trazo uniforme de 1.6,
 * puntas y uniones redondeadas, sin relleno. Toman el color del texto.
 * Uso en HTML: <i data-icon="mic"></i>  ·  en código: icon('mic')
 */
const P: Record<string, string> = {
  office: '<path d="M9 4 3.5 6v14L9 18l6 2 5.5-2V4L15 6 9 4Z"/><path d="M9 4v14M15 6v14"/>',
  chat: '<path d="M20 11.5c0 4.1-3.6 7.5-8 7.5-1.2 0-2.4-.25-3.4-.7L4 19.5l1.3-3.7A7.1 7.1 0 0 1 4 11.5C4 7.4 7.6 4 12 4s8 3.4 8 7.5Z"/>',
  message:
    '<path d="M20 11.5c0 4.1-3.6 7.5-8 7.5-1.2 0-2.4-.25-3.4-.7L4 19.5l1.3-3.7A7.1 7.1 0 0 1 4 11.5C4 7.4 7.6 4 12 4s8 3.4 8 7.5Z"/><path d="M8.5 10h7M8.5 13.2h4.5"/>',
  team: '<circle cx="9" cy="8" r="3.2"/><path d="M3.5 19.5c.6-3.3 2.8-5.2 5.5-5.2s4.9 1.9 5.5 5.2"/><circle cx="16.6" cy="9" r="2.6"/><path d="M15.6 14.2c2.4-.3 4.4 1.2 4.9 4.5"/>',
  bell: '<path d="M6 16.5V11a6 6 0 1 1 12 0v5.5l1.5 1.8h-15L6 16.5Z"/><path d="M10 20.6a2.2 2.2 0 0 0 4 0"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="3"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  keyboard: '<rect x="2.5" y="6" width="19" height="12" rx="2.5"/><path d="M6.5 10h.01M10 10h.01M14 10h.01M17.5 10h.01M8 14h8"/>',
  settings:
    '<path d="M4 7.5h9.5M18.5 7.5H20M4 16.5h3M12 16.5h8"/><circle cx="16" cy="7.5" r="2.4"/><circle cx="9.5" cy="16.5" r="2.4"/>',
  mic: '<rect x="9" y="3" width="6" height="11.5" rx="3"/><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3"/>',
  'mic-off':
    '<path d="M15 9.5V6a3 3 0 0 0-5.7-1.3M9 9v2.5a3 3 0 0 0 4.9 2.3"/><path d="M5.5 11.5a6.5 6.5 0 0 0 10.6 5M18.5 11.5c0 .9-.2 1.8-.5 2.6M12 18v3M4 4l16 16"/>',
  video: '<rect x="3" y="6.5" width="12.5" height="11" rx="2.6"/><path d="m15.5 10.6 5-3v8.8l-5-3"/>',
  'video-off':
    '<path d="M8 6.5h5A2.5 2.5 0 0 1 15.5 9v3.5M15.5 16A2.5 2.5 0 0 1 13 17.5H5.5A2.5 2.5 0 0 1 3 15V9c0-1 .6-1.9 1.5-2.3"/><path d="m15.5 10.6 5-3v8.8l-3.2-1.9M3.5 3.5l17 17"/>',
  smile: '<circle cx="12" cy="12" r="8.5"/><path d="M8.6 14.3c.9 1.4 2 2.1 3.4 2.1s2.5-.7 3.4-2.1M9.2 9.6h.01M14.8 9.6h.01"/>',
  board: '<rect x="3" y="4" width="18" height="12.5" rx="2"/><path d="M12 16.5V20M8.5 20h7M7 12.5l3-3.5 2.5 2.5L17 7.5"/>',
  save: '<path d="M5 4.5h11l3 3V18a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 18V4.5Z"/><path d="M8.5 4.5v4.5h6V4.5M8.5 19.5v-5h7v5"/>',
  download: '<path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M5 19.5h14"/>',
  trash: '<path d="M4.5 7h15M9.5 7V5h5v2M6.5 7l1 12.5h9l1-12.5M10 10.5v6M14 10.5v6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  tab: '<rect x="3" y="4.5" width="18" height="15" rx="2.6"/><path d="M3 9h18M10.5 9V4.5"/>',
  window: '<rect x="3" y="4.5" width="18" height="15" rx="2.6"/><path d="M3 9h18M6.3 6.8h.01M8.8 6.8h.01"/>',
  volume: '<path d="M4 9.5h3.2L12 5.5v13l-4.8-4H4v-5Z"/><path d="M15.5 9a4.2 4.2 0 0 1 0 6M18.2 6.5a7.8 7.8 0 0 1 0 11"/>',
  'volume-off': '<path d="M4 9.5h3.2L12 5.5v13l-4.8-4H4v-5Z"/><path d="m16 9.5 5 5M21 9.5l-5 5"/>',
  screen: '<rect x="3" y="4.5" width="18" height="12.5" rx="2.6"/><path d="M8.5 20.5h7M12 17v3.5M12 13.5V8.2M9.6 10.4 12 8l2.4 2.4"/>',
  nearby:
    '<path d="M14.3 9.4C14.3 6.4 11.7 4 8.4 4S2.5 6.4 2.5 9.4c0 1.2.4 2.3 1.1 3.1L3 15.3l2.8-.9c.8.4 1.7.6 2.6.6"/><path d="M21.5 14.6c0-2.8-2.5-5.1-5.6-5.1s-5.6 2.3-5.6 5.1 2.5 5.1 5.6 5.1c.8 0 1.6-.2 2.3-.5l2.7.9-.6-2.6c.8-.8 1.2-1.8 1.2-2.9Z"/>',
  home: '<path d="M4 10.4 12 4l8 6.4V19a1.5 1.5 0 0 1-1.5 1.5H15V15h-6v5.5H5.5A1.5 1.5 0 0 1 4 19v-8.6Z"/>',
  'chevron-up': '<path d="m7 14.5 5-5 5 5"/>',
  collapse: '<path d="m11 7-5 5 5 5M18 7l-5 5 5 5"/>',
  close: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
  wave:
    '<path d="M7.8 12.6V6.4a1.5 1.5 0 0 1 3 0v4.4M10.8 10.8V4.9a1.5 1.5 0 0 1 3 0v5.9M13.8 10.6V6.4a1.5 1.5 0 0 1 3 0v6.2M16.8 10.4a1.5 1.5 0 0 1 3 0v3.4a7.2 7.2 0 0 1-7.2 7.2h-.4a6.8 6.8 0 0 1-5.5-2.8l-2.6-3.6a1.6 1.6 0 0 1 2.5-2l1.2 1.5"/>',
  pin: '<path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0C18.5 15.4 12 21 12 21Z"/><circle cx="12" cy="10" r="2.3"/>',
  logout: '<path d="M14 4h3.5A1.5 1.5 0 0 1 19 5.5v13a1.5 1.5 0 0 1-1.5 1.5H14M9.5 8l-4 4 4 4M5.5 12H15"/>',
  wifi: '<path d="M4 10.2a11.5 11.5 0 0 1 16 0M7 13.4a7.2 7.2 0 0 1 10 0M10 16.6a3 3 0 0 1 4 0M12 19.5h.01"/>',
  door: '<path d="M6 21V4.5A1.5 1.5 0 0 1 7.5 3h9A1.5 1.5 0 0 1 18 4.5V21M4 21h16M14.5 12.2h.01"/>',
  'user-plus':
    '<circle cx="10" cy="8" r="3.5"/><path d="M3.5 20c.7-3.6 3.3-5.5 6.5-5.5 1.4 0 2.6.3 3.6 1M18 14v6M15 17h6"/>',
  'user-minus': '<circle cx="10" cy="8" r="3.5"/><path d="M3.5 20c.7-3.6 3.3-5.5 6.5-5.5 1.4 0 2.6.3 3.6 1M15 17h6"/>',
  send: '<path d="M20.5 3.5 3.5 10.6l6.8 2.9 2.9 6.9 7.3-16.9Z"/><path d="m10.3 13.5 4.4-4.4"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.2M12 7.8h.01"/>',
  moon: '<path d="M19.5 14.5A8 8 0 0 1 9.5 4.5a8 8 0 1 0 10 10Z"/>',
  minus: '<circle cx="12" cy="12" r="8.5"/><path d="M8 12h8"/>',
  'zoom-in': '<path d="M12 5v14M5 12h14"/>',
  'zoom-out': '<path d="M5 12h14"/>',
  desk: '<rect x="3.5" y="6.5" width="17" height="3" rx="1"/><path d="M5.5 9.5V19M18.5 9.5V19M12.5 9.5v5.5h6M14.8 12.2h1.6"/>',
  locate: '<path d="M5 5l14.5 6-6.3 2.2L11 19.5 5 5Z"/>',
  sun: '<circle cx="12" cy="12" r="3.8"/><path d="M12 2.8v2.1M12 19.1v2.1M2.8 12h2.1M19.1 12h2.1M5.5 5.5l1.5 1.5M17 17l1.5 1.5M5.5 18.5 7 17M17 7l1.5-1.5"/>',
  pip: '<rect x="3" y="4.5" width="18" height="15" rx="2.5"/><rect x="11.5" y="11" width="7" height="6" rx="1.2"/>',
  sidebar: '<rect x="3" y="4.5" width="18" height="15" rx="2.5"/><path d="M14.5 4.5v15"/>',
  grid: '<rect x="3.5" y="5" width="7.5" height="6" rx="1.5"/><rect x="13" y="5" width="7.5" height="6" rx="1.5"/><rect x="3.5" y="13" width="7.5" height="6" rx="1.5"/><rect x="13" y="13" width="7.5" height="6" rx="1.5"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  more: '<circle cx="6" cy="12" r="1.3" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.3" fill="currentColor" stroke="none"/><circle cx="18" cy="12" r="1.3" fill="currentColor" stroke="none"/>'
}

export function icon(name: string, size = 20): string {
  const body = P[name] ?? P.info
  return `<svg class="ic" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`
}

/** Reemplaza cada <i data-icon="x"> por su SVG. */
export function hydrateIcons(root: ParentNode = document) {
  for (const el of root.querySelectorAll<HTMLElement>('[data-icon]')) {
    if (el.dataset.done) continue
    el.innerHTML = icon(el.dataset.icon!, Number(el.dataset.size) || 20)
    el.dataset.done = '1'
  }
}
