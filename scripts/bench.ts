// Media index benchmarks: run before and after a change and compare the printed tables.
//   node scripts/bench.ts                    # all three, defaults
//   node scripts/bench.ts scan 3 25          # runs=3, simulated TDLib round-trip 25 ms
//   node scripts/bench.ts scan 3 0           # local overhead only (no simulated latency)
//   node scripts/bench.ts media-db 5         # putMedia throughput, 200 000 rows per run
//   node scripts/bench.ts library 3          # download-folder scan, 10 000 files
// Every bench reports the median of `runs` iterations.
import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { performance } from 'node:perf_hooks'
import tdl from 'tdl'
import { type DB, type MediaRow, openDb, putMedia } from '../core/db.ts'
import { library, openLog, scanLibrary } from '../core/storage.ts'
import * as tg from '../core/telegram.ts'

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0
const fmt = (n: number) => (n >= 10_000 ? Math.round(n).toLocaleString('en-US') : n.toFixed(1))
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const temp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'mediagram-bench-'))

const TABLES: { name: string, rows: (string | number)[][] }[] = []
const table = (name: string, rows: (string | number)[][]) => TABLES.push({ name, rows })

// ---- 1. putMedia: the SQLite half of the index (core/db.ts) ----

const mediaRow = (i: number): MediaRow => ({
  chatId: -1, messageId: i, date: 1_700_000_000 + i, type: 'video', name: `Clip ${i}.mp4`, ext: 'mp4',
  size: 5_000_000 + i, duration: 30 + (i % 300), caption: `caption ${i}`, thumb: `remote-${i}`,
})

/** One walk: pages of 100, exactly the call pattern `runScan` uses. */
function walk(db: DB, rows: number) {
  const at = performance.now()
  for (let i = 0; i < rows; i += 100) {
    const page: MediaRow[] = []
    for (let k = i; k < Math.min(i + 100, rows); k++) page.push(mediaRow(k))
    putMedia(db, page)
  }
  return performance.now() - at
}

function benchMediaDb(runs: number, rows: number) {
  const dir = temp()
  const first: number[] = []
  for (let r = 0; r < runs; r++) {
    const file = path.join(dir, `walk-${r}.db`)
    const db = openDb(file)
    first.push(walk(db, rows))
    db.close()
    for (const suffix of ['', '-wal', '-shm']) fs.rmSync(file + suffix, { force: true })
  }
  // The overlap every top-up produces: the same rows again (the conflict path).
  const file = path.join(dir, 'rewalk.db')
  const db = openDb(file)
  walk(db, rows)
  const rewalk = walk(db, rows)
  db.close()
  fs.rmSync(dir, { recursive: true, force: true })

  const m = median(first)
  table('putMedia', [
    ['metric', 'value'],
    ['rows per run', rows.toLocaleString('en-US')],
    [`first walk (median of ${runs})`, `${fmt(m)} ms`],
    ['first walk throughput', `${fmt((rows / m) * 1000)} rows/s`],
    ['re-walk / upsert (conflict path)', `${fmt(rewalk)} ms`],
    ['re-walk throughput', `${fmt((rows / rewalk) * 1000)} rows/s`],
  ])
}

// ---- 2. The per-chat media index scan (core/telegram.ts) ----

type Req = Record<string, any> & { _: string }
const notFound = () => { throw new tdl.TDLibError(404, 'Not Found') }

class Fake extends EventEmitter {
  scanRpcs = 0
  closed = false
  constructor(options: Record<string, unknown>) { super(); void options }
  async invoke(req: Req) {
    if (req._ === 'getChatHistory' || req._ === 'searchChatMessages' || req._ === 'getChatMessageCount') this.scanRpcs++
    return answer(req)
  }
  async close() { await sleep(0); this.end() }
  end() { if (!this.closed) { this.closed = true; this.emit('close') } }
  update(u: object) { this.emit('update', u) }
}

let answer: (req: Req) => unknown = () => notFound()
let clients: Fake[] = []
Object.assign(tdl, { createClient: (o: Record<string, unknown>) => { const c = new Fake(o); clients.push(c); return c } })

/** The seven media content types, cycled over the media messages so the fixture matches a real chat. */
const KINDS = ['photo', 'video', 'document', 'audio', 'animation', 'voice', 'video_note'] as const
type Kind = (typeof KINDS)[number]
const file = (id: number) => ({ _: 'file', id, size: 1_000_000, expected_size: 1_000_000, remote: { id: `r${id}` } })
const content = (id: number, kind: Kind) => {
  const n = Math.floor(id / 2 ** 20)
  const name = { photo: `Photo_${n}.jpg`, video: `Video_${n}.mp4`, document: `f${id}.pdf`, audio: `Audio_${n}.mp3`,
    animation: `Animation_${n}.mp4`, voice: `Voice_${n}.ogg`, video_note: `VideoNote_${n}.mp4` }[kind]
  switch (kind) {
    case 'photo': return { _: 'messagePhoto', photo: { sizes: [{ type: 'm', width: 90, height: 90, photo: file(id) }] }, caption: { text: '' } }
    case 'video': return { _: 'messageVideo', video: { video: file(id), file_name: name, duration: 60 }, caption: { text: '' } }
    case 'document': return { _: 'messageDocument', document: { file_name: name, mime_type: 'application/pdf', document: file(id) }, caption: { text: '' } }
    case 'audio': return { _: 'messageAudio', audio: { audio: file(id), file_name: name, duration: 60 }, caption: { text: '' } }
    case 'animation': return { _: 'messageAnimation', animation: { animation: file(id), file_name: name, duration: 60 }, caption: { text: '' } }
    case 'voice': return { _: 'messageVoiceNote', voice_note: { voice: file(id), duration: 60 }, caption: { text: '' } }
    case 'video_note': return { _: 'messageVideoNote', video_note: { video: file(id), duration: 60 }, caption: { text: '' } }
  }
}
const filterKind: Record<string, Kind> = {
  searchMessagesFilterPhoto: 'photo', searchMessagesFilterVideo: 'video', searchMessagesFilterDocument: 'document',
  searchMessagesFilterAudio: 'audio', searchMessagesFilterAnimation: 'animation',
  searchMessagesFilterVoiceNote: 'voice', searchMessagesFilterVideoNote: 'video_note',
}
/** The `content._` of each kind, exactly what `content()` below builds. */
const contentType: Record<Kind, string> = {
  photo: 'messagePhoto', video: 'messageVideo', document: 'messageDocument', audio: 'messageAudio',
  animation: 'messageAnimation', voice: 'messageVoiceNote', video_note: 'messageVideoNote',
}

async function benchScan(runs: number, rtt: number, total: number, mediaRatio: number) {
  const home = temp()
  openLog(path.join(home, 'logs'))
  const chatId = -900_000
  const every = Math.max(1, Math.round(1 / mediaRatio))
  const mediaCount = Math.floor(total / every)
  const kinds = new Map<number, Kind>()
  let seen = 0
  for (let id = total; id >= 1; id--) if (id % every === 0) kinds.set(id, KINDS[seen++ % KINDS.length]!)
  const history = Array.from({ length: total }, (_, k) => {
    const id = total - k
    const kind = kinds.get(id)
    return { _: 'message', id, chat_id: chatId, date: id, sender_id: { _: 'messageSenderUser', user_id: 100 },
      media_album_id: '0', content: kind ? content(id, kind) : { _: 'messageText', text: { text: 'hi' } } }
  })

  const wait = () => (rtt ? sleep(rtt) : Promise.resolve())
  const auth = async (req: Req) => {
    if (req._ === 'getMe') return { _: 'user', id: 100, first_name: 'Bench', last_name: 'User', phone_number: '19995550123', is_premium: false }
    if (req._ === 'getOption') return { _: 'optionValueInteger', value: '2048' }
    if (req._ === 'setOption' || req._ === 'setNetworkType') return { _: 'optionValueBoolean', value: true }
    if (req._ === 'createPrivateChat') return { _: 'chat', id: 100, title: 'Saved', type: { _: 'chatTypePrivate', user_id: 100 }, positions: [], chat_lists: [], unread_count: 0 }
    return notFound()
  }

  const wall: number[] = []
  let scanRpcs = 0
  for (let r = 0; r < runs; r++) {
    const dbFile = path.join(home, `scan-${r}.db`)
    const db = openDb(dbFile)
    tg.init({ dir: path.join(home, 'tdlib'), version: '0.0.0', db, emit: () => {}, showArchived: () => false, forgetCredentials: () => {} })
    clients = []
    answer = async (req) => {
      if (req._ !== 'getChatHistory' && req._ !== 'searchChatMessages' && req._ !== 'getChatMessageCount') return auth(req)
      await wait()
      if (req._ === 'getChatMessageCount') return { _: 'count', count: Math.round(mediaCount / 7) }
      if (req._ === 'getChatHistory') { // the unfiltered walk every message passes through
        const from = req.from_message_id ? history.findIndex((m) => m.id === req.from_message_id) + 1 : 0
        return { _: 'messages', total_count: history.length, messages: history.slice(from, from + (req.limit || 100)) }
      }
      const kind = filterKind[req.filter?._]! // the media-only walk: only messages the filter selects
      const matches = history.filter((m) => m.content._ === contentType[kind])
      const page = matches.filter((m) => !req.from_message_id || m.id <= req.from_message_id).slice(0, req.limit || 100)
      return { _: 'foundChatMessages', total_count: matches.length, messages: page,
        next_from_message_id: page.length ? page[page.length - 1]!.id : 0 }
    }
    await tg.start({ apiId: 1, apiHash: 'a'.repeat(32) })
    const cl = clients[clients.length - 1]!
    cl.update({ _: 'updateAuthorizationState', authorization_state: { _: 'authorizationStateReady' } })
    for (let i = 0; i < 4000 && tg.authState().step !== 'ready'; i++) await sleep(1)
    if (tg.authState().step !== 'ready') throw new Error('never reached ready')
    cl.update({ _: 'updateNewChat', chat: { _: 'chat', id: chatId, title: 'Bench channel',
      type: { _: 'chatTypeSupergroup', supergroup_id: 1 }, unread_count: 0, chat_lists: [],
      positions: [{ _: 'chatPosition', list: { _: 'chatListMain' }, order: '1', is_pinned: false }],
      last_message: { id: total, date: total } } })

    const at = performance.now()
    tg.ensureScan(chatId)
    for (let i = 0; i < 120_000 && tg.scanInfo(chatId).state === 'scanning'; i++) await sleep(2)
    wall.push(performance.now() - at)
    const state = tg.scanInfo(chatId)
    if (state.state === 'scanning') throw new Error('the scan never finished')
    if (state.indexed !== mediaCount) throw new Error(`indexed ${state.indexed}, expected ${mediaCount}`)
    scanRpcs = cl.scanRpcs
    await tg.close()
    db.close()
    for (const suffix of ['', '-wal', '-shm']) fs.rmSync(dbFile + suffix, { force: true })
  }
  fs.rmSync(home, { recursive: true, force: true })

  const m = median(wall)
  table('media index scan', [
    ['metric', 'value'],
    ['messages in the chat', total.toLocaleString('en-US')],
    ['media messages (index rows)', mediaCount.toLocaleString('en-US')],
    ['media share', `${(mediaCount / total) * 100}%`],
    ['simulated TDLib round-trip', `${rtt} ms`],
    [`wall time (median of ${runs})`, `${fmt(m)} ms`],
    ['media-index TDLib calls per run', scanRpcs.toLocaleString('en-US')],
    ['messages walked per TDLib call', fmt(total / Math.max(1, scanRpcs))],
  ])
}

// ---- 3. The Library scan of the download folder (core/storage.ts) ----

async function benchLibrary(runs: number, files: number) {
  const root = path.join(os.tmpdir(), 'mediagram-bench-library')
  const perDir = 100
  const dirs = Math.ceil(files / perDir)
  if (!fs.existsSync(path.join(root, 'd0', 'file-0.mp4'))) {
    fs.rmSync(root, { recursive: true, force: true })
    for (let d = 0; d < dirs; d++) {
      const sub = path.join(root, `d${d}`)
      fs.mkdirSync(sub, { recursive: true })
      for (let f = 0; f < perDir; f++) fs.writeFileSync(path.join(sub, `file-${f}.mp4`), 'x')
    }
  }

  const cold: number[] = []
  for (let r = 0; r < runs; r++) {
    const at = performance.now()
    const entries = await scanLibrary(root)
    cold.push(performance.now() - at)
    if (entries.length !== files) throw new Error(`expected ${files} files, found ${entries.length}`)
  }
  const timed = async (fn: () => Promise<unknown>) => { const at = performance.now(); await fn(); return performance.now() - at }
  const first = await timed(() => library(root))
  const warm = await timed(() => library(root))
  const expired = await timed(() => library(root, Date.now() + 120_000))

  const m = median(cold)
  table('library scan', [
    ['metric', 'value'],
    ['files in the folder', files.toLocaleString('en-US')],
    [`full readdir + stat (median of ${runs})`, `${fmt(m)} ms`],
    ['throughput', `${fmt((files / m) * 1000)} files/s`],
    ['library() cold (fills the cache)', `${fmt(first)} ms`],
    ['library() warm (cache < 60 s)', `${fmt(warm)} ms`],
    ['library() after the 60 s TTL', `${fmt(expired)} ms`],
  ])
}

// ---- Run ----

async function main() {
  const which = process.argv[2] ?? 'all'
  const runs = Number(process.argv[3] ?? 3)
  const rtt = Number(process.argv[4] ?? 25)
  if (which === 'media-db') benchMediaDb(runs, 200_000)
  else if (which === 'scan') await benchScan(runs, rtt, 20_000, 0.1)
  else if (which === 'library') await benchLibrary(runs, 10_000)
  else {
    benchMediaDb(runs, 200_000)
    await benchScan(runs, rtt, 20_000, 0.1)
    await benchLibrary(runs, 10_000)
  }
  for (const t of TABLES) {
    console.log(`\n### ${t.name}`)
    const w = Math.max(...t.rows.map((r) => String(r[0]).length)) + 2
    for (const r of t.rows) console.log(String(r[0]).padEnd(w) + String(r[1]))
  }
}

main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1) })
