// Upload flow (ARCHITECTURE > Transfer engine > Upload steps 1–6): grouping, sending, routing results by temporary
// message id, settling, pause/cancel/quit, crash recovery. Split from transfers.ts by the 400-line rule; runs on its Core.
import fs from 'node:fs'
import path from 'node:path'
import tdl from 'tdl'
import type * as Td from 'tdlib-types'
import { addHistory, enqueue, fail, jobRow, type JobRow, tx, type UploadFile } from './db.ts'
import { type Chat, extractMedia, tdError } from './shapes.ts'
import { retainStreamingFile } from './telegram.ts'
import { log } from './storage.ts'
import type { Core, Live } from './transfers.ts'

type UploadType = UploadFile['type']
const exts = { photo: /^(jpe?g|png|webp)$/, video: /^(mp4|mov|m4v|webm|mkv)$/, audio: /^(mp3|m4a|aac|ogg|flac|wav)$/ }

/** photo (jpg/jpeg/png/webp up to 10 MB), video, audio, else document; photos and videos the chat does not allow go as documents. */
export function uploadKind(name: string, size: number, allow: { photos: boolean, videos: boolean }): UploadType {
  const ext = path.extname(name).slice(1).toLowerCase()
  if (exts.photo.test(ext) && size <= 10 * 2 ** 20) return allow.photos ? 'photo' : 'document'
  if (exts.video.test(ext)) return allow.videos ? 'video' : 'document'
  return exts.audio.test(ext) ? 'audio' : 'document'
}

/** The jobs of one uploads.add: with `album`, consecutive runs of one class (photo/video, audio, document) go in albums
 *  of up to 10; everything else is one job per file. */
export function groupUploads(files: { path: string, name: string, size: number }[], o: { album: boolean, photos: boolean, videos: boolean }) {
  const cls = (t: UploadType) => (t === 'video' ? 'photo' : t)
  const groups: UploadFile[][] = []
  for (const f of files) {
    const file: UploadFile = { ...f, type: uploadKind(f.path, f.size, o) }
    const g = groups.at(-1)
    if (o.album && g && g.length < 10 && cls(g[0].type) === cls(file.type)) g.push(file)
    else groups.push([file])
  }
  return groups
}

export const jobName = (files: UploadFile[]) => (files.length > 1 ? `${files[0].name} + ${files.length - 1} more` : files[0]?.name ?? '')
const jobType = (files: UploadFile[]) => (files.length > 1 ? 'album' : files[0]?.type ?? 'document')
const total = (files: UploadFile[]) => files.reduce((s, f) => s + f.size, 0)

/** Part of a job failed: sent files leave it (the caller writes their history rows), the rest stay for Retry, so nothing
 *  is posted twice; the caption goes when the first file, which carried it, was sent. */
export function settleUpload(job: { files: UploadFile[], caption: string | null }) {
  const sent = job.files.filter((f) => f.messageId)
  const files = job.files.filter((f) => !f.messageId).map(({ pendingId: _, ...f }) => f)
  return { sent, files, name: jobName(files), type: jobType(files), size: total(files), caption: job.files[0]?.messageId ? null : job.caption }
}

/** TDLib 1.8.66 input shapes: the file sits in a nested inputPhoto/inputVideo/inputAudio/inputDocument. */
function content(f: UploadFile, file: string, caption: string | null): Td.InputMessageContent$Input {
  const local = { _: 'inputFileLocal' as const, path: file }
  const cap = caption ? { caption: { _: 'formattedText' as const, text: caption } } : {}
  switch (f.type) {
    case 'photo': return { _: 'inputMessagePhoto', photo: { _: 'inputPhoto', photo: local }, ...cap }
    case 'video': return { _: 'inputMessageVideo', video: { _: 'inputVideo', video: local, supports_streaming: true }, ...cap }
    case 'audio': return { _: 'inputMessageAudio', audio: { _: 'inputAudio', audio: local }, ...cap }
    default: return { _: 'inputMessageDocument', document: { _: 'inputDocument', document: local }, ...cap }
  }
}

/** Not retried automatically: Telegram may have posted the file before the crash or sign-out. */
export const interrupted = () => fail(409, 'Interrupted. Check the chat before retrying', { final: true })
const pad = (n: number) => String(n).padStart(2, '0')
const stamp = (d: Date) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`

export function createUploads(core: Core) {
  const { d, live, inFlight } = core
  const { db } = d
  const route = new Map<string, { jobId: number, index: number }>() // chat + temporary message id → its file
  const routeKey = (chatId: number, messageId: number) => `${chatId}:${messageId}`
  const sending = new Map<number, number>()
  const starting = new Set<number>()
  const early = new Map<string, { messageId: number | null, error: unknown }>()
  const errors = new Map<number, unknown>() // first send error per job, until the job settles
  const tmpDir = (id: number) => path.join(d.paths.tmp, String(id))
  const filesOf = (job: JobRow): UploadFile[] => JSON.parse(job.files ?? '[]')
  const saveFiles = (id: number, files: UploadFile[]) => db.prepare('UPDATE jobs SET files = ? WHERE id = ?').run(JSON.stringify(files), id)
  // The posted file's history row records its original source path (bug 34): the protocol serves a
  // recorded upload by that path, and the file id is retained so a renamed (tmp) upload still plays
  // after tmp\<jobId> is removed. Both records keep just-uploaded media playable without a re-download.
  const history = (job: JobRow, f: UploadFile, now: number) => {
    if (f.fileId && f.path) retainStreamingFile(f.fileId, f.path, f.size)
    return addHistory(db, { kind: 'upload', status: 'completed', chatId: job.chat_id,
      chatTitle: job.chat_title, messageId: f.messageId ?? null, name: f.name, type: f.type, size: f.size, path: f.path, error: null, finishedAt: now })
  }
  const removeTmp = (id: number) => void fs.promises.rm(tmpDir(id), { recursive: true, force: true })
    .catch((e: Error) => log('warn', `Removing tmp\\${id} failed: ${e.message}`))
  const deletePending = (chat_id: number, message_ids: number[]) => message_ids.length && d.auth().step === 'ready'
    ? d.invoke({ _: 'deleteMessages', chat_id, message_ids, revoke: true }).then(() => {}, (e: Error) => log('warn', `Deleting pending messages failed: ${e.message}`))
    : Promise.resolve()

  /** uploads.add after its checks: one job per group; with keepNames off each file is posted as Mediagram_<time>_<n>.<ext>. */
  function add(chat: Chat, files: { path: string, name: string, size: number }[], o: { caption: string, album: boolean, keepNames: boolean, photos: boolean, videos: boolean }) {
    const at = stamp(new Date())
    let n = 0
    const groups = groupUploads(files, o).map((g) => g.map((f) => (o.keepNames ? f : { ...f, name: `Mediagram_${at}_${++n}${path.extname(f.path).toLowerCase()}` })))
    const ids = enqueue(db, groups.map((g, i) => ({ kind: 'upload' as const, chatId: chat.id, chatTitle: chat.title, messageId: null, name: jobName(g),
      type: jobType(g), size: total(g), files: g, caption: i === 0 && o.caption ? o.caption : null })))
    core.invalidate('jobs')
    core.statsSoon()
    core.pump()
    // Each input file to the job it landed in (the album grouping is backend logic, so the renderer
    // cannot work it out). A plain record rather than a Map: this crosses the IPC bridge, where the
    // renderer reads it as an object. It lets a caller bind an optimistic row to its real job, so
    // cancel hits that job and progress comes from the live bytes instead of a guess.
    const byPath: Record<string, number> = {}
    groups.forEach((g, i) => { if (ids[i] !== undefined) for (const f of g) byPath[f.path] = ids[i] })
    return { added: files.length, ids, byPath }
  }

  /** The file TDLib reads: the original, or a hard link (a copy across volumes) under the posted name in tmp\<jobId>. */
  async function source(jobId: number, f: UploadFile) {
    if (f.name === path.basename(f.path)) return f.path
    const dest = path.join(tmpDir(jobId), f.name)
    await fs.promises.mkdir(tmpDir(jobId), { recursive: true })
    await fs.promises.rm(dest, { force: true })
    await fs.promises.link(f.path, dest).catch(() => fs.promises.copyFile(f.path, dest))
    return dest
  }

  async function start(l: Live) {
    const { job } = l
    starting.add(job.id)
    let sendingRegistered = false
    try {
      const files = filesOf(job)
      const todo = files.flatMap((f, i) => (f.messageId ? [] : [i]))
      for (const i of todo) {
        if (!(await fs.promises.stat(files[i].path).catch(() => null))?.isFile()) throw fail(400, `Source file is missing: ${path.basename(files[i].path)}`, { final: true })
      }
      const sources = await Promise.all(todo.map((i) => source(job.id, files[i])))
      l.size = todo.reduce((s, i) => s + files[i].size, 0)
      if (!core.isLive(l)) return // paused, canceled, or Telegram left ready during the copy: never also send
      const contents = todo.map((i, k) => content(files[i], sources[k], i === 0 ? job.caption : null))
      const options: Td.messageSendOptions$Input = { _: 'messageSendOptions', from_background: false }
      sending.set(job.chat_id, (sending.get(job.chat_id) ?? 0) + 1)
      sendingRegistered = true
      const sent = todo.length === 1
        ? [await d.invoke({ _: 'sendMessage', chat_id: job.chat_id, options, input_message_content: contents[0] })]
        : (await d.invoke({ _: 'sendMessageAlbum', chat_id: job.chat_id, options, input_message_contents: contents })).messages
      todo.forEach((i, k) => {
        const m = sent[k]
        if (!m) return
        files[i].pendingId = m.id
        route.set(routeKey(job.chat_id, m.id), { jobId: job.id, index: i })
        const f = extractMedia(m)?.file
        if (f) {
          files[i].fileId = f.id // settles retain the original source under this id (bug 34)
          if (core.isLive(l)) { inFlight.set(f.id, job.id); l.fileIds.push(f.id); progress(l, f) }
        }
      })
      saveFiles(job.id, files) // at once: the file index survives a crash even after part of the send succeeded
      const now = jobRow(db, job.id)
      if (!core.isLive(l) && now?.status !== 'active') await unsend(job.chat_id, job.id, files, !!now)
      else for (const m of sent) {
        if (!m) continue
        const key = routeKey(job.chat_id, m.id)
        const result = early.get(key)
        early.delete(key)
        if (result) settleFile(job.chat_id, m.id, result.messageId, result.error)
        else if (m.sending_state?._ === 'messageSendingStateFailed') {
          settleFile(job.chat_id, m.id, null, tdError(new tdl.TDLibError(m.sending_state.error.code, m.sending_state.error.message)))
          void deletePending(job.chat_id, [m.id])
        } else if (!m.sending_state) settleFile(job.chat_id, m.id, m.id, null)
      }
    } catch (e) { core.failed(l, e) }
    finally {
      starting.delete(job.id)
      if (sendingRegistered) {
        const remaining = (sending.get(job.chat_id) ?? 1) - 1
        if (remaining > 0) sending.set(job.chat_id, remaining)
        else {
          sending.delete(job.chat_id)
          for (const key of early.keys()) if (key.startsWith(`${job.chat_id}:`)) early.delete(key)
        }
      }
      core.pump()
    }
  }

  /** Clears pending ids (routing and, when the row exists, the stored files) and deletes those messages in Telegram. */
  async function unsend(chatId: number, jobId: number, files: UploadFile[], save: boolean) {
    const pending = files.flatMap((f) => (f.pendingId ? [f.pendingId] : []))
    for (const id of pending) route.delete(routeKey(chatId, id))
    for (const f of files) delete f.pendingId
    if (save) saveFiles(jobId, files)
    await deletePending(chatId, pending)
  }

  function progress(l: Live, f: Td.file) {
    const uploadedBytes = f.remote.is_uploading_completed ? (f.size || f.expected_size || f.remote.uploaded_size) : f.remote.uploaded_size
    const uploaded = (l.uploaded ??= new Map()).set(f.id, uploadedBytes)
    const done = Math.max(l.done, [...uploaded.values()].reduce((a, b) => a + b, 0))
    if (done > l.done) { l.done = done; l.lastProgressAt = Date.now() }
  }

  function result(chatId: number, pendingId: number, messageId: number | null, error: unknown) {
    if (settleFile(chatId, pendingId, messageId, error)) return true
    // TDLib can emit send results before sendMessage/Album resolves. Keep them until routing is persisted.
    if (sending.has(chatId)) { early.set(routeKey(chatId, pendingId), { messageId, error }); return true }
    return false
  }

  function onUpdate(u: Td.Update) {
    if (u._ === 'updateMessageSendSucceeded') result(u.message.chat_id, u.old_message_id, u.message.id, null)
    else if (u._ === 'updateMessageSendFailed') {
      if (result(u.message.chat_id, u.old_message_id, null, tdError(new tdl.TDLibError(u.error.code, u.error.message)))) void deletePending(u.message.chat_id, [u.message.id])
    } else if (u._ === 'updateDeleteMessages') {
      for (const id of u.message_ids) result(u.chat_id, id, null, fail(502, 'Telegram dropped the message before it was sent'))
    }
  }

  /** Each pending file settles once, and settling persists `files` right away. Returns whether the id was routed. */
  function settleFile(chatId: number, pendingId: number, messageId: number | null, error: unknown) {
    const key = routeKey(chatId, pendingId)
    const r = route.get(key)
    if (!r) return false
    route.delete(key)
    const job = jobRow(db, r.jobId)
    const files = job ? filesOf(job) : []
    const f = files[r.index]
    if (!job || f?.pendingId !== pendingId) return true
    delete f.pendingId
    if (messageId) f.messageId = messageId
    else if (!errors.has(job.id)) errors.set(job.id, error)
    saveFiles(job.id, files)
    if (!files.some((x) => x.pendingId)) settleJob({ ...job, files: JSON.stringify(files) })
    return true
  }

  /** No pending file left: all sent → completed with one history row per file; else the sent files leave the job
   *  (settleUpload) and it fails with the first error (a flood requeues it without spending an attempt). */
  function settleJob(job: JobRow, fallback: unknown = interrupted()) {
    const files = filesOf(job)
    const l = live.get(job.id)
    if (l) core.drop(l)
    const error = errors.get(job.id) ?? fallback
    errors.delete(job.id)
    const now = Date.now()
    if (files.every((f) => f.messageId)) {
      tx(db, () => {
        db.prepare(`UPDATE jobs SET status = 'completed', message_id = ?, done = size, error = NULL, retry_at = NULL, finished_at = ? WHERE id = ?`)
          .run(files[0].messageId!, now, job.id)
        for (const f of files) history(job, f, now)
      })
      removeTmp(job.id)
      core.invalidate('jobs', 'history', `messages:${job.chat_id}`)
      core.statsSoon()
      d.finished('upload', true)
      return core.pump()
    }
    const s = settleUpload({ files, caption: job.caption })
    tx(db, () => {
      for (const f of s.sent) history(job, f, now)
      db.prepare('UPDATE jobs SET files = ?, name = ?, type = ?, size = ?, done = 0, caption = ? WHERE id = ?')
        .run(JSON.stringify(s.files), s.name, s.type, s.size, s.caption, job.id)
    })
    if (s.sent.length) core.invalidate('history')
    core.failJob(jobRow(db, job.id) ?? job, l?.attempts ?? job.attempts, 0, error)
  }

  /** Pause, cancel, or quit of a running upload: sent files settle first, then the still-pending messages are deleted
   *  (which cancels TDLib's upload). Resume sends the remaining files from zero. `row` is the row after the action. */
  async function stop(l: Live, row: JobRow, mode: 'paused' | 'queued' | 'deleted') {
    core.drop(l)
    errors.delete(row.id)
    const files = filesOf(row)
    const pending = files.flatMap((f) => (f.pendingId ? [f.pendingId] : []))
    for (const id of pending) route.delete(routeKey(row.chat_id, id))
    const s = settleUpload({ files, caption: row.caption })
    const now = Date.now()
    tx(db, () => {
      for (const f of s.sent) history(row, f, now)
      if (mode !== 'deleted') {
        const preservedDone = Math.min(s.size, Math.max(row.done, l.done))
        db.prepare(`UPDATE jobs SET files = ?, name = ?, type = ?, size = ?, done = ?, caption = ?, status = ? WHERE id = ?`)
          .run(JSON.stringify(s.files), s.name, s.type, s.size, preservedDone, s.caption, mode, row.id)
      }
    })
    if (s.sent.length) core.invalidate('history')
    if (mode === 'deleted') removeTmp(row.id)
    await deletePending(row.chat_id, pending)
  }

  /** Cancel of an upload with no live state: no TDLib calls; files already posted still get their history rows. */
  function forget(row: JobRow) {
    const files = filesOf(row)
    for (const f of files) if (f.pendingId) route.delete(routeKey(row.chat_id, f.pendingId))
    const sent = files.filter((f) => f.messageId)
    const now = Date.now()
    if (sent.length) { tx(db, () => { for (const f of sent) history(row, f, now) }); core.invalidate('history') }
    removeTmp(row.id)
  }

  const activeUploads = () => db.prepare(`SELECT * FROM jobs WHERE kind = 'upload' AND status = 'active'`).all() as JobRow[]

  /** Startup (before TDLib starts) and every `ready`: updates TDLib sends while it resumes pending messages reach the right file. */
  function rebuildRoutes() {
    route.clear()
    for (const job of activeUploads()) filesOf(job).forEach((f, index) => { if (f.pendingId && !f.messageId) route.set(routeKey(job.chat_id, f.pendingId), { jobId: job.id, index }) })
  }

  /** On `ready`, restore live progress and concurrency slots for pending messages. Vanished or failed
   *  messages settle as "Interrupted"; uploads without pending messages settle immediately. */
  async function ready() {
    rebuildRoutes()
    const restored = new Set<number>()
    for (const [key, r] of [...route]) {
      const pendingId = Number(key.slice(key.indexOf(':') + 1))
      const job = jobRow(db, r.jobId)
      if (!job || (live.has(job.id) && !restored.has(job.id))) continue
      const m = await d.invoke({ _: 'getMessage', chat_id: job.chat_id, message_id: pendingId }).catch(() => null)
      if (d.auth().step !== 'ready') return // left ready again; the next ready runs this again
      if (m?.sending_state?._ === 'messageSendingStatePending') {
        const mediaFile = extractMedia(m)?.file
        if (mediaFile && jobRow(db, job.id)?.status === 'active' && route.has(key)) {
          const l = core.restoreUpload(job)
          restored.add(job.id)
          inFlight.set(mediaFile.id, job.id)
          if (!l.fileIds.includes(mediaFile.id)) l.fileIds.push(mediaFile.id)
          progress(l, mediaFile)
        }
        continue
      }
      if (m?.sending_state?._ === 'messageSendingStateFailed') void deletePending(job.chat_id, [pendingId])
      settleFile(job.chat_id, pendingId, null, interrupted())
    }
    for (const job of activeUploads()) if (!live.has(job.id) && !filesOf(job).some((f) => f.pendingId)) settleJob(job)
  }

  /** Leaving `ready`: in-memory upload state is dropped; rows stay active for the next `ready`. */
  function leftReady() {
    for (const l of [...live.values()]) if (l.kind === 'upload') core.drop(l)
    errors.clear()
  }

  async function quit() {
    const running = [...live.values()].filter((l) => l.kind === 'upload')
    await Promise.all(running.map((l) => { const row = jobRow(db, l.id); return row ? stop(l, row, 'queued') : undefined }))
  }

  return { add, start, progress, onUpdate, stop, forget, rebuildRoutes, ready, leftReady, quit, isStarting: (id: number) => starting.has(id) }
}
