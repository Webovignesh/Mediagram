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
- [ ] Worktree and branch created; docs copied in
- [ ] Design step finalizes API, schema, file layout; docs updated
- [ ] Old FileGram code removed; new `package.json`, `tsconfig.json`, Vite + Tailwind config
- [ ] `npm run typecheck`, `npm test`, `npm run build` all run (even if near-empty)

### 2. Server core
- [ ] `db.ts`: schema, settings (seeded from FileGram `settings.json`)
- [ ] `telegram.ts`: auth flow, me, chats, folders, messages with filters, thumbnails
- [ ] `main.ts`: REST, WebSocket, Host/Origin guards, static serving

### 3. Transfer engine
- [ ] Downloads: queue, concurrency, pause/resume/cancel/retry/move, naming, dedupe, folder template
- [ ] Flood-wait handling, stall detection, auto-resume with backoff
- [ ] Uploads: single and album, captions, progress
- [ ] History + stats queries
- [ ] `engine.test.ts` covers naming, dedupe, scheduling, flood wait

### 4. Web shell
- [ ] Design tokens, `ui.tsx` primitives
- [ ] Sidebar, top bar with global search and link paste, user menu
- [ ] Login flow

### 5. Pages
- [ ] Overview
- [ ] Downloads (chat list, Files View, Chat View, side panels)
- [ ] Queue
- [ ] Uploads
- [ ] Media Library
- [ ] Settings

### 6. Ship
- [ ] Launcher scripts (Edge `--app`), Start-with-system shortcut
- [ ] README rewritten, CI updated
- [ ] Playwright UI suite with screenshots of every page at 1440×900 and 1280×720
- [ ] Final review against PRODUCT.md and UI.md
- [ ] Ready for user review (branch not merged)

## Decision log

| Date | Decision | Why |
|------|----------|-----|
| 2026-10-01 | Keep Node + TDLib; rewrite everything else | TDLib already does resumable downloads; existing session survives |
| 2026-10-01 | React 19 + Vite + Tailwind v4 + lucide; hand-rolled SVG charts | Dense dashboard UI, minimal dependencies |
| 2026-10-01 | `node:sqlite` for jobs/history/settings | Built in, no new dependency |
| 2026-10-01 | Edge `--app` window instead of Electron | Native window feel, no extra toolchain |
| 2026-10-01 | Brand TeleFlow; unified sidebar nav | Mockups disagree; see UI.md |
| 2026-10-01 | Only honored settings are shown | No fake toggles |
| 2026-10-01 | Forwarding, bulk delete, ZIP export out of v1 | Not in mockups; can return on request (PRODUCT.md D1) |

## Changelog

### 2026-10-01 · Phase 0 · Docs
- Wrote PRODUCT.md, ARCHITECTURE.md, UI.md (mockups transcribed), PROGRESS.md.
- Added Ponytail coding rules at `.kiro/steering/ponytail.md`.
- Next: create worktree, finalize design, scaffold.
