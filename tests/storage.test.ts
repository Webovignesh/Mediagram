import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, test } from 'node:test'
import { pathToFileURL } from 'node:url'
import { type DB, downloadStates, openDb } from '../core/db.ts'
import {
  checkDownloadRoot, dirSize, libraryFile, libraryMissing, libType, log, openLog, pageKey, realLocation, resolvePaths, scanLibrary, storageReport, trash,
} from '../core/storage.ts'

const env = { LOCALAPPDATA: 'C:\\Users\\u\\AppData\\Local' }
const repo = 'C:\\src\\teleflow'
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'teleflow-'))
after(() => fs.rmSync(temp, { recursive: true, force: true }))
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
