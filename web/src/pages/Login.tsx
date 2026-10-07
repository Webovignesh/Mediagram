import { useState, type FormEvent, type ReactNode, type CSSProperties, useEffect, useLayoutEffect, useRef } from 'react'
import { ArrowLeft, ArrowRight, ArrowDown, ChevronDown, Check, Loader2, AlertTriangle, ExternalLink, Eye, EyeOff, HelpCircle, BookOpen, Lock, X } from 'lucide-react'
import type { AuthState } from '../../../core/shapes.ts'
import { call, useCall } from '../api.ts'
import { Input, Button, Select, toast, MediagramLogo, ErrorState } from '../ui.tsx'

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

/** The four steps the credentials popover walks through, in the order they happen on my.telegram.org. */
const GUIDE_STEPS = [
  { title: 'Sign In', body: <>Open <span className="text-primary font-medium">my.telegram.org</span> with your phone number</> },
  { title: 'Tools', body: <>Click <strong className="text-text-2 font-semibold">API development tools</strong></> },
  { title: 'Create App', body: <>Enter a title, e.g. “Mediagram”</> },
  { title: 'Copy Keys', body: <>Paste <strong className="text-text-2 font-semibold">api_id</strong> &amp; <strong className="text-text-2 font-semibold">api_hash</strong> into the fields</> },
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
  const { data: auth, reload, error: loadError } = useCall<AuthState>('auth.get', undefined, ['auth'])
  const { data: settings } = useCall<{ lastUser?: string | null }>('settings.get', {}, ['settings'])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  /** A rejection the user backed out of: the phone screen must not keep showing it, while a fresh
   *  attempt (or a different message) brings it right back. */
  const [dismissedError, setDismissedError] = useState<string | null>(null)
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

  // Credentials guide popover: `closing` keeps it mounted long enough to play its exit animation.
  const [guide, setGuide] = useState<'closed' | 'open' | 'closing'>('closed')
  const [tail, setTail] = useState<{ top: number, x: number } | null>(null)
  const guideTimer = useRef<number | undefined>(undefined)
  const cardRef = useRef<HTMLDivElement>(null)
  const popRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)

  function openGuide() {
    if (guideTimer.current) { clearTimeout(guideTimer.current); guideTimer.current = undefined }
    setTail(null)
    setGuide('open')
  }

  function closeGuide() {
    if (guide !== 'open') return
    setGuide('closing')
    guideTimer.current = window.setTimeout(() => { setGuide('closed'); guideTimer.current = undefined }, 170)
  }

  /** The tail must land exactly on the "View guide" row. Offsets are read from layout (the entrance
   *  transform cannot skew them) and shifted by the popover's own CSS translate — right, or centred
   *  beneath the card on a narrow window — so the tail follows it either way. */
  function measureTail() {
    const card = cardRef.current, pop = popRef.current, trigger = triggerRef.current
    if (!card || !pop || !trigger) return
    const box = card.getBoundingClientRect()
    const row = trigger.getBoundingClientRect()
    const [tx, ty] = getComputedStyle(pop).translate.split(' ')
    const shiftX = tx?.endsWith('%') ? (pop.offsetWidth * parseFloat(tx)) / 100 : parseFloat(tx || '0')
    const shiftY = ty?.endsWith('%') ? (pop.offsetHeight * parseFloat(ty)) / 100 : parseFloat(ty || '0')
    const inCardX = row.left + row.width / 2 - (box.left + card.clientLeft)
    const inCardY = row.top + row.height / 2 - (box.top + card.clientTop)
    const next = {
      top: Math.min(Math.max(inCardY - pop.offsetTop - shiftY - 6, 24), pop.offsetHeight - 24),
      x: Math.min(Math.max(inCardX - pop.offsetLeft - shiftX - 6, 24), pop.offsetWidth - 24),
    }
    setTail((prev) => (prev && prev.top === next.top && prev.x === next.x ? prev : next))
  }

  // Runs after every render while the popover is up: content above the trigger (an error, the fresh
  // sign-in offer, the "removed by" banner) moves it, and the tail follows.
  useLayoutEffect(() => { if (guide !== 'closed') measureTail() })

  useEffect(() => {
    if (guide === 'closed') return
    // Below the 1160px breakpoint the CSS stacks the popover under the card, so bring it into view.
    if (window.matchMedia('(max-width: 1160px)').matches)
      popRef.current?.scrollIntoView({ block: 'nearest' })
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeGuide() }
    const onDown = (e: MouseEvent) => { if (!cardRef.current?.contains(e.target as Node)) closeGuide() }
    // A resize can re-flow the card or flip the popover to its stacked layout: re-measure, and if it
    // now sits below the card, bring it back into view.
    const onResize = () => {
      measureTail()
      if (window.matchMedia('(max-width: 1160px)').matches) popRef.current?.scrollIntoView({ block: 'nearest' })
    }
    window.addEventListener('resize', onResize)
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onDown)
    return () => {
      window.removeEventListener('resize', onResize)
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onDown)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- open/close only; measure runs every render
  }, [guide])

  useEffect(() => () => { if (guideTimer.current) clearTimeout(guideTimer.current) }, [])

  // Telegram cannot text a code before it knows this app's API ID and hash, so with nothing stored the screen
  // opens on the phone number and the keys are asked for only when Continue finds no client to send it with.
  const raw = auth?.step ?? 'credentials'
  const rawAuthError = (auth as { error?: string } | undefined)?.error
  const authError = rawAuthError && rawAuthError !== dismissedError ? rawAuthError : undefined
  const current = overrideStep || (raw === 'credentials'
    ? (showApi || authError ? 'credentials' : 'phone')
    : raw)
  /** The socket TDLib opened (or is syncing over): the send stage can be shown truthfully. */
  const connected = auth?.connection === 'ready' || auth?.connection === 'updating'

  // Telegram dropping the rejection clears the dismissal too, so the next one is never swallowed.
  useEffect(() => { if (!rawAuthError) setDismissedError(null) }, [rawAuthError])

  useEffect(() => {
    setError('')
    // The guide belongs to the screen that offers it — leaving that screen plays its exit, not a cut.
    closeGuide()
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
    setDismissedError(null)
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
    // Leaving the keys also leaves the rejection behind: the phone form must open cleanly, while the
    // message stays on auth for any later attempt that shows it again.
    setDismissedError(rawAuthError ?? null)
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

  // The 36px drag strip keeps clear of the native window buttons drawn by titleBarOverlay; both
  // shapes this page renders (still-fetching and the card) carry it.
  const dragStrip = (
    <div
      className="drag flex h-9 shrink-0 items-center justify-between px-3 bg-bg border-b border-border/40 select-none z-30"
      style={{ paddingRight: 'calc(100vw - env(titlebar-area-x, 0px) - env(titlebar-area-width, 100vw))' }}
    />
  )

  // App only mounts Login with auth in hand, but this page's own auth.get can still fail while that
  // copy succeeds (restart mid-flight, a transient error): keep the shell up with a spinner, and give
  // a real failure the retry every other page gets instead of a blank window.
  if (!auth) {
    return (
      <div className="flex h-full flex-col">
        {dragStrip}
        <main className="flex flex-1 items-center justify-center p-6">
          {loadError
            ? <ErrorState error={loadError} onRetry={reload} />
            : (
              <p className="flex items-center gap-2 text-[13px] text-text-2">
                <Loader2 size={15} className="animate-spin" aria-hidden /> Starting Mediagram…
              </p>
            )}
        </main>
      </div>
    )
  }

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
      {dragStrip}
      <main className="flex flex-1 flex-col items-center justify-center overflow-y-auto p-6 gap-4">
        {/* The card is centred on its own, and the guide popover is positioned against it — opening
            the guide never nudges the sign-in box, it only appears beside it. */}
        <div ref={cardRef} className="relative w-[420px] max-w-full rounded-[14px] border border-border bg-panel p-6 shadow-md shrink-0">
          <div className="mb-6 flex items-center gap-2">
            <MediagramLogo size={36} className="rounded-xl shadow-md shrink-0" />
            <span className="text-lg font-bold">Mediagram</span>
          </div>

          {/* A fresh key remounts the screen body, so every step change plays the same soft entrance. */}
          <div key={step} className="fade-enter">

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
                <label htmlFor="login-api-id" className="block text-[12px] text-text-2 mb-1">API ID</label>
                <div className="relative">
                  <input
                    id="login-api-id"
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
                <label htmlFor="login-api-hash" className="block text-[12px] text-text-2 mb-1">API hash</label>
                <div className="relative">
                  <input
                    id="login-api-hash"
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

              {/* The question everyone has at this screen, answered by the popover this row opens. The arrow
                  swaps rather than rotates, so it is never caught mid-diagonal: right at rest, down when open. */}
              <button
                type="button"
                ref={triggerRef}
                onClick={() => (guide === 'open' ? closeGuide() : openGuide())}
                aria-expanded={guide !== 'closed'}
                aria-controls="login-api-guide"
                className="group mt-4 flex w-full items-center gap-2 px-1 py-1 text-left text-[12.5px] text-text-2 transition-colors hover:text-text"
              >
                <HelpCircle size={14} className="shrink-0 text-muted" aria-hidden />
                <span className="min-w-0">Where do I get these credentials?</span>
                <span className={`ml-3 flex shrink-0 items-center gap-1 font-semibold transition-colors ${guide === 'closed' ? 'text-primary' : 'text-primary-hover'}`}>
                  <span>View guide</span>
                  <span className="relative grid size-[15px] place-items-center" aria-hidden>
                    <ArrowRight
                      size={13}
                      className={`absolute transition-all duration-200 ease-out ${guide === 'closed' ? 'translate-x-0 opacity-100 group-hover:translate-x-0.5' : '-translate-x-1 opacity-0'}`}
                    />
                    <ArrowDown
                      size={13}
                      className={`absolute transition-all duration-200 ease-out ${guide === 'closed' ? '-translate-y-1 opacity-0' : 'translate-y-0 opacity-100'}`}
                    />
                  </span>
                </span>
              </button>

              {(error || authError) && <p role="alert" className="mt-3 text-danger">{error || authError}</p>}

              <div className="mt-5 flex gap-2">
                {/* Back is never hidden: a rejected pair still has to be escapable, or the user is
                    stranded on keys they cannot change the number behind. */}
                <Button variant="secondary" onClick={backToPhone} disabled={busy}>
                  <ArrowLeft size={16} className="inline mr-1" /> Back
                </Button>
                <Button type="submit" busy={busy} disabled={busy}>
                  {busy ? 'Connecting…' : (settings?.lastUser ? 'Sign in' : 'Continue')}
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
              {/* The keys never leave this machine, so the promise sits with the fields it covers. */}
              <div className="mt-5 flex items-start gap-2 border-t border-border/60 pt-3.5 text-[11px] leading-snug text-muted">
                <Lock size={12} className="mt-px shrink-0" aria-hidden />
                <span>Values are stored encrypted with Windows DPAPI on this device and only shared directly with Telegram.</span>
              </div>
            </form>
          )}

          {step === 'phone' && (
            <form onSubmit={submitPhone}>
              <h1 className="text-xl font-semibold">Phone Number</h1>
              <p className="mt-1 text-text-2">Enter your phone number to sign in to Telegram.</p>
              <div className="mt-5">
                <label className="block text-[12px] text-text-2 mb-1.5">Phone number</label>
                <div className="flex gap-2">
                  <div className="shrink-0">
                    <Select
                      value={countryCode}
                      onChange={(v) => setCountryCode(String(v))}
                      options={COUNTRY_CODES.map((c) => ({
                        value: c.code,
                        label: `${c.code} (${c.country})`,
                      }))}
                      className="h-10 min-w-[140px]"
                    />
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
              {(error || authError) && <p role="alert" className="mt-3 text-danger">{error || authError}</p>}
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

          {/* The guide: a popover that slides in beside the centred card, its tail pointing straight
              at the row that opened it. It stays mounted while it closes, so leaving the screen it
              belongs to fades it out instead of cutting it away. */}
          {guide !== 'closed' && (
            <aside
              id="login-api-guide"
              ref={popRef}
              aria-label="How to get your Telegram API credentials"
              className={`guide-pop z-40 rounded-2xl border border-border bg-panel/95 p-4 shadow-2xl backdrop-blur-xl ${guide === 'closing' ? 'is-closing' : ''}`}
              style={{
                '--guide-tail-top': tail ? `${tail.top}px` : undefined,
                '--guide-tail-x': tail ? `${tail.x}px` : undefined,
              } as CSSProperties}
            >
              <span className="guide-pop-tail" aria-hidden />
              <div className="flex items-start gap-2.5">
                <span className="grid size-9 shrink-0 place-items-center rounded-xl border border-primary/30 bg-primary/15 text-primary">
                  <BookOpen size={17} aria-hidden />
                </span>
                <h2 className="flex-1 pt-1 text-[13.5px] font-semibold leading-snug">How to get your Telegram API credentials</h2>
                <button
                  type="button"
                  onClick={closeGuide}
                  aria-label="Close guide"
                  className="-mr-1 -mt-1 rounded-md p-1.5 text-muted transition-colors hover:bg-tile hover:text-text"
                >
                  <X size={15} aria-hidden />
                </button>
              </div>

              <ol className="mt-3 space-y-2">
                {GUIDE_STEPS.map((s, i) => (
                  <li key={s.title} className="guide-step flex gap-3 rounded-xl border border-border/50 bg-tile/60 p-3">
                    <span className="grid size-6 shrink-0 place-items-center rounded-full bg-primary text-[11px] font-bold text-white">{i + 1}</span>
                    <div className="min-w-0">
                      <p className="text-[12.5px] font-semibold leading-snug text-text">{s.title}</p>
                      <p className="mt-0.5 text-[11.5px] leading-snug text-muted">{s.body}</p>
                    </div>
                  </li>
                ))}
              </ol>

              <div className="mt-3 flex justify-end border-t border-border/60 pt-2.5">
                <a
                  href="https://my.telegram.org"
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-1 text-[11.5px] font-semibold text-primary hover:underline"
                  aria-label="Open my.telegram.org"
                >
                  <span>Open my.telegram.org</span>
                  <ExternalLink size={11} aria-hidden />
                </a>
              </div>
            </aside>
          )}
        </div>
      </main>
    </div>
  )
}
