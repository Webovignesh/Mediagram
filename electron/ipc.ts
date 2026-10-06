// The IPC API and the teleflow:// resolver (ARCHITECTURE > IPC contract). Imports no `electron`: main passes native
// calls in through ctx, so node:test can load this file.
import fs from 'node:fs'
import path from 'node:path'
import {
  type AppError, checkSettings, type DB, downloadStates, type Emit, fail, jobsList, mediaExts, type MediaItem, mediaQuery,
  readSetting, setSettings, statsActivity, statsChats, statsOverview, type StoredSettings,
} from '../core/db.ts'
import { type Chat, extractMedia, isTelegramLink, linkKind, mediaRow } from '../core/shapes.ts'
import {
  checkDownloadRoot, clearAll, clearAppData, clearCache, type ClearDeps, dirSize, library, libraryCached, libraryFile, libraryItems,
  libraryList, libraryMissing, libType, log, pageKey, type Paths, realLocation, type RootLists, storageReport, trash, within, withPreview,
} from '../core/storage.ts'
import type * as telegram from '../core/telegram.ts'
import type { Engine } from '../core/transfers.ts'

export type License = { name: string, version: string, license: string }
/** Electron calls, passed in by main. */
export type Native = {
  pickFolder(title?: string): Promise<string | null>
  /** Files the user chose this session (file dialog or drag-drop, handed over by preload). uploads.add reads nothing else. */
  grants: { add(paths: unknown): void, has(path: string): boolean }
  /** Folders chosen in the Browse dialog this session. settings.set only accepts one of these as the download root. */
  picks: { add(path: string): void, has(path: string): boolean }
  /** The API keys, encrypted by main: saved automatically when a sign-in reaches `ready`, kept through logout,
   *  forgotten when Telegram rejects them or Clear All Data runs. `get` is the pair the next sign-in starts with. */
  keys: { save(apiId: number, apiHash: string): void, forget(): void, get(): { apiId: number, apiHash: string } | null }
  openPath(target: string): Promise<string> // '' on success, else the error (shell.openPath)
  reveal(file: string): void
  trashItem(file: string): Promise<void>
  loginItem: { get(): boolean, set(on: boolean): void }
  cacheSize(): Promise<number>
  clearCache(): Promise<void> // session.clearCache + clearCodeCaches
  clearStorageData(): Promise<void>
}
export type Ctx = {
  version: string, tdlib: string, installedAt: number | null,
  repository: string | undefined /* package.json repository.url */, licenses: License[],
  paths: Paths, db: DB, settings: () => StoredSettings, roots: RootLists, emit: Emit, tg: typeof telegram, native: Native, engine: Engine,
}

// Common validators: each failure is a 400 naming the field.
type Check<T> = (value: unknown, field: string) => T
const reject = (field: string, rule: string) => fail(400, `${field} ${rule}`)
export const int = (min: number, max: number, fallback?: number): Check<number> => (v, f) => {
  if (v === undefined && fallback !== undefined) return fallback
  if (!Number.isInteger(v) || (v as number) < min || (v as number) > max) throw reject(f, `must be a whole number from ${min} to ${max}`)
  return v as number
}
export const id: Check<number> = (v, f) => {
  if (!Number.isSafeInteger(v) || v === 0) throw reject(f, 'must be a non-zero whole number')
  return v as number
}
export const page = int(1, 100_000, 1)
export const pageSize = int(1, 100, 25)
export const text = (max: number, min = 0): Check<string> => (v, f) => {
  const s = typeof v === 'string' ? v.trim() : null
  if (s === null || s.length < min || s.length > max) throw reject(f, `must be text of ${min} to ${max} characters`)
  return s
}
export const q: Check<string> = (v, f) => (v === undefined ? '' : text(200)(v, f))
export const oneOf = <T extends string>(...values: T[]): Check<T> => (v, f) => {
  if (!values.includes(v as T)) throw reject(f, `must be one of ${values.join(', ')}`)
  return v as T
}
export const opt = <T>(check: Check<T>): Check<T | undefined> => (v, f) => (v === undefined ? undefined : check(v, f))
export const flag: Check<boolean> = (v, f) => {
  if (v !== undefined && typeof v !== 'boolean') throw reject(f, 'must be true or false')
  return v ?? false
}
const match = (re: RegExp, rule: string): Check<string> => (v, f) => {
  const s = typeof v === 'string' ? v.trim() : ''
  if (!re.test(s)) throw reject(f, rule)
  return s
}
const secret: Check<string> = (v, f) => { // not trimmed: spaces can be part of a password
  if (typeof v !== 'string' || v.length < 1 || v.length > 256) throw reject(f, 'must be 1 to 256 characters')
  return v
}
const filePath: Check<string> = (v, f) => {
  if (typeof v !== 'string' || !v || v.length > 4096) throw reject(f, 'must be a file path')
  return v
}
const list = <T>(check: Check<T>, min: number, max: number): Check<T[]> => (v, f) => {
  if (!Array.isArray(v) || v.length < min || v.length > max) throw reject(f, `must be a list of ${min} to ${max} items`)
  return v.map((x, i) => check(x, `${f}[${i}]`))
}
const bool: Check<boolean> = (v, f) => {
  if (typeof v !== 'boolean') throw reject(f, 'must be true or false')
  return v
}

/** A plain object with only the listed keys (absent = empty); nested fields are named by their path (filters.type). */
const fields = <S extends Record<string, Check<unknown>>>(spec: S): Check<{ [K in keyof S]: ReturnType<S[K]> }> => (v, f) => {
  const a = v ?? {}
  if (typeof a !== 'object' || Array.isArray(a)) throw f ? reject(f, 'must be an object') : fail(400, 'Arguments must be an object')
  const at = (key: string) => (f ? `${f}.${key}` : key)
  for (const key of Object.keys(a)) if (!Object.hasOwn(spec, key)) throw fail(400, `Unknown field ${at(key)}`)
  const out: Record<string, unknown> = {}
  for (const key of Object.keys(spec)) out[key] = spec[key]((a as Record<string, unknown>)[key], at(key))
  return out as { [K in keyof S]: ReturnType<S[K]> }
}
/** Method args: absent or a plain object with only the listed keys. */
export const shape = <S extends Record<string, Check<unknown>>>(spec: S) => (args: unknown) => fields(spec)(args, '')

const method = <A, R>(validate: (args: unknown) => A, run: (args: A) => R) => ({ validate, run })

const kind = oneOf('download', 'upload')
/** Extensions library.open refuses: executing a downloaded file is not a file-manager job (ARCHITECTURE > Security). */
const RUNS = new Set(['exe', 'msi', 'msp', 'mst', 'appx', 'appxbundle', 'msix', 'msixbundle', 'com', 'pif', 'scr', 'cpl',
  'bat', 'cmd', 'ps1', 'psm1', 'psd1', 'psc1', 'vbs', 'vbe', 'js', 'jse', 'wsf', 'wsh', 'ws', 'hta', 'jar', 'jnlp',
  'reg', 'rgs', 'msc', 'lnk', 'url', 'website', 'scf', 'apk', 'sh', 'run'])
const range = oneOf('24h', '7d', '30d')
const message = fields({ chatId: id, messageId: id })
const ext: Check<string> = (v, f) => match(/^[a-z0-9]{1,16}$/i, 'must be a file extension')(v, f).toLowerCase()
const durationVal: Check<string> = (v, f) => {
  if (v === 'short' || v === 'medium' || v === 'long' || v === 'xlong') return v
  if (typeof v === 'string' && /^custom:\d+:\d+$/.test(v)) return v
  throw reject(f, 'must be one of: short, medium, long, xlong')
}
const sizeVal: Check<string> = (v, f) => {
  if (v === 'small' || v === 'medium' || v === 'large' || v === 'xlarge') return v
  if (typeof v === 'string' && /^custom:\d+:\d+$/.test(v)) return v
  throw reject(f, 'must be one of: small, medium, large, xlarge')
}
const filterSpec = {
  type: opt(oneOf('video', 'photo', 'document', 'audio', 'animation')), ext: opt(ext),
  duration: opt(durationVal), size: opt(sizeVal),
  status: opt(oneOf('none', 'queued', 'active', 'paused', 'failed', 'downloaded')), q,
  sort: opt(oneOf('newest', 'oldest', 'largest', 'smallest', 'name', 'longest')),
}
/** downloads.add takes one of three forms, told apart by their keys. */
/** One {chatId, filters} pass may queue at most this many files (the {items} path allows the same ceiling): the
 *  caller narrows the filters instead of one call materialising an entire chat's history. */
const FILTER_ADD_MAX = 10_000

const downloadsArgs = (args: unknown) => {
  const keys = args && typeof args === 'object' ? Object.keys(args) : []
  const hasCustom = keys.includes('customPath')
  if (keys.includes('link')) return shape({ link: text(300, 2), ...(hasCustom ? { customPath: text(4096) } : {}) })(args)
  if (keys.includes('filters')) return shape({ chatId: id, filters: fields(filterSpec), ...(hasCustom ? { customPath: text(4096) } : {}) })(args)
  return shape({ items: list(message, 1, 10_000), force: flag, ...(hasCustom ? { customPath: text(4096) } : {}) })(args)
}
const actionArgs = (args: unknown) => {
  const a = shape({ action: oneOf('pause', 'resume', 'retry', 'cancel', 'up', 'down', 'clear-completed'), ids: opt(list(id, 1, 1000)) })(args)
  if ((a.action === 'up' || a.action === 'down') && a.ids?.length !== 1) throw reject('ids', 'must be exactly one job to move')
  return a
}
// The file types TDLib caches for media, thumbnails, and profile photos (Clear cache).
const cacheTypes = (['Photo', 'Video', 'Document', 'Audio', 'Animation', 'VoiceNote', 'VideoNote', 'Thumbnail', 'ProfilePhoto', 'Unknown'] as const)
  .map((t) => ({ _: `fileType${t}` as const }))

/** package.json repository.url → an https link, or null (the window-open handler only opens https:). */
export const repoUrl = (raw: string | undefined) => {
  const url = raw?.replace(/^git\+/, '').replace(/\.git$/, '')
  return url?.startsWith('https://') ? url : null
}

export function createMethods(ctx: Ctx) {
  const { db, tg, engine } = ctx
  const invalidate = (...topics: string[]) => ctx.emit({ type: 'invalidate', topics })
  const root = () => ctx.settings().downloadRoot
  const settings = () => ({ ...ctx.settings(), startWithSystem: ctx.native.loginItem.get() })
  const open = async (target: string) => { // shell.openPath fails for expected reasons (no app for the file type)
    const error = await ctx.native.openPath(target)
    if (error) throw fail(409, `Windows couldn't open ${path.basename(target)}: ${error}`)
  }
  const knownChat = (chatId: number) => { const c = tg.chat(chatId); if (!c) throw fail(404, 'Chat not found'); return c }
  const clearDeps = (): ClearDeps => ({
    db, paths: ctx.paths, root: root(), roots: ctx.roots, cacheSize: ctx.native.cacheSize, clearChromium: ctx.native.clearCache,
    optimize: () => tg.invoke({ _: 'optimizeStorage', size: 0, ttl: 0, count: 0, immunity_delay: 0, file_types: cacheTypes,
      chat_ids: [], exclude_chat_ids: [], return_deleted_file_statistics: false, chat_limit: 0 }),
    stopScan: tg.stopScan, cancelAll: () => { engine.action('cancel') }, logout: tg.logout, signOut: tg.reset,
    clearStorageData: ctx.native.clearStorageData, loginItemOff: () => ctx.native.loginItem.set(false),
  })
  const cleared = (chats: number[]) => invalidate('jobs', 'history', 'library', 'settings', 'storage', 'chats',
    ...chats.flatMap((c) => [`media:${c}`, `messages:${c}`]))

  return {
    'app.info': method(shape({}), () => ({
      version: ctx.version, tdlib: ctx.tdlib, installedAt: ctx.installedAt, home: ctx.paths.home,
      repository: repoUrl(ctx.repository), licenses: ctx.licenses,
    })),
    'app.clearCache': method(shape({}), async () => {
      const r = await clearCache(clearDeps())
      invalidate('storage', 'jobs', 'history', 'library') // partial progress reset, saved thumbnails gone
      return r
    }),
    'app.clearData': method(shape({}), async () => { const r = await clearAppData(clearDeps()); cleared(r.chats); return { freed: r.freed } }),
    'app.clearAll': method(shape({ deleteDownloads: bool }), async ({ deleteDownloads }) => {
      const r = await clearAll(clearDeps(), deleteDownloads)
      cleared(r.chats)
      return { freed: r.freed }
    }),
    'app.storage': method(shape({}), () => storageReport(root(), ctx.paths, ctx.native.cacheSize)),
    // The renderer's OS online/offline event: a recovered network restarts scans, queues, and the views watching them.
    'app.networkChanged': method(shape({ online: bool }), ({ online }) => {
      tg.networkChanged(online)
      if (online) {
        engine.pump()
        invalidate('chats', 'jobs', 'library', 'stats')
      }
      return { online }
    }),
    'app.pickFolder': method(shape({ title: opt(text(80)) }), async ({ title }) => ({ path: await ctx.native.pickFolder(title) })),
    'app.openPath': method(shape({ target: oneOf('downloads', 'appData', 'logs') }), async ({ target }) => {
      const dir = target === 'downloads' ? root() : target === 'appData' ? ctx.paths.home : ctx.paths.logs
      if (!(await fs.promises.stat(dir).catch(() => null))?.isDirectory()) throw fail(404, "That folder doesn't exist yet")
      await open(dir)
    }),

    'auth.get': method(shape({}), () => tg.authState()),
    // The keys go to TDLib and stay in main's memory for the session. Reaching `ready` saves them encrypted for the
    // next start (core/telegram.ts calls back); a rejection from Telegram forgets them again. Before an existing
    // session is opened, core/telegram.ts compares them with the fingerprint recorded when that session signed in:
    // a mismatch is a 409 with needsFresh, and `fresh` is that offer taken (the local session is deleted first, so
    // Telegram checks the pair for real at the code step). Settings changing the keys of a signed-in session is that
    // same check in reverse: keys differing from the running session force the fresh path, identical keys do nothing.
    'auth.credentials': method(shape({ apiId: int(1, 2_147_483_647), apiHash: match(/^[0-9a-f]{32}$/i, 'must be the 32-character hash from my.telegram.org'), fresh: flag }), async ({ fresh, ...creds }) => {
      const current = tg.credentials()
      const same = !!current && current.apiId === creds.apiId && current.apiHash.toLowerCase() === creds.apiHash.toLowerCase()
      if (!fresh && same) return tg.authState()
      await tg.start(creds, fresh || !!current)
      return tg.authState()
    }),
    /** Puts the session's own keys on disk (encrypted by main), so the next start skips the API-keys step. */
    'auth.saveKeys': method(shape({}), () => {
      const creds = tg.credentials()
      if (!creds) throw fail(409, 'Enter your API ID and hash first')
      ctx.native.keys.save(creds.apiId, creds.apiHash)
      invalidate('settings')
      return { saved: true }
    }),
    'auth.forgetKeys': method(shape({}), () => {
      ctx.native.keys.forget()
      invalidate('settings')
      return { saved: false }
    }),
    'auth.phone': method(shape({ phone: match(/^\+?[\d\s().-]{5,24}$/, 'must be a phone number with its country code') }),
      ({ phone }) => tg.sendPhone(phone.replace(/\D/g, ''))),
    'auth.code': method(shape({ code: match(/^\d{4,8}$/, 'must be the 4 to 8 digit code') }), ({ code }) => tg.sendCode(code)),
    'auth.password': method(shape({ password: secret }), ({ password }) => tg.sendPassword(password)),
    'auth.logout': method(shape({ local: opt(bool) }), async () => {
      const before = await dirSize(ctx.paths.tdlib)
      const { local } = await tg.logout()
      invalidate('settings')
      await tg.reset() // the session's in-memory keys go with it; the pair saved on disk (kept on purpose) signs back in
      const freed = Math.max(0, before - await dirSize(ctx.paths.tdlib))
      const saved = ctx.native.keys.get()
      // Straight back to the phone step with the saved keys: signing out ends the session, not the app's setup.
      if (saved) await tg.start(saved).catch((e) => log('warn', `Restarting with the saved API keys failed: ${(e as Error).message}`))
      return { freed, local }
    }),

    'account.updateProfile': method(shape({
      firstName: opt(text(64, 1)),
      lastName: opt(text(64, 0)),
      bio: opt(text(140, 0)),
      username: opt(text(32, 0)),
    }), async (args) => {
      const me = await tg.updateProfile(args)
      invalidate('auth')
      return { me }
    }),

    'chats.list': method(shape({}), () => tg.chatList()),
    'chats.open': method(shape({ link: text(300, 2), join: flag }), ({ link, join }) => tg.openChat(link, join)),
    'chats.leave': method(shape({ chatId: id }), async ({ chatId }) => {
      await tg.leaveChat(chatId)
      return { ok: true }
    }),
    'chats.delete': method(shape({ chatId: id }), async ({ chatId }) => {
      await tg.deleteChat(chatId)
      return { ok: true }
    }),
    'chats.clear': method(shape({ chatId: id }), async ({ chatId }) => {
      await tg.clearChat(chatId)
      return { ok: true }
    }),
    'chats.send': method(shape({ chatId: id, text: text(4096, 1), replyToMessageId: opt(id) }), async ({ chatId, text: msgText, replyToMessageId }) => {
      await tg.sendMessage(chatId, msgText, replyToMessageId)
      return { ok: true }
    }),
    'messages.send': method(shape({ chatId: id, text: text(4096, 1), replyToMessageId: opt(id) }), async ({ chatId, text: msgText, replyToMessageId }) => {
      await tg.sendMessage(chatId, msgText, replyToMessageId)
      return { ok: true }
    }),
    'messages.edit': method(shape({ chatId: id, messageId: id, text: text(4096, 1) }), async ({ chatId, messageId, text: msgText }) => {
      await tg.editMessage(chatId, messageId, msgText)
      return { ok: true }
    }),
    'messages.delete': method(shape({ chatId: id, messageIds: list(id, 1, 100), revoke: opt(bool) }), async ({ chatId, messageIds, revoke }) => {
      await tg.deleteMessages(chatId, messageIds, revoke ?? true)
      return { ok: true }
    }),
    'messages.pin': method(shape({ chatId: id, messageId: id, unpin: opt(bool) }), async ({ chatId, messageId, unpin }) => {
      await tg.pinChatMessage(chatId, messageId, unpin ?? false)
      return { ok: true }
    }),
    'messages.forward': method(shape({ fromChatId: id, toChatId: id, messageIds: list(id, 1, 100), sendCopy: opt(bool) }), async ({ fromChatId, toChatId, messageIds, sendCopy }) => {
      await tg.forwardMessages(fromChatId, toChatId, messageIds, sendCopy ?? false)
      return { ok: true }
    }),
    'messages.react': method(shape({ chatId: id, messageId: id, reaction: text(32, 1), remove: opt(bool) }), async ({ chatId, messageId, reaction, remove }) => {
      await tg.reactMessage(chatId, messageId, reaction, remove ?? false)
      return { ok: true }
    }),
    'messages.read': method(shape({ chatId: id, messageIds: list(id, 1, 100) }), async ({ chatId, messageIds }) => {
      await tg.markMessagesRead(chatId, messageIds)
      return { ok: true }
    }),
    'messages.search': method(shape({ chatId: id, query: text(100, 1), fromMessageId: opt(id), limit: int(1, 100, 50) }), async ({ chatId, query, fromMessageId, limit }) => {
      return tg.searchMessages(chatId, query, fromMessageId ?? 0, limit)
    }),
    'chats.sendTyping': method(shape({ chatId: id, action: opt(text(30)) }), async ({ chatId, action }) => {
      await tg.sendChatAction(chatId, action ?? 'typing')
      return { ok: true }
    }),
    'chats.messages': method(shape({ chatId: id, limit: int(1, 1000, 30), fromMessageId: opt(id) }), async ({ chatId, limit, fromMessageId }) => {
      const r = await tg.messages(chatId, limit, fromMessageId ?? 0)
      const states = downloadStates(db, chatId, r.messages.filter((m) => m.media).map((m) => m.id))
      return {
        more: r.more,
        messages: r.messages.map((m) => {
          if (!m.media) return { ...m, media: null }
          const state = states.get(m.id)!
          const cachedPath = (m.media.file.local.is_downloading_completed && m.media.file.local.path) ? m.media.file.local.path : null
          return {
            ...m,
            media: {
              ...mediaRow(chatId, m, m.media),
              ...state,
              path: state.path || cachedPath,
            } satisfies MediaItem,
          }
        }),
      }
    }),
    'media.prepare': method(shape({ chatId: id, messageId: id }), ({ chatId, messageId }) => tg.prepareMedia(chatId, messageId)),
    'chats.typing': method(shape({ chatId: opt(id) }), ({ chatId }) => chatId ? { text: tg.getChatAction(chatId) } : tg.getAllChatActions()),
    'chats.media': method(shape({ chatId: id, ...filterSpec, page, pageSize }), ({ chatId, page, pageSize, ...filters }) => {
      knownChat(chatId)
      tg.ensureScan(chatId)
      return { ...mediaQuery(db, chatId, filters, { page, pageSize }), exts: mediaExts(db, chatId), scan: tg.scanInfo(chatId) }
    }),
    /** The index bar's Retry and Resume: forget why this chat stopped or failed and start the scan again. */
    'chats.rescan': method(shape({ chatId: id }), ({ chatId }) => {
      knownChat(chatId)
      tg.retryScan(chatId)
      return tg.scanInfo(chatId)
    }),
    /** The index bar's Stop: the scan ends after its page and picks up from its saved cursors later. */
    'chats.stopScan': method(shape({ chatId: id }), ({ chatId }) => {
      knownChat(chatId)
      return tg.holdScan(chatId)
    }),

    'downloads.add': method(downloadsArgs, async (a) => {
      if ('link' in a) {
        const { chatId, messages } = await tg.linkMessages(a.link)
        return engine.addDownloads(chatId, messages.map((m) => mediaRow(chatId, m, extractMedia(m)!)))
      }
      if ('filters' in a) {
        const chatId = knownChat(a.chatId).id
        // One pass can queue a whole chat's history: count first and refuse a batch this size instead of building it
        // in memory (ARCHITECTURE > Methods notes > downloads.add).
        const { total } = mediaQuery(db, a.chatId, a.filters, { page: 1, pageSize: 1 })
        if (total > FILTER_ADD_MAX) throw fail(400, `That's ${total.toLocaleString('en-US')} files. Narrow the filters and add them in batches of ${FILTER_ADD_MAX.toLocaleString('en-US')}.`)
        return engine.addDownloads(chatId, mediaQuery(db, a.chatId, a.filters).items)
      }
      return engine.addItems(a.items, a.force)
    }),
    'downloads.checkDuplicates': method(downloadsArgs, async (a) => engine.checkDuplicates(a)),
    'uploads.add': method(shape({ chatId: id, paths: list(filePath, 1, 500), caption: text(4096), album: bool, keepNames: bool }), async (a) => {
      const auth = tg.authState()
      if (auth.step !== 'ready') throw fail(503, 'Telegram is not connected yet')
      const chat = knownChat(a.chatId)
      if (!chat.canPost) throw fail(403, "You can't post in this chat")
      if (a.caption.length > auth.me.captionMax) throw fail(400, `caption must be at most ${auth.me.captionMax} characters`)
      // Upload sources are only ever read; each must be an existing regular file within Telegram's size limit. The
      // provenance check comes first: a renderer can name any path, so an upload may only read paths the user handed
      // to the app through the file dialog or a drag-drop (ARCHITECTURE > Security > Renderer compromise).
      const files = await Promise.all(a.paths.map(async (p, i) => {
        if (!path.isAbsolute(p) || path.parse(p).root.length < 3) throw reject(`paths[${i}]`, 'must be a full file path')
        if (!ctx.native.grants.has(p)) throw fail(403, `${path.basename(p)} isn't a file you chose for this upload. Pick it again with Choose files or drag it onto the window.`)
        const name = path.basename(p)
        const st = await fs.promises.stat(p).catch(() => null)
        if (!st?.isFile()) throw fail(400, `${name} is missing or isn't a file`)
        if (st.size < 1) throw fail(400, `${name} is empty`)
        if (st.size > auth.me.uploadMax) throw fail(413, `${name} is larger than Telegram allows for this account`)
        return { path: path.resolve(p), name, size: st.size }
      }))
      const allow = tg.mediaRights(chat.id) ?? { photos: false, videos: false }
      return engine.addUploads(chat, files, { caption: a.caption, album: a.album, keepNames: a.keepNames, photos: allow.photos, videos: allow.videos })
    }),
    'jobs.list': method(shape({ kind: opt(kind), status: opt(oneOf('open', 'queued', 'active', 'paused', 'completed', 'failed')), q, page, pageSize }),
      (a) => jobsList(db, a, tg.chat)),
    'jobs.action': method(actionArgs, ({ action, ids }) => engine.action(action, ids)),

    'stats.live': method(shape({}), () => engine.liveStats()),
    'stats.overview': method(shape({}), () => statsOverview(db, ctx.paths.thumbs)),
    'stats.activity': method(shape({ range }), ({ range }) => statsActivity(db, range)),
    'stats.chats': method(shape({ range }), ({ range }) => statsChats(db, range, tg.chat)),
    'search.global': method(shape({ q: text(300, 1) }), async ({ q }) => {
      const needle = q.toLowerCase()
      let chats: Chat[] = []
      try {
        chats = tg.chatList().chats.filter((c) => c.title.toLowerCase().includes(needle) || !!c.username?.toLowerCase().includes(needle)).slice(0, 5)
      } catch (e) { if ((e as AppError).status !== 503) throw e } // signed out: no chats, files and links still answer
      const files = libraryItems(db, libraryCached(root()).filter((e) => e.name.toLowerCase().includes(needle)).slice(0, 5))
        .map((x) => withPreview(x, ctx.paths.thumbs))
      const link = isTelegramLink(q) ? await tg.linkType(q).then(linkKind, () => null) : null
      return { chats, files, link }
    }),

    'library.list': method(shape({
      q, type: opt(oneOf('video', 'image', 'audio', 'document', 'archive')), chat: opt(text(200)),
      sort: opt(oneOf('newest', 'oldest', 'largest', 'smallest', 'name')), page, pageSize,
    }), (a) => libraryList(db, { root: root(), thumbs: ctx.paths.thumbs }, a)),
    'library.missing': method(shape({}), async () => ({ items: await libraryMissing(db, await library(root()), ctx.paths.thumbs) })),
    'library.open': method(shape({ path: filePath }), async (a) => {
      const file = await libraryFile(db, root(), a.path)
      const ext = path.extname(file).slice(1).toLowerCase()
      // Opening a downloaded program is running it, and the library has no reason to do that on the user's behalf.
      if (RUNS.has(ext)) throw fail(400, `Mediagram won't open ${path.basename(file)}: it can run a program or a script. Use Reveal to open its folder instead.`)
      return open(file)
    }),
    'library.reveal': method(shape({ path: filePath }), async (a) => { ctx.native.reveal(await libraryFile(db, root(), a.path)) }),
    'library.trash': method(shape({ paths: list(filePath, 1, 1000) }), async ({ paths }) => {
      const r = await trash(db, root(), paths, ctx.native.trashItem)
      if (r.trashed) invalidate('library', 'history', 'jobs', ...r.chats.flatMap((c) => [`media:${c}`, `messages:${c}`]))
      if (r.failed) throw fail(409, `Couldn't move ${r.failed} to the Recycle Bin. Close any app using it and try again.`)
      return { trashed: r.trashed, freed: r.freed }
    }),

    // apiHashSaved is a flag only: the stored value itself never leaves main (ARCHITECTURE > IPC contract).
    'settings.get': method(shape({}), () => ({ ...settings(), apiHashSaved: readSetting(db, 'apiHash') !== undefined })),
    // Every key is validated (incl. the download root rules and canPost) before anything is written.
    'settings.set': method(checkSettings, async (patch) => {
      const before = ctx.settings()
      const next = { ...patch }
      if (next.downloadRoot !== undefined) {
        // Provenance: the renderer may only move the root to a folder the user chose in the Browse dialog (or keep
        // the one already in use), so a forged call cannot point the library, its reads, or Clear All at any folder.
        if (next.downloadRoot !== before.downloadRoot && !ctx.native.picks.has(next.downloadRoot)) {
          throw fail(400, 'downloadRoot must be a folder you picked in the Browse dialog')
        }
        next.downloadRoot = checkDownloadRoot(next.downloadRoot, ctx.roots)
        checkDownloadRoot(await realLocation(next.downloadRoot), ctx.roots) // the stored path stays the one picked
      }
      if (next.defaultUploadChat != null && !tg.chat(next.defaultUploadChat)?.canPost) throw fail(400, 'defaultUploadChat must be a chat you can post to')
      if (next.downloadRoot !== undefined) {
        await fs.promises.mkdir(next.downloadRoot, { recursive: true }).catch(() => { throw fail(400, "Mediagram couldn't create that folder. Pick another one.") })
      }
      setSettings(db, next)
      engine.pump() // concurrency limits may have changed
      if (next.startWithSystem !== undefined) ctx.native.loginItem.set(next.startWithSystem)
      const topics = ['settings']
      if (next.downloadRoot !== undefined && next.downloadRoot.toLowerCase() !== before.downloadRoot.toLowerCase()) topics.push('library', 'storage')
      if (next.showArchived !== undefined && next.showArchived !== before.showArchived) {
        topics.push('chats')
        if (next.showArchived && tg.authState().step === 'ready') void tg.loadLists()
      }
      invalidate(...topics)
      return settings()
    }),
  }
}
export type Methods = ReturnType<typeof createMethods>

/** mediagram:// or teleflow:// URL → local file, or null for a 404 (ARCHITECTURE > mediagram:// protocol). */
export async function protocolFile(url: string, ctx: Pick<Ctx, 'tg' | 'paths' | 'settings' | 'db'>): Promise<string | null> {
  const u = new URL(url)
  const arg = decodeURIComponent(u.pathname.slice(1))
  const isFile = async (f: string) => !!(await fs.promises.stat(f).catch(() => null))?.isFile()
  if (u.host === 'thumb') return /^[\w-]{10,200}$/.test(arg) ? ctx.tg.thumbFile(arg) : null
  if (u.host === 'saved') {
    const file = path.join(ctx.paths.thumbs, `${arg}.jpg`)
    return /^[1-9]\d{0,15}$/.test(arg) && await isFile(file) ? file : null
  }
  if (u.host === 'image' && libType(arg) === 'image') {
    const root = ctx.settings().downloadRoot
    const [real, realRoot] = await Promise.all([path.resolve(root, arg), root].map((p) => fs.promises.realpath(p).catch(() => null)))
    return real && realRoot && real !== realRoot && within(realRoot, real) && await isFile(real) ? real : null
  }
  if (u.host === 'file' || u.host === 'media') {
    // 1. TDLib cache/downloads directory: allow direct instant playback
    const tdFiles = path.join(ctx.paths.tdlib, 'files')
    const resolved = path.resolve(arg)
    if (within(tdFiles, resolved) && await isFile(resolved)) return resolved

    // 2. Playback URLs carry absolute paths, so they go through the library rule: an existing file inside the root
    // after realpath, or a recorded download. A forged URL names nothing outside those two (ARCHITECTURE > Security).
    try { return await libraryFile(ctx.db, ctx.settings().downloadRoot, arg) } catch { return null }
  }
  return null
}

export type Envelope = { ok: true, data: unknown } | { ok: false, status: number, error: string, retryAfter?: number }
type AnyMethod = { validate(args: unknown): unknown, run(args: unknown): unknown }

/** True when a message came from the renderer page itself (ARCHITECTURE > IPC contract): a sibling frame or another
 *  local page is rejected, because file: origins are all "null" and cannot be compared. */
export function fromRenderer(rendererKey: string, senderUrl: string | null): boolean {
  let key: string | null = null
  try { key = senderUrl === null ? null : pageKey(senderUrl) } catch {} // unparsable or encoded-slash URL → reject
  return key === rendererKey
}

/** Bridge steps 1–4: sender check, own-property lookup, validation, error envelope. */
export async function handleCall(methods: Record<string, AnyMethod>, rendererKey: string, senderUrl: string | null, req: unknown): Promise<Envelope> {
  if (!fromRenderer(rendererKey, senderUrl)) {
    log('warn', `Not allowed: IPC call from ${senderUrl ?? 'an unknown frame'}`)
    return { ok: false, status: 403, error: 'Not allowed' }
  }
  const { method: name, args } = (req ?? {}) as { method?: unknown, args?: unknown }
  if (typeof name !== 'string' || !Object.hasOwn(methods, name)) return { ok: false, status: 404, error: 'Unknown method' }
  try {
    const m = methods[name]
    return { ok: true, data: await m.run(m.validate(args)) }
  } catch (e) {
    const err = e as Partial<AppError>
    if (typeof err.status === 'number' && err.status !== 500) {
      return { ok: false, status: err.status, error: String(err.message), ...(err.retryAfter !== undefined && { retryAfter: err.retryAfter }) }
    }
    log('error', `${name} failed: ${err.stack ?? String(e)}`)
    return { ok: false, status: 500, error: 'Something went wrong. Details are in the log.' }
  }
}
