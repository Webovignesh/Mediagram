// Sandboxed preload (built as CommonJS): the renderer's only door to main (ARCHITECTURE > Bridge).
import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron'

const bridge = {
  call: (method: string, args?: unknown): Promise<unknown> => ipcRenderer.invoke('call', { method, args }),
  on(cb: (event: unknown) => void) {
    const listener = (_: IpcRendererEvent, event: unknown) => cb(event)
    ipcRenderer.on('event', listener)
    return () => { ipcRenderer.removeListener('event', listener) }
  },
  pathOf: (file: File): string => webUtils.getPathForFile(file),
}

contextBridge.exposeInMainWorld('teleflow', bridge)

export type Bridge = typeof bridge
