# TeleFlow: Progress

Living log of the rewrite. Update this file in the same commit as the code it describes.

- Branch: `revamp/teleflow` (worktree `.worktrees/teleflow`), cut from `main`. Not merged until the user reviews.
- Docs: [PRODUCT.md](./PRODUCT.md), [ARCHITECTURE.md](./ARCHITECTURE.md), [UI.md](./UI.md).

## How to update

After every step:
1. Tick finished items below and add new ones you discover.
2. Add a Changelog entry at the top: date, phase, what changed, how it was verified (commands + results), what is left.
3. Record any decision that changes the docs in the Decision log, and update the affected doc in the same commit.
4. If the code and a doc disagree, fix whichever is wrong before finishing the step.

## Plan

The ordered implementation plan. ARCHITECTURE.md, UI.md, and PRODUCT.md are the spec; this section only sequences them. Section names in parentheses (for example "ARCHITECTURE > Download") point at the text to implement.

How it runs:
- Phases 1–5 run in the workflow's phase loops (`phase1-loop` … `phase5-loop`). Each loop's reviewer writes `docs/.phaseN-review.json`; `"verdict": "APPROVED"` ends that loop. Phase 6 is the workflow's `final-gate` step.
- Items run in order. Each item leaves the branch green on the gates it names and ends in one local commit (code + tests + docs together).

### Rules for every item

- Work only in `c:\Users\REBEL DUKER\Downloads\tele\.worktrees\teleflow` (branch `revamp/teleflow`). Use absolute paths or the `cwd` parameter; a relative path lands in the main workspace. Never push, merge, rebase, or touch `main`.
- The main workspace is read-only except for the docs mirror. The user removed FileGram and all its data there (user change #5); never write anything else into it. Never print secrets (key names only).
- Old FileGram code is reference only. After 1.1 deletes it from the worktree, read it with `git show main:<path>` (Reference map below).
- Ponytail rules (`.kiro/steering/ponytail.md`) apply to every line. Each deliberate corner-cut is a `ponytail:` comment with an upgrade path and is listed in the item's Changelog entry.
- If code must differ from a doc, update the doc and the Decision log in the same commit.
- Pins are exact (`npm install --save-exact`, no `^` or `~`).
- Runtime data never lands in the worktree or an install folder. Tests create `TELEFLOW_HOME` with `fs.mkdtempSync(path.join(os.tmpdir(), 'teleflow-'))` and delete it afterwards. Agents set `$env:TELEFLOW_HOME` to a `%TEMP%` folder before any manual `npm run dev`, and delete it afterwards.
- No mockup sample data outside `tests/`. Fixtures use their own made-up values (for example version `9.9.9`), so a UI test proves the value is bound, not typed in.
- After each item: tick it, add a dated Changelog entry (phase, what changed, commands run and their results, deferrals, what is next), then mirror the docs:
  `Copy-Item -Force "c:\Users\REBEL DUKER\Downloads\tele\.worktrees\teleflow\docs\*.md" "c:\Users\REBEL DUKER\Downloads\tele\docs\"`.
  Stage files by name (no `git add -A`).

### Gates (named by the Verify lines)

- Core gate: `npm run typecheck` exits 0; `npm test` passes; `npm run build` writes `out\main\index.js`, `out\preload\preload.cjs`, `out\renderer\index.html`.
- UI gate (from Phase 4): `npm run test:ui` passes.
- Package gate: `npm run dist` writes `release\TeleFlow-Setup-1.0.0.exe` and `release\win-unpacked\TeleFlow.exe`; `npm run test:app` passes.
- Data gate: after the tests ran, `git status --short --ignored` in the worktree shows no `*.db`, `tdlib`, `logs`, `thumbs`, `tmp`, or `downloads` paths (ignored build output `node_modules/`, `out/`, `release/`, `test-results/` is fine).
- Hardcode gate: in the worktree, `Get-ChildItem -Recurse -File electron,core,web\src | Select-String -SimpleMatch -Pattern 'Alex Carter','MrBeast','$1 vs $250,000','2.7 MB/s','2,782','156.4 GB','500 GB','Jan 26, 2025','1.0.0','TG Manager'` prints nothing.

### Reference map (old FileGram code; `git show main:<path>`, line numbers approximate)

- Auth flow and client creation: `server.js` ~2040–2230 (auth state handler, "a closed client cannot be reused", `getMe` photo refresh).
- Media extraction: `server.js` ~2402 `extractMedia`.
- Moving finished downloads out of the TDLib files folder (rename, cross-volume copy): `server.js` ~880–910. Thumbnail copy: ~1940–1960.
- Flood-wait parsing and the stall keeper (re-assert, then cancel and restart): `server/download-client-reliability-preload.js` ~45–60, ~150–170, ~330.
- Stale file ids (`getRemoteFile` before `downloadFile`): `server/download-reference-resolver.js` ~115–140.
- Upload flood handling: `server/bulk-upload-server.js` ~62. Upload input shapes: `server/tdl-upload-compat.js` (lesson only; not ported).
- Git-history lessons kept as defaults in ARCHITECTURE > Transfer engine: download concurrency 2 avoids `FLOOD_PREMIUM_WAIT` (`dd4ad623`); batch enqueue (500 per transaction) and spaced, backed-off start bursts (`578e2d47`); stall detection that re-asserts and then restarts stalled transfers (the keeper above).

### 0. Docs (done)
- [x] PRODUCT.md, ARCHITECTURE.md, UI.md, PROGRESS.md drafted
- [x] Worktree and branch created; docs copied in
- [x] Design finalized; design reviews 1–4 resolved (39, 25, 21, 4 findings)
- [x] Design review 5 approved; its 3 NITs applied in the planning commit
- [x] Implementation plan written (this section)

### Phase 1: Scaffold, cleanup, packaging spike (`phase1-loop`, `docs/.phase1-review.json`)

- [x] 1.1 Replace FileGram with the TeleFlow scaffold.
      Delete with `git rm -r`: `server.js`, `server/`, `public/`, `scripts/` (every `*.test.cjs` and `*.ps1`), `tests/` (old specs and helpers), `BULK_UPLOAD_TESTING.md`, `Clean Repo After Release.cmd`, `FileGram.vbs`, `Install FileGram.cmd`, `Uninstall FileGram.cmd`, `playwright.config.js`, `package-lock.json`.
      Write `package.json`: name `teleflow`, version `1.0.0`, `private`, `type: module`, `main: out/main/index.js`, author `Webovignesh` and `repository.url` `git+https://github.com/Webovignesh/tele.git` (the git remote; electron-builder uses `author` as the NSIS publisher, `app.info` normalizes the URL), scripts and the electron-builder `build` block exactly as ARCHITECTURE > Build, packaging, tests. `dependencies`: `tdl` 8.1.0, `prebuilt-tdlib` 0.1008066.0. `devDependencies`: electron 44.5.1, electron-builder 26.15.3, electron-vite 5.0.0, vite 7.3.6, @vitejs/plugin-react 5.2.0, react 19.3.0, react-dom 19.3.0, tailwindcss 4.3.3, @tailwindcss/vite 4.3.3, lucide-react 1.49.0, typescript 7.0.2, @types/node 24.19.0, @types/react 19.3.0, @types/react-dom 19.3.0, @playwright/test 1.63.0. Run `npm install`, then `npm ci` to prove a clean install, then `node -e "require('electron')"` (Electron 44.5.1 has no install script; its binary downloads on first `require`, so no `allowScripts` entry is needed: Decision log), then `npx playwright install chromium`.
      Write `tsconfig.json` (ARCHITECTURE > Tech stack, incl. `types: [node, @prebuilt-tdlib/types, electron-vite/node]`), `electron.vite.config.ts` (main `electron/main.ts` → `out/main` with the `__LICENSES__` define; preload `electron/preload.ts` → `out/preload/preload.cjs`, format `cjs`; renderer root `web`, out `out/renderer`, plugins react + `@tailwindcss/vite` + the build-only CSP `transformIndexHtml` plugin with the CSP from ARCHITECTURE > Security), `playwright.config.ts` (`testDir: tests`, `launchOptions.args: ['--allow-file-access-from-files']`).
      `.gitignore`: add `out/`, drop `.teleflow/`, replace `.kiro/` with `.kiro/*` + `!.kiro/steering/`. Copy `c:\Users\REBEL DUKER\Downloads\tele\.kiro\steering\ponytail.md` to `.kiro\steering\ponytail.md`.
      Minimal app so the gates run: `core/storage.ts` with `resolvePaths`, `pageKey`, and `log` (5 MB rotation to `main.old.log`; never logs secrets) per ARCHITECTURE > Runtime data and > IPC contract > Bridge; `electron/preload.ts` (`call`, `on`, `pathOf` exactly as Bridge); `electron/main.ts` (startup steps 1–2 and a window loading the renderer); `web/index.html`, `web/src/main.tsx`, `web/src/App.tsx`, `web/src/styles.css` (Tailwind import + UI.md color tokens), `web/src/pages/Login.tsx` with the API Keys step markup only (labelled API ID and API hash inputs, Continue, the my.telegram.org link). Replace `README.md` with a short accurate one (what TeleFlow is, `npm ci`, scripts, where data lives; finished in 6.1). Replace `.github/workflows/ci.yml` (it runs deleted files): `windows-latest`, Node 24, `npm ci`, `npm run typecheck`, `npm test`, `npm run build`.
      Tests in `tests/engine.test.ts`: every `resolvePaths` case (TELEFLOW_HOME wins, packaged → `%LOCALAPPDATA%\TeleFlow`, dev → `TeleFlow-dev`, home inside appDir throws) and the four `pageKey` cases from ARCHITECTURE > Testability.
      Files: package.json, package-lock.json, tsconfig.json, electron.vite.config.ts, playwright.config.ts, .gitignore, .kiro/steering/ponytail.md, README.md, .github/workflows/ci.yml, core/storage.ts, electron/main.ts, electron/preload.ts, web/index.html, web/src/main.tsx, web/src/App.tsx, web/src/styles.css, web/src/pages/Login.tsx, tests/engine.test.ts (plus the deletions).
      Verify: `npm ci` exits 0 and, after the first `require('electron')`, `node_modules\electron\dist\electron.exe` exists; `Select-String -Path package.json -Pattern '": "[\^~]'` prints nothing; Core gate; `git ls-files` lists no FileGram file.

- [x] 1.2 Load TDLib and wire the IPC bridge with the sender check.
      `core/db.ts`: `fail(status, message, extra?)` only (schema lands in 2.1). `core/telegram.ts`: `configure(tdjson, logFile)` once (`getTdjson().replace('app.asar', 'app.asar.unpacked')`, `verbosityLevel: 1`, TDLib log stream to `home\logs\tdlib.log`, 10 MB), `tdlibVersion()` via `tdl.execute({ _: 'getOption', name: 'version' })`, and the current `AuthState` (no client yet → `{ step: 'credentials', connection: 'offline' }`). `electron/ipc.ts` (imports no `electron`): `createMethods(ctx)` with `app.info` (all sources in ARCHITECTURE > Methods notes) and `auth.get`, the common validators, and `handleCall(methods, rendererKey, senderUrl, req)` doing Bridge steps 1–4 (403 logged at warn, own-property lookup → 404, validation → 400 naming the field, envelope, 500 logged with stack). `electron/main.ts`: startup steps 1–5 and 7 of ARCHITECTURE > Desktop integration (paths, `setPath`, AUMID, single-instance lock, privileged `teleflow` scheme), `rendererUrl`/`rendererKey`, `ipcMain.handle('call')` through `handleCall`, `webPreferences` and navigation/window-open/permission handlers from ARCHITECTURE > Security, `titleBarStyle: 'hidden'` + `titleBarOverlay` (`#060b18`, `text-2`, 40), and an info log line `TDLib <version>` at startup. `web/src/api.ts`: `call()` that unwraps the envelope and throws an `Error` with `status`. `App.tsx` gates on `auth.get` and shows Login for every non-ready step. Login keeps a 40 px drag strip that reserves `env(titlebar-area-width)`; its Continue button calls `auth.credentials` and shows the rejection inline (404 until 2.4 registers the method).
      Tests in `tests/engine.test.ts`: `handleCall` → 403 for a null sender, a sibling page, and an unparsable URL; 404 for an unknown method, `__proto__`, and `toString`; 400 for an unknown arg key; `{ ok: true, data }` for `app.info` with a fake ctx.
      Files: core/db.ts, core/telegram.ts, core/storage.ts, electron/ipc.ts, electron/main.ts, web/src/api.ts, web/src/App.tsx, web/src/pages/Login.tsx, tests/engine.test.ts.
      Verify: Core gate.

- [x] 1.3 Packaging spike: icon, installer hook, packaged smoke test.
      `assets/icon.svg` (blue paper-plane mark), `scripts/icon.ts` (Playwright Chromium renders 16/32/48/256 px; writes `assets/icon.png` and a PNG-compressed `assets/icon.ico`), run `npm run icon` and commit both outputs; `assets/installer.nsh` with the `customUnInstall` macro from ARCHITECTURE > Build. `tests/app.spec.ts` (`_electron`): launches `release\win-unpacked\TeleFlow.exe` through its lowercased absolute path with `TELEFLOW_HOME` = a temp folder; asserts the API Keys step is visible; `window.teleflow.call('app.info')` returns `{ ok: true }` with `tdlib === '1.8.66'` (proves the sender check passes for the packaged `file:` page with a lowercased drive letter); `home\logs\main.log` has the TDLib line and no "Not allowed"; `typeof window.teleflow.pathOf === 'function'` and `pathOf(new File(['x'], 'x.txt'))` does not throw; the Login drag strip's computed right padding from `env(titlebar-area-width)` is > 0; `electronApp.evaluate` resolves `session.defaultSession.getCacheSize()` and `clearCodeCaches({})`; a second launch with the same `TELEFLOW_HOME` exits, and the test asserts whether a launch with another `TELEFLOW_HOME` stays up (expected: yes, the lock is keyed by `userData`; the test asserts what the spike observes); deletes its temp homes.
      Record every spike result (asar TDLib load, sandboxed CJS preload, `npmRebuild: false` with no node-gyp run, `webUtils.getPathForFile`, `env(titlebar-area-width)`, `getCacheSize`/`clearCodeCaches`, the lock key, the icon) in ARCHITECTURE > Early-risk findings. If the lock is not keyed by `userData`, say so there and in PRODUCT (dev and installed runs cannot run side by side).
      Files: assets/icon.svg, assets/icon.png, assets/icon.ico, assets/installer.nsh, scripts/icon.ts, tests/app.spec.ts, docs/ARCHITECTURE.md.
      Verify: Core gate; Package gate (the `dist` log has no `node-gyp` or "rebuilding native dependencies" line, and `release\win-unpacked\resources\app.asar.unpacked\node_modules\tdl` exists); Data gate.

### Phase 2: Core engine, database, Telegram (`phase2-loop`, `docs/.phase2-review.json`)

- [ ] 2.1 SQLite schema and settings in `core/db.ts`.
      `openDb(file)`: WAL, `foreign_keys = ON`, schema v1 verbatim from ARCHITECTURE > SQLite schema when `user_version` is 0, then `user_version = 1`. Settings: defaults and per-key validation from ARCHITECTURE > Settings keys (`downloadRoot` is checked by `checkDownloadRoot` in 2.2; `startWithSystem` is not stored; `apiHash` is never returned); `getSettings(db)`; `setSettings(db, patch)` validates every key before writing any; unknown or non-editable keys → 400 naming the key.
      Tests: `:memory:` schema creation and reopen idempotence; accept/reject cases for every key's rule (incl. `folderTemplate` placeholders, `..`, drive letters, leading separator, invalid characters, empty); `apiHash` absent from `getSettings`.
      Files: core/db.ts, tests/engine.test.ts.
      Verify: Core gate.

- [ ] 2.2 Paths, library, and storage in `core/storage.ts`.
      `checkDownloadRoot(path, { sealed, guarded })` (ARCHITECTURE > Runtime data); library scan (recursive `readdir`, `stat` in batches of 64, dot-prefixed names and parents, `desktop.ini`, `Thumbs.db` skipped, LibType by extension, 60 s cache, background scan at startup); `libraryList` (q, type, chat, sort, page; joined to completed download history by `lower(path)`; `chats`; `stats.files/size/missing`); `libraryMissing` (latest completed row per message with `path IS NOT NULL` whose file is gone); the `library.*` path rule (inside the root after `realpath`, or equal to a recorded download path); `trash(paths, trashItem)` with the forget transaction (ARCHITECTURE > Methods notes > `library.trash`; queries live in `core/db.ts`); `dirSize`; `storageReport` (`fs.statfs`, library by type, cache tdlib/thumbs/tmp + injected `getCacheSize`, app data = db + wal + shm).
      Tests: every `checkDownloadRoot` case in ARCHITECTURE > Testability; the `library.*` path rule (inside root, recorded path after a root change, anything else 404); `missing` uses the latest row only; trash nulls `history.path` and deletes the completed job; scan skip rules and LibType mapping on a temp folder.
      Files: core/storage.ts, core/db.ts, tests/engine.test.ts.
      Verify: Core gate.

- [ ] 2.3 Telegram client, auth, chats, messages in `core/telegram.ts`.
      Implement ARCHITECTURE > Telegram > Client lifecycle (`start(creds)` with `tdlibParameters`, `auth.credentials` closes any client first, closed client → drop, delete `tdlib\db` and `tdlib\files`, start again; `API_ID_INVALID`/`API_ID_PUBLISHED_FLOOD` → credentials step with error and stored credentials deleted; `invoke()` 503 gate and TDLib error → `fail()` with `retryAfter`; close on quit, 5 s), the auth and connection mappings, `Me` (masked phone, `captionMax` from `getOption` + `updateOption`, `uploadMax` from `premium`), > Chat cache (update routing, Saved Messages via `createPrivateChat`, `loadChats` per list, membership, order, kind, username, `canPost`, media permissions, folders), > Link resolution (`openChat(link, join)`, `isTelegramLink`), `messages(chatId, limit)` paging `getChatHistory` by 100 until `limit`, > Media extraction (`extractMedia`), `thumbFile(remoteId)` for `teleflow://thumb` (size check ≤ 2 MB before `downloadFile` priority 32), `logout()` (15 s timeout → local delete, `local: true`), and `onUpdate(fn)` for the engine. Exports pure helpers for tests.
      Tests: auth mapping for every state incl. the 5 unsupported ones; connection mapping; `parseFloodWait` (`FLOOD_WAIT_n`, `FLOOD_PREMIUM_WAIT_n`, `retry after n`); TDLib error → status; `extractMedia` for the 7 content types (default names with `<n>` = `message_id / 2^20`, `file_name` wins, thumbnail formats, largest photo size); `isTelegramLink`; phone mask; chat kind/`canPost`/permissions; `Folder.name` mapping.
      Files: core/telegram.ts, tests/engine.test.ts.
      Verify: Core gate.

- [ ] 2.4 Main process, protocol, events, and the Phase 2 IPC methods.
      `electron/main.ts`: full startup order (ARCHITECTURE > Desktop integration steps 1–9; step 6 opens SQLite; the engine parts of 6 and 8 land in 3.7), window state (restore if it intersects a display, else 1440×900 centered and clamped; min 1024×640; `window` setting saved debounced 500 ms, no topic), icon via `import icon from '../assets/icon.png?asset'`, `teleflow://` handler (thumb, saved, image with the validation in ARCHITECTURE > `teleflow://` protocol), events (`auth`; `invalidate` coalesced every 500 ms, `chats` every 2 s), Start with Windows through the one `loginItem` object, quit (TDLib close ≤ 5 s, SQLite close). `electron/ipc.ts`: validators and handlers for `app.info`, `app.storage`, `app.pickFolder`, `app.openPath`, `auth.get`, `auth.credentials`, `auth.phone`, `auth.code`, `auth.password`, `auth.logout`, `chats.list`, `chats.open`, `chats.messages`, `search.global`, `library.list`, `library.missing`, `library.open`, `library.reveal`, `library.trash`, `settings.get`, `settings.set` (21 of 33; `settings.set` runs `checkDownloadRoot`, creates the folder, writes the login item, emits `settings` and, for a root change, `library` + `storage`). Native calls (`dialog`, `shell.openPath`, `showItemInFolder`, `trashItem`, `openExternal`, login item, session) reach `ipc.ts` only through `ctx`.
      Tests: validators of these 21 methods (each regex and range in ARCHITECTURE > Methods, unknown keys, per-method length limits); `search.global` returns `link: null` when TDLib rejects the link.
      Files: electron/main.ts, electron/ipc.ts, core/telegram.ts, core/storage.ts, tests/engine.test.ts.
      Verify: Core gate; Package gate (packaged smoke still reaches the API Keys step); Data gate; Hardcode gate.

### Phase 3: Transfer engine and engine tests (`phase3-loop`, `docs/.phase3-review.json`)

Split rule fixed in advance: when `core/transfers.ts` passes about 400 lines, the upload flow (`groupUploads`, `settleUpload`, send, routing, recovery) moves to `core/uploads.ts`; when `tests/engine.test.ts` passes about 400 lines, tests split into one file per module (`tests/<module>.test.ts`, `test` script `node --test tests/*.test.ts`). Either split updates ARCHITECTURE > Layout in the same commit.

- [ ] 3.1 Queue, media, history, and stats queries in `core/db.ts`.
      `enqueue(db, rows, { force })` (upsert verbatim from ARCHITECTURE > Invariants, `MAX(position) + 1` once per transaction, 500 rows per transaction, `skipped`); `jobsList` (ordering, `open`, escaped `LIKE`, chat username/photo through a lookup callback); `jobsAction` (every scope in Methods notes > `jobs.action`, ids through one `json_each` parameter, returns `changed` and the affected chat ids); `MediaItem.status`/`path` derivation; the `chats.media` filter query (buckets, `duration > 0`, sorts, `exts` over the whole chat index, pages); history inserts; stats (`completedToday` from local midnight, `totalFiles`, `stats.activity` buckets 24h/7d/30d, `stats.chats` top 5 with ties, `recent` 6).
      Tests: upsert (dedupe, `force` only for completed, open rows untouched, re-add after Clear Completed → skipped, increasing `position`, a retried row keeps its `position`); `jobsAction` with 1000 ids; up/down swap only among open jobs of the same kind; `jobsList` ordering; media filters and buckets; status derivation (trash → `none`); stats buckets with a fixed clock.
      Files: core/db.ts, tests/engine.test.ts.
      Verify: Core gate.

- [ ] 3.2 Engine core: `createEngine(deps)` in `core/transfers.ts`.
      Pure helpers `fileName`, `sanitize`, `folderFor`, `uniquePath(dir, name, reserved)`, `gate`, `stallDecision`, `isRetryable`, `retryDelay`; pump (`free` = limit minus jobs with live state; nothing starts unless `ready`; same-file wait); per-kind gate (600/1000 ms spacing, doubled per flood up to 5 s, eased 100 ms per start, `waitUntil`; a flood-waited job goes back to `queued` with `attempts − 1`); `requeueActiveDownloads()`; the 500 ms tick (stats emit rule, 1/s history sample that drains to 60 zeros, stalls, `retry_at` requeue, local-midnight `history` invalidation, `clearCompletedDays` cleanup once a minute); `LiveStats` with EMA speed; `stats` 100 ms after a status change. Deps: `db`, `invoke`, `onUpdate`, `isReady`, `chat(id)`, `emit`, `paths`, `settings`, clock.
      Tests: naming (untitled defaults, date prefix, reserved names, trailing dots, 180-char cap keeping the extension); `folderFor` confinement (no `..`, sanitized placeholders, result stays under the root); `uniquePath` with a reserved name; scheduler concurrency and priority (`maxDownloads` 2 starts the first two by `position`, a third waits, `up`/`down` changes which starts next, uploads limited separately); flood-wait hold (no start of that kind before `waitUntil`, the other kind unaffected, no attempt spent); spacing and backoff; stall decision (offline skip, third stall requeue, cap → "Download keeps stalling"); `isRetryable`, `retryDelay`; `requeueActiveDownloads` keeps positions.
      Files: core/transfers.ts, tests/engine.test.ts.
      Verify: Core gate.

- [ ] 3.3 Downloads end to end.
      ARCHITECTURE > Transfer engine > Download steps 1–6: `getMessage`, `getRemoteFile`, target and name, skip-existing through `complete(job, path)`, `downloadFile` with `updateFile` routing through `inFlight`, finalize (slot freed first, `finalizing`, `reserved`, `markOfTheWeb`, same-volume rename or the `.teleflow-<jobId>.part` copy on `EXDEV` via a `moveFile` helper in `core/storage.ts`, `deleteFile`, `complete()` transaction, thumbnail saved to `home\thumbs\<historyId>.jpg`, reservation released, invalidations); pause/cancel (`cancelDownloadFile`; the background cancel cleanup with the `inFlight` guard and its `ponytail:` note); `downloads.add` for `items`, `{ chatId, filters }`, and `{ link }` (album siblings).
      Tests (fake `invoke`, temp folders): happy path ends `completed` with a history row, the file under its final name, and a `Zone.Identifier` stream with `ZoneId=3`; skip-existing completes and stays `downloaded` after Clear Completed, so a re-add is skipped; `moveFile` with a `rename` that throws `EXDEV` leaves no part file and a complete destination, and a failed copy removes the part file; two finalizes of the same name pick different names; cancel of a paused download that transferred data calls `deleteFile`, a completed one does not.
      Files: core/transfers.ts, core/storage.ts, core/db.ts, tests/engine.test.ts.
      Verify: Core gate.

- [ ] 3.4 Uploads end to end.
      ARCHITECTURE > Transfer engine > Upload steps 1–6: `uploads.add` checks (absolute, exists, regular file, 1 byte to `uploadMax`, `canPost`, caption ≤ `captionMax`), `groupUploads` with photo/video permissions, temp names in `home\tmp\<jobId>\` when `keepNames` is off, the four nested content shapes, `sendMessage`/`sendMessageAlbum`, `files[i].pendingId` persisted at once, settle on succeeded/failed/deleted, `settleUpload`, flood → `queued` without spending an attempt, pause/cancel/quit, crash recovery (routing rebuilt before `start(creds)`; on `ready`, `getMessage` per pending id, and `active` uploads with no live state and no pending id settle at once), the live-state re-check before `sendMessage`, and the `ponytail:` note for an upload TDLib resumes after a crash (design review 5 NIT 2).
      Tests: `groupUploads` (albums of up to 10, runs by class, caption on the first file, photos/videos → documents when not allowed); upload kind detection; every `settleUpload` case in ARCHITECTURE > Testability (album of 3 with 1 failed, caption dropped, routing rebuilt after restart, `active` with no pending id → "Interrupted" or `completed`).
      Files: core/transfers.ts (or core/uploads.ts per the split rule), core/db.ts, tests/engine.test.ts.
      Verify: Core gate.

- [ ] 3.5 Media index scan and `chats.media`.
      ARCHITECTURE > Media index scan in `core/telegram.ts` (rows through `core/db.ts`): start decision, top-up and backfill by 100, `scans.total` from the 7 `getChatMessageCount` calls, `indexed` and `state`, flood sleep, stop on leaving `ready`, the `failed` set cleared when the connection enters `ready` (design review 5 NIT 1), the `current` set cleared when it leaves `ready`, live upkeep (`updateNewMessage`; `updateDeleteMessages` only when `is_permanent && !from_cache`), `media:` at most 1/s plus each state change. Wire `chats.media` in `electron/ipc.ts`.
      Tests: no new top-up once `newest_id` equals a text last message; no start for a chat in `failed`, and a new try after the connection enters `ready`; live upkeep bumps `newest_id` only for `current` chats; overlapping pages are harmless.
      Files: core/telegram.ts, core/db.ts, electron/ipc.ts, tests/engine.test.ts.
      Verify: Core gate.

- [ ] 3.6 Clearing and logout cleanup in `core/storage.ts`.
      ARCHITECTURE > Storage and maintenance: Clear cache (409 while active or finalizing; `optimizeStorage`; empty `thumbs\`; `tmp\` minus unfinished uploads; injected `clearCache` + `clearCodeCaches`; `done = 0` for queued/paused/failed downloads; `freed`), Clear app data (keeps `apiId`, `apiHash`, `window`; `VACUUM`; then Clear cache), Clear All Data (cancel all, optional download deletion that keeps the root folder, logout with local fallback, remove `tdlib\`, `thumbs\`, `tmp\`, delete every row, `VACUUM`, injected `clearStorageData`, login item off). Leaving `ready` runs `requeueActiveDownloads`, drops upload live state, and stops the scan.
      Tests (temp folders): Clear cache resets `done`; Clear app data keeps credentials; Clear All Data with `deleteDownloads` keeps the root folder.
      Files: core/storage.ts, core/db.ts, core/telegram.ts, tests/engine.test.ts.
      Verify: Core gate.

- [ ] 3.7 IPC methods, startup recovery, tray, and notifications.
      `electron/ipc.ts`: validators and handlers for `app.clearCache`, `app.clearData`, `app.clearAll`, `downloads.add`, `uploads.add`, `jobs.list`, `jobs.action`, `stats.live`, `stats.overview`, `stats.activity`, `stats.chats` (with `chats.media` from 3.5, this completes all 33). `electron/main.ts`: create the engine; startup step 6 (`requeueActiveDownloads`, routing rebuild) before step 8 (`start(creds)`); `stats` and `invalidate` from the engine; quit sequence (persist live progress, settle uploads back to `queued`, close TDLib, close SQLite); tray (icon, tooltip "TeleFlow — `<active>` active · `<speed>`", Show TeleFlow / Pause all / Resume all / Quit TeleFlow, double-click shows); close-to-tray; `--hidden` start when `closeToTray` is on; notifications batched per 3 s, click shows the window. Covers UI.md > Tray and notifications (all 5 rows).
      Tests: validators of these 11 methods (`downloads.add` three forms and 1–10000 items, `jobs.action` ids 1–1000 and `up`/`down` with exactly one id, `uploads.add` 1–500 paths, enums). Extend `tests/app.spec.ts`: turning Start with Windows on makes `reg query HKCU\Software\Microsoft\Windows\CurrentVersion\Run /v com.teleflow.app` succeed and the setting reads back on after a relaunch; a `finally` turns it off and the value is gone.
      Files: electron/ipc.ts, electron/main.ts, core/transfers.ts, tests/engine.test.ts, tests/app.spec.ts.
      Verify: Core gate; Package gate; Data gate; Hardcode gate. List every `ponytail:` comment added in Phase 3 in the Changelog entry.

### Phase 4: Web shell and login (`phase4-loop`, `docs/.phase4-review.json`)

Primitives enter `web/src/ui.tsx` with their first user (Phase 4: the shell and Login set; Phase 5: the rest), so nothing is built for later. Split rule fixed in advance: when `ui.tsx` passes about 400 lines, `TransferCard`, `JobActions`, `ChatPicker`, and `OpenChatDialog` move to `web/src/parts.tsx`, and when `tests/ui.spec.ts` passes about 400 lines, the stub and fixtures move to `tests/fixtures.ts`; either split updates UI.md / ARCHITECTURE > Layout in the same commit.

- [ ] 4.1 Design tokens and the renderer data layer.
      `web/src/styles.css`: Tailwind import, `@theme` tokens from UI.md > Design system (colors, radii, font stack Inter → Segoe UI Variable → system-ui, tabular numbers), glass panel, table, focus ring (2 px `primary` with offset), skeleton shimmer and transitions off under `prefers-reduced-motion`. `web/src/api.ts`: `call`, `on`, `useCall(method, args, topics)` (300 ms debounced refetch on its topics; `data` kept across refetches), `useLive()` (`auth` + `live` through `useSyncExternalStore`, first snapshot from `auth.get` and `stats.live`), `useRoute()`, `navigate()`; method names and results typed through `import type { Methods }`.
      Files: web/src/styles.css, web/src/api.ts.
      Verify: Core gate.

- [ ] 4.2 Shell: sidebar, top bar, global search, user menu.
      `web/src/ui.tsx` (first set): `fmtBytes`, `fmtSpeed`, `fmtEta`, `fmtAgo`, `fmtDuration`, `fmtCount`, `fmtDate`, `typeLabel`, `Button`, `IconButton`, `SearchInput`, `Avatar`, `Menu`, `Dialog`, `confirm()`/`<ConfirmHost/>`, `toast()`/`<Toaster/>`, `Empty`, `Skeleton`, `ErrorState`, `OpenChatDialog`. `web/src/App.tsx`: sidebar (logo, tagline, 6 nav items, Queue badge from `live.counts`, hidden at 0), 40 px top bar (drag region, controls `no-drag`, `env(titlebar-area-width)` reserved), global search (250 ms debounce, popover sections, ↑/↓/Enter/Escape, link actions), user menu, auth gate, routes from UI.md > Shell (`#/overview` default). Until Phase 5 builds a page, its route renders that page's title and subtitle only; 5.7 removes the fallback.
      Covers: UI.md > Shell > Control inventory (Sidebar item, Search input, Chat result, File result, Download media from this link, Open chat (link), User menu button, User menu > Settings, User menu > Log out) and Shell > Data bindings (Queue badge, User menu, Search results); Dialogs > `OpenChatDialog` and `confirm()`.
      Tests in `tests/ui.spec.ts`: the stub (`addInitScript` defines `window.teleflow`, records every `{ method, args }`, answers from fixtures, exposes an `emit(event)` helper) and fixtures; one test per Control inventory row asserting the call and args (Log out: confirm text, toast, Devices hint when `local`); search empty/loading/error states and keyboard; Escape closes a dialog and focus returns to its opener; screenshots of the shell at 1440×900 and 1280×720 into `test-results/screens/`.
      Files: web/src/ui.tsx, web/src/App.tsx, tests/ui.spec.ts.
      Verify: Core gate; UI gate.

- [ ] 4.3 Login.
      `web/src/pages/Login.tsx`: centered 420 px panel, step indicator, Starting ("Connecting to Telegram…"), Logging out ("Signing out…"), API Keys, Phone (`type="tel"`, `<auth.error>` above the input), Code (`autocomplete="one-time-code"`, `<auth.phone>`, `<auth.via>`), Password (hint hidden when empty); busy buttons; inline `role="alert"` errors from the rejected call or `<auth.error>`; Overview shows when the state becomes `ready`.
      Covers: UI.md > Login > Control inventory (Continue, Get them at my.telegram.org, Send code, Back, Sign in (Code), Use a different number, Sign in (Password)).
      Tests: one per row (calls and args), each step rendered from an `auth` event, a 400 from `auth.credentials` shown inline, screenshots of every Login step at both sizes.
      Files: web/src/pages/Login.tsx, web/src/ui.tsx, tests/ui.spec.ts.
      Verify: Core gate; UI gate.

- [ ] 4.4 Phase 4 close-out.
      Add `npx playwright install chromium` and `npm run test:ui` to `.github/workflows/ci.yml`.
      Files: .github/workflows/ci.yml.
      Verify: Core gate; UI gate; Package gate (the packaged Login still shows the API Keys step); Hardcode gate.

### Phase 5: The six pages (`phase5-loop`, `docs/.phase5-review.json`)

Every item: the page per its UI.md section (layout, copy, Control inventory, Data bindings with empty, loading, and error states), keyboard reachable (row actions revealed on focus, not only hover), one `ui.spec.ts` test per Control inventory row that asserts the method and args (or the navigation), tests for each Data bindings state, and screenshots at 1440×900 and 1280×720 into `test-results/screens/`. Verify for items 5.1–5.6: Core gate; UI gate; Hardcode gate.

- [ ] 5.1 Overview.
      Adds to `ui.tsx`: `Panel`, `IconTile`, `Stat`, `Pill`, `Progress`, `Select`, `JobActions`. Page-local `AreaChart` (gradient areas, gridlines, x labels per range, focusable, hover and arrow-key guide with tooltip).
      Covers: Connect Channel; Transfer Activity range; Chart hover / arrow keys; Channel Activity range (default 7 days); Channel Activity row; View All (Recent Activity); Current Jobs filter; Row pause/resume; Row "…" > Open chat; Row "…" > Cancel; View queue. Data bindings: Active Transfers, Completed Today, Total Files, Failed Jobs, Transfer Activity, Channel Activity rows, Recent Activity rows, Current Jobs rows.
      Files: web/src/pages/Overview.tsx, web/src/ui.tsx, web/src/App.tsx, tests/ui.spec.ts.

- [ ] 5.2 Downloads.
      Adds to `ui.tsx`: `Chip`, `Segmented`, `Pagination`, `Thumb`, `TypeChip`, `SelectionBar`, `TransferCard`, `ChatPicker`. Page-local `FilesView` (index bar, filters, table, selection bar, pagination) and `ChatView` (timeline, media cards, Load older up to 1000, "Older media are in Files View"); right column Download Overview tiles and Transfer Queue cards (first 5 open downloads, flood-wait detail line).
      Covers: "+" (Chats panel); Chat search; Chips All / Channels / Groups / Folders; Folder row / back; Chat row; Chat View / Files View; File search; Media Type; File Type; Duration; Size; Status; Sort By; Reset; Header checkbox / row checkbox; Download selected; Download all `<media.total>` matching; Selection bar Clear; Pagination; Chat View: Download; Chat View: Show in folder; Load older messages; Older media are in Files View; Transfer Queue card actions; View all. Data bindings: Chat rows, Folder list, Files panel (no chat), Index bar, File rows (incl. the scanning-with-no-rows state), Pagination text, Messages, Speed, Active, Remaining, Total Files tiles, Transfer Queue cards.
      Files: web/src/pages/Downloads.tsx, web/src/ui.tsx, web/src/App.tsx, tests/ui.spec.ts.

- [ ] 5.3 Uploads.
      Adds `Toggle` to `ui.tsx`. Destinations (`ChatPicker` over `canPost` chats with chips All, Channels, Groups, Saved; default `<settings.defaultUploadChat>`), dropzone with `<input type="file" multiple>` and drag and drop (folders ignored with a toast), files table (object-URL thumbnails for images, revoked on removal; over-limit files flagged and the button blocked), caption with counter and `maxlength`, per-batch toggles from settings, `uploads.add` with `window.teleflow.pathOf(file)` paths, Upload Overview tiles and Upload Queue cards (pause tooltip "Upload restarts when resumed").
      Covers: Destination search / chips / row; Dropzone click / Enter / Browse; Drop files; Remove ×; Caption; Upload as album / Keep original file names; Upload `<n>` files to `<chat.title>`; Upload Queue card actions; View all. Data bindings: Destination rows, Selected files, Speed / Active / Remaining, Uploaded Today, Upload Queue cards.
      Files: web/src/pages/Uploads.tsx, web/src/ui.tsx, web/src/App.tsx, tests/ui.spec.ts.

- [ ] 5.4 Queue.
      Tabs with badges, status chips with counts, search, table with rank, progress, and ETA states (incl. "Retrying in `<retryAt>`" and "Failed: `<job.error>`"), selection bar, pagination with range text; right column Queue Overview tiles (per-tab counting rules), Live Activity with the page-local `Sparkline` and the flood-wait caption, Queue Actions with the Clear All confirm.
      Covers: Tabs Downloads / Uploads / Completed / Failed; Search; Status chips; Header / row checkbox; Row Pause / Resume; Row Move up / Move down; Row Retry (failed); Row Cancel / Remove; Row Show in folder (completed download); Selection bar Pause / Resume / Retry / Remove; Pagination; Pause All; Resume All; Clear Completed; Clear All. Data bindings: Tab badges and chip counts, Rows (per-tab empty texts), Queue Overview tiles, Sparkline and speed, Flood-wait caption.
      Files: web/src/pages/Queue.tsx, web/src/ui.tsx, web/src/App.tsx, tests/ui.spec.ts.

- [ ] 5.5 Media Library.
      Stats strip with Verify, toolbar (search, type chips, chat select from `<library.chats>`, sort, grid/list saved in `localStorage`), grid cards with 16:9 previews and focus-revealed actions, list table, multi-select with the Recycle Bin confirm (count and size), page-local `VerifyDialog`.
      Covers: Open folder; Verify; VerifyDialog checkboxes / Select all / Re-download selected; Search, type chips, chat select, sort; Grid / List; Card or row checkbox; Open; Show in folder; Delete / bulk Move to Recycle Bin; Pagination. Data bindings: Stats strip, Cards / rows, Chat select options, Verify list. Dialogs: `VerifyDialog`.
      Files: web/src/pages/Library.tsx, web/src/ui.tsx, web/src/App.tsx, tests/ui.spec.ts.

- [ ] 5.6 Settings.
      Category nav (scrolls to the section, `section` in the URL, IntersectionObserver highlight), the ten section cards with only the rows in UI.md > Settings, saves on change with a "Saved" toast and inline 400 errors that revert the control, page-local `Stepper` and `LicensesDialog`, right column App Status, Storage (drive bar, library breakdown, App cache with Clear cache), Danger Zone (typed DELETE / DISCONNECT); Clear cache and Clear app data disabled from live counts with the hint "Pause active transfers first"; Clear All Data returns to Login.
      Covers: Category nav item; Start with Windows; Minimize to tray on close; Download folder > Change; Download folder > Open; Max concurrent downloads − / +; Skip existing files / Prefix with date; Folder template; Default destination; Upload as album / Keep original file names; Max concurrent uploads − / +; Log out (Telegram); Show archived chats; Auto-retry failed transfers; Retry attempts − / +; Stall timeout; Clear completed after; App data folder > Open / Logs > Open; Notify when transfers complete / Notify on failures; Clear cache (Privacy, Storage card); Clear app data; Source code; Open-source licenses; Clear All Data; Disconnect Telegram. Data bindings: every control value, Account row, Default destination options, App Status, Storage card, Clear cache / app data sizes, About. Dialogs: `LicensesDialog`.
      Files: web/src/pages/Settings.tsx, web/src/ui.tsx, web/src/App.tsx, tests/ui.spec.ts.

- [ ] 5.7 Phase 5 close-out.
      Remove the title-only route fallback from `App.tsx`; check every Control inventory row in UI.md (Shell, Overview, Downloads, Queue, Uploads, Media Library, Settings, Login, Dialogs) has a named test in `ui.spec.ts` and list any gap as a failure; accessibility pass (icon-only buttons have `aria-label`, progress bars have `role="progressbar"` + `aria-valuenow`, pills carry text, toasts use `role="status"`/`role="alert"`, the full tab order reaches table checkboxes, row actions, menus, the chart, and dialogs).
      Files: web/src/App.tsx, tests/ui.spec.ts (and fixes in the page files they find).
      Verify: Core gate; UI gate; Package gate; Data gate; Hardcode gate.

### Phase 6: Ship and final verification (`final-gate`)

- [ ] 6.1 README and CI.
      Rewrite `README.md`: what TeleFlow does, install from `TeleFlow-Setup-<version>.exe` (unsigned, so SmartScreen asks once), data locations (`%LOCALAPPDATA%\TeleFlow`, `%USERPROFILE%\Downloads\TeleFlow`, `TELEFLOW_HOME`), clearing options, development (`npm ci`, `dev`, `build`, `dist`, `test`, `test:ui`, `test:app`, `icon`), links to the docs. Confirm `.github/workflows/ci.yml` runs `npm ci`, typecheck, test, build, and test:ui on `windows-latest`.
      Files: README.md, .github/workflows/ci.yml.
      Verify: every command the README lists runs as written.

- [ ] 6.2 Full clean verification.
      From a clean tree: `npm ci`; Core gate; UI gate; Package gate; Data gate; Hardcode gate. Every `ponytail:` comment in `electron/`, `core/`, `web/src/` appears in a Changelog deferral (and the reverse); no `TODO`/`FIXME`.
      Verify: all commands pass; record their output summary in the Changelog.

- [ ] 6.3 Installer check (per-user, reversible).
      Run `release\TeleFlow-Setup-1.0.0.exe /S /D=<lowercase path under %TEMP%>` (`/D=` goes last and unquoted; the profile path has a space); launch the installed `TeleFlow.exe` with `TELEFLOW_HOME` = a temp folder (point `tests/app.spec.ts` at it through an optional `TELEFLOW_EXE` env var) and confirm the API Keys step; turn Start with Windows on, run the uninstaller silently, then confirm `reg query HKCU\Software\Microsoft\Windows\CurrentVersion\Run /v com.teleflow.app` fails, the shortcuts are gone, and the temp home is still there; delete the temp folders.
      Files: tests/app.spec.ts (env override only).
      Verify: the commands above; results recorded in the Changelog.

- [ ] 6.4 Final review and hand-off.
      Walk PRODUCT.md (features 1–8, engine behavior, storage) and UI.md (every page) against the build and the screenshots; fix or record gaps. Write the Manual checks list below with today's status; tick "Ready for user review (branch not merged)"; mirror the docs.
      Files: docs/PROGRESS.md (and any doc a gap touches).
      Verify: `git status --short` is clean after the commit; `git log main..revamp/teleflow --oneline` shows the phase commits; `main` is unchanged.

- [ ] Ready for user review (branch not merged)

### Manual checks (user; need a Telegram account or a second drive)

Agents never use the user's session or credentials, so these stay open until the user runs them:
- [ ] Real login: API keys → phone → code → 2FA; avatars and thumbnails render (also confirms the `teleflow://thumb` remote id pattern).
- [ ] Download from a channel: filters, Download all matching, pause, resume, cancel; canceling a paused download frees its `tdlib\files` data.
- [ ] Download root on a second drive: no `.teleflow-*.part` left; `Get-Item <file> -Stream Zone.Identifier` shows `ZoneId=3`; opening a downloaded `.exe` from the Library triggers SmartScreen.
- [ ] Uploads: one file, an album, and a partly failed album (Retry posts only the rest).
- [ ] Tray during transfers, Minimize to tray on close, batched notifications, Start with Windows after a reboot (starts in the tray with `closeToTray` on).
- [ ] Upgrade install keeps Start with Windows; uninstall keeps app data; reinstall keeps the login.
- [ ] A large queue at concurrency 2 rides out a flood wait without failing jobs.

## Decision log

| Date | Decision | Why |
|------|----------|-----|
| 2026-10-01 | Keep Node + TDLib; rewrite everything else | TDLib already does resumable downloads; existing session survives |
| 2026-10-01 | React 19 + Vite + Tailwind v4 + lucide; hand-rolled SVG charts | Dense dashboard UI, minimal dependencies |
| 2026-10-01 | `node:sqlite` for jobs/history/settings | Built in, no new dependency |
| 2026-10-01 | ~~Edge `--app` window instead of Electron~~ superseded below | – |
| 2026-10-01 | Brand TeleFlow; unified sidebar nav | Mockups disagree; see UI.md |
| 2026-10-01 | Only honored settings are shown | No fake toggles |
| 2026-10-01 | Forwarding, bulk delete, ZIP export out of v1 | Not in mockups; can return on request (PRODUCT.md D1) |
| 2026-10-01 | User scope change: Analytics page removed; nav is 6 items | User request; Overview keeps Transfer Activity and Channel Activity |
| 2026-10-01 | User scope change: every visible control works with real data; UI.md has a Control inventory and Data bindings per page | User hard requirement; controls that cannot be real are removed |
| 2026-10-01 | User scope change: nothing written inside the repo or install folder; app data `%LOCALAPPDATA%\TeleFlow`, downloads `%USERPROFILE%\Downloads\TeleFlow`; `TELEFLOW_HOME` override; dev runs use `TeleFlow-dev` | User request; keeps source and data apart |
| 2026-10-01 | User scope change: Clear cache / Clear app data / Clear All Data / Disconnect Telegram with sizes, confirms, freed-size toasts | User request; semantics in PRODUCT.md > Storage |
| 2026-10-01 | User scope change: no hardcoded data; UI.md uses `<source.field>` placeholders; reviewers grep production code for mockup samples | User request |
| 2026-10-01 | User scope change: Electron 44.5.1 + electron-builder NSIS installer replaces Edge `--app`, Express, `ws`, launcher scripts | User wants a real installable exe; also removes the open port and its Host/Origin guards |
| 2026-10-01 | ~~FileGram import is user-initiated (folder picker on Login and in Settings), not automatic~~ superseded by user change #5 below | – |
| 2026-10-01 | Tray, minimize to tray on close, start with Windows are in v1 | Real with Electron (user scope change #4) |
| 2026-10-01 | Engine runs in the Electron main process, not a `utilityProcess` | TDLib does its I/O on its own thread; one IPC hop is simpler |
| 2026-10-01 | `node:sqlite` kept in Electron (verified in a spike), not `better-sqlite3` | No Electron-ABI rebuild; tests run in plain Node 24 |
| 2026-10-01 | electron-vite 5.0.0 + Vite 7.3.6 + `@vitejs/plugin-react` 5.2.0 (not Vite 8) | electron-vite 5 supports Vite ≤ 7 |
| 2026-10-01 | TypeScript 7.0.2 for `tsc --noEmit`; fall back to the latest 5.9.x only if TS 7 rejects an option we need | Current release; type checks only |
| 2026-10-01 | `core/` is Electron-free; Electron-only calls (`shell.trashItem`, dialogs, login item) are passed in from `electron/` | Engine logic stays testable under `node:test` |
| 2026-10-01 | Renderer IPC types inferred from `electron/ipc.ts` with a type-only import | No hand-written contract file to drift |
| 2026-10-01 | One `stats` event (500 ms while busy) carries speeds, counts, and active job progress; plus `auth` and `invalidate` | Replaces per-job `job` events; at most 8 active jobs |
| 2026-10-01 | Job states: queued, active, paused, completed, failed; cancel deletes the row | No view ever shows canceled jobs |
| 2026-10-01 | Separate `jobs` and `history` tables | Clear Completed must not erase Overview stats or Library metadata |
| 2026-10-01 | Per-chat media index (`media`, `scans`) built in the background | Files View filters on extension, duration, size, and status need it; TDLib cannot filter those |
| 2026-10-01 | Uploads send from the original file path (`webUtils.getPathForFile`); temp copies only when "Keep original file names" is off | No staging copy of multi-GB files |
| 2026-10-01 | Library delete moves files to the Recycle Bin; "Remove from library" dropped | The Library is the disk, so hiding a file would need a second source of truth |
| 2026-10-01 | Pausing an active upload restarts that upload on resume (UI says so) | TDLib cannot pause an in-flight `sendMessage` |
| 2026-10-01 | Log out from the user menu, Settings > Telegram, and Disconnect Telegram all call `auth.logout` | Same behavior everywhere; Disconnect adds a typed confirm |
| 2026-10-01 | Settings dropped: Language, Appearance, Hide chats without media, Verify files on startup, Library root, Clear thumbnail cache, Clear history; Auto-retry moved to Queue | Not honored, not cheap, or covered by another row |
| 2026-10-01 | Links parsed by TDLib `getInternalLinkType` | No hand-written link parser |
| 2026-10-01 | Chat list served from a cache filled by TDLib updates | Standard TDLib pattern; no `getChat` per chat |
| 2026-10-01 | TDLib 1.8.66 nested `inputPhoto/inputVideo/inputAudio/inputDocument` built directly | FileGram's compat shim is not ported |
| 2026-10-01 | `titleBarStyle: 'hidden'` + `titleBarOverlay` | Native window buttons on the dark top bar |
| 2026-10-01 | No bundled font; Inter only when installed, else Segoe UI Variable | No font dependency |
| 2026-10-01 | Icons in `assets/` (`build/` is gitignored); `scripts/icon.ts` renders them once | electron-builder `buildResources: assets` |
| 2026-10-01 | D4 (default port) is obsolete; D1–D3 keep their defaults | Electron uses IPC, no port |
| 2026-10-01 | The design-step brief still lists Express 5 + `ws` + Edge `--app`; ARCHITECTURE's Electron stack stands, and the brief's "REST routes" / "WebSocket events" are the IPC methods / events | The brief predates the Electron user scope change above |
| 2026-10-01 | `chats.messages` takes `limit` (1–1000) instead of a cursor; "Load older" raises it | One contiguous refetch after invalidations; per-cursor refetch drops messages at page boundaries (review 1 #10, fixed differently) |
| 2026-10-01 | Interrupted downloads are requeued at startup and when auth leaves `ready` (`requeueActiveDownloads`) | Rows left `active` had no live state and never resumed (review 1 #2) |
| 2026-10-01 | One stall rule: online only; third stall requeues as an attempt; fails "Download keeps stalling" once attempts are spent | Old rules conflicted and could loop forever (review 1 #12) |
| 2026-10-01 | Download root may not be the profile, a known folder itself, or an ancestor of one | Clear All Data with "delete downloads" deletes everything under the root (review 1 #15) |
| 2026-10-01 | Trash forgets the download (`history.path = NULL`, completed job deleted); upsert never touches open rows; non-forced adds skip downloaded items | Status, Verify, and dedupe stayed consistent only while job rows existed (review 1 #5, #6) |
| 2026-10-01 | Stats count completed history rows (files): today since local midnight, hour/day buckets, top 5 chats | KPIs and charts had no definition (review 1 #8) |
| 2026-10-01 | Media index progress counts media: 7 per-filter `getChatMessageCount` calls, "about" in the UI | TDLib rejects `searchMessagesFilterEmpty` there (review 1 #1) |
| 2026-10-01 | `chats.list` = main list (+ archive), Saved Messages via `createPrivateChat`, chats opened this session | Cache holds chats seen via forwards/search; uploads need Saved Messages (review 1 #11) |
| 2026-10-01 | TDLib auth states TeleFlow cannot complete (email, sign-up, Premium, other device) map to the phone step with an error | Login got stuck with no screen (review 1 #17) |
| 2026-10-01 | Group uploads send photos/videos as documents when the group forbids them (`updateChatPermissions`) | `canPost` only checked documents (review 1 #29) |
| 2026-10-01 | Licenses list built at build time (`__LICENSES__` define); `installedAt` from the install folder's birth time | Bundled renderer deps have no `package.json` at runtime (review 1 #9) |
| 2026-10-01 | `Stepper` ~~and `FileGramImportDialog`~~ (removed by user change #5) lives in `pages/Settings.tsx` | Single-page component rule; keeps `ui.tsx` under 400 lines (review 1 #18, #19) |
| 2026-10-01 | Download root rule split into `sealed` (home, appDir, AppData, Windows, Program Files, ProgramData: not equal, inside, or containing) and `guarded` (profile, known folders: not equal or containing) | An ancestor of AppData or Program Files passed and Clear All Data could delete it (review 2 #1) |
| 2026-10-01 | Start with Windows reads and writes through one `loginItem` object; read `executableWillLaunchAtLogin` | `getLoginItemSettings` only matches the same `args`, so the toggle read back off (review 2 #2) |
| 2026-10-01 | Uploads record `messageId` per file; a partly failed album keeps only unsent files (`settleUpload`) | Retry re-posted files that were already sent (review 2 #4) |
| 2026-10-01 | ~~FileGram folders need a marker (`.td_database`, `.filegram_state`, or `package.json` name `filegram`)~~ superseded by user change #5 below | – |
| 2026-10-01 | `uniquePath` honors an in-memory `reserved` set; failed cross-volume copies remove the partial file | Concurrent finalizes could pick the same name, and `fs.rename` replaces on Windows (review 2 #6) |
| 2026-10-01 | Downloads get Mark-of-the-Web (`Zone.Identifier`, ZoneId=3) | Library Open would run executables and macros without SmartScreen or Protected View (review 2 #7) |
| 2026-10-01 | Startup order written down (paths → AUMID → lock → scheme → DB + requeue + pending ids → ready → TDLib → Library scan) | Correctness depends on it (review 2 #10, #24, #25) |
| 2026-10-01 | Thumbnails only for Jpeg/Png/Webp/Gif; dropped `jobs.started_at`, `scans.updated_at`, `stats.chats[].username` | `<img>` cannot render Mpeg4/Webm/Tgs; unused fields (review 2 #12, #14) |
| 2026-10-01 | Top bar 40px with the title bar overlay in the top bar color `#060b18` | Overlay matched the sidebar instead of the bar it sits on (review 2 #17) |
| 2026-10-01 | The design brief again lists Express + `ws`, Edge `--app`, and an Analytics page; the Electron/IPC design and the removal of Analytics stand | Both are user scope changes recorded above; the brief predates them |
| 2026-10-01 | IPC sender check compares full page URLs (hash and query stripped) against the URL the window loads; 403 otherwise | `file:` origins are `"null"`, so the origin + pathname check never matched the packaged page, and an origin check would accept any local page (review 3 #1) |
| 2026-10-01 | Canceling a non-live download that transferred data (`attempts > 0 OR done > 0`) deletes its TDLib partial data in the background while `ready` | Cancel of paused/queued/failed downloads left gigabytes in `tdlib\files`, contradicting Clear All's confirm (review 3 #2) |
| 2026-10-01 | `jobs.pending` dropped; the temporary id lives on each file entry (`files[i].pendingId`) | Ids alone could not restore the file index after a partial send and a crash, so files were re-posted or wrongly marked sent (review 3 #3) |
| 2026-10-01 | Cross-volume finalize copies to `.teleflow-<jobId>.part`, then renames; Mark-of-the-Web written before the final rename; nothing after the final rename fails the job | A quit or crash mid-copy left a truncated file under the final name (review 3 #4) |
| 2026-10-01 | Skip-existing completes through the same `complete(job, path)` as finalize (writes history) | Without history, Clear Completed turned those items back to "Not downloaded" and broke dedupe (review 3 #5) |
| 2026-10-01 | `scans.newest_id`/`oldest_id` count messages walked; live upkeep bumps `newest_id` only for chats topped up since the connection was last `ready` | The media-id reading restarted a scan on every refetch in chats ending with text; the `current` rule keeps gaps after outages from being skipped (review 3 #6) |
| 2026-10-01 | Queue order = first-enqueue order: `MAX(position) + 1` per transaction, retries keep their place | One INSERT cannot read its own id; a per-row MAX scans the table (review 3 #20) |
| 2026-10-01 | Dropped unused shape fields `Chat.archived`, `Message.outgoing`, `Job.fileCount`, `Job.attempts`, `Job.createdAt` | Nothing in UI.md binds them (review 3 #21) |
| 2026-10-01 | `library.*` also accepts recorded download paths outside the current root | Show in folder and Open broke for downloads made before a root change (review 3 #12) |
| 2026-10-01 | `npmRebuild: false`; NSIS `customUnInstall` removes the Start with Windows Run value unless `isUpdated`; Clear All Data turns the login item off | No node-gyp toolchain needed for `tdl`; no dead startup entry after uninstall or Clear All Data (review 3 #11, #17) |
| 2026-10-01 | IPC sender check compares `pageKey()`s: `file:` pages as decoded, lowercased paths, dev URLs as lowercased `href`s, hash and query stripped; parse errors → 403; `test:app` launches the exe through its lowercased path | Node and Chromium canonicalize file URLs differently (Chromium uppercases the drive letter), so a lowercase install path made every call 403 (review 4 #1) |
| 2026-10-01 | On `ready`, an `active` upload with no live state and no pending id settles at once: all sent → completed, else failed "Interrupted" (not retryable); a start re-checks its live state before `sendMessage` | A crash during the temp copy, before `files` was persisted, or before the job update left the row "Uploading" forever (review 4 #2) |
| 2026-10-01 | A media scan page error (not a flood wait) puts the chat in an in-memory `failed` set until the next reconnect; no scan starts for it | The finish invalidation restarted a failing scan on every refetch (review 4 #3) |
| 2026-10-01 | Cancel's TDLib cleanup skips completed downloads | Their TDLib copy is already gone; Clear All over a long history made thousands of useless calls (review 4 #4) |
| 2026-10-01 | `failed` scan set is cleared when the connection enters `ready`; `current` when it leaves | A chat that failed during an outage would otherwise wait for the next outage (review 5 #1) |
| 2026-10-01 | An upload TDLib resumes after a crash gets no live state (`ponytail:` note) | Throughput and a frozen bar only, no duplicate posts, needs a crash mid-upload (review 5 #2) |
| 2026-10-01 | Plan: Phases 1–5 run in the workflow's existing phase loops (verdict `docs/.phaseN-review.json`), Phase 6 is the `final-gate` step; the workflow tail is not restructured into FEATs | The phases are strictly sequential and each already has an implement-and-review loop |
| 2026-10-01 | Tray, close to tray, `--hidden`, notifications, and quit move from Phase 6 to 3.7; window state and Start with Windows to 2.4 | They are code that needs a phase review; Phase 6 is verification only |
| 2026-10-01 | `electron/ipc.ts` imports no `electron`: `createMethods(ctx)` + `handleCall()`; renderer types from `Methods = ReturnType<typeof createMethods>` | Plain Node cannot import named exports from the `electron` package, and IPC validation and the sender check must run under `node:test` |
| 2026-10-01 | `core/transfers.ts` exports `createEngine(deps)` plus pure helpers; `core/telegram.ts` stays a module singleton | Tests need a fresh engine on `:memory:` SQLite with a fake `invoke`; TDLib allows one client per process |
| 2026-10-01 | tsconfig `types: [node, @prebuilt-tdlib/types, electron-vite/node]`; icon loaded with `?asset` | `tdl`'s `index.d.ts` imports `tdlib-types`, declared by `@prebuilt-tdlib/types` (optional dependency of `prebuilt-tdlib`); `files: out/**` would not package `assets/icon.png` otherwise |
| 2026-10-01 | Version `1.0.0`; `author` and `repository` from the git remote (`Webovignesh/tele`) | electron-builder needs `author` for the NSIS publisher; `app.info` reads `repository` |
| 2026-10-01 | Old CI replaced in Phase 1 (typecheck, test, build), test:ui added in 4.4 | The old workflow runs files Phase 1 deletes |
| 2026-10-01 | Primitives enter `ui.tsx` with their first user; split targets fixed in advance (`core/uploads.ts`, `tests/<module>.test.ts`, `web/src/parts.tsx`, `tests/fixtures.ts`) at about 400 lines | No scaffolding for later; implementers never choose a split under time pressure |
| 2026-10-01 | ~~FileGram import is tested on synthetic FileGram folders~~ (superseded by user change #5); every live Telegram flow is a user manual check | Agents never use the user's session or credentials |
| 2026-10-01 | User wiped FileGram data; FileGram import removed (user change #5): no `fileGram.*` methods (33 IPC methods, not 37), no `fileGramDir` setting, no Import or Leftover controls on Login or Settings, no import tests or manual check; `checkDownloadRoot` has one writer (`settings.set`). TeleFlow starts fresh: API ID/hash, then phone and code on first run | The user stopped FileGram and deleted its code and data from the main workspace, so there is nothing to import (Ponytail YAGNI) |
| 2026-10-01 | No `allowScripts` entry: Electron 44.5.1 has no install script and downloads its binary on the first `require('electron')`; npm 12 keeps blocking the scripts of `tdl`, `esbuild`, and `electron-winstaller`, none of which is needed | Verified in Phase 1: `node_modules/electron/package.json` has no `scripts`; build, dist, and the packaged app work with all four blocked (plan 1.1 assumed `npm approve-scripts electron`) |
| 2026-10-01 | tsconfig adds `vite/client` to `types` and `skipLibCheck` | TS 7.0.2 checks side-effect imports (`import './styles.css'`), and electron-vite 5.0.0's `index.d.ts` imports the optional `@swc/core` types |
| 2026-10-01 | A startup failure (home inside `appDir`, TDLib not loading) shows a native error box and exits 1 | The app cannot work without either; a silent exit would leave the user guessing (ARCHITECTURE > Desktop integration) |
| 2026-10-01 | Until 4.1, `web/src/api.ts` exports an untyped `call<T>(method, args)`; 4.1 types it through `Methods` | `auth.credentials` is called by Login before 2.4 registers it, so a `Methods`-typed call would not compile yet |
| 2026-10-01 | Phase 1 items 1.1–1.3 landed in one commit (plan rule: one per item) | 1.1's minimal `main.ts` already needed 1.2's bridge and TDLib load to show a working Login, and the 1.3 spike findings rewrite the same doc sections; one commit keeps code and docs together |

## Changelog

### 2026-10-01 · Phase 1 · Scaffold, cleanup, packaging spike (items 1.1–1.3)
- FileGram removed from the worktree with `git rm -r` (105 paths: `server.js`, `server/`, `public/`, `scripts/`, `tests/`, `BULK_UPLOAD_TESTING.md`, the three `.cmd` files, `FileGram.vbs`, `playwright.config.js`, the old `package-lock.json`). The old code stays readable with `git show main:<path>`.
- New stack, pinned exactly in `package.json` (name `teleflow`, 1.0.0, `type: module`, author `Webovignesh`, repository from the git remote, scripts and the electron-builder `build` block from ARCHITECTURE > Build): `tdl` 8.1.0, `prebuilt-tdlib` 0.1008066.0; dev: electron 44.5.1, electron-builder 26.15.3, electron-vite 5.0.0, vite 7.3.6, @vitejs/plugin-react 5.2.0, react/react-dom 19.3.0, tailwindcss and @tailwindcss/vite 4.3.3, lucide-react 1.49.0, typescript 7.0.2, @types/node 24.19.0, @types/react and @types/react-dom 19.3.0, @playwright/test 1.63.0.
- Code (all new): `core/storage.ts` (`resolvePaths`, `pageKey`, `openLog`/`log` with 5 MB rotation and a 32-hex mask), `core/db.ts` (`fail` only), `core/telegram.ts` (`configure(tdjson, logFile)`, `tdlibVersion`, `authState` = `credentials`/`offline`, `AuthState`/`Me` types), `electron/ipc.ts` (common validators `id`/`page`/`pageSize`/`q`/`oneOf`/`text` + `shape`, `repoUrl`, `createMethods` with `app.info` and `auth.get`, `handleCall` for Bridge steps 1–4), `electron/preload.ts` (`call`, `on`, `pathOf`), `electron/main.ts` (startup steps 1–5 and 7, TDLib load and `TDLib <version>` log line, `rendererUrl`/`rendererKey`, `ipcMain.handle('call')`, Security handlers, `titleBarOverlay`, error box on startup failure), `web/index.html`, `web/src/{main.tsx,App.tsx,api.ts,styles.css,pages/Login.tsx}` (auth gate; API Keys step with labelled inputs, Continue that shows the rejection inline, the my.telegram.org link, a 40 px drag strip), `assets/{icon.svg,icon.png,icon.ico,installer.nsh}`, `scripts/icon.ts`, `tests/engine.test.ts` (12 tests), `tests/app.spec.ts` (packaged smoke), `tsconfig.json`, `electron.vite.config.ts` (`__LICENSES__` define, CJS preload, build-only CSP plugin), `playwright.config.ts`, `.gitignore` (`out/`, `.kiro/*` + `!.kiro/steering/`, `.teleflow/` dropped), `.kiro/steering/ponytail.md`, `README.md`, `.github/workflows/ci.yml` (windows-latest, Node 24, `npm ci`, typecheck, test, build).
- User change #5 applied to the docs: FileGram import removed (PRODUCT Setup/Storage/Out of scope/D2; UI.md Login, Settings rows and data needs, Dialogs, placeholder table, page-local list; ARCHITECTURE methods, shapes, settings key, topics, Storage and maintenance, Security, Layout, Testability; PROGRESS items 3.6, 3.7, 4.3, 5.6, 6.1, manual checks, Rules, Decision log). 33 IPC methods remain.
- Other doc fixes so code and docs agree: ARCHITECTURE Early-risk findings filled from the spike; tsconfig `types` + `skipLibCheck`; `resolvePaths({ env, packaged, appDir })` and `openLog`/`log`; startup-failure behavior; lock keyed by `userData`; packaged smoke description; Layout no longer lists `allowScripts`. PRODUCT Storage: dev and installed runs can run side by side. UI.md Login: the drag strip.
- Commands run, in order, with results (worktree, Windows, Node 24.19.0, npm 12.0.2):
  - `npm install --save-exact` → 377 packages, 0 vulnerabilities; npm warns that the install scripts of `tdl@8.1.0`, `esbuild@0.25.12`, `esbuild@0.28.2`, `electron-winstaller@5.4.0` are blocked (none needed; Electron is not in the list because it has no install script).
  - `npm ci` → exit 0, 377 packages.
  - `node -e "console.log(require('electron'))"` → "Downloading Electron binary...", then `node_modules\electron\dist\electron.exe` (`Test-Path` True).
  - `npx playwright install chromium` → exit 0.
  - `Select-String -Path package.json -Pattern '": "[\^~]'` → no output.
  - `npm run typecheck` → first run exit 1 (`TS2307 '@swc/core'` in `electron-vite/dist/index.d.ts`; `TS2882` side-effect import `./styles.css`); after adding `skipLibCheck` and `vite/client` → exit 0.
  - `npm test` → 12 tests, 12 pass, 0 fail (resolvePaths ×3, pageKey ×2, handleCall ×5, validators, repoUrl).
  - `npm run build` → exit 0: `out/main/index.js` 7.57 kB (ESM), `out/preload/preload.cjs` 0.47 kB (CJS), `out/renderer/index.html` 0.57 kB with the CSP meta, CSS 9.91 kB, JS 652.92 kB.
  - Unpackaged smoke: `node_modules\electron\dist\electron.exe .` with `TELEFLOW_HOME=%TEMP%\teleflow-smoke-<n>` → still running after 8 s; `main.log`: `info TeleFlow 1.0.0 starting; TDLib 1.8.66; home …`; the home held `chromium\`, `logs\main.log`, `logs\tdlib.log`, `lockfile`; deleted afterwards.
  - Dev smoke: `npm run dev` with a temp `TELEFLOW_HOME` → dev server at `http://localhost:5173/`, Electron started, `main.log` has the TDLib 1.8.66 line and no "Not allowed"; process tree killed, temp home deleted.
  - `npm run icon` → `assets/icon.ico` (16, 32, 48, 256 px; 25 916 bytes), `assets/icon.png` (256 px; 22 249 bytes).
  - `npm run dist` → exit 0; electron-builder 26.15.3 logs `skipped dependencies rebuild reason=npmRebuild is set to false`; `Select-String 'node-gyp|rebuilding native'` on the log → 0 lines; outputs `release\TeleFlow-Setup-1.0.0.exe` (119 639 663 bytes, `Get-AuthenticodeSignature` = NotSigned, as designed), `release\win-unpacked\TeleFlow.exe`, `release\win-unpacked\resources\app.asar.unpacked\node_modules\tdl` (plus `prebuilt-tdlib`, `@prebuilt-tdlib/win32-x64\tdjson.dll`, `@prebuilt-tdlib/types`).
  - `npm run test:app` → 1 passed: API Keys step visible; `app.info` `{ ok: true, tdlib: '1.8.66', home: <temp>, repository: 'https://github.com/Webovignesh/tele' }` through the lowercased exe path; Continue → inline "Unknown method" (404 until 2.4); `pathOf(new File(['x'], 'x.txt'))` → `''`; drag strip `padding-right` > 0; `getCacheSize()` and `clearCodeCaches({})` resolve; second launch with the same home exits 0; a launch with another home stays up; `main.log` has `TDLib 1.8.66` and no "Not allowed"; `tdlib.log` exists; temp homes deleted.
  - `[System.Drawing.Icon]::ExtractAssociatedIcon` on `TeleFlow.exe` and `TeleFlow-Setup-1.0.0.exe` → the paper-plane mark (temp PNGs deleted).
  - Data gate: `git status --short --ignored` → ignored only `node_modules/`, `out/`, `release/`, `test-results/`; no `*.db`, `tdlib`, `logs`, `thumbs`, `tmp`, or `downloads` path; no `%TEMP%\teleflow-*` left.
  - Hardcode gate → no output.
  - Final rerun on the tree being committed: typecheck 0, test 12/12, build 0 (all three outputs), dist 0 (0 node-gyp lines), test:app 1 passed.
- `ponytail:` comments added in Phase 1: none.
- Not verified: the `?asset` import (first used in 2.4); `webUtils.getPathForFile` on a real picked file (5.3); running the NSIS installer and the Run value name (6.3). Verified now that the planning entry listed as open: `types: [@prebuilt-tdlib/types]` resolves under TS 7.0.2 (`tdl.execute({ _: 'getOption' })` type-checks).
- Next: Phase 2, item 2.1 (SQLite schema and settings in `core/db.ts`).

### 2026-10-01 · Phase 1 · Implementation plan
- Replaced the Phases checklist with the ordered Plan: rules, five gates, a reference map into the old FileGram code (`git show main:<path>`), and items 1.1–6.4 with files, UI.md Control inventory rows, and verification per item. Phases 1–5 map to the workflow's `phase1-loop` … `phase5-loop` (verdicts `docs/.phaseN-review.json`), Phase 6 to `final-gate`. The workflow tail was not restructured.
- Design review 5 (APPROVED, 3 NIT) applied in the docs: `failed` cleared when the connection enters `ready` (ARCHITECTURE > Media index scan); `ponytail:` note for an upload TDLib resumes after a crash (Upload step 6); review-4 response header and the status line name review 5. `docs/.design-review.md` and `.design-review.json` (review 5) are committed with this change.
- ARCHITECTURE.md: Layout and the renderer-types note describe `createMethods(ctx)`/`handleCall()` in an Electron-free `ipc.ts` and `createEngine(deps)` in `transfers.ts`; tsconfig `types` adds `@prebuilt-tdlib/types` and `electron-vite/node`.
- Decision log: 11 new rows (review 5 NITs, workflow mapping, desktop integration moved to Phases 2–3, IPC and engine wiring, typings and icon, version and author, CI timing, split targets, manual checks).
- Verified by reading: `node_modules/tdl/index.d.ts` imports `tdlib-types`; `@prebuilt-tdlib/types/tdlib-types.d.ts` declares it (TDLib 1.8.66); `prebuilt-tdlib` 0.1008066.0 lists it as an optional dependency; `tdl` loads its addon lazily (inside `configure`/init, not at import), so `node:test` can import `core/telegram.ts`; `npm approve-scripts` exists in npm 12.0.2; local Node is 24.19.0; git remote is `https://github.com/Webovignesh/tele.git`; electron-vite ships `node.d.ts` for `?asset` imports (its GitHub repo).
- Not verified (Phase 1 spike): `types: [@prebuilt-tdlib/types]` resolving under TS 7.0.2; `?asset` with electron-vite 5.0.0; every item already listed in 1.3.
- Next: 1.1 scaffold.

### 2026-10-01 · Phase 1 · Design review 4 resolved
- Resolved all 4 findings of `docs/.design-review.md` (0 HIGH, 2 MEDIUM, 2 NIT); per-finding responses are at the end of ARCHITECTURE.md. None backlogged or ignored. `docs/.design-review.md` and `.design-review.json` are committed with this change.
- ARCHITECTURE.md:
  - IPC: `pageUrl()` replaced by a pure `pageKey()` in `core/storage.ts` (hash and query stripped; `file:` → `fileURLToPath` lowercased, other URLs → `href` lowercased; never origins); parse errors and disposed frames → 403; unit cases (drive-letter case, sibling page, dev trailing slash, encoded slash); `test:app` launches the exe through its lowercased path; Security bullet and Layout updated.
  - Uploads: Upload step 6 settles `active` uploads with no live state and no pending id on `ready` (all sent → `completed`, else `settleUpload` + "Interrupted", not retryable); a start re-checks its live state before `sendMessage`; new invariant; call map and Client lifecycle updated; `settleUpload` test extended. Pump `free` = limit minus jobs with live state.
  - Media index: non-flood page errors while `ready` end the scan (warn) and add the chat to `failed`, cleared with `current`; no scan starts for a chat in `failed`; scan start test extended.
  - Cancel cleanup: only unfinished downloads (`status <> 'completed'`); call map row updated.
  - Manual checks: installer install into a lowercase custom folder.
- PRODUCT.md: a crashed upload fails as "Interrupted. Check the chat before retrying" instead of staying "Uploading".
- UI.md: no change (a failed scan reads `idle`, which the existing Files View states already cover).
- PROGRESS.md: Phase 1 spike, Phase 2 `pageKey`, Phase 3 upload recovery and scan `failed` set, Phase 6 lowercase install check.
- Verified: nothing run this pass; every change is a doc edit checked by reading and grepping the docs for stale `pageUrl` references (none outside the review-history tables and older changelog entries).
- Deferred (`ponytail:` note in ARCHITECTURE > Media index scan): a failed scan shows as `idle` with no reason in the UI. Upgrade: a `failed` scan state with the error text. Reason: rare (a chat that became inaccessible), and it retries after the next reconnect or restart.
- Not verified (carried to spikes): Chromium uppercasing the drive letter and `process.execPath` keeping the launch case (from the reviewer; `test:app` with the lowercased path proves the check either way in Phase 1); `fileURLToPath` behavior is from Node's documentation, not run.
- Next: Phase 1 scaffolding and packaging spike.

### 2026-10-01 · Phase 1 · Design review 3 resolved
- Resolved all 21 findings of `docs/.design-review.md` (0 HIGH, 6 MEDIUM, 15 NIT); per-finding responses are at the end of ARCHITECTURE.md. None ignored. `docs/.design-review.md` and `.design-review.json` are committed with this change.
- ARCHITECTURE.md:
  - IPC: `pageUrl()` full-URL sender check against `rendererUrl` (env URL only unpackaged), 403 logged at warn; Security bullet.
  - Downloads: background partial-data cleanup on cancel of non-live downloads (`getMessages` + `deleteFile`, `inFlight` guard); skip-existing via `complete(job, path)` with `deleteFile` when TDLib holds data; cross-volume finalize through a dot-prefixed part file, Mark-of-the-Web before the final rename, `deleteFile` instead of `rm(src)`, nothing after the final rename fails the job; new "final name is always complete" invariant.
  - Uploads: `jobs.pending` column removed; `files[i].pendingId`; Upload steps 3–6 rewritten; `supports_streaming` on `inputVideo`; failed messages deleted by `update.message.id`; startup rebuilds the routing map from `files[]`; `sendingStateFailed` after restart settles as failed.
  - Media index: `newest_id`/`oldest_id` by messages walked; start condition vs `chat.last_message.id`; `media:` on scan state change; live upkeep bump limited to the `current` set.
  - Schema and queries: `jobs_path`/`history_path` `lower(path)` indexes; history granularity comment; `position` assignment and retry order; id lists via `json_each`; `jobs.action ids` 1–1000.
  - API details: TDLib-to-shape mappings (`Folder.name`, photos, connection states); `fileGram.import.session: boolean`; `chats.media.exts` scope; `downloads.add` partial resolution; `library.*` accepts recorded download paths; dropped five unused shape fields; topic table (`storage` on root change, `window` writes silent); logout keeps the queue.
  - Build: `npmRebuild: false`; `assets/installer.nsh` (`customUnInstall`, `isUpdated` guard) in Layout and config; Clear All Data turns the login item off; tests and manual checks extended.
- UI.md: File Type options span the whole index; scanning with no rows shows the index bar + skeletons; Download folder description "Existing downloads stay where they are"; Clear All Data turns Start with Windows off.
- PRODUCT.md: logout keeps the queue (v1 limit); retries keep their place; final names are always complete; cancel deletes partial data; root change does not move downloads; Clear All Data and uninstall remove the startup entry.
- Verified: nothing new run this pass. The design relies on the reviewer's checks of `@prebuilt-tdlib/types` 0.1008066.0 (`inputVideo.supports_streaming`, `updateMessageSendFailed.message`, `chatFolderInfo.name`, five `connectionState*` variants), `tdl` 8.1.0 (`binding.gyp`, `install` script), and Node 24 (`file:` origin `"null"`, 32 767-parameter failure, `json_each`, expression indexes used by the planner).
- Deferred (each a `ponytail:` note in ARCHITECTURE with its upgrade path):
  - Partial data of downloads canceled while Telegram is not `ready` stays until Clear cache. Upgrade: retry on the next `ready`. Reason: rare, and Clear cache already covers it.
  - `.teleflow-*.part` files of jobs canceled after a crash are not swept. Upgrade: sweep on Clear cache. Reason: needs a crash plus a cancel; the file is hidden from the Library.
  - Jobs are not tied to an account. Upgrade: store `me.id` on jobs. Reason: multiple accounts are out of scope for v1.
- Not verified (carried to spikes): `npmRebuild: false` with the packaged `tdl` (Phase 1); NSIS Run value name `com.teleflow.app` and the `isUpdated` guard (Phase 6); whether TDLib keeps temporary message ids across a restart (the design is safe either way: unknown ids settle as "Interrupted").
- Next: Phase 1 scaffolding and packaging spike.

### 2026-10-01 · Phase 1 · Design review 2 resolved
- Resolved all 25 findings of `docs/.design-review.md` (0 HIGH, 7 MEDIUM, 18 NIT); per-finding responses are at the end of ARCHITECTURE.md. None backlogged or ignored.
- ARCHITECTURE.md: `checkDownloadRoot(path, { sealed, guarded })`; `loginItem` read/write; one `media:`/`messages:` topic rule incl. job deletes and trash; per-file upload `messageId` + `settleUpload`; FileGram markers; `uniquePath` reservations and partial-copy cleanup; Mark-of-the-Web at finalize + Security bullets; `stats` drains the idle sparkline; link 404 → 400, `isTelegramLink` in core; Startup list; upload state on leaving `ready`; thumbnail formats; `updateChatDraftMessage`; dropped `jobs.started_at`, `scans.updated_at`, `stats.chats[].username`; `repository` normalization; overlay color; Clear cache `done` reset; duration `> 0`; background Library scan; pending ids before `start(creds)`; three new invariants with owners; tests list extended.
- UI.md: top bar 40px and overlay color; `typeLabel` in the `ui.tsx` inventory; Downloads topic sentence; Load older capped at 1000; Queue Total/legend/Clear All scopes; Retry attempts always enabled; App Status signed-out branch removed; download-folder and FileGram-folder error texts.
- PRODUCT.md: download root rule (system and app data folders), FileGram folder markers, partial album retry, collision-safe naming, Mark-of-the-Web.
- Verified in `@prebuilt-tdlib/types` 0.1008066.0: `getInternalLinkType` 404 for non-internal links, `updateChatDraftMessage.positions`, `ThumbnailFormat` incl. `Mpeg4`/`Webm`/`Tgs`, `updateMessageSendFailed` note about `updateDeleteMessages`. FileGram `package.json` name is `filegram`; `server.js` uses `.filegram_state`.
- Not verified (carried to spikes): single-instance lock keyed by `userData` (Phase 1), Mark-of-the-Web triggering SmartScreen via `shell.openPath` (Phase 6), TDLib behavior when one album file fails (design is safe either way).
- Next: Phase 1 scaffolding and packaging spike.

### 2026-10-01 · Phase 1 · Design review 1 resolved
- Resolved all 39 findings of `docs/.design-review.md` (2 HIGH, 15 MEDIUM, 22 NIT); per-finding responses are at the end of ARCHITECTURE.md. #10 is fixed differently (limit-based `chats.messages`); #31 is applied in the Phase 1 scaffolding commit.
- ARCHITECTURE.md: `requeueActiveDownloads`; unified stall rule; enqueue upsert and dedupe after Clear Completed; trash forgets downloads; `jobs.list` order and `jobs.action` scopes; stats definitions; topic emission table; `appDir`; `checkDownloadRoot` with `userDirs` and invalid characters; auth state mapping; chat list membership, Saved Messages, group media permissions; media index totals; `app.info` sources; StorageReport trimmed; Chromium cache via `getCacheSize`/`clearCodeCaches`; FileGram `.thumbs` and import warning; protocol privileges; sender URL check; 403; tsconfig and `dependencies` split; Playwright file-access flag.
- UI.md: Shell Control inventory and Data bindings; skeleton-vs-refetch rule; Stepper and FileGramImportDialog page-local; index bar text; "Download all `<n>` matching"; Chat View "Load older" via `limit`; Downloads Total Files = `totalFiles.download`; Queue tab calls; Login "Signing out…" and phone-step error; Danger Zone subtitle; Clear buttons gated on live counts.
- PRODUCT.md: interrupted-download requeue, stall cap, download root rules, FileGram `.thumbs`, trash behavior, Chat View 1000-message cap, where the Ponytail rules live.
- Verified: `@prebuilt-tdlib/types` 0.1008066.0 says `searchMessagesFilterEmpty` is unsupported in `getChatMessageCount`; `authorizationStateWaitEmailAddress/EmailCode/Registration/OtherDeviceConfirmation/PremiumPurchase`, `updateChatPermissions`, `updateOption`, `chatPermissions.can_send_photos/can_send_videos` exist; `server.js` puts `.thumbs` under `downloadsDir`.
- Not verified locally: Electron `session.getCacheSize()` / `clearCodeCaches()` (no Electron typings in the repo; check in the Phase 1 spike), upload limits 2000/4000 MiB (Telegram's published limits).
- Next: Phase 1 scaffolding and packaging spike.

### 2026-10-01 · Phase 1 · Design finalized
- Rewrote PRODUCT.md, ARCHITECTURE.md, UI.md for the final design and four user scope changes: Analytics removed; every control real with a Control inventory; app data out of the repo with clear-cache/data actions; no hardcoded data (placeholders + grep gate); Electron + NSIS installer replacing Edge `--app`, Express, and launcher scripts.
- ARCHITECTURE.md now has: pinned stack, file layout, runtime paths, IPC bridge + 37 methods with shapes and errors, 3 events, `teleflow://` protocol, SQLite schema (settings, jobs, history, media, scans), settings keys, TDLib call map, engine flows, storage/clearing/FileGram import, desktop integration, security, build/packaging/tests.
- UI.md now has: No hardcoded data rule, `ui.tsx` inventory, per-page data needs, Control inventory, Data bindings (empty/loading/error), dialogs, tray.
- Verified:
  - `npm view` for every pinned package (electron 44.5.1, electron-builder 26.15.3, electron-vite 5.0.0 with peer `vite ^5 || ^6 || ^7`, vite 7.3.6, `@vitejs/plugin-react` 5.2.0, React 19.3.0, Tailwind 4.3.3, lucide-react 1.49.0, TypeScript 7.0.2, `@types/node` 24.19.0, Playwright 1.63.0).
  - `releases.electronjs.org`: Electron 44.5.1 = Node 24.21.0, Chromium 152.
  - Spike in `%TEMP%\teleflow-spike` (`npm install --save-exact electron@44.5.1`, `electron.exe main.js`): `node:sqlite` works in main (SQLite 3.53.4, STRICT); `tdl` + `prebuilt-tdlib` from the repo's `node_modules` load and report TDLib `1.8.66`. npm 12.0.2 skipped Electron's install script until `node node_modules/electron/install.js` was run (needs `allowScripts`). Spike folder deleted afterwards.
  - `@prebuilt-tdlib/types`: confirmed every TDLib function and update named in the call map, and the nested upload input shapes.
- Not verified yet: packaged (asar) TDLib loading, sandboxed CJS preload, icon conversion. All three are in the Phase 1 packaging spike.
- Next: Phase 1 scaffolding and packaging spike.

### 2026-10-01 · Phase 1 · Setup
- `git worktree add .worktrees/teleflow -b revamp/teleflow main` → new branch at `ca7ee901`.
- Added `.worktrees/` to `.git/info/exclude` (local only, not committed).
- Copied docs into the worktree; added `.teleflow/` and `.scratch/` to `.gitignore`.
- `git add docs .gitignore && git commit -m "docs: TeleFlow rewrite spec"` → `ca362cc0`.
- Old FileGram server and `.td_database` untouched.
- Next: design step (API, schema, file layout).

### 2026-10-01 · Phase 0 · Docs
- Wrote PRODUCT.md, ARCHITECTURE.md, UI.md (mockups transcribed), PROGRESS.md.
- Added Ponytail coding rules at `.kiro/steering/ponytail.md`.
- Next: create worktree, finalize design, scaffold.
