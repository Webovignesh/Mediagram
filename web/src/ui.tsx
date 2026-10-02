// Phase 5: Complete UI primitives per UI.md
import { type ReactNode, type LegacyRef, useState, useEffect, useRef, createContext, useContext } from 'react'
import { Loader2, ChevronDown, X, Search, Check, Pause, Play, Download } from 'lucide-react'
import { call } from './api.ts'

type Tone = 'primary' | 'success' | 'warning' | 'danger' | 'neutral'
type Status = 'queued' | 'active' | 'paused' | 'completed' | 'failed'
type Kind = 'download' | 'upload'

// Formatters per UI.md
const fmtBase = new Intl.NumberFormat('en', { maximumFractionDigits: 1 })
export const fmtBytes = (n: number) => {
  if (n === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.min(Math.floor(Math.log(n) / Math.log(1024)), units.length - 1)
  return `${fmtBase.format(n / 1024 ** i)} ${units[i]}`
}
export const fmtSpeed = (n: number) => `${fmtBytes(n)}/s`
export const fmtEta = (s: number | null) => {
  if (s === null || s <= 0) return null
  if (s < 60) return `${Math.round(s)}s`
  if (s < 3600) return `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`
}
const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto', style: 'short' })
export const fmtAgo = (unix: number) => {
  if (unix === 0) return 'Never'
  const s = (Date.now() - unix * 1000) / 1000
  if (s < 60) return rtf.format(-Math.floor(s), 'second')
  if (s < 3600) return rtf.format(-Math.floor(s / 60), 'minute')
  if (s < 86400) return rtf.format(-Math.floor(s / 3600), 'hour')
  if (s < 2592000) return rtf.format(-Math.floor(s / 86400), 'day')
  return rtf.format(-Math.floor(s / 2592000), 'month')
}
export const fmtDuration = (s: number) => {
  if (s < 60) return `0:${String(s).padStart(2, '0')}`
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}
export const fmtCount = (n: number) => n.toLocaleString('en')
const dateFormat = new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', year: 'numeric' })
export const fmtDate = (unix: number) => dateFormat.format(new Date(unix * 1000))
export const typeLabel: Record<string, string> = {
  video_note: 'video message', voice: 'voice message', animation: 'GIF', album: 'album',
  video: 'video', photo: 'photo', document: 'document', audio: 'audio',
}

// Components
export function Button({ 
  children, variant = 'primary', tone, busy, disabled, type = 'button', onClick, className,
}: { 
  children: ReactNode, variant?: 'primary' | 'secondary' | 'tint' | 'danger', tone?: Tone, busy?: boolean
  disabled?: boolean, type?: 'button' | 'submit', onClick?: () => void, className?: string
}) {
  const base = 'rounded-md px-3.5 py-1.5 text-[13px] font-medium transition-colors disabled:opacity-60'
  const variants = {
    primary: 'bg-primary text-text hover:bg-[#3b82f6]',
    secondary: 'border border-border bg-tile hover:border-primary',
    tint: tone === 'danger' ? 'bg-danger/15 border border-danger text-danger hover:bg-danger/25'
      : tone === 'success' ? 'bg-success/15 border border-success text-success hover:bg-success/25'
      : 'bg-primary/15 border border-primary text-primary hover:bg-primary/25',
    danger: 'bg-danger text-text hover:bg-danger/90',
  }
  return (
    <button 
      type={type} disabled={disabled || busy} aria-busy={busy} onClick={onClick}
      className={`${base} ${variants[variant]} ${className || ''}`}
    >
      {busy ? <Loader2 size={16} className="inline animate-spin" /> : children}
    </button>
  )
}

export function IconButton({ 
  icon, label, onClick, variant = 'secondary', tone, disabled, className,
}: {
  icon: ReactNode, label: string, onClick: () => void, variant?: 'primary' | 'secondary' | 'tint'
  tone?: Tone, disabled?: boolean, className?: string
}) {
  return (
    <button
      onClick={onClick} disabled={disabled} aria-label={label} title={label}
      className={`rounded-md p-2 transition-colors ${variant === 'primary' ? 'bg-primary hover:bg-[#3b82f6]'
        : variant === 'tint' && tone === 'danger' ? 'bg-danger/15 hover:bg-danger/25' : 'bg-tile hover:bg-tile/80'} ${className || ''}`}
    >
      {icon}
    </button>
  )
}

export function Input({ 
  label, value, onChange, type = 'text', placeholder, required, autoComplete, inputMode, spellCheck,
}: {
  label?: string, value: string, onChange: (value: string) => void, type?: 'text' | 'password' | 'tel'
  placeholder?: string, required?: boolean, autoComplete?: string
  inputMode?: 'text' | 'numeric' | 'tel', spellCheck?: boolean
}) {
  const input = 'mt-1 block w-full rounded-md border border-border bg-tile px-3 py-2 text-[13px] text-text placeholder:text-muted focus:border-primary'
  const field = (
    <input
      type={type} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
      required={required} autoComplete={autoComplete} inputMode={inputMode} spellCheck={spellCheck}
      className={input}
    />
  )
  return label ? <label className="block text-[12px] text-text-2">{label}{field}</label> : field
}

export function Panel({ title, icon, subtitle, action, children }: { 
  title?: string, icon?: ReactNode, subtitle?: string, action?: ReactNode, children: ReactNode 
}) {
  return (
    <div className="rounded-lg border border-border bg-panel/85 p-4 backdrop-blur">
      {title && (
        <div className="mb-4 flex items-start justify-between">
          <div className="flex items-center gap-3">
            {icon && <div className="text-primary">{icon}</div>}
            <div>
              <h3 className="text-[15px] font-semibold">{title}</h3>
              {subtitle && <p className="text-[13px] text-text-2">{subtitle}</p>}
            </div>
          </div>
          {action}
        </div>
      )}
      {children}
    </div>
  )
}

export function IconTile({ icon, tone = 'primary' }: { icon: ReactNode, tone?: Tone }) {
  const tones = {
    primary: 'bg-primary/15 border-primary/30', success: 'bg-success/15 border-success/30',
    warning: 'bg-warning/15 border-warning/30', danger: 'bg-danger/15 border-danger/30',
    neutral: 'bg-tile border-border',
  }
  return <div className={`flex h-10 w-10 items-center justify-center rounded-xl border ${tones[tone]}`}>{icon}</div>
}

export function Stat({ icon, tone, label, value, split }: { 
  icon: ReactNode, tone?: Tone, label: string, value: number | string | undefined, split?: string 
}) {
  if (value === undefined) return <div className="flex gap-3"><IconTile icon={icon} tone={tone} /><div className="h-10 w-20 animate-pulse rounded bg-tile" /></div>
  return (
    <div className="flex gap-3">
      <IconTile icon={icon} tone={tone} />
      <div>
        <div className="text-[12px] text-muted">{label}</div>
        <div className="text-[22px] font-bold tabular-nums">{typeof value === 'number' ? fmtCount(value) : value}</div>
        {split && <div className="text-[11px] text-text-2">{split}</div>}
      </div>
    </div>
  )
}

export function Pill({
  kind,
  status,
  finalizing,
  label,
}: {
  kind?: Kind
  status?: Status | 'none' | 'downloaded' | string
  finalizing?: boolean
  label?: string
}) {
  if (label) {
    return <span className="inline-flex h-6 items-center justify-center rounded-full border border-white/10 bg-white/5 px-3 text-[11px] font-medium text-text-2 whitespace-nowrap shrink-0">{label}</span>
  }
  if (finalizing) {
    return (
      <span className="inline-flex h-6 items-center justify-center gap-1.5 rounded-full border border-warning/40 bg-warning/15 px-3 text-[11px] font-semibold text-warning whitespace-nowrap shrink-0">
        <span className="size-1.5 rounded-full bg-warning animate-pulse" />
        Finalizing
      </span>
    )
  }
  if (status === 'downloading' || (status === 'active' && kind !== 'upload')) {
    return (
      <span className="inline-flex h-6 items-center justify-center gap-1.5 rounded-full border border-cyan/40 bg-cyan/15 px-3 text-[11px] font-semibold text-cyan whitespace-nowrap shrink-0">
        <span className="size-1.5 rounded-full bg-cyan animate-pulse" />
        Downloading
      </span>
    )
  }
  if (status === 'uploading' || (status === 'active' && kind === 'upload')) {
    return (
      <span className="inline-flex h-6 items-center justify-center gap-1.5 rounded-full border border-upload/40 bg-upload/15 px-3 text-[11px] font-semibold text-upload whitespace-nowrap shrink-0">
        <span className="size-1.5 rounded-full bg-upload animate-pulse" />
        Uploading
      </span>
    )
  }
  if (status === 'uploaded' || (status === 'completed' && kind === 'upload')) {
    return (
      <span className="inline-flex h-6 items-center justify-center gap-1.5 rounded-full border border-success/40 bg-success/15 px-3 text-[11px] font-semibold text-success whitespace-nowrap shrink-0">
        <span className="size-1.5 rounded-full bg-success" />
        Uploaded
      </span>
    )
  }
  if (status === 'downloaded' || (status === 'completed' && kind !== 'upload')) {
    return (
      <span className="inline-flex h-6 items-center justify-center gap-1.5 rounded-full border border-success/40 bg-success/15 px-3 text-[11px] font-semibold text-success whitespace-nowrap shrink-0">
        <span className="size-1.5 rounded-full bg-success" />
        Downloaded
      </span>
    )
  }
  if (status === 'queued') {
    return (
      <span className="inline-flex h-6 items-center justify-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3 text-[11px] font-semibold text-text-2 whitespace-nowrap shrink-0">
        <span className="size-1.5 rounded-full bg-muted" />
        Queued
      </span>
    )
  }
  if (status === 'paused') {
    return (
      <span className="inline-flex h-6 items-center justify-center gap-1.5 rounded-full border border-warning/40 bg-warning/15 px-3 text-[11px] font-semibold text-warning whitespace-nowrap shrink-0">
        <span className="size-1.5 rounded-full bg-warning" />
        Paused
      </span>
    )
  }
  if (status === 'failed') {
    return (
      <span className="inline-flex h-6 items-center justify-center gap-1.5 rounded-full border border-danger/40 bg-danger/15 px-3 text-[11px] font-semibold text-danger whitespace-nowrap shrink-0">
        <span className="size-1.5 rounded-full bg-danger" />
        Failed
      </span>
    )
  }
  return <span className="inline-flex h-6 items-center justify-center rounded-full border border-white/10 bg-white/5 px-3 text-[11px] font-medium text-muted whitespace-nowrap shrink-0">Not downloaded</span>
}

export function Progress({ done, size, tone = 'primary' }: { done: number, size: number, tone?: Tone }) {
  const percent = size > 0 ? (done / size) * 100 : 0
  const tones = {
    primary: 'bg-cyan',
    success: 'bg-success',
    warning: 'bg-upload',
    danger: 'bg-danger',
    neutral: 'bg-muted',
  }
  return (
    <div className="w-full">
      <div className="flex items-center justify-between text-[11px] mb-1 font-medium">
        <span className="tabular-nums font-semibold text-text">{Math.round(percent)}%</span>
        <span className="text-muted tabular-nums">{fmtBytes(done)} / {fmtBytes(size)}</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/[0.08]">
        <div
          className={`h-full rounded-full transition-all duration-300 ${tones[tone]}`}
          style={{ width: `${Math.min(100, Math.max(percent > 0 ? 1 : 0, percent))}%` }}
        />
      </div>
    </div>
  )
}

export function Chip({ label, active, count, tone, onClick }: { 
  label: string, active: boolean, count?: number, tone?: Tone, onClick: () => void 
}) {
  const dot = tone ? <span className={`mr-1.5 h-2 w-2 rounded-full ${tone === 'success' ? 'bg-success' : tone === 'warning' ? 'bg-warning' : tone === 'danger' ? 'bg-danger' : 'bg-muted'}`} /> : null
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-medium transition ${
        active ? 'bg-primary text-text' : 'border border-border bg-tile hover:border-primary'
      }`}
    >
      {dot}{label}{count !== undefined && <span className="text-[11px] opacity-75">({count})</span>}
    </button>
  )
}

export function Badge({ count }: { count: number }) {
  if (count === 0) return null
  return <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[11px] font-semibold">{count}</span>
}

export function Select({ label, value, options, onChange, className }: { 
  label?: string, value: string | number, options: { value: string | number, label: string }[], 
  onChange: (value: string | number) => void, className?: string 
}) {
  const sel = (
    <div className="relative">
      <select
        value={value} onChange={(e) => onChange(options.find((o) => String(o.value) === e.target.value)!.value)}
        className={`appearance-none rounded-md border border-border bg-tile py-1.5 pl-3 pr-8 text-[12.5px] hover:border-primary ${className || ''}`}
      >
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      <ChevronDown size={14} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-muted" />
    </div>
  )
  return label ? <label className="block text-[12px] text-muted">{label}<div className="mt-1">{sel}</div></label> : sel
}

export function Segmented({ options, value, onChange }: { 
  options: { value: string, label: string, icon: ReactNode }[], value: string, onChange: (v: string) => void 
}) {
  return (
    <div role="radiogroup" className="inline-flex gap-1 rounded-md bg-tile p-1">
      {options.map((o) => (
        <button
          key={o.value} role="radio" aria-checked={value === o.value} onClick={() => onChange(o.value)}
          className={`flex items-center gap-2 rounded-md px-3 py-1.5 text-[12.5px] font-medium transition ${
            value === o.value ? 'bg-primary text-text' : 'hover:bg-tile/60'
          }`}
        >
          {o.icon}{o.label}
        </button>
      ))}
    </div>
  )
}

export function Toggle({
  label,
  checked,
  onChange,
  disabled,
}: {
  label?: string
  checked: boolean
  onChange: (v: boolean) => void
  disabled?: boolean
}) {
  return (
    <label
      onClick={(e) => {
        e.preventDefault()
        if (!disabled) onChange(!checked)
      }}
      className={`inline-flex items-center gap-3 select-none ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
    >
      <input
        type="checkbox"
        role="switch"
        aria-checked={checked}
        checked={checked}
        onChange={() => {}}
        className="sr-only"
        disabled={disabled}
      />
      <div
        className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors duration-200 ease-in-out ${
          checked ? 'bg-primary border-primary' : 'bg-tile border-border'
        }`}
      >
        <span
          className={`pointer-events-none inline-block size-4 rounded-full bg-white shadow transition-transform duration-200 ease-in-out ${
            checked ? 'translate-x-6' : 'translate-x-1'
          }`}
        />
      </div>
      {label && <span className="text-[13px] text-text font-medium">{label}</span>}
    </label>
  )
}

export function SearchInput({ value, onChange, placeholder, className }: { 
  value: string, onChange: (v: string) => void, placeholder: string, className?: string 
}) {
  return (
    <div className={`relative ${className || ''}`}>
      <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
      <input
        type="search" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
        className="w-full rounded-lg border border-border bg-tile py-1.5 pl-9 pr-3 text-[12.5px] placeholder:text-muted focus:border-primary outline-none"
      />
      {value && (
        <button onClick={() => onChange('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted hover:text-text">
          <X size={14} />
        </button>
      )}
    </div>
  )
}

export function Pagination({ page, pageSize, total, onPage }: { 
  page: number, pageSize: number, total: number, onPage: (p: number) => void 
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize))
  const from = Math.min(total, (page - 1) * pageSize + 1)
  const to = Math.min(total, page * pageSize)
  return (
    <div className="flex items-center justify-between text-[13px]">
      <div className="text-muted">Showing {from}–{to} of {fmtCount(total)} items</div>
      <div className="flex gap-1">
        <Button variant="secondary" disabled={page === 1} onClick={() => onPage(page - 1)}>‹ Previous</Button>
        {page > 2 && <Button variant="secondary" onClick={() => onPage(1)}>1</Button>}
        {page > 3 && <span className="px-2 py-2">...</span>}
        {page > 1 && <Button variant="secondary" onClick={() => onPage(page - 1)}>{page - 1}</Button>}
        <Button variant="primary">{page}</Button>
        {page < pages && <Button variant="secondary" onClick={() => onPage(page + 1)}>{page + 1}</Button>}
        {page < pages - 2 && <span className="px-2 py-2">...</span>}
        {page < pages - 1 && <Button variant="secondary" onClick={() => onPage(pages)}>{pages}</Button>}
        <Button variant="secondary" disabled={page === pages} onClick={() => onPage(page + 1)}>Next ›</Button>
      </div>
    </div>
  )
}

export function Avatar({ src, name, size = 36 }: { src: string | null, name: string, size?: number }) {
  const colors = ['#e91e63', '#9c27b0', '#3f51b5', '#2196f3', '#009688', '#4caf50', '#ff9800', '#ff5722']
  const color = colors[name.charCodeAt(0) % colors.length]
  return src ? (
    <img src={`teleflow://thumb/${src}`} alt={name} className="rounded-lg object-cover" style={{ width: size, height: size }} />
  ) : (
    <div className="flex items-center justify-center rounded-lg font-semibold" style={{ width: size, height: size, backgroundColor: color }}>
      {name[0]?.toUpperCase()}
    </div>
  )
}

export function Thumb({ src, name }: { src: string | null, name: string }) {
  const [failed, setFailed] = useState(false)
  const ext = (name.split('.').pop() || 'FILE').toUpperCase()

  if (!src || failed) {
    return (
      <div className="flex h-7 w-10 shrink-0 items-center justify-center rounded bg-tile text-[9px] font-bold uppercase text-muted border border-border/40">
        {ext.slice(0, 3)}
      </div>
    )
  }

  const url = src.startsWith('teleflow://') || src.startsWith('data:') || src.startsWith('blob:') || src.startsWith('http')
    ? src
    : `teleflow://thumb/${src}`

  return (
    <img
      src={url}
      alt={name}
      onError={() => setFailed(true)}
      className="h-7 w-10 shrink-0 rounded object-cover border border-border/40"
    />
  )
}

export function TypeChip({ ext }: { ext: string }) {
  return <span className="rounded border border-border px-1.5 py-0.5 text-[10px] font-bold uppercase text-muted">{ext}</span>
}

type MenuProps = { trigger: ReactNode, items: { label: string, onClick: () => void, danger?: boolean }[] }
export function Menu({ trigger, items }: MenuProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('click', close)
    return () => document.removeEventListener('click', close)
  }, [open])
  return (
    <div ref={ref} className="relative">
      <div onClick={() => setOpen(!open)}>{trigger}</div>
      {open && (
        <div className="absolute right-0 z-50 mt-1 min-w-[160px] rounded-lg border border-border bg-panel shadow-lg">
          {items.map((item, i) => (
            <button
              key={i} onClick={() => { item.onClick(); setOpen(false) }}
              className={`block w-full px-3 py-2 text-left text-[13px] hover:bg-tile ${item.danger ? 'text-danger' : ''}`}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export function Dialog({ open, onClose, title, children, actions }: { 
  open: boolean, onClose: () => void, title: string, children: ReactNode, actions?: ReactNode 
}) {
  useEffect(() => {
    if (!open) return
    const handleEscape = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handleEscape)
    return () => window.removeEventListener('keydown', handleEscape)
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm select-none"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-md rounded-xl border border-border bg-[#1e293b] p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-3 text-[17px] font-bold text-text">{title}</h2>
        <div className="mb-4 text-text">{children}</div>
        {actions && <div className="flex justify-end gap-2">{actions}</div>}
      </div>
    </div>
  )
}

type ConfirmOpts = {
  title: string
  message: string
  confirm: string
  danger?: boolean
  typed?: string
  checkbox?: string
}

type ConfirmState = {
  opts: ConfirmOpts
  resolve: (value: boolean) => void
}

let confirmDispatcher: ((s: ConfirmState | null) => void) | null = null

export function confirm(opts: ConfirmOpts): Promise<boolean> {
  if (!confirmDispatcher) {
    return Promise.resolve(window.confirm(`${opts.title}\n\n${opts.message}`))
  }
  return new Promise<boolean>((resolve) => {
    confirmDispatcher!({ opts, resolve })
  })
}

export function ConfirmHost({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ConfirmState | null>(null)
  const [typed, setTyped] = useState('')
  const [checked, setChecked] = useState(false)

  useEffect(() => {
    confirmDispatcher = (s) => {
      setTyped('')
      setChecked(false)
      setState(s)
    }
    return () => { confirmDispatcher = null }
  }, [])

  const close = (result: boolean) => {
    state?.resolve(result)
    setState(null)
    setTyped('')
    setChecked(false)
  }

  return (
    <>
      {children}
      {state && (
        <Dialog open title={state.opts.title} onClose={() => close(false)}>
          <p className="text-[13px] text-text-2">{state.opts.message}</p>
          {state.opts.typed && (
            <input
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder={`Type ${state.opts.typed} to confirm`}
              className="mt-3 w-full rounded-[10px] border border-border bg-tile px-3 py-2 text-[13px] text-text focus:border-primary outline-none"
              autoFocus
            />
          )}
          {state.opts.checkbox && (
            <label className="mt-3 flex items-center gap-2 text-[13px] text-text cursor-pointer select-none">
              <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} />
              <span>{state.opts.checkbox}</span>
            </label>
          )}
          <div className="mt-5 flex justify-end gap-2">
            <Button variant="secondary" onClick={() => close(false)}>Cancel</Button>
            <Button
              variant={state.opts.danger ? 'danger' : 'primary'}
              disabled={Boolean(state.opts.typed && typed.trim().toUpperCase() !== state.opts.typed.trim().toUpperCase())}
              onClick={() => close(true)}
            >
              {state.opts.confirm}
            </Button>
          </div>
        </Dialog>
      )}
    </>
  )
}

const toasts: { id: number, message: string, tone?: Tone }[] = []
const toastListeners = new Set<() => void>()
let toastId = 0
export function toast(message: string, tone?: Tone) {
  const id = toastId++
  toasts.push({ id, message, tone })
  toastListeners.forEach((l) => l())
  setTimeout(() => {
    const i = toasts.findIndex((t) => t.id === id)
    if (i >= 0) toasts.splice(i, 1)
    toastListeners.forEach((l) => l())
  }, tone === 'danger' ? 8000 : 4000)
}
export function Toaster() {
  const [, setTick] = useState(0)
  useEffect(() => {
    const cb = () => setTick((t) => t + 1)
    toastListeners.add(cb)
    return () => { toastListeners.delete(cb) }
  }, [])
  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2">
      {toasts.map((t) => (
        <div
          key={t.id} role={t.tone === 'danger' ? 'alert' : 'status'}
          className={`rounded-lg border px-4 py-3 shadow-lg ${
            t.tone === 'danger' ? 'border-danger bg-danger/10 text-danger' : 'border-border bg-panel text-text'
          }`}
        >
          {t.message}
        </div>
      ))}
    </div>
  )
}

export function Empty({ message, action }: { message: string, action?: { label: string, onClick: () => void } }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-12 text-center text-muted">
      <p className="text-[13px]">{message}</p>
      {action && <Button variant="secondary" onClick={action.onClick}>{action.label}</Button>}
    </div>
  )
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={`animate-pulse rounded bg-tile ${className || 'h-4 w-20'}`} />
}

export function ErrorState({ error, onRetry }: { error: string, onRetry: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-center justify-center gap-3 py-12 text-center">
      <p className="text-[13px] text-danger">{error}</p>
      <Button variant="secondary" onClick={onRetry}>Retry</Button>
    </div>
  )
}

export function OpenChatDialog({
  open,
  onClose,
  onSuccess,
}: {
  open: boolean
  onClose: () => void
  onSuccess?: (chatId: number) => void
}) {
  const [link, setLink] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [invite, setInvite] = useState<{ title: string, members: number, photo: string | null } | null>(null)

  const handleOpen = async (join = false) => {
    if (!link.trim()) return
    setBusy(true)
    setError('')
    try {
      const res = await call<any>('chats.open', { link: link.trim(), join })
      if (res.invite && !join) {
        setInvite(res.invite)
      } else if (res.chat) {
        onSuccess?.(res.chat.id)
        onClose()
        setLink('')
        setInvite(null)
      }
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const resetAndClose = () => {
    setLink('')
    setError('')
    setInvite(null)
    onClose()
  }

  return (
    <Dialog open={open} onClose={resetAndClose} title={invite ? 'Join Channel?' : 'Connect Channel or Chat'}>
      {invite ? (
        <div>
          <p className="text-[13px] text-text-2">
            Do you want to join <strong className="text-text">{invite.title}</strong> ({invite.members} members)?
          </p>
          {error && <p role="alert" className="mt-3 text-[13px] text-danger">{error}</p>}
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setInvite(null)} disabled={busy}>Back</Button>
            <Button variant="primary" busy={busy} onClick={() => handleOpen(true)}>Join & Open</Button>
          </div>
        </div>
      ) : (
        <div>
          <p className="text-[13px] text-text-2 mb-3">
            Enter a public channel username (@channel), t.me link, or private invite link.
          </p>
          <input
            type="text"
            placeholder="@username, t.me/channel, or https://t.me/+..."
            value={link}
            onChange={(e) => setLink(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleOpen(false) }}
            className="w-full rounded-[10px] border border-border bg-tile px-3 py-2 text-[13px] text-text placeholder:text-muted focus:border-primary outline-none"
          />
          {error && <p role="alert" className="mt-3 text-[13px] text-danger">{error}</p>}
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="secondary" onClick={resetAndClose} disabled={busy}>Cancel</Button>
            <Button variant="primary" busy={busy} disabled={!link.trim()} onClick={() => handleOpen(false)}>Open</Button>
          </div>
        </div>
      )}
    </Dialog>
  )
}

export function TransferCard({
  job,
  onPause,
  onResume,
  onCancel,
}: {
  job: any
  onPause?: (id: number) => void
  onResume?: (id: number) => void
  onCancel?: (id: number) => void
}) {
  return (
    <div className="rounded-xl border border-white/[0.08] bg-[#0c142b]/80 p-3 shadow-sm hover:border-white/20 transition-colors">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2.5 overflow-hidden min-w-0 flex-1">
          <Thumb src={job.thumb} name={job.name} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13px] font-medium text-text" title={job.name}>{job.name}</div>
            {job.chatTitle && <div className="text-[11px] text-muted truncate">{job.chatTitle}</div>}
          </div>
        </div>
        <Pill kind={job.kind} status={job.status} finalizing={job.finalizing} />
      </div>
      <div className="mt-2.5">
        <Progress done={job.done || 0} size={job.size || 0} tone={job.kind === 'upload' ? 'warning' : 'primary'} />
      </div>
      <div className="mt-2 flex items-center justify-between text-[11px] text-text-2">
        <div className="flex items-center gap-2">
          {job.speed > 0 && <span className="text-cyan font-semibold tabular-nums">{fmtSpeed(job.speed)}</span>}
          <span>{job.status === 'active' && job.eta ? `${fmtEta(job.eta)} left` : fmtBytes(job.size || 0)}</span>
        </div>
        <div className="flex items-center gap-1">
          {job.status === 'active' && onPause && (
            <button
              onClick={() => onPause(job.id)}
              className="rounded p-1 hover:bg-white/10 text-muted hover:text-text transition-colors"
              title="Pause"
            >
              <Pause size={13} />
            </button>
          )}
          {job.status === 'paused' && onResume && (
            <button
              onClick={() => onResume(job.id)}
              className="rounded p-1 hover:bg-white/10 text-muted hover:text-text transition-colors"
              title="Resume"
            >
              <Play size={13} />
            </button>
          )}
          {onCancel && (
            <button
              onClick={() => onCancel(job.id)}
              className="rounded p-1 hover:bg-danger/20 text-muted hover:text-danger transition-colors"
              title="Cancel"
            >
              <X size={13} />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

export function MediaPreviewModal({
  open,
  item,
  onClose,
  onDownload,
}: {
  open: boolean
  item: {
    name: string
    path?: string | null
    thumb?: string | null
    type?: string
    size?: number
    duration?: number
  } | null
  onClose: () => void
  onDownload?: () => void
}) {
  const [downloading, setDownloading] = useState(false)

  useEffect(() => {
    if (!open) {
      setDownloading(false)
      return
    }
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [open, onClose])

  if (!open || !item) return null

  const ext = item.name.split('.').pop()?.toLowerCase() || ''
  const isVideo = ['mp4', 'webm', 'mkv', 'mov', 'm4v'].includes(ext) || item.type === 'video' || item.type === 'video_note'
  const isImage = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp'].includes(ext) || item.type === 'photo' || item.type === 'image'
  const isAudio = ['mp3', 'ogg', 'wav', 'flac', 'm4a', 'aac'].includes(ext) || item.type === 'audio' || item.type === 'voice'

  const localUrl = item.path ? `teleflow://file/${encodeURIComponent(item.path)}` : null
  const thumbUrl = item.thumb ? `teleflow://thumb/${item.thumb}` : null

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/85 p-6 backdrop-blur-md"
      onClick={onClose}
    >
      <div
        className="relative flex w-[90vw] max-w-5xl max-h-[92vh] min-h-[520px] flex-col rounded-2xl border border-white/10 bg-[#121c2d] p-6 shadow-2xl backdrop-blur-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="mb-4 flex items-center justify-between gap-4 border-b border-border/50 pb-3">
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-[15px] font-bold text-text" title={item.name}>
              {item.name}
            </h3>
            <div className="mt-0.5 flex items-center gap-3 text-[11px] text-muted">
              {item.size ? <span>{fmtBytes(item.size)}</span> : null}
              {item.duration ? <span>{fmtDuration(item.duration)}</span> : null}
              <TypeChip ext={ext.toUpperCase()} />
            </div>
          </div>
          <div className="flex items-center gap-2">
            {item.path ? (
              <Button
                variant="secondary"
                onClick={() => call('library.open', { path: item.path })}
                className="py-1.5 px-3.5 text-[12px]"
              >
                Open in App
              </Button>
            ) : onDownload ? (
              <Button
                variant="primary"
                onClick={() => {
                  setDownloading(true)
                  onDownload()
                }}
                className="py-1.5 px-3.5 text-[12px] flex items-center gap-1.5"
              >
                <Download size={14} /> Download
              </Button>
            ) : null}
            <button
              onClick={onClose}
              className="flex size-8 items-center justify-center rounded-lg border border-border bg-tile text-text-2 hover:border-primary hover:text-text transition-colors"
              title="Close (Esc)"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Media Content */}
        <div className="flex flex-1 items-center justify-center overflow-hidden min-h-[440px] bg-black/50 rounded-xl p-2 border border-white/5">
          {isVideo ? (
            localUrl ? (
              <video
                src={localUrl}
                controls
                autoPlay
                className="max-h-[75vh] w-full max-w-4xl rounded-lg shadow-2xl bg-black object-contain"
              />
            ) : (
              <div className="flex flex-col items-center justify-center gap-4 py-4 px-2 text-center w-full">
                {thumbUrl ? (
                  <div className="relative w-full max-w-4xl h-[60vh] flex items-center justify-center overflow-hidden rounded-2xl bg-black/90 shadow-2xl">
                    <img src={thumbUrl} alt={item.name} className="w-full h-full object-contain rounded-2xl" />
                    <button
                      type="button"
                      onClick={() => {
                        if (onDownload) {
                          setDownloading(true)
                          onDownload()
                        }
                      }}
                      className="absolute inset-0 flex items-center justify-center group/play cursor-pointer bg-black/25 hover:bg-black/35 transition-colors"
                      title="Click to Download and Play"
                    >
                      <div className="size-20 rounded-full bg-primary text-white flex items-center justify-center shadow-2xl group-hover/play:scale-110 transition-transform">
                        <Play size={36} className="ml-1 fill-white" />
                      </div>
                    </button>
                  </div>
                ) : (
                  <div className="size-20 rounded-full bg-primary/20 text-primary flex items-center justify-center mb-2">
                    <Play size={32} className="ml-1" />
                  </div>
                )}
                <div className="text-[13px] text-muted">
                  {downloading ? (
                    <span className="text-cyan font-medium animate-pulse">
                      Downloading video to play in full quality… check Queue for progress.
                    </span>
                  ) : (
                    'Video preview available. Click to download and play in full quality.'
                  )}
                </div>
                {onDownload && !downloading && (
                  <Button
                    variant="primary"
                    onClick={() => {
                      setDownloading(true)
                      onDownload()
                    }}
                    className="py-2 px-6 text-[13px] flex items-center gap-2 shadow-lg"
                  >
                    <Download size={15} /> Download &amp; Play
                  </Button>
                )}
              </div>
            )
          ) : isImage && (localUrl || thumbUrl) ? (
            <img
              src={localUrl || thumbUrl!}
              alt={item.name}
              className="max-h-[78vh] max-w-full object-contain rounded-lg shadow-2xl"
            />
          ) : isAudio ? (
            localUrl ? (
              <div className="flex flex-col items-center justify-center gap-6 py-12 px-16 w-full max-w-md">
                <div className="size-24 rounded-full bg-primary/20 text-primary flex items-center justify-center shadow-xl border border-primary/30">
                  <Play size={36} className="ml-1 fill-primary" />
                </div>
                <div className="text-center">
                  <div className="text-[15px] text-white font-semibold truncate max-w-sm">{item.name}</div>
                  <div className="text-[12px] text-muted mt-1">{item.size ? fmtBytes(item.size) : ''} {item.duration ? `• ${fmtDuration(item.duration)}` : ''}</div>
                </div>
                <audio src={localUrl} controls autoPlay className="w-full" />
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center gap-4 py-12 px-8 text-center">
                <div className="size-20 rounded-full bg-primary/20 text-primary flex items-center justify-center mb-2">
                  <Play size={32} className="ml-1" />
                </div>
                <div className="text-[14px] text-white font-medium">{item.name}</div>
                <div className="text-[12px] text-muted">
                  {downloading ? 'Downloading audio file…' : 'Audio file not downloaded yet.'}
                </div>
                {onDownload && !downloading && (
                  <Button
                    variant="primary"
                    onClick={() => {
                      setDownloading(true)
                      onDownload()
                    }}
                    className="py-2 px-5 text-[13px] flex items-center gap-2"
                  >
                    <Download size={15} /> Download &amp; Play
                  </Button>
                )}
              </div>
            )
          ) : thumbUrl ? (
            <div className="flex flex-col items-center gap-3">
              <img
                src={thumbUrl}
                alt={item.name}
                className="max-h-[72vh] max-w-full object-contain rounded-lg shadow-lg"
              />
              <div className="text-[12px] text-muted text-center">
                Preview thumbnail. {item.path ? '' : 'Download the file to view full content.'}
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-16 px-20 text-center">
              <div className="size-20 rounded-2xl bg-primary/20 flex items-center justify-center text-primary mb-4 shadow">
                <TypeChip ext={ext.toUpperCase() || 'FILE'} />
              </div>
              <div className="text-[15px] font-semibold text-text max-w-md truncate">{item.name}</div>
              <div className="text-[12px] text-muted mt-1.5">
                {item.path ? 'Ready to open with your system default application.' : 'File not downloaded yet.'}
              </div>
              {!item.path && onDownload && !downloading && (
                <Button
                  variant="primary"
                  onClick={() => {
                    setDownloading(true)
                    onDownload()
                  }}
                  className="mt-4 py-2 px-5 text-[13px] flex items-center gap-2"
                >
                  <Download size={15} /> Download File
                </Button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/** Dispatches animation event for flying Telegram logo to the Queue nav item */
export function triggerFlyToQueue(e?: React.MouseEvent | { clientX: number, clientY: number }) {
  if (typeof window === 'undefined') return
  const x = e ? ('clientX' in e ? e.clientX : window.innerWidth / 2) : window.innerWidth / 2
  const y = e ? ('clientY' in e ? e.clientY : window.innerHeight / 2) : window.innerHeight / 2
  window.dispatchEvent(new CustomEvent('mediagram-fly-to-queue', { detail: { x, y } }))
}
