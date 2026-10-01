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

## Phases

### 0. Docs
- [x] PRODUCT.md, ARCHITECTURE.md, UI.md, PROGRESS.md drafted

### 1. Setup
- [x] Worktree and branch created; docs copied in
- [x] Design step finalizes API, schema, file layout; docs updated
- [x] Design review 1 (39 findings) resolved in the docs
- [x] Design review 2 (25 findings) resolved in the docs
- [x] Design review 3 (21 findings) resolved in the docs
- [x] Design review 4 (4 findings) resolved in the docs
- [ ] Old FileGram code removed; new `package.json` (exact pins, `dependencies` = `tdl` + `prebuilt-tdlib` only, `allowScripts` for `electron@44.5.1`, electron-builder `build` config), `tsconfig.json`, `electron.vite.config.ts` (incl. `__LICENSES__` define), `playwright.config.ts` (`--allow-file-access-from-files`); `.gitignore` adds `out/`, drops `.teleflow/`, un-ignores `.kiro/steering/`; `.kiro/steering/ponytail.md` committed
- [ ] Packaging spike: `npm run dist` produces `release\TeleFlow-Setup-<version>.exe`; `release\win-unpacked\TeleFlow.exe` boots, loads TDLib from `app.asar.unpacked` (logs the TDLib version), and shows the Login screen when launched through its lowercased path (which also proves the case-insensitive IPC sender check passes for the packaged `file:` page); spike also confirms that `npmRebuild: false` keeps `tdl`'s prebuild (no node-gyp run), the sandboxed CJS preload, `webUtils.getPathForFile`, `env(titlebar-area-width)`, `session.getCacheSize()` / `clearCodeCaches()`, and whether the single-instance lock is keyed by `userData` (dev and installed runs side by side)
- [ ] `npm run typecheck`, `npm test`, `npm run build` all run (even if near-empty)

### 2. Core and shell
- [ ] `core/db.ts`: schema, queries, settings defaults and validation, `fail()`
- [ ] `core/storage.ts`: `resolvePaths`, `checkDownloadRoot`, `pageKey`, logger, library scan, storage report
- [ ] `core/telegram.ts`: client lifecycle, auth flow, chat cache, messages, media extraction, link resolution, thumbnails
- [ ] `electron/main.ts`, `electron/ipc.ts`, `electron/preload.ts`: single instance, window + state, `teleflow://` protocol, IPC bridge with sender check and validation, CSP

### 3. Transfer engine
- [ ] Downloads: queue, concurrency, pause/resume/cancel/retry/move, naming, dedupe (incl. after Clear Completed), folder template, finalize, `requeueActiveDownloads`
- [ ] Gates: flood wait, start spacing with backoff, stall detection (online only, capped by retry attempts), auto-retry with backoff
- [ ] Uploads: single and album, captions, progress, pause/cancel, quit and crash recovery (incl. `active` uploads with no pending id settled on `ready`)
- [ ] Media index scan (top-up, backfill, live upkeep, `failed` set for erroring chats)
- [ ] History + stats queries
- [ ] Clear cache, Clear app data, Clear All Data, logout cleanup
- [ ] `engine.test.ts` covers naming, folder template, paths, dedupe, scheduling, gates, retry, albums, media filters

### 4. Web shell
- [ ] Design tokens, `ui.tsx` primitives
- [ ] Sidebar, top bar (title bar overlay, global search with link paste, user menu)
- [ ] Login flow, including FileGram import

### 5. Pages
- [ ] Overview
- [ ] Downloads (chat list, Files View, Chat View, side panels)
- [ ] Queue
- [ ] Uploads
- [ ] Media Library
- [ ] Settings (incl. Storage, clearing, Danger Zone, leftovers)

### 6. Desktop and ship
- [ ] Tray, minimize to tray on close, start with Windows (toggle reads back on after restart, packaged and dev), notifications (`setAppUserModelId` toast identity), window state
- [ ] Start with Windows cleanup: `reg query HKCU\Software\Microsoft\Windows\CurrentVersion\Run` shows value `com.teleflow.app` with the toggle on (confirms the name in `assets/installer.nsh`); uninstall removes it; an upgrade install keeps it; Clear All Data turns it off
- [ ] Cross-volume download (download root on a second drive): no `.teleflow-*.part` left, file has Mark-of-the-Web; canceling a paused download frees its `tdlib\files` data
- [ ] Mark-of-the-Web verified manually: `Get-Item <file> -Stream Zone.Identifier` shows `ZoneId=3`; opening a downloaded `.exe` from the Library triggers SmartScreen
- [ ] FileGram import and leftover removal verified on a copy of a FileGram folder
- [ ] Icon (`assets/icon.svg` → `icon.png`, `icon.ico`), NSIS installer options; an install into a custom folder typed in lowercase reaches the Login screen (IPC sender check)
- [ ] README rewritten, CI updated (Windows runner: `npm ci`, typecheck, test, build, test:ui)
- [ ] Playwright UI suite with screenshots of every page at 1440×900 and 1280×720
- [ ] Every Control inventory row in UI.md exercised by `ui.spec.ts`
- [ ] Grep gate: no mockup sample strings in `electron/`, `core/`, `web/src/`
- [ ] Final gate: `npm run dist` builds the installer and `npm run test:app` passes on `release\win-unpacked\TeleFlow.exe`
- [ ] Final review against PRODUCT.md and UI.md
- [ ] Ready for user review (branch not merged)

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
| 2026-10-01 | FileGram import is user-initiated (folder picker on Login and in Settings), not automatic | The installed exe cannot know the repo path (user scope change #4 supersedes #2's automatic migration) |
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
| 2026-10-01 | `Stepper` and `FileGramImportDialog` live in `pages/Settings.tsx` | Single-page component rule; keeps `ui.tsx` under 400 lines (review 1 #18, #19) |
| 2026-10-01 | Download root rule split into `sealed` (home, appDir, AppData, Windows, Program Files, ProgramData: not equal, inside, or containing) and `guarded` (profile, known folders: not equal or containing) | An ancestor of AppData or Program Files passed and Clear All Data could delete it (review 2 #1) |
| 2026-10-01 | Start with Windows reads and writes through one `loginItem` object; read `executableWillLaunchAtLogin` | `getLoginItemSettings` only matches the same `args`, so the toggle read back off (review 2 #2) |
| 2026-10-01 | Uploads record `messageId` per file; a partly failed album keeps only unsent files (`settleUpload`) | Retry re-posted files that were already sent (review 2 #4) |
| 2026-10-01 | FileGram folders need a marker (`.td_database`, `.filegram_state`, or `package.json` name `filegram`) | A wrong folder with a `config.json` would have its downloads moved and config deleted (review 2 #5) |
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

## Changelog

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
