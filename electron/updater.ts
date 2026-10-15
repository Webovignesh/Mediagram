// Over-the-air update controller for Mediagram (ARCHITECTURE > Desktop integration).
import fs from 'node:fs'
import path from 'node:path'
import type { Emit, UpdateState } from '../core/db.ts'
import type { Paths } from '../core/storage.ts'
import { log } from '../core/storage.ts'

export type Updater = {
  getStatus: () => UpdateState
  checkForUpdates: (manual?: boolean) => Promise<UpdateState>
  quitAndInstall: () => Promise<void>
  dismiss: () => UpdateState
  destroy: () => void
}

export type UpdaterOptions = {
  emit: Emit
  paths: Paths
  isPackaged: boolean
  prepareForQuit: () => Promise<void>
}

/** Sweeps any lingering %LOCALAPPDATA%\mediagram-updater directory to ensure clean updates. */
export function sweepUpdaterCache() {
  try {
    const local = process.env.LOCALAPPDATA || path.join(process.env.USERPROFILE || '', 'AppData', 'Local')
    const updaterDir = path.join(local, 'mediagram-updater')
    if (fs.existsSync(updaterDir)) {
      fs.rmSync(updaterDir, { recursive: true, force: true })
      log('info', 'updater: swept %LOCALAPPDATA%\\mediagram-updater cache directory')
    }
  } catch (err) {
    log('warn', `updater: cache sweep skipped: ${(err as Error).message}`)
  }
}

export function createUpdater({ emit, paths: _paths, isPackaged, prepareForQuit }: UpdaterOptions): Updater {
  let state: UpdateState = { status: 'idle' }
  let checkTimer: NodeJS.Timeout | undefined
  let initialDelayTimer: NodeJS.Timeout | undefined
  let autoUpdaterInstance: any = null
  let isManualCheck = false

  const setState = (next: UpdateState) => {
    state = next
    emit({ type: 'update', state })
  }

  // Pre-startup sweep of any lingering updater artifacts from previous sessions
  sweepUpdaterCache()

  if (!isPackaged) {
    log('info', 'updater: running in development mode (automatic background check disabled)')
    return {
      getStatus: () => state,
      checkForUpdates: async (_manual?: boolean) => {
        setState({ status: 'checking' })
        await new Promise((r) => setTimeout(r, 800))
        setState({ status: 'idle' })
        return state
      },
      quitAndInstall: async () => {
        log('info', 'updater: quitAndInstall requested in dev mode (simulating)')
      },
      dismiss: () => {
        setState({ status: 'idle' })
        return state
      },
      destroy: () => {},
    }
  }

  // Initialize electron-updater asynchronously in packaged mode
  const initAutoUpdater = async () => {
    if (autoUpdaterInstance) return autoUpdaterInstance
    const mod: any = await import('electron-updater')
    const autoUpdater = mod.autoUpdater ?? mod.default?.autoUpdater ?? mod.default
    if (!autoUpdater) {
      throw new Error('Could not resolve autoUpdater from electron-updater')
    }
    autoUpdaterInstance = autoUpdater

    autoUpdater.logger = {
      info: (msg: unknown) => log('info', `updater: ${String(msg)}`),
      warn: (msg: unknown) => log('warn', `updater: ${String(msg)}`),
      error: (msg: unknown) => log('error', `updater: ${String(msg)}`),
      debug: () => {},
    }

    autoUpdater.autoDownload = true
    autoUpdater.autoInstallOnAppQuit = true
    autoUpdater.allowPrerelease = false
    autoUpdater.disableWebInstaller = true

    autoUpdater.on('checking-for-update', () => {
      setState({ status: 'checking', version: state.version })
    })

    autoUpdater.on('update-not-available', () => {
      log('info', 'updater: app is up to date')
      setState({ status: 'idle' })
    })

    autoUpdater.on('update-available', (info: any) => {
      const releaseNotes = typeof info.releaseNotes === 'string'
        ? info.releaseNotes
        : Array.isArray(info.releaseNotes)
          ? info.releaseNotes.map((n: any) => (typeof n === 'string' ? n : n.note)).join('\n')
          : undefined

      setState({
        status: 'available',
        version: info.version,
        releaseNotes,
      })
    })

    autoUpdater.on('download-progress', (progress: any) => {
      setState({
        status: 'downloading',
        version: state.version,
        percent: Math.round(progress.percent),
        bytesPerSecond: progress.bytesPerSecond,
        transferredBytes: progress.transferred,
        totalBytes: progress.total,
        releaseNotes: state.releaseNotes,
      })
    })

    autoUpdater.on('update-downloaded', (info: any) => {
      setState({
        status: 'ready',
        version: info.version,
        percent: 100,
        releaseNotes: state.releaseNotes,
      })
    })

    autoUpdater.on('error', (err: any) => {
      const errorMsg = (err as Error)?.message || 'Update check failed'
      log('warn', `updater error: ${errorMsg}`)

      // If 404 / latest.yml not found / No published versions, the repo has no newer release
      const isNotFound = /404|not found|no published versions/i.test(errorMsg)
      if (isNotFound) {
        log('info', 'updater: no newer release found on GitHub (app is up to date)')
        setState({ status: 'idle' })
        return
      }

      // Suppress disruptive error pill on silent background checks
      if (!isManualCheck) {
        log('info', `updater: background check failed (${errorMsg}); keeping status idle`)
        setState({ status: 'idle' })
        return
      }

      setState({
        status: 'error',
        version: state.version,
        error: errorMsg,
        releaseNotes: state.releaseNotes,
      })
    })

    return autoUpdater
  }

  const checkForUpdates = async (manual = false): Promise<UpdateState> => {
    isManualCheck = manual
    try {
      if (manual) {
        setState({ status: 'checking', version: state.version })
      }
      const u = await initAutoUpdater()
      await u.checkForUpdates()
    } catch (err) {
      const msg = (err as Error)?.message || 'Update check failed'
      log('warn', `updater: checkForUpdates error: ${msg}`)
      const isNotFound = /404|not found|no published versions/i.test(msg)
      if (isNotFound || !manual) {
        setState({ status: 'idle' })
      } else {
        setState({ status: 'error', error: msg })
      }
    }
    return state
  }

  const quitAndInstall = async () => {
    log('info', 'updater: quitAndInstall initiated; preparing application for clean restart')
    try {
      // Gracefully close TDLib, flush SQLite WAL, pause active engine downloads
      await prepareForQuit()
    } catch (err) {
      log('warn', `updater: pre-restart preparation encountered error: ${(err as Error).message}`)
    }
    // Clean updater scratch directories before launching new binary
    sweepUpdaterCache()
    // Restart into updated application
    const u = await initAutoUpdater()
    setImmediate(() => {
      u.quitAndInstall(false, true)
    })
  }

  const dismiss = () => {
    setState({ status: 'idle' })
    return state
  }

  // Initial update check: wait 20 seconds after launch so app startup is instant
  initialDelayTimer = setTimeout(() => {
    checkForUpdates(false).catch(() => {})
  }, 20_000)

  // Periodic check every 6 hours
  checkTimer = setInterval(() => {
    checkForUpdates(false).catch(() => {})
  }, 6 * 60 * 60 * 1000)

  const destroy = () => {
    clearTimeout(initialDelayTimer)
    clearInterval(checkTimer)
    if (autoUpdaterInstance) {
      autoUpdaterInstance.removeAllListeners()
    }
  }

  return {
    getStatus: () => state,
    checkForUpdates,
    quitAndInstall,
    dismiss,
    destroy,
  }
}
