// Phase 5: Complete UI primitives per UI.md
import { type ReactNode, type LegacyRef, useState, useEffect, useRef, createContext, useContext } from 'react'
import { Loader2, ChevronDown, X, Search, Check } from 'lucide-react'

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
  const base = 'rounded-[10px] px-4 py-2 text-[13px] font-semibold transition-colors disabled:opacity-60'
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
      className={`rounded-[10px] p-2 transition-colors ${variant === 'primary' ? 'bg-primary hover:bg-[#3b82f6]'
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
  const input = 'mt-1 block w-full rounded-[10px] border border-border bg-tile px-3 py-2 text-[13px] text-text placeholder:text-muted focus:border-primary'
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
    <div className="rounded-[14px] border border-border bg-panel/85 p-4 backdrop-blur">
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

export function Pill({ kind, status, finalizing, label }: { 
  kind?: Kind, status?: Status, finalizing?: boolean, label?: string 
}) {
  const text = label || (finalizing ? 'Finalizing' : status === 'queued' ? 'Queued' : status === 'active' 
    ? (kind === 'upload' ? 'Uploading' : 'Downloading') : status === 'paused' ? 'Paused' 
    : status === 'completed' ? 'Completed' : 'Failed')
  const cls = finalizing || status === 'active' ? 'bg-primary text-text' 
    : status === 'paused' || finalizing ? 'border border-warning text-warning'
    : status === 'completed' ? 'border border-success text-success'
    : status === 'failed' ? 'border border-danger text-danger'
    : 'border border-border text-muted'
  return <span className={`inline-flex h-6 items-center rounded-full px-2.5 text-[11px] font-medium ${cls}`}>{text}</span>
}

export function Progress({ done, size, tone = 'primary' }: { done: number, size: number, tone?: Tone }) {
  const percent = size > 0 ? (done / size) * 100 : 0
  const tones = { primary: 'bg-primary', success: 'bg-success', warning: 'bg-warning', danger: 'bg-danger', neutral: 'bg-muted' }
  return (
    <div>
      <div className="flex items-center justify-between text-[12px]">
        <span className="tabular-nums">{Math.round(percent)}%</span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-[#1e2a47]">
        <div className={`h-full transition-all ${tones[tone]}`} style={{ width: `${Math.min(100, percent)}%` }} />
      </div>
      <div className="mt-0.5 text-[11px] text-muted">{fmtBytes(done)} / {fmtBytes(size)}</div>
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
        className={`appearance-none rounded-[10px] border border-border bg-tile py-2 pl-3 pr-9 text-[13px] hover:border-primary ${className || ''}`}
      >
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      <ChevronDown size={16} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-muted" />
    </div>
  )
  return label ? <label className="block text-[12px] text-muted">{label}<div className="mt-1">{sel}</div></label> : sel
}

export function Segmented({ options, value, onChange }: { 
  options: { value: string, label: string, icon: ReactNode }[], value: string, onChange: (v: string) => void 
}) {
  return (
    <div role="radiogroup" className="inline-flex gap-1 rounded-[10px] bg-tile p-1">
      {options.map((o) => (
        <button
          key={o.value} role="radio" aria-checked={value === o.value} onClick={() => onChange(o.value)}
          className={`flex items-center gap-2 rounded-lg px-3 py-1.5 text-[13px] font-medium transition ${
            value === o.value ? 'bg-primary text-text' : 'hover:bg-tile/60'
          }`}
        >
          {o.icon}{o.label}
        </button>
      ))}
    </div>
  )
}

export function Toggle({ label, checked, onChange }: { label: string, checked: boolean, onChange: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-center gap-3">
      <input type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} className="peer sr-only" />
      <div className="h-6 w-11 rounded-full bg-tile transition peer-checked:bg-primary relative">
        <div className="absolute top-1 left-1 h-4 w-4 rounded-full bg-white transition peer-checked:translate-x-5" />
      </div>
      <span className="text-[13px]">{label}</span>
    </label>
  )
}

export function SearchInput({ value, onChange, placeholder, className }: { 
  value: string, onChange: (v: string) => void, placeholder: string, className?: string 
}) {
  return (
    <div className={`relative ${className || ''}`}>
      <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
      <input
        type="search" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
        className="w-full rounded-[10px] border border-border bg-tile py-2 pl-9 pr-3 text-[13px] placeholder:text-muted focus:border-primary"
      />
      {value && (
        <button onClick={() => onChange('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted hover:text-text">
          <X size={16} />
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
  const ext = name.split('.').pop()?.toLowerCase()
  return src ? (
    <img src={src} alt={name} className="h-7 w-10 rounded object-cover" />
  ) : (
    <div className="flex h-7 w-10 items-center justify-center rounded bg-tile text-[9px] font-bold uppercase text-muted">
      {ext?.slice(0, 3)}
    </div>
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
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    if (open && !ref.current?.open) ref.current?.showModal()
    if (!open && ref.current?.open) ref.current?.close()
  }, [open])
  useEffect(() => {
    const dialog = ref.current
    const handleClose = () => onClose()
    const handleEscape = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    dialog?.addEventListener('close', handleClose)
    dialog?.addEventListener('keydown', handleEscape)
    return () => {
      dialog?.removeEventListener('close', handleClose)
      dialog?.removeEventListener('keydown', handleEscape)
    }
  }, [onClose])
  return (
    <dialog ref={ref} className="rounded-[14px] border border-border bg-panel p-6 backdrop:bg-black/50">
      <h2 className="mb-4 text-[18px] font-bold">{title}</h2>
      <div className="mb-4">{children}</div>
      {actions && <div className="flex justify-end gap-2">{actions}</div>}
    </dialog>
  )
}

const confirmCtx = createContext<(opts: { title: string, message: string, confirm: string, danger?: boolean, typed?: string, checkbox?: string }) => Promise<boolean>>(null as any)
export function ConfirmHost({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ opts: any, resolve: (v: boolean) => void } | null>(null)
  const [typed, setTyped] = useState('')
  const [checked, setChecked] = useState(false)
  const confirm = (opts: any) => new Promise<boolean>((resolve) => setState({ opts, resolve }))
  const close = (result: boolean) => { state?.resolve(result); setState(null); setTyped(''); setChecked(false) }
  return (
    <confirmCtx.Provider value={confirm}>
      {children}
      {state && (
        <Dialog open title={state.opts.title} onClose={() => close(false)}>
          <p className="text-[13px]">{state.opts.message}</p>
          {state.opts.typed && (
            <input
              value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={`Type ${state.opts.typed} to confirm`}
              className="mt-3 w-full rounded-lg border border-border bg-tile px-3 py-2 text-[13px]"
            />
          )}
          {state.opts.checkbox && (
            <label className="mt-3 flex items-center gap-2 text-[13px]">
              <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} />
              {state.opts.checkbox}
            </label>
          )}
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="secondary" onClick={() => close(false)}>Cancel</Button>
            <Button
              variant={state.opts.danger ? 'danger' : 'primary'}
              disabled={state.opts.typed && typed !== state.opts.typed}
              onClick={() => close(true)}
            >
              {state.opts.confirm}
            </Button>
          </div>
        </Dialog>
      )}
    </confirmCtx.Provider>
  )
}
export const confirm = (opts: { title: string, message: string, confirm: string, danger?: boolean, typed?: string, checkbox?: string }) => useContext(confirmCtx)(opts)

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
