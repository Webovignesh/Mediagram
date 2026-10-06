# TeleFlow: UI Spec

Transcribed from four mockups: Overview, Downloads, Queue, Settings. Uploads, Media Library, and Login are not in the mockups and follow the same patterns. There is no Analytics page.

Where mockups disagree, this file decides:
- The app is Mediagram everywhere in the UI (the spec keeps the TeleFlow project name; two mockups say "TG Manager").
- Sidebar nav is: Overview, Downloads, Uploads, Queue, Settings (5 items). Media Library exists as a page (`#/library`) but has no sidebar entry.
- Each page carries its own search; there is no global search bar in the top bar (the mockup's top-bar search is not built).

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
| `bg` | `#060b18` with a subtle radial blue glow near the top | App background, top bar, title bar overlay color |
| `sidebar` | `#070d1d`, right border `border` | Sidebar |
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
- Sidebar (200px, 64px collapsed): logo block (blue paper-plane mark, "Workspace" bold, "Telegram Manager" 10.5px `muted`), then nav: Overview, Downloads, Uploads, Queue, Settings. Queue badge = open jobs (`<live.counts.*.queued + active + paused>`), hidden at 0.
- Top bar: 36px (`h-9`) drag bar, background `#0f172a` with a hairline bottom border. Left (`no-drag`): paper-plane mark + "Mediagram" (12px semibold). Middle: a reserved `no-drag` slot for the OTA update pill. Right: the native min/max/close buttons drawn by Windows (`titleBarOverlay`). No global search and no user menu in v1 — Log out lives in Settings > Danger Zone.
- Content: page title + subtitle, optional page action top-right, then a grid. Pages with a side column use main + 290px right column.
- Routes: `#/overview` (default), `#/downloads?chat=<id>&view=files|chat` (`view` defaults to `files`), `#/uploads?chat=<id>`, `#/queue?tab=downloads|uploads|completed|failed` (default `downloads`), `#/library?q=`, `#/settings?section=<id>` (Settings scrolls to it on mount). Any auth step other than `ready` shows Login instead.
- Target 1440×900; must stay usable at 1280×720. Minimum window 1024×640. Below 1280px wide, the right column moves under the main area.

Data needs: `auth.get` + `auth` events (auth gate), `stats.live` + `stats` events (Queue badge).

### Control inventory

| Control | Behavior | Call |
|---------|----------|------|
| Sidebar item | Navigate | `#/<page>` |

### Data bindings

| Element | Source | Empty | Loading | Error |
|---------|--------|-------|---------|-------|
| Queue badge | `<live.counts.*.queued + active + paused>` | hidden at 0 | hidden | – |

## ui.tsx inventory

Shared primitives live in `web/src/ui.tsx`. Components used by one page stay in that page file.

| Export | What it is | Used by |
|--------|------------|---------|
| `fmtBytes`, `fmtSpeed`, `fmtEta`, `fmtAgo`, `fmtDuration`, `fmtCount`, `fmtDate` | `Intl.NumberFormat` / `RelativeTimeFormat` / `DateTimeFormat` formatters | All pages |
| `typeLabel` | One map from media/history `type` to words: `video_note` → "video message", `voice` → "voice message", `animation` → "GIF", `album` → "album", others as is | Recent Activity, Chat View |
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
| `toast()`, `<Toaster/>` | Bottom-right toasts, `role="status"`, 4 s (errors 8 s); `toast.info(msg, { title, duration, action: { label, onClick } })` renders the action as a button in the toast | Everywhere |
| `Empty`, `Skeleton`, `ErrorState` | Empty state, shimmer block, error + Retry | Every data-bearing element |
| `SelectionBar` | "`<n>` selected" + actions + Clear | Files View, Queue, Library |
| `TransferCard` | Job card: thumb, name, pill, progress, detail line, actions | Downloads and Uploads right column |
| `JobActions` | Pause/resume, cancel, retry for one job | Overview Current Jobs, Queue rows, `TransferCard` |
| `ChatPicker` | Chat panel: search, chips, rows, selection | Downloads, Uploads |
| `OpenChatDialog` | Link/username → `chats.open`, join confirm | Overview, Downloads, global search |

Page-local: `AreaChart` (Overview), `Sparkline` (Queue), `FilesView` and `ChatView` (Downloads), `VerifyDialog` (Library), `Stepper` and `LicensesDialog` (Settings).

`web/src/api.ts` exports `call`, `on`, `useCall(method, args, topics)` (`{ data, error, loading, reload }`; `data` survives refetches), `useLive()` (`{ auth, live }`), `useRoute()`, `navigate()`.

## Overview

Layout (mockup):
- Title "Welcome to Mediagram", subtitle "Your Telegram videos, downloads, and uploads — all in one place." Top-right secondary button with link icon: "Connect Channel".
- Row of 4 KPI cards: Active Transfers (blue lightning tile), Completed Today (green check tile), Total Files (indigo stack tile), Failed Jobs (red warning tile). Each: value + "`<d>` downloads • `<u>` uploads".
- Row of 3 panels:
  - **Transfer Activity**, "Downloads and uploads over time", range select. Area chart, Downloads (blue) and Uploads (purple), gradient fills, y gridlines, x labels (24h: every 3 hours; 7d: weekdays; 30d: every 5 days). Hover/focus shows a vertical guide, dots, and a tooltip ("`<bucket label>` / Downloads `<n>` / Uploads `<n>`"). Legend below.
  - **Channel Activity**, "Top channels by transfer volume", range select. Rows: avatar, `<top.title>`, horizontal bar (alternating blue/purple, length relative to the top row), "`<top.count>` files".
  - **Recent Activity** with "View All". Rows: direction tile (download blue / upload purple), thumbnail, text ("Downloaded `typeLabel(<type>)` from `<chatTitle>`", "Uploaded `typeLabel(<type>)` to `<chatTitle>`", "Failed to download `<name>`", "Failed to upload `<name>`"), time ago, size right, green check circle or red x.
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
- **Chats & Channels** panel: title + "+" button. Search "Search chats or channels…". Chips: All, Channels, Groups, Folders (Folders shows the user's Telegram folders as a sub-list with a back button). Rows are two lines: line 1 is avatar, `<chat.title>` bold (truncates) and `fmtAgo(<chat.lastDate>)` right (no wrap, exact time in the title attribute); line 2 is typing indicator or `@<chat.username>` `muted` (truncates) with the unread badge `<chat.unread>` right (primary pill, hidden at 0). Selected row: primary-tinted background. The selected row also carries a primary "• Indexing" pill (pulsing dot) while its `scan.state` is `scanning`.
- **Files panel**:
  - Header: segmented toggle "Chat View" | "Files View" and, in Files View, search "Search files in this channel…".
  - Index bar (`role="status"`, `aria-live="polite"`), shown while `scan.state` is `scanning`, `failed`, or `paused`:
    - `scanning`: "Indexing media… `<scan.indexed>` of about `<scan.total>` • `<eta>` left • `<rate>`/s" with a thin progress bar (indeterminate and pulsing when `<scan.total>` is null) and a secondary **Stop** button (`chats.stopScan`). The rate is an EMA of the per-second change of `<scan.indexed>`; the ETA is `(total - indexed) / rate`, both hidden until there is a sample and a total.
    - `failed` (danger tint): "Indexing stopped: `<scan.error>`" with a primary **Retry** button (`chats.rescan`); no bar.
    - `paused` (amber tint): "Indexing paused at `<scan.indexed>` of about `<scan.total>` files" with a primary **Resume** button (`chats.rescan`).
  - Filter row(s): Media Type, File Type (options = `<media.exts>`, every extension in the chat's index whatever the filters, so picking one keeps the others listed), Duration, Size, Status, Sort By, "Reset" (rotate icon).
  - Table: checkbox, #, Thumbnail, File Name, Type chip, Size, Duration, Status pill. A selection bar appears when rows are checked: "`<n>` selected • Download selected • Download all `<media.total>` matching" (the count makes the scope visible while indexing is still running).
  - Pagination at the bottom.
  - Chat View: message list with `<message.sender>`, time, `<message.text>`, media card (`typeLabel(<media.type>)`, `<media.size>`, Download button, or progress/status, or Show in folder when downloaded). "Load older messages" at the end while `chats.messages` returns `more: true`; when `limit === 1000 && more` it is replaced by "Older media are in Files View" (switches the view).
- **Right column**:
  - **Download Overview** (bar-chart icon): 2×2 tiles: Speed (lightning, cyan), Active (green download-circle), Remaining (purple clock, pink value), Total Files (doc icon).
  - **Transfer Queue** (doc icon): `TransferCard`s with thumbnail 44px, `<job.name>`, status pill, progress + %, detail line by status: active "`<done>` / `<size>` • `<eta>` left", finalizing "`<size>` • Finalizing", paused "`<done>` / `<size>` • Paused", queued "`<done>` / `<size>` • Waiting to start", flood wait "Waiting for Telegram • `<seconds>`s". Shows the first 5 open jobs; link "View all".

Data needs: `chats.list` (`chats`), `chats.media({ chatId, ...filters, page })` (`media:<chatId>`), `chats.messages({ chatId, limit })` (`messages:<chatId>`), `jobs.list({ kind: 'download', status: 'open', pageSize: 5 })` (`jobs`), `stats.overview` (`history`, for Total Files), `stats.live`. The engine emits the chat's `media:` and `messages:` topics on every download job insert, status change, finalize, or delete in that chat and on trash (ARCHITECTURE > Events), so both views refetch only for their own chat, including right after a cancel from the Transfer Queue card; row and card progress comes from `live.active` by `jobId`.

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
| Load older messages | Loads up to 30 more older messages (scroll position kept) | `chats.messages({ chatId, limit: Math.min(limit + 30, 1000) })` |
| Older media are in Files View | Switches to Files View | `#/downloads?chat=<id>&view=files` |
| Transfer Queue card actions | Pause/resume, cancel | `jobs.action(...)` |
| View all | Opens Queue | `#/queue?tab=downloads` |

### Data bindings

| Element | Source | Empty | Loading | Error |
|---------|--------|-------|---------|-------|
| Chat rows | `<chat.*>` | "No chats yet" + "Open a chat"; search: "No chats match" | 8 skeleton rows | ErrorState |
| Folder list | `<folder.name>`, chat count | "You have no Telegram folders" | – | – |
| Files panel, no chat | – | "Select a chat to see its files" | – | – |
| Index bar | `<scan.state>`, `<scan.indexed>`, `<scan.total>`, `<scan.error>` | hidden when `done` or `idle`; `failed` → reason + Retry, `paused` → count + Resume | – | – |
| Chat-list pill | `scan.state` of the selected chat | hidden unless `scanning` | – | – |
| File rows | `<media.thumb>`, `<media.name>`, `<media.ext>`, `<media.size>`, `<media.duration>`, `<media.status>` + live progress | `<scan.state>` is `scanning` and no rows yet: index bar + 8 skeleton rows; not scanning and none: "No media in this chat"; filters: "No files match these filters" + Reset | 8 skeleton rows | ErrorState |
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
  - **Queue Overview**: 2×2 tiles: Total (blue doc), Downloading/Uploading/Active (green ↓ circle), Queued (purple clock), Paused (amber pause circle). Kind tabs count that kind; Completed/Failed tabs count both kinds and label the second tile "Active". Total = all job rows of the counted kind(s), every status (sum of `<live.counts[kind].*>`).
  - **Live Activity**: blue sparkline of total speed (`<live.history>`, last 60 s), big cyan `fmtSpeed(<live.speed.download + live.speed.upload>)`, caption "Total transfer speed" (amber "Telegram asked to wait · resumes in `<seconds>`s" during a flood wait), legend with colored squares: "`<active>` Active", "`<queued>` Queued", "`<paused>` Paused", each summed over both kinds on every tab.
  - **Queue Actions**: 2×2 tinted buttons: Pause All (blue), Resume All (green), Clear Completed (neutral), Clear All (red, confirm). Clear All's `<n>` = sum of every `<live.counts>` value (all job rows, both kinds).

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
| Clear All | Confirm "Remove all `<n>` jobs? Partial downloads are deleted." (`<n>` = sum of all `<live.counts>`) | `jobs.action({ action: 'cancel' })` |

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
- Scan strip (`role="status"`, `aria-live="polite"`), between the stats strip and the toolbar: "Scanning the download folder… `<n>` files indexed so far" with an indeterminate pulsing bar. `library.list` answers a cached scan in milliseconds and only waits when it really has to walk the folder, so the strip appears after 150 ms — the moment a cache hit would already have answered — and disappears with the answer.
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
| Downloads | Location, limits, naming | Download folder (`<settings.downloadRoot>` + Change + Open; description "Existing downloads stay where they are"), Max concurrent downloads (stepper 1–5), Skip existing files, Prefix file names with date, Folder template (text, placeholders `{chat}` and `{chat_id}`) |
| Uploads | Defaults and limits | Default destination (select of `canPost` chats + None), Upload as album, Keep original file names, Max concurrent uploads (stepper 1–3) |
| Telegram | Account and session | Account (avatar, `<me.name>`, `@<me.username>`, `<me.phone>`), Telegram API data (editable API ID and API hash, the hash in a `type="password"` field and never shown; heading line "Your own API ID and hash from my.telegram.org — Mediagram uses them to connect to Telegram."; status line green "Saved on this device — kept through sign-out, so you won't be asked for these again." when `<settings.apiHashSaved>` with a muted line under it — "Saved keys are encrypted with your Windows account (DPAPI) and never leave this device. Signing out keeps them; Clear All Data erases them." —, amber "Not saved yet: these keys are only in this session, so Mediagram will ask for them again next time. A completed sign-in saves them automatically." otherwise; **Save API data** → `auth.saveKeys` (disabled and relabelled "Saved" once saved; toast title "API data saved", text "Encrypted on this device — signing out keeps it."), **Delete API data** (only while `<settings.apiHashSaved>`; tint danger button left of "Saved"; confirm "Delete API data" / "Erases the API data saved on this device. Your current sign-in keeps working; you will be asked for it again after signing out."; toast title "API data deleted", text "You will be asked for your API data again after signing out."; the status line flips to the amber one), **Update API data** → a confirm dialog ("Update API data" / "New keys are checked by Telegram with a fresh sign-in — you'll enter your phone number and code again. Apply the update?") then `auth.credentials` (validated in the renderer first: a whole number 1–2147483647 and 32 hex characters; a wrong value keeps an inline `role="alert"` error on its own field and never reaches TDLib, and when the keys were already saved the new ones are re-saved too; success toast "API data saved"), a hint under API ID while signed in and typing: "Applying updated keys checks them with Telegram straight away: you'll sign back in with your phone number and code.", link "Get them at my.telegram.org")) |
| Channels | Chat list | Show archived chats |
| Queue | Retries and cleanup | Auto-retry failed transfers, Retry attempts (stepper 1–10, always enabled; description "Starts per transfer, including stall restarts"), Stall timeout (5 / 10 / 30 / 60 s), Clear completed after (Never / 1 / 7 / 30 days) |
| Files & Folders | App data and logs | App data folder (`<app.home>` + Open), Logs (Open) |
| Notifications | Desktop alerts | Notify when transfers complete, Notify on failures |
| About | Version and licenses | Version `<app.version>`, TDLib `<app.tdlib>`, Installed `fmtDate(<app.installedAt>)` (hidden when null, i.e. dev runs), Source code (`<app.repository>`, hidden when null), Open-source licenses |

Language is not shown (English only in v1). Appearance is removed (dark is the only theme; compact density is not trivial). "Check for updates" is not shown (no release feed). "Auto minimize to tray" from the mockup is the real "Minimize to tray on close".

- Section card: header with icon, title, subtitle; rows of label (bold) + description (`muted`) on the left, control on the right; rows divided by 1px lines. Changes save immediately; success shows a small "Saved" toast, a validation error shows inline under the row and reverts the control.
- **Danger Zone** (bottom panel, red trash icon, subtitle "Sign out or delete data stored on this device."): three rows — **Log out** (or **Log in** when there is no active session) with a plain danger button (`variant="danger"`, Log out icon + label; the row explains the saved API data stays; Log in calls `navigate('/overview')`, where the app gate opens Login), **Clear cache** (neutral row; same disabled state and confirm as below), and **Clear app data** (red row; row description "Deletes history, queue, media index, and settings (`<storage.appData>`)"; its confirm has a 3-second countdown before the delete button opens).

Data needs: `settings.get` (`settings`), `app.info`, `app.storage` (`storage`, refreshed when the page opens and after each clear), `chats.list` (`chats`, for Default destination), `auth`, `stats.live`.

### Control inventory

| Control | Behavior | Call |
|---------|----------|------|
| Category nav item | Scrolls to section, updates `section` in URL | – |
| Start with Windows | Login item on/off | `settings.set({ startWithSystem })` → `app.setLoginItemSettings` |
| Minimize to tray on close | Close hides to tray | `settings.set({ closeToTray })` |
| Download folder > Change | Native folder dialog, then save; inline error on 400 with the reason from `checkDownloadRoot` (for example "Pick or create a subfolder, for example Downloads\TeleFlow" for the profile or a known folder itself, "TeleFlow can't use a system or app data folder…" for AppData or Program Files) | `app.pickFolder()` → `settings.set({ downloadRoot })` |
| Download folder > Open | Explorer | `app.openPath({ target: 'downloads' })` |
| Max concurrent downloads − / + | 1–5 | `settings.set({ maxDownloads })` |
| Skip existing files / Prefix with date | Toggles | `settings.set({ skipExisting })`, `settings.set({ datePrefix })` |
| Folder template | Saves on blur or Enter; inline error on 400 | `settings.set({ folderTemplate })` |
| Default destination | Select | `settings.set({ defaultUploadChat })` |
| Upload as album / Keep original file names | Toggles | `settings.set({ uploadAlbum })`, `settings.set({ keepNames })` |
| Max concurrent uploads − / + | 1–3 | `settings.set({ maxUploads })` |
| Log out / Log in (Danger Zone) | Log out: a plain danger button (Log out icon + label); confirm ("Log out" / "Your Telegram session ends on this device. Saved API data stays, so signing back in is quick."), then log out; toast "Logged out" (+ Devices hint when `local`); the saved API keys stay on disk and the app restarts at the phone screen with them. Log in: shown only when there is no active session; `navigate('/overview')`, where the app gate opens Login | `auth.logout()` |
| Save API data | Writes the keys of this session, encrypted, so Login is skipped next time; toast title "API data saved", text "Encrypted on this device — signing out keeps it."; disabled once `<settings.apiHashSaved>` | `auth.saveKeys()` |
| Delete API data | Shown only while `<settings.apiHashSaved>`; confirm ("Delete API data" / "Erases the API data saved on this device. Your current sign-in keeps working; you will be asked for it again after signing out."), then erase the saved pair; toast title "API data deleted", text "You will be asked for your API data again after signing out."; the status line flips to the amber "Not saved yet" one; the signed-in session keeps working | `auth.forgetKeys()` |
| Update API data | Confirm dialog first ("Update API data": changed keys are re-checked by Telegram with a fresh sign-in), then API ID + API hash drafts, validated in the renderer (whole number 1–2147483647, 32 hex characters) before anything is sent; the error stays under the field it belongs to (`role="alert"`), blur checks a field on its own, a previously saved pair is re-saved; toast "API data saved" | `confirm()` → `auth.credentials()` (+ `auth.saveKeys()` when `<settings.apiHashSaved>`) |
| Show archived chats | Toggle | `settings.set({ showArchived })` |
| Auto-retry failed transfers | Toggle | `settings.set({ autoRetry })` |
| Retry attempts − / + | 1–10; enabled whether or not auto-retry is on (it also caps stall restarts) | `settings.set({ retryAttempts })` |
| Stall timeout | Select | `settings.set({ stallSeconds })` |
| Clear completed after | Select | `settings.set({ clearCompletedDays })` |
| App data folder > Open / Logs > Open | Explorer | `app.openPath({ target: 'appData' \| 'logs' })` |
| Notify when transfers complete / Notify on failures | Toggles | `settings.set({ notifyComplete })`, `settings.set({ notifyFailed })` |
| Clear cache (Danger Zone) | Disabled with hint "Pause active transfers first" while `<live.counts.download.active + live.counts.upload.active>` > 0 (live, so it re-enables as soon as transfers stop); confirm "Clear `<storage.cache.total>` of cache? Paused downloads restart from the beginning."; toast "Freed `<freed>`" | `app.clearCache()` |
| Clear app data (Danger Zone) | Disabled while transfers are active (same live condition); row description "Deletes history, queue, media index, and settings (`<storage.appData>`)"; confirm "Clear app data" / "Deletes your history, download queue, media index, and all settings — the download folder resets to the default.", delete button disabled for a 3-second countdown ("Clear app data (3s)" → "(2s)" → "(1s)") then opens; toast "Freed `<freed>`" | `app.clearData()` |
| Source code | Opens in the browser | `<a href target="_blank">` → `shell.openExternal` |
| Open-source licenses | `LicensesDialog` with `<app.licenses>` (name, version, homepage) | `app.info()` |
| Clear All Data | IPC exists but is not wired to any Settings button (no typed DELETE, no file option in the UI) | `app.clearAll({ deleteDownloads })` |

### Data bindings

| Element | Source | Empty | Loading | Error |
|---------|--------|-------|---------|-------|
| Every control value | `<settings.*>` | – | skeleton rows | ErrorState for the card |
| Account row | `<me.*>` | – | skeleton | – |
| Default destination options | `<chat.title>` where `canPost` | only "None" | disabled select | – |
| App Status | `<auth.connection>`, `<app.version>`, `<app.installedAt>`, `<live.counts>` | – | skeleton lines | ErrorState |
| Storage card | `<storage.*>` | 0 B rows | skeleton (scan can take seconds) | ErrorState + Retry |
| Clear cache / app data sizes | `<storage.cache.total>`, `<storage.appData>` | 0 B | skeleton | – |
| About | `<app.*>` | Source code hidden if no repository | skeleton | ErrorState |

## Login (not in mockups)

- Full-screen app background (window still draggable at the top), centered 420px panel, logo on top.
- Step order the user sees: Phone → API data (one time, only when nothing is stored) → Processing → Code → Password (Password only when 2FA is on), driven by `<auth.step>`. With nothing stored the panel opens on the phone number, because Telegram cannot send a code before it knows this app's API ID and hash: the API fields are asked for only when Continue finds no TDLib client to send the number with, so Login never opens on them. After the keys the panel stays on the Processing screen until Telegram answers with a real step.
- Processing screen (also opened by a sign-in that starts with saved keys): heading "Signing in to Telegram" (or "Sign-in could not continue" when something failed), stage rows — "Starting the Telegram engine", "Connecting to Telegram", "Checking your API ID and hash — sending your code" — each a done tick, a spinner while active, or a quiet dot pending, with a hint that Telegram can take up to a minute. A failure shows an error card (`role="alert"`) and **Back**: to the API data step when a rejection put it there, otherwise to the phone form, which then sends the number itself. The stages only advance when the state does — the number is sent once `connection` is ready (4 s fallback), so "Connecting" never claims more than TDLib reports. When the flow ends on `ready` the panel rests on "Signed in / Opening Mediagram…" while the dashboard transitions in.
- Logging out (`<auth.step>` = `logging-out`): spinner "Logging out…".
- Phone step: country select + phone input (`type="tel"`), "Continue". `<auth.error>` shows above the input; it is how TeleFlow explains TDLib steps it cannot complete (email setup, sign-up, Premium), and the user can enter a different number.
- API data step (one time, after Continue with nothing stored): API ID, API hash (`type="password"`, placeholder only), "Back" to the phone number (it is kept and shown as "Then we'll continue signing in as `<number>`"), and under the boxes a guide card "Where do I get these?" — header link "Open my.telegram.org" plus five plain steps (open my.telegram.org and log in with the phone number — Telegram sends a code in the app; click "API development tools"; fill in any app title and short name and create the app; copy "App api_id" into API ID; copy "App api_hash" into API hash) and a note that the values stay on this device (saved encrypted with the Windows account) and are only sent to Telegram. Continue starts TDLib — the processing screen appears at once — and the number typed before the keys is sent automatically once the connection is up. No sample values: the step starts empty (No hardcoded data). A rejected API ID/hash lands on the processing screen's error card, whose Back returns here; this step's own Back stays hidden until the keys are corrected (`<auth.error>`). The 40px top strip is the drag region and reserves the native window buttons with `env(titlebar-area-x/width)`.
- Code step: "Enter the code sent to `<auth.phone>`" + "via Telegram/SMS/call" from `<auth.via>`; code input (`autocomplete="one-time-code"`), "Verify", "Back" (shows the Phone step — TDLib accepts a new number).
- Password step: hint `<auth.hint>` (hidden if empty), password input, "Continue", "Back".
- Each step: labelled input, primary button (busy state while the call runs), inline error (`role="alert"`) from the rejected call or `<auth.error>`.
- When the state becomes `ready`, the panel shows "Signed in / Opening Mediagram…" and Login stays mounted one transition while the dashboard mounts beneath it and rises in (`login-exit` over `app-enter`, 0.48 s); then Login is gone.
- After sign-in nothing is asked: no toast, no prompt and no highlight — the ready gate has already saved the keys (encrypted) for the next start. API data is asked for again only by Settings > Delete API data, Clear All Data, or a rejection from Telegram; Settings > Telegram > API credentials remains the place to see the status and update the pair.

Data needs: `auth.get` + `auth` events (step, phone, via, hint, error, connection). Login renders no other data.

### Control inventory

| Control | Behavior | Call |
|---------|----------|------|
| Continue (Phone) | With a TDLib client: submits the number. With nothing stored: opens the one-time API data step, keeping the number | `auth.phone({ phone })` |
| Back (API data) | Returns to the Phone step, keeping the number | – |
| Continue (API data) | Starts TDLib with the keys; the processing screen appears, and the number typed before them is sent once the connection is ready | `auth.credentials({ apiId, apiHash })`, `auth.phone({ phone })` |
| Back (Processing) | Leaves the processing screen: to the API data step when a rejection put it there, otherwise to the phone form, which then sends the number itself | – |
| Guide box links ("Open my.telegram.org" header, step-1 "my.telegram.org") | External browser | `<a href="https://my.telegram.org" target="_blank">` |
| Verify (Code) | Submits code | `auth.code({ code })` |
| Back (Code, Password) | Shows Phone step (TDLib accepts a new number) | – |
| Continue (Password) | Submits password | `auth.password({ password })` |

## Dialogs

| Dialog | Controls | Calls |
|--------|----------|-------|
| `OpenChatDialog` | Input "t.me link, invite link, or @username", Open, Cancel; for invites "Join `<invite.title>` (`<invite.members>` members)?" with Join / Cancel; a rejected call (bad link, 409 join request sent, 403 join refused) shows its message inline in the dialog | `chats.open({ link })`, `chats.open({ link, join: true })` |
| `confirm()` | Cancel, Confirm (danger tone for destructive), optional typed word (Confirm disabled until it matches), optional checkbox | – |
| `VerifyDialog` | Checkboxes, Select all, Re-download selected, Close | `downloads.add({ items, force: true })` |
| `LicensesDialog` | Close | – |

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
