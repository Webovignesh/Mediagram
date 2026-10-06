import { useState, type FormEvent, type ReactNode, useEffect, useRef } from 'react'
import { Send, ArrowLeft, ChevronDown, Check, Loader2, AlertTriangle, ExternalLink, Eye, EyeOff } from 'lucide-react'
import type { AuthState } from '../../../core/shapes.ts'
import { call, useCall } from '../api.ts'
import { Input, Button, toast, MediagramLogo } from '../ui.tsx'

const COUNTRY_CODES = [
  { code: '+91', country: 'India' },
  { code: '+1', country: 'USA / Canada' },
  { code: '+44', country: 'UK' },
  { code: '+971', country: 'UAE' },
  { code: '+966', country: 'Saudi Arabia' },
  { code: '+7', country: 'Russia' },
  { code: '+49', country: 'Germany' },
  { code: '+33', country: 'France' },
  { code: '+39', country: 'Italy' },
  { code: '+34', country: 'Spain' },
  { code: '+81', country: 'Japan' },
  { code: '+82', country: 'South Korea' },
  { code: '+86', country: 'China' },
  { code: '+65', country: 'Singapore' },
  { code: '+60', country: 'Malaysia' },
  { code: '+62', country: 'Indonesia' },
  { code: '+61', country: 'Australia' },
  { code: '+55', country: 'Brazil' },
  { code: '+52', country: 'Mexico' },
  { code: '+20', country: 'Egypt' },
  { code: '+27', country: 'South Africa' },
  { code: '+234', country: 'Nigeria' },
  { code: '+92', country: 'Pakistan' },
  { code: '+880', country: 'Bangladesh' },
  { code: '+94', country: 'Sri Lanka' },
  { code: '+977', country: 'Nepal' },
  { code: '+90', country: 'Turkey' },
  { code: '+380', country: 'Ukraine' },
]

/** One row of the processing screen: ticked when done, spinning while it runs, a quiet dot until its turn. */
function Stage({ state, children }: { state: 'done' | 'active' | 'pending', children: ReactNode }) {
  return (
    <li className="flex items-center gap-3">
      <span className={`grid size-5 shrink-0 place-items-center rounded-full ${
        state === 'done' ? 'bg-success/15 text-success' : state === 'active' ? 'bg-primary/15 text-primary' : 'bg-tile text-muted'}`}>
        {state === 'done' ? <Check size={12} strokeWidth={3} />
          : state === 'active' ? <Loader2 size={12} className="animate-spin" />
          : <span className="size-1.5 rounded-full bg-current" />}
      </span>
      <span className={`text-[13px] ${state === 'pending' ? 'text-muted' : 'text-text'}`}>{children}</span>
    </li>
  )
}

// Phase 4.6: Full login flow with all auth steps
export default function Login() {
  const { data: auth, reload } = useCall<AuthState>('auth.get', undefined, ['auth'])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [overrideStep, setOverrideStep] = useState<string | null>(null)
  /** The third screen: the keys are with TDLib/Telegram — engine boot, connection, and the code request on its way. */
  const [processing, setProcessing] = useState(false)
  /** The number is in flight to Telegram: stage three of the processing screen, and what holds Continue. */
  const [sending, setSending] = useState(false)

  // Credentials step
  const [apiId, setApiId] = useState('')
  const [apiHash, setApiHash] = useState('')
  const [showApiId, setShowApiId] = useState(false)
  const [showApiHash, setShowApiHash] = useState(false)

  // Phone step
  const [countryCode, setCountryCode] = useState('+91')
  const [phone, setPhone] = useState('')
  /** The number dialed on the phone screen, kept while the API step asks for the keys that can send its code. */
  const [dialled, setDialled] = useState('')
  const [showApi, setShowApi] = useState(false)
  const sent = useRef(false)

  // Code step
  const [code, setCode] = useState('')

  // Password step
  const [password, setPassword] = useState('')

  // Telegram cannot text a code before it knows this app's API ID and hash, so with nothing stored the screen
  // opens on the phone number and the keys are asked for only when Continue finds no client to send it with.
  const raw = auth?.step ?? 'credentials'
  const authError = (auth as { error?: string } | undefined)?.error
  const current = overrideStep || (raw === 'credentials'
    ? (showApi || authError ? 'credentials' : 'phone')
    : raw)
  /** The socket TDLib opened (or is syncing over): the send stage can be shown truthfully. */
  const connected = auth?.connection === 'ready' || auth?.connection === 'updating'

  useEffect(() => {
    setError('')
    // What was typed belongs to its step: the keys, the code, and the password leave React state as soon as the
    // step is left (ARCHITECTURE > Security > Credentials).
    if (current !== 'credentials') { setApiId(''); setApiHash('') }
    if (current !== 'code') setCode('')
    if (current !== 'password') setPassword('')
    if (raw !== 'credentials') setShowApi(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- resets on the step the user is looking at
  }, [current, raw])

  // The processing screen opens while TDLib starts and closes when Telegram answers with a real step: the code
  // screen, or the phone form after a logout or Settings change restarted the engine (nothing typed before it).
  useEffect(() => {
    if (raw === 'starting') { setProcessing(true); return }
    if (processing && (raw === 'code' || raw === 'password' || raw === 'ready' || (raw === 'phone' && !dialled && !sending)))
      setProcessing(false)
  }, [raw, processing, dialled, sending])

  // The keys only start TDLib: once it asks for a number, send the one typed before them and land on the code.
  // Sending waits for the connection so the processing screen can show it truthfully; the fallback timer covers a
  // socket that never reports ready (TDLib queues the request internally either way).
  useEffect(() => {
    if (!dialled || sent.current || auth?.step !== 'phone') return
    const send = () => {
      if (sent.current) return
      sent.current = true
      setBusy(true)
      setSending(true)
      void call('auth.phone', { phone: dialled })
        .then(() => { setOverrideStep(null); reload() })
        .catch((err) => { setError((err as Error).message); reload() })
        .finally(() => { setBusy(false); setSending(false) })
    }
    if (connected) { send(); return }
    const timer = setTimeout(send, 4000)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only right after the keys reached TDLib
  }, [auth?.step, auth?.connection, dialled])

  /** Both Continue and the fresh-sign-in offer land here; only the second one may delete the saved session. */
  async function sendCredentials(fresh: boolean) {
    if (!apiId.trim() || !apiHash.trim()) {
    toast('Enter your API ID and API hash to continue', 'danger')
    setError('Enter your API ID and API hash — Mediagram needs them to sign you in.')
      return
    }
    setBusy(true)
    setError('')
    setProcessing(true) // the processing screen takes over; its Back returns here when Telegram refuses the keys
    try {
      await call('auth.credentials', { apiId: Number(apiId), apiHash: apiHash.trim(), ...(fresh && { fresh: true }) })
      setOverrideStep(null)
      sent.current = false // corrected keys restart TDLib: the phone screen must auto-send the number again
      reload()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  function submitCredentials(e: FormEvent) {
    e.preventDefault()
    void sendCredentials(false)
  }

  async function submitPhone(e: FormEvent) {
    e.preventDefault()
    const trimmed = phone.trim().replace(/[\s()-]/g, '')
    const fullPhone = trimmed.startsWith('+') ? trimmed : `${countryCode}${trimmed.replace(/^0+/, '')}`
    setBusy(true)
    setError('')
    try {
      if (raw === 'credentials') {
        // No TDLib client to send it with yet: ask for the keys first, then the effect above sends this number.
        setDialled(fullPhone)
        setShowApi(true)
        return
      }
      await call('auth.phone', { phone: fullPhone })
      setOverrideStep(null)
      reload()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  function backToPhone() {
    setShowApi(false)
    setApiId('')
    setApiHash('')
    setError('')
  }

  async function submitCode(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      await call('auth.code', { code: code.trim() })
      setOverrideStep(null)
      reload()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function submitPassword(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      await call('auth.password', { password })
      setOverrideStep(null)
      reload()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function goBack() {
    setBusy(true)
    setError('')
    try {
      await call('auth.logout')
      setOverrideStep(null)
      reload()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  function changeNumber() {
    setError('')
    setOverrideStep('phone')
  }

  /** Back from the processing screen: to the keys when that is where the trouble is, otherwise to the number
   *  itself — and the phone form takes over sending, so nothing fires behind the user's back. */
  function leaveProcessing() {
    setProcessing(false)
    setError('')
    if (raw === 'credentials') setShowApi(true)
    else sent.current = true
  }

  if (!auth) return null

  // The processing screen covers every moment TDLib/Telegram hold the keys — and a sign-in that succeeded on an
  // auto-start rests on the success note (App keeps this page mounted through the hand-off to the dashboard).
  const step = raw === 'ready' ? 'signed-in' : (processing || raw === 'starting') ? 'processing' : current
  const a = auth as any
  const activeError = error || authError
  const engineDone = raw !== 'starting'
  const linkDone = engineDone && (connected || sending || raw !== 'phone')
  const sendDone = raw === 'code' || raw === 'password' || raw === 'ready'

  return (
    <div className="flex h-full flex-col">
      {/* The 36px drag strip keeps clear of the native window buttons drawn by titleBarOverlay */}
      <div
        className="drag flex h-9 shrink-0 items-center justify-between px-3 bg-bg border-b border-border/40 select-none z-30"
        style={{ paddingRight: 'calc(100vw - env(titlebar-area-x, 0px) - env(titlebar-area-width, 100vw))' }}
      />
      <main className="grid flex-1 place-items-center overflow-auto p-6">
        <div className="w-[420px] max-w-full rounded-[14px] border border-border bg-panel p-6">
          <div className="mb-6 flex items-center gap-2">
            <MediagramLogo size={36} className="rounded-xl shadow-md shrink-0" />
            <span className="text-lg font-bold">Mediagram</span>
          </div>

          {step === 'processing' && (
            <div>
              <h1 className="text-xl font-semibold">
                {activeError ? 'Sign-in could not continue' : 'Signing in to Telegram'}
              </h1>
              <p className="mt-1 text-text-2">
                {activeError
                  ? 'Telegram answered with a problem — go back, correct it, and try again.'
                  : dialled
                    ? <>Signing in as <span className="font-medium text-text">{dialled}</span>.</>
                    : 'Getting the connection ready.'}
              </p>

              {activeError ? (
                <>
                  <div role="alert" className="mt-5 flex items-start gap-3 rounded-[10px] border border-danger/40 bg-danger/10 p-3.5">
                    <AlertTriangle size={16} className="mt-0.5 shrink-0 text-danger" aria-hidden />
                    <p className="text-[13px] leading-relaxed text-danger">{activeError}</p>
                  </div>
                  <div className="mt-5">
                    <Button variant="secondary" onClick={leaveProcessing}>
                      <ArrowLeft size={16} className="inline mr-1" /> Back
                    </Button>
                  </div>
                </>
              ) : (
                <>
                  <ul className="mt-5 space-y-3">
                    <Stage state={engineDone ? 'done' : 'active'}>Starting the Telegram engine</Stage>
                    <Stage state={!engineDone ? 'pending' : linkDone ? 'done' : 'active'}>Connecting to Telegram</Stage>
                    <Stage state={!linkDone ? 'pending' : sendDone ? 'done' : 'active'}>Checking your API ID and hash — sending your code</Stage>
                  </ul>
                  {engineDone && !sendDone && (
                    <p className="mt-4 text-[12px] leading-relaxed text-text-2">
                      Validating your connection and API data with Telegram — on a slow connection this can take up to a minute. Keep the app open.
                    </p>
                  )}
                  {raw !== 'starting' && (
                    <div className="mt-5">
                      <Button variant="secondary" onClick={leaveProcessing}>
                        <ArrowLeft size={16} className="inline mr-1" /> Back
                      </Button>
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {step === 'signed-in' && (
            <div className="py-6 text-center">
              <span className="mx-auto grid size-12 place-items-center rounded-full bg-success/15 text-success">
                <Check size={22} strokeWidth={3} aria-hidden />
              </span>
              <h1 className="mt-4 text-xl font-semibold">Signed in</h1>
              <p className="mt-1 text-text-2">Opening Mediagram…</p>
            </div>
          )}

          {step === 'credentials' && (
            <form onSubmit={submitCredentials}>
              <h1 className="text-xl font-semibold">Connect your Telegram app</h1>
              <p className="mt-1 text-text-2">
                Telegram needs your app's API ID and hash before it can send you a code. You only do this once.
              </p>
              {dialled && (
                <p className="mt-1 text-text-2">
                  Then we'll continue signing in as <span className="font-medium text-text">{dialled}</span>.
                </p>
              )}
              <div className="mt-5">
                <label className="block text-[12px] text-text-2 mb-1">API ID</label>
                <div className="relative">
                  <input
                    type={showApiId ? 'text' : 'password'}
                    placeholder="e.g. 2040"
                    value={apiId}
                    onChange={(e) => setApiId(e.target.value)}
                    inputMode="numeric"
                    autoComplete="off"
                    required
                    className="block w-full rounded-[10px] border border-border bg-tile pl-3.5 pr-10 py-2.5 text-[13px] text-text placeholder:text-muted focus:border-primary outline-none transition-colors"
                  />
                  <button
                    type="button"
                    onClick={() => setShowApiId(!showApiId)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted hover:text-text p-1 transition-colors"
                    title={showApiId ? 'Hide API ID' : 'Show API ID'}
                  >
                    {showApiId ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>
              <div className="mt-3">
                <label className="block text-[12px] text-text-2 mb-1">API hash</label>
                <div className="relative">
                  <input
                    type={showApiHash ? 'text' : 'password'}
                    placeholder="32-character hash from my.telegram.org"
                    value={apiHash}
                    onChange={(e) => setApiHash(e.target.value)}
                    autoComplete="off"
                    spellCheck={false}
                    required
                    className="block w-full rounded-[10px] border border-border bg-tile pl-3.5 pr-10 py-2.5 text-[13px] text-text placeholder:text-muted focus:border-primary outline-none transition-colors"
                  />
                  <button
                    type="button"
                    onClick={() => setShowApiHash(!showApiHash)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted hover:text-text p-1 transition-colors"
                    title={showApiHash ? 'Hide API hash' : 'Show API hash'}
                  >
                    {showApiHash ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>
              {(error || a.error) && <p role="alert" className="mt-3 text-danger">{error || a.error}</p>}
              {/* The one thing a first-time user cannot guess: where these two values come from. */}
              <div className="mt-4 rounded-xl border border-border bg-tile/70 p-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-[13px] font-semibold text-text">Where do I get these?</div>
                  <a href="https://my.telegram.org" target="_blank" rel="noreferrer" className="flex items-center gap-1 text-[12px] text-primary hover:underline">
                    Open my.telegram.org <ExternalLink size={12} />
                  </a>
                </div>
                <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-[12px] leading-relaxed text-text-2">
                  <li>
                    Go to{' '}
                    <a href="https://my.telegram.org" target="_blank" rel="noreferrer" className="text-primary hover:underline">my.telegram.org</a>{' '}
                    and log in with your phone number — Telegram sends you a code inside the app.
                  </li>
                  <li>Click <span className="font-medium text-text">API development tools</span>.</li>
                  <li>Fill in an app title and short name (any text you like, e.g. “Mediagram”) and create the app.</li>
                  <li>Copy <span className="font-medium text-text">App api_id</span> into <span className="font-medium text-text">API ID</span> above.</li>
                  <li>Copy <span className="font-medium text-text">App api_hash</span> into <span className="font-medium text-text">API hash</span> above.</li>
                </ol>
                <p className="mt-2.5 text-[11px] text-muted">
                  These values stay on this device (saved encrypted with your Windows account) and are only sent to Telegram.
                </p>
              </div>
              <div className="mt-5 flex gap-2">
                {!a.error && (
                  <Button variant="secondary" onClick={backToPhone} disabled={busy}>
                    <ArrowLeft size={16} className="inline mr-1" /> Back
                  </Button>
                )}
                <Button type="submit" busy={busy} disabled={busy}>
                  {busy ? 'Connecting…' : 'Continue'}
                </Button>
              </div>
              {/* The keys on record for the saved session do not match what was typed: wiping the local session and
                  signing in again is the only way Telegram gets to check this pair for real (the OTP step). */}
              {a.needsFresh && (
                <Button
                  variant="secondary"
                  className="mt-2 w-full"
                  disabled={busy || !apiId.trim() || !apiHash.trim()}
                  onClick={() => void sendCredentials(true)}
                >
                  Start a fresh sign-in (checks these keys with Telegram)
                </Button>
              )}
            </form>
          )}

          {step === 'phone' && (
            <form onSubmit={submitPhone}>
              <h1 className="text-xl font-semibold">Phone Number</h1>
              <p className="mt-1 text-text-2">Enter your phone number to sign in to Telegram.</p>
              <div className="mt-5">
                <label className="block text-[12px] text-text-2 mb-1.5">Phone number</label>
                <div className="flex gap-2">
                  <div className="relative shrink-0">
                    <select
                      value={countryCode}
                      onChange={(e) => setCountryCode(e.target.value)}
                      className="appearance-none h-10 w-[140px] rounded-[10px] border border-border bg-tile pl-3 pr-8 text-[13px] text-text hover:border-primary focus:border-primary outline-none cursor-pointer transition-colors"
                    >
                      {COUNTRY_CODES.map((c) => (
                        <option key={c.code} value={c.code} className="bg-panel text-text">
                          {c.code} ({c.country})
                        </option>
                      ))}
                    </select>
                    <ChevronDown size={14} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-muted" />
                  </div>
                  <input
                    type="tel"
                    inputMode="tel"
                    placeholder="98765 43210"
                    autoComplete="tel"
                    required
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    className="h-10 w-full rounded-[10px] border border-border bg-tile px-3.5 text-[13px] text-text placeholder:text-muted hover:border-primary/50 focus:border-primary outline-none transition-colors"
                  />
                </div>
              </div>
              {(error || a.error) && <p role="alert" className="mt-3 text-danger">{error || a.error}</p>}
              <div className="mt-5">
                <Button type="submit" busy={busy} disabled={busy || !phone.trim()}>
                  {busy ? 'Sending…' : 'Continue'}
                </Button>
              </div>
            </form>
          )}

          {step === 'code' && (
            <form onSubmit={submitCode}>
              <h1 className="text-xl font-semibold">Verification Code</h1>
              <p className="mt-1 text-text-2">
                Enter the code sent to {a.phone || phone} via {a.via === 'telegram' ? 'Telegram' : a.via === 'sms' ? 'SMS' : a.via === 'call' ? 'phone call' : 'another method'}.
              </p>
              <div className="mt-5">
                <Input 
                  label="Verification code"
                  value={code} 
                  onChange={setCode} 
                  inputMode="numeric"
                  autoComplete="one-time-code" 
                  required 
                />
              </div>
              {error && <p role="alert" className="mt-3 text-danger">{error}</p>}
              <div className="mt-5 flex gap-2">
                <Button variant="secondary" onClick={changeNumber} disabled={busy}>
                  <ArrowLeft size={16} className="inline mr-1" /> Back
                </Button>
                <Button type="submit" busy={busy} disabled={busy || !code.trim()}>
                  {busy ? 'Verifying…' : 'Verify'}
                </Button>
              </div>
            </form>
          )}

          {step === 'password' && (
            <form onSubmit={submitPassword}>
              <h1 className="text-xl font-semibold">Two-Step Verification</h1>
              <p className="mt-1 text-text-2">
                This account has 2FA enabled. Enter your password to continue.
                {a.hint && <span className="block mt-1">Hint: {a.hint}</span>}
              </p>
              <div className="mt-5">
                <Input 
                  label="Password"
                  value={password} 
                  onChange={setPassword} 
                  type="password"
                  autoComplete="current-password" 
                  required 
                />
              </div>
              {error && <p role="alert" className="mt-3 text-danger">{error}</p>}
              <div className="mt-5 flex gap-2">
                <Button variant="secondary" onClick={changeNumber} disabled={busy}>
                  <ArrowLeft size={16} className="inline mr-1" /> Back
                </Button>
                <Button type="submit" busy={busy} disabled={busy || !password}>
                  {busy ? 'Verifying…' : 'Continue'}
                </Button>
              </div>
            </form>
          )}

          {step === 'logging-out' && (
            <div className="py-8 text-center text-text-2">Logging out…</div>
          )}
        </div>
      </main>
    </div>
  )
}
