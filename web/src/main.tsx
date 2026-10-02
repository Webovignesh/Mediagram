import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import { ConfirmHost, Toaster } from './ui.tsx'
import './styles.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ConfirmHost>
      <App />
      <Toaster />
    </ConfirmHost>
  </StrictMode>
)
