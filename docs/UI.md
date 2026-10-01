# TeleFlow: UI Spec

Transcribed from four mockups: Overview, Downloads, Queue, Settings. Uploads, Media Library, Analytics, and Login are not in the mockups and must follow the same patterns. The mockups show sample data ("Alex Carter", "MrBeast", file names); the app shows real data.

Where mockups disagree, this file decides:
- Brand is TeleFlow everywhere (two mockups say "TG Manager").
- Sidebar nav is: Overview, Downloads, Uploads, Queue, Media Library, Analytics, Settings.
- The global search bar from the Settings mockup appears in the top bar on every page.

## Design system

### Look
Dark navy, glassy panels, thin blue-tinted borders, soft blue glow on active elements. Dense but calm: small type, generous panel padding, clear hierarchy.

### Color tokens (approximate, tune to match)

| Token | Value | Use |
|-------|-------|-----|
| `bg` | `#060b18` with a subtle radial blue glow near the top | App background |
| `sidebar` | `#070d1d`, right border `border` | Sidebar |
| `panel` | `#0c1530` at ~85% opacity | Panels |
| `tile` | `#0f1a38` | Stat tiles and rows inside panels |
| `border` | `rgba(96,140,255,0.14)` | Panel, tile, input borders |
| `primary` | `#2563eb` (hover `#3b82f6`) | Active nav, primary buttons, active chips, selected page |
| `glow` | `0 0 0 1px #3b82f6, 0 0 16px rgba(59,130,246,.35)` | Active nav item, focused primary |
| `text` | `#eaf0ff` | Primary text |
| `text-2` | `#a3b0cf` | Secondary text |
| `muted` | `#7a88a8` | Labels, hints (check contrast on `panel`) |
| `success` | `#22c55e` | Completed, connected, resume |
| `warning` | `#f59e0b` | Paused, finalizing |
| `danger` | `#ef4444` | Failed, destructive |
| `upload` | `#8b5cf6` | Uploads (chart series, direction icon, pill) |
| `cyan` | `#38bdf8` | Speed values |
| `pink` | `#e879f9` | "Remaining" value |

### Type
- Font: Inter, then "Segoe UI Variable", system-ui.
- Page title 28px bold; subtitle 13px `text-2`.
- Panel title 15px semibold with an 18px outline icon to its left.
- Body/table 13px; labels 12px `muted`; stat value 22px bold.

### Shape and spacing
- Panels: radius 14px, 1px `border`, padding 16px, gap 16px between panels.
- Tiles, inputs, buttons, rows: radius 10–12px.
- Pills and badges: fully rounded.
- Icons: lucide outline, 16–18px. Stat icons sit in a 40px rounded-xl tile tinted with the accent color at ~15% plus a matching border.

### Components
- **Sidebar nav item**: icon + label, 40px tall. Active: `primary` fill with `glow`. Optional right badge (count, rounded, primary tint), used by Queue.
- **Stat tile**: icon tile left, label (`muted`) above value (bold). Overview KPI cards add a one-line split under the value ("2 downloads • 3 uploads").
- **Status pill**: Downloading = solid primary; Uploading = solid/tinted purple; Finalizing = amber tint; Paused = amber outline + amber text; Completed = green outline + green text; Queued = slate outline; Failed = red outline.
- **Progress bar**: 6px, rounded, track `#1e2a47`. Fill by status: blue (downloading), purple (uploading), amber (paused/finalizing), green (completed), red (failed). Percentage right-aligned next to it; "1.0 GB / 1.4 GB" under it where space allows.
- **Filter chip**: small rounded rect; active = primary fill. With a colored status dot and count when used for statuses.
- **Dropdown filter**: label + value + chevron in one bordered control ("Media Type  All ⌄").
- **Segmented toggle**: two options with icons, active option primary fill (Chat View | Files View).
- **Toggle switch**: pill switch, on = primary.
- **Stepper**: − value + (Max concurrent downloads).
- **Table**: header row in `muted` 12px, rows 48px with 1px dividers, checkbox column, thumbnails 40×28 rounded, type chip ("MP4") outlined small caps.
- **Pagination**: "‹ Previous", numbered buttons (active primary), "Next ›"; plus "Showing 1–8 of 8 items" on the left where shown.
- **Buttons**: primary (solid blue), secondary (bordered `tile`), tinted action buttons (blue/green/neutral/red at ~15% with matching border and text), danger.
- **Avatars**: chat photos rounded-lg 36px in lists, 28px in tables; fallback = colored initial.
- **Feedback**: toasts bottom-right; confirm dialogs with native `<dialog>`; skeleton shimmer while loading; empty states = icon + one line + one action.

### Shell
- Sidebar 170px fixed: logo (blue paper-plane mark, "TeleFlow" bold, tagline "Download. Upload. Organize." 11px `muted`), then nav.
- Top bar: global search input (left, max ~670px): "Search channels, chats, files, or paste a Telegram link…". Typing searches chats and files; pasting a `t.me` link offers "Download media from this link". Right side: user menu (avatar circle, Telegram display name, chevron). Menu: account (name, masked phone), Settings, Log out.
- Content: page title + subtitle, optional page action top-right, then a grid. Pages with a side column use main + 290px right column.
- Target 1440×900; must stay usable at 1280×720. Below 1280px wide, the right column moves under the main area.

## Overview (mockup)

- Title "Welcome to TeleFlow", subtitle "Manage your Telegram video downloads and uploads in one powerful workspace." Top-right secondary button with link icon: "Connect Channel".
- Row of 4 KPI cards:
  - Active Transfers (blue lightning tile), e.g. 5, "2 downloads • 3 uploads"
  - Completed Today (green check tile), e.g. 24, "18 downloads • 6 uploads"
  - Total Files (indigo stack tile), e.g. 26, "12 downloads • 14 uploads"
  - Failed Jobs (red warning tile), e.g. 2
- Row of 3 panels:
  - **Transfer Activity**, "Downloads and uploads over time", range dropdown "Last 24 hours". Area chart with two series, Downloads (blue) and Uploads (purple), gradient fills, y gridlines, x labels every 3 hours. Hover shows a vertical guide, dots, and a tooltip ("12:00 / Downloads 28 / Uploads 14"). Legend below.
  - **Channel Activity**, "Top channels by transfer volume", dropdown "Last 7 days". Rows: avatar, name, horizontal bar (alternating blue/purple), "48 files".
  - **Recent Activity** with "View All" link (to Queue > Completed). Rows: direction tile (download blue / upload purple), thumbnail, text ("Downloaded video from MrBeast"), time ago, size right, green check circle (or red x for failures).
- **Current Jobs** panel, "Active downloads and uploads", filter dropdown "All Jobs". Columns: #, Source (Channel / Group) with avatar, name, @handle; Video Name; Size; Direction (↓ Download blue / ↑ Upload purple); Progress bar + %; Status pill; ETA; Actions (round pause/play button + "…" menu with cancel, retry, open chat).

## Downloads (mockup)

- Title "Downloads", subtitle "Manage Telegram downloads from channels, groups, chats, and direct links in one workspace."
- Three columns: chat list (~180px), files panel (flex), right column.
- **Chats & Channels** panel: title + "+" button (open/join by link or @username). Search "Search chats or channels…". Chips: All (active), Channels, Groups, Folders (Folders shows Telegram chat folders as a sub-list). Rows: avatar, name bold, @username `muted`, time ago right, unread count badge (primary pill). Selected row: primary-tinted background.
- **Files panel**:
  - Header: segmented toggle "Chat View" | "Files View" (Files View active), and search "Search files in this channel…".
  - Filter row(s): Media Type, File Type, Duration, Size, Status, Sort By ("Date Added"), "Reset" (rotate icon).
  - Table: checkbox, #, Thumbnail, File Name, Type chip, Size, Duration. A selection bar appears when rows are checked: "N selected • Download selected • Download all matching".
  - Pagination at the bottom.
  - Chat View: message list with sender, time, caption text, media preview card with type, size, and a download button / progress state.
- **Right column**:
  - **Download Overview** (bar-chart icon): 2×2 tiles: Speed (lightning, cyan value "2.7 MB/s"), Active (green download-circle, "4"), Remaining (purple clock, pink value "2,782"), Total Files (doc icon, "2,813").
  - **Transfer Queue** (doc icon): cards with thumbnail 44px, file name, status pill right, progress bar + %, detail line: "1.0 GB / 1.4 GB • 2m 14s left", "414 MB / 862 MB • ETA 3m 12s", "358 MB / 358 MB • Finished 1m ago", "0 B / 2.1 GB • Waiting to start". Shows the active and next jobs; link to Queue.

## Queue (mockup)

- Title "Queue", subtitle "Manage your active and pending downloads and uploads".
- Tabs: Downloads (count badge), Uploads (count badge), Completed, Failed, each with an icon. Active tab = primary fill.
- Search "Search in queue…".
- Status chips: All 8 (active), Downloading 3 (green dot), Paused 1 (amber dot), Queued 4 (slate dot), Completed (ring), Failed (red dot).
- Table: checkbox, #, Name (thumbnail + file name), Size, Progress (bar + % + "1.0 GB / 1.4 GB" under it), ETA ("2m 14s", green "Completed", `muted` "Queued", amber "Paused" pill). Row hover reveals actions (pause/resume, move up/down, cancel, retry).
- Footer: "Showing 1–8 of 8 items" left, pagination right.
- Right column:
  - **Queue Overview**: 2×2 tiles: Total (blue doc), Downloading (green ↓ circle), Queued (purple clock), Paused (amber pause circle).
  - **Live Activity**: blue sparkline of total speed (last ~60 s), big cyan "2.7 MB/s", caption "Total Download Speed", legend with colored squares: "3 Downloading", "4 Queued", "1 Paused".
  - **Queue Actions**: 2×2 tinted buttons: Pause All (blue, pause icon), Resume All (green, play icon), Clear Completed (neutral, check-circle icon), Clear All (red, trash icon, confirm dialog).

## Settings (mockup)

- Title "Settings", subtitle "Customize your experience and manage application preferences".
- Three columns: category nav (~170px), section cards (flex, scrollable), right column (~290px).
- Category nav items (icon, title, subtitle; active = primary fill + glow). Clicking scrolls to the section; scrolling highlights the current one.

| Category | Subtitle | Settings (only real, honored settings) |
|----------|----------|------|
| General | Language, startup, updates | Language (English only for v1, select shown disabled or omitted), Start with system (toggle: Startup-folder shortcut) |
| Downloads | Default settings, storage, limits | Default download location (path + folder button opens a native folder dialog), Max concurrent downloads (stepper 1–5, default 2), Auto-resume failed downloads, Skip existing files, Prefix file names with date, Folder template |
| Uploads | Upload settings, quality, limits | Default upload destination (select a chat), Upload as album, Keep original file names, Max concurrent uploads |
| Telegram | Account, sessions, data | Account (name, phone, @username), API ID (hash masked), Log out |
| Channels | Default channel settings | Show archived chats, Hide chats without media (if cheap) |
| Queue | Queue behavior, concurrency | Retry attempts, Stall timeout, Clear completed after N days |
| Files & Folders | Storage, organization | Library root, Verify files on startup |
| Notifications | Alerts and updates | Desktop notifications on complete, on failure |
| Appearance | Theme, layout, language | Compact density (only if trivial); dark theme is the only theme |
| Privacy & Security | Data, security, cleanup | Clear thumbnail cache, Clear history |
| About | App info, version, licenses | Version, links, open-source licenses |

The mockup's "Check for updates" and "Auto minimize to tray" are not implementable in v1 (see PRODUCT.md > Out of scope) and are not shown. Any category left empty after this rule is removed from the nav.

- Section card: header with icon, title, subtitle; rows of label (bold) + description (`muted`) on the left, control on the right; rows divided by 1px lines. Changes save immediately with a small "Saved" toast.
- Right column:
  - **App Status** with "● All systems operational" (green; amber/red when degraded): Version, Last updated, Telegram connection ("● Connected"), Active downloads, Active uploads.
  - **Storage**: progress bar (indigo) with %, "156.4 GB of 500 GB used" (download drive), breakdown rows with colored squares: Videos (indigo), Documents (blue), Images (green), Archives (amber), sizes right.
  - **Danger Zone** (red trash icon, "These actions are permanent and cannot be undone."): red-tinted buttons "Clear All Data — Remove all downloads, settings and cache" and "Disconnect Telegram — Remove saved sessions and account data". Both confirm with a typed confirmation.

## Uploads (not in mockups)

Same three-column pattern as Downloads.
- Title "Uploads", subtitle "Send files to your channels, groups, and Saved Messages."
- Left **Destinations** panel: search, chips (All, Channels, Groups, Saved), rows of chats the user can post in.
- Center **New Upload** panel: dashed dropzone ("Drop files here or Browse", upload-cloud icon), selected files table (thumbnail via object URL, name, type chip, size, remove ×), caption textarea, toggles (Upload as album, Keep original file names), primary button "Upload N files to <chat>".
- Right column: **Upload Overview** tiles (Speed, Active, Remaining, Uploaded Today) and **Upload Queue** cards (same component as Transfer Queue, purple progress).

## Media Library (not in mockups)

- Title "Media Library", subtitle "Everything you have downloaded, in one place."
- Stats strip: Total Files, Total Size, Missing Files (with "Verify" button).
- Toolbar: search, type chips (All, Videos, Images, Documents, Audio, Archives), chat select, sort, grid/list toggle.
- Grid: cards with 16:9 thumbnail, file name, "size • chat • date", hover actions (Open, Show in folder, Delete). List: table like Files View.
- Multi-select with bulk delete; confirm dialog offers "Remove from library" or "Delete from disk".

## Analytics (not in mockups)

- Title "Analytics", subtitle "How your transfers are going." Range select top-right (Last 24 hours, 7 days, 30 days, All time).
- KPI cards: Files Downloaded, Files Uploaded, Data Transferred, Success Rate.
- Large Transfer Activity chart (same component as Overview).
- Two panels: Top Chats (bar rows) and File Types (stacked horizontal bar + legend with sizes).
- Recent Failures table: file, chat, reason, time, retry button.

## Login (not in mockups)

- Full-screen app background, centered 420px panel, logo on top.
- Step indicator: API Keys → Phone → Code → Password (password only when 2FA is on).
- API Keys step: API ID, API hash, helper link "Get them at my.telegram.org".
- Each step: labelled input, primary button, inline error (`role="alert"`), back link.
- When TDLib reports the session as ready, go straight to Overview.

## Accessibility

- Real `<button>`, `<a>`, `<input>`, `<label>`, `<table>` elements; icon-only buttons get `aria-label`.
- Visible focus ring: 2px `primary` outline with offset.
- Text contrast at least 4.5:1 against its background (verify `muted` on `panel`).
- Everything reachable by keyboard, including table checkboxes and dialogs.
- Respect `prefers-reduced-motion` for shimmer and transitions.
- Status is never conveyed by color alone: pills carry text.
