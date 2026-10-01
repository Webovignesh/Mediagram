import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, mock, test } from 'node:test'
import { setImmediate as tick } from 'node:timers/promises'
import tdl from 'tdl'
import type { AppEvent } from '../core/db.ts'
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
tg.init({ dir, version: '9.9.9', emit: (e) => events.push(e), showArchived: () => archived, forgetCredentials: () => { forgot++ } })
const creds = { apiId: 12345, apiHash: 'f'.repeat(32) }

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
  return extra(req, cl)
}
async function signIn(extra: Answer = notFound) {
  answer = base(extra)
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
  assert.deepEqual(all.messages[0], { id: history[0].id, date: 250, sender: 'Fixture User', text: 'm250', media: null })
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
