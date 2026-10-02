// SQLite schema, settings, and queries (ARCHITECTURE > SQLite schema, > Settings keys). Electron-free.
import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { AuthState } from './shapes.ts'
import type { LiveStats } from './transfers.ts'

export type AppError = Error & { status: number, retryAfter?: number, final?: boolean }

/** The one way to raise a user-facing error; `message` is shown as is (ARCHITECTURE > Bridge). `final` marks a
 *  transfer error that no automatic retry can fix (ARCHITECTURE > Transfer engine > Auto-retry). */
export const fail = (status: number, message: string, extra?: { retryAfter?: number, final?: boolean }): AppError =>
  Object.assign(new Error(message), { status }, extra)

/** Main → renderer events (ARCHITECTURE > Events); main coalesces `invalidate`. */
export type AppEvent = { type: 'auth', auth: AuthState } | { type: 'invalidate', topics: string[] } | { type: 'stats', stats: LiveStats }
export type Emit = (e: AppEvent) => void

export type DB = DatabaseSync
type Row = Record<string, unknown>

// Schema v1, verbatim from ARCHITECTURE > SQLite schema.
const v1 = `
CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
) STRICT;
CREATE TABLE jobs (
  id          INTEGER PRIMARY KEY,
  kind        TEXT    NOT NULL CHECK (kind IN ('download', 'upload')),
  status      TEXT    NOT NULL CHECK (status IN ('queued', 'active', 'paused', 'completed', 'failed')),
  position    INTEGER NOT NULL,
  chat_id     INTEGER NOT NULL,
  chat_title  TEXT    NOT NULL,
  message_id  INTEGER,
  name        TEXT    NOT NULL,
  type        TEXT    NOT NULL,
  size        INTEGER NOT NULL DEFAULT 0,
  done        INTEGER NOT NULL DEFAULT 0,
  thumb       TEXT,
  path        TEXT,
  files       TEXT,
  caption     TEXT,
  attempts    INTEGER NOT NULL DEFAULT 0,
  error       TEXT,
  retry_at    INTEGER,
  created_at  INTEGER NOT NULL,
  finished_at INTEGER
) STRICT;
CREATE UNIQUE INDEX jobs_download_msg ON jobs (chat_id, message_id) WHERE kind = 'download';
CREATE INDEX jobs_queue    ON jobs (kind, status, position);
CREATE INDEX jobs_finished ON jobs (status, finished_at);
CREATE INDEX jobs_path     ON jobs (lower(path));
CREATE TABLE history (
  id          INTEGER PRIMARY KEY,
  kind        TEXT    NOT NULL CHECK (kind IN ('download', 'upload')),
  status      TEXT    NOT NULL CHECK (status IN ('completed', 'failed')),
  chat_id     INTEGER NOT NULL,
  chat_title  TEXT    NOT NULL,
  message_id  INTEGER,
  name        TEXT    NOT NULL,
  type        TEXT    NOT NULL,
  size        INTEGER NOT NULL,
  path        TEXT,
  error       TEXT,
  finished_at INTEGER NOT NULL
) STRICT;
CREATE INDEX history_time ON history (finished_at);
CREATE INDEX history_msg  ON history (chat_id, message_id);
CREATE INDEX history_path ON history (lower(path));
CREATE TABLE media (
  chat_id    INTEGER NOT NULL,
  message_id INTEGER NOT NULL,
  date       INTEGER NOT NULL,
  type       TEXT    NOT NULL,
  name       TEXT    NOT NULL,
  ext        TEXT    NOT NULL,
  size       INTEGER NOT NULL,
  duration   INTEGER NOT NULL DEFAULT 0,
  caption    TEXT    NOT NULL DEFAULT '',
  thumb      TEXT,
  PRIMARY KEY (chat_id, message_id)
) STRICT, WITHOUT ROWID;
CREATE INDEX media_chat_date ON media (chat_id, date);
CREATE TABLE scans (
  chat_id    INTEGER PRIMARY KEY,
  newest_id  INTEGER NOT NULL,
  oldest_id  INTEGER NOT NULL,
  complete   INTEGER NOT NULL DEFAULT 0,
  total      INTEGER
) STRICT;`

export function tx<T>(db: DB, fn: () => T): T {
  db.exec('BEGIN')
  try { const out = fn(); db.exec('COMMIT'); return out } catch (e) { db.exec('ROLLBACK'); throw e }
}

/** Opens (and on first run creates) the database. Future schema changes add a numbered step here. */
export function openDb(file: string) {
  const db = new DatabaseSync(file)
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON')
  const { user_version } = db.prepare('PRAGMA user_version').get() as { user_version: number }
  if (user_version < 1) tx(db, () => { db.exec(v1); db.exec('PRAGMA user_version = 1') })
  return db
}

// ---- Settings ----

export type Settings = {
  downloadRoot: string, maxDownloads: number, skipExisting: boolean, datePrefix: boolean, folderTemplate: string,
  defaultUploadChat: number | null, uploadAlbum: boolean, keepNames: boolean, maxUploads: number, showArchived: boolean,
  autoRetry: boolean, retryAttempts: number, stallSeconds: number, clearCompletedDays: number, notifyComplete: boolean,
  notifyFailed: boolean, closeToTray: boolean, startWithSystem: boolean, apiId: number | null,
}
/** What the database stores; `startWithSystem` lives in the Windows login item, not here. */
export type StoredSettings = Omit<Settings, 'startWithSystem'>
export type SettingsPatch = Partial<Omit<Settings, 'apiId'>>

const defaults: Omit<StoredSettings, 'downloadRoot'> = {
  maxDownloads: 2, skipExisting: true, datePrefix: false, folderTemplate: '{chat}', defaultUploadChat: null,
  uploadAlbum: true, keepNames: true, maxUploads: 1, showArchived: false, autoRetry: true, retryAttempts: 3,
  stallSeconds: 10, clearCompletedDays: 0, notifyComplete: true, notifyFailed: true, closeToTray: false, apiId: null,
}

type Rule = (v: unknown, key: string) => void
const bad = (key: string, rule: string) => fail(400, `${key} ${rule}`)
const bool: Rule = (v, k) => { if (typeof v !== 'boolean') throw bad(k, 'must be on or off') }
const range = (min: number, max: number): Rule => (v, k) => {
  if (!Number.isInteger(v) || (v as number) < min || (v as number) > max) throw bad(k, `must be a whole number from ${min} to ${max}`)
}
const choice = (...values: number[]): Rule => (v, k) => { if (!values.includes(v as number)) throw bad(k, `must be one of ${values.join(', ')}`) }

/** `{chat}` and `{chat_id}` folders under the download root; never a way out of it. */
export const folderTemplate: Rule = (v, k) => {
  if (typeof v !== 'string' || v.length > 100) throw bad(k, 'must be text of up to 100 characters')
  if (v === '') return // files go straight into the download root
  if (/^[\\/]/.test(v)) throw bad(k, "can't start with \\ or /")
  if (/^[a-z]:/i.test(v)) throw bad(k, "can't contain a drive letter")
  const literal = v.replace(/\{chat(?:_id)?\}/g, '')
  if (/[{}]/.test(literal)) throw bad(k, 'can only use the {chat} and {chat_id} placeholders')
  if (/[<>:"|?*\x00-\x1f]/.test(literal)) throw bad(k, 'can\'t contain < > : " | ? * or control characters')
  for (const part of v.split(/[\\/]/)) {
    if (part === '') throw bad(k, "can't contain empty folder names")
    if (/^\.+$/.test(part.trim())) throw bad(k, "can't contain . or .. folders")
  }
}

// Editable keys only. `downloadRoot` gets its full check from checkDownloadRoot and `defaultUploadChat` its
// canPost check from the chat cache, both in settings.set before anything is written.
const rules: Record<keyof SettingsPatch, Rule> = {
  downloadRoot: (v, k) => { if (typeof v !== 'string' || !v.trim() || v.length > 1000) throw bad(k, 'must be a folder path') },
  maxDownloads: range(1, 5), skipExisting: bool, datePrefix: bool, folderTemplate,
  defaultUploadChat: (v, k) => { if (v !== null && (!Number.isSafeInteger(v) || v === 0)) throw bad(k, 'must be a chat or none') },
  uploadAlbum: bool, keepNames: bool, maxUploads: range(1, 3), showArchived: bool, autoRetry: bool,
  retryAttempts: range(1, 10), stallSeconds: choice(5, 10, 30, 60), clearCompletedDays: choice(0, 1, 7, 30),
  notifyComplete: bool, notifyFailed: bool, closeToTray: bool, startWithSystem: bool,
}
const internal = new Set(['apiId', 'apiHash', 'window']) // written by auth.credentials and main only

/** Validates a settings.set patch; every failure is a 400 naming the key. Writes nothing. */
export function checkSettings(patch: unknown): SettingsPatch {
  if (typeof patch !== 'object' || patch === null || Array.isArray(patch)) throw fail(400, 'Settings must be an object')
  for (const [key, value] of Object.entries(patch)) {
    if (internal.has(key)) throw fail(400, `${key} can't be changed in Settings`)
    if (!Object.hasOwn(rules, key)) throw fail(400, `Unknown setting ${key}`)
    rules[key as keyof SettingsPatch](value, key)
  }
  return patch as SettingsPatch
}

/** Validates every key, then writes them in one transaction. `startWithSystem` is not stored. */
export function setSettings(db: DB, patch: unknown) {
  const valid = checkSettings(patch)
  tx(db, () => { for (const [key, value] of Object.entries(valid)) if (key !== 'startWithSystem') putSetting(db, key, value) })
  return valid
}

/** Stored values over defaults. `apiHash` and `window` are never part of the result. */
export function getSettings(db: DB, defaultRoot: string): StoredSettings {
  const out: Record<string, unknown> = { downloadRoot: defaultRoot, ...defaults }
  for (const r of db.prepare('SELECT key, value FROM settings').all() as { key: string, value: string }[]) {
    if (Object.hasOwn(out, r.key)) out[r.key] = JSON.parse(r.value)
  }
  return out as StoredSettings
}

export const readSetting = (db: DB, key: string): unknown => {
  const r = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined
  return r && JSON.parse(r.value)
}
/** Raw write for internal keys (apiId, apiHash, window); `undefined` deletes the key. */
export const putSetting = (db: DB, key: string, value?: unknown) => {
  if (value === undefined) db.prepare('DELETE FROM settings WHERE key = ?').run(key)
  else db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value').run(key, JSON.stringify(value))
}

// ---- Downloads as seen by Files View, Chat View, and the Library ----

export type MediaType = 'video' | 'photo' | 'document' | 'audio' | 'animation' | 'voice' | 'video_note'
export type DownloadState = { status: 'none' | 'queued' | 'active' | 'paused' | 'failed' | 'downloaded', jobId: number | null, path: string | null }
export type MediaItem = {
  chatId: number, messageId: number, date: number, type: MediaType, name: string, ext: string, size: number,
  duration: number, caption: string, thumb: string | null,
} & DownloadState

/** Adds `jobId`, `status`, and `path` (MediaItem.status, ARCHITECTURE > Invariants) to rows of `source`, which must have
 *  `chat_id` and `message_id`: the open or failed job's status, else `downloaded` when a completed job or completed
 *  history row still has a path, else `none`. The one predicate behind Chat View, Files View, and downloads.add. */
const stated = (source: string) => `
  SELECT *, CASE WHEN jobStatus IN ('queued', 'active', 'paused', 'failed') THEN jobStatus
      WHEN (jobStatus = 'completed' AND jobPath IS NOT NULL) OR historyPath IS NOT NULL THEN 'downloaded' ELSE 'none' END AS status,
    COALESCE(jobPath, historyPath) AS path
  FROM (SELECT s.*, j.id AS jobId, j.status AS jobStatus, j.path AS jobPath,
      (SELECT h.path FROM history h WHERE h.kind = 'download' AND h.status = 'completed' AND h.path IS NOT NULL
         AND h.chat_id = s.chat_id AND h.message_id = s.message_id ORDER BY h.id DESC LIMIT 1) AS historyPath
    FROM (${source}) s LEFT JOIN jobs j ON j.kind = 'download' AND j.chat_id = s.chat_id AND j.message_id = s.message_id)`
const stateOf = (r: Row): DownloadState => ({ status: r.status as DownloadState['status'], jobId: r.jobId as number | null, path: r.path as string | null })

/** MediaItem.status per message. Ids are bound as one JSON parameter. */
export function downloadStates(db: DB, chatId: number, messageIds: number[]) {
  const rows = db.prepare(stated('SELECT ? AS chat_id, value AS message_id FROM json_each(?)')).all(chatId, JSON.stringify(messageIds)) as Row[]
  return new Map(rows.map((r): [number, DownloadState] => [r.message_id as number, stateOf(r)]))
}

export type HistoryItem = {
  id: number, kind: 'download' | 'upload', status: 'completed' | 'failed', chatId: number, chatTitle: string,
  messageId: number | null, name: string, type: string, size: number, path: string | null, error: string | null,
  finishedAt: number, preview: string | null,
}
export const historyItem = (r: Row, thumbs: string): HistoryItem => ({
  id: r.id as number, kind: r.kind as HistoryItem['kind'], status: r.status as HistoryItem['status'],
  chatId: r.chat_id as number, chatTitle: r.chat_title as string, messageId: r.message_id as number | null,
  name: r.name as string, type: r.type as string, size: r.size as number, path: r.path as string | null,
  error: r.error as string | null, finishedAt: r.finished_at as number,
  preview: fs.existsSync(path.join(thumbs, `${r.id}.jpg`)) ? `teleflow://saved/${r.id}` : null,
})

/** Per message, the latest completed download that still has a path (Verify's candidates). */
export const latestDownloads = (db: DB) => db.prepare(`
  SELECT * FROM (SELECT *, ROW_NUMBER() OVER (PARTITION BY chat_id, message_id ORDER BY id DESC) AS n
    FROM history WHERE kind = 'download' AND status = 'completed' AND path IS NOT NULL) WHERE n = 1`).all() as Row[]

/** Chat data for files TeleFlow downloaded, keyed by lowercased path; the latest row wins. */
export function downloadsByPath(db: DB, paths: string[]) {
  const rows = db.prepare(`
    SELECT lower(path) AS key, id, chat_id, chat_title, message_id FROM history
    WHERE kind = 'download' AND status = 'completed' AND lower(path) IN (SELECT lower(value) FROM json_each(?)) ORDER BY id`)
    .all(JSON.stringify(paths)) as { key: string, id: number, chat_id: number, chat_title: string, message_id: number | null }[]
  return new Map(rows.map((r) => [r.key, r]))
}

/** True when `file` is the recorded path of a completed download job or a download history row. */
export const isRecordedDownload = (db: DB, file: string) => db.prepare(`
  SELECT 1 FROM jobs WHERE kind = 'download' AND status = 'completed' AND lower(path) = lower($p)
  UNION ALL SELECT 1 FROM history WHERE kind = 'download' AND lower(path) = lower($p) LIMIT 1`).get({ p: file }) !== undefined

/** After a file went to the Recycle Bin: the message reads as not downloaded and can be downloaded again.
 *  Returns the affected chat ids (for `media:` / `messages:` invalidations). */
export const forgetDownload = (db: DB, file: string) => tx(db, () => {
  const a = db.prepare(`UPDATE history SET path = NULL WHERE kind = 'download' AND lower(path) = lower(?) RETURNING chat_id`).all(file)
  const b = db.prepare(`DELETE FROM jobs WHERE kind = 'download' AND status = 'completed' AND lower(path) = lower(?) RETURNING chat_id`).all(file)
  return [...new Set([...a, ...b].map((r) => r.chat_id as number))]
})

// ---- Jobs (ARCHITECTURE > Invariants, > Methods notes) ----

export type Kind = 'download' | 'upload'
export type Status = 'queued' | 'active' | 'paused' | 'completed' | 'failed'
/** One file of an upload job. `name` is the name it is posted under; `pendingId` is the temporary message id while
 *  it is sending, `messageId` the real one once sent (ARCHITECTURE > Upload steps 3–6). */
export type UploadFile = { path: string, name: string, size: number, type: 'photo' | 'video' | 'audio' | 'document', pendingId?: number, messageId?: number }
export type JobRow = {
  id: number, kind: Kind, status: Status, position: number, chat_id: number, chat_title: string, message_id: number | null,
  name: string, type: string, size: number, done: number, thumb: string | null, path: string | null, files: string | null,
  caption: string | null, attempts: number, error: string | null, retry_at: number | null, created_at: number, finished_at: number | null,
}
export type NewJob = { kind: Kind, chatId: number, chatTitle: string, messageId: number | null, name: string, type: string,
  size: number, thumb?: string | null, files?: UploadFile[], caption?: string | null }
export type Job = { id: number, kind: Kind, status: Status, chatId: number, chatTitle: string, chatUsername: string | null,
  chatPhoto: string | null, messageId: number | null, name: string, type: string, size: number, done: number, thumb: string | null,
  path: string | null, error: string | null, retryAt: number | null, finishedAt: number | null }

const open = `('queued', 'active', 'paused')`
const like = (q: string) => `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`
export const jobRow = (db: DB, id: number) => db.prepare('SELECT * FROM jobs WHERE id = ?').get(id) as JobRow | undefined

/** Adds jobs in first-enqueue order, 500 per transaction. A download that is queued, active, or paused is left alone;
 *  a failed one (or, with `force`, a completed one) is requeued and keeps its place. Returns the ids added or requeued. */
export function enqueue(db: DB, rows: NewJob[], force = false) {
  const upsert = db.prepare(`
    INSERT INTO jobs (kind, status, position, chat_id, chat_title, message_id, name, type, size, thumb, files, caption, created_at)
    VALUES (?, 'queued', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (chat_id, message_id) WHERE kind = 'download' DO UPDATE SET
      status = 'queued', attempts = 0, error = NULL, retry_at = NULL, path = NULL, finished_at = NULL
    WHERE jobs.status = 'failed' OR (? AND jobs.status = 'completed')
    RETURNING id`)
  const ids: number[] = []
  const now = Date.now()
  for (let i = 0; i < rows.length; i += 500) tx(db, () => {
    // One MAX per transaction: an INSERT cannot read its own id, and a MAX per row would scan the table each time.
    let next = (db.prepare('SELECT IFNULL(MAX(position), 0) + 1 AS n FROM jobs').get() as { n: number }).n
    for (const r of rows.slice(i, i + 500)) {
      const out = upsert.get(r.kind, next++, r.chatId, r.chatTitle, r.messageId, r.name, r.type, r.size, r.thumb ?? null,
        r.files ? JSON.stringify(r.files) : null, r.caption ?? null, now, force ? 1 : 0) as { id: number } | undefined
      if (out) ids.push(out.id)
    }
  })
  return ids
}

export const toJob = (r: JobRow, chat: (id: number) => { username: string | null, photo: string | null } | null): Job => {
  const c = chat(r.chat_id)
  return { id: r.id, kind: r.kind, status: r.status, chatId: r.chat_id, chatTitle: r.chat_title, chatUsername: c?.username ?? null,
    chatPhoto: c?.photo ?? null, messageId: r.message_id, name: r.name, type: r.type, size: r.size, done: r.done, thumb: r.thumb,
    path: r.path, error: r.error, retryAt: r.retry_at, finishedAt: r.finished_at }
}

/** jobs.list: open rows by queue position, then finished rows newest first. */
export function jobsList(db: DB, a: { kind?: Kind, status?: 'open' | Status, q: string, page: number, pageSize: number },
  chat: Parameters<typeof toJob>[1]) {
  const cond: string[] = [], args: (string | number)[] = []
  if (a.kind) { cond.push('kind = ?'); args.push(a.kind) }
  if (a.status === 'open') cond.push(`status IN ${open}`)
  else if (a.status) { cond.push('status = ?'); args.push(a.status) }
  if (a.q) { cond.push(`name LIKE ? ESCAPE '\\'`); args.push(like(a.q)) }
  const where = cond.length ? `WHERE ${cond.join(' AND ')}` : ''
  const { n } = db.prepare(`SELECT COUNT(*) AS n FROM jobs ${where}`).get(...args) as { n: number }
  const rows = db.prepare(`SELECT * FROM jobs ${where}
    ORDER BY status IN ${open} DESC, CASE WHEN status IN ${open} THEN position END, finished_at DESC, id DESC LIMIT ? OFFSET ?`)
    .all(...args, a.pageSize, (a.page - 1) * a.pageSize) as JobRow[]
  return { items: rows.map((r) => toJob(r, chat)), total: n }
}

export type Action = 'pause' | 'resume' | 'retry' | 'cancel' | 'up' | 'down' | 'clear-completed'

/** The SQL half of jobs.action: changes or deletes the rows in scope and returns them (deleted rows as they were).
 *  Without ids: pause = queued + active, resume = paused, retry = failed, cancel = every row. Ids are one JSON parameter. */
export function jobsAction(db: DB, action: Action, ids?: number[]): JobRow[] {
  const scope = ids ? 'AND id IN (SELECT value FROM json_each(?))' : ''
  const run = (sql: string) => db.prepare(`${sql} ${scope} RETURNING *`).all(...(ids ? [JSON.stringify(ids)] : [])) as JobRow[]
  switch (action) {
    case 'pause': return run(`UPDATE jobs SET status = 'paused' WHERE status IN ('queued', 'active')`)
    case 'resume': return run(`UPDATE jobs SET status = 'queued' WHERE status = 'paused'`)
    case 'retry': return run(`UPDATE jobs SET status = 'queued', attempts = 0, error = NULL, retry_at = NULL, finished_at = NULL WHERE status = 'failed'`)
    case 'cancel': return run('DELETE FROM jobs WHERE 1 = 1')
    case 'clear-completed': return db.prepare(`DELETE FROM jobs WHERE status = 'completed' RETURNING *`).all() as JobRow[]
    case 'up': case 'down': {
      // Swaps with the neighbor of the same kind among open jobs.
      const me = db.prepare(`SELECT * FROM jobs WHERE id = ? AND status IN ${open}`).get(ids![0]) as JobRow | undefined
      const other = me && db.prepare(`SELECT * FROM jobs WHERE kind = ? AND status IN ${open} AND position ${action === 'up' ? '<' : '>'} ?
        ORDER BY position ${action === 'up' ? 'DESC' : 'ASC'} LIMIT 1`).get(me.kind, me.position) as JobRow | undefined
      if (!me || !other) return []
      tx(db, () => {
        const set = db.prepare('UPDATE jobs SET position = ? WHERE id = ?')
        set.run(other.position, me.id)
        set.run(me.position, other.id)
      })
      return [me, other]
    }
  }
}

/** Job rows per kind and status (LiveStats.counts). */
export function jobCounts(db: DB) {
  const zero = (): Record<Status, number> => ({ queued: 0, active: 0, paused: 0, completed: 0, failed: 0 })
  const counts: Record<Kind, Record<Status, number>> = { download: zero(), upload: zero() }
  for (const r of db.prepare('SELECT kind, status, COUNT(*) AS n FROM jobs GROUP BY kind, status').all() as { kind: Kind, status: Status, n: number }[]) {
    counts[r.kind][r.status] = r.n
  }
  return counts
}

/** True while any transfer is active or finalizing (Clear cache and Clear app data refuse then). */
export const anyActive = (db: DB) => db.prepare(`SELECT 1 FROM jobs WHERE status = 'active' LIMIT 1`).get() !== undefined
/** Clear app data (`keep` = credentials and window) and Clear All Data (keeps nothing). Returns the chats that had rows,
 *  for their `media:` / `messages:` invalidations. */
export function clearRows(db: DB, keep: string[]) {
  const chats = tx(db, () => {
    const ids = db.prepare('SELECT chat_id FROM jobs UNION SELECT chat_id FROM history UNION SELECT chat_id FROM media UNION SELECT chat_id FROM scans').all()
    db.exec('DELETE FROM jobs; DELETE FROM history; DELETE FROM media; DELETE FROM scans')
    db.prepare('DELETE FROM settings WHERE key NOT IN (SELECT value FROM json_each(?))').run(JSON.stringify(keep))
    return ids.map((r) => r.chat_id as number)
  })
  db.exec('VACUUM; PRAGMA wal_checkpoint(TRUNCATE)')
  return chats
}

export type NewHistory = { kind: Kind, status: 'completed' | 'failed', chatId: number, chatTitle: string, messageId: number | null,
  name: string, type: string, size: number, path: string | null, error: string | null, finishedAt: number }
export const addHistory = (db: DB, h: NewHistory) => Number(db.prepare(`
  INSERT INTO history (kind, status, chat_id, chat_title, message_id, name, type, size, path, error, finished_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(h.kind, h.status, h.chatId, h.chatTitle, h.messageId, h.name, h.type, h.size,
  h.path, h.error, h.finishedAt).lastInsertRowid)

// ---- Media index (ARCHITECTURE > Media index scan) ----

export type MediaRow = Omit<MediaItem, keyof DownloadState>
export type MediaFilters = { type?: 'video' | 'photo' | 'document' | 'audio' | 'animation', ext?: string,
  duration?: 'short' | 'medium' | 'long' | 'xlong', size?: 'small' | 'medium' | 'large' | 'xlarge',
  status?: DownloadState['status'], q?: string, sort?: 'newest' | 'oldest' | 'largest' | 'smallest' | 'name' | 'longest' }
export type ScanRow = { chat_id: number, newest_id: number, oldest_id: number, complete: number, total: number | null }

export function putMedia(db: DB, rows: MediaRow[]) {
  if (!rows.length) return
  const put = db.prepare(`INSERT OR REPLACE INTO media (chat_id, message_id, date, type, name, ext, size, duration, caption, thumb)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
  tx(db, () => { for (const m of rows) put.run(m.chatId, m.messageId, m.date, m.type, m.name, m.ext, m.size, m.duration, m.caption, m.thumb) })
}
export const deleteMedia = (db: DB, chatId: number, ids: number[]) =>
  db.prepare('DELETE FROM media WHERE chat_id = ? AND message_id IN (SELECT value FROM json_each(?))').run(chatId, JSON.stringify(ids)).changes
export const getScan = (db: DB, chatId: number) => db.prepare('SELECT * FROM scans WHERE chat_id = ?').get(chatId) as ScanRow | undefined
export const putScan = (db: DB, s: ScanRow) => db.prepare(`INSERT INTO scans (chat_id, newest_id, oldest_id, complete, total) VALUES (?, ?, ?, ?, ?)
  ON CONFLICT (chat_id) DO UPDATE SET newest_id = excluded.newest_id, oldest_id = excluded.oldest_id, complete = excluded.complete, total = excluded.total`)
  .run(s.chat_id, s.newest_id, s.oldest_id, s.complete, s.total)
export const mediaCount = (db: DB, chatId: number) => (db.prepare('SELECT COUNT(*) AS n FROM media WHERE chat_id = ?').get(chatId) as { n: number }).n
/** Distinct extensions of the whole chat index, ignoring filters (the File Type options). */
export const mediaExts = (db: DB, chatId: number) =>
  (db.prepare(`SELECT DISTINCT ext FROM media WHERE chat_id = ? AND ext <> '' ORDER BY ext`).all(chatId) as { ext: string }[]).map((r) => r.ext)

const mediaItem = (r: Row): MediaItem => ({
  chatId: r.chat_id as number, messageId: r.message_id as number, date: r.date as number, type: r.type as MediaType, name: r.name as string,
  ext: r.ext as string, size: r.size as number, duration: r.duration as number, caption: r.caption as string, thumb: r.thumb as string | null, ...stateOf(r),
})
export const mediaByIds = (db: DB, chatId: number, ids: number[]) => new Map((db.prepare(stated(
  'SELECT * FROM media WHERE chat_id = ? AND message_id IN (SELECT value FROM json_each(?))')).all(chatId, JSON.stringify(ids)) as Row[])
  .map((r) => [r.message_id as number, mediaItem(r)]))

const MB = 2 ** 20, MAX = Number.MAX_SAFE_INTEGER
const durations = { short: [0, 60], medium: [60, 600], long: [600, 1800], xlong: [1800, MAX] }
const sizes = { small: [0, 10 * MB], medium: [10 * MB, 100 * MB], large: [100 * MB, 1024 * MB], xlarge: [1024 * MB, MAX] }
const sorts = { newest: 'date DESC, message_id DESC', oldest: 'date, message_id', largest: 'size DESC, message_id DESC',
  smallest: 'size, message_id', name: 'name COLLATE NOCASE, message_id', longest: 'duration DESC, message_id DESC' }

/** Files View rows (chats.media) and downloads.add's `{ chatId, filters }`; every page when `page` is omitted. */
export function mediaQuery(db: DB, chatId: number, f: MediaFilters, page?: { page: number, pageSize: number }) {
  const cond: string[] = [], args: (string | number)[] = []
  const add = (sql: string, ...v: (string | number)[]) => { cond.push(sql); args.push(...v) }
  if (f.type === 'video' || f.type === 'audio') add('type IN (?, ?)', f.type, f.type === 'video' ? 'video_note' : 'voice')
  else if (f.type) add('type = ?', f.type)
  if (f.ext) add('ext = ?', f.ext)
  if (f.duration) add('duration > 0 AND duration >= ? AND duration < ?', ...durations[f.duration]) // photos and documents never match
  if (f.size) add('size >= ? AND size < ?', ...sizes[f.size])
  if (f.status) add('status = ?', f.status)
  if (f.q) add(`(name LIKE ? ESCAPE '\\' OR caption LIKE ? ESCAPE '\\')`, like(f.q), like(f.q))
  const base = `FROM (${stated('SELECT * FROM media WHERE chat_id = ?')}) ${cond.length ? `WHERE ${cond.join(' AND ')}` : ''}`
  const { n } = db.prepare(`SELECT COUNT(*) AS n ${base}`).get(chatId, ...args) as { n: number }
  const limit = page ? [page.pageSize, (page.page - 1) * page.pageSize] : [-1, 0]
  const rows = db.prepare(`SELECT * ${base} ORDER BY ${sorts[f.sort ?? 'newest']} LIMIT ? OFFSET ?`).all(chatId, ...args, ...limit) as Row[]
  return { items: rows.map(mediaItem), total: n }
}

// ---- Stats: completed history rows, one per file (ARCHITECTURE > Methods notes) ----

export type Range = '24h' | '7d' | '30d'

/** Bucket starts in ms, oldest first: 24 local hours ending with the current one, or 7 / 30 local days ending today. */
export function bucketStarts(range: Range, now: number) {
  const top = new Date(now)
  if (range === '24h') top.setMinutes(0, 0, 0)
  else top.setHours(0, 0, 0, 0)
  const n = range === '24h' ? 24 : range === '7d' ? 7 : 30
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(top)
    if (range === '24h') d.setHours(d.getHours() - (n - 1 - i))
    else d.setDate(d.getDate() - (n - 1 - i))
    return d.getTime()
  })
}

export function statsOverview(db: DB, thumbs: string, now = Date.now()) {
  const completedToday = { download: 0, upload: 0 }, totalFiles = { download: 0, upload: 0 }
  for (const r of db.prepare(`SELECT kind, COUNT(*) AS total, SUM(finished_at >= ?) AS today FROM history WHERE status = 'completed' GROUP BY kind`)
    .all(new Date(now).setHours(0, 0, 0, 0)) as { kind: Kind, total: number, today: number }[]) {
    totalFiles[r.kind] = r.total
    completedToday[r.kind] = r.today
  }
  const recent = (db.prepare('SELECT * FROM history ORDER BY finished_at DESC, id DESC LIMIT 6').all() as Row[]).map((r) => historyItem(r, thumbs))
  return { completedToday, totalFiles, recent }
}

export function statsActivity(db: DB, range: Range, now = Date.now()) {
  const buckets = bucketStarts(range, now)
  const out = { buckets, download: buckets.map(() => 0), upload: buckets.map(() => 0) }
  for (const r of db.prepare(`SELECT kind, finished_at FROM history WHERE status = 'completed' AND finished_at >= ?`).all(buckets[0]) as { kind: Kind, finished_at: number }[]) {
    out[r.kind][buckets.findLastIndex((b) => b <= r.finished_at)]++
  }
  return out
}

/** Top 5 chats by completed files in the range, ties by the latest finish; title and photo from the chat cache. */
export function statsChats(db: DB, range: Range, chat: (id: number) => { title: string, photo: string | null } | null, now = Date.now()) {
  const rows = db.prepare(`
    SELECT chat_id, COUNT(*) AS count, MAX(finished_at) AS latest,
      (SELECT h2.chat_title FROM history h2 WHERE h2.chat_id = h.chat_id ORDER BY h2.finished_at DESC, h2.id DESC LIMIT 1) AS title
    FROM history h WHERE status = 'completed' AND finished_at >= ? GROUP BY chat_id ORDER BY count DESC, latest DESC LIMIT 5`)
    .all(bucketStarts(range, now)[0]) as { chat_id: number, count: number, title: string }[]
  return { items: rows.map((r) => { const c = chat(r.chat_id); return { chatId: r.chat_id, title: c?.title ?? r.title, photo: c?.photo ?? null, count: r.count } }) }
}
