# Mediagram Chat Parity Roadmap & Progress Tracker

> **Goal:** Transform Mediagram's read-mostly Chat View into a full-featured, real-time Telegram Desktop experience with true parity in chat controls, message states, rich entities, delivery tracking, and responsive glassmorphism UI.  
> *(Note: Stickers & GIFs Picker are intentionally excluded per product scope).*

---

## 📋 Comprehensive Todo List & Progress Status (100% Completed)

### Phase 1: Schema & Data Model Extensions (`core/shapes.ts`) ✅
- [x] Define `TextEntity` shape (bold, italic, code, pre, spoiler, underline, strikethrough, url, mention).
- [x] Define `ReplyPreview` shape (`id`, `sender`, `text`, `thumb`).
- [x] Define `ReactionItem` shape (`emoji`, `count`, `chosen`).
- [x] Extend `Message` type with:
  - `replyTo`: `ReplyPreview | null`
  - `replyToMessageId`: `number | null`
  - `editDate`: `number | null`
  - `forwardFrom`: `{ name: string, chatTitle?: string } | null`
  - `reactions`: `ReactionItem[]`
  - `deliveryStatus`: `'sending' | 'sent' | 'read' | 'failed'`
  - `senderId`: `number`
  - `senderPhoto`: `string | null`
  - `isPinned`: `boolean`
  - `albumId`: `string | null`
  - `entities`: `TextEntity[]`
- [x] Update `extractMedia` & `toMessage` to preserve formatting entities, reply references, edit dates, and reactions.

---

### Phase 2: Core TDLib Integration & Lifecycle (`core/telegram.ts`) ✅
- [x] **Real-time Event Synchronization**:
  - [x] Add `updateMessageContent` handler in `onTdUpdate` to emit message invalidations on edits.
  - [x] Add `updateMessageEdited` handler in `onTdUpdate`.
  - [x] Add `updateChatReadOutbox` handler to update message `deliveryStatus` from `sent` (`✓`) to `read` (`✓✓`).
  - [x] Add `updateMessageSendSucceeded` & `updateMessageSendFailed` handlers.
- [x] **Chat Actions & Typing Indicator**:
  - [x] Implement `sendChatAction(chatId, action)` with debouncing when user types.
- [x] **Cursor-Based Efficient Pagination**:
  - [x] Refactor `messages(chatId, fromMessageId, limit, direction)` to avoid O(N) re-fetch from offset 0.
- [x] **Message Operations**:
  - [x] Implement `sendMessage(chatId, text, replyToMessageId)` supporting text formatting.
  - [x] Implement `editMessage(chatId, messageId, text)`.
  - [x] Implement `deleteMessages(chatId, messageIds, revoke)`.
  - [x] Implement `pinChatMessage(chatId, messageId, unpin)`.
  - [x] Implement `addMessageReaction(chatId, messageId, reaction)` & `removeMessageReaction`.
  - [x] Implement `viewMessages(chatId, messageIds)` for viewport-driven unread clearing.
  - [x] Implement `searchChatMessages(chatId, query, fromMessageId, limit)`.

---

### Phase 3: IPC API Expansion (`electron/ipc.ts`) ✅
- [x] Register `messages.send` method with `{ chatId, text, replyToMessageId? }`.
- [x] Register `messages.edit` method with `{ chatId, messageId, text }`.
- [x] Register `messages.delete` method with `{ chatId, messageIds, revoke: boolean }`.
- [x] Register `messages.pin` method with `{ chatId, messageId, unpin?: boolean }`.
- [x] Register `messages.react` method with `{ chatId, messageId, reaction: string }`.
- [x] Register `messages.read` method with `{ chatId, messageIds: number[] }`.
- [x] Register `messages.search` method with `{ chatId, query: string, fromMessageId?: number, limit?: number }`.
- [x] Register `chats.sendTyping` method with `{ chatId, action?: string }`.
- [x] Update `chats.messages` validation and return types with full rich message payload.
- [x] Verify all 113 backend unit tests pass (`npm test`).

---

### Phase 4: Chat Area UI Architecture & Controls (`web/src/pages/Downloads.tsx` / `ChatView.tsx`) ✅
- [x] **Multi-line Input & Chat Controls**:
  - [x] Replace single-line `<input>` with auto-resizing `<textarea>`.
  - [x] Handle Shift+Enter for new line, Enter to submit.
  - [x] Dispatch outgoing typing events while user is typing (`chats.sendTyping`).
  - [x] Implement Reply Banner bar above input with target sender, preview snippet, and dismiss.
  - [x] Implement Edit Banner bar above input with original text, cancel action, and checkmark send button.
  - [x] In-chat file attachment button (paperclip) for direct multi-file upload dispatch.
- [x] **Rich Message Bubbles**:
  - [x] Formatted entity renderer (bold, italic, code, pre with copy button, spoilers with blur & click-to-reveal, smart links).
  - [x] Reply preview snippet inside bubble (click to jump/scroll to replied message with highlight ring).
  - [x] Forward attribution banner ("Forwarded from...").
  - [x] Delivery status indicators:
    - Sending clock icon
    - Single checkmark `✓` (sent to server)
    - Double checkmark `✓✓` (read by recipient)
  - [x] "edited" label for edited messages.
  - [x] Message reactions row with count badges (click to toggle reaction).
  - [x] Pinned message banner at top of chat viewport with jump and unpin controls.
- [x] **Message Context Menu**:
  - [x] Right-click & hover dropdown menu on messages:
    - Portaled to `document.body` for flawless absolute coordinate placement.
    - Quick emoji reaction bar (👍, ❤️, 🔥, 🎉, 😂, 👏, 😢, 😍).
    - Reply.
    - Edit (for outgoing messages).
    - Pin / Unpin.
    - Copy Text.
    - Delete (modal dialog: "Also delete for everyone in this chat").
- [x] **Design, Layout & Polish**:
  - [x] Segmented pill view switcher with matching icons: `[📄 Files View]` and `[💬 Chat View]`.
  - [x] Dark slate/blue Telegram Desktop theme (`#0c1424`, `#182533`, `#224467`).
  - [x] Pixel-perfect padding, micro-animations, glassmorphic blur effects.

---

### Phase 5: Verification, Playwright UI Tests & Screenshot Validation ✅
- [x] Update `tests/ui.spec.ts` with mock IPC fixtures for all new message methods.
- [x] Execute Playwright test suite (`npx playwright test tests/ui.spec.ts`) - all 12 tests passing.
- [x] Capture and visually audit high-resolution screenshots:
  - `tests/screenshots/chat-view-1440x900.png` (clean layout, active switcher tab, chat bubbles)
  - `tests/screenshots/chat-typing-1440x900.png` (textarea typing state, enabled send button)
  - `tests/screenshots/chat-context-menu-1440x900.png` (portaled context menu with reaction strip)
  - `tests/screenshots/chat-reply-banner-1440x900.png` (cyan reply banner above input bar)
  - `tests/screenshots/chat-edit-banner-1440x900.png` (edit message banner with checkmark button)

---

### Phase 6: Release Build & Distribution Package ✅
- [x] Version maintained at `1.2.0` (no bump per instruction).
- [x] Build electron app bundle with `npm run build`.
- [x] Build Windows NSIS installer with `npm run dist`.

---

### Phase 7: Post-Audit Refinements & Bug Resolution ✅
- [x] **File Upload Path Extraction**:
  - Resolved `"Could not read file path for upload"` by using `window.teleflow?.pathOf?.(f)` for Chromium file objects in Electron 32+.
- [x] **Video Player Buffering & Preload**:
  - Added `preload="auto"` to `<video>` for fast stream initialization.
  - Implemented `buffering` state hook and rendered an animated glassmorphic cyan loading spinner overlay (`Loader2`).
- [x] **Cross-Page Selection & View Persistence**:
  - Saved and restored `mediagram_active_chat_id` and `mediagram_downloads_view` in `Downloads.tsx`.
  - Persisted destination chat selection in `Uploads.tsx` (`mediagram_uploads_chat_id`).
  - Persisted tab selection in `Queue.tsx` (`mediagram_queue_tab`).
- [x] **Emoji Rendering, Undo & Emoji Panel**:
  - Resolved Segoe UI cyan tinting by wrapping emojis in `.emoji-glyph` with native color font stack (`Segoe UI Emoji`, `Apple Color Emoji`).
  - Normalized Unicode variation selectors (`\uFE0F` vs `\u2764`) for TDLib reaction compatibility.
  - Implemented reaction toggle undo (`remove: true` in `messages.react` calling `removeMessageReaction`).
  - Added full Telegram-style Emoji Picker Panel with categories (Smileys, Gestures, Hearts & Vibes) accessible via Smile button.
- [x] **Dormant Delete Message Button**:
  - Evaluated message deletion permissions (`canBeDeleted`, `isOutgoing`, `canPost`).
  - Grayed out and disabled the delete button (`opacity-40 cursor-not-allowed`) with tooltip in channels and restricted groups.
- [x] **Automated Verification & Evidence**:
  - 113/113 node unit tests passing (`npm test`).
  - 0 TypeScript compiler errors (`npm run typecheck`).
  - 16/16 Playwright UI tests passing (`npx playwright test tests/ui.spec.ts`).
  - Captured visual evidence screenshots for all fixes.
  - Produced `release/Mediagram-Setup-1.2.0.exe` installer without bumping version.
