# TeleFlow: UI Spec

Transcribed from four mockups: Overview, Downloads, Queue, Settings. Uploads, Media Library, and Login are not in the mockups and follow the same patterns. There is no Analytics page.

Where mockups disagree, this file decides:
- Brand is TeleFlow everywhere (two mockups say "TG Manager").
- Sidebar nav is: Overview, Downloads, Uploads, Queue, Media Library, Settings (6 items).
- The global search bar from the Settings mockup appears in the top bar on every page.

## No hardcoded data

The mockups are visual reference only. Every name, handle, avatar, thumbnail, file name, size, duration, count, speed, percentage, ETA, date, version, storage figure, chart point, badge number, and user name or initial comes from live data. In this file, data is written as `<source.field>`; the sources are:

| Placeholder root | Source |
|------------------|--------|
| `<me.*>` | `AuthState.me` (TDLib `getMe`, `updateUser`) |
| `<auth.*>` | `AuthState` |
| `<live.*>` | `LiveStats` from `stats.live` and `stats` events |
| `<chat.*>`, `<folder.*>` | `chats.list` |
| `<job.*>` | `jobs.list` rows, overlaid with the matching `live.active` entry |
| `<media.*>`, `<scan.*>` | `chats.media` |
| `<message.*>` | `chats.messages` |
| `<overview.*>`, `<activity.*>`, `<top.*>` | `stats.overview`, `stats.activity`, `stats.chats` |
| `<item.*>`, `<library.*>` | `library.list` (`<item.*>` also from `search.global` files) |
| `<link.*>` | `search.global` |
| `<settings.*>` | `settings.get` |
| `<storage.*>` | `app.storage` |
| `<app.*>` | `app.info` (`app.getVersion()`, TDLib version, install time, licenses) |
| `<leftovers.*>`, `<fg.*>` | `fileGram.leftovers`, `fileGram.inspect` |
| `<missing.*>` | `library.missing` |
| `<invite.*>` | `chats.open` (invite preview) |
| `<added>`, `<skipped>`, `<trashed>`, `<freed>` | The result of the call that triggered the toast |

Rules:
- Static copy (page titles, subtitles, labels, button text, empty-state text) is fine. Sample values from the mockups ("Alex Carter", "MrBeast", "@MrBeast", "$1 vs $250,000 Vacation.mp4", "2.7 MB/s", "2,782", "156.4 GB of 500 GB", "Jan 26, 2025", "1.0.0") must not appear under `electron/`, `core/`, or `web/src/`. Reviewers grep for them; any hit is a rejection. Mock data lives only in `tests/`.
- While data loads for the first time, an element shows a skeleton of its own size, never a placeholder number such as 0. Refetches keep the previous data on screen (`useCall` never clears `data`), so skeletons appear only while `data` is undefined. On failure it shows an inline error with Retry. With no data it shows its empty state. The Data bindings tables below define each.
- A count of 0 is real data and is shown as 0, except badges, which hide at 0.

## Design system

### Look
Dark navy, glassy panels, thin blue-tinted borders, soft blue glow on active elements. Dense but calm: small type, generous panel padding, clear hierarchy.

### Color tokens (approximate, tune to match)

| Token | Value | Use |
|-------|-------|-----|
| `bg` | `#060b18` with a subtle radial blue glow near the top | App background |
| `sidebar` | `#070d1d`, right border `border` | Sidebar, title bar overlay color |
| `panel` | `#0c1530` at ~85% opacity | Panels |
| `tile` | `#0f1a38` | Stat tiles and rows inside panels |
| `border` | `rgba(96,140,255,0.14)` | Panel, tile, input borders |
| `primary` | `#2563eb` (hover `#3b82f6`) | Active nav, primary buttons, active chips, selected page |
| `glow` | `0 0 0 1px #3b82f6, 0 0 16px rgba(59,130,246,.35)` | Active nav item, focused primary |
| `text` | `#eaf0ff` | Primary text |
| `text-2` | `#a3b0cf` | Secondary text, title bar symbols |
| `muted` | `#7a88a8` | Labels, hints (check contrast on `panel`) |
| `success` | `#22c55e` | Completed, connected, resume |
| `warning` | `#f59e0b` | Paused, finalizing |
| `danger` | `#ef4444` | Failed, destructive |
| `upload` | `#8b5cf6` | Uploads (chart series, direction icon, pill) |
| `cyan` | `#38bdf8` | Speed values |
| `pink` | `#e879f9` | "Remaining" value |

### Type
- Font stack: Inter (when installed), "Segoe UI Variable", system-ui. No bundled font.
- Page title 28px bold; subtitle 13px `text-2`.
- Panel title 15px semibold with an 18px outline icon to its left.
- Body/table 13px; labels 12px `muted`; stat value 22px bold. Numbers use `font-variant-numeric: tabular-nums`.

### Shape and spacing
- Panels: radius 14px, 1px `border`, padding 16px, gap 16px between panels.
- Tiles, inputs, buttons, rows: radius 10–12px.
- Pills and badges: fully rounded.
- Icons: lucide outline, 16–18px. Stat icons sit in a 40px rounded-xl tile tinted with the accent color at ~15% plus a matching border.

### Components
- **Sidebar nav item**: icon + label, 40px tall. Active: `primary` fill with `glow`. Optional right badge (count, rounded, primary tint), used by Queue.
- **Stat tile**: icon tile left, label (`muted`) above value (bold). Overview KPI cards add a one-line split under the value ("`<d>` downloads • `<u>` uploads").
- **Status pill**: Downloading = solid primary; Uploading = solid/tinted purple; Finalizing = amber tint; Paused = amber outline + amber text; Completed = green outline + green text; Queued = slate outline; Failed = red outline.
- **Progress bar**: 6px, rounded, track `#1e2a47`. Fill by status: blue (downloading), purple (uploading), amber (paused/finalizing), green (completed), red (failed). Percentage right-aligned next to it; "`<job.done>` / `<job.size>`" under it where space allows.
- **Filter chip**: small rounded rect; active = primary fill. With a colored status dot and count when used for statuses.
- **Dropdown filter**: label + value + chevron in one bordered control ("Media Type  All ⌄"), built on a native `<select>`.
- **Segmented toggle**: options with icons, active option primary fill (Chat View | Files View).
- **Toggle switch**: pill switch, on = primary.
- **Stepper**: − value + (Max concurrent downloads).
- **Table**: header row in `muted` 12px, rows 48px with 1px dividers, checkbox column, thumbnails 40×28 rounded, type chip (`<media.ext>` uppercase) outlined small caps.
- **Pagination**: "‹ Previous", numbered buttons (active primary), "Next ›"; plus "Showing `<from>`–`<to>` of `<total>` items" on the left where shown.
- **Buttons**: primary (solid blue), secondary (bordered `tile`), tinted action buttons (blue/green/neutral/red at ~15% with matching border and text), danger.
- **Avatars**: chat photos (`teleflow://thumb/<chat.photo>`) rounded-lg 36px in lists, 28px in tables; fallback = first letter of `<chat.title>` on a color picked from the chat id.
- **Feedback**: toasts bottom-right; confirm dialogs with native `<dialog>`; skeleton shimmer while loading; empty states = icon + one line + one action.

## Shell

- Electron window with the native title bar hidden; the native min/max/close buttons are drawn by Windows over the top-right of the top bar (`titleBarOverlay`). The top bar is the drag region (`app-region: drag`); its inputs and buttons are `no-drag`, and it reserves the overlay width with `env(titlebar-area-width)`.
- Sidebar 170px fixed: logo (blue paper-plane mark, "TeleFlow" bold, tagline "Download. Upload. Organize." 11px `muted`), then nav. Queue badge = open jobs (`<live.counts.*.queued + active + paused>`), hidden at 0.
- Top bar: global search input (left, max ~670px): "Search channels, chats, files, or paste a Telegram link…". Results popover: Chats (`<chat.title>`, `<chat.username>`), Downloaded files (`<item.name>`, `<item.chat>`), and, when the text is a Telegram link, "Download media from this link" and "Open chat". Right side: user menu (avatar from `<me.photo>` or initial of `<me.firstName>`, `<me.name>`, chevron). Menu: account (`<me.name>`, `<me.phone>`, `@<me.username>`), Settings, Log out.
- Content: page title + subtitle, optional page action top-right, then a grid. Pages with a side column use main + 290px right column.
- Routes: `#/overview` (default), `#/downloads?chat=<id>&view=files|chat` (`view` defaults to `files`), `#/uploads?chat=<id>`, `#/queue?tab=downloads|uploads|completed|failed` (default `downloads`), `#/library?q=`, `#/settings?section=<id>`. Any auth step other than `ready` shows Login instead.
- Target 1440×900; must stay usable at 1280×720. Minimum window 1024×640. Below 1280px wide, the right column moves under the main area.

Data needs: `auth.get` + `auth` events (user menu, auth gate), `stats.live` + `stats` events (Queue badge), `search.global({ q })` (popover).

### Control inventory

| Control | Behavior | Call |
|---------|----------|------|
| Sidebar item | Navigate | `#/<page>` |
| Search input | Debounced 250 ms; popover opens at 1+ characters; ↑/↓ move through results, Enter activates, Escape closes and keeps the text | `search.global({ q })` |
| Chat result | Opens the chat | `#/downloads?chat=<id>` |
| File result | Shows it in the Library | `#/library?q=<item.name>` |
| Download media from this link | Queues the message's media (whole album); toast "Added `<added>`, skipped `<skipped>`" | `downloads.add({ link })` |
| Open chat (link) | Invite link not joined → `OpenChatDialog` at its join step; else navigate | `chats.open({ link })` → `#/downloads?chat=<id>` |
| User menu button | Opens the menu (`Menu`) | – |
| User menu > Settings | Navigate | `#/settings` |
| User menu > Log out | Confirm "Log out of Telegram?"; toast "Logged out" (+ Devices hint when `local`) | `auth.logout()` |

### Data bindings

| Element | Source | Empty | Loading | Error |
|---------|--------|-------|---------|-------|
| Queue badge | `<live.counts.*.queued + active + paused>` | hidden at 0 | hidden | – |
| User menu | `<me.photo>`, `<me.firstName>`, `<me.name>`, `<me.phone>`, `<me.username>` (`@` row hidden when null) | – | skeleton avatar | – |
| Search results | `<chat.*>`, `<item.*>`, `<link.kind>` (link actions shown only when `link` is non-null; "Download media" only for `message`) | "No matches" | 3 skeleton rows | inline ErrorState |

## ui.tsx inventory

Shared primitives live in `web/src/ui.tsx`. Components used by one page stay in that page file.

| Export | What it is | Used by |
|--------|------------|---------|
| `fmtBytes`, `fmtSpeed`, `fmtEta`, `fmtAgo`, `fmtDuration`, `fmtCount`, `fmtDate` | `Intl.NumberFormat` / `RelativeTimeFormat` / `DateTimeFormat` formatters | All pages |
| `Panel` | Glass panel; optional title, icon, subtitle, action slot | All pages |
| `IconTile` | 40px tinted icon tile (tone) | `Stat`, Recent Activity, cards |
| `Stat` | Icon tile + label + value (+ split line); renders a skeleton while `value` is undefined | Overview KPIs, side panels, Library strip, Queue Overview |
| `Pill` | Status pill from `(kind, status, finalizing)` or an explicit label/tone | Tables, cards |
| `Progress` | 6px bar with tone and optional percent | Tables, cards, Storage |
| `Chip` | Filter chip with optional dot and count | Downloads, Uploads, Queue, Library |
| `Select` | Labelled native `<select>` | Filters, range pickers, Settings |
| `Segmented` | Option group with icons (`role="radiogroup"`) | Downloads view, Library grid/list |
| `Toggle` | `<input type="checkbox" role="switch">` styled as a pill | Settings, Uploads |
| `Button`, `IconButton` | Variants primary/secondary/tint(tone)/danger; busy state; `IconButton` requires `label` (aria-label + title) | Everywhere |
| `SearchInput` | Search field with icon and clear button | Lists |
| `Pagination` | Range text + Previous / numbers / Next | Files View, Queue, Library |
| `Avatar` | Chat or user photo, colored-initial fallback | Chats, jobs, user menu |
| `Thumb` | `teleflow://` image with type-icon fallback | Tables, cards, Library |
| `TypeChip` | Uppercase extension chip | Tables |
| `Menu` | Popover menu (HTML `popover` + CSS anchor positioning) | Row "…" menus, user menu, search results |
| `Dialog` | Native `<dialog>` with title and actions | All dialogs |
| `confirm()`, `<ConfirmHost/>` | Promise-based confirm; optional typed word and checkbox | Destructive actions |
| `toast()`, `<Toaster/>` | Bottom-right toasts, `role="status"`, 4 s (errors 8 s) | Everywhere |
| `Empty`, `Skeleton`, `ErrorState` | Empty state, shimmer block, error + Retry | Every data-bearing element |
| `SelectionBar` | "`<n>` selected" + actions + Clear | Files View, Queue, Library |
| `TransferCard` | Job card: thumb, name, pill, progress, detail line, actions | Downloads and Uploads right column |
| `JobActions` | Pause/resume, cancel, retry for one job | Overview Current Jobs, Queue rows, `TransferCard` |
| `ChatPicker` | Chat panel: search, chips, rows, selection | Downloads, Uploads |
| `OpenChatDialog` | Link/username → `chats.open`, join confirm | Overview, Downloads, global search |

Page-local: `AreaChart` (Overview), `Sparkline` (Queue), `FilesView` and `ChatView` (Downloads), `VerifyDialog` (Library), `Stepper` and `LicensesDialog` (Settings). `FileGramImportDialog` (pick folder → inspect → import → leftovers) lives in `pages/Settings.tsx` and is exported for `Login.tsx`, which keeps `ui.tsx` under the 400-line split rule.

`web/src/api.ts` exports `call`, `on`, `useCall(method, args, topics)` (`{ data, error, loading, reload }`; `data` survives refetches), `useLive()` (`{ auth, live }`), `useRoute()`, `navigate()`.

## Overview

Layout (mockup):
- Title "Welcome to TeleFlow", subtitle "Manage your Telegram video downloads and uploads in one powerful workspace." Top-right secondary button with link icon: "Connect Channel".
- Row of 4 KPI cards: Active Transfers (blue lightning tile), Completed Today (green check tile), Total Files (indigo stack tile), Failed Jobs (red warning tile). Each: value + "`<d>` downloads • `<u>` uploads".
- Row of 3 panels:
  - **Transfer Activity**, "Downloads and uploads over time", range select. Area chart, Downloads (blue) and Uploads (purple), gradient fills, y gridlines, x labels (24h: every 3 hours; 7d: weekdays; 30d: every 5 days). Hover/focus shows a vertical guide, dots, and a tooltip ("`<bucket label>` / Downloads `<n>` / Uploads `<n>`"). Legend below.
  - **Channel Activity**, "Top channels by transfer volume", range select. Rows: avatar, `<top.title>`, horizontal bar (alternating blue/purple, length relative to the top row), "`<top.count>` files".
  - **Recent Activity** with "View All". Rows: direction tile (download blue / upload purple), thumbnail, text ("Downloaded `<type>` from `<chatTitle>`", "Uploaded `<type>` to `<chatTitle>`", "Failed to download `<name>`", "Failed to upload `<name>`"), time ago, size right, green check circle or red x.
- KPI and chart definitions (completed history rows, local-day and hour buckets) are in ARCHITECTURE.md > Methods notes.
- **Current Jobs** panel, "Active downloads and uploads", filter select. Columns: #, Source (avatar, `<job.chatTitle>`, `@<job.chatUsername>`), Name, Size, Direction (↓ Download blue / ↑ Upload purple), Progress bar + %, Status pill, ETA, Actions (round pause/play button + "…" menu). Footer link "View queue".

Data needs: `stats.live` (+ `stats` events), `stats.overview` (topics `history`), `stats.activity({ range })` (`history`), `stats.chats({ range })` (`history`, `chats`), `jobs.list({ kind?, status: 'open', pageSize: 8 })` (`jobs`).

### Control inventory

| Control | Behavior | Call |
|---------|----------|------|
| Connect Channel | Opens `OpenChatDialog`; on success go to the chat | `chats.open({ link })` → `#/downloads?chat=<id>` |
| Transfer Activity range (Last 24 hours / Last 7 days / Last 30 days) | Reloads the chart | `stats.activity({ range })` |
| Chart hover / arrow keys | Moves the guide and tooltip to the nearest bucket (chart is focusable) | – |
| Channel Activity range (Last 24 hours / Last 7 days / Last 30 days, default 7 days) | Reloads rows | `stats.chats({ range })` |
| Channel Activity row | Opens that chat | `#/downloads?chat=<chatId>` |
| View All (Recent Activity) | Opens completed jobs | `#/queue?tab=completed` |
| Current Jobs filter (All Jobs / Downloads / Uploads) | Reloads table | `jobs.list({ kind, status: 'open', pageSize: 8 })` |
| Row pause/resume | Toggles the job | `jobs.action({ action: 'pause' \| 'resume', ids: [id] })` |
| Row "…" > Open chat | Opens the source chat | `#/downloads?chat=<chatId>` (uploads: `#/uploads?chat=<chatId>`) |
| Row "…" > Cancel | Cancels and removes the job; toast | `jobs.action({ action: 'cancel', ids: [id] })` |
| View queue | Opens Queue | `#/queue?tab=downloads` |

### Data bindings

| Element | Source | Empty | Loading | Error |
|---------|--------|-------|---------|-------|
| Active Transfers | `<live.counts.download.active> + <live.counts.upload.active>` and split | shows 0 | skeleton | ErrorState in card |
| Completed Today | `<overview.completedToday>` sum and split | 0 | skeleton | ErrorState |
| Total Files | `<overview.totalFiles>` sum and split | 0 | skeleton | ErrorState |
| Failed Jobs | `<live.counts.*.failed>` sum and split | 0 | skeleton | ErrorState |
| Transfer Activity | `<activity.buckets>`, `<activity.download>`, `<activity.upload>` | flat lines + "No transfers in this period" | skeleton chart | ErrorState + Retry |
| Channel Activity rows | `<top.title>`, `<top.photo>`, `<top.count>` | "No transfers yet" + "Open Downloads" | 5 skeleton rows | ErrorState |
| Recent Activity rows | `<overview.recent[]>`: kind, preview, type, chatTitle, name, finishedAt, size, status | "Nothing transferred yet" | 6 skeleton rows | ErrorState |
| Current Jobs rows | `<job.*>` + `<live.active[]>` (done, speed, eta) | "No active jobs" + "Open Downloads" | 8 skeleton rows | ErrorState |

## Downloads

Layout (mockup):
- Title "Downloads", subtitle "Manage Telegram downloads from channels, groups, chats, and direct links in one workspace."
- Three columns: chat list (~180px), files panel (flex), right column.
- **Chats & Channels** panel: title + "+" button. Search "Search chats or channels…". Chips: All, Channels, Groups, Folders (Folders shows the user's Telegram folders as a sub-list with a back button). Rows: avatar, `<chat.title>` bold, `@<chat.username>` `muted`, `fmtAgo(<chat.lastDate>)` right, unread badge `<chat.unread>` (primary pill, hidden at 0). Selected row: primary-tinted background.
- **Files panel**:
  - Header: segmented toggle "Chat View" | "Files View" and, in Files View, search "Search files in this channel…".
  - Index bar while `scan.state` is `scanning`: "Indexing media… `<scan.indexed>` of about `<scan.total>`" with a thin progress bar; when `<scan.total>` is null, "Indexing media… `<scan.indexed>` found" with an indeterminate bar.
  - Filter row(s): Media Type, File Type (options = `<media.exts>`), Duration, Size, Status, Sort By, "Reset" (rotate icon).
  - Table: checkbox, #, Thumbnail, File Name, Type chip, Size, Duration, Status pill. A selection bar appears when rows are checked: "`<n>` selected • Download selected • Download all `<media.total>` matching" (the count makes the scope visible while indexing is still running).
  - Pagination at the bottom.
  - Chat View: message list with `<message.sender>`, time, `<message.text>`, media card (type, `<media.size>`, Download button, or progress/status, or Show in folder when downloaded). "Load older messages" at the end while `chats.messages` returns `more: true`; at the 1000-message cap it is replaced by "Older media are in Files View" (switches the view).
- **Right column**:
  - **Download Overview** (bar-chart icon): 2×2 tiles: Speed (lightning, cyan), Active (green download-circle), Remaining (purple clock, pink value), Total Files (doc icon).
  - **Transfer Queue** (doc icon): `TransferCard`s with thumbnail 44px, `<job.name>`, status pill, progress + %, detail line by status: active "`<done>` / `<size>` • `<eta>` left", finalizing "`<size>` • Finalizing", paused "`<done>` / `<size>` • Paused", queued "`<done>` / `<size>` • Waiting to start", flood wait "Waiting for Telegram • `<seconds>`s". Shows the first 5 open jobs; link "View all".

Data needs: `chats.list` (`chats`), `chats.media({ chatId, ...filters, page })` (`media:<chatId>`), `chats.messages({ chatId, limit })` (`messages:<chatId>`), `jobs.list({ kind: 'download', status: 'open', pageSize: 5 })` (`jobs`), `stats.overview` (`history`, for Total Files), `stats.live`. The engine emits the chat's `media:` and `messages:` topics on every job change in that chat, so both views refetch only for their own chat; row and card progress comes from `live.active` by `jobId`.

### Control inventory

| Control | Behavior | Call |
|---------|----------|------|
| "+" (Chats panel) | Opens `OpenChatDialog` | `chats.open({ link })`, then select the chat |
| Chat search | Filters the loaded list by title/username (client-side) | – |
| Chips All / Channels / Groups / Folders | Filters by `<chat.kind>`; Folders shows `<folder.name>` list | – |
| Folder row / back | Filters by `<chat.folders>` / returns to folder list | – |
| Chat row | Selects the chat | `#/downloads?chat=<id>&view=<view>` |
| Chat View / Files View | Switches view (kept in the URL) | – |
| File search | Filters by name or caption | `chats.media({ ..., q })` |
| Media Type (All, Videos, Photos, Documents, Audio, GIFs) | Filter | `chats.media({ ..., type })` |
| File Type (All + `<media.exts>`) | Filter | `chats.media({ ..., ext })` |
| Duration (Any, Under 1 min, 1–10 min, 10–30 min, Over 30 min) | Filter | `chats.media({ ..., duration })` |
| Size (Any, Under 10 MB, 10–100 MB, 100 MB–1 GB, Over 1 GB) | Filter | `chats.media({ ..., size })` |
| Status (All, Not downloaded, Queued, Downloading, Paused, Downloaded, Failed) | Filter | `chats.media({ ..., status })` |
| Sort By (Newest, Oldest, Largest, Smallest, Name, Longest) | Sort | `chats.media({ ..., sort })` |
| Reset | Clears filters, search, page | `chats.media({ chatId })` |
| Header checkbox / row checkbox | Select page / row (keyboard: Space) | – |
| Download selected | Queues checked rows; toast "Added `<added>`, skipped `<skipped>`" | `downloads.add({ items })` |
| Download all `<media.total>` matching | Queues everything in the index matching the filters (already downloaded files are skipped); toast "Added `<added>`, skipped `<skipped>`" | `downloads.add({ chatId, filters })` |
| Selection bar Clear | Clears selection | – |
| Pagination | Changes page | `chats.media({ ..., page })` |
| Chat View: Download (media card) | Queues that message | `downloads.add({ items: [{ chatId, messageId }] })` |
| Chat View: Show in folder | Reveals the file | `library.reveal({ path })` |
| Load older messages | Loads 30 more older messages (scroll position kept) | `chats.messages({ chatId, limit: limit + 30 })` |
| Older media are in Files View | Switches to Files View | `#/downloads?chat=<id>&view=files` |
| Transfer Queue card actions | Pause/resume, cancel | `jobs.action(...)` |
| View all | Opens Queue | `#/queue?tab=downloads` |

### Data bindings

| Element | Source | Empty | Loading | Error |
|---------|--------|-------|---------|-------|
| Chat rows | `<chat.*>` | "No chats yet" + "Open a chat"; search: "No chats match" | 8 skeleton rows | ErrorState |
| Folder list | `<folder.name>`, chat count | "You have no Telegram folders" | – | – |
| Files panel, no chat | – | "Select a chat to see its files" | – | – |
| Index bar | `<scan.state>`, `<scan.indexed>`, `<scan.total>` | hidden when done | – | – |
| File rows | `<media.thumb>`, `<media.name>`, `<media.ext>`, `<media.size>`, `<media.duration>`, `<media.status>` + live progress | indexed and none: "No media in this chat"; filters: "No files match these filters" + Reset | 8 skeleton rows | ErrorState |
| Pagination text | `<media.total>`, page, pageSize | hidden | – | – |
| Messages | `<message.*>` | "No messages" | skeleton bubbles | ErrorState |
| Speed tile | `<live.speed.download>` | 0 B/s | skeleton | – |
| Active tile | `<live.counts.download.active>` | 0 | skeleton | – |
| Remaining tile | `<live.counts.download.queued + active + paused>` | 0 | skeleton | – |
| Total Files tile | `<overview.totalFiles.download>` (same meaning as on Overview) | 0 | skeleton | – |
| Transfer Queue cards | `<job.*>` + `<live.active[]>`, `<live.waitUntil.download>` | "Queue is empty" | 3 skeleton cards | ErrorState |

## Queue

Layout (mockup):
- Title "Queue", subtitle "Manage your active and pending downloads and uploads".
- Tabs: Downloads (badge = open downloads), Uploads (badge = open uploads), Completed, Failed, each with an icon. Active tab = primary fill.
- Search "Search in queue…".
- Status chips (Downloads and Uploads tabs): All (= open), Downloading/Uploading (green dot), Paused (amber dot), Queued (slate dot), Completed (ring), Failed (red dot), each with its count.
- Table: checkbox, # (rank in the current list: open jobs by queue position, finished ones newest first), Name (thumbnail + `<job.name>`; Completed/Failed tabs add a direction icon), Size, Progress (bar + % + "`<done>` / `<size>`" under it), ETA ("`<eta>`", green "Completed", `muted` "Queued", amber "Paused" pill, red "Failed: `<job.error>`", "Retrying in `<retryAt>`"). Row hover or focus reveals actions.
- Footer: "Showing `<from>`–`<to>` of `<total>` items" left, pagination right.
- Right column:
  - **Queue Overview**: 2×2 tiles: Total (blue doc), Downloading/Uploading/Active (green ↓ circle), Queued (purple clock), Paused (amber pause circle). Kind tabs count that kind; Completed/Failed tabs count both kinds and label the second tile "Active".
  - **Live Activity**: blue sparkline of total speed (`<live.history>`, last 60 s), big cyan `fmtSpeed(<live.speed.download + live.speed.upload>)`, caption "Total transfer speed" (amber "Telegram asked to wait · resumes in `<seconds>`s" during a flood wait), legend with colored squares: "`<active>` Active", "`<queued>` Queued", "`<paused>` Paused".
  - **Queue Actions**: 2×2 tinted buttons: Pause All (blue), Resume All (green), Clear Completed (neutral), Clear All (red, confirm).

Data needs: `jobs.list({ kind?, status, q, page })` (`jobs`; kind tabs always pass `status`, `'open'` for All), `stats.live` + `stats` events.

### Control inventory

| Control | Behavior | Call |
|---------|----------|------|
| Tabs Downloads / Uploads / Completed / Failed | Switch list (URL `tab`); kind tabs open on the All chip | Downloads/Uploads: `jobs.list({ kind, status: 'open' })`; Completed/Failed: `jobs.list({ status })` |
| Search | Filters by name (debounced 250 ms) | `jobs.list({ ..., q })` |
| Status chips | Filter within the kind; All = open (queued, active, paused) | `jobs.list({ kind, status: 'open' \| <chip status> })` |
| Header / row checkbox | Select page / row | – |
| Row Pause / Resume | Toggle | `jobs.action({ action: 'pause' \| 'resume', ids: [id] })` |
| Row Move up / Move down | Reorder among open jobs of that kind | `jobs.action({ action: 'up' \| 'down', ids: [id] })` |
| Row Retry (failed) | Requeue now | `jobs.action({ action: 'retry', ids: [id] })` |
| Row Cancel / Remove | Cancel open job or remove finished row | `jobs.action({ action: 'cancel', ids: [id] })` |
| Row Show in folder (completed download) | Reveal file | `library.reveal({ path })` |
| Selection bar Pause / Resume / Retry / Remove | Bulk on checked ids | `jobs.action({ action, ids })` |
| Pagination | Page | `jobs.list({ ..., page })` |
| Pause All | All open jobs | `jobs.action({ action: 'pause' })` |
| Resume All | All paused jobs | `jobs.action({ action: 'resume' })` |
| Clear Completed | Removes completed rows (history kept) | `jobs.action({ action: 'clear-completed' })` |
| Clear All | Confirm "Remove all `<n>` jobs? Partial downloads are deleted." | `jobs.action({ action: 'cancel' })` |

### Data bindings

| Element | Source | Empty | Loading | Error |
|---------|--------|-------|---------|-------|
| Tab badges, chip counts | `<live.counts>` | badge hidden at 0; chips show 0 | skeleton | – |
| Rows | `<job.*>` + `<live.active[]>` | per tab: "No downloads in the queue", "No uploads in the queue", "Nothing completed yet", "No failed jobs" | 8 skeleton rows | ErrorState |
| Queue Overview tiles | `<live.counts>` | 0 | skeleton | – |
| Sparkline, speed | `<live.history>`, `<live.speed>` | flat line, 0 B/s | skeleton | – |
| Flood-wait caption | `<live.waitUntil>` | hidden | – | – |

## Uploads (not in mockups)

Same three-column pattern as Downloads.
- Title "Uploads", subtitle "Send files to your channels, groups, and Saved Messages."
- Left **Destinations** panel (`ChatPicker` with `<chat.canPost>` chats): search, chips (All, Channels, Groups, Saved), rows.
- Center **New Upload** panel: dashed dropzone ("Drop files here or Browse", upload-cloud icon), selected files table (thumbnail via object URL for images, type icon otherwise; name; type chip; size; remove ×), caption textarea with counter "`<length>` / `<me.captionMax>`", toggles (Upload as album, Keep original file names; initial values from settings), primary button "Upload `<n>` files to `<chat.title>`". Files over `<me.uploadMax>` are flagged in the table and block the button.
- Right column: **Upload Overview** tiles (Speed, Active, Remaining, Uploaded Today) and **Upload Queue** (`TransferCard`, purple progress; uploads show a type icon instead of a thumbnail).

Data needs: `chats.list` (`chats`), `settings.get` (`settings`), `jobs.list({ kind: 'upload', status: 'open', pageSize: 5 })` (`jobs`), `stats.overview` (`history`), `stats.live`.

### Control inventory

| Control | Behavior | Call |
|---------|----------|------|
| Destination search / chips / row | Filter and select (client-side); default = `<settings.defaultUploadChat>` | `#/uploads?chat=<id>` |
| Dropzone click / Enter / Browse | Opens the native file picker (`<input type="file" multiple>`) | – |
| Drop files | Adds files; folders are ignored with a toast | – |
| Remove × | Removes a file from the list | – |
| Caption | Text, `maxlength = <me.captionMax>` | – |
| Upload as album / Keep original file names | Per-batch options | – |
| Upload `<n>` files to `<chat.title>` | Queues uploads; clears the form; toast "Queued `<added>` uploads" | `uploads.add({ chatId, paths: files.map(pathOf), caption, album, keepNames })` |
| Upload Queue card actions | Pause (tooltip "Upload restarts when resumed") / resume, cancel | `jobs.action(...)` |
| View all | Opens Queue | `#/queue?tab=uploads` |

### Data bindings

| Element | Source | Empty | Loading | Error |
|---------|--------|-------|---------|-------|
| Destination rows | `<chat.*>` where `canPost` | "No chats you can post to" | skeleton rows | ErrorState |
| Selected files | File objects (name, size, type) | dropzone only | – | – |
| Speed / Active / Remaining | `<live.speed.upload>`, `<live.counts.upload.*>` | 0 | skeleton | – |
| Uploaded Today | `<overview.completedToday.upload>` | 0 | skeleton | ErrorState |
| Upload Queue cards | `<job.*>` + `<live.active[]>` | "No uploads queued" | skeleton cards | ErrorState |

## Media Library (not in mockups)

- Title "Media Library", subtitle "Everything you have downloaded, in one place." Page action: secondary "Open folder".
- Stats strip: Total Files `<library.stats.files>`, Total Size `<library.stats.size>`, Missing Files `<library.stats.missing>` (with "Verify" button).
- Toolbar: search, type chips (All, Videos, Images, Documents, Audio, Archives), chat select (options = `<library.chats>`), sort, grid/list toggle.
- Grid: cards with 16:9 `<item.preview>` (type icon when null), `<item.name>`, "`<item.size>` • `<item.chat>` • `fmtDate(<item.mtime>)`", hover/focus actions (Open, Show in folder, Delete). List: table like Files View.
- Multi-select with bulk "Move to Recycle Bin"; confirm "Move `<n>` files (`<size>`) to the Recycle Bin?".

Data needs: `library.list({ q, type, chat, sort, page })` (`library`), `library.missing` (on Verify).

### Control inventory

| Control | Behavior | Call |
|---------|----------|------|
| Open folder | Opens the download root in Explorer | `app.openPath({ target: 'downloads' })` |
| Verify | Opens `VerifyDialog` listing missing files | `library.missing()` |
| VerifyDialog checkboxes / Select all / Re-download selected | Requeues missing files | `downloads.add({ items, force: true })` |
| Search, type chips, chat select, sort | Filter and sort | `library.list({ ... })` |
| Grid / List | Switch view (saved in `localStorage`) | – |
| Card or row checkbox | Select | – |
| Open | Opens with the default app | `library.open({ path })` |
| Show in folder | Reveals in Explorer | `library.reveal({ path })` |
| Delete / bulk Move to Recycle Bin | Confirm, then trash; toast "Moved `<trashed>` files (`<freed>`) to the Recycle Bin". The download is forgotten, so Files View shows it as not downloaded and Verify does not list it | `library.trash({ paths })` |
| Pagination | Page | `library.list({ ..., page })` |

### Data bindings

| Element | Source | Empty | Loading | Error |
|---------|--------|-------|---------|-------|
| Stats strip | `<library.stats>` | 0 | skeleton | ErrorState |
| Cards / rows | `<item.*>` | "No downloads yet" + "Open Downloads"; filters: "No files match" | 12 skeleton cards | ErrorState |
| Chat select options | `<library.chats>` | only "All chats" | – | – |
| Verify list | `<missing.items[]>` | "All files are present" | skeleton rows | ErrorState |

## Settings (mockup)

- Title "Settings", subtitle "Customize your experience and manage application preferences".
- Three columns: category nav (~170px), section cards (flex, scrollable), right column (~290px).
- Category nav items (icon, title, subtitle; active = primary fill + glow). Clicking scrolls to the section; scrolling highlights the current one (IntersectionObserver).

| Category | Subtitle | Rows (only real, honored settings) |
|----------|----------|------|
| General | Startup and window | Start with Windows (toggle), Minimize to tray on close (toggle) |
| Downloads | Location, limits, naming | Download folder (`<settings.downloadRoot>` + Change + Open), Max concurrent downloads (stepper 1–5), Skip existing files, Prefix file names with date, Folder template (text, placeholders `{chat}` and `{chat_id}`) |
| Uploads | Defaults and limits | Default destination (select of `canPost` chats + None), Upload as album, Keep original file names, Max concurrent uploads (stepper 1–3) |
| Telegram | Account, session, import | Account (avatar, `<me.name>`, `@<me.username>`, `<me.phone>`), API ID (`<settings.apiId>`; "API hash saved", never shown), Import from FileGram, Log out |
| Channels | Chat list | Show archived chats |
| Queue | Retries and cleanup | Auto-retry failed transfers, Retry attempts (stepper 1–10, disabled when auto-retry is off), Stall timeout (5 / 10 / 30 / 60 s), Clear completed after (Never / 1 / 7 / 30 days) |
| Files & Folders | App data and leftovers | App data folder (`<app.home>` + Open), Logs (Open), Leftover FileGram data (`<leftovers.dir>`, `<leftovers.total>` + Remove; row shown only when leftovers exist) |
| Notifications | Desktop alerts | Notify when transfers complete, Notify on failures |
| Privacy & Security | Cache and data | Clear cache (`<storage.cache.total>`), Clear app data (`<storage.appData>`) |
| About | Version and licenses | Version `<app.version>`, TDLib `<app.tdlib>`, Installed `fmtDate(<app.installedAt>)` (hidden when null, i.e. dev runs), Source code (`<app.repository>`, hidden when null), Open-source licenses |

Language is not shown (English only in v1). Appearance is removed (dark is the only theme; compact density is not trivial). "Check for updates" is not shown (no release feed). "Auto minimize to tray" from the mockup is the real "Minimize to tray on close".

- Section card: header with icon, title, subtitle; rows of label (bold) + description (`muted`) on the left, control on the right; rows divided by 1px lines. Changes save immediately; success shows a small "Saved" toast, a validation error shows inline under the row and reverts the control.
- Right column:
  - **App Status**: status line (green "All systems operational" when signed in and `<auth.connection>` is `ready`; amber "Connecting to Telegram…" while connecting/updating; red "Telegram is offline" when offline; amber "Not signed in" otherwise), Version `<app.version>`, Installed `fmtDate(<app.installedAt>)` (hidden when null), Telegram connection (● + state), Active downloads `<live.counts.download.active>`, Active uploads `<live.counts.upload.active>`.
  - **Storage**: indigo progress bar with %, "`<storage.drive.total − storage.drive.free>` of `<storage.drive.total>` used" on `<storage.drive.root>`; breakdown rows with colored squares: Videos (indigo), Images (green), Audio (cyan), Documents (blue), Archives (amber) from `<storage.library.*>`; App cache `<storage.cache.total>` with a "Clear cache" button.
  - **Danger Zone** (red trash icon, "These actions are permanent and cannot be undone."): red-tinted buttons "Clear All Data — Remove settings, history, cache, and your session" (deleting downloaded files is an unchecked option in its confirm) and "Disconnect Telegram — Log out and remove the saved session". Both use a typed confirmation (DELETE / DISCONNECT).

Data needs: `settings.get` (`settings`), `app.info`, `app.storage` (`storage`, refreshed when the page opens and after each clear), `fileGram.leftovers` (`storage`), `chats.list` (`chats`, for Default destination), `auth`, `stats.live`.

### Control inventory

| Control | Behavior | Call |
|---------|----------|------|
| Category nav item | Scrolls to section, updates `section` in URL | – |
| Start with Windows | Login item on/off | `settings.set({ startWithSystem })` → `app.setLoginItemSettings` |
| Minimize to tray on close | Close hides to tray | `settings.set({ closeToTray })` |
| Download folder > Change | Native folder dialog, then save; inline error on 400 (for example "Pick or create a subfolder, for example Downloads\TeleFlow" for the profile or a known folder itself) | `app.pickFolder()` → `settings.set({ downloadRoot })` |
| Download folder > Open | Explorer | `app.openPath({ target: 'downloads' })` |
| Max concurrent downloads − / + | 1–5 | `settings.set({ maxDownloads })` |
| Skip existing files / Prefix with date | Toggles | `settings.set({ skipExisting })`, `settings.set({ datePrefix })` |
| Folder template | Saves on blur or Enter; inline error on 400 | `settings.set({ folderTemplate })` |
| Default destination | Select | `settings.set({ defaultUploadChat })` |
| Upload as album / Keep original file names | Toggles | `settings.set({ uploadAlbum })`, `settings.set({ keepNames })` |
| Max concurrent uploads − / + | 1–3 | `settings.set({ maxUploads })` |
| Import from FileGram | `FileGramImportDialog` | see Login |
| Log out (Telegram) | Confirm, then log out; toast "Logged out" (+ Devices hint when `local`) | `auth.logout()` |
| Show archived chats | Toggle | `settings.set({ showArchived })` |
| Auto-retry failed transfers | Toggle | `settings.set({ autoRetry })` |
| Retry attempts − / + | 1–10 | `settings.set({ retryAttempts })` |
| Stall timeout | Select | `settings.set({ stallSeconds })` |
| Clear completed after | Select | `settings.set({ clearCompletedDays })` |
| App data folder > Open / Logs > Open | Explorer | `app.openPath({ target: 'appData' \| 'logs' })` |
| Leftover FileGram data > Remove | Confirm listing `<leftovers.items>` paths and sizes ("The FileGram downloads folder goes to the Recycle Bin; the rest is deleted."); toast "Freed `<freed>`" | `fileGram.removeLeftovers()` |
| Notify when transfers complete / Notify on failures | Toggles | `settings.set({ notifyComplete })`, `settings.set({ notifyFailed })` |
| Clear cache (Privacy, Storage card) | Disabled with hint "Pause active transfers first" while `<live.counts.download.active + live.counts.upload.active>` > 0 (live, so it re-enables as soon as transfers stop); confirm "Clear `<storage.cache.total>` of cache? Paused downloads restart from the beginning."; toast "Freed `<freed>`" | `app.clearCache()` |
| Clear app data | Disabled while transfers are active (same live condition); confirm "Delete history, queue, media index, and settings (download folder resets to default)? Your login and downloaded files stay."; toast "Freed `<freed>`" | `app.clearData()` |
| Source code | Opens in the browser | `<a href target="_blank">` → `shell.openExternal` |
| Open-source licenses | `LicensesDialog` with `<app.licenses>` (name, version, license) | `app.info()` |
| Clear All Data | Typed DELETE; checkbox "Also delete downloaded files (`<storage.library.files>` files, `<storage.library.total>`)", unchecked; toast "Freed `<freed>`"; app returns to Login | `app.clearAll({ deleteDownloads })` |
| Disconnect Telegram | Typed DISCONNECT; toast; app returns to Login | `auth.logout()` |

### Data bindings

| Element | Source | Empty | Loading | Error |
|---------|--------|-------|---------|-------|
| Every control value | `<settings.*>` | – | skeleton rows | ErrorState for the card |
| Account row | `<me.*>` | – | skeleton | – |
| Default destination options | `<chat.title>` where `canPost` | only "None" | disabled select | – |
| App Status | `<auth.connection>`, `<app.version>`, `<app.installedAt>`, `<live.counts>` | – | skeleton lines | ErrorState |
| Storage card | `<storage.*>` | 0 B rows | skeleton (scan can take seconds) | ErrorState + Retry |
| Clear cache / app data sizes | `<storage.cache.total>`, `<storage.appData>` | 0 B | skeleton | – |
| Leftover row | `<leftovers.*>` | row hidden | – | – |
| About | `<app.*>` | Source code hidden if no repository | skeleton | ErrorState |

## Login (not in mockups)

- Full-screen app background (window still draggable at the top), centered 420px panel, logo on top.
- Step indicator: API Keys → Phone → Code → Password (Password only when 2FA is on), driven by `<auth.step>`.
- Starting: spinner "Connecting to Telegram…". Logging out (`<auth.step>` = `logging-out`): spinner "Signing out…".
- API Keys step: API ID, API hash, helper link "Get them at my.telegram.org", and "Used FileGram before? Import from FileGram".
- Phone step: phone input (`type="tel"`), "Send code", "Back", and the same import link. `<auth.error>` shows above the input; it is how TeleFlow explains TDLib steps it cannot complete (email setup, sign-up, Premium), and the user can enter a different number.
- Code step: "We sent a code to `<auth.phone>`" + "via Telegram/SMS/call" from `<auth.via>`; code input (`autocomplete="one-time-code"`), "Sign in", "Use a different number".
- Password step: hint `<auth.hint>` (hidden if empty), password input, "Sign in", "Use a different number".
- Each step: labelled input, primary button (busy state while the call runs), inline error (`role="alert"`) from the rejected call or `<auth.error>`.
- When the state becomes `ready`, the shell shows Overview.

Data needs: `auth.get` + `auth` events (step, phone, via, hint, error, connection); `app.pickFolder`, `fileGram.inspect`, `fileGram.import`, `fileGram.removeLeftovers` inside `FileGramImportDialog`. Login renders no other data.

### Control inventory

| Control | Behavior | Call |
|---------|----------|------|
| Continue (API Keys) | Saves credentials, starts TDLib | `auth.credentials({ apiId, apiHash })` |
| Get them at my.telegram.org | External browser | `<a href="https://my.telegram.org" target="_blank">` |
| Import from FileGram | Folder dialog → summary of `<fg.*>` (session, credentials, `<fg.downloadsDir>` + `<fg.downloadsSize>`, and `<fg.downloadsWarning>` in amber when that folder cannot become the download folder) → Import; "Close FileGram first" + Retry on 409; the result's `warning` (if any) stays visible; then "Remove leftover FileGram data (`<leftovers.total>`)" or "Not now" | `app.pickFolder()` → `fileGram.inspect({ dir })` → `fileGram.import({ dir })` → `fileGram.removeLeftovers()` |
| Send code | Submits phone | `auth.phone({ phone })` |
| Back (Phone) | Shows API Keys step; resubmitting restarts TDLib | – |
| Sign in (Code) | Submits code | `auth.code({ code })` |
| Use a different number | Shows Phone step (TDLib accepts a new number) | – |
| Sign in (Password) | Submits password | `auth.password({ password })` |

## Dialogs

| Dialog | Controls | Calls |
|--------|----------|-------|
| `OpenChatDialog` | Input "t.me link, invite link, or @username", Open, Cancel; for invites "Join `<invite.title>` (`<invite.members>` members)?" with Join / Cancel | `chats.open({ link })`, `chats.open({ link, join: true })` |
| `confirm()` | Cancel, Confirm (danger tone for destructive), optional typed word (Confirm disabled until it matches), optional checkbox | – |
| `VerifyDialog` | Checkboxes, Select all, Re-download selected, Close | `downloads.add({ items, force: true })` |
| `LicensesDialog` | Close | – |
| `FileGramImportDialog` | Import, Retry, Remove leftover FileGram data, Not now, Cancel | as in Login |

Every dialog closes with Escape and returns focus to the control that opened it.

## Tray and notifications (native)

| Control | Behavior |
|---------|----------|
| Tray: Show TeleFlow / double-click | Shows and focuses the window |
| Tray: Pause all / Resume all | `jobs.action({ action: 'pause' \| 'resume' })` in main |
| Tray: Quit TeleFlow | Graceful quit |
| Tray tooltip | "TeleFlow — `<active>` active · `fmtSpeed(<speed>)`" |
| Notification click | Shows the window |

## Accessibility

- Real `<button>`, `<a>`, `<input>`, `<label>`, `<table>` elements; icon-only buttons get `aria-label`.
- Visible focus ring: 2px `primary` outline with offset.
- Text contrast at least 4.5:1 against its background (verify `muted` on `panel`).
- Everything reachable by keyboard, including table checkboxes, row actions (revealed on focus, not only hover), menus, the chart, and dialogs.
- Live regions: toasts use `role="status"` (errors `role="alert"`); progress bars use `role="progressbar"` with `aria-valuenow`.
- Respect `prefers-reduced-motion` for shimmer and transitions.
- Status is never conveyed by color alone: pills carry text.
- Full WCAG validation needs manual testing with assistive technologies; the Playwright suite only checks structure and focus order.
