import { useState, useEffect, useMemo } from 'react'
import { Download, Upload, CheckCircle2, XCircle, Pause, Play, RotateCcw, X, FolderOpen, ArrowUp, ArrowDown, ArrowUpRight, Clock } from 'lucide-react'
import { call, useCall, useLive, useRouteQuery } from '../api.ts'
import type { Job, Action } from '../../../core/db.ts'
import type { LiveStats } from '../../../core/transfers.ts'
import { SearchInput, Chip, Button, Empty, ErrorState, Skeleton, Pagination, Thumb, Pill, Progress, MediaPreviewModal, fmtBytes, fmtSpeed, fmtEta, confirm, toast } from '../ui.tsx'

type Tab = 'downloads' | 'uploads' | 'completed' | 'failed'
const tabs: { value: Tab, label: string, icon: typeof Download }[] = [
  { value: 'downloads', label: 'Downloads', icon: Download },
  { value: 'uploads', label: 'Uploads', icon: Upload },
  { value: 'completed', label: 'Completed', icon: CheckCircle2 },
  { value: 'failed', label: 'Failed', icon: XCircle },
]
const validTab = (value: string | null): value is Tab => tabs.some((t) => t.value === value)
const time = (value: number | null) => value ? new Date(value).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : ''

const EMPTY_ARGS = {}

export default function Queue() {
  const routeTab = useRouteQuery().get('tab')
  const [tab, setTab] = useState<Tab>(() => {
    if (validTab(routeTab)) return routeTab
    try { const saved = localStorage.getItem('mediagram_queue_tab'); if (validTab(saved)) return saved } catch {}
    return 'downloads'
  })
  const [status, setStatus] = useState('open')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState<number[]>([])
  const [busy, setBusy] = useState(false)
  const [preview, setPreview] = useState<Job | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const liveState = useLive()
  const { data: initialLive } = useCall<LiveStats>('stats.live', EMPTY_ARGS, [])
  const live = liveState.stats ?? initialLive
  const kind = tab === 'downloads' ? 'download' : tab === 'uploads' ? 'upload' : undefined
  const jobsArgs = useMemo(() => ({
    kind, status: kind ? status : tab === 'completed' ? 'completed' : 'failed', q: search, page, pageSize: 25,
  }), [kind, status, tab, search, page])
  const { data: jobs, reload, error } = useCall<{ items: Job[], total: number }>('jobs.list', jobsArgs, ['jobs'])

  // URL changes take over once. Including `tab` here would continuously undo the user's tab clicks.
  useEffect(() => {
    if (validTab(routeTab)) { setTab(routeTab); setStatus('open'); setPage(1); setSelected([]) }
  }, [routeTab])
  useEffect(() => { try { localStorage.setItem('mediagram_queue_tab', tab) } catch {} }, [tab])
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer) }, [])
  useEffect(() => { setSelected([]) }, [tab, status, search, page])
  useEffect(() => {
    if (jobs && page > 1 && page > Math.max(1, Math.ceil(jobs.total / 25))) setPage(Math.max(1, Math.ceil(jobs.total / 25)))
  }, [jobs?.total, page])

  const counts = live?.counts
  const count = (state: string, direction?: 'download' | 'upload') => direction
    ? counts?.[direction]?.[state as keyof NonNullable<typeof counts>['download']] ?? 0
    : (counts?.download?.[state as keyof NonNullable<typeof counts>['download']] ?? 0) + (counts?.upload?.[state as keyof NonNullable<typeof counts>['upload']] ?? 0)
  const openCount = (direction: 'download' | 'upload') => count('queued', direction) + count('active', direction) + count('paused', direction)
  const active = new Map((live?.active ?? []).map((job) => [job.id, job]))
  // `items` is the real IPC contract; the fallback supports older cached renderer responses.
  const list = (jobs?.items ?? (jobs as any)?.jobs ?? []) as Job[]
  const allSelected = list.length > 0 && list.every((job) => selected.includes(job.id))
  const selectedJobs = list.filter((job) => selected.includes(job.id))

  function filterTo(value: string) { setStatus(value); setPage(1); setSelected([]) }
  function switchTab(value: Tab) {
    setTab(value); filterTo('open')
    if (routeTab !== null) window.location.assign(`#/queue?tab=${value}`)
  }
  async function action(value: Action, ids?: number[]) {
    if (busy) return
    setBusy(true)
    try { await call('jobs.action', { action: value, ids }); setSelected([]); reload() }
    catch (e) { toast((e as Error).message, 'danger') }
    finally { setBusy(false) }
  }
  async function reveal(filePath: string) {
    try { await call('library.reveal', { path: filePath }) } catch (e) { toast((e as Error).message, 'danger') }
  }
  async function clearAll() {
    const total = ['queued', 'active', 'paused', 'completed', 'failed'].reduce((n, state) => n + count(state), 0)
    if (await confirm({ title: 'Clear all jobs', message: `Remove all ${total} jobs from both queues? Active uploads are canceled and partial downloads are deleted. Completed files stay on disk.`, confirm: 'Clear all', danger: true })) await action('cancel')
  }

  return (
    <div className="h-full overflow-y-auto [scrollbar-gutter:stable] p-6 space-y-5">
      <MediaPreviewModal open={!!preview} item={preview ? { ...preview, messageId: preview.messageId ?? undefined } : null} onClose={() => setPreview(null)} />
      <div className="pr-36">
        <h1 className="text-[26px] font-bold text-text">Queue</h1>
        <p className="text-[13px] text-text-2 mt-1">Manage every transfer, from waiting to sent or saved.</p>
      </div>

      <section aria-label="Queue Overview" className="grid grid-cols-2 xl:grid-cols-4 gap-3">
        {[
          { label: 'Downloading', value: fmtSpeed(live?.speed.download ?? 0), detail: `${count('active', 'download')} active · ${count('queued', 'download')} waiting`, icon: Download },
          { label: 'Uploading', value: fmtSpeed(live?.speed.upload ?? 0), detail: `${count('active', 'upload')} active · ${count('queued', 'upload')} waiting`, icon: Upload },
          { label: 'Paused', value: count('paused'), detail: 'Ready to resume', icon: Pause },
          { label: 'Needs attention', value: count('failed'), detail: 'Open Failed to see the reason', icon: XCircle },
        ].map(({ label, value, detail, icon: Icon }) => <div key={label} className="rounded-xl border border-border bg-panel p-4">
          <div className="flex items-center justify-between text-text-2 text-[12px]"><span>{label}</span><Icon size={16} className="text-primary" /></div>
          <div className="mt-2 text-xl font-semibold text-text tabular-nums">{value}</div>
          <div className="mt-1 text-[11px] text-muted">{detail}</div>
        </div>)}
      </section>

      {(['download', 'upload'] as const).map((direction) => {
        const until = live?.waitUntil[direction]
        return until && until > now ? <div key={direction} role="status" className="flex items-center gap-2 rounded-lg border border-warning/30 bg-warning/10 p-3 text-[13px] text-warning">
          <Clock size={16} /> Telegram asked {direction === 'upload' ? 'uploads' : 'downloads'} to wait {fmtEta((until - now) / 1000)}. Transfers resume automatically.
        </div> : null
      })}

      <section className="rounded-xl border border-border bg-panel overflow-hidden" aria-label="Transfer queue">
        <div className="p-4 border-b border-border space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div role="tablist" aria-label="Transfer categories" className="flex flex-wrap gap-1 rounded-xl bg-tile p-1 border border-border shadow-xs">
              {tabs.map(({ value, label, icon: Icon }) => {
                const badge = value === 'downloads' ? openCount('download') : value === 'uploads' ? openCount('upload') : count(value === 'completed' ? 'completed' : 'failed')
                return <button key={value} role="tab" aria-selected={tab === value} onClick={() => switchTab(value)} className={`flex items-center gap-1.5 rounded-lg px-3 py-1 text-[12.5px] font-medium transition-all cursor-pointer ${tab === value ? 'bg-primary text-white shadow-sm' : 'text-text-2 hover:bg-panel hover:text-text'}`}>
                  <Icon size={13} />{label}<span className={`rounded-md px-1.5 py-0.5 text-[10.5px] font-semibold tabular-nums leading-none transition-colors ${tab === value ? 'bg-white/20 text-white' : 'bg-panel/80 text-muted border border-border/50'}`}>{badge}</span>
                </button>
              })}
            </div>
            <div className="w-full sm:w-64"><SearchInput placeholder="Search in queue…" value={search} onChange={(v) => { setSearch(v); setPage(1) }} /></div>
          </div>
          <div className="flex items-center justify-between flex-wrap gap-3">
            {kind ? <div className="flex flex-wrap gap-2">
              <Chip label="All" active={status === 'open'} onClick={() => filterTo('open')} />
              <Chip label={kind === 'upload' ? 'Uploading' : 'Downloading'} active={status === 'active'} count={count('active', kind)} onClick={() => filterTo('active')} />
              <Chip label="Queued" active={status === 'queued'} count={count('queued', kind)} onClick={() => filterTo('queued')} />
              <Chip label="Paused" active={status === 'paused'} count={count('paused', kind)} onClick={() => filterTo('paused')} />
            </div> : <span className="text-[12px] text-muted">Downloads and uploads</span>}
            <span className="text-[12px] text-muted tabular-nums">{jobs?.total ?? 0} transfers</span>
          </div>
        </div>

        {selected.length > 0 && <div className="px-4 py-3 border-b border-primary/20 bg-primary/10 flex flex-wrap items-center gap-2 text-[12px] animate-in fade-in slide-in-from-top-1 duration-150">
          <span className="font-semibold text-text mr-auto">{selected.length} selected</span>
          {selectedJobs.some((j) => j.status === 'queued' || j.status === 'active') && <Button variant="secondary" disabled={busy} onClick={() => action('pause', selected)}>Pause selected</Button>}
          {selectedJobs.some((j) => j.status === 'paused') && <Button variant="secondary" disabled={busy} onClick={() => action('resume', selected)}>Resume selected</Button>}
          {selectedJobs.some((j) => j.status === 'failed') && <Button variant="secondary" disabled={busy} onClick={() => action('retry', selected)}>Retry selected</Button>}
          <Button variant="tint" tone="danger" disabled={busy} onClick={() => action('cancel', selected)}>Remove selected</Button>
          <button onClick={() => setSelected([])} className="text-primary hover:underline">Deselect</button>
        </div>}

        {error ? <ErrorState error={error} onRetry={reload} /> : !jobs ? <div className="p-4 space-y-3">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-20 w-full" />)}</div> : list.length === 0 ? <div className="py-12"><Empty message={search ? 'No transfers match your search' : tab === 'downloads' ? 'No downloads in the queue' : tab === 'uploads' ? 'No uploads in the queue' : tab === 'completed' ? 'Nothing completed yet' : 'No failed jobs'} /></div> : <>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[880px] text-[13px] table-fixed">
              <colgroup>
                <col className="w-10" />
                <col className="w-[28%]" />
                <col className="w-[18%]" />
                <col className="w-[15%]" />
                <col className="w-[15%]" />
                <col className="w-[12%]" />
                <col className="w-24" />
              </colgroup>
              <thead className="bg-tile/50 text-muted text-[11px] border-b border-border select-none">
                <tr>
                  <th className="py-2.5 text-center"><input type="checkbox" aria-label="Select all transfers on this page" checked={allSelected} onChange={() => setSelected(allSelected ? [] : list.map((j) => j.id))} /></th>
                  <th className="text-left px-3 font-semibold">File & destination</th>
                  <th className="text-left px-3 font-semibold">Progress</th>
                  <th className="text-left px-3 font-semibold">Transferred</th>
                  <th className="text-center px-3 font-semibold">Speed & ETA</th>
                  <th className="text-center px-3 font-semibold">Status</th>
                  <th className="text-center px-3 font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {list.map((j) => {
                  const running = active.get(j.id)
                  const size = running?.size || j.size
                  const done = Math.min(running?.done ?? j.done, size)
                  const finalizing = !!running?.finalizing
                  const canPreview = j.kind === 'download' && j.status === 'completed' && !!j.path
                  const canPause = (j.status === 'active' || j.status === 'queued') && !finalizing
                  return <tr key={j.id} className={`align-middle hover:bg-tile/30 ${selected.includes(j.id) ? 'bg-primary/5' : ''}`} data-job-id={j.id}>
                    <td className="text-center py-3.5 align-middle"><input type="checkbox" aria-label={`Select ${j.name}`} checked={selected.includes(j.id)} onChange={() => setSelected((prev) => prev.includes(j.id) ? prev.filter((id) => id !== j.id) : [...prev, j.id])} /></td>
                    <td className="px-3 py-3.5 align-middle">
                      <div className="flex items-center gap-3 min-w-0"><Thumb src={j.thumb} name={j.name} /><div className="min-w-0 flex-1">
                        <button disabled={!canPreview} onClick={() => setPreview(j)} className={`text-left font-semibold text-text truncate max-w-full block leading-snug ${canPreview ? 'hover:text-primary cursor-pointer' : ''}`} title={j.name}>{j.name}</button>
                        <a href={`#/downloads?chat=${j.chatId}`} className="mt-0.5 flex items-center gap-1 text-[11px] text-primary hover:underline truncate" title={`Open ${j.chatTitle}`}><ArrowUpRight size={12} className="shrink-0" /><span className="truncate">{j.chatTitle || 'Chat'}</span></a>
                        <div className="mt-0.5 text-[10px] text-muted flex items-center gap-1">{j.kind === 'upload' ? <Upload size={10} /> : <Download size={10} />}{j.kind === 'upload' ? 'Upload' : 'Download'} · {j.type}</div>
                      </div></div>
                    </td>
                    <td className="px-3 py-3.5 align-middle">
                      <Progress done={done} size={size} tone={j.kind === 'upload' ? 'warning' : 'primary'} showValues={false} />
                      {j.error && <div role="alert" className="mt-1 text-[11px] text-danger break-words leading-tight">{j.error}</div>}
                    </td>
                    <td className="px-3 py-3.5 align-middle">
                      <div className="text-[12px] font-medium text-text tabular-nums">{fmtBytes(done)} / {fmtBytes(size)}</div>
                      {j.retryAt && j.retryAt > now && <div className="mt-0.5 text-[10.5px] text-warning font-medium">Retry in {fmtEta((j.retryAt - now) / 1000)}</div>}
                    </td>
                    <td className="px-3 py-3.5 text-center align-middle">
                      {j.status === 'active' ? (
                        <div className="flex flex-col items-center justify-center space-y-0.5">
                          <div className="text-[12px] font-semibold text-primary tabular-nums">
                            {finalizing ? 'Saving file…' : j.kind === 'upload' && size > 0 && done >= size ? 'Sending…' : running?.speed ? fmtSpeed(running.speed) : 'Connecting…'}
                          </div>
                          {running?.eta != null && !finalizing && (
                            <div className="text-[11px] text-muted tabular-nums flex items-center justify-center gap-1">
                              <Clock size={11} className="opacity-70 shrink-0" />
                              <span>{fmtEta(running.eta)} left</span>
                            </div>
                          )}
                        </div>
                      ) : j.status === 'paused' ? (
                        <span className="text-[11.5px] text-muted italic inline-block text-center">Paused</span>
                      ) : j.status === 'queued' ? (
                        <span className="text-[11.5px] text-muted italic inline-block text-center">Waiting…</span>
                      ) : j.status === 'completed' ? (
                        <span className="text-[11.5px] text-success font-medium inline-block text-center">Finished</span>
                      ) : (
                        <span className="text-[11.5px] text-muted inline-block text-center">—</span>
                      )}
                    </td>
                    <td className="px-3 py-3.5 text-center align-middle">
                      <div className="flex flex-col items-center justify-center">
                        <Pill kind={j.kind} status={j.status} finalizing={finalizing} />
                        {j.finishedAt && <div className="mt-1 text-[10px] text-muted tabular-nums text-center">{time(j.finishedAt)}</div>}
                      </div>
                    </td>
                    <td className="px-3 py-3.5 text-center align-middle">
                      <div className="flex items-center justify-center gap-1">
                        {canPause && <button aria-label={`Pause ${j.name}`} title="Pause" disabled={busy} onClick={() => action('pause', [j.id])} className="p-1.5 rounded hover:bg-tile text-text-2 cursor-pointer"><Pause size={15} /></button>}
                        {j.status === 'paused' && <button aria-label={`Resume ${j.name}`} title="Resume" disabled={busy} onClick={() => action('resume', [j.id])} className="p-1.5 rounded hover:bg-tile text-primary cursor-pointer"><Play size={15} /></button>}
                        {j.status === 'failed' && <button aria-label={`Retry ${j.name}`} title="Retry" disabled={busy} onClick={() => action('retry', [j.id])} className="p-1.5 rounded hover:bg-tile text-warning cursor-pointer"><RotateCcw size={15} /></button>}
                        {j.status === 'completed' && j.kind === 'download' && j.path && <button aria-label={`Show ${j.name} in folder`} title="Show in folder" onClick={() => reveal(j.path!)} className="p-1.5 rounded hover:bg-tile text-primary cursor-pointer"><FolderOpen size={15} /></button>}
                        <button aria-label={`Remove ${j.name}`} title="Remove" disabled={busy || finalizing} onClick={() => action('cancel', [j.id])} className="p-1.5 rounded hover:bg-danger/10 text-muted hover:text-danger cursor-pointer"><X size={15} /></button>
                        {j.status === 'queued' && <>
                          <button aria-label={`Move ${j.name} up`} title="Move up" disabled={busy} onClick={() => action('up', [j.id])} className="p-1.5 rounded hover:bg-tile text-muted cursor-pointer"><ArrowUp size={13} /></button>
                          <button aria-label={`Move ${j.name} down`} title="Move down" disabled={busy} onClick={() => action('down', [j.id])} className="p-1.5 rounded hover:bg-tile text-muted cursor-pointer"><ArrowDown size={13} /></button>
                        </>}
                      </div>
                    </td>
                  </tr>
                })}
              </tbody>
            </table>
          </div>
          {jobs.total > 25 && <div className="p-3 border-t border-border"><Pagination page={page} pageSize={25} total={jobs.total} onPage={setPage} /></div>}
        </>}
      </section>

      <div className="flex items-center justify-between gap-3 flex-wrap text-[12px]">
        <div className="text-muted"><span className="font-medium text-text-2">Live Activity</span> · {count('active')} active · {count('queued')} waiting · {count('completed')} completed</div>
        <section aria-label="Queue Actions" className="flex flex-wrap gap-2 items-center">
          <span className="sr-only">Queue Actions</span>
          <Button variant="secondary" disabled={busy || count('active') + count('queued') === 0} onClick={() => action('pause')}>Pause All</Button>
          <Button variant="secondary" disabled={busy || count('paused') === 0} onClick={() => action('resume')}>Resume All</Button>
          <Button variant="tint" tone="danger" disabled={busy} onClick={clearAll}>Clear All</Button>
        </section>
      </div>
    </div>
  )
}
