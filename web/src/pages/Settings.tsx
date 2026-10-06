// Phase 5.6: Settings page per UI.md & User Specs
import { useState, useRef, useEffect } from 'react'
import { Settings as SettingsIcon, Download, Upload, Users, Folder, Bell, Info, ExternalLink, Trash2, LogOut, Clock, Key } from 'lucide-react'
import { call, useCall, useRoute, navigate } from '../api.ts'
import { Panel, Toggle, Select, Button, Avatar, Input, Dialog, fmtBytes, fmtDate, confirm, toast } from '../ui.tsx'

export default function Settings() {
  const [activeSection, setActiveSection] = useState('general')
  const [licensesOpen, setLicensesOpen] = useState(false)

  const [editApiId, setEditApiId] = useState('')
  const [editApiHash, setEditApiHash] = useState('')
  /** Field-level errors for Update Credentials: the message names the field that is wrong, not a toast that vanishes. */
  const [idError, setIdError] = useState<string | null>(null)
  const [hashError, setHashError] = useState<string | null>(null)
  const [apiError, setApiError] = useState<string | null>(null)

  const sectionRefs = {
    general: useRef<HTMLDivElement>(null),
    downloads: useRef<HTMLDivElement>(null),
    uploads: useRef<HTMLDivElement>(null),
    telegram: useRef<HTMLDivElement>(null),
    channels: useRef<HTMLDivElement>(null),
    queue: useRef<HTMLDivElement>(null),
    files: useRef<HTMLDivElement>(null),
    notifications: useRef<HTMLDivElement>(null),
    about: useRef<HTMLDivElement>(null),
  }

  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const isScrollingToRef = useRef(false)
  const scrollTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const sectionOrder: (keyof typeof sectionRefs)[] = [
    'general', 'downloads', 'uploads', 'telegram', 'channels', 'queue', 'files', 'notifications', 'about'
  ]

  const handleScroll = (e?: { target?: EventTarget | null }) => {
    if (isScrollingToRef.current) return
    const container = scrollContainerRef.current
    if (!container) return

    const scrollEl = (e?.target as HTMLElement | null) || container
    const activeScrollEl = scrollEl.scrollHeight > scrollEl.clientHeight ? scrollEl : container

    // If scrolled near the bottom, activate the final section (About)
    const isBottom = activeScrollEl.scrollHeight - activeScrollEl.scrollTop <= activeScrollEl.clientHeight + 80
    if (isBottom) {
      setActiveSection('about')
      return
    }

    const containerTop = container.getBoundingClientRect().top
    let active: keyof typeof sectionRefs = 'general'

    for (const key of sectionOrder) {
      const el = sectionRefs[key]?.current
      if (!el) continue
      const topOffset = el.getBoundingClientRect().top - containerTop
      if (topOffset <= 160) {
        active = key
      }
    }
    setActiveSection(active)
  }

  useEffect(() => {
    const container = scrollContainerRef.current
    if (!container) return

    const onScroll = (e: Event) => handleScroll(e)
    container.addEventListener('scroll', onScroll, { passive: true })

    const parentMain = container.closest('main')
    if (parentMain) {
      parentMain.addEventListener('scroll', onScroll, { passive: true })
    }
    window.addEventListener('scroll', onScroll, { passive: true })

    handleScroll()

    return () => {
      container.removeEventListener('scroll', onScroll)
      if (parentMain) parentMain.removeEventListener('scroll', onScroll)
      window.removeEventListener('scroll', onScroll)
    }
  }, [])

  const scrollTo = (key: keyof typeof sectionRefs) => {
    setActiveSection(key)
    isScrollingToRef.current = true
    if (scrollTimerRef.current) clearTimeout(scrollTimerRef.current)

    sectionRefs[key]?.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })

    scrollTimerRef.current = setTimeout(() => {
      isScrollingToRef.current = false
    }, 800)
  }

  useEffect(() => {
    const navBtn = document.getElementById(`settings-nav-${activeSection}`)
    if (navBtn) {
      navBtn.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    }
  }, [activeSection])

  // Opened as #/settings?section=<id>: scroll straight to that section on mount.
  const route = useRoute()
  useEffect(() => {
    const query = route.split('?')[1]
    if (!query) return
    const params = new URLSearchParams(query)
    const section = params.get('section') as keyof typeof sectionRefs | null
    if (!section || !sectionRefs[section]) return
    scrollTo(section)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when the page is opened with a target
  }, [])

  const { data: settings, reload: reloadSettings } = useCall<any>('settings.get', {}, ['settings'])
  const { data: auth } = useCall<{ step: string, me: any, connection: string }>('auth.get', {}, ['auth'])
  const { data: app } = useCall<{ version: string, tdlib: string, installedAt: number | null, repository: string | null, licenses: any[] }>('app.info', {})
  const { data: storage, reload: reloadStorage } = useCall<any>('app.storage', {}, ['storage'])
  const { data: live } = useCall<any>('stats.live', {}, ['stats'])
  const { data: chats } = useCall<{ chats: any[] }>('chats.list', {}, ['chats'])

  async function setSetting(key: string, value: any) {
    try {
      await call('settings.set', { [key]: value })
      toast('Saved')
      reloadSettings()
    } catch (e) {
      toast((e as Error).message, 'danger')
    }
  }

  async function pickFolder() {
    try {
      const res = await call<{ path: string | null }>('app.pickFolder', { title: 'Choose download folder' })
      if (res.path) await setSetting('downloadRoot', res.path)
    } catch (e) {
      toast((e as Error).message, 'danger')
    }
  }

  const checkId = (raw: string): string | null =>
    /^\d+$/.test(raw) && Number(raw) >= 1 && Number(raw) <= 2_147_483_647
      ? null
      : 'API ID is the whole number from my.telegram.org (1 to 2147483647).'
  const checkHash = (raw: string): string | null => {
    const hash = raw.trim()
    if (/^[0-9a-f]{32}$/i.test(hash)) return null
    return `API hash is 32 hexadecimal characters (0-9, a-f) — this one has ${hash.length}.`
  }

  /** Validates both fields before anything leaves the renderer: a hash one character short never reaches TDLib. */
  async function updateCredentials() {
    const idMsg = checkId(editApiId.trim())
    const hashMsg = checkHash(editApiHash)
    setIdError(idMsg)
    setHashError(hashMsg)
    setApiError(null)
    if (idMsg || hashMsg) return
    // Keys differing from the ones in use re-check with Telegram by signing back in (auth.credentials takes the
    // fresh path when they change), so the dialog says so before anything is wiped.
    if (!(await confirm({
      title: 'Update API data',
      message: 'New keys are checked by Telegram with a fresh sign-in — you\'ll enter your phone number and code again. Apply the update?',
      confirm: 'Update',
    }))) return
    const wasSaved = !!settings?.apiHashSaved
    try {
      await call('auth.credentials', { apiId: Number(editApiId.trim()), apiHash: editApiHash.trim() })
      if (wasSaved) await call('auth.saveKeys') // the saved row keeps up, so it can't hold the previous keys
      setEditApiId('')
      setEditApiHash('')
      setIdError(null)
      setHashError(null)
      toast('API data saved')
      reloadSettings()
    } catch (e) {
      const msg = (e as Error).message
      if (msg.startsWith('apiId') || /API ID/i.test(msg)) setIdError(msg)
      else if (msg.startsWith('apiHash') || /hash/i.test(msg)) setHashError(msg)
      else setApiError(msg)
      reloadSettings() // a rejection from Telegram also forgets the stored keys; the status line must follow
    }
  }

  /** Keeps the keys of this session on disk, encrypted, so the API-keys step is skipped next time. */
  async function saveKeys() {
    try {
      await call('auth.saveKeys')
      toast.success('Encrypted on this device — signing out keeps it.', { title: 'API data saved' })
      reloadSettings()
    } catch (e) {
      toast((e as Error).message, 'danger')
    }
  }

  /** Erases the API data saved on this device. The signed-in session keeps working until it signs out. */
  async function deleteApiData() {
    if (await confirm({
      title: 'Delete API data',
      message: 'Erases the API data saved on this device. Your current sign-in keeps working; you will be asked for it again after signing out.',
      confirm: 'Delete API data',
      danger: true,
    })) {
      try {
        await call('auth.forgetKeys')
        toast.success('You will be asked for your API data again after signing out.', { title: 'API data deleted' })
        reloadSettings()
      } catch (e) {
        toast((e as Error).message, 'danger')
      }
    }
  }

  async function logout() {
    if (await confirm({
      title: 'Log out',
      message: 'Your Telegram session ends on this device. Saved API data stays, so signing back in is quick.',
      confirm: 'Log out',
    })) {
      try {
        await call('auth.logout')
        toast('Logged out')
      } catch (e) {
        toast((e as Error).message, 'danger')
      }
    }
  }

  async function clearCache() {
    if (await confirm({
      title: 'Clear Cache',
      message: `Clear ${fmtBytes(storage?.cache?.total || 0)} of cache? Paused downloads restart from the beginning.`,
      confirm: 'Clear Cache',
    })) {
      try {
        const res = await call<{ freed: number }>('app.clearCache')
        toast(`Freed ${fmtBytes(res.freed)}`)
        reloadStorage()
      } catch (e) {
        toast((e as Error).message, 'danger')
      }
    }
  }

  async function clearData() {
    if (await confirm({
      title: 'Clear app data',
      message: 'Deletes your history, download queue, media index, and all settings — the download folder resets to the default.',
      confirm: 'Clear app data',
      danger: true,
      wait: 3, // the delete button opens after 3 seconds, so a stray click cannot wipe anything
    })) {
      try {
        const res = await call<{ freed: number }>('app.clearData')
        toast(`Freed ${fmtBytes(res.freed)}`)
        reloadSettings()
        reloadStorage()
      } catch (e) {
        toast((e as Error).message, 'danger')
      }
    }
  }

  const canPost = chats?.chats.filter((c: any) => c.canPost) || []
  const activeCount = (live?.counts?.download?.active || 0) + (live?.counts?.upload?.active || 0)
  // Settings is only reachable while signed in; the "Log in" button is a safety net for a dead session.
  const signedIn = auth?.step === 'ready'

  return (
    <div className="flex h-full overflow-hidden">
      {/* Licenses Dialog */}
      <Dialog open={licensesOpen} onClose={() => setLicensesOpen(false)} title="Open Source Licenses">
        <div className="max-h-96 overflow-y-auto space-y-3 p-1">
          {app?.licenses?.map((l: any, i: number) => (
            <div key={i} className="border-b border-border/40 pb-2 text-[12px]">
              <div className="font-semibold text-text">{l.name} <span className="text-muted font-normal">v{l.version}</span></div>
              <div className="text-text-2">{l.license} License</div>
            </div>
          ))}
        </div>
        <div className="mt-4 flex justify-end">
          <Button variant="secondary" onClick={() => setLicensesOpen(false)}>Close</Button>
        </div>
      </Dialog>

      {/* Category Navigation Column (~240px) */}
      <div className="w-[240px] shrink-0 border-r border-border bg-panel/30 p-3 space-y-1 overflow-y-auto">
        <div className="px-2 py-2.5 text-[11px] font-bold text-muted uppercase tracking-wider">Settings</div>
        {[
          { id: 'general', icon: SettingsIcon, label: 'General', subtitle: 'Startup & tray' },
          { id: 'downloads', icon: Download, label: 'Downloads', subtitle: 'Location & limits' },
          { id: 'uploads', icon: Upload, label: 'Uploads', subtitle: 'Defaults & format' },
          { id: 'telegram', icon: Users, label: 'Telegram', subtitle: 'Account & API' },
          { id: 'channels', icon: Users, label: 'Channels', subtitle: 'Chat list' },
          { id: 'queue', icon: Clock, label: 'Queue', subtitle: 'Retries & cleanup' },
          { id: 'files', icon: Folder, label: 'Files & Folders', subtitle: 'App data & logs' },
          { id: 'notifications', icon: Bell, label: 'Notifications', subtitle: 'Desktop alerts' },
          { id: 'about', icon: Info, label: 'About', subtitle: 'Version & info' },
        ].map(({ id, icon: Icon, label, subtitle }) => (
          <button
            key={id}
            id={`settings-nav-${id}`}
            onClick={() => scrollTo(id as any)}
            className={`flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors ${
              activeSection === id ? 'bg-primary text-text shadow-glow' : 'hover:bg-tile text-text-2 hover:text-text'
            }`}
          >
            <Icon size={16} className="mt-0.5 shrink-0" />
            <div className="min-w-0">
              <div className="text-[13px] font-medium leading-snug">{label}</div>
              <div className={`text-[11px] leading-normal mt-0.5 ${activeSection === id ? 'text-white/85' : 'text-muted'}`}>{subtitle}</div>
            </div>
          </button>
        ))}
      </div>

      {/* Main Settings Panels (Full-Width Flex-1 Center, Right Column Removed) */}
      <div 
        ref={scrollContainerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto p-6 space-y-5 w-full scroll-smooth"
      >
        <div className="flex items-center justify-between pr-40">
          <div>
            <h1 className="text-[26px] font-bold text-white tracking-wide">Settings</h1>
            <p className="mt-1 text-[13px] text-text-2">Change how Mediagram looks and works</p>
          </div>
        </div>

        {/* General */}
        <div ref={sectionRefs.general}>
          <Panel title="General" icon={<SettingsIcon size={18} />}>
            <div className="divide-y divide-border">
              <div className="flex items-center justify-between py-3">
                <div>
                  <div className="text-[13px] font-semibold text-text">Start with Windows</div>
                  <div className="text-[12px] text-muted">Launch Mediagram automatically on system startup</div>
                </div>
                <Toggle checked={settings?.startWithSystem || false} onChange={(v) => setSetting('startWithSystem', v)} />
              </div>
              <div className="flex items-center justify-between py-3">
                <div>
                  <div className="text-[13px] font-semibold text-text">Minimize to tray on close</div>
                  <div className="text-[12px] text-muted">Keep transfers active in the system tray when closing window</div>
                </div>
                <Toggle checked={settings?.closeToTray || false} onChange={(v) => setSetting('closeToTray', v)} />
              </div>
            </div>
          </Panel>
        </div>

        {/* Downloads */}
        <div ref={sectionRefs.downloads}>
          <Panel title="Downloads" icon={<Download size={18} />}>
            <div className="divide-y divide-border">
              <div className="py-3">
                <div className="mb-2">
                  <div className="text-[13px] font-semibold text-text">Default download location</div>
                  <div className="text-[12px] text-muted">Files will be saved to this folder</div>
                </div>
                <div className="flex gap-2">
                  <Input value={settings?.downloadRoot || ''} onChange={() => {}} />
                  <Button variant="secondary" onClick={pickFolder}>Change</Button>
                  <Button variant="secondary" onClick={() => call('app.openPath', { target: 'downloads' })}>Open</Button>
                </div>
              </div>
              <div className="flex items-center justify-between py-3">
                <div>
                  <div className="text-[13px] font-semibold text-text">Max concurrent downloads</div>
                  <div className="text-[12px] text-muted">Number of files to download at the same time (1–5)</div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    disabled={(settings?.maxDownloads || 2) <= 1}
                    onClick={() => setSetting('maxDownloads', Math.max(1, (settings?.maxDownloads || 2) - 1))}
                    className="flex size-7 items-center justify-center rounded-lg border border-border bg-tile hover:border-primary disabled:opacity-40"
                  >−</button>
                  <span className="w-6 text-center tabular-nums font-bold">{settings?.maxDownloads || 2}</span>
                  <button
                    disabled={(settings?.maxDownloads || 2) >= 5}
                    onClick={() => setSetting('maxDownloads', Math.min(5, (settings?.maxDownloads || 2) + 1))}
                    className="flex size-7 items-center justify-center rounded-lg border border-border bg-tile hover:border-primary disabled:opacity-40"
                  >+</button>
                </div>
              </div>
              <div className="flex items-center justify-between py-3">
                <div>
                  <div className="text-[13px] font-semibold text-text">Auto-resume failed downloads</div>
                  <div className="text-[12px] text-muted">Automatically retry failed transfers with backoff</div>
                </div>
                <Toggle checked={settings?.autoRetry ?? true} onChange={(v) => setSetting('autoRetry', v)} />
              </div>
              <div className="flex items-center justify-between py-3">
                <div>
                  <div className="text-[13px] font-semibold text-text">Skip existing files</div>
                  <div className="text-[12px] text-muted">Avoid re-downloading files that already exist on disk</div>
                </div>
                <Toggle checked={settings?.skipExisting || false} onChange={(v) => setSetting('skipExisting', v)} />
              </div>
              <div className="flex items-center justify-between py-3">
                <div>
                  <div className="text-[13px] font-semibold text-text">Prefix file names with date</div>
                  <div className="text-[12px] text-muted">Prepend YYYY-MM-DD timestamp to downloaded file names</div>
                </div>
                <Toggle checked={settings?.datePrefix || false} onChange={(v) => setSetting('datePrefix', v)} />
              </div>
              <div className="flex items-center justify-between py-3">
                <div>
                  <div className="text-[13px] font-semibold text-text">Prebuffer video playback</div>
                  <div className="text-[12px] text-muted">Automatically stream and buffer videos before playback; when off, un-downloaded videos won't prebuffer automatically</div>
                </div>
                <Toggle checked={settings?.prebufferVideo ?? true} onChange={(v) => setSetting('prebufferVideo', v)} />
              </div>
              <div className="py-3">
                <div className="mb-2">
                  <div className="text-[13px] font-semibold text-text">Folder template</div>
                  <div className="text-[12px] text-muted">Subfolder pattern under download root (placeholders: &#123;chat&#125;, &#123;chat_id&#125;)</div>
                </div>
                <input
                  type="text"
                  value={settings?.folderTemplate || '{chat}'}
                  onChange={(e) => setSetting('folderTemplate', e.target.value)}
                  className="w-full rounded-[10px] border border-border bg-tile px-3 py-2 text-[13px] text-text focus:border-primary outline-none"
                />
              </div>
            </div>
          </Panel>
        </div>

        {/* Uploads */}
        <div ref={sectionRefs.uploads}>
          <Panel title="Uploads" icon={<Upload size={18} />}>
            <div className="divide-y divide-border">
              <div className="flex items-center justify-between py-3">
                <div>
                  <div className="text-[13px] font-semibold text-text">Default destination</div>
                  <div className="text-[12px] text-muted">Pre-select destination chat in Uploads</div>
                </div>
                <Select
                  value={settings?.defaultUploadChat || 'none'}
                  options={[{ value: 'none', label: 'None' }, ...canPost.map((c: any) => ({ value: c.id, label: c.title }))]}
                  onChange={(v) => setSetting('defaultUploadChat', v === 'none' ? null : v)}
                />
              </div>
              <div className="flex items-center justify-between py-3">
                <div>
                  <div className="text-[13px] font-semibold text-text">Upload as album</div>
                  <div className="text-[12px] text-muted">Group multiple photos or videos as a single album</div>
                </div>
                <Toggle checked={settings?.uploadAlbum || false} onChange={(v) => setSetting('uploadAlbum', v)} />
              </div>
              <div className="flex items-center justify-between py-3">
                <div>
                  <div className="text-[13px] font-semibold text-text">Keep original file names</div>
                  <div className="text-[12px] text-muted">Preserve original file names when uploading</div>
                </div>
                <Toggle checked={settings?.keepNames || false} onChange={(v) => setSetting('keepNames', v)} />
              </div>
              <div className="flex items-center justify-between py-3">
                <div>
                  <div className="text-[13px] font-semibold text-text">Max concurrent uploads</div>
                  <div className="text-[12px] text-muted">Number of files to upload at the same time (1–3)</div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    disabled={(settings?.maxUploads || 1) <= 1}
                    onClick={() => setSetting('maxUploads', Math.max(1, (settings?.maxUploads || 1) - 1))}
                    className="flex size-7 items-center justify-center rounded-lg border border-border bg-tile hover:border-primary disabled:opacity-40"
                  >−</button>
                  <span className="w-6 text-center tabular-nums font-bold">{settings?.maxUploads || 1}</span>
                  <button
                    disabled={(settings?.maxUploads || 1) >= 3}
                    onClick={() => setSetting('maxUploads', Math.min(3, (settings?.maxUploads || 1) + 1))}
                    className="flex size-7 items-center justify-center rounded-lg border border-border bg-tile hover:border-primary disabled:opacity-40"
                  >+</button>
                </div>
              </div>
            </div>
          </Panel>
        </div>

        {/* Telegram & Open Source API Credentials */}
        <div ref={sectionRefs.telegram}>
          <Panel title="Telegram" icon={<Users size={18} />}>
            <div className="divide-y divide-border">
              {/* Account profile */}
              <div className="flex items-center gap-3.5 py-3">
                <Avatar src={auth?.me?.photo} name={auth?.me?.name || 'Telegram User'} size={48} />
                <div className="flex-1">
                  <div className="text-[15px] font-bold text-text">{auth?.me?.name || 'Connected User'}</div>
                  <div className="text-[12px] text-muted">{auth?.me?.phone}</div>
                  {auth?.me?.username && <div className="text-[12px] text-primary">@{auth.me.username}</div>}
                </div>
              </div>

              {/* Editable Telegram API Credentials */}
              <div className="space-y-3 py-4">
                <div className="flex items-center gap-2 text-text font-semibold text-[13px]">
                  <Key size={15} className="text-primary" />
                  <span>Telegram API data</span>
                </div>
                <p className="text-[12px] text-muted">
                  Your own API ID and hash from my.telegram.org — Mediagram uses them to connect to Telegram.
                </p>
                <p className={`text-[12px] ${settings?.apiHashSaved ? 'text-success' : 'text-warning'}`}>
                  {settings?.apiHashSaved
                    ? 'Saved on this device — kept through sign-out, so you won\'t be asked for these again.'
                    : 'Not saved yet: these keys are only in this session, so Mediagram will ask for them again next time. A completed sign-in saves them automatically.'}
                </p>
                {settings?.apiHashSaved && (
                  <p className="text-[12px] text-muted">
                    Saved keys are encrypted with your Windows account (DPAPI) and never leave this device.
                    Signing out keeps them; Clear All Data erases them.
                  </p>
                )}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] text-muted mb-1">API ID</label>
                    <input
                      type="number"
                      placeholder={settings?.apiId ? String(settings.apiId) : 'API ID'}
                      value={editApiId}
                      onChange={(e) => { setEditApiId(e.target.value); setIdError(null); setApiError(null) }}
                      onBlur={() => setIdError(editApiId.trim() ? checkId(editApiId.trim()) : null)}
                      aria-invalid={!!idError}
                      className={`w-full rounded-[10px] border ${idError ? 'border-danger' : 'border-border'} bg-tile px-3 py-2 text-[13px] text-text focus:border-primary outline-none`}
                    />
                    {idError && <p role="alert" className="mt-1 text-[11px] text-danger">{idError}</p>}
                    {!idError && auth?.step === 'ready' && !!editApiId.trim() && (
                      <p className="mt-1 text-[11px] text-primary">
                        Applying updated keys checks them with Telegram straight away: you'll sign back in with your
                        phone number and code.
                      </p>
                    )}
                  </div>
                  <div>
                    <label className="block text-[11px] text-muted mb-1">API Hash</label>
                    <input
                      type="password"
                      placeholder="32-character hex hash"
                      value={editApiHash}
                      onChange={(e) => { setEditApiHash(e.target.value); setHashError(null); setApiError(null) }}
                      onBlur={() => setHashError(editApiHash.trim() ? checkHash(editApiHash) : null)}
                      aria-invalid={!!hashError}
                      autoComplete="off"
                      spellCheck={false}
                      className={`w-full rounded-[10px] border ${hashError ? 'border-danger' : 'border-border'} bg-tile px-3 py-2 text-[13px] text-text focus:border-primary outline-none`}
                    />
                    {hashError && <p role="alert" className="mt-1 text-[11px] text-danger">{hashError}</p>}
                  </div>
                </div>
                {apiError && <p role="alert" className="text-[12px] text-danger">{apiError}</p>}
                <div className="flex items-center justify-between pt-1">
                  <a
                    href="https://my.telegram.org"
                    target="_blank"
                    rel="noreferrer"
                    className="text-[12px] text-primary hover:underline flex items-center gap-1"
                  >
                    <span>Get them at my.telegram.org</span>
                    <ExternalLink size={12} />
                  </a>
                  <div className="flex items-center gap-2">
                    {settings?.apiHashSaved && (
                      <Button variant="tint" tone="danger" onClick={deleteApiData} className="py-1 px-3 text-[12px]">
                        Delete API data
                      </Button>
                    )}
                    <Button
                      variant="secondary"
                      disabled={!!settings?.apiHashSaved}
                      onClick={saveKeys}
                      className="py-1 px-3 text-[12px]"
                    >
                      {settings?.apiHashSaved ? 'Saved' : 'Save API data'}
                    </Button>
                    <Button
                      variant="primary"
                      disabled={!editApiId.trim() || !editApiHash.trim()}
                      onClick={updateCredentials}
                      className="py-1 px-3 text-[12px]"
                    >
                      Update API data
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          </Panel>
        </div>

        {/* Channels */}
        <div ref={sectionRefs.channels}>
          <Panel title="Channels" icon={<Users size={18} />}>
            <div className="flex items-center justify-between py-2">
              <div>
                <div className="text-[13px] font-semibold text-text">Show archived chats</div>
                <div className="text-[12px] text-muted">Include archived channels and groups in chat selector</div>
              </div>
              <Toggle checked={settings?.showArchived || false} onChange={(v) => setSetting('showArchived', v)} />
            </div>
          </Panel>
        </div>

        {/* Queue */}
        <div ref={sectionRefs.queue}>
          <Panel title="Queue" icon={<Clock size={18} />}>
            <div className="divide-y divide-border">
              <div className="flex items-center justify-between py-3">
                <div>
                  <div className="text-[13px] font-semibold text-text">Retry attempts</div>
                  <div className="text-[12px] text-muted">Max restart attempts per transfer (1–10)</div>
                </div>
                <Select
                  value={settings?.retryAttempts || 3}
                  options={[1, 2, 3, 5, 10].map((n) => ({ value: n, label: `${n} attempts` }))}
                  onChange={(v) => setSetting('retryAttempts', v)}
                />
              </div>
              <div className="flex items-center justify-between py-3">
                <div>
                  <div className="text-[13px] font-semibold text-text">Stall timeout</div>
                  <div className="text-[12px] text-muted">Time without transfer activity before re-asserting</div>
                </div>
                <Select
                  value={settings?.stallSeconds || 30}
                  options={[
                    { value: 5, label: '5 seconds' },
                    { value: 10, label: '10 seconds' },
                    { value: 30, label: '30 seconds' },
                    { value: 60, label: '60 seconds' },
                  ]}
                  onChange={(v) => setSetting('stallSeconds', v)}
                />
              </div>
              <div className="flex items-center justify-between py-3">
                <div>
                  <div className="text-[13px] font-semibold text-text">Clear completed after</div>
                  <div className="text-[12px] text-muted">Automatically remove completed rows from queue view</div>
                </div>
                <Select
                  value={settings?.clearCompletedDays ?? 7}
                  options={[
                    { value: 0, label: 'Never' },
                    { value: 1, label: '1 day' },
                    { value: 7, label: '7 days' },
                    { value: 30, label: '30 days' },
                  ]}
                  onChange={(v) => setSetting('clearCompletedDays', v)}
                />
              </div>
            </div>
          </Panel>
        </div>

        {/* Files & Folders */}
        <div ref={sectionRefs.files}>
          <Panel title="Files &amp; Folders" icon={<Folder size={18} />}>
            <div className="divide-y divide-border">
              <div className="flex items-center justify-between py-3">
                <div>
                  <div className="text-[13px] font-semibold text-text">App data folder</div>
                  <div className="text-[12px] text-muted">Database and local configuration files</div>
                </div>
                <Button variant="secondary" onClick={() => call('app.openPath', { target: 'appData' })}>Open folder</Button>
              </div>
              <div className="flex items-center justify-between py-3">
                <div>
                  <div className="text-[13px] font-semibold text-text">Application logs</div>
                  <div className="text-[12px] text-muted">Diagnostic log files for troubleshooting</div>
                </div>
                <Button variant="secondary" onClick={() => call('app.openPath', { target: 'logs' })}>Open logs</Button>
              </div>
            </div>
          </Panel>
        </div>

        {/* Notifications */}
        <div ref={sectionRefs.notifications}>
          <Panel title="Notifications" icon={<Bell size={18} />}>
            <div className="divide-y divide-border">
              <div className="flex items-center justify-between py-3">
                <div>
                  <div className="text-[13px] font-semibold text-text">Notify when transfers complete</div>
                  <div className="text-[12px] text-muted">Show desktop notification when downloads or uploads finish</div>
                </div>
                <Toggle checked={settings?.notifyComplete ?? true} onChange={(v) => setSetting('notifyComplete', v)} />
              </div>
              <div className="flex items-center justify-between py-3">
                <div>
                  <div className="text-[13px] font-semibold text-text">Notify on failures</div>
                  <div className="text-[12px] text-muted">Show desktop notification if a transfer permanently fails</div>
                </div>
                <Toggle checked={settings?.notifyFailed ?? true} onChange={(v) => setSetting('notifyFailed', v)} />
              </div>
            </div>
          </Panel>
        </div>

        {/* About */}
        <div ref={sectionRefs.about}>
          <Panel title="About" icon={<Info size={18} />}>
            <div className="divide-y divide-border text-[13px]">
              <div className="flex items-center justify-between py-2.5">
                <span className="text-muted">Mediagram Version</span>
                <span className="font-semibold text-text">{app?.version || '–'}</span>
              </div>
              <div className="flex items-center justify-between py-2.5">
                <span className="text-muted">TDLib Version</span>
                <span className="font-mono text-text">{app?.tdlib || '1.8.66'}</span>
              </div>
              <div className="flex items-center justify-between py-2.5">
                <span className="text-muted">Telegram Status</span>
                {auth?.connection === 'ready' ? (
                  <span className="text-success font-medium flex items-center gap-1.5">
                    <span className="size-2 rounded-full bg-success" />
                    Connected
                  </span>
                ) : auth?.connection === 'updating' ? (
                  <span className="text-warning font-medium flex items-center gap-1.5">
                    <span className="size-2 rounded-full bg-warning animate-pulse" />
                    Updating
                  </span>
                ) : auth?.connection === 'offline' ? (
                  <span className="text-danger font-medium flex items-center gap-1.5">
                    <span className="size-2 rounded-full bg-danger" />
                    Offline
                  </span>
                ) : (
                  <span className="text-warning font-medium flex items-center gap-1.5">
                    <span className="size-2 rounded-full bg-warning animate-pulse" />
                    Connecting
                  </span>
                )}
              </div>
              {app?.installedAt && (
                <div className="flex items-center justify-between py-2.5">
                  <span className="text-muted">Installed On</span>
                  <span className="text-text">{fmtDate(app.installedAt)}</span>
                </div>
              )}
              {app?.repository && (
                <div className="flex items-center justify-between py-2.5">
                  <span className="text-muted">Source Code</span>
                  <a href={app.repository} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-primary hover:underline">
                    <span>GitHub Repository</span>
                    <ExternalLink size={13} />
                  </a>
                </div>
              )}
              <div className="py-2.5">
                <Button variant="secondary" onClick={() => setLicensesOpen(true)} className="text-[12px]">
                  Open-source licenses
                </Button>
              </div>
            </div>
          </Panel>
        </div>

        {/* Danger Zone */}
        <Panel title="Danger Zone" icon={<Trash2 size={18} className="text-danger" />} subtitle="Sign out or delete data stored on this device.">
          <div className="space-y-3 pt-1">
            {/* Account: Log out, or Log in when the session is gone */}
            <div className="rounded-xl border border-danger/30 bg-danger/5 p-4 flex items-center justify-between gap-4">
              <div>
                <div className="text-[13px] font-bold text-danger">{signedIn ? 'Log out' : 'Log in'}</div>
                <div className="text-[12px] text-muted">
                  {signedIn
                    ? 'Signs you out of Telegram on this device. Your saved API data stays, so signing back in is quick.'
                    : 'You are not signed in. Sign back in to use Mediagram.'}
                </div>
              </div>
              {signedIn ? (
                <Button
                  variant="danger"
                  onClick={logout}
                  className="btn-logout shrink-0 px-4 py-2"
                  style={{
                    display: 'inline-flex',
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '8px',
                    whiteSpace: 'nowrap',
                    flexShrink: 0,
                  }}
                >
                  <LogOut size={15} style={{ display: 'inline-block', flexShrink: 0 }} />
                  <span style={{ display: 'inline-block', whiteSpace: 'nowrap' }}>Log out</span>
                </Button>
              ) : (
                <Button variant="primary" onClick={() => navigate('/overview')} className="shrink-0">Log in</Button>
              )}
            </div>

            {/* Clear cache */}
            <div className="rounded-xl border border-border bg-tile/60 p-4 flex items-center justify-between gap-4">
              <div>
                <div className="text-[13px] font-semibold text-text">Clear cache</div>
                <div className="text-[12px] text-muted">
                  Deletes temporary files and thumbnails ({storage ? fmtBytes(storage.cache?.total || 0) : '...'}). Paused downloads restart from the beginning.
                </div>
              </div>
              <Button variant="secondary" disabled={activeCount > 0} onClick={clearCache}>
                {activeCount > 0 ? 'Pause active transfers first' : 'Clear cache'}
              </Button>
            </div>

            {/* Clear app data */}
            <div className="rounded-xl border border-danger/30 bg-danger/5 p-4 flex items-center justify-between gap-4">
              <div>
                <div className="text-[13px] font-bold text-danger">Clear app data</div>
                <div className="text-[12px] text-muted">
                  Deletes history, queue, media index, and settings ({storage ? fmtBytes(storage.appData || 0) : '...'}).
                </div>
              </div>
              <Button variant="danger" disabled={activeCount > 0} onClick={clearData}>
                {activeCount > 0 ? 'Pause active transfers first' : 'Clear app data'}
              </Button>
            </div>
          </div>
        </Panel>
      </div>
    </div>
  )
}
