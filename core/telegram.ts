// TDLib client lifecycle, auth, chat cache, links, messages, thumbnails (ARCHITECTURE > Telegram). One TDLib client
// per process, so this module is a singleton; the pure TDLib → shape mappings live in shapes.ts.
import fs from 'node:fs'
import path from 'node:path'
import tdl, { type Client } from 'tdl'
import type * as Td from 'tdlib-types'
import { type AppError, type Emit, fail } from './db.ts'
import {
  type AuthState, type Cache, type Chat, type Creds, extractMedia, type Folder, folderOf, mapAuth, mapConnection, type Me,
  type Message, normalizeLink, rights, tdError, toChat, toMe,
} from './shapes.ts'
import { log } from './storage.ts'

// ---- Client ----

type Deps = { dir: string /* home\tdlib */, version: string, emit: Emit, showArchived: () => boolean, forgetCredentials: () => void }
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

/** Creates the client (closing any previous one); tdl answers WaitTdlibParameters with these options. */
export async function start(c: Creds) {
  await close()
  creds = c
  credError = undefined
  loggingOut = false
  for (const m of [chats, cache.users, cache.basicGroups, cache.supergroups]) m.clear()
  folders = []
  opened.clear()
  connection = 'connecting'
  const cl = tdl.createClient({
    apiId: c.apiId, apiHash: c.apiHash,
    databaseDirectory: path.join(deps.dir, 'db'), filesDirectory: path.join(deps.dir, 'files'),
    tdlibParameters: { use_message_database: true, use_secret_chats: false, system_language_code: 'en',
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
  connection = 'offline'
  await Promise.race([cl.close(), sleep(5000)]).catch((e) => log('warn', `Closing TDLib failed: ${(e as Error).message}`))
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
function setPositions(c: Td.chat, positions: Td.chatPosition[]) {
  for (const p of positions) {
    c.positions = c.positions.filter((x) => !sameList(x.list, p.list))
    if (p.order !== '0') c.positions.push(p)
  }
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
    case 'updateConnectionState': connection = mapConnection(u.state); changed(); break
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
    case 'updateChatPosition': patch(u.chat_id, (c) => setPositions(c, [u.position])); break
    case 'updateChatLastMessage': patch(u.chat_id, (c) => { c.last_message = u.last_message; setPositions(c, u.positions) }); break
    case 'updateChatDraftMessage': patch(u.chat_id, (c) => setPositions(c, u.positions)); break // positions only
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
  return chats.get(id) ?? await invoke({ _: 'getChat', chat_id: id })
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
    if (!got.length) return { messages: out.map(toMessage), more: false }
    out.push(...got)
    from = got[got.length - 1].id
  }
  return { messages: out.map(toMessage), more: true }
}

/** Local path of a thumbnail or avatar for teleflow://thumb; the size is checked before anything downloads. */
export async function thumbFile(remoteId: string) {
  let f = await invoke({ _: 'getRemoteFile', remote_file_id: remoteId })
  if ((f.expected_size || f.size) > 2 * 2 ** 20) throw fail(413, 'Thumbnail too large')
  if (!f.local.is_downloading_completed) f = await invoke({ _: 'downloadFile', file_id: f.id, priority: 32, offset: 0, limit: 0, synchronous: true })
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
