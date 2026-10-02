import { type ReactNode } from 'react'
import { Loader2 } from 'lucide-react'

// Shared UI primitives (Phase 4.2): Button, Input, Badge, ProgressBar, Spinner, EmptyState, ErrorState, LoadingState

type Tone = 'primary' | 'success' | 'warning' | 'danger' | 'neutral'

export function Button({ 
  children, 
  variant = 'primary', 
  tone, 
  busy, 
  disabled, 
  type = 'button',
  onClick,
}: { 
  children: ReactNode
  variant?: 'primary' | 'secondary' | 'tint' | 'danger'
  tone?: Tone
  busy?: boolean
  disabled?: boolean
  type?: 'button' | 'submit'
  onClick?: () => void
}) {
  const base = 'rounded-[10px] px-4 py-2 font-semibold transition-colors disabled:opacity-60'
  const variants = {
    primary: 'bg-primary text-text hover:bg-primary-hover',
    secondary: 'border border-border bg-tile hover:border-primary',
    tint: tone === 'danger' ? 'bg-danger/15 border border-danger text-danger hover:bg-danger/25'
      : tone === 'success' ? 'bg-success/15 border border-success text-success hover:bg-success/25'
      : 'bg-primary/15 border border-primary text-primary hover:bg-primary/25',
    danger: 'bg-danger text-text hover:bg-danger/90',
  }
  return (
    <button 
      type={type}
      disabled={disabled || busy} 
      aria-busy={busy}
      onClick={onClick}
      className={`${base} ${variants[variant]}`}
    >
      {busy ? <Loader2 size={16} className="inline animate-spin" /> : children}
    </button>
  )
}

export function Input({ 
  label, 
  value, 
  onChange, 
  type = 'text',
  placeholder,
  required,
  autoComplete,
  inputMode,
  spellCheck,
}: {
  label?: string
  value: string
  onChange: (value: string) => void
  type?: 'text' | 'password' | 'tel'
  placeholder?: string
  required?: boolean
  autoComplete?: string
  inputMode?: 'text' | 'numeric' | 'tel'
  spellCheck?: boolean
}) {
  const input = 'mt-1 block w-full rounded-[10px] border border-border bg-tile px-3 py-2 text-text placeholder:text-muted focus:border-primary'
  const field = (
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      required={required}
      autoComplete={autoComplete}
      inputMode={inputMode}
      spellCheck={spellCheck}
      className={input}
    />
  )
  return label ? (
    <label className="block text-xs text-text-2">
      {label}
      {field}
    </label>
  ) : field
}

export function Badge({ count, tone = 'primary' }: { count: number, tone?: Tone }) {
  if (count === 0) return null
  const tones = {
    primary: 'bg-primary',
    success: 'bg-success',
    warning: 'bg-warning',
    danger: 'bg-danger',
    neutral: 'bg-tile',
  }
  return (
    <span className={`inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-xs font-semibold ${tones[tone]}`}>
      {count}
    </span>
  )
}

export function ProgressBar({ 
  percent, 
  tone = 'primary',
}: { 
  percent: number
  tone?: Tone
}) {
  const tones = {
    primary: 'bg-primary',
    success: 'bg-success',
    warning: 'bg-warning',
    danger: 'bg-danger',
    neutral: 'bg-muted',
  }
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-tile">
      <div 
        className={`h-full transition-all ${tones[tone]}`}
        style={{ width: `${Math.min(100, Math.max(0, percent))}%` }}
      />
    </div>
  )
}

export function Spinner({ size = 24 }: { size?: number }) {
  return <Loader2 size={size} className="animate-spin text-primary" aria-label="Loading" />
}

export function EmptyState({ 
  message, 
  action,
}: { 
  message: string
  action?: { label: string, onClick: () => void }
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-12 text-center text-muted">
      <p>{message}</p>
      {action && (
        <Button variant="secondary" onClick={action.onClick}>
          {action.label}
        </Button>
      )}
    </div>
  )
}

export function ErrorState({ 
  error, 
  onRetry,
}: { 
  error: string
  onRetry: () => void
}) {
  return (
    <div role="alert" className="flex flex-col items-center justify-center gap-3 py-12 text-center">
      <p className="text-danger">{error}</p>
      <Button variant="secondary" onClick={onRetry}>
        Retry
      </Button>
    </div>
  )
}

export function LoadingState() {
  return (
    <div className="flex items-center justify-center py-12">
      <Spinner />
    </div>
  )
}
