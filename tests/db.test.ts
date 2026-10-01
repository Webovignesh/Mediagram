import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { checkSettings, type DB, downloadStates, getSettings, openDb, putSetting, readSetting, setSettings } from '../core/db.ts'

const is400For = (key: string) => (e: Error & { status?: number }) => e.status === 400 && e.message.startsWith(`${key} `)
const pragma = (db: DB, name: string) => Object.values(db.prepare(`PRAGMA ${name}`).get()!)[0]

test('openDb: creates schema v1 on :memory:', () => {
  const db = openDb(':memory:')
  assert.equal(pragma(db, 'user_version'), 1)
  assert.equal(pragma(db, 'foreign_keys'), 1)
  const names = (type: string) => db.prepare('SELECT name FROM sqlite_master WHERE type = ? AND name NOT LIKE ? ORDER BY name').all(type, 'sqlite_%').map((r) => r.name)
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
    assert.equal(pragma(db, 'user_version'), 1)
    assert.equal(readSetting(db, 'maxDownloads'), 4)
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
    clearCompletedDays: 0, notifyComplete: true, notifyFailed: true, closeToTray: false, apiId: null,
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
  const booleans = ['skipExisting', 'datePrefix', 'uploadAlbum', 'keepNames', 'showArchived', 'autoRetry', 'notifyComplete', 'notifyFailed', 'closeToTray', 'startWithSystem']
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
