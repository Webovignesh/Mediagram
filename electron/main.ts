// App lifecycle (ARCHITECTURE > Desktop integration): paths, single instance, window, tray, notifications, IPC, quit.
import fs from 'node:fs'
import path from 'node:path'
import { Readable } from 'node:stream'
import { pathToFileURL } from 'node:url'
import { app, BrowserWindow, dialog, ipcMain, Menu, MenuItem, Notification, protocol, safeStorage, screen, session, shell, Tray } from 'electron'
import { getTdjson } from 'prebuilt-tdlib'
import icon from '../assets/icon.png?asset'
import { type AppError, type AppEvent, type DB, getSettings, type Kind, openDb, putSetting, readSetting } from '../core/db.ts'
import { isUnc, library, log, onLibraryChange, openLog, pageKey, realRoots, resolvePaths } from '../core/storage.ts'
import * as telegram from '../core/telegram.ts'
import { createEngine, type Engine, type LiveStats } from '../core/transfers.ts'
import { createMethods, fromRenderer, handleCall, type License, protocolFile } from './ipc.ts'

declare const __LICENSES__: License[] // built by electron.vite.config.ts

// fs and zlib run on the libuv thread pool (4 threads by default). The Library walk of a large root, TDLib's media scan,
// and every other fs call share it, so a bigger pool keeps them off each other's feet. libuv reads this the first time
// it needs a thread, which is the first asynchronous fs call — still ahead of us.
process.env.UV_THREADPOOL_SIZE ??= '16'

// Hardware acceleration and video decoding enhancements (HEVC / H.265 / zero-copy rendering)
app.commandLine.appendSwitch('enable-features', 'PlatformHEVCDecoderSupport')
app.commandLine.appendSwitch('enable-gpu-rasterization')
app.commandLine.appendSwitch('enable-zero-copy')
app.commandLine.appendSwitch('ignore-gpu-blocklist')

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
  let fast = false
  for (const topic of e.topics) {
    if (topic === 'chats') {
      chatsTimer ??= setTimeout(() => { chatsTimer = undefined; send({ type: 'invalidate', topics: ['chats'] }) }, 250)
    } else {
      pending.add(topic)
      if (topic.startsWith('messages:')) fast = true
    }
  }
  if (pending.size) {
    if (fast) {
      clearTimeout(flushTimer)
      flushTimer = setTimeout(() => { flushTimer = undefined; send({ type: 'invalidate', topics: [...pending] }); pending.clear() }, 50)
    } else {
      flushTimer ??= setTimeout(() => { flushTimer = undefined; send({ type: 'invalidate', topics: [...pending] }); pending.clear() }, 400)
    }
  }
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
  app.setAppUserModelId('com.mediagram.app')
  if (!app.requestSingleInstanceLock()) return app.quit()
  protocol.registerSchemesAsPrivileged([
    { scheme: 'mediagram', privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true } },
    { scheme: 'teleflow', privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true } },
  ])

  // tdjson.dll is loaded by the OS loader, which cannot read inside app.asar.
  telegram.configure(getTdjson().replace('app.asar', 'app.asar.unpacked'), path.join(paths.logs, 'tdlib.log'))
  const tdlib = telegram.tdlibVersion()
  log('info', `Mediagram ${app.getVersion()} starting; TDLib ${tdlib}; home ${paths.home}`)

  // 6. SQLite, the engine, and its recovery (before TDLib starts, so pending upload updates find their files).
  const db = openDb(paths.db)
  const legacyDefaultRoot = path.join(app.getPath('downloads'), 'TeleFlow')
  const newDefaultRoot = path.join(app.getPath('downloads'), 'Mediagram')
  const defaultRoot = fs.existsSync(newDefaultRoot) ? newDefaultRoot : (fs.existsSync(legacyDefaultRoot) ? legacyDefaultRoot : newDefaultRoot)
  // A root saved by an older build (or written straight into the database) still has to obey today's rules: a network
  // share is never the library, because Clear All Data deletes everything under the root (ARCHITECTURE > Runtime data).
  const settings = () => {
    const s = getSettings(db, defaultRoot)
    if (!path.isAbsolute(s.downloadRoot) || isUnc(s.downloadRoot)) s.downloadRoot = defaultRoot
    return s
  }
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
  // API keys are kept encrypted (DPAPI through safeStorage): saved automatically when a sign-in reaches `ready`,
  // so the next start skips the API-keys step; a rejection from Telegram or Clear All Data forgets them. Logout
  // keeps them (the session is what ends). A row written by an older build in the clear is upgraded when read.
  const encode = (plain: string) => (safeStorage.isEncryptionAvailable() ? `enc:${safeStorage.encryptString(plain).toString('base64')}` : `plain:${plain}`)
  const decode = (stored: unknown): string | null => {
    if (typeof stored !== 'string') return null
    if (stored.startsWith('enc:')) { try { return safeStorage.decryptString(Buffer.from(stored.slice(4), 'base64')) } catch { return null } }
    if (stored.startsWith('plain:')) return stored.slice(6)
    return /^[0-9a-f]{32}$/i.test(stored) ? stored : null
  }
  const keys = {
    save: (apiId: number, apiHash: string) => { putSetting(db, 'apiId', apiId); putSetting(db, 'apiHash', encode(apiHash)) },
    forget: () => { putSetting(db, 'apiId'); putSetting(db, 'apiHash') },
    get: (): { apiId: number, apiHash: string } | null => {
      const apiId = readSetting(db, 'apiId'), apiHash = decode(readSetting(db, 'apiHash'))
      return typeof apiId === 'number' && apiHash ? { apiId, apiHash } : null
    },
  }
  const hasSaved = typeof readSetting(db, 'apiId') === 'number' && Boolean(decode(readSetting(db, 'apiHash')))
  telegram.init({
    dir: paths.tdlib, version: app.getVersion(), db, emit, showArchived: () => settings().showArchived,
    forgetCredentials: keys.forget,
    saveCredentials: (c) => { keys.save(c.apiId, c.apiHash); emit({ type: 'invalidate', topics: ['settings'] }) },
    hasSavedCredentials: hasSaved,
  })
  const finished = (kind: Kind, ok: boolean) => {
    emit({
      type: 'notification',
      title: ok ? `${kind === 'download' ? 'Download' : 'Upload'} Completed` : `${kind === 'download' ? 'Download' : 'Upload'} Failed`,
      body: ok ? `Your ${kind} transfer finished successfully.` : `A ${kind} transfer failed. Check Queue for details.`,
      kind: ok ? kind : 'failed',
    })
    const s = settings()
    if (ok ? !s.notifyComplete : !s.notifyFailed) return
    if (ok) batch[kind]++
    else batch.failed++
    notifyTimer ??= setTimeout(flushNotifications, 3000)
  }
  engine = createEngine({
    db, invoke: telegram.invoke, onUpdate: telegram.onUpdate, auth: telegram.authState, chat: telegram.chat,
    emit, paths, settings, finished
  })
  engine.recover()
  const eng = engine

  // The env URL is honored only unpackaged, so a packaged app never loads a page named by the environment.
  const rendererUrl = (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) || pathToFileURL(path.join(import.meta.dirname, '../renderer/index.html')).href
  const rendererKey = pageKey(rendererUrl)
  // Upload provenance: preload reports the path of every File the user chose (dialog or drop) here, and uploads.add
  // refuses anything else. Renderer code can name any path; it cannot make a File Chromium will resolve for one.
  const uploadGrants = new Set<string>()
  const grantKey = (p: string) => path.resolve(p).toLowerCase()
  const grants = {
    add: (paths: unknown) => {
      if (uploadGrants.size > 10_000) uploadGrants.clear() // a session cap; re-picking a file is cheap
      if (!Array.isArray(paths)) return
      for (const p of paths) if (typeof p === 'string' && p.length <= 4096 && path.isAbsolute(p)) uploadGrants.add(grantKey(p))
    },
    has: (p: string) => uploadGrants.has(grantKey(p)),
  }
  // Download-root provenance: only a folder the Browse dialog handed back may become the root.
  const pickedFolders = new Set<string>()
  const picks = {
    add: (p: string) => { if (typeof p === 'string' && p && p.length <= 4096 && path.isAbsolute(p)) pickedFolders.add(grantKey(p)) },
    has: (p: string) => pickedFolders.has(grantKey(p)),
  }
  const ctx = {
    version: app.getVersion(), tdlib, paths, db, settings, roots, emit, tg: telegram, engine: eng,
    installedAt: app.isPackaged ? (() => {
      try {
        const stat = fs.statSync(appDir)
        const t = stat.birthtimeMs || stat.ctimeMs || stat.mtimeMs || Date.now()
        return t > 1e11 ? t : t * 1000
      } catch {
        return Date.now()
      }
    })() : null,
    repository: JSON.parse(fs.readFileSync(path.join(app.getAppPath(), 'package.json'), 'utf8')).repository?.url,
    licenses: __LICENSES__,
    native: {
      grants,
      picks,
      keys,
      pickFolder: async (title?: string) => {
        const options = { title, properties: ['openDirectory', 'createDirectory'] as ('openDirectory' | 'createDirectory')[] }
        const r = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
        const chosen = r.canceled ? null : r.filePaths[0] ?? null
        if (chosen) picks.add(chosen) // settings.set accepts this path because the user chose it here
        return chosen
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
      notify: (title: string, body: string) => {
        if (Notification.isSupported()) {
          const n = new Notification({ title: title || 'Mediagram', body, icon })
          n.on('click', showWindow)
          n.show()
        }
      },
    },
  }
  const methods = createMethods(ctx)

  app.on('second-instance', showWindow)
  app.on('window-all-closed', () => app.quit())

  // Nothing in this app attaches a <webview> and only the main window ever opens: whatever a page tries, no second
  // window, no webview, and no navigation away from the app (ARCHITECTURE > Security > Renderer compromise).
  app.on('web-contents-created', (_event, contents) => {
    contents.on('will-attach-webview', (e) => e.preventDefault())
    contents.on('will-navigate', (e) => e.preventDefault())
    contents.setWindowOpenHandler(({ url }) => {
      if (url.startsWith('https://')) void shell.openExternal(url)
      return { action: 'deny' }
    })
  })

  // 7.
  app.whenReady().then(async () => {
    session.defaultSession.setPermissionRequestHandler((_contents, permission, done) => {
      if (permission === 'clipboard-read' || permission === 'clipboard-sanitized-write') return done(true)
      done(false)
    })
    session.defaultSession.setPermissionCheckHandler((_contents, permission) =>
      permission === 'clipboard-sanitized-write' || permission === 'clipboard-read' || permission === 'fullscreen')
    // A teleflow:// response is only ever an image or media file, but it may be a downloaded document: nothing in it
    // gets a chance to run or be sniffed into a type it didn't declare (ARCHITECTURE > teleflow:// protocol).
    const mediaHeaders: Record<string, string> = {
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
    }
    const thumbBufferCache = new Map<string, Buffer>()
    const MAX_THUMB_CACHE = 300

    const handleMediaProtocol = async (req: Request) => {
      try {
        const file = req.method === 'GET' ? await protocolFile(req.url, ctx) : null
        if (!file) return new Response(null, { status: 404 })
        const isThumb = req.url.startsWith('mediagram://thumb/') || req.url.startsWith('teleflow://thumb/') ||
          req.url.startsWith('mediagram://saved/') || req.url.startsWith('teleflow://saved/')
        if (isThumb) {
          const etag = `"${Buffer.from(file).toString('base64url')}"`
          if (req.headers.get('if-none-match') === etag) {
            return new Response(null, {
              status: 304,
              headers: {
                ...mediaHeaders,
                'ETag': etag,
                'Cache-Control': 'public, max-age=2592000, immutable',
              },
            })
          }
          let buf = thumbBufferCache.get(file)
          if (!buf) {
            buf = await fs.promises.readFile(file)
            if (thumbBufferCache.size >= MAX_THUMB_CACHE) {
              const oldestKey = thumbBufferCache.keys().next().value
              if (oldestKey) thumbBufferCache.delete(oldestKey)
            }
            thumbBufferCache.set(file, buf)
          }
          return new Response(new Uint8Array(buf), {
            headers: {
              ...mediaHeaders,
              'Content-Type': 'image/jpeg',
              'Cache-Control': 'public, max-age=2592000, immutable',
              'ETag': etag,
            },
          })
        }
        const reqUrl = new URL(req.url)
        const queryExt = reqUrl.searchParams.get('ext')?.toLowerCase()
        const queryTotal = parseInt(reqUrl.searchParams.get('total') || '0', 10)

        let stat = await fs.promises.stat(file).catch(() => null)
        if (!stat && file.includes(path.join('files', 'temp'))) {
          for (let i = 0; i < 6; i++) {
            await new Promise((r) => setTimeout(r, 100))
            stat = await fs.promises.stat(file).catch(() => null)
            if (stat) break
          }
        }
        if (!stat) return new Response(null, { status: 404 })

        if (stat.size === 0 && file.includes(path.join('files', 'temp'))) {
          for (let i = 0; i < 8; i++) {
            await new Promise((r) => setTimeout(r, 100))
            const check = await fs.promises.stat(file).catch(() => null)
            if (check && check.size > 0) {
              stat = check
              break
            }
          }
        }

        const currentSize = stat.size
        const totalSize = (queryTotal && queryTotal > currentSize) ? queryTotal : currentSize
        const ext = (queryExt || path.extname(file).slice(1)).toLowerCase()
        const mimeMap: Record<string, string> = {
          mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', mkv: 'video/x-matroska', m4v: 'video/mp4',
          mp3: 'audio/mpeg', ogg: 'audio/ogg', wav: 'audio/wav', m4a: 'audio/mp4', aac: 'audio/aac', flac: 'audio/flac',
          jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif',
        }
        const mime = mimeMap[ext] || 'video/mp4'

        // Partial files live in TDLib's temp dir under their numeric file id; anything else on disk is
        // complete and needs neither a tail fetch nor a TDLib watermark.
        const tempPrefix = path.join(paths.tdlib, 'files', 'temp') + path.sep
        const isTemp = file.toLowerCase().startsWith(tempPrefix.toLowerCase())
        const fileId = isTemp ? parseInt(path.basename(file), 10) : NaN
        const knownId = !isNaN(fileId) && fileId > 0
        // Bytes readable from offset 0: everything up to currentSize written sequentially to disk.
        const readableSize = async (size: number) => {
          if (!knownId || size <= 0) return size
          return size
        }

        if (req.method === 'HEAD') {
          return new Response(null, {
            status: 200,
            headers: {
              ...mediaHeaders,
              'Content-Type': mime,
              'Accept-Ranges': 'bytes',
              'Content-Length': String(totalSize),
            },
          })
        }

        const range = req.headers.get('range')
        if (range) {
          const match = range.match(/bytes=(\d+)-(\d*)/)
          if (match) {
            const start = parseInt(match[1], 10)
            const requestedEnd = match[2] ? parseInt(match[2], 10) : totalSize - 1

            // Bytes the sequential download has written from offset 0: everything at or below this streams
            // straight from disk, so playback starts immediately whatever the file size.
            let availableSize = await readableSize(currentSize)

            // Non-faststart MP4s (phone cameras, Clipchamp, Premiere) keep moov at the very end. The
            // demuxer halts the moment it walks into mdat and asks for that tail: answering 416 kills
            // the decoder for good, so serve it from the cached tail instead. Only a range the download
            // cannot answer yet takes this path — a plain forward read never waits on it.
            const isTailRequest = knownId && start > 0 && start >= availableSize && start >= Math.max(0, totalSize - 16 * 1024 * 1024)
            if (isTailRequest) {
              let tail = telegram.getVideoTail(fileId)
              const covered = tail && start >= tail.tailOffset && start < tail.tailOffset + tail.buffer.length
              if (!covered) {
                tail = (await telegram.fetchVideoTail(fileId, totalSize, start).catch(() => undefined)) || undefined
              }
              if (tail && start >= tail.tailOffset && start < tail.tailOffset + tail.buffer.length) {
                const end = Math.min(requestedEnd, totalSize - 1, tail.tailOffset + tail.buffer.length - 1)
                if (end >= start) {
                  const chunk = tail.buffer.subarray(start - tail.tailOffset, end - tail.tailOffset + 1)
                  return new Response(new Uint8Array(chunk), {
                    status: 206,
                    statusText: 'Partial Content',
                    headers: {
                      ...mediaHeaders,
                      'Content-Type': mime,
                      'Content-Range': `bytes ${start}-${end}/${totalSize}`,
                      'Accept-Ranges': 'bytes',
                      'Content-Length': String(chunk.length),
                    },
                  })
                }
              }
              // If the tail cannot be fetched, return 416 immediately rather than blocking
              // or stalling sequential playback streams for 45 seconds.
              return new Response(null, {
                status: 416,
                statusText: 'Range Not Satisfiable',
                headers: {
                  ...mediaHeaders,
                  'Content-Range': `bytes */${totalSize}`,
                },
              })
            }

            // Hold the request while the sequential download catches up. Chromium treats 416 as a
            // hard media error, so give plenty of time and keep TDLib download prioritized.
            if (start >= availableSize && availableSize < totalSize) {
              const deadline = Date.now() + 30000
              let last = availableSize
              let stalled = 0
              while (Date.now() < deadline && availableSize <= start) {
                await new Promise((r) => setTimeout(r, 150))
                stalled++
                if (stalled % 20 === 0 && knownId) {
                  telegram.resumeStreamingDownload(fileId)
                }
                const refreshed = await fs.promises.stat(file).catch(() => null)
                if (!refreshed) break
                availableSize = await readableSize(refreshed.size)
                if (availableSize > last) {
                  stalled = 0
                }
                last = availableSize
              }
              if (availableSize <= start) {
                return new Response(null, {
                  status: 416,
                  statusText: 'Range Not Satisfiable',
                  headers: {
                    ...mediaHeaders,
                    'Content-Range': `bytes */${totalSize}`,
                  },
                })
              }
            }

            const end = Math.min(requestedEnd, availableSize - 1)
            if (end < start) {
              return new Response(null, {
                status: 416,
                statusText: 'Range Not Satisfiable',
                headers: {
                  ...mediaHeaders,
                  'Content-Range': `bytes */${totalSize}`,
                },
              })
            }
            const chunksize = (end - start) + 1
            const nodeStream = fs.createReadStream(file, { start, end })
            const webStream = Readable.toWeb(nodeStream) as unknown as ReadableStream
            return new Response(webStream, {
              status: 206,
              statusText: 'Partial Content',
              headers: {
                ...mediaHeaders,
                'Content-Type': mime,
                'Content-Range': `bytes ${start}-${end}/${totalSize}`,
                'Accept-Ranges': 'bytes',
                'Content-Length': String(chunksize),
              },
            })
          }
        }

        // Plain GET: stream only the readable prefix, so an unwritten hole is never played as zeros.
        const bodySize = await readableSize(currentSize)
        if (bodySize <= 0) {
          return new Response(null, {
            status: 416,
            statusText: 'Range Not Satisfiable',
            headers: {
              ...mediaHeaders,
              'Content-Range': `bytes */${totalSize}`,
            },
          })
        }
        const nodeStream = fs.createReadStream(file, { start: 0, end: bodySize - 1 })
        const webStream = Readable.toWeb(nodeStream) as unknown as ReadableStream
        return new Response(webStream, {
          status: 200,
          headers: {
            ...mediaHeaders,
            'Content-Type': mime,
            'Accept-Ranges': 'bytes',
            'Content-Length': String(bodySize),
          },
        })
      } catch { return new Response(null, { status: 404 }) } // not signed in, bad URL, file gone
    }

    protocol.handle('mediagram', handleMediaProtocol)
    protocol.handle('teleflow', handleMediaProtocol)
    ipcMain.handle('call', (e, req) => {
      let sender: string | null = null
      try { sender = e.senderFrame?.url ?? null } catch { } // disposed frame → reject
      return handleCall(methods, rendererKey, sender, req)
    })
    // Preload's pathOf(): record which files the user chose. Same sender rule as the call channel, and the work is
    // synchronous, so it lands before the uploads.add that follows it in the same message queue.
    ipcMain.handle('grant', (e, paths) => {
      let sender: string | null = null
      try { sender = e.senderFrame?.url ?? null } catch { }
      if (!fromRenderer(rendererKey, sender)) return false
      grants.add(paths)
      return true
    })
    ipcMain.handle('theme', (e, { color, symbolColor, id: themeId }) => {
      let sender: string | null = null
      try { sender = e.senderFrame?.url ?? null } catch { }
      if (!fromRenderer(rendererKey, sender)) return false
      if (themeId && typeof themeId === 'string') {
        try { putSetting(db, 'theme', themeId) } catch { }
      }
      if (win && !win.isDestroyed() && process.platform === 'win32') {
        win.setTitleBarOverlay({ color, symbolColor: symbolColor || '#94a3b8', height: 36 })
        win.setBackgroundColor(color)
      }
      return true
    })
    // 8. Saved keys (if the user chose to keep them) start TDLib straight into the session immediately
    const apiId = readSetting(db, 'apiId'), stored = readSetting(db, 'apiHash')
    const apiHash = decode(stored)
    if (typeof apiId === 'number' && apiHash) {
      if (!(typeof stored === 'string' && stored.startsWith('enc:'))) keys.save(apiId, apiHash) // upgrade an old row
      telegram.start({ apiId, apiHash }).catch((e) => {
        if ((e as AppError).status !== 409) log('error', `Starting TDLib failed: ${(e as Error).message}`)
        else log('warn', `The saved API keys don't match the session on this device: ${(e as Error).message}`)
      })
    } else if (stored !== undefined) {
      log('warn', 'The stored API keys could not be read; they were forgotten')
      keys.forget()
    }

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

    // 9. Fills the cache global search reads from, and listens for files appearing outside Mediagram.
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

function getThemeColors(id?: string) {
  const map: Record<string, { color: string, symbolColor: string }> = {
    dark: { color: '#0b1329', symbolColor: '#cbd5e1' },
    fulldark: { color: '#000000', symbolColor: '#ffffff' },
    tokyo: { color: '#000000', symbolColor: '#ffffff' },
    cream: { color: '#faf6ee', symbolColor: '#292524' },
    emerald: { color: '#faf6ee', symbolColor: '#292524' },
    sunset: { color: '#faf6ee', symbolColor: '#292524' },
    ocean: { color: '#070e1e', symbolColor: '#38bdf8' },
    telegram: { color: '#17212b', symbolColor: '#ffffff' },
    light: { color: '#f8fafc', symbolColor: '#0f172a' },
  }
  return map[id || ''] || map.dark
}

function createWindow(url: string, db: DB, hidden: boolean, closeToTray: () => boolean) {
  const saved = readSetting(db, 'window') as Partial<WindowState> | undefined
  const initialTheme = getThemeColors(readSetting(db, 'theme') as string | undefined)
  const w = new BrowserWindow({
    ...initialBounds(saved), minWidth: 1024, minHeight: 640, icon, show: false,
    backgroundColor: initialTheme.color,
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: initialTheme.color, symbolColor: initialTheme.symbolColor, height: 36 },
    webPreferences: {
      preload: path.join(import.meta.dirname, '../preload/preload.cjs'),
      contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true,
    },
  })
  if (saved?.maximized) {
    w.maximize()
  }
  w.once('ready-to-show', () => {
    if (!hidden) {
      w.show()
    }
  })
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
  w.webContents.on('context-menu', (_e, params) => {
    const menu = new Menu()
    if (params.isEditable) {
      menu.append(new MenuItem({ label: 'Undo', role: 'undo', enabled: params.editFlags.canUndo }))
      menu.append(new MenuItem({ label: 'Redo', role: 'redo', enabled: params.editFlags.canRedo }))
      menu.append(new MenuItem({ type: 'separator' }))
      menu.append(new MenuItem({ label: 'Cut', role: 'cut', enabled: params.editFlags.canCut }))
      menu.append(new MenuItem({ label: 'Copy', role: 'copy', enabled: params.editFlags.canCopy }))
      menu.append(new MenuItem({ label: 'Paste', role: 'paste', enabled: params.editFlags.canPaste }))
      menu.append(new MenuItem({ label: 'Select All', role: 'selectAll', enabled: params.editFlags.canSelectAll }))
      menu.popup({ window: w })
    } else if (params.selectionText) {
      menu.append(new MenuItem({ label: 'Copy', role: 'copy' }))
      menu.append(new MenuItem({ label: 'Select All', role: 'selectAll' }))
      menu.popup({ window: w })
    }
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
