// TDLib client lifecycle, auth, chat cache, links, messages, thumbnails (ARCHITECTURE > Telegram). One TDLib client
// per process, so this module is a singleton; the pure TDLib → shape mappings live in shapes.ts.
import fs from 'node:fs'
import path from 'node:path'
import tdl, { type Client } from 'tdl'
import type * as Td from 'tdlib-types'
import { type AppError, type DB, deleteMedia, type Emit, fail, getScan, mediaCount, putMedia, putScan, type ScanRow } from './db.ts'
import {
  type AuthState, type Cache, type Chat, type Creds, extractMedia, type Folder, folderOf, mapAuth, mapConnection, type Me,
  type Message, mediaRow, normalizeLink, rights, tdError, toChat, toMe,
} from './shapes.ts'
import { log } from './storage.ts'

// ---- Client ----

type Deps = { dir: string /* home\tdlib */, version: string, db: DB, emit: Emit, showArchived: () => boolean, forgetCredentials: () => void }
let deps: Deps
let client: Client | null = null
let creds: Creds | null = null
let tdAuth: Td.AuthorizationState | null = null
let connection: AuthState['connection'] = 'offline'
let loggingOut = false
let credError: string | undefined
let me: Me | null = null
let auth: AuthState = { step: 'credentials', connection: 'offline' }
const cache: Cache = { meId: 0, users: new Map(), basicGroups: new Map(), supergroups: new Map() }
const chats = new Map<number, Td.chat>()
let folders: Folder[] = []
// ponytail: chats opened but not joined are forgotten on restart; upgrade: persist their ids in settings.
const opened = new Set<number>()
const listeners = new Set<(u: Td.Update) => void>()
const restarted: (() => void)[] = []
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

export const init = (d: Deps) => { deps = d }
export const authState = () => auth
/** Raw TDLib updates for the transfer engine (updateFile, send results). Returns unsubscribe. */
export const onUpdate = (fn: (u: Td.Update) => void) => { listeners.add(fn); return () => { listeners.delete(fn) } }

function changed() {
  const next: AuthState = client ? { connection, ...mapAuth(tdAuth, me) }
    : { connection: 'offline', step: 'credentials', ...(credError && { error: credError }) }
  if (JSON.stringify(next) === JSON.stringify(auth)) return
  if (next.step !== auth.step) log('info', `Telegram: ${next.step}`)
  auth = next
  deps.emit({ type: 'auth', auth })
}
const chatsChanged = () => deps.emit({ type: 'invalidate', topics: ['chats'] })

/** Entering `ready` gives failed media scans one new try; leaving it means TDLib may skip updates for a gap, so no
 *  chat's top-up counts as current any more (ARCHITECTURE > Media index scan). */
function setConnection(c: AuthState['connection']) {
  if (c === 'ready' && connection !== 'ready') failedScans.clear()
  if (c !== 'ready' && connection === 'ready') current.clear()
  connection = c
}

/** Any TDLib call; auth calls use it directly, everything else goes through `invoke`. */
const call: Td.Invoke = async (req) => {
  const cl = client
  if (!cl) throw fail(503, 'Telegram is not connected yet')
  try { return await cl.invoke(req) } catch (e) {
    if (e instanceof Error && /API_ID_INVALID|API_ID_PUBLISHED_FLOOD/.test(e.message)) throw await rejectCredentials(e.message)
    throw tdError(e)
  }
}
/** TDLib calls that need a signed-in account: 503 until auth is `ready`. */
export const invoke: Td.Invoke = (req) => {
  if (auth.step !== 'ready') return Promise.reject(fail(503, 'Telegram is not connected yet'))
  return call(req)
}

let starting = Promise.resolve()
/** Creates the client, closing any previous one. Calls run one after another, so overlapping starts (a double submit)
 *  never leave a second client locking tdlib\db, and the last credentials win. */
export function start(c: Creds) {
  const run = starting.then(() => launch(c))
  starting = run.catch(() => {})
  return run
}

// tdl answers WaitTdlibParameters with these options.
async function launch(c: Creds) {
  await close()
  creds = c
  credError = undefined
  loggingOut = false
  for (const m of [chats, cache.users, cache.basicGroups, cache.supergroups]) m.clear()
  folders = []
  opened.clear()
  setConnection('connecting')
  const cl = tdl.createClient({
    apiId: c.apiId, apiHash: c.apiHash,
    databaseDirectory: path.join(deps.dir, 'db'), filesDirectory: path.join(deps.dir, 'files'),
    tdlibParameters: { use_message_database: true, use_chat_info_database: true, use_file_database: true, use_secret_chats: false, system_language_code: 'en',
      device_model: 'TeleFlow', system_version: 'Windows', application_version: deps.version },
  })
  client = cl
  cl.on('update', (u) => { if (client === cl) onTdUpdate(cl, u) })
  cl.on('error', (e) => {
    if (client !== cl) return
    if (/API_ID_INVALID|API_ID_PUBLISHED_FLOOD/.test(e.message)) void rejectCredentials(e.message)
    else log('warn', `TDLib: ${e.message}`)
  })
  cl.on('close', () => { if (client === cl) void onClosed() })
  changed()
}

/** Drops the client and waits up to 5 s for TDLib to flush its database. Emits nothing. */
export async function close() {
  const cl = client
  if (!cl) return
  client = null
  tdAuth = null
  me = null
  setConnection('offline')
  await Promise.race([cl.close(), sleep(5000)]).catch((e) => log('warn', `Closing TDLib failed: ${(e as Error).message}`))
}

/** Clear All Data: closes the client and forgets the credentials, so auth returns to the API Keys step. */
export function reset() {
  const run = starting.then(async () => { await close(); creds = null; credError = undefined; changed() })
  starting = run.catch(() => {})
  return run
}

async function rejectCredentials(code: string) {
  await close()
  creds = null
  deps.forgetCredentials()
  credError = code.includes('PUBLISHED_FLOOD')
    ? 'Telegram blocked this API ID because it was published. Create a new one at my.telegram.org.'
    : 'Telegram rejected this API ID and hash. Check them at my.telegram.org.'
  changed()
  return fail(400, credError)
}

const removeSession = () => Promise.all(['db', 'files'].map((d) => fs.promises.rm(path.join(deps.dir, d), { recursive: true, force: true, maxRetries: 5 })
  .catch((e) => log('warn', `Could not delete tdlib\\${d}: ${(e as Error).message}`))))

// A closed TDLib client cannot be reused: drop it, delete the session after a logout, and start a fresh one.
async function onClosed() {
  const wasLoggingOut = loggingOut
  client = null
  tdAuth = null
  me = null
  changed()
  if (wasLoggingOut) await removeSession()
  if (creds) await start(creds)
  restarted.splice(0).forEach((r) => r())
}

async function onReady(cl: Client) {
  try {
    const [user, cap] = await Promise.all([call({ _: 'getMe' }), call({ _: 'getOption', name: 'message_caption_length_max' })])
    if (client !== cl) return
    me = toMe(user, cap._ === 'optionValueInteger' ? Number(cap.value) : 0)
    cache.meId = me.id
    changed()
    await invoke({ _: 'createPrivateChat', user_id: me.id, force: false }) // Saved Messages exists even if never used
    await loadLists()
  } catch (e) {
    log('error', `Loading the Telegram account failed: ${(e as Error).stack ?? String(e)}`)
  }
}

/** loadChats until 404 for the main list, each folder, and the archive when shown. */
export async function loadLists() {
  const lists: Td.ChatList$Input[] = [{ _: 'chatListMain' }, ...folders.map((f) => ({ _: 'chatListFolder' as const, chat_folder_id: f.id }))]
  if (deps.showArchived()) lists.push({ _: 'chatListArchive' })
  for (const chat_list of lists) {
    try { for (;;) await invoke({ _: 'loadChats', chat_list, limit: 100 }) } catch (e) {
      if ((e as AppError).status !== 404) log('warn', `Loading ${chat_list._} stopped: ${(e as Error).message}`)
    }
  }
}

const sameList = (a: Td.ChatList, b: Td.ChatList) => a._ === b._ && (a._ !== 'chatListFolder' || a.chat_folder_id === (b as Td.chatListFolder).chat_folder_id)
// updateChatPosition changes one list (order 0 = removed from it); last-message and draft updates carry the full list.
function setPosition(c: Td.chat, p: Td.chatPosition) {
  c.positions = c.positions.filter((x) => !sameList(x.list, p.list))
  if (p.order !== '0') c.positions.push(p)
}
function patch(id: number, fn: (c: Td.chat) => void) {
  const c = chats.get(id)
  if (c) { fn(c); chatsChanged() }
}

function onTdUpdate(cl: Client, u: Td.Update) {
  switch (u._) {
    case 'updateAuthorizationState':
      tdAuth = u.authorization_state
      if (tdAuth._ === 'authorizationStateLoggingOut') loggingOut = true
      if (tdAuth._ === 'authorizationStateReady') void onReady(cl)
      else me = null
      changed()
      break
    case 'updateConnectionState': setConnection(mapConnection(u.state)); changed(); break
    case 'updateNewMessage': upkeep(u.message); break
    case 'updateDeleteMessages':
      if (!u.is_permanent || u.from_cache) break // TDLib cache evictions are not deletions (FileGram lesson)
      if (deleteMedia(deps.db, u.chat_id, u.message_ids)) mediaChanged(u.chat_id)
      deps.emit({ type: 'invalidate', topics: [`messages:${u.chat_id}`] })
      break
    case 'updateOption':
      if (u.name === 'message_caption_length_max' && me && u.value._ === 'optionValueInteger') { me = { ...me, captionMax: Number(u.value.value) }; changed() }
      break
    case 'updateUser':
      cache.users.set(u.user.id, u.user)
      if (me && u.user.id === me.id) { me = toMe(u.user, me.captionMax); changed() }
      if (chats.has(u.user.id)) chatsChanged() // a private chat's id is its user's id
      break
    case 'updateBasicGroup': cache.basicGroups.set(u.basic_group.id, u.basic_group); chatsChanged(); break
    case 'updateSupergroup': cache.supergroups.set(u.supergroup.id, u.supergroup); chatsChanged(); break
    case 'updateNewChat': chats.set(u.chat.id, u.chat); chatsChanged(); break
    case 'updateChatTitle': patch(u.chat_id, (c) => { c.title = u.title }); break
    case 'updateChatPhoto': patch(u.chat_id, (c) => { c.photo = u.photo }); break
    case 'updateChatPermissions': patch(u.chat_id, (c) => { c.permissions = u.permissions }); break
    case 'updateChatPosition': patch(u.chat_id, (c) => setPosition(c, u.position)); break
    case 'updateChatLastMessage': patch(u.chat_id, (c) => { c.last_message = u.last_message; c.positions = u.positions }); break
    case 'updateChatDraftMessage': patch(u.chat_id, (c) => { c.positions = u.positions }); break // positions only
    case 'updateChatAddedToList': patch(u.chat_id, (c) => { c.chat_lists = [...c.chat_lists.filter((l) => !sameList(l, u.chat_list)), u.chat_list] }); break
    case 'updateChatRemovedFromList': patch(u.chat_id, (c) => { c.chat_lists = c.chat_lists.filter((l) => !sameList(l, u.chat_list)) }); break
    case 'updateChatReadInbox': patch(u.chat_id, (c) => { c.unread_count = u.unread_count }); break
    case 'updateChatFolders':
      folders = u.chat_folders.map(folderOf)
      chatsChanged()
      if (auth.step === 'ready') void loadLists()
      break
  }
  for (const fn of listeners) fn(u)
}

// Valid from the phone, code, and password steps ("use a different number" sends a new phone).
export const sendPhone = async (phone: string) => { await call({ _: 'setAuthenticationPhoneNumber', phone_number: phone }) }
export const sendCode = async (code: string) => { await call({ _: 'checkAuthenticationCode', code }) }
export const sendPassword = async (password: string) => { await call({ _: 'checkAuthenticationPassword', password }) }

/** Logs out; with Telegram unreachable for 15 s the local session is deleted anyway (`local: true`).
 *  ponytail: the queue is kept and jobs are not tied to an account; upgrade: store me.id on jobs and pause other accounts' jobs. */
export async function logout() {
  const cl = client
  if (!cl) return { local: true }
  const fresh = new Promise<void>((r) => restarted.push(r))
  const ok = await Promise.race([call({ _: 'logOut' }).then(() => fresh).then(() => true, () => false), sleep(15_000).then(() => false)])
  if (!ok) {
    await close()
    await removeSession()
    if (creds) await start(creds)
  }
  return { local: !ok }
}

// ---- Chats, links, messages, thumbnails ----

const order = (c: Td.chat, list: 'chatListMain' | 'chatListArchive') => BigInt(c.positions.find((p) => p.list._ === list)?.order ?? -1)
const cmp = (a: bigint, b: bigint) => (a > b ? 1 : a < b ? -1 : 0)

/** Main list (+ archive when shown), Saved Messages, and chats opened this session; no TDLib calls. */
export function chatList() {
  if (auth.step !== 'ready') throw fail(503, 'Telegram is not connected yet')
  const archived = deps.showArchived()
  const listed = [...chats.values()].filter((c) => opened.has(c.id) || (c.type._ === 'chatTypePrivate' && c.type.user_id === cache.meId)
    || c.positions.some((p) => p.list._ === 'chatListMain' || (archived && p.list._ === 'chatListArchive')))
  listed.sort((a, b) => cmp(order(b, 'chatListMain'), order(a, 'chatListMain')) || cmp(order(b, 'chatListArchive'), order(a, 'chatListArchive')))
  return { chats: listed.map((c) => toChat(c, cache)).filter((c) => c !== null), folders }
}
export const chat = (id: number) => { const c = chats.get(id); return c ? toChat(c, cache) : null }
export const mediaRights = (id: number) => { const c = chats.get(id); return c ? rights(c, cache) : null }

const notALink = () => fail(400, "That link isn't a chat or message link")
/** getInternalLinkType; TDLib's 404 for a non-Telegram link becomes a 400. */
export const linkType = (link: string) => invoke({ _: 'getInternalLinkType', link: normalizeLink(link) })
  .catch((e) => { throw (e as AppError).status === 404 ? notALink() : e })
const getChat = async (id: number) => {
  if (!id) throw fail(404, "You don't have access to that chat")
  let c = chats.get(id)
  if (!c) {
    c = await invoke({ _: 'getChat', chat_id: id })
    chats.set(c.id, c)
    chatsChanged()
  }
  return c
}

/** Opens a public chat, invite link, or message link; an unjoined invite returns a preview unless `join`. */
export async function openChat(link: string, join: boolean) {
  const t = await linkType(link)
  let c: Td.chat
  if (t._ === 'internalLinkTypePublicChat') c = await invoke({ _: 'searchPublicChat', username: t.chat_username })
  else if (t._ === 'internalLinkTypeMessage') c = await getChat((await invoke({ _: 'getMessageLinkInfo', url: t.url })).chat_id)
  else if (t._ === 'internalLinkTypeChatInvite') {
    const info = await invoke({ _: 'checkChatInviteLink', invite_link: t.invite_link })
    if (info.chat_id) c = await getChat(info.chat_id)
    else if (!join) return { invite: { title: info.title, members: info.member_count, photo: info.photo?.small.remote.id || null } }
    else {
      const r = await invoke({ _: 'joinChatByInviteLink', invite_link: t.invite_link })
      if (r._ === 'chatJoinResultRequestSent') throw fail(409, 'Your request to join was sent. You can open the chat once an admin approves it.')
      if (r._ !== 'chatJoinResultSuccess') throw fail(403, "This chat didn't let you join. Try it in the official Telegram app.")
      c = await getChat(r.chat_id)
    }
  } else throw notALink()
  opened.add(c.id)
  chatsChanged()
  return { chat: toChat(chats.get(c.id) ?? c, cache) as Chat }
}

const senderName = (s: Td.MessageSender) => s._ === 'messageSenderUser'
  ? [cache.users.get(s.user_id)?.first_name, cache.users.get(s.user_id)?.last_name].filter(Boolean).join(' ')
  : chats.get(s.chat_id)?.title ?? ''
const toMessage = (m: Td.message): Message => ({
  id: m.id, date: m.date, sender: senderName(m.sender_id), media: extractMedia(m),
  text: m.content._ === 'messageText' ? m.content.text.text : 'caption' in m.content ? m.content.caption.text : '',
})

/** The newest `limit` messages, paging getChatHistory by 100 (TDLib returns short first pages).
 *  ponytail: capped at the newest 1000 messages (chats.messages limit); older media are reachable in Files View;
 *  upgrade: cursor paging with an `until` bound. */
export async function messages(chatId: number, limit: number) {
  if (auth.step !== 'ready') throw fail(503, 'Telegram is not connected yet')
  if (!chats.has(chatId)) throw fail(404, 'Chat not found')
  const out: Td.message[] = []
  for (let from = 0; out.length < limit;) {
    const page = await invoke({ _: 'getChatHistory', chat_id: chatId, from_message_id: from, offset: 0, limit: Math.min(100, limit - out.length), only_local: false })
    const got = page.messages.filter((m) => m !== null)
    if (!got.length) {
      const msgs = out.map(toMessage)
      prefetchThumbs(msgs.map((m) => m.media?.thumb))
      return { messages: msgs, more: false }
    }
    out.push(...got)
    from = got[got.length - 1].id
  }
  const msgs = out.map(toMessage)
  prefetchThumbs(msgs.map((m) => m.media?.thumb))
  return { messages: msgs, more: true }
}

/** Leave a channel or supergroup, or delete chat from list */
export async function leaveChat(chatId: number) {
  if (auth.step !== 'ready') throw fail(503, 'Telegram is not connected yet')
  try {
    await invoke({ _: 'leaveChat', chat_id: chatId })
  } catch {
    await invoke({ _: 'deleteChatHistory', chat_id: chatId, remove_from_chat_list: true, revoke: false })
  }
  chats.delete(chatId)
  opened.delete(chatId)
  chatsChanged()
}

/** Delete chat history and remove from chat list */
export async function deleteChat(chatId: number) {
  if (auth.step !== 'ready') throw fail(503, 'Telegram is not connected yet')
  try {
    await invoke({ _: 'deleteChatHistory', chat_id: chatId, remove_from_chat_list: true, revoke: true })
  } catch {
    await invoke({ _: 'leaveChat', chat_id: chatId })
  }
  chats.delete(chatId)
  opened.delete(chatId)
  chatsChanged()
}

/** Clear all message history in a chat without leaving */
export async function clearChat(chatId: number) {
  if (auth.step !== 'ready') throw fail(503, 'Telegram is not connected yet')
  await invoke({ _: 'deleteChatHistory', chat_id: chatId, remove_from_chat_list: false, revoke: false })
  mediaChanged(chatId)
}

/** Send a text message to a chat */
export async function sendMessage(chatId: number, textMsg: string) {
  if (auth.step !== 'ready') throw fail(503, 'Telegram is not connected yet')
  const content = textMsg.trim()
  if (!content) throw fail(400, 'Message cannot be empty')
  await invoke({
    _: 'sendMessage',
    chat_id: chatId,
    input_message_content: {
      _: 'inputMessageText',
      text: { _: 'formattedText', text: content, entities: [] },
      clear_draft: true,
    },
  })
}

/** downloads.add `{ link }`: the linked message, or its whole album when the link points at one. */
export async function linkMessages(link: string) {
  const t = await linkType(link)
  if (t._ !== 'internalLinkTypeMessage') throw notALink()
  const info = await invoke({ _: 'getMessageLinkInfo', url: t.url })
  if (!info.chat_id) throw fail(404, "You don't have access to that chat")
  const m = info.message
  if (!m || !extractMedia(m)) throw fail(400, 'That message has no media to download')
  if (!info.for_album || m.media_album_id === '0') return { chatId: info.chat_id, messages: [m] }
  // Siblings share media_album_id; an album has at most 10 messages, so one page around the message holds them all.
  const page = await invoke({ _: 'getChatHistory', chat_id: info.chat_id, from_message_id: m.id, offset: -10, limit: 20, only_local: false })
  const album = page.messages.filter((x): x is Td.message => !!x && x.media_album_id === m.media_album_id && !!extractMedia(x))
  return { chatId: info.chat_id, messages: album.length ? album.sort((a, b) => a.id - b.id) : [m] }
}

// ---- Media index scan (ARCHITECTURE > Media index scan) ----

const failedScans = new Set<number>() // a page failed: no new scan until the connection next enters ready
const current = new Set<number>() // top-up finished since the connection was last ready: live upkeep may move newest_id
let scan: { chatId: number, stop: boolean } | null = null
let scans = Promise.resolve()
const throttle = new Map<number, { dirty: boolean }>()
const counted = [{ _: 'searchMessagesFilterPhoto' }, { _: 'searchMessagesFilterVideo' }, { _: 'searchMessagesFilterDocument' },
  { _: 'searchMessagesFilterAudio' }, { _: 'searchMessagesFilterAnimation' }, { _: 'searchMessagesFilterVoiceNote' },
  { _: 'searchMessagesFilterVideoNote' }] as const // TDLib rejects searchMessagesFilterEmpty here

/** Whether chats.media starts a scan: no row yet, backfill unfinished, or a newer last message than the walk has seen. */
export const scanNeeded = (row: ScanRow | undefined, lastId: number | null, failed: boolean) =>
  !failed && (!row || !row.complete || (lastId !== null && row.newest_id < lastId))

/** `media:<chatId>` at most once per second (a change inside the second is sent when it ends); `now` for state changes. */
function mediaChanged(chatId: number, now = false) {
  const t = throttle.get(chatId)
  if (t && !now) { t.dirty = true; return }
  deps.emit({ type: 'invalidate', topics: [`media:${chatId}`] })
  const entry = { dirty: false }
  throttle.set(chatId, entry)
  setTimeout(() => {
    if (throttle.get(chatId) === entry) throttle.delete(chatId)
    if (entry.dirty) mediaChanged(chatId)
  }, 1000)
}

/** chats.media's index bar; `indexed` is clamped to the approximate total. */
export function scanInfo(chatId: number) {
  const row = getScan(deps.db, chatId)
  const indexed = mediaCount(deps.db, chatId)
  const state = scan?.chatId === chatId ? 'scanning' as const
    : row?.complete && row.newest_id >= (chats.get(chatId)?.last_message?.id ?? 0) ? 'done' as const : 'idle' as const
  return { state, indexed: row?.total != null ? Math.min(indexed, row.total) : indexed, total: row?.total ?? null }
}

/** Starts this chat's scan when it needs one; asking for another chat stops the current one after its page. */
export function ensureScan(chatId: number) {
  if (auth.step !== 'ready' || scan?.chatId === chatId) return
  if (!scanNeeded(getScan(deps.db, chatId), chats.get(chatId)?.last_message?.id ?? null, failedScans.has(chatId))) return
  if (scan) scan.stop = true
  const s = { chatId, stop: false }
  scan = s
  scans = scans.then(() => runScan(s))
}
/** Clear app data: the running scan stops after its page. */
export const stopScan = () => { if (scan) scan.stop = true; scan = null }

async function historyPage(chatId: number, from: number, s: { stop: boolean }) {
  for (;;) {
    try {
      const r = await invoke({ _: 'getChatHistory', chat_id: chatId, from_message_id: from, offset: 0, limit: 100, only_local: false })
      return r.messages.filter((m): m is Td.message => m !== null)
    } catch (e) {
      const err = e as AppError
      if (err.status !== 429 || !err.retryAfter || s.stop) throw e
      log('warn', `Media scan waits ${err.retryAfter} s (flood wait)`)
      await sleep(err.retryAfter * 1000) // flood waits sleep and continue
    }
  }
}

function index(chatId: number, messages: Td.message[]) {
  putMedia(deps.db, messages.flatMap((m) => { const x = extractMedia(m); return x ? [mediaRow(chatId, m, x)] : [] })) // INSERT OR REPLACE: overlaps are harmless
  mediaChanged(chatId)
}

/** Top-up from the newest message down to newest_id (the first walk creates the row with its first page), then
 *  backfill from oldest_id until an empty page. Progress is persisted per page, so a stopped scan resumes later. */
async function runScan(s: { chatId: number, stop: boolean }) {
  const { chatId } = s, { db } = deps
  const stopped = () => s.stop || auth.step !== 'ready'
  if (stopped()) { if (scan === s) scan = null; return }
  mediaChanged(chatId, true)
  try {
    const total = await Promise.all(counted.map((filter) => invoke({ _: 'getChatMessageCount', chat_id: chatId, filter, return_local: false })))
      .then((cs) => cs.reduce((n, c) => n + c.count, 0), () => null) // approximate: TDLib says so
    let row = getScan(db, chatId)
    const last = chats.get(chatId)?.last_message?.id ?? null
    if (!row || (last !== null && row.newest_id < last)) {
      let from = 0, newest = 0
      for (;;) {
        if (stopped()) return // newest_id stays, so the next top-up starts from the top again instead of leaving a gap
        const page = await historyPage(chatId, from, s)
        if (!page.length) break
        newest ||= page[0].id
        index(chatId, page)
        const oldest = page[page.length - 1].id
        if (!row) { putScan(db, { chat_id: chatId, newest_id: newest, oldest_id: oldest, complete: 0, total }); break }
        if (oldest <= row.newest_id) break
        from = oldest
      }
      if (row) putScan(db, { ...row, newest_id: Math.max(row.newest_id, newest), total })
      else if (!newest) putScan(db, { chat_id: chatId, newest_id: 0, oldest_id: 0, complete: 1, total }) // an empty chat
      current.add(chatId)
    } else putScan(db, { ...row, total })
    let walk: ScanRow = getScan(db, chatId)!
    while (!walk.complete) {
      if (stopped()) return
      const oldest = walk.oldest_id
      const page = (await historyPage(chatId, oldest, s)).filter((m) => m.id < oldest)
      index(chatId, page)
      walk = { ...walk, oldest_id: page.length ? page[page.length - 1].id : oldest, complete: page.length ? 0 : 1 }
      putScan(db, walk)
    }
  } catch (e) {
    // ponytail: a failed scan shows as idle with no reason in the UI; upgrade: scan.state 'failed' with the error text.
    if (!stopped()) { failedScans.add(chatId); log('warn', `Media scan of chat ${chatId} stopped: ${(e as Error).message}`) }
  } finally {
    if (scan === s) scan = null
    mediaChanged(chatId, true) // the index bar hides
  }
}

/** updateNewMessage: media joins the index of a chat that has one; newest_id moves only for current chats, so after an
 *  outage the next chats.media runs one top-up over the gap instead of jumping past it.
 *  ponytail: edits are not tracked, so an edited caption or file stays as indexed; upgrade: handle updateMessageContent. */
function upkeep(m: Td.message) {
  deps.emit({ type: 'invalidate', topics: [`messages:${m.chat_id}`] })
  if (m.sending_state) return // still being sent: a temporary id
  const row = getScan(deps.db, m.chat_id)
  if (!row) return
  const x = extractMedia(m)
  if (x) putMedia(deps.db, [mediaRow(m.chat_id, m, x)])
  if (current.has(m.chat_id) && m.id > row.newest_id) putScan(deps.db, { ...row, newest_id: m.id })
  if (x) mediaChanged(m.chat_id)
}

const thumbPathCache = new Map<string, string>()

/** Prefetch remote thumbnail files asynchronously in background */
export function prefetchThumbs(remoteIds: (string | null | undefined)[]) {
  for (const id of remoteIds) {
    if (!id || typeof id !== 'string' || thumbPathCache.has(id)) continue
    void invoke({ _: 'getRemoteFile', remote_file_id: id }).then((f) => {
      if (!f.local.is_downloading_completed) {
        return invoke({ _: 'downloadFile', file_id: f.id, priority: 32, offset: 0, limit: 0, synchronous: false })
      } else if (f.local.path && fs.existsSync(f.local.path)) {
        thumbPathCache.set(id, f.local.path)
      }
    }).catch(() => {})
  }
}

/** Local path of a thumbnail or avatar for teleflow://thumb; the size is checked before anything downloads. */
export async function thumbFile(remoteId: string) {
  const cached = thumbPathCache.get(remoteId)
  if (cached && fs.existsSync(cached)) return cached
  let f = await invoke({ _: 'getRemoteFile', remote_file_id: remoteId })
  if ((f.expected_size || f.size) > 2 * 2 ** 20) throw fail(413, 'Thumbnail too large')
  if (!f.local.is_downloading_completed) {
    f = await invoke({ _: 'downloadFile', file_id: f.id, priority: 32, offset: 0, limit: 0, synchronous: true })
  }
  if (f.local.path && fs.existsSync(f.local.path)) {
    thumbPathCache.set(remoteId, f.local.path)
  }
  return f.local.path
}

/** Call once, before any other TDLib use. `tdjson` must point outside app.asar: the OS loader cannot read inside it. */
export function configure(tdjson: string, logFile: string) {
  tdl.configure({ tdjson, verbosityLevel: 1 })
  tdl.execute({ _: 'setLogStream', log_stream: { _: 'logStreamFile', path: logFile, max_file_size: 10 * 2 ** 20, redirect_stderr: false } })
}

export function tdlibVersion() {
  const v = tdl.execute({ _: 'getOption', name: 'version' })
  if (v?._ !== 'optionValueString') throw new Error(`TDLib did not report its version: ${JSON.stringify(v)}`)
  return v.value
}
