import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, mock, test } from 'node:test'
import { setImmediate as tick } from 'node:timers/promises'
import tdl from 'tdl'
import { type AppEvent, getScan, mediaCount, openDb, putMedia, putScan } from '../core/db.ts'
import { openLog } from '../core/storage.ts'
import * as tg from '../core/telegram.ts'

// tdl exports createClient as a plain writable property, so a fake client stands in for TDLib. setTimeout is mocked:
// the 5 s close and 15 s logout timeouts fire only when a test ticks them, and none outlives the run.
mock.timers.enable({ apis: ['setTimeout'] })
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'teleflow-'))
after(() => { mock.timers.reset(); fs.rmSync(temp, { recursive: true, force: true }) })
openLog(path.join(temp, 'logs'))

type Req = Record<string, any> & { _: string }
type Answer = (req: Req, cl: Fake) => unknown
const notFound = () => { throw new tdl.TDLibError(404, 'Not Found') }
let answer: Answer = notFound

class Fake extends EventEmitter {
  options: { apiId: number, apiHash: string, databaseDirectory: string, filesDirectory: string }
  requests: Req[] = []
  closed = false
  constructor(options: Fake['options']) { super(); this.options = options }
  async invoke(req: Req) { this.requests.push(req); return answer(req, this) }
  async close() { await tick(); this.end() }
  /** TDLib closed: our close(), a finished logout, or a crash. */
  end() { if (!this.closed) { this.closed = true; this.emit('close') } }
  update(u: object) { this.emit('update', u) }
}
const clients: Fake[] = []
Object.assign(tdl, { createClient: (o: Fake['options']) => { const c = new Fake(o); clients.push(c); return c } })
const last = () => clients[clients.length - 1]
const live = () => clients.filter((c) => !c.closed)

const dir = path.join(temp, 'tdlib')
const events: AppEvent[] = []
let archived = false
let forgot = 0
/** What the ready gate handed to main to keep for the next start (core/telegram.ts > ready gate). */
let savedCreds: { apiId: number, apiHash: string } | null = null
const db = openDb(':memory:')
tg.init({ dir, version: '9.9.9', db, emit: (e) => events.push(e), showArchived: () => archived, forgetCredentials: () => { forgot++ }, saveCredentials: (c) => { savedCreds = c } })
const creds = { apiId: 12345, apiHash: 'f'.repeat(32) }

// The credentials gate: `trust` records the fingerprint a real sign-in would leave, so a test can resume a session
// the way an existing install does; `dropTrust` is an install from before the gate existed.
const fingerprintFile = path.join(dir, 'session.fingerprint')
const trust = (c: { apiId: number, apiHash: string } = creds) => { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(fingerprintFile, tg.fingerprint(c)) }
const dropTrust = () => fs.rmSync(fingerprintFile, { force: true })

const step = () => tg.authState().step
async function until(ok: () => boolean) {
  // File I/O is real even when the download timers are mocked.
  for (const end = performance.now() + 5000; !ok() && performance.now() < end;) await tick()
  assert.ok(ok(), 'the condition never became true')
}
const auth = (_: string) => ({ _: 'updateAuthorizationState', authorization_state: { _ } })
const pos = (list: object, order: string) => ({ _: 'chatPosition', list, order, is_pinned: false })
const main = { _: 'chatListMain' }, archive = { _: 'chatListArchive' }, folder = { _: 'chatListFolder', chat_folder_id: 3 }
const chatOf = (id: number, positions: object[] = [], type: object = { _: 'chatTypeBasicGroup', basic_group_id: -id }) =>
  ({ _: 'chat', id, title: `Fixture chat ${id}`, type, positions, chat_lists: [], unread_count: 0 })
const meUser = { _: 'user', id: 100, first_name: 'Fixture', last_name: 'User', phone_number: '19995550123', is_premium: false }
const saved = chatOf(100, [], { _: 'chatTypePrivate', user_id: 100 })

/** What TDLib answers while signing in; anything else goes to `extra`. */
const base = (extra: Answer): Answer => (req, cl) => {
  if (req._ === 'getMe') return meUser
  if (req._ === 'getOption') return { _: 'optionValueInteger', value: '2048' }
  if (req._ === 'createPrivateChat') { cl.update({ _: 'updateNewChat', chat: saved }); return saved }
  if (req._ === 'setAuthenticationPhoneNumber') return { _: 'ok' } // Telegram would accept the number here
  return extra(req, cl)
}
async function signIn(extra: Answer = notFound) {
  answer = base(extra)
  trust() // a session that already signed in under these keys
  await tg.start(creds)
  const cl = last()
  cl.update(auth('authorizationStateReady'))
  await until(() => step() === 'ready' && cl.requests.some((r) => r._ === 'loadChats'))
  await tick()
  return cl
}

test('start: TDLib folders and credentials; invoke is a 503 until getMe and the caption option answer, then ready', async () => {
  let releaseMe!: () => void
  const meGate = new Promise<void>((r) => { releaseMe = r })
  const signedIn = base(notFound)
  answer = async (req, cl) => (req._ === 'getMe' ? (await meGate, meUser) : signedIn(req, cl))
  trust() // this session signed in under these keys: the gate lets it open
  await tg.start(creds)
  const cl = last()
  assert.deepEqual(cl.options, { ...cl.options, ...creds, databaseDirectory: path.join(dir, 'db'), filesDirectory: path.join(dir, 'files') })
  assert.deepEqual(tg.authState(), { connection: 'connecting', step: 'starting' })
  cl.update(auth('authorizationStateWaitPhoneNumber'))
  assert.equal(step(), 'phone')
  await assert.rejects(tg.invoke({ _: 'getMe' }), { status: 503 })
  cl.update(auth('authorizationStateReady'))
  await tick()
  assert.equal(step(), 'starting') // getMe has not answered yet
  await assert.rejects(tg.invoke({ _: 'getMe' }), { status: 503 })
  assert.throws(() => tg.chatList(), { status: 503 })
  releaseMe()
  await until(() => step() === 'ready')
  const a = tg.authState()
  assert.ok(a.step === 'ready' && a.me.captionMax === 2048 && a.me.phone === '+•• ••• ••01 23')
  cl.update({ _: 'updateConnectionState', state: { _: 'connectionStateReady' } })
  assert.equal(tg.authState().connection, 'ready')
  assert.deepEqual(events.flatMap((e) => (e.type === 'auth' ? [e.auth.step] : [])), ['starting', 'phone', 'starting', 'ready', 'ready'])
})

test('chatList: main list, archive only when shown, Saved Messages, opened chats; positions replaced by last-message and draft updates', async () => {
  const cl = await signIn((req) => {
    if (req._ === 'getInternalLinkType') return { _: 'internalLinkTypePublicChat', chat_username: 'fixture_open' }
    if (req._ === 'searchPublicChat') return chatOf(-5)
    if (req._ === 'joinChat') return { _: 'chatJoinResultSuccess', chat_id: -5 } // a public chat is joined for real
    return notFound()
  })
  for (const chat of [chatOf(-1, [pos(main, '30')]), chatOf(-2, [pos(main, '20'), pos(folder, '7')]), chatOf(-3, [pos(archive, '50')]),
    chatOf(-4, [pos(folder, '9')]) /* folder only */, chatOf(-5) /* seen through a forward */]) cl.update({ _: 'updateNewChat', chat })
  const ids = () => tg.chatList().chats.map((c) => c.id)
  assert.deepEqual(ids(), [-1, -2, 100])
  archived = true
  assert.deepEqual(ids(), [-1, -2, -3, 100])
  archived = false
  await tg.openChat('t.me/fixture_open', false)
  assert.deepEqual(ids(), [-1, -2, 100, -5])

  cl.update({ _: 'updateChatPosition', chat_id: -2, position: pos(main, '40') }) // one list changes, the others stay
  assert.deepEqual(ids(), [-2, -1, 100, -5])
  assert.deepEqual(tg.chat(-2)?.folders, [3])
  cl.update({ _: 'updateChatPosition', chat_id: -1, position: pos(main, '0') }) // order 0: left the main list
  assert.deepEqual(ids(), [-2, 100, -5])
  // Last-message and draft updates carry every position, so a list they leave out is a list the chat left.
  cl.update({ _: 'updateChatLastMessage', chat_id: -2, last_message: { date: 77 }, positions: [pos(folder, '7')] })
  assert.deepEqual([ids(), tg.chat(-2)?.lastDate, tg.chat(-2)?.folders], [[100, -5], 77, [3]])
  cl.update({ _: 'updateChatDraftMessage', chat_id: -3, positions: [pos(main, '60')] })
  assert.deepEqual(ids(), [-3, 100, -5])
  archived = true
  cl.update({ _: 'updateChatDraftMessage', chat_id: -3, positions: [] })
  assert.deepEqual(ids(), [100, -5]) // its old archive position went with the main one
  archived = false

  cl.update({ _: 'updateChatFolders', chat_folders: [{ id: 3, name: { text: { text: 'Fixture folder' } } }], main_chat_list_position: 0 })
  await until(() => cl.requests.some((r) => r._ === 'loadChats' && r.chat_list._ === 'chatListFolder' && r.chat_list.chat_folder_id === 3))
  assert.deepEqual(tg.chatList().folders, [{ id: 3, name: 'Fixture folder' }])
})

test('messages: pages getChatHistory by 100 up to limit; more is false once the start of the chat is reached', async () => {
  const history = Array.from({ length: 250 }, (_, i) => ({
    _: 'message', id: (250 - i) * 2 ** 20, date: 250 - i, sender_id: { _: 'messageSenderUser', user_id: 100 }, content: { _: 'messageText', text: { text: `m${250 - i}` } },
  }))
  const cl = await signIn((req) => {
    if (req._ !== 'getChatHistory') return notFound()
    const from = req.from_message_id ? history.findIndex((m) => m.id === req.from_message_id) + 1 : 0
    return { _: 'messages', total_count: 250, messages: history.slice(from, from + (from ? req.limit : 1)) } // TDLib answers a short first page
  })
  cl.update({ _: 'updateUser', user: meUser })
  cl.update({ _: 'updateNewChat', chat: chatOf(-7) })
  const r = await tg.messages(-7, 150)
  assert.deepEqual([r.messages.length, r.more], [150, true])
  assert.deepEqual(r.messages.map((m) => m.id), history.slice(0, 150).map((m) => m.id))
  assert.deepEqual(cl.requests.filter((q) => q._ === 'getChatHistory').map((q) => q.limit), [100, 100, 49])
  const all = await tg.messages(-7, 1000)
  assert.deepEqual([all.messages.length, all.more], [250, false])
  assert.deepEqual(all.messages[0], { id: history[0].id, date: 250, sender: 'Fixture User', text: 'm250', media: null, isOutgoing: false })
  await assert.rejects(tg.messages(-8, 10), { status: 404 })
})

test('rejected credentials (error event, setAuthenticationPhoneNumber): client closed, credentials forgotten, Login shows why', async () => {
  answer = (req) => { if (req._ === 'setAuthenticationPhoneNumber') throw new tdl.TDLibError(400, 'API_ID_PUBLISHED_FLOOD'); return notFound() }
  forgot = 0
  await tg.start(creds)
  const first = last()
  first.emit('error', new Error('Request failed: API_ID_INVALID'))
  await until(() => step() === 'credentials')
  assert.deepEqual(tg.authState(), { connection: 'offline', step: 'credentials', error: 'Telegram rejected this API ID and hash. Check them at my.telegram.org.' })
  assert.deepEqual([first.closed, forgot, last()], [true, 1, first]) // no restart with rejected credentials

  await tg.start(creds)
  last().update(auth('authorizationStateWaitPhoneNumber'))
  assert.deepEqual(tg.authState(), { connection: 'connecting', step: 'phone' }) // a new start clears the error
  await assert.rejects(tg.sendPhone('19995550123'), { status: 400, message: /blocked this API ID because it was published/ })
  const a = tg.authState()
  assert.ok(a.step === 'credentials' && a.error?.includes('blocked this API ID'))
  assert.deepEqual([last().closed, forgot, live().length], [true, 2, 0])
})

test('an unexpected close restarts with the session kept; a close after LoggingOut deletes tdlib\\db and tdlib\\files first', async () => {
  answer = notFound
  for (const d of ['db', 'files']) { fs.mkdirSync(path.join(dir, d), { recursive: true }); fs.writeFileSync(path.join(dir, d, 'x'), 'x') }
  await tg.start(creds)
  const crashed = last()
  crashed.end()
  await until(() => last() !== crashed)
  const second = last()
  assert.deepEqual([second.options.apiId, second.options.apiHash], [creds.apiId, creds.apiHash])
  assert.ok(fs.existsSync(path.join(dir, 'db', 'x')) && fs.existsSync(path.join(dir, 'files', 'x')))
  second.update(auth('authorizationStateLoggingOut')) // our logout, or the session was ended from another device
  assert.equal(step(), 'logging-out')
  second.end()
  await until(() => last() !== second)
  assert.ok(!fs.existsSync(path.join(dir, 'db')) && !fs.existsSync(path.join(dir, 'files')))
  assert.deepEqual([last().options.apiId, live().length, step()], [creds.apiId, 1, 'starting'])
})

test('start: overlapping calls never leave two live clients, and the last credentials win', async () => {
  answer = notFound
  await tg.start(creds)
  const other = { apiId: 777, apiHash: 'e'.repeat(32) }
  await Promise.all([tg.start(creds), tg.start(other)])
  assert.deepEqual(live().map((c) => c.options.apiId), [777])
  assert.equal(live()[0], last())
})

// ---- Media index scan, links (Phase 3) ----

const sender = { _: 'messageSenderUser', user_id: 100 }
const docMsg = (chatId: number, id: number, extra: object = {}) => ({ _: 'message', id, chat_id: chatId, date: id, sender_id: sender, media_album_id: '0',
  content: { _: 'messageDocument', document: { file_name: `f${id}.pdf`, mime_type: 'application/pdf', document: { _: 'file', id, size: 1, expected_size: 1, remote: { id: `r${id}` } } }, caption: { text: '' } }, ...extra })
const textMsg = (chatId: number, id: number) => ({ _: 'message', id, chat_id: chatId, date: id, sender_id: sender, media_album_id: '0', content: { _: 'messageText', text: { text: 'hi' } } })
const pages = (cl: Fake) => cl.requests.filter((r) => r._ === 'getChatHistory').length

test('scanNeeded: no row, an unfinished backfill, or a newer last message; never for a chat in failed', () => {
  const row = { chat_id: 1, newest_id: 10, oldest_id: 1, complete: 1, total: 3, cursors: null }
  assert.deepEqual([tg.scanNeeded(undefined, null, false), tg.scanNeeded({ ...row, complete: 0 }, 10, false), tg.scanNeeded(row, 12, false)], [true, true, true])
  assert.deepEqual([tg.scanNeeded(row, 10, false), tg.scanNeeded(row, null, false), tg.scanNeeded(undefined, null, true)], [false, false, false])
})

test('media scan: the first walk creates the row and backfills by page; once newest_id equals a text last message nothing restarts; live upkeep', async () => {
  const chatId = -20
  const history = Array.from({ length: 10 }, (_, i) => (10 - i) % 2 ? docMsg(chatId, 10 - i) : textMsg(chatId, 10 - i)) // the newest is text
  const cl = await signIn((req) => {
    if (req._ === 'getChatMessageCount') return { _: 'count', count: 1 }
    if (req._ !== 'getChatHistory' || req.chat_id !== chatId) return notFound()
    const from = req.from_message_id ? history.findIndex((m) => m.id === req.from_message_id) + 1 : 0
    return { _: 'messages', total_count: 10, messages: history.slice(from, from + 4) } // short pages
  })
  cl.update({ _: 'updateNewChat', chat: { ...chatOf(chatId), last_message: { id: 10, date: 10 } } })
  tg.ensureScan(chatId)
  assert.equal(tg.scanInfo(chatId).state, 'scanning')
  await until(() => tg.scanInfo(chatId).state !== 'scanning')
  assert.deepEqual({ ...getScan(db, chatId) }, { chat_id: chatId, newest_id: 10, oldest_id: 1, complete: 1, total: 7, cursors: null })
  assert.deepEqual([pages(cl), tg.scanInfo(chatId)], [4, { state: 'done', indexed: 5, total: 7 }])
  tg.ensureScan(chatId) // the refetch that the finish invalidation causes
  await tick()
  assert.equal(pages(cl), 4)
  assert.ok(events.some((e) => e.type === 'invalidate' && e.topics.includes(`media:${chatId}`)))

  cl.update({ _: 'updateConnectionState', state: { _: 'connectionStateReady' } })
  cl.update({ _: 'updateNewMessage', message: docMsg(chatId, 12) }) // a current chat: newest_id follows
  assert.deepEqual([getScan(db, chatId)!.newest_id, mediaCount(db, chatId)], [12, 6])
  cl.update({ _: 'updateConnectionState', state: { _: 'connectionStateConnecting' } }) // TDLib may skip updates from here on
  cl.update({ _: 'updateNewMessage', message: docMsg(chatId, 14) })
  assert.deepEqual([getScan(db, chatId)!.newest_id, mediaCount(db, chatId)], [12, 7]) // indexed, but the next top-up covers the gap
  cl.update({ _: 'updateNewMessage', message: docMsg(chatId, 16, { sending_state: { _: 'messageSendingStatePending' } }) }) // a temporary id
  cl.update({ _: 'updateNewMessage', message: docMsg(chatId, 14) }) // overlaps are harmless
  putMedia(db, [{ chatId, messageId: 14, date: 14, type: 'document', name: 'f14.pdf', ext: 'pdf', size: 1, duration: 0, caption: '', thumb: null }])
  assert.equal(mediaCount(db, chatId), 7)
  cl.update({ _: 'updateDeleteMessages', chat_id: chatId, message_ids: [14], is_permanent: false, from_cache: true }) // a cache eviction
  assert.equal(mediaCount(db, chatId), 7)
  cl.update({ _: 'updateDeleteMessages', chat_id: chatId, message_ids: [14], is_permanent: true, from_cache: false })
  assert.equal(mediaCount(db, chatId), 6)
  assert.ok(events.some((e) => e.type === 'invalidate' && e.topics.includes(`messages:${chatId}`)))
})

test('media scan: a page error puts the chat in failed (no rescan on refetch) until the connection next enters ready', async () => {
  const chatId = -21
  let broken = true
  const cl = await signIn((req) => {
    if (req._ === 'getChatMessageCount') throw new tdl.TDLibError(400, 'Bad filter')
    if (req._ !== 'getChatHistory') return notFound()
    if (broken) throw new tdl.TDLibError(400, 'CHANNEL_PRIVATE')
    return { _: 'messages', total_count: 0, messages: [] }
  })
  cl.update({ _: 'updateNewChat', chat: chatOf(chatId) })
  tg.ensureScan(chatId)
  await until(() => tg.scanInfo(chatId).state === 'failed' && pages(cl) === 1)
  tg.ensureScan(chatId)
  await tick()
  assert.equal(pages(cl), 1)
  cl.update({ _: 'updateConnectionState', state: { _: 'connectionStateReady' } }) // one new try
  broken = false
  tg.ensureScan(chatId)
  await until(() => getScan(db, chatId)?.complete === 1)
  assert.deepEqual({ ...getScan(db, chatId) }, { chat_id: chatId, newest_id: 0, oldest_id: 0, complete: 1, total: null, cursors: null }) // an empty chat; counts failed
})

test('networkChanged: offline changes nothing; back online clears the failed hold and pings the wanted scan and chats', async () => {
  const chatId = -22
  let broken = true
  const cl = await signIn((req) => {
    if (req._ === 'getChatMessageCount') return { _: 'count', count: 1 }
    if (req._ !== 'getChatHistory') return notFound()
    if (broken) throw new tdl.TDLibError(400, 'NETWORK_DOWN')
    return { _: 'messages', total_count: 0, messages: [] }
  })
  cl.update({ _: 'updateNewChat', chat: chatOf(chatId) })
  tg.ensureScan(chatId)
  await until(() => tg.scanInfo(chatId).state === 'failed' && pages(cl) === 1) // the failed page holds the chat
  tg.ensureScan(chatId)
  await tick()
  assert.equal(pages(cl), 1)
  const before = events.length
  tg.networkChanged(false)
  assert.equal(events.length, before)
  tg.networkChanged(true)
  const topics = events.slice(before).flatMap((e) => (e.type === 'invalidate' ? e.topics : []))
  assert.ok(topics.includes('chats'), 'the chat lists ask again')
  assert.ok(topics.includes(`media:${chatId}`), 'the wanted scan gets its refetch')
  broken = false
  tg.ensureScan(chatId) // the refetch the invalidation causes
  await until(() => getScan(db, chatId)?.complete === 1)
})

/** TDLib answers a search in decreasing id order with `from_message_id` itself at the head, and may cut a page short. */
const searched = (docs: { id: number }[], from: number) => {
  const at = from === 0 ? 0 : docs.findIndex((m) => m.id === from)
  const page = docs.slice(at, at + 4)
  return { _: 'foundChatMessages', total_count: docs.length, messages: page,
    next_from_message_id: at + 4 < docs.length ? docs[at + 4].id : 0 }
}

test('media scan: the backfill searches one filter at a time instead of walking the history; every filter keeps a cursor', async () => {
  const chatId = -30
  const docs = Array.from({ length: 10 }, (_, i) => docMsg(chatId, 10 - i)) // ids 10..1, all documents
  const froms: number[] = []
  const cl = await signIn((req) => {
    if (req._ === 'getChatMessageCount') return { _: 'count', count: req.filter._ === 'searchMessagesFilterDocument' ? 10 : 0 }
    if (req._ === 'getChatHistory') return { _: 'messages', total_count: 10, messages: docs }
    if (req._ !== 'searchChatMessages') return notFound()
    if (req.filter._ !== 'searchMessagesFilterDocument') return { _: 'foundChatMessages', total_count: 0, messages: [], next_from_message_id: 0 }
    froms.push(req.from_message_id)
    return searched(docs, req.from_message_id)
  })
  cl.update({ _: 'updateNewChat', chat: { ...chatOf(chatId), last_message: { id: 10, date: 10 } } })
  tg.ensureScan(chatId)
  await until(() => tg.scanInfo(chatId).state !== 'scanning')
  assert.deepEqual([pages(cl), froms], [1, [0, 7, 4]]) // one history page to create the row, then the search paged itself
  assert.deepEqual(tg.scanInfo(chatId), { state: 'done', indexed: 10, total: 10 })
  assert.deepEqual(JSON.parse(getScan(db, chatId)!.cursors!), [0, 0, 1, 0, 0, 0, 0])
  tg.ensureScan(chatId) // the refetch the finish invalidation causes
  await tick()
  assert.deepEqual([pages(cl), froms.length], [1, 3])
})

test('media scan: an unfinished scan resumes from the cursors it saved instead of re-reading the history', async () => {
  const chatId = -31
  const docs = Array.from({ length: 10 }, (_, i) => docMsg(chatId, 10 - i))
  const froms: number[] = []
  const cl = await signIn((req) => {
    if (req._ === 'getChatMessageCount') return { _: 'count', count: req.filter._ === 'searchMessagesFilterDocument' ? 10 : 0 }
    if (req._ === 'getChatHistory') return { _: 'messages', total_count: 10, messages: docs }
    if (req._ !== 'searchChatMessages') return notFound()
    if (req.filter._ !== 'searchMessagesFilterDocument') return { _: 'foundChatMessages', total_count: 0, messages: [], next_from_message_id: 0 }
    froms.push(req.from_message_id)
    return searched(docs, req.from_message_id)
  })
  cl.update({ _: 'updateNewChat', chat: { ...chatOf(chatId), last_message: { id: 10, date: 10 } } })
  putScan(db, { chat_id: chatId, newest_id: 10, oldest_id: 1, complete: 0, total: 10, cursors: '[0,0,7,0,0,0,0]' })
  tg.ensureScan(chatId)
  await until(() => tg.scanInfo(chatId).state !== 'scanning')
  assert.equal(pages(cl), 0) // newest_id is current: only the backfill is left, from where it stopped
  assert.deepEqual(froms, [7, 4])
  assert.deepEqual(JSON.parse(getScan(db, chatId)!.cursors!), [0, 0, 1, 0, 0, 0, 0])
  assert.deepEqual(tg.scanInfo(chatId), { state: 'done', indexed: 6, total: 10 }) // ids 7..10 were already indexed
})

test('index bar: Stop holds the scan back without losing it; the next ask and Resume both go through it', async () => {
  const chatId = -32
  const docs = Array.from({ length: 10 }, (_, i) => docMsg(chatId, 10 - i))
  const cl = await signIn((req) => {
    if (req._ === 'getChatMessageCount') return { _: 'count', count: req.filter._ === 'searchMessagesFilterDocument' ? 10 : 0 }
    if (req._ === 'getChatHistory') return { _: 'messages', total_count: 10, messages: docs }
    if (req._ !== 'searchChatMessages') return notFound()
    if (req.filter._ !== 'searchMessagesFilterDocument') return { _: 'foundChatMessages', total_count: 0, messages: [], next_from_message_id: 0 }
    return searched(docs, req.from_message_id)
  })
  cl.update({ _: 'updateNewChat', chat: { ...chatOf(chatId), last_message: { id: 10, date: 10 } } })
  tg.ensureScan(chatId)
  assert.equal(tg.holdScan(chatId).state, 'paused')
  await tick(); await tick()
  assert.deepEqual([pages(cl), mediaCount(db, chatId), tg.scanInfo(chatId).state], [0, 0, 'paused'])
  tg.ensureScan(chatId) // the refetch the stop invalidates causes must not start it again
  await tick()
  assert.equal(pages(cl), 0)
  tg.retryScan(chatId)
  await until(() => tg.scanInfo(chatId).state === 'done')
  assert.deepEqual([pages(cl), mediaCount(db, chatId)], [1, 10])
})

test('linkMessages: the message, or its whole album; 400 for links without media or that are not message links, 404 without access', async () => {
  const album = [docMsg(-40, 3, { media_album_id: '77' }), textMsg(-40, 4), docMsg(-40, 2, { media_album_id: '77' }), docMsg(-40, 1, { media_album_id: '5' })]
  await signIn((req) => {
    if (req._ === 'getInternalLinkType') return req.link.includes('/c/') ? { _: 'internalLinkTypeMessage', url: req.link } : { _: 'internalLinkTypePublicChat', chat_username: 'x' }
    if (req._ === 'getMessageLinkInfo') {
      if (req.url.endsWith('/9')) return { chat_id: 0, for_album: false }
      if (req.url.endsWith('/8')) return { chat_id: -40, message: textMsg(-40, 8), for_album: false }
      return { chat_id: -40, message: album[0], for_album: !req.url.endsWith('single') }
    }
    if (req._ === 'getChatHistory') return { _: 'messages', total_count: 4, messages: album }
    return notFound()
  })
  const ids = async (link: string) => (await tg.linkMessages(link)).messages.map((m) => m.id)
  assert.deepEqual(await ids('https://t.me/c/40/3'), [2, 3])
  assert.deepEqual(await ids('https://t.me/c/40/3?single'), [3])
  await assert.rejects(tg.linkMessages('https://t.me/c/40/8'), { status: 400, message: /no media/ })
  await assert.rejects(tg.linkMessages('https://t.me/c/40/9'), { status: 404 })
  await assert.rejects(tg.linkMessages('https://t.me/fixture'), { status: 400, message: /isn't a chat or message link/ })
})

test('openChat invites: preview, request sent → 409, declined → 403, success opens it; thumbFile refuses big files before downloading', async () => {
  const cl = await signIn((req, c) => {
    if (req._ === 'getInternalLinkType') return { _: 'internalLinkTypeChatInvite', invite_link: req.link }
    if (req._ === 'checkChatInviteLink') return { _: 'chatInviteLinkInfo', chat_id: 0, title: 'Fixture group', member_count: 12, photo: null }
    if (req._ === 'joinChatByInviteLink') {
      if (req.invite_link.endsWith('req')) return { _: 'chatJoinResultRequestSent' }
      if (req.invite_link.endsWith('no')) return { _: 'chatJoinResultDeclined' }
      c.update({ _: 'updateNewChat', chat: chatOf(-30) })
      return { _: 'chatJoinResultSuccess', chat_id: -30 }
    }
    if (req._ === 'getRemoteFile') return { _: 'file', id: 5, size: 0, expected_size: 3 * 2 ** 20, local: { is_downloading_completed: false, path: '' } }
    return notFound()
  })
  assert.deepEqual(await tg.openChat('https://t.me/+fixturereq', false), { invite: { title: 'Fixture group', members: 12, photo: null } })
  await assert.rejects(tg.openChat('https://t.me/+fixturereq', true), { status: 409, message: /request to join was sent/ })
  await assert.rejects(tg.openChat('https://t.me/+fixtureno', true), { status: 403 })
  const opened = await tg.openChat('https://t.me/+fixtureok', true)
  assert.equal((opened as { chat: { id: number } }).chat.id, -30)
  assert.ok(tg.chatList().chats.some((c) => c.id === -30))
  await assert.rejects(tg.thumbFile('AgACAgIAAxk-fixture'), { status: 413 })
  assert.equal(cl.requests.filter((r) => r._ === 'downloadFile').length, 0)
})

test('openChat public chats: a group or channel is joined for real, a member or a private chat is not, failures answer like an invite', async () => {
  const cl = await signIn((req) => {
    if (req._ === 'getInternalLinkType') return { _: 'internalLinkTypePublicChat', chat_username: req.link.split('/').pop() }
    if (req._ === 'searchPublicChat') {
      if (req.username === 'member') return chatOf(-41, [pos(main, '90')]) // already in the account's list
      if (req.username === 'someone') return chatOf(-42, [], { _: 'chatTypePrivate', user_id: 999 })
      if (req.username === 'req') return chatOf(-43)
      if (req.username === 'no') return chatOf(-44)
      return chatOf(-40) // public, not a member: no position at all
    }
    if (req._ === 'joinChat') {
      if (req.chat_id === -43) return { _: 'chatJoinResultRequestSent' }
      if (req.chat_id === -44) return { _: 'chatJoinResultDeclined' }
      return { _: 'chatJoinResultSuccess', chat_id: req.chat_id }
    }
    if (req._ === 'getChat') return chatOf(req.chat_id, [pos(main, '95')]) // the positions the join just earned
    return notFound()
  })
  const joins = () => cl.requests.filter((r) => r._ === 'joinChat').map((r) => r.chat_id)

  const opened = await tg.openChat('https://t.me/joinme', false)
  assert.equal((opened as { chat: { id: number } }).chat.id, -40)
  assert.deepEqual(joins(), [-40])
  assert.deepEqual(cl.requests.filter((r) => r._ === 'getChat').map((r) => r.chat_id), [-40]) // read back the join's positions
  assert.ok(tg.chatList().chats.some((c) => c.id === -40))

  await tg.openChat('https://t.me/member', false)
  await tg.openChat('https://t.me/someone', false)
  assert.deepEqual(joins(), [-40]) // membership and a private chat need no join

  await assert.rejects(tg.openChat('https://t.me/req', false), { status: 409, message: /request to join was sent/ })
  await assert.rejects(tg.openChat('https://t.me/no', false), { status: 403 })
  assert.deepEqual(joins(), [-40, -43, -44])
})

test('logout: online it waits for the fresh client; offline it deletes the session after 15 s and restarts', async () => {
  const online = await signIn((req, cl) => {
    if (req._ !== 'logOut') return notFound()
    setImmediate(() => { cl.update(auth('authorizationStateLoggingOut')); cl.update(auth('authorizationStateClosed')); cl.end() })
    return { _: 'ok' }
  })
  fs.mkdirSync(path.join(dir, 'db'), { recursive: true })
  assert.deepEqual(await tg.logout(), { local: false })
  assert.ok(online.closed && !fs.existsSync(path.join(dir, 'db')))
  assert.deepEqual([live().length, step()], [1, 'starting'])

  const offline = await signIn((req) => (req._ === 'logOut' ? new Promise(() => {}) : notFound()))
  fs.mkdirSync(path.join(dir, 'db'), { recursive: true })
  const out = tg.logout()
  await tick()
  assert.equal(offline.closed, false) // still waiting for Telegram
  mock.timers.tick(15_000)
  assert.deepEqual(await out, { local: true })
  assert.ok(offline.closed && !fs.existsSync(path.join(dir, 'db')))
  assert.deepEqual([live().length, last() !== offline, last().options.apiId], [1, true, creds.apiId])
})

test('reset: after a logout the keys leave memory, so auth returns to the API-keys step', async () => {
  await signIn((req, cl) => {
    if (req._ !== 'logOut') return notFound()
    setImmediate(() => { cl.update(auth('authorizationStateLoggingOut')); cl.update(auth('authorizationStateClosed')); cl.end() })
    return { _: 'ok' }
  })
  assert.deepEqual(await tg.logout(), { local: false })
  assert.equal(step(), 'starting') // logout restarts the client with the same in-memory keys
  await tg.reset() // what auth.logout does next
  assert.equal(tg.credentials(), null)
  assert.deepEqual([live().length, step(), tg.authState().connection], [0, 'credentials', 'offline'])
})

// ---- Credentials gate: the keys that made the session are the only keys that open it ----

test('credentials gate: mismatched keys are refused before TDLib starts, an unrecorded session is closed unread', async () => {
  trust()
  savedCreds = null // only a sign-in that gets in may hand main its keys to keep
  const other = { apiId: 777, apiHash: 'e'.repeat(32) }

  // 1. Keys that did not sign in this device: refused before a client is created, with the offer in the state.
  const before = clients.length
  await assert.rejects(tg.start(other), { status: 409, message: /don't match the session/ })
  const refused = tg.authState()
  assert.ok(refused.step === 'credentials' && refused.needsFresh && /don't match the session/.test(refused.error ?? ''))
  assert.equal(clients.length, before) // TDLib was never asked to open the session

  // 2. No fingerprint at all (a session from before this gate): TDLib resumes it, the gate closes it before onReady
  //    can read a single chat, and the renderer is told a fresh sign-in is the way forward.
  dropTrust()
  await tg.start(creds)
  const resumed = last()
  resumed.update(auth('authorizationStateReady'))
  await until(() => step() === 'credentials')
  const blocked = tg.authState()
  assert.ok(blocked.step === 'credentials' && blocked.needsFresh && /fresh sign-in/.test(blocked.error ?? ''))
  assert.deepEqual([resumed.closed, tg.credentials(), live().length], [true, null, 0])
  assert.ok(!resumed.requests.some((r) => r._ === 'getMe')) // nothing of the account was read
  assert.equal(savedCreds, null) // a refused session keeps nothing for the next start

  // 3. Fresh sign-in: the old session is deleted first, so Telegram checks this pair at the phone/code step, and
  //    the pair that gets in is fingerprinted for every start after it — and saved with it.
  fs.mkdirSync(path.join(dir, 'db'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'db', 'x'), 'x')
  answer = base(notFound)
  await tg.start(other, true)
  const fresh = last()
  assert.ok(!fs.existsSync(path.join(dir, 'db'))) // the session the gate would not open is gone
  await tg.sendPhone('19995550123')
  fresh.update(auth('authorizationStateReady'))
  await until(() => step() === 'ready')
  assert.equal(fs.readFileSync(fingerprintFile, 'utf8'), tg.fingerprint(other))
  assert.deepEqual(savedCreds, other) // the ready gate hands main the keys that made this session
})

test('sendPhone: a Continue click while the same number is still in flight shares that one TDLib query', async () => {
  trust() // these keys own the session on disk, so the start below opens it
  let release!: () => void
  const held = new Promise<void>((r) => { release = r })
  answer = (req) => (req._ === 'setAuthenticationPhoneNumber' ? held : notFound())
  await tg.start(creds)
  const cl = last()
  cl.update(auth('authorizationStateWaitPhoneNumber'))
  const first = tg.sendPhone('911234567890')
  const duplicate = tg.sendPhone('911234567890') // the auto-send raced by a click on the phone screen
  const different = tg.sendPhone('919998887777') // "use a different number" is its own query
  await tick()
  const phones = cl.requests.filter((r) => r._ === 'setAuthenticationPhoneNumber').map((r) => r.phone_number)
  assert.deepEqual(phones, ['911234567890', '919998887777']) // the duplicate never reached TDLib
  release()
  await Promise.all([first, duplicate, different])
  assert.equal(step(), 'phone') // the number was accepted; the code step would follow from Telegram
})

test('prepareMedia: video streaming path is provided immediately during download', async () => {
  const chatId = -77
  const messageId = 2 * 2 ** 20
  const videoFile = { _: 'file', id: 404, size: 1048576, expected_size: 1048576, local: { is_downloading_completed: false, downloaded_size: 0, path: path.join(dir, 'files', 'temp', 'stream-1036') } }
  const cl = await signIn((req) => {
    if (req._ === 'getMessage') {
      return {
        _: 'message', id: messageId, chat_id: chatId, date: 100,
        content: {
          _: 'messageVideo',
          video: { _: 'video', duration: 120, width: 1920, height: 1080, file_name: 'test.mp4', mime_type: 'video/mp4', video: videoFile },
        },
      }
    }
    if (req._ === 'getFile') return videoFile
    if (req._ === 'downloadFile') return videoFile
    return notFound()
  })
  const res = await tg.prepareMedia(chatId, messageId)
  assert.equal(res.fileId, 404)
  assert.equal(res.completed, false)
  assert.equal(res.path, videoFile.local.path, 'TDLib provides the path before it exists; the basename is not the file ID')
  const downloadCalls = () => cl.requests.filter((r) => r._ === 'downloadFile')
  // The streaming download from byte 0, right away — and nothing else. The tail prefetch this used
  // to fire next downloads the last 5 MB out of order, leaving a hole of zeros before it that the
  // decoder reads as an unsupported file; the tail is fetched only when Chromium asks for a range
  // past the download frontier.
  for (let i = 0; i < 50; i++) await new Promise((r) => setImmediate(r))
  const calls = downloadCalls()
  assert.equal(calls.length, 1, 'prepareMedia must not prefetch the moov tail out of order')
  assert.equal(calls[0].priority, 32)
  assert.equal(calls[0].synchronous, false)
  assert.equal(calls[0].offset, 0)
  assert.equal(calls[0].limit, 0)
})

test('prepareMedia: a recorded path that no longer holds the whole file is not reported complete', async () => {
  const chatId = -78
  const messageId = 2 * 2 ** 20 + 1
  const videoFile = { _: 'file', id: 405, size: 1048576, expected_size: 1048576, local: { is_downloading_completed: false, downloaded_size: 0, path: '' } }
  // A completed row left over from an earlier session: the name matches, the bytes do not. The
  // library is pruned while this row survives, so the file it points at can be short — and handing
  // it back as complete made the player declare a whole video and fail on the first byte past the end.
  const stale = path.join(dir, 'files', 'videos', 'stale.mp4')
  fs.mkdirSync(path.dirname(stale), { recursive: true })
  fs.writeFileSync(stale, Buffer.alloc(4096))
  db.prepare(`INSERT INTO jobs (kind, status, position, chat_id, chat_title, message_id, name, type, path, created_at)
    VALUES ('download', 'completed', 0, ?, 'Fixture chat', ?, 'stale.mp4', 'video', ?, 0)`).run(chatId, messageId, stale)
  await signIn((req) => {
    if (req._ === 'getMessage') {
      return {
        _: 'message', id: messageId, chat_id: chatId, date: 100,
        content: {
          _: 'messageVideo',
          video: { _: 'video', duration: 120, width: 1920, height: 1080, file_name: 'test.mp4', mime_type: 'video/mp4', video: videoFile },
        },
      }
    }
    if (req._ === 'getFile') return videoFile
    if (req._ === 'downloadFile') return videoFile
    return notFound()
  })
  const res = await tg.prepareMedia(chatId, messageId)
  db.prepare('DELETE FROM jobs WHERE chat_id = ? AND message_id = ?').run(chatId, messageId)
  fs.rmSync(stale, { force: true })
  assert.notEqual(res.path, stale, 'a truncated leftover must not be handed back as the finished file')
  assert.equal(res.completed, false)
  assert.equal(res.path, null, 'an empty TDLib path must not invent a temp filename')
})

test('videoTail: caching and retrieval for fast MP4 playback', async () => {
  tg.setVideoTail(999, {
    totalSize: 10000000,
    tailOffset: 8000000,
    buffer: Buffer.from('test-moov-atom-data'),
  })
  const tail = tg.getVideoTail(999)
  assert.ok(tail)
  assert.equal(tail.totalSize, 10000000)
  assert.equal(tail.tailOffset, 8000000)
  assert.equal(tail.buffer.toString(), 'test-moov-atom-data')
})

const STREAM_SIZE = 10967770
const STREAM_TAIL_OFFSET = Math.floor((STREAM_SIZE - 5 * 1024 * 1024) / 4096) * 4096
const STREAM_TAIL_SIZE = STREAM_SIZE - STREAM_TAIL_OFFSET
const STREAM_SUFFIX_OFFSET = Math.floor((STREAM_SIZE - 64 * 1024) / 4096) * 4096
const PRODUCTION_SIZE = 68876944
const PRODUCTION_FLOOR = 63631360
const CHROMIUM_OFFSET = 68812800
const PRODUCTION_SUFFIX_OFFSET = 68808704
const streamingFile = (id: number, filePath: string, prefix = 4096, totalSize = STREAM_SIZE) => ({
  _: 'file', id, size: totalSize, expected_size: totalSize,
  local: { path: filePath, is_downloading_completed: false, is_downloading_active: true, can_be_downloaded: true,
    download_offset: 0, downloaded_prefix_size: prefix, downloaded_size: prefix },
})
const videoMessage = (file: ReturnType<typeof streamingFile>) => ({
  _: 'message', id: 2 * 2 ** 20 + file.id, chat_id: -79, date: 100,
  content: { _: 'messageVideo', video: { _: 'video', duration: 120, width: 1920, height: 1080,
    file_name: 'stream.mp4', mime_type: 'video/mp4', video: file } },
})
function sparseVideo(name: string, tail: Buffer, head = Buffer.alloc(4096, 0x41), totalSize = STREAM_SIZE, tailOffset = STREAM_TAIL_OFFSET): string {
  const filePath = path.join(dir, 'files', 'temp', name)
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  const fd = fs.openSync(filePath, 'w')
  try {
    fs.ftruncateSync(fd, totalSize)
    fs.writeSync(fd, head, 0, head.length, 0)
    fs.writeSync(fd, tail, 0, tail.length, tailOffset)
  } finally { fs.closeSync(fd) }
  return filePath
}
function mp4Box(type: string, payload: Buffer = Buffer.alloc(0), size64 = false): Buffer {
  const header = Buffer.alloc(size64 ? 16 : 8)
  header.writeUInt32BE(size64 ? 1 : header.length + payload.length, 0)
  header.write(type, 4, 4, 'ascii')
  if (size64) header.writeBigUInt64BE(BigInt(header.length + payload.length), 8)
  return Buffer.concat([header, payload])
}

test('prepareMedia: a full-size sparse temp file and a name-matching temp file are not completed media', async () => {
  const actual = sparseVideo('prepare-actual', Buffer.alloc(32))
  const nameMatch = path.join(dir, 'files', 'temp', 'stream.mp4')
  fs.writeFileSync(nameMatch, Buffer.alloc(STREAM_SIZE))
  const file = streamingFile(880, actual)
  file.local.downloaded_size = 8192
  await signIn((req) => {
    if (req._ === 'getMessage') return videoMessage(file)
    if (req._ === 'getFile' || req._ === 'downloadFile') return file
    return notFound()
  })
  const result = await tg.prepareMedia(-79, 2 * 2 ** 20 + file.id)
  assert.equal(result.completed, false)
  assert.equal(result.path, actual)
  assert.equal(result.downloaded, 8192, 'disk size is not downloaded progress')
})

test('fetchVideoTail: pending tail shields prepare/resume/invoke and awaits exactly one handback', async () => {
  const bytes = Buffer.alloc(STREAM_TAIL_SIZE, 0x5a)
  bytes.fill(0, 4096, 8192) // Legitimate zero bytes do not disqualify confirmed coverage.
  const actual = sparseVideo('1036', bytes)
  const file = streamingFile(888, actual)
  let prefix = 4096, coverage = 0
  let releaseTail!: () => void, releaseHandback!: () => void, startHandback!: () => void
  const tailGate = new Promise<void>((resolve) => { releaseTail = resolve })
  const handbackGate = new Promise<void>((resolve) => { releaseHandback = resolve })
  const handbackStarted = new Promise<void>((resolve) => { startHandback = resolve })
  const cl = await signIn((req) => {
    if (req._ === 'getMessage') return videoMessage(file)
    if (req._ === 'getFile') return file
    if (req._ === 'getFileDownloadedPrefixSize') return { _: 'fileDownloadedPrefixSize', size: req.offset === 0 ? prefix : coverage }
    if (req._ === 'downloadFile') {
      if (req.file_id !== file.id) return streamingFile(req.file_id, '')
      if (req.synchronous) return tailGate.then(() => file)
      startHandback()
      return handbackGate.then(() => file)
    }
    return notFound()
  })
  assert.equal((await tg.getWatermarks(file.id, 0))?.prefix, prefix)
  let settled = false
  const pending = tg.fetchVideoTail(file.id, STREAM_SIZE, STREAM_TAIL_OFFSET).then((tail) => { settled = true; return tail })
  await until(() => cl.requests.some((r) => r._ === 'downloadFile' && r.synchronous))
  const joined = tg.fetchVideoTail(file.id, STREAM_SIZE, STREAM_SIZE - 1)
  assert.equal(tg.videoTailBusy(file.id), true)
  assert.equal((await tg.invoke({ _: 'downloadFile', file_id: file.id, priority: 32, offset: 0, limit: 0, synchronous: false })).id, file.id)
  assert.equal((await tg.prepareMedia(-79, 2 * 2 ** 20 + file.id)).path, actual)
  tg.resumeStreamingDownload(file.id)
  await tg.invoke({ _: 'downloadFile', file_id: 889, priority: 32, offset: 0, limit: 0, synchronous: false })
  file.local.download_offset = STREAM_TAIL_OFFSET
  file.local.downloaded_prefix_size = STREAM_TAIL_SIZE
  file.local.downloaded_size = STREAM_SIZE // Aggregate byte count must not imply completion.
  cl.update({ _: 'updateFile', file })
  assert.equal(tg.trackedReadableEnd(file.id), prefix)
  assert.deepEqual(await tg.getWatermarks(file.id, 0), { prefix, downloaded: STREAM_SIZE, size: STREAM_SIZE, done: false })
  const downloads = () => cl.requests.filter((r) => r._ === 'downloadFile' && r.file_id === file.id)
  assert.equal(downloads().length, 1, 'no caller resets the pending tail')
  assert.equal(tg.getVideoTail(file.id), undefined, 'even dense on-disk bytes require confirmed coverage')
  coverage = STREAM_TAIL_SIZE
  mock.timers.tick(250)
  await handbackStarted
  releaseTail() // Coverage, not the pending synchronous answer, permitted the handback.
  assert.equal(settled, false, 'the result waits for the handback answer')
  assert.equal(tg.videoTailBusy(file.id), true, 'the guard covers handback too')
  await tg.invoke({ _: 'downloadFile', file_id: file.id, priority: 32, offset: 0, limit: 0, synchronous: false })
  releaseHandback()
  const tail = await pending
  assert.ok(tail)
  assert.equal(await joined, tail)
  assert.deepEqual(tail.buffer, bytes)
  assert.equal(tail.tailOffset, 5722112)
  assert.equal(tail.totalSize, STREAM_SIZE)
  assert.equal(downloads()[0].limit, STREAM_TAIL_SIZE)
  assert.equal(downloads()[0].offset % 4096, 0)
  assert.equal(downloads()[1].offset, 0)
  assert.equal(downloads()[1].limit, 0)
  assert.equal(downloads()[1].synchronous, false)
  assert.equal(tg.videoTailBusy(file.id), false)
  assert.equal(cl.requests.some((r) => r._ === 'readFilePart'), false)
  prefix = 8192
  file.local.download_offset = 0
  file.local.downloaded_prefix_size = prefix
  cl.update({ _: 'updateFile', file })
  assert.equal((await tg.getWatermarks(file.id, 0))?.prefix, prefix)
  assert.equal(tg.downloadComplete(file.id), false)
  mock.timers.tick(30000)
  await tick()
  assert.equal(downloads().length, 2, 'cleared timeout handles never cause another handback')
})

test('fetchVideoTail: requires the whole range and refreshes a changing non-ID temp path', async () => {
  const garbage = Buffer.alloc(STREAM_TAIL_SIZE, 0x58)
  mp4Box('moov', Buffer.alloc(128)).copy(garbage, garbage.length - 136)
  const oldPath = sparseVideo('tail-old', garbage)
  const bytes = Buffer.alloc(STREAM_TAIL_SIZE, 0x44)
  const newPath = sparseVideo('tail-new', bytes)
  const file = streamingFile(890, oldPath)
  let coverage = STREAM_TAIL_SIZE - 1
  let probes = 0
  const cl = await signIn((req) => {
    if (req._ === 'getFile' || req._ === 'downloadFile') return file
    if (req._ === 'getFileDownloadedPrefixSize') { probes++; return { _: 'fileDownloadedPrefixSize', size: coverage } }
    return notFound()
  })
  const pending = tg.fetchVideoTail(file.id, STREAM_SIZE, STREAM_TAIL_OFFSET)
  await until(() => probes > 0)
  for (let i = 0; i < 10; i++) await tick()
  assert.equal(tg.getVideoTail(file.id), undefined, 'dense bytes and a moov cannot prove the missing final byte')
  file.local.path = newPath
  coverage = STREAM_TAIL_SIZE
  mock.timers.tick(250)
  const tail = await pending
  assert.ok(tail)
  assert.deepEqual(tail.buffer, bytes)
  assert.equal(await tg.getStreamingFilePath(file.id), newPath)
  file.local.path = ''
  assert.equal(await tg.getStreamingFilePath(file.id), newPath, 'empty metadata retains the actual path')
  const signedIn = answer
  answer = (req, client) => req._ === 'getFile' ? notFound() : signedIn(req, client)
  assert.equal(await tg.getStreamingFilePath(file.id), newPath, 'a transient failure retains the actual path')
  assert.equal(cl.requests.filter((r) => r._ === 'downloadFile').length, 2)
})

test('fetchVideoTail: polls coverage and the actual path while the synchronous answer is still pending', async () => {
  const bytes = Buffer.alloc(STREAM_TAIL_SIZE, 0x46)
  const file = streamingFile(891, '')
  const actual = sparseVideo('pending-actual', bytes)
  let coverage = 0, probes = 0
  const cl = await signIn((req) => {
    if (req._ === 'getFile') return file
    if (req._ === 'getFileDownloadedPrefixSize') { probes++; return { _: 'fileDownloadedPrefixSize', size: coverage } }
    if (req._ === 'downloadFile') return req.synchronous ? new Promise(() => {}) : file
    return notFound()
  })
  const pending = tg.fetchVideoTail(file.id, STREAM_SIZE, STREAM_TAIL_OFFSET)
  await until(() => probes > 0)
  for (let i = 0; i < 10; i++) await tick()
  file.local.path = actual
  coverage = STREAM_TAIL_SIZE
  mock.timers.tick(250)
  const tail = await pending
  assert.ok(tail)
  assert.deepEqual(tail.buffer, bytes)
  assert.equal(cl.requests.filter((r) => r._ === 'downloadFile').length, 2)
  assert.equal(fs.existsSync(path.join(dir, 'files', 'temp', String(file.id))), false)
})

test('fetchVideoTail: an idle unconfirmed sparse range fails closed after 30 seconds and hands back once', async (t) => {
  const garbage = Buffer.alloc(STREAM_TAIL_SIZE, 0x58)
  mp4Box('moov', Buffer.alloc(128)).copy(garbage, garbage.length - 136)
  const file = streamingFile(892, sparseVideo('unconfirmed', garbage))
  let now = Date.now(), probes = 0
  t.mock.method(Date, 'now', () => now)
  const cl = await signIn((req) => {
    if (req._ === 'getFile' || req._ === 'downloadFile') return file
    if (req._ === 'getFileDownloadedPrefixSize') { probes++; return { _: 'fileDownloadedPrefixSize', size: 0 } }
    return notFound()
  })
  const pending = tg.fetchVideoTail(file.id, STREAM_SIZE, STREAM_TAIL_OFFSET)
  await until(() => probes > 0)
  for (let i = 0; i < 10; i++) await tick()
  assert.equal(tg.getVideoTail(file.id), undefined)
  now += 29750
  mock.timers.tick(29750)
  await until(() => probes > 1)
  for (let i = 0; i < 10; i++) await tick()
  assert.equal(tg.videoTailBusy(file.id), true)
  assert.equal(cl.requests.filter((r) => r._ === 'downloadFile').length, 1)
  now += 250
  mock.timers.tick(250)
  assert.equal(await pending, null)
  assert.equal(tg.getVideoTail(file.id), undefined)
  assert.equal(cl.requests.filter((r) => r._ === 'downloadFile' && r.offset === 0).length, 1)
  assert.equal(tg.videoTailBusy(file.id), false)
})

test('fetchVideoTail: joined callers share cancellation without starting a new download or handback', async () => {
  const file = streamingFile(893, '')
  const cl = await signIn((req) => {
    if (req._ === 'getFile') return file
    if (req._ === 'downloadFile') return new Promise(() => {})
    if (req._ === 'cancelDownloadFile') return { _: 'ok' }
    return notFound()
  })
  const pending = tg.fetchVideoTail(file.id, STREAM_SIZE)
  await until(() => cl.requests.some((r) => r._ === 'downloadFile'))
  const joined = tg.fetchVideoTail(file.id, STREAM_SIZE, STREAM_SIZE - 1)
  const differentWindow = tg.fetchVideoTail(file.id, STREAM_SIZE + 4096)
  await tg.invoke({ _: 'cancelDownloadFile', file_id: file.id, only_if_pending: false })
  assert.deepEqual(await Promise.all([pending, joined, differentWindow]), [null, null, null])
  assert.equal(cl.requests.filter((r) => r._ === 'cancelDownloadFile').length, 1)
  assert.equal(cl.requests.filter((r) => r._ === 'downloadFile').length, 1)
  assert.equal(tg.videoTailBusy(file.id), false)
})

test('fetchVideoTail: the production Chromium request downloads only its 64,144-byte confirmed suffix, never sparse padding', async () => {
  const moov = mp4Box('moov', Buffer.alloc(1024, 0x53))
  const head = Buffer.alloc(64 * 1024)
  const ftyp = mp4Box('ftyp', Buffer.from('isom'))
  ftyp.copy(head)
  const mdat = mp4Box('mdat')
  mdat.writeUInt32BE(PRODUCTION_SIZE - ftyp.length - moov.length)
  mdat.copy(head, ftyp.length)
  const bytes = Buffer.alloc(PRODUCTION_SIZE - CHROMIUM_OFFSET, 0x56)
  bytes.fill(0, 4096, 8192) // Verified zeros are legitimate; unconfirmed sparse zeros are not.
  moov.copy(bytes, bytes.length - moov.length)
  const actual = sparseVideo('production-temp-1036', bytes, head, PRODUCTION_SIZE, CHROMIUM_OFFSET)
  const file = streamingFile(902, actual, head.length, PRODUCTION_SIZE)
  let coverage = 0, probes = 0, handbacks = 0
  let releaseHandback!: () => void
  const handbackGate = new Promise<void>((resolve) => { releaseHandback = resolve })
  const cl = await signIn((req) => {
    if (req._ === 'getFile') return file
    if (req._ === 'getFileDownloadedPrefixSize') {
      if (req.offset === 0) return { _: 'fileDownloadedPrefixSize', size: head.length }
      assert.equal(req.offset, CHROMIUM_OFFSET)
      probes++
      return { _: 'fileDownloadedPrefixSize', size: coverage }
    }
    if (req._ === 'downloadFile') {
      if (req.synchronous) return new Promise(() => {})
      handbacks++
      return handbackGate.then(() => file)
    }
    return notFound()
  })
  assert.equal(await tg.probeVideoHead(file.id, PRODUCTION_SIZE, actual), 'tail')
  const pending = tg.fetchVideoTail(file.id, PRODUCTION_SIZE, CHROMIUM_OFFSET)
  await until(() => probes === 1)
  for (let i = 0; i < 10; i++) await tick()
  const range = cl.requests.find((r) => r._ === 'downloadFile')!
  assert.equal(range.offset, 68812800)
  assert.equal(range.limit, 64144)
  assert.equal(range.offset % 4096, 0)
  assert.equal(fs.statSync(actual).size, PRODUCTION_SIZE)
  assert.equal(tg.getVideoTail(file.id), undefined)
  assert.equal(handbacks, 0)
  file.local.download_offset = CHROMIUM_OFFSET
  file.local.downloaded_prefix_size = coverage = bytes.length - 1
  file.local.downloaded_size = PRODUCTION_SIZE
  cl.update({ _: 'updateFile', file })
  mock.timers.tick(250)
  await until(() => probes === 2)
  for (let i = 0; i < 10; i++) await tick()
  assert.equal(tg.getVideoTail(file.id), undefined, 'one missing confirmed byte forbids the whole buffer')
  assert.equal(handbacks, 0)
  assert.equal((await tg.getWatermarks(file.id, 0))?.prefix, head.length, 'tail bytes never enlarge offset-0 coverage')
  coverage = bytes.length
  mock.timers.tick(250)
  await until(() => handbacks === 1)
  assert.equal(tg.videoTailBusy(file.id), true, 'confirmed bytes still await the single handback')
  releaseHandback()
  const tail = await pending
  assert.ok(tail)
  assert.deepEqual(tail, { totalSize: PRODUCTION_SIZE, tailOffset: CHROMIUM_OFFSET, buffer: bytes })
  assert.equal(tail.buffer.length, 64144, 'no 5 MiB zero-filled padding reaches the decoder')
  assert.equal(handbacks, 1)
  assert.equal(cl.requests.some((r) => r._ === 'readFilePart'), false)
})

test('prefetchVideoTail: warms the aligned last 64 KiB, expanding to the unchanged eligible floor only after full confirmation', async () => {
  const head = Buffer.concat([mp4Box('ftyp', Buffer.from('isom')), mp4Box('mdat', Buffer.alloc(16))])
  const bytes = Buffer.alloc(PRODUCTION_SIZE - PRODUCTION_SUFFIX_OFFSET, 0x61)
  const oldPath = sparseVideo('production-small-suffix', bytes, head, PRODUCTION_SIZE, PRODUCTION_SUFFIX_OFFSET)
  const expandedBytes = Buffer.alloc(PRODUCTION_SIZE - PRODUCTION_FLOOR, 0x62)
  bytes.copy(expandedBytes, PRODUCTION_SUFFIX_OFFSET - PRODUCTION_FLOOR)
  const newPath = sparseVideo('production-expanded-suffix', expandedBytes, head, PRODUCTION_SIZE, PRODUCTION_FLOOR)
  const file = streamingFile(903, oldPath, head.length, PRODUCTION_SIZE)
  let expandedCoverage = 0, expandedProbes = 0
  const cl = await signIn((req) => {
    if (req._ === 'getFile') return file
    if (req._ === 'downloadFile') return req.synchronous ? new Promise(() => {}) : file
    if (req._ === 'getFileDownloadedPrefixSize') {
      if (req.offset === 0) return { _: 'fileDownloadedPrefixSize', size: head.length }
      if (req.offset === PRODUCTION_SUFFIX_OFFSET) return { _: 'fileDownloadedPrefixSize', size: bytes.length }
      assert.equal(req.offset, PRODUCTION_FLOOR)
      expandedProbes++
      return { _: 'fileDownloadedPrefixSize', size: expandedCoverage }
    }
    return notFound()
  })
  tg.prefetchVideoTail(file.id, PRODUCTION_SIZE, oldPath)
  await until(() => Boolean(tg.getVideoTail(file.id)) && !tg.videoTailBusy(file.id))
  const warmed = tg.getVideoTail(file.id)!
  assert.deepEqual(warmed, { totalSize: PRODUCTION_SIZE, tailOffset: 68808704, buffer: bytes })
  assert.equal(warmed.buffer.length, 68240)
  const downloads = () => cl.requests.filter((r) => r._ === 'downloadFile')
  assert.deepEqual(downloads().map((r) => [r.offset, r.limit]), [[68808704, 68240], [0, 0]])
  const eligibleFloor = Math.floor(Math.max(0, PRODUCTION_SIZE - Math.min(PRODUCTION_SIZE, 5 * 1024 * 1024)) / 4096) * 4096
  assert.equal(eligibleFloor, PRODUCTION_FLOOR, 'the range policy floor is byte-identical')
  assert.equal(await tg.fetchVideoTail(file.id, PRODUCTION_SIZE, eligibleFloor - 1), null)
  assert.equal(await tg.fetchVideoTail(file.id, PRODUCTION_SIZE, PRODUCTION_SIZE), null)
  assert.equal(downloads().length, 2, 'requests outside the eligible window cannot start a tail download')
  assert.equal(await tg.fetchVideoTail(file.id, PRODUCTION_SIZE, CHROMIUM_OFFSET), warmed, 'the warm suffix covers Chromium through EOF')
  const pending = tg.fetchVideoTail(file.id, PRODUCTION_SIZE, eligibleFloor + 123)
  await until(() => expandedProbes === 1)
  for (let i = 0; i < 10; i++) await tick()
  assert.equal(downloads()[2].offset, eligibleFloor)
  assert.equal(downloads()[2].limit, 5245584)
  assert.equal(tg.getVideoTail(file.id), warmed, 'keep the smaller verified cache while expansion is unconfirmed')
  expandedCoverage = expandedBytes.length - 1
  mock.timers.tick(250)
  await until(() => expandedProbes === 2)
  for (let i = 0; i < 10; i++) await tick()
  assert.equal(tg.getVideoTail(file.id), warmed)
  assert.equal(downloads().length, 3, 'no handback before the entire expanded suffix is confirmed')
  file.local.path = newPath
  expandedCoverage = expandedBytes.length
  mock.timers.tick(250)
  const expanded = await pending
  assert.ok(expanded)
  assert.equal(expanded.tailOffset, eligibleFloor)
  assert.deepEqual(expanded.buffer, expandedBytes)
  assert.equal(tg.getVideoTail(file.id), expanded)
  assert.equal(await tg.getStreamingFilePath(file.id), newPath)
  assert.deepEqual(downloads().map((r) => r.offset), [PRODUCTION_SUFFIX_OFFSET, 0, PRODUCTION_FLOOR, 0])
})

test('fetchVideoTail: numeric coverage progress extends the idle budget beyond the old 25-second synchronous timeout', async (t) => {
  const bytes = Buffer.alloc(PRODUCTION_SIZE - CHROMIUM_OFFSET, 0x71)
  const file = streamingFile(904, sparseVideo('production-progress', bytes, undefined, PRODUCTION_SIZE, CHROMIUM_OFFSET), 4096, PRODUCTION_SIZE)
  let now = Date.now(), coverage = 0, probes = 0, handbacks = 0
  t.mock.method(Date, 'now', () => now)
  const cl = await signIn((req) => {
    if (req._ === 'getFile') return file
    if (req._ === 'getFileDownloadedPrefixSize') { probes++; return { _: 'fileDownloadedPrefixSize', size: coverage } }
    if (req._ === 'downloadFile') {
      if (req.synchronous) return new Promise(() => {})
      handbacks++
      return file
    }
    return notFound()
  })
  const pending = tg.fetchVideoTail(file.id, PRODUCTION_SIZE, CHROMIUM_OFFSET)
  await until(() => probes === 1)
  for (let i = 0; i < 10; i++) await tick()
  for (let step = 1; step <= 7; step++) {
    coverage = step * 8192
    file.local.downloaded_size += 8192
    now += 20000
    mock.timers.tick(20000)
    await until(() => probes === step + 1)
    for (let i = 0; i < 10; i++) await tick()
    assert.equal(tg.videoTailBusy(file.id), true, 'numeric progress refreshes the 30-second idle deadline')
    assert.equal(tg.getVideoTail(file.id), undefined)
    assert.equal(handbacks, 0)
  }
  coverage = bytes.length
  now += 20000
  mock.timers.tick(20000)
  const tail = await pending
  assert.ok(tail)
  assert.deepEqual(tail.buffer, bytes)
  assert.equal(handbacks, 1)
  assert.equal(probes, 9, 'polling is time-paced, not driven by every downloaded chunk')
  assert.deepEqual(cl.requests.filter((r) => r._ === 'downloadFile').map((r) => r.offset), [CHROMIUM_OFFSET, 0])
})

test('fetchVideoTail: even continually progressing numeric coverage is bounded by the five-minute absolute cap', async (t) => {
  const file = streamingFile(905, sparseVideo('production-capped', Buffer.alloc(0), undefined, PRODUCTION_SIZE, CHROMIUM_OFFSET), 4096, PRODUCTION_SIZE)
  let now = Date.now(), coverage = 0, probes = 0, handbacks = 0
  t.mock.method(Date, 'now', () => now)
  const cl = await signIn((req) => {
    if (req._ === 'getFile') return file
    if (req._ === 'getFileDownloadedPrefixSize') { probes++; return { _: 'fileDownloadedPrefixSize', size: coverage } }
    if (req._ === 'downloadFile') {
      if (req.synchronous) return new Promise(() => {})
      handbacks++
      return file
    }
    return notFound()
  })
  const pending = tg.fetchVideoTail(file.id, PRODUCTION_SIZE, CHROMIUM_OFFSET)
  await until(() => probes === 1)
  for (let i = 0; i < 10; i++) await tick()
  for (let step = 1; step < 15; step++) {
    coverage = step * 1024
    now += 20000
    mock.timers.tick(20000)
    await until(() => probes === step + 1)
    for (let i = 0; i < 10; i++) await tick()
    assert.equal(handbacks, 0)
  }
  now += 20000
  mock.timers.tick(20000)
  assert.equal(await pending, null)
  assert.equal(tg.getVideoTail(file.id), undefined)
  assert.equal(handbacks, 1)
  assert.equal(probes, 15, 'the cap stops before issuing another metadata query')
  assert.equal(cl.requests.filter((r) => r._ === 'downloadFile').length, 2)
  mock.timers.tick(300000)
  await tick()
  assert.equal(handbacks, 1, 'cleared polling timers do not linger after failure')
})

test('fetchVideoTail: a synchronous rejection gets bounded coverage grace without retries or a busy loop', async (t) => {
  const file = streamingFile(906, sparseVideo('production-rejected', Buffer.alloc(0), undefined, PRODUCTION_SIZE, CHROMIUM_OFFSET), 4096, PRODUCTION_SIZE)
  let now = Date.now(), probes = 0
  t.mock.method(Date, 'now', () => now)
  const cl = await signIn((req) => {
    if (req._ === 'getFile') return file
    if (req._ === 'getFileDownloadedPrefixSize') { probes++; return { _: 'fileDownloadedPrefixSize', size: 1024 } }
    if (req._ === 'downloadFile') {
      if (req.synchronous) throw new tdl.TDLibError(400, 'Requested range failed')
      return file
    }
    return notFound()
  })
  const pending = tg.fetchVideoTail(file.id, PRODUCTION_SIZE, CHROMIUM_OFFSET)
  await until(() => probes === 1)
  for (let i = 0; i < 10; i++) await tick()
  now += 4750
  mock.timers.tick(4750)
  await until(() => probes === 2)
  for (let i = 0; i < 10; i++) await tick()
  assert.equal(tg.videoTailBusy(file.id), true)
  assert.equal(cl.requests.filter((r) => r._ === 'downloadFile').length, 1)
  now += 250
  mock.timers.tick(250)
  assert.equal(await pending, null)
  assert.equal(tg.getVideoTail(file.id), undefined)
  assert.equal(probes, 3)
  assert.deepEqual(cl.requests.filter((r) => r._ === 'downloadFile').map((r) => r.offset), [CHROMIUM_OFFSET, 0])
})

test('watermarks: only offset-0 prefixes or explicit completion authorize reads, even without a tail', async () => {
  const file = streamingFile(894, '')
  file.local.downloaded_size = STREAM_SIZE
  let reachable = false
  const cl = await signIn((req) => {
    if (req._ === 'getFile' && reachable) return file
    if (req._ === 'getFileDownloadedPrefixSize' && reachable) return { _: 'fileDownloadedPrefixSize', size: 1024 }
    return notFound()
  })
  assert.deepEqual(await tg.watermarkFor(file.id), { prefix: 0, downloaded: 0, size: 0, done: false })
  cl.update({ _: 'updateFile', file })
  assert.equal(tg.trackedReadableEnd(file.id), 4096)
  file.local.download_offset = STREAM_TAIL_OFFSET
  file.local.downloaded_prefix_size = STREAM_TAIL_SIZE
  cl.update({ _: 'updateFile', file })
  assert.equal(tg.trackedReadableEnd(file.id), 4096)
  reachable = true
  assert.deepEqual(await tg.getWatermarks(file.id, 0), { prefix: 1024, downloaded: STREAM_SIZE, size: STREAM_SIZE, done: false })
  assert.equal(tg.trackedReadableEnd(file.id), 1024, 'fresh confirmed coverage may correct an older update')
  file.local.is_downloading_completed = true
  cl.update({ _: 'updateFile', file })
  assert.equal(tg.downloadComplete(file.id), true)
  assert.equal((await tg.getWatermarks(file.id, 0))?.prefix, STREAM_SIZE)
  assert.equal((await tg.getWatermarks(file.id, 0))?.done, true)
})

test('retainStreamingFile: finalized library coverage survives deleteFile, empty updates, and re-download', async () => {
  const id = 897
  const bytes = Buffer.alloc(8192, 0x46)
  const src = path.join(dir, 'files', 'temp', 'retain-source')
  fs.mkdirSync(path.dirname(src), { recursive: true })
  fs.writeFileSync(src, bytes)
  const dest = path.join(temp, 'finalized-library.mp4')
  const file = streamingFile(id, src)
  file.size = file.expected_size = bytes.length
  let reachable = true
  const cl = await signIn((req) => {
    if (req._ === 'getFile' || req._ === 'downloadFile') {
      if (!reachable) return notFound()
      return file
    }
    if (req._ === 'getFileDownloadedPrefixSize') return { _: 'fileDownloadedPrefixSize', size: file.local.downloaded_prefix_size }
    if (req._ === 'deleteFile') {
      file.local.path = ''
      file.local.is_downloading_completed = false
      file.local.downloaded_prefix_size = file.local.downloaded_size = 0
      return { _: 'ok' }
    }
    return notFound()
  })
  assert.equal((await tg.getWatermarks(id, 0))?.prefix, 4096)
  fs.renameSync(src, dest)
  tg.retainStreamingFile(id, dest, bytes.length)
  await tg.invoke({ _: 'deleteFile', file_id: id })
  cl.update({ _: 'updateFile', file })
  reachable = false
  const requests = cl.requests.length
  assert.equal(await tg.getStreamingFilePath(id), dest)
  const complete = { prefix: bytes.length, downloaded: bytes.length, size: bytes.length, done: true }
  assert.deepEqual(await tg.getWatermarks(id, 0), complete)
  assert.deepEqual(await tg.watermarkFor(id), complete)
  assert.equal(tg.trackedReadableEnd(id), bytes.length)
  assert.equal(tg.downloadComplete(id), true)
  assert.equal(await tg.getReadableEnd(id), Number.MAX_SAFE_INTEGER)
  assert.equal(cl.requests.length, requests, 'the retained copy does not depend on TDLib being reachable')
  reachable = true
  file.local.path = src
  file.local.downloaded_prefix_size = file.local.downloaded_size = 1024
  fs.writeFileSync(src, bytes)
  await tg.invoke({ _: 'downloadFile', file_id: id, priority: 32, offset: 0, limit: 0, synchronous: false })
  cl.update({ _: 'updateFile', file })
  assert.equal(await tg.getStreamingFilePath(id), dest, 'a re-download cannot replace the explicitly finalized identity')
  assert.deepEqual(await tg.getWatermarks(id, 0), complete)
  fs.unlinkSync(dest)
  assert.equal(await tg.getStreamingFilePath(id), src, 'a missing retained copy falls back to the actual TDLib cache path')
  assert.deepEqual(await tg.getWatermarks(id, 0), { prefix: 1024, downloaded: 1024, size: bytes.length, done: false })
  assert.equal(tg.downloadComplete(id), false)
  tg.retainStreamingFile(id, src, bytes.length)
  assert.equal((await tg.getWatermarks(id, 0))?.done, false, 'a full-size TDLib temp file cannot be registered as a finalized copy')
  fs.writeFileSync(dest, bytes)
  assert.equal(await tg.getStreamingFilePath(id), src, 'recreating the old path does not resurrect discarded trust')
})

test('retainStreamingFile: pending metadata cannot override a concurrently finalized copy', async () => {
  const id = 899
  const dest = path.join(temp, 'concurrent-finalized.mp4')
  const bytes = Buffer.alloc(64, 0x51)
  fs.writeFileSync(dest, bytes)
  const file = streamingFile(id, '', 0)
  let release!: () => void
  const gate = new Promise<void>((resolve) => { release = resolve })
  const cl = await signIn((req) => {
    if (req._ === 'getFile') return gate.then(() => file)
    if (req._ === 'getFileDownloadedPrefixSize') return { _: 'fileDownloadedPrefixSize', size: 0 }
    if (req._ === 'deleteFile') return { _: 'ok' }
    return notFound()
  })
  const wm = tg.getWatermarks(id, 0)
  const actualPath = tg.getStreamingFilePath(id)
  await until(() => cl.requests.filter((r) => r._ === 'getFile').length === 2)
  tg.retainStreamingFile(id, dest, bytes.length)
  await tg.invoke({ _: 'deleteFile', file_id: id })
  cl.update({ _: 'updateFile', file })
  release()
  assert.equal(await actualPath, dest)
  assert.deepEqual(await wm, { prefix: bytes.length, downloaded: bytes.length, size: bytes.length, done: true })
  fs.unlinkSync(dest)
  assert.equal(await tg.getStreamingFilePath(id), null)
  assert.deepEqual(await tg.watermarkFor(id), { prefix: 0, downloaded: 0, size: STREAM_SIZE, done: false })
})

test('retainStreamingFile: records are bounded, dropped on truncation, and cleared for a new session', async () => {
  const dest = path.join(temp, 'bounded-finalized.mp4')
  fs.writeFileSync(dest, Buffer.alloc(16, 0x51))
  const backend: Answer = (req) => {
    if (req._ === 'getFile') return streamingFile(req.file_id, '', 0)
    if (req._ === 'getFileDownloadedPrefixSize') return { _: 'fileDownloadedPrefixSize', size: 0 }
    return notFound()
  }
  await signIn(backend)
  for (let id = 10000; id <= 10400; id++) tg.retainStreamingFile(id, dest, 16)
  assert.equal(await tg.getStreamingFilePath(10000), null, 'the 401st entry evicts the oldest')
  assert.equal(await tg.getStreamingFilePath(10400), dest)
  fs.truncateSync(dest, 8)
  assert.equal(await tg.getStreamingFilePath(10400), null, 'a truncated completed copy no longer authorizes reads')
  fs.writeFileSync(dest, Buffer.alloc(16, 0x51))
  tg.retainStreamingFile(10400, dest, 16)
  await signIn(backend)
  assert.equal(await tg.getStreamingFilePath(10400), null, 'new-session file IDs cannot inherit retained paths')
  assert.deepEqual(await tg.getWatermarks(10400, 0), { prefix: 0, downloaded: 0, size: STREAM_SIZE, done: false })
})

test('probeVideoHead: partial size64 moov stays unknown; only verified top-level boxes establish faststart', async () => {
  const ftyp = mp4Box('ftyp', Buffer.from('isommoov'))
  const free = mp4Box('free', mp4Box('moov', Buffer.alloc(16)))
  const moov = mp4Box('moov', Buffer.alloc(24), true)
  const head = Buffer.concat([ftyp, free, moov, mp4Box('mdat', Buffer.alloc(16))])
  const actual = sparseVideo('head-faststart', Buffer.alloc(0), head)
  const file = streamingFile(895, actual)
  let prefix = 5
  const cl = await signIn((req) => {
    if (req._ === 'getFile') return file
    if (req._ === 'getFileDownloadedPrefixSize') return { _: 'fileDownloadedPrefixSize', size: prefix }
    return notFound()
  })
  assert.equal(await tg.probeVideoHead(file.id, STREAM_SIZE, actual), 'unknown')
  prefix = ftyp.length + free.length + 15
  assert.equal(await tg.probeVideoHead(file.id, STREAM_SIZE, actual), 'unknown')
  prefix++
  assert.equal(await tg.probeVideoHead(file.id, STREAM_SIZE, actual), 'unknown', 'a verified moov header is not a complete moov')
  assert.equal(tg.videoHasHeadMoov(file.id), false)
  prefix = ftyp.length + free.length + moov.length
  assert.equal(await tg.probeVideoHead(file.id, STREAM_SIZE, actual), 'faststart')
  assert.equal(tg.videoHasHeadMoov(file.id), true)
  tg.prefetchVideoTail(file.id, STREAM_SIZE, actual)
  await tick()
  assert.equal(cl.requests.some((r) => r._ === 'downloadFile'), false)
})

test('prefetchVideoTail: a short head is retryable and mdat before moov fetches the confirmed tail', async () => {
  const ftyp = mp4Box('ftyp', Buffer.from('isommoov'))
  const head = Buffer.concat([ftyp, mp4Box('mdat', Buffer.alloc(16), true)])
  const bytes = Buffer.alloc(STREAM_TAIL_SIZE, 0x51)
  const actual = sparseVideo('head-tail', bytes, head)
  const file = streamingFile(896, actual)
  let prefix = ftyp.length + 8
  let startHandback!: () => void
  const handbackStarted = new Promise<void>((resolve) => { startHandback = resolve })
  const cl = await signIn((req) => {
    if (req._ === 'getFile') return file
    if (req._ === 'downloadFile') {
      if (!req.synchronous) startHandback()
      return file
    }
    if (req._ === 'getFileDownloadedPrefixSize') return { _: 'fileDownloadedPrefixSize', size: req.offset === 0 ? prefix : STREAM_SIZE - req.offset }
    return notFound()
  })
  tg.prefetchVideoTail(file.id, STREAM_SIZE, actual)
  assert.equal(await tg.probeVideoHead(file.id, STREAM_SIZE, actual), 'unknown')
  await tick()
  assert.equal(cl.requests.some((r) => r._ === 'downloadFile'), false)
  assert.equal(tg.videoHasHeadMoov(file.id), false)
  prefix = head.length
  tg.prefetchVideoTail(file.id, STREAM_SIZE, actual)
  await handbackStarted
  await until(() => !tg.videoTailBusy(file.id))
  assert.equal(await tg.probeVideoHead(file.id, STREAM_SIZE, actual), 'tail')
  assert.deepEqual(tg.getVideoTail(file.id)?.buffer, bytes.subarray(STREAM_SUFFIX_OFFSET - STREAM_TAIL_OFFSET))
  assert.deepEqual(cl.requests.filter((r) => r._ === 'downloadFile').map((r) => [r.offset, r.limit]), [[STREAM_SUFFIX_OFFSET, STREAM_SIZE - STREAM_SUFFIX_OFFSET], [0, 0]])
})

test('prefetchVideoTail: retained completion after delete cleanup never requests a tail or consumes an attempt', async () => {
  const head = Buffer.concat([mp4Box('ftyp', Buffer.from('isom')), mp4Box('mdat', Buffer.alloc(16))])
  const src = sparseVideo('prefetch-completed-source', Buffer.alloc(STREAM_TAIL_SIZE, 0x51), head)
  const dest = path.join(temp, 'prefetch-completed-library.mp4')
  const file = streamingFile(900, src, head.length)
  let startHandback!: () => void
  const handbackStarted = new Promise<void>((resolve) => { startHandback = resolve })
  const cl = await signIn((req) => {
    if (req._ === 'getFile') return file
    if (req._ === 'getFileDownloadedPrefixSize') return { _: 'fileDownloadedPrefixSize', size: req.offset === 0 ? file.local.downloaded_prefix_size : STREAM_SIZE - req.offset }
    if (req._ === 'downloadFile') {
      if (req.offset === 0) startHandback()
      return file
    }
    if (req._ === 'deleteFile') {
      file.local.path = ''
      file.local.downloaded_prefix_size = file.local.downloaded_size = 0
      return { _: 'ok' }
    }
    return notFound()
  })
  assert.equal(await tg.probeVideoHead(file.id, STREAM_SIZE, src), 'tail')
  fs.renameSync(src, dest)
  tg.retainStreamingFile(file.id, dest, STREAM_SIZE)
  await tg.invoke({ _: 'deleteFile', file_id: file.id })
  cl.update({ _: 'updateFile', file })
  assert.equal((await tg.getWatermarks(file.id, 0))?.done, true)
  for (let i = 0; i < 3; i++) {
    tg.prefetchVideoTail(file.id, STREAM_SIZE, src)
    // Joining the probe and yielding drains asynchronous prefetch work too, not just the caller.
    assert.equal(await tg.probeVideoHead(file.id, STREAM_SIZE, src), 'tail')
    await tick()
  }
  assert.equal(cl.requests.some((r) => r._ === 'downloadFile'), false, 'delete cleanup must not restart tail downloading for the retained complete file')
  assert.equal(tg.videoTailBusy(file.id), false)
  fs.renameSync(dest, src)
  file.local.path = src
  file.local.downloaded_prefix_size = file.local.downloaded_size = head.length
  cl.update({ _: 'updateFile', file })
  tg.prefetchVideoTail(file.id, STREAM_SIZE, src)
  await handbackStarted
  await until(() => !tg.videoTailBusy(file.id))
  assert.deepEqual(cl.requests.filter((r) => r._ === 'downloadFile').map((r) => r.offset), [STREAM_SUFFIX_OFFSET, 0], 'skipping a completed file does not consume its automatic attempt')
})

test('prefetchVideoTail: cached tail classification checks fresh TDLib completion before downloading', async () => {
  const head = Buffer.concat([mp4Box('ftyp', Buffer.from('isom')), mp4Box('mdat', Buffer.alloc(16))])
  const actual = sparseVideo('prefetch-tdlib-completed', Buffer.alloc(0), head)
  const file = streamingFile(901, actual, head.length)
  let checkedCompletion!: () => void
  const completionChecked = new Promise<void>((resolve) => { checkedCompletion = resolve })
  const cl = await signIn((req) => {
    if (req._ === 'getFile') {
      if (file.local.is_downloading_completed) checkedCompletion()
      return file
    }
    if (req._ === 'getFileDownloadedPrefixSize') return { _: 'fileDownloadedPrefixSize', size: file.local.downloaded_prefix_size }
    if (req._ === 'downloadFile') return file
    return notFound()
  })
  assert.equal(await tg.probeVideoHead(file.id, STREAM_SIZE, actual), 'tail')
  assert.equal(tg.downloadComplete(file.id), false)
  file.local.is_downloading_completed = true
  file.local.downloaded_prefix_size = file.local.downloaded_size = STREAM_SIZE
  // No updateFile: the existing head classification and cached watermark still say incomplete.
  tg.prefetchVideoTail(file.id, STREAM_SIZE, actual)
  await completionChecked
  await tick()
  assert.equal((await tg.getWatermarks(file.id, 0))?.done, true)
  assert.equal(cl.requests.some((r) => r._ === 'downloadFile'), false)
  assert.equal(tg.videoTailBusy(file.id), false)
})

test('prefetchVideoTail: one failed automatic attempt leaves sequential alone; explicit retries, deletion and new sessions remain allowed', async (t) => {
  const head = Buffer.concat([mp4Box('ftyp', Buffer.from('isom')), mp4Box('mdat', Buffer.alloc(16))])
  const actual = sparseVideo('prefetch-once', Buffer.alloc(0), head)
  const file = streamingFile(898, actual, head.length)
  let now = Date.now()
  t.mock.method(Date, 'now', () => now)
  const backend: Answer = (req) => {
    if (req._ === 'getFile') return file
    if (req._ === 'getFileDownloadedPrefixSize') return { _: 'fileDownloadedPrefixSize', size: req.offset === 0 ? head.length : 0 }
    if (req._ === 'downloadFile') {
      if (req.synchronous) throw new tdl.TDLibError(404, 'Tail range unavailable')
      return file
    }
    if (req._ === 'deleteFile' || req._ === 'cancelDownloadFile') return { _: 'ok' }
    return notFound()
  }
  const cl = await signIn(backend)
  const downloads = () => cl.requests.filter((r) => r._ === 'downloadFile')
  const finishFailure = async (pending: Promise<tg.VideoTail | null>, previousProbes: number) => {
    await until(() => cl.requests.filter((r) => r._ === 'getFileDownloadedPrefixSize' && r.offset === STREAM_SUFFIX_OFFSET).length > previousProbes)
    for (let i = 0; i < 10; i++) await tick()
    now += 5000
    mock.timers.tick(5000)
    assert.equal(await pending, null)
    await tick()
  }
  tg.prefetchVideoTail(file.id, STREAM_SIZE, actual)
  await until(() => downloads().some((r) => r.synchronous))
  await finishFailure(tg.fetchVideoTail(file.id, STREAM_SIZE), 0)
  assert.deepEqual(downloads().map((r) => r.offset), [STREAM_SUFFIX_OFFSET, 0])
  now += 6000
  mock.timers.tick(6000)
  for (let i = 0; i < 5; i++) {
    await tg.getWatermarks(file.id, 0)
    tg.prefetchVideoTail(file.id, STREAM_SIZE, actual)
    await tick()
  }
  assert.equal(downloads().length, 2, 'wm polls never restart a failed automatic prefetch after backoff')
  const probes = cl.requests.filter((r) => r._ === 'getFileDownloadedPrefixSize' && r.offset === STREAM_SUFFIX_OFFSET).length
  await finishFailure(tg.fetchVideoTail(file.id, STREAM_SIZE), probes)
  assert.deepEqual(downloads().map((r) => r.offset), [STREAM_SUFFIX_OFFSET, 0, STREAM_SUFFIX_OFFSET, 0], 'an explicit handler retry is not blocked by the automatic-attempt flag')
  await tg.invoke({ _: 'deleteFile', file_id: file.id })
  const afterDelete = cl.requests.filter((r) => r._ === 'getFileDownloadedPrefixSize' && r.offset === STREAM_SUFFIX_OFFSET).length
  tg.prefetchVideoTail(file.id, STREAM_SIZE, actual)
  await until(() => downloads().filter((r) => r.synchronous).length === 3)
  await finishFailure(tg.fetchVideoTail(file.id, STREAM_SIZE), afterDelete)
  assert.equal(downloads().length, 6, 'cache deletion permits one new automatic attempt')
  const next = await signIn(backend)
  tg.prefetchVideoTail(file.id, STREAM_SIZE, actual)
  await until(() => next.requests.some((r) => r._ === 'downloadFile' && r.synchronous))
  const joined = tg.fetchVideoTail(file.id, STREAM_SIZE)
  await tg.invoke({ _: 'cancelDownloadFile', file_id: file.id, only_if_pending: false })
  assert.equal(await joined, null)
  assert.equal(next.requests.filter((r) => r._ === 'downloadFile').length, 1, 'new sessions reset the attempt flag without resurrecting cancellation')
})

test('growing file streaming: delivers initial and appended bytes sequentially', async () => {
  const testFile = path.join(dir, 'growing_test.dat')
  fs.writeFileSync(testFile, Buffer.from('chunk1-data-'))

  let handle: fs.promises.FileHandle | null = await fs.promises.open(testFile, 'r')
  const readChunks: string[] = []

  // Read initial data
  const buf = Buffer.alloc(12)
  const r1 = await handle.read(buf, 0, 12, 0)
  readChunks.push(buf.subarray(0, r1.bytesRead).toString())

  // Append new data to file while handle is held
  fs.appendFileSync(testFile, Buffer.from('chunk2-data-more'))

  // Read subsequent data from offset 12
  const buf2 = Buffer.alloc(16)
  const r2 = await handle.read(buf2, 0, 16, 12)
  readChunks.push(buf2.subarray(0, r2.bytesRead).toString())

  await handle.close()
  assert.deepEqual(readChunks, ['chunk1-data-', 'chunk2-data-more'])
})


