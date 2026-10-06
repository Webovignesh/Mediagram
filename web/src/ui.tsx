// Phase 5: Complete UI primitives per UI.md
import { type ReactNode, type LegacyRef, type RefObject, useState, useEffect, useRef, createContext, useContext } from 'react'
import { Loader2, ChevronDown, X, Search, Check, Pause, Play, Download, CheckCircle2, AlertCircle, AlertTriangle, Info, Music, FolderOpen, Gauge, Film, Volume2, VolumeX, Maximize2, Minimize2, RotateCcw, Folder, Bookmark, ImageOff } from 'lucide-react'
import { call, on, useCall } from './api.ts'
import { getActiveTheme } from './theme.ts'

export type Tone = 'primary' | 'info' | 'success' | 'warning' | 'danger' | 'neutral'
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
export const fmtDate = (time: number | null | undefined) => {
  if (!time || isNaN(time)) return '–'
  let ms = time > 1e11 ? time : time * 1000
  if (new Date(ms).getFullYear() > 3000) {
    ms = time / 1000
  }
  return dateFormat.format(new Date(ms))
}
export const typeLabel: Record<string, string> = {
  video_note: 'video message', voice: 'voice message', animation: 'GIF', album: 'album',
  video: 'video', photo: 'photo', document: 'document', audio: 'audio',
}

// Components
export function Button({ 
  children, variant = 'primary', tone, busy, disabled, type = 'button', onClick, className, style,
}: { 
  children: ReactNode, variant?: 'primary' | 'secondary' | 'tint' | 'danger', tone?: Tone, busy?: boolean
  disabled?: boolean, type?: 'button' | 'submit', onClick?: () => void, className?: string, style?: React.CSSProperties
}) {
  const base = 'inline-flex items-center justify-center gap-2 whitespace-nowrap shrink-0 rounded-md px-3.5 py-1.5 text-[13px] font-medium transition-colors disabled:opacity-60'
  const variants = {
    primary: 'bg-primary text-white hover:bg-primary-hover shadow-sm',
    secondary: 'border border-border bg-tile text-text hover:border-primary',
    tint: tone === 'danger' ? 'bg-danger/15 border border-danger text-danger hover:bg-danger/25'
      : tone === 'success' ? 'bg-success/15 border border-success text-success hover:bg-success/25'
      : 'bg-primary/15 border border-primary text-primary hover:bg-primary/25',
    danger: 'bg-danger text-white hover:bg-danger/90 shadow-sm',
  }
  return (
    <button 
      type={type} disabled={disabled || busy} aria-busy={busy} onClick={onClick}
      style={style}
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
      className={`rounded-md p-2 transition-colors cursor-pointer ${variant === 'primary' ? 'bg-primary text-white hover:bg-primary-hover'
        : variant === 'tint' && tone === 'danger' ? 'bg-danger/15 hover:bg-danger/25' : 'bg-tile text-text hover:bg-tile/80 border border-border'} ${className || ''}`}
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
  const tones: Record<Tone, string> = {
    primary: 'bg-primary/15 border-primary/30', info: 'bg-cyan/15 border-cyan/30', success: 'bg-success/15 border-success/30',
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
  const tones: Record<Tone, string> = {
    primary: 'bg-cyan',
    info: 'bg-cyan',
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
      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-medium transition cursor-pointer ${
        active ? 'bg-primary text-white shadow-sm' : 'border border-border bg-tile text-text-2 hover:border-primary hover:text-text'
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
          className={`flex items-center gap-2 rounded-md px-3 py-1.5 text-[12.5px] font-medium transition cursor-pointer ${
            value === o.value ? 'bg-primary text-white shadow-sm' : 'text-text-2 hover:text-text hover:bg-tile/60'
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
  const [loaded, setLoaded] = useState(false)
  const [failed, setFailed] = useState(false)
  const isSaved = name?.toLowerCase().includes('saved')
  const colors = ['#f43f5e', '#a855f7', '#6366f1', '#0ea5e9', '#14b8a6', '#22c55e', '#f97316', '#eab308']
  const color = colors[(name ? name.charCodeAt(0) : 0) % colors.length]

  if (isSaved && (!src || failed)) {
    return (
      <div
        className="flex items-center justify-center rounded-lg select-none bg-primary/20 text-primary border border-primary/30 shadow-sm shrink-0"
        style={{ width: size, height: size }}
        title="Saved Messages"
      >
        <Bookmark size={Math.round(size * 0.52)} className="fill-current" />
      </div>
    )
  }

  if (!src || failed) {
    return (
      <div
        className="flex items-center justify-center rounded-lg font-semibold select-none text-white shadow-sm shrink-0"
        style={{ width: size, height: size, backgroundColor: color }}
      >
        {name[0]?.toUpperCase()}
      </div>
    )
  }

  const url = src.startsWith('mediagram://') || src.startsWith('teleflow://') || src.startsWith('data:') || src.startsWith('blob:') || src.startsWith('http')
    ? src
    : `mediagram://thumb/${src}`

  return (
    <div className="relative shrink-0 rounded-lg overflow-hidden" style={{ width: size, height: size }}>
      {!loaded && <div className="absolute inset-0 bg-white/10 animate-pulse rounded-lg" />}
      <img
        src={url}
        alt={name}
        loading="lazy"
        onLoad={() => setLoaded(true)}
        onError={() => setFailed(true)}
        className={`rounded-lg object-cover transition-opacity duration-200 ${loaded ? 'opacity-100' : 'opacity-0'}`}
        style={{ width: size, height: size }}
      />
    </div>
  )
}

export function Thumb({ src, name }: { src: string | null, name: string }) {
  const [loaded, setLoaded] = useState(false)
  const [failed, setFailed] = useState(false)
  const ext = (name.split('.').pop() || 'FILE').toUpperCase()

  if (!src || failed) {
    return (
      <div className="flex h-7 w-10 shrink-0 items-center justify-center rounded bg-tile text-[9px] font-bold uppercase text-muted border border-border/40 select-none">
        {ext.slice(0, 3)}
      </div>
    )
  }

  const url = src.startsWith('mediagram://') || src.startsWith('teleflow://') || src.startsWith('data:') || src.startsWith('blob:') || src.startsWith('http')
    ? src
    : `mediagram://thumb/${src}`

  return (
    <div className="relative h-7 w-10 shrink-0 rounded overflow-hidden border border-border/40 bg-tile/60">
      {!loaded && (
        <div className="absolute inset-0 bg-white/10 animate-pulse flex items-center justify-center">
          <span className="text-[8px] font-bold text-muted/60">{ext.slice(0, 2)}</span>
        </div>
      )}
      <img
        src={url}
        alt={name}
        loading="lazy"
        onLoad={() => setLoaded(true)}
        onError={() => setFailed(true)}
        className={`h-full w-full object-cover transition-opacity duration-200 ${loaded ? 'opacity-100' : 'opacity-0'}`}
      />
    </div>
  )
}

export function ChatMediaThumb({
  src,
  alt,
  className = '',
  minHeight = '180px',
  maxHeight = '460px',
}: {
  src: string | null
  alt: string
  className?: string
  minHeight?: string
  maxHeight?: string
}) {
  const [loaded, setLoaded] = useState(false)
  const [failed, setFailed] = useState(false)

  if (!src || failed) {
    return (
      <div
        className={`flex w-full flex-col items-center justify-center gap-2 bg-panel/80 text-muted ${className}`}
        style={{ minHeight }}
      >
        <div className="size-12 rounded-2xl bg-tile border border-border flex items-center justify-center text-primary shadow-inner">
          <Film size={26} />
        </div>
        <span className="text-[11px] text-muted tracking-wide font-medium">Video Preview</span>
      </div>
    )
  }

  const url = src.startsWith('mediagram://') || src.startsWith('teleflow://') || src.startsWith('data:') || src.startsWith('blob:') || src.startsWith('http')
    ? src
    : `mediagram://thumb/${src}`

  return (
    <div className="relative w-full overflow-hidden bg-panel/40" style={{ minHeight }}>
      {!loaded && (
        <div
          className="absolute inset-0 flex flex-col items-center justify-center bg-panel/90 animate-pulse z-10"
          style={{ minHeight }}
        >
          <div className="size-10 rounded-xl bg-tile border border-border flex items-center justify-center text-primary/70">
            <Film size={20} className="animate-pulse" />
          </div>
          <span className="mt-2 text-[10px] font-semibold tracking-wider text-muted/70 uppercase">Loading preview…</span>
        </div>
      )}
      <img
        src={url}
        alt={alt}
        loading="lazy"
        onLoad={() => setLoaded(true)}
        onError={() => setFailed(true)}
        className={`w-full h-auto object-cover transition-all duration-300 ${loaded ? 'opacity-100 scale-100' : 'opacity-0 scale-[1.01]'} ${className}`}
        style={{ minHeight, maxHeight }}
      />
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
        className="relative w-full max-w-md rounded-xl border border-border bg-panel p-6 shadow-2xl"
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
  /** Seconds the confirm button stays off with a visible countdown (the Clear app data delete timer). */
  wait?: number
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
  const [left, setLeft] = useState(0)

  useEffect(() => {
    confirmDispatcher = (s) => {
      setTyped('')
      setChecked(false)
      setState(s)
    }
    return () => { confirmDispatcher = null }
  }, [])

  // The delete timer: count down while the dialog is open, then let the button through.
  useEffect(() => {
    const wait = state?.opts.wait
    if (!wait) { setLeft(0); return }
    setLeft(wait)
    let n = wait
    const t = setInterval(() => {
      n -= 1
      setLeft(Math.max(n, 0))
      if (n <= 0) clearInterval(t)
    }, 1000)
    return () => clearInterval(t)
  }, [state])

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
              disabled={left > 0 || Boolean(state.opts.typed && typed.trim().toUpperCase() !== state.opts.typed.trim().toUpperCase())}
              onClick={() => close(true)}
            >
              {left > 0 ? `${state.opts.confirm} (${left}s)` : state.opts.confirm}
            </Button>
          </div>
        </Dialog>
      )}
    </>
  )
}

export type ToastOptions = {
  tone?: Tone
  title?: string
  description?: string
  duration?: number
  action?: {
    label: string
    onClick: () => void
  }
}

export type ToastItem = {
  id: number
  message: string
  title?: string
  description?: string
  tone: Tone
  duration: number
  action?: { label: string, onClick: () => void }
  createdAt: number
}

const toasts: ToastItem[] = []
const toastListeners = new Set<() => void>()
let toastId = 0

export function dismissToast(id: number) {
  const i = toasts.findIndex((t) => t.id === id)
  if (i >= 0) {
    toasts.splice(i, 1)
    toastListeners.forEach((l) => l())
  }
}

export function toast(message: string, optionsOrTone?: ToastOptions | Tone) {
  const opts: ToastOptions = typeof optionsOrTone === 'string'
    ? { tone: optionsOrTone }
    : (optionsOrTone || {})
  const tone = opts.tone || 'neutral'
  const duration = opts.duration ?? (tone === 'danger' ? 8000 : 4500)
  const id = toastId++
  const item: ToastItem = {
    id,
    message,
    title: opts.title,
    description: opts.description,
    tone,
    duration,
    action: opts.action,
    createdAt: Date.now(),
  }
  toasts.push(item)
  toastListeners.forEach((l) => l())
  if (duration > 0) {
    setTimeout(() => {
      dismissToast(id)
    }, duration)
  }
  return id
}

toast.dismiss = dismissToast
toast.success = (message: string, opts?: Omit<ToastOptions, 'tone'>) => toast(message, { ...opts, tone: 'success' })
toast.error = (message: string, opts?: Omit<ToastOptions, 'tone'>) => toast(message, { ...opts, tone: 'danger' })
toast.danger = (message: string, opts?: Omit<ToastOptions, 'tone'>) => toast(message, { ...opts, tone: 'danger' })
toast.warning = (message: string, opts?: Omit<ToastOptions, 'tone'>) => toast(message, { ...opts, tone: 'warning' })
toast.info = (message: string, opts?: Omit<ToastOptions, 'tone'>) => toast(message, { ...opts, tone: 'primary' })

export function Toaster() {
  const [, setTick] = useState(0)
  useEffect(() => {
    const cb = () => setTick((t) => t + 1)
    toastListeners.add(cb)
    return () => { toastListeners.delete(cb) }
  }, [])

  if (!toasts.length) return null

  return (
    <div className="fixed top-12 right-6 z-[9999] flex flex-col gap-2.5 max-w-[380px] w-full pointer-events-none select-none">
      {toasts.map((t) => {
        const isDanger = t.tone === 'danger'
        const isSuccess = t.tone === 'success'
        const isWarning = t.tone === 'warning'
        const isPrimary = t.tone === 'primary'

        const borderClass = isDanger
          ? 'border-rose-500/40 shadow-[0_8px_30px_rgba(244,63,94,0.25)]'
          : isSuccess
          ? 'border-emerald-500/40 shadow-[0_8px_30px_rgba(16,185,129,0.25)]'
          : isWarning
          ? 'border-amber-500/40 shadow-[0_8px_30px_rgba(245,158,11,0.25)]'
          : isPrimary
          ? 'border-cyan/40 shadow-[0_8px_30px_rgba(6,182,212,0.25)]'
          : 'border-white/15 shadow-[0_8px_30px_rgba(0,0,0,0.5)]'

        const iconBg = isDanger
          ? 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
          : isSuccess
          ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
          : isWarning
          ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
          : 'bg-primary/20 text-primary border border-primary/30'

        return (
          <div
            key={t.id}
            role={isDanger ? 'alert' : 'status'}
            className={`pointer-events-auto relative overflow-hidden rounded-2xl border ${borderClass} bg-panel/95 backdrop-blur-2xl p-3.5 shadow-2xl transition-all animate-in slide-in-from-top-3 fade-in duration-200`}
          >
            <div className="flex items-start gap-3">
              <div className={`size-8 rounded-xl shrink-0 flex items-center justify-center ${iconBg}`}>
                {isSuccess && <CheckCircle2 size={16} strokeWidth={2.5} />}
                {isDanger && <AlertCircle size={16} strokeWidth={2.5} />}
                {isWarning && <AlertTriangle size={16} strokeWidth={2.5} />}
                {(isPrimary || (!isSuccess && !isDanger && !isWarning)) && <Info size={16} strokeWidth={2.5} />}
              </div>

              <div className="flex-1 min-w-0 pr-1 pt-0.5">
                {t.title && <div className="text-[13px] font-semibold text-text tracking-wide leading-tight mb-0.5">{t.title}</div>}
                <div className={`text-[12.5px] leading-relaxed break-words font-medium ${isDanger ? 'text-danger' : isSuccess ? 'text-success' : isWarning ? 'text-warning' : 'text-text-2'}`}>
                  {t.message}
                </div>
                {t.description && <div className="text-[11.5px] text-muted leading-relaxed mt-1">{t.description}</div>}
                {t.action && (
                  <div className="mt-2">
                    <button
                      type="button"
                      onClick={() => {
                        t.action?.onClick()
                        dismissToast(t.id)
                      }}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-white/20 bg-white/10 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-white/20 transition-all cursor-pointer"
                    >
                      {t.action.label}
                    </button>
                  </div>
                )}
              </div>

              <button
                type="button"
                onClick={() => dismissToast(t.id)}
                className="shrink-0 size-6 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition-colors flex items-center justify-center cursor-pointer mt-0.5"
                title="Dismiss"
              >
                <X size={14} />
              </button>
            </div>

            {t.duration > 0 && (
              <div
                className={`absolute bottom-0 left-0 h-[2px] w-full origin-left opacity-70 ${
                  isDanger ? 'bg-rose-500' : isSuccess ? 'bg-emerald-500' : isWarning ? 'bg-amber-500' : 'bg-cyan'
                }`}
                style={{
                  animation: `shrinkWidth ${t.duration}ms linear forwards`,
                }}
              />
            )}
          </div>
        )
      })}
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
    <div className="rounded-xl border border-border bg-panel p-3 shadow-sm hover:border-border/80 transition-colors">
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

export function MediagramLogo({ size = 20, className = '' }: { size?: number, className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 256 256"
      className={`shrink-0 overflow-hidden ${className}`}
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient id="mediagram-logo-grad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="var(--color-primary, #3b82f6)" />
          <stop offset="100%" stopColor="var(--color-primary-hover, #1d4ed8)" />
        </linearGradient>
      </defs>
      <rect width="256" height="256" rx="56" fill="url(#mediagram-logo-grad)" />
      <path d="M199 58 47 120q-10 5 0 9l47 16 18 52q4 10 12 3l25-23 39 29q9 6 12-4l16-130q1-17-17-14Z" fill="#fff" />
      <path d="m94 145 92-62-74 74-1 40Z" fill="rgba(255, 255, 255, 0.45)" />
    </svg>
  )
}

function CustomVideoPlayer({
  src,
  speed,
  onSpeedChange,
  poster,
  initialDuration,
}: {
  src: string
  speed: number
  onSpeedChange: (speed: number) => void
  poster?: string | null
  initialDuration?: number
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [playing, setPlaying] = useState(true)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(initialDuration || 0)
  const [volume, setVolume] = useState(1)
  const [muted, setMuted] = useState(false)
  const [fullscreen, setFullscreen] = useState(false)
  const [showControls, setShowControls] = useState(true)
  const [buffering, setBuffering] = useState(true)
  const [hasStarted, setHasStarted] = useState(false)
  const hideTimerRef = useRef<NodeJS.Timeout | null>(null)

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.playbackRate = speed
    }
  }, [speed])

  // Instant playback attempt on mount or source change
  useEffect(() => {
    setBuffering(true)
    setHasStarted(false)
    if (videoRef.current) {
      videoRef.current.play().catch(() => {
        setPlaying(false)
      })
    }
  }, [src])

  const resetHideTimer = () => {
    setShowControls(true)
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current)
    if (playing) {
      hideTimerRef.current = setTimeout(() => setShowControls(false), 2500)
    }
  }

  const togglePlay = () => {
    if (!videoRef.current) return
    if (videoRef.current.paused) {
      videoRef.current.play()
      setPlaying(true)
    } else {
      videoRef.current.pause()
      setPlaying(false)
    }
    resetHideTimer()
  }

  // Spacebar plays/pauses video
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' || e.key === ' ') {
        const tag = (e.target as HTMLElement)?.tagName
        if (['INPUT', 'TEXTAREA', 'SELECT'].includes(tag)) return
        e.preventDefault()
        togglePlay()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [playing])

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value)
    setVolume(val)
    setMuted(val === 0)
    if (videoRef.current) {
      videoRef.current.volume = val
      videoRef.current.muted = val === 0
    }
  }

  const toggleMute = () => {
    if (!videoRef.current) return
    if (muted) {
      videoRef.current.muted = false
      videoRef.current.volume = volume || 1
      setMuted(false)
    } else {
      videoRef.current.muted = true
      setMuted(true)
    }
  }

  const toggleFullscreen = () => {
    if (!containerRef.current) return
    if (!document.fullscreenElement) {
      containerRef.current.requestFullscreen?.()
      setFullscreen(true)
    } else {
      document.exitFullscreen?.()
      setFullscreen(false)
    }
  }

  const handleSeek = (posFraction: number) => {
    const newTime = Math.max(0, Math.min(duration, posFraction * duration))
    if (videoRef.current) {
      videoRef.current.currentTime = newTime
      setCurrentTime(newTime)
    }
  }

  const formatTime = (secs: number) => {
    if (isNaN(secs) || secs < 0) return '0:00'
    const m = Math.floor(secs / 60)
    const s = Math.floor(secs % 60)
    return `${m}:${s < 10 ? '0' : ''}${s}`
  }

  const progressPct = duration > 0 ? Math.min(100, Math.max(0, (currentTime / duration) * 100)) : 0

  return (
    <div
      ref={containerRef}
      className="relative flex items-center justify-center w-full max-w-5xl aspect-video min-h-[360px] max-h-[86vh] rounded-2xl overflow-hidden group select-none bg-black shadow-2xl cursor-default"
      onMouseMove={resetHideTimer}
      onMouseLeave={() => playing && setShowControls(false)}
      onClick={(e) => e.stopPropagation()}
    >
      {/* Thumbnail backdrop: stays visible while buffering before video starts, preventing any pitch-black flash */}
      {poster && (
        <img
          src={poster}
          alt=""
          className={`absolute inset-0 w-full h-full object-contain pointer-events-none transition-opacity duration-300 z-0 ${
            hasStarted ? 'opacity-0' : 'opacity-100'
          }`}
        />
      )}

      <video
        ref={videoRef}
        src={src}
        poster={poster || undefined}
        autoPlay
        playsInline
        preload="auto"
        onClick={togglePlay}
        onTimeUpdate={() => {
          if (videoRef.current) {
            setCurrentTime(videoRef.current.currentTime)
            if (videoRef.current.currentTime > 0) setHasStarted(true)
          }
        }}
        onLoadedMetadata={() => {
          if (videoRef.current) {
            setDuration(videoRef.current.duration || initialDuration || 0)
          }
        }}
        onLoadStart={() => setBuffering(true)}
        onWaiting={() => setBuffering(true)}
        onSeeking={() => setBuffering(true)}
        onSeeked={() => setBuffering(false)}
        onCanPlay={() => setBuffering(false)}
        onLoadedData={() => {
          setBuffering(false)
          setHasStarted(true)
        }}
        onPlaying={() => {
          setPlaying(true)
          setBuffering(false)
          setHasStarted(true)
        }}
        onPlay={() => {
          setPlaying(true)
          setBuffering(false)
        }}
        onPause={() => setPlaying(false)}
        className={`relative z-10 w-full h-full object-contain cursor-pointer transition-opacity duration-300 ${
          hasStarted ? 'opacity-100' : 'opacity-0'
        }`}
      />

      {/* Loading Spinner Circle when buffering / initial loading - rendered on top of thumbnail backdrop */}
      {buffering && (
        <div
          data-testid="video-buffering-spinner"
          className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none z-25 transition-opacity gap-3"
        >
          <div className="size-14 rounded-full bg-black/75 backdrop-blur-md border border-white/20 flex items-center justify-center text-cyan shadow-2xl">
            <Loader2 size={28} className="animate-spin text-cyan" />
          </div>
          {!hasStarted && (
            <span className="text-[12px] font-semibold text-white/90 bg-black/60 backdrop-blur-md px-3.5 py-1 rounded-full border border-white/10 shadow-lg tracking-wide">
              Starting playback…
            </span>
          )}
        </div>
      )}

      {/* Center play icon overlay when paused and not buffering */}
      {!playing && !buffering && (
        <div
          onClick={togglePlay}
          className="absolute inset-0 flex items-center justify-center bg-black/25 cursor-pointer z-20"
        >
          <div className="size-16 rounded-full bg-black/75 backdrop-blur-md border border-white/20 flex items-center justify-center text-white shadow-2xl transition-transform hover:scale-110">
            <Play size={28} className="ml-1 fill-white" />
          </div>
        </div>
      )}

      {/* Sleek Custom Bottom Video Controls Bar - only shown after video frames have started playing */}
      <div
        className={`absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/95 via-black/75 to-transparent px-4 pb-3.5 pt-8 flex flex-col gap-2 transition-opacity duration-300 z-30 ${
          showControls && hasStarted ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Custom Sleek Scrubber Timeline */}
        <div
          className="w-full flex items-center relative py-1 cursor-pointer group/scrub"
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect()
            handleSeek((e.clientX - rect.left) / rect.width)
          }}
        >
          <div className="w-full h-1.5 group-hover/scrub:h-2 bg-white/20 rounded-full overflow-hidden transition-all relative">
            <div
              className="h-full bg-cyan rounded-full transition-all duration-75"
              style={{ width: `${progressPct}%` }}
            />
          </div>
          <div
            className="absolute size-3.5 rounded-full bg-white shadow-md pointer-events-none group-hover/scrub:scale-125 transition-transform"
            style={{ left: `calc(${progressPct}% - 7px)` }}
          />
        </div>

        {/* Controls row */}
        <div className="flex items-center justify-between text-white text-[12px] font-medium pt-0.5 whitespace-nowrap flex-nowrap gap-3">
          <div className="flex items-center gap-2.5 shrink-0">
            <button
              type="button"
              onClick={togglePlay}
              className="p-1 hover:text-cyan transition-colors"
              title={playing ? 'Pause (Space)' : 'Play (Space)'}
            >
              {playing ? <Pause size={17} /> : <Play size={17} className="fill-white" />}
            </button>

            {/* Time readout */}
            <span className="font-mono text-[11.5px] text-slate-200 tabular-nums whitespace-nowrap select-none">
              {formatTime(currentTime)} / {formatTime(duration)}
            </span>

            {/* Full Volume Control with Slider */}
            <div className="flex items-center gap-1.5 ml-1 group/vol">
              <button
                type="button"
                onClick={toggleMute}
                className="p-1 hover:text-cyan transition-colors"
                title={muted || volume === 0 ? 'Unmute' : 'Mute'}
              >
                {muted || volume === 0 ? <VolumeX size={17} className="text-danger" /> : <Volume2 size={17} />}
              </button>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={muted ? 0 : volume}
                onChange={handleVolumeChange}
                className="w-14 sm:w-18 h-1 bg-white/30 rounded-lg appearance-none cursor-pointer accent-cyan hover:h-1.5 transition-all"
                title={`Volume: ${Math.round((muted ? 0 : volume) * 100)}%`}
              />
              <span className="text-[10px] text-slate-300 font-mono w-7 tabular-nums select-none">
                {Math.round((muted ? 0 : volume) * 100)}%
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {/* Speed toggle without emoji */}
            <button
              type="button"
              onClick={() => {
                const speeds = [1, 1.25, 1.5, 2]
                const nextIndex = (speeds.indexOf(speed) + 1) % speeds.length
                onSpeedChange(speeds[nextIndex])
              }}
              className="flex items-center gap-1 px-2.5 py-1 rounded-md border border-white/20 bg-white/10 hover:bg-white/20 text-white text-[11.5px] font-semibold transition-colors"
              title="Toggle playback speed"
            >
              <Gauge size={13} className="text-cyan" />
              <span>{speed}x</span>
            </button>

            {/* Fullscreen toggle (NO 3-dot button!) */}
            <button
              type="button"
              onClick={toggleFullscreen}
              className="p-1 hover:text-cyan transition-colors"
              title={fullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
            >
              {fullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
            </button>
          </div>
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
    chatId?: number
    messageId?: number
  } | null
  onClose: () => void
  onDownload?: () => void
}) {
  const { data: settings } = useCall<any>('settings.get', {}, ['settings'])
  const [preparedPath, setPreparedPath] = useState<string | null>(null)
  const [prepProgress, setPrepProgress] = useState<{ downloaded: number, total: number } | null>(null)
  const [actualSize, setActualSize] = useState<number>(item?.size || 0)
  const [naturalDims, setNaturalDims] = useState<{ width: number, height: number } | null>(null)
  const [isFullLoaded, setIsFullLoaded] = useState(false)
  const [imgError, setImgError] = useState(false)
  const [thumbError, setThumbError] = useState(false)
  const [speed, setSpeed] = useState<number>(1)
  const audioRef = useRef<HTMLAudioElement>(null)

  const ext = item?.name.split('.').pop()?.toLowerCase() || ''
  const isVideo = ['mp4', 'webm', 'mkv', 'mov', 'm4v'].includes(ext) || item?.type === 'video' || item?.type === 'video_note'
  const isImage = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp'].includes(ext) || item?.type === 'photo' || item?.type === 'image'
  const isAudio = ['mp3', 'ogg', 'wav', 'flac', 'm4a', 'aac'].includes(ext) || item?.type === 'audio' || item?.type === 'voice'

  // Cache prebuffer preference locally so initial render has immediate accurate state
  const [localPrebuffer, setLocalPrebuffer] = useState(() => {
    try {
      const stored = localStorage.getItem('mediagram_prebuffer_video')
      if (stored !== null) return stored !== 'false'
    } catch {}
    return true
  })

  useEffect(() => {
    if (settings?.prebufferVideo !== undefined) {
      setLocalPrebuffer(settings.prebufferVideo)
      try {
        localStorage.setItem('mediagram_prebuffer_video', String(settings.prebufferVideo))
      } catch {}
    }
  }, [settings?.prebufferVideo])

  // true = wait for full download before playing; false = start playing as soon as TDLib gives any path
  const shouldPrebuffer = settings?.prebufferVideo ?? localPrebuffer

  // Sync Electron native title bar overlay color with modal background when open
  useEffect(() => {
    const bridge = window.mediagram || window.teleflow
    if (open) {
      bridge?.setTheme?.('#080c14', '#ffffff')?.catch(() => {})
    }
    return () => {
      const cur = getActiveTheme()
      bridge?.setTheme?.(cur.overlayColor, cur.symbolColor)?.catch(() => {})
    }
  }, [open])

  useEffect(() => {
    setActualSize(item?.size || 0)
    setNaturalDims(null)
    setIsFullLoaded(Boolean(item?.path))
    setImgError(false)
    setThumbError(false)
  }, [item])

  useEffect(() => {
    if (!open || !item) {
      setPreparedPath(null)
      setPrepProgress(null)
      setSpeed(1)
      return
    }

    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handleKey)

    if (item.path) {
      setPreparedPath(item.path)
      setIsFullLoaded(true)
      return () => window.removeEventListener('keydown', handleKey)
    }

    if (!item.chatId || !item.messageId) {
      return () => window.removeEventListener('keydown', handleKey)
    }

    let targetFileId: number | null = null
    let active = true

    call<{ completed: boolean, path: string | null, fileId: number, size: number, downloaded: number }>('media.prepare', {
      chatId: item.chatId,
      messageId: item.messageId,
    })
      .then((res) => {
        if (!active) return
        targetFileId = res.fileId
        if (res.size && res.size > 0) {
          setActualSize(res.size)
        }
        if (res.path) {
          if (isImage || !shouldPrebuffer) {
            setPreparedPath(res.path)
          } else if (res.completed) {
            setPreparedPath(res.path)
          }
        }
        if (!res.completed && res.size) {
          setPrepProgress({ downloaded: res.downloaded || 0, total: res.size })
        }
      })
      .catch(() => {})

    const unsub = on((event) => {
      if (!active) return
      if (event.type === 'fileProgress') {
        if (targetFileId && event.fileId !== targetFileId) return
        if (event.total && event.total > 0) {
          setActualSize(event.total)
        }
        if (event.path) {
          if (isImage || !shouldPrebuffer) {
            setPreparedPath(event.path)
          } else if (event.completed) {
            setPreparedPath(event.path)
          }
        }
        if (!event.completed && event.total > 0) {
          setPrepProgress({ downloaded: event.downloaded, total: event.total })
        }
      }
    })

    return () => {
      active = false
      window.removeEventListener('keydown', handleKey)
      unsub()
    }
  }, [open, item, onClose, shouldPrebuffer, isImage])

  useEffect(() => {
    if (audioRef.current) audioRef.current.playbackRate = speed
  }, [speed, preparedPath])

  if (!open || !item) return null

  const resolvedPath = item.path || preparedPath
  const mediaUrl = resolvedPath ? `mediagram://file/${encodeURIComponent(resolvedPath)}` : null
  const thumbUrl = item.thumb ? `mediagram://thumb/${item.thumb}` : null

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col justify-between bg-black/95 select-none backdrop-blur-md transition-all duration-200 cursor-pointer overflow-hidden"
      onClick={onClose}
    >
      {/* 1. Seamless native window drag bar across the top matching titleBarOverlay */}
      <div
        className="drag flex h-9 shrink-0 items-center justify-between px-3 bg-bg select-none z-30 border-b border-border/40"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="no-drag" />
        {/* Reserved space matching Windows min/max/close controls */}
        <div className="no-drag" style={{ width: 'calc(env(titlebar-area-width, 140px) + 8px)' }} aria-hidden="true" />
      </div>

      {/* 2. Floating metadata and action controls toolbar */}
      <div
        className="w-full flex items-center justify-between px-6 py-2.5 bg-panel/90 backdrop-blur-md border-b border-border z-20 cursor-default"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="min-w-0 flex-1 mr-4">
          <h3 className="truncate text-[13.5px] font-semibold text-text tracking-wide" title={item.name}>
            {item.name}
          </h3>
          <div className="mt-0.5 flex items-center gap-2 text-[11.5px] text-slate-300">
            {actualSize > 0 ? <span className="font-mono text-white/90 font-medium">{fmtBytes(actualSize)}</span> : null}
            {naturalDims ? <span>• {naturalDims.width} × {naturalDims.height}</span> : null}
            {item.duration ? <span>• {fmtDuration(item.duration)}</span> : null}
            <TypeChip ext={ext.toUpperCase()} />
            {isImage && !isFullLoaded && !imgError && (
              <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10.5px] font-medium bg-primary/15 text-primary border border-primary/25">
                <span className="size-2 rounded-full border border-primary/40 border-t-primary animate-spin" />
                <span>Loading photo… {prepProgress && prepProgress.total > 0 ? `${Math.round((prepProgress.downloaded / prepProgress.total) * 100)}%` : ''}</span>
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {onDownload ? (
            <Button
              variant="primary"
              onClick={onDownload}
              className="py-1.5 px-3.5 text-[12px] flex items-center gap-1.5 shadow-lg"
            >
              <Download size={14} />
              <span>Download</span>
            </Button>
          ) : null}

          <button
            onClick={onClose}
            className="flex size-7 items-center justify-center rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors"
            title="Close (Esc)"
          >
            <X size={15} />
          </button>
        </div>
      </div>

      {/* Center Media Stage - Backdrop click closes modal; media element stops propagation */}
      <div className="flex flex-1 items-center justify-center w-full h-full p-4 overflow-hidden">
        {isVideo ? (
          mediaUrl ? (
            <CustomVideoPlayer
              src={mediaUrl}
              speed={speed}
              onSpeedChange={setSpeed}
              poster={thumbUrl}
              initialDuration={item.duration}
            />
          ) : shouldPrebuffer ? (
            // Prebuffer ON: show download progress spinner on top of thumbnail, wait for full download
            <div
              className="relative flex items-center justify-center w-full max-w-5xl aspect-video min-h-[360px] max-h-[86vh] rounded-2xl overflow-hidden bg-black cursor-default shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              {thumbUrl ? (
                <img
                  src={thumbUrl}
                  alt={item.name}
                  className="absolute inset-0 w-full h-full object-contain pointer-events-none opacity-60 filter blur-[1px]"
                />
              ) : (
                <div className="w-80 h-52 flex items-center justify-center bg-slate-900/80 rounded-2xl">
                  <Film size={36} className="text-muted" />
                </div>
              )}
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/40 backdrop-blur-xs gap-3 pointer-events-none z-10">
                {prepProgress && prepProgress.total > 0 ? (
                  <>
                    <div className="relative size-16 flex items-center justify-center">
                      <svg className="size-16 -rotate-90" viewBox="0 0 64 64">
                        <circle cx="32" cy="32" r="28" stroke="currentColor" strokeWidth="4" className="text-white/20 fill-none" />
                        <circle
                          cx="32" cy="32" r="28"
                          stroke="currentColor" strokeWidth="4"
                          className="text-cyan fill-none transition-all duration-150"
                          strokeDasharray={175.9}
                          strokeDashoffset={175.9 - (175.9 * Math.min(100, Math.round((prepProgress.downloaded / prepProgress.total) * 100))) / 100}
                          strokeLinecap="round"
                        />
                      </svg>
                      <span className="absolute text-[12px] font-bold text-white font-mono">
                        {Math.min(100, Math.round((prepProgress.downloaded / prepProgress.total) * 100))}%
                      </span>
                    </div>
                    <div className="flex flex-col items-center gap-0.5">
                      <div className="text-[12.5px] font-semibold text-white">Buffering video…</div>
                      <div className="text-[11px] font-mono text-slate-300">
                        {fmtBytes(prepProgress.downloaded)} / {fmtBytes(prepProgress.total)}
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="flex flex-col items-center gap-3">
                    <div className="size-14 rounded-full bg-black/75 backdrop-blur-md border border-white/20 flex items-center justify-center text-cyan shadow-2xl">
                      <Loader2 size={28} className="animate-spin text-cyan" />
                    </div>
                    <span className="text-[12px] font-semibold text-white/90 bg-black/60 backdrop-blur-md px-3.5 py-1 rounded-full border border-white/10 shadow-lg tracking-wide">
                      Starting playback…
                    </span>
                  </div>
                )}
              </div>
            </div>
          ) : (
            // Prebuffer OFF: show continuous thumbnail with spinner until playback frames decode seamlessly
            <div
              className="relative flex items-center justify-center w-full max-w-5xl aspect-video min-h-[360px] max-h-[86vh] rounded-2xl overflow-hidden bg-black cursor-default shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              {thumbUrl ? (
                <img
                  src={thumbUrl}
                  alt={item.name}
                  className="absolute inset-0 w-full h-full object-contain pointer-events-none"
                />
              ) : (
                <div className="w-80 h-52 flex items-center justify-center bg-slate-900/80 rounded-2xl">
                  <Film size={36} className="text-muted" />
                </div>
              )}
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 pointer-events-none z-10">
                <div className="size-14 rounded-full bg-black/75 backdrop-blur-md border border-white/20 flex items-center justify-center text-cyan shadow-2xl">
                  <Loader2 size={28} className="animate-spin text-cyan" />
                </div>
                <span className="text-[12px] font-semibold text-white/90 bg-black/60 backdrop-blur-md px-3.5 py-1 rounded-full border border-white/10 shadow-lg tracking-wide">
                  Starting playback…
                </span>
              </div>
            </div>
          )
        ) : isImage ? (
          <div
            className="relative flex items-center justify-center max-h-[85vh] max-w-[95vw] cursor-default"
            onClick={(e) => e.stopPropagation()}
          >
            {/* 1. Full-resolution Image */}
            {mediaUrl && !imgError && (
              <img
                key={mediaUrl}
                src={mediaUrl}
                alt={item.name}
                onLoad={(e) => {
                  setNaturalDims({ width: e.currentTarget.naturalWidth, height: e.currentTarget.naturalHeight })
                  setIsFullLoaded(true)
                }}
                onError={() => {
                  setImgError(true)
                }}
                className={`max-h-[85vh] max-w-[95vw] w-auto h-auto min-w-[320px] md:min-w-[480px] object-contain rounded-lg shadow-2xl transition-opacity duration-300 ${
                  isFullLoaded ? 'opacity-100' : 'opacity-0'
                }`}
              />
            )}

            {/* 2. Instant Thumbnail Preview while full image prepares */}
            {(!mediaUrl || !isFullLoaded) && thumbUrl && !thumbError && !imgError && (
              <img
                src={thumbUrl}
                alt={item.name}
                onError={() => setThumbError(true)}
                className={`max-h-[85vh] max-w-[95vw] w-auto h-auto min-w-[320px] md:min-w-[480px] object-contain rounded-lg shadow-2xl filter blur-[1px] transition-opacity duration-300 ${
                  isFullLoaded ? 'opacity-0 pointer-events-none absolute' : 'opacity-85'
                }`}
              />
            )}

            {/* 3. Sleek Loading Stage Overlay */}
            {!isFullLoaded && !imgError && (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/40 backdrop-blur-[2px] rounded-2xl pointer-events-none z-10 gap-3 p-6">
                <div className="size-14 rounded-full bg-panel/90 backdrop-blur-md border border-border flex items-center justify-center text-primary shadow-2xl">
                  <Loader2 size={26} className="animate-spin text-primary" />
                </div>
                <div className="flex flex-col items-center gap-1 text-center">
                  <span className="text-[13px] font-semibold text-text shadow-sm">Loading photo…</span>
                  {prepProgress && prepProgress.total > 0 ? (
                    <span className="text-[11px] font-mono text-muted tabular-nums">
                      {fmtBytes(prepProgress.downloaded)} of {fmtBytes(prepProgress.total)} ({Math.round((prepProgress.downloaded / prepProgress.total) * 100)}%)
                    </span>
                  ) : actualSize > 0 ? (
                    <span className="text-[11px] font-mono text-muted">{fmtBytes(actualSize)}</span>
                  ) : null}
                </div>
              </div>
            )}

            {/* 4. Resilient Error Fallback Card */}
            {imgError && (
              <div className="flex flex-col items-center justify-center gap-4 p-8 rounded-2xl bg-panel/95 border border-border shadow-2xl text-center max-w-md">
                <div className="size-16 rounded-2xl bg-danger/15 text-danger flex items-center justify-center border border-danger/30 shadow-inner">
                  <ImageOff size={32} />
                </div>
                <div>
                  <div className="text-[15px] font-bold text-text truncate max-w-sm">{item.name}</div>
                  <div className="text-[12px] text-muted mt-1">
                    Photo preview could not be displayed. You can download the file directly to view it.
                  </div>
                </div>
                <div className="flex items-center gap-2 pt-1">
                  {onDownload && (
                    <Button variant="primary" onClick={onDownload} className="py-2 px-5 text-[12.5px] flex items-center gap-2">
                      <Download size={14} /> Download File
                    </Button>
                  )}
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setImgError(false)
                      setPreparedPath(null)
                    }}
                    className="py-2 px-4 text-[12.5px]"
                  >
                    Retry
                  </Button>
                </div>
              </div>
            )}
          </div>
        ) : isAudio ? (
          <div
            className="flex flex-col items-center justify-center gap-6 py-10 px-12 w-full max-w-xl bg-panel/95 backdrop-blur-2xl border border-border rounded-3xl shadow-2xl cursor-default"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="size-24 rounded-full bg-primary/20 text-primary flex items-center justify-center shadow-xl border border-primary/40 animate-pulse">
              <Music size={42} className="text-primary" />
            </div>
            <div className="text-center w-full px-4">
              <div className="text-[16px] text-text font-bold truncate max-w-md mx-auto">{item.name}</div>
              <div className="text-[12px] text-muted mt-1">
                {item.size ? fmtBytes(item.size) : ''} {item.duration ? `• ${fmtDuration(item.duration)}` : ''}
              </div>
            </div>
            {mediaUrl ? (
              <audio ref={audioRef} src={mediaUrl} controls autoPlay className="w-full mt-2" />
            ) : (
              <div className="flex flex-col items-center gap-2 py-4">
                <div className="size-10 rounded-full border-2 border-primary/30 border-t-primary animate-spin" />
                <span className="text-[12.5px] text-primary font-medium">Loading audio…</span>
              </div>
            )}
          </div>
        ) : (
          <div
            className="flex flex-col items-center justify-center gap-4 py-16 px-20 text-center bg-panel rounded-2xl border border-border shadow-2xl cursor-default"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="size-20 rounded-2xl bg-primary/20 flex items-center justify-center text-primary mb-2 shadow">
              <TypeChip ext={ext.toUpperCase() || 'FILE'} />
            </div>
            <div className="text-[16px] font-semibold text-text max-w-md truncate">{item.name}</div>
            <div className="text-[12.5px] text-muted">{item.size ? fmtBytes(item.size) : ''}</div>
            {onDownload && (
              <Button variant="primary" onClick={onDownload} className="mt-3 py-2 px-6 text-[13px] flex items-center gap-2">
                <Download size={15} /> Download File
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

/** Telegram Join Request / Community Invite Modal */
export function TelegramInviteModal({
  open,
  invite,
  loading,
  requestSent,
  onClose,
  onJoin,
}: {
  open: boolean
  invite: {
    title: string
    members?: number
    photo?: string | null
    about?: string
    createsJoinRequest?: boolean
    isPublic?: boolean
    link?: string
  } | null
  loading?: boolean
  requestSent?: boolean
  onClose: () => void
  onJoin: () => void
}) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open || !invite) return null

  const isRequest = Boolean(invite.createsJoinRequest)

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-md select-none animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-sm overflow-hidden rounded-3xl border border-border bg-panel p-6 shadow-2xl flex flex-col items-center text-center animate-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="absolute top-4 right-4 size-7 rounded-full bg-tile hover:bg-tile/80 text-muted hover:text-text flex items-center justify-center transition-colors cursor-pointer border border-border"
          title="Close"
        >
          <X size={15} />
        </button>

        {/* Channel / Group Avatar */}
        <div className="mt-2 mb-3">
          {invite.photo ? (
            <img
              src={`mediagram://thumb/${invite.photo}`}
              alt={invite.title}
              loading="lazy"
              className="size-20 rounded-full object-cover shadow-xl border-2 border-white/15"
            />
          ) : (
            <div className="size-20 rounded-full bg-primary/20 text-primary flex items-center justify-center text-2xl font-bold shadow-xl border-2 border-primary/30">
              {invite.title.charAt(0).toUpperCase()}
            </div>
          )}
        </div>

        {/* Channel Title */}
        <h3 className="text-[17px] font-bold text-text tracking-wide max-w-[280px] truncate" title={invite.title}>
          {invite.title}
        </h3>

        {/* Member count */}
        <p className="text-[12px] text-primary font-medium mt-1">
          {invite.members ? `${invite.members.toLocaleString()} members` : 'Telegram Community'}
        </p>

        {/* Description / About */}
        {invite.about && (
          <p className="text-[12px] text-muted mt-3 line-clamp-3 leading-relaxed px-2 break-words">
            {invite.about}
          </p>
        )}

        {/* Request notice or request sent badge */}
        {requestSent ? (
          <div className="mt-5 w-full p-3 rounded-2xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-[13px] font-semibold flex items-center justify-center gap-2 shadow-sm">
            <CheckCircle2 size={18} className="text-emerald-400" />
            <span>Join Request Sent!</span>
          </div>
        ) : isRequest ? (
          <div className="mt-4 p-2.5 rounded-xl bg-blue-500/10 border border-blue-500/20 text-[11.5px] text-blue-200 flex items-center justify-center gap-1.5 font-medium">
            <span>An admin will review your request to join</span>
          </div>
        ) : null}

        {/* Actions */}
        <div className="w-full flex flex-col gap-2 mt-5">
          {requestSent ? (
            <Button variant="primary" onClick={onClose} className="w-full py-2.5 text-[13.5px] font-semibold rounded-xl">
              Done
            </Button>
          ) : (
            <>
              <Button
                variant="primary"
                busy={loading}
                onClick={onJoin}
                className="w-full py-2.5 text-[13.5px] font-semibold rounded-xl shadow-lg"
              >
                {isRequest ? 'Request to Join' : 'Join Channel'}
              </Button>
              <Button
                variant="secondary"
                onClick={onClose}
                disabled={loading}
                className="w-full py-2 text-[12.5px] rounded-xl text-slate-300"
              >
                Cancel
              </Button>
            </>
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

export type DuplicateMatch = {
  chatId: number
  messageId: number
  name: string
  size: number
  duration: number
  diskPath: string
}

export type DuplicateCheckResult = {
  scannedPath: string
  filesScanned: number
  totalSelected: number
  onDiskCount: number
  willDownloadCount: number
  skippedBytes: number
  duplicates: DuplicateMatch[]
  willDownload: { chatId: number, messageId: number, name: string, size: number, duration: number }[]
}

export function CheckDuplicatesModal({
  open,
  loading,
  selectedCount,
  result,
  customPath,
  onClose,
  onContinue,
  onPickCustomPath,
  onResetCustomPath,
}: {
  open: boolean
  loading: boolean
  selectedCount: number
  result: DuplicateCheckResult | null
  customPath?: string | null
  onClose: () => void
  onContinue: (downloadItems: { chatId: number, messageId: number }[], force: boolean) => void
  onPickCustomPath?: () => void
  onResetCustomPath?: () => void
}) {
  const [skipDuplicates, setSkipDuplicates] = useState(true)
  const [showDuplicatesList, setShowDuplicatesList] = useState(false)

  useEffect(() => {
    if (!open) {
      setSkipDuplicates(true)
      setShowDuplicatesList(false)
      return
    }
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [open, onClose])

  if (!open) return null

  const onDiskCount = result?.onDiskCount ?? 0
  const totalSelected = result?.totalSelected ?? selectedCount
  const willDownloadCount = skipDuplicates ? (result?.willDownloadCount ?? totalSelected) : totalSelected

  const handleConfirm = () => {
    if (!result) return
    if (skipDuplicates) {
      onContinue(result.willDownload.map((x) => ({ chatId: x.chatId, messageId: x.messageId })), false)
    } else {
      const allItems = [...result.willDownload, ...result.duplicates].map((x) => ({ chatId: x.chatId, messageId: x.messageId }))
      onContinue(allItems, true)
    }
  }

  const subtitle = loading
    ? `Checking ${selectedCount.toLocaleString()} selected files before download`
    : onDiskCount > 0
    ? `${onDiskCount.toLocaleString()} duplicates found · ${willDownloadCount.toLocaleString()} ready to download`
    : `No duplicates found · ${willDownloadCount.toLocaleString()} ready to download`

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-md select-none animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-2xl overflow-hidden rounded-2xl border border-border bg-panel shadow-2xl flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between border-b border-border px-6 py-5">
          <div>
            <h2 className="text-[18px] font-bold text-text tracking-wide leading-tight">Check for duplicates</h2>
            <p className="text-[13px] text-muted mt-1 leading-normal">{subtitle}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-muted hover:bg-tile hover:text-text transition-colors cursor-pointer"
            title="Close"
          >
            <X size={18} />
          </button>
        </div>

        {/* Content Area */}
        <div className="p-6">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-20">
              <div className="flex items-center gap-4">
                <div className="size-8 rounded-full border-2 border-primary/30 border-t-primary animate-spin shrink-0" />
                <div>
                  <div className="text-[15px] font-semibold text-text">Scanning download folder</div>
                  <div className="text-[12.5px] text-muted mt-0.5">Duplicates require an exact filename and exact byte-size match.</div>
                </div>
              </div>
            </div>
          ) : result ? (
            <div className="space-y-4">
              {/* Scanned Path Card */}
              <div className="rounded-xl border border-border bg-tile/40 p-3.5">
                <div className="flex items-center justify-between gap-3 pb-2.5 border-b border-border/50 mb-2.5">
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] font-bold tracking-wider text-muted uppercase">
                      Scanned Path{customPath ? ' (Custom)' : ''}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {customPath && onResetCustomPath && (
                      <button
                        type="button"
                        onClick={onResetCustomPath}
                        className="px-2.5 py-1 rounded-md text-[11.5px] font-medium text-text-2 hover:text-text bg-tile hover:bg-tile/80 border border-border flex items-center gap-1.5 transition-all cursor-pointer active:scale-95 shadow-sm"
                        title="Reset to default download folder"
                      >
                        <RotateCcw size={11} className="text-muted" />
                        <span>Reset to default</span>
                      </button>
                    )}
                    {onPickCustomPath && (
                      <button
                        type="button"
                        onClick={onPickCustomPath}
                        className="px-2.5 py-1 rounded-md text-[11.5px] font-semibold text-primary hover:text-primary-hover bg-primary/15 hover:bg-primary/25 border border-primary/30 flex items-center gap-1.5 transition-all cursor-pointer active:scale-95 shadow-sm"
                        title="Choose custom folder to scan"
                      >
                        <FolderOpen size={12} />
                        <span>{customPath ? 'Change folder' : 'Browse folder'}</span>
                      </button>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-tile border border-border">
                  <Folder size={13} className="text-muted shrink-0" />
                  <span className="text-[12.5px] font-mono text-text break-all select-text leading-tight">{result.scannedPath}</span>
                </div>
              </div>

              {/* 3 Stats Grid */}
              <div className="grid grid-cols-3 gap-3">
                <div className="rounded-xl border border-border bg-tile/40 p-4">
                  <div className="text-[11px] font-bold tracking-wider text-muted uppercase mb-1.5">Selected</div>
                  <div className="text-[26px] font-bold text-text tabular-nums">{result.totalSelected.toLocaleString()}</div>
                </div>
                <div className="rounded-xl border border-border bg-tile/40 p-4">
                  <div className="text-[11px] font-bold tracking-wider text-muted uppercase mb-1.5">On Disk</div>
                  <div className={`text-[26px] font-bold tabular-nums ${onDiskCount > 0 ? 'text-amber-400' : 'text-text'}`}>
                    {result.onDiskCount.toLocaleString()}
                  </div>
                </div>
                <div className="rounded-xl border border-border bg-tile/40 p-4">
                  <div className="text-[11px] font-bold tracking-wider text-muted uppercase mb-1.5">Will Download</div>
                  <div className="text-[26px] font-bold text-primary tabular-nums">{willDownloadCount.toLocaleString()}</div>
                </div>
              </div>

              {/* Match Criteria Banner */}
              <div className={`rounded-xl border p-4 flex items-center justify-between gap-3.5 ${
                onDiskCount > 0
                  ? 'border-amber-500/30 bg-amber-950/20'
                  : 'border-emerald-500/30 bg-emerald-950/20'
              }`}>
                <div className="flex items-center gap-3.5">
                  <div className={`flex size-9 shrink-0 items-center justify-center rounded-full ${
                    onDiskCount > 0 ? 'bg-amber-500/20 text-amber-400' : 'bg-emerald-500/20 text-emerald-400'
                  }`}>
                    <Check size={18} strokeWidth={2.5} />
                  </div>
                  <div>
                    <div className={`text-[14px] font-semibold ${onDiskCount > 0 ? 'text-amber-100' : 'text-emerald-100'}`}>
                      Exact filename + exact byte size
                    </div>
                    <div className={`text-[12px] mt-0.5 ${onDiskCount > 0 ? 'text-amber-300/80' : 'text-emerald-300/80'}`}>
                      {result.filesScanned.toLocaleString()} files scanned · {fmtBytes(result.skippedBytes)} skipped
                    </div>
                  </div>
                </div>

                {onDiskCount > 0 && (
                  <button
                    type="button"
                    onClick={() => setShowDuplicatesList(!showDuplicatesList)}
                    className="text-[12px] font-medium text-amber-300 hover:text-white underline cursor-pointer shrink-0"
                  >
                    {showDuplicatesList ? 'Hide details' : 'View duplicates'}
                  </button>
                )}
              </div>

              {/* Duplicates Details & Skip Toggle */}
              {onDiskCount > 0 && (
                <div className="space-y-3 pt-1">
                  <label className="flex items-center gap-2.5 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={skipDuplicates}
                      onChange={(e) => setSkipDuplicates(e.target.checked)}
                      className="size-4 rounded accent-primary cursor-pointer"
                    />
                    <span className="text-[13px] font-medium text-text">
                      Skip duplicates on disk (recommended)
                    </span>
                  </label>

                  {showDuplicatesList && (
                    <div className="max-h-48 overflow-y-auto rounded-xl border border-white/10 bg-black/25 p-3 space-y-2 text-[12px]">
                      {result.duplicates.map((dup, idx) => (
                        <div key={idx} className="flex items-center justify-between gap-2 border-b border-white/5 pb-1.5 last:border-0 last:pb-0">
                          <div className="truncate text-slate-200">
                            <span className="font-medium">{dup.name}</span>
                            <span className="text-muted ml-2 font-mono text-[11px] truncate">({dup.diskPath})</span>
                          </div>
                          <span className="text-muted tabular-nums shrink-0">{fmtBytes(dup.size)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div className="py-12 text-center text-muted">No scan information available.</div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-border px-6 py-4 flex items-center justify-end gap-3 bg-tile/40">
          <Button variant="secondary" onClick={onClose} className="px-5 py-2">
            Cancel
          </Button>

          {loading ? (
            <Button disabled className="px-5 py-2 opacity-60 bg-primary/40 text-white">
              Checking...
            </Button>
          ) : (
            <Button
              onClick={handleConfirm}
              disabled={willDownloadCount === 0}
              className="px-6 py-2 font-semibold"
            >
              Continue with {willDownloadCount}
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
