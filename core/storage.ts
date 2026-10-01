import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/** Where TeleFlow keeps its data. Never inside the repo or the install folder (ARCHITECTURE > Runtime data). */
export function resolvePaths(o: { env: Record<string, string | undefined>, packaged: boolean, appDir: string }) {
  const local = o.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local')
  const home = path.resolve(o.env.TELEFLOW_HOME || path.join(local, o.packaged ? 'TeleFlow' : 'TeleFlow-dev'))
  const appDir = path.resolve(o.appDir)
  const rel = path.relative(appDir, home) // win32 compares case-insensitively
  if (!path.isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${path.sep}`)) {
    throw new Error(`TeleFlow can't keep its data inside its own folder (${home}). Set TELEFLOW_HOME to a folder outside ${appDir}.`)
  }
  return { home, appDir }
}

/** Compares renderer pages, never origins: every file: URL has the origin "null" (ARCHITECTURE > Bridge step 1). Throws on bad URLs. */
export const pageKey = (s: string) => {
  const u = new URL(s); u.hash = ''; u.search = ''
  return (u.protocol === 'file:' ? fileURLToPath(u) : u.href).toLowerCase()
}

let logFile = ''

/** Opens home\logs\main.log; a log over 5 MB moves to main.old.log first. */
export function openLog(dir: string) {
  fs.mkdirSync(dir, { recursive: true })
  logFile = path.join(dir, 'main.log')
  if ((fs.statSync(logFile, { throwIfNoEntry: false })?.size ?? 0) > 5 * 2 ** 20) fs.renameSync(logFile, path.join(dir, 'main.old.log'))
}

/** Callers never pass secrets; a 32-hex value (the API hash format) is masked as a backstop. */
export function log(level: 'info' | 'warn' | 'error', message: string) {
  const line = `${new Date().toISOString()} ${level} ${message.replace(/\b[0-9a-f]{32}\b/gi, '[redacted]')}\n`
  if (logFile) fs.appendFileSync(logFile, line)
  else process.stderr.write(line)
}
