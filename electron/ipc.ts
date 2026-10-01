// The IPC API and the teleflow:// resolver (ARCHITECTURE > IPC contract). Imports no `electron`: main passes native
// calls in through ctx, so node:test can load this file.
import fs from 'node:fs'
import path from 'node:path'
import { type AppError, checkSettings, type DB, type DownloadState, downloadStates, type Emit, fail, type MediaItem, putSetting, setSettings, type StoredSettings } from '../core/db.ts'
import {
  checkDownloadRoot, dirSize, library, libraryCached, libraryFile, libraryItems, libraryList, libraryMissing, libType, log,
  pageKey, type Paths, realLocation, type RootLists, storageReport, trash, within, withPreview,
} from '../core/storage.ts'
import type * as telegram from '../core/telegram.ts'
import { type Chat, isTelegramLink, linkKind, type Media, type Message } from '../core/shapes.ts'

export type License = { name: string, version: string, license: string }
/** Electron calls, passed in by main. */
export type Native = {
  pickFolder(title?: string): Promise<string | null>
  openPath(target: string): Promise<string> // '' on success, else the error (shell.openPath)
  reveal(file: string): void
  trashItem(file: string): Promise<void>
  loginItem: { get(): boolean, set(on: boolean): void }
  cacheSize(): Promise<number>
}
export type Ctx = {
  version: string, tdlib: string, installedAt: number | null,
  repository: string | undefined /* package.json repository.url */, licenses: License[],
  paths: Paths, db: DB, settings: () => StoredSettings, roots: RootLists, emit: Emit, tg: typeof telegram, native: Native,
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

/** Args must be absent or a plain object with only the listed keys. */
export const shape = <S extends Record<string, Check<unknown>>>(spec: S) => (args: unknown) => {
  const a = args ?? {}
  if (typeof a !== 'object' || Array.isArray(a)) throw fail(400, 'Arguments must be an object')
  for (const key of Object.keys(a)) if (!Object.hasOwn(spec, key)) throw fail(400, `Unknown field ${key}`)
  const out: Record<string, unknown> = {}
  for (const key of Object.keys(spec)) out[key] = spec[key]((a as Record<string, unknown>)[key], key)
  return out as { [K in keyof S]: ReturnType<S[K]> }
}

const method = <A, R>(validate: (args: unknown) => A, run: (args: A) => R) => ({ validate, run })

/** package.json repository.url → an https link, or null (the window-open handler only opens https:). */
export const repoUrl = (raw: string | undefined) => {
  const url = raw?.replace(/^git\+/, '').replace(/\.git$/, '')
  return url?.startsWith('https://') ? url : null
}

const mediaItem = (chatId: number, m: Message, x: Media, s: DownloadState): MediaItem => ({
  chatId, messageId: m.id, date: m.date, type: x.type, name: x.name, ext: x.ext, size: x.size,
  duration: x.duration, caption: x.caption, thumb: x.thumb, ...s,
})

export function createMethods(ctx: Ctx) {
  const { db, tg } = ctx
  const invalidate = (...topics: string[]) => ctx.emit({ type: 'invalidate', topics })
  const root = () => ctx.settings().downloadRoot
  const settings = () => ({ ...ctx.settings(), startWithSystem: ctx.native.loginItem.get() })
  const open = async (target: string) => { // shell.openPath fails for expected reasons (no app for the file type)
    const error = await ctx.native.openPath(target)
    if (error) throw fail(409, `Windows couldn't open ${path.basename(target)}: ${error}`)
  }

  return {
    'app.info': method(shape({}), () => ({
      version: ctx.version, tdlib: ctx.tdlib, installedAt: ctx.installedAt, home: ctx.paths.home,
      repository: repoUrl(ctx.repository), licenses: ctx.licenses,
    })),
    'app.storage': method(shape({}), () => storageReport(root(), ctx.paths, ctx.native.cacheSize)),
    'app.pickFolder': method(shape({ title: opt(text(80)) }), async ({ title }) => ({ path: await ctx.native.pickFolder(title) })),
    'app.openPath': method(shape({ target: oneOf('downloads', 'appData', 'logs') }), async ({ target }) => {
      const dir = target === 'downloads' ? root() : target === 'appData' ? ctx.paths.home : ctx.paths.logs
      if (!(await fs.promises.stat(dir).catch(() => null))?.isDirectory()) throw fail(404, "That folder doesn't exist yet")
      await open(dir)
    }),

    'auth.get': method(shape({}), () => tg.authState()),
    'auth.credentials': method(shape({ apiId: int(1, 2_147_483_647), apiHash: match(/^[0-9a-f]{32}$/i, 'must be the 32-character hash from my.telegram.org') }), async (creds) => {
      putSetting(db, 'apiId', creds.apiId)
      putSetting(db, 'apiHash', creds.apiHash)
      await tg.start(creds)
      return tg.authState()
    }),
    'auth.phone': method(shape({ phone: match(/^\+?[\d\s().-]{5,24}$/, 'must be a phone number with its country code') }),
      ({ phone }) => tg.sendPhone(phone.replace(/\D/g, ''))),
    'auth.code': method(shape({ code: match(/^\d{4,8}$/, 'must be the 4 to 8 digit code') }), ({ code }) => tg.sendCode(code)),
    'auth.password': method(shape({ password: secret }), ({ password }) => tg.sendPassword(password)),
    'auth.logout': method(shape({}), async () => {
      const before = await dirSize(ctx.paths.tdlib)
      const { local } = await tg.logout()
      return { freed: Math.max(0, before - await dirSize(ctx.paths.tdlib)), local }
    }),

    'chats.list': method(shape({}), () => tg.chatList()),
    'chats.open': method(shape({ link: text(300, 2), join: flag }), ({ link, join }) => tg.openChat(link, join)),
    'chats.messages': method(shape({ chatId: id, limit: int(1, 1000, 30) }), async ({ chatId, limit }) => {
      const r = await tg.messages(chatId, limit)
      const states = downloadStates(db, chatId, r.messages.filter((m) => m.media).map((m) => m.id))
      return { more: r.more, messages: r.messages.map((m) => ({ ...m, media: m.media && mediaItem(chatId, m, m.media, states.get(m.id)!) })) }
    }),
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
    'library.open': method(shape({ path: filePath }), async (a) => open(await libraryFile(db, root(), a.path))),
    'library.reveal': method(shape({ path: filePath }), async (a) => { ctx.native.reveal(await libraryFile(db, root(), a.path)) }),
    'library.trash': method(shape({ paths: list(filePath, 1, 1000) }), async ({ paths }) => {
      const r = await trash(db, root(), paths, ctx.native.trashItem)
      if (r.trashed) invalidate('library', 'history', 'jobs', ...r.chats.flatMap((c) => [`media:${c}`, `messages:${c}`]))
      if (r.failed) throw fail(409, `Couldn't move ${r.failed} to the Recycle Bin. Close any app using it and try again.`)
      return { trashed: r.trashed, freed: r.freed }
    }),

    'settings.get': method(shape({}), settings),
    // Every key is validated (incl. the download root rules and canPost) before anything is written.
    'settings.set': method(checkSettings, async (patch) => {
      const before = ctx.settings()
      const next = { ...patch }
      if (next.downloadRoot !== undefined) {
        next.downloadRoot = checkDownloadRoot(next.downloadRoot, ctx.roots)
        checkDownloadRoot(await realLocation(next.downloadRoot), ctx.roots) // the stored path stays the one picked
      }
      if (next.defaultUploadChat != null && !tg.chat(next.defaultUploadChat)?.canPost) throw fail(400, 'defaultUploadChat must be a chat you can post to')
      if (next.downloadRoot !== undefined) {
        await fs.promises.mkdir(next.downloadRoot, { recursive: true }).catch(() => { throw fail(400, "TeleFlow couldn't create that folder. Pick another one.") })
      }
      setSettings(db, next)
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

/** teleflow:// URL → local file, or null for a 404 (ARCHITECTURE > teleflow:// protocol). */
export async function protocolFile(url: string, ctx: Pick<Ctx, 'tg' | 'paths' | 'settings'>): Promise<string | null> {
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
  return null
}

export type Envelope = { ok: true, data: unknown } | { ok: false, status: number, error: string, retryAfter?: number }
type AnyMethod = { validate(args: unknown): unknown, run(args: unknown): unknown }

/** Bridge steps 1–4: sender check, own-property lookup, validation, error envelope. */
export async function handleCall(methods: Record<string, AnyMethod>, rendererKey: string, senderUrl: string | null, req: unknown): Promise<Envelope> {
  let key: string | null = null
  try { key = senderUrl === null ? null : pageKey(senderUrl) } catch {} // unparsable or encoded-slash URL → reject
  if (key !== rendererKey) {
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
