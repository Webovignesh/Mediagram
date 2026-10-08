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

async function bounded<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('TDLib request timed out')), ms) }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

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
    : { connection: 'offline', step: creds ? 'starting' : 'credentials', ...(credError && { error: credError }), ...(offerFresh && { needsFresh: true }) }
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
function guardStreamingRequest(req: { _: string, file_id?: unknown, offset?: unknown, limit?: unknown }): { _: 'getFile', file_id: number } | null {
  const fileId = req.file_id
  if (typeof fileId !== 'number') return null
  if (req._ === 'cancelDownloadFile' || req._ === 'deleteFile') {
    videoTailControls.get(fileId)?.cancel()
    if (req._ === 'deleteFile') {
      streamingPaths.delete(fileId)
      readableEnds.delete(fileId)
      readableDone.delete(fileId)
      wmProbe.delete(fileId)
      videoTailCache.delete(fileId)
      videoTailFailed.delete(fileId)
      videoHeadKinds.delete(fileId)
      videoHeadInflight.delete(fileId)
      videoPrefetchAttempted.delete(fileId)
      videoPrefetchInflight.delete(fileId)
      wmInflight.delete(fileId)
    }
  }
  // Preparing or reasserting the same file must not replace the tail's offset/limit. The tail
  // owner uses `call` for its range and its one handback; unrelated files remain concurrent.
  if (req._ === 'downloadFile' && (req.offset || 0) === 0 && (req.limit || 0) === 0 && videoTailBusy(fileId)) {
    return { _: 'getFile', file_id: fileId }
  }
  return null
}

/** TDLib calls that need a signed-in account: 503 until auth is `ready`. */
export const invoke: Td.Invoke = (req) => {
  if (auth.step !== 'ready') return Promise.reject(fail(503, 'Telegram is not connected yet'))
  const guarded = guardStreamingRequest(req)
  // Both the guarded downloadFile and getFile return File; preserve Invoke's generic result type.
  return call(guarded ? guarded as unknown as typeof req : req)
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
  resetStreamingSession()
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
    let bio = ''
    try {
      const full = await call({ _: 'getUserFullInfo', user_id: user.id })
      bio = (full as any)?.bio?.text || (typeof (full as any)?.bio === 'string' ? (full as any)?.bio : '') || ''
    } catch {}
    me = toMe(user, cap._ === 'optionValueInteger' ? Number(cap.value) : 0, bio)
    cache.meId = me.id
    changed()
    await invoke({ _: 'createPrivateChat', user_id: me.id, force: false }) // Saved Messages exists even if never used
    await loadLists()
  } catch (e) {
    log('error', `Loading the Telegram account failed: ${(e as Error).stack ?? String(e)}`)
  }
}

/** Update profile details (first name, last name, bio, username) */
export async function updateProfile(args: { firstName?: string, lastName?: string, bio?: string, username?: string }) {
  if (args.firstName !== undefined || args.lastName !== undefined) {
    const first = args.firstName !== undefined ? args.firstName : (me?.firstName || '')
    const last = args.lastName !== undefined ? args.lastName : (me?.lastName || '')
    await invoke({ _: 'setName', first_name: first, last_name: last })
  }
  if (args.bio !== undefined) {
    await invoke({ _: 'setBio', bio: args.bio })
  }
  if (args.username !== undefined) {
    await invoke({ _: 'setUsername', username: args.username.replace(/^@/, '') })
  }
  const cl = client
  if (cl) {
    const [user, cap] = await Promise.all([call({ _: 'getMe' }), call({ _: 'getOption', name: 'message_caption_length_max' })])
    if (client === cl) {
      let bio = ''
      try {
        const full = await call({ _: 'getUserFullInfo', user_id: user.id })
        bio = (full as any)?.bio?.text || (typeof (full as any)?.bio === 'string' ? (full as any)?.bio : '') || ''
      } catch {}
      me = toMe(user, cap._ === 'optionValueInteger' ? Number(cap.value) : 0, bio)
      cache.meId = me.id
      changed()
    }
  }
  return me
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
      if (u.is_permanent && !u.from_cache) {
        if (deleteMedia(deps.db, u.chat_id, u.message_ids)) mediaChanged(u.chat_id)
      }
      deps.emit({ type: 'invalidate', topics: [`messages:${u.chat_id}`] })
      break
    case 'updateMessageContent':
      deps.emit({ type: 'invalidate', topics: [`messages:${u.chat_id}`] })
      break
    case 'updateMessageEdited':
      deps.emit({ type: 'invalidate', topics: [`messages:${u.chat_id}`] })
      break
    case 'updateMessageSendAcknowledged':
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
    case 'updateMessageReaction':
    case 'updateMessageReactions':
    case 'updateMessageUnreadReactions':
    case 'updateChatUnreadReactionCount':
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
    case 'updateChatNotificationSettings': patch(u.chat_id, (c) => { c.notification_settings = u.notification_settings }); break
    case 'updateChatPosition': patch(u.chat_id, (c) => setPosition(c, u.position)); break
    case 'updateChatLastMessage':
      patch(u.chat_id, (c) => { c.last_message = u.last_message; c.positions = u.positions })
      deps.emit({ type: 'invalidate', topics: [`messages:${u.chat_id}`] })
      break
    case 'updateChatDraftMessage': patch(u.chat_id, (c) => { c.positions = u.positions }); break // positions only
    case 'updateChatAddedToList': patch(u.chat_id, (c) => { c.chat_lists = [...c.chat_lists.filter((l) => !sameList(l, u.chat_list)), u.chat_list] }); break
    case 'updateChatRemovedFromList': patch(u.chat_id, (c) => { c.chat_lists = c.chat_lists.filter((l) => !sameList(l, u.chat_list)) }); break
    case 'updateChatReadInbox':
      patch(u.chat_id, (c) => { c.unread_count = u.unread_count })
      deps.emit({ type: 'invalidate', topics: [`messages:${u.chat_id}`] })
      break
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
      noteReadable(u.file)
      // Publish TDLib's actual path before creation; the media protocol waits for confirmed bytes.
      const localPath = streamingPaths.get(u.file.id) ?? null
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
  for (const c of listed) {
    if (c.photo?.small.id && !c.photo.small.local?.is_downloading_completed) {
      invoke({ _: 'downloadFile', file_id: c.photo.small.id, priority: 20, offset: 0, limit: 0, synchronous: false }).catch(() => null)
    }
  }
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
    } else if (r.type?._ === 'reactionTypePaid') {
      out.push({
        emoji: '⭐',
        count: r.total_count ?? 1,
        chosen: Boolean(r.is_chosen),
      })
    } else if (r.type?._ === 'reactionTypeCustomEmoji') {
      out.push({
        emoji: '✨',
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
  void invoke({ _: 'openChat', chat_id: chatId }).catch(() => {})
  const out: Td.message[] = []
  for (let from = fromMessageId; out.length < limit;) {
    const page = await invoke({ _: 'getChatHistory', chat_id: chatId, from_message_id: from, offset: 0, limit: Math.min(100, limit - out.length), only_local: false })
    const got = page.messages.filter((m) => m !== null)
    if (!got.length) {
      const msgs = out.map((m) => toMessage(m, c))
      prefetchThumbs(msgs.map((m) => m.media ? { remoteId: m.media.thumb, fileId: m.media.thumbFileId } : null))
      prefetchPhotos(msgs.filter((m) => m.media?.type === 'photo').slice(0, 10).map((m) => m.media?.file?.id))
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
  prefetchThumbs(msgs.map((m) => m.media ? { remoteId: m.media.thumb, fileId: m.media.thumbFileId } : null))
  prefetchPhotos(msgs.filter((m) => m.media?.type === 'photo').slice(0, 10).map((m) => m.media?.file?.id))
  if (out.length) {
    void invoke({ _: 'viewMessages', chat_id: chatId, message_ids: out.map((m) => m.id), force_read: false }).catch(() => {})
    void invoke({ _: 'openChat', chat_id: chatId }).catch(() => {})
  }
  return { messages: msgs, more: true }
}

/** Prepares media for fast instant playback and full-quality viewing: checks cache, downloads images synchronously with priority 32, streams videos */
export async function prepareMedia(chatId: number, messageId: number) {
  if (auth.step !== 'ready') throw fail(503, 'Telegram is not connected yet')
  const m = await invoke({ _: 'getMessage', chat_id: chatId, message_id: messageId })
  const media = extractMedia(m)
  if (!media) throw fail(404, 'No media found in this message')

  // A path recorded earlier must still hold the message's bytes. Downloads resume and the library is
  // pruned, so a row or a name-based lookup can point at a truncated leftover — handing that back
  // declared a partial file as complete and the player failed it before it could ever buffer.
  const holdsMedia = (p: string): boolean => {
    const st = fs.statSync(p, { throwIfNoEntry: false })
    return Boolean(st && st.isFile() && (media.size <= 0 || st.size >= media.size))
  }

  // Instant check: if this file was already downloaded to the library or transfers, return immediately
  if (deps?.db) {
    try {
      const jobRow = deps.db.prepare(
        "SELECT path FROM jobs WHERE chat_id = ? AND message_id = ? AND status = 'completed' AND path IS NOT NULL LIMIT 1"
      ).get(chatId, messageId) as { path: string } | undefined
      if (jobRow?.path && holdsMedia(jobRow.path)) {
        return {
          path: jobRow.path,
          fileId: media.file.id,
          completed: true,
          size: media.size,
          downloaded: media.size,
          name: media.name,
          type: media.type,
          duration: media.duration,
        }
      }
      const histRow = deps.db.prepare(
        "SELECT path FROM history WHERE chat_id = ? AND message_id = ? AND status = 'completed' AND path IS NOT NULL ORDER BY finished_at DESC LIMIT 1"
      ).get(chatId, messageId) as { path: string } | undefined
      if (histRow?.path && holdsMedia(histRow.path)) {
        return {
          path: histRow.path,
          fileId: media.file.id,
          completed: true,
          size: media.size,
          downloaded: media.size,
          name: media.name,
          type: media.type,
          duration: media.duration,
        }
      }
    } catch {}
  }

  let f = await invoke({ _: 'getFile', file_id: media.file.id })
  noteReadable(f)
  if (f.local.is_downloading_completed && f.local.path && holdsMedia(f.local.path)) {
    return {
      path: f.local.path,
      fileId: f.id,
      completed: true,
      size: f.size || f.expected_size || media.size,
      downloaded: f.size,
      name: media.name,
      type: media.type,
      duration: media.duration,
    }
  }

  // Check TDLib files directory directly in case TDLib already completed the file locally
  if (deps?.dir) {
    const candidateDirs = ['photos', 'documents', 'videos']
    for (const sub of candidateDirs) {
      const candidatePath = path.join(deps.dir, 'files', sub, media.name)
      if (holdsMedia(candidatePath)) {
        return {
          path: candidatePath,
          fileId: f.id,
          completed: true,
          size: f.size || f.expected_size || media.size,
          downloaded: f.size || media.size,
          name: media.name,
          type: media.type,
          duration: media.duration,
        }
      }
    }
  }
  const isImage = media.type === 'photo' || ['jpg', 'jpeg', 'png', 'webp', 'bmp', 'gif'].includes(media.ext)
  if (isImage) {
    try {
      f = await bounded(invoke({ _: 'downloadFile', file_id: f.id, priority: 32, offset: 0, limit: 0, synchronous: true }), 3500)
    } catch {
      f = await invoke({ _: 'downloadFile', file_id: f.id, priority: 32, offset: 0, limit: 0, synchronous: false }).catch(() => f)
    }
  } else {
    // Download with priority 32 (maximum speed)
    f = await invoke({ _: 'downloadFile', file_id: f.id, priority: 32, offset: 0, limit: 0, synchronous: false })
  }
  noteReadable(f)
  const localCompleted = Boolean(f.local.is_downloading_completed)
  const streamPath = streamingPaths.get(f.id) ?? await getStreamingFilePath(f.id)
  const canUsePath = isImage ? (localCompleted && f.local.path && fs.existsSync(f.local.path)) : Boolean(streamPath)
  // Preparation starts the sequential download. The protocol probes the verified head before
  // deciding whether a non-faststart file needs a tail prefetch.
  return {
    path: canUsePath ? (isImage ? f.local.path : streamPath) : null,
    fileId: f.id,
    completed: localCompleted,
    size: f.size || f.expected_size || media.size,
    downloaded: localCompleted ? (f.size || media.size) : (f.local.downloaded_size || 0),
    name: media.name,
    type: media.type,
    duration: media.duration,
    thumb: media.thumb,
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

/** Pin or unpin a chat in its current chat list (main or archive) */
export async function pinChat(chatId: number, pin: boolean) {
  if (auth.step !== 'ready') throw fail(503, 'Telegram is not connected yet')
  const c = chats.get(chatId)
  const isArchive = c?.positions?.some((p) => p.list._ === 'chatListArchive')
  const chat_list: Td.ChatList$Input = isArchive ? { _: 'chatListArchive' } : { _: 'chatListMain' }
  await invoke({ _: 'toggleChatIsPinned', chat_list, chat_id: chatId, is_pinned: pin })
  if (c) {
    const pos = c.positions.find((p) => p.list._ === chat_list._)
    if (pos) pos.is_pinned = pin
    chatsChanged()
  }
}

/** Move chat between main list and archive */
export async function archiveChat(chatId: number, archive: boolean) {
  if (auth.step !== 'ready') throw fail(503, 'Telegram is not connected yet')
  const chat_list: Td.ChatList$Input = archive ? { _: 'chatListArchive' } : { _: 'chatListMain' }
  await invoke({ _: 'addChatToList', chat_id: chatId, chat_list })
  const c = chats.get(chatId)
  if (c) {
    c.positions = c.positions.filter((p) => p.list._ !== 'chatListMain' && p.list._ !== 'chatListArchive')
    c.positions.push({ _: 'chatPosition', list: chat_list as any, order: '1', is_pinned: false, source: { _: 'chatSourceMtprotoProxy' } as any })
    chatsChanged()
  }
}

/** Mute or unmute notifications for a chat */
export async function muteChat(chatId: number, mute: boolean) {
  if (auth.step !== 'ready') throw fail(503, 'Telegram is not connected yet')
  if (chatId === cache.meId) return
  await invoke({
    _: 'setChatNotificationSettings',
    chat_id: chatId,
    notification_settings: {
      _: 'chatNotificationSettings',
      mute_for: mute ? 2147483647 : 0,
      use_default_mute_stories: false,
      use_default_show_preview: true,
      use_default_sound: true,
      use_default_disable_pinned_message_notifications: true,
      use_default_disable_mention_notifications: true,
    },
  })
  const c = chats.get(chatId)
  if (c) {
    c.notification_settings = {
      ...(c.notification_settings || ({} as any)),
      mute_for: mute ? 2147483647 : 0,
    }
    chatsChanged()
  }
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

/** Forward messages to another chat */
export async function forwardMessages(fromChatId: number, toChatId: number, messageIds: number[], sendCopy = false) {
  if (auth.step !== 'ready') throw fail(503, 'Telegram is not connected yet')
  if (!messageIds.length) return
  await invoke({
    _: 'forwardMessages',
    chat_id: toChatId,
    from_chat_id: fromChatId,
    message_ids: messageIds,
    send_copy: sendCopy,
    remove_caption: false,
  })
  deps.emit({ type: 'invalidate', topics: [`messages:${toChatId}`, 'chats'] })
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
  if (!m.is_outgoing) {
    const c = chats.get(m.chat_id)
    const isMuted = Boolean(c?.notification_settings && (c.notification_settings.mute_for ?? 0) > 0)
    if (!isMuted) {
      const chatTitle = c?.title || 'New Message'
      let textBody = ''
      if (m.content._ === 'messageText') textBody = m.content.text.text
      else if (m.content._ === 'messagePhoto') textBody = '📷 Photo'
      else if (m.content._ === 'messageVideo') textBody = '🎥 Video'
      else if (m.content._ === 'messageDocument') textBody = '📄 Document'
      else if (m.content._ === 'messageAudio') textBody = '🎵 Audio'
      else textBody = 'New message received'
      deps.emit({
        type: 'notification',
        title: chatTitle,
        body: textBody.slice(0, 150),
        kind: 'message',
        chatId: m.chat_id,
        messageId: m.id,
      })
    }
  }
  const row = getScan(deps.db, m.chat_id)
  if (!row) return
  const x = extractMedia(m)
  if (x) putMedia(deps.db, [mediaRow(m.chat_id, m, x)])
  if (current.has(m.chat_id) && m.id > row.newest_id) putScan(deps.db, { ...row, newest_id: m.id })
  if (x) mediaChanged(m.chat_id)
}

const thumbPathCache = new Map<string, string>()
/** Deduplicates concurrent requests for the same thumbnail remote ID. */
const thumbInflight = new Map<string, Promise<string | null>>()
/** remoteIds that could not be fetched, and when. The renderer re-issues the <img> on every
 *  re-render, so without this an id that cannot be fetched becomes an unbounded getRemoteFile
 *  stream that starves everything else in TDLib's queue. */
const thumbFailed = new Map<string, number>()
/** How long thumbFile waits for TDLib to finish a thumbnail before answering the request. */
const THUMB_WAIT_MS = 15_000
/** How long a failed thumb is left alone before it may be tried again. */
const THUMB_RETRY_MS = 20_000
/** A single channel page queues ~100 thumbnails. Letting them all into TDLib at once is what made
 *  every other request — including the video the user was trying to open — wait behind them. */
let thumbPrefetchSlots = 0
const THUMB_PREFETCH_MAX = 6
const thumbPrefetchWaiters: (() => void)[] = []
async function withThumbSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (thumbPrefetchSlots >= THUMB_PREFETCH_MAX) {
    await new Promise<void>((r) => thumbPrefetchWaiters.push(r))
  }
  thumbPrefetchSlots++
  try {
    return await fn()
  } finally {
    thumbPrefetchSlots--
    thumbPrefetchWaiters.shift()?.()
  }
}
function rememberThumb(remoteId: string | null | undefined, filePath: string) {
  if (!remoteId) return
  thumbPathCache.set(remoteId, filePath)
  thumbFailed.delete(remoteId)
}

/** Prefetch recent full photo files in background with low priority so opening image view is instantaneous */
export function prefetchPhotos(fileIds: (number | null | undefined)[]) {
  for (const id of fileIds) {
    if (!id || typeof id !== 'number') continue
    void invoke({ _: 'getFile', file_id: id }).then((f) => {
      if (!f.local.is_downloading_completed && !f.local.is_downloading_active) {
        return invoke({ _: 'downloadFile', file_id: f.id, priority: 1, offset: 0, limit: 0, synchronous: false })
      }
    }).catch(() => {})
  }
}

export type ThumbPrefetchItem = string | { remoteId?: string | null, fileId?: number | null }

/** Prefetch remote thumbnail files asynchronously in background with low priority so active downloads get maximum bandwidth.
 *  Prefers local TDLib getFile (integer file_id lookup) when available to avoid remote network roundtrips. */
export function prefetchThumbs(items: (ThumbPrefetchItem | null | undefined)[]) {
  for (const item of items) {
    if (!item) continue
    const remoteId = typeof item === 'string' ? item : item.remoteId
    const fileId = typeof item === 'object' ? item.fileId : null

    if (remoteId && thumbPathCache.has(remoteId)) continue
    if (remoteId && thumbFailed.has(remoteId)) continue

    const query = (fileId && typeof fileId === 'number')
      ? invoke({ _: 'getFile', file_id: fileId })
      : (remoteId && typeof remoteId === 'string')
      ? invoke({ _: 'getRemoteFile', remote_file_id: remoteId })
      : null

    if (!query) continue

    void withThumbSlot(() => query.then((f) => {
      const cacheKey = remoteId || f.remote?.id
      // Same 2 MB ceiling as thumbFile: an id whose file is not a thumbnail is left alone (ARCHITECTURE > teleflow://
      // protocol), so a poisoned index cannot pull an arbitrary file down in the background.
      if ((f.expected_size || f.size) > 2 * 2 ** 20) return
      if (f.local.is_downloading_completed) {
        if (f.local.path && fs.existsSync(f.local.path)) rememberThumb(cacheKey, f.local.path)
        return
      }
      // Already under way: re-issuing downloadFile only resets the priority of the download that is
      // running, and on a page of 100 messages this happened again on every re-render.
      if (f.local.is_downloading_active) return
      return invoke({ _: 'downloadFile', file_id: f.id, priority: 16, offset: 0, limit: 0, synchronous: false })
        .then((done) => {
          if (done.local.is_downloading_completed && done.local.path && fs.existsSync(done.local.path)) {
            rememberThumb(cacheKey, done.local.path)
          }
        }).catch(() => {})
    })).catch(() => {})
  }
}

/** Local path of a thumbnail or avatar for teleflow://thumb; the size is checked before anything downloads.
 *  Concurrent requests for the same remoteId share a single in-flight Promise to avoid duplicate TDLib calls.
 *  It waits for TDLib to actually finish the file: an earlier version gave up the moment its 3 s
 *  synchronous call timed out, so any thumbnail that needed more than three seconds answered 404
 *  forever while the download kept running for nobody. */
export function thumbFile(remoteId: string): Promise<string | null> {
  // Fast path: already resolved and still on disk
  const cached = thumbPathCache.get(remoteId)
  if (cached && fs.existsSync(cached)) return Promise.resolve(cached)

  // A thumb that just failed is not retried immediately — see thumbFailed.
  if (thumbFailed.has(remoteId) && Date.now() - (thumbFailed.get(remoteId) || 0) < THUMB_RETRY_MS) {
    return Promise.resolve(null)
  }

  // Dedup: if another request is already downloading this thumbnail, share its promise
  const inflight = thumbInflight.get(remoteId)
  if (inflight) return inflight

  const promise = (async (): Promise<string | null> => {
    let remoteIdFailed = false
    try {
      let f = await invoke({ _: 'getRemoteFile', remote_file_id: remoteId })
      if ((f.expected_size || f.size) > 2 * 2 ** 20) throw fail(413, 'Thumbnail too large')
      if (f.local.is_downloading_completed && f.local.path && fs.existsSync(f.local.path)) {
        rememberThumb(remoteId, f.local.path)
        return f.local.path
      }

      // Watch both the updateFile stream and a getFile poll. The event stream alone is not enough —
      // a burst of updates during a busy page can be missed — and the poll is what turns "the
      // download finished a second later" from a 404 into a picture.
      const wait = (budgetMs: number) => new Promise<string | null>((resolve) => {
        let settled = false
        let unsub: () => void = () => {}
        let poll: ReturnType<typeof setInterval> | null = null
        const stop = (p: string | null) => {
          if (settled) return
          settled = true
          unsub()
          if (poll) clearInterval(poll)
          clearTimeout(timer)
          resolve(p)
        }
        const accept = (file: typeof f) => {
          if (file.local.is_downloading_completed && file.local.path && fs.existsSync(file.local.path)) stop(file.local.path)
        }
        const timer = setTimeout(() => stop(null), budgetMs)
        unsub = onUpdate((u) => { if (u._ === 'updateFile' && u.file.id === f.id) accept(u.file) })
        poll = setInterval(() => {
          void invoke({ _: 'getFile', file_id: f.id }).then((g) => { if (g) accept(g) }).catch(() => {})
        }, 600)
        accept(f)
      })

      // Fast path: a thumbnail under ~200 KB usually lands synchronously in well under a second.
      const sync: any = await Promise.race([
        invoke({ _: 'downloadFile', file_id: f.id, priority: 32, offset: 0, limit: 0, synchronous: true }),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 1500)),
      ]).catch(() => null)
      if (sync?.local?.is_downloading_completed && sync.local.path && fs.existsSync(sync.local.path)) {
        rememberThumb(remoteId, sync.local.path)
        return sync.local.path
      }

      // Not there yet: start (or resume) the download and watch for it instead of giving up.
      void invoke({ _: 'downloadFile', file_id: f.id, priority: 32, offset: 0, limit: 0, synchronous: false }).catch(() => null)
      const p = await wait(THUMB_WAIT_MS)
      if (p) rememberThumb(remoteId, p)
      else { remoteIdFailed = true; thumbFailed.set(remoteId, Date.now()) }
      return p
    } catch (e) {
      if ((e as { status?: number })?.status === 413) throw e
      remoteIdFailed = true
      thumbFailed.set(remoteId, Date.now())
      return null
    } finally {
      if (!remoteIdFailed) thumbFailed.delete(remoteId)
      thumbInflight.delete(remoteId)
    }
  })()

  thumbInflight.set(remoteId, promise)
  return promise
}

export type VideoTail = {
  totalSize: number
  tailOffset: number
  buffer: Buffer
}

const videoTailCache = new Map<number, VideoTail>()
const videoTailInflight = new Map<number, Promise<VideoTail | null>>()
const videoTailFailed = new Map<number, number>()
type HeadKind = 'faststart' | 'tail' | 'unknown'
const videoHeadKinds = new Map<number, Exclude<HeadKind, 'unknown'>>()
const videoHeadInflight = new Map<number, Promise<HeadKind>>()
const videoPrefetchInflight = new Map<number, object>()
/** Automatic tail warming used to be one attempt per file for the whole session, so a single
 *  failed prefetch meant no tail until the user opened the video. Attempts are now rate limited
 *  and capped instead of forbidden. */
const videoPrefetchAttempted = new Map<number, { at: number, n: number }>()
const videoTailControls = new Map<number, { cancelled: boolean, cancel: () => void }>()

// Disk length and aggregate downloaded bytes include holes. Only TDLib-confirmed offset-0
// coverage (or completion) can authorize a sequential read.
const tailSeen = new Set<number>()
const readableEnds = new Map<number, number>()
const readableDone = new Set<number>()
const streamingPaths = new Map<number, string>()
// Only the transfer engine's successful move can authorize a completed library copy. TDLib
// deletion and subsequent re-downloads affect the cache state above, never this separate record.
const retainedStreamingFiles = new Map<number, { path: string, size: number }>()

function resetStreamingSession() {
  for (const control of videoTailControls.values()) control.cancel()
  for (const state of [videoTailCache, videoTailInflight, videoTailFailed, videoTailControls,
    videoHeadKinds, videoHeadInflight, videoPrefetchInflight, videoPrefetchAttempted,
    tailSeen, readableEnds, readableDone, streamingPaths, retainedStreamingFiles, wmProbe, wmInflight]) state.clear()
}

/** Records an explicitly finalized local copy, not a TDLib temp file inferred from its disk size. */
export function retainStreamingFile(fileId: number, filePath: string, size: number): void {
  if (!(fileId > 0) || !path.isAbsolute(filePath) || isStreamingPath(filePath) || !Number.isSafeInteger(size) || size <= 0) return
  if (retainedStreamingFiles.size >= 400 && !retainedStreamingFiles.has(fileId)) {
    const oldest = retainedStreamingFiles.keys().next().value
    if (oldest !== undefined) retainedStreamingFiles.delete(oldest)
  }
  retainedStreamingFiles.set(fileId, { path: filePath, size })
  retainedStreamingFile(fileId)
}

function retainedStreamingFile(fileId: number): { path: string, size: number } | null {
  const retained = retainedStreamingFiles.get(fileId)
  if (!retained) return null
  try {
    const stat = fs.statSync(retained.path, { throwIfNoEntry: false })
    if (stat?.isFile() && stat.size === retained.size) return retained
  } catch {}
  retainedStreamingFiles.delete(fileId)
  return null
}

function retainedWatermarks(fileId: number): Watermarks | null {
  const retained = retainedStreamingFile(fileId)
  return retained ? { prefix: retained.size, downloaded: retained.size, size: retained.size, done: true } : null
}

function isStreamingPath(filePath: string): boolean {
  if (!deps?.dir || !path.isAbsolute(filePath)) return false
  const relative = path.relative(path.join(deps.dir, 'files'), filePath)
  return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
}

function rememberStreamingPath(file: Td.file) {
  const filePath = file.local?.path
  if (!filePath || !isStreamingPath(filePath)) return
  if (streamingPaths.size >= 400 && !streamingPaths.has(file.id)) {
    const oldest = streamingPaths.keys().next().value
    if (oldest !== undefined) streamingPaths.delete(oldest)
  }
  streamingPaths.set(file.id, filePath)
}

/** Prefer an existing finalized copy; otherwise refresh TDLib's actual path, retaining it during transient outages. */
export async function getStreamingFilePath(fileId: number): Promise<string | null> {
  if (!(fileId > 0)) return null
  const retained = retainedStreamingFile(fileId)
  if (retained) return retained.path
  const owner = client
  if (auth.step === 'ready') {
    try {
      const file = await bounded(invoke({ _: 'getFile', file_id: fileId }), 1500)
      if (client === owner) rememberStreamingPath(file)
    } catch {}
  }
  return retainedStreamingFile(fileId)?.path ?? streamingPaths.get(fileId) ?? null
}

async function confirmedCoverage(fileId: number, offset: number): Promise<number> {
  const result = await bounded(invoke({ _: 'getFileDownloadedPrefixSize', file_id: fileId, offset }), 1500)
  const size = Number(result.size)
  if (!Number.isSafeInteger(size) || size < 0) throw new Error('TDLib returned invalid downloaded prefix coverage')
  return size
}

/** True once a tail (moov) range has been requested for this file: its temp file may hold holes. */
export function tailWasRequested(fileId: number) {
  return tailSeen.has(fileId)
}

/** True while a tail (moov) fetch for this file is running; it hands the download back to byte 0 itself. */
export function videoTailBusy(fileId: number) {
  return videoTailInflight.has(fileId)
}

/** Complete means a retained finalized copy exists, or TDLib explicitly reported completion. */
export function downloadComplete(fileId: number) {
  return retainedStreamingFile(fileId) !== null || readableDone.has(fileId)
}

/** Cached confirmed offset-0 coverage, or the full size of an existing finalized copy. */
export function trackedReadableEnd(fileId: number) {
  return retainedStreamingFile(fileId)?.size ?? readableEnds.get(fileId) ?? 0
}

export type Watermarks = {
  /** Bytes of the temp file contiguous from offset 0. Reading past this returns zeros from a hole. */
  prefix: number
  /** Total bytes downloaded, counting out-of-order parts as well. */
  downloaded: number
  /** Final size of the file; 0 when TDLib cannot say. */
  size: number
  /** TDLib reported completion, or a trusted finalized local copy still exists. */
  done: boolean
}

const wmProbe = new Map<number, { value: Watermarks, at: number }>()
const wmInflight = new Map<number, Promise<Watermarks | null>>()

/** Prefer the finalized copy; otherwise obtain metadata and confirmed offset-0 coverage independently of the active range. */
export async function getWatermarks(fileId: number, maxAgeMs = 250): Promise<Watermarks | null> {
  if (!(fileId > 0)) return null
  const retained = retainedWatermarks(fileId)
  if (retained) return retained
  const hit = wmProbe.get(fileId)
  if (hit && Date.now() - hit.at < maxAgeMs) return hit.value
  const inflight = wmInflight.get(fileId)
  if (inflight) return inflight
  if (auth.step !== 'ready') return hit?.value ?? null
  const owner = client
  let promise!: Promise<Watermarks | null>
  promise = (async () => {
    try {
      const [f, coverage] = await Promise.all([
        bounded(invoke({ _: 'getFile', file_id: fileId }), 1500),
        confirmedCoverage(fileId, 0).catch(() => null),
      ])
      const retained = retainedWatermarks(fileId)
      if (retained) return retained
      if (client !== owner || wmInflight.get(fileId) !== promise) return null
      noteReadable(f)
      const size = Number(f.size) || Number(f.expected_size) || 0
      const downloaded = Number(f.local.downloaded_size) || 0
      const done = Boolean(f.local.is_downloading_completed)
      const prefix = done && size > 0 ? size : (coverage ?? readableEnds.get(fileId) ?? 0)
      readableEnds.set(fileId, prefix)
      const value: Watermarks = { prefix, downloaded, size, done }
      wmProbe.set(fileId, { value, at: Date.now() })
      return value
    } catch {
      return retainedWatermarks(fileId) ?? (client === owner && wmInflight.get(fileId) === promise ? hit?.value ?? null : null)
    } finally {
      if (wmInflight.get(fileId) === promise) wmInflight.delete(fileId)
    }
  })()
  wmInflight.set(fileId, promise)
  return promise
}

/** Fail closed even before the first tail: a downloading file's disk length is never coverage. */
export async function watermarkFor(fileId: number): Promise<Watermarks | null> {
  const w = await getWatermarks(fileId)
  const retained = retainedWatermarks(fileId)
  if (retained) return retained
  if (w) return w
  if (!(fileId > 0)) return null
  const tracked = readableEnds.get(fileId) ?? 0
  return { prefix: tracked, downloaded: 0, size: 0, done: readableDone.has(fileId) }
}

/** Bytes of TDLib's temp file readable from offset 0; null when TDLib cannot say. */
export async function getReadableEnd(fileId: number, maxAgeMs = 250): Promise<number | null> {
  if (downloadComplete(fileId)) return Number.MAX_SAFE_INTEGER
  const wm = await getWatermarks(fileId, maxAgeMs)
  if (!wm) return null
  return wm.done ? Number.MAX_SAFE_INTEGER : wm.prefix
}

/** Keeps the readable-from-0 watermark current straight from updateFile, without a getFile round trip. */
function noteReadable(file: Td.file) {
  rememberStreamingPath(file)
  wmProbe.delete(file.id)
  const tracked = readableEnds.get(file.id) ?? 0
  let value = tracked
  if (file.local.is_downloading_completed) {
    value = file.size || file.expected_size || tracked
    readableDone.add(file.id)
  } else {
    readableDone.delete(file.id)
    // This field describes the prefix of the current download_offset, not necessarily byte 0.
    if ((file.local.download_offset || 0) === 0) value = Math.max(tracked, file.local.downloaded_prefix_size || 0)
  }
  if (readableEnds.size >= 400 && !readableEnds.has(file.id)) {
    const oldest = readableEnds.keys().next().value
    if (oldest !== undefined) readableEnds.delete(oldest)
  }
  readableEnds.set(file.id, value)
}

/** Re-assert priority 32 sequential download from offset 0 if background stream was waiting */
export function resumeStreamingDownload(fileId: number) {
  if (auth.step !== 'ready' || fileId <= 0) return
  invoke({ _: 'downloadFile', file_id: fileId, priority: 32, offset: 0, limit: 0, synchronous: false }).catch(() => {})
}

/** Seek streaming download to a specific byte offset */
export function seekStreamingDownload(fileId: number, offset: number) {
  if (auth.step !== 'ready' || fileId <= 0) return
  invoke({ _: 'downloadFile', file_id: fileId, priority: 32, offset, limit: 0, synchronous: false }).catch(() => {})
}

export function getVideoTail(fileId: number): VideoTail | undefined {
  return videoTailCache.get(fileId)
}

export function setVideoTail(fileId: number, tail: VideoTail) {
  if (videoTailCache.size > 30) {
    const firstKey = videoTailCache.keys().next().value
    if (firstKey !== undefined) videoTailCache.delete(firstKey)
  }
  videoTailCache.set(fileId, tail)
}

/** Reads a range of bytes directly from TDLib file cache via readFilePart */
export async function readFileRange(fileId: number, offset: number, count: number): Promise<Buffer | null> {
  if (auth.step !== 'ready') return null
  const CHUNK_SIZE = 512 * 1024
  const chunks: Buffer[] = []
  let currentOffset = offset
  let remaining = count

  while (remaining > 0) {
    const toRead = Math.min(remaining, CHUNK_SIZE)
    try {
      const res = await invoke({
        _: 'readFilePart',
        file_id: fileId,
        offset: currentOffset,
        count: toRead,
      })
      if (res && res._ === 'data' && res.data) {
        const buf = Buffer.from(res.data, 'base64')
        if (buf.length === 0) break
        chunks.push(buf)
        currentOffset += buf.length
        remaining -= buf.length
      } else {
        break
      }
    } catch {
      break
    }
  }

  return chunks.length > 0 ? Buffer.concat(chunks) : null
}

const TAIL_BASE = 5 * 1024 * 1024 // maximum eligible tail window, shared with the media range policy
const TAIL_PREFETCH = 64 * 1024

/**
 * Fetches a verified suffix through EOF, not necessarily the whole eligible 5 MiB window. Its
 * aligned floor remains byte-identical to the range policy: requests below it stay sequential.
 * Without a hint, warm the last 64 KiB (aligned down); an earlier eligible request downloads an
 * expanded suffix and replaces the cache only once that entire suffix is confirmed.
 *
 * The bytes are read out of TDLib's own temp file — `readFilePart` cannot reach them, because TDLib
 * only exposes the contiguous prefix of a file that is still downloading, and the tail is by
 * definition outside that prefix — and are cached in memory (see getVideoTail) so the protocol
 * handler can answer from them. Restore the sequential download once afterwards, unless the caller
 * explicitly cancelled it: a new offset/limit call replaces the previous range.
 */
export async function fetchVideoTail(fileId: number, totalSize: number, fromOffset?: number): Promise<VideoTail | null> {
  if (auth.step !== 'ready' || !(fileId > 0) || !Number.isSafeInteger(totalSize) || totalSize <= 0) return null
  // Eligibility is unchanged; the actual download can be a much smaller aligned suffix.
  const eligibleFloor = Math.floor(Math.max(0, totalSize - Math.min(totalSize, TAIL_BASE)) / 4096) * 4096
  const need = fromOffset ?? Math.max(0, totalSize - TAIL_PREFETCH)
  if (!Number.isSafeInteger(need) || need < eligibleFloor || need >= totalSize) return null
  const tailOffset = Math.max(eligibleFloor, Math.floor(need / 4096) * 4096)
  const tailSize = totalSize - tailOffset
  const covers = (t: VideoTail) => t.totalSize === totalSize && t.tailOffset <= need && t.tailOffset + t.buffer.length === totalSize
  const cached = videoTailCache.get(fileId)
  if (cached && covers(cached)) return cached
  const inflight = videoTailInflight.get(fileId)
  if (inflight) {
    const result = await inflight
    return result && covers(result) ? result : null
  }
  const failedAt = videoTailFailed.get(fileId)
  if (failedAt !== undefined && Date.now() - failedAt < 5000) return null

  let cancel!: () => void
  const cancelled = new Promise<void>((resolve) => { cancel = resolve })
  const control = { cancelled: false, cancel: () => { control.cancelled = true; cancel() } }
  const owner = client
  videoTailControls.set(fileId, control)
  tailSeen.add(fileId)
  const promise = (async (): Promise<VideoTail | null> => {
    const began = Date.now()
    let requested = false
    let handedBack = false
    let filePath: string | null = null
    const failed = (reason: string): null => {
      log('warn', `media: tail failure id ${fileId} window ${tailOffset}+${tailSize} after ${Date.now() - began}ms; reason ${reason}; path ${filePath ?? '-'}`)
      if (!control.cancelled) videoTailFailed.set(fileId, Date.now())
      return null
    }
    const handBack = async () => {
      if (!requested || handedBack) return
      handedBack = true
      if (control.cancelled || client !== owner || auth.step !== 'ready') {
        log('warn', `media: tail handback id ${fileId} skipped: cancelled or client changed; path ${filePath ?? '-'}`)
        return
      }
      try {
        const file = await bounded(call({ _: 'downloadFile', file_id: fileId, priority: 32, offset: 0, limit: 0, synchronous: false }), 1500)
        noteReadable(file)
        log('warn', `media: tail handback id ${fileId} success; path ${streamingPaths.get(fileId) ?? filePath ?? '-'}`)
      } catch (error) {
        log('warn', `media: tail handback id ${fileId} failed: ${error instanceof Error ? error.message : String(error)}; path ${filePath ?? '-'}`)
      }
    }
    try {
      filePath = await getStreamingFilePath(fileId)
      if (control.cancelled || client !== owner) return failed('cancelled before range request')
      log('warn', `media: tail start id ${fileId} window ${tailOffset}+${tailSize}; eligible floor ${eligibleFloor}; path ${filePath ?? '-'}`)
      requested = true
      let downloadFailure = ''
      let rejectionDeadline = Infinity
      // Synchronous describes TDLib's eventual answer, not a barrier to checking range coverage.
      // Handback cancels the outstanding request when the verified bytes are already available.
      void call({ _: 'downloadFile', file_id: fileId, priority: 32, offset: tailOffset, limit: tailSize, synchronous: true }).then(
        (file) => {
          if (client === owner && videoTailControls.get(fileId) === control && !control.cancelled) rememberStreamingPath(file)
        },
        (error) => {
          if (client !== owner || videoTailControls.get(fileId) !== control || control.cancelled) return
          downloadFailure = error instanceof Error ? error.message : String(error)
          rejectionDeadline = Date.now() + 5000
          log('warn', `media: tail download rejected id ${fileId} window ${tailOffset}+${tailSize}: ${downloadFailure}`)
        },
      )
      const absoluteDeadline = began + 5 * 60 * 1000
      let idleDeadline = Date.now() + 30000
      let confirmed = 0
      let reason = 'range not confirmed'
      do {
        if (Date.now() >= absoluteDeadline) return failed(`absolute timeout; confirmed ${confirmed}/${tailSize}`)
        // Neither a returned download nor bytes that resemble media prove a sparse range is ready.
        const [coverage, actualPath] = await Promise.all([
          confirmedCoverage(fileId, tailOffset).catch(() => null),
          getStreamingFilePath(fileId),
        ])
        filePath = actualPath
        if (control.cancelled || client !== owner) return failed('explicit cancellation or client changed')
        if (Date.now() >= absoluteDeadline) return failed(`absolute timeout; confirmed ${confirmed}/${tailSize}`)
        if (coverage !== null && coverage > confirmed) {
          confirmed = coverage
          idleDeadline = Date.now() + 30000
        }
        if (coverage !== null && coverage >= tailSize && filePath) {
          const buffer = await readTailFromDisk(filePath, tailOffset, tailSize)
          if (control.cancelled || client !== owner) return failed('explicit cancellation or client changed')
          if (buffer?.length === tailSize) {
            const tail: VideoTail = { totalSize, tailOffset, buffer }
            setVideoTail(fileId, tail)
            videoTailFailed.delete(fileId)
            log('warn', `media: tail ready id ${fileId} window ${tailOffset}+${tailSize} in ${Date.now() - began}ms; confirmed ${coverage}; path ${filePath}`)
            return tail
          }
          reason = 'confirmed range missing or short on disk'
        } else {
          reason = coverage === null ? 'coverage query failed' : (!filePath ? 'TDLib has no local path' : `unconfirmed range ${coverage}/${tailSize}`)
        }
        if (Date.now() >= rejectionDeadline) return failed(`${downloadFailure}; ${reason}`)
        if (Date.now() >= idleDeadline) return failed(`idle timeout; ${reason}`)
        await bounded(cancelled, 250).catch(() => {})
      } while (!control.cancelled && client === owner)
      return failed('explicit cancellation or client changed')
    } catch (error) {
      return failed(error instanceof Error ? error.message : String(error))
    } finally {
      await handBack()
      if (videoTailControls.get(fileId) === control) {
        videoTailControls.delete(fileId)
        videoTailInflight.delete(fileId)
      }
    }
  })()
  videoTailInflight.set(fileId, promise)
  return promise
}

/** Reads `count` bytes at `offset` straight from a local file; null when it cannot be read at all. */
async function readTailFromDisk(filePath: string, offset: number, count: number): Promise<Buffer | null> {
  if (!filePath || count <= 0) return null
  const handle = await fs.promises.open(filePath, 'r').catch(() => null)
  if (!handle) return null
  try {
    const buf = Buffer.alloc(count)
    let read = 0
    while (read < count) {
      let bytesRead = 0
      try {
        ({ bytesRead } = await handle.read(buf, read, count - read, offset + read))
      } catch {
        break
      }
      if (bytesRead <= 0) break
      read += bytesRead
    }
    return read > 0 ? buf.subarray(0, read) : null
  } finally {
    await handle.close().catch(() => {})
  }
}

/** True only after parsing a complete, verified top-level moov before the first mdat. */
export function videoHasHeadMoov(fileId: number): boolean {
  return videoHeadKinds.get(fileId) === 'faststart'
}

/** Partial headers/boxes remain unknown so a later prefix update can retry the probe. */
export async function probeVideoHead(fileId: number, totalSize: number, filePath: string): Promise<HeadKind> {
  if (!(fileId > 0) || !Number.isSafeInteger(totalSize) || totalSize <= 0) return 'unknown'
  const known = videoHeadKinds.get(fileId)
  if (known) return known
  const inflight = videoHeadInflight.get(fileId)
  if (inflight) return inflight
  const owner = client
  let promise!: Promise<HeadKind>
  promise = (async () => {
    try {
      const [wm, actualPath] = await Promise.all([getWatermarks(fileId, 0), getStreamingFilePath(fileId)])
      const prefix = Math.min(totalSize, wm?.prefix ?? trackedReadableEnd(fileId))
      const source = actualPath || (isStreamingPath(filePath) ? filePath : null)
      if (!source) return 'unknown'
      const remember = (kind: Exclude<HeadKind, 'unknown'>): HeadKind => {
        if (client !== owner || videoHeadInflight.get(fileId) !== promise) return 'unknown'
        if (videoHeadKinds.size >= 400) {
          const oldest = videoHeadKinds.keys().next().value
          if (oldest !== undefined) videoHeadKinds.delete(oldest)
        }
        videoHeadKinds.set(fileId, kind)
        log('warn', `media: head probe id ${fileId} ${kind}; prefix ${prefix}; path ${source}`)
        return kind
      }
      let offset = 0
      for (let boxes = 0; boxes < 1024 && offset < prefix; boxes++) {
        if (prefix - offset < 8) return 'unknown'
        let header = await readTailFromDisk(source, offset, 8)
        if (header?.length !== 8) return 'unknown'
        let size = header.readUInt32BE(0)
        const type = header.toString('ascii', 4, 8)
        let headerSize = 8
        if (size === 1) {
          if (prefix - offset < 16) return 'unknown'
          header = await readTailFromDisk(source, offset, 16)
          if (header?.length !== 16) return 'unknown'
          const largeSize = header.readBigUInt64BE(8)
          if (largeSize > BigInt(Number.MAX_SAFE_INTEGER)) return 'unknown'
          size = Number(largeSize)
          headerSize = 16
        } else if (size === 0) {
          size = totalSize - offset
        }
        if (size < headerSize || size > totalSize - offset) return 'unknown'
        if (type === 'mdat') return remember('tail')
        // A moov header alone is not enough: its complete box must be within the verified prefix.
        if (size > prefix - offset) return 'unknown'
        if (type === 'moov') return remember('faststart')
        offset += size
      }
      return 'unknown'
    } catch {
      return 'unknown'
    } finally {
      if (videoHeadInflight.get(fileId) === promise) videoHeadInflight.delete(fileId)
    }
  })()
  videoHeadInflight.set(fileId, promise)
  return promise
}

const TAIL_PREFETCH_RETRY_MS = 20_000
const TAIL_PREFETCH_MAX_ATTEMPTS = 6

/** Warming the tail repeatedly, at a distance, instead of exactly once: an attempt that found
 *  nothing (TDLib could not serve that range yet) must not be the last word for the session. */
export function prefetchVideoTail(fileId: number, totalSize: number, filePath: string) {
  if (!(fileId > 0) || totalSize <= TAIL_BASE || videoHasHeadMoov(fileId) || videoPrefetchInflight.has(fileId) || videoTailBusy(fileId)) return
  if (downloadComplete(fileId) || videoTailCache.get(fileId)?.totalSize === totalSize) return
  const prior = videoPrefetchAttempted.get(fileId)
  if (prior && prior.n >= TAIL_PREFETCH_MAX_ATTEMPTS) return
  if (prior && Date.now() - prior.at < TAIL_PREFETCH_RETRY_MS) return
  const failedAt = videoTailFailed.get(fileId)
  if (failedAt !== undefined && Date.now() - failedAt < 5000) return
  const owner = client, attempt = {}
  videoPrefetchInflight.set(fileId, attempt)
  void (async () => {
    try {
      const kind = await probeVideoHead(fileId, totalSize, filePath)
      if (client !== owner || videoPrefetchInflight.get(fileId) !== attempt || kind !== 'tail') return
      // A cached head classification can outlive completion or a transfer's move/delete cleanup.
      // Recheck before consuming the attempt or replacing the sequential download.
      const wm = await getWatermarks(fileId, 0)
      if (client !== owner || videoPrefetchInflight.get(fileId) !== attempt || wm?.done || downloadComplete(fileId)) return
      // Recorded here rather than on entry: a probe that finds nothing to fetch has not spent an
      // attempt, and a caller that learns the head is retryable must still be able to ask again.
      videoPrefetchAttempted.set(fileId, { at: Date.now(), n: (prior?.n ?? 0) + 1 })
      await fetchVideoTail(fileId, totalSize)
    } catch (error) {
      log('warn', `media: prefetch id ${fileId} failed: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      if (videoPrefetchInflight.get(fileId) === attempt) videoPrefetchInflight.delete(fileId)
    }
  })()
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
