import { useEffect, useState, useCallback, useRef, useSyncExternalStore } from 'react'
import type { Envelope } from '../../electron/ipc.ts'
import type { Bridge } from '../../electron/preload.ts'
import type { AuthState } from '../../core/shapes.ts'
import type { AppEvent } from '../../core/db.ts'
import type { LiveStats } from '../../core/transfers.ts'
import { addNotification, isChatMuted } from './notifications.ts'

declare global {
  interface Window { mediagram?: Bridge; teleflow: Bridge }
}

export const getBridge = (): Bridge =>
  (typeof window !== 'undefined' ? (window.mediagram || window.teleflow) : undefined) as Bridge

export type CallError = Error & { status: number, retryAfter?: number }

/** Calls a main-process method; a failure throws an Error carrying `status` and the user-facing message. */
export async function call<T>(method: string, args?: unknown): Promise<T> {
  const bridge = getBridge()
  const res = await bridge.call(method, args) as Envelope
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

  const errorRef = useRef(error)
  const loadingRef = useRef(loading)
  const pendingSince = useRef(0)
  errorRef.current = error
  loadingRef.current = loading

  useEffect(() => {
    if (args === null) {
      setData(undefined)
      setLoading(false)
      return
    }
    let active = true
    pendingSince.current = Date.now()
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

  // An outage can fail a call or leave it queued behind TDLib's dead sockets; both come back when the OS reports the
  // network again or TDLib re-enters ready, so a failed or hanging call (over 2 s) fetches once now and once more
  // a few seconds later, when TDLib has had time to reconnect on its own.
  useEffect(() => {
    if (args === null) return
    let delayed: NodeJS.Timeout | undefined
    const hung = () => !!errorRef.current || (loadingRef.current && Date.now() - pendingSince.current > 2000)
    const recover = () => {
      if (hung()) reload()
      clearTimeout(delayed)
      delayed = setTimeout(() => { if (hung()) reload() }, 5000)
    }
    window.addEventListener('online', recover)
    const unsub = on((event) => {
      if (event.type === 'auth' && event.auth.connection === 'ready') recover()
    })
    return () => {
      window.removeEventListener('online', recover)
      clearTimeout(delayed)
      unsub()
    }
  }, [JSON.stringify(args), reload])

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
        const isMsg = event.type === 'invalidate' && event.topics.some((t) => t.startsWith('messages:'))
        timer = setTimeout(() => {
          reload()
        }, isMsg ? 30 : 200)
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
  const bridge = getBridge()
  if (eventListenerInitialized || !bridge?.on) return
  eventListenerInitialized = true

  bridge.on((event: unknown) => {
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
    } else if (e.type === 'typing') {
      const existing = typingTimers.get(e.chatId)
      if (existing) {
        clearTimeout(existing)
        typingTimers.delete(e.chatId)
      }
      if (e.text) {
        typingSnapshot = { ...typingSnapshot, [e.chatId]: e.text }
        const timer = setTimeout(() => {
          const next = { ...typingSnapshot }
          delete next[e.chatId]
          typingSnapshot = next
          typingTimers.delete(e.chatId)
          notifyTyping()
        }, 5000)
        typingTimers.set(e.chatId, timer)
      } else {
        const next = { ...typingSnapshot }
        delete next[e.chatId]
        typingSnapshot = next
      }
      notifyTyping()
    } else if (e.type === 'notification') {
      if (!e.chatId || !isChatMuted(e.chatId)) {
        addNotification({
          title: e.title,
          body: e.body,
          type: e.kind,
          chatId: e.chatId,
          messageId: e.messageId,
        })
      }
    }
    if (changed) {
      liveListeners.forEach((l) => l())
    }
  })

  // Populate first snapshot from auth.get, stats.live, and chats.typing
  call<Record<number, string>>('chats.typing').then((map) => {
    if (map && Object.keys(map).length > 0) {
      typingSnapshot = { ...typingSnapshot, ...map }
      notifyTyping()
    }
  }).catch(() => {})

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

let typingSnapshot: Record<number, string> = {}
const typingListeners = new Set<() => void>()
const typingTimers = new Map<number, NodeJS.Timeout>()

function notifyTyping() {
  typingListeners.forEach((l) => l())
}

/** Subscribe to app events. */
export function on(cb: (event: AppEvent) => void): () => void {
  initEventListener()
  const bridge = getBridge()
  return bridge?.on ? bridge.on((event: unknown) => cb(event as AppEvent)) : () => {}
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

/** Hook for real-time typing and media sending indicators across chats. */
export function useTyping(): Record<number, string> {
  initEventListener()
  return useSyncExternalStore(
    (cb) => {
      typingListeners.add(cb)
      return () => { typingListeners.delete(cb) }
    },
    () => typingSnapshot
  )
}

/** Hook for real-time typing indicator of a specific chat. */
export function useChatTyping(chatId?: number | null): string | null {
  const typing = useTyping()
  return chatId ? typing[chatId] ?? null : null
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
