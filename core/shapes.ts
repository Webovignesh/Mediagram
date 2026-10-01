// TDLib objects → TeleFlow shapes (ARCHITECTURE > Shared shapes, > Telegram): auth and connection states, errors, Me,
// chats and rights, media extraction, links. Pure, so node:test covers them without a TDLib client.
import path from 'node:path'
import tdl from 'tdl'
import type * as Td from 'tdlib-types'
import { type AppError, fail, type MediaType } from './db.ts'

export type Me = { id: number, name: string, firstName: string, username: string | null,
  phone: string /* masked */, photo: string | null /* remote file id */, premium: boolean,
  captionMax: number, uploadMax: number }
type Step =
  | { step: 'starting' }
  | { step: 'credentials', error?: string }
  | { step: 'phone', error?: string }
  | { step: 'code', phone: string, via: 'telegram' | 'sms' | 'call' | 'other' }
  | { step: 'password', hint: string }
  | { step: 'ready', me: Me }
  | { step: 'logging-out' }
export type AuthState = { connection: 'ready' | 'connecting' | 'updating' | 'offline' } & Step
export type Chat = { id: number, title: string, kind: 'private' | 'saved' | 'group' | 'channel', username: string | null,
  photo: string | null, unread: number, lastDate: number, canPost: boolean, folders: number[] }
export type Folder = { id: number, name: string }
export type Media = { type: MediaType, file: Td.file, name: string, ext: string, size: number, duration: number, caption: string, thumb: string | null }
export type Message = { id: number, date: number, sender: string, text: string, media: Media | null }
export type Creds = { apiId: number, apiHash: string }

/** Seconds from FLOOD_WAIT_n, FLOOD_PREMIUM_WAIT_n, or "retry after n"; null when the error is not a flood wait. */
export const parseFloodWait = (message: string) => {
  const m = /FLOOD_(?:PREMIUM_)?WAIT_(\d+)|retry after (\d+)/i.exec(message)
  return m ? Number(m[1] ?? m[2]) : null
}

const readable: Record<string, string> = {
  PHONE_NUMBER_INVALID: "That phone number isn't valid. Include the country code.",
  PHONE_NUMBER_BANNED: 'Telegram has banned this phone number.',
  PHONE_CODE_INVALID: 'That code is wrong. Check it and try again.',
  PHONE_CODE_EXPIRED: 'That code has expired. Request a new one.',
  PASSWORD_HASH_INVALID: 'Wrong password. Try again.',
  USERNAME_NOT_OCCUPIED: 'No chat uses that username.',
  USERNAME_INVALID: "That username isn't valid.",
  INVITE_HASH_EXPIRED: 'That invite link has expired.',
  INVITE_HASH_INVALID: "That invite link isn't valid.",
  CHANNEL_PRIVATE: 'That chat is private.',
  CHAT_WRITE_FORBIDDEN: "You can't post in this chat.",
}

/** TDLib errors → fail() with a status from the code; tdl's "client closed" errors → 503; anything else is a bug. */
export function tdError(e: unknown): AppError | unknown {
  if (!(e instanceof tdl.TDLibError)) {
    return e instanceof Error && /closed client|Client was closed/.test(e.message) ? fail(503, 'Telegram is not connected yet') : e
  }
  const wait = parseFloodWait(e.message)
  if (wait !== null) return fail(429, `Telegram asks to wait ${wait} s before trying again.`, { retryAfter: wait })
  const c = e.code
  const status = c === 400 || c === 406 ? 400 : c === 401 || c === 403 ? 403 : c === 404 ? 404 : c === 420 || c === 429 ? 429 : 500
  return fail(status, readable[e.message] ?? e.message)
}

export const mapConnection = (s: Td.ConnectionState): AuthState['connection'] =>
  s._ === 'connectionStateReady' ? 'ready' : s._ === 'connectionStateUpdating' ? 'updating'
    : s._ === 'connectionStateWaitingForNetwork' ? 'offline' : 'connecting'

// ponytail: email login and sign-up are not supported; upgrade: auth.email / auth.emailCode →
// setAuthenticationEmailAddress / checkAuthenticationEmailCode.
const unsupported: Record<string, string> = {
  authorizationStateWaitEmailAddress: 'email setup', authorizationStateWaitEmailCode: 'email setup',
  authorizationStateWaitRegistration: 'account registration',
  authorizationStateWaitOtherDeviceConfirmation: 'confirmation on another device',
  authorizationStateWaitPremiumPurchase: 'Telegram Premium',
}
const codeVia = (t: Td.AuthenticationCodeType) => t._ === 'authenticationCodeTypeTelegramMessage' ? 'telegram' as const
  : /^authenticationCodeTypeSms/.test(t._) ? 'sms' as const : t._ === 'authenticationCodeTypeCall' ? 'call' as const : 'other' as const

/** TDLib authorization state → login step. `ready` waits for `me` (getMe), so it shows `starting` until then. */
export function mapAuth(s: Td.AuthorizationState | null, me: Me | null): Step {
  if (!s) return { step: 'starting' }
  switch (s._) {
    case 'authorizationStateWaitTdlibParameters': return { step: 'starting' }
    case 'authorizationStateWaitPhoneNumber': return { step: 'phone' }
    case 'authorizationStateWaitCode': return { step: 'code', phone: `+${s.code_info.phone_number.replace(/\D/g, '')}`, via: codeVia(s.code_info.type) }
    case 'authorizationStateWaitPassword': return { step: 'password', hint: s.password_hint }
    case 'authorizationStateReady': return me ? { step: 'ready', me } : { step: 'starting' }
    case 'authorizationStateLoggingOut': case 'authorizationStateClosing': case 'authorizationStateClosed': return { step: 'logging-out' }
    default: return { step: 'phone', error: `Telegram needs ${unsupported[s._]} for this number, which TeleFlow does not support yet. Finish it in the official Telegram app, then try again.` }
  }
}

/** +•• ••• ••45 67: only the last four digits stay readable. */
export function maskPhone(phone: string) {
  const d = phone.replace(/\D/g, '')
  const m = '•'.repeat(Math.max(0, d.length - 4)) + d.slice(-4)
  const tail = Math.max(5, m.length - 2)
  return '+' + [m.slice(0, 2), m.slice(2, 5), m.slice(5, tail), m.slice(tail)].filter(Boolean).join(' ')
}

export const toMe = (u: Td.user, captionMax: number): Me => ({
  id: u.id, name: [u.first_name, u.last_name].filter(Boolean).join(' '), firstName: u.first_name,
  username: u.usernames?.active_usernames[0] ?? null, phone: maskPhone(u.phone_number),
  photo: u.profile_photo?.small.remote.id || null, premium: u.is_premium, captionMax,
  uploadMax: u.is_premium ? 4_194_304_000 : 2_097_152_000,
})

// <img> can't render Mpeg4, Webm, or Tgs thumbnails.
const thumbId = (t?: Td.thumbnail) => t && /^thumbnailFormat(Jpeg|Png|Webp|Gif)$/.test(t.format._) ? t.file.remote.id || null : null
const mimeExt: Record<string, string> = {
  'application/pdf': 'pdf', 'application/zip': 'zip', 'application/vnd.rar': 'rar', 'application/x-rar-compressed': 'rar',
  'application/x-7z-compressed': '7z', 'application/vnd.android.package-archive': 'apk', 'text/plain': 'txt',
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'video/mp4': 'mp4',
  'video/x-matroska': 'mkv', 'audio/mpeg': 'mp3', 'audio/ogg': 'ogg',
}
const area = (s: Td.photoSize) => s.width * s.height

/** A message's downloadable media (stickers excluded), or null. `<n>` in default names is the id shown in t.me links. */
export function extractMedia(m: Td.message): Media | null {
  const c = m.content
  const n = Math.floor(m.id / 2 ** 20)
  let r: [MediaType, Td.file, string, number, string | null]
  switch (c._) {
    case 'messageVideo': r = ['video', c.video.video, c.video.file_name || `Video_${n}.mp4`, c.video.duration, thumbId(c.video.thumbnail)]; break
    case 'messagePhoto': {
      const sizes = c.photo.sizes
      if (!sizes.length) return null
      const thumb = sizes.find((s) => s.type === 'm') ?? sizes.reduce((a, b) => (area(b) < area(a) ? b : a)) // photo sizes are JPEG
      r = ['photo', sizes.reduce((a, b) => (area(b) > area(a) ? b : a)).photo, `Photo_${n}.jpg`, 0, thumb.photo.remote.id || null]
      break
    }
    case 'messageDocument': {
      const ext = mimeExt[c.document.mime_type]
      r = ['document', c.document.document, c.document.file_name || `File_${n}${ext ? `.${ext}` : ''}`, 0, thumbId(c.document.thumbnail)]
      break
    }
    case 'messageAudio': r = ['audio', c.audio.audio, c.audio.file_name || `Audio_${n}.mp3`, c.audio.duration, thumbId(c.audio.album_cover_thumbnail)]; break
    case 'messageAnimation': r = ['animation', c.animation.animation, c.animation.file_name || `Animation_${n}.mp4`, c.animation.duration, thumbId(c.animation.thumbnail)]; break
    case 'messageVoiceNote': r = ['voice', c.voice_note.voice, `Voice_${n}.ogg`, c.voice_note.duration, null]; break
    case 'messageVideoNote': r = ['video_note', c.video_note.video, `VideoNote_${n}.mp4`, c.video_note.duration, thumbId(c.video_note.thumbnail)]; break
    default: return null
  }
  const [type, file, name, duration, thumb] = r
  return { type, file, name, ext: path.extname(name).slice(1).toLowerCase(), size: file.size || file.expected_size, duration, caption: 'caption' in c ? c.caption.text : '', thumb }
}

export const isTelegramLink = (q: string) => /^(?:https?:\/\/)?(?:www\.)?(?:t\.me|telegram\.me|telegram\.dog)\/|^tg:\/\//i.test(q.trim())
/** Bare `@name` or `name` → https://t.me/name; a scheme-less t.me link gets https://. */
export function normalizeLink(s: string) {
  const t = s.trim()
  if (/^@?\w{4,32}$/.test(t)) return `https://t.me/${t.replace(/^@/, '')}`
  return /^(?:www\.)?(?:t\.me|telegram\.me|telegram\.dog)\//i.test(t) ? `https://${t}` : t
}
export const linkKind = (t: Td.InternalLinkType) => t._ === 'internalLinkTypeMessage' ? { kind: 'message' as const }
  : t._ === 'internalLinkTypePublicChat' ? { kind: 'chat' as const } : t._ === 'internalLinkTypeChatInvite' ? { kind: 'invite' as const } : null

/** The user and group records that chat kind, username, and rights are read from. */
export type Cache = { meId: number, users: Map<number, Td.user>, basicGroups: Map<number, Td.basicGroup>, supergroups: Map<number, Td.supergroup> }

/** Posting and upload media rights: creators, admins, channels you post in, and Saved Messages allow everything;
 *  group members get the chat's (or their restricted) permissions. */
export function rights(c: Td.chat, k: Cache) {
  const all = { post: true, photos: true, videos: true }
  const none = { post: false, photos: false, videos: false }
  const t = c.type
  if (t._ === 'chatTypePrivate') return t.user_id === k.meId ? all : none
  if (t._ === 'chatTypeSecret') return none
  const s = t._ === 'chatTypeBasicGroup' ? k.basicGroups.get(t.basic_group_id)?.status : k.supergroups.get(t.supergroup_id)?.status
  if (s?._ === 'chatMemberStatusCreator') return all
  if (t._ === 'chatTypeSupergroup' && t.is_channel) return s?._ === 'chatMemberStatusAdministrator' && s.rights.can_post_messages ? all : none
  if (s?._ === 'chatMemberStatusAdministrator') return all
  const p = s?._ === 'chatMemberStatusMember' ? c.permissions : s?._ === 'chatMemberStatusRestricted' && s.is_member ? s.permissions : null
  return p ? { post: p.can_send_documents, photos: p.can_send_photos, videos: p.can_send_videos } : none
}

const folderIds = (c: Td.chat) => [...new Set([...c.positions.map((p) => p.list), ...c.chat_lists]
  .flatMap((l) => (l._ === 'chatListFolder' ? [l.chat_folder_id] : [])))]

export function toChat(c: Td.chat, k: Cache): Chat | null {
  const t = c.type
  if (t._ === 'chatTypeSecret') return null
  const saved = t._ === 'chatTypePrivate' && t.user_id === k.meId
  const names = t._ === 'chatTypePrivate' ? k.users.get(t.user_id)?.usernames : t._ === 'chatTypeSupergroup' ? k.supergroups.get(t.supergroup_id)?.usernames : undefined
  return {
    id: c.id, title: saved ? 'Saved Messages' : c.title,
    kind: saved ? 'saved' : t._ === 'chatTypePrivate' ? 'private' : t._ === 'chatTypeSupergroup' && t.is_channel ? 'channel' : 'group',
    username: names?.active_usernames[0] ?? null, photo: c.photo?.small.remote.id || null, unread: c.unread_count,
    lastDate: c.last_message?.date ?? 0, canPost: rights(c, k).post, folders: folderIds(c),
  }
}

export const folderOf = (f: Td.chatFolderInfo): Folder => ({ id: f.id, name: f.name.text.text })
