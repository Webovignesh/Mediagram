import { useState, useRef, useEffect } from 'react'
import { Home, Download, Upload, ListOrdered, Settings as SettingsIcon, ChevronDown, LogOut, PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import { call, useCall, useLive, useRoute, navigate } from './api.ts'
import { Empty, ErrorState, Badge, Avatar, toast, confirm, MediagramLogo } from './ui.tsx'
import type { AuthState, Me } from '../../core/shapes.ts'
import Login from './pages/Login.tsx'
import Overview from './pages/Overview.tsx'
import Downloads from './pages/Downloads.tsx'
import Uploads from './pages/Uploads.tsx'
import Queue from './pages/Queue.tsx'
import Settings from './pages/Settings.tsx'

// Native window drag bar for seamless color match with native controls without creating layout gap
function WindowDragBar() {
  return (
    <div
      className="drag absolute top-0 right-0 h-9 z-30 select-none pointer-events-none"
      style={{ width: 'calc(env(titlebar-area-width, 140px) + 8px)' }}
    />
  )
}

// Collapsible Sidebar navigation
function Sidebar({
  activeCount,
  collapsed,
  onToggleCollapse,
}: {
  activeCount: number
  collapsed: boolean
  onToggleCollapse: () => void
}) {
  const route = useRoute()
  const rawPage = route.split('?')[0] || '/overview'
  const page = rawPage === '' || rawPage === '/' ? '/overview' : rawPage

  const [flyingPlane, setFlyingPlane] = useState<{ startX: number, startY: number, key: number } | null>(null)
  const [queueBumping, setQueueBumping] = useState(false)

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail || {}
      setFlyingPlane({ startX: detail.x || window.innerWidth / 2, startY: detail.y || window.innerHeight / 2, key: Date.now() })
      setTimeout(() => {
        setQueueBumping(true)
        setTimeout(() => setQueueBumping(false), 600)
      }, 550)
      setTimeout(() => {
        setFlyingPlane(null)
      }, 700)
    }
    window.addEventListener('mediagram-fly-to-queue', handler)
    return () => window.removeEventListener('mediagram-fly-to-queue', handler)
  }, [])

  const items = [
    { id: '/overview', icon: Home, label: 'Overview' },
    { id: '/downloads', icon: Download, label: 'Downloads' },
    { id: '/uploads', icon: Upload, label: 'Uploads' },
    { id: '/queue', icon: ListOrdered, label: 'Queue', badge: activeCount },
    { id: '/settings', icon: SettingsIcon, label: 'Settings' },
  ]

  return (
    <div
      className={`flex h-full shrink-0 flex-col border-r border-border bg-sidebar select-none transition-all duration-200 ${
        collapsed ? 'w-[64px]' : 'w-[200px]'
      }`}
    >
      {flyingPlane && (
        <div
          key={flyingPlane.key}
          className="fly-to-queue-plane fixed pointer-events-none z-[9999] flex items-center justify-center size-8 rounded-full shadow-xl"
          style={{
            '--fly-start-x': `${flyingPlane.startX}px`,
            '--fly-start-y': `${flyingPlane.startY}px`,
          } as any}
        >
          <MediagramLogo size={28} />
        </div>
      )}

      {/* Brand */}
      <div className="border-b border-border p-3 flex items-center justify-between">
        <div className="flex items-center gap-2.5 overflow-hidden">
          <MediagramLogo size={32} className="rounded-lg shadow-md shrink-0" />
          {!collapsed && (
            <div className="overflow-hidden">
              <div className="font-bold text-[13.5px] text-text leading-tight truncate tracking-wide">Workspace</div>
              <div className="text-[10.5px] text-muted leading-tight truncate mt-0.5">Telegram Manager</div>
            </div>
          )}
        </div>
      </div>

      {/* Nav List */}
      <nav className="flex-1 p-2 space-y-1 overflow-y-auto">
        {items.map(({ id, icon: Icon, label, badge }) => {
          const active = page === id
          return (
            <button
              key={id}
              onClick={() => navigate(id)}
              title={collapsed ? label : undefined}
              className={`flex w-full items-center gap-2.5 rounded-lg transition-all ${
                collapsed ? 'justify-center p-2.5' : 'px-3 py-2 text-left'
              } ${
                active ? 'bg-primary text-text shadow-glow font-medium' : 'text-text-2 hover:bg-tile hover:text-text'
              } ${id === '/queue' && queueBumping ? 'scale-110 ring-2 ring-cyan shadow-glow' : ''}`}
            >
              <Icon size={18} className="shrink-0" />
              {!collapsed && <span className="flex-1 text-[13px] truncate">{label}</span>}
              {badge !== undefined && (
                collapsed ? (
                  badge > 0 ? <span className="size-2 rounded-full bg-primary absolute top-2 right-2" /> : null
                ) : (
                  <Badge count={badge} />
                )
              )}
            </button>
          )
        })}
      </nav>

      {/* Collapse Toggle */}
      <div className="border-t border-border p-2">
        <button
          onClick={onToggleCollapse}
          className="flex w-full items-center justify-center gap-2 rounded-lg p-2 text-text-2 hover:bg-tile hover:text-text transition-colors text-[12px]"
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
          {!collapsed && <span>Collapse</span>}
        </button>
      </div>
    </div>
  )
}

// Main App with full-height sidebar and topbar inside main flex container
export default function App() {
  const [collapsed, setCollapsed] = useState(false)
  const { data: auth, error, reload, loading } = useCall<AuthState>('auth.get', undefined, ['auth'])
  const live = useLive()
  const route = useRoute()

  const prevConnection = useRef<string | undefined>(auth?.connection)
  const lastToast = useRef({ offline: 0, online: 0 })
  /** Network messages live in toasts only; the OS event and TDLib's own state report both call in, so each side
   *  suppresses a repeat of its kind for 15 s (an outage rarely announces itself just once). */
  const netToast = (online: boolean) => {
    // Only show transfer connection status toasts when user is signed in
    if (auth?.step !== 'ready') return
    const kind = online ? 'online' : 'offline'
    const now = Date.now()
    if (now - lastToast.current[kind] < 15_000) return
    lastToast.current[kind] = now
    if (online) toast.success('Connection restored. Active transfers are resuming.', { title: 'Back Online' })
    else toast.warning('No internet connection. Transfers are paused and resume automatically.', { title: 'Network Outage' })
  }
  useEffect(() => {
    // The OS notices an outage the moment it happens; TDLib can sit on dead sockets far longer, so the engine gets
    // the signal here: a recovered network clears the failed-scan hold and restarts queues and lists.
    const offline = () => { netToast(false); void call('app.networkChanged', { online: false }).catch(() => {}) }
    const online = () => { netToast(true); void call('app.networkChanged', { online: true }).catch(() => {}) }
    window.addEventListener('offline', offline)
    window.addEventListener('online', online)
    return () => { window.removeEventListener('offline', offline); window.removeEventListener('online', online) }
  }, [auth?.step])
  useEffect(() => {
    const was = prevConnection.current
    const now = auth?.connection
    const isAuthed = auth?.step === 'ready'
    // Never trigger network outage toasts during sign-in attempts / credential validation / logout
    if (isAuthed) {
      if (was === 'ready' && now === 'offline') netToast(false)
      else if (was === 'offline' && now === 'ready') netToast(true)
    }
    prevConnection.current = isAuthed ? now : undefined
  }, [auth?.connection, auth?.step])
  // Minimum splash display time on app launch (600ms) guarantees that the splash screen never flashes
  // away in a split-second, giving TDLib time to report session readiness without any login screen flash.
  const [minSplashDone, setMinSplashDone] = useState(false)
  useEffect(() => {
    const timer = setTimeout(() => setMinSplashDone(true), 600)
    return () => clearTimeout(timer)
  }, [])

  // Sustained logout state: stays active throughout the entire logout pipeline (closing sockets, wiping local
  // session, restarting with saved keys) until the phone/credentials step is fully established and stable.
  const [isLoggingOut, setIsLoggingOut] = useState(false)
  useEffect(() => {
    if (auth?.step === 'logging-out') {
      setIsLoggingOut(true)
    } else if (isLoggingOut && (auth?.step === 'phone' || auth?.step === 'credentials')) {
      const timer = setTimeout(() => setIsLoggingOut(false), 600)
      return () => clearTimeout(timer)
    }
  }, [auth?.step, isLoggingOut])

  // Hand-off from Login form to Dashboard: only applies when user actually went through the Login form
  const [leavingLogin, setLeavingLogin] = useState(false)
  const seenLogin = useRef(false)
  useEffect(() => {
    if (auth?.step !== 'ready') {
      if (auth && auth.step !== 'starting' && auth.step !== 'logging-out' && !isLoggingOut) seenLogin.current = true
      return
    }
    if (!seenLogin.current) return
    seenLogin.current = false
    setLeavingLogin(true)
    const timer = setTimeout(() => setLeavingLogin(false), 480)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once per login, not on connection pushes
  }, [auth?.step, isLoggingOut])

  if (error) {
    return (
      <div className="flex h-full flex-col">
        <div className="drag h-10 shrink-0" />
        <ErrorState error={error} onRetry={reload} />
      </div>
    )
  }

  // Sustained Signing Out screen during logout pipeline (stays steadily visible until logout completes)
  if (isLoggingOut || auth?.step === 'logging-out') {
    return (
      <div className="fade-enter relative flex h-screen w-screen flex-col items-center justify-center bg-[#0f172a] select-none overflow-hidden">
        <WindowDragBar />
        <div className="flex flex-col items-center gap-4">
          <div className="logout-icon grid size-16 place-items-center rounded-2xl bg-danger/15 text-danger shadow-[0_0_35px_rgba(239,68,68,0.3)] border border-danger/30">
            <LogOut size={28} />
          </div>
          <div className="flex flex-col items-center gap-1.5 text-center">
            <div className="text-[19px] font-bold text-white tracking-wide">Signing out…</div>
            <div className="text-[12px] text-muted font-medium flex items-center gap-2">
              <span className="size-1.5 rounded-full bg-danger animate-pulse" />
              Closing Telegram session securely
            </div>
          </div>
        </div>
      </div>
    )
  }

  // Sustained Splash screen on app launch: stays active until session check is complete and minSplashDone elapsed
  if (loading || !auth || auth.step === 'starting' || (!minSplashDone && auth.step === 'ready')) {
    return (
      <div className="relative flex h-screen w-screen flex-col items-center justify-center bg-[#0f172a] select-none overflow-hidden">
        <WindowDragBar />
        <div className="flex flex-col items-center gap-4">
          <div className="splash-icon flex size-16 items-center justify-center rounded-2xl shadow-[0_0_40px_rgba(59,130,246,0.35)]">
            <MediagramLogo size={64} className="rounded-2xl" />
          </div>
          <div className="flex flex-col items-center gap-1.5 text-center">
            <div className="text-[19px] font-bold text-white tracking-wide">Mediagram</div>
            <div className="text-[12px] text-muted font-medium flex items-center gap-2">
              <span className="size-1.5 rounded-full bg-primary animate-pulse" />
              Connecting to Telegram…
            </div>
          </div>
        </div>
      </div>
    )
  }

  // Auth gate: any other non-ready step shows Login with smooth entrance animation
  if (auth.step !== 'ready') {
    return (
      <div className="login-enter h-screen w-screen overflow-hidden">
        <Login />
      </div>
    )
  }

  const rawPage = route.split('?')[0] || '/overview'
  const page = rawPage === '' || rawPage === '/' ? '/overview' : rawPage

  const shell = (
    <div className="flex h-full w-full flex-col overflow-hidden bg-bg">
      {/* Top Window Bar: Solid 36px bar holding native controls, drag region, and the app logo */}
      <div className="drag flex h-9 shrink-0 items-center justify-between bg-[#0f172a] px-3 select-none z-30 border-b border-white/[0.06]">
        <div className="no-drag flex items-center gap-2 text-[12px] font-semibold text-text tracking-wide">
          <MediagramLogo size={18} className="rounded" />
          <span>Mediagram</span>
        </div>

        {/* Reserved slot for the OTA update pill (the top bar carries no status indicators otherwise) */}
        <div className="no-drag mr-36" aria-hidden="true" />
      </div>

      {/* Main Workspace (Sidebar + Content) */}
      <div className="flex flex-1 overflow-hidden min-h-0">
        <Sidebar
          activeCount={live.activeCount}
          collapsed={collapsed}
          onToggleCollapse={() => setCollapsed(!collapsed)}
        />

        <main className={`flex-1 min-h-0 h-full ${page === '/settings' ? 'overflow-hidden' : 'overflow-auto'}`}>
          {page === '/overview' && <Overview />}
          {page === '/downloads' && <Downloads />}
          {page === '/uploads' && <Uploads />}
          {page === '/queue' && <Queue />}
          {page === '/settings' && <Settings />}
          {!['/overview', '/downloads', '/uploads', '/queue', '/settings'].includes(page) && (
            <div className="flex h-full items-center justify-center">
              <Empty message="Page not found" action={{ label: 'Go to Overview', onClick: () => navigate('/overview') }} />
            </div>
          )}
        </main>
      </div>
    </div>
  )

  // Through the hand-off the dashboard mounts beneath Login, which fades out as a layer over it. The tree shape
  // stays put either way, so nothing inside the dashboard remounts when the overlay leaves.
  return (
    <div className="relative h-screen w-screen overflow-hidden bg-bg">
      <div className={leavingLogin ? 'app-enter absolute inset-0' : 'absolute inset-0'}>{shell}</div>
      {leavingLogin && (
        <div className="login-exit absolute inset-0 z-40">
          <Login />
        </div>
      )}
    </div>
  )
}
