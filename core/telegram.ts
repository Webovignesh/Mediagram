import tdl from 'tdl'

export type Me = { id: number, name: string, firstName: string, username: string | null,
  phone: string /* masked */, photo: string | null /* remote file id */, premium: boolean,
  captionMax: number, uploadMax: number }
export type AuthState = { connection: 'ready' | 'connecting' | 'updating' | 'offline' } & (
  | { step: 'starting' }
  | { step: 'credentials', error?: string }
  | { step: 'phone', error?: string }
  | { step: 'code', phone: string, via: 'telegram' | 'sms' | 'call' | 'other' }
  | { step: 'password', hint: string }
  | { step: 'ready', me: Me }
  | { step: 'logging-out' })

// No client until credentials are entered (auth.credentials lands in Phase 2).
const state: AuthState = { step: 'credentials', connection: 'offline' }
export const authState = (): AuthState => state

/** Call once, before any other TDLib use. `tdjson` must point outside app.asar: the OS loader cannot read inside it. */
export function configure(tdjson: string, logFile: string) {
  tdl.configure({ tdjson, verbosityLevel: 1 })
  tdl.execute({ _: 'setLogStream', log_stream: { _: 'logStreamFile', path: logFile, max_file_size: 10 * 2 ** 20, redirect_stderr: false } })
}

export function tdlibVersion() {
  const v = tdl.execute({ _: 'getOption', name: 'version' })
  if (v?._ !== 'optionValueString') throw new Error(`TDLib did not report its version: ${JSON.stringify(v)}`)
  return v.value
}
