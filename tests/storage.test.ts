import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, mock, test } from 'node:test'
import { pathToFileURL } from 'node:url'
import { type DB, downloadStates, enqueue, getSettings, openDb, putMedia, putScan, putSetting, readSetting } from '../core/db.ts'
import {
  checkDownloadRoot, clearAll, clearAppData, clearCache, type ClearDeps, dirSize, library, libraryAdded, libraryCached, libraryFile, libraryMissing,
  libType, log, moveFile, openLog, pageKey, realLocation, realRoots, resolvePaths, scanLibrary, storageReport, trash, unwatchLibrary, within,
} from '../core/storage.ts'

const env = { LOCALAPPDATA: 'C:\\Users\\u\\AppData\\Local' }
const repo = 'C:\\src\\teleflow'
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'teleflow-'))
after(() => { unwatchLibrary(); fs.rmSync(temp, { recursive: true, force: true }) })
let n = 0
/** A fresh folder with the given files (relative path → content). */
function tree(files: Record<string, string>) {
  const dir = path.join(temp, `t${++n}`)
  for (const [rel, body] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true })
    fs.writeFileSync(path.join(dir, rel), body)
  }
  fs.mkdirSync(dir, { recursive: true })
  return dir
}
function addHistory(db: DB, chat: number, msg: number, file: string | null, o: { status?: string, kind?: string } = {}) {
  return Number(db.prepare(`INSERT INTO history (kind, status, chat_id, chat_title, message_id, name, type, size, path, finished_at)
    VALUES (?, ?, ?, 'Fixture chat', ?, 'f.mp4', 'video', 10, ?, 0)`).run(o.kind ?? 'download', o.status ?? 'completed', chat, msg, file).lastInsertRowid)
}

test('resolvePaths: TELEFLOW_HOME wins over packaged and dev defaults; the layout hangs off home', () => {
  for (const packaged of [true, false]) {
    assert.equal(resolvePaths({ env: { ...env, TELEFLOW_HOME: 'D:\\tf-home' }, packaged, appDir: repo }).home, 'D:\\tf-home')
  }
  const p = resolvePaths({ env: { TELEFLOW_HOME: 'D:\\tf-home' }, packaged: true, appDir: repo })
  assert.deepEqual([p.db, p.tdlib, p.thumbs, p.tmp, p.logs, p.chromium],
    ['teleflow.db', 'tdlib', 'thumbs', 'tmp', 'logs', 'chromium'].map((x) => `D:\\tf-home\\${x}`))
})

test('resolvePaths: packaged uses %LOCALAPPDATA%\\TeleFlow, dev uses TeleFlow-dev', () => {
  assert.equal(resolvePaths({ env, packaged: true, appDir: 'C:\\Users\\u\\AppData\\Local\\Programs\\TeleFlow' }).home, 'C:\\Users\\u\\AppData\\Local\\TeleFlow')
  assert.equal(resolvePaths({ env, packaged: false, appDir: repo }).home, 'C:\\Users\\u\\AppData\\Local\\TeleFlow-dev')
})

test('resolvePaths and checkDownloadRoot: app data and downloads never land in this repo', () => {
  const repoDir = path.resolve(import.meta.dirname, '..')
  for (const packaged of [true, false]) {
    const p = resolvePaths({ env: { LOCALAPPDATA: process.env.LOCALAPPDATA }, packaged, appDir: repoDir })
    for (const dir of [p.home, p.db, p.tdlib, p.thumbs, p.tmp, p.logs, p.chromium]) assert.ok(!within(repoDir, dir), dir)
  }
  assert.throws(() => resolvePaths({ env: { TELEFLOW_HOME: path.join(repoDir, 'data') }, packaged: false, appDir: repoDir }), /inside its own folder/)
  const roots = { sealed: [repoDir], guarded: [] }
  for (const root of [repoDir, path.join(repoDir, 'downloads'), path.dirname(repoDir)]) {
    assert.throws(() => checkDownloadRoot(root, roots), { status: 400 }, root)
  }
})

test('resolvePaths: home inside or equal to appDir throws (any case)', () => {
  for (const home of ['C:\\src\\teleflow\\data', 'c:\\SRC\\TeleFlow', 'C:\\src\\teleflow']) {
    assert.throws(() => resolvePaths({ env: { ...env, TELEFLOW_HOME: home }, packaged: false, appDir: repo }), /inside its own folder/)
  }
  // A sibling whose name starts like the app folder is fine.
  assert.equal(resolvePaths({ env: { ...env, TELEFLOW_HOME: 'C:\\src\\teleflow-data' }, packaged: false, appDir: repo }).home, 'C:\\src\\teleflow-data')
})

test('pageKey: drive-letter case and hash are ignored; sibling pages differ', () => {
  const index = pathToFileURL('c:\\x\\out\\renderer\\index.html').href
  assert.equal(pageKey('file:///C:/X/out/renderer/index.html#/queue'), pageKey(index))
  assert.notEqual(pageKey('file:///C:/X/out/renderer/other.html'), pageKey(index))
})

test('pageKey: dev URLs compare as lowercased hrefs; an encoded slash throws', () => {
  assert.equal(pageKey('http://localhost:5173/#/a'), pageKey('http://localhost:5173'))
  assert.throws(() => pageKey('file:///C:/x/out%2Frenderer/index.html'))
})

test('openLog/log: a log over 5 MB rotates, 32-hex values are masked, and a failed write never throws', () => {
  const dir = tree({ 'main.log': 'x'.repeat(5 * 2 ** 20 + 1) })
  openLog(dir)
  assert.equal(fs.statSync(path.join(dir, 'main.old.log')).size, 5 * 2 ** 20 + 1)
  log('info', `hash ${'ab12'.repeat(8)} kept`)
  const text = fs.readFileSync(path.join(dir, 'main.log'), 'utf8')
  assert.match(text, / info hash \[redacted\] kept\n$/)
  assert.ok(!text.includes('ab12ab12'))
  fs.rmSync(dir, { recursive: true, force: true })
  assert.doesNotThrow(() => log('warn', 'falls back to stderr once the folder is gone'))
})

const lists = {
  sealed: ['C:\\Users\\u\\AppData\\Local\\TeleFlow', 'D:\\Tools\\TeleFlow', 'C:\\Users\\u\\AppData', 'C:\\Windows', 'C:\\Program Files', 'C:\\Program Files (x86)', 'C:\\ProgramData'],
  guarded: ['C:\\Users\\u', ...['Desktop', 'Documents', 'Downloads', 'Pictures', 'Videos', 'Music'].map((k) => `C:\\Users\\u\\${k}`)],
}

test('checkDownloadRoot: rejects relative, invalid, drive roots, app/system folders, the profile, known folders, and their ancestors', () => {
  const cases: [string, RegExp][] = [
    ['Media', /full folder path/], ['C:Media', /full folder path/], ['\\Media', /full folder path/], ['D:\\Me<dia', /full folder path/], ['D:\\a|b', /full folder path/],
    ['C:\\', /subfolder/], ['D:\\', /subfolder/],
    ['C:\\Users\\u\\AppData\\Local\\TeleFlow', /system or app data/], // home
    ['D:\\Tools\\TeleFlow', /system or app data/], ['D:\\Tools\\TeleFlow\\Media', /system or app data/], ['D:\\Tools', /system or app data/], // appDir, inside, ancestor
    ['C:\\Users\\u\\AppData\\Local', /system or app data/], ['C:\\Users\\u\\AppData\\Local\\Programs', /system or app data/], // %LOCALAPPDATA%
    ['c:\\windows', /system or app data/], ['C:\\Program Files\\X', /system or app data/], ['C:\\ProgramData\\Media', /system or app data/],
    ['C:\\Users\\u', /subfolder/], ['C:\\Users', /subfolder/], ['C:\\Users\\u\\Downloads', /subfolder/], ['c:\\users\\U\\documents', /subfolder/],
  ]
  for (const [p, reason] of cases) assert.throws(() => checkDownloadRoot(p, lists), (e: Error & { status?: number }) => e.status === 400 && reason.test(e.message), p)
})

test('checkDownloadRoot: accepts D:\\Media and Downloads\\TeleFlow, normalized', () => {
  assert.equal(checkDownloadRoot('D:\\Media', lists), 'D:\\Media')
  assert.equal(checkDownloadRoot('C:\\Users\\u\\Downloads\\TeleFlow', lists), 'C:\\Users\\u\\Downloads\\TeleFlow')
  assert.equal(checkDownloadRoot('D:/Media/TG/', lists), 'D:\\Media\\TG')
})

test('realLocation: follows junctions, also below them for folders that do not exist yet', async () => {
  const target = tree({ 'x.txt': 'x' })
  const base = tree({})
  fs.symlinkSync(target, path.join(base, 'link'), 'junction')
  const real = fs.realpathSync.native(target) // %TEMP% can be an 8.3 short path; the native realpath expands it
  assert.equal(await realLocation(path.join(base, 'link')), real)
  assert.equal(await realLocation(path.join(base, 'link', 'New', 'Sub')), path.join(real, 'New', 'Sub'))
  assert.equal(await realLocation(path.join(base, 'plain')), path.join(fs.realpathSync.native(base), 'plain'))
})

test('libType: extension mapping, case-insensitive; everything else is a document', () => {
  const cases = { 'a.TS': 'video', 'b.3gp': 'video', 'c.heic': 'image', 'd.opus': 'audio', 'e.oga': 'audio', 'f.bz2': 'archive', 'g.docx': 'document', h: 'document' }
  for (const [name, type] of Object.entries(cases)) assert.equal(libType(name), type, name)
})

test('scanLibrary: skips dot-prefixed names and folders, part files, desktop.ini, Thumbs.db', async () => {
  const root = tree({
    'a.MP4': '1', 'b.jpeg': '22', 'Chat One\\c.flac': '333', 'd.7z': '4', 'e.pdf': '5', noext: '6',
    '.hidden\\g.mp4': 'x', 'Chat One\\.teleflow-5.part': 'x', '.dotfile': 'x', 'desktop.ini': 'x', 'Sub\\Thumbs.db': 'x',
  })
  const got = (await scanLibrary(root)).map((e) => [e.rel, e.type, e.size]).sort()
  assert.deepEqual(got, [['Chat One\\c.flac', 'audio', 3], ['a.MP4', 'video', 1], ['b.jpeg', 'image', 2], ['d.7z', 'archive', 1], ['e.pdf', 'document', 1], ['noext', 'document', 1]])
  assert.deepEqual(await scanLibrary(path.join(root, 'missing')), [])
})

test('libraryFile: inside the root, or a recorded download path after a root change; anything else 404', async () => {
  const db = openDb(':memory:')
  const root = tree({ 'Chat\\a.mp4': 'a' })
  const elsewhere = tree({ 'b.mp4': 'b', 'c.mp4': 'c' })
  fs.symlinkSync(elsewhere, path.join(root, 'link'), 'junction')
  const notFound = { status: 404 }
  assert.equal(await libraryFile(db, root, 'Chat\\a.mp4'), path.join(root, 'Chat', 'a.mp4'))
  assert.equal(await libraryFile(db, root, path.join(root, 'CHAT', 'A.MP4')), path.join(root, 'CHAT', 'A.MP4'))
  for (const p of [path.join(elsewhere, 'b.mp4'), `..\\${path.basename(elsewhere)}\\b.mp4`, 'link\\b.mp4', 'Chat\\gone.mp4', 'Chat']) {
    await assert.rejects(libraryFile(db, root, p), notFound, p)
  }
  addHistory(db, 7, 1, path.join(elsewhere, 'b.mp4')) // downloaded before the root moved
  assert.equal(await libraryFile(db, root, path.join(elsewhere, 'B.mp4')), path.join(elsewhere, 'B.mp4'))
  await assert.rejects(libraryFile(db, root, path.join(elsewhere, 'c.mp4')), notFound)
})

test('libraryMissing: only the latest completed download of each message counts', async () => {
  const db = openDb(':memory:')
  const root = tree({ 'present.mp4': 'p', 'newer.mp4': 'n' })
  const outside = tree({ 'kept.mp4': 'k' })
  addHistory(db, 7, 1, path.join(root, 'gone-older.mp4'))
  addHistory(db, 7, 1, path.join(root, 'newer.mp4')) // latest: present
  addHistory(db, 7, 2, path.join(root, 'present.mp4'))
  const missing = addHistory(db, 7, 2, path.join(root, 'gone-newer.mp4')) // latest: gone
  addHistory(db, 7, 3, path.join(outside, 'kept.mp4')) // outside the scan but on disk
  addHistory(db, 8, 1, path.join(root, 'failed.mp4'), { status: 'failed' })
  addHistory(db, 8, 2, path.join(root, 'upload.mp4'), { kind: 'upload' })
  const items = await libraryMissing(db, await scanLibrary(root), path.join(temp, 'thumbs'))
  assert.deepEqual(items.map((i) => [i.id, i.messageId, i.preview]), [[missing, 2, null]])
})

test('trash: Recycle Bin first, then history.path is nulled and the completed job deleted', async () => {
  const db = openDb(':memory:')
  const root = tree({ 'Chat\\a.mp4': '12345', 'Chat\\b.mp4': 'b' })
  const a = path.join(root, 'Chat', 'a.mp4')
  addHistory(db, 7, 1, a)
  const job = db.prepare(`INSERT INTO jobs (kind, status, position, chat_id, chat_title, message_id, name, type, path, created_at)
    VALUES ('download', ?, ?, 7, 'Fixture chat', ?, 'a.mp4', 'video', ?, 0)`)
  job.run('completed', 1, 1, a)
  job.run('queued', 2, 2, null)
  const binned: string[] = []
  const r = await trash(db, root, ['Chat\\a.mp4', 'CHAT\\A.MP4'], async (f) => { binned.push(f); fs.rmSync(f) })
  assert.deepEqual(r, { trashed: 1, freed: 5, failed: null, chats: [7] })
  assert.deepEqual(binned, [a])
  assert.equal(db.prepare('SELECT path FROM history').get()!.path, null)
  assert.deepEqual(db.prepare('SELECT status FROM jobs').all().map((j) => j.status), ['queued'])
  assert.equal(downloadStates(db, 7, [1]).get(1)!.status, 'none')
  await assert.rejects(trash(db, root, ['Chat\\b.mp4', 'Chat\\gone.mp4'], async () => {}), { status: 404 }) // checked before anything moves
  const refused = await trash(db, root, ['Chat\\b.mp4'], async () => { throw new Error('in use') })
  assert.deepEqual(refused, { trashed: 0, freed: 0, failed: 'b.mp4', chats: [] })
})

test('dirSize and storageReport: sizes by area and library type, injected Chromium cache', async () => {
  const home = tree({ 'tdlib\\files\\videos\\x': '1234567890', 'tdlib\\db\\td.binlog': 'session', 'thumbs\\1.jpg': '12345', 'tmp\\9\\a': '123' })
  const root = tree({ 'v.mp4': '1234', 'Chat\\z.zip': '12' })
  const paths = resolvePaths({ env: { TELEFLOW_HOME: home }, packaged: true, appDir: repo })
  openDb(paths.db).close()
  assert.equal(await dirSize(paths.tdlib), 17)
  assert.equal(await dirSize(path.join(home, 'missing')), 0)
  const r = await storageReport(root, paths, async () => 7)
  assert.equal(r.drive.root, path.parse(root).root)
  assert.ok(r.drive.total > 0 && r.drive.free > 0 && r.drive.free <= r.drive.total)
  assert.deepEqual(r.library, { video: 4, image: 0, audio: 0, document: 0, archive: 2, files: 2, total: 6 })
  assert.deepEqual(r.cache, { tdlib: 10, thumbs: 5, tmp: 3, chromium: 7, total: 25 })
  assert.ok(r.appData > 0)
})

test('storageReport: a download root on a missing drive reports the drive as 0 / 0; cache and app data still answer', async () => {
  const home = tree({ 'thumbs\\1.jpg': '12345' })
  const paths = resolvePaths({ env: { TELEFLOW_HOME: home }, packaged: true, appDir: repo })
  const letter = [...'QRSTUVWXYZ'].find((l) => !fs.existsSync(`${l}:\\`))
  assert.ok(letter, 'needs one unused drive letter')
  const r = await storageReport(`${letter}:\\Media`, paths, async () => 7)
  assert.deepEqual(r.drive, { root: `${letter}:\\`, total: 0, free: 0 })
  assert.deepEqual([r.library.files, r.library.total, r.cache.thumbs, r.cache.total], [0, 0, 5, 12])
})

// ---- Finalizing downloads (3.3) ----

const exdev = () => Object.assign(new Error('cross-device link not permitted'), { code: 'EXDEV' })

test('moveFile: across volumes (EXDEV) it copies to the part file and renames it, so the final name only ever holds a complete file', async () => {
  const dir = tree({ 'src.bin': 'payload', 'Chat\\.teleflow-1.part': 'stale part from an interrupted run' })
  const src = path.join(dir, 'src.bin'), part = path.join(dir, 'Chat', '.teleflow-1.part')
  const rename = mock.method(fs.promises, 'rename', async () => { throw exdev() }, { times: 1 })
  await moveFile(src, path.join(dir, 'Chat', 'final.bin'), part)
  rename.mock.restore()
  assert.equal(fs.readFileSync(path.join(dir, 'Chat', 'final.bin'), 'utf8'), 'payload')
  assert.ok(!fs.existsSync(part))
  assert.match(fs.readFileSync(path.join(dir, 'Chat', 'final.bin:Zone.Identifier'), 'utf8'), /^\[ZoneTransfer\]\r\nZoneId=3\r\n$/)
  assert.ok(fs.existsSync(src)) // the source goes with TDLib's deleteFile

  const rename2 = mock.method(fs.promises, 'rename', async () => { throw exdev() }, { times: 1 })
  const copy = mock.method(fs.promises, 'copyFile', async (_from: string, to: string) => {
    fs.writeFileSync(to, 'half')
    throw Object.assign(new Error('not enough space'), { code: 'ENOSPC' })
  }, { times: 1 })
  await assert.rejects(moveFile(src, path.join(dir, 'Chat', 'second.bin'), part), { code: 'ENOSPC' })
  rename2.mock.restore()
  copy.mock.restore()
  assert.ok(!fs.existsSync(part) && !fs.existsSync(path.join(dir, 'Chat', 'second.bin')), 'a failed copy leaves no part file and no final name')

  await moveFile(src, path.join(dir, 'third.bin'), part) // same volume: one rename
  assert.deepEqual([fs.existsSync(src), fs.readFileSync(path.join(dir, 'third.bin'), 'utf8')], [false, 'payload'])
})

test('libraryAdded: a completed download joins the cached scan; part files and other roots are ignored', async () => {
  const root = tree({ 'a.mp4': '1' })
  await library(root)
  fs.mkdirSync(path.join(root, 'Chat'))
  for (const [name, body] of [['b.jpg', '22'], ['.teleflow-3.part', 'x']]) fs.writeFileSync(path.join(root, 'Chat', name), body)
  await libraryAdded(root, path.join(root, 'Chat', 'b.jpg'))
  await libraryAdded(root, path.join(root, 'Chat', '.teleflow-3.part'))
  await libraryAdded(path.join(temp, 'elsewhere'), path.join(root, 'Chat', 'b.jpg'))
  assert.deepEqual(libraryCached(root).map((e) => [e.rel, e.type, e.size]).sort(), [['Chat\\b.jpg', 'image', 2], ['a.mp4', 'video', 1]])
})

test('library: a change anywhere under the root drops the cached scan, so the next read sees the new file', async () => {
  const root = tree({ 'a.mp4': '1' })
  assert.equal((await library(root)).length, 1)
  fs.writeFileSync(path.join(root, 'b.mp4'), '22')
  await new Promise((r) => setTimeout(r, 700)) // the watcher lets the burst settle instead of rescanning per event
  assert.deepEqual(libraryCached(root), [], 'the cached scan is gone')
  assert.equal((await library(root)).length, 2)
})

// ---- Clearing (3.6) ----

function clearRig() {
  const home = tree({ 'tdlib\\files\\videos\\v': '1234567890', 'tdlib\\db\\td.binlog': 'session', 'thumbs\\1.jpg': '12345', 'tmp\\1\\a': '1', 'tmp\\2\\b': '22' })
  const root = tree({ 'Chat\\a.mp4': 'aaaa', 'Chat\\Sub\\b.jpg': 'bb', 'loose.zip': 'z', '.keep\\hidden.txt': 'h' })
  const paths = resolvePaths({ env: { TELEFLOW_HOME: home }, packaged: true, appDir: repo })
  const db = openDb(paths.db)
  const calls: string[] = []
  const deps: ClearDeps = {
    db, paths, root, roots: realRoots({ sealed: [home], guarded: [] }), cacheSize: async () => 0,
    optimize: async () => { calls.push('optimize'); fs.rmSync(path.join(paths.tdlib, 'files'), { recursive: true, force: true }) },
    clearChromium: async () => { calls.push('chromium') }, stopScan: () => { calls.push('stopScan') },
    cancelAll: () => { calls.push('cancelAll'); db.exec('DELETE FROM jobs') }, logout: async () => { calls.push('logout') },
    signOut: async () => { calls.push('signOut') }, clearStorageData: async () => { calls.push('storage') }, loginItemOff: () => { calls.push('loginItemOff') },
  }
  return { db, root, paths, home, calls, deps }
}
let msg = 0
const addJob = (db: DB, kind: 'download' | 'upload', status: string, done = 0) => {
  const [id] = enqueue(db, [{ kind, chatId: 7, chatTitle: 'Fixture chat', messageId: kind === 'download' ? ++msg : null, name: 'f', type: 'video', size: 10, files: [] }])
  db.prepare('UPDATE jobs SET status = ?, done = ? WHERE id = ?').run(status, done, id)
  return id
}
const count = (db: DB, table: string) => (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n

test('Clear cache: refused while a transfer is active; empties the TDLib cache, thumbnails, and tmp of finished uploads; restarts partial downloads', async () => {
  const t = clearRig()
  addJob(t.db, 'upload', 'queued') // job 1: tmp\1 stays for it
  const ids = (['queued', 'paused', 'failed', 'active'] as const).map((s, i) => addJob(t.db, 'download', s, i + 5))
  await assert.rejects(clearCache(t.deps), { status: 409, message: 'Pause active transfers first' })
  assert.deepEqual(t.calls, [])
  t.db.prepare(`UPDATE jobs SET status = 'completed' WHERE id = ?`).run(ids[3])
  assert.deepEqual(await clearCache(t.deps), { freed: 10 + 5 + 2 }) // TDLib files, the thumbnail, tmp\2
  assert.deepEqual([fs.readdirSync(t.paths.tmp), fs.readdirSync(t.paths.thumbs), t.calls], [['1'], [], ['optimize', 'chromium']])
  assert.deepEqual(ids.map((id) => t.db.prepare('SELECT done FROM jobs WHERE id = ?').get(id)!.done), [0, 0, 0, 8])
  assert.ok(fs.existsSync(path.join(t.paths.tdlib, 'db', 'td.binlog')), 'the session stays')
  t.db.close()
})

test('Clear app data: keeps the credentials, window, and downloads; removes jobs, history, the media index, and other settings; then Clear cache', async () => {
  const t = clearRig()
  for (const [k, v] of [['apiId', 777], ['apiHash', 'f'.repeat(32)], ['window', { x: 1 }], ['maxDownloads', 4], ['downloadRoot', 'X:\\Custom']] as const) putSetting(t.db, k, v)
  addJob(t.db, 'download', 'completed')
  t.db.prepare(`INSERT INTO history (kind, status, chat_id, chat_title, name, type, size, finished_at) VALUES ('download', 'completed', 8, 'c', 'f', 'video', 1, 0)`).run()
  putMedia(t.db, [{ chatId: 9, messageId: 1, date: 0, type: 'video', name: 'v.mp4', ext: 'mp4', size: 1, duration: 1, caption: '', thumb: null }])
  putScan(t.db, { chat_id: 9, newest_id: 1, oldest_id: 1, complete: 1, total: 1, cursors: null })
  addJob(t.db, 'download', 'active')
  await assert.rejects(clearAppData(t.deps), { status: 409 })
  t.db.exec(`UPDATE jobs SET status = 'paused'`)
  const r = await clearAppData(t.deps)
  assert.deepEqual(r.chats.sort(), [7, 8, 9])
  assert.ok(r.freed >= 10 + 5 + 2)
  assert.deepEqual(['jobs', 'history', 'media', 'scans'].map((table) => count(t.db, table)), [0, 0, 0, 0])
  assert.deepEqual([readSetting(t.db, 'apiId'), readSetting(t.db, 'window'), readSetting(t.db, 'maxDownloads'), getSettings(t.db, 'X:\\Default').downloadRoot],
    [777, { x: 1 }, undefined, 'X:\\Default'])
  assert.equal(readSetting(t.db, 'apiHash'), 'f'.repeat(32))
  assert.deepEqual(t.calls, ['stopScan', 'optimize', 'chromium'])
  assert.ok(fs.existsSync(path.join(t.root, 'Chat', 'a.mp4')), 'downloads stay')
  t.db.close()
})

test('Clear All Data: cancels everything, deletes downloads but keeps the root folder, signs out, removes the session and every row', async () => {
  const t = clearRig()
  putSetting(t.db, 'apiHash', 'f'.repeat(32))
  addJob(t.db, 'download', 'active')
  const r = await clearAll(t.deps, true)
  assert.ok(fs.statSync(t.root).isDirectory())
  const left = fs.readdirSync(t.root, { recursive: true }).map(String).sort()
  assert.deepEqual(left, ['.keep', '.keep\\hidden.txt']) // only what the Library does not list; emptied folders are gone
  for (const dir of [t.paths.tdlib, t.paths.thumbs, t.paths.tmp]) assert.ok(!fs.existsSync(dir), dir)
  assert.deepEqual([count(t.db, 'settings'), count(t.db, 'jobs')], [0, 0])
  assert.deepEqual(t.calls, ['cancelAll', 'logout', 'signOut', 'storage', 'loginItemOff'])
  assert.ok(r.freed >= 4 + 2 + 1 + 17 + 5 + 3)
  t.db.close()
})

test('Clear All Data: with "delete downloads", a root whose real location is protected is refused before anything is deleted', async () => {
  const t = clearRig()
  const link = path.join(temp, `junction${++n}`)
  fs.symlinkSync(t.home, link, 'junction') // the saved root was turned into a junction into app data after it was saved
  t.deps.root = link
  await assert.rejects(clearAll(t.deps, true), { status: 400, message: /system or app data/ })
  assert.deepEqual(t.calls, [])
  assert.ok(fs.existsSync(path.join(t.paths.tdlib, 'db', 'td.binlog')) && fs.existsSync(t.paths.db))
  t.db.close()
})
