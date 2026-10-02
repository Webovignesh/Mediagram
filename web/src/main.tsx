import { Component, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import { ConfirmHost, Toaster } from './ui.tsx'
import './styles.css'

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }
  static getDerivedStateFromError(error: Error) { return { error } }
  componentDidCatch(error: Error, info: unknown) { console.error('React error:', error, info) }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: '2rem', color: '#fff', backgroundColor: '#060b18', height: '100vh' }}>
          <h1>Error</h1>
          <pre style={{ whiteSpace: 'pre-wrap' }}>{this.state.error.message}\n\n{this.state.error.stack}</pre>
        </div>
      )
    }
    return this.props.children
  }
}

try {
  if (!window.teleflow) {
    document.body.innerHTML = '<div style="padding: 2rem; color: #fff;">Error: window.teleflow is not defined. Preload script failed.</div>'
  } else {
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
  document.body.innerHTML = `<div style="padding: 2rem; color: #fff;">Fatal error: ${err instanceof Error ? err.message : String(err)}</div>`
  console.error('Fatal error:', err)
}
