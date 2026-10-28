import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import type { AppEvent } from '../core/db.ts'
import { createUpdater, sweepUpdaterCache } from '../electron/updater.ts'

test('updater: sweepUpdaterCache safely cleans up %LOCALAPPDATA%\\mediagram-updater if present', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mediagram-updater-test-'))
  const origLocal = process.env.LOCALAPPDATA
  try {
    process.env.LOCALAPPDATA = tmpDir
    const mockCache = path.join(tmpDir, 'mediagram-updater')
    fs.mkdirSync(path.join(mockCache, 'pending'), { recursive: true })
    fs.writeFileSync(path.join(mockCache, 'pending', 'installer.exe'), 'test')

    assert.equal(fs.existsSync(mockCache), true)
    sweepUpdaterCache()
    assert.equal(fs.existsSync(mockCache), false)
  } finally {
    process.env.LOCALAPPDATA = origLocal
    fs.rmSync(tmpDir, { recursive: true, force: true })
  }
})

test('updater: dev mode returns idle and simulated check without crashing', async () => {
  const events: AppEvent[] = []
  let quitPrepared = false

  const updater = createUpdater({
    emit: (e) => events.push(e),
    paths: { home: '', appDir: '', db: '', tdlib: '', thumbs: '', tmp: '', logs: '', chromium: '' },
    isPackaged: false,
    prepareForQuit: async () => { quitPrepared = true },
  })

  assert.deepEqual(updater.getStatus(), { status: 'idle' })

  // Silent background check (manual = false) should NOT emit 'checking' state
  const backgroundResult = await updater.checkForUpdates(false)
  assert.equal(backgroundResult.status, 'idle')
  const hadCheckingEvent = events.some((e) => e.type === 'update' && (e as any).state?.status === 'checking')
  assert.equal(hadCheckingEvent, false, 'background check must not emit checking state')

  // Manual check (manual = true) emits checking then finishes with idle
  const manualPromise = updater.checkForUpdates(true)
  assert.equal(events.some((e) => e.type === 'update' && (e as any).state?.status === 'checking'), true)
  const manualResult = await manualPromise
  assert.equal(manualResult.status, 'idle')

  // Calling quitAndInstall in dev mode logs and does not throw
  await updater.quitAndInstall()
  assert.equal(quitPrepared, false) // Dev mode skips real shutdown

  updater.destroy()
})

function formatReleaseUrl(repo: string | null | undefined, version: string | null | undefined) {
  const base = repo || 'https://github.com/Webovignesh/Mediagram'
  const raw = version || ''
  const tag = raw.startsWith('v') ? raw : `v${raw}`
  return raw ? `${base}/releases/tag/${tag}` : `${base}/releases`
}

test('updater: release URL formation properly targets tagged GitHub releases', () => {
  assert.equal(
    formatReleaseUrl('https://github.com/Webovignesh/Mediagram', '1.1.0'),
    'https://github.com/Webovignesh/Mediagram/releases/tag/v1.1.0'
  )
  assert.equal(
    formatReleaseUrl('https://github.com/Webovignesh/Mediagram', 'v1.2.0'),
    'https://github.com/Webovignesh/Mediagram/releases/tag/v1.2.0'
  )
  assert.equal(
    formatReleaseUrl(null, '2.0.0'),
    'https://github.com/Webovignesh/Mediagram/releases/tag/v2.0.0'
  )
  assert.equal(
    formatReleaseUrl(null, ''),
    'https://github.com/Webovignesh/Mediagram/releases'
  )
})
