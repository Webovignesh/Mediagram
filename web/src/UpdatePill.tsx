import { useState } from 'react'
import { Download, Loader2, X, AlertCircle, RefreshCw } from 'lucide-react'
import { useUpdater, useCall } from './api.ts'

function checkFreshOpenChangelog(version: string | undefined): boolean {
  if (!version) return false
  const LAST_SEEN_KEY = 'mediagram_last_seen_version'
  const DISMISSED_KEY = 'mediagram_changelog_dismissed_version'
  const SESSION_KEY = `mediagram_fresh_update_${version}`

  try {
    const prevVersion = localStorage.getItem(LAST_SEEN_KEY)
    const dismissed = localStorage.getItem(DISMISSED_KEY)
    const sessionFresh = sessionStorage.getItem(SESSION_KEY)

    if (dismissed === version) return false
    if (sessionFresh === 'true') return true

    // If user had a previously recorded version and now opened a newer/different version
    if (prevVersion && prevVersion !== version) {
      sessionStorage.setItem(SESSION_KEY, 'true')
      localStorage.setItem(LAST_SEEN_KEY, version)
      return true
    }

    // Check if user is an existing user upgrading from an older version that didn't track version
    const isExistingUser = Boolean(
      localStorage.getItem('mediagram_theme') ||
      localStorage.getItem('mediagram_notification_settings_v1') ||
      localStorage.getItem('mediagram_downloads_view') ||
      localStorage.getItem('mediagram_queue_tab')
    )

    if (!prevVersion && isExistingUser) {
      sessionStorage.setItem(SESSION_KEY, 'true')
      localStorage.setItem(LAST_SEEN_KEY, version)
      return true
    }

    if (!prevVersion) {
      // Brand new installation: mark current version so future updates trigger the pill
      localStorage.setItem(LAST_SEEN_KEY, version)
      return false
    }
  } catch {
    // Storage unavailable or disabled
  }
  return false
}

export function UpdatePill() {
  const { update, checkForUpdates, quitAndInstall, dismiss } = useUpdater()
  const { data: appInfo } = useCall<{ version: string; repository: string | null }>('app.info')
  const [isRestarting, setIsRestarting] = useState(false)
  const [dismissedVersion, setDismissedVersion] = useState<string | null>(null)

  const showChangelog = Boolean(
    appInfo?.version &&
    dismissedVersion !== appInfo.version &&
    checkFreshOpenChangelog(appInfo.version)
  )

  const handleRestart = async () => {
    setIsRestarting(true)
    try {
      if (appInfo?.version) {
        localStorage.setItem('mediagram_last_seen_version', appInfo.version)
      }
      await quitAndInstall()
    } catch {
      setIsRestarting(false)
    }
  }

  const handleDismissChangelog = () => {
    if (appInfo?.version) {
      try {
        localStorage.setItem('mediagram_changelog_dismissed_version', appInfo.version)
        sessionStorage.removeItem(`mediagram_fresh_update_${appInfo.version}`)
      } catch {}
      setDismissedVersion(appInfo.version)
    }
  }

  const handleOpenChangelog = () => {
    if (!appInfo?.version) return
    const repo = appInfo.repository || 'https://github.com/Webovignesh/Mediagram'
    const rawVersion = appInfo.version
    const tag = rawVersion.startsWith('v') ? rawVersion : `v${rawVersion}`
    const releaseUrl = `${repo}/releases/tag/${tag}`

    window.open(releaseUrl, '_blank')
    handleDismissChangelog()
  }

  // 1. Downloading / Available state: micro-progress bar and percent (only shown when an update is really available)
  if (update.status === 'downloading' || update.status === 'available') {
    const percent = Math.min(100, Math.max(0, update.percent ?? 0))
    return (
      <div
        className="relative flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-surface-raised/90 border border-primary/30 text-[11px] text-foreground select-none shadow-sm backdrop-blur-md overflow-hidden"
        title={`Downloading update: ${percent}%`}
      >
        <Download className="w-3 h-3 text-primary animate-pulse" />
        <span className="font-medium tracking-tight">
          {update.version ? `v${update.version}` : 'Update'} · {percent}%
        </span>
        {/* Hairline progress indicator on bottom border */}
        <div
          className="absolute bottom-0 left-0 h-[2px] bg-primary transition-all duration-300"
          style={{ width: `${percent}%` }}
        />
      </div>
    )
  }

  // 2. Ready state: clean direct pill to restart & update immediately (no flyout popover)
  if (update.status === 'ready') {
    return (
      <button
        type="button"
        onClick={handleRestart}
        disabled={isRestarting}
        className="group flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-500/15 hover:bg-emerald-500/25 active:scale-95 border border-emerald-500/40 text-[11.5px] font-medium text-emerald-400 select-none transition-all shadow-sm cursor-pointer disabled:opacity-60"
        title="Update ready to install — click to restart"
      >
        {isRestarting ? (
          <>
            <Loader2 className="w-3 h-3 animate-spin text-emerald-400" />
            <span>Restarting...</span>
          </>
        ) : (
          <>
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
            </span>
            <RefreshCw className="w-3 h-3 text-emerald-400 group-hover:rotate-180 transition-transform duration-500" />
            <span>Restart & Update</span>
            {update.version ? (
              <span className="font-mono text-[10.5px] opacity-80">v{update.version}</span>
            ) : null}
          </>
        )}
      </button>
    )
  }

  // 3. Error state (only shown if a manual check failed)
  if (update.status === 'error') {
    return (
      <div className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-destructive/10 border border-destructive/30 text-[11px] text-destructive shadow-sm select-none">
        <AlertCircle className="w-3 h-3" />
        <span className="truncate max-w-[140px]" title={update.error || 'Update check failed'}>
          Update error
        </span>
        <button
          type="button"
          onClick={() => checkForUpdates()}
          className="hover:underline font-semibold ml-0.5 cursor-pointer"
          title="Retry"
        >
          Retry
        </button>
        <button
          type="button"
          onClick={() => dismiss()}
          className="p-0.5 hover:bg-destructive/20 rounded cursor-pointer"
          title="Dismiss"
        >
          <X className="w-3 h-3" />
        </button>
      </div>
    )
  }

  // 4. Fresh open changelog pill (only shown once on the fresh launch after an update is installed)
  if (showChangelog) {
    const rawVersion = appInfo?.version || ''
    const tag = rawVersion ? (rawVersion.startsWith('v') ? rawVersion : `v${rawVersion}`) : ''

    return (
      <div
        role="button"
        tabIndex={0}
        onClick={handleOpenChangelog}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            handleOpenChangelog()
          }
        }}
        className="group flex items-center gap-1.5 pl-3 pr-1.5 py-0.5 rounded-full bg-[#0078d4] hover:bg-[#0271c6] active:scale-95 text-white select-none transition-all shadow-md cursor-pointer border border-[#0078d4]/40 animate-in fade-in duration-200"
        title={tag ? `View changelog for ${tag} on GitHub` : 'View changelog on GitHub'}
      >
        <span className="text-[12px] font-semibold tracking-tight text-white">View Changelog</span>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            handleDismissChangelog()
          }}
          className="p-0.5 rounded-full hover:bg-white/20 active:scale-90 transition-all text-white/90 hover:text-white cursor-pointer ml-0.5"
          title="Dismiss"
          aria-label="Dismiss changelog"
        >
          <X className="w-3.5 h-3.5 stroke-[2.5]" />
        </button>
      </div>
    )
  }

  // 5. Idle / Checking state: completely silent in the background
  return null
}
