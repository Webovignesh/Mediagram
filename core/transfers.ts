// Transfer engine (ARCHITECTURE > Transfer engine): queue pump, per-kind gates, downloads, stalls, retries, live stats.
// The upload flow is in uploads.ts. createEngine(deps) lets tests run a fresh engine on :memory: SQLite with a fake invoke.
import fs from 'node:fs'
import path from 'node:path'
import type * as Td from 'tdlib-types'
import {
  type Action, addHistory, type AppError, type DB, downloadStates, type Emit, enqueue, fail, jobCounts, type JobRow, jobsAction,
  type Kind, mediaByIds, type MediaFilters, mediaQuery, type MediaRow, type Status, type StoredSettings, tx,
} from './db.ts'
import { type AuthState, type Chat, extractMedia, mediaRow } from './shapes.ts'
import { libraryAdded, log, moveFile, realLocation, type Paths, within } from './storage.ts'
import { createUploads } from './uploads.ts'

// ---- Pure helpers ----

const reservedName = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i
const trimEnds = (s: string) => s.replace(/^[. ]+|[. ]+$/g, '')

/** A Windows-safe file or folder name: invalid characters → _, reserved device names get a _ prefix, no leading or
 *  trailing dots and spaces (a leading dot would hide the file from the Library), at most 180 characters with the
 *  extension kept. */
export function sanitize(name: string) {
  // The bidi controls and marks are stripped too: a name can otherwise hide its real extension behind an RTL override
  // (ARCHITECTURE > Security > Renderer compromise).
  let s = trimEnds(name.replace(/[<>:"/\\|?*\x00-\x1f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, '_'))
  if (reservedName.test(s)) s = `_${s}`
  const chars = [...s] // code points, so a cut never splits a surrogate pair
  if (chars.length > 180) {
    const ext = [...path.extname(s)].length <= 20 ? [...path.extname(s)] : []
    s = trimEnds(chars.slice(0, 180 - ext.length).join('')) + ext.join('')
  }
  return s || '_'
}

const pad = (n: number) => String(n).padStart(2, '0')
/** The final file name: the media's own or default name (extractMedia), optionally prefixed with the message's local date. */
export function fileName(name: string, date: number, datePrefix: boolean) {
  const d = new Date(date * 1000)
  return sanitize(datePrefix ? `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${name}` : name)
}

/** The folder under the download root from `folderTemplate`. Every part is sanitized, so no part is `..` and the
 *  result never leaves the root. */
export function folderFor(template: string, chat: { id: number, title: string }) {
  const filled = template.replace(/\{chat_id\}/g, () => String(chat.id)).replace(/\{chat\}/g, () => sanitize(chat.title))
  return path.join(...filled.split(/[\\/]/).filter(Boolean).map(sanitize), '.')
}

/** `name` in `dir`, or `name (2)`, `name (3)`… when the file exists or another finalize reserved it (lowercased paths). */
export function uniquePath(dir: string, name: string, reserved: Set<string>) {
  const ext = path.extname(name), base = name.slice(0, name.length - ext.length)
  for (let n = 1; ; n++) {
    const p = path.join(dir, n === 1 ? name : `${base} (${n})${ext}`)
    if (!reserved.has(p.toLowerCase()) && !fs.existsSync(p)) return p
  }
}

/** The longest Windows path the app can write without the long-path prefix: 259 characters plus the null. */
export const MAX_PATH = 259

/** The path `name` lands on, with the name cut when the folder would make it too long to create (ARCHITECTURE >
 *  Download step 6): the extension stays, room for a " (2)" suffix is kept, and the folder is never cut — the Library
 *  and the history row have to keep naming the folder the user chose. `null` when even the trimmed name cannot fit. */
export function fitName(dir: string, name: string, reserved: Set<string>) {
  const ext = path.extname(name), stem = path.basename(name, ext)
  const room = MAX_PATH - dir.length - 1 - ext.length - 6
  if (room < 1) return null
  const dest = uniquePath(dir, stem.length > room ? stem.slice(0, room) + ext : name, reserved)
  return dest.length <= MAX_PATH ? dest : null
}

/** Start gate per kind: spacing between starts (doubled per flood up to 5 s, eased 100 ms per start) and the flood wait. */
export type Gate = { base: number, spacing: number, nextAt: number, waitUntil: number | null }
export const newGate = (base: number): Gate => ({ base, spacing: base, nextAt: 0, waitUntil: null })
export const gate = {
  open: (g: Gate, now: number) => now >= g.nextAt && (g.waitUntil === null || now >= g.waitUntil),
  started: (g: Gate, now: number): Gate => ({ ...g, nextAt: now + g.spacing, spacing: Math.max(g.base, g.spacing - 100) }),
  flooded: (g: Gate, now: number, seconds: number): Gate =>
    ({ ...g, spacing: Math.min(5000, g.spacing * 2), waitUntil: Math.max(g.waitUntil ?? 0, now + seconds * 1000) }),
}

/** One stall rule (ARCHITECTURE > Stalls): only while online and not flood-waiting; two re-asserts, then the third stall
 *  requeues the download as a new attempt, or fails it once the attempts are spent. */
export function stallDecision(s: { online: boolean, idleMs: number, stallMs: number, stalls: number, attempts: number, maxAttempts: number }) {
  if (!s.online) return 'skip'
  if (s.idleMs < s.stallMs) return 'wait'
  if (s.stalls < 2) return 'reassert'
  return s.attempts >= s.maxAttempts ? 'fail' : 'requeue'
}

/** Network and timeout errors, 5xx, FILE_REFERENCE_EXPIRED, and unknown errors are worth another try; invalid requests,
 *  permissions, missing messages and files, a full disk, and errors marked `final` are not. */
export function isRetryable(e: unknown) {
  const err = e as Partial<AppError> & { code?: unknown }
  if (err.final || err.code === 'ENOSPC') return false
  if (/FILE_REFERENCE_EXPIRED/.test(String(err.message))) return true
  return !(err.status !== undefined && err.status >= 400 && err.status < 500 && err.status !== 408 && err.status !== 429)
}
/** Backoff before an automatic retry: 30 s doubled per attempt, at most 10 minutes. */
export const retryDelay = (attempts: number) => Math.min(30_000 * 2 ** Math.max(0, attempts - 1), 600_000)

const fsText: Record<string, string> = {
  ENOSPC: 'The disk is full', EACCES: "TeleFlow can't write to the download folder", EPERM: "TeleFlow can't write to the download folder",
  EBUSY: 'The file is in use by another app',
}
const errorText = (e: unknown) => { const err = e as Partial<AppError> & { code?: string }; return (err.code && fsText[err.code]) || err.message || String(e) }

// ---- Engine ----

export type JobLive = { id: number, kind: Kind, done: number, size: number, speed: number, eta: number | null, finalizing: boolean }
export type LiveStats = {
  speed: Record<Kind, number>, history: number[], counts: Record<Kind, Record<Status, number>>, active: JobLive[],
  waitUntil: Record<Kind, number | null>,
}
export type EngineDeps = {
  db: DB, invoke: Td.Invoke, onUpdate: (fn: (u: Td.Update) => void) => () => void, auth: () => AuthState,
  chat: (id: number) => Chat | null, emit: Emit, paths: Paths, settings: () => StoredSettings,
  finished: (kind: Kind, ok: boolean) => void, // notifications
}
/** In-memory state of a job the engine is running (ARCHITECTURE > Transfer engine). */
export type Live = {
  job: JobRow, id: number, kind: Kind, size: number, done: number, speed: number, lastBytes: number, lastAt: number,
  lastProgressAt: number, stalls: number, attempts: number, finalizing: boolean, checking: boolean, fileIds: number[],
  target?: { dir: string, name: string }, uploaded?: Map<number, number>,
}
/** The engine internals uploads.ts runs on (written out: inferring it from createEngine would be circular). */
export type Core = {
  d: EngineDeps, live: Map<number, Live>, inFlight: Map<number, number>, isLive(l: Live): boolean, drop(l: Live): void,
  failed(l: Live, e: unknown): void, failJob(job: JobRow, attempts: number, done: number, e: unknown): void,
  invalidate(...topics: string[]): void, statsSoon(): void, pump(): void,
}

export function createEngine(d: EngineDeps) {
  const { db } = d
  const live = new Map<number, Live>()
  const inFlight = new Map<number, number>() // TDLib file id → job id: updateFile routing, same-file wait, cancel cleanup
  const waiting = new Map<number, number>() // queued job id → the in-flight file id it waits for
  const reserved = new Set<string>() // lowercased paths chosen by finalizes that have not completed yet
  const gates: Record<Kind, Gate> = { download: newGate(150), upload: newGate(250) }
  let history: number[] = []
  let pumpTimer: NodeJS.Timeout | undefined, statsTimer: NodeJS.Timeout | undefined
  let lastSample = 0, lastCleanup = 0, day = new Date().toDateString(), wasReady = false, wasOnline = false, stopped = false

  const invalidate = (...topics: string[]) => d.emit({ type: 'invalidate', topics })
  const chatTopics = (chats: number[]) => [...new Set(chats)].flatMap((c) => [`media:${c}`, `messages:${c}`])
  const isLive = (l: Live) => live.get(l.id) === l
  const saveDone = (l: Live) => db.prepare('UPDATE jobs SET done = ? WHERE id = ?').run(l.done, l.id)
  const statsSoon = () => { statsTimer ??= setTimeout(() => { statsTimer = undefined; d.emit({ type: 'stats', stats: liveStats() }) }, 100) }
  const statusChanged = (kind: Kind, chatId: number) => { invalidate('jobs', ...(kind === 'download' ? chatTopics([chatId]) : [])); statsSoon() }

  /** Forgets a job's live state; queued same-file siblings may start again. */
  function drop(l: Live) {
    if (!isLive(l)) return
    live.delete(l.id)
    for (const f of l.fileIds) {
      if (inFlight.get(f) === l.id) inFlight.delete(f)
      for (const [jobId, fileId] of waiting) if (fileId === f) waiting.delete(jobId)
    }
  }

  // ---- Pump ----

  function pump() {
    clearTimeout(pumpTimer)
    pumpTimer = undefined
    if (stopped || d.auth().step !== 'ready' || d.auth().connection === 'offline') return
    const s = d.settings(), now = Date.now()
    let wake = Infinity
    for (const kind of ['download', 'upload'] as const) {
      let free = (kind === 'download' ? s.maxDownloads : s.maxUploads) - [...live.values()].filter((l) => l.kind === kind && !l.finalizing).length
      if (free <= 0) continue
      const rows = db.prepare(`SELECT * FROM jobs WHERE kind = ? AND status = 'queued' ORDER BY position LIMIT ?`).all(kind, free + waiting.size) as JobRow[]
      for (const job of rows) {
        if (free <= 0) break
        if (waiting.has(job.id)) continue
        if (!gate.open(gates[kind], now)) { wake = Math.min(wake, Math.max(gates[kind].nextAt, gates[kind].waitUntil ?? 0)); break }
        gates[kind] = gate.started(gates[kind], now)
        free--
        begin(job)
      }
    }
    if (wake < Infinity) pumpTimer = setTimeout(pump, wake - now)
  }

  function begin(job: JobRow) {
    const now = Date.now()
    db.prepare(`UPDATE jobs SET status = 'active', attempts = attempts + 1, error = NULL WHERE id = ?`).run(job.id)
    const done = job.kind === 'download' ? job.done : 0 // an upload restarts its remaining files from zero
    const l: Live = { job, id: job.id, kind: job.kind, size: job.size, done, speed: 0, lastBytes: done, lastAt: now, lastProgressAt: now,
      stalls: 0, attempts: job.attempts + 1, finalizing: false, checking: false, fileIds: [] }
    live.set(job.id, l)
    statusChanged(job.kind, job.chat_id)
    void (job.kind === 'download' ? startDownload(l) : uploads.start(l))
  }

  // ---- Failure (both kinds, with or without live state) ----

  function failed(l: Live, e: unknown) {
    if (!isLive(l)) return // paused, canceled, or requeued meanwhile
    drop(l)
    failJob(l.job, l.attempts, l.done, e)
  }

  function failJob(job: JobRow, attempts: number, done: number, e: unknown) {
    const err = e as Partial<AppError> & { code?: unknown }
    const now = Date.now()
    if (err.status === 429 && err.retryAfter) { // flood: hold this kind; the job waits in its place without spending an attempt
      gates[job.kind] = gate.flooded(gates[job.kind], now, err.retryAfter)
      log('warn', `Telegram asked to wait ${err.retryAfter} s; ${job.kind}s are held until then`)
      db.prepare(`UPDATE jobs SET status = 'queued', attempts = MAX(0, attempts - 1), done = ? WHERE id = ? AND status = 'active'`).run(done, job.id)
    } else {
      if (err.status === undefined && typeof err.code !== 'string') log('error', `${job.kind} ${job.id} failed: ${(e as Error)?.stack ?? String(e)}`)
      const s = d.settings()
      const message = errorText(e)
      const retryAt = s.autoRetry && isRetryable(e) && attempts < s.retryAttempts ? now + retryDelay(attempts) : null
      const final = tx(db, () => {
        const changed = db.prepare(`UPDATE jobs SET status = 'failed', error = ?, retry_at = ?, finished_at = ?, done = ? WHERE id = ? AND status = 'active'`)
          .run(message, retryAt, now, done, job.id).changes
        if (changed && retryAt === null) addHistory(db, { kind: job.kind, status: 'failed', chatId: job.chat_id, chatTitle: job.chat_title,
          messageId: job.message_id, name: job.name, type: job.type, size: job.size, path: null, error: message, finishedAt: now })
        return changed > 0 && retryAt === null
      })
      if (final) { invalidate('history'); d.finished(job.kind, false) }
    }
    statusChanged(job.kind, job.chat_id)
    pump()
  }

  // ---- Downloads (ARCHITECTURE > Download steps 1–6) ----

  async function startDownload(l: Live) {
    const { job } = l
    try {
      const m = await d.invoke({ _: 'getMessage', chat_id: job.chat_id, message_id: job.message_id! }).catch((e: AppError) => {
        throw e.status === 404 ? fail(404, 'This message no longer exists', { final: true }) : e
      })
      const media = extractMedia(m)
      if (!media) throw fail(400, 'This message has no media to download', { final: true })
      // Stored file ids go stale (FileGram lesson): the remote id gives the current one.
      const file = media.file.remote.id
        ? await d.invoke({ _: 'getRemoteFile', remote_file_id: media.file.remote.id }).catch(() => media.file)
        : media.file
      if (!isLive(l)) return
      const owner = inFlight.get(file.id)
      if (owner !== undefined && owner !== job.id) {
        // ponytail: same-file siblings re-download after the first finishes (skipExisting usually completes them at once).
        drop(l)
        waiting.set(job.id, file.id)
        db.prepare(`UPDATE jobs SET status = 'queued', attempts = MAX(0, attempts - 1) WHERE id = ? AND status = 'active'`).run(job.id)
        return statusChanged('download', job.chat_id)
      }
      const s = d.settings()
      const dir = path.join(s.downloadRoot, folderFor(s.folderTemplate, { id: job.chat_id, title: job.chat_title }))
      // The template is checked where the folder really is, so a junction cannot aim it out of the root. `dir` itself
      // stays as written: it is what the Library scans, and history must speak the same path (ARCHITECTURE > Download step 6).
      if (!within(await realLocation(s.downloadRoot), await realLocation(dir))) throw fail(400, 'The folder template leads outside the download folder', { final: true }) // backstop
      l.target = { dir, name: fileName(media.name, m.date, s.datePrefix) }
      l.size = file.size || file.expected_size || l.size
      const existing = s.skipExisting && l.size > 0 ? await fs.promises.stat(path.join(dir, l.target.name)).catch(() => null) : null
      if (existing?.isFile() && existing.size === l.size) {
        // Skip existing: completes like any download (history, dedupe), without the move or Mark-of-the-Web.
        if (file.local.downloaded_size > 0 && !inFlight.has(file.id)) await d.invoke({ _: 'deleteFile', file_id: file.id }).catch(() => {})
        if (isLive(l)) await complete(l, path.join(dir, l.target.name))
        return
      }
      l.fileIds = [file.id]
      inFlight.set(file.id, job.id)
      if (file.local.is_downloading_completed) {
        if (file.local.path && fs.existsSync(file.local.path)) return finalize(l, file.local.path)
        await d.invoke({ _: 'deleteFile', file_id: file.id }).catch(() => {})
      }
      progress(l, file.local.downloaded_size)
      const res = await d.invoke({ _: 'downloadFile', file_id: file.id, priority: 32, offset: 0, limit: 0, synchronous: false })
      if (res && res.id) {
        inFlight.set(res.id, job.id)
        if (!l.fileIds.includes(res.id)) l.fileIds.push(res.id)
      }
      onFile(res)
    } catch (e) { failed(l, e) }
  }

  function progress(l: Live, bytes: number) {
    if (bytes > l.done) { l.done = bytes; l.lastProgressAt = Date.now(); l.stalls = 0 }
  }

  function onFile(f: Td.file) {
    const id = inFlight.get(f.id)
    const l = id === undefined ? undefined : live.get(id)
    if (!l || l.finalizing) return
    if (l.kind === 'upload') return uploads.progress(l, f)
    l.size = f.size || f.expected_size || l.size
    progress(l, f.local.downloaded_size)
    if (f.local.is_downloading_completed) void finalize(l, f.local.path)
  }

  async function finalize(l: Live, src: string) {
    if (l.finalizing || !l.target) return
    l.finalizing = true
    pump() // the slot is free while the file moves: a big cross-volume copy must not hold up the next download
    statsSoon()
    // Write where the folder really is: a junction planted while the file downloaded must not carry the file out of
    // the root, so the pair is resolved and checked again here (ARCHITECTURE > Download step 6). History keeps the
    // path the Library scans; the two name the same file, because that resolved folder is the target's real location.
    const dir = await realLocation(l.target.dir)
    if (!within(await realLocation(d.settings().downloadRoot), dir)) {
      return failed(l, fail(400, "The download folder points somewhere it shouldn't, so the file was not saved", { final: true }))
    }
    // A folder path near Windows' ceiling, or a name long enough to push the file past it, would fail the move halfway:
    // the name is cut to fit (the folder is not), and a folder that fits nothing is refused before the file is touched.
    const part = path.join(dir, `.teleflow-${l.id}.part`)
    const dest = fitName(dir, l.target.name, reserved)
    if (!dest || part.length > MAX_PATH) {
      return failed(l, fail(400, `The download folder path is too long to save a file in it (${Math.max(part.length, dir.length + 1)} characters). Pick a shorter folder in Settings.`, { final: true }))
    }
    const recorded = path.join(l.target.dir, path.basename(dest))
    reserved.add(dest.toLowerCase())
    try {
      await fs.promises.mkdir(dir, { recursive: true })
      await moveFile(src, dest, part)
    } catch (e) {
      reserved.delete(dest.toLowerCase())
      return failed(l, e) // the TDLib copy stays, so a retry finalizes without downloading again
    }
    // The file has its final name: nothing below fails the job. deleteFile keeps TDLib's database consistent
    // (FileGram lesson) and removes the source a cross-volume copy left behind.
    await d.invoke({ _: 'deleteFile', file_id: l.fileIds[0] }).catch((e: Error) => log('warn', `deleteFile after a download failed: ${e.message}`))
    await complete(l, recorded)
    reserved.delete(dest.toLowerCase())
  }

  /** One transaction marks the job completed and writes its history row; then the thumbnail and invalidations. */
  async function complete(l: Live, dest: string) {
    const { job } = l
    const now = Date.now()
    const historyId = tx(db, () => {
      db.prepare(`UPDATE jobs SET status = 'completed', path = ?, size = ?, done = ?, error = NULL, retry_at = NULL, finished_at = ? WHERE id = ?`)
        .run(dest, l.size, l.size, now, job.id)
      return addHistory(db, { kind: 'download', status: 'completed', chatId: job.chat_id, chatTitle: job.chat_title, messageId: job.message_id,
        name: path.basename(dest), type: job.type, size: l.size, path: dest, error: null, finishedAt: now })
    })
    drop(l)
    await saveThumb(job.thumb, historyId)
    await libraryAdded(d.settings().downloadRoot, dest)
    invalidate('jobs', 'history', 'library', ...chatTopics([job.chat_id]))
    d.finished('download', true)
    statsSoon()
    pump()
  }

  async function saveThumb(remoteId: string | null, historyId: number) {
    if (!remoteId) return
    try {
      let f = await d.invoke({ _: 'getRemoteFile', remote_file_id: remoteId })
      if (!f.local.is_downloading_completed) f = await d.invoke({ _: 'downloadFile', file_id: f.id, priority: 32, offset: 0, limit: 0, synchronous: true })
      await fs.promises.mkdir(d.paths.thumbs, { recursive: true })
      await fs.promises.copyFile(f.local.path, path.join(d.paths.thumbs, `${historyId}.jpg`))
    } catch (e) { log('warn', `Saving a thumbnail failed: ${(e as Error).message}`) }
  }

  /** Pause or cancel of a running download: progress is kept on pause; cancel also deletes TDLib's partial data. */
  function stopDownload(l: Live, deleteData: boolean) {
    drop(l)
    saveDone(l)
    const file_id = l.fileIds[0]
    if (file_id === undefined) return
    void (async () => {
      await d.invoke({ _: 'cancelDownloadFile', file_id, only_if_pending: false })
      if (deleteData && !inFlight.has(file_id)) await d.invoke({ _: 'deleteFile', file_id })
    })().catch((e: Error) => log('warn', `Stopping a download failed: ${e.message}`))
  }

  /** Canceled downloads with no live state that transferred data: their TDLib partial data, in the background. */
  async function cleanupCanceled(rows: JobRow[]) {
    // ponytail: partial data stays until Clear cache when Telegram is not ready; upgrade: retry on the next ready.
    if (!rows.length || d.auth().step !== 'ready') return
    const byChat = Map.groupBy(rows, (r) => r.chat_id)
    for (const [chat_id, list] of byChat) {
      const ids = list.map((r) => r.message_id!)
      for (let i = 0; i < ids.length; i += 100) {
        try {
          const { messages } = await d.invoke({ _: 'getMessages', chat_id, message_ids: ids.slice(i, i + 100) })
          for (const m of messages) {
            const f = m && extractMedia(m)?.file
            if (f && !inFlight.has(f.id)) await d.invoke({ _: 'deleteFile', file_id: f.id }).catch(() => {})
          }
        } catch {} // a failed batch is left for the next Clear cache
      }
    }
  }

  async function checkStall(l: Live, now: number) {
    const s = d.settings()
    const flooding = (gates.download.waitUntil ?? 0) > now // FileGram lesson: re-asserting into a flood only stretches it
    const decision = stallDecision({ online: d.auth().connection === 'ready' && !flooding, idleMs: now - l.lastProgressAt,
      stallMs: s.stallSeconds * 1000, stalls: l.stalls, attempts: l.attempts, maxAttempts: s.retryAttempts })
    if (decision === 'skip') l.lastProgressAt = now // an outage does not count toward a stall
    const file_id = l.fileIds[0]
    if (decision === 'skip' || decision === 'wait' || file_id === undefined) return
    l.lastProgressAt = now
    l.checking = true
    try {
      const f = await d.invoke({ _: 'getFile', file_id }).catch(() => null)
      if (!isLive(l) || l.finalizing) return
      const prevDone = l.done
      if (f) onFile(f)
      if (f?.local.is_downloading_completed) return void finalize(l, f.local.path)
      if (l.done > prevDone) return // Progress was made: actively transferring data, not stalled
      if (f && !f.local.can_be_downloaded) return failed(l, fail(403, "Telegram doesn't allow downloading this file", { final: true }))
      if (decision === 'fail') return failed(l, fail(500, 'Download keeps stalling', { final: true }))
      if (decision === 'reassert') {
        l.stalls++
        log('warn', `Download ${l.id} stalled; asking TDLib again (${l.stalls})`)
        const res = await d.invoke({ _: 'downloadFile', file_id, priority: 32, offset: 0, limit: 0, synchronous: false })
        if (res && res.id) {
          inFlight.set(res.id, l.id)
          if (!l.fileIds.includes(res.id)) l.fileIds.push(res.id)
        }
        onFile(res)
        return
      }
      // Third stall in a row: restart in the same queue position; the next start counts as an attempt.
      log('warn', `Download ${l.id} keeps stalling; restarting it`)
      drop(l)
      saveDone(l)
      await d.invoke({ _: 'cancelDownloadFile', file_id, only_if_pending: false }).catch(() => {})
      db.prepare(`UPDATE jobs SET status = 'queued' WHERE id = ? AND status = 'active'`).run(l.id)
      statusChanged('download', l.job.chat_id)
      pump()
    } catch (e) {
      const err = e as AppError
      if (err.status === 429 && err.retryAfter) gates.download = gate.flooded(gates.download, Date.now(), err.retryAfter)
      else log('warn', `Stall check for download ${l.id} failed: ${err.message}`)
    } finally { l.checking = false }
  }

  /** Interrupted downloads go back to the queue in their old place; a finalizing one finishes on its own. */
  function requeueActiveDownloads() {
    const finalizing: number[] = []
    for (const l of [...live.values()]) {
      if (l.kind !== 'download') continue
      if (l.finalizing) { finalizing.push(l.id); continue }
      drop(l)
      saveDone(l)
    }
    waiting.clear()
    const rows = db.prepare(`UPDATE jobs SET status = 'queued' WHERE kind = 'download' AND status = 'active'
      AND id NOT IN (SELECT value FROM json_each(?)) RETURNING chat_id`).all(JSON.stringify(finalizing)) as { chat_id: number }[]
    if (rows.length) { invalidate('jobs', ...chatTopics(rows.map((r) => r.chat_id))); statsSoon() }
  }

  // ---- Tick, live stats ----

  const busy = (now: number) => live.size > 0 || history.some((v) => v > 0)
    || (['download', 'upload'] as const).some((k) => (gates[k].waitUntil ?? 0) > now)

  function liveStats(): LiveStats {
    const now = Date.now()
    const ls = [...live.values()]
    const speed = (k: Kind) => ls.filter((l) => l.kind === k).reduce((s, l) => s + l.speed, 0)
    const wait = (k: Kind) => ((gates[k].waitUntil ?? 0) > now ? gates[k].waitUntil : null)
    return {
      speed: { download: speed('download'), upload: speed('upload') }, history: [...history], counts: jobCounts(db),
      active: ls.map((l) => ({ id: l.id, kind: l.kind, done: l.done, size: l.size, speed: l.speed,
        eta: l.speed > 0 ? Math.max(0, (l.size - l.done) / l.speed) : null, finalizing: l.finalizing })),
      waitUntil: { download: wait('download'), upload: wait('upload') },
    }
  }

  function tick() {
    const now = Date.now()
    const wasBusy = busy(now)
    for (const l of live.values()) {
      const dt = (now - l.lastAt) / 1000
      if (dt > 0) { l.speed = 0.7 * l.speed + 0.3 * Math.max(0, (l.done - l.lastBytes) / dt); l.lastBytes = l.done; l.lastAt = now }
      if (l.kind === 'download') {
        // Periodically persist progress to SQLite so abrupt power loss or process kill retains downloaded bytes
        if (now - ((l as any).lastSavedAt ?? 0) >= 3000 && l.done !== (l as any).lastSavedDone) {
          ;(l as any).lastSavedAt = now
          ;(l as any).lastSavedDone = l.done
          saveDone(l)
        }
        if (!l.finalizing && !l.checking) void checkStall(l, now)
      }
    }
    if (now - lastSample >= 1000) {
      lastSample = now
      // Zeros keep being sampled until 60 in a row, so the idle sparkline drains to flat.
      if (wasBusy) history = [...history, [...live.values()].reduce((s, l) => s + l.speed, 0)].slice(-60)
    }
    for (const k of ['download', 'upload'] as const) {
      if (gates[k].waitUntil !== null && now >= gates[k].waitUntil!) { gates[k] = { ...gates[k], waitUntil: null }; pump() }
    }
    const due = db.prepare(`UPDATE jobs SET status = 'queued', retry_at = NULL, error = NULL, finished_at = NULL
      WHERE status = 'failed' AND retry_at IS NOT NULL AND retry_at <= ? RETURNING kind, chat_id`).all(now) as { kind: Kind, chat_id: number }[]
    if (due.length) { invalidate('jobs', ...chatTopics(due.filter((r) => r.kind === 'download').map((r) => r.chat_id))); statsSoon(); pump() }
    const today = new Date(now).toDateString()
    if (today !== day) { day = today; invalidate('history') } // Completed Today rolls over at local midnight
    if (now - lastCleanup >= 60_000) {
      lastCleanup = now
      const days = d.settings().clearCompletedDays
      const old = days ? db.prepare(`DELETE FROM jobs WHERE status = 'completed' AND finished_at < ? RETURNING kind, chat_id`)
        .all(now - days * 86_400_000) as { kind: Kind, chat_id: number }[] : []
      if (old.length) invalidate('jobs', ...chatTopics(old.filter((r) => r.kind === 'download').map((r) => r.chat_id)))
    }
    if (wasBusy || busy(now)) d.emit({ type: 'stats', stats: liveStats() })
  }
  const timer = setInterval(tick, 500)
  timer.unref?.()

  // ---- Adding and acting on jobs ----

  /** Media rows of one chat → download jobs. Without `force`, downloaded items are skipped (dedupe after Clear Completed). */
  function addDownloads(chatId: number, rows: MediaRow[], force = false) {
    const title = d.chat(chatId)?.title ?? ''
    const states = downloadStates(db, chatId, rows.map((r) => r.messageId))
    const fresh = force ? rows : rows.filter((r) => states.get(r.messageId)?.status !== 'downloaded')
    const ids = enqueue(db, fresh.map((r) => ({ kind: 'download' as const, chatId, chatTitle: title, messageId: r.messageId,
      name: r.name, type: r.type, size: r.size, thumb: r.thumb })), force)
    if (ids.length) { invalidate('jobs', ...chatTopics([chatId])); statsSoon(); pump() }
    return { added: ids.length, skipped: rows.length - ids.length }
  }

  /** downloads.add `{ items }`: display data from the media index, else getMessages (100 per call). Items that
   *  cannot be resolved (deleted, no media) count as skipped. */
  async function addItems(items: { chatId: number, messageId: number }[], force: boolean) {
    const byChat = Map.groupBy(items, (i) => i.chatId)
    for (const chatId of byChat.keys()) {
      if (!d.chat(chatId)) {
        await d.invoke({ _: 'getChat', chat_id: chatId }).catch(() => null)
        if (!d.chat(chatId)) throw fail(404, 'Chat not found')
      }
    }
    let added = 0
    for (const [chatId, list] of byChat) {
      const ids = [...new Set(list.map((i) => i.messageId))]
      const known = new Map<number, MediaRow>(mediaByIds(db, chatId, ids))
      const missing = ids.filter((id) => !known.has(id))
      for (let i = 0; i < missing.length; i += 100) {
        const { messages } = await d.invoke({ _: 'getMessages', chat_id: chatId, message_ids: missing.slice(i, i + 100) })
        for (const m of messages) { const x = m && extractMedia(m); if (m && x) known.set(m.id, mediaRow(chatId, m, x)) }
      }
      added += addDownloads(chatId, ids.flatMap((id) => known.get(id) ?? []), force).added
    }
    return { added, skipped: items.length - added }
  }

  /** Checks disk and history for exact duplicates (filename + byte size + duration) before downloading */
  async function checkDuplicates(a: { items?: { chatId: number, messageId: number }[], chatId?: number, filters?: MediaFilters, link?: string }) {
    let candidates: { chatId: number, messageId: number, name: string, size: number, duration: number, date: number }[] = []
    let targetChatId = a.chatId ?? 0

    if ('link' in a && a.link) {
      const linkInfo = await d.invoke({ _: 'getInternalLinkType', link: a.link.trim() }).catch(() => null) as any
      if (linkInfo?.url) {
        const msgInfo = await d.invoke({ _: 'getMessageLinkInfo', url: linkInfo.url }).catch(() => null) as any
        if (msgInfo?.chat_id && msgInfo.message && extractMedia(msgInfo.message)) {
          targetChatId = msgInfo.chat_id
          const x = extractMedia(msgInfo.message)!
          candidates.push({ chatId: msgInfo.chat_id, messageId: msgInfo.message.id, name: x.name, size: x.size, duration: x.duration, date: msgInfo.message.date })
        }
      }
    } else if ('filters' in a && a.chatId) {
      targetChatId = a.chatId
      const mediaItems = mediaQuery(db, a.chatId, a.filters ?? {}).items
      candidates = mediaItems.map((m) => ({
        chatId: m.chatId, messageId: m.messageId, name: m.name, size: m.size, duration: m.duration, date: m.date,
      }))
    } else if (a.items && a.items.length) {
      targetChatId = a.items[0]?.chatId ?? 0
      const byChat = Map.groupBy(a.items, (i) => i.chatId)
      for (const [chatId, list] of byChat) {
        const ids = [...new Set(list.map((i) => i.messageId))]
        const known = new Map<number, MediaRow>(mediaByIds(db, chatId, ids))
        const missing = ids.filter((id) => !known.has(id))
        for (let i = 0; i < missing.length; i += 100) {
          try {
            const { messages } = await d.invoke({ _: 'getMessages', chat_id: chatId, message_ids: missing.slice(i, i + 100) })
            for (const m of messages) {
              const x = m && extractMedia(m)
              if (m && x) known.set(m.id, mediaRow(chatId, m, x))
            }
          } catch {}
        }
        for (const item of list) {
          const row = known.get(item.messageId)
          if (row) {
            candidates.push({
              chatId, messageId: item.messageId, name: row.name, size: row.size, duration: row.duration, date: row.date,
            })
          }
        }
      }
    }

    const s = d.settings()
    const chat = targetChatId ? d.chat(targetChatId) : null
    const targetDir = chat
      ? path.join(s.downloadRoot, folderFor(s.folderTemplate, { id: chat.id, title: chat.title }))
      : s.downloadRoot

    let filesScanned = 0
    const diskFiles = new Map<string, string[]>()

    try {
      if (fs.existsSync(targetDir)) {
        const entries = await fs.promises.readdir(targetDir, { recursive: true, withFileTypes: true })
        for (const dirent of entries) {
          if (dirent.isFile()) {
            const full = path.join(dirent.parentPath || (dirent as any).path || targetDir, dirent.name)
            if (dirent.name.startsWith('.') || /^(desktop\.ini|thumbs\.db)$/i.test(dirent.name)) continue
            filesScanned++
            const lower = dirent.name.toLowerCase()
            const existing = diskFiles.get(lower)
            if (existing) existing.push(full)
            else diskFiles.set(lower, [full])
          }
        }
      }
    } catch (e: any) {
      log('warn', `Disk dedupe scan of ${targetDir} failed: ${e.message}`)
    }

    const historyRows = db.prepare(`SELECT chat_id, message_id, name, size, path FROM history WHERE kind = 'download' AND status = 'completed' AND path IS NOT NULL`).all() as { chat_id: number, message_id: number, name: string, size: number, path: string }[]
    const historyMap = new Map<string, { path: string, size: number }>()
    for (const h of historyRows) {
      historyMap.set(`${h.chat_id}:${h.message_id}`, { path: h.path, size: h.size })
    }

    const duplicates: Array<{ chatId: number, messageId: number, name: string, size: number, duration: number, diskPath: string }> = []
    const willDownload: Array<{ chatId: number, messageId: number, name: string, size: number, duration: number }> = []
    let skippedBytes = 0

    for (const item of candidates) {
      const targetName = fileName(item.name, item.date || Math.floor(Date.now() / 1000), s.datePrefix)
      const lower = targetName.toLowerCase()
      let matchedPath: string | null = null

      const diskMatches = diskFiles.get(lower) ?? []
      for (const p of diskMatches) {
        try {
          const st = await fs.promises.stat(p)
          if (st.isFile() && (item.size === 0 || st.size === item.size)) {
            matchedPath = p
            break
          }
        } catch {}
      }

      if (!matchedPath) {
        const hist = historyMap.get(`${item.chatId}:${item.messageId}`)
        if (hist) {
          try {
            const st = await fs.promises.stat(hist.path)
            if (st.isFile() && (item.size === 0 || st.size === item.size)) {
              matchedPath = hist.path
            }
          } catch {}
        }
      }

      if (matchedPath) {
        duplicates.push({
          chatId: item.chatId,
          messageId: item.messageId,
          name: item.name,
          size: item.size,
          duration: item.duration,
          diskPath: matchedPath,
        })
        skippedBytes += item.size
      } else {
        willDownload.push(item)
      }
    }

    return {
      scannedPath: targetDir,
      filesScanned,
      totalSelected: candidates.length,
      onDiskCount: duplicates.length,
      willDownloadCount: willDownload.length,
      skippedBytes,
      duplicates,
      willDownload,
    }
  }

  function action(a: Action, ids?: number[]) {
    const rows = jobsAction(db, a, ids)
    const stale: JobRow[] = []
    for (const r of rows) {
      const l = live.get(r.id)
      if (a === 'cancel') waiting.delete(r.id)
      if (a !== 'pause' && a !== 'cancel') continue
      if (l && !l.finalizing) { // a finalizing download completes anyway: its file already has its final name
        if (l.kind === 'download') stopDownload(l, a === 'cancel')
        else void uploads.stop(l, r, a === 'cancel' ? 'deleted' : 'paused')
      } else if (a === 'cancel' && !l) {
        if (r.kind === 'upload') uploads.forget(r)
        else if (r.status !== 'completed' && (r.attempts > 0 || r.done > 0)) stale.push(r)
      }
    }
    void cleanupCanceled(stale)
    if (rows.length) { invalidate('jobs', ...chatTopics(rows.filter((r) => r.kind === 'download').map((r) => r.chat_id))); statsSoon() }
    pump()
    return { changed: rows.length }
  }

  const core: Core = { d, live, inFlight, isLive, drop, failed, failJob, invalidate, statsSoon, pump }
  const uploads = createUploads(core)
  d.onUpdate((u) => { if (u._ === 'updateFile') onFile(u.file); else uploads.onUpdate(u) })

  return {
    pump, action, addDownloads, addItems, addUploads: uploads.add, checkDuplicates, liveStats, requeueActiveDownloads,
    /** Startup step 6, before TDLib starts: interrupted downloads requeued, upload routing rebuilt from pending ids. */
    recover() { requeueActiveDownloads(); uploads.rebuildRoutes() },
    /** Main forwards every auth event; entering and leaving `ready` drive recovery, requeue, and the pump. */
    onAuth(a: AuthState) {
      const ready = a.step === 'ready'
      const online = a.connection === 'ready'
      if (ready !== wasReady) {
        wasReady = ready
        if (ready) { void uploads.ready(); pump() } else { requeueActiveDownloads(); uploads.leftReady() }
      } else if (ready && online && !wasOnline) {
        // Network recovered after an outage: trigger upload recovery and pump queues
        void uploads.ready()
        pump()
      }
      wasOnline = online
    },
    /** Quit: live progress persisted; active uploads settle and go back to queued (Upload step 6). */
    async quit() {
      stopped = true
      clearInterval(timer)
      clearTimeout(pumpTimer)
      clearTimeout(statsTimer)
      for (const l of live.values()) if (l.kind === 'download') saveDone(l)
      await uploads.quit()
    },
  }
}
export type Engine = ReturnType<typeof createEngine>
