// Phase 5.12: Playwright UI suite per UI.md - skeleton asserting structure and IPC wiring
import { test, expect, type Page } from '@playwright/test'

const baseUrl = `file://${process.cwd().replace(/\\/g, '/')}/out/renderer/index.html`

// Mock IPC bridge with fixtures
async function setupBridge(page: Page) {
  await page.addInitScript(() => {
    const mockData: Record<string, any> = {
      'auth.get': { step: 'ready', connection: 'ready', me: { id: 1, name: 'Test User', firstName: 'Test', username: 'testuser', phone: '+•• ••• ••12 34', photo: null, premium: false, captionMax: 1024, uploadMax: 2097152000 } },
      'stats.live': { speed: { download: 1234567, upload: 123456 }, counts: { download: { queued: 2, active: 1, paused: 0, completed: 10, failed: 0 }, upload: { queued: 1, active: 0, paused: 0, completed: 5, failed: 0 } }, active: [], history: [], waitUntil: { download: null, upload: null } },
      'stats.overview': { completedToday: { download: 5, upload: 2 }, totalFiles: { download: 100, upload: 50 } },
      'stats.activity': { buckets: [{ label: '00:00', download: 10, upload: 5 }] },
      'stats.chats': { top: [{ chatId: 1, title: 'Test Channel', photo: null, count: 25 }] },
      'chats.list': { chats: [{ id: 1, title: 'Test Channel', kind: 'channel', username: 'testchannel', photo: null, unread: 0, lastDate: 1234567890, canPost: true, folders: [] }] },
      'chats.media': { items: [{ chatId: 1, messageId: 1, date: 1234567890, type: 'video', name: 'test.mp4', ext: 'mp4', size: 1048576, duration: 120, caption: '', thumb: null, status: 'none', jobId: null, path: null }], total: 1, exts: ['mp4'], scan: { state: 'done', indexed: 1, total: 1 } },
      'chats.messages': { messages: [{ id: 1, date: 1234567890, sender: 'Test User', text: 'Hello', media: null }], more: false },
      'jobs.list': { jobs: [{ id: 1, kind: 'download', status: 'active', chatId: 1, chatTitle: 'Test Channel', chatUsername: 'testchannel', chatPhoto: null, messageId: 1, name: 'test.mp4', type: 'video', size: 1048576, done: 524288, thumb: null, path: null, error: null, retryAt: null, finishedAt: null }], total: 1 },
      'library.list': { items: [{ path: 'test.mp4', name: 'test.mp4', type: 'video', size: 1048576, mtime: 1234567890, chat: 'Test Channel', chatId: 1, messageId: 1, historyId: 1, preview: null }], total: 1, stats: { files: 1, size: 1048576, missing: 0 }, chats: ['Test Channel'] },
      'settings.get': { downloadRoot: 'C:\\Downloads\\TeleFlow', maxDownloads: 2, skipExisting: false, datePrefix: false, folderTemplate: '{chat}', defaultUploadChat: null, uploadAlbum: false, keepNames: false, maxUploads: 1, showArchived: false, autoRetry: true, retryAttempts: 3, stallSeconds: 30, clearCompletedDays: 7, notifyComplete: true, notifyFailed: true, closeToTray: false, startWithSystem: false },
      'app.info': { version: '1.0.0', tdlib: '1.8.66', installedAt: null, home: 'C:\\TeleFlow', repository: 'https://github.com/test/test', licenses: [] },
      'app.storage': { drive: { root: 'C:\\', total: 500000000000, free: 250000000000 }, library: { files: 100, total: 10485760, video: 8388608, image: 1048576, audio: 524288, document: 524288, archive: 0 }, cache: { total: 1048576, tdlib: 524288, thumbs: 262144, tmp: 262144, chromium: 0 }, appData: 2097152 },
    }
    const calls: string[] = []
    ;(window as any).teleflow = {
      calls,
      call: async (method: string) => {
        calls.push(method)
        console.log('[mock] call:', method)
        try {
          const marker = document.createElement('div')
          marker.style.display = 'none'
          marker.setAttribute('data-ipc', method)
          document.body.appendChild(marker)
        } catch {}
        return { ok: true, data: mockData[method] || {} }
      },
      on: () => () => {},
      pathOf: () => '',
    }
  })
}

test.describe('TeleFlow UI', () => {
  test('Overview page renders with all sections', async ({ page }) => {
    await setupBridge(page)
    await page.goto(baseUrl)
    await page.waitForLoadState('networkidle')
    
    // Page structure
    await expect(page.locator('h1')).toContainText('Welcome to Mediagram')
    
    // KPI cards
    await expect(page.locator('text=Active Transfers')).toBeVisible()
    await expect(page.locator('text=Completed Today')).toBeVisible()
    await expect(page.locator('text=Total Files')).toBeVisible()
    await expect(page.locator('text=Failed Jobs')).toBeVisible()
    
    // Panels
    await expect(page.locator('text=Transfer Activity')).toBeVisible()
    await expect(page.locator('text=Channel Activity')).toBeVisible()
    await expect(page.locator('text=Recent Activity')).toBeVisible()
    await expect(page.locator('text=Current Jobs')).toBeVisible()
    
    // IPC method references
    expect(await page.content()).toContain('stats.live')
    expect(await page.content()).toContain('stats.overview')
    
    // Screenshot
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.screenshot({ path: 'tests/screenshots/overview-1440x900.png', fullPage: true })
    await page.setViewportSize({ width: 1280, height: 720 })
    await page.screenshot({ path: 'tests/screenshots/overview-1280x720.png', fullPage: true })
  })

  test('Downloads page renders with all sections', async ({ page }) => {
    await setupBridge(page)
    await page.goto(baseUrl + '#/downloads')
    await page.waitForLoadState('networkidle')
    
    await expect(page.locator('text=Chats & Channels')).toBeVisible()
    await expect(page.locator('text=Files View')).toBeVisible()
    await expect(page.locator('text=Chat View')).toBeVisible()
    
    await expect(page.locator('[data-ipc="chats.media"]')).toBeAttached()
    expect(await page.content()).toContain('chats.list')
    expect(await page.content()).toContain('chats.media')
    
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.screenshot({ path: 'tests/screenshots/downloads-1440x900.png', fullPage: true })
  })

  test('Uploads page renders with all sections', async ({ page }) => {
    await setupBridge(page)
    await page.goto(baseUrl + '#/uploads')
    await page.waitForLoadState('networkidle')
    
    await expect(page.locator('text=Destinations')).toBeVisible()
    await expect(page.locator('text=Drop files here')).toBeVisible()
    
    await expect(page.locator('[data-ipc="settings.get"]')).toBeAttached()
    expect(await page.content()).toContain('chats.list')
    expect(await page.content()).toContain('settings.get')
    
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.screenshot({ path: 'tests/screenshots/uploads-1440x900.png', fullPage: true })
  })

  test('Queue page renders with all sections', async ({ page }) => {
    await setupBridge(page)
    await page.goto(baseUrl + '#/queue')
    await page.waitForLoadState('networkidle')
    
    await expect(page.locator('h1')).toContainText('Queue')
    await expect(page.locator('button:has-text("Downloads")').first()).toBeVisible()
    await expect(page.locator('button:has-text("Uploads")').first()).toBeVisible()
    await expect(page.locator('button:has-text("Completed")').first()).toBeVisible()
    await expect(page.locator('button:has-text("Failed")').first()).toBeVisible()
    await expect(page.locator('text=Queue Overview')).toBeVisible()
    await expect(page.locator('text=Live Activity')).toBeVisible()
    await expect(page.locator('text=Queue Actions')).toBeVisible()
    
    expect(await page.content()).toContain('jobs.list')
    expect(await page.content()).toContain('stats.live')
    
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.screenshot({ path: 'tests/screenshots/queue-1440x900.png', fullPage: true })
  })

  test('Media preview modal opens and closes', async ({ page }) => {
    await setupBridge(page)
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto(baseUrl + '#/downloads')
    await page.waitForLoadState('networkidle')
    
    await expect(page.locator('text=Files View')).toBeVisible()
    // Click on file row/thumbnail to trigger preview
    await page.locator('text=test.mp4').first().click({ force: true })
    
    // Preview modal should be visible
    await expect(page.locator('button[title*="Close"]')).toBeVisible()
    
    // Press Escape to close
    await page.keyboard.press('Escape')
    await expect(page.locator('button[title*="Close"]')).not.toBeVisible()
  })

  test('Settings page renders with all sections', async ({ page }) => {
    await setupBridge(page)
    await page.goto(baseUrl + '#/settings')
    await page.waitForLoadState('networkidle')
    
    await expect(page.locator('h1')).toContainText('Settings')
    await expect(page.locator('text=General').first()).toBeVisible()
    await expect(page.locator('text=Downloads').first()).toBeVisible()
    await expect(page.locator('text=Uploads').first()).toBeVisible()
    await expect(page.locator('text=Telegram').first()).toBeVisible()
    await expect(page.locator('text=Privacy & Security').first()).toBeVisible()
    await expect(page.locator('text=About').first()).toBeVisible()
    await expect(page.locator('text=Danger Zone').first()).toBeVisible()
    
    expect(await page.content()).toContain('settings.get')
    expect(await page.content()).toContain('app.info')
    
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.screenshot({ path: 'tests/screenshots/settings-1440x900.png', fullPage: true })
  })

  test('Login page renders with API Keys step', async ({ page }) => {
    await page.addInitScript(() => {
      ;(window as any).teleflow = {
        call: async (method: string) => {
          if (method === 'auth.get') return { ok: true, data: { step: 'credentials', connection: 'offline' } }
          return { ok: true, data: {} }
        },
        on: () => () => {},
        pathOf: () => '',
      }
    })
    await page.goto(baseUrl)
    await page.waitForLoadState('networkidle')
    
    await expect(page.locator('text=API ID').first()).toBeVisible()
    await expect(page.locator('text=API Hash').first()).toBeVisible()
    await expect(page.locator('button:has-text("Continue")')).toBeVisible()
    
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.screenshot({ path: 'tests/screenshots/login-1440x900.png', fullPage: true })
  })

  test('No hardcoded sample data in UI', async ({ page }) => {
    await setupBridge(page)
    await page.goto(baseUrl)
    await page.waitForLoadState('networkidle')
    
    const banned = ['Alex Carter', 'MrBeast', '@MrBeast', '$1 vs $250,000', '2.7 MB/s', '2,782', '156.4 GB', '500 GB', 'Jan 26, 2025', 'TG Manager']
    const body = await page.textContent('body')
    
    for (const text of banned) {
      expect(body).not.toContain(text)
    }
  })

  test('All pages have interactive controls', async ({ page }) => {
    await setupBridge(page)
    
    // Overview
    await page.goto(baseUrl)
    await page.waitForLoadState('networkidle')
    await expect(page.locator('button:has-text("View queue")')).toBeVisible()
    
    // Downloads
    await page.goto(baseUrl + '#/downloads')
    await page.waitForLoadState('networkidle')
    await expect(page.locator('button:has-text("Files View")')).toBeVisible()
    
    // Uploads
    await page.goto(baseUrl + '#/uploads')
    await page.waitForLoadState('networkidle')
    await expect(page.locator('input[type="file"]')).toBeAttached()
    
    // Queue
    await page.goto(baseUrl + '#/queue')
    await page.waitForLoadState('networkidle')
    await expect(page.locator('button:has-text("Pause All")')).toBeVisible()
    await expect(page.locator('button:has-text("Resume All")')).toBeVisible()
    
    // Settings
    await page.goto(baseUrl + '#/settings')
    await page.waitForLoadState('networkidle')
    await expect(page.locator('input[type="checkbox"][role="switch"]').first()).toBeAttached()
  })
})
