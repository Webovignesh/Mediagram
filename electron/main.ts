// App lifecycle (ARCHITECTURE > Desktop integration). Startup steps 6, 8, 9, window state, tray, and the
// teleflow:// handler land in Phases 2–3.
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { app, BrowserWindow, dialog, ipcMain, protocol, screen, session, shell } from 'electron'
import { getTdjson } from 'prebuilt-tdlib'
import { log, openLog, pageKey, resolvePaths } from '../core/storage.ts'
import { authState, configure, tdlibVersion } from '../core/telegram.ts'
import { createMethods, handleCall, type License } from './ipc.ts'

declare const __LICENSES__: License[] // built by electron.vite.config.ts

function startup() {
  // 1. Paths and logger. 2. Chromium's files go under home too; set before the lock so dev and installed runs stay apart.
  const appDir = app.isPackaged ? path.dirname(app.getPath('exe')) : app.getAppPath()
  const { home } = resolvePaths({ env: process.env, packaged: app.isPackaged, appDir })
  openLog(path.join(home, 'logs'))
  app.setPath('userData', home)
  app.setPath('sessionData', path.join(home, 'chromium'))
  // 3. Windows toast identity (same as appId). 4. One process per home: TDLib locks its database.
  app.setAppUserModelId('com.teleflow.app')
  if (!app.requestSingleInstanceLock()) return app.quit()
  // 5.
  protocol.registerSchemesAsPrivileged([{ scheme: 'teleflow', privileges: { standard: true, secure: true } }])

  // tdjson.dll is loaded by the OS loader, which cannot read inside app.asar.
  configure(getTdjson().replace('app.asar', 'app.asar.unpacked'), path.join(home, 'logs', 'tdlib.log'))
  const tdlib = tdlibVersion()
  log('info', `TeleFlow ${app.getVersion()} starting; TDLib ${tdlib}; home ${home}`)

  // The env URL is honored only unpackaged, so a packaged app never loads a page named by the environment.
  const rendererUrl = (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) || pathToFileURL(path.join(import.meta.dirname, '../renderer/index.html')).href
  const rendererKey = pageKey(rendererUrl)
  const methods = createMethods({
    version: app.getVersion(), tdlib, home,
    installedAt: app.isPackaged ? fs.statSync(appDir).birthtimeMs : null,
    repository: JSON.parse(fs.readFileSync(path.join(app.getAppPath(), 'package.json'), 'utf8')).repository?.url,
    licenses: __LICENSES__,
    auth: authState,
  })

  app.on('second-instance', () => {
    const win = BrowserWindow.getAllWindows()[0]
    if (!win) return
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
  })

  // 7.
  app.whenReady().then(() => {
    session.defaultSession.setPermissionRequestHandler((_contents, _permission, done) => done(false))
    ipcMain.handle('call', (e, req) => {
      let sender: string | null = null
      try { sender = e.senderFrame?.url ?? null } catch {} // disposed frame → reject
      return handleCall(methods, rendererKey, sender, req)
    })
    createWindow(rendererUrl)
  }).catch(fatal)
}

function createWindow(url: string) {
  const area = screen.getPrimaryDisplay().workAreaSize
  const win = new BrowserWindow({
    width: Math.min(1440, area.width), height: Math.min(900, area.height), minWidth: 1024, minHeight: 640,
    backgroundColor: '#060b18', // UI.md `bg`
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#060b18', symbolColor: '#a3b0cf', height: 40 }, // top bar `bg`, `text-2`, top bar height
    webPreferences: {
      preload: path.join(import.meta.dirname, '../preload/preload.cjs'),
      contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true,
    },
  })
  win.webContents.on('will-navigate', (e) => e.preventDefault())
  win.webContents.setWindowOpenHandler(({ url: target }) => {
    if (target.startsWith('https://')) void shell.openExternal(target)
    return { action: 'deny' }
  })
  void win.loadURL(url)
}

function fatal(e: unknown) {
  const message = e instanceof Error ? e.message : String(e)
  log('error', `Startup failed: ${e instanceof Error ? e.stack : message}`)
  dialog.showErrorBox('TeleFlow could not start', message)
  app.exit(1)
}

try { startup() } catch (e) { fatal(e) }
