import { useState, useRef, useEffect } from 'react'
import { Download, Loader2, ChevronDown, X, Sparkles, AlertCircle, RefreshCw } from 'lucide-react'
import { useUpdater } from './api.ts'

export function UpdatePill() {
  const { update, checkForUpdates, quitAndInstall, dismiss } = useUpdater()
  const [showFlyout, setShowFlyout] = useState(false)
  const [isRestarting, setIsRestarting] = useState(false)
  const flyoutRef = useRef<HTMLDivElement>(null)

  // Close flyout when clicking outside
  useEffect(() => {
    if (!showFlyout) return
    const handleClickOutside = (e: MouseEvent) => {
      if (flyoutRef.current && !flyoutRef.current.contains(e.target as Node)) {
        setShowFlyout(false)
      }
    }
    window.addEventListener('mousedown', handleClickOutside)
    return () => window.removeEventListener('mousedown', handleClickOutside)
  }, [showFlyout])

  const handleRestart = async () => {
    setIsRestarting(true)
    try {
      await quitAndInstall()
    } catch {
      setIsRestarting(false)
    }
  }

  // 1. Idle state: zero footprint, pristine top bar
  if (update.status === 'idle') {
    return null
  }

  // 2. Checking state: subtle minimal spinner
  if (update.status === 'checking') {
    return (
      <div
        className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-surface-raised/80 border border-border/40 text-[11px] text-muted select-none shadow-sm backdrop-blur-md"
        title="Checking for updates..."
      >
        <Loader2 className="w-3 h-3 animate-spin text-primary" />
        <span className="font-medium">Checking updates...</span>
      </div>
    )
  }

  // 3. Downloading / Available state: micro-progress bar and percent
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

  // 4. Ready state: interactive pill with glowing pulse badge & flyout card
  if (update.status === 'ready') {
    return (
      <div className="relative" ref={flyoutRef}>
        <button
          type="button"
          onClick={() => setShowFlyout(!showFlyout)}
          className="group flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-primary/15 hover:bg-primary/25 active:scale-95 border border-primary/40 text-[11.5px] font-medium text-primary select-none transition-all shadow-sm cursor-pointer"
          title="Update ready to install — click to restart"
        >
          {/* Glowing pulse indicator */}
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
          </span>
          <span>Update ready</span>
          {update.version ? (
            <span className="font-mono text-[10.5px] opacity-80">v{update.version}</span>
          ) : null}
          <ChevronDown
            className={`w-3 h-3 opacity-60 group-hover:opacity-100 transition-transform duration-200 ${
              showFlyout ? 'rotate-180' : ''
            }`}
          />
        </button>

        {/* Floating popover anchored under the pill */}
        {showFlyout && (
          <div className="absolute right-0 top-full mt-2 w-80 rounded-xl bg-surface/95 backdrop-blur-xl border border-border shadow-2xl p-4 z-50 text-left select-text animate-in fade-in zoom-in-95 duration-150">
            {/* Header */}
            <div className="flex items-start justify-between gap-2 border-b border-border/40 pb-2.5 mb-2.5">
              <div className="flex items-center gap-2">
                <div className="p-1.5 rounded-lg bg-primary/10 text-primary">
                  <Sparkles className="w-4 h-4" />
                </div>
                <div>
                  <h4 className="text-[13px] font-semibold text-foreground">
                    Mediagram {update.version ? `v${update.version}` : 'Update'}
                  </h4>
                  <p className="text-[11px] text-emerald-400 font-medium">Ready to install</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowFlyout(false)}
                className="p-1 rounded-md text-muted hover:text-foreground hover:bg-surface-raised transition-colors cursor-pointer"
                title="Close"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Release notes summary */}
            <div className="mb-3.5">
              <div className="text-[11px] font-semibold text-muted uppercase tracking-wider mb-1">
                What's New
              </div>
              <div className="max-h-32 overflow-y-auto text-[11.5px] text-muted-foreground leading-relaxed bg-surface-raised/40 rounded-lg p-2 border border-border/20 [scrollbar-gutter:stable]">
                {update.releaseNotes ? (
                  <div className="whitespace-pre-line">{update.releaseNotes}</div>
                ) : (
                  <p>Performance improvements, transfer reliability, and bug fixes.</p>
                )}
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-2 pt-1">
              <button
                type="button"
                onClick={handleRestart}
                disabled={isRestarting}
                className="flex-1 flex items-center justify-center gap-1.5 py-1.5 px-3 rounded-lg bg-primary text-primary-foreground text-[12px] font-medium shadow-sm hover:brightness-110 active:scale-[0.98] transition-all disabled:opacity-60 cursor-pointer"
              >
                {isRestarting ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Restarting...</span>
                  </>
                ) : (
                  <>
                    <RefreshCw className="w-3.5 h-3.5" />
                    <span>Restart & Update</span>
                  </>
                )}
              </button>
              <button
                type="button"
                onClick={() => setShowFlyout(false)}
                className="py-1.5 px-3 rounded-lg border border-border/60 hover:bg-surface-raised text-[12px] text-muted-foreground hover:text-foreground transition-all cursor-pointer"
              >
                Later
              </button>
            </div>
          </div>
        )}
      </div>
    )
  }

  // 5. Error state
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

  return null
}
