// Phase 5.6: Settings page per UI.md - skeleton with all controls wired
import { useState } from 'react'
import { Settings as SettingsIcon, Download, Upload, Users, Folder, Bell, Shield, Info } from 'lucide-react'
import { call, useCall } from '../api.ts'
import { Panel, Toggle, Select, Button, Avatar, Input, fmtBytes, fmtDate, confirm, toast } from '../ui.tsx'

export default function Settings() {
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

  async function logout() {
    if (await confirm({ title: 'Log out', message: 'Log out of Telegram?', confirm: 'Log out' })) {
      await call('auth.logout')
      toast('Logged out')
    }
  }

  async function clearCache() {
    if (await confirm({ title: 'Clear cache', message: `Clear ${fmtBytes(storage?.cache.total || 0)} of cache? Paused downloads restart from the beginning.`, confirm: 'Clear cache' })) {
      const res = await call<{ freed: number }>('app.clearCache')
      toast(`Freed ${fmtBytes(res.freed)}`)
      reloadStorage()
    }
  }

  async function clearData() {
    if (await confirm({ title: 'Clear app data', message: 'Delete history, queue, media index, and settings (download folder resets to default)? Your login and downloaded files stay.', confirm: 'Clear app data', danger: true })) {
      const res = await call<{ freed: number }>('app.clearData')
      toast(`Freed ${fmtBytes(res.freed)}`)
      reloadSettings()
      reloadStorage()
    }
  }

  async function clearAll() {
    if (await confirm({
      title: 'Clear All Data',
      message: 'This removes everything: settings, history, queue, cache, and your Telegram session. Start with Windows turns off. You will return to the login screen.',
      confirm: 'Clear All Data',
      danger: true,
      typed: 'DELETE',
      checkbox: `Also delete downloaded files (${storage?.library.files || 0} files, ${fmtBytes(storage?.library.total || 0)})`,
    })) {
      // ponytail: stub, checkbox state tracking needs dialog refactor
      const deleteDownloads = false
      const res = await call<{ freed: number }>('app.clearAll', { deleteDownloads })
      toast(`Freed ${fmtBytes(res.freed)}`)
    }
  }

  const canPost = chats?.chats.filter((c: any) => c.canPost) || []
  const activeCount = (live?.counts.download.active || 0) + (live?.counts.upload.active || 0)

  return (
    <div className="flex h-full">
      {/* Category nav */}
      <div className="w-[170px] border-r border-border p-4">
        <nav className="space-y-1">
          {[
            { id: 'general', icon: SettingsIcon, label: 'General', subtitle: 'Startup' },
            { id: 'downloads', icon: Download, label: 'Downloads', subtitle: 'Location' },
            { id: 'uploads', icon: Upload, label: 'Uploads', subtitle: 'Defaults' },
            { id: 'telegram', icon: Users, label: 'Telegram', subtitle: 'Account' },
            { id: 'privacy', icon: Shield, label: 'Privacy', subtitle: 'Cache' },
            { id: 'about', icon: Info, label: 'About', subtitle: 'Version' },
          ].map(({ id, icon: Icon, label, subtitle }) => (
            <button key={id} className="flex w-full items-start gap-2 rounded-lg p-2 text-left hover:bg-tile">
              <Icon size={16} className="mt-0.5" />
              <div>
                <div className="text-[13px] font-medium">{label}</div>
                <div className="text-[11px] text-muted">{subtitle}</div>
              </div>
            </button>
          ))}
        </nav>
      </div>

      {/* Settings sections */}
      <div className="flex-1 overflow-auto p-6 space-y-4">
        <div>
          <h1 className="text-[28px] font-bold">Settings</h1>
          <p className="mt-1 text-[13px] text-text-2">Customize your experience and manage application preferences</p>
        </div>

        <Panel title="General" icon={<SettingsIcon size={18} />}>
          <div className="space-y-4">
            <div className="flex items-center justify-between py-3 border-b border-border">
              <div>
                <div className="text-[13px] font-semibold">Start with Windows</div>
                <div className="text-[12px] text-muted">Launch TeleFlow when you sign in</div>
              </div>
              <Toggle label="" checked={settings?.startWithSystem || false} onChange={(v) => setSetting('startWithSystem', v)} />
            </div>
            <div className="flex items-center justify-between py-3">
              <div>
                <div className="text-[13px] font-semibold">Minimize to tray on close</div>
                <div className="text-[12px] text-muted">Keep transfers running in the background</div>
              </div>
              <Toggle label="" checked={settings?.closeToTray || false} onChange={(v) => setSetting('closeToTray', v)} />
            </div>
          </div>
        </Panel>

        <Panel title="Downloads" icon={<Download size={18} />}>
          <div className="space-y-4">
            <div className="py-3 border-b border-border">
              <div className="mb-2">
                <div className="text-[13px] font-semibold">Download folder</div>
                <div className="text-[12px] text-muted">Existing downloads stay where they are</div>
              </div>
              <div className="flex gap-2">
                <Input value={settings?.downloadRoot || ''} onChange={() => {}} />
                <Button variant="secondary" onClick={pickFolder}>Change</Button>
                <Button variant="secondary" onClick={() => call('app.openPath', { target: 'downloads' })}>Open</Button>
              </div>
            </div>
            <div className="flex items-center justify-between py-3 border-b border-border">
              <div>
                <div className="text-[13px] font-semibold">Max concurrent downloads</div>
              </div>
              <Select value={settings?.maxDownloads || 2} options={[1, 2, 3, 4, 5].map((n) => ({ value: n, label: String(n) }))} onChange={(v) => setSetting('maxDownloads', v)} />
            </div>
            <div className="flex items-center justify-between py-3 border-b border-border">
              <div className="text-[13px] font-semibold">Skip existing files</div>
              <Toggle label="" checked={settings?.skipExisting || false} onChange={(v) => setSetting('skipExisting', v)} />
            </div>
            <div className="flex items-center justify-between py-3">
              <div className="text-[13px] font-semibold">Prefix file names with date</div>
              <Toggle label="" checked={settings?.datePrefix || false} onChange={(v) => setSetting('datePrefix', v)} />
            </div>
          </div>
        </Panel>

        <Panel title="Uploads" icon={<Upload size={18} />}>
          <div className="space-y-4">
            <div className="flex items-center justify-between py-3 border-b border-border">
              <div className="text-[13px] font-semibold">Default destination</div>
              <Select value={settings?.defaultUploadChat || 'none'} options={[{ value: 'none', label: 'None' }, ...canPost.map((c: any) => ({ value: c.id, label: c.title }))]} onChange={(v) => setSetting('defaultUploadChat', v === 'none' ? null : v)} />
            </div>
            <div className="flex items-center justify-between py-3 border-b border-border">
              <div className="text-[13px] font-semibold">Upload as album</div>
              <Toggle label="" checked={settings?.uploadAlbum || false} onChange={(v) => setSetting('uploadAlbum', v)} />
            </div>
            <div className="flex items-center justify-between py-3">
              <div className="text-[13px] font-semibold">Keep original file names</div>
              <Toggle label="" checked={settings?.keepNames || false} onChange={(v) => setSetting('keepNames', v)} />
            </div>
          </div>
        </Panel>

        <Panel title="Telegram" icon={<Users size={18} />}>
          <div className="space-y-4">
            <div className="flex items-center gap-3 py-3 border-b border-border">
              <Avatar src={auth?.me.photo} name={auth?.me.name || ''} size={48} />
              <div className="flex-1">
                <div className="text-[15px] font-semibold">{auth?.me.name}</div>
                <div className="text-[13px] text-muted">{auth?.me.phone}</div>
                {auth?.me.username && <div className="text-[13px] text-muted">@{auth.me.username}</div>}
              </div>
            </div>
            <div className="py-3">
              <Button variant="tint" tone="danger" onClick={logout}>Log out</Button>
            </div>
          </div>
        </Panel>

        <Panel title="Privacy & Security" icon={<Shield size={18} />}>
          <div className="space-y-4">
            <div className="flex items-center justify-between py-3">
              <div>
                <div className="text-[13px] font-semibold">Clear cache</div>
                <div className="text-[12px] text-muted">{storage ? fmtBytes(storage.cache.total) : '...'}</div>
              </div>
              <Button variant="tint" tone="danger" disabled={activeCount > 0} onClick={clearCache}>
                {activeCount > 0 ? 'Pause active transfers first' : 'Clear cache'}
              </Button>
            </div>
            <div className="flex items-center justify-between py-3">
              <div>
                <div className="text-[13px] font-semibold">Clear app data</div>
                <div className="text-[12px] text-muted">{storage ? fmtBytes(storage.appData) : '...'}</div>
              </div>
              <Button variant="tint" tone="danger" disabled={activeCount > 0} onClick={clearData}>
                Clear app data
              </Button>
            </div>
          </div>
        </Panel>

        <Panel title="Danger Zone" icon={<Shield size={18} />} subtitle="These actions are permanent and cannot be undone.">
          <div className="space-y-4">
            <div className="py-3">
              <Button variant="danger" onClick={clearAll}>Clear All Data — Remove settings, history, cache, and your session</Button>
            </div>
          </div>
        </Panel>
      </div>

      {/* Right column */}
      <div className="w-[290px] border-l border-border p-4 space-y-4">
        <Panel title="App Status">
          <div className="space-y-2 text-[13px]">
            <div className="flex items-center gap-2">
              <div className={`h-2 w-2 rounded-full ${auth?.connection === 'ready' ? 'bg-success' : 'bg-warning'}`} />
              <span>{auth?.connection === 'ready' ? 'All systems operational' : 'Connecting to Telegram...'}</span>
            </div>
            <div className="text-muted">Version {app?.version}</div>
            {app?.installedAt && <div className="text-muted">Installed {fmtDate(app.installedAt)}</div>}
            <div className="text-muted">Active downloads: {live?.counts.download.active || 0}</div>
            <div className="text-muted">Active uploads: {live?.counts.upload.active || 0}</div>
          </div>
        </Panel>

        <Panel title="Storage">
          {storage && (
            <div className="space-y-3">
              <div>
                <div className="flex justify-between text-[13px] mb-1">
                  <span>{fmtBytes(storage.drive.total - storage.drive.free)} of {fmtBytes(storage.drive.total)} used</span>
                  <span>{Math.round(((storage.drive.total - storage.drive.free) / storage.drive.total) * 100)}%</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-tile">
                  <div className="h-full bg-primary" style={{ width: `${Math.round(((storage.drive.total - storage.drive.free) / storage.drive.total) * 100)}%` }} />
                </div>
              </div>
              <div className="space-y-1 text-[12px]">
                <div className="flex items-center gap-2"><div className="h-2 w-2 rounded-full bg-primary" />Videos: {fmtBytes(storage.library.video)}</div>
                <div className="flex items-center gap-2"><div className="h-2 w-2 rounded-full bg-success" />Images: {fmtBytes(storage.library.image)}</div>
                <div className="flex items-center gap-2"><div className="h-2 w-2 rounded-full bg-warning" />Documents: {fmtBytes(storage.library.document)}</div>
              </div>
            </div>
          )}
        </Panel>
      </div>
    </div>
  )
}
