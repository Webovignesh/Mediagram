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
      'chats.list': { chats: [
        { id: 1, title: 'Test Channel', kind: 'channel', username: 'testchannel', photo: null, unread: 0, lastDate: 1234567890, canPost: true, folders: [] },
        { id: 2, title: 'VIP Community', kind: 'channel', username: 'vip', photo: null, unread: 0, lastDate: 1234567895, canPost: false, folders: [] }
      ] },
      'chats.media': { items: [{ chatId: 1, messageId: 1, date: 1234567890, type: 'video', name: 'test.mp4', ext: 'mp4', size: 1048576, duration: 120, caption: '', thumb: null, status: 'none', jobId: null, path: null }], total: 1, exts: ['mp4'], scan: { state: 'done', indexed: 1, total: 1 } },
      'chats.messages': { messages: [
        {
          id: 5,
          date: 1234568150,
          sender: 'Test User',
          text: '😔',
          isOutgoing: true,
          canBeDeleted: true,
          isAnimatedEmoji: true,
          media: null
        },
        {
          id: 4,
          date: 1234568100,
          sender: 'Test Channel',
          text: 'Annual Mediagram Project Report',
          isOutgoing: false,
          canBeDeleted: false,
          media: { chatId: 1, messageId: 4, date: 1234568100, type: 'document', name: 'Mediagram_Whitepaper_2026.pdf', ext: 'pdf', size: 4521980, duration: 0, caption: '', thumb: null, status: 'none', jobId: null, path: null }
        },
        {
          id: 3,
          date: 1234568050,
          sender: 'Test User',
          text: '',
          isOutgoing: true,
          canBeDeleted: true,
          media: { chatId: 1, messageId: 3, date: 1234568050, type: 'audio', name: 'Ambient_Podcast_Episode_12.mp3', ext: 'mp3', size: 18454912, duration: 184, caption: '', thumb: null, status: 'none', jobId: null, path: null }
        },
        {
          id: 2,
          date: 1234567990,
          sender: 'Test Channel',
          text: 'Here is the video preview',
          isOutgoing: false,
          canBeDeleted: false,
          reactions: [
            { emoji: '❤️', count: 3, chosen: true },
            { emoji: '👍', count: 5, chosen: false }
          ],
          media: { chatId: 1, messageId: 2, date: 1234567990, type: 'video', name: 'demo_video.mp4', ext: 'mp4', size: 15728640, duration: 245, caption: 'Here is the video preview', thumb: null, status: 'none', jobId: null, path: null }
        },
        { id: 1, date: 1234567890, sender: 'Test User', text: 'Hello', isOutgoing: true, canBeDeleted: true, media: null }
      ], more: false },
      'media.prepare': { completed: true, path: 'teleflow://media/demo_video.mp4', fileId: 10, size: 15728640, downloaded: 15728640 },
      'jobs.list': { jobs: [{ id: 1, kind: 'download', status: 'active', chatId: 1, chatTitle: 'Test Channel', chatUsername: 'testchannel', chatPhoto: null, messageId: 1, name: 'test.mp4', type: 'video', size: 1048576, done: 524288, thumb: null, path: null, error: null, retryAt: null, finishedAt: null }], total: 1 },
      'library.list': { items: [{ path: 'test.mp4', name: 'test.mp4', type: 'video', size: 1048576, mtime: 1234567890, chat: 'Test Channel', chatId: 1, messageId: 1, historyId: 1, preview: null }], total: 1, stats: { files: 1, size: 1048576, missing: 0 }, chats: ['Test Channel'] },
      'settings.get': { downloadRoot: 'C:\\Downloads\\TeleFlow', maxDownloads: 2, skipExisting: false, datePrefix: false, folderTemplate: '{chat}', defaultUploadChat: null, uploadAlbum: false, keepNames: false, maxUploads: 1, showArchived: false, autoRetry: true, retryAttempts: 3, stallSeconds: 30, clearCompletedDays: 7, notifyComplete: true, notifyFailed: true, closeToTray: false, startWithSystem: false, apiHashSaved: true },
      'app.info': { version: '1.0.0', tdlib: '1.8.66', installedAt: null, home: 'C:\\TeleFlow', repository: 'https://github.com/test/test', licenses: [] },
      'app.storage': { drive: { root: 'C:\\', total: 500000000000, free: 250000000000 }, library: { files: 100, total: 10485760, video: 8388608, image: 1048576, audio: 524288, document: 524288, archive: 0 }, cache: { total: 1048576, tdlib: 524288, thumbs: 262144, tmp: 262144, chromium: 0 }, appData: 2097152 },
    }
    const calls: { method: string, args?: any }[] = []
    ;(window as any).teleflow = {
      calls,
      call: async (method: string, args?: any) => {
        calls.push({ method, args })
        console.log('[mock] call:', method, args)
        try {
          const marker = document.createElement('div')
          marker.style.display = 'none'
          marker.setAttribute('data-ipc', method)
          document.body.appendChild(marker)
        } catch {}
        return { ok: true, data: mockData[method] || {} }
      },
      on: () => () => {},
      pathOf: (f: any) => f?.name ? `C:\\MockUploads\\${f.name}` : 'C:\\MockUploads\\upload.dat',
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
    await page.setViewportSize({ width: 1024, height: 640 })
    await page.screenshot({ path: 'tests/screenshots/overview-1024x640.png', fullPage: true })
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

    // Also test and screenshot Chat View
    await page.locator('button:has-text("Chat View")').click()
    await expect(page.locator('text=Media only')).toBeVisible()
    await page.screenshot({ path: 'tests/screenshots/chat-view-1440x900.png', fullPage: true })

    // Scroll to show all media card types including document
    if (await page.locator('#msg-4').count() > 0) {
      await page.locator('#msg-4').scrollIntoViewIfNeeded()
      await page.waitForTimeout(100)
      await page.screenshot({ path: 'tests/screenshots/chat-media-cards-1440x900.png' })
    }
  })

  test('Chat View full interaction: typing, context menu, reply preview, and edit preview', async ({ page }) => {
    await setupBridge(page)
    await page.goto(baseUrl + '#/downloads')
    await page.waitForLoadState('networkidle')
    await page.setViewportSize({ width: 1440, height: 900 })

    // Switch to Chat View
    await page.locator('button:has-text("Chat View")').click()
    await expect(page.locator('text=Media only')).toBeVisible()
    await expect(page.locator('#msg-1')).toBeVisible()

    // 1. Typing in textarea
    const textarea = page.locator('textarea')
    await textarea.fill('Testing real Telegram message **bold** and `code`')
    await expect(textarea).toHaveValue('Testing real Telegram message **bold** and `code`')
    await page.screenshot({ path: 'tests/screenshots/chat-typing-1440x900.png' })

    // 2. Message context menu on right click
    const bubble = page.locator('#msg-1 [class*="rounded-2xl"]').first()
    await bubble.click({ button: 'right' })
    await expect(page.locator('button:has-text("Reply")')).toBeVisible()
    await expect(page.locator('button:has-text("Copy Text")')).toBeVisible()
    await page.waitForTimeout(150)
    await page.screenshot({ path: 'tests/screenshots/chat-context-menu-1440x900.png' })

    // 3. Click Reply -> Verify Reply Preview Banner appears
    await page.locator('button:has-text("Reply")').click()
    await expect(page.locator('text=Replying to')).toBeVisible()
    await page.screenshot({ path: 'tests/screenshots/chat-reply-banner-1440x900.png' })

    // Cancel reply
    await page.locator('button[title="Cancel reply"]').click()
    await expect(page.locator('text=Replying to')).toHaveCount(0)

    // 4. Click Edit -> Verify Edit Preview Banner appears
    await bubble.click({ button: 'right' })
    await page.locator('button:has-text("Edit Message")').click()
    await expect(page.locator('text=Editing message')).toBeVisible()
    await page.screenshot({ path: 'tests/screenshots/chat-edit-banner-1440x900.png' })

    // Cancel edit
    await page.locator('button[title="Cancel editing"]').click()
    await expect(page.locator('text=Editing message')).toHaveCount(0)
  })

  test('Chat View: emoji reactions colors, reaction toggle undo, and removed delete button', async ({ page }) => {
    await setupBridge(page)
    await page.goto(baseUrl + '#/downloads')
    await page.waitForLoadState('networkidle')
    await page.setViewportSize({ width: 1440, height: 900 })

    // Verify chat item does NOT have the hover delete/leave button
    await expect(page.locator('button[title="Leave / Delete Channel"]')).toHaveCount(0)

    // Switch to Chat View
    await page.locator('button:has-text("Chat View")').click()
    await expect(page.locator('#msg-2')).toBeVisible()

    // 1. Emoji Reaction Glyph & Colors
    const heartBadge = page.locator('#msg-2 button[title*="❤️"]')
    await expect(heartBadge).toBeVisible()
    const glyph = heartBadge.locator('.emoji-glyph')
    await expect(glyph).toHaveText('❤️')
    await page.screenshot({ path: 'tests/screenshots/chat-reactions-color-1440x900.png' })

    // 2. Click active chosen reaction -> Triggers messages.react with remove: true (Undo)
    await heartBadge.click()
    const calls = await page.evaluate(() => (window as any).teleflow.calls)
    const reactCall = calls.find((c: any) => c.method === 'messages.react')
    expect(reactCall).toBeDefined()
    expect(reactCall.args.remove).toBe(true)

    // 3. Right-click non-owned incoming channel message -> Delete Message is removed
    await page.locator('#msg-2 [class*="rounded-2xl"]').first().click({ button: 'right' })
    const deleteBtn = page.locator('button:has-text("Delete Message")')
    await expect(deleteBtn).toHaveCount(0)
    await page.screenshot({ path: 'tests/screenshots/chat-dormant-delete-1440x900.png' })
  })

  test('Chat View: input emoji picker panel opens, switches categories, and inserts emoji', async ({ page }) => {
    await setupBridge(page)
    await page.goto(baseUrl + '#/downloads')
    await page.waitForLoadState('networkidle')
    await page.setViewportSize({ width: 1440, height: 900 })

    // Switch to Chat View
    await page.locator('button:has-text("Chat View")').click()
    await expect(page.locator('textarea')).toBeVisible()

    // Open Emoji Picker
    const emojiBtn = page.locator('[data-testid="emoji-picker-btn"]')
    await expect(emojiBtn).toBeVisible()
    await emojiBtn.click()

    const picker = page.locator('[data-testid="emoji-picker-panel"]')
    await expect(picker).toBeVisible()
    await page.screenshot({ path: 'tests/screenshots/chat-emoji-picker-1440x900.png' })

    // Switch to Hearts & Vibes category
    await page.locator('button:has-text("Hearts & Vibes")').click()
    const fireEmoji = page.locator('[data-testid="emoji-picker-panel"] button[title="🔥"]')
    await expect(fireEmoji).toBeVisible()
    await fireEmoji.click()

    // Assert emoji was inserted into textarea
    await expect(page.locator('textarea')).toHaveValue('🔥')
  })

  test('Chat View: animated emoji renders standalone floating and in-chat file upload shows live progress bar', async ({ page }) => {
    await setupBridge(page)
    await page.goto(baseUrl + '#/downloads')
    await page.waitForLoadState('networkidle')
    await page.setViewportSize({ width: 1440, height: 900 })

    // Switch to Chat View
    await page.locator('button:has-text("Chat View")').click()
    await expect(page.locator('#msg-5')).toBeVisible()

    // Assert animated emoji renders standalone with float animation and emoji text
    const emojiMsg = page.locator('#msg-5')
    await expect(emojiMsg.locator('.animate-emoji-standalone')).toBeVisible()
    await expect(emojiMsg).toContainText('😔')
    await page.screenshot({ path: 'tests/screenshots/chat-animated-emoji-1440x900.png' })

    // Test in-chat file upload progress bar: trigger file input with mock file
    const fileInput = page.locator('input[type="file"]').first()
    await fileInput.setInputFiles({
      name: 'archive_dataset.zip',
      mimeType: 'application/zip',
      buffer: Buffer.from('mock zip data file content for upload'),
    })

    // Assert in-chat outgoing upload progress bubble appears directly in chat
    const uploadCard = page.locator('text=archive_dataset.zip')
    await expect(uploadCard).toBeVisible()
    await expect(page.locator('text=Uploading to chat…')).toBeVisible()
    await uploadCard.scrollIntoViewIfNeeded()
    await page.waitForTimeout(100)
    await page.screenshot({ path: 'tests/screenshots/chat-upload-progressbar-1440x900.png' })
  })

  test('CustomVideoPlayer: displays buffering loading spinner circle overlay during video load', async ({ page }) => {
    await setupBridge(page)
    await page.goto(baseUrl + '#/downloads')
    await page.waitForLoadState('networkidle')
    await page.setViewportSize({ width: 1440, height: 900 })

    // Switch to Chat View
    await page.locator('button:has-text("Chat View")').click()
    await expect(page.locator('#msg-2')).toBeVisible()

    // Click video to open CustomVideoPlayer modal
    await page.locator('#msg-2 [class*="group/media"]').click()
    
    // Assert video buffering spinner circle is present
    const spinner = page.locator('[data-testid="video-buffering-spinner"]')
    await expect(spinner).toBeAttached()
    await page.screenshot({ path: 'tests/screenshots/video-buffering-spinner-1440x900.png' })

    // Close preview modal
    await page.keyboard.press('Escape')
  })

  test('Cross-page navigation persistence: chat and view selection persist between pages', async ({ page }) => {
    await setupBridge(page)
    await page.goto(baseUrl + '#/downloads')
    await page.waitForLoadState('networkidle')
    await page.setViewportSize({ width: 1440, height: 900 })

    // Switch to Chat View on first chat
    await page.locator('button:has-text("Chat View")').click()
    await expect(page.locator('button:has-text("Chat View")')).toHaveClass(/bg-primary/)

    // Navigate to Overview
    await page.locator('button:has-text("Overview")').click()
    await expect(page.locator('h1')).toContainText('Welcome to Mediagram')

    // Navigate back to Downloads -> Retains Chat View on first chat
    await page.locator('button:has-text("Downloads")').click()
    await expect(page.locator('button:has-text("Chat View")')).toHaveClass(/bg-primary/)

    // Switching to a DIFFERENT chat ('VIP Community') resets view to Files view
    await page.locator('text=VIP Community').click()
    await expect(page.locator('button:has-text("Files")')).toHaveClass(/bg-primary/)
    
    // Confirm chat selection persisted via localStorage
    const savedChat = await page.evaluate(() => localStorage.getItem('mediagram_active_chat_id'))
    const savedView = await page.evaluate(() => localStorage.getItem('mediagram_downloads_view'))
    expect(savedChat).toBe('2')
    expect(savedView).toBe('files')
    await page.screenshot({ path: 'tests/screenshots/chat-persistence-1440x900.png' })
  })

  test('Uploads page renders with all sections', async ({ page }) => {
    await setupBridge(page)
    await page.goto(baseUrl + '#/uploads')
    await page.waitForLoadState('networkidle')
    
    await expect(page.locator('text=Destinations')).toBeVisible()
    await expect(page.locator('text=Drop files here')).toBeVisible()
    
    // The page's own settings.get is the first marker of the IPC traffic it made
    await expect(page.locator('[data-ipc="settings.get"]').first()).toBeAttached()
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
    await expect(page.locator('text=About').first()).toBeVisible()
    // Privacy & Security is gone: cache and app data live in the Danger Zone with a plain Log out button.
    await expect(page.locator('text=Privacy & Security')).toHaveCount(0)
    await expect(page.locator('text=Danger Zone').first()).toBeVisible()
    await expect(page.getByRole('button', { name: 'Log out' })).toBeVisible()
    await expect(page.locator('.liquid-drop')).toHaveCount(0)
    await expect(page.locator('text=Clear cache').first()).toBeVisible()
    await expect(page.locator('text=Clear app data').first()).toBeVisible()
    await expect(page.locator('text=Your Telegram login and downloaded files stay')).toHaveCount(0)
    // A saved pair can be erased right from the API section.
    await expect(page.getByRole('button', { name: 'Delete API data' })).toBeVisible()

    // Log out button is not crooked (inline-flex, single line)
    const logoutBtn = page.getByRole('button', { name: 'Log out' })
    await expect(logoutBtn).toHaveClass(/inline-flex/)

    // Scrolling down syncs active category in sidebar
    await page.locator('text=Open-source licenses').scrollIntoViewIfNeeded()
    await page.waitForTimeout(400)
    await expect(page.locator('#settings-nav-about')).toHaveClass(/bg-primary/)

    expect(await page.content()).toContain('settings.get')
    expect(await page.content()).toContain('app.info')
    
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.screenshot({ path: 'tests/screenshots/settings-1440x900.png', fullPage: true })
  })

  test('Settings keeps bad API data on the field instead of sending it', async ({ page }) => {
    await setupBridge(page)
    await page.goto(baseUrl + '#/settings?section=telegram')
    await page.waitForLoadState('networkidle')

    // A hash one character short never leaves the renderer: the field itself says what is wrong.
    await page.getByPlaceholder('API ID').fill('12345')
    await page.getByPlaceholder('32-character hex hash').fill('a'.repeat(31))
    await page.getByRole('button', { name: 'Update API data' }).click()
    await expect(page.locator('[role="alert"]')).toContainText('32 hexadecimal characters')
    await expect(page.locator('[role="alert"]')).toContainText('has 31')
    expect(await page.locator('[data-ipc="auth.credentials"]').count()).toBe(0)

    // Corrected, it goes through: the dialog says changed keys re-check with Telegram, then the drafts are cleared.
    await page.getByPlaceholder('32-character hex hash').fill('a'.repeat(32))
    await page.getByRole('button', { name: 'Update API data' }).click()
    await expect(page.getByRole('button', { name: 'Update', exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Update', exact: true }).click()
    await expect(page.locator('[data-ipc="auth.credentials"]')).toHaveCount(1)
    await expect(page.getByPlaceholder('API ID')).toBeVisible()
  })

  test('Clear app data waits 3 seconds before the delete button opens', async ({ page }) => {
    await page.addInitScript(() => {
      const mockData: Record<string, any> = {
        'auth.get': { step: 'ready', connection: 'ready', me: { id: 1, name: 'Test User', firstName: 'Test', username: 'testuser', phone: '+•• ••• ••12 34', photo: null, premium: false, captionMax: 1024, uploadMax: 2097152000 } },
        'app.info': { version: '1.1.4', tdlib: '1.8.66', installedAt: null, home: 'C:\\TeleFlow', repository: null, licenses: [] },
        'app.storage': { drive: { root: 'C:\\', total: 500000000000, free: 250000000000 }, library: { files: 1, total: 1, video: 0, image: 0, audio: 0, document: 0, archive: 0 }, cache: { total: 1048576, tdlib: 0, thumbs: 0, tmp: 0, chromium: 0 }, appData: 2097152 },
        'chats.list': { chats: [] },
        'settings.get': { downloadRoot: 'C:\\Downloads', maxDownloads: 2, retryAttempts: 3, stallSeconds: 30, clearCompletedDays: 7, notifyComplete: true, notifyFailed: true, closeToTray: false, startWithSystem: false },
      }
      const calls: string[] = []
      ;(window as any).teleflow = {
        calls,
        call: async (method: string) => {
          calls.push(method)
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
    await page.goto(baseUrl + '#/settings')
    await page.waitForLoadState('networkidle')

    // The dialog says only what is deleted (no login-saved line), and its delete button counts down before it opens.
    await page.getByRole('button', { name: 'Clear app data', exact: true }).click()
    const dialog = page.locator('div.fixed').filter({ hasText: 'Clear app data' })
    await expect(dialog).toContainText('the download folder resets to the default')
    await expect(dialog).not.toContainText('login')
    const del = dialog.getByRole('button', { name: /Clear app data/ })
    await expect(del).toBeDisabled()
    await expect(del).toContainText(/[1-3]s/)
    await expect(del).toBeEnabled({ timeout: 5000 })

    // Cancel after the timer still wipes nothing.
    await dialog.getByRole('button', { name: 'Cancel' }).click()
    await expect(dialog).toHaveCount(0)
    await expect(page.locator('[data-ipc="app.clearData"]')).toHaveCount(0)
  })

  test('Login lands on the phone screen and asks for API data only after Continue', async ({ page }) => {
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

    // Nothing is stored yet, so the screen opens on the phone number: no API fields on it at all.
    await expect(page.getByPlaceholder('98765 43210')).toBeVisible()
    await expect(page.locator('text=API ID')).toHaveCount(0)
    await expect(page.locator('text=API hash')).toHaveCount(0)

    await page.setViewportSize({ width: 1440, height: 900 })
    await page.screenshot({ path: 'tests/screenshots/login-1440x900.png', fullPage: true })

    // Continue finds no TDLib client to send the code with, so the one-time API step appears, with a way back.
    await page.getByPlaceholder('98765 43210').fill('98765 43210')
    await page.locator('button:has-text("Continue")').click()
    await expect(page.locator('text=API ID').first()).toBeVisible()
    await expect(page.locator('text=API hash').first()).toBeVisible()
    await expect(page.locator('button:has-text("Back")')).toBeVisible()
    await expect(page.getByText('+919876543210')).toBeVisible() // the number typed before them is carried over

    // Under the boxes, the guide explains where the two values come from, in simple steps.
    await expect(page.locator('text=Where do I get these?')).toBeVisible()
    await expect(page.locator('text=API development tools')).toBeVisible()
    await expect(page.getByRole('link', { name: 'Open my.telegram.org' })).toHaveAttribute('href', 'https://my.telegram.org')

    await page.locator('button:has-text("Back")').click()
    await expect(page.getByPlaceholder('98765 43210')).toHaveValue('98765 43210')
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
