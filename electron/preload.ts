// Sandboxed preload (built as CommonJS): the renderer's only door to main (ARCHITECTURE > Bridge).
import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron'

const bridge = {
  call: (method: string, args?: unknown): Promise<unknown> => ipcRenderer.invoke('call', { method, args }),
  on(cb: (event: unknown) => void) {
    const listener = (_: IpcRendererEvent, event: unknown) => cb(event)
    ipcRenderer.on('event', listener)
    return () => { ipcRenderer.removeListener('event', listener) }
  },
  pathOf: (file: File): string => {
    // Only a File Chromium was handed by the file dialog or a drag-drop resolves to a path (a File built in JS does
    // not), so this is where upload provenance is recorded: main learns the path from preload, never from renderer
    // text (ARCHITECTURE > Security > Renderer compromise).
    const p = webUtils.getPathForFile(file)
    if (p) ipcRenderer.invoke('grant', [p]).catch(() => {})
    return p
  },
}

contextBridge.exposeInMainWorld('teleflow', bridge)

export type Bridge = typeof bridge
