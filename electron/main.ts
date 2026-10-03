// App lifecycle (ARCHITECTURE > Desktop integration): paths, single instance, window, tray, notifications, IPC, quit.
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { app, BrowserWindow, dialog, ipcMain, Menu, net, Notification, protocol, screen, session, shell, Tray } from 'electron'
import { getTdjson } from 'prebuilt-tdlib'
import icon from '../assets/icon.png?asset'
import { type AppEvent, type DB, getSettings, type Kind, openDb, putSetting, readSetting } from '../core/db.ts'
import { library, log, onLibraryChange, openLog, pageKey, realRoots, resolvePaths } from '../core/storage.ts'
import * as telegram from '../core/telegram.ts'
import { createEngine, type Engine, type LiveStats } from '../core/transfers.ts'
import { createMethods, handleCall, type License, protocolFile } from './ipc.ts'

declare const __LICENSES__: License[] // built by electron.vite.config.ts

// fs and zlib run on the libuv thread pool (4 threads by default). The Library walk of a large root, TDLib's media scan,
// and every other fs call share it, so a bigger pool keeps them off each other's feet. libuv reads this the first time
// it needs a thread, which is the first asynchronous fs call — still ahead of us.
process.env.UV_THREADPOOL_SIZE ??= '16'

let win: BrowserWindow | null = null
let tray: Tray | null = null
let engine: Engine | undefined
let quitting = false
const send = (e: AppEvent) => { if (win && !win.isDestroyed()) win.webContents.send('event', e) }

// `invalidate` topics are coalesced: flushed every 500 ms, `chats` every 2 s (ARCHITECTURE > Events). `auth` also drives
// the engine (entering and leaving ready); `stats` also updates the tray tooltip.
const pending = new Set<string>()
let flushTimer: NodeJS.Timeout | undefined
let chatsTimer: NodeJS.Timeout | undefined
function emit(e: AppEvent) {
  if (e.type === 'auth') engine?.onAuth(e.auth)
  if (e.type === 'stats') trayTooltip(e.stats)
  if (e.type !== 'invalidate') return send(e)
  for (const topic of e.topics) {
    if (topic === 'chats') chatsTimer ??= setTimeout(() => { chatsTimer = undefined; send({ type: 'invalidate', topics: ['chats'] }) }, 2000)
    else pending.add(topic)
  }
  if (pending.size) flushTimer ??= setTimeout(() => { flushTimer = undefined; send({ type: 'invalidate', topics: [...pending] }); pending.clear() }, 500)
}

const units = [['gigabyte', 2 ** 30], ['megabyte', 2 ** 20], ['kilobyte', 1024], ['byte', 1]] as const
const speedText = (bps: number) => {
  const [unit, div] = units.find(([, d]) => bps >= d) ?? units[3]
  return new Intl.NumberFormat('en', { style: 'unit', unit: `${unit}-per-second`, maximumFractionDigits: 1 }).format(bps / div)
}
function trayTooltip(s: LiveStats) {
  tray?.setToolTip(`Mediagram — ${s.counts.download.active + s.counts.upload.active} active · ${speedText(s.speed.download + s.speed.upload)}`)
}
function showWindow() {
  if (!win || win.isDestroyed()) return
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
}

// Notifications: one per 3-second batch, so a large queue does not flood the screen. Clicking shows the window.
const batch = { download: 0, upload: 0, failed: 0 }
let notifyTimer: NodeJS.Timeout | undefined
function flushNotifications() {
  notifyTimer = undefined
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`
  const lines = [batch.download && `${plural(batch.download, 'download')} completed`, batch.upload && `${plural(batch.upload, 'upload')} completed`,
    batch.failed && `${plural(batch.failed, 'transfer')} failed`].filter(Boolean)
  Object.assign(batch, { download: 0, upload: 0, failed: 0 })
  if (!lines.length || !Notification.isSupported()) return
  const n = new Notification({ title: 'Mediagram', body: lines.join('\n'), icon })
  n.on('click', showWindow)
  n.show()
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
  protocol.registerSchemesAsPrivileged([{ scheme: 'teleflow', privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true } }])

  // tdjson.dll is loaded by the OS loader, which cannot read inside app.asar.
  telegram.configure(getTdjson().replace('app.asar', 'app.asar.unpacked'), path.join(paths.logs, 'tdlib.log'))
  const tdlib = telegram.tdlibVersion()
  log('info', `Mediagram ${app.getVersion()} starting; TDLib ${tdlib}; home ${paths.home}`)

  // 6. SQLite, the engine, and its recovery (before TDLib starts, so pending upload updates find their files).
  const db = openDb(paths.db)
  const defaultRoot = path.join(app.getPath('downloads'), 'TeleFlow')
  const settings = () => getSettings(db, defaultRoot)
  const env = process.env
  const roots = realRoots({
    sealed: [paths.home, paths.appDir, path.dirname(app.getPath('appData')), env.SystemRoot, env.ProgramFiles, env['ProgramFiles(x86)'], env.ProgramData]
      .filter((p): p is string => !!p),
    guarded: (['home', 'desktop', 'documents', 'downloads', 'pictures', 'videos', 'music'] as const).map((n) => app.getPath(n)),
  })
  // One options object for reading and writing: Windows only matches a login item with the same args. The path is
  // quoted because Electron 44 reads it back with CommandLine::FromString, which splits an unquoted path at its first
  // space (a profile such as C:\Users\First Last), so the toggle would always read back off.
  const loginItem = { path: `"${process.execPath}"`, args: app.isPackaged ? ['--hidden'] : [app.getAppPath(), '--hidden'] }
  telegram.init({
    dir: paths.tdlib, version: app.getVersion(), db, emit, showArchived: () => settings().showArchived,
    forgetCredentials: () => { putSetting(db, 'apiId'); putSetting(db, 'apiHash') },
  })
  const finished = (kind: Kind, ok: boolean) => {
    const s = settings()
    if (ok ? !s.notifyComplete : !s.notifyFailed) return
    if (ok) batch[kind]++
    else batch.failed++
    notifyTimer ??= setTimeout(flushNotifications, 3000)
  }
  engine = createEngine({ db, invoke: telegram.invoke, onUpdate: telegram.onUpdate, auth: telegram.authState, chat: telegram.chat,
    emit, paths, settings, finished })
  engine.recover()
  const eng = engine

  // The env URL is honored only unpackaged, so a packaged app never loads a page named by the environment.
  const rendererUrl = (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) || pathToFileURL(path.join(import.meta.dirname, '../renderer/index.html')).href
  const rendererKey = pageKey(rendererUrl)
  const ctx = {
    version: app.getVersion(), tdlib, paths, db, settings, roots, emit, tg: telegram, engine: eng,
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
      clearCache: async () => { await session.defaultSession.clearCache(); await session.defaultSession.clearCodeCaches({}) },
      clearStorageData: () => session.defaultSession.clearStorageData(),
    },
  }
  const methods = createMethods(ctx)

  app.on('second-instance', showWindow)
  app.on('window-all-closed', () => app.quit())

  // 7.
  app.whenReady().then(async () => {
    session.defaultSession.setPermissionRequestHandler((_contents, _permission, done) => done(false))
    protocol.handle('teleflow', async (req) => {
      try {
        const file = req.method === 'GET' ? await protocolFile(req.url, ctx) : null
        if (!file) return new Response(null, { status: 404 })
        if (req.url.startsWith('teleflow://thumb/')) {
          const buf = await fs.promises.readFile(file)
          return new Response(buf, { headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'public, max-age=2592000, immutable' } })
        }
        const res = await net.fetch(pathToFileURL(file).href)
        return res
      } catch { return new Response(null, { status: 404 }) } // not signed in, bad URL, file gone
    })
    ipcMain.handle('call', (e, req) => {
      let sender: string | null = null
      try { sender = e.senderFrame?.url ?? null } catch {} // disposed frame → reject
      return handleCall(methods, rendererKey, sender, req)
    })
    // A login-item start (--hidden) stays in the tray only when closing to the tray is on.
    win = createWindow(rendererUrl, db, process.argv.includes('--hidden') && settings().closeToTray, () => settings().closeToTray)
    tray = new Tray(icon)
    trayTooltip(eng.liveStats())
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: 'Show Mediagram', click: showWindow },
      { label: 'Pause all', click: () => eng.action('pause') },
      { label: 'Resume all', click: () => eng.action('resume') },
      { type: 'separator' },
      { label: 'Quit Mediagram', click: () => app.quit() },
    ]))
    tray.on('double-click', showWindow)
    // 8.
    const apiId = readSetting(db, 'apiId'), apiHash = readSetting(db, 'apiHash')
    if (typeof apiId === 'number' && typeof apiHash === 'string') await telegram.start({ apiId, apiHash })
    // 9. Fills the cache global search reads from, and listens for files appearing outside TeleFlow.
    onLibraryChange(() => emit({ type: 'invalidate', topics: ['library'] }))
    library(settings().downloadRoot).catch((e) => log('warn', `Library scan failed: ${(e as Error).message}`))
  }).catch(fatal)

  // Quit: live progress persisted and running uploads put back in the queue, TDLib flushes its database (up to 5 s),
  // then SQLite closes. Downloads in progress or finalizing are requeued on the next start.
  app.on('before-quit', (e) => {
    if (quitting) return
    e.preventDefault()
    quitting = true
    void eng.quit().catch((err: Error) => log('warn', `Saving transfers on quit failed: ${err.message}`))
      .then(() => telegram.close()).finally(() => { db.close(); tray?.destroy(); app.quit() })
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

function createWindow(url: string, db: DB, hidden: boolean, closeToTray: () => boolean) {
  const saved = readSetting(db, 'window') as Partial<WindowState> | undefined
  const w = new BrowserWindow({
    ...initialBounds(saved), minWidth: 1024, minHeight: 640, icon, show: !hidden,
    backgroundColor: '#0f172a',
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#0f172a', symbolColor: '#94a3b8', height: 36 },
    webPreferences: {
      preload: path.join(import.meta.dirname, '../preload/preload.cjs'),
      contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true,
    },
  })
  if (saved?.maximized && !hidden) w.maximize()
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
  // Minimize to tray on close: the window hides and transfers keep running; otherwise closing quits.
  w.on('close', (e) => { if (!quitting && closeToTray()) { e.preventDefault(); w.hide() } })
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
  dialog.showErrorBox('Mediagram could not start', message)
  app.exit(1)
}

try { startup() } catch (e) { fatal(e) }
