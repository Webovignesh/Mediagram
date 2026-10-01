import { useEffect, useState } from 'react'
import type { AuthState } from '../../core/shapes.ts'
import { call } from './api.ts'
import Login from './pages/Login.tsx'

export default function App() {
  const [auth, setAuth] = useState<AuthState>()
  const [error, setError] = useState('')

  const load = () => {
    setError('')
    call<AuthState>('auth.get').then(setAuth, (e: Error) => setError(e.message))
  }
  useEffect(load, [])

  if (error) {
    return (
      <div className="flex h-full flex-col">
        <div className="drag h-10 shrink-0" />
        <div role="alert" className="grid flex-1 place-content-center gap-3 text-center">
          <p>{error}</p>
          <button type="button" onClick={load} className="justify-self-center rounded-[10px] border border-border bg-tile px-4 py-2 hover:border-primary">Retry</button>
        </div>
      </div>
    )
  }
  if (!auth) return null
  // The shell for the ready state lands in Phase 4; until then every step shows Login.
  return auth.step === 'ready' ? null : <Login />
}
