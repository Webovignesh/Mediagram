# TeleFlow: Product Spec

> Download. Upload. Organize.

TeleFlow is an installable Windows desktop app for downloading, uploading, and organizing Telegram media. It replaces FileGram (the previous code in this repo) with a full rewrite: new stack and new UI. It starts fresh: nothing is imported from FileGram (its data was deleted by the user).

- Ships as a real Windows installer: `TeleFlow-Setup-<version>.exe` (per-user NSIS install, Start Menu and Desktop shortcuts, uninstaller in Windows "Installed apps").
- Built on Electron. No local web server, no open port, no script launchers.
- Feature reference: [vinodkr494/telegram-media-downloader](https://github.com/vinodkr494/telegram-media-downloader).
- Visual reference: four UI mockups, transcribed in [UI.md](./UI.md). The mockups are visual reference only; their sample data is never shipped.
- Code style: Ponytail rules (`.kiro/steering/ponytail.md`, on the branch): minimal, readable, no speculative code.

## Principles

1. Every visible control works end to end with real data. No fake toggles, placeholder buttons, or no-op handlers. If a control cannot be made real, it is not shown.
2. No hardcoded data. Every name, handle, avatar, thumbnail, file name, size, duration, count, speed, percentage, ETA, date, version, storage figure, chart point, and badge comes from live data: Telegram (TDLib), the SQLite job/history tables, disk scans, settings, or the app version. Static UI copy (titles, labels, button text, empty-state text) is fine. Mock data lives only in `tests/`.
3. Few files, clear names, one obvious place for each concern.
4. Telegram is the source of truth for chats and messages. The disk is the source of truth for downloaded files. SQLite stores jobs, history, settings, and the per-chat media index.
5. Nothing the app produces is written inside the install folder or the source repo. App data lives in `%LOCALAPPDATA%\TeleFlow\`; downloads default to `%USERPROFILE%\Downloads\TeleFlow`. Updating or reinstalling keeps the login, settings, history, and downloaded files.

## Features (v1)

### 1. Setup and login
- First run: enter the Telegram API ID and API hash (from my.telegram.org), then phone, login code, and 2FA password when enabled.
- Log out from the user menu, Settings > Telegram, or Settings > Danger Zone > Disconnect Telegram. The queue is kept; jobs are not tied to an account, so jobs from another account fail if a different account signs in (v1 limit).

### 2. Overview
- KPIs: Active Transfers, Completed Today, Total Files, Failed Jobs (each with a download/upload split).
- Transfer Activity chart (downloads vs uploads over 24h / 7d / 30d) with hover tooltip.
- Channel Activity (top chats by transfers, 24h / 7d / 30d).
- Recent Activity feed; "View All" opens Queue > Completed.
- Current Jobs table with inline pause/resume and a row menu.
- "Connect Channel" opens the open/join dialog (link, invite link, or `@username`).

### 3. Downloads
- Chat list: all chats, filter chips (All, Channels, Groups, Folders), search, unread badges, last-activity time.
- Add chat (+): open or join by `t.me` link, invite link, or `@username`. A chat that needs admin approval gets a join request, and TeleFlow says so; it opens once an admin approves.
- Two views of the selected chat:
  - Chat View: message timeline with media previews and per-message download (newest 1000 messages; Files View covers the full history).
  - Files View: media table with filters (media type, file type, duration, size, download status), sort, search, pagination. Backed by a per-chat media index built in the background.
- Select rows and download, or download everything matching the current filters.
- Paste a `t.me/<chat>/<msg>` link into the global search to download that message's media (whole album when the message is part of one).
- Side panel: live Download Overview stats and the Transfer Queue.

### 4. Uploads
- Pick a destination the user can post to: owned/admin channels, groups where sending files is allowed, Saved Messages.
- Add files with the file picker or drag and drop, optional caption.
- Options: send photos/videos as albums (up to 10 per album), keep original file names.
- Persistent upload queue with progress, pause (restarts that file's upload on resume), cancel, retry. When part of an album fails, the files already posted are recorded as done and leave the job, so Retry never posts a file twice. After a crash, an upload never stays stuck as "Uploading": files TeleFlow cannot confirm as posted fail with "Interrupted. Check the chat before retrying" (Telegram may have posted them), and no automatic retry runs for them.

### 5. Queue
- One queue for downloads and uploads. Tabs: Downloads, Uploads, Completed, Failed.
- Status chips with counts, search, multi-select.
- Per job: pause, resume, cancel, retry, move up/down.
- Bulk: Pause All, Resume All, Clear Completed, Clear All (confirm).
- Live total speed with a 60-second sparkline.

### 6. Media Library
- Lists files on disk under the download root, enriched with chat/message metadata from history when known.
- Search, type chips, chat filter, sort, grid/list toggle.
- Open, Show in folder, Move to Recycle Bin (with confirm). A trashed file is forgotten: it shows as not downloaded and can be downloaded again.
- Verify: lists history entries whose file is missing and offers re-download.

### 7. Settings
- Categories per the mockup. Only settings the app actually honors are shown (see UI.md > Settings).
- Start with Windows and minimize-to-tray on close are real (Electron login item and tray).
- App Status, Storage (download library by type, app cache), cache/data clearing, Danger Zone.

### 8. Desktop integration
- Single instance: launching again focuses the running window.
- Uninstalling removes the Start with Windows entry (an upgrade install keeps it) and keeps app data, so a reinstall keeps the login.
- Window size, position, and maximized state are remembered.
- Tray icon with Show TeleFlow, Pause all, Resume all, Quit. With "Minimize to tray on close" on, closing the window keeps transfers running in the tray.
- Desktop notifications (Electron `Notification`) when transfers complete or fail, batched so a large queue does not flood the screen.

## Download engine behavior

Borrowed from the reference repo and lessons in this repo's git history:

- Persistent queue in SQLite; survives restarts; interrupted downloads resume (TDLib keeps partial data).
- Each download re-reads its message right before starting, so stale TDLib file ids never reach `downloadFile`.
- Concurrency default 2 (range 1–5). Higher values triggered `FLOOD_PREMIUM_WAIT` in FileGram.
- Honor `FLOOD_WAIT` / `retry after`: hold new starts of that kind until the wait ends, then continue. Start bursts are spaced and back off after each flood.
- Interrupted downloads (quit, crash, logout) go back to the queue in their old position on the next start. Retried jobs also keep their place: the queue runs in the order jobs were first added.
- A download only appears under its final name once it is complete, even if the app quits or crashes while moving it to another drive.
- Canceling a download deletes its partial data (while connected to Telegram; otherwise Clear cache removes it).
- Stall detection (only while connected): no progress for the stall timeout re-asserts the download; three stalls in a row restart it. Each restart counts as an attempt; once the retry attempts are used up, the job fails with "Download keeps stalling".
- Skip existing: a file with the same name and size at the target path is marked completed without downloading.
- Naming: original file name; untitled media becomes `Video_<msgId>.mp4`, `Photo_<msgId>.jpg`, and so on, where `<msgId>` is the id shown in `t.me` links; optional `YYYY-MM-DD_` prefix from the message date; collisions get ` (2)`, ` (3)`, also between downloads finishing at the same moment, so no download ever overwrites another file.
- Downloaded files are marked as coming from the internet (Mark-of-the-Web), so Windows SmartScreen and Office Protected View apply when they are opened.
- Folder per chat from a template with `{chat}` and `{chat_id}` placeholders.
- Auto-retry failed jobs (setting): backoff, capped attempts, only for retryable errors.
- Speed shown with EMA smoothing.

## Storage

- App data: `%LOCALAPPDATA%\TeleFlow\` (TDLib session and cache, SQLite, thumbnails, logs, temp files, Chromium data). `TELEFLOW_HOME` overrides it for development and tests. Development runs without it use `%LOCALAPPDATA%\TeleFlow-dev`, and the single-instance lock is per app data folder, so a dev run and the installed app can run side by side. The app data folder may not be the install folder or inside it: installing into `%LOCALAPPDATA%\TeleFlow` itself makes TeleFlow refuse to start with an error box, so install anywhere else (the installer's default, `%LOCALAPPDATA%\Programs\TeleFlow`, is fine).
- Download root: `%USERPROFILE%\Downloads\TeleFlow` by default, configurable. Clear All Data can delete every file under it, so it may not be a drive root; may not be, sit inside, or contain the app data folder, the install folder, `AppData`, or the Windows system folders (Windows, Program Files, ProgramData); and may not be the user folder or a known folder (Desktop, Documents, Downloads, Pictures, Videos, Music) itself or an ancestor of one. Subfolders such as `Downloads\TeleFlow` and other folders such as `D:\Media` are fine. Changing it does not move existing downloads; they stay where they are and still open from the Queue and Chat View.
- Clearing (Settings), each with current size, a confirm dialog, and the freed size in a toast:
  - Clear cache: TDLib file cache (`optimizeStorage`), thumbnails, temp files, Chromium cache. Keeps login, history, queue, downloads. Refused while transfers are active; paused downloads restart from zero.
  - Clear app data: history, queue, media index, settings reset to defaults (including the download folder), plus the cache. Keeps login and downloaded files.
  - Clear All Data (Danger Zone): everything above plus log out, delete the session, and turn Start with Windows off; unchecked "Also delete downloaded files" option.
  - Disconnect Telegram (Danger Zone): log out and delete the session.

## Out of scope for v1

FileGram had some of these. They are dropped to keep v1 small and can come back on request:

- Forwarding messages between chats
- Bulk-deleting messages in owned channels
- ZIP export of selections
- Speed limiter, proxy settings
- Auto-update and "Check for updates" (no release feed), code signing
- Multiple accounts
- Setting file timestamps to the message date
- Analytics page (removed by the user; Overview keeps its charts)
- Importing anything from FileGram: session, credentials, downloads, queue (removed by the user after deleting FileGram's data)

## Open decisions

| # | Question | Default |
|---|----------|---------|
| D1 | Keep any "out of scope" FileGram feature? | Drop all for v1 |
| D2 | Import FileGram's pending queue? | Obsolete: FileGram import was removed (user change #5) |
| D3 | Brand name | TeleFlow (mockups also show "TG Manager") |
| D4 | Default port | Obsolete: the Electron app has no port (IPC only) |
