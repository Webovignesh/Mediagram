// Packaged smoke test (needs `npm run dist`). The exe is launched through its lowercased path, so the renderer URL
// gets a lowercase drive letter that Chromium uppercases: a working Login proves the IPC sender check (Bridge step 1).
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { _electron as electron, expect, test } from '@playwright/test'

const exe = path.resolve('release/win-unpacked/TeleFlow.exe').toLowerCase()
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
  const app = await launch(home)
  try {
    const win = await app.firstWindow()
    await expect(win.getByLabel('API ID')).toBeVisible()
    await expect(win.getByLabel('API hash')).toBeVisible()
    await expect(win.getByRole('link', { name: 'Get them at my.telegram.org' })).toHaveAttribute('href', 'https://my.telegram.org')

    const info = await win.evaluate(() => window.teleflow.call('app.info'))
    expect(info).toMatchObject({ ok: true, data: { tdlib: '1.8.66', home, repository: 'https://github.com/Webovignesh/tele' } })

    // Continue reaches main and shows the rejection inline (auth.credentials is registered in Phase 2).
    await win.getByLabel('API ID').fill('12345')
    await win.getByLabel('API hash').fill('0123456789abcdef0123456789abcdef')
    await win.getByRole('button', { name: 'Continue' }).click()
    await expect(win.getByRole('alert')).toHaveText('Unknown method')

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
