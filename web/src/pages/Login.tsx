import { useState, type FormEvent, useEffect } from 'react'
import { Send, ArrowLeft } from 'lucide-react'
import type { AuthState } from '../../../core/shapes.ts'
import { call, useCall } from '../api.ts'
import { Input, Button } from '../ui.tsx'

// Phase 4.6: Full login flow with all auth steps
export default function Login() {
  const { data: auth, reload } = useCall<AuthState>('auth.get', undefined, ['auth'])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  // Credentials step
  const [apiId, setApiId] = useState('')
  const [apiHash, setApiHash] = useState('')

  // Phone step
  const [phone, setPhone] = useState('')

  // Code step
  const [code, setCode] = useState('')

  // Password step
  const [password, setPassword] = useState('')

  useEffect(() => {
    setError('')
  }, [auth?.step])

  async function submitCredentials(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      await call('auth.credentials', { apiId: Number(apiId), apiHash: apiHash.trim() })
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
      await call('auth.phone', { phone: phone.trim() })
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
      await call('auth.logout', { local: true })
      reload()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  if (!auth) return null

  const step = auth.step

  return (
    <div className="flex h-full flex-col">
      <div className="drag h-10 shrink-0" />
      <main className="grid flex-1 place-items-center overflow-auto p-6">
        <div className="w-[420px] max-w-full rounded-[14px] border border-border bg-panel p-6">
          <div className="mb-6 flex items-center gap-2">
            <span className="grid size-9 place-items-center rounded-xl bg-primary"><Send size={18} aria-hidden /></span>
            <span className="text-lg font-bold">TeleFlow</span>
          </div>

          {step === 'credentials' && (
            <form onSubmit={submitCredentials}>
              <h1 className="text-xl font-semibold">Connect to Telegram</h1>
              <p className="mt-1 text-text-2">Enter the API ID and API hash of your Telegram app.</p>
              <div className="mt-5">
                <Input 
                  label="API ID"
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
                  value={apiHash} 
                  onChange={setApiHash} 
                  autoComplete="off" 
                  spellCheck={false} 
                  required 
                />
              </div>
              {(error || auth.error) && <p role="alert" className="mt-3 text-danger">{error || auth.error}</p>}
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
                <Input 
                  label="Phone number"
                  value={phone} 
                  onChange={setPhone} 
                  type="tel"
                  inputMode="tel"
                  placeholder="+1234567890"
                  autoComplete="tel" 
                  required 
                />
              </div>
              {(error || auth.error) && <p role="alert" className="mt-3 text-danger">{error || auth.error}</p>}
              <div className="mt-5 flex gap-2">
                <Button variant="secondary" onClick={goBack} disabled={busy}>
                  <ArrowLeft size={16} className="inline" /> Back
                </Button>
                <Button type="submit" busy={busy} disabled={busy}>
                  {busy ? 'Sending…' : 'Send Code'}
                </Button>
              </div>
            </form>
          )}

          {step === 'code' && (
            <form onSubmit={submitCode}>
              <h1 className="text-xl font-semibold">Verification Code</h1>
              <p className="mt-1 text-text-2">
                Enter the code sent to {auth.phone} via {auth.via === 'telegram' ? 'Telegram' : auth.via === 'sms' ? 'SMS' : auth.via === 'call' ? 'phone call' : 'another method'}.
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
                <Button variant="secondary" onClick={goBack} disabled={busy}>
                  <ArrowLeft size={16} className="inline" /> Back
                </Button>
                <Button type="submit" busy={busy} disabled={busy}>
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
                {auth.hint && <span className="block mt-1">Hint: {auth.hint}</span>}
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
                <Button variant="secondary" onClick={goBack} disabled={busy}>
                  <ArrowLeft size={16} className="inline" /> Back
                </Button>
                <Button type="submit" busy={busy} disabled={busy}>
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
