import { Component, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import { ConfirmHost, Toaster } from './ui.tsx'
import { applyTheme, getActiveTheme } from './theme.ts'
import './styles.css'

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }
  static getDerivedStateFromError(error: Error) { return { error } }
  componentDidCatch(error: Error, info: unknown) { console.error('React error:', error, info) }
  render() {
    if (this.state.error) {
      // The message only: a stack carries local file paths, which never belong in the window.
      return (
        <div style={{ padding: '2rem', color: '#fff', backgroundColor: '#060b18', height: '100vh' }}>
          <h1>Error</h1>
          <pre style={{ whiteSpace: 'pre-wrap' }}>{this.state.error.message}</pre>
        </div>
      )
    }
    return this.props.children
  }
}

/** A fatal message is text, never markup: an error message can carry a crafted string (no innerHTML here). */
function fatal(message: string) {
  const div = document.createElement('div')
  div.style.cssText = 'padding: 2rem; color: #fff;'
  div.textContent = message
  document.body.replaceChildren(div)
}

try {
  applyTheme(getActiveTheme().id)

  // Prevent default image drag ghost artifacts across the entire app
  if (typeof window !== 'undefined') {
    window.addEventListener('dragstart', (e) => {
      const target = e.target as HTMLElement | null
      if (target && (target.tagName === 'IMG' || target.closest('img'))) {
        e.preventDefault()
      }
    })
  }

  if (!window.mediagram && !window.teleflow) fatal('Error: Mediagram preload script failed.')
  else {
    createRoot(document.getElementById('root')!).render(
      <ErrorBoundary>
        <ConfirmHost>
          <App />
          <Toaster />
        </ConfirmHost>
      </ErrorBoundary>
    )
  }
} catch (err) {
  fatal(`Fatal error: ${err instanceof Error ? err.message : String(err)}`)
  console.error('Fatal error:', err)
}
