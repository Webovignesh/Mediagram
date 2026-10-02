import { useState } from 'react'
import { Home, Download, Upload, ListOrdered, FolderOpen, Settings as SettingsIcon, Search, ChevronDown, Send } from 'lucide-react'
import { call, useCall, useLive, useRoute, navigate } from './api.ts'
import { Badge, EmptyState, ErrorState } from './ui.tsx'
import type { AuthState, Me } from '../../core/shapes.ts'
import Login from './pages/Login.tsx'
import Overview from './pages/Overview.tsx'
import Downloads from './pages/Downloads.tsx'
import Uploads from './pages/Uploads.tsx'
import Queue from './pages/Queue.tsx'
import Library from './pages/Library.tsx'
import Settings from './pages/Settings.tsx'

// Phase 4.3: Top bar with search and user menu
function TopBar({ me }: { me: Me }) {
  const [searchOpen, setSearchOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)

  async function logout() {
    if (confirm('Log out of Telegram?')) {
      try {
        await call('auth.logout', {})
      } catch (err) {
        alert((err as Error).message)
      }
    }
  }

  const initial = me.firstName.charAt(0).toUpperCase()

  return (
    <div className="drag flex h-10 items-center border-b border-border bg-bg px-4" style={{ paddingRight: 'calc(1rem + env(titlebar-area-width, 0px))' }}>
      <div className="no-drag relative flex-1" style={{ maxWidth: '670px' }}>
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
        <input
          type="text"
          placeholder="Search channels, chats, files, or paste a Telegram link…"
          className="w-full rounded-lg border border-border bg-tile py-1.5 pl-9 pr-3 text-sm placeholder:text-muted focus:border-primary"
          onFocus={() => setSearchOpen(true)}
          onBlur={() => setTimeout(() => setSearchOpen(false), 200)}
        />
        {searchOpen && (
          <div className="absolute left-0 right-0 top-full mt-1 rounded-lg border border-border bg-panel p-2 shadow-lg">
            <EmptyState message="No matches" />
          </div>
        )}
      </div>
      <div className="no-drag relative ml-auto">
        <button
          onClick={() => setMenuOpen(!menuOpen)}
          className="flex items-center gap-2 rounded-lg px-3 py-1.5 hover:bg-tile"
        >
          <div className="flex size-7 items-center justify-center rounded-full bg-primary font-semibold">
            {initial}
          </div>
          <span className="text-sm">{me.name}</span>
          <ChevronDown size={16} className="text-text-2" />
        </button>
        {menuOpen && (
          <div className="absolute right-0 top-full mt-1 w-64 rounded-lg border border-border bg-panel p-2 shadow-lg">
            <div className="border-b border-border px-3 py-2">
              <div className="font-semibold">{me.name}</div>
              <div className="text-xs text-text-2">{me.phone}</div>
              {me.username && <div className="text-xs text-text-2">@{me.username}</div>}
            </div>
            <button
              onClick={() => { setMenuOpen(false); navigate('/settings') }}
              className="flex w-full items-center gap-2 rounded px-3 py-2 text-left hover:bg-tile"
            >
              <SettingsIcon size={16} />
              <span>Settings</span>
            </button>
            <button
              onClick={logout}
              className="flex w-full items-center gap-2 rounded px-3 py-2 text-left text-danger hover:bg-danger/10"
            >
              <span>Log out</span>
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// Phase 4.4: Sidebar navigation
function Sidebar({ activeCount }: { activeCount: number }) {
  const route = useRoute()
  const page = route.split('?')[0]

  const items = [
    { id: '/overview', icon: Home, label: 'Overview' },
    { id: '/downloads', icon: Download, label: 'Downloads' },
    { id: '/uploads', icon: Upload, label: 'Uploads' },
    { id: '/queue', icon: ListOrdered, label: 'Queue', badge: activeCount },
    { id: '/library', icon: FolderOpen, label: 'Media Library' },
    { id: '/settings', icon: SettingsIcon, label: 'Settings' },
  ]

  return (
    <div className="flex w-[170px] flex-col border-r border-border bg-sidebar">
      <div className="border-b border-border p-4">
        <div className="flex items-center gap-2">
          <div className="grid size-8 place-items-center rounded-lg bg-primary">
            <Send size={16} />
          </div>
          <div>
            <div className="font-bold">TeleFlow</div>
            <div className="text-[11px] text-muted">Download. Upload. Organize.</div>
          </div>
        </div>
      </div>
      <nav className="flex-1 p-2">
        {items.map(({ id, icon: Icon, label, badge }) => {
          const active = page === id
          return (
            <button
              key={id}
              onClick={() => navigate(id)}
              className={`flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left transition-colors ${
                active ? 'bg-primary text-text shadow-glow' : 'text-text-2 hover:bg-tile'
              }`}
            >
              <Icon size={18} />
              <span className="flex-1 text-sm">{label}</span>
              {badge !== undefined && <Badge count={badge} />}
            </button>
          )
        })}
      </nav>
    </div>
  )
}

// Phase 4.5: Main App with routing and auth gate
export default function App() {
  const { data: auth, error, reload } = useCall<AuthState>('auth.get', undefined, ['auth'])
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

  if (!auth) return null

  // Auth gate: any step other than 'ready' shows Login
  if (auth.step !== 'ready') {
    return <Login />
  }

  const page = route.split('?')[0]

  return (
    <div className="flex h-full flex-col">
      <TopBar me={auth.me} />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar activeCount={live.activeCount} />
        <main className="flex-1 overflow-auto">
          {page === '/overview' && <Overview />}
          {page === '/downloads' && <Downloads />}
          {page === '/uploads' && <Uploads />}
          {page === '/queue' && <Queue />}
          {page === '/library' && <Library />}
          {page === '/settings' && <Settings />}
          {!['/overview', '/downloads', '/uploads', '/queue', '/library', '/settings'].includes(page) && (
            <div className="flex h-full items-center justify-center">
              <EmptyState message="Page not found" action={{ label: 'Go to Overview', onClick: () => navigate('/overview') }} />
            </div>
          )}
        </main>
      </div>
    </div>
  )
}
