# TeleFlow: Architecture

Status: final design for v1 (2026-10-01, revised after design reviews 1 to 4; responses at the end). Keep this file in sync with the code; if they disagree, fix whichever is wrong in the same change.

The IPC methods below are the app's API (the "routes"), and the IPC events are its push channel. There is no REST server and no WebSocket (user scope change, see PROGRESS decision log).

## Overview

TeleFlow is one Electron app. The main process owns everything stateful: the TDLib client, the transfer engine, SQLite, the disk, and the native integrations (tray, login item, dialogs, notifications). The renderer is a React UI that talks to the main process through one typed preload bridge, `window.teleflow`, and loads images through a custom `teleflow://` protocol. There is no HTTP server, no WebSocket, and no open port. Engine logic lives in `core/`, which never imports `electron`, so it runs under plain Node in `node:test`.

## Tech stack

All versions are pinned exactly in `package.json` (no `^` or `~`).

| Layer | Choice (version) | Why |
|-------|------------------|-----|
| Desktop shell | Electron 44.5.1 (Node 24.21.0, Chromium 152) | Real installable app with tray, login item, native dialogs, notifications |
| Installer | electron-builder 26.15.3, NSIS target | Per-user `TeleFlow-Setup-<version>.exe`, shortcuts, uninstaller in "Installed apps" |
| Build | electron-vite 5.0.0 + Vite 7.3.6 | One config builds main, preload, and renderer; dev server with HMR and main-process restart. electron-vite 5 supports Vite ≤ 7, so Vite 8 is not used |
| Language | TypeScript 7.0.2, erasable syntax only, `tsc --noEmit` | Type checks only; Vite strips types for the app, Node 24 strips them for tests |
| Telegram | `tdl` 8.1.0 + `prebuilt-tdlib` 0.1008066.0 (TDLib 1.8.66) | Kept: resumable chunked downloads, and the existing FileGram session database is compatible |
| Storage | `node:sqlite` (built into Electron's Node) | Jobs, history, settings, media index in one file; no native rebuild |
| UI | React 19.3.0, `react-dom` 19.3.0, Tailwind CSS 4.3.3 (`@tailwindcss/vite` 4.3.3), `lucide-react` 1.49.0, `@vitejs/plugin-react` 5.2.0 | Component model for a dense dashboard; Tailwind maps to the UI.md tokens |
| Charts | Hand-written SVG (area chart, sparkline) | Two small charts do not justify a chart library |
| Routing / state | Hash routing in `App.tsx`; one event-fed store via `useSyncExternalStore` | No router or state library |
| Tests | `node:test` (Node 24) for core logic; `@playwright/test` 1.63.0 for the renderer (stubbed bridge) and an `_electron` smoke of the packaged exe | Built-in runner; Playwright already in use |
| Types | `@types/node` 24.19.0, `@types/react` 19.3.0, `@types/react-dom` 19.3.0 | Match Electron's Node 24 |

`dependencies` = `tdl` and `prebuilt-tdlib` only (externalized by electron-vite, shipped by electron-builder). Everything else is a devDependency, since Vite bundles the renderer and main.

TypeScript conventions: ESM everywhere; every relative import has an explicit `.ts`/`.tsx` extension (Node 24 type stripping requires it). One `tsconfig.json`: `strict`, `noEmit`, `allowImportingTsExtensions`, `erasableSyntaxOnly`, `verbatimModuleSyntax`, `module: preserve`, `moduleResolution: bundler`, `jsx: react-jsx`, `lib: [ES2024, DOM, DOM.Iterable]`, `types: [node]`.

Removed: Express, `ws`, `dotenv`, `archiver`, every `.cmd`/`.vbs`/`.ps1` launcher, the Edge `--app` shell.

Not chosen:
- Edge `--app` + local server (previous draft): not a real installable app, needed Host/Origin guards for an open port, and could not do tray or native dialogs.
- Tauri: a Rust toolchain plus a Node sidecar for TDLib; two runtimes for no gain.
- `better-sqlite3`: unnecessary because `node:sqlite` works in Electron 44 (verified), and a native module would need an Electron-ABI rebuild that breaks plain-Node tests.
- Running the engine in a `utilityProcess`: two IPC hops for no measured need. TDLib does its network I/O on its own thread, SQLite calls are sub-millisecond, and disk scans are async. Revisit if the window ever stutters during big queues.

### Early-risk findings (verified 2026-10-01)

Spike: `electron@44.5.1` installed in `%TEMP%\teleflow-spike`, a `main.js` run by `electron.exe`:

| Risk | Result |
|------|--------|
| `node:sqlite` in Electron main | Works. `process.versions.node` = 24.21.0, `sqlite_version()` = 3.53.4, `STRICT` tables OK |
| `tdl` N-API addon + `prebuilt-tdlib` `tdjson.dll` in Electron main | Works unpacked. `tdl.execute({ _: 'getOption', name: 'version' })` → `1.8.66` |
| npm 12 install scripts | npm 12.0.2 blocks dependency install scripts unless allowed: Electron's binary download did not run until `node node_modules/electron/install.js`. Phase 1 adds an `allowScripts` entry for `electron@44.5.1` via `npm approve-scripts electron`. `tdl`'s `node-gyp-build` install step is not needed (its prebuilt addon loads), so it stays unapproved |
| Packaged app (asar) | Not verified yet: Phase 1 packaging spike. Plan: `asarUnpack` `node_modules/tdl/**`, `node_modules/prebuilt-tdlib/**`, `node_modules/@prebuilt-tdlib/**`, and pass `getTdjson().replace('app.asar', 'app.asar.unpacked')` to `tdl.configure`, because `tdjson.dll` is loaded by the OS loader, which cannot read inside an asar |
| TDLib 1.8.66 upload shape | `inputMessagePhoto/Video/Audio/Document` take nested `inputPhoto/inputVideo/inputAudio/inputDocument` objects (checked in `@prebuilt-tdlib/types`). TeleFlow builds that shape directly; FileGram's `tdl-upload-compat` shim is not ported |
| Sandboxed preload format | Not verified yet: Phase 1. Sandboxed preloads must be CommonJS; electron-vite is configured to emit `out/preload/preload.cjs` |
| Icon | Not verified yet: Phase 1. electron-builder gets `assets/icon.ico` (generated, see Build) |

## Layout

```
electron/
  main.ts        app lifecycle: paths, single-instance lock, window + state, tray, login item,
                 teleflow:// protocol, IPC bridge (sender check, error envelope), notifications, quit
  ipc.ts         the method table: name -> (args) => result, with argument validation
  preload.ts     contextBridge: window.teleflow = { call, on, pathOf }
core/
  db.ts          SQLite schema, queries, settings defaults and validation
  telegram.ts    TDLib client lifecycle, auth, chat cache, messages, media extraction,
                 media index scan, thumbnails, link resolution
  transfers.ts   download/upload queue engine, naming, gates, stats
  storage.ts     paths (incl. the IPC pageKey), logger, library scan, storage report, clearing, FileGram import, fs helpers
web/
  index.html
  src/main.tsx
  src/App.tsx      shell: sidebar, top bar (global search, user menu), auth gate, page switch
  src/api.ts       typed call(), on(), useCall(), useLive() store, useRoute(), navigate()
  src/ui.tsx       shared primitives and formatters (inventory in UI.md)
  src/pages/       Overview, Downloads, Uploads, Queue, Library, Settings, Login (.tsx);
                   Settings.tsx also exports FileGramImportDialog, which Login.tsx imports
  src/styles.css   Tailwind import, theme tokens, table and focus classes
assets/
  icon.svg         logo mark source
  icon.png         256 px render (window, tray, notifications)
  icon.ico         Windows icon (installer, exe, shortcuts)
  installer.nsh    NSIS uninstall hook: removes the Start with Windows entry (Build)
scripts/
  icon.ts          renders icon.svg to icon.png/icon.ico with Playwright (run manually)
tests/
  engine.test.ts   node:test: naming, folder template, paths, dedupe, scheduling, gates, retry, albums, media filters
  ui.spec.ts       Playwright: renderer with window.teleflow stubbed (fixtures live here)
  app.spec.ts      Playwright _electron: packaged exe boots, loads TDLib, shows Login
electron.vite.config.ts
playwright.config.ts  launchOptions.args ['--allow-file-access-from-files'] so out/renderer loads over file://
tsconfig.json
package.json      scripts, pinned deps, allowScripts, electron-builder "build" config
docs/
```

Split a file only when it passes roughly 400 lines or mixes unrelated concerns. Renderer types for IPC are inferred from `electron/ipc.ts` with a type-only import (`typeof import('../../electron/ipc.ts').methods`), so there is no hand-written contract file to drift.

Removed in the rewrite: `server.js`, `server/`, `public/`, `scripts/*.test.cjs`, `scripts/*.ps1`, old `tests/`, `BULK_UPLOAD_TESTING.md`, `Clean Repo After Release.cmd`, `FileGram.vbs`, `Install FileGram.cmd`, `Uninstall FileGram.cmd`, `playwright.config.js`.

`.gitignore` gains `out/` (electron-vite output) and drops the stale `.teleflow/` entry; `.kiro/` becomes `.kiro/*` + `!.kiro/steering/` so `.kiro/steering/ponytail.md` is on the branch. `release/` (installer output) and `test-results/` are already ignored. `build/` stays ignored, which is why icons live in `assets/`.

## Runtime data

`home` = `TELEFLOW_HOME` if set, else `%LOCALAPPDATA%\TeleFlow`; an unpackaged dev run without `TELEFLOW_HOME` uses `%LOCALAPPDATA%\TeleFlow-dev` so development never touches the installed app's session. `appDir` = `app.isPackaged ? path.dirname(app.getPath('exe')) : app.getAppPath()` (the install folder when packaged, the repo in dev; `app.getAppPath()` alone would be `resources\app.asar`). Startup fails with a clear error if `home` resolves inside `appDir`.

| Path | Owner | Notes |
|------|-------|-------|
| `home\tdlib\db\` | TDLib | Session (`database_directory`). Deleted only by logout, Disconnect, Clear All Data |
| `home\tdlib\files\` | TDLib | File cache (`files_directory`): partial downloads, thumbnails, avatars |
| `home\teleflow.db` (+ `-wal`, `-shm`) | App | Jobs, history, settings, media index |
| `home\thumbs\<historyId>.jpg` | App | Thumbnail saved when a download completes (Library, Recent Activity) |
| `home\tmp\<jobId>\` | App | Renamed hard links/copies for uploads with "Keep original file names" off; deleted after send or cancel |
| `home\logs\main.log`, `main.old.log` | App | App log; rotated at 5 MB on startup |
| `home\logs\tdlib.log` | TDLib | TDLib log stream, verbosity 1, max 10 MB |
| `home\chromium\` | Electron | `sessionData` (Chromium cache, localStorage) |
| Download root | User | Default `app.getPath('downloads')\TeleFlow`; configurable |

Main sets `app.setPath('userData', home)` and `app.setPath('sessionData', home\chromium)` before `ready`, so Chromium's own files also land under `home`. The NSIS uninstaller keeps `home` (`deleteAppDataOnUninstall: false`), so a reinstall keeps the login.

Download root rules (`checkDownloadRoot(path, { sealed, guarded })`, pure, owned by `core/storage.ts`, called by `settings.set` and FileGram import). Clear All Data can delete every file under the root, and the Library lists every file under it, so the root must never hold or contain anything but the user's media. Paths are resolved and compared case-insensitively:
- Absolute; no `<>:"|?*` or control characters (the drive colon excepted); not a drive root.
- `sealed`: may not equal, sit inside, or contain any of `home`, `appDir`, the `AppData` folder (`path.dirname(app.getPath('appData'))`), `%SystemRoot%`, `%ProgramFiles%`, `%ProgramFiles(x86)%`, `%ProgramData%` (unset variables are skipped). Reason: "TeleFlow can't use a system or app data folder. Pick a folder for your media, for example Downloads\TeleFlow".
- `guarded`: may not equal or contain `os.homedir()` or `app.getPath` for `desktop`, `documents`, `downloads`, `pictures`, `videos`, `music`; subfolders are fine, so the default passes. Reason: "Pick or create a subfolder, for example Downloads\TeleFlow".

Main builds both lists once at startup. `checkDownloadRoot` only validates; `settings.set` creates the folder (`fs.mkdir(path, { recursive: true })`) after it passes. Violations return a 400 with the reason.

TDLib locks its database, so only one process may use `tdlib\db`; the single-instance lock enforces this.

## IPC contract

### Bridge

`electron/preload.ts` exposes exactly:

```ts
window.teleflow = {
  call(method: string, args?: unknown): Promise<unknown>  // ipcRenderer.invoke('call', { method, args })
  on(cb: (event: AppEvent) => void): () => void           // ipcRenderer.on('event'); returns unsubscribe
  pathOf(file: File): string                              // webUtils.getPathForFile, for uploads
}
```

Main registers one handler, `ipcMain.handle('call', ...)`:
1. Rejects the call with `{ ok: false, status: 403, error: 'Not allowed' }` unless `event.senderFrame` is non-null and shows the renderer page. Both sides go through one pure `pageKey()` that drops the hash and query (routing uses the hash) and compares whole pages, never origins: every `file:` URL has the opaque origin `"null"`, so an origin check would accept any local page. The two strings come from different canonicalizers: `rendererUrl` from Node's WHATWG serializer (`pathToFileURL` keeps the drive-letter case the exe was launched with, for example a lowercase install folder typed in the installer), `senderFrame.url` from Chromium's, which uppercases the drive letter and may percent-encode other characters differently. So `file:` pages compare as decoded, lowercased Windows paths (`fileURLToPath`; NTFS is case-insensitive), and other URLs (the dev server) as lowercased `href`s, which also normalizes the trailing slash. Any parse error (`new URL` throws, `fileURLToPath` rejects an encoded `/` or `\`, or the frame is already disposed) rejects:
   ```ts
   // core/storage.ts, next to resolvePaths; pure (tests run on Windows, the only target, so fileURLToPath uses Windows rules)
   export const pageKey = (s: string) => {
     const u = new URL(s); u.hash = ''; u.search = ''
     return (u.protocol === 'file:' ? fileURLToPath(u) : u.href).toLowerCase()
   }
   // electron/main.ts; the env URL is honored only unpackaged, so a packaged app never loads a page named by the environment
   const rendererUrl = (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) || pathToFileURL(indexHtml).href // win.loadURL(rendererUrl)
   const rendererKey = pageKey(rendererUrl)
   // in ipcMain.handle('call', (e, req) => …)
   let key: string | null = null
   try { key = e.senderFrame ? pageKey(e.senderFrame.url) : null } catch {}   // bad URL, encoded slash, disposed frame → reject
   if (key !== rendererKey) return { ok: false, status: 403, error: 'Not allowed' }
   ```
   `indexHtml` = `out/renderer/index.html`, resolved from the main bundle's folder. Rejections are logged at warn with the sender URL when it is readable (the one logged 4xx). `pageKey` is unit tested (Testability), and the packaged smoke test (`test:app`) launches the exe through its lowercased path, so a Login screen there proves the check passes for the real page when the drive-letter case differs.
2. Looks up `method` as an own property of `methods` (unknown → 404).
3. Runs the method's validator on `args`, then the handler.
4. Returns `{ ok: true, data }` or `{ ok: false, status, error, retryAfter? }`. `web/src/api.ts` unwraps and throws an `Error` with `status` on failure, so pages show the message as is.

Errors are created with `fail(status, message)` (one helper in `core/db.ts`, used everywhere): 400 invalid input, 403 not allowed (cannot post, Telegram permission), 404 not found, 409 conflict (busy, locked, wrong state), 413 too large, 429 Telegram flood wait (`retryAfter` seconds), 503 Telegram not ready, 500 unexpected. Messages are user-facing sentences. 500s are logged with the stack; 4xx are not logged, except the sender-check 403 (step 1).

### Shared shapes

```ts
type Kind = 'download' | 'upload'
type Status = 'queued' | 'active' | 'paused' | 'completed' | 'failed'
type MediaType = 'video' | 'photo' | 'document' | 'audio' | 'animation' | 'voice' | 'video_note'
type KindCount = { download: number, upload: number }

type Me = { id: number, name: string, firstName: string, username: string | null,
            phone: string /* masked: +•• ••• ••45 67 */, photo: string | null /* remote file id */,
            premium: boolean,
            captionMax: number /* option message_caption_length_max, refreshed on updateOption */,
            uploadMax: number /* bytes: premium ? 4_194_304_000 : 2_097_152_000, recomputed on updateUser */ }
type AuthState = { connection: 'ready' | 'connecting' | 'updating' | 'offline' } & (
  | { step: 'starting' }
  | { step: 'credentials', error?: string }
  | { step: 'phone', error?: string /* set for TDLib auth states TeleFlow cannot complete */ }
  | { step: 'code', phone: string, via: 'telegram' | 'sms' | 'call' | 'other' }
  | { step: 'password', hint: string }
  | { step: 'ready', me: Me }
  | { step: 'logging-out' })

type Chat = { id: number, title: string, kind: 'private' | 'saved' | 'group' | 'channel',
              username: string | null, photo: string | null, unread: number,
              lastDate: number /* unix s, 0 if none */, canPost: boolean, folders: number[] }
type Folder = { id: number, name: string }
type MediaItem = { chatId: number, messageId: number, date: number, type: MediaType, name: string, ext: string,
                   size: number, duration: number, caption: string, thumb: string | null,
                   status: 'none' | 'queued' | 'active' | 'paused' | 'failed' | 'downloaded',
                   jobId: number | null, path: string | null }
type Message = { id: number, date: number, sender: string, text: string, media: MediaItem | null }
type Job = { id: number, kind: Kind, status: Status, chatId: number, chatTitle: string,
             chatUsername: string | null, chatPhoto: string | null, messageId: number | null,
             name: string, type: MediaType | 'album', size: number, done: number,
             thumb: string | null, path: string | null, error: string | null, retryAt: number | null,
             finishedAt: number | null }
// Job.chatUsername / chatPhoto come from the chat cache at read time (null when the chat is unknown).
type JobLive = { id: number, kind: Kind, done: number, size: number, speed: number, eta: number | null, finalizing: boolean }
type LiveStats = { speed: KindCount /* bytes/s */,
                   history: number[] /* last 60 total-speed samples, 1/s; zeros keep being sampled until 60 in a row, so an idle chart is flat */,
                   counts: Record<Kind, Record<Status, number>>, active: JobLive[],
                   waitUntil: { download: number | null, upload: number | null } /* flood wait end, ms */ }
type HistoryItem = { id: number, kind: Kind, status: 'completed' | 'failed', chatId: number, chatTitle: string,
                     messageId: number | null, name: string, type: string, size: number, path: string | null,
                     error: string | null, finishedAt: number, preview: string | null /* teleflow:// url */ }
type LibType = 'video' | 'image' | 'audio' | 'document' | 'archive'
type LibraryItem = { path: string /* relative to root */, name: string, type: LibType, size: number, mtime: number,
                     chat: string | null, chatId: number | null, messageId: number | null,
                     historyId: number | null, preview: string | null }
type MediaFilters = { type?: 'video' | 'photo' | 'document' | 'audio' | 'animation', ext?: string,
                      duration?: 'short' | 'medium' | 'long' | 'xlong', size?: 'small' | 'medium' | 'large' | 'xlarge',
                      status?: MediaItem['status'], q?: string,
                      sort?: 'newest' | 'oldest' | 'largest' | 'smallest' | 'name' | 'longest' }
```

TDLib-to-shape mappings (TDLib 1.8.66):
- `Folder.name` = `chatFolderInfo.name.text.text` (`name` is a `chatFolderName` object, not a string).
- `Chat.photo` = `chat.photo.small.remote.id`; `Me.photo` = `user.profile_photo.small.remote.id`; `null` when absent.
- `AuthState.connection` from `updateConnectionState`: `connectionStateReady` → `ready`, `connectionStateUpdating` → `updating`, `connectionStateConnecting` and `connectionStateConnectingToProxy` → `connecting`, `connectionStateWaitingForNetwork` → `offline`. `offline` also while no client exists.

Filter buckets: duration short < 1 min, medium 1–10 min, long 10–30 min, xlong > 30 min; any `duration` filter also requires `duration > 0`, so photos and documents never match. Size small < 10 MB, medium 10–100 MB, large 100 MB–1 GB, xlarge > 1 GB. Media type `video` covers `video` + `video_note`; `audio` covers `audio` + `voice`. Library types by extension: video (mp4 mkv mov avi webm m4v wmv flv ts 3gp), image (jpg jpeg png gif webp bmp heic tiff), audio (mp3 m4a aac ogg oga opus flac wav wma), archive (zip rar 7z tar gz bz2 xz), everything else document.

### Methods

Common validators (in `ipc.ts`): `id` = safe integer ≠ 0; `page` = integer 1–100000 (default 1); `pageSize` = integer 1–100 (default 25); `q` = string, trimmed, ≤ 200 chars; enums checked against their lists; unknown keys rejected. Every failure is a 400 naming the field. A length limit in the table below (for example `search.global.q`, `chats.open.link`) replaces the common rule for that field.

| Method | Args | Returns | Errors |
|--------|------|---------|--------|
| `app.info` | – | `{ version: string, tdlib: string, installedAt: number \| null, home: string, repository: string \| null, licenses: { name, version, license }[] }` (sources below) | – |
| `app.storage` | – | `StorageReport` (below) | – |
| `app.pickFolder` | `{ title?: string ≤ 80 }` | `{ path: string \| null }` | – |
| `app.openPath` | `{ target: 'downloads' \| 'appData' \| 'logs' }` | `void` | 404 folder missing |
| `app.clearCache` | – | `{ freed }` | 409 transfers active |
| `app.clearData` | – | `{ freed }` | 409 transfers active |
| `app.clearAll` | `{ deleteDownloads: boolean }` | `{ freed }` | – |
| `fileGram.inspect` | `{ dir: absolute path ≤ 260 }` | `FileGramReport` | 400 not a FileGram folder |
| `fileGram.import` | `{ dir }` | `{ session: boolean /* session moved */, credentials: boolean, downloadRoot: string, movedFiles: number, warning: string \| null, leftovers: Leftovers }` | 400, 409 "Close FileGram first", 409 transfers active |
| `fileGram.leftovers` | – | `Leftovers` | – |
| `fileGram.removeLeftovers` | – | `{ freed }` | 404 nothing to remove |
| `auth.get` | – | `AuthState` | – |
| `auth.credentials` | `{ apiId: integer 1–2147483647, apiHash: /^[0-9a-f]{32}$/i }` | `AuthState` | 400 |
| `auth.phone` | `{ phone: /^\+?[\d\s().-]{5,24}$/ }` (digits kept) | `void` | 400 `PHONE_NUMBER_INVALID`, 429 |
| `auth.code` | `{ code: /^\d{4,8}$/ }` | `void` | 400 `PHONE_CODE_INVALID`/`EXPIRED`, 429 |
| `auth.password` | `{ password: string 1–256 }` | `void` | 400 `PASSWORD_HASH_INVALID`, 429 |
| `auth.logout` | – | `{ freed, local: boolean }` | – |
| `chats.list` | – | `{ chats: Chat[], folders: Folder[] }` | 503 |
| `chats.open` | `{ link: string 2–300, join?: boolean }` | `{ chat: Chat } \| { invite: { title, members, photo } }` | 400 unsupported link, 404, 429, 503 |
| `chats.messages` | `{ chatId, limit?: 1–1000 (30) }` | `{ messages: Message[] /* newest first */, more: boolean }` | 404, 503 |
| `chats.media` | `{ chatId, ...MediaFilters, page?, pageSize? }` | `{ items: MediaItem[], total, exts: string[] /* distinct ext of the whole chat index, ignoring filters */, scan: { state: 'idle' \| 'scanning' \| 'done', indexed: number, total: number \| null } }` | 404 |
| `search.global` | `{ q: 1–300 chars }` | `{ chats: Chat[] (≤ 5), files: LibraryItem[] (≤ 5, from the cached Library scan, which startup fills in the background; never waits for or triggers a rebuild), link: { kind: 'message' \| 'chat' \| 'invite' } \| null /* null when not a link or TDLib rejects it */ }` | – |
| `downloads.add` | `{ items: { chatId, messageId }[] (1–10000), force?: boolean }` or `{ chatId, filters: MediaFilters }` or `{ link }` | `{ added, skipped }` | 400 no media (`{ link }` only), 404 unknown chat, 503 |
| `uploads.add` | `{ chatId, paths: string[] (1–500), caption: string ≤ me.captionMax, album: boolean, keepNames: boolean }` | `{ added /* files, not jobs */ }` | 400 missing file, 403 cannot post, 413 over `me.uploadMax` |
| `jobs.list` | `{ kind?: Kind, status?: 'open' \| Status, q?, page?, pageSize? }` | `{ items: Job[], total }` | – |
| `jobs.action` | `{ action: 'pause' \| 'resume' \| 'retry' \| 'cancel' \| 'up' \| 'down' \| 'clear-completed', ids?: id[] (1–1000) }` | `{ changed }` | 400 (`up`/`down` need exactly one id) |
| `stats.live` | – | `LiveStats` | – |
| `stats.overview` | – | `{ completedToday: KindCount, totalFiles: KindCount, recent: HistoryItem[] (6) }` (active and failed counts come from `LiveStats.counts`) | – |
| `stats.activity` | `{ range: '24h' \| '7d' \| '30d' }` | `{ buckets: number[] /* bucket start, ms */, download: number[], upload: number[] }` | – |
| `stats.chats` | `{ range }` | `{ items: { chatId, title, photo, count }[] (≤ 5) }` | – |
| `library.list` | `{ q?, type?: LibType, chat?: string ≤ 200, sort?: 'newest' \| 'oldest' \| 'largest' \| 'smallest' \| 'name', page?, pageSize? }` | `{ items: LibraryItem[], total, chats: string[], stats: { files, size, missing } }` | – |
| `library.missing` | – | `{ items: HistoryItem[] }` | – |
| `library.open` | `{ path }` | `void` | 404 |
| `library.reveal` | `{ path }` | `void` | 404 |
| `library.trash` | `{ paths: string[] (1–1000) }` | `{ trashed, freed }` | 404 |
| `settings.get` | – | `Settings` | – |
| `settings.set` | partial `Settings` (editable keys only) | `Settings` | 400 per key |

Notes:
- `library.*` paths are relative to the download root or absolute, and must be existing files. A path is accepted when it is inside the root after `realpath`, or when it equals (case-insensitively, through the `lower(path)` indexes) the `path` of a completed download job or a download history row. The second rule keeps "Show in folder" and "Open" working for downloads made before a download root change (the files are not moved), while still confining these calls to files TeleFlow wrote. Queue and Chat View reuse `library.reveal` with a job's or media item's `path`.
- `library.trash`: after `trashItem` succeeds for a file, one transaction runs `UPDATE history SET path = NULL WHERE kind = 'download' AND lower(path) = lower(?)` and deletes completed download jobs with that path (both use the `lower(path)` indexes). The message then shows as not downloaded, is not "missing", and can be downloaded again.
- `downloads.add` with `items` reads display data from the media index when present and calls `getMessages` (100 ids per call) otherwise. With `{ chatId, filters }` it selects from the media index with the same query as `chats.media`. Without `force`, items whose `MediaItem.status` is `downloaded` (same SQL predicate) are counted in `skipped` and not enqueued, so dedupe holds after Clear Completed. Unresolvable items (message deleted, no media, `null` from `getMessages`) also count as `skipped`; 404 only for an unknown chat; 400 "no media" only for `{ link }`. Inserts are batched 500 per transaction.
- Id lists (`jobs.action` ids, `downloads.add` dedupe lookups) are bound as one JSON parameter, `WHERE id IN (SELECT value FROM json_each(?))`, so no statement grows with the list (SQLite caps bound parameters at 32 766).
- `jobs.list`: `status: 'open'` = `queued`, `active`, `paused`. Order: open → `ORDER BY position`; `completed` or `failed` → `ORDER BY finished_at DESC, id DESC`; no status → open rows first by `position`, then the rest by `finished_at DESC`. `q` matches `name` with `LIKE` (escaped). The "#" column is `(page − 1) × pageSize + index + 1`.
- `jobs.action` without `ids`: `pause` = all queued and active jobs; `resume` = all paused; `retry` = all failed; `cancel` = every job row; `clear-completed` = all completed (ignores `ids`). `up`/`down` need exactly one id of an open job and swap `position` with the neighbor of the same kind among open jobs. `retry` sets `status = 'queued', attempts = 0, error = NULL, retry_at = NULL`. `pause` and `cancel` on a job with no live engine state (queued, paused, failed, requeued after a crash, or an upload left `active` after logout) skip the live TDLib calls and only update or delete the row. `changed` = rows affected.
- `jobs.action cancel` still deletes the TDLib partial data of unfinished non-live downloads that ever transferred (`kind = 'download' AND status <> 'completed' AND (attempts > 0 OR done > 0)`; `retry` resets `attempts` but not `done`), so Clear All's "Partial downloads are deleted" holds. Completed rows are left out: their TDLib copy was removed at finalize (or never existed for skip-existing), so Remove on a completed row and Clear All over a long history make no TDLib calls for them. The transaction that deletes the rows returns their `chat_id`/`message_id`; then a background task (not awaited by the call) runs per chat in batches of 100 ids while auth is `ready`:
  ```ts
  const { messages } = await invoke({ _: 'getMessages', chat_id, message_ids })
  for (const m of messages) { const f = m && extractMedia(m)?.file; if (f && !inFlight.has(f.id)) await invoke({ _: 'deleteFile', file_id: f.id }).catch(() => {}) }
  ```
  `inFlight` (the engine's `Map<fileId, jobId>`) protects a same-file sibling that is downloading. A failed batch is ignored; whatever is left goes with the next Clear cache. When auth is not `ready` the task is skipped: `// ponytail: partial data stays until Clear cache; upgrade: retry on next ready`.
- `chats.messages` pages `getChatHistory` internally (100 per call, TDLib returns short first pages) until it has `limit` messages or reaches the start (`more = false`). Chat View's "Load older" raises `limit` to `Math.min(limit + 30, 1000)` and refetches, so a refetch after an invalidation always returns one contiguous list from the newest message (no cursor pages to drop or overlap). `ponytail:` capped at the newest 1000 messages; older media are reachable in Files View; upgrade: cursor paging with an `until` bound.
- `app.info` sources: `version` = `app.getVersion()`; `tdlib` = `tdl.execute({ _: 'getOption', name: 'version' })`; `installedAt` = `birthtimeMs` of `path.dirname(app.getPath('exe'))` when packaged (the folder survives NSIS updates), `null` in dev; `repository` = `package.json` `repository.url` with a leading `git+` and trailing `.git` removed, or `null` unless the result starts with `https://` (the window-open handler only opens `https:`); `licenses` = `__LICENSES__`, built in `electron.vite.config.ts` from `node_modules/<name>/package.json` for every `dependencies` entry plus `electron`, `react`, `react-dom`, `lucide-react`, injected into main with `define`.
- `uploads.add` paths come from `window.teleflow.pathOf(file)`; main checks each is absolute, exists, is a regular file, and is 1 byte to `me.uploadMax`.
- `chats.open` returns `{ invite }` for an invite link the user has not joined; the renderer asks "Join <title>?" and calls again with `join: true`. A returned chat is added to the session's opened set, so `chats.list` includes it (see Chat cache).
- `auth.logout` with Telegram unreachable for 15 s still deletes the local session and returns `local: true`; the UI then says the session may still be listed under Telegram > Settings > Devices.
- Stats are counted on `history` rows with `status = 'completed'` (one row per file), so they survive Clear Completed and reset only with Clear app data:
  - `completedToday[kind]` = rows with `finished_at` ≥ local midnight. Main emits `invalidate: ['history']` at local midnight so the KPI rolls over.
  - `totalFiles[kind]` = all rows. The Downloads "Total Files" tile uses `totalFiles.download`.
  - `stats.activity`: `24h` = 24 one-hour buckets ending with the current hour; `7d` / `30d` = 7 / 30 local-day buckets ending today. Each value = file count of that kind in the bucket; `buckets[i]` = bucket start (ms).
  - `stats.chats` = rows of both kinds grouped by `chat_id` within the range, top 5 by count, ties by latest `finished_at`. `title` and `photo` come from the chat cache, falling back to the latest `history.chat_title` (photo null).
  - `recent` = the newest 6 rows of either status.

```ts
type StorageReport = {
  drive: { root: string, total: number, free: number },               // fs.statfs on the download root
  library: Record<LibType, number> & { files: number, total: number }, // from the library scan
  cache: { tdlib: number, thumbs: number, tmp: number,
           chromium: number /* session.getCacheSize() */, total: number },
  appData: number }                                                    // teleflow.db + wal + shm
type FileGramReport = { dir: string, session: boolean /* .td_database present and TeleFlow not logged in */,
  credentials: boolean, downloadsDir: string | null, downloadsInside: boolean, downloadsSize: number,
  downloadsWarning: string | null /* checkDownloadRoot reason when an outside folder cannot become the root */,
  leftovers: Leftovers }
type Leftovers = { dir: string | null, items: { path: string /* absolute */, size: number }[], total: number }
type Settings = { downloadRoot: string, maxDownloads: number, skipExisting: boolean, datePrefix: boolean,
  folderTemplate: string, defaultUploadChat: number | null, uploadAlbum: boolean, keepNames: boolean,
  maxUploads: number, showArchived: boolean, autoRetry: boolean, retryAttempts: number, stallSeconds: number,
  clearCompletedDays: number, notifyComplete: boolean, notifyFailed: boolean, closeToTray: boolean,
  startWithSystem: boolean, apiId: number | null, fileGramDir: string | null }
```

### Events (main → renderer)

Sent with `webContents.send('event', e)`:

| Event | Payload | When |
|-------|---------|------|
| `auth` | `AuthState` | Any authorization or connection state change, `me` changes (`updateUser` for self) |
| `stats` | `LiveStats` | Every 500 ms while busy: any job is active, finalizing, or flood-waiting, or `history` still holds a non-zero sample (so the idle sparkline drains to flat over 60 s, then emits stop); 100 ms after any job status change |
| `invalidate` | `{ topics: string[] }` | Data changed; topics: `jobs`, `history`, `chats`, `library`, `settings`, `storage`, `media:<chatId>`, `messages:<chatId>`. Coalesced and flushed every 500 ms (`chats` every 2 s) |

Who emits which topic:

| Topic | Emitted on |
|-------|-----------|
| `jobs` | Any job insert, status change, reorder, delete |
| `history` | History insert or path change (finish, failure, trash), local midnight, Clear app data |
| `chats` | Chat cache updates, opened-set changes, `showArchived` change |
| `library` | Download finalize, trash, download root change, FileGram import |
| `settings` | `settings.set`, FileGram import, Clear app data. Not the `window` setting: main writes it on move/resize and emits nothing, so Settings does not refetch while the window is dragged |
| `storage` | Clears, leftover removal, FileGram import, download root change |
| `media:<chatId>`, `messages:<chatId>` | Any download job insert, status change, finalize, or delete in that chat (cancel, Remove, Clear All, Clear Completed, `clearCompletedDays`, clears), and any `history.path` change for that chat (trash). Bulk actions emit once per affected chat. Plus, `media:` only: index pages inserted (at most 1/s), scan state changes (start and finish, so the index bar hides), and live upkeep; `messages:` only: `updateNewMessage` / `updateDeleteMessages` in that chat |

The renderer gets its first snapshot with `auth.get` and `stats.live`, then follows events. `useCall(method, args, topics)` refetches when one of its topics is invalidated (renderer debounce 300 ms). `useCall` keeps the previous `data` during a refetch and never clears it on reload, so skeletons appear only on first load. Files View and Chat View subscribe only to their chat's topic; live progress on their rows comes from `live.active` by `jobId`.

### `teleflow://` protocol

Registered as privileged (`standard`, `secure`) before `ready`; handled with `protocol.handle`. Only `<img>` loads it. GET only; anything else 404.

| URL | Serves | Validation |
|-----|--------|------------|
| `teleflow://thumb/<remoteId>` | TDLib thumbnail or avatar: `getRemoteFile` → size check → `downloadFile` (priority 32, synchronous) → file | `remoteId` matches `/^[\w-]{10,200}$/` (check against real ids in Phase 2); `expected_size \|\| size` ≤ 2 MB, checked before `downloadFile`; `Cache-Control: private, max-age=86400` |
| `teleflow://saved/<historyId>` | `home\thumbs\<historyId>.jpg` (the bytes may be PNG, WebP, or GIF; Blink picks the image decoder from the bytes) | positive integer; file must exist |
| `teleflow://image/<encodeURIComponent(relPath)>` | An image file in the download root (Library previews for files without a saved thumbnail) | inside root after `realpath`; image extensions only |

Files are streamed with `net.fetch(pathToFileURL(path))`.

## SQLite schema

`core/db.ts` opens `home\teleflow.db` with `journal_mode = WAL`, `foreign_keys = ON`, and creates the schema when `PRAGMA user_version` is 0, then sets it to 1. Future schema changes add a numbered step; there is no migration framework. Tests open `:memory:`.

```sql
CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL                       -- JSON
) STRICT;

CREATE TABLE jobs (
  id          INTEGER PRIMARY KEY,
  kind        TEXT    NOT NULL CHECK (kind IN ('download', 'upload')),
  status      TEXT    NOT NULL CHECK (status IN ('queued', 'active', 'paused', 'completed', 'failed')),
  position    INTEGER NOT NULL,             -- queue order; new rows get MAX(position) + 1 (Invariants), swapped by up/down
  chat_id     INTEGER NOT NULL,
  chat_title  TEXT    NOT NULL,             -- snapshot at enqueue, for display when the chat is gone
  message_id  INTEGER,                      -- download: source message; upload: first sent message
  name        TEXT    NOT NULL,             -- display name ("IMG_1.jpg + 5 more" for albums)
  type        TEXT    NOT NULL,             -- MediaType or 'album'
  size        INTEGER NOT NULL DEFAULT 0,
  done        INTEGER NOT NULL DEFAULT 0,   -- bytes; live value is in memory, persisted on pause/finish/quit
  thumb       TEXT,                         -- download: thumbnail remote file id
  path        TEXT,                         -- download: final file path once completed
  files       TEXT,                         -- upload: JSON [{ path, name, size, type, pendingId?, messageId? }]: pendingId = temporary
                                            -- message id while sending, messageId once sent (Upload steps 3–6)
  caption     TEXT,                         -- upload
  attempts    INTEGER NOT NULL DEFAULT 0,
  error       TEXT,
  retry_at    INTEGER,                      -- ms; failed jobs with an automatic retry scheduled
  created_at  INTEGER NOT NULL,
  finished_at INTEGER
) STRICT;
CREATE UNIQUE INDEX jobs_download_msg ON jobs (chat_id, message_id) WHERE kind = 'download';
CREATE INDEX jobs_queue    ON jobs (kind, status, position);
CREATE INDEX jobs_finished ON jobs (status, finished_at);
CREATE INDEX jobs_path     ON jobs (lower(path));           -- trash and library.* path lookups

CREATE TABLE history (                      -- append-only record of finished transfers:
                                            -- completed = one row per file; failed = one row per job (name = job name)
  id          INTEGER PRIMARY KEY,
  kind        TEXT    NOT NULL CHECK (kind IN ('download', 'upload')),
  status      TEXT    NOT NULL CHECK (status IN ('completed', 'failed')),
  chat_id     INTEGER NOT NULL,
  chat_title  TEXT    NOT NULL,
  message_id  INTEGER,
  name        TEXT    NOT NULL,
  type        TEXT    NOT NULL,
  size        INTEGER NOT NULL,
  path        TEXT,                         -- download: absolute file path
  error       TEXT,
  finished_at INTEGER NOT NULL
) STRICT;
CREATE INDEX history_time ON history (finished_at);
CREATE INDEX history_msg  ON history (chat_id, message_id);
CREATE INDEX history_path ON history (lower(path));         -- trash and library.* path lookups

CREATE TABLE media (                        -- per-chat media index for Files View filters
  chat_id    INTEGER NOT NULL,
  message_id INTEGER NOT NULL,
  date       INTEGER NOT NULL,              -- unix s
  type       TEXT    NOT NULL,
  name       TEXT    NOT NULL,
  ext        TEXT    NOT NULL,              -- lowercase, no dot, '' if none
  size       INTEGER NOT NULL,
  duration   INTEGER NOT NULL DEFAULT 0,    -- s
  caption    TEXT    NOT NULL DEFAULT '',
  thumb      TEXT,                          -- thumbnail remote file id
  PRIMARY KEY (chat_id, message_id)
) STRICT, WITHOUT ROWID;
CREATE INDEX media_chat_date ON media (chat_id, date);

CREATE TABLE scans (                        -- media index progress per chat
  chat_id    INTEGER PRIMARY KEY,
  newest_id  INTEGER NOT NULL,              -- id of the newest message the walk has seen (any content, not only media)
  oldest_id  INTEGER NOT NULL,              -- id of the oldest message the walk has seen
  complete   INTEGER NOT NULL DEFAULT 0,    -- 1 once the walk reached the start of history
  total      INTEGER                        -- approx. media messages at scan start (see Media index scan); NULL if unknown
) STRICT;
```

Invariants and who owns them:
- One download job per message: the database (`jobs_download_msg`). Enqueue uses `INSERT ... ON CONFLICT (chat_id, message_id) WHERE kind = 'download' DO UPDATE SET status = 'queued', attempts = 0, error = NULL, retry_at = NULL, path = NULL, finished_at = NULL WHERE jobs.status = 'failed' OR (:force AND jobs.status = 'completed')`. Queued, active, and paused rows are never touched. `force` (Verify re-download) also requeues completed jobs. Without `force`, `downloads.add` first drops items whose status is `downloaded` (below). `skipped` = items dropped plus rows not inserted or updated.
- Queue order: `enqueue` (shared by `downloads.add` and `uploads.add`) reads `next = (SELECT IFNULL(MAX(position), 0) FROM jobs) + 1` once per transaction and gives each inserted row `next++`. One `INSERT` cannot read its own new id, and a `MAX` subquery per row would scan the table for each of up to 10 000 rows. The upsert's `DO UPDATE` leaves `position` alone, so a retried job (manual, automatic, re-added, or forced) keeps its place: the queue runs in first-enqueue order, the same rule interrupted downloads and stall requeues follow.
- No download row stays `active` without live engine state: the engine (`requeueActiveDownloads`, see Transfer engine).
- No upload row stays `active` past a `ready` without live state or a pending id: the engine (Upload step 6 settles the rest on `ready`).
- Valid kinds and statuses: the database (`CHECK`).
- Jobs and history stay separate: history survives Clear Completed and powers Overview, Library metadata, and "downloaded" status in Files View. Only Clear app data and Clear All Data delete history rows; `library.trash` only sets `history.path` to NULL.
- Canceling deletes the job row; there is no `canceled` status.
- No two finalizes write the same file name: the engine (`uniquePath` + the in-memory `reserved` set), because the check and the rename are not atomic.
- An upload file is posted at most once: the engine, by keeping each temporary id on its own file entry (`files[i].pendingId`, so routing survives a crash after part of a send succeeded), persisting `files[i].messageId` as each send succeeds, and sending only files without one.
- A file under its final download name is always complete: the engine (finalize copies across volumes to a dot-prefixed part file, then renames; Download step 6).
- The download root is never a system, app data, profile, or known folder or an ancestor of one: `checkDownloadRoot` in `core/storage.ts`, called by both writers (`settings.set`, FileGram import).

`MediaItem.status` is computed in SQL: the matching job's status if it is `queued`, `active`, `paused`, or `failed`; else `downloaded` when a completed download job with a path or a completed download history row with `path IS NOT NULL` exists for the message; else `none`. `MediaItem.path` = that job's or the latest such history row's path.

### Settings keys

Values are JSON in `settings`; a missing row means the default. `core/db.ts` owns defaults and validation; `settings.set` validates every key before writing any.

| Key | Default | Rule | Effect |
|-----|---------|------|--------|
| `downloadRoot` | `<Downloads>\TeleFlow` | `checkDownloadRoot` | Engine target root, Library root; invalidates `library`, `storage`. Existing downloads are not moved and stay reachable through `library.*` (Methods notes) |
| `maxDownloads` | 2 | integer 1–5 | Engine pump |
| `skipExisting` | true | boolean | Engine |
| `datePrefix` | false | boolean | Naming |
| `folderTemplate` | `{chat}` | ≤ 100 chars; only `{chat}`/`{chat_id}` placeholders; `\` or `/` separators; no `..`, drive letter, or leading separator; literal parts have no `<>:"\|?*` or control characters; may be empty (root). Placeholder values are sanitized like file names | Target folder |
| `defaultUploadChat` | null | null or id of a chat with `canPost` | Uploads preselect |
| `uploadAlbum` | true | boolean | Uploads default |
| `keepNames` | true | boolean | Uploads default |
| `maxUploads` | 1 | integer 1–3 | Engine pump |
| `showArchived` | false | boolean | Loads and lists `chatListArchive` |
| `autoRetry` | true | boolean | Engine |
| `retryAttempts` | 3 | integer 1–10 | Engine |
| `stallSeconds` | 10 | one of 5, 10, 30, 60 | Engine |
| `clearCompletedDays` | 0 | one of 0 (never), 1, 7, 30 | Engine tick deletes older completed jobs |
| `notifyComplete` | true | boolean | Notifications |
| `notifyFailed` | true | boolean | Notifications |
| `closeToTray` | false | boolean | Window close behavior |
| `startWithSystem` | – | boolean | Not stored: read as `app.getLoginItemSettings(loginItem).executableWillLaunchAtLogin`, written with `app.setLoginItemSettings({ ...loginItem, openAtLogin })` (`loginItem` in Desktop integration) |
| `apiId`, `apiHash` | – | set by `auth.credentials` / FileGram import only | `apiHash` is never returned or logged |
| `fileGramDir` | null | set by FileGram import | Leftover detection |
| `window` | – | `{ x, y, width, height, maximized }` | Written by main on move/resize (debounced 500 ms); emits no topic |

## Telegram (`core/telegram.ts`)

### Client lifecycle

- `tdl.configure({ tdjson, verbosityLevel: 1 })` once; TDLib logs go to `home\logs\tdlib.log` via `setLogStream` (`logStreamFile`, 10 MB).
- `start(creds)` creates a client with `databaseDirectory: home\tdlib\db`, `filesDirectory: home\tdlib\files`, `tdlibParameters: { use_message_database: true, use_secret_chats: false, system_language_code: 'en', device_model: 'TeleFlow', system_version: 'Windows', application_version: app version }`, and attaches one `update` listener that routes updates (below). `auth.credentials` closes any existing client first.
- A closed TDLib client cannot be reused (FileGram lesson). After `logOut` reaches `authorizationStateClosed`, the module drops the client, deletes `tdlib\db` and `tdlib\files`, and calls `start()` again with the same credentials, which yields the phone step. No stable-wrapper class.
- `API_ID_INVALID` / `API_ID_PUBLISHED_FLOOD` from client setup close the client, delete the stored credentials, and set `{ step: 'credentials', error }`.
- Auth state mapping: `WaitTdlibParameters` → `starting` (tdl answers it); `WaitPhoneNumber` → `phone`; `WaitCode` → `code` (`via` from `code_info.type`); `WaitPassword` → `password` (`hint`); `Ready` → `ready`; `LoggingOut`, `Closing`, `Closed` → `logging-out`. States TeleFlow cannot complete (`WaitEmailAddress`, `WaitEmailCode`, `WaitRegistration`, `WaitOtherDeviceConfirmation`, `WaitPremiumPurchase`) → `{ step: 'phone', error: 'Telegram needs <email setup | account registration | confirmation on another device | Telegram Premium> for this number, which TeleFlow does not support yet. Finish it in the official Telegram app, then try again.' }`; TDLib accepts `setAuthenticationPhoneNumber` from these states. `ponytail:` email login and sign-up are not supported; upgrade: `auth.email` / `auth.emailCode` → `setAuthenticationEmailAddress` / `checkAuthenticationEmailCode`.
- Leaving `ready` (any state above other than `ready`) calls `requeueActiveDownloads()`, drops in-memory upload state (rows stay `active`; the next `ready` rebuilds the routing map from `files[].pendingId` and runs the checks of Upload step 6, which also settle uploads with no pending id left), and stops the media scan.
- Logout keeps the queue: jobs are not tied to an account, so if another account signs in, its downloads fail as "This message no longer exists" and its uploads as "Interrupted". `// ponytail: jobs are not tied to an account; upgrade: store me.id on jobs and pause other accounts' jobs`.
- `invoke()` throws `fail(503, 'Telegram is not connected yet')` unless the state is `ready` (auth calls excepted). TDLib errors become `fail()` with a status from the code (400, 403, 404, 429 with `retryAfter` parsed from `FLOOD_WAIT_n` / `retry after n`) and a readable message.
- On quit: `client.close()` (awaited up to 5 s) so TDLib flushes its database.

### Chat cache

The module keeps `Map`s for chats, users, basic groups, and supergroups, filled from TDLib updates the standard way, so `chats.list` needs no TDLib calls. Positions come from `updateChatPosition`, `updateChatLastMessage.positions`, and `updateChatDraftMessage.positions` (only the positions of the draft update are used; drafts typed in another client reorder chats). After `ready` it calls `createPrivateChat(me.id)` (so Saved Messages exists even if never used), then `loadChats` (limit 100, until 404) for `chatListMain`, each folder in `updateChatFolders`, and `chatListArchive` when `showArchived` is on. Chat updates emit `invalidate: ['chats']`.

- Membership: `chats.list` returns chats with a position in `chatListMain` (plus `chatListArchive` when `showArchived` is on), Saved Messages, and chats returned by `chats.open` in this session (an in-memory `Set`). The cache also holds chats TDLib announced through forwards or search; those are not listed. `ponytail:` opened-not-joined chats are forgotten on restart; upgrade: persist their ids in settings.
- `kind`: `saved` = private chat with `me.id` (title shown as "Saved Messages"); `private` = other private chats; `channel` = supergroup with `is_channel`; `group` = basic group or non-channel supergroup. Secret chats are skipped.
- `username`: first of `usernames.active_usernames` from the user or supergroup.
- `canPost`: saved → true; private → false; channel → creator, or administrator with `rights.can_post_messages`; group → creator or administrator, or the member's effective permissions allow `can_send_documents` (member: `chat.permissions`, kept fresh by `updateChatPermissions`; restricted: `status.permissions`).
- Media permissions for uploads (not exposed to the renderer): admins, creators, channels, and Saved Messages allow everything; in groups `can_send_photos` / `can_send_videos` from the same effective permissions. `uploads.add` passes them to `groupUploads`, which sends photos/videos as documents where they are not allowed.
- `folders`: folder ids from `chat.positions` with `chatListFolder`; folder names from `updateChatFolders` (`Folder.name` mapping under Shared shapes). Order: main-list `order` descending, then chats that only have a `chatListArchive` position (when `showArchived` is on).

### Media extraction

One function maps a message to media (FileGram's `extractMedia`, minus stickers):

| Content | Type | File | Default name | Thumbnail |
|---------|------|------|--------------|-----------|
| `messageVideo` | video | `video.video` | `Video_<n>.mp4` | `video.thumbnail.file` |
| `messagePhoto` | photo | largest `photo.sizes[]` | `Photo_<n>.jpg` | size `m`, else smallest |
| `messageDocument` | document | `document.document` | `File_<n>` + extension from MIME when known | `document.thumbnail.file` |
| `messageAudio` | audio | `audio.audio` | `Audio_<n>.mp3` | `audio.album_cover_thumbnail.file` |
| `messageAnimation` | animation | `animation.animation` | `Animation_<n>.mp4` | `animation.thumbnail.file` |
| `messageVoiceNote` | voice | `voice_note.voice` | `Voice_<n>.ogg` | – |
| `messageVideoNote` | video_note | `video_note.video` | `VideoNote_<n>.mp4` | `video_note.thumbnail.file` |

`<n>` = server message id (`message_id / 2^20`), the number in `t.me` links. A file's own `file_name` wins when present. Duration comes from the content; caption from `caption.text`. A `thumbnail` is used only when its `format` is `thumbnailFormatJpeg`, `Png`, `Webp`, or `Gif` (`Mpeg4`, `Webm`, and `Tgs` cannot render in `<img>`); otherwise `thumb` is `null` and the UI shows the type icon. Photo sizes are always JPEG.

### Media index scan

- `scans.newest_id` / `oldest_id` count messages walked, not media indexed: they are the newest and oldest message ids the walk has seen, whatever the content. The row is created with the first page of the first walk, which starts at the newest message, so it counts as a finished top-up.
- `chats.media` starts a scan for the chat when it has no `scans` row, `complete = 0`, or `newest_id < chat.last_message.id` (chat cache; no last message → no top-up). In a chat whose last message is text, a finished top-up sets `newest_id` to that message's id, so the next call does not start another. One scan runs at a time; asking for another chat stops the current one after its page (progress is persisted, so it resumes later).
- Top-up: `getChatHistory` from the newest message down to `newest_id`. Only when the walk reaches the old `newest_id` is it set to the newest id seen (and the chat added to `current`, below), so a top-up interrupted by another chat restarts from the top next time instead of leaving a gap. Backfill: from `oldest_id` toward the start until an empty page sets `complete = 1`. Pages of 100, each inserted in one transaction (`INSERT OR REPLACE`, so pages that overlap live upkeep are harmless), `scans` updated, `invalidate: ['media:<chatId>']` at most once per second, and once more on each `scan.state` change (start, finish), so the index bar hides. With `newest_id` defined by messages walked, that invalidation cannot restart the scan.
- `scans.total` = sum of `getChatMessageCount({ chat_id, filter, return_local: false })` at scan start over `searchMessagesFilterPhoto`, `Video`, `Document`, `Audio`, `Animation`, `VoiceNote`, `VideoNote` (7 calls; TDLib rejects `searchMessagesFilterEmpty` here). Any failed call → `NULL`. The counts are approximate (TDLib says so) and include stickers sent as documents, so the bar says "about".
- `scan.indexed` = `SELECT COUNT(*) FROM media WHERE chat_id = ?`, clamped to `total`. `scan.state` = `scanning` while this chat's scan runs, `done` when `complete = 1` and the top-up is current, else `idle` (also for a chat in `failed`, below).
- Flood waits sleep and continue. A scan stops when the client leaves `ready`. A page that fails with any other error while the client is still `ready` ends the scan (logged at warn) and adds the chat to an in-memory `failed` set, cleared together with `current` (below). `chats.media` does not start a scan for a chat in `failed`, so a chat that keeps failing (for example a channel that became private while selected) is not rescanned on every refetch the finish invalidation causes; it gets one new try after the next reconnect or restart. `// ponytail: a failed scan shows as idle with no reason in the UI; upgrade: scan.state 'failed' with the error text`.
- Live upkeep: `updateNewMessage` in a chat that has a `scans` row inserts the media row (when the message has media) and, for any content, sets `newest_id = max(newest_id, message.id)`, but only for chats in the in-memory `current` set: chats whose top-up finished since the connection was last `ready`. `current` is cleared (together with `failed`) whenever `updateConnectionState` leaves `ready`, so after a restart or an outage (when TDLib may skip `updateNewMessage` for a gap) the next `chats.media` call runs one top-up over the gap instead of jumping past it. `updateDeleteMessages` with `is_permanent && !from_cache` deletes rows (TDLib cache evictions are ignored, a FileGram lesson). Edits are not tracked (`ponytail:` comment; upgrade path: handle `updateMessageContent`).

### Link resolution

TDLib parses links: `getInternalLinkType(link)` after normalizing bare `@name` or `name` to `https://t.me/name`.
- `internalLinkTypePublicChat` → `searchPublicChat`.
- `internalLinkTypeChatInvite` → `checkChatInviteLink`; already a member → that chat; else `{ invite }`, and with `join: true` → `joinChatByInviteLink`.
- `internalLinkTypeMessage` → `getMessageLinkInfo`; when `for_album`, siblings with the same `media_album_id` come from one `getChatHistory` page around the message.
- Any other link type, and the 404 TDLib returns for a non-internal link, → 400 "That link isn't a chat or message link" (`chats.open`, `downloads.add({ link })`).

`isTelegramLink(q)` (one regex in `core/telegram.ts`: `t.me`, `telegram.me`, `telegram.dog`, `tg://`) decides whether `search.global` asks TDLib; any `getInternalLinkType` error there yields `link: null`. The renderer only reads `link`.

### TDLib call map

| Method / trigger | TDLib calls |
|------------------|-------------|
| `auth.credentials` | `tdl.createClient` (tdl sends `setTdlibParameters`) |
| `auth.phone` | `setAuthenticationPhoneNumber` (also valid from the code and password steps for "use a different number") |
| `auth.code` | `checkAuthenticationCode` |
| `auth.password` | `checkAuthenticationPassword` |
| `auth.logout`, Disconnect | `logOut`, wait `authorizationStateClosed`, `client.close` |
| Ready | `getMe`, `getOption('message_caption_length_max')`, `createPrivateChat(me.id)`, `loadChats` loop per list |
| `chats.list` | none (cache) |
| `chats.open` | `getInternalLinkType`, then `searchPublicChat` / `checkChatInviteLink` / `joinChatByInviteLink` / `getMessageLinkInfo` |
| `chats.messages` | `getChatHistory` (100 per call, paging inside the call like FileGram because TDLib returns short first pages, until `limit`) |
| `chats.media` | none at read; scan uses `getChatMessageCount` × 7 media filters, `getChatHistory` |
| `search.global` | `getInternalLinkType` when the query is a link; chats from cache |
| `downloads.add` | `getMessages` (items not in the index), `getInternalLinkType` + `getMessageLinkInfo` + `getChatHistory` (links) |
| Download start | `getMessage`, `getRemoteFile` (when the file has a remote id), `downloadFile` (priority 1, async) |
| Download progress | `updateFile` |
| Download stall | `getFile`, `downloadFile` again; third stall in a row `cancelDownloadFile` and requeue (see Stalls) |
| Download finalize | `deleteFile` (after moving the file out of `tdlib\files`, so TDLib's database stays consistent), thumbnail `getRemoteFile` + `downloadFile` (synchronous) |
| Download pause / cancel | `cancelDownloadFile(only_if_pending: false)`; cancel also `deleteFile` (unfinished non-live downloads that transferred data: `getMessages` first, see `jobs.action cancel`) |
| Download skip-existing | `deleteFile` only when TDLib holds local data for the file (Download step 4) |
| Upload start | `sendMessage` (1 file) or `sendMessageAlbum` (2–10) |
| Upload progress / result | `updateFile` (`remote.uploaded_size`), `updateMessageSendSucceeded`, `updateMessageSendFailed`, `updateDeleteMessages` naming a pending id (TDLib reports some failed sends as deletions) |
| Upload pause / cancel / quit | `deleteMessages(revoke: true)` on the still-pending messages by their `pendingId`s (skipped when the job has no live state) |
| Upload failed cleanup | `deleteMessages(chat_id, [update.message.id], revoke: true)`: the failed message's new id, not the temporary one |
| Upload crash recovery | routing map rebuilt from `files[].pendingId` before `start(creds)`; on `ready`, `getMessage` on each still-unsettled pending id; `active` uploads with no pending id left settle without TDLib calls (`completed`, or failed "Interrupted", Upload step 6) |
| `teleflow://thumb` | `getRemoteFile`, size check, `downloadFile` (priority 32, synchronous) |
| `app.clearCache` and Clear app data | `optimizeStorage` (size 0, ttl 0, count 0, immunity_delay 0, every `fileType*` used for media, thumbnails, and profile photos) |
| `app.clearAll` | `logOut` as above |
| Updates consumed | `updateAuthorizationState`, `updateConnectionState`, `updateOption` (`message_caption_length_max`), `updateUser`, `updateBasicGroup`, `updateSupergroup`, `updateNewChat`, `updateChatTitle`, `updateChatPhoto`, `updateChatPermissions`, `updateChatPosition`, `updateChatAddedToList`, `updateChatRemovedFromList`, `updateChatLastMessage`, `updateChatDraftMessage` (positions only), `updateChatReadInbox`, `updateChatFolders`, `updateNewMessage`, `updateDeleteMessages`, `updateFile`, `updateMessageSendSucceeded`, `updateMessageSendFailed` |

## Transfer engine (`core/transfers.ts`)

- States: `queued → active → completed | failed`, `queued/active → paused → queued`, `failed → queued` (retry). Cancel deletes the row. The UI shows "Downloading"/"Uploading" for `active` by kind, and "Finalizing" while an active download is moving its file (`JobLive.finalizing`).
- In memory, per active job: `{ fileIds, done, speed, lastBytes, lastAt, lastProgressAt, stalls }`, plus `inFlight: Map<fileId, jobId>` for `updateFile` routing, the same-file wait, and cancel cleanup. Speed is an EMA (`speed = 0.7 * speed + 0.3 * instant`). `done` is written to SQLite on pause, finish, and quit.
- Pump (`pump()`): runs on enqueue, finish, resume, settings change, `ready`, and when a wait ends. Per kind it starts `SELECT ... WHERE kind = ? AND status = 'queued' ORDER BY position LIMIT free` while the kind's gate allows; `free` = the kind's limit minus its jobs with live state (a finalizing download has already given its slot back), so a row left `active` without live state never holds a slot. Nothing starts unless Telegram is `ready`. A download whose TDLib file is already in flight for another job waits (`ponytail:` same-file siblings re-download after the first finishes; `skipExisting` usually completes them instantly).
- Gate per kind (pure, tested): concurrency limit from settings; start spacing starting at 600 ms (downloads) / 1000 ms (uploads), doubled on every flood up to 5 s and eased by 100 ms per accepted start (AIMD from FileGram); `waitUntil` set from `FLOOD_WAIT_n`, `FLOOD_PREMIUM_WAIT_n`, or `retry after n`. A flood-waited job goes back to `queued` and its `attempts` is decremented, so the wait does not spend an attempt.
- `attempts` counts starts: each start increments it.
- `requeueActiveDownloads()`: `UPDATE jobs SET status = 'queued' WHERE kind = 'download' AND status = 'active'` and clear the in-memory download state. Called once after the database opens (before the first pump) and whenever auth leaves `ready` (logout, credentials change, FileGram session import, client closed). Rows keep their `position`, so interrupted downloads restart first, and TDLib's partial data makes them resume. Uploads use their pending-id path instead (Upload step 6).
- Tick every 500 ms: emit `stats` when busy; sample `history` once per second (see `LiveStats`); check stalls (below); requeue failed jobs whose `retry_at` passed; emit `invalidate: ['history']` when the local date changes; once a minute delete completed jobs older than `clearCompletedDays`.
- Stalls (one rule, pure decision tested). Checks run only while `connection === 'ready'`, so an outage does not burn restarts. No new bytes for `stallSeconds` → `getFile`: completed → finalize; `can_be_downloaded: false` → fail, not retryable; otherwise `downloadFile` again and `stalls += 1`. Any progress resets `stalls`. At `stalls === 3`: if `attempts >= retryAttempts` → fail "Download keeps stalling" (auto-retry does not apply because attempts are spent; manual Retry resets them); else `cancelDownloadFile` and `status = 'queued'` with `position` unchanged, and the next start counts as an attempt.
- Auto-retry: on a retryable failure with `autoRetry` on and `attempts < retryAttempts`, set `retry_at = now + min(30 s × 2^(attempts − 1), 10 min)`. Retryable (pure, tested): network and timeout errors, 5xx, `FILE_REFERENCE_EXPIRED`, unknown errors. Not retryable: message deleted, no media, `can_be_downloaded: false`, source file missing, `CHAT_WRITE_FORBIDDEN`, `ENOSPC`, file too large, interrupted upload, "Download keeps stalling". A final failure inserts one `history` row per job (`name` = job name); completions insert one per file.

### Download

1. Mark active, `attempts + 1`. `getMessage(chat_id, message_id)`; missing → fail "This message no longer exists". No media → fail.
2. If the file has `remote.id`, `getRemoteFile` to get the current file id (FileGram lesson: stored ids go stale).
3. Target folder = download root + `folderFor(template, chat)`; name = `fileName(media, datePrefix)` (sanitized: Windows-invalid characters → `_`, reserved names get `_`, trailing dots/spaces trimmed, 180-char cap keeping the extension).
4. `skipExisting` and a file with that name and the expected size exists → `complete(job, path)` (step 6) with that path and no transfer, so history, dedupe, stats, and Library metadata see it like any download, including after Clear Completed. It skips the move and Mark-of-the-Web (the file may not be TeleFlow's). When TDLib holds local data for the file (`local.downloaded_size > 0`, for example after a crash between the move and `complete`) and no other job has it in `inFlight`, it also calls `deleteFile`, so the TDLib copy does not linger.
5. Already complete in TDLib's cache → finalize. Else `downloadFile` (async); progress via `updateFile`.
6. Finalize:
   - Free the concurrency slot first (big cross-volume copies must not block the next download, a FileGram lesson) and mark `finalizing`.
   - Pick the name with `uniquePath(dir, name, reserved)` (` (2)`, ` (3)`; pure, tested). It skips names that exist on disk and lowercased paths in `reserved: Set<string>`, owned by `transfers.ts`. The chosen path is added before the move and removed after `complete` or on error, so two finalizes running at once never pick the same name (`fs.rename` replaces an existing file on Windows).
   - Move. A file under its final name is always complete: a same-volume `fs.rename` is atomic, and a cross-volume move copies to a dot-prefixed part file in the target folder (the Library scan skips dot-prefixed entries) and renames it on that volume. Mark-of-the-Web (`<file>:Zone.Identifier` = `[ZoneTransfer]\r\nZoneId=3\r\n`, so Windows applies SmartScreen and Office Protected View) is written before the file takes its final name; the stream moves with the rename.
     ```ts
     await markOfTheWeb(src)                                           // logs at warn and continues on failure
     try { await fs.promises.rename(src, dest) }
     catch (e) {
       if (e.code !== 'EXDEV') throw e
       const part = path.join(dir, `.teleflow-${job.id}.part`)
       await fs.promises.rm(part, { force: true })                     // stale part from an interrupted run
       try { await fs.promises.copyFile(src, part); await markOfTheWeb(part); await fs.promises.rename(part, dest) }
       catch (e) { await fs.promises.rm(part, { force: true }); throw e }
     }
     // ponytail: a part file of a job canceled after a crash is not swept; upgrade: sweep .teleflow-*.part on Clear cache
     ```
     `ponytail:` FAT/exFAT volumes have no streams, so their files carry no Mark-of-the-Web.
   - Once the file has its final name nothing fails the job. `deleteFile` in TDLib, best effort (warn on error); it also removes the source a copy left behind, so there is no separate `rm(src)`. Then `complete(job, dest)`: one transaction updates the job (`completed`, `path`, `finished_at`) and inserts the history row; then the thumbnail is saved to `home\thumbs\<history.id>.jpg` using the new row id (failure is logged at warn and ignored); the reservation is released; `jobs`, `history`, `library`, `media:<chatId>`, `messages:<chatId>` are invalidated. Step 4 uses the same `complete`.
   - Errors before the file has its final name (disk full, permission) fail the job with the message; the TDLib copy is not deleted, so a retry finalizes without re-downloading.
   - Quit does not wait for a finalize, and a crash cannot. Either way the final name holds a complete file or nothing (a copy in progress only leaves the part file, which the job's next finalize removes). If the file already has its final name but `complete` did not run, the job stays `active`; on restart it is requeued, and step 4 finds the file and completes the job. With `skipExisting` off it is downloaded again and saved as ` (2)`.

### Upload

1. `uploads.add` checks `canPost` and file limits, then groups files (`groupUploads(files, { album, photos, videos })`, pure, tested): kind per file is photo for jpg/jpeg/png/webp up to 10 MB, video for mp4/mov/m4v/webm/mkv, audio for mp3/m4a/aac/ogg/flac/wav, else document; photos or videos become documents when the chat does not allow them (see Chat cache). With `album` on, consecutive runs of the same class (photo/video, audio, document) are chunked into albums of up to 10; a run of one is a single job. The caption goes on the first file of the first job. `added` = number of files.
2. Start: every source file must still exist (else fail "Source file is missing: <name>"). With `keepNames` off, each file is hard-linked (copied across volumes) to `home\tmp\<jobId>\TeleFlow_<yyyyMMdd-HHmmss>_<n>.<ext>`.
3. Build the content with `inputFileLocal`: `{ _: 'inputMessagePhoto', photo: { _: 'inputPhoto', photo } }`, `{ _: 'inputMessageVideo', video: { _: 'inputVideo', video, supports_streaming: true } }` (`supports_streaming` belongs to `inputVideo`; on the outer object it is ignored), `{ _: 'inputMessageAudio', audio: { _: 'inputAudio', audio } }`, or `{ _: 'inputMessageDocument', document: { _: 'inputDocument', document } }`, each with the caption when it has one. Call `sendMessage` or `sendMessageAlbum` for the files that have no `messageId` yet. Each returned temporary message id is stored on its own file entry (`files[i].pendingId`) and `files` is persisted at once; `route: Map<pendingId, { jobId, index /* into files */ }>` matches the updates. Because the id sits on the file, the index survives a crash even after some files of the send have succeeded.
4. Each pending file settles once, and settling persists `files` right away:
   - Sent: `updateMessageSendSucceeded` (matched by `old_message_id`) sets `files[index].messageId` to the new id and deletes `pendingId`.
   - Failed: `updateMessageSendFailed` (matched by `old_message_id`) deletes `pendingId` and deletes the failed local message by its new id: `deleteMessages(chat_id, [update.message.id], revoke: true)`. `updateDeleteMessages` naming a pending id also counts as failed (TDLib reports some failed sends that way; the message is already gone).

   When no file of the job has a `pendingId` left:
   - All sent → `completed`, `message_id` = first new id, one history row per file, `tmp\<jobId>` removed.
   - Any failed → `settleUpload(job)` (pure, tested) in one transaction: a completed history row per sent file; the sent files removed from `files`; `name`, `type`, `size` recomputed from the rest, `done = 0`; `caption = NULL` when the first file was sent (the caption went out with it). Then a flood → `queued` after the wait (no attempt spent); else fail with the error (auto-retry per `isRetryable`). A retry sends only the remaining files, so nothing is posted twice.
5. Pause and cancel first settle files already sent (as in step 4), then delete the still-pending messages by their `pendingId`s (temporary ids, which cancels TDLib's upload) and clear those ids. Resume sends the remaining files from zero (UI says so). A job with no live state (after logout) skips the TDLib calls.
6. Quit: active uploads settle and delete pending messages as in step 5 and go back to `queued`. Crash recovery: before `start(creds)` the engine rebuilds the routing map from every active upload, so the updates TDLib sends while it resumes pending messages at startup reach the right file:
   ```ts
   for (const job of activeUploads) job.files.forEach((f, index) => { if (f.pendingId && !f.messageId) route.set(f.pendingId, { jobId: job.id, index }) })
   ```
   On `ready`, each still-unsettled pending id gets `getMessage`: `sendingStatePending` → keep waiting; `sendingStateFailed` → delete it and settle the file as failed; gone → settled as failed. Both failures carry "Interrupted. Check the chat before retrying" (not retryable, to avoid duplicate posts: a message that vanished may have been sent before the crash).

   On the same `ready`, every `active` upload with no live state and no `pendingId` left settles at once through step 4's job-level rule, with no TDLib call: all files have `messageId` → `completed`; otherwise `settleUpload(job)` and fail "Interrupted. Check the chat before retrying" (not retryable, the same rule as a vanished pending id, because TDLib may have accepted a send whose id was never persisted). This covers a crash or auth change during step 2's copy, between `sendMessage` returning and `files` being persisted, and between the last file settling and the job update; without it the row would stay "Uploading" with no live state. A start checks that its live state still exists right before `sendMessage` (leaving `ready` drops it), so a job settled here is never also sent by the start it interrupted.

### Notifications

Main listens to engine finish events and, per settings, shows one Electron `Notification` per 3-second batch ("<n> downloads completed", "<n> transfers failed"). Clicking it shows the window.

## Storage and maintenance (`core/storage.ts`)

- `resolvePaths({ env, localAppData, appDir, packaged })`, `checkDownloadRoot(path, { sealed, guarded })`, and `pageKey(url)` (IPC sender check, Bridge step 1) are pure and tested; main computes `appDir`, `sealed`, and `guarded` (Runtime data).
- `log(level, ...args)`: one function that appends to `main.log` and mirrors to the console. Levels: `error` (unexpected failures, with stack), `warn` (flood waits, retries, recoverable fs errors), `info` (startup, TDLib version, auth state changes, migration steps). Never logs the API hash, phone, codes, or passwords.
- Library scan: `fs.promises.readdir(root, { recursive: true, withFileTypes: true })`, `stat` in batches of 64, skipping any entry whose name or any parent folder name starts with `.` (FileGram's `.thumbs` lives in its downloads folder), plus `desktop.ini` and `Thumbs.db`. Joined to completed download history by lowercased path for chat and message data; otherwise `chat` = first folder under the root. Cached in memory; a completed download or trash updates the cache, a root change drops it, and a cache older than 60 s is rebuilt on the next read (`ponytail:` no file watcher; upgrade path: `fs.watch` on the root). Startup runs one scan in the background so `search.global` has files from the first search. `missing` = for each `(chat_id, message_id)`, the latest completed download history row with `path IS NOT NULL`, when that path is neither in the scan nor on disk.
- `library.trash` uses `shell.trashItem` (Recycle Bin), then forgets the download (see the `library.trash` note under Methods). Main passes `trashItem` in, so `core/` stays Electron-free.
- Sizes: one async recursive `dirSize(path)` used by the storage report, clearing, and leftovers. Drive totals from `fs.statfs`. The Chromium cache is measured with `session.getCacheSize()` (passed in from main), because `home\chromium` also holds Local Storage, which no clear here removes.
- Clear cache: 409 if any job is active or finalizing. Measure → `optimizeStorage` (when a client exists) → empty `thumbs\` → remove `tmp\` entries not used by unfinished uploads → `session.clearCache()` + `session.clearCodeCaches({})` → `UPDATE jobs SET done = 0 WHERE kind = 'download' AND status IN ('queued', 'paused', 'failed')` (their TDLib partial data is gone) → measure; `freed` = difference.
- Clear app data: 409 if active. Delete all rows from `jobs`, `history`, `media`, `scans`; delete settings except `apiId`, `apiHash`, `window`; `VACUUM`; then Clear cache.
- Clear All Data: cancel every job; if `deleteDownloads`, delete every file the Library lists, then empty folders under the root (the root itself stays); log out (local delete if offline); remove `tdlib\`, `thumbs\`, `tmp\`; delete all rows including credentials; `VACUUM`; `session.clearStorageData()`; main turns Start with Windows off (`app.setLoginItemSettings({ ...loginItem, openAtLogin: false })`), so no startup entry outlives the data. Auth returns to `credentials`.
- FileGram import:
  - `inspect` requires a directory with at least one FileGram marker: a `.td_database\` directory, a `.filegram_state\` directory, or a `package.json` whose `name` is `filegram`. Otherwise 400 "This doesn't look like a FileGram folder". `config.json` and `settings.json` are read only after a marker matched, so a wrong pick never moves or offers to delete anything. `import` re-runs the same check.
  - `import` needs no active transfers. Credentials: `.env` `API_ID`/`API_HASH` first (FileGram's precedence), then `config.json`. Session (only when TeleFlow is not logged in): close the client, remove TeleFlow's unauthenticated `tdlib\db`, move `.td_database` there (rename; `EXDEV` → copy then delete; `EBUSY`/`EPERM` → 409 "Close FileGram first"), start the client. Downloads: `settings.json` `downloadsDir` (else `<dir>\downloads` if present); inside the FileGram folder → `moveInto(src, downloadRoot)` (rename per entry, merge folders, collisions get ` (2)`, dot-prefixed entries such as `.thumbs` skipped; `ponytail:` moved files are not given Mark-of-the-Web, upgrade: mark each file during the move); outside → becomes `downloadRoot` if it passes `checkDownloadRoot`, else the current root stays and `warning` carries the reason (the dialog shows it; `inspect` already reports it as `downloadsWarning`). Saves `fileGramDir`. Every step is idempotent, so Retry after "Close FileGram first" continues where it stopped.
  - Leftovers, only while `fileGramDir` is set: fixed names under `fileGramDir` (`.td_database`, `.td_files`, `.filegram_state`, `.management_uploads`, `.thumbs`, `downloads`, `config.json`, `settings.json`) plus `<downloadRoot>\.thumbs` (FileGram's thumbnails when its outside folder became the root), listed when present with sizes. `removeLeftovers` recomputes that list and removes exactly those: the `downloads` folder goes to the Recycle Bin (`trashItem`), since it may still hold user files; the rest are deleted. Then it clears `fileGramDir`. Renderer-supplied paths are never deleted. `.env` is left alone (it may hold unrelated secrets).

## Desktop integration (`electron/main.ts`)

Startup, in this order:
1. `resolvePaths` (fails with a clear error if `home` is inside `appDir`); open the logger.
2. `app.setPath('userData', home)`, `app.setPath('sessionData', home\chromium)`, before the lock so dev and installed runs keep separate profiles (whether the lock is keyed by `userData` is checked in the Phase 1 spike).
3. `app.setAppUserModelId('com.teleflow.app')` (Windows toast identity, same as `appId`).
4. `app.requestSingleInstanceLock()`; false → quit. A second launch focuses the existing window and exits.
5. `protocol.registerSchemesAsPrivileged` for `teleflow` (`standard`, `secure`).
6. Open SQLite, `requeueActiveDownloads()`, rebuild the upload routing map from `files[].pendingId` (Upload step 6).
7. `app.whenReady()`: `protocol.handle('teleflow')`, `ipcMain.handle('call')`, window (not shown when launched with `--hidden` and `closeToTray` on), tray.
8. `start(creds)` when `apiId`/`apiHash` are stored, else auth is `{ step: 'credentials' }`.
9. One background Library scan (`search.global` files).

- Window: restored from the `window` setting if it intersects a display (`screen.getAllDisplays()`), else 1440×900 clamped to the work area, centered; `minWidth: 1024`, `minHeight: 640`; `backgroundColor` = app background; `titleBarStyle: 'hidden'` with `titleBarOverlay` (`color: '#060b18'`, the top bar background; `symbolColor` = `text-2`; `height: 40`, the top bar height), so the native min/max/close buttons sit on the dark top bar.
- Tray (always present): icon from `assets/icon.png`; tooltip "TeleFlow — <active> active · <speed>" updated with `stats`; menu Show TeleFlow, Pause all, Resume all, Quit TeleFlow; double-click shows the window.
- Close: `closeToTray` on → hide the window (transfers continue); off → quit.
- Start with Windows: one options object for reading and writing, because on Windows `getLoginItemSettings` only matches an item with the same `args` (default `[]`):
  ```ts
  const loginItem = app.isPackaged ? { args: ['--hidden'] } : { path: process.execPath, args: [app.getAppPath(), '--hidden'] }
  const startWithSystem = app.getLoginItemSettings(loginItem).executableWillLaunchAtLogin // false if disabled in Task Manager
  app.setLoginItemSettings({ ...loginItem, openAtLogin })                                 // enabled defaults to true
  ```
  `--hidden` starts in the tray only when `closeToTray` is on.
- Quit: persist live progress, settle active uploads and put them back to `queued` (Upload step 6), `client.close()`, close SQLite. Active downloads, including one in the middle of a finalize, are left as they are; `requeueActiveDownloads()` puts them back in the queue on the next start (the same path covers a crash), and finalize never leaves a partial file under the final name (Download step 6).

## Security

- `webPreferences`: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, `webSecurity: true`, preload only.
- CSP (injected into `index.html` at build time by a 6-line Vite plugin, because dev HMR needs inline scripts): `default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' teleflow: blob: data:; font-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`.
- Navigation: `will-navigate` is prevented; `setWindowOpenHandler` denies every window and opens `https:` URLs with `shell.openExternal`. Permission requests are denied (`setPermissionRequestHandler`), since notifications come from main.
- IPC: sender-frame check (full page path for `file:` or URL in dev, hash and query stripped, case-insensitive, never the origin; 403 otherwise, also on any parse error; Bridge step 1), own-property method lookup, per-method validation, no generic file or shell access. File operations are confined to the download root, `home`, the recorded `fileGramDir` leftover names, and `fileGram.import`, which moves only `.td_database` and the FileGram downloads folder out of a folder that passed `inspect`. Upload sources are read-only.
- Secrets: the API hash stays in main; the renderer only sees `apiId`. Phone numbers are masked in `Me`. Nothing secret is logged.
- Downloaded files get Mark-of-the-Web (`Zone.Identifier`, `ZoneId=3`) at finalize, so Windows applies SmartScreen and Office Protected View when they are opened from the Library (`shell.openPath`) or Explorer. Verified manually in Phase 6 (`Get-Item <file> -Stream Zone.Identifier`).
- The download root can never be, sit inside, or contain system or app data folders (`checkDownloadRoot`), because Clear All Data may delete everything under it.
- FileGram import acts only on folders with a FileGram marker (`fileGram.inspect`).

## Build, packaging, tests

`package.json` scripts:

| Script | Command |
|--------|---------|
| `dev` | `electron-vite dev` |
| `build` | `electron-vite build` (→ `out/main`, `out/preload/preload.cjs`, `out/renderer`) |
| `typecheck` | `tsc --noEmit` |
| `test` | `node --test tests/engine.test.ts` |
| `test:ui` | `playwright test tests/ui.spec.ts` (needs `build`; loads `out/renderer/index.html` from disk, stubs `window.teleflow` with `addInitScript`; `playwright.config.ts` launches Chromium with `--allow-file-access-from-files`, without which Chromium blocks the module script from origin `null`, verified in design review 1) |
| `dist` | `electron-vite build && electron-builder --win nsis` |
| `test:app` | `playwright test tests/app.spec.ts` (needs `dist`; launches `release\win-unpacked\TeleFlow.exe` through its absolute path lowercased, so `rendererUrl` gets a lowercase drive letter that Chromium uppercases (Bridge step 1), with `TELEFLOW_HOME` set to a temp folder) |
| `icon` | `node scripts/icon.ts` |

electron-builder config (`"build"` in `package.json`): `appId: com.teleflow.app`, `productName: TeleFlow`, `directories: { output: release, buildResources: assets }`, `files: ["out/**", "package.json"]`, `asarUnpack` as above, `npmRebuild: false`, `win: { target: nsis, icon: assets/icon.ico }`, `nsis: { oneClick: false, perMachine: false, allowToChangeInstallationDirectory: true, createDesktopShortcut: true, createStartMenuShortcut: true, deleteAppDataOnUninstall: false, include: "assets/installer.nsh", artifactName: "TeleFlow-Setup-${version}.${ext}" }`. The installer is unsigned, so SmartScreen warns on first run.

`npmRebuild: false`: `tdl` 8.1.0 ships `binding.gyp` and an `install: node-gyp-build` script next to its N-API prebuild, and electron-builder's default rebuild could try to compile it (Python and MSVC on every build machine). The prebuild already loads in Electron 44 (Early-risk findings); the Phase 1 packaging spike confirms the packaged app still loads it.

`assets/installer.nsh` removes the Run value that `app.setLoginItemSettings` wrote (value name = Electron's default, the AppUserModelId), so uninstalling leaves no dead startup entry. `isUpdated` is set when a newer installer runs the old uninstaller, so an upgrade keeps Start with Windows:
```nsis
!macro customUnInstall
  ${ifNot} ${isUpdated}
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "com.teleflow.app"
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run" "com.teleflow.app"
  ${endIf}
!macroend
```
The value name is confirmed in Phase 6 (`reg query HKCU\Software\Microsoft\Windows\CurrentVersion\Run` with the toggle on).

Icon: `assets/icon.svg` is the source. `scripts/icon.ts` renders it with Playwright's Chromium at 16, 32, 48, and 256 px and writes `icon.png` (256) and `icon.ico` (PNG-compressed entries). Both outputs are committed.

Version: only in `package.json`; main reads `app.getVersion()`, and the renderer gets it from `app.info`.

Licenses: `electron.vite.config.ts` reads `{ name, version, license }` from `node_modules/<name>/package.json` for every `dependencies` entry plus `electron`, `react`, `react-dom`, `lucide-react`, and injects the list into the main build with `define: { __LICENSES__: JSON.stringify(list) }` (a few lines; Vite bundles the renderer libraries, so their `package.json` files are not in the packaged app).

Testability:
- Unit (`node:test`, plain Node 24, `:memory:` SQLite): `fileName`, `sanitize`, `folderFor` (incl. invalid template characters), `uniquePath` (incl. a reserved name), `resolvePaths`, `pageKey` (`pageKey('file:///C:/X/out/renderer/index.html#/queue') === pageKey(pathToFileURL('c:\\x\\out\\renderer\\index.html').href)`; a sibling `…/renderer/other.html` differs; `http://localhost:5173/#/a` equals `http://localhost:5173`; a path with `%2F` throws), `checkDownloadRoot` (rejects relative paths, drive roots, `home`, `appDir`, `%LOCALAPPDATA%`, `%LOCALAPPDATA%\Programs`, `C:\Windows`, `C:\Program Files\X`, the profile folder, known folders and their ancestors; accepts `D:\Media` and `Downloads\TeleFlow`), `parseFloodWait`, gate spacing and backoff, stall decision (offline skip, third stall requeue, cap → "Download keeps stalling"), `isRetryable`, `retryDelay`, `groupUploads` (albums, photo/video permissions → documents), `settleUpload` (an album of 3 where 1 fails leaves 1 file in the job and 2 history rows; caption dropped when the first file was sent; after a restart with `files[1].messageId` and `files[2].pendingId` set, the rebuilt routing map sends a success for `files[2].pendingId` to index 2; after a simulated restart and `ready`, an `active` upload with no `pendingId` and one file without `messageId` ends `failed` with "Interrupted. Check the chat before retrying", and one whose files all have `messageId` ends `completed`), upload kind detection, enqueue upsert (dedupe, `force` only for completed, open rows untouched, re-add after Clear Completed → `skipped`, new rows get increasing `position`, a retried row keeps its `position`), skip-existing completion (after `complete` and Clear Completed, `MediaItem.status` is still `downloaded` and `downloads.add` counts the item in `skipped`), `jobs.action` with 1000 ids (one `json_each` parameter), scan start decision (no new top-up once `newest_id` equals a text last message; no start for a chat in `failed`; live upkeep bumps `newest_id` only for `current` chats), `library.*` path rule (inside the root, or equal to a recorded download path after a root change; anything else 404), `requeueActiveDownloads`, `nextQueued` order and limits, `jobs.list` ordering, up/down swaps, media filter query, `MediaItem.status` derivation (trash nulls the path → `none`), `missing` (latest row only), stats buckets, `isTelegramLink`, FileGram marker check and credential precedence, `repository` URL normalization.
- Renderer (Playwright, Chromium): every page renders with fixture data at 1440×900 and 1280×720 (screenshots), empty/loading/error states, the Control inventory flows in UI.md against the stub (asserts the method and args each control calls).
- Packaged smoke (`_electron`, exe launched through its lowercased path): the exe starts, `app.info().tdlib` is `1.8.66`, the Login credentials step is visible (so the sender check passed), `main.log` contains the TDLib version line and no "Not allowed" warning.
- Manual (documented in PROGRESS per release): real login, download, upload (incl. a partly failed album), a download to a second drive (cross-volume finalize: no `.teleflow-*.part` left, Mark-of-the-Web present), cancel of a paused download frees its `tdlib\files` data, tray, start with Windows (toggle reads back on after a restart; uninstall removes the Run value, an upgrade install keeps it), Mark-of-the-Web on a downloaded file, installer install/uninstall (once into a custom folder typed in lowercase, which must reach the Login screen).

## Design review 1: responses

Review 1 (CHANGES_REQUESTED, 2 HIGH, 15 MEDIUM, 22 NIT; the file `docs/.design-review.md` has since been replaced by review 2). All 39 findings are addressed; none ignored.

| # | Response |
|---|----------|
| 1 | Addressed: `scans.total` = sum of 7 per-filter `getChatMessageCount` calls (null on error); `indexed` = media rows, clamped; UI index bar says "about" and is indeterminate when total is null |
| 2 | Addressed: `requeueActiveDownloads()` at DB open and whenever auth leaves `ready`; Quit section and tests updated |
| 3 | Addressed: `pageSize` 1–100 |
| 4 | Addressed: `jobs.list` order, `open`, "#", no-ids scope per action, retry reset; Queue tabs call `{ kind, status: 'open' }` |
| 5 | Addressed: upsert touches only failed rows, or completed ones with `force`; non-forced adds skip `downloaded` items |
| 6 | Addressed: trash nulls `history.path` and deletes the completed job; `downloaded` and `missing` require a path; `missing` uses the latest row |
| 7 | Addressed: Shell Control inventory and Data bindings in UI.md |
| 8 | Addressed: stats defined on completed history rows with buckets; midnight `history` invalidation; Downloads tile uses `totalFiles.download` |
| 9 | Addressed: `app.info` sources (`installedAt` from the install folder, `__LICENSES__` at build time, `repository` from `package.json`) |
| 10 | Addressed differently: `chats.messages` takes `limit` (1–1000) instead of a cursor, "Load older" raises it, so `useCall` refetches one contiguous list. The review's per-cursor refetch drops messages at page boundaries when new messages arrive. Chat View subscribes to `messages:<chatId>` only |
| 11 | Addressed: membership = main list (+ archive), Saved Messages (`createPrivateChat`), session-opened set with a `ponytail:` note |
| 12 | Addressed: one stall rule, online only, capped by `retryAttempts`, "stall restarts" removed from the retryable list |
| 13 | Addressed: `uploadMax` from `premium`; `captionMax` refreshed on `updateOption` |
| 14 | Addressed: `appDir` = exe folder when packaged |
| 15 | Addressed: `checkDownloadRoot` rejects the profile, known folders, and their ancestors; FileGram import keeps the current root with `warning` |
| 16 | Addressed: `--allow-file-access-from-files` in `playwright.config.ts` |
| 17 | Addressed: unsupported auth states map to `phone` with `error`; `ponytail:` upgrade path named |
| 18 | Addressed: `Stepper` is page-local to Settings |
| 19 | Addressed: `FileGramImportDialog` lives in `pages/Settings.tsx`; Login imports it |
| 20 | Addressed: skeletons only on first load; refetch keeps data |
| 21 | Addressed: thumbnail saved after the transaction, under the new `history.id` |
| 22 | Addressed: `moveInto` and the Library scan skip dot-prefixed entries; `<downloadRoot>\.thumbs` listed as a leftover |
| 23 | Addressed: null frame rejected; the origin + pathname comparison was replaced by a full-URL comparison in review 3 #1 |
| 24 | Addressed: `{ standard, secure }` only; size check before `downloadFile` |
| 25 | Addressed: `session` and `activeTransfers` dropped; Clear buttons gate on `live.counts` |
| 26 | Addressed: `getCacheSize()`; `clearCache()` + `clearCodeCaches({})` |
| 27 | Addressed: 403 listed |
| 28 | Addressed: Security > IPC names the `fileGram.import` moves |
| 29 | Addressed: `updateChatPermissions` consumed; photos/videos sent as documents where not allowed |
| 30 | Addressed: zeros sampled until 60 in a row |
| 31 | Addressed in the Phase 1 scaffolding commit (it already edits `.gitignore` for `out/`): drop `.teleflow/`, un-ignore `.kiro/steering/`; PRODUCT notes where the rules live until then |
| 32 | Addressed: `useRoute` / `navigate` in `api.ts`; Layout updated |
| 33 | Addressed: "Download all `<n>` matching" |
| 34 | Addressed: "Signing out…" spinner |
| 35 | Addressed: Danger Zone subtitle no longer mentions downloads |
| 36 | Addressed: template literal characters validated |
| 37 | Addressed: `view` defaults to `files` |
| 38 | Addressed: `.ts` imports, tsconfig options, `dependencies` split under Tech stack |
| 39 | Addressed: "Failed to upload `<name>`"; `added` counts files; `search.global` uses the cached scan; leftover `downloads` goes to the Recycle Bin |

## Design review 2: responses

Review 2 (CHANGES_REQUESTED, 0 HIGH, 7 MEDIUM, 18 NIT; `docs/.design-review.md` now holds review 3). All 25 findings are addressed; none backlogged or ignored. Checked against `@prebuilt-tdlib/types` 0.1008066.0 in the workspace: `getInternalLinkType` returns 404 for non-internal links, `updateChatDraftMessage.positions` exists, `ThumbnailFormat` includes `Mpeg4`/`Webm`/`Tgs`, and `updateMessageSendFailed` notes that some failed sends arrive as `updateDeleteMessages`. The FileGram `package.json` name is `filegram`.

| # | Response |
|---|----------|
| 1 | Addressed: `checkDownloadRoot(path, { sealed, guarded })`; `sealed` (home, appDir, AppData, SystemRoot, ProgramFiles, ProgramFiles(x86), ProgramData) may not be equal, inside, or contained; `guarded` (profile, known folders) may not be equal or contained; tests and PRODUCT rule updated |
| 2 | Addressed: one `loginItem` object (packaged `--hidden`; dev passes `execPath` + app path); read `executableWillLaunchAtLogin`, write `{ ...loginItem, openAtLogin }` |
| 3 | Addressed: one topic row for `media:`/`messages:` covering download job insert, status change, finalize, delete (incl. bulk and clears, once per affected chat) and trash; UI.md Downloads data needs points to it |
| 4 | Addressed: `files[i].messageId` persisted on success; `updateDeleteMessages` counts as a failed send; `settleUpload` writes history for sent files, trims the job, drops the caption when the first file went out; retry sends only the rest; pause, cancel, and quit settle first; test added |
| 5 | Addressed: `inspect` requires `.td_database\`, `.filegram_state\`, or `package.json` name `filegram`; config files read only after a marker; `import` re-checks |
| 6 | Addressed: `uniquePath(dir, name, reserved)` with an engine-owned set held until the history transaction; failed `EXDEV` copy removes the partial file; test added |
| 7 | Addressed: `Zone.Identifier` (ZoneId=3) written at finalize, warn on non-NTFS; Security bullet; manual Phase 6 check. FileGram-moved files are not marked (`ponytail:` note with upgrade path) |
| 8 | Addressed: `stats` keeps emitting while `history` holds a non-zero sample, so the sparkline drains to flat |
| 9 | Addressed: TDLib 404 from `getInternalLinkType` → 400 in `chats.open` / `downloads.add`; `search.global` returns `link: null` on any error; `isTelegramLink` lives in `core/telegram.ts`; per-method length limits override the common `q` rule |
| 10 | Addressed: Startup list (9 steps) in Desktop integration |
| 11 | Addressed: leaving `ready` drops live upload state and keeps rows `active`; `pause`/`cancel` without live state skip TDLib calls |
| 12 | Addressed: thumbnails only for Jpeg/Png/Webp/Gif formats, else `null` |
| 13 | Addressed: `updateChatDraftMessage` consumed for positions only |
| 14 | Addressed: dropped `jobs.started_at`, `scans.updated_at`, `stats.chats[].username`; `chatUsername`/`chatPhoto` from the chat cache at read time; `fileCount` source stated |
| 15 | Addressed in UI.md Queue: Total, legend, and Clear All `<n>` scopes |
| 16 | Addressed: `repository` normalized to `https://…` (strip `git+`, `.git`), else `null` |
| 17 | Addressed: top bar 40px; overlay color `#060b18` (top bar background), `symbolColor` = `text-2`; UI.md token table fixed |
| 18 | Addressed: `Math.min(limit + 30, 1000)`; Files View switch when `limit === 1000 && more` |
| 19 | Addressed: Clear cache resets `done` for queued, paused, and failed downloads |
| 20 | Addressed: Retry attempts stepper always enabled, described as "Starts per transfer, including stall restarts" |
| 21 | Addressed: "Not signed in" branch removed from App Status |
| 22 | Addressed: crash note reworded (step 4 completes the job); `checkDownloadRoot` only validates, `settings.set` creates the folder |
| 23 | Addressed: duration filters add `duration > 0`; one `typeLabel` map in `ui.tsx` (Recent Activity, Chat View media cards) |
| 24 | Addressed: startup runs one background Library scan |
| 25 | Addressed: pending ids loaded into the routing map before `start(creds)`; review-1 pointer reworded |

## Design review 3: responses

Review 3 (CHANGES_REQUESTED, 0 HIGH, 6 MEDIUM, 15 NIT; `docs/.design-review.md` now holds review 4). All 21 findings are addressed; none ignored. Deferred upgrades are `ponytail:` notes with an upgrade path, also listed in PROGRESS.

| # | Response |
|---|----------|
| 1 | Addressed: `pageUrl()` strips hash and query and compares full `href`s against `rendererUrl`, the same URL the window loads (`file:` origins are `"null"`, so origins are not compared; the env URL is honored only unpackaged); rejection is `403 'Not allowed'`, logged at warn; `test:app` proves the real page passes. The string comparison became a case-insensitive `pageKey` path comparison in review 4 #1 |
| 2 | Addressed: canceling non-live downloads with `attempts > 0 OR done > 0` deletes TDLib partial data in a background task (`getMessages` 100 per call, `deleteFile`, skipping files in `inFlight`); skipped when not `ready` with a `ponytail:` note; call map row updated. `done > 0` is added to the review's `attempts > 0` because `retry` resets `attempts` |
| 3 | Addressed: `jobs.pending` column dropped; `files[i].pendingId` set on send and cleared on settle; startup rebuilds `route` from files with `pendingId && !messageId`; Upload steps 3–6, schema, call map, Startup step 6, Client lifecycle, invariant, and the `settleUpload` test updated. Also: a pending id found in `sendingStateFailed` after restart is deleted and settled as failed |
| 4 | Addressed: cross-volume finalize copies to `.teleflow-<jobId>.part`, then renames on that volume; stale part removed first, part removed on error; `ponytail:` note for unswept parts. Also: Mark-of-the-Web is written before the final rename, `deleteFile` replaces `rm(src)`, and nothing after the final rename fails the job (a failure there would make Retry save a ` (2)` duplicate); new invariant |
| 5 | Addressed: step 4 completes through `complete(job, path)` (job row, history row, thumbnail, invalidations), without the move or Mark-of-the-Web; it calls `deleteFile` only when TDLib holds data for the file; test added |
| 6 | Addressed: `newest_id`/`oldest_id` = messages walked (any content); start condition `newest_id < chat.last_message.id`; `media:` emitted on scan state change. Live upkeep bumps `newest_id` only for chats in `current` (top-up finished since the connection was last `ready`), so a gap TDLib skipped after an outage or restart is still walked |
| 7 | Addressed: `supports_streaming: true` on `inputVideo`; all four content shapes written out |
| 8 | Addressed: failed messages deleted by `update.message.id`; pause, cancel, and quit delete by `pendingId` |
| 9 | Addressed: TDLib-to-shape mappings under Shared shapes (`Folder.name`, `Chat.photo`, `Me.photo`, `AuthState.connection`); `fileGram.import.session: boolean` |
| 10 | Addressed: `ids` capped at 1000 (selections are per page) and every id list is bound as one `json_each` parameter |
| 11 | Addressed: `npmRebuild: false`; confirmed in the Phase 1 packaging spike |
| 12 | Addressed: `library.*` accepts paths inside the root or equal to a recorded download path; Settings says "Existing downloads stay where they are" |
| 13 | Addressed: `storage` row lists download root change; `window` writes emit no topic |
| 14 | Addressed: schema comment and engine text say completed = per file, failed = per job |
| 15 | Addressed: `exts` = whole chat index, ignoring filters; UI.md shows the index bar and skeleton rows while scanning with no rows |
| 16 | Addressed: unresolvable items count as `skipped`; 404 only for an unknown chat; 400 "no media" only for `{ link }` |
| 17 | Addressed: Clear All Data turns the login item off; `assets/installer.nsh` `customUnInstall` deletes the Run (and StartupApproved) value unless `isUpdated`; value name confirmed in Phase 6 |
| 18 | Addressed: `jobs_path` and `history_path` expression indexes on `lower(path)` |
| 19 | Addressed: logout keeps the queue, stated with a `ponytail:` note; PRODUCT Log out says so |
| 20 | Addressed: `enqueue` assigns `MAX(position) + 1` once per transaction and increments per row (a per-row `MAX` subquery would scan the table for each of 10 000 rows); a retried job keeps its place (first-enqueue order) |
| 21 | Addressed: dropped `Chat.archived`, `Message.outgoing`, `Job.fileCount`, `Job.attempts`, `Job.createdAt` (none bound in UI.md; archive ordering stays server-side) |

## Design review 4: responses

Review: `docs/.design-review.md` (CHANGES_REQUESTED, 0 HIGH, 2 MEDIUM, 2 NIT). All 4 findings are addressed; none backlogged or ignored. The one new deferral is a `ponytail:` note, also listed in PROGRESS.

| # | Response |
|---|----------|
| 1 | Addressed as proposed: `pageKey()` (pure, `core/storage.ts`) strips hash and query and compares `file:` pages as decoded, lowercased paths (`fileURLToPath`) and other URLs as lowercased `href`s, never origins; any parse error or disposed frame → 403. Unit cases: drive-letter case, sibling page, dev trailing slash, encoded slash. Also: `test:app` launches the exe through its lowercased path, so the packaged smoke covers the case the review says it could not, and the manual installer check uses a lowercase custom folder. Security bullet reworded |
| 2 | Addressed as proposed: on `ready`, every `active` upload with no live state and no `pendingId` settles through step 4 (all sent → `completed`; else `settleUpload` and fail "Interrupted. Check the chat before retrying", not retryable); call map, Client lifecycle, new invariant, `settleUpload` test extended. Also: a start re-checks its live state right before `sendMessage`, so an upload settled here is never also sent by the interrupted start; the pump's `free` = limit minus jobs with live state, so a stale row never holds a slot |
| 3 | Addressed as proposed: a non-flood page error while `ready` ends the scan (warn) and adds the chat to an in-memory `failed` set cleared with `current`; no scan starts for it; `scan.state` reads `idle`. `ponytail:` the UI shows no reason; upgrade: a `failed` scan state with the error. Scan start test extended |
| 4 | Addressed as proposed: cancel cleanup selects `kind = 'download' AND status <> 'completed' AND (attempts > 0 OR done > 0)`; call map row says "unfinished" |
