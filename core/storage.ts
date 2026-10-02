// Paths, logger, download root rules, the Library, and storage sizes (ARCHITECTURE > Runtime data, > Storage and maintenance).
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { anyActive, clearRows, type DB, downloadsByPath, fail, forgetDownload, historyItem, isRecordedDownload, latestDownloads } from './db.ts'

/** True when `child` equals or sits inside `parent` (win32 path.relative compares case-insensitively). */
export const within = (parent: string, child: string) => {
  const rel = path.relative(parent, child)
  return !path.isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${path.sep}`)
}

/** Where TeleFlow keeps its data. Never inside the repo or the install folder (ARCHITECTURE > Runtime data). */
export function resolvePaths(o: { env: Record<string, string | undefined>, packaged: boolean, appDir: string }) {
  const local = o.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local')
  const home = path.resolve(o.env.TELEFLOW_HOME || path.join(local, o.packaged ? 'TeleFlow' : 'TeleFlow-dev'))
  const appDir = path.resolve(o.appDir)
  if (within(appDir, home)) {
    throw new Error(`TeleFlow can't keep its data inside its own folder (${home}). Set TELEFLOW_HOME to a folder outside ${appDir}.`)
  }
  const at = (...p: string[]) => path.join(home, ...p)
  return { home, appDir, db: at('teleflow.db'), tdlib: at('tdlib'), thumbs: at('thumbs'), tmp: at('tmp'), logs: at('logs'), chromium: at('chromium') }
}
export type Paths = ReturnType<typeof resolvePaths>

/** Compares renderer pages, never origins: every file: URL has the origin "null" (ARCHITECTURE > Bridge step 1). Throws on bad URLs. */
export const pageKey = (s: string) => {
  const u = new URL(s); u.hash = ''; u.search = ''
  return (u.protocol === 'file:' ? fileURLToPath(u) : u.href).toLowerCase()
}

let logFile = ''

/** Opens home\logs\main.log; a log over 5 MB moves to main.old.log first. */
export function openLog(dir: string) {
  fs.mkdirSync(dir, { recursive: true })
  logFile = path.join(dir, 'main.log')
  if ((fs.statSync(logFile, { throwIfNoEntry: false })?.size ?? 0) > 5 * 2 ** 20) fs.renameSync(logFile, path.join(dir, 'main.old.log'))
}

/** Callers never pass secrets; a 32-hex value (the API hash format) is masked as a backstop. Never throws. */
export function log(level: 'info' | 'warn' | 'error', message: string) {
  const line = `${new Date().toISOString()} ${level} ${message.replace(/\b[0-9a-f]{32}\b/gi, '[redacted]')}\n`
  try { if (logFile) return fs.appendFileSync(logFile, line) } catch {} // a full disk must not fail the caller
  process.stderr.write(line)
}

// ---- Download root ----

export type RootLists = { sealed: string[], guarded: string[] }
const pickSubfolder = 'Pick or create a subfolder, for example Downloads\\TeleFlow'

/** Clear All Data may delete everything under the root, so it must only ever hold the user's media. Returns the
 *  normalized path or throws a 400 with the reason (ARCHITECTURE > Runtime data). Validates only. */
export function checkDownloadRoot(p: string, lists: RootLists) {
  if (!path.isAbsolute(p) || path.parse(p).root.length < 3 || /[<>:"|?*\x00-\x1f]/.test(p.replace(/^[a-z]:/i, ''))) {
    throw fail(400, 'Pick a full folder path, for example D:\\Media')
  }
  const root = path.resolve(p)
  if (path.parse(root).root === root || lists.guarded.some((g) => within(root, g))) throw fail(400, pickSubfolder)
  if (lists.sealed.some((s) => within(s, root) || within(root, s))) {
    throw fail(400, "TeleFlow can't use a system or app data folder. Pick a folder for your media, for example Downloads\\TeleFlow")
  }
  return root
}

/** The protected-folder lists with each entry's real location next to it (junctions, symlinks, 8.3 names), so a known
 *  folder that is itself a junction cannot be picked by its target. Main builds the lists through this once. */
export function realRoots(lists: RootLists): RootLists {
  const withReal = (ps: string[]) => [...new Set(ps.flatMap((p) => { try { return [p, fs.realpathSync.native(p)] } catch { return [p] } }))]
  return { sealed: withReal(lists.sealed), guarded: withReal(lists.guarded) }
}

/** Where `p` really is, following junctions and symlinks; a part that does not exist yet is joined to its nearest
 *  existing parent's real path. checkDownloadRoot runs on this too, so a junction cannot lead into a protected folder. */
export async function realLocation(p: string): Promise<string> {
  const real = await fs.promises.realpath(p).catch(() => null)
  if (real) return real
  const parent = path.dirname(p)
  return parent === p ? p : path.join(await realLocation(parent), path.basename(p))
}

// ---- Library ----

export type LibType = 'video' | 'image' | 'audio' | 'document' | 'archive'
const extTypes: Record<string, LibType> = {}
for (const [type, exts] of Object.entries({
  video: 'mp4 mkv mov avi webm m4v wmv flv ts 3gp', image: 'jpg jpeg png gif webp bmp heic tiff',
  audio: 'mp3 m4a aac ogg oga opus flac wav wma', archive: 'zip rar 7z tar gz bz2 xz',
})) for (const ext of exts.split(' ')) extTypes[ext] = type as LibType
export const libType = (name: string): LibType => extTypes[path.extname(name).slice(1).toLowerCase()] ?? 'document'

export type LibraryEntry = { path: string /* absolute */, rel: string, name: string, type: LibType, size: number, mtime: number }
export type LibraryItem = {
  path: string /* relative to root */, name: string, type: LibType, size: number, mtime: number,
  chat: string | null, chatId: number | null, messageId: number | null, historyId: number | null, preview: string | null,
}

/** stat() in batches of 64; files that vanished in between are left out. */
async function statAll(files: string[]) {
  const out: [string, fs.Stats][] = []
  for (let i = 0; i < files.length; i += 64) {
    const batch = files.slice(i, i + 64)
    const stats = await Promise.all(batch.map((f) => fs.promises.stat(f).catch(() => null)))
    stats.forEach((s, j) => { if (s?.isFile()) out.push([batch[j], s]) })
  }
  return out
}
const filesUnder = async (dir: string) => (await fs.promises.readdir(dir, { recursive: true, withFileTypes: true })
  .catch((e: NodeJS.ErrnoException) => { if (e.code === 'ENOENT') return []; throw e }))
  .filter((d) => d.isFile()).map((d) => path.join(d.parentPath, d.name))

// Dot-prefixed names and folders (incl. .teleflow-<jobId>.part files) and Windows' own files are not media.
const skipped = (rel: string) => rel.split(path.sep).some((s) => s.startsWith('.')) || /^(desktop\.ini|thumbs\.db)$/i.test(path.basename(rel))

export async function scanLibrary(root: string): Promise<LibraryEntry[]> {
  const files = (await filesUnder(root)).filter((f) => !skipped(path.relative(root, f)))
  return (await statAll(files)).map(([file, s]) => ({
    path: file, rel: path.relative(root, file), name: path.basename(file), type: libType(file), size: s.size, mtime: s.mtimeMs,
  }))
}

// ponytail: no file watcher, so files added outside TeleFlow show up within 60 s; upgrade: fs.watch on the root.
let cache: { key: string, at: number, entries: LibraryEntry[] } | null = null
let scanning: { key: string, promise: Promise<LibraryEntry[]> } | null = null

/** The cached scan of `root`, rebuilt when older than 60 s or for another root (a root change drops it). */
export function library(root: string, now = Date.now()): Promise<LibraryEntry[]> {
  const key = root.toLowerCase()
  if (cache?.key === key && now - cache.at < 60_000) return Promise.resolve(cache.entries)
  if (scanning?.key !== key) {
    const promise = scanLibrary(root).then((entries) => { cache = { key, at: Date.now(), entries }; return entries })
    scanning = { key, promise }
    void promise.finally(() => { if (scanning?.promise === promise) scanning = null }).catch(() => {})
  }
  return scanning.promise
}
/** Never waits for or triggers a scan (global search). */
export const libraryCached = (root: string) => (cache?.key === root.toLowerCase() ? cache.entries : [])

/** A completed download joins the cached scan of its root, so the Library shows it without a rescan. */
export async function libraryAdded(root: string, file: string) {
  const key = root.toLowerCase(), rel = path.relative(root, file)
  if (cache?.key !== key || !within(root, file) || skipped(rel)) return
  const s = await fs.promises.stat(file).catch(() => null)
  const c = cache
  if (!s?.isFile() || c?.key !== key) return
  c.entries = [...c.entries.filter((e) => e.path.toLowerCase() !== file.toLowerCase()),
    { path: file, rel, name: path.basename(file), type: libType(file), size: s.size, mtime: s.mtimeMs }]
}

const preview = (e: LibraryEntry, historyId: number | null, thumbs: string) =>
  historyId !== null && fs.existsSync(path.join(thumbs, `${historyId}.jpg`)) ? `teleflow://saved/${historyId}`
    : e.type === 'image' ? `teleflow://image/${encodeURIComponent(e.rel)}` : null

/** Joins scan entries to completed download history by path; other files take the first folder under the root as chat. */
export function libraryItems(db: DB, entries: LibraryEntry[]) {
  const meta = downloadsByPath(db, entries.map((e) => e.path))
  return entries.map((e) => {
    const m = meta.get(e.path.toLowerCase())
    const folder = e.rel.includes(path.sep) ? e.rel.split(path.sep)[0] : null
    return { entry: e, historyId: m?.id ?? null, item: {
      path: e.rel, name: e.name, type: e.type, size: e.size, mtime: e.mtime, chat: m?.chat_title ?? folder,
      chatId: m?.chat_id ?? null, messageId: m?.message_id ?? null, historyId: m?.id ?? null, preview: null as string | null,
    } satisfies LibraryItem }
  })
}
export const withPreview = (x: ReturnType<typeof libraryItems>[number], thumbs: string): LibraryItem =>
  ({ ...x.item, preview: preview(x.entry, x.historyId, thumbs) })

export type LibraryQuery = { q: string, type?: LibType, chat?: string, sort?: 'newest' | 'oldest' | 'largest' | 'smallest' | 'name', page: number, pageSize: number }
const sorts: Record<NonNullable<LibraryQuery['sort']>, (a: LibraryItem, b: LibraryItem) => number> = {
  newest: (a, b) => b.mtime - a.mtime, oldest: (a, b) => a.mtime - b.mtime, largest: (a, b) => b.size - a.size,
  smallest: (a, b) => a.size - b.size, name: (a, b) => a.name.localeCompare(b.name),
}

export async function libraryList(db: DB, o: { root: string, thumbs: string }, a: LibraryQuery) {
  const entries = await library(o.root)
  const all = libraryItems(db, entries)
  const q = a.q.toLowerCase()
  const hits = all.filter(({ item }) => (!q || item.name.toLowerCase().includes(q)) && (!a.type || item.type === a.type) && (!a.chat || item.chat === a.chat))
  hits.sort((x, y) => sorts[a.sort ?? 'newest'](x.item, y.item))
  return {
    items: hits.slice((a.page - 1) * a.pageSize, a.page * a.pageSize).map((x) => withPreview(x, o.thumbs)),
    total: hits.length,
    chats: [...new Set(all.map((x) => x.item.chat).filter((c): c is string => c !== null))].sort((x, y) => x.localeCompare(y)),
    stats: { files: entries.length, size: entries.reduce((s, e) => s + e.size, 0), missing: (await libraryMissing(db, entries, o.thumbs)).length },
  }
}

/** The latest completed download of each message whose file is neither in the scan nor on disk (Verify). */
export async function libraryMissing(db: DB, entries: LibraryEntry[], thumbs: string) {
  const scanned = new Set(entries.map((e) => e.path.toLowerCase()))
  const rows = latestDownloads(db).filter((r) => !scanned.has((r.path as string).toLowerCase()))
  const present = new Set((await statAll(rows.map((r) => r.path as string))).map(([f]) => f))
  return rows.filter((r) => !present.has(r.path as string)).map((r) => historyItem(r, thumbs))
}

/** The `library.*` path rule: an existing file inside the root after realpath, or a recorded download path
 *  (downloads made before a root change). Anything else is a 404. Returns the absolute path. */
export async function libraryFile(db: DB, root: string, p: string) {
  const file = path.resolve(root, p)
  const real = await fs.promises.realpath(file).catch(() => null)
  if (real && (await fs.promises.stat(real)).isFile()) {
    const realRoot = await fs.promises.realpath(root).catch(() => null)
    if ((realRoot && within(realRoot, real)) || isRecordedDownload(db, file)) return file
  }
  throw fail(404, 'File not found')
}

/** Moves files to the Recycle Bin, then forgets each download (ARCHITECTURE > Methods notes > library.trash).
 *  Every path is checked first; a file the Recycle Bin refuses stops the run and is named in `failed`. */
export async function trash(db: DB, root: string, paths: string[], trashItem: (file: string) => Promise<void>) {
  const checked = await Promise.all(paths.map((p) => libraryFile(db, root, p)))
  const files = checked.filter((f, i) => checked.findIndex((g) => g.toLowerCase() === f.toLowerCase()) === i)
  let trashed = 0, freed = 0, failed: string | null = null
  const chats = new Set<number>()
  for (const file of files) {
    const size = (await fs.promises.stat(file).catch(() => null))?.size ?? 0
    try { await trashItem(file) } catch { failed = path.basename(file); break }
    for (const id of forgetDownload(db, file)) chats.add(id)
    if (cache) cache.entries = cache.entries.filter((e) => e.path.toLowerCase() !== file.toLowerCase())
    trashed++
    freed += size
  }
  return { trashed, freed, failed, chats: [...chats] }
}

// ---- Sizes ----

export const dirSize = async (dir: string) => (await statAll(await filesUnder(dir))).reduce((sum, [, s]) => sum + s.size, 0)

export type StorageReport = {
  drive: { root: string, total: number, free: number },
  library: Record<LibType, number> & { files: number, total: number },
  cache: { tdlib: number, thumbs: number, tmp: number, chromium: number, total: number },
  appData: number,
}

const appDataSize = async (paths: Paths) => (await statAll(['', '-wal', '-shm'].map((s) => paths.db + s))).reduce((sum, [, st]) => sum + st.size, 0)

export async function storageReport(root: string, paths: Paths, cacheSize: () => Promise<number>): Promise<StorageReport> {
  const drive = path.parse(root).root
  const [disk, entries, tdlib, thumbs, tmp, chromium, appData] = await Promise.all([
    fs.promises.statfs(drive).catch(() => null), // an unplugged or unmapped drive reports 0 / 0; the rest still answers
    library(root), dirSize(path.join(paths.tdlib, 'files')), dirSize(paths.thumbs), dirSize(paths.tmp), cacheSize(), appDataSize(paths),
  ])
  const lib = { video: 0, image: 0, audio: 0, document: 0, archive: 0, files: entries.length, total: 0 }
  for (const e of entries) { lib[e.type] += e.size; lib.total += e.size }
  return {
    drive: { root: drive, total: disk ? disk.blocks * disk.bsize : 0, free: disk ? disk.bavail * disk.bsize : 0 },
    library: lib, cache: { tdlib, thumbs, tmp, chromium, total: tdlib + thumbs + tmp + chromium }, appData,
  }
}

// ---- Finalizing downloads (ARCHITECTURE > Download step 6) ----

/** Mark-of-the-Web, so Windows applies SmartScreen and Office Protected View when the file is opened. Logs and continues
 *  on failure. ponytail: FAT/exFAT volumes have no streams, so their files carry no Mark-of-the-Web. */
export const markOfTheWeb = (file: string) => fs.promises.writeFile(`${file}:Zone.Identifier`, '[ZoneTransfer]\r\nZoneId=3\r\n')
  .catch((e: Error) => log('warn', `Mark-of-the-Web failed for ${path.basename(file)}: ${e.message}`))

/** Moves a finished download out of TDLib's files folder. A file under its final name is always complete: a same-volume
 *  rename is atomic; across volumes the file is copied to `part` (dot-prefixed, so the Library skips it), then renamed.
 *  ponytail: a part file of a job canceled after a crash is not swept; upgrade: sweep .teleflow-*.part on Clear cache. */
export async function moveFile(src: string, dest: string, part: string) {
  await markOfTheWeb(src) // the stream moves with the rename
  try { await fs.promises.rename(src, dest) } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'EXDEV') throw e
    await fs.promises.rm(part, { force: true }) // a stale part from an interrupted run
    try {
      await fs.promises.copyFile(src, part)
      await markOfTheWeb(part)
      await fs.promises.rename(part, dest)
    } catch (copyError) {
      await fs.promises.rm(part, { force: true })
      throw copyError
    }
  }
}

// ---- Clearing (ARCHITECTURE > Storage and maintenance) ----

/** Electron, TDLib, and engine calls the clears need; main passes them in so core/ stays Electron-free. */
export type ClearDeps = {
  db: DB, paths: Paths, root: string, roots: RootLists,
  optimize: () => Promise<unknown>, // TDLib optimizeStorage; rejects when Telegram is not signed in
  clearChromium: () => Promise<void>, cacheSize: () => Promise<number>, stopScan: () => void,
  cancelAll: () => void, logout: () => Promise<unknown>, signOut: () => Promise<void>, clearStorageData: () => Promise<void>,
  loginItemOff: () => void,
}
const sum = (ns: number[]) => ns.reduce((a, b) => a + b, 0)
const emptyDir = async (dir: string, keep = new Set<string>()) => {
  for (const name of await fs.promises.readdir(dir).catch(() => [])) {
    if (!keep.has(name)) await fs.promises.rm(path.join(dir, name), { recursive: true, force: true, maxRetries: 3 })
  }
}
const cacheBytes = async (o: ClearDeps) =>
  sum(await Promise.all([dirSize(path.join(o.paths.tdlib, 'files')), dirSize(o.paths.thumbs), dirSize(o.paths.tmp), o.cacheSize()]))

/** TDLib file cache, saved thumbnails, temp files of finished uploads, Chromium cache. Keeps login, history, queue, and
 *  downloads; queued, paused, and failed downloads restart from zero (their TDLib partial data is gone). */
export async function clearCache(o: ClearDeps) {
  if (anyActive(o.db)) throw fail(409, 'Pause active transfers first')
  const before = await cacheBytes(o)
  await o.optimize().catch((e: Error) => log('info', `TDLib cache not optimized: ${e.message}`))
  await emptyDir(o.paths.thumbs)
  const unfinished = o.db.prepare(`SELECT id FROM jobs WHERE kind = 'upload' AND status <> 'completed'`).all().map((r) => String(r.id))
  await emptyDir(o.paths.tmp, new Set(unfinished))
  await o.clearChromium()
  o.db.prepare(`UPDATE jobs SET done = 0 WHERE kind = 'download' AND status IN ('queued', 'paused', 'failed')`).run()
  return { freed: Math.max(0, before - await cacheBytes(o)) }
}

/** History, queue, media index, and settings (except the credentials and window), then Clear cache. */
export async function clearAppData(o: ClearDeps) {
  if (anyActive(o.db)) throw fail(409, 'Pause active transfers first')
  const before = await appDataSize(o.paths)
  o.stopScan()
  const chats = clearRows(o.db, ['apiId', 'apiHash', 'window'])
  const freed = Math.max(0, before - await appDataSize(o.paths)) + (await clearCache(o)).freed
  return { freed, chats }
}

/** Everything: cancels every job, optionally deletes the downloads (the root folder stays), logs out (a local delete when
 *  Telegram is unreachable), removes the session, cache, and every row, and turns Start with Windows off. */
export async function clearAll(o: ClearDeps, deleteDownloads: boolean) {
  // Where the root really is is checked right before anything is deleted: a junction made after it was saved must not
  // lead the delete into a protected folder (Phase 2 review 1 #2).
  if (deleteDownloads) checkDownloadRoot(await realLocation(o.root), o.roots)
  const measure = async () => sum(await Promise.all([dirSize(o.paths.tdlib), dirSize(o.paths.thumbs), dirSize(o.paths.tmp),
    appDataSize(o.paths), o.cacheSize(), deleteDownloads ? dirSize(o.root) : 0]))
  const before = await measure()
  o.cancelAll()
  if (deleteDownloads) {
    for (const e of await scanLibrary(o.root)) {
      await fs.promises.rm(e.path, { force: true }).catch((err: Error) => log('warn', `Could not delete ${e.rel}: ${err.message}`))
    }
    const dirs = (await fs.promises.readdir(o.root, { recursive: true, withFileTypes: true }).catch(() => []))
      .filter((d) => d.isDirectory()).map((d) => path.join(d.parentPath, d.name))
    for (const dir of dirs.sort((a, b) => b.length - a.length)) await fs.promises.rmdir(dir).catch(() => {}) // only empty ones go
    cache = null
  }
  await o.logout().catch((e: Error) => log('warn', `Logout during Clear All Data failed: ${e.message}`))
  await o.signOut() // closes the client and forgets the credentials: auth returns to the API Keys step
  for (const dir of [o.paths.tdlib, o.paths.thumbs, o.paths.tmp]) await fs.promises.rm(dir, { recursive: true, force: true, maxRetries: 5 })
  const chats = clearRows(o.db, [])
  await o.clearStorageData()
  o.loginItemOff()
  return { freed: Math.max(0, before - await measure()), chats }
}
