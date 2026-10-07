import { test, expect, type Page } from '@playwright/test'

const baseUrl = `file://${process.cwd().replace(/\\/g, '/')}/out/renderer/index.html`

async function setupBridge(page: Page) {
  await page.addInitScript(() => {
    const mockData: Record<string, any> = {
      'auth.get': {
        step: 'ready',
        connection: 'ready',
        me: { id: 1, name: 'Test User', firstName: 'Test', username: 'testuser', phone: '+•• ••• ••12 34', photo: null, premium: false, captionMax: 1024, uploadMax: 2097152000 },
      },
      'stats.live': {
        speed: { download: 1234567, upload: 123456 },
        counts: { download: { queued: 2, active: 1, paused: 0, completed: 10, failed: 0 }, upload: { queued: 1, active: 0, paused: 0, completed: 5, failed: 0 } },
        active: [],
        history: [],
        waitUntil: { download: null, upload: null },
      },
      'stats.overview': { completedToday: { download: 5, upload: 2 }, totalFiles: { download: 100, upload: 50 } },
      'stats.activity': { buckets: [{ label: '00:00', download: 10, upload: 5 }] },
      'stats.chats': { top: [{ chatId: 1, title: 'Test Channel', photo: null, count: 25 }] },
      'chats.list': {
        chats: [
          { id: 1, title: 'Test Channel', kind: 'channel', username: 'testchannel', photo: null, unread: 0, lastDate: 1234567890, canPost: true, folders: [] },
          { id: 2, title: 'VIP Community', kind: 'channel', username: 'vip', photo: null, unread: 0, lastDate: 1234567895, canPost: false, folders: [] },
        ],
        folders: [],
      },
      'chats.media': {
        items: [
          {
            chatId: 1,
            messageId: 101,
            date: 1234567890,
            type: 'video',
            name: 'Clipchamp_Video_35.mp4',
            ext: 'mp4',
            size: 272433152, // ~259.8 MB
            duration: 313,   // 5:13
            caption: 'Awesome video highlight',
            thumb: null,
            status: 'none',
            jobId: null,
            path: null,
          },
          {
            chatId: 1,
            messageId: 102,
            date: 1234567895,
            type: 'photo',
            name: 'Holiday_Panorama.jpg',
            ext: 'jpg',
            size: 4194304,   // 4 MB
            duration: 0,
            caption: 'Beautiful landscape view',
            thumb: null,
            status: 'none',
            jobId: null,
            path: null,
          },
          {
            chatId: 1,
            messageId: 103,
            date: 1234567900,
            type: 'video',
            name: 'Product_Walkthrough.mp4',
            ext: 'mp4',
            size: 68996300,  // ~65.7 MB
            duration: 62,    // 1:02
            caption: 'Quick walkthrough',
            thumb: null,
            status: 'downloaded',
            jobId: null,
            path: 'C:\\Downloads\\Product_Walkthrough.mp4',
          },
        ],
        total: 3,
        exts: ['mp4', 'jpg'],
        scan: { state: 'done', indexed: 3, total: 3 },
      },
      'chats.messages': { messages: [], more: false },
      'media.prepare': { completed: true, path: 'teleflow://media/Clipchamp_Video_35.mp4', fileId: 101, size: 272433152, downloaded: 272433152 },
      'jobs.list': { jobs: [], total: 0 },
      'library.list': { items: [], total: 0, stats: { files: 0, size: 0, missing: 0 }, chats: [] },
      'settings.get': { downloadRoot: 'C:\\Downloads', maxDownloads: 2 },
      'downloads.checkDuplicates': {
        scannedPath: 'C:\\Downloads',
        filesScanned: 10,
        totalSelected: 1,
        onDiskCount: 0,
        willDownloadCount: 1,
        skippedBytes: 0,
        duplicates: [],
        willDownload: [{ chatId: 1, messageId: 101, name: 'Clipchamp_Video_35.mp4', size: 272433152, duration: 313 }],
      },
      'downloads.add': { added: 1, skipped: 0 },
      'library.reveal': { ok: true },
    }

    const calls: { method: string, args?: any }[] = []
    ;(window as any).teleflow = {
      calls,
      call: async (method: string, args?: any) => {
        calls.push({ method, args })
        if (method === 'downloads.checkDuplicates' && args?.items) {
          return {
            ok: true,
            data: {
              ...mockData['downloads.checkDuplicates'],
              totalSelected: args.items.length,
              willDownloadCount: args.items.length,
            },
          }
        }
        return { ok: true, data: mockData[method] || {} }
      },
      on: () => () => {},
    }
  })
}

test.describe('Downloads Page: Telegram-style Grid View & Grid Size Control', () => {
  test.beforeEach(async ({ page }) => {
    await setupBridge(page)
    await page.goto(baseUrl + '#/downloads')
    await page.waitForLoadState('networkidle')
    await page.setViewportSize({ width: 1440, height: 900 })
  })

  test('View mode switch buttons (Table and Grid) are present in the filter toolbar', async ({ page }) => {
    // Check that toggle switch buttons for Table and Grid are present
    const tableBtn = page.getByRole('button', { name: 'Table', exact: false })
    const gridBtn = page.getByRole('button', { name: 'Grid', exact: false })
    await expect(tableBtn).toBeVisible()
    await expect(gridBtn).toBeVisible()

    // Verify dropdown select is removed in favor of clean switch controls
    const viewSelect = page.locator('select').filter({ hasText: /View:/i })
    await expect(viewSelect).toHaveCount(0)
  })

  test('Switching to Grid View displays Telegram-style media cards and hides table', async ({ page }) => {
    // Initially in Table View
    await expect(page.locator('table')).toBeVisible()
    await expect(page.locator('th:has-text("Preview")')).toBeVisible()

    // Click Grid toggle button
    const gridBtn = page.getByRole('button', { name: 'Grid', exact: false })
    await gridBtn.click()

    // Table should now be hidden
    await expect(page.locator('table')).toHaveCount(0)

    // Grid cards should be visible
    const cards = page.locator('[data-testid="media-grid-card"]')
    await expect(cards).toHaveCount(3)

    // Verify sub-toolbar showing Select All and items count
    await expect(page.locator('text=Select All')).toBeVisible()
    await expect(page.locator('text=Showing 3 of 3 items')).toBeVisible()

    // Verify first video card metadata: duration badge (5:13), size badge (~259.8 MB)
    const videoCard = cards.filter({ hasText: 'Clipchamp_Video_35.mp4' })
    await expect(videoCard).toBeVisible()
    await expect(videoCard.locator('text=5:13')).toBeVisible()
    await expect(videoCard.locator('text=259.8 MB').first()).toBeVisible()
    await expect(videoCard.locator('span', { hasText: /^mp4$/i }).first()).toBeVisible()

    // Verify downloaded card has 'Saved' indicator
    const downloadedCard = cards.filter({ hasText: 'Product_Walkthrough.mp4' })
    await expect(downloadedCard).toBeVisible()
    await expect(downloadedCard.locator('text=Saved').first()).toBeVisible()
  })

  test('Grid size control changes layout dynamically across SM, MD, LG, XL', async ({ page }) => {
    // Switch to Grid view
    await page.getByRole('button', { name: 'Grid', exact: false }).click()

    // Grid size control should now be visible
    const smBtn = page.getByRole('button', { name: 'SM', exact: true })
    const mdBtn = page.getByRole('button', { name: 'MD', exact: true })
    const lgBtn = page.getByRole('button', { name: 'LG', exact: true })
    const xlBtn = page.getByRole('button', { name: 'XL', exact: true })

    await expect(smBtn).toBeVisible()
    await expect(mdBtn).toBeVisible()
    await expect(lgBtn).toBeVisible()
    await expect(xlBtn).toBeVisible()

    // Test clicking SM (compact)
    await smBtn.click()
    const gridContainer = page.locator('.grid-cols-2.sm\\:grid-cols-3.md\\:grid-cols-4')
    await expect(gridContainer).toBeVisible()

    // Test clicking LG
    await lgBtn.click()
    const lgContainer = page.locator('.grid-cols-1.sm\\:grid-cols-2.md\\:grid-cols-2.lg\\:grid-cols-3')
    await expect(lgContainer).toBeVisible()

    // Test clicking XL
    await xlBtn.click()
    const xlContainer = page.locator('.grid-cols-1.sm\\:grid-cols-1.md\\:grid-cols-2.lg\\:grid-cols-2.xl\\:grid-cols-3')
    await expect(xlContainer).toBeVisible()

    // Verify persistence in localStorage
    const savedSize = await page.evaluate(() => localStorage.getItem('mediagram_media_grid_size'))
    expect(savedSize).toBe('xl')
  })

  test('Human tester flow: clicking card opens preview modal, clicking checkbox selects card', async ({ page }) => {
    // Switch to Grid view
    await page.getByRole('button', { name: 'Grid', exact: false }).click()

    const cards = page.locator('[data-testid="media-grid-card"]')
    const firstCard = cards.first()

    // 1. Click on filename/thumbnail -> Opens preview modal
    await firstCard.locator('text=Clipchamp_Video_35.mp4').click()
    const closeBtn = page.locator('button[title*="Close"]')
    await expect(closeBtn).toBeVisible()

    // Close preview modal via Escape
    await page.keyboard.press('Escape')
    await expect(closeBtn).toHaveCount(0)

    // 2. Click the selection checkbox in card -> Card selected without opening modal
    const checkboxBtn = firstCard.locator('button[title="Select item"]')
    await checkboxBtn.click()

    // Selection action bar should appear
    await expect(page.locator('text=1 items selected')).toBeVisible()
    await expect(page.locator('button:has-text("Download selected")')).toBeVisible()

    // Checkbox state toggles to Deselect
    await expect(firstCard.locator('button[title="Deselect item"]')).toBeVisible()

    // 3. Test Select All button in grid sub-toolbar
    const selectAllBtn = page.getByRole('button', { name: 'Select All' })
    await selectAllBtn.click()
    await expect(page.locator('text=3 items selected')).toBeVisible()

    // 4. Test Clear selection button
    await page.locator('button:has-text("Clear")').click()
    await expect(page.locator('text=items selected')).toHaveCount(0)
  })

  test('View mode persists across page refresh and chat switching', async ({ page }) => {
    // Switch to Grid view
    await page.getByRole('button', { name: 'Grid', exact: false }).click()
    await expect(page.locator('[data-testid="media-grid-card"]')).toHaveCount(3)

    // Switch to different chat
    await page.locator('text=VIP Community').click()

    // Switch back to Test Channel
    await page.locator('text=Test Channel').click()

    // Grid View should still be active
    await expect(page.locator('[data-testid="media-grid-card"]')).toHaveCount(3)
    await expect(page.locator('table')).toHaveCount(0)
  })

  test('Reset button preserves Grid View layout while resetting media filters', async ({ page }) => {
    // Switch to Grid view
    await page.getByRole('button', { name: 'Grid', exact: false }).click()
    await expect(page.locator('[data-testid="media-grid-card"]')).toHaveCount(3)

    // Click Reset button
    const resetBtn = page.getByTitle('Reset filters')
    await resetBtn.click()

    // Still in Grid View!
    await expect(page.locator('[data-testid="media-grid-card"]')).toHaveCount(3)
    await expect(page.locator('table')).toHaveCount(0)
  })

  test('Captures screenshots of Telegram Grid View across sizes and selection states', async ({ page }) => {
    // 1. Table view baseline
    await page.screenshot({ path: 'tests/screenshots/grid-view-table-baseline.png' })

    // 2. Switch to Grid view (Medium default)
    await page.getByRole('button', { name: 'Grid', exact: false }).click()
    await expect(page.locator('[data-testid="media-grid-card"]')).toHaveCount(3)
    await page.screenshot({ path: 'tests/screenshots/grid-view-telegram-medium.png' })

    // 3. Switch to Small grid size
    await page.getByRole('button', { name: 'SM', exact: true }).click()
    await page.screenshot({ path: 'tests/screenshots/grid-view-telegram-small.png' })

    // 4. Switch to Large grid size
    await page.getByRole('button', { name: 'LG', exact: true }).click()
    await page.screenshot({ path: 'tests/screenshots/grid-view-telegram-large.png' })

    // 5. Select items
    const firstCard = page.locator('[data-testid="media-grid-card"]').first()
    await firstCard.locator('button[title="Select item"]').click()
    await expect(firstCard.locator('button[title="Deselect item"]')).toBeVisible()
    await page.screenshot({ path: 'tests/screenshots/grid-view-selection-active.png' })
  })
})
