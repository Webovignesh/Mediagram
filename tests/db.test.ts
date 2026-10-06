import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import {
  addHistory as insertHistory, bucketStarts, checkSettings, type DB, downloadStates, enqueue, forgetDownload, getSettings, jobCounts, jobRow, jobsAction, jobsList,
  type Kind, mediaExts, mediaQuery, type NewJob, openDb, putMedia, putSetting, readSetting, setSettings, statsActivity, statsChats, statsOverview,
} from '../core/db.ts'

const is400For = (key: string) => (e: Error & { status?: number }) => e.status === 400 && e.message.startsWith(`${key} `)
const pragma = (db: DB, name: string) => Object.values(db.prepare(`PRAGMA ${name}`).get()!)[0]

test('openDb: creates schema v1 then the v2 scans.cursors column on :memory:', () => {
  const db = openDb(':memory:')
  assert.equal(pragma(db, 'user_version'), 2)
  assert.equal(pragma(db, 'foreign_keys'), 1)
  const names = (type: string) => db.prepare(`SELECT name FROM sqlite_master WHERE type = ? AND name NOT LIKE ? ORDER BY name`).all(type, 'sqlite_%').map((r) => r.name)
  assert.deepEqual(names('table'), ['history', 'jobs', 'media', 'scans', 'settings'])
  assert.deepEqual(names('index'), ['history_msg', 'history_path', 'history_time', 'jobs_download_msg', 'jobs_finished', 'jobs_path', 'jobs_queue', 'media_chat_date'])
  assert.throws(() => db.prepare(`INSERT INTO jobs (kind, status, position, chat_id, chat_title, name, type, created_at) VALUES ('torrent', 'queued', 1, 1, 't', 'n', 'video', 0)`).run(), /CHECK/)
  db.close()
})

test('openDb: reopening a file keeps its data and does not re-run the schema', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'teleflow-'))
  try {
    const file = path.join(dir, 'teleflow.db')
    let db = openDb(file)
    assert.equal(pragma(db, 'journal_mode'), 'wal')
    putSetting(db, 'maxDownloads', 4)
    db.close()
    db = openDb(file)
    assert.equal(pragma(db, 'user_version'), 2)
    assert.equal(readSetting(db, 'maxDownloads'), 4)
    db.close()
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})

test('openDb: a v1 file is migrated to v2 by adding scans.cursors, once', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'teleflow-'))
  try {
    const file = path.join(dir, 'teleflow.db')
    let db = openDb(file)
    db.exec('ALTER TABLE scans DROP COLUMN cursors')
    db.exec('PRAGMA user_version = 1')
    db.close()
    db = openDb(file)
    assert.equal(pragma(db, 'user_version'), 2)
    assert.equal(db.prepare(`SELECT name FROM pragma_table_info('scans') WHERE name = 'cursors'`).all().length, 1)
    assert.deepEqual(db.prepare(`SELECT cursors FROM scans`).all(), [])
    db.close()
    db = openDb(file)
    assert.equal(pragma(db, 'user_version'), 2)
    db.close()
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})

test('getSettings: defaults, stored values win; apiHash, window, and startWithSystem never come back', () => {
  const db = openDb(':memory:')
  const s = getSettings(db, 'X:\\Fixture\\Root')
  assert.equal(s.downloadRoot, 'X:\\Fixture\\Root')
  assert.deepEqual({ ...s, downloadRoot: undefined }, {
    downloadRoot: undefined, maxDownloads: 2, skipExisting: true, datePrefix: false, folderTemplate: '{chat}', defaultUploadChat: null,
    uploadAlbum: true, keepNames: true, maxUploads: 1, showArchived: false, autoRetry: true, retryAttempts: 3, stallSeconds: 10,
    clearCompletedDays: 0, notifyComplete: true, notifyFailed: true, closeToTray: false, apiId: null, prebufferVideo: true,
  })
  putSetting(db, 'apiId', 777)
  putSetting(db, 'apiHash', 'c0ffee'.repeat(5) + 'ab')
  putSetting(db, 'window', { x: 1, y: 2, width: 3, height: 4, maximized: false })
  putSetting(db, 'maxUploads', 3)
  const t = getSettings(db, 'X:\\Fixture\\Root')
  assert.equal(t.apiId, 777)
  assert.equal(t.maxUploads, 3)
  for (const key of ['apiHash', 'window', 'startWithSystem']) assert.ok(!(key in t), key)
  putSetting(db, 'maxUploads')
  assert.equal(getSettings(db, 'X:\\Fixture\\Root').maxUploads, 1)
})

test('checkSettings: accepts and rejects each key by its rule, naming the key', () => {
  const booleans = ['skipExisting', 'datePrefix', 'uploadAlbum', 'keepNames', 'showArchived', 'autoRetry', 'notifyComplete', 'notifyFailed', 'closeToTray', 'startWithSystem', 'prebufferVideo']
  const good: Record<string, unknown[]> = {
    maxDownloads: [1, 5], maxUploads: [1, 3], retryAttempts: [1, 10], stallSeconds: [5, 10, 30, 60], clearCompletedDays: [0, 1, 7, 30],
    defaultUploadChat: [null, 42, -1009876543210], downloadRoot: ['X:\\Fixture'],
    ...Object.fromEntries(booleans.map((k) => [k, [true, false]])),
  }
  const bad: Record<string, unknown[]> = {
    maxDownloads: [0, 6, 2.5, '2', null], maxUploads: [0, 4], retryAttempts: [0, 11], stallSeconds: [15, '10'], clearCompletedDays: [2, -1],
    defaultUploadChat: [0, 1.5, '5'], downloadRoot: ['', '   ', 5, 'x'.repeat(1001)],
    ...Object.fromEntries(booleans.map((k) => [k, ['yes', 1, null]])),
  }
  for (const [key, values] of Object.entries(good)) for (const v of values) assert.doesNotThrow(() => checkSettings({ [key]: v }), `${key}=${v}`)
  for (const [key, values] of Object.entries(bad)) for (const v of values) assert.throws(() => checkSettings({ [key]: v }), is400For(key), `${key}=${v}`)
})

test('checkSettings: folderTemplate placeholders, separators, and escapes', () => {
  for (const v of ['', '{chat}', '{chat_id}', 'Telegram/{chat}', 'Telegram\\{chat} ({chat_id})', 'a..b', 'x'.repeat(100)]) {
    assert.doesNotThrow(() => checkSettings({ folderTemplate: v }), v)
  }
  for (const v of ['..', '../x', '{chat}/..', 'a/./b', 'C:\\x', 'c:{chat}', '\\{chat}', '/x', '{name}', '{chat', 'a}', 'a<b', 'a:b', 'a|b',
    'a?b', 'a*b', 'a"b', 'a\x01b', 'a//b', '{chat}/', 'x'.repeat(101), 5]) {
    assert.throws(() => checkSettings({ folderTemplate: v }), is400For('folderTemplate'), String(v))
  }
})

test('setSettings: one bad key writes nothing; unknown and internal keys are 400s naming the key', () => {
  const db = openDb(':memory:')
  assert.throws(() => setSettings(db, { maxDownloads: 3, maxUploads: 9 }), is400For('maxUploads'))
  assert.equal(getSettings(db, 'X:\\r').maxDownloads, 2)
  assert.throws(() => checkSettings({ nope: 1 }), { status: 400, message: 'Unknown setting nope' })
  for (const key of ['apiId', 'apiHash', 'window']) assert.throws(() => checkSettings({ [key]: 1 }), is400For(key))
  for (const v of [null, [], 'x']) assert.throws(() => checkSettings(v), { status: 400 })
  setSettings(db, { maxDownloads: 3, startWithSystem: true })
  assert.equal(getSettings(db, 'X:\\r').maxDownloads, 3)
  assert.equal(readSetting(db, 'startWithSystem'), undefined) // lives in the login item
})

function addJob(db: DB, chat: number, msg: number, status: string, file: string | null = null) {
  db.prepare(`INSERT INTO jobs (kind, status, position, chat_id, chat_title, message_id, name, type, path, created_at)
    VALUES ('download', ?, ?, ?, 'Fixture chat', ?, 'f.mp4', 'video', ?, 0)`).run(status, msg, chat, msg, file)
}
function addHistory(db: DB, chat: number, msg: number, file: string | null, o: { status?: string, kind?: string } = {}) {
  return Number(db.prepare(`INSERT INTO history (kind, status, chat_id, chat_title, message_id, name, type, size, path, finished_at)
    VALUES (?, ?, ?, 'Fixture chat', ?, 'f.mp4', 'video', 10, ?, 0)`).run(o.kind ?? 'download', o.status ?? 'completed', chat, msg, file).lastInsertRowid)
}

test('downloadStates: open job status, downloaded through a job or history path, none once trashed', () => {
  const db = openDb(':memory:')
  addJob(db, 7, 1, 'queued')
  addJob(db, 7, 2, 'completed', 'X:\\r\\two.mp4')
  addHistory(db, 7, 3, 'X:\\r\\three.mp4') // job removed by Clear Completed
  addHistory(db, 7, 4, null) // trashed
  addJob(db, 7, 5, 'failed')
  addHistory(db, 8, 6, 'X:\\r\\other-chat.mp4')
  const s = downloadStates(db, 7, [1, 2, 3, 4, 5, 6])
  assert.deepEqual([...s.values()].map((x) => x.status), ['queued', 'downloaded', 'downloaded', 'none', 'failed', 'none'])
  assert.equal(s.get(2)!.path, 'X:\\r\\two.mp4')
  assert.equal(s.get(3)!.path, 'X:\\r\\three.mp4')
  assert.equal(typeof s.get(1)!.jobId, 'number')
  assert.equal(s.get(6)!.jobId, null)
})

// ---- Queue (3.1) ----

const dl = (msg: number, o: Partial<NewJob> = {}): NewJob => ({ kind: 'download', chatId: 7, chatTitle: 'Fixture chat', messageId: msg, name: `f${msg}.mp4`, type: 'video', size: 10, ...o })
const up = (name: string): NewJob => ({ kind: 'upload', chatId: 7, chatTitle: 'Fixture chat', messageId: null, name, type: 'document', size: 1, files: [] })
const set = (db: DB, id: number, sql: string) => db.prepare(`UPDATE jobs SET ${sql} WHERE id = ?`).run(id)

test('enqueue: dedupe, failed rows requeued in their place, force only for completed, open rows untouched, positions increase', () => {
  const db = openDb(':memory:')
  const [a, b, c] = enqueue(db, [dl(1), dl(2), dl(3), dl(1)]) // a duplicate inside the batch is skipped
  assert.equal(enqueue(db, []).length, 0)
  assert.deepEqual([a, b, c].map((id) => jobRow(db, id)!.position), [1, 2, 3])
  set(db, a, `status = 'failed', attempts = 3, error = 'x', retry_at = 9, finished_at = 9`)
  set(db, b, `status = 'completed', path = 'X:\\f2.mp4', finished_at = 9`)
  set(db, c, `status = 'active'`)
  const again = enqueue(db, [dl(1), dl(2), dl(3), dl(4)])
  assert.deepEqual(again.slice(0, 1), [a])
  const ra = jobRow(db, a)!
  assert.deepEqual([ra.status, ra.attempts, ra.error, ra.retry_at, ra.finished_at, ra.position], ['queued', 0, null, null, null, 1]) // keeps its place
  assert.deepEqual([jobRow(db, b)!.status, jobRow(db, c)!.status], ['completed', 'active'])
  assert.ok(jobRow(db, again[1])!.position > 3)
  assert.deepEqual(enqueue(db, [dl(2), dl(3)], true), [b]) // force requeues completed only; the active row is untouched
  assert.deepEqual([jobRow(db, b)!.status, jobRow(db, b)!.path, jobRow(db, c)!.status], ['queued', null, 'active'])
  assert.equal(enqueue(db, [up('x.pdf'), up('x.pdf')]).length, 2) // uploads never conflict
  assert.equal(enqueue(db, Array.from({ length: 1201 }, (_, i) => dl(100 + i))).length, 1201) // 3 transactions of up to 500
})

test('jobsAction: 1000 ids in one JSON parameter; scopes without ids; retry resets; cancel and clear-completed delete', () => {
  const db = openDb(':memory:')
  const ids = enqueue(db, Array.from({ length: 1200 }, (_, i) => dl(i + 1)))
  assert.equal(jobsAction(db, 'pause', ids.slice(0, 1000)).length, 1000)
  assert.deepEqual([jobCounts(db).download.paused, jobCounts(db).download.queued], [1000, 200])
  set(db, ids[1000], `status = 'active'`)
  assert.equal(jobsAction(db, 'pause').length, 200) // queued and active
  assert.equal(jobsAction(db, 'resume').length, 1200)
  for (const id of ids.slice(0, 3)) set(db, id, `status = 'failed', attempts = 2, error = 'x', retry_at = 5, finished_at = 5`)
  assert.equal(jobsAction(db, 'retry', [ids[0], ids[1], ids[5]]).length, 2) // only failed rows
  const r = jobRow(db, ids[0])!
  assert.deepEqual([r.status, r.attempts, r.error, r.retry_at, r.finished_at], ['queued', 0, null, null, null])
  for (const id of ids.slice(10, 12)) set(db, id, `status = 'completed', finished_at = 5`)
  assert.equal(jobsAction(db, 'clear-completed', [ids[0]]).length, 2) // ignores ids
  assert.deepEqual(jobsAction(db, 'cancel', [ids[20]]).map((x) => x.status), ['queued']) // deleted rows come back as they were
  assert.equal(jobsAction(db, 'cancel').length, 1200 - 3)
})

test('jobsAction up/down: swaps with the nearest open job of the same kind', () => {
  const db = openDb(':memory:')
  const [d1, , d2, d3] = enqueue(db, [dl(1), up('u.pdf'), dl(2), dl(3)])
  set(db, d2, `status = 'completed', finished_at = 1`)
  const pos = () => [d1, d3].map((id) => jobRow(db, id)!.position)
  assert.deepEqual(jobsAction(db, 'down', [d1]).map((x) => x.id), [d1, d3]) // past the upload and the completed job
  assert.deepEqual(pos(), [4, 1])
  assert.deepEqual(jobsAction(db, 'up', [d3]), []) // already first among open downloads
  assert.deepEqual(jobsAction(db, 'up', [d2]), []) // not open
  assert.equal(jobsAction(db, 'up', [d1]).length, 2)
  assert.deepEqual(pos(), [1, 4])
})

test('jobsList: open rows by position, then finished rows newest first; kind, status, and escaped q filters; paging', () => {
  const db = openDb(':memory:')
  const [d1, d2, d3, d4, u1] = enqueue(db, [dl(1), dl(2), dl(3), dl(4), up('100%_done.pdf')])
  set(db, d2, `status = 'completed', finished_at = 100`)
  set(db, d3, `status = 'active'`)
  set(db, d4, `status = 'failed', finished_at = 200`)
  set(db, u1, `status = 'paused'`)
  const chat = (id: number) => (id === 7 ? { username: 'fixture_chat', photo: 'fixture-photo-id' } : null)
  const ids = (a: Partial<Parameters<typeof jobsList>[1]>) => jobsList(db, { q: '', page: 1, pageSize: 25, ...a }, chat).items.map((j) => j.id)
  assert.deepEqual(ids({}), [d1, d3, u1, d4, d2])
  assert.deepEqual(ids({ status: 'open' }), [d1, d3, u1])
  assert.deepEqual(ids({ status: 'completed' }), [d2])
  assert.deepEqual(ids({ kind: 'upload' }), [u1])
  assert.deepEqual(ids({ q: '100%' }), [u1]) // % is literal
  assert.deepEqual(ids({ q: 'f_' }), []) // _ is literal too
  const p2 = jobsList(db, { q: '', page: 2, pageSize: 2 }, chat)
  assert.deepEqual([p2.items.map((j) => j.id), p2.total], [[u1, d4], 5])
  assert.deepEqual([p2.items[0].chatUsername, p2.items[0].chatPhoto, p2.items[0].kind], ['fixture_chat', 'fixture-photo-id', 'upload'])
})

// ---- Media index (3.1) ----

test('mediaQuery: type buckets, duration needs > 0, size buckets, status, escaped q, sorts, paging; exts over the whole chat', () => {
  const db = openDb(':memory:')
  const MB = 2 ** 20
  const m = (messageId: number, type: string, duration: number, size: number, name: string, caption = '') =>
    ({ chatId: 7, messageId, date: messageId * 10, type: type as 'video', name, ext: name.split('.').pop()!, size, duration, caption, thumb: null })
  putMedia(db, [
    m(1, 'video', 30, 5 * MB, 'a clip.mp4'), m(2, 'video_note', 700, 50 * MB, 'b.mp4'), m(3, 'photo', 0, MB, 'c.jpg'),
    m(4, 'audio', 2000, 200 * MB, 'song_1.mp3'), m(5, 'voice', 10, 2048 * MB, 'e.ogg'), m(6, 'document', 0, 3 * MB, 'report%.pdf', 'Quarterly numbers'),
    { ...m(9, 'video', 1, 1, 'other.mkv'), chatId: 8 },
  ])
  putMedia(db, [m(1, 'video', 30, 5 * MB, 'a clip.mp4')]) // overlapping pages are harmless
  addJob(db, 7, 2, 'queued')
  addHistory(db, 7, 3, 'X:\\r\\c.jpg')
  addHistory(db, 7, 4, 'X:\\r\\song_1.mp3')
  forgetDownload(db, 'X:\\r\\song_1.mp3') // trashed → none
  const ids = (f: Parameters<typeof mediaQuery>[2], page?: { page: number, pageSize: number }) => mediaQuery(db, 7, f, page).items.map((x) => x.messageId)
  assert.deepEqual(ids({}), [6, 5, 4, 3, 2, 1])
  assert.deepEqual([ids({ type: 'video' }), ids({ type: 'audio' }), ids({ type: 'photo' })], [[2, 1], [5, 4], [3]])
  assert.deepEqual([ids({ duration: 'short' }), ids({ duration: 'medium' }), ids({ duration: 'long' }), ids({ duration: 'xlong' })], [[5, 1], [], [2], [4]])
  assert.deepEqual([ids({ size: 'small' }), ids({ size: 'medium' }), ids({ size: 'large' }), ids({ size: 'xlarge' })], [[6, 3, 1], [2], [4], [5]])
  assert.deepEqual(ids({ size: `custom:${4 * MB}:${60 * MB}` }), [2, 1])
  assert.deepEqual(ids({ duration: 'custom:20:800' }), [2, 1])
  assert.deepEqual([ids({ ext: 'pdf' }), ids({ q: '%' }), ids({ q: 'quarter' }), ids({ q: 'g_1' })], [[6], [6], [6], [4]])
  assert.deepEqual([ids({ status: 'downloaded' }), ids({ status: 'queued' }), ids({ status: 'none' })], [[3], [2], [6, 5, 4, 1]])
  const items = mediaQuery(db, 7, {}).items
  assert.deepEqual([items.find((x) => x.messageId === 3)!.path, items.find((x) => x.messageId === 4)!.status], ['X:\\r\\c.jpg', 'none'])
  assert.deepEqual([ids({ sort: 'largest' }), ids({ sort: 'smallest' }), ids({ sort: 'oldest' })], [[5, 4, 2, 1, 6, 3], [3, 6, 1, 2, 4, 5], [1, 2, 3, 4, 5, 6]])
  assert.deepEqual([ids({ sort: 'name' }), ids({ sort: 'longest' })], [[1, 2, 3, 5, 6, 4], [4, 2, 1, 5, 6, 3]])
  assert.deepEqual([ids({}, { page: 2, pageSize: 4 }), mediaQuery(db, 7, { type: 'video' }, { page: 1, pageSize: 1 }).total], [[2, 1], 2])
  assert.deepEqual(mediaExts(db, 7), ['jpg', 'mp3', 'mp4', 'ogg', 'pdf'])
})

// ---- Stats (3.1) ----

test('stats: Completed Today from local midnight, hour and day buckets, top chats with ties, recent 6', () => {
  const db = openDb(':memory:')
  const now = new Date(2026, 9, 1, 14, 30).getTime() // local time
  const at = (d: number, h: number, min: number) => new Date(2026, 9, d, h, min).getTime()
  const add = (kind: Kind, status: 'completed' | 'failed', chatId: number, finishedAt: number) =>
    insertHistory(db, { kind, status, chatId, chatTitle: `Fixture chat ${chatId}`, messageId: null, name: 'f', type: 'video', size: 1, path: null, error: null, finishedAt })
  add('download', 'completed', 1, at(1, 14, 20))
  add('download', 'completed', 1, at(1, 0, 5))
  add('upload', 'completed', 2, at(1, 13, 10))
  add('download', 'completed', 2, at(0, 23, 50)) // yesterday (Sept 30)
  add('download', 'failed', 3, at(1, 14, 25)) // not counted
  add('download', 'completed', 4, at(-2, 12, 0)) // 3 days ago
  const o = statsOverview(db, 'X:\\no-thumbs', now)
  assert.deepEqual([o.completedToday, o.totalFiles], [{ download: 2, upload: 1 }, { download: 4, upload: 1 }])
  assert.deepEqual(o.recent.map((h) => [h.chatId, h.status]), [[3, 'failed'], [1, 'completed'], [2, 'completed'], [1, 'completed'], [2, 'completed'], [4, 'completed']])
  const h = statsActivity(db, '24h', now)
  assert.deepEqual([h.buckets.length, h.buckets[23], h.buckets[0]], [24, at(1, 14, 0), at(0, 15, 0)])
  assert.deepEqual([h.download[23], h.upload[22], h.download[9], h.download[8], h.download.reduce((a, b) => a + b)], [1, 1, 1, 1, 3])
  const w = statsActivity(db, '7d', now)
  assert.deepEqual([w.buckets[6], w.download, w.upload], [at(1, 0, 0), [0, 0, 0, 1, 0, 1, 2], [0, 0, 0, 0, 0, 0, 1]])
  assert.deepEqual([bucketStarts('30d', now).length, bucketStarts('30d', now)[29]], [30, at(1, 0, 0)])
  const chats = statsChats(db, '7d', (id) => (id === 1 ? { title: 'Live title', photo: 'fixture-photo-id' } : null), now)
  assert.deepEqual(chats.items, [ // chats 1 and 2 tie on count; 1 finished later
    { chatId: 1, title: 'Live title', photo: 'fixture-photo-id', count: 2 }, { chatId: 2, title: 'Fixture chat 2', photo: null, count: 2 },
    { chatId: 4, title: 'Fixture chat 4', photo: null, count: 1 }])
})
