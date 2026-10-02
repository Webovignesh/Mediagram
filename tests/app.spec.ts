// Packaged smoke test (needs `npm run dist`). The exe is launched through its lowercased path, so the renderer URL
// gets a lowercase drive letter that Chromium uppercases: a working Login proves the IPC sender check (Bridge step 1).
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { _electron as electron, expect, test } from '@playwright/test'

const exe = (fs.existsSync(path.resolve('release/win-unpacked/Mediagram.exe'))
  ? path.resolve('release/win-unpacked/Mediagram.exe')
  : path.resolve('release/win-unpacked/TeleFlow.exe')).toLowerCase()
const homes: string[] = []
const tempHome = () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'teleflow-'))
  homes.push(home)
  return home
}
const launch = (home: string) => electron.launch({ executablePath: exe, env: { ...process.env, TELEFLOW_HOME: home } })

test.afterAll(() => {
  for (const home of homes) fs.rmSync(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 })
})

test('packaged exe boots, loads TDLib, and shows the API Keys step', async () => {
  test.setTimeout(120_000)
  const home = tempHome()
  fs.mkdirSync(path.join(home, 'thumbs'))
  fs.copyFileSync('assets/icon.png', path.join(home, 'thumbs', '1.jpg')) // a saved thumbnail (Blink decodes by content)
  const app = await launch(home)
  try {
    const win = await app.firstWindow()
    await expect(win.getByLabel('API ID')).toBeVisible()
    await expect(win.getByLabel('API hash')).toBeVisible()
    await expect(win.getByRole('link', { name: 'Get them at my.telegram.org' })).toHaveAttribute('href', 'https://my.telegram.org')

    const info = await win.evaluate(() => window.teleflow.call('app.info'))
    expect(info).toMatchObject({ ok: true, data: { tdlib: '1.8.66', home, repository: 'https://github.com/Webovignesh/tele' } })

    // Continue reaches main and shows its 400 inline. The hash is malformed, so no TDLib client starts and nothing goes to Telegram.
    await win.getByLabel('API ID').fill('12345')
    await win.getByLabel('API hash').fill('not-a-hash')
    await win.getByRole('button', { name: 'Continue' }).click()
    await expect(win.getByRole('alert')).toHaveText('apiHash must be the 32-character hash from my.telegram.org')

    // SQLite opens in the packaged main process; settings come back with their defaults and no credentials.
    const settings = await win.evaluate(() => window.teleflow.call('settings.get'))
    expect(settings).toMatchObject({ ok: true, data: { apiId: null, maxDownloads: 2, folderTemplate: '{chat}' } })
    expect(fs.existsSync(path.join(home, 'teleflow.db'))).toBe(true)

    // teleflow:// is privileged, allowed by the CSP for <img>, and served from home\thumbs; a missing id is a 404.
    const load = (src: string) => win.evaluate((s) => new Promise<number>((resolve) => {
      const img = new Image()
      img.onload = () => resolve(img.naturalWidth)
      img.onerror = () => resolve(0)
      img.src = s
    }), src)
    expect(await load('teleflow://saved/1')).toBe(256)
    expect(await load('teleflow://saved/2')).toBe(0)

    // Sandboxed CJS preload exposes webUtils.getPathForFile (a File not from disk has no path).
    expect(await win.evaluate(() => window.teleflow.pathOf(new File(['x'], 'x.txt')))).toBe('')

    // The drag strip keeps clear of the native window buttons drawn by titleBarOverlay.
    const pad = await win.evaluate(() => parseFloat(getComputedStyle(document.querySelector('.drag')!).paddingRight))
    expect(pad).toBeGreaterThan(0)

    // Clear cache relies on these session APIs (ARCHITECTURE > Storage and maintenance).
    const cacheSize = await app.evaluate(async ({ session }) => {
      const size = await session.defaultSession.getCacheSize()
      await session.defaultSession.clearCodeCaches({})
      return size
    })
    expect(cacheSize).toBeGreaterThanOrEqual(0)

    // A second launch with the same home hands over to the running app and exits.
    const second = spawn(exe, [], { env: { ...process.env, TELEFLOW_HOME: home } })
    const code = await new Promise<number | null>((resolve, reject) => {
      const timer = setTimeout(() => { second.kill(); reject(new Error('second instance kept running')) }, 20_000)
      second.on('exit', (c) => { clearTimeout(timer); resolve(c) })
    })
    expect(code).toBe(0)

    // The lock is keyed by userData (= home), so a run with another home stays up next to this one.
    const other = await launch(tempHome())
    try {
      await expect((await other.firstWindow()).getByLabel('API ID')).toBeVisible()
    } finally {
      await other.close()
    }

    const log = fs.readFileSync(path.join(home, 'logs', 'main.log'), 'utf8')
    expect(log).toContain('TDLib 1.8.66')
    expect(log).not.toContain('Not allowed')
    expect(fs.existsSync(path.join(home, 'logs', 'tdlib.log'))).toBe(true)
  } finally {
    await app.close()
  }
})

test('Start with Windows writes the Run value, reads back on after a relaunch, and turning it off removes it', async () => {
  test.setTimeout(120_000)
  const home = tempHome()
  const runValue = () => {
    const s1 = spawnSync('reg', ['query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run', '/v', 'com.mediagram.app']).status
    return s1 === 0 ? 0 : spawnSync('reg', ['query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run', '/v', 'com.teleflow.app']).status
  }
  let app = await launch(home)
  try {
    let win = await app.firstWindow()
    await expect(win.getByLabel('API ID')).toBeVisible()
    expect(await win.evaluate(() => window.teleflow.call('settings.set', { startWithSystem: true }))).toMatchObject({ ok: true, data: { startWithSystem: true } })
    expect(runValue()).toBe(0)
    await app.close()
    app = await launch(home)
    win = await app.firstWindow()
    expect(await win.evaluate(() => window.teleflow.call('settings.get'))).toMatchObject({ ok: true, data: { startWithSystem: true } })
    expect(await win.evaluate(() => window.teleflow.call('settings.set', { startWithSystem: false }))).toMatchObject({ ok: true, data: { startWithSystem: false } })
  } finally {
    // Leave the machine as it was even when an assertion failed (turning it off deletes the value by name).
    await app.evaluate(({ app: a }) => a.setLoginItemSettings({ args: ['--hidden'], openAtLogin: false })).catch(() => {})
    await app.close()
  }
  expect(runValue()).not.toBe(0)
})
