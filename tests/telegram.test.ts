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
  for (let i = 0; i < 200 && !ok(); i++) await tick()
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
