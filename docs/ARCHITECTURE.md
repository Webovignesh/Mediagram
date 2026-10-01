# TeleFlow: Architecture

Status: draft. The design step finalizes the API and schema; keep this file in sync with the code.

## Tech stack

| Layer | Choice | Why |
|-------|--------|-----|
| Runtime | Node.js 24 (installed: v24.19), ESM | Already installed; runs TypeScript natively via type stripping, so the server needs no build step |
| Language | TypeScript (erasable syntax only), `tsc --noEmit` for type checks | Readable, safe refactors, zero runtime cost |
| Telegram | TDLib via `tdl` + `prebuilt-tdlib` | Kept: TDLib handles chunked, resumable downloads natively and the existing session in `.td_database/` keeps working |
| HTTP / live updates | Express 5 + `ws` | Kept: already proven here |
| Storage | `node:sqlite` (built in) | Jobs, history, settings in one file; no new dependency |
| Web UI | React 19 + Vite + Tailwind CSS v4 + `lucide-react` | Component model for a dense dashboard; Tailwind maps cleanly to the mockups' design tokens |
| Charts | Hand-written SVG components | Two chart types (area, sparkline) do not justify a chart library |
| Routing / state | Hash routing in `App.tsx`; one WebSocket-fed store via `useSyncExternalStore` | No router or state library needed |
| Tests | `node:test` for engine logic; Playwright (kept) for UI with mocked API | Built-in runner; Playwright already in use |
| Desktop shell | Launcher opens Edge `--app=http://127.0.0.1:<port>`; Startup-folder shortcut for "Start with system" | Native window feel without Electron |

Not chosen:
- Electron / Tauri: a second toolchain and 100+ MB for what Edge `--app` already gives on Windows. Revisit if tray or auto-update becomes a requirement.
- Python + Telethon (reference repo): it needed FastTelethon and `.part.meta` workarounds for resumable downloads that TDLib already provides, and it would force a re-login.

## Layout

```
server/
  main.ts        bootstrap: static files, REST routes, WebSocket, security guards
  telegram.ts    TDLib client: auth, chats, folders, messages, files, thumbnails
  transfers.ts   download/upload queue engine
  db.ts          SQLite schema, queries, settings
web/
  index.html
  src/main.tsx
  src/App.tsx      shell: sidebar, top bar, hash routing, auth gate
  src/api.ts       fetch helpers + live store fed by WebSocket
  src/ui.tsx       shared primitives (Panel, StatCard, Pill, Progress, Toggle, Select, Table, ...)
  src/pages/       Overview, Downloads, Uploads, Queue, Library, Analytics, Settings, Login
  src/styles.css   Tailwind import + theme tokens
tests/
  engine.test.ts   queue, naming, dedupe, flood-wait logic
  ui.spec.ts       Playwright: every page renders, key flows work, screenshots
scripts/
  TeleFlow.vbs, install.cmd, uninstall.cmd
docs/
```

Split a file only when it passes roughly 400 lines or mixes unrelated concerns.

Removed in the rewrite: `server.js`, `server/*.js` preloads, `public/`, `scripts/*.test.cjs`, old `tests/`, `BULK_UPLOAD_TESTING.md`, `Clean Repo After Release.cmd`, `FileGram.vbs`, `Install/Uninstall FileGram.cmd`.

## Runtime data

All paths are relative to `TELEFLOW_HOME` (default: repo root). Development and tests set it to a separate folder so they never touch the live session.

| Path | Owner | Notes |
|------|-------|-------|
| `.td_database/` | TDLib | Session. Kept in place, never deleted by the app except "Disconnect Telegram" |
| `.td_files/` | TDLib | File cache, including partial downloads |
| `config.json` | App | API ID/hash, read for migration, never logged |
| `settings.json` | App | FileGram settings, read once to seed TeleFlow settings |
| `.teleflow/teleflow.db` | App | Jobs, history, settings |
| `downloads/` (default) | User | Download root; configurable |

TDLib locks its database, so only one process may use a given `.td_database/` at a time.

## API sketch

REST under `/api`, JSON in and out:

- `GET /health`
- `GET /auth`, `POST /auth/credentials | phone | code | password | logout`
- `GET /me`
- `GET /chats?filter=&q=`, `GET /folders`, `POST /chats/open` (link or username)
- `GET /chats/:id/messages?view=&type=&ext=&duration=&size=&status=&sort=&page=`
- `GET /files/:id/thumb`
- `POST /downloads` `{ chatId, messageIds }` or `{ chatId, filters }` or `{ link }`
- `POST /uploads` multipart: files, `chatId`, `caption`, `album`, `keepNames`
- `GET /jobs?kind=&status=&q=&page=`
- `POST /jobs/:id/pause | resume | cancel | retry | move`
- `POST /jobs/bulk` `{ action, ids | "all" }`
- `GET /library?q=&type=&chat=&sort=&page=`, `POST /library/open | reveal | delete | verify`
- `GET /stats/overview`, `GET /stats/activity?range=`, `GET /stats/chats?range=`
- `GET /settings`, `PUT /settings`
- `GET /system` (version, connection, storage), `POST /system/pick-folder`

WebSocket `/ws` pushes: `job` (throttled to about 4 updates/s per job), `job:removed`, `speed`, `auth`, `connection`.

## Transfer engine

- Job states: `queued`, `active`, `paused`, `completed`, `failed`, `canceled`. The UI derives "Downloading", "Uploading", and "Finalizing" from kind and progress.
- Scheduler picks queued jobs by priority, then creation time, up to the concurrency limit per kind.
- Downloads: TDLib `downloadFile` (async), progress from `updateFile`. Pause = `cancelDownloadFile` (partial data kept). On completion, move the file from `.td_files/` to the target path (rename on the same volume, copy otherwise).
- Uploads: TDLib `sendMessage` / `sendMessageAlbum`, progress from `updateFile` on the local file, done on `updateMessageSendSucceeded`.
- `FLOOD_WAIT`: read the retry delay, hold new starts until it passes.
- History rows record finished jobs for Overview, Analytics, and Library metadata.

## Security

- Bind `127.0.0.1` only. No login screen for the app itself, because it is local-only.
- Reject requests whose `Host` is not `127.0.0.1` or `localhost` on the app port (DNS rebinding).
- Require a matching `Origin` on non-GET requests and WebSocket upgrades (blocks other websites from driving the local API).
- Validate all ids and query params. Library file operations must resolve inside the download root (path traversal).
- Never log or return the API hash, login codes, or 2FA passwords.
