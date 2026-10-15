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
  const result = await updater.checkForUpdates()
  assert.equal(result.status, 'idle')

  // Calling quitAndInstall in dev mode logs and does not throw
  await updater.quitAndInstall()
  assert.equal(quitPrepared, false) // Dev mode skips real shutdown

  updater.destroy()
})
