// Playwright renderer tests: App shell and Login with stubbed window.teleflow bridge.
import { test, expect } from '@playwright/test'

test('stub bridge loads', async ({ page }) => {
  await page.addInitScript(() => {
    ;(window as any).teleflow = {
      call: async () => ({ ok: true, data: { step: 'credentials', connection: 'offline' } }),
      on: () => () => {},
      pathOf: () => '',
    }
  })

  await page.goto('file://' + process.cwd().replace(/\\/g, '/') + '/out/renderer/index.html')
  await page.waitForLoadState('networkidle')

  // Login screen should render
  await expect(page.locator('body')).toBeVisible()
})

test('no hardcoded sample names in UI', async ({ page }) => {
  await page.addInitScript(() => {
    ;(window as any).teleflow = {
      call: async () => ({ ok: true, data: { step: 'credentials', connection: 'offline' } }),
      on: () => () => {},
      pathOf: () => '',
    }
  })

  await page.goto('file://' + process.cwd().replace(/\\/g, '/') + '/out/renderer/index.html')
  await page.waitForLoadState('networkidle')

  const body = await page.textContent('body')
  expect(body).not.toContain('Alex Carter')
  expect(body).not.toContain('MrBeast')
  expect(body).not.toContain('$1 vs $250,000')
})
