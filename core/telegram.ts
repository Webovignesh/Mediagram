// TDLib client lifecycle, auth, chat cache, links, messages, thumbnails (ARCHITECTURE > Telegram). One TDLib client
// per process, so this module is a singleton; the pure TDLib → shape mappings live in shapes.ts.
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import tdl, { type Client } from 'tdl'
import type * as Td from 'tdlib-types'
import { type AppError, type DB, deleteMedia, type Emit, fail, getScan, mediaCount, putMedia, putScan, type ScanRow } from './db.ts'
import {
  type AuthState, type Cache, type Chat, type Creds, type DeliveryStatus, extractMedia, type Folder, folderOf,
  mapAuth, mapConnection, mapEntities, type Me, type Message, mediaRow, normalizeLink, type ReactionItem,
  type ReplyPreview, rights, tdError, type TextEntity, toChat, toMe,
} from './shapes.ts'
import { log } from './storage.ts'

// ---- Client ----

type Deps = { dir: string /* home\tdlib */, version: string, db: DB, emit: Emit, showArchived: () => boolean, forgetCredentials: () => void,
  /** Called with the keys a session reached `ready` under: the pair is kept on disk (encrypted) so the next sign-in skips the API-keys step. */
  saveCredentials: (c: Creds) => void,
  hasSavedCredentials?: boolean }
let deps: Deps
let client: Client | null = null
let creds: Creds | null = null
let tdAuth: Td.AuthorizationState | null = null
let connection: AuthState['connection'] = 'offline'
let loggingOut = false
let credError: string | undefined
// Credentials gate: Telegram checks api_id/api_hash only while authorizing a NEW session, never when an existing
// tdlib session resumes, so the keys that signed this session in are fingerprinted on disk (keysMatch) and compared
// before they may open it. `loggingIn` marks a sign-in this run completed (phone sent), which is Telegram checking
// the keys itself; `offerFresh` tells the renderer a fresh sign-in is the only way forward.
let offerFresh = false
let keysMatch = false
let loggingIn = false
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

export const init = (d: Deps) => {
  deps = d
  if (d.hasSavedCredentials) {
    auth = { step: 'starting', connection: 'connecting' }
  }
}
export const authState = () => auth
/** The keys this session is running on: the gate compares them, Settings and the ready callback keep them,
 *  and logout restarts the app with them. */
export const credentials = (): Creds | null => creds
/** Raw TDLib updates for the transfer engine (updateFile, send results). Returns unsubscribe. */
export const onUpdate = (fn: (u: Td.Update) => void) => { listeners.add(fn); return () => { listeners.delete(fn) } }

function changed() {
  const next: AuthState = client ? { connection, ...mapAuth(tdAuth, me) }
    : { connection: 'offline', step: 'credentials', ...(credError && { error: credError }), ...(offerFresh && { needsFresh: true }) }
  if (JSON.stringify(next) === JSON.stringify(auth)) return
  if (next.step !== auth.step) log('info', `Telegram: ${next.step}`)
  auth = next
  deps.emit({ type: 'auth', auth })
}
const chatsChanged = () => deps.emit({ type: 'invalidate', topics: ['chats'] })

/** Entering `ready` gives failed media scans one new try; leaving it means TDLib may skip updates for a gap, so no
 *  chat's top-up counts as current any more (ARCHITECTURE > Media index scan). */
function setConnection(c: AuthState['connection']) {
  if (c === 'ready' && connection !== 'ready') {
    failedScans.clear()
    if (wanted !== null) mediaChanged(wanted, true) // the refetch re-asks chats.media, which restarts the scan
  }
  if (c !== 'ready' && connection === 'ready') current.clear()
  connection = c
}

/** The renderer saw the OS network come and go. TDLib can sit on dead sockets long after the OS notices, so a
 *  recovered network clears the failed-scan hold and pings the chat's scan and the chat lists to ask again. */
export function networkChanged(online: boolean) {
  if (!online) return
  failedScans.clear()
  if (auth.step !== 'ready') return
  if (wanted !== null) mediaChanged(wanted, true)
  chatsChanged()
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

// ---- Credentials gate ----
// Telegram checks api_id/api_hash only while authorizing a NEW session; an existing tdlib session resumes without
// them (the Telethon #1569 behaviour). So the pair that signed this session in is fingerprinted on disk the moment
// the session reaches `ready`, and every later pair must match it before TDLib is even created. Anything that cannot
// be accounted for is refused (409) with an offer to start fresh, where the OTP step is where Telegram really checks.
const fingerprintFile = () => path.join(deps.dir, 'session.fingerprint')
/** Pure: `<apiId>:<sha256 of the lowercased hash>`; the hash is one-way, so the file never holds the keys themselves. */
export const fingerprint = (c: Creds) => `${c.apiId}:${createHash('sha256').update(c.apiHash.toLowerCase()).digest('hex')}`
const readFingerprint = (): string | null => {
  try { return fs.readFileSync(fingerprintFile(), 'utf8').trim() || null } catch { return null }
}
const writeFingerprint = (c: Creds) => {
  try { fs.mkdirSync(deps.dir, { recursive: true }); fs.writeFileSync(fingerprintFile(), fingerprint(c)) }
  catch (e) { log('warn', `Recording the session's API keys failed: ${(e as Error).message}`) }
}
const dropFingerprint = () => { try { fs.rmSync(fingerprintFile(), { force: true }) } catch {} }
const MISMATCH = "These API keys don't match the session saved on this device. Correct them, or start a fresh sign-in to use different keys."
const UNVERIFIABLE = "These API keys can't be checked against the session saved on this device. Start a fresh sign-in to have Telegram check them."

/** An existing session the keys cannot be accounted for: close it before it shows anything, and ask for a fresh sign-in. */
async function blockSession() {
  await close()
  creds = null
  credError = UNVERIFIABLE
  offerFresh = true
  changed()
}

let starting = Promise.resolve()
/** Creates the client, closing any previous one. Calls run one after another, so overlapping starts (a double submit)
 *  never leave a second client locking tdlib\db, and the last credentials win. `fresh` deletes the saved session first,
 *  so the keys go through a real Telegram sign-in instead of reopening what is already here. */
export function start(c: Creds, fresh = false) {
  const run = starting.then(() => launch(c, fresh))
  starting = run.catch(() => {})
  return run
}

async function applySpeedOptimizations(cl: Client) {
  // Enable Quick ACK for low-latency outgoing message & packet acknowledgments (accelerates upload window scaling)
  await cl.invoke({ _: 'setOption', name: 'use_quick_ack', value: { _: 'optionValueBoolean', value: true } }).catch(() => {})
  // Enable Perfect Forward Secrecy for faster and robust session crypto
  await cl.invoke({ _: 'setOption', name: 'use_pfs', value: { _: 'optionValueBoolean', value: true } }).catch(() => {})
  // Disable persistent network statistics tracking to save disk I/O and avoid SQLite locking
  await cl.invoke({ _: 'setOption', name: 'disable_persistent_network_statistics', value: { _: 'optionValueBoolean', value: true } }).catch(() => {})
  await cl.invoke({ _: 'setOption', name: 'disable_network_statistics', value: { _: 'optionValueBoolean', value: true } }).catch(() => {})
  // Disable time adjustment protection to prevent transfer throttling caused by minor clock drifts
  await cl.invoke({ _: 'setOption', name: 'disable_time_adjustment_protection', value: { _: 'optionValueBoolean', value: true } }).catch(() => {})
  // Enable background storage optimizer
  await cl.invoke({ _: 'setOption', name: 'use_storage_optimizer', value: { _: 'optionValueBoolean', value: true } }).catch(() => {})
}

// tdl answers WaitTdlibParameters with these options.
async function launch(c: Creds, fresh = false) {
  // Fresh sign-in: the local session and its fingerprint go first, so Telegram will really check this pair at the
  // code step. Otherwise the stored fingerprint must match the keys before TDLib is allowed to open the session.
  if (fresh) { await close(); await removeSession() }
  const stored = fresh ? null : readFingerprint()
  keysMatch = stored !== null && stored === fingerprint(c)
  if (stored !== null && !keysMatch) {
    credError = MISMATCH
    offerFresh = true
    changed()
    throw fail(409, MISMATCH)
  }
  await close()
  creds = c
  credError = undefined
  offerFresh = false
  loggingIn = false
  loggingOut = false
  for (const m of [chats, cache.users, cache.basicGroups, cache.supergroups]) m.clear()
  folders = []
  opened.clear()
  setConnection('connecting')
  const cl = tdl.createClient({
    apiId: c.apiId, apiHash: c.apiHash,
    databaseDirectory: path.join(deps.dir, 'db'), filesDirectory: path.join(deps.dir, 'files'),
    tdlibParameters: { use_message_database: true, use_chat_info_database: true, use_file_database: true, use_secret_chats: false, system_language_code: 'en',
      device_model: 'Mediagram', system_version: 'Windows', application_version: deps.version },
  })
  client = cl
  void applySpeedOptimizations(cl)
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
  const run = starting.then(async () => { await close(); creds = null; credError = undefined; offerFresh = false; changed() })
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

const removeSession = () => {
  dropFingerprint() // the keys on record belong to the session being deleted
  return Promise.all(['db', 'files'].map((d) => fs.promises.rm(path.join(deps.dir, d), { recursive: true, force: true, maxRetries: 5 })
    .catch((e) => log('warn', `Could not delete tdlib\\${d}: ${(e as Error).message}`))))
}

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

const senderName = (s: Td.MessageSender) => s._ === 'messageSenderUser'
  ? [cache.users.get(s.user_id)?.first_name, cache.users.get(s.user_id)?.last_name].filter(Boolean).join(' ')
  : chats.get(s.chat_id)?.title ?? ''

const typingState = new Map<number, { text: string, timer: NodeJS.Timeout }>()

function formatChatAction(sender: string, action: Td.ChatAction): string | null {
  const name = sender || 'Someone'
  switch (action._) {
    case 'chatActionTyping': return `${name} is typing…`
    case 'chatActionRecordingVideo': return `${name} is recording a video…`
    case 'chatActionUploadingVideo': return `${name} is sending a video…`
    case 'chatActionRecordingVoiceNote': return `${name} is recording a voice message…`
    case 'chatActionUploadingVoiceNote': return `${name} is sending a voice message…`
    case 'chatActionUploadingPhoto': return `${name} is sending a photo…`
    case 'chatActionUploadingDocument': return `${name} is sending a file…`
    case 'chatActionRecordingVideoNote': return `${name} is recording a video message…`
    case 'chatActionUploadingVideoNote': return `${name} is sending a video message…`
    case 'chatActionChoosingSticker': return `${name} is choosing a sticker…`
    case 'chatActionChoosingLocation': return `${name} is sharing a location…`
    case 'chatActionChoosingContact': return `${name} is sharing a contact…`
    case 'chatActionStartPlayingGame': return `${name} is playing a game…`
    case 'chatActionCancel': return null
    default: return null
  }
}

export function getChatAction(chatId: number): string | null {
  return typingState.get(chatId)?.text ?? null
}

export function getAllChatActions(): Record<number, string> {
  const res: Record<number, string> = {}
  for (const [id, entry] of typingState.entries()) {
    res[id] = entry.text
  }
  return res
}

function onTdUpdate(cl: Client, u: Td.Update) {
  switch (u._) {
    case 'updateAuthorizationState':
      tdAuth = u.authorization_state
      if (tdAuth._ === 'authorizationStateLoggingOut') loggingOut = true
      if (tdAuth._ === 'authorizationStateReady') {
        // The gate: a session resuming under keys it was never signed in with (or never recorded) is closed before
        // onReady can read a single chat. A sign-in this run completed is proof Telegram checked the pair itself.
        if (creds && !(keysMatch || loggingIn)) { void blockSession(); break }
        if (creds) { writeFingerprint(creds); deps.saveCredentials(creds) } // session, fingerprint, and saved keys are one pair
        void onReady(cl)
      } else me = null
      changed()
      break
    case 'updateConnectionState': setConnection(mapConnection(u.state)); changed(); break
    case 'updateNewMessage': upkeep(u.message); break
    case 'updateDeleteMessages':
      if (!u.is_permanent || u.from_cache) break // TDLib cache evictions are not deletions (FileGram lesson)
      if (deleteMedia(deps.db, u.chat_id, u.message_ids)) mediaChanged(u.chat_id)
      deps.emit({ type: 'invalidate', topics: [`messages:${u.chat_id}`] })
      break
    case 'updateMessageContent':
      deps.emit({ type: 'invalidate', topics: [`messages:${u.chat_id}`] })
      break
    case 'updateMessageEdited':
      deps.emit({ type: 'invalidate', topics: [`messages:${u.chat_id}`] })
      break
    case 'updateMessageSendSucceeded':
      deps.emit({ type: 'invalidate', topics: [`messages:${u.message.chat_id}`] })
      break
    case 'updateMessageSendFailed':
      deps.emit({ type: 'invalidate', topics: [`messages:${u.message.chat_id}`] })
      break
    case 'updateChatReadOutbox':
      patch(u.chat_id, (c) => { c.last_read_outbox_message_id = u.last_read_outbox_message_id })
      deps.emit({ type: 'invalidate', topics: [`messages:${u.chat_id}`] })
      break
    case 'updateMessageInteractionInfo':
      deps.emit({ type: 'invalidate', topics: [`messages:${u.chat_id}`] })
      break
    case 'updateMessageIsPinned':
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
    case 'updateChatAction': {
      const existing = typingState.get(u.chat_id)
      if (existing) {
        clearTimeout(existing.timer)
        typingState.delete(u.chat_id)
      }
      const sName = senderName(u.sender_id)
      const text = formatChatAction(sName, u.action)
      if (text) {
        const timer = setTimeout(() => {
          typingState.delete(u.chat_id)
          deps.emit({ type: 'typing', chatId: u.chat_id, text: null })
        }, 5000)
        typingState.set(u.chat_id, { text, timer })
        deps.emit({ type: 'typing', chatId: u.chat_id, text })
      } else {
        deps.emit({ type: 'typing', chatId: u.chat_id, text: null })
      }
      break
    }
    case 'updateFile': {
      const localPath = (u.file.local.path && fs.existsSync(u.file.local.path)) ? u.file.local.path : null
      deps.emit({
        type: 'fileProgress',
        fileId: u.file.id,
        downloaded: u.file.local.downloaded_size,
        total: u.file.size || u.file.expected_size,
        completed: u.file.local.is_downloading_completed,
        path: localPath,
      })
      break
    }
  }
  for (const fn of listeners) fn(u)
}

// Valid from the phone, code, and password steps ("use a different number" sends a new phone). Sending the phone is
// the sign-in Telegram performs with these keys, so it marks the pair as checked by Telegram (the credentials gate).
// TDLib answers a duplicate setAuthenticationPhoneNumber by failing the *older* query ("Another authorization query
// has started"), so a Continue click landing while the same number is still in flight shares that one request.
let sending: { phone: string, done: Promise<void> } | null = null
export const sendPhone = async (phone: string) => {
  if (sending?.phone === phone) return sending.done
  loggingIn = true
  const done = (async () => {
    await Promise.race([
      call({ _: 'setAuthenticationPhoneNumber', phone_number: phone }),
      sleep(60_000).then(() => { throw fail(504, 'Telegram took too long to send your code. Please check your internet connection and API keys.') }),
    ])
  })()
  sending = { phone, done }
  try { await done } finally { if (sending?.done === done) sending = null }
}
export const sendCode = async (code: string) => {
  await Promise.race([
    call({ _: 'checkAuthenticationCode', code }),
    sleep(60_000).then(() => { throw fail(504, 'Checking your code took too long. Please try again.') }),
  ])
}
export const sendPassword = async (password: string) => {
  await Promise.race([
    call({ _: 'checkAuthenticationPassword', password }),
    sleep(60_000).then(() => { throw fail(504, 'Checking your password took too long. Please try again.') }),
  ])
}

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
  // Telegram's own order first: `positions.order` already ranks a list by recency (pinned chats outrank the rest),
  // so date-first would sink a pinned chat and a chat whose last message TDLib does not know yet. The date only
  // breaks the tie for the chats that have no position at all (Saved Messages, a chat opened this session).
  listed.sort((a, b) => cmp(order(b, 'chatListMain'), order(a, 'chatListMain'))
    || cmp(order(b, 'chatListArchive'), order(a, 'chatListArchive'))
    || (b.last_message?.date ?? 0) - (a.last_message?.date ?? 0))
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

/** Membership, the TDLib way: every chat the account belongs to has a position in at least one chat list. */
const isMember = (c: Td.chat) => c.positions.length > 0 || c.chat_lists.length > 0

/** `joinChat` for a public group or channel, with the same answers the invite path gives.
 *  ponytail: a chat the user left is joined again if its link is opened once more; upgrade: remember left ids. */
async function joinPublic(c: Td.chat) {
  try {
    const r = await invoke({ _: 'joinChat', chat_id: c.id })
    if (r._ === 'chatJoinResultRequestSent') throw fail(409, 'Your request to join was sent. You can open the chat once an admin approves it.')
    if (r._ === 'chatJoinResultGuardBotApprovalRequired') throw fail(409, 'A guard bot has to approve your join request before you can open the chat.')
    if (r._ !== 'chatJoinResultSuccess') throw fail(403, "This chat didn't let you join. Try it in the official Telegram app.")
  } catch (e) {
    if ((e as AppError).status === 400 && /already/i.test((e as Error).message)) return // already a member
    throw e
  }
}

/** Opens a public chat, bot, invite link, or message link; an unjoined invite returns a preview unless `join`.
 *  A public group or channel is joined for real here: only Telegram's own membership makes it show up in the
 *  official clients, while the `opened` set below is local to this session. */
export async function openChat(link: string, join: boolean) {
  const clean = normalizeLink(link)
  let t: any = null
  try {
    t = await linkType(clean)
  } catch (e) {
    const tgResolve = clean.match(/^tg:\/\/resolve\?(?:.*&)?domain=([a-zA-Z0-9_]{4,32})/i)
    const m = clean.match(/(?:https?:\/\/)?(?:www\.)?(?:t\.me|telegram\.me|telegram\.dog)\/([a-zA-Z0-9_]{4,32})(?:\/|\?|$)/i)
    const uname = tgResolve ? tgResolve[1] : (m ? m[1] : null)
    if (uname && !['joinchat', 'addstickers', 'share', 'login'].includes(uname.toLowerCase())) {
      t = { _: 'internalLinkTypePublicChat', chat_username: uname }
    } else {
      throw e
    }
  }

  let c: Td.chat
  if (t._ === 'internalLinkTypePublicChat' || t._ === 'internalLinkTypeBotStart' || t._ === 'internalLinkTypeBotStartInGroup' || t._ === 'internalLinkTypeBotAddToChannel' || t._ === 'internalLinkTypeMainWebApp') {
    const username = t.chat_username || t.bot_username
    c = await invoke({ _: 'searchPublicChat', username })
    chats.set(c.id, c)
    // Resolving a public channel or group is not membership: join it, or the chat lives only in this session.
    // A private chat (a user or bot profile) has nothing to join.
    if (t._ === 'internalLinkTypePublicChat' && !isMember(c)
      && (c.type._ === 'chatTypeBasicGroup' || c.type._ === 'chatTypeSupergroup')) {
      await joinPublic(c)
      c = await invoke({ _: 'getChat', chat_id: c.id }).catch(() => c) // the positions the join just earned
      chats.set(c.id, c)
    }
  }
  else if (t._ === 'internalLinkTypeMessage') c = await getChat((await invoke({ _: 'getMessageLinkInfo', url: t.url })).chat_id)
  else if (t._ === 'internalLinkTypeUserPhoneNumber') {
    c = await invoke({ _: 'searchPublicChat', username: t.phone_number })
    chats.set(c.id, c)
  }
  else if (t._ === 'internalLinkTypeSavedMessages') {
    c = await getChat(cache.meId)
  }
  else if (t._ === 'internalLinkTypeChatInvite') {
    const info = await invoke({ _: 'checkChatInviteLink', invite_link: t.invite_link })
    if (info.chat_id) c = await getChat(info.chat_id)
    else if (!join) {
      const inv: any = {
        title: info.title,
        members: info.member_count,
        photo: info.photo?.small.remote.id || null,
      }
      if ((info as any).description || (info as any).about) inv.about = (info as any).description || (info as any).about
      if ((info as any).creates_join_request) inv.createsJoinRequest = true
      if ((info as any).is_public) inv.isPublic = true
      return { invite: inv }
    }
    else {
      const r = await invoke({ _: 'joinChatByInviteLink', invite_link: t.invite_link })
      if (r._ === 'chatJoinResultRequestSent') throw fail(409, 'Your request to join was sent. You can open the chat once an admin approves it.')
      if (r._ !== 'chatJoinResultSuccess') throw fail(403, "This chat didn't let you join. Try it in the official Telegram app.")
      c = await getChat(r.chat_id)
    }
  } else {
    const possibleUser = (t as any).chat_username || (t as any).bot_username
    if (possibleUser) {
      c = await invoke({ _: 'searchPublicChat', username: possibleUser })
      chats.set(c.id, c)
    } else {
      throw notALink()
    }
  }
  chats.set(c.id, c)
  opened.add(c.id)
  c.unread_count = 0
  void invoke({ _: 'openChat', chat_id: c.id }).catch(() => {})
  chatsChanged()
  return { chat: toChat(chats.get(c.id) ?? c, cache) as Chat }
}

const recentMessages = new Map<string, Td.message>()

function previewText(m: Td.message): string {
  if (m.content._ === 'messageText') return m.content.text.text
  if ('caption' in m.content && m.content.caption.text) return m.content.caption.text
  if (m.content._ === 'messageAnimatedEmoji') return m.content.emoji
  if (m.content._ === 'messageDice') return m.content.emoji
  if (m.content._ === 'messageSticker') return (m.content as any).sticker?.emoji || '[Sticker]'
  const media = extractMedia(m)
  if (media) return `[${media.type}: ${media.name}]`
  return '[Attachment]'
}

function extractForward(m: Td.message): { name: string, chatTitle?: string } | null {
  if (!m.forward_info) return null
  const origin = m.forward_info.origin
  switch (origin._) {
    case 'messageOriginUser': {
      const u = cache.users.get(origin.sender_user_id)
      return { name: u ? [u.first_name, u.last_name].filter(Boolean).join(' ') : 'User' }
    }
    case 'messageOriginChannel': {
      const c = chats.get(origin.chat_id)
      return { name: c?.title || 'Channel', chatTitle: origin.author_signature || undefined }
    }
    case 'messageOriginChat': {
      const c = chats.get(origin.sender_chat_id)
      return { name: c?.title || origin.author_signature || 'Group' }
    }
    case 'messageOriginHiddenUser':
      return { name: origin.sender_name }
    default:
      return null
  }
}

function extractReactions(m: Td.message): ReactionItem[] {
  const rList = (m as any).interaction_info?.reactions?.reactions
  if (!rList || !rList.length) return []
  const out: ReactionItem[] = []
  for (const r of rList) {
    if (r.type?._ === 'reactionTypeEmoji' && r.type.emoji) {
      const emoji = r.type.emoji === '\u2764' ? '❤️' : r.type.emoji
      out.push({
        emoji,
        count: r.total_count ?? 1,
        chosen: Boolean(r.is_chosen),
      })
    }
  }
  return out
}

function getSenderPhoto(s: Td.MessageSender): string | null {
  if (s._ === 'messageSenderUser') {
    return cache.users.get(s.user_id)?.profile_photo?.small.remote.id || null
  }
  return chats.get(s.chat_id)?.photo?.small.remote.id || null
}

function getSenderId(s: Td.MessageSender): number {
  return s._ === 'messageSenderUser' ? s.user_id : s.chat_id
}

function getReplyPreview(m: Td.message): ReplyPreview | null {
  const replyId = m.reply_to?._ === 'messageReplyToMessage'
    ? m.reply_to.message_id
    : (m as any).reply_to_message_id ?? null
  if (!replyId) return null
  const target = recentMessages.get(`${m.chat_id}:${replyId}`)
  if (target) {
    const targetMedia = extractMedia(target)
    return {
      id: target.id,
      sender: senderName(target.sender_id),
      text: previewText(target),
      thumb: targetMedia?.thumb || null,
    }
  }
  return {
    id: replyId,
    sender: 'Reply',
    text: 'Click to view',
    thumb: null,
  }
}

function getDeliveryStatus(m: Td.message, chat?: Td.chat): DeliveryStatus {
  if (m.sending_state) {
    return m.sending_state._ === 'messageSendingStateFailed' ? 'failed' : 'sending'
  }
  if (!m.is_outgoing) return 'read'
  if (chat && chat.last_read_outbox_message_id >= m.id) return 'read'
  return 'sent'
}

const toMessage = (m: Td.message, chat?: Td.chat): Message => {
  if (m.chat_id && m.id) {
    recentMessages.set(`${m.chat_id}:${m.id}`, m)
    if (recentMessages.size > 2000) {
      const firstKey = recentMessages.keys().next().value
      if (firstKey) recentMessages.delete(firstKey)
    }
  }

  const rawEntities = m.content._ === 'messageText'
    ? m.content.text.entities
    : 'caption' in m.content
    ? m.content.caption.entities
    : undefined
  const entities = mapEntities(rawEntities)

  const replyId = m.reply_to?._ === 'messageReplyToMessage'
    ? m.reply_to.message_id
    : (m as any).reply_to_message_id ?? null
  const replyTo = getReplyPreview(m)
  const forwardFrom = extractForward(m)
  const reactions = extractReactions(m)
  const senderPhoto = m.sender_id ? getSenderPhoto(m.sender_id) : null

  let text = ''
  let isAnimatedEmoji = false
  if (m.content._ === 'messageText') {
    text = m.content.text.text
  } else if ('caption' in m.content && m.content.caption.text) {
    text = m.content.caption.text
  } else if (m.content._ === 'messageAnimatedEmoji') {
    text = m.content.emoji
    isAnimatedEmoji = true
  } else if (m.content._ === 'messageDice') {
    text = m.content.emoji
  } else if (m.content._ === 'messageSticker') {
    text = (m.content as any).sticker?.emoji || '🎭'
  } else if (m.content._ === 'messagePoll') {
    text = `📊 Poll: ${(m.content as any).poll?.question?.text || 'Poll'}`
  } else if (m.content._ === 'messageContact') {
    const cont = (m.content as any).contact
    text = `👤 Contact: ${cont?.first_name || ''} ${cont?.last_name || ''} (${cont?.phone_number || ''})`.trim()
  } else if (m.content._ === 'messageLocation') {
    const loc = (m.content as any).location
    text = `📍 Location: ${loc?.latitude?.toFixed(4)}, ${loc?.longitude?.toFixed(4)}`
  } else if (m.content._ === 'messageVenue') {
    const v = (m.content as any).venue
    text = `📍 ${v?.title || 'Venue'}${v?.address ? ` (${v.address})` : ''}`
  } else if (m.content._ === 'messageGame') {
    text = `🎮 Game: ${(m.content as any).game?.title || 'Game'}`
  }

  return {
    id: m.id,
    date: m.date,
    sender: senderName(m.sender_id),
    text,
    media: extractMedia(m),
    isOutgoing: Boolean(m.is_outgoing),
    ...(isAnimatedEmoji ? { isAnimatedEmoji: true } : {}),
    ...(m.chat_id ? {
      chatId: m.chat_id,
      senderId: getSenderId(m.sender_id),
      deliveryStatus: getDeliveryStatus(m, chat),
    } : {}),
    ...(m.edit_date && m.edit_date > 0 ? { editDate: m.edit_date } : {}),
    ...(entities.length ? { entities } : {}),
    ...(replyTo ? { replyTo, replyToMessageId: replyId } : {}),
    ...(forwardFrom ? { forwardFrom } : {}),
    ...(reactions.length ? { reactions } : {}),
    ...(m.is_pinned ? { isPinned: true } : {}),
    ...(m.media_album_id && m.media_album_id !== '0' ? { albumId: m.media_album_id } : {}),
    ...(m.interaction_info?.view_count ? { views: m.interaction_info.view_count } : {}),
    ...(((m as any).can_be_deleted_only_for_self !== undefined || (m as any).can_be_deleted_for_all_users !== undefined) ? {
      canBeDeleted: Boolean((m as any).can_be_deleted_only_for_self || (m as any).can_be_deleted_for_all_users),
    } : {}),
  }
}

/** The newest `limit` messages, paging getChatHistory by 100 (TDLib returns short first pages). */
export async function messages(chatId: number, limit: number, fromMessageId = 0) {
  if (auth.step !== 'ready') throw fail(503, 'Telegram is not connected yet')
  if (!chats.has(chatId)) throw fail(404, 'Chat not found')
  const c = chats.get(chatId)
  const out: Td.message[] = []
  for (let from = fromMessageId; out.length < limit;) {
    const page = await invoke({ _: 'getChatHistory', chat_id: chatId, from_message_id: from, offset: 0, limit: Math.min(100, limit - out.length), only_local: false })
    const got = page.messages.filter((m) => m !== null)
    if (!got.length) {
      const msgs = out.map((m) => toMessage(m, c))
      prefetchThumbs(msgs.map((m) => m.media?.thumb))
      if (out.length) {
        void invoke({ _: 'viewMessages', chat_id: chatId, message_ids: out.map((m) => m.id), force_read: false }).catch(() => {})
        void invoke({ _: 'openChat', chat_id: chatId }).catch(() => {})
      }
      return { messages: msgs, more: false }
    }
    out.push(...got)
    from = got[got.length - 1].id
  }
  const msgs = out.map((m) => toMessage(m, c))
  prefetchThumbs(msgs.map((m) => m.media?.thumb))
  if (out.length) {
    void invoke({ _: 'viewMessages', chat_id: chatId, message_ids: out.map((m) => m.id), force_read: false }).catch(() => {})
    void invoke({ _: 'openChat', chat_id: chatId }).catch(() => {})
  }
  return { messages: msgs, more: true }
}

/** Prepares media for fast instant playback: checks if already in TDLib cache, or starts downloading with priority 32 */
export async function prepareMedia(chatId: number, messageId: number) {
  if (auth.step !== 'ready') throw fail(503, 'Telegram is not connected yet')
  const m = await invoke({ _: 'getMessage', chat_id: chatId, message_id: messageId })
  const media = extractMedia(m)
  if (!media) throw fail(404, 'No media found in this message')
  let f = await invoke({ _: 'getFile', file_id: media.file.id })
  if (f.local.is_downloading_completed && f.local.path && fs.existsSync(f.local.path)) {
    return {
      path: f.local.path,
      fileId: f.id,
      completed: true,
      size: f.size,
      downloaded: f.size,
      name: media.name,
      type: media.type,
      duration: media.duration,
    }
  }
  // Download with priority 32 (maximum speed)
  f = await invoke({ _: 'downloadFile', file_id: f.id, priority: 32, offset: 0, limit: 0, synchronous: false })
  const localExists = Boolean(f.local.path && fs.existsSync(f.local.path))
  return {
    path: (f.local.is_downloading_completed || localExists) && f.local.path && fs.existsSync(f.local.path) ? f.local.path : null,
    fileId: f.id,
    completed: f.local.is_downloading_completed,
    size: f.size || f.expected_size,
    downloaded: f.local.downloaded_size,
    name: media.name,
    type: media.type,
    duration: media.duration,
  }
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
/** Send a text message to a chat */
export async function sendMessage(chatId: number, textMsg: string, replyToMessageId?: number) {
  if (auth.step !== 'ready') throw fail(503, 'Telegram is not connected yet')
  const content = textMsg.trim()
  if (!content) throw fail(400, 'Message cannot be empty')

  let formatted: Td.formattedText = { _: 'formattedText', text: content, entities: [] }
  try {
    const parsed = await invoke({
      _: 'parseTextEntities',
      text: content,
      parse_mode: { _: 'textParseModeMarkdown', version: 2 },
    })
    if (parsed?.text) formatted = parsed
  } catch {
    formatted = { _: 'formattedText', text: content, entities: [] }
  }

  const reply_to = replyToMessageId ? {
    _: 'inputMessageReplyToMessage' as const,
    message_id: replyToMessageId,
    quote: null as never,
  } : null

  await invoke({
    _: 'sendMessage',
    chat_id: chatId,
    reply_to: reply_to as any,
    input_message_content: {
      _: 'inputMessageText',
      text: formatted,
      clear_draft: true,
    },
  })
}

/** Edit a text message in a chat */
export async function editMessage(chatId: number, messageId: number, textMsg: string) {
  if (auth.step !== 'ready') throw fail(503, 'Telegram is not connected yet')
  const content = textMsg.trim()
  if (!content) throw fail(400, 'Message cannot be empty')

  let formatted: Td.formattedText = { _: 'formattedText', text: content, entities: [] }
  try {
    const parsed = await invoke({
      _: 'parseTextEntities',
      text: content,
      parse_mode: { _: 'textParseModeMarkdown', version: 2 },
    })
    if (parsed?.text) formatted = parsed
  } catch {
    formatted = { _: 'formattedText', text: content, entities: [] }
  }

  await invoke({
    _: 'editMessageText',
    chat_id: chatId,
    message_id: messageId,
    input_message_content: {
      _: 'inputMessageText',
      text: formatted,
      clear_draft: true,
    },
  })
  deps.emit({ type: 'invalidate', topics: [`messages:${chatId}`] })
}

/** Delete messages in a chat */
export async function deleteMessages(chatId: number, messageIds: number[], revoke = true) {
  if (auth.step !== 'ready') throw fail(503, 'Telegram is not connected yet')
  if (!messageIds.length) return
  await invoke({
    _: 'deleteMessages',
    chat_id: chatId,
    message_ids: messageIds,
    revoke,
  })
  deps.emit({ type: 'invalidate', topics: [`messages:${chatId}`] })
}

/** Pin or unpin a message in a chat */
export async function pinChatMessage(chatId: number, messageId: number, unpin = false) {
  if (auth.step !== 'ready') throw fail(503, 'Telegram is not connected yet')
  if (unpin) {
    await invoke({ _: 'unpinChatMessage', chat_id: chatId, message_id: messageId })
  } else {
    await invoke({ _: 'pinChatMessage', chat_id: chatId, message_id: messageId, disable_notification: false, only_for_self: false })
  }
  deps.emit({ type: 'invalidate', topics: [`messages:${chatId}`] })
}

/** Add or remove an emoji reaction to a message */
export async function reactMessage(chatId: number, messageId: number, reaction: string, remove = false) {
  if (auth.step !== 'ready') throw fail(503, 'Telegram is not connected yet')
  const cleanEmoji = reaction.replace(/\uFE0F/g, '')
  if (remove) {
    try {
      await invoke({
        _: 'removeMessageReaction',
        chat_id: chatId,
        message_id: messageId,
        reaction_type: { _: 'reactionTypeEmoji', emoji: cleanEmoji },
      })
    } catch {
      await invoke({
        _: 'removeMessageReaction',
        chat_id: chatId,
        message_id: messageId,
        reaction_type: { _: 'reactionTypeEmoji', emoji: reaction },
      })
    }
  } else {
    try {
      await invoke({
        _: 'addMessageReaction',
        chat_id: chatId,
        message_id: messageId,
        reaction_type: { _: 'reactionTypeEmoji', emoji: cleanEmoji },
        is_big: false,
        update_recent_reactions: true,
      })
    } catch {
      await invoke({
        _: 'addMessageReaction',
        chat_id: chatId,
        message_id: messageId,
        reaction_type: { _: 'reactionTypeEmoji', emoji: reaction },
        is_big: false,
        update_recent_reactions: true,
      })
    }
  }
  setTimeout(() => {
    deps.emit({ type: 'invalidate', topics: [`messages:${chatId}`] })
  }, 350)
}

/** Mark messages as read */
export async function markMessagesRead(chatId: number, messageIds: number[]) {
  if (auth.step !== 'ready' || !messageIds.length) return
  await invoke({
    _: 'viewMessages',
    chat_id: chatId,
    message_ids: messageIds,
    force_read: true,
  }).catch(() => {})
  const c = chats.get(chatId)
  if (c && c.unread_count > 0) {
    c.unread_count = 0
    chatsChanged()
  }
}

/** Send an outgoing chat action (typing indicator) */
export async function sendChatAction(chatId: number, action = 'typing') {
  if (auth.step !== 'ready') return
  const chatAction: Td.ChatAction = action === 'cancel'
    ? { _: 'chatActionCancel' }
    : { _: 'chatActionTyping' }
  await invoke({
    _: 'sendChatAction',
    chat_id: chatId,
    action: chatAction,
  }).catch(() => {})
}

/** Search messages in a chat */
export async function searchMessages(chatId: number, query: string, fromMessageId = 0, limit = 50) {
  if (auth.step !== 'ready') throw fail(503, 'Telegram is not connected yet')
  const r = await invoke({
    _: 'searchChatMessages',
    chat_id: chatId,
    query,
    sender_id: null as never,
    topic_id: null as never,
    from_message_id: fromMessageId,
    offset: 0,
    limit,
    filter: { _: 'searchMessagesFilterEmpty' },
  })
  const msgs = r.messages.filter((m): m is Td.message => m !== null).map((m) => toMessage(m, chats.get(chatId)))
  return { messages: msgs, nextFromMessageId: r.next_from_message_id }
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

const failedScans = new Map<number, string>() // a page failed: no new scan until the connection next enters ready
const held = new Set<number>() // the user stopped this one: nothing restarts it until they ask again
let wanted: number | null = null // the chat the renderer most recently asked to scan: retried after an outage
const current = new Set<number>() // top-up finished since the connection was last ready: live upkeep may move newest_id
let scan: { chatId: number, stop: boolean } | null = null
let scans = Promise.resolve()
const throttle = new Map<number, { dirty: boolean }>()
/** The seven media types as TDLib search filters (searchMessagesFilterEmpty is rejected here). Their union is exactly
 *  what extractMedia indexes, so walking them walks the media alone instead of every message in the chat. */
const counted = [{ _: 'searchMessagesFilterPhoto' }, { _: 'searchMessagesFilterVideo' }, { _: 'searchMessagesFilterDocument' },
  { _: 'searchMessagesFilterAudio' }, { _: 'searchMessagesFilterAnimation' }, { _: 'searchMessagesFilterVoiceNote' },
  { _: 'searchMessagesFilterVideoNote' }] as const
/** Filter streams reading TDLib at once: enough to keep the link busy without provoking a flood wait. */
const PARALLEL = 3

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

/** chats.media's index bar; `indexed` is clamped to the approximate total. `state` is `failed` (with the reason)
 *  for a chat whose last scan stopped on an error until the connection next goes ready or the user retries, and
 *  `paused` for one the user stopped themselves. */
export function scanInfo(chatId: number) {
  const row = getScan(deps.db, chatId)
  const indexed = mediaCount(deps.db, chatId)
  const error = failedScans.get(chatId)
  const state = scan?.chatId === chatId ? 'scanning' as const
    : held.has(chatId) ? 'paused' as const
    : error !== undefined ? 'failed' as const
    : row?.complete && row.newest_id >= (chats.get(chatId)?.last_message?.id ?? 0) ? 'done' as const : 'idle' as const
  return { state, indexed: row?.total != null ? Math.min(indexed, row.total) : indexed, total: row?.total ?? null,
    ...(error !== undefined && state === 'failed' && { error }) }
}

/** Starts this chat's scan when it needs one; asking for another chat stops the current one after its page. */
export function ensureScan(chatId: number) {
  wanted = chatId
  if (auth.step !== 'ready' || scan?.chatId === chatId || held.has(chatId)) return
  if (!scanNeeded(getScan(deps.db, chatId), chats.get(chatId)?.last_message?.id ?? null, failedScans.has(chatId))) return
  if (scan) scan.stop = true
  const s = { chatId, stop: false }
  scan = s
  scans = scans.then(() => runScan(s))
}
/** The index bar's Stop: the scan ends after its page and the saved cursors keep what it already indexed. */
export function holdScan(chatId: number) {
  held.add(chatId)
  failedScans.delete(chatId)
  if (scan?.chatId === chatId) { scan.stop = true; scan = null }
  if (wanted === chatId) wanted = null
  mediaChanged(chatId, true)
  return scanInfo(chatId)
}
/** The index bar's Retry and Resume: forget why this chat stopped or failed and ask for the scan again. */
export function retryScan(chatId: number) {
  held.delete(chatId)
  failedScans.delete(chatId)
  ensureScan(chatId)
}
/** Clear app data: the running scan stops after its page and no chat stays held back. */
export const stopScan = () => { if (scan) scan.stop = true; scan = null; wanted = null; held.clear() }

/** One scan request: flood waits sleep for as long as TDLib asks (bounded by `s.stop`), transient server errors
 *  retry three times with a backoff, and anything else fails the scan instead of hanging it. */
async function request<T>(send: () => Promise<T>, s: { stop: boolean }, what: string): Promise<T> {
  let server = 0
  for (;;) {
    try { return await send() } catch (e) {
      const err = e as AppError
      const alive = !s.stop && auth.step === 'ready'
      if (alive && err.status === 429 && err.retryAfter) {
        log('warn', `Media scan waits ${err.retryAfter} s (${what}: flood wait)`)
        await sleep(err.retryAfter * 1000)
        continue
      }
      if (alive && err.status >= 500 && server < 3) { await sleep(1000 * ++server); continue }
      throw e
    }
  }
}

async function historyPage(chatId: number, from: number, s: { stop: boolean }) {
  const r = await request(() => invoke({ _: 'getChatHistory', chat_id: chatId, from_message_id: from, offset: 0, limit: 100, only_local: false }), s, 'history')
  return r.messages.filter((m): m is Td.message => m !== null)
}

/** searchChatMessages returns messages in decreasing id order and always includes `from` itself, so the caller drops
 *  every id it has already indexed. `next` is 0 when there is nothing older left. */
async function searchPage(chatId: number, filter: Td.SearchMessagesFilter$Input, from: number, s: { stop: boolean }) {
  const r = await request(() => invoke({ _: 'searchChatMessages', chat_id: chatId, query: '', sender_id: null as never,
    topic_id: null as never, from_message_id: from, offset: 0, limit: 100, filter }), s, 'search')
  return { messages: r.messages.filter((m): m is Td.message => m !== null), next: r.next_from_message_id }
}

function index(chatId: number, messages: Td.message[]) {
  putMedia(deps.db, messages.flatMap((m) => { const x = extractMedia(m); return x ? [mediaRow(chatId, m, x)] : [] })) // OR IGNORE: an overlap is already indexed
  mediaChanged(chatId)
}

/** One `from_message_id` per filter, in `counted` order; a corrupt or pre-v2 value restarts that filter. */
const parseCursors = (raw: string | null): number[] => {
  let saved: unknown = null
  try { saved = raw ? JSON.parse(raw) : null } catch { saved = null }
  return Array.from({ length: counted.length }, (_, i) => {
    const at = Array.isArray(saved) ? saved[i] : undefined
    return typeof at === 'number' && Number.isSafeInteger(at) && at >= 0 ? at : 0
  })
}

/** Top-up from the newest message down to newest_id (the first walk creates the row with its first page), then
 *  backfill the whole chat. Progress is persisted per page, so a stopped scan resumes later. */
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
        if (!row) { putScan(db, { chat_id: chatId, newest_id: newest, oldest_id: oldest, complete: 0, total, cursors: null }); break }
        if (oldest <= row.newest_id) break
        from = oldest
      }
      if (row) putScan(db, { ...row, newest_id: Math.max(row.newest_id, newest), total })
      else if (!newest) putScan(db, { chat_id: chatId, newest_id: 0, oldest_id: 0, complete: 1, total, cursors: null }) // an empty chat
      current.add(chatId)
    } else putScan(db, { ...row, total })
    await backfill()
  } catch (e) {
    if (!stopped()) {
      failedScans.set(chatId, (e as Error).message)
      log('warn', `Media scan of chat ${chatId} stopped: ${(e as Error).message}`)
    }
  } finally {
    if (scan === s) scan = null
    mediaChanged(chatId, true) // the index bar hides
  }

  /** One search stream per media filter, PARALLEL at a time, each resuming from its own cursor. A TDLib that cannot
   *  answer the search falls back to the unfiltered history walk from the same oldest_id. */
  async function backfill() {
    const start = getScan(db, chatId)
    if (!start || start.complete) return
    const cursors = parseCursors(start.cursors)
    let oldest = start.oldest_id
    let fall: unknown = null // the search is unusable here: take the history path
    let failure: unknown = null // a flood wait or server error that outlived its retries: fail the scan
    const done = new Array<boolean>(counted.length).fill(false)
    const save = () => { // only this scan's own fields: `upkeep` may have moved newest_id while a page was in flight
      const cur = getScan(db, chatId)
      if (cur) putScan(db, { ...cur, oldest_id: Math.min(cur.oldest_id, oldest), complete: 0, cursors: JSON.stringify(cursors) })
    }
    const walkOne = async (i: number): Promise<boolean> => {
      let from = cursors[i]
      for (;;) {
        if (stopped() || fall || failure) return false
        let page: Awaited<ReturnType<typeof searchPage>>
        try { page = await searchPage(chatId, counted[i], from, s) }
        catch (e) {
          const err = e as AppError
          if (err.status === 429 || err.status >= 500) throw e // an outage, not a method this TDLib cannot answer
          fall = e
          return false
        }
        const fresh = page.messages.filter((m) => from === 0 || m.id < from)
        const noMore = page.next === 0
        if (fresh.length) {
          index(chatId, fresh)
          from = fresh[fresh.length - 1].id
          oldest = Math.min(oldest, from)
        } else if (!noMore) { // TDLib may answer a short page: step the cursor below what it just handed back
          const next = page.next > 0 && (from === 0 || page.next < from) ? page.next : from > 1 ? from - 1 : from
          if (next === from) { save(); return true } // nowhere older to go
          from = next
        }
        cursors[i] = from
        save()
        if (noMore) return true
      }
    }
    let pull = 0
    const worker = async () => {
      for (;;) {
        const i = pull++
        if (i >= counted.length || fall || failure) return
        try { done[i] = await walkOne(i) } catch (e) { failure ??= e; return }
      }
    }
    await Promise.all(Array.from({ length: Math.min(PARALLEL, counted.length) }, worker))
    if (failure) throw failure
    if (fall) {
      log('info', `Media scan of chat ${chatId}: falling back to the history walk (${String((fall as Error).message ?? fall)})`)
      await walkHistory()
      return
    }
    if (stopped()) return
    if (done.every(Boolean)) {
      const cur = getScan(db, chatId)
      if (cur) putScan(db, { ...cur, oldest_id: Math.min(cur.oldest_id, oldest), complete: 1, cursors: JSON.stringify(cursors) })
    }

    /** The unfiltered backfill from oldest_id until an empty page (the path a search-less TDLib takes). */
    async function walkHistory() {
      let walk = getScan(db, chatId)!
      while (!walk.complete) {
        if (stopped()) return
        const floor = walk.oldest_id
        const page = (await historyPage(chatId, floor, s)).filter((m) => m.id < floor)
        index(chatId, page)
        oldest = Math.min(oldest, page.length ? page[page.length - 1].id : floor)
        walk = { ...walk, oldest_id: page.length ? page[page.length - 1].id : floor, complete: page.length ? 0 : 1 }
        putScan(db, walk)
      }
    }
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

/** Prefetch remote thumbnail files asynchronously in background with low priority so active downloads get maximum bandwidth */
export function prefetchThumbs(remoteIds: (string | null | undefined)[]) {
  for (const id of remoteIds) {
    if (!id || typeof id !== 'string' || thumbPathCache.has(id)) continue
    void invoke({ _: 'getRemoteFile', remote_file_id: id }).then((f) => {
      // Same 2 MB ceiling as thumbFile: an id whose file is not a thumbnail is left alone (ARCHITECTURE > teleflow://
      // protocol), so a poisoned index cannot pull an arbitrary file down in the background.
      if ((f.expected_size || f.size) > 2 * 2 ** 20) return
      if (!f.local.is_downloading_completed) {
        return invoke({ _: 'downloadFile', file_id: f.id, priority: 1, offset: 0, limit: 0, synchronous: false })
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
