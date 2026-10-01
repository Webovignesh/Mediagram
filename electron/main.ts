// App lifecycle (ARCHITECTURE > Desktop integration). The transfer engine, tray, and notifications land in Phase 3.
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { app, BrowserWindow, dialog, ipcMain, net, protocol, screen, session, shell } from 'electron'
import { getTdjson } from 'prebuilt-tdlib'
import icon from '../assets/icon.png?asset'
import { type AppEvent, type DB, getSettings, openDb, putSetting, readSetting } from '../core/db.ts'
import { library, log, openLog, pageKey, resolvePaths } from '../core/storage.ts'
import * as telegram from '../core/telegram.ts'
import { createMethods, handleCall, type License, protocolFile } from './ipc.ts'

declare const __LICENSES__: License[] // built by electron.vite.config.ts

let win: BrowserWindow | null = null
const send = (e: AppEvent) => { if (win && !win.isDestroyed()) win.webContents.send('event', e) }

// `invalidate` topics are coalesced: flushed every 500 ms, `chats` every 2 s (ARCHITECTURE > Events).
const pending = new Set<string>()
let flushTimer: NodeJS.Timeout | undefined
let chatsTimer: NodeJS.Timeout | undefined
function emit(e: AppEvent) {
  if (e.type !== 'invalidate') return send(e)
  for (const topic of e.topics) {
    if (topic === 'chats') chatsTimer ??= setTimeout(() => { chatsTimer = undefined; send({ type: 'invalidate', topics: ['chats'] }) }, 2000)
    else pending.add(topic)
  }
  if (pending.size) flushTimer ??= setTimeout(() => { flushTimer = undefined; send({ type: 'invalidate', topics: [...pending] }); pending.clear() }, 500)
}

function startup() {
  // 1. Paths and logger. 2. Chromium's files go under home too; set before the lock so dev and installed runs stay apart.
  const appDir = app.isPackaged ? path.dirname(app.getPath('exe')) : app.getAppPath()
  const paths = resolvePaths({ env: process.env, packaged: app.isPackaged, appDir })
  openLog(paths.logs)
  app.setPath('userData', paths.home)
  app.setPath('sessionData', paths.chromium)
  // 3. Windows toast identity (same as appId). 4. One process per home: TDLib locks its database.
  app.setAppUserModelId('com.teleflow.app')
  if (!app.requestSingleInstanceLock()) return app.quit()
  // 5.
  protocol.registerSchemesAsPrivileged([{ scheme: 'teleflow', privileges: { standard: true, secure: true } }])

  // tdjson.dll is loaded by the OS loader, which cannot read inside app.asar.
  telegram.configure(getTdjson().replace('app.asar', 'app.asar.unpacked'), path.join(paths.logs, 'tdlib.log'))
  const tdlib = telegram.tdlibVersion()
  log('info', `TeleFlow ${app.getVersion()} starting; TDLib ${tdlib}; home ${paths.home}`)

  // 6. (The engine's requeue and upload routing join this step in Phase 3.)
  const db = openDb(paths.db)
  const defaultRoot = path.join(app.getPath('downloads'), 'TeleFlow')
  const settings = () => getSettings(db, defaultRoot)
  const env = process.env
  const roots = {
    sealed: [paths.home, paths.appDir, path.dirname(app.getPath('appData')), env.SystemRoot, env.ProgramFiles, env['ProgramFiles(x86)'], env.ProgramData]
      .filter((p): p is string => !!p),
    guarded: (['home', 'desktop', 'documents', 'downloads', 'pictures', 'videos', 'music'] as const).map((n) => app.getPath(n)),
  }
  // One options object for reading and writing: Windows only matches a login item with the same args.
  const loginItem = app.isPackaged ? { args: ['--hidden'] } : { path: process.execPath, args: [app.getAppPath(), '--hidden'] }
  telegram.init({
    dir: paths.tdlib, version: app.getVersion(), emit, showArchived: () => settings().showArchived,
    forgetCredentials: () => { putSetting(db, 'apiId'); putSetting(db, 'apiHash') },
  })

  // The env URL is honored only unpackaged, so a packaged app never loads a page named by the environment.
  const rendererUrl = (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) || pathToFileURL(path.join(import.meta.dirname, '../renderer/index.html')).href
  const rendererKey = pageKey(rendererUrl)
  const ctx = {
    version: app.getVersion(), tdlib, paths, db, settings, roots, emit, tg: telegram,
    installedAt: app.isPackaged ? fs.statSync(appDir).birthtimeMs : null,
    repository: JSON.parse(fs.readFileSync(path.join(app.getAppPath(), 'package.json'), 'utf8')).repository?.url,
    licenses: __LICENSES__,
    native: {
      pickFolder: async (title?: string) => {
        const options = { title, properties: ['openDirectory', 'createDirectory'] as ('openDirectory' | 'createDirectory')[] }
        const r = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
        return r.canceled ? null : r.filePaths[0] ?? null
      },
      openPath: (target: string) => shell.openPath(target),
      reveal: (file: string) => shell.showItemInFolder(file),
      trashItem: (file: string) => shell.trashItem(file),
      loginItem: {
        get: () => app.getLoginItemSettings(loginItem).executableWillLaunchAtLogin, // false if disabled in Task Manager
        set: (openAtLogin: boolean) => app.setLoginItemSettings({ ...loginItem, openAtLogin }),
      },
      cacheSize: () => session.defaultSession.getCacheSize(),
    },
  }
  const methods = createMethods(ctx)

  app.on('second-instance', () => {
    if (!win) return
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
  })

  // 7.
  app.whenReady().then(async () => {
    session.defaultSession.setPermissionRequestHandler((_contents, _permission, done) => done(false))
    protocol.handle('teleflow', async (req) => {
      try {
        const file = req.method === 'GET' ? await protocolFile(req.url, ctx) : null
        if (!file) return new Response(null, { status: 404 })
        const res = await net.fetch(pathToFileURL(file).href)
        if (!req.url.startsWith('teleflow://thumb/')) return res
        return new Response(res.body, { headers: { 'Content-Type': res.headers.get('Content-Type') ?? '', 'Cache-Control': 'private, max-age=86400' } })
      } catch { return new Response(null, { status: 404 }) } // not signed in, bad URL, file gone
    })
    ipcMain.handle('call', (e, req) => {
      let sender: string | null = null
      try { sender = e.senderFrame?.url ?? null } catch {} // disposed frame → reject
      return handleCall(methods, rendererKey, sender, req)
    })
    win = createWindow(rendererUrl, db)
    // 8.
    const apiId = readSetting(db, 'apiId'), apiHash = readSetting(db, 'apiHash')
    if (typeof apiId === 'number' && typeof apiHash === 'string') await telegram.start({ apiId, apiHash })
    // 9. Fills the cache global search reads from.
    library(settings().downloadRoot).catch((e) => log('warn', `Library scan failed: ${(e as Error).message}`))
  }).catch(fatal)

  // Quit: TDLib flushes its database (up to 5 s), then SQLite closes.
  let quitting = false
  app.on('before-quit', (e) => {
    if (quitting) return
    e.preventDefault()
    quitting = true
    void telegram.close().finally(() => { db.close(); app.quit() })
  })
}

type WindowState = { x: number, y: number, width: number, height: number, maximized: boolean }
const overlaps = (a: Electron.Rectangle, b: Electron.Rectangle) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height

/** The saved bounds when they still overlap a display, else 1440×900 clamped to the work area and centered. */
function initialBounds(saved: Partial<WindowState> | undefined) {
  const s = saved && [saved.x, saved.y, saved.width, saved.height].every(Number.isFinite) ? saved as WindowState : null
  if (s && screen.getAllDisplays().some((d) => overlaps(d.bounds, s))) return { x: s.x, y: s.y, width: s.width, height: s.height }
  const area = screen.getPrimaryDisplay().workArea
  const width = Math.min(1440, area.width), height = Math.min(900, area.height)
  return { width, height, x: area.x + Math.round((area.width - width) / 2), y: area.y + Math.round((area.height - height) / 2) }
}

function createWindow(url: string, db: DB) {
  const saved = readSetting(db, 'window') as Partial<WindowState> | undefined
  const w = new BrowserWindow({
    ...initialBounds(saved), minWidth: 1024, minHeight: 640, icon,
    backgroundColor: '#060b18', // UI.md `bg`
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#060b18', symbolColor: '#a3b0cf', height: 40 }, // top bar `bg`, `text-2`, top bar height
    webPreferences: {
      preload: path.join(import.meta.dirname, '../preload/preload.cjs'),
      contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true,
    },
  })
  if (saved?.maximized) w.maximize()
  // Saved debounced on move and resize; emits no topic, so Settings does not refetch while the window moves.
  let timer: NodeJS.Timeout | undefined
  const save = () => {
    clearTimeout(timer)
    timer = setTimeout(() => {
      if (w.isDestroyed()) return
      try { putSetting(db, 'window', { ...w.getNormalBounds(), maximized: w.isMaximized() }) } catch (e) { log('warn', `Saving the window position failed: ${(e as Error).message}`) }
    }, 500)
  }
  w.on('move', save)
  w.on('resize', save)
  w.on('maximize', save)
  w.on('unmaximize', save)
  w.webContents.on('will-navigate', (e) => e.preventDefault())
  w.webContents.setWindowOpenHandler(({ url: target }) => {
    if (target.startsWith('https://')) void shell.openExternal(target)
    return { action: 'deny' }
  })
  void w.loadURL(url)
  return w
}

function fatal(e: unknown) {
  const message = e instanceof Error ? e.message : String(e)
  log('error', `Startup failed: ${e instanceof Error ? e.stack : message}`)
  dialog.showErrorBox('TeleFlow could not start', message)
  app.exit(1)
}

try { startup() } catch (e) { fatal(e) }
