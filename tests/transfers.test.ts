import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, mock, test } from 'node:test'
import { setImmediate as tick } from 'node:timers/promises'
import { type AppEvent, type DB, downloadStates, enqueue, fail, getSettings, jobRow, type Kind, openDb, putSetting, type UploadFile } from '../core/db.ts'
import { type AuthState, type Chat, extractMedia } from '../core/shapes.ts'
import { openLog, resolvePaths, within } from '../core/storage.ts'
import { createEngine, type EngineDeps, fileName, fitName, folderFor, gate, isRetryable, MAX_PATH, newGate, retryDelay, sanitize, stallDecision, uniquePath } from '../core/transfers.ts'
import { groupUploads, settleUpload, uploadKind } from '../core/uploads.ts'

// Timers and the clock are mocked: the engine's 500 ms tick, start spacing, flood waits, and retries run only when a
// test ticks them. Promises and file I/O are real, so `settle()` lets them finish.
const NOW = Date.UTC(2026, 9, 1, 9, 30)
mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: NOW })
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'teleflow-'))
after(() => { mock.timers.reset(); fs.rmSync(temp, { recursive: true, force: true }) })
openLog(path.join(temp, 'logs'))

// performance.now() is not mocked, so these wait on real time for real file I/O.
async function until(ok: () => boolean) {
  for (const end = performance.now() + 5000; !ok() && performance.now() < end;) await tick()
  assert.ok(ok(), 'the condition never became true')
}
const settle = async () => { for (const end = performance.now() + 10; performance.now() < end;) await tick() }
const advance = async (ms: number) => { for (let t = 0; t < ms; t += 500) { mock.timers.tick(Math.min(500, ms - t)); await settle() } }

// ---- TDLib fakes (made-up values) ----

type Req = Record<string, any> & { _: string }
const tdFile = (id: number, o: { size?: number, path?: string, done?: boolean, downloaded?: number } = {}) => ({
  _: 'file', id, size: o.size ?? 5, expected_size: o.size ?? 5,
  local: { _: 'localFile', path: o.path ?? '', can_be_downloaded: true, can_be_deleted: true, is_downloading_active: !o.done,
    is_downloading_completed: !!o.done, download_offset: 0, downloaded_prefix_size: 0, downloaded_size: o.downloaded ?? (o.done ? o.size ?? 5 : 0) },
  remote: { _: 'remoteFile', id: `remote-${id}`, unique_id: `u${id}`, is_uploading_active: false, is_uploading_completed: true, uploaded_size: 0 },
})
const docMessage = (chatId: number, id: number, file: object, name = '', extra: object = {}) => ({
  _: 'message', id, chat_id: chatId, date: NOW / 1000,
  content: { _: 'messageDocument', document: { file_name: name, mime_type: 'application/pdf', document: file }, caption: { text: '' } }, ...extra,
})
const never = () => new Promise(() => {})
const CHAT = -100

const engines: { quit(): Promise<void> }[] = []
function rig(o: { settings?: Record<string, unknown>, ready?: boolean, prepare?: (db: DB) => void, savedFile?: EngineDeps['savedFile'] } = {}) {
  for (const e of engines.splice(0)) void e.quit() // the previous test's engine stops ticking
  const home = fs.mkdtempSync(path.join(temp, 'home-')), root = path.join(home, '..', `${path.basename(home)}-root`)
  const paths = resolvePaths({ env: { TELEFLOW_HOME: home }, packaged: true, appDir: path.join(temp, 'app') })
  const cache = path.join(paths.tdlib, 'files')
  fs.mkdirSync(cache, { recursive: true })
  const db = openDb(':memory:')
  for (const [k, v] of Object.entries(o.settings ?? {})) putSetting(db, k, v)
  o.prepare?.(db)
  const me = { id: 1, name: 'Fixture', firstName: 'Fixture', username: null, phone: '', photo: null, premium: false, captionMax: 1024, uploadMax: 2 ** 31 }
  const auth = { value: (o.ready === false ? { step: 'starting', connection: 'connecting' } : { step: 'ready', connection: 'ready', me }) as AuthState }
  const requests: Req[] = []
  const handlers = new Set<(u: any) => void>()
  const events: AppEvent[] = [], finished: [Kind, boolean][] = []
  const t = {
    db, root, cache, paths, requests, events, finished, auth, me,
    answer: ((req: Req): unknown => { throw fail(404, `No fake for ${req._}`) }),
    update: (u: object) => { for (const h of handlers) h(u) },
    calls: (name: string) => requests.filter((r) => r._ === name),
    status: (id: number) => jobRow(db, id)?.status,
    setReady(on: boolean) { auth.value = on ? { step: 'ready', connection: 'ready', me } : { step: 'starting', connection: 'connecting' }; engine.onAuth(auth.value) },
  }
  const chat = (id: number): Chat => ({ id, title: `Fixture chat ${id}`, kind: 'channel', username: null, photo: null, unread: 0, lastDate: 0, canPost: true, folders: [] })
  const engine = createEngine({
    db, paths, settings: () => getSettings(db, root), auth: () => auth.value, chat,
    invoke: (async (req: Req) => { requests.push(req); return t.answer(req) }) as never,
    onUpdate: (fn) => { handlers.add(fn); return () => { handlers.delete(fn) } },
    emit: (e) => { events.push(e) }, finished: (k, ok) => { finished.push([k, ok]) }, savedFile: o.savedFile,
  })
  engines.push(engine)
  if (o.ready !== false) engine.onAuth(auth.value)
  return Object.assign(t, { engine, chat }) // the same object, so a test can swap `answer`
}
const row = (messageId: number, name = 'Report.pdf', size = 5) =>
  ({ chatId: CHAT, messageId, date: NOW / 1000, type: 'document' as const, name, ext: 'pdf', size, duration: 0, caption: '', thumb: null })
const jobIds = (db: DB) => (db.prepare('SELECT id FROM jobs ORDER BY position').all() as { id: number }[]).map((r) => r.id)

// ---- Pure helpers ----

test('fileName and sanitize: untitled defaults, date prefix, reserved names, dots, invalid characters, 180-character cap', () => {
  const video = extractMedia({ id: 42 * 2 ** 20, date: 0, content: { _: 'messageVideo', video: { file_name: '', duration: 3, video: tdFile(1) }, caption: { text: '' } } } as never)!
  assert.equal(fileName(video.name, 0, false), 'Video_42.mp4')
  const date = Date.UTC(2026, 0, 5, 12) / 1000, d = new Date(date * 1000)
  const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  assert.equal(fileName('Clip.mp4', date, true), `${day}_Clip.mp4`)
  const cases: Record<string, string> = {
    CON: '_CON', 'con.txt': '_con.txt', 'LPT1.log': '_LPT1.log', 'console.txt': 'console.txt', 'a<b>c:d"e|f?g*h.txt': 'a_b_c_d_e_f_g_h.txt',
    'x/y\\z.bin': 'x_y_z.bin', 'trailing. . ': 'trailing', '...hidden.mp4': 'hidden.mp4', '': '_', '..': '_', 'tab\there': 'tab_here',
    // bidi controls are stripped: an RTL override must not make a name read as a different extension
    'in\u202Evf.mp4': 'in_vf.mp4', 'a\u200e\u061cb.mp4': 'a__b.mp4', '\u2066x\u2069.mp4': '_x_.mp4',
  }
  for (const [input, out] of Object.entries(cases)) assert.equal(sanitize(input), out, JSON.stringify(input))
  const long = sanitize(`${'x'.repeat(300)}.mkv`)
  assert.deepEqual([long.length, long.endsWith('.mkv')], [180, true])
  const emoji = sanitize(`${'😀'.repeat(200)}.mp4`)
  assert.equal([...emoji].length, 180)
  assert.ok(emoji.endsWith('.mp4') && !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(emoji), 'no split surrogate pair')
})

test('folderFor: placeholders are sanitized, so the target folder never leaves the download root', () => {
  const root = 'D:\\Media'
  const at = (template: string, title: string) => path.join(root, folderFor(template, { id: -1001, title }))
  assert.equal(at('{chat}', 'Fixture Chat'), 'D:\\Media\\Fixture Chat')
  assert.equal(at('TG/{chat} ({chat_id})', 'A'), 'D:\\Media\\TG\\A (-1001)')
  assert.equal(at('', 'A'), root)
  assert.equal(at('{chat}', '$& $1'), 'D:\\Media\\$& $1') // replacement patterns in titles stay literal
  for (const title of ['..', '..\\..\\Windows', '../../x', 'C:\\Windows', '.', ' .. ', '\\\\server\\share']) {
    const p = at('{chat}', title)
    assert.ok(within(root, p) && path.dirname(p) === root, `${title} → ${p}`)
  }
})

test('fitName: a name that would make the file uncreatable is cut, the folder never is', () => {
  const dir = 'D:\\Media\\Fixture channel'
  assert.equal(fitName(dir, 'a.mp4', new Set()), path.join(dir, 'a.mp4'))
  const fitted = fitName(dir, `${'n'.repeat(180)}.mkv`, new Set([path.join(dir, 'first.mkv').toLowerCase()]))!
  assert.ok(fitted.length <= MAX_PATH, `length ${fitted.length}`)
  assert.ok(fitted.endsWith('.mkv') && fitted.startsWith(`${path.join(dir, 'n')}`), fitted)
  assert.equal(fitName(dir, 'a.mp4', new Set([path.join(dir, 'a.mp4').toLowerCase()])), path.join(dir, 'a (2).mp4'))
  assert.equal(fitName(`D:\\${'p'.repeat(250)}`, 'a.mp4', new Set()), null) // the folder alone is past the ceiling
})

test('uniquePath: existing files and reserved names get (2), (3)…, case-insensitively', () => {
  const dir = fs.mkdtempSync(path.join(temp, 'u-'))
  fs.writeFileSync(path.join(dir, 'a.mp4'), 'x')
  assert.equal(uniquePath(dir, 'a.mp4', new Set([path.join(dir, 'A (2).MP4').toLowerCase()])), path.join(dir, 'a (3).mp4'))
  assert.equal(uniquePath(dir, 'A.MP4', new Set()), path.join(dir, 'A (2).MP4'))
  assert.equal(uniquePath(dir, 'b', new Set()), path.join(dir, 'b'))
})

test('gate: spacing, doubling per flood up to 5 s, easing by 100 ms per start, and the flood wait', () => {
  let g = newGate(600)
  assert.ok(gate.open(g, 0))
  g = gate.started(g, 0)
  assert.deepEqual([gate.open(g, 599), gate.open(g, 600)], [false, true])
  g = gate.flooded(g, 1000, 30)
  assert.deepEqual([g.spacing, g.waitUntil, gate.open(g, 30_999), gate.open(g, 31_000)], [1200, 31_000, false, true])
  g = gate.started(g, 31_000)
  assert.deepEqual([g.nextAt, g.spacing], [32_200, 1100])
  for (let i = 0; i < 5; i++) g = gate.flooded(g, 0, 1)
  assert.equal(g.spacing, 5000)
  for (let i = 0; i < 60; i++) g = gate.started(g, 0)
  assert.equal(g.spacing, 600)
})

test('stallDecision: offline skip, wait, two re-asserts, the third stall requeues, and fails once attempts are spent', () => {
  const s = { online: true, idleMs: 10_000, stallMs: 10_000, stalls: 0, attempts: 1, maxAttempts: 3 }
  assert.equal(stallDecision({ ...s, online: false }), 'skip')
  assert.equal(stallDecision({ ...s, idleMs: 9_999 }), 'wait')
  assert.equal(stallDecision(s), 'reassert')
  assert.equal(stallDecision({ ...s, stalls: 1 }), 'reassert')
  assert.equal(stallDecision({ ...s, stalls: 2 }), 'requeue')
  assert.equal(stallDecision({ ...s, stalls: 2, attempts: 3 }), 'fail')
})

test('isRetryable and retryDelay', () => {
  for (const e of [fail(500, 'x'), fail(503, 'x'), fail(408, 'x'), new Error('socket hang up'), fail(400, 'FILE_REFERENCE_EXPIRED')]) assert.ok(isRetryable(e), e.message)
  for (const e of [fail(404, 'gone'), fail(403, "You can't post in this chat."), fail(413, 'big'), fail(400, 'MESSAGE_ID_INVALID'),
    Object.assign(new Error('full'), { code: 'ENOSPC' }), fail(500, 'Download keeps stalling', { final: true })]) assert.ok(!isRetryable(e), e.message)
  assert.deepEqual([1, 2, 3, 6, 10].map(retryDelay), [30_000, 60_000, 120_000, 600_000, 600_000])
})

test('uploads: kind detection, album grouping with permissions, and settleUpload', () => {
  const all = { photos: true, videos: true }
  assert.deepEqual(['a.JPG', 'b.webp', 'c.mov', 'd.flac', 'e.pdf', 'f'].map((n) => uploadKind(n, 100, all)), ['photo', 'photo', 'video', 'audio', 'document', 'document'])
  assert.equal(uploadKind('big.png', 10 * 2 ** 20 + 1, all), 'document')
  assert.deepEqual([uploadKind('a.jpg', 1, { photos: false, videos: true }), uploadKind('a.mp4', 1, { photos: true, videos: false })], ['document', 'document'])
  const f = (name: string) => ({ path: `C:\\in\\${name}`, name, size: 1 })
  const names = (groups: UploadFile[][]) => groups.map((g) => g.map((x) => x.name).join(','))
  const files = [...Array.from({ length: 12 }, (_, i) => f(`p${i}.jpg`)), f('v.mp4'), f('s.mp3'), f('t.mp3'), f('d.pdf')]
  const albums = groupUploads(files, { album: true, ...all })
  assert.deepEqual(albums.map((g) => g.length), [10, 3, 2, 1]) // photo/video runs share albums of up to 10
  assert.equal(names(albums)[1], 'p10.jpg,p11.jpg,v.mp4')
  assert.equal(groupUploads(files, { album: false, ...all }).length, 16)
  const noVideo = groupUploads([f('a.jpg'), f('b.mp4'), f('c.pdf')], { album: true, photos: true, videos: false })
  assert.deepEqual(noVideo.map((g) => g.map((x) => x.type)), [['photo'], ['document', 'document']]) // the video goes as a document

  const job = { caption: 'Fixture caption', files: [{ ...f('a.jpg'), type: 'photo' as const, messageId: 11 }, { ...f('b.jpg'), type: 'photo' as const },
    { ...f('c.jpg'), type: 'photo' as const, messageId: 13 }] }
  const s = settleUpload(job)
  assert.deepEqual([s.sent.length, s.files.map((x) => x.name), s.name, s.type, s.size, s.caption], [2, ['b.jpg'], 'b.jpg', 'photo', 1, null])
  assert.equal(settleUpload({ ...job, files: job.files.map((x, i) => (i === 0 ? { ...x, messageId: undefined } : x)) }).caption, 'Fixture caption')
})

// ---- Scheduler ----

test('scheduler: maxDownloads 2 starts the first two by position, a third waits, up/down changes the next start, uploads have their own limit', async () => {
  const t = rig({ ready: false })
  t.answer = never // every job stays in flight
  for (const name of ['u1.pdf', 'u2.pdf']) fs.writeFileSync(path.join(temp, name), 'x')
  const added = t.engine.addDownloads(CHAT, [row(1), row(2), row(3), row(4)])
  t.engine.addUploads(t.chat(CHAT), ['u1.pdf', 'u2.pdf'].map((n) => ({ path: path.join(temp, n), name: n, size: 1 })),
    { caption: '', album: false, keepNames: true, photos: true, videos: true })
  assert.deepEqual([added, t.requests.length], [{ added: 4, skipped: 0 }, 0]) // nothing starts before Telegram is ready
  const [a, b, c, d, u1, u2] = jobIds(t.db)
  t.setReady(true)
  await settle()
  assert.deepEqual([a, b, c, d, u1, u2].map(t.status), ['active', 'queued', 'queued', 'queued', 'active', 'queued']) // b waits for the spacing
  await advance(600)
  assert.deepEqual([a, b, c, d].map(t.status), ['active', 'active', 'queued', 'queued'])
  assert.deepEqual(t.engine.action('up', [d]), { changed: 2 }) // d now starts before c
  t.engine.action('cancel', [a])
  await advance(600)
  assert.deepEqual([b, c, d, u1, u2].map(t.status), ['active', 'queued', 'active', 'active', 'queued'])
  assert.deepEqual(t.calls('getMessage').map((r) => r.message_id), [1, 2, 4])
  assert.equal(t.calls('sendMessage').length, 1)
})

test('flood wait: that kind holds until the wait ends without spending an attempt; the other kind keeps going', async () => {
  const t = rig()
  let floods = 1
  t.answer = (req) => {
    if (req._ === 'getMessage' && floods-- > 0) throw fail(429, 'Telegram asks to wait 30 s before trying again.', { retryAfter: 30 })
    return never()
  }
  const t0 = Date.now()
  t.engine.addDownloads(CHAT, [row(1)])
  const [job] = jobIds(t.db)
  await until(() => t.status(job) === 'queued')
  assert.equal(jobRow(t.db, job)!.attempts, 0)
  const wait = t.engine.liveStats().waitUntil
  assert.deepEqual([wait.download, wait.upload], [t0 + 30_000, null])
  fs.writeFileSync(path.join(temp, 'flood.pdf'), 'x')
  t.engine.addUploads(t.chat(CHAT), [{ path: path.join(temp, 'flood.pdf'), name: 'flood.pdf', size: 1 }], { caption: '', album: true, keepNames: true, photos: true, videos: true })
  await until(() => t.calls('sendMessage').length === 1) // uploads are not held
  await advance(29_500)
  assert.deepEqual([t.calls('getMessage').length, t.status(job)], [1, 'queued'])
  await advance(500)
  assert.deepEqual([t.calls('getMessage').length, t.status(job), jobRow(t.db, job)!.attempts], [2, 'active', 1])
})

// ---- Downloads ----

/** A fake Telegram with one document per message id; the TDLib copy is a real file in tdlib\files. */
function telegramWith(t: ReturnType<typeof rig>, files: Record<number, { fileId: number, name: string, body: string }>) {
  const local = (fileId: number) => path.join(t.cache, `f${fileId}`)
  for (const f of Object.values(files)) fs.writeFileSync(local(f.fileId), f.body)
  const thumb = path.join(t.cache, 'thumb.jpg')
  fs.writeFileSync(thumb, 'jpeg')
  t.answer = (req) => {
    const byFile = Object.values(files).find((f) => req.remote_file_id === `remote-${f.fileId}` || req.file_id === f.fileId)
    switch (req._) {
      case 'getMessage': case 'getMessages': {
        const ids: number[] = req.message_ids ?? [req.message_id]
        const msgs = ids.map((id) => files[id] && docMessage(req.chat_id, id, tdFile(files[id].fileId, { size: files[id].body.length }), files[id].name))
        return req._ === 'getMessage' ? msgs[0] ?? (() => { throw fail(404, 'Not Found') })() : { _: 'messages', total_count: msgs.length, messages: msgs.map((m) => m ?? null) }
      }
      case 'getRemoteFile':
        if (req.remote_file_id === 'remote-thumb') return { ...tdFile(99, { done: true, path: thumb }) }
        return tdFile(byFile!.fileId, { size: byFile!.body.length })
      case 'downloadFile': return tdFile(req.file_id, { size: byFile?.body.length, downloaded: 1 })
      case 'getFile': return tdFile(req.file_id, { size: byFile?.body.length, downloaded: 1 })
      default: return { _: 'ok' }
    }
  }
  return { local, done: (fileId: number) => t.update({ _: 'updateFile', file: tdFile(fileId, { size: Object.values(files).find((f) => f.fileId === fileId)!.body.length, done: true, path: local(fileId) }) }) }
}

test('download: finalize moves the file out of tdlib\\files under its final name, with history, Mark-of-the-Web, and a thumbnail', async () => {
  const t = rig()
  const tg = telegramWith(t, { [7 * 2 ** 20]: { fileId: 7, name: 'Report.pdf', body: 'hello' } })
  t.engine.addDownloads(CHAT, [{ ...row(7 * 2 ** 20), thumb: 'remote-thumb' }])
  const [job] = jobIds(t.db)
  await until(() => t.calls('downloadFile').length === 1)
  assert.equal(t.engine.liveStats().active[0].done, 1)
  tg.done(7)
  await until(() => t.finished.length === 1) // after the thumbnail and invalidations
  assert.equal(t.status(job), 'completed')
  const dest = path.join(t.root, `Fixture chat ${CHAT}`, 'Report.pdf')
  assert.equal(fs.readFileSync(dest, 'utf8'), 'hello')
  assert.ok(!fs.existsSync(tg.local(7)), 'moved, not copied')
  assert.match(fs.readFileSync(`${dest}:Zone.Identifier`, 'utf8'), /\[ZoneTransfer\]\r\nZoneId=3/)
  const h = t.db.prepare('SELECT * FROM history').get() as Record<string, unknown>
  assert.deepEqual([h.status, h.path, h.size, h.name, jobRow(t.db, job)!.path], ['completed', dest, 5, 'Report.pdf', dest])
  assert.equal(fs.readFileSync(path.join(t.paths.thumbs, `${h.id}.jpg`), 'utf8'), 'jpeg')
  assert.deepEqual(t.calls('deleteFile').map((r) => r.file_id), [7])
  assert.deepEqual(t.finished, [['download', true]])
  assert.ok(t.events.some((e) => e.type === 'invalidate' && e.topics.includes('library') && e.topics.includes(`media:${CHAT}`)))
})

test('download: savedFile publishes only the finalized file after its move and before deleteFile', async () => {
  const order: string[] = []
  const saved: { id: number, path: string, size: number, body: string, sourceExists: boolean }[] = []
  let src = ''
  const t = rig({ savedFile: (id, filePath, size) => {
    order.push('saved')
    saved.push({ id, path: filePath, size, body: fs.readFileSync(filePath, 'utf8'), sourceExists: fs.existsSync(src) })
  } })
  const tg = telegramWith(t, { 52: { fileId: 52, name: 'Saved.pdf', body: 'saved' } })
  src = tg.local(52)
  const answer = t.answer
  t.answer = (req) => {
    // A refreshed download ID must not cause the hook to register its stale predecessor too.
    if (req._ === 'downloadFile') return tdFile(53, { size: 5, downloaded: 1 })
    if (req._ === 'deleteFile') order.push('delete')
    return answer(req)
  }
  t.engine.addDownloads(CHAT, [row(52, 'Saved.pdf')])
  const [job] = jobIds(t.db)
  await until(() => t.calls('downloadFile').length === 1)
  t.update({ _: 'updateFile', file: tdFile(53, { size: 5, done: true, path: src }) })
  await until(() => t.finished.length === 1)
  const dest = path.join(t.root, `Fixture chat ${CHAT}`, 'Saved.pdf')
  assert.deepEqual(saved, [{ id: 53, path: await fs.promises.realpath(dest), size: 5, body: 'saved', sourceExists: false }])
  assert.deepEqual(order, ['saved', 'delete'])
  assert.deepEqual(t.calls('deleteFile').map((r) => r.file_id), [53])
  assert.equal(t.status(job), 'completed')
})

test('download: failed moves never publish savedFile', async (context) => {
  const saved: number[] = []
  const t = rig({ savedFile: (id) => { saved.push(id) } })
  const tg = telegramWith(t, { 54: { fileId: 54, name: 'Missing.pdf', body: 'lost' } })
  t.engine.addDownloads(CHAT, [row(54, 'Missing.pdf', 4)])
  const [job] = jobIds(t.db)
  await until(() => t.calls('downloadFile').length === 1)
  context.mock.method(fs.promises, 'rename', async () => { throw Object.assign(new Error('Move denied'), { code: 'EACCES' }) })
  tg.done(54)
  await until(() => t.status(job) === 'failed')
  assert.deepEqual(saved, [])
  assert.equal(t.calls('deleteFile').length, 0)
})

test('download: priority is 32 and survives getRemoteFile rejection', async () => {
  const t = rig()
  const tg = telegramWith(t, { 8: { fileId: 8, name: 'Doc.pdf', body: 'data' } })
  const origAnswer = t.answer
  t.answer = (req) => {
    if (req._ === 'getRemoteFile') throw fail(400, "Can't find remote file")
    return origAnswer(req)
  }
  t.engine.addDownloads(CHAT, [row(8, 'Doc.pdf')])
  const [job] = jobIds(t.db)
  await until(() => t.calls('downloadFile').length === 1)
  const call = t.calls('downloadFile')[0]
  assert.equal(call.priority, 32)
  assert.equal(call.file_id, 8)
  tg.done(8)
  await until(() => t.status(job) === 'completed')
})

test('download: stale completed path triggers deleteFile and fresh download', async () => {
  const t = rig()
  const tg = telegramWith(t, { 9: { fileId: 9, name: 'Stale.pdf', body: 'fresh' } })
  const origAnswer = t.answer
  t.answer = (req) => {
    if (req._ === 'getRemoteFile') {
      const res = origAnswer(req) as any
      res.local.is_downloading_completed = true
      res.local.path = 'C:\\non\\existent\\stale.pdf'
      return res
    }
    return origAnswer(req)
  }
  t.engine.addDownloads(CHAT, [row(9, 'Stale.pdf')])
  const [job] = jobIds(t.db)
  await until(() => t.calls('deleteFile').length === 1)
  assert.equal(t.calls('deleteFile')[0].file_id, 9)
  await until(() => t.calls('downloadFile').length === 1)
  tg.done(9)
  await until(() => t.status(job) === 'completed')
})

test('skip existing: completes without downloading and stays downloaded after Clear Completed, so a re-add is skipped', async () => {
  const saved: number[] = []
  const t = rig({ savedFile: (id) => { saved.push(id) } })
  telegramWith(t, { 5: { fileId: 5, name: 'Report.pdf', body: 'hello' } })
  fs.mkdirSync(path.join(t.root, `Fixture chat ${CHAT}`), { recursive: true })
  fs.writeFileSync(path.join(t.root, `Fixture chat ${CHAT}`, 'Report.pdf'), 'HELLO') // same name and size
  t.engine.addDownloads(CHAT, [row(5)])
  const [job] = jobIds(t.db)
  await until(() => t.status(job) === 'completed')
  assert.equal(t.calls('downloadFile').length, 0)
  assert.deepEqual(saved, [], 'same size alone is not the successful-move completion hook')
  t.engine.action('clear-completed')
  assert.deepEqual([jobRow(t.db, job), downloadStates(t.db, CHAT, [5]).get(5)!.status], [undefined, 'downloaded'])
  assert.deepEqual(await t.engine.addItems([{ chatId: CHAT, messageId: 5 }], false), { added: 0, skipped: 1 })
  assert.deepEqual(await t.engine.addItems([{ chatId: CHAT, messageId: 5 }], true), { added: 1, skipped: 0 }) // Verify's re-download
})

test('two finalizes of the same name at the same moment pick different names', async () => {
  const t = rig({ settings: { skipExisting: false } })
  const tg = telegramWith(t, { 1: { fileId: 11, name: 'Same.pdf', body: 'one' }, 2: { fileId: 12, name: 'Same.pdf', body: 'two' } })
  t.engine.addDownloads(CHAT, [row(1, 'Same.pdf', 3), row(2, 'Same.pdf', 3)])
  await advance(600)
  await until(() => t.calls('downloadFile').length === 2)
  tg.done(11)
  tg.done(12)
  await until(() => jobIds(t.db).every((id) => t.status(id) === 'completed'))
  const dir = path.join(t.root, `Fixture chat ${CHAT}`)
  assert.deepEqual(fs.readdirSync(dir).sort(), ['Same (2).pdf', 'Same.pdf'])
  assert.deepEqual(['Same.pdf', 'Same (2).pdf'].map((n) => fs.readFileSync(path.join(dir, n), 'utf8')).sort(), ['one', 'two'])
})

test('cancel: a paused download that transferred data has its TDLib copy deleted; a completed one is left alone', async () => {
  const t = rig({ ready: false })
  telegramWith(t, { 21: { fileId: 21, name: 'a.pdf', body: 'a' }, 22: { fileId: 22, name: 'b.pdf', body: 'b' } })
  t.engine.addDownloads(CHAT, [row(21), row(22)])
  const [paused, completed] = jobIds(t.db)
  t.db.prepare(`UPDATE jobs SET status = 'paused', attempts = 1, done = 1 WHERE id = ?`).run(paused)
  t.db.prepare(`UPDATE jobs SET status = 'completed', attempts = 1, done = 1, path = 'X:\\b.pdf' WHERE id = ?`).run(completed)
  t.setReady(true)
  assert.deepEqual(t.engine.action('cancel'), { changed: 2 })
  await until(() => t.calls('deleteFile').length === 1)
  assert.deepEqual(t.calls('getMessages').map((r) => r.message_ids), [[21]])
  assert.deepEqual(t.calls('deleteFile').map((r) => r.file_id), [21])
})

test('stalls: two re-asserts, then a restart in the same position; once attempts are spent it fails; offline never counts', async () => {
  const t = rig({ settings: { stallSeconds: 5, retryAttempts: 2 } })
  telegramWith(t, { 31: { fileId: 31, name: 'slow.pdf', body: 'slow' } })
  t.engine.addDownloads(CHAT, [row(31, 'slow.pdf', 4)])
  const [job] = jobIds(t.db)
  const position = jobRow(t.db, job)!.position
  await until(() => t.calls('downloadFile').length === 1)
  t.auth.value = { ...t.auth.value, connection: 'connecting' }
  await advance(20_000)
  assert.equal(t.calls('getFile').length, 0) // an outage does not burn restarts
  t.auth.value = { ...t.auth.value, connection: 'ready' }
  await advance(5_000)
  await advance(5_000)
  assert.deepEqual([t.calls('getFile').length, t.calls('downloadFile').length, t.calls('cancelDownloadFile').length], [2, 3, 0])
  await advance(5_000) // the third stall in a row restarts it as a new attempt, in its old place
  assert.equal(t.calls('cancelDownloadFile').length, 1)
  await until(() => jobRow(t.db, job)!.attempts === 2 && t.status(job) === 'active')
  assert.equal(jobRow(t.db, job)!.position, position)
  for (let i = 0; i < 3; i++) await advance(5_000)
  const r = jobRow(t.db, job)!
  assert.deepEqual([r.status, r.error, r.retry_at], ['failed', 'Download keeps stalling', null])
  assert.equal((t.db.prepare(`SELECT COUNT(*) AS n FROM history WHERE status = 'failed'`).get() as { n: number }).n, 1)
})

test('auto-retry: a retryable failure is retried after its backoff; the last one and non-retryable ones are final with one history row', async () => {
  const t = rig({ settings: { retryAttempts: 2 } })
  t.answer = (req) => {
    if (req._ === 'getMessage' && req.message_id === 1) throw fail(500, 'Network is unreachable')
    if (req._ === 'getMessage') throw fail(404, 'Not Found')
    return never()
  }
  const t0 = Date.now()
  t.engine.addDownloads(CHAT, [row(1)])
  const [job] = jobIds(t.db)
  await until(() => t.status(job) === 'failed')
  assert.deepEqual([jobRow(t.db, job)!.retry_at, t.finished], [t0 + 30_000, []])
  await advance(30_000)
  await until(() => t.calls('getMessage').length === 2 && t.status(job) === 'failed')
  assert.deepEqual([jobRow(t.db, job)!.retry_at, jobRow(t.db, job)!.error, t.finished], [null, 'Network is unreachable', [['download', false]]])
  t.engine.addDownloads(CHAT, [row(2)])
  await advance(600)
  const gone = jobIds(t.db)[1]
  await until(() => t.status(gone) === 'failed')
  assert.deepEqual([jobRow(t.db, gone)!.error, jobRow(t.db, gone)!.retry_at], ['This message no longer exists', null])
  assert.equal((t.db.prepare(`SELECT COUNT(*) AS n FROM history WHERE status = 'failed'`).get() as { n: number }).n, 2)
})

test('recover (startup): interrupted downloads go back to the queue and keep their positions', () => {
  const t = rig({ ready: false })
  t.engine.addDownloads(CHAT, [row(1), row(2), row(3)])
  const ids = jobIds(t.db)
  t.db.prepare(`UPDATE jobs SET status = 'active' WHERE id IN (?, ?)`).run(ids[0], ids[2])
  const before = ids.map((id) => jobRow(t.db, id)!.position)
  t.engine.recover()
  assert.deepEqual(ids.map(t.status), ['queued', 'queued', 'queued'])
  assert.deepEqual(ids.map((id) => jobRow(t.db, id)!.position), before)
})

// ---- Uploads ----

const sentMessage = (id: number, fileId: number) => docMessage(CHAT, id, tdFile(fileId), '', { sending_state: { _: 'messageSendingStatePending' } })
function uploadFiles(names: string[]) {
  const dir = fs.mkdtempSync(path.join(temp, 'up-'))
  return names.map((name) => { fs.writeFileSync(path.join(dir, name), name); return { path: path.join(dir, name), name, size: name.length } })
}
const historyOf = (db: DB) => db.prepare('SELECT kind, status, name, message_id FROM history ORDER BY id').all().map((r) => ({ ...r }))

test('upload: an album of 3 with 1 failure keeps only the failed file; Retry sends just that file without the caption', async () => {
  const t = rig()
  t.answer = (req) => {
    if (req._ === 'sendMessageAlbum') return { _: 'messages', total_count: 3, messages: [sentMessage(-1, 41), sentMessage(-2, 42), sentMessage(-3, 43)] }
    if (req._ === 'sendMessage') return sentMessage(-4, 44)
    return { _: 'ok' }
  }
  t.engine.addUploads(t.chat(CHAT), uploadFiles(['a.jpg', 'b.jpg', 'c.jpg']), { caption: 'Fixture caption', album: true, keepNames: true, photos: true, videos: true })
  const [job] = jobIds(t.db)
  await until(() => t.calls('sendMessageAlbum').length === 1)
  const contents = t.calls('sendMessageAlbum')[0].input_message_contents
  assert.deepEqual([contents[0]._, contents[0].photo._, contents[0].caption.text, contents[1].caption], ['inputMessagePhoto', 'inputPhoto', 'Fixture caption', undefined])
  await until(() => JSON.parse(jobRow(t.db, job)!.files!).every((f: UploadFile) => f.pendingId))
  t.update({ _: 'updateMessageSendSucceeded', old_message_id: -1, message: { id: 101 } })
  t.update({ _: 'updateMessageSendSucceeded', old_message_id: -2, message: { id: 102 } })
  assert.equal(t.status(job), 'active')
  t.update({ _: 'updateMessageSendFailed', old_message_id: -3, message: { id: 103, chat_id: CHAT }, error: { code: 400, message: 'PHOTO_INVALID_DIMENSIONS' } })
  const r = jobRow(t.db, job)!
  assert.deepEqual([r.status, r.name, r.type, r.caption, r.error, JSON.parse(r.files!).map((f: UploadFile) => f.name)],
    ['failed', 'c.jpg', 'photo', null, 'PHOTO_INVALID_DIMENSIONS', ['c.jpg']])
  assert.deepEqual(historyOf(t.db), [
    { kind: 'upload', status: 'completed', name: 'a.jpg', message_id: 101 }, { kind: 'upload', status: 'completed', name: 'b.jpg', message_id: 102 },
    { kind: 'upload', status: 'failed', name: 'c.jpg', message_id: null }])
  await until(() => t.calls('deleteMessages').length === 1)
  assert.deepEqual(t.calls('deleteMessages')[0].message_ids, [103]) // the failed message's new id
  t.engine.action('retry', [job])
  await advance(1000) // upload start spacing
  await until(() => t.calls('sendMessage').length === 1)
  const single = t.calls('sendMessage')[0].input_message_content
  assert.deepEqual([single._, single.photo.photo.path, single.caption], ['inputMessagePhoto', JSON.parse(r.files!)[0].path, undefined])
})

test('upload: pause settles sent files and deletes the pending ones; keepNames off posts Mediagram_<time>_<n> hard links from tmp', async () => {
  const t = rig()
  t.answer = (req) => (req._ === 'sendMessageAlbum'
    ? { _: 'messages', total_count: 2, messages: [sentMessage(-1, 51), sentMessage(-2, 52)] } : { _: 'ok' })
  t.engine.addUploads(t.chat(CHAT), uploadFiles(['x.pdf', 'y.pdf']), { caption: '', album: true, keepNames: false, photos: true, videos: true })
  const [job] = jobIds(t.db)
  await until(() => JSON.parse(jobRow(t.db, job)!.files!).every((f: UploadFile) => f.pendingId))
  const sentPaths = t.calls('sendMessageAlbum')[0].input_message_contents.map((c: Req) => c.document.document.path)
  assert.deepEqual(sentPaths.map((p: string) => path.relative(t.paths.tmp, p).replace(/\d{8}-\d{6}/, 'T')), [`${job}\\Mediagram_T_1.pdf`, `${job}\\Mediagram_T_2.pdf`])
  assert.equal(fs.readFileSync(sentPaths[0], 'utf8'), 'x.pdf')
  t.update({ _: 'updateMessageSendSucceeded', old_message_id: -1, message: { id: 201 } })
  t.engine.action('pause', [job])
  await until(() => t.calls('deleteMessages').length === 1)
  assert.deepEqual(t.calls('deleteMessages')[0].message_ids, [-2]) // deleting the pending message cancels TDLib's upload
  const r = jobRow(t.db, job)!
  assert.deepEqual([r.status, JSON.parse(r.files!).map((f: UploadFile) => [f.pendingId, f.messageId])], ['paused', [[undefined, undefined]]])
  const h = historyOf(t.db) as { name: string, message_id: number }[]
  assert.deepEqual([h.length, h[0].message_id], [1, 201])
  assert.match(h[0].name, /^Mediagram_\d{8}-\d{6}_1\.pdf$/)
  assert.match(JSON.parse(r.files!)[0].name, /^Mediagram_\d{8}-\d{6}_2\.pdf$/)
  t.update({ _: 'updateMessageSendSucceeded', old_message_id: -2, message: { id: 202 } }) // no longer routed
  assert.equal(t.status(job), 'paused')
})

test('upload: a flood on send requeues without spending an attempt', async () => {
  const t = rig()
  t.answer = (req) => { if (req._ === 'sendMessage') throw fail(429, 'Telegram asks to wait 5 s before trying again.', { retryAfter: 5 }); return { _: 'ok' } }
  const t0 = Date.now()
  t.engine.addUploads(t.chat(CHAT), uploadFiles(['f.pdf']), { caption: '', album: true, keepNames: true, photos: true, videos: true })
  const [job] = jobIds(t.db)
  await until(() => t.calls('sendMessage').length === 1 && t.status(job) === 'queued')
  assert.deepEqual([jobRow(t.db, job)!.attempts, t.engine.liveStats().waitUntil.upload], [0, t0 + 5_000])
})

/** An upload row as a crash left it: active, with the given files. */
function crashed(db: DB, files: Partial<UploadFile>[]) {
  const [id] = enqueue(db, [{ kind: 'upload', chatId: CHAT, chatTitle: 'Fixture chat', messageId: null, name: 'x', type: 'album', size: files.length,
    files: files.map((f, i) => ({ path: `C:\\in\\${i}.pdf`, name: `${i}.pdf`, size: 1, type: 'document', ...f })) }])
  db.prepare(`UPDATE jobs SET status = 'active', attempts = 1 WHERE id = ?`).run(id)
  return id
}

test('upload recovery: routing is rebuilt from pending ids before TDLib starts, so a success after a restart reaches its file', async () => {
  let job = 0
  const t = rig({ ready: false, prepare: (db) => { job = crashed(db, [{ messageId: 301 }, { messageId: 302 }, { pendingId: -9 }]) } })
  t.engine.recover()
  t.update({ _: 'updateMessageSendSucceeded', old_message_id: -9, message: { id: 303 } }) // TDLib resumes before ready
  const r = jobRow(t.db, job)!
  assert.deepEqual([r.status, r.message_id], ['completed', 301])
  assert.deepEqual(historyOf(t.db).map((h) => (h as { message_id: number }).message_id), [301, 302, 303])
})

test('upload recovery on ready: no pending id settles at once; vanished pending ids are "Interrupted"; still-pending ones wait', async () => {
  const ids: Record<string, number> = {}
  const t = rig({ ready: false, prepare: (db) => {
    ids.partial = crashed(db, [{ messageId: 401 }, {}])
    ids.sent = crashed(db, [{ messageId: 411 }, { messageId: 412 }])
    ids.vanished = crashed(db, [{ pendingId: -5 }])
    ids.pending = crashed(db, [{ pendingId: -6 }])
  } })
  t.answer = (req) => {
    if (req._ === 'getMessage' && req.message_id === -6) return sentMessage(-6, 61)
    if (req._ === 'getMessage') throw fail(404, 'Not Found')
    return never()
  }
  t.engine.recover()
  t.setReady(true)
  await until(() => t.status(ids.vanished) === 'failed' && t.status(ids.partial) === 'failed' && t.status(ids.sent) === 'completed')
  const interrupted = 'Interrupted. Check the chat before retrying'
  assert.deepEqual([t.status(ids.partial), jobRow(t.db, ids.partial)!.error, jobRow(t.db, ids.partial)!.retry_at], ['failed', interrupted, null])
  assert.deepEqual(JSON.parse(jobRow(t.db, ids.partial)!.files!).map((f: UploadFile) => f.name), ['1.pdf'])
  assert.deepEqual([t.status(ids.sent), jobRow(t.db, ids.vanished)!.error, t.status(ids.pending)], ['completed', interrupted, 'active'])
})
