import { useEffect, useState, useSyncExternalStore } from 'react'
import type { Envelope } from '../../electron/ipc.ts'
import type { Bridge } from '../../electron/preload.ts'
import type { AuthState } from '../../core/shapes.ts'
import type { AppEvent } from '../../core/db.ts'

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

/** Hook that calls a method once on mount and refetches when the specified topics are invalidated. */
export function useCall<T>(
  method: string,
  args?: unknown,
  topics: string[] = []
): { data: T | undefined, error: string, loading: boolean, reload: () => void } {
  const [data, setData] = useState<T>()
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [tick, setTick] = useState(0)

  const reload = () => {
    setError('')
    setLoading(true)
    setTick((t) => t + 1)
  }

  useEffect(() => {
    let active = true
    call<T>(method, args)
      .then((d) => active && setData(d))
      .catch((e: Error) => active && setError(e.message))
      .finally(() => active && setLoading(false))
    return () => { active = false }
  }, [method, JSON.stringify(args), tick])

  useEffect(() => {
    if (topics.length === 0) return
    const unsub = on((event) => {
      if (event.type === 'invalidate' && event.topics.some((t) => topics.includes(t))) {
        reload()
      }
    })
    return unsub
  }, [topics.join(',')])

  return { data, error, loading, reload }
}

type LiveState = { auth: AuthState | null, activeCount: number }
const liveStore = { auth: null as AuthState | null, activeCount: 0, listeners: new Set<() => void>() }

/** Subscribe to app events. */
export function on(cb: (event: AppEvent) => void): () => void {
  const handler = (event: unknown) => {
    const e = event as AppEvent
    if (e.type === 'auth') {
      liveStore.auth = e.auth
      liveStore.listeners.forEach((l) => l())
    } else if (e.type === 'stats') {
      const counts = e.stats.counts
      liveStore.activeCount = (counts.download.queued + counts.download.active + counts.download.paused) +
        (counts.upload.queued + counts.upload.active + counts.upload.paused)
      liveStore.listeners.forEach((l) => l())
    }
    cb(e)
  }
  return window.teleflow.on(handler)
}

/** Hook for live auth and active transfer count. */
export function useLive(): LiveState {
  return useSyncExternalStore(
    (cb) => { liveStore.listeners.add(cb); return () => liveStore.listeners.delete(cb) },
    () => ({ auth: liveStore.auth, activeCount: liveStore.activeCount })
  )
}

/** Hook for hash-based routing. */
export function useRoute(): string {
  const [route, setRoute] = useState(() => window.location.hash.slice(1) || '/overview')
  useEffect(() => {
    const handler = () => setRoute(window.location.hash.slice(1) || '/overview')
    window.addEventListener('hashchange', handler)
    return () => window.removeEventListener('hashchange', handler)
  }, [])
  return route
}

/** Navigate to a route. */
export function navigate(path: string) {
  window.location.hash = path
}
