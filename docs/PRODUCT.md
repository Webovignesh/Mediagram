# TeleFlow: Product Spec

> Download. Upload. Organize.

TeleFlow is a local Windows app for downloading, uploading, and organizing Telegram media. It replaces FileGram (the current code in this repo) with a full rewrite: new stack, new UI, same Telegram session.

- Runs on `127.0.0.1` only and opens as a chromeless app window (Edge `--app` mode).
- Feature reference: [vinodkr494/telegram-media-downloader](https://github.com/vinodkr494/telegram-media-downloader).
- Visual reference: four UI mockups, transcribed in [UI.md](./UI.md).
- Code style: Ponytail rules (`.kiro/steering/ponytail.md`): minimal, readable, no speculative code.

## Principles

1. Every visible control works. No fake toggles, no placeholder buttons.
2. Few files, clear names, one obvious place for each concern.
3. Telegram is the source of truth for chats and messages. The disk is the source of truth for downloaded files. SQLite stores jobs, history, and settings.
4. Upgrading must not log the user out or lose downloaded files.

## Features (v1)

### 1. Setup and login
- Enter Telegram API ID and API hash (from my.telegram.org), then phone, login code, and 2FA password when enabled.
- Reuses the existing TDLib session in `.td_database/`, so current users stay logged in.
- Log out from the user menu or Settings > Telegram.

### 2. Overview
- KPIs: Active Transfers, Completed Today, Total Files, Failed Jobs (each with a download/upload split).
- Transfer Activity chart (downloads vs uploads over 24h / 7d / 30d).
- Channel Activity (top chats by transfer count).
- Recent Activity feed.
- Current Jobs table with inline pause/resume and a row menu.
- "Connect Channel" opens the join-by-link / username dialog.

### 3. Downloads
- Chat list: all chats, filter chips (All, Channels, Groups, Folders), search, unread badges, last-activity time.
- Add chat (+): join or open by `t.me` link, invite link, or `@username`.
- Two views of the selected chat:
  - Chat View: message timeline with media previews.
  - Files View: media table with filters (media type, file type, duration, size, download status), sort, pagination.
- Select rows and download, or download everything matching the current filters.
- Paste a `t.me/<chat>/<msg>` link into the global search to download that message's media.
- Side panel: live Download Overview stats and the Transfer Queue.

### 4. Uploads
- Pick a destination the user can post to: owned/admin channels and groups, Saved Messages.
- Add files with the file picker or drag and drop, optional caption.
- Options: send images/videos as album, keep original file names.
- Persistent upload queue with progress, pause, cancel, retry.

### 5. Queue
- One queue for downloads and uploads. Tabs: Downloads, Uploads, Completed, Failed.
- Status chips with counts, search, multi-select.
- Per job: pause, resume, cancel, retry, move up/down.
- Bulk: Pause All, Resume All, Clear Completed, Clear All (confirm).
- Live total speed with a sparkline.

### 6. Media Library
- Lists files on disk under the download root, enriched with chat/message metadata when known. Files downloaded by FileGram show up automatically.
- Search, type chips, chat filter, sort, grid/list toggle.
- Open, Show in Explorer, delete (remove from library or delete from disk, with confirm).
- Verify: find history entries whose file is missing and offer re-download.

### 7. Analytics
- Range: 24h, 7d, 30d, All.
- KPIs: files downloaded, files uploaded, data transferred, success rate.
- Activity chart, top chats, file-type breakdown, recent failures with reasons.

### 8. Settings
- Categories per the mockup. Only settings that the app actually honors are shown (see UI.md > Settings).
- App Status, Storage breakdown, Danger Zone (clear app data, disconnect Telegram).

### 9. Notifications
- In-app toasts for every user action result.
- Optional desktop notifications (browser Notification API) when a job completes or fails.

## Download engine behavior

Borrowed from the reference repo and lessons in this repo's git history:

- Persistent queue in SQLite; survives restarts; interrupted jobs resume (TDLib keeps partial data).
- Concurrency default 2. Higher values triggered `FLOOD_PREMIUM_WAIT` in FileGram.
- Honor `FLOOD_WAIT`/`retry after`: pause new starts until the wait ends, then continue.
- Enqueue large selections in batches; rate-limit start bursts.
- Stall detection: no progress for a set time restarts the transfer.
- Skip existing: a file with the same name and size at the target path is marked completed without downloading.
- Naming: original file name; untitled media becomes `Video_<msgId>.mp4` / `Photo_<msgId>.jpg`; optional `YYYY-MM-DD_` prefix from the message date; collisions get ` (2)`, ` (3)`.
- Folder per chat, from a template with `{chat}` and `{chat_id}` placeholders.
- Auto-resume failed jobs (setting): retry with backoff, capped attempts.
- Speed shown with EMA smoothing.

## Out of scope for v1

FileGram had some of these. They are dropped to keep v1 small and can come back on request:

- Forwarding messages between chats
- Bulk-deleting messages in owned channels
- ZIP export of selections
- Speed limiter, proxy settings
- System tray, auto-update, multiple accounts
- Setting file timestamps to the message date

## Open decisions

| # | Question | Default |
|---|----------|---------|
| D1 | Keep any "out of scope" FileGram feature? | Drop all for v1 |
| D2 | Import FileGram's pending queue (`.filegram_state/download-queue.json`)? | No import; Library scans the disk, so finished files still appear |
| D3 | Brand name | TeleFlow (mockups also show "TG Manager") |
| D4 | Default port | 3000 |
