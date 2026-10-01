// SQLite schema, settings, and queries (ARCHITECTURE > SQLite schema, > Settings keys). Electron-free.
import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { AuthState } from './shapes.ts'

export type AppError = Error & { status: number, retryAfter?: number }

/** The one way to raise a user-facing error; `message` is shown as is (ARCHITECTURE > Bridge). */
export const fail = (status: number, message: string, extra?: { retryAfter?: number }): AppError =>
  Object.assign(new Error(message), { status }, extra)

/** Main → renderer events (ARCHITECTURE > Events); main coalesces `invalidate`. */
export type AppEvent = { type: 'auth', auth: AuthState } | { type: 'invalidate', topics: string[] }
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

/** MediaItem.status per message (ARCHITECTURE > Invariants): the open or failed job's status, else `downloaded` when
 *  a completed job or completed history row still has a path, else `none`. Ids are bound as one JSON parameter. */
export function downloadStates(db: DB, chatId: number, messageIds: number[]) {
  const rows = db.prepare(`
    SELECT m.value AS id, j.id AS jobId, j.status AS status, j.path AS jobPath,
      (SELECT h.path FROM history h WHERE h.kind = 'download' AND h.status = 'completed' AND h.path IS NOT NULL
         AND h.chat_id = $chat AND h.message_id = m.value ORDER BY h.id DESC LIMIT 1) AS historyPath
    FROM json_each($ids) m
    LEFT JOIN jobs j ON j.kind = 'download' AND j.chat_id = $chat AND j.message_id = m.value`)
    .all({ chat: chatId, ids: JSON.stringify(messageIds) }) as { id: number, jobId: number | null, status: string | null, jobPath: string | null, historyPath: string | null }[]
  return new Map(rows.map((r): [number, DownloadState] => {
    const open = r.status === 'queued' || r.status === 'active' || r.status === 'paused' || r.status === 'failed'
    const done = (r.status === 'completed' && r.jobPath !== null) || r.historyPath !== null
    return [r.id, { status: open ? r.status as DownloadState['status'] : done ? 'downloaded' : 'none', jobId: r.jobId, path: r.jobPath ?? r.historyPath }]
  }))
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
