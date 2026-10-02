// Upload flow (ARCHITECTURE > Transfer engine > Upload steps 1–6): grouping, sending, routing results by temporary
// message id, settling, pause/cancel/quit, crash recovery. Split from transfers.ts by the 400-line rule; runs on its Core.
import fs from 'node:fs'
import path from 'node:path'
import tdl from 'tdl'
import type * as Td from 'tdlib-types'
import { addHistory, enqueue, fail, jobRow, type JobRow, tx, type UploadFile } from './db.ts'
import { type Chat, extractMedia, tdError } from './shapes.ts'
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
  const route = new Map<number, { jobId: number, index: number }>() // temporary message id → its file
  const errors = new Map<number, unknown>() // first send error per job, until the job settles
  const tmpDir = (id: number) => path.join(d.paths.tmp, String(id))
  const filesOf = (job: JobRow): UploadFile[] => JSON.parse(job.files ?? '[]')
  const saveFiles = (id: number, files: UploadFile[]) => db.prepare('UPDATE jobs SET files = ? WHERE id = ?').run(JSON.stringify(files), id)
  const history = (job: JobRow, f: UploadFile, now: number) => addHistory(db, { kind: 'upload', status: 'completed', chatId: job.chat_id,
    chatTitle: job.chat_title, messageId: f.messageId ?? null, name: f.name, type: f.type, size: f.size, path: null, error: null, finishedAt: now })
  const removeTmp = (id: number) => void fs.promises.rm(tmpDir(id), { recursive: true, force: true })
    .catch((e: Error) => log('warn', `Removing tmp\\${id} failed: ${e.message}`))
  const deletePending = (chat_id: number, message_ids: number[]) => message_ids.length && d.auth().step === 'ready'
    ? d.invoke({ _: 'deleteMessages', chat_id, message_ids, revoke: true }).then(() => {}, (e: Error) => log('warn', `Deleting pending messages failed: ${e.message}`))
    : Promise.resolve()

  /** uploads.add after its checks: one job per group; with keepNames off each file is posted as TeleFlow_<time>_<n>.<ext>. */
  function add(chat: Chat, files: { path: string, name: string, size: number }[], o: { caption: string, album: boolean, keepNames: boolean, photos: boolean, videos: boolean }) {
    const at = stamp(new Date())
    let n = 0
    const groups = groupUploads(files, o).map((g) => g.map((f) => (o.keepNames ? f : { ...f, name: `TeleFlow_${at}_${++n}${path.extname(f.path).toLowerCase()}` })))
    enqueue(db, groups.map((g, i) => ({ kind: 'upload' as const, chatId: chat.id, chatTitle: chat.title, messageId: null, name: jobName(g),
      type: jobType(g), size: total(g), files: g, caption: i === 0 && o.caption ? o.caption : null })))
    core.invalidate('jobs')
    core.statsSoon()
    core.pump()
    return { added: files.length }
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
      const sent = todo.length === 1
        ? [await d.invoke({ _: 'sendMessage', chat_id: job.chat_id, input_message_content: contents[0] })]
        : (await d.invoke({ _: 'sendMessageAlbum', chat_id: job.chat_id, input_message_contents: contents })).messages
      todo.forEach((i, k) => {
        const m = sent[k]
        if (!m) return
        files[i].pendingId = m.id
        route.set(m.id, { jobId: job.id, index: i })
        const f = extractMedia(m)?.file
        if (f && core.isLive(l)) { inFlight.set(f.id, job.id); l.fileIds.push(f.id) }
      })
      saveFiles(job.id, files) // at once: the file index survives a crash even after part of the send succeeded
      const now = jobRow(db, job.id)
      if (!core.isLive(l) && now?.status !== 'active') await unsend(job.chat_id, job.id, files, !!now) // paused, canceled, or quit meanwhile
    } catch (e) { core.failed(l, e) }
  }

  /** Clears pending ids (routing and, when the row exists, the stored files) and deletes those messages in Telegram. */
  async function unsend(chatId: number, jobId: number, files: UploadFile[], save: boolean) {
    const pending = files.flatMap((f) => (f.pendingId ? [f.pendingId] : []))
    for (const id of pending) route.delete(id)
    for (const f of files) delete f.pendingId
    if (save) saveFiles(jobId, files)
    await deletePending(chatId, pending)
  }

  function progress(l: Live, f: Td.file) {
    const uploaded = (l.uploaded ??= new Map()).set(f.id, f.remote.uploaded_size)
    const done = [...uploaded.values()].reduce((a, b) => a + b, 0)
    if (done > l.done) { l.done = done; l.lastProgressAt = Date.now() }
  }

  function onUpdate(u: Td.Update) {
    if (u._ === 'updateMessageSendSucceeded') settleFile(u.old_message_id, u.message.id, null)
    else if (u._ === 'updateMessageSendFailed') {
      // The failed message has a new id; delete it so it does not linger in the chat as "failed to send".
      if (settleFile(u.old_message_id, null, tdError(new tdl.TDLibError(u.error.code, u.error.message)))) void deletePending(u.message.chat_id, [u.message.id])
    } else if (u._ === 'updateDeleteMessages') {
      // TDLib reports some failed sends as deletions; the message is already gone.
      for (const id of u.message_ids) settleFile(id, null, fail(502, 'Telegram dropped the message before it was sent'))
    }
  }

  /** Each pending file settles once, and settling persists `files` right away. Returns whether the id was routed. */
  function settleFile(pendingId: number, messageId: number | null, error: unknown) {
    const r = route.get(pendingId)
    if (!r) return false
    route.delete(pendingId)
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
      core.invalidate('jobs', 'history')
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
    for (const id of pending) route.delete(id)
    const s = settleUpload({ files, caption: row.caption })
    const now = Date.now()
    tx(db, () => {
      for (const f of s.sent) history(row, f, now)
      if (mode !== 'deleted') db.prepare(`UPDATE jobs SET files = ?, name = ?, type = ?, size = ?, done = 0, caption = ?, status = ? WHERE id = ?`)
        .run(JSON.stringify(s.files), s.name, s.type, s.size, s.caption, mode, row.id)
    })
    if (s.sent.length) core.invalidate('history')
    if (mode === 'deleted') removeTmp(row.id)
    await deletePending(row.chat_id, pending)
  }

  /** Cancel of an upload with no live state: no TDLib calls; files already posted still get their history rows. */
  function forget(row: JobRow) {
    const files = filesOf(row)
    for (const f of files) if (f.pendingId) route.delete(f.pendingId)
    const sent = files.filter((f) => f.messageId)
    const now = Date.now()
    if (sent.length) { tx(db, () => { for (const f of sent) history(row, f, now) }); core.invalidate('history') }
    removeTmp(row.id)
  }

  const activeUploads = () => db.prepare(`SELECT * FROM jobs WHERE kind = 'upload' AND status = 'active'`).all() as JobRow[]

  /** Startup (before TDLib starts) and every `ready`: updates TDLib sends while it resumes pending messages reach the right file. */
  function rebuildRoutes() {
    route.clear()
    for (const job of activeUploads()) filesOf(job).forEach((f, index) => { if (f.pendingId && !f.messageId) route.set(f.pendingId, { jobId: job.id, index }) })
  }

  /** Upload step 6 on `ready`: each still-unsettled pending id is looked up; vanished or failed ones settle as
   *  "Interrupted". Then every active upload with no live state and no pending id settles at once.
   *  ponytail: an upload TDLib resumes after a crash has no live state, so it shows no progress and holds no slot until
   *  it settles; upgrade: give it live state from getMessage (extractMedia(m).file.id into inFlight). */
  async function ready() {
    rebuildRoutes()
    for (const [pendingId, r] of [...route]) {
      const job = jobRow(db, r.jobId)
      if (!job || live.has(job.id)) continue
      const m = await d.invoke({ _: 'getMessage', chat_id: job.chat_id, message_id: pendingId }).catch(() => null)
      if (d.auth().step !== 'ready') return // left ready again; the next ready runs this again
      if (m?.sending_state?._ === 'messageSendingStatePending') continue
      if (m?.sending_state?._ === 'messageSendingStateFailed') void deletePending(job.chat_id, [pendingId])
      settleFile(pendingId, null, interrupted())
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

  return { add, start, progress, onUpdate, stop, forget, rebuildRoutes, ready, leftReady, quit }
}
