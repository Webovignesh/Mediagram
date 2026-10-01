// The IPC API (ARCHITECTURE > IPC contract). Imports no `electron`: main passes native calls in through ctx,
// so node:test can load this file.
import { fail, type AppError } from '../core/db.ts'
import { log, pageKey } from '../core/storage.ts'
import type { AuthState } from '../core/telegram.ts'

export type License = { name: string, version: string, license: string }
export type Ctx = {
  version: string, tdlib: string, installedAt: number | null, home: string,
  repository: string | undefined /* package.json repository.url */, licenses: License[],
  auth: () => AuthState,
}

// Common validators: each failure is a 400 naming the field.
type Check<T> = (value: unknown, field: string) => T
const reject = (field: string, rule: string) => fail(400, `${field} ${rule}`)
const int = (min: number, max: number, fallback?: number): Check<number> => (v, f) => {
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

export function createMethods(ctx: Ctx) {
  return {
    'app.info': method(shape({}), () => ({
      version: ctx.version, tdlib: ctx.tdlib, installedAt: ctx.installedAt, home: ctx.home,
      repository: repoUrl(ctx.repository), licenses: ctx.licenses,
    })),
    'auth.get': method(shape({}), () => ctx.auth()),
  }
}
export type Methods = ReturnType<typeof createMethods>

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
