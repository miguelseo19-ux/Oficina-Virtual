/**
 * La pizarra en sí (Excalidraw, gratis y de código abierto). Este módulo se carga recién cuando
 * alguien abre una pizarra (import dinámico desde board.ts): Excalidraw + React pesan bastante y la
 * oficina no los necesita para arrancar.
 *
 * Acá solo se dibuja y se mezclan cambios; quién manda qué a quién y el guardado viven en board.ts.
 */
import {createElement} from 'react'
import {createRoot} from 'react-dom/client'
import {CaptureUpdateAction, Excalidraw, exportToBlob, reconcileElements, restoreElements} from '@excalidraw/excalidraw'
import '@excalidraw/excalidraw/index.css'
import type {BoardElement, BoardView, MountOptions} from './board'

type ExcalidrawAPI = Parameters<NonNullable<Parameters<typeof Excalidraw>[0]['excalidrawAPI']>>[0]
type Elements = ReturnType<ExcalidrawAPI['getSceneElementsIncludingDeleted']>
type RemoteElements = Parameters<typeof reconcileElements>[1]
type Collaborators = Map<string, Record<string, unknown>>

export function mountBoard(host: HTMLElement, o: MountOptions): BoardView {
  let api: ExcalidrawAPI | null = null
  let ready: () => void
  const apiReady = new Promise<void>(r => (ready = r))
  // última versión de cada elemento que ya vimos (propia o ajena): así solo se avisa de lo nuevo
  const seen = new Map<string, number>()
  const note = (els: readonly {id: string; version: number}[]) => {
    for (const e of els) if ((seen.get(e.id) ?? -1) < e.version) seen.set(e.id, e.version)
  }

  const initial = restoreElements(o.elements as never, null, {repairBindings: true})
  note(initial)

  const root = createRoot(host)
  root.render(
    createElement(Excalidraw, {
      excalidrawAPI: a => {
        api = a
        ready()
      },
      initialData: {elements: initial, appState: {viewBackgroundColor: '#ffffff', currentItemFontFamily: 2}, scrollToContent: true},
      langCode: 'es-ES',
      theme: 'light',
      isCollaborating: true,
      UIOptions: {
        tools: {image: false}, // las imágenes harían pesada la sincronización y el guardado
        canvasActions: {loadScene: false, saveToActiveFile: false, toggleTheme: false, export: false, saveAsImage: true}
      },
      onChange: elements => {
        // cambios hechos acá (los ajenos ya quedaron anotados al mezclarlos)
        const fresh = elements.filter(e => (seen.get(e.id) ?? -1) < e.version)
        if (!fresh.length) return
        note(fresh)
        o.onLocalChange(fresh as unknown as BoardElement[])
      },
      onPointerUpdate: p => o.onPointer(p.pointer.x, p.pointer.y, p.button === 'down')
    })
  )

  return {
    async merge(remote) {
      await apiReady
      if (!api) return
      const restored = restoreElements(remote as never, null)
      const merged = reconcileElements(api.getSceneElementsIncludingDeleted() as Elements, restored as unknown as RemoteElements, api.getAppState())
      note(restored)
      api.updateScene({elements: merged, captureUpdate: CaptureUpdateAction.NEVER})
    },
    elements() {
      return (api?.getSceneElementsIncludingDeleted() ?? initial) as unknown as BoardElement[]
    },
    setPeers(peers) {
      if (!api) return
      const map: Collaborators = new Map()
      for (const p of peers) {
        map.set(p.id, {
          id: p.id,
          socketId: p.id,
          username: p.name,
          pointer: {x: p.x, y: p.y, tool: 'pointer'},
          button: p.down ? 'down' : 'up',
          color: {background: p.color, stroke: p.color}
        })
      }
      api.updateScene({collaborators: map as never, captureUpdate: CaptureUpdateAction.NEVER})
    },
    async png() {
      if (!api) return null
      const elements = api.getSceneElements()
      if (!elements.length) return null
      return exportToBlob({
        elements,
        appState: {...api.getAppState(), exportBackground: true, viewBackgroundColor: '#ffffff'},
        files: api.getFiles(),
        mimeType: 'image/png',
        exportPadding: 24
      })
    },
    refresh() {
      api?.refresh()
    },
    destroy() {
      root.unmount()
      api = null
    }
  }
}
