import type { Envelope } from '../../electron/ipc.ts'
import type { Bridge } from '../../electron/preload.ts'

declare global {
  interface Window { teleflow: Bridge }
}

export type CallError = Error & { status: number, retryAfter?: number }

/** Calls a main-process method; a failure throws an Error carrying `status` and the user-facing message. */
export async function call<T>(method: string, args?: unknown): Promise<T> {
  const res = await window.teleflow.call(method, args) as Envelope
  if (!res.ok) throw Object.assign(new Error(res.error), { status: res.status, retryAfter: res.retryAfter }) as CallError
  return res.data as T
}
