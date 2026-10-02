import { useState, type FormEvent, useEffect } from 'react'
import { Send, ArrowLeft, ChevronDown, Key } from 'lucide-react'
import type { AuthState } from '../../../core/shapes.ts'
import { call, useCall } from '../api.ts'
import { Input, Button, toast } from '../ui.tsx'

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

// Phase 4.6: Full login flow with all auth steps
export default function Login() {
  const { data: auth, reload } = useCall<AuthState>('auth.get', undefined, ['auth'])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [overrideStep, setOverrideStep] = useState<string | null>(null)

  // Credentials step
  const [apiId, setApiId] = useState('')
  const [apiHash, setApiHash] = useState('')

  // Phone step
  const [countryCode, setCountryCode] = useState('+91')
  const [phone, setPhone] = useState('')

  // Code step
  const [code, setCode] = useState('')

  // Password step
  const [password, setPassword] = useState('')

  useEffect(() => {
    setError('')
  }, [auth?.step, overrideStep])

  async function submitCredentials(e: FormEvent) {
    e.preventDefault()
    if (!apiId.trim() || !apiHash.trim()) {
      toast('Telegram API ID and API Hash are required to use Mediagram', 'danger')
      setError('Telegram API ID and API Hash are required to use Mediagram. Please provide valid Telegram API credentials.')
      return
    }
    setBusy(true)
    setError('')
    try {
      await call('auth.credentials', { apiId: Number(apiId), apiHash: apiHash.trim() })
      setOverrideStep(null)
      reload()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function submitPhone(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      const trimmed = phone.trim().replace(/[\s()-]/g, '')
      const fullPhone = trimmed.startsWith('+') ? trimmed : `${countryCode}${trimmed.replace(/^0+/, '')}`
      await call('auth.phone', { phone: fullPhone })
      setOverrideStep(null)
      reload()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
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

  if (!auth) return null

  const step = overrideStep || auth.step
  const a = auth as any

  return (
    <div className="flex h-full flex-col">
      <div className="drag h-10 shrink-0" />
      <main className="grid flex-1 place-items-center overflow-auto p-6">
        <div className="w-[420px] max-w-full rounded-[14px] border border-border bg-panel p-6">
          <div className="mb-6 flex items-center gap-2">
            <span className="grid size-9 place-items-center rounded-xl bg-primary"><Send size={18} aria-hidden /></span>
            <span className="text-lg font-bold">Mediagram</span>
          </div>

          {step === 'credentials' && (
            <form onSubmit={submitCredentials}>
              <h1 className="text-xl font-semibold">Connect to Telegram</h1>
              <p className="mt-1 text-text-2">Enter the API ID and API hash of your Telegram app.</p>
              <div className="mt-5">
                <Input 
                  label="API ID"
                  placeholder="e.g. 2040 or 94575"
                  value={apiId} 
                  onChange={setApiId} 
                  inputMode="numeric" 
                  autoComplete="off" 
                  required 
                />
              </div>
              <div className="mt-3">
                <Input 
                  label="API hash"
                  placeholder="e.g. a3406de8d171bb422bb6ddf3bbd800e2"
                  value={apiHash} 
                  onChange={setApiHash} 
                  autoComplete="off" 
                  spellCheck={false} 
                  required 
                />
              </div>
              <button
                type="button"
                onClick={() => {
                  setApiId('94575')
                  setApiHash('a3406de8d171bb422bb6ddf3bbd800e2')
                  toast('Filled sample Telegram API key')
                }}
                className="mt-2.5 flex items-center justify-center gap-1.5 w-full text-center text-xs text-primary hover:underline py-1"
              >
                <Key size={12} />
                <span>Fill sample developer key</span>
              </button>
              {(error || a.error) && <p role="alert" className="mt-3 text-danger">{error || a.error}</p>}
              <div className="mt-5">
                <Button type="submit" busy={busy} disabled={busy}>
                  {busy ? 'Connecting…' : 'Continue'}
                </Button>
              </div>
              <a href="https://my.telegram.org" target="_blank" rel="noreferrer" className="mt-4 block text-center text-text-2 underline hover:text-text">
                Get them at my.telegram.org
              </a>
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
                  {busy ? 'Sending…' : 'Send Code'}
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

          {(step === 'starting' || step === 'logging-out') && (
            <div className="py-8 text-center text-text-2">
              {step === 'starting' ? 'Starting…' : 'Logging out…'}
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
