# TeleFlow

Windows desktop app for downloading and uploading Telegram media, built on Electron and TDLib. It installs from `TeleFlow-Setup-<version>.exe` like any other program; there is no server, open port, or launcher script.

Status: rewrite in progress on `revamp/teleflow`. See [docs/PROGRESS.md](docs/PROGRESS.md).

## Where data lives

Nothing the app produces is written to the repo or the install folder.

- App data (TDLib session and cache, database, logs, Chromium profile): `%LOCALAPPDATA%\TeleFlow`. Development runs use `%LOCALAPPDATA%\TeleFlow-dev`.
- Downloads: `%USERPROFILE%\Downloads\TeleFlow` (configurable in Settings).
- `TELEFLOW_HOME` overrides the app data folder (tests and manual dev runs point it at a temp folder).

## Development

Requires Node 24 on Windows.

```powershell
npm ci
npm run dev        # electron-vite dev server with HMR
npm run typecheck  # tsc --noEmit
npm test           # node:test engine tests
npm run build      # out/main, out/preload, out/renderer
npm run dist       # build + NSIS installer in release\
npm run test:app   # Playwright smoke of release\win-unpacked\TeleFlow.exe (after dist)
npm run icon       # re-render assets\icon.png and icon.ico from icon.svg
```

The Electron binary downloads on first use (`npm run dev`, `npm run test:app`). Run `npx playwright install chromium` once before `npm run icon`.

Design and spec: [PRODUCT](docs/PRODUCT.md), [ARCHITECTURE](docs/ARCHITECTURE.md), [UI](docs/UI.md).
