import { useEffect, useState, useCallback, useSyncExternalStore } from 'react'
import type { Envelope } from '../../electron/ipc.ts'
import type { Bridge } from '../../electron/preload.ts'
import type { AuthState } from '../../core/shapes.ts'
import type { AppEvent } from '../../core/db.ts'
import type { LiveStats } from '../../core/transfers.ts'

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

  const reload = useCallback(() => {
    setError('')
    setTick((t) => t + 1)
  }, [])

  useEffect(() => {
    if (args === null) {
      setData(undefined)
      setLoading(false)
      return
    }
    let active = true
    call<T>(method, args)
      .then((d) => {
        if (active) {
          setData(d)
          setLoading(false)
        }
      })
      .catch((e: Error) => {
        if (active) {
          setError(e.message)
          setLoading(false)
        }
      })
    return () => { active = false }
  }, [method, JSON.stringify(args), tick])

  useEffect(() => {
    if (topics.length === 0) return
    let timer: NodeJS.Timeout | undefined
    const unsub = on((event) => {
      const match =
        (event.type === 'invalidate' && event.topics.some((t) => topics.includes(t))) ||
        (event.type === 'auth' && topics.includes('auth')) ||
        (event.type === 'stats' && topics.includes('stats'))
      if (match) {
        clearTimeout(timer)
        timer = setTimeout(() => {
          reload()
        }, 300)
      }
    })
    return () => {
      clearTimeout(timer)
      unsub()
    }
  }, [topics.join(','), reload])

  return { data, error, loading, reload }
}

export type LiveState = { auth: AuthState | null, activeCount: number, stats: LiveStats | null }

let liveSnapshot: LiveState = { auth: null, activeCount: 0, stats: null }
const liveListeners = new Set<() => void>()
let eventListenerInitialized = false

function initEventListener() {
  if (eventListenerInitialized || typeof window === 'undefined' || !window.teleflow?.on) return
  eventListenerInitialized = true

  window.teleflow.on((event: unknown) => {
    const e = event as AppEvent
    let changed = false
    if (e.type === 'auth') {
      if (liveSnapshot.auth !== e.auth) {
        liveSnapshot = { ...liveSnapshot, auth: e.auth }
        changed = true
      }
    } else if (e.type === 'stats') {
      const counts = e.stats.counts
      const activeCount =
        (counts.download.queued + counts.download.active + counts.download.paused) +
        (counts.upload.queued + counts.upload.active + counts.upload.paused)
      liveSnapshot = { ...liveSnapshot, activeCount, stats: e.stats }
      changed = true
    }
    if (changed) {
      liveListeners.forEach((l) => l())
    }
  })

  // Populate first snapshot from auth.get and stats.live
  call<AuthState>('auth.get').then((auth) => {
    if (liveSnapshot.auth !== auth) {
      liveSnapshot = { ...liveSnapshot, auth }
      liveListeners.forEach((l) => l())
    }
  }).catch(() => {})

  call<LiveStats>('stats.live').then((stats) => {
    const counts = stats.counts
    const activeCount =
      (counts.download.queued + counts.download.active + counts.download.paused) +
      (counts.upload.queued + counts.upload.active + counts.upload.paused)
    liveSnapshot = { ...liveSnapshot, activeCount, stats }
    liveListeners.forEach((l) => l())
  }).catch(() => {})
}

/** Subscribe to app events. */
export function on(cb: (event: AppEvent) => void): () => void {
  initEventListener()
  return window.teleflow.on((event: unknown) => cb(event as AppEvent))
}

/** Hook for live auth and active transfer count. */
export function useLive(): LiveState {
  initEventListener()
  return useSyncExternalStore(
    (cb) => {
      liveListeners.add(cb)
      return () => { liveListeners.delete(cb) }
    },
    () => liveSnapshot
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
