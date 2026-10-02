import { useState, useRef, useEffect } from 'react'
import { Home, Download, Upload, ListOrdered, Settings as SettingsIcon, ChevronDown, Send, LogOut, PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import { call, useCall, useLive, useRoute, navigate } from './api.ts'
import { Empty, ErrorState, Badge, Avatar, toast, confirm } from './ui.tsx'
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
          className="fly-to-queue-plane fixed pointer-events-none z-[9999] flex items-center justify-center size-8 rounded-full bg-cyan text-white shadow-xl"
          style={{
            '--fly-start-x': `${flyingPlane.startX}px`,
            '--fly-start-y': `${flyingPlane.startY}px`,
          } as any}
        >
          <Send size={15} />
        </div>
      )}

      {/* Brand */}
      <div className="border-b border-border p-3 flex items-center justify-between">
        <div className="flex items-center gap-2.5 overflow-hidden">
          <div className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary/20 text-primary border border-primary/30">
            <Send size={16} />
          </div>
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

  if (error) {
    return (
      <div className="flex h-full flex-col">
        <div className="drag h-10 shrink-0" />
        <ErrorState error={error} onRetry={reload} />
      </div>
    )
  }

  if (loading || !auth) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-text-2">Loading…</div>
      </div>
    )
  }

  // Auth gate: any step other than 'ready' shows Login
  if (auth.step !== 'ready') {
    return <Login />
  }

  const rawPage = route.split('?')[0] || '/overview'
  const page = rawPage === '' || rawPage === '/' ? '/overview' : rawPage

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-bg">
      {/* Top Window Bar: Solid 36px bar holding native controls, drag region, and app logo */}
      <div className="drag flex h-9 shrink-0 items-center justify-between bg-[#0f172a] px-3 select-none z-30 border-b border-white/[0.06]">
        <div className="no-drag flex items-center gap-2 text-[12px] font-semibold text-text tracking-wide">
          <div className="grid size-5 place-items-center rounded bg-primary text-white shadow-glow">
            <Send size={11} />
          </div>
          <span>Mediagram</span>
        </div>
      </div>

      {/* Main Workspace (Sidebar + Content) */}
      <div className="flex flex-1 overflow-hidden min-h-0">
        <Sidebar
          activeCount={live.activeCount}
          collapsed={collapsed}
          onToggleCollapse={() => setCollapsed(!collapsed)}
        />

        <main className="flex-1 overflow-auto">
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
}
