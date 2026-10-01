import { useState, type FormEvent } from 'react'
import { Send } from 'lucide-react'
import { call } from '../api.ts'

const input = 'mt-1 block w-full rounded-[10px] border border-border bg-tile px-3 py-2 text-text placeholder:text-muted focus:border-primary'

// API Keys step only; Phone, Code, Password, and the step indicator land in Phase 4 (UI.md > Login).
export default function Login() {
  const [apiId, setApiId] = useState('')
  const [apiHash, setApiHash] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      await call('auth.credentials', { apiId: Number(apiId), apiHash: apiHash.trim() })
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="drag h-10 shrink-0" />
      <main className="grid flex-1 place-items-center overflow-auto p-6">
        <form onSubmit={submit} className="w-[420px] max-w-full rounded-[14px] border border-border bg-panel p-6">
          <div className="mb-6 flex items-center gap-2">
            <span className="grid size-9 place-items-center rounded-xl bg-primary"><Send size={18} aria-hidden /></span>
            <span className="text-lg font-bold">TeleFlow</span>
          </div>
          <h1 className="text-xl font-semibold">Connect to Telegram</h1>
          <p className="mt-1 text-text-2">Enter the API ID and API hash of your Telegram app.</p>
          <label className="mt-5 block text-xs text-text-2">
            API ID
            <input className={input} value={apiId} onChange={(e) => setApiId(e.target.value)} inputMode="numeric" autoComplete="off" required />
          </label>
          <label className="mt-3 block text-xs text-text-2">
            API hash
            <input className={input} value={apiHash} onChange={(e) => setApiHash(e.target.value)} autoComplete="off" spellCheck={false} required />
          </label>
          {error && <p role="alert" className="mt-3 text-danger">{error}</p>}
          <button type="submit" disabled={busy} aria-busy={busy} className="mt-5 w-full rounded-[10px] bg-primary px-4 py-2 font-semibold hover:bg-primary-hover disabled:opacity-60">
            {busy ? 'Connecting…' : 'Continue'}
          </button>
          <a href="https://my.telegram.org" target="_blank" rel="noreferrer" className="mt-4 block text-center text-text-2 underline hover:text-text">
            Get them at my.telegram.org
          </a>
        </form>
      </main>
    </div>
  )
}
