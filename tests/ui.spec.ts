// Phase 5.12: Playwright UI suite per UI.md - skeleton asserting structure and IPC wiring
import { test, expect, type Page } from '@playwright/test'
import { build } from 'esbuild'

const baseUrl = `file://${process.cwd().replace(/\\/g, '/')}/out/renderer/index.html`

// Mock IPC bridge with fixtures
async function setupBridge(page: Page, video?: { deferPrepare?: boolean, missingPath?: boolean }) {
  await page.addInitScript(({ video }) => {
    const mockData: Record<string, any> = {
      'auth.get': { step: 'ready', connection: 'ready', me: { id: 1, name: 'Test User', firstName: 'Test', username: 'testuser', phone: '+•• ••• ••12 34', photo: null, premium: false, captionMax: 1024, uploadMax: 2097152000 } },
      'stats.live': { speed: { download: 1234567, upload: 123456 }, counts: { download: { queued: 2, active: 1, paused: 0, completed: 10, failed: 0 }, upload: { queued: 1, active: 0, paused: 0, completed: 5, failed: 0 } }, active: [], history: [], waitUntil: { download: null, upload: null } },
      'stats.overview': { completedToday: { download: 5, upload: 2 }, totalFiles: { download: 100, upload: 50 } },
      'stats.activity': { buckets: [{ label: '00:00', download: 10, upload: 5 }] },
      'stats.chats': { top: [{ chatId: 1, title: 'Test Channel', photo: null, count: 25 }] },
      'chats.list': { chats: [
        { id: 1, title: 'Test Channel', kind: 'channel', username: 'testchannel', photo: null, unread: 0, lastDate: 1234567890, canPost: true, folders: [101] },
        { id: 2, title: 'VIP Community', kind: 'channel', username: 'vip', photo: null, unread: 0, lastDate: 1234567895, canPost: false, folders: [] }
      ], folders: [{ id: 101, name: 'Work Folder', title: 'Work Folder' }] },
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
          views: 736,
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
      'app.pickFolder': { path: 'D:\\CustomScanFolder' },
      'downloads.checkDuplicates': {
        scannedPath: 'C:\\Downloads\\TeleFlow',
        filesScanned: 50,
        totalSelected: 1,
        onDiskCount: 0,
        willDownloadCount: 1,
        skippedBytes: 0,
        duplicates: [],
        willDownload: [{ chatId: 1, messageId: 1, name: 'test.mp4', size: 1048576, duration: 120 }],
      },
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
        if (method === 'downloads.checkDuplicates' && args?.customPath) {
          return { ok: true, data: { ...mockData['downloads.checkDuplicates'], scannedPath: args.customPath } }
        }
        return { ok: true, data: mockData[method] || {} }
      },
      on: () => () => {},
      pathOf: (f: any) => f?.name ? `C:\\MockUploads\\${f.name}` : 'C:\\MockUploads\\upload.dat',
      setTheme: async (_color: string, _symbolColor?: string) => ({ ok: true }),
    }
    if (!video) return

    // These source-level regressions control media readiness, but load() still calls through so
    // an unintended decoder reset is observable rather than hidden by a no-op.
    const bridge = (window as any).teleflow
    const listeners = new Set<(event: any) => void>()
    const pending: ((response: any) => void)[] = []
    const fixture: any = (window as any).__videoTest = {
      loads: 0,
      time: 0,
      paused: true,
      seeking: false,
      readyState: 0,
      error: null,
      rejection: null,
      ranges: [[0, 45.66]],
      statTick: 0,
      result: {
        completed: false,
        path: video.missingPath ? null : 'C:\\tdlib\\files\\temp\\1364',
        fileId: 1364,
        size: 10960000,
        downloaded: 6160000,
      },
      emit: (event: any) => Array.from(listeners).forEach((cb) => cb(event)),
      resolvePrepare: (data: any) => pending.shift()?.({ ok: true, data }),
    }
    bridge.on = (cb: (event: any) => void) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    }
    const realCall = bridge.call
    bridge.call = (method: string, args?: any) => {
      if (method !== 'media.prepare') return realCall(method, args)
      bridge.calls.push({ method, args })
      return video.deferPrepare
        ? new Promise((resolve) => pending.push(resolve))
        : Promise.resolve({ ok: true, data: fixture.result })
    }
    fixture.emitStats = async () => {
      const { data } = await bridge.call('stats.live')
      fixture.emit({ type: 'stats', stats: { ...data, speed: { ...data.speed, download: ++fixture.statTick } } })
    }
    Object.defineProperties(HTMLMediaElement.prototype, {
      error: { configurable: true, get() { return fixture.error } },
      paused: { configurable: true, get() { return fixture.paused } },
      seeking: { configurable: true, get() { return fixture.seeking } },
      readyState: { configurable: true, get() { return fixture.readyState } },
      duration: { configurable: true, get() { return 159.2 } },
      currentTime: {
        configurable: true,
        get() { return fixture.time },
        set(value: number) {
          fixture.time = value
          fixture.seeking = true
          this.dispatchEvent(new Event('seeking'))
        },
      },
      buffered: {
        configurable: true,
        get() {
          return {
            length: fixture.ranges.length,
            start: (i: number) => fixture.ranges[i][0],
            end: (i: number) => fixture.ranges[i][1],
          }
        },
      },
    })
    const nativeLoad = HTMLMediaElement.prototype.load
    HTMLMediaElement.prototype.load = function () {
      fixture.loads++
      fixture.time = 0
      fixture.ranges = []
      nativeLoad.call(this)
    }
    HTMLMediaElement.prototype.play = function () {
      if (fixture.rejection) return Promise.reject(new DOMException('Controlled media failure', fixture.rejection))
      fixture.paused = false
      this.dispatchEvent(new Event('play'))
      return Promise.resolve()
    }
    HTMLMediaElement.prototype.pause = function () {
      fixture.paused = true
      this.dispatchEvent(new Event('pause'))
    }
  }, { video: video || null })
}

let videoPreviewBundle: Promise<string> | undefined

async function setupVideoPreview(page: Page, options: { deferPrepare?: boolean, missingPath?: boolean } = {}) {
  await setupBridge(page, options)
  // Bundle the real source in memory: these tests need neither a stale out/renderer nor Electron's protocol.
  videoPreviewBundle ||= build({
    stdin: {
      contents: `
        import * as React from 'react'
        import { createRoot } from 'react-dom/client'
        import { MediaPreviewModal } from './web/src/ui.tsx'
        import { useLive } from './web/src/api.ts'
        function Parent() {
          useLive()
          const [state, setState] = React.useState({
            open: true,
            item: { name: 'preview.mp4', type: 'video', chatId: 1, messageId: 2, size: 10960000, duration: 159.2 },
          })
          window.__videoTest.render = patch => setState(prev => ({ ...prev, ...patch }))
          return <MediaPreviewModal {...state} onClose={() => setState(prev => ({ ...prev, open: false }))} />
        }
        createRoot(document.getElementById('root')).render(<Parent />)
      `,
      loader: 'tsx',
      resolveDir: process.cwd(),
    },
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
    logLevel: 'silent',
  }).then((result) => result.outputFiles[0].text)
  await page.goto('about:blank')
  await page.setContent('<style>video { width: 640px; height: 360px } #root { width: 1000px }</style><div id="root"></div>')
  await page.addScriptTag({ content: await videoPreviewBundle })
  await expect(page.locator('h3', { hasText: 'preview.mp4' })).toBeVisible()
  await expect.poll(() => page.evaluate(() =>
    (window as any).teleflow.calls.filter((c: any) => c.method === 'media.prepare').length)).toBe(1)
}

test.describe('Mediagram UI', () => {
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

  test('Downloads: Folder filter strictly lists chats belonging to selected folder', async ({ page }) => {
    await setupBridge(page)
    await page.goto(baseUrl + '#/downloads')
    await page.waitForLoadState('networkidle')

    // Click 'Folders' chip
    const foldersChip = page.locator('text=Folders').first()
    await expect(foldersChip).toBeVisible()
    await foldersChip.click()

    // Assert that 'Work Folder' is visible in sidebar
    await expect(page.locator('text=Work Folder').first()).toBeVisible()

    // Assert chat inside folder (Test Channel) is visible
    await expect(page.locator('text=Test Channel').first()).toBeVisible()

    // Assert chat NOT in folder (VIP Community) is hidden
    await expect(page.locator('text=VIP Community')).toHaveCount(0)

    await page.screenshot({ path: 'tests/screenshots/downloads-folders.png' })
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

  test('Chat View: single media renders edge-to-edge without nested frames, Telegram caption layout and forward option', async ({ page }) => {
    await setupBridge(page)
    await page.goto(baseUrl + '#/downloads')
    await page.waitForLoadState('networkidle')
    await page.setViewportSize({ width: 1440, height: 900 })

    // Switch to Chat View
    await page.locator('button:has-text("Chat View")').click()
    const msg2 = page.locator('#msg-2')
    await expect(msg2).toBeVisible()

    // 1. Single media renders edge-to-edge (no nested card/frames with double borders)
    const mediaContainer = msg2.locator('[class*="group/media"]')
    await expect(mediaContainer).toBeVisible()
    // Inner media container has no border class
    const mediaClass = await mediaContainer.getAttribute('class')
    expect(mediaClass).not.toContain('border-white/10')

    // 2. Floating elements on media
    await expect(mediaContainer.locator('text=4:05')).toBeVisible() // Duration pill
    await expect(mediaContainer.locator('button[title="Download media"]')).toBeVisible() // Floating download action

    // 3. Telegram caption & views footer layout (reactions on left, views on right)
    await expect(msg2.locator('text=Here is the video preview')).toBeVisible()
    await expect(msg2.locator('text=736')).toBeVisible() // Views counter
    await expect(msg2.locator('button[title*="❤️"]')).toBeVisible() // Reaction badge
    await page.screenshot({ path: 'tests/screenshots/chat-single-media-edge-to-edge-1440x900.png' })

    // 4. Message Forward option: click forward button beside message
    const forwardBtn = msg2.locator('button[title="Forward message"]')
    await expect(forwardBtn).toBeVisible()
    await forwardBtn.click()

    // Assert Forward Dialog is open
    const forwardDialog = page.locator('text=Forward Message').first()
    await expect(forwardDialog).toBeVisible()
    await expect(page.locator('text=Send without sender name (send as copy)')).toBeVisible()

    // Filter destination chats in dialog
    const searchInput = page.getByPlaceholder('Search chats and channels...')
    await expect(searchInput).toBeVisible()
    await searchInput.fill('VIP')
    const targetItem = page.getByRole('button', { name: /VIP Community/ })
    await expect(targetItem).toBeVisible()

    await page.screenshot({ path: 'tests/screenshots/chat-forward-dialog-1440x900.png' })

    // Click target chat to forward
    await targetItem.click()

    // Verify messages.forward IPC call was dispatched
    const calls = await page.evaluate(() => (window as any).teleflow.calls)
    const fwdCall = calls.find((c: any) => c.method === 'messages.forward')
    expect(fwdCall).toBeDefined()
    expect(fwdCall.args.fromChatId).toBe(1)
    expect(fwdCall.args.toChatId).toBe(2)
    expect(fwdCall.args.messageIds).toEqual([2])
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
    const emojiEl = emojiMsg.locator('.animate-emoji-standalone')
    await expect(emojiEl).toBeVisible()
    await expect(emojiMsg).toContainText('😔')

    // Assert emoji does not have hover:scale-125
    const emojiClass = await emojiEl.getAttribute('class')
    expect(emojiClass).not.toContain('hover:scale-125')

    // Assert message stream container has overflow-x-hidden and no horizontal scrollbar
    const stream = emojiMsg.locator('xpath=ancestor::div[contains(@class, "overflow-y-auto")]')
    const streamClass = await stream.getAttribute('class')
    expect(streamClass).toContain('overflow-x-hidden')
    const hasHorizontalScroll = await stream.evaluate((el) => el.scrollWidth > el.clientWidth)
    expect(hasHorizontalScroll).toBe(false)

    await emojiEl.hover({ force: true })
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

  test('CustomVideoPlayer: mounts video player directly without blocking buffering overlay', async ({ page }) => {
    await setupBridge(page)
    await page.goto(baseUrl + '#/downloads')
    await page.waitForLoadState('networkidle')
    await page.setViewportSize({ width: 1440, height: 900 })

    // Switch to Chat View
    await page.locator('button:has-text("Chat View")').click()
    await expect(page.locator('#msg-2')).toBeVisible()

    // Click video to open CustomVideoPlayer modal
    await page.locator('#msg-2 [class*="group/media"]').click()
    
    // Assert video element is mounted and no blocking spinner overlay
    const videoEl = page.locator('video')
    await expect(videoEl).toBeAttached()
    await expect(page.locator('[data-testid="video-buffering-spinner"]')).toHaveCount(0)
    await expect(page.locator('text=Buffering in background…')).toHaveCount(0)

    // Close preview modal
    await page.keyboard.press('Escape')
  })

  test('Prebuffer off (the default): opening an un-downloaded video plays it at once, filling in behind', async ({ page }) => {
    await setupBridge(page)
    await page.addInitScript(() => {
      const bridge = (window as any).teleflow
      const realCall = bridge.call
      bridge.call = async (method: string, args?: unknown) => {
        if (method === 'settings.get') {
          const res = await realCall(method, args)
          return { ok: true, data: { ...res.data, prebufferVideo: false } }
        }
        if (method === 'media.prepare') {
          // Streamable: a path exists, but only part of the file has been written so far.
          return { ok: true, data: { completed: false, path: 'C:\\tdlib\\files\\temp\\10', fileId: 10, size: 15728640, downloaded: 420000, thumb: null } }
        }
        return realCall(method, args)
      }
    })
    await page.goto(baseUrl + '#/downloads')
    await page.waitForLoadState('networkidle')
    await page.setViewportSize({ width: 1440, height: 900 })

    await page.locator('button:has-text("Chat View")').click()
    await expect(page.locator('#msg-2')).toBeVisible()
    await page.locator('#msg-2 [class*="group/media"]').click()

    // The stage mounts the player straight away with a streamable URL — nothing to wait for first.
    await expect(page.locator('video')).toHaveCount(1, { timeout: 5000 })
    await expect(page.locator('video').first()).toHaveAttribute('src', /mediagram:\/\/file\/.+total=15728640&ext=mp4/)
    await expect(page.locator('text=Buffering video…')).toHaveCount(0)

    await page.keyboard.press('Escape')
  })

  test('Video playback starts immediately without buffering screen', async ({ page }) => {
    await setupBridge(page)
    await page.addInitScript(() => {
      const bridge = (window as any).teleflow
      const realCall = bridge.call
      bridge.call = async (method: string, args?: unknown) => {
        if (method === 'media.prepare') {
          return { ok: true, data: { completed: false, path: 'C:\\tdlib\\files\\temp\\10', fileId: 10, size: 15728640, downloaded: 420000, thumb: null } }
        }
        return realCall(method, args)
      }
    })
    await page.goto(baseUrl + '#/downloads')
    await page.waitForLoadState('networkidle')
    await page.setViewportSize({ width: 1440, height: 900 })

    await page.locator('button:has-text("Chat View")').click()
    await expect(page.locator('#msg-2')).toBeVisible()
    await page.locator('#msg-2 [class*="group/media"]').click()

    await expect(page.locator('video')).toHaveCount(1, { timeout: 5000 })
    await expect(page.locator('text=Buffering video…')).toHaveCount(0)

    await page.keyboard.press('Escape')
  })

  test('Check for duplicates modal: supports custom scan folder browsing', async ({ page }) => {
    await setupBridge(page)
    await page.goto(baseUrl + '#/downloads')
    await page.waitForLoadState('networkidle')
    await page.setViewportSize({ width: 1440, height: 900 })

    // Ensure we are in Files view
    const filesViewBtn = page.locator('button:has-text("Files View")')
    if (await filesViewBtn.isVisible()) {
      await filesViewBtn.click()
    }

    // Select first media item in table
    const checkbox = page.locator('tbody tr td button').first()
    await checkbox.click()

    // Click "Download selected" button
    await page.locator('button:has-text("Download selected")').click()

    // Assert CheckDuplicatesModal is opened and displays Scanned Path and Change/Browse folder button
    await expect(page.locator('h2:has-text("Check for duplicates")')).toBeVisible()
    await expect(page.locator('text=Scanned Path')).toBeVisible()
    const browseBtn = page.locator('button:has-text("Browse folder"), button:has-text("Change folder")')
    await expect(browseBtn).toBeVisible()

    // Click Browse folder button
    await browseBtn.click()

    // Assert scanned path card shows Custom indicator
    await expect(page.locator('text=Scanned Path (Custom)')).toBeVisible()
    await expect(page.getByText('D:\\CustomScanFolder', { exact: true })).toBeVisible()

    // Take screenshot
    await page.screenshot({ path: 'tests/screenshots/dedupe-custom-path-1440x900.png' })

    // Close modal
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

    // Switching back to the first chat ('Test Channel') restores its persisted Chat View!
    await page.locator('text=Test Channel').click()
    await expect(page.locator('button:has-text("Chat View")')).toHaveClass(/bg-primary/)
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
    await expect(page.locator('text=Appearance').first()).toBeVisible()
    await expect(page.locator('text=Theme Palette').first()).toBeVisible()
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

  test('Settings: Appearance & Theme customization updates document theme and title bar overlay', async ({ page }) => {
    await setupBridge(page)
    await page.goto(baseUrl + '#/settings?section=appearance')
    await page.waitForLoadState('networkidle')

    // Find and click 'Nordic Frost (Light)' theme
    const lightBtn = page.getByRole('button', { name: /Nordic Frost/i })
    await lightBtn.scrollIntoViewIfNeeded()
    await expect(lightBtn).toBeVisible()
    await lightBtn.click()

    // Document element attribute data-theme updates to light
    const themeAttr = await page.evaluate(() => document.documentElement.getAttribute('data-theme'))
    expect(themeAttr).toBe('light')

    // Stored in localStorage
    const savedTheme = await page.evaluate(() => localStorage.getItem('mediagram_theme'))
    expect(savedTheme).toBe('light')

    // Click Telegram Dark
    const telegramBtn = page.getByRole('button', { name: /Telegram Dark/i })
    await telegramBtn.click()
    const telegramAttr = await page.evaluate(() => document.documentElement.getAttribute('data-theme'))
    expect(telegramAttr).toBe('telegram')

    await page.screenshot({ path: 'tests/screenshots/settings-appearance.png' })
  })

  test('Settings keeps bad API data on the field instead of sending it', async ({ page }) => {
    await setupBridge(page)
    await page.goto(baseUrl + '#/settings?section=telegram')
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(600)
    await page.screenshot({ path: 'tests/screenshots/settings-telegram.png' })

    // A hash one character short never leaves the renderer: the field itself says what is wrong.
    await page.getByPlaceholder('API ID').fill('12345')
    await page.getByPlaceholder('32-character hex hash').fill('a'.repeat(31))
    await page.getByRole('button', { name: /Update API/i }).click()
    await expect(page.locator('[role="alert"]')).toContainText('32 hexadecimal characters')
    await expect(page.locator('[role="alert"]')).toContainText('has 31')
    expect(await page.locator('[data-ipc="auth.credentials"]').count()).toBe(0)

    // Corrected, it goes through: the dialog says changed keys re-check with Telegram, then the drafts are cleared.
    await page.getByPlaceholder('32-character hex hash').fill('a'.repeat(32))
    await page.getByRole('button', { name: /Update API/i }).click()
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

    // Under the boxes, the guide explains where the two values come from — behind the View guide row.
    await expect(page.locator('text=Where do I get these credentials?')).toBeVisible()
    await expect(page.locator('text=API development tools')).toHaveCount(0)
    await page.getByRole('button', { name: /View guide/ }).click()
    await expect(page.locator('text=API development tools')).toBeVisible()
    await expect(page.getByRole('link', { name: 'Open my.telegram.org' })).toHaveAttribute('href', 'https://my.telegram.org')
    await page.keyboard.press('Escape')
    await expect(page.locator('#login-api-guide')).toHaveCount(0)

    await page.locator('button:has-text("Back")').click()
    await expect(page.getByPlaceholder('98765 43210')).toHaveValue('98765 43210')
  })

  test('Rejected keys stay escapable and the rejection clears when leaving them', async ({ page }) => {
    const rejection = 'Telegram rejected this API ID and hash. Check them at my.telegram.org.'
    await page.addInitScript((msg) => {
      ;(window as any).teleflow = {
        call: async (method: string) => {
          if (method === 'auth.get') return { ok: true, data: { step: 'credentials', connection: 'offline', error: msg } }
          if (method === 'auth.credentials') return { ok: false, error: msg }
          return { ok: true, data: {} }
        },
        on: () => () => {},
        pathOf: () => '',
      }
    }, rejection)
    await page.goto(baseUrl)
    await page.waitForLoadState('networkidle')

    // Telegram's rejection is on screen, and so is the way out of it (it used to be hidden).
    await expect(page.locator('[role="alert"]')).toContainText('rejected this API ID')
    const back = page.locator('button:has-text("Back")')
    await expect(back).toBeVisible()

    // Back lands on the number, with the rejection no longer shadowing that screen.
    await back.click()
    await expect(page.getByPlaceholder('98765 43210')).toBeVisible()
    await expect(page.locator('[role="alert"]')).toHaveCount(0)

    // Forward again: the keys screen opens and is still escapable.
    await page.getByPlaceholder('98765 43210').fill('98765 43210')
    await page.locator('button:has-text("Continue")').click()
    await expect(page.getByPlaceholder('e.g. 2040')).toBeVisible()
    await expect(page.locator('button:has-text("Back")')).toBeVisible()
    await expect(page.locator('[role="alert"]')).toHaveCount(0)

    // A fresh attempt Telegram refuses is reported all the same.
    await page.getByPlaceholder('e.g. 2040').fill('2040')
    await page.getByPlaceholder('32-character hash from my.telegram.org').fill('deadbeefdeadbeefdeadbeefdeadbeef')
    await page.locator('button:has-text("Continue")').click()
    await expect(page.locator('[role="alert"]')).toContainText('rejected this API ID')
  })

  test('A failed auth.get keeps the login shell up instead of a blank window', async ({ page }) => {
    await page.addInitScript(() => {
      ;(window as any).__authCalls = 0
      ;(window as any).teleflow = {
        call: async (method: string) => {
          if (method === 'auth.get') {
            // #1 the live snapshot, #2 App's own copy, #3 the one this page fetches on mount.
            if (++(window as any).__authCalls === 3) return { ok: false, error: 'auth service unavailable' }
            return { ok: true, data: { step: 'credentials', connection: 'offline' } }
          }
          return { ok: true, data: {} }
        },
        on: () => () => {},
        pathOf: () => '',
      }
    })
    await page.goto(baseUrl)
    await page.waitForLoadState('networkidle')

    // The drag strip and the message are up — no blank window — and the call can be re-made.
    await expect(page.locator('.drag')).toHaveCount(1)
    await expect(page.locator('main')).toContainText('auth service unavailable')
    await page.getByRole('button', { name: 'Retry' }).click()
    await expect(page.getByPlaceholder('98765 43210')).toBeVisible()
  })

  test('API guide is an animated popover that never moves the centred card', async ({ page }) => {
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
    await page.setViewportSize({ width: 1280, height: 720 })
    await page.goto(baseUrl)
    await page.waitForLoadState('networkidle')
    await page.getByPlaceholder('98765 43210').fill('98765 43210')
    await page.locator('button:has-text("Continue")').click()
    await page.getByPlaceholder('e.g. 2040').waitFor()

    const card = page.locator('main > div').first()
    const centreOf = async () => {
      const b = await card.boundingBox()
      if (!b) throw new Error('the sign-in card has no box')
      return b.x + b.width / 2
    }
    const before = await centreOf()
    expect(before).toBeCloseTo(640, 0) // the card sits on the middle of the window on its own

    const trigger = page.getByRole('button', { name: /View guide/ })
    await expect(trigger).toHaveAttribute('aria-expanded', 'false')
    await trigger.click()

    const guide = page.locator('#login-api-guide')
    await expect(guide).toBeVisible()
    await expect(trigger).toHaveAttribute('aria-expanded', 'true')
    await expect(guide.locator('.guide-step')).toHaveCount(4)
    expect(await centreOf()).toBe(before) // opening it re-flows nothing: still dead centre

    // It slides in rather than popping, and its tail lands on the row that opened it.
    expect(await guide.evaluate((el) => getComputedStyle(el).animationName)).toContain('guidePopIn')
    expect(await guide.evaluate((el) => parseFloat(getComputedStyle(el).animationDuration))).toBeGreaterThan(0.1)
    const aligned = await page.evaluate(() => {
      const row = document.querySelector('[aria-controls="login-api-guide"]')!.getBoundingClientRect()
      const tail = document.querySelector('.guide-pop-tail')!.getBoundingClientRect()
      return Math.abs(tail.top + tail.height / 2 - (row.top + row.height / 2))
    })
    expect(aligned).toBeLessThan(5)
    await expect(guide.locator('.guide-step').last()).toHaveCSS('opacity', '1') // the stagger has landed
    await page.screenshot({ path: 'tests/screenshots/login-guide-1280x720.png' })

    // The close button plays the exit animation and takes the popover with it…
    await page.getByRole('button', { name: 'Close guide' }).click()
    await expect(guide).toHaveCount(0, { timeout: 2000 })
    await expect(page.locator('text=API development tools')).toHaveCount(0)

    // …and a click anywhere else closes it too.
    await trigger.click()
    await expect(guide).toHaveCount(1)
    await page.mouse.click(60, 400)
    await expect(guide).toHaveCount(0, { timeout: 2000 })

    // Below 1160px there is no room to the right, so it stacks under the card instead of running off.
    await page.setViewportSize({ width: 1024, height: 640 })
    await trigger.click()
    await expect(guide).toBeVisible()
    const stacked = await page.evaluate(() => {
      const card = document.querySelector('main > div')!.getBoundingClientRect()
      const pop = document.getElementById('login-api-guide')!.getBoundingClientRect()
      const row = document.querySelector('[aria-controls="login-api-guide"]')!.getBoundingClientRect()
      const tail = document.querySelector('.guide-pop-tail')!.getBoundingClientRect()
      return {
        underCard: pop.left >= card.left - 1 && pop.right <= card.right + 1 && pop.top >= card.bottom - 1,
        tailDeltaX: Math.abs(tail.left + tail.width / 2 - (row.left + row.width / 2)),
      }
    })
    expect(stacked.underCard).toBe(true)
    expect(stacked.tailDeltaX).toBeLessThan(3)
    expect(await guide.evaluate((el) => getComputedStyle(el).animationName)).toContain('guidePopInUp')
    await expect(guide.locator('.guide-step').last()).toHaveCSS('opacity', '1')
    await page.screenshot({ path: 'tests/screenshots/login-guide-stacked-1024x640.png' })
  })

  test('Login pipeline: phone → API keys → code → password → signed in', async ({ page }) => {
    await page.addInitScript(() => {
      const auth: Record<string, unknown> = { step: 'credentials', connection: 'offline' }
      ;(window as any).teleflow = {
        calls: [] as { method: string, args?: unknown }[],
        call: async (method: string, args?: unknown) => {
          ((window as any).teleflow.calls as { method: string, args?: unknown }[]).push({ method, args })
          try {
            const marker = document.createElement('div')
            marker.style.display = 'none'
            marker.setAttribute('data-ipc', method)
            document.body.appendChild(marker)
          } catch {}
          if (method === 'auth.credentials') { auth.step = 'phone'; auth.connection = 'ready'; auth.error = undefined }
          if (method === 'auth.phone') { auth.step = 'code'; auth.connection = 'ready'; auth.via = 'sms'; auth.phone = args && (args as any).phone }
          if (method === 'auth.code') { auth.step = 'password'; auth.hint = 'your first pet' }
          if (method === 'auth.password') { auth.step = 'ready'; auth.connection = 'ready' }
          if (method === 'auth.get') return { ok: true, data: { ...auth } }
          return { ok: true, data: {} }
        },
        on: () => () => {},
        pathOf: () => '',
      }
    })
    await page.goto(baseUrl)
    await page.waitForLoadState('networkidle')

    // 1. Nothing stored: the phone number comes first.
    await expect(page.getByText('Phone Number', { exact: true })).toBeVisible()
    await page.getByPlaceholder('98765 43210').fill('98765 43210')
    await page.locator('button:has-text("Continue")').click()

    // 2. No client to send it with yet, so the one-time key screen asks, carrying the number over.
    await expect(page.getByPlaceholder('e.g. 2040')).toBeVisible()
    await expect(page.getByText("Then we'll continue signing in as +919876543210")).toBeVisible()

    // 3. Keys reach Telegram; the number typed before them is sent for us and the code screen lands.
    await page.getByPlaceholder('e.g. 2040').fill('2040')
    await page.getByPlaceholder('32-character hash from my.telegram.org').fill('a'.repeat(32))
    await page.locator('button:has-text("Continue")').click()
    await expect(page.locator('[data-ipc="auth.credentials"]')).toHaveCount(1)
    await expect(page.locator('[data-ipc="auth.phone"]')).toHaveCount(1)
    await expect(page.getByRole('heading', { name: 'Verification Code' })).toBeVisible()
    await expect(page.getByText('+919876543210')).toBeVisible() // the number the code was sent to

    // 4. The OTP, then 2FA, then the hand-off.
    await page.getByLabel('Verification code').fill('12345')
    await page.locator('button:has-text("Verify")').click()
    await expect(page.getByText('Two-Step Verification')).toBeVisible()
    await expect(page.getByText('Hint: your first pet')).toBeVisible()

    await page.getByLabel('Password', { exact: true }).fill('hunter2')
    await page.locator('button:has-text("Continue")').click()
    await expect(page.getByText('Signed in')).toBeVisible()
    await expect(page.locator('[data-ipc="auth.password"]')).toHaveCount(1)
  })

  test('Verification never cuts to the splash: the engine restart keeps the sign-in screen up', async ({ page }) => {
    await page.addInitScript(() => {
      const auth: Record<string, unknown> = { step: 'credentials', connection: 'offline' }
      const listeners: ((event: unknown) => void)[] = []
      const emit = () => { for (const l of [...listeners]) l({ type: 'auth', auth: { ...auth } }) }
      ;(window as any).teleflow = {
        call: async (method: string) => {
          if (method === 'auth.get') return { ok: true, data: { ...auth } }
          if (method === 'auth.credentials') {
            // The keys restart TDLib: it sits in `starting` — the stage the sign-in used to be cut off in.
            auth.step = 'starting'
            auth.connection = 'connecting'
            setTimeout(() => {
              auth.step = 'code'
              auth.connection = 'ready'
              auth.via = 'sms'
              auth.phone = '+919876543210'
              emit()
            }, 1500)
            return { ok: true, data: {} }
          }
          return { ok: true, data: {} }
        },
        on: (cb: (event: unknown) => void) => {
          listeners.push(cb)
          return () => { const i = listeners.indexOf(cb); if (i >= 0) listeners.splice(i, 1) }
        },
        pathOf: () => '',
      }
    })
    await page.goto(baseUrl)
    await page.waitForLoadState('networkidle')

    await page.getByPlaceholder('98765 43210').fill('98765 43210')
    await page.locator('button:has-text("Continue")').click()
    await page.getByPlaceholder('e.g. 2040').fill('2040')
    await page.getByPlaceholder('32-character hash from my.telegram.org').fill('a'.repeat(32))
    await page.locator('button:has-text("Continue")').click()

    // While TDLib restarts the verification screen carries the moment, stage list and all.
    await expect(page.getByText('Signing in to Telegram')).toBeVisible()
    await expect(page.getByText('Starting the Telegram engine')).toBeVisible()
    // The launch splash must never take the window over mid sign-in — that is the cut that dropped the flow.
    await expect(page.getByText('Connecting to Telegram…')).toHaveCount(0)

    // …and the pipeline resumes exactly where it stood.
    await expect(page.getByRole('heading', { name: 'Verification Code' })).toBeVisible({ timeout: 5000 })
    await expect(page.getByText('+919876543210')).toBeVisible()
  })

  test('Logout holds its own screen through the restart and lands on the phone form', async ({ page }) => {
    await setupBridge(page)
    await page.addInitScript(() => {
      const bridge = (window as any).teleflow
      const listeners: ((event: unknown) => void)[] = []
      let step = 'ready'
      let connection = 'ready'
      const emit = () => { for (const l of [...listeners]) l({ type: 'auth', auth: { step, connection } }) }
      bridge.on = (cb: (event: unknown) => void) => {
        listeners.push(cb)
        return () => { const i = listeners.indexOf(cb); if (i >= 0) listeners.splice(i, 1) }
      }
      const realCall = bridge.call
      bridge.call = async (method: string, args?: unknown) => {
        if (method === 'auth.get') return { ok: true, data: { step, connection } }
        if (method === 'auth.logout') {
          step = 'logging-out'; connection = 'offline'; emit()
          setTimeout(() => { step = 'starting'; connection = 'connecting'; emit() }, 700)
          setTimeout(() => { step = 'phone'; connection = 'ready'; emit() }, 2500)
          return { ok: true, data: {} }
        }
        return realCall(method, args)
      }
    })
    await page.goto(baseUrl + '#/settings')
    await page.waitForLoadState('networkidle')

    await page.getByRole('button', { name: 'Log out' }).first().click()
    // The confirm host renders after the page, so the dialog's own action is the last one.
    await page.getByRole('button', { name: 'Log out' }).last().click()

    // The signing-out screen stays up for the whole pipeline — no splash, no blank, no dashboard flicker.
    await expect(page.getByText('Signing out…')).toBeVisible()
    await expect(page.getByText('Connecting to Telegram…')).toHaveCount(0)
    await page.waitForTimeout(1000) // past the TDLib restart the logout triggers
    await expect(page.getByText('Signing out…')).toBeVisible()

    // The login screen it hands over to is the real one: the phone form, ready to type in.
    await expect(page.getByRole('heading', { name: 'Phone Number' })).toBeVisible({ timeout: 8000 })
    await expect(page.getByText('Connecting to Telegram…')).toHaveCount(0)
    await page.screenshot({ path: 'tests/screenshots/logout-lands-on-phone.png' })
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

  test('Overview page notification center: opens on click, shows tabs and controls', async ({ page }) => {
    await setupBridge(page)
    await page.goto(baseUrl)
    await page.waitForLoadState('networkidle')

    const notifBtn = page.locator('[data-testid="overview-notification-btn"]')
    await expect(notifBtn).toBeVisible()

    // Click to open notification center popover
    await notifBtn.click()
    await expect(page.getByText('Notifications', { exact: true })).toBeVisible()
    await expect(page.locator('button:has-text("All (")')).toBeVisible()
    await expect(page.locator('button:has-text("Unread (")')).toBeVisible()

    // Close button
    const closeBtn = page.locator('button[title="Close"]')
    await expect(closeBtn).toBeVisible()
    await closeBtn.click()
  })

  test('Downloads: chat row action buttons, right-click toolbox and archive folder', async ({ page }) => {
    await setupBridge(page)
    await page.goto(baseUrl + '#/downloads')
    await page.waitForLoadState('networkidle')

    const chatRow = page.locator('text=Test Channel').first()
    await expect(chatRow).toBeVisible()

    // Right-click chat row to trigger context toolbox
    await chatRow.click({ button: 'right' })

    // Verify toolbox options: Pin, Mute, Archive, Select Chats, Leave
    await expect(page.locator('text=Pin to Top').or(page.locator('text=Unpin from Top'))).toBeVisible()
    await expect(page.locator('text=Mute Notifications').or(page.locator('text=Unmute Notifications'))).toBeVisible()
    await expect(page.locator('text=Archive Chat').or(page.locator('text=Unarchive Chat'))).toBeVisible()
    await expect(page.locator('text=Select Chats')).toBeVisible()
    await expect(page.locator('text=Leave Channel').or(page.locator('text=Leave Chat'))).toBeVisible()

    // Test archiving: click Archive Chat
    await page.locator('text=Archive Chat').click()

    // Verify Archived Chats folder row appears
    await expect(page.locator('text=Archived Chats')).toBeVisible()
  })

  test('ChatView: Select Chat button opens dialog and switches chat', async ({ page }) => {
    await setupBridge(page)
    await page.goto(baseUrl + '#/downloads')
    await page.waitForLoadState('networkidle')

    // Switch to Chat View mode
    const chatViewBtn = page.locator('button:has-text("Chat View")')
    await expect(chatViewBtn).toBeVisible()
    await chatViewBtn.click()

    // Verify "Select Chat" button is visible
    const selectChatBtn = page.locator('[data-testid="select-chat-btn"]')
    await expect(selectChatBtn).toBeVisible()

    // Click "Select Chat"
    await selectChatBtn.click()

    // Verify modal appears with search input and chat list
    await expect(page.locator('input[placeholder="Search chats and channels..."]')).toBeVisible()
    await expect(page.locator('button:has-text("VIP Community")')).toBeVisible()

    // Click another chat in dialog to switch
    await page.locator('button:has-text("VIP Community")').click()
  })

  test('Video preview regression: stats rerenders do not prepare the same item again', async ({ page }) => {
    await setupVideoPreview(page)
    await expect(page.locator('video')).toHaveCount(1)
    await page.clock.install()
    for (let i = 0; i < 3; i++) {
      await page.evaluate(() => (window as any).__videoTest.emitStats())
      await page.clock.runFor(300)
    }
    await expect.poll(() => page.evaluate(() =>
      (window as any).teleflow.calls.filter((c: any) => c.method === 'media.prepare').length)).toBe(1)
    await page.keyboard.press('Escape')
    await expect(page.locator('video')).toHaveCount(0)
  })

  test('Video preview regression: unrelated progress cannot supply a path or file id', async ({ page }) => {
    await setupVideoPreview(page, { deferPrepare: true, missingPath: true })
    await page.clock.install()
    await page.evaluate(() => {
      const fixture = (window as any).__videoTest
      fixture.emit({ type: 'fileProgress', fileId: 1036, path: 'C:\\tdlib\\files\\temp\\1036', total: 10960000, downloaded: 10960000, completed: true })
      fixture.resolvePrepare(fixture.result)
    })
    await page.clock.runFor(100)
    await expect(page.locator('video')).toHaveCount(0)
    await page.evaluate(() => (window as any).__videoTest.emit({
      type: 'fileProgress', fileId: 1036, path: 'C:\\tdlib\\files\\temp\\1036', total: 10960000, downloaded: 10960000, completed: true,
    }))
    await page.clock.runFor(2600)
    await expect.poll(() => page.evaluate(() =>
      (window as any).teleflow.calls.filter((c: any) => c.method === 'media.prepare').length)).toBe(2)
    await expect(page.locator('video')).toHaveCount(0)
    await page.evaluate(() => {
      const fixture = (window as any).__videoTest
      fixture.resolvePrepare({ ...fixture.result, path: 'C:\\tdlib\\files\\temp\\1364' })
    })
    await expect(page.locator('video')).toHaveAttribute('src', /temp%5C1364\?total=10960000&ext=mp4&id=1364$/)
    await expect(page.locator('[data-testid="player-download-status"]')).toContainText('Buffering 56%')
  })

  test('Video preview regression: matching progress cancels a pending preparation retry', async ({ page }) => {
    await setupVideoPreview(page, { missingPath: true })
    await page.clock.install()
    await page.evaluate(() => (window as any).__videoTest.emit({
      type: 'fileProgress', fileId: 1364, path: 'C:\\tdlib\\files\\temp\\1364', total: 10960000, downloaded: 6160000, completed: false,
    }))
    await expect(page.locator('video')).toHaveCount(1)
    await page.clock.runFor(3000)
    await expect.poll(() => page.evaluate(() =>
      (window as any).teleflow.calls.filter((c: any) => c.method === 'media.prepare').length)).toBe(1)
    expect(await page.evaluate(() => (window as any).__videoTest.loads)).toBe(0)
  })

  test('Video preview regression: progress, completion and an unbuffered seek keep the source and decoder', async ({ page }) => {
    const logs: string[] = []
    page.on('console', (message) => {
      if (message.text().startsWith('[player] buffering')) logs.push(message.text())
    })
    await setupVideoPreview(page)
    const video = page.locator('video')
    await expect(video).toHaveCount(1)
    const src = await video.getAttribute('src')
    await page.clock.install()
    await video.evaluate((v) => {
      ;(window as any).__videoTest.originalVideo = v
      v.dispatchEvent(new Event('loadedmetadata'))
      v.dispatchEvent(new Event('progress'))
    })
    const buffer = page.locator('[data-testid="player-buffered-track"]')
    await expect(buffer).toHaveAttribute('title', 'Buffered: 29%')
    await expect(page.locator('[data-testid="player-download-status"]')).toContainText('Buffering 56%')
    await page.locator('[class*="group/scrub"]').evaluate((scrub) => {
      const rect = scrub.getBoundingClientRect()
      scrub.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: rect.left + rect.width * 119.88 / 159.2 }))
    })
    const target = await video.evaluate((v: HTMLVideoElement) => v.currentTime)
    expect(target).toBeCloseTo(119.88, 0)
    await expect(page.locator('[data-testid="player-buffering"]')).toBeAttached()
    await expect(page.locator('[data-testid="player-download-status"]')).toHaveText('Buffering 56%')
    await page.evaluate(() => (window as any).__videoTest.emit({
      type: 'fileProgress', fileId: 1364, total: 10960000, downloaded: 10000000, completed: false,
    }))
    await expect(page.locator('[data-testid="player-download-status"]')).toHaveText('Buffering 91%')
    await page.clock.runFor(5000)
    expect(logs.some((line) => line.includes('downloaded=91%'))).toBe(true)
    await video.evaluate((v) => {
      const fixture = (window as any).__videoTest
      fixture.ranges = []
      fixture.readyState = 0
      v.dispatchEvent(new Event('progress'))
      v.dispatchEvent(new Event('emptied'))
    })
    await expect(buffer).toHaveAttribute('title', 'Buffered: 0%')
    await page.evaluate(() => (window as any).__videoTest.emit({
      type: 'fileProgress', fileId: 1364, path: 'C:\\library\\finished.mp4', total: 12000000, downloaded: 12000000, completed: true,
    }))
    await expect(page.locator('[data-testid="player-download-status"]')).toHaveCount(0)
    await expect(video).toHaveAttribute('src', src!)
    await expect(buffer).toHaveAttribute('style', 'width: 0%;')
    expect(await video.evaluate((v: HTMLVideoElement) => v.currentTime)).toBe(target)
    expect(await video.evaluate((v) => v === (window as any).__videoTest.originalVideo)).toBe(true)
    expect(await page.evaluate(() => (window as any).__videoTest.loads)).toBe(0)
    expect(await page.evaluate(() =>
      (window as any).teleflow.calls.filter((c: any) => c.method === 'media.prepare').length)).toBe(1)
  })

  test('Video preview regression: decode and unsupported failures never reload automatically', async ({ page }) => {
    await setupVideoPreview(page)
    await expect(page.locator('video')).toHaveCount(1)
    await page.clock.install()
    for (const code of [3, 4]) {
      await page.evaluate((code) => {
        const fixture = (window as any).__videoTest
        fixture.error = { code, message: 'Controlled decoder failure' }
        fixture.rejection = 'NotSupportedError'
        fixture.paused = true
        document.querySelector('video')!.dispatchEvent(new Event('error'))
        document.querySelector<HTMLButtonElement>('button[title$="(Space)"]')!.click()
      }, code)
      await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible()
      await page.clock.runFor(6000)
      expect(await page.evaluate(() => (window as any).__videoTest.loads)).toBe(0)
    }
  })

  test('Video preview regression: a network error and play rejection queue only one reload', async ({ page }) => {
    await setupVideoPreview(page)
    await expect(page.locator('video')).toHaveCount(1)
    await page.clock.install()
    await page.evaluate(() => {
      const fixture = (window as any).__videoTest
      fixture.time = 119.88
      fixture.error = { code: 2, message: 'Controlled network failure' }
      fixture.rejection = 'NotSupportedError'
      fixture.paused = true
      document.querySelector('video')!.dispatchEvent(new Event('error'))
      document.querySelector<HTMLButtonElement>('button[title$="(Space)"]')!.click()
    })
    await expect(page.getByText('The connection dropped while loading this file')).toBeVisible()
    await page.clock.runFor(1000)
    expect(await page.evaluate(() => (window as any).__videoTest.loads)).toBe(1)
    await page.locator('video').evaluate((v) => {
      const fixture = (window as any).__videoTest
      fixture.error = null
      fixture.rejection = null
      fixture.paused = false
      v.dispatchEvent(new Event('loadedmetadata'))
      v.dispatchEvent(new Event('playing'))
    })
    expect(await page.locator('video').evaluate((v: HTMLVideoElement) => v.currentTime)).toBe(119.88)
    await page.clock.runFor(5000)
    expect(await page.evaluate(() => (window as any).__videoTest.loads)).toBe(1)
  })

  test('Video preview regression: reopened and replaced local items do not inherit media state', async ({ page }) => {
    await setupVideoPreview(page)
    await expect(page.locator('video')).toHaveAttribute('src', /&id=1364$/)
    await page.evaluate(() => (window as any).__videoTest.render({ open: false }))
    await expect(page.locator('video')).toHaveCount(0)
    await page.evaluate(() => (window as any).__videoTest.render({
      open: true, item: { name: 'local-b.mp4', type: 'video', path: 'C:\\library\\b.mp4', size: 999000 },
    }))
    await expect(page.locator('video')).toHaveAttribute('src', 'mediagram://file/C%3A%5Clibrary%5Cb.mp4?total=999000&ext=mp4')
    await page.evaluate(() => {
      const fixture = (window as any).__videoTest
      fixture.emit({ type: 'fileProgress', fileId: 1364, path: 'C:\\library\\old.mp4', total: 10960000, downloaded: 10960000, completed: true })
      fixture.render({ item: { name: 'local-c.mp4', type: 'video', path: 'C:\\library\\c.mp4', size: 3000000 } })
    })
    await expect(page.locator('video')).toHaveAttribute('src', 'mediagram://file/C%3A%5Clibrary%5Cc.mp4?total=3000000&ext=mp4')
    await expect(page.locator('[data-testid="player-buffered-track"]')).toHaveAttribute('title', 'Buffered: 0%')
    expect(await page.evaluate(() =>
      (window as any).teleflow.calls.filter((c: any) => c.method === 'media.prepare').length)).toBe(1)
  })

  test('CustomVideoPlayer: play/pause drives the media element instead of a stuck optimistic flag', async ({ page }) => {
    await setupBridge(page)
    await page.addInitScript(() => {

      const bridge = (window as any).teleflow
      const realCall = bridge.call
      bridge.call = async (method: string, args?: unknown) => {
        if (method === 'media.prepare') {
          return { ok: true, data: { completed: false, path: 'C:\\tdlib\\files\\temp\\10', fileId: 10, size: 15728640, downloaded: 420000, thumb: null } }
        }
        return realCall(method, args)
      }
    })
    await page.goto(baseUrl + '#/downloads')
    await page.waitForLoadState('networkidle')
    await page.setViewportSize({ width: 1440, height: 900 })

    await page.locator('button:has-text("Chat View")').click()
    await expect(page.locator('#msg-2')).toBeVisible()
    await page.locator('#msg-2 [class*="group/media"]').click()
    await expect(page.locator('video')).toHaveCount(1, { timeout: 5000 })

    // The source cannot resolve here, so the player must admit it is not playing. A pause button
    // while the element sits paused is the exact regression that made the controls unresponsive.
    const playBtn = page.locator('button[title^="Play (Space)"]')
    const pauseBtn = page.locator('button[title^="Pause (Space)"]')
    await expect(playBtn).toHaveCount(1, { timeout: 15000 })

    // Hand the element a real, playable source so the control can be exercised end to end.
    await page.evaluate(async () => {
      const canvas = document.createElement('canvas')
      canvas.width = 320
      canvas.height = 180
      const ctx = canvas.getContext('2d')!
      const draw = () => {
        ctx.fillStyle = `hsl(${Date.now() % 360},70%,50%)`
        ctx.fillRect(0, 0, 320, 180)
        requestAnimationFrame(draw)
      }
      draw()
      const rec = new MediaRecorder(canvas.captureStream(30), { mimeType: 'video/webm' })
      const parts: BlobPart[] = []
      rec.ondataavailable = (e) => parts.push(e.data)
      rec.start()
      await new Promise((r) => setTimeout(r, 1500))
      await new Promise<void>((r) => { rec.onstop = () => r(); rec.stop() })
      const media = document.querySelector('video') as HTMLVideoElement
      media.src = URL.createObjectURL(new Blob(parts, { type: 'video/webm' }))
    })

    const video = page.locator('video')

    // The injected source has to be decodable, otherwise the rest of the test proves nothing.
    await expect.poll(async () => video.evaluate((v: HTMLVideoElement) => v.duration || 0), { timeout: 10000 }).toBeGreaterThan(0.5)

    // Drive the element to a known paused state through the control itself.
    for (let i = 0; i < 5; i++) {
      if (await pauseBtn.count()) await pauseBtn.click()
      await page.waitForTimeout(250)
      if (await video.evaluate((v: HTMLVideoElement) => v.paused)) break
    }
    await expect.poll(async () => video.evaluate((v: HTMLVideoElement) => v.paused), { timeout: 5000 }).toBe(true)
    await expect(playBtn).toHaveCount(1)

    // Play: time has to advance. A rejected play() leaves it at 0 forever.
    await playBtn.click()
    await expect.poll(async () => video.evaluate((v: HTMLVideoElement) => v.paused), { timeout: 5000 }).toBe(false)
    await expect(pauseBtn).toHaveCount(1)
    const started = await video.evaluate((v: HTMLVideoElement) => v.currentTime)
    await expect.poll(async () => video.evaluate((v: HTMLVideoElement) => v.currentTime), { timeout: 10000 })
      .toBeGreaterThan(started)

    // Pause: the element must actually stop and the control must flip back.
    await pauseBtn.click()
    await expect.poll(async () => video.evaluate((v: HTMLVideoElement) => v.paused), { timeout: 5000 }).toBe(true)
    await expect(playBtn).toHaveCount(1)

    // And play again.
    await playBtn.click()
    await expect.poll(async () => video.evaluate((v: HTMLVideoElement) => v.paused), { timeout: 5000 }).toBe(false)
    await expect(pauseBtn).toHaveCount(1)

    await page.keyboard.press('Escape')
  })
})
