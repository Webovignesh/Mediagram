// Phase 5.4: Queue page - Revamped UI per awesome-design-md standards
import { useState } from 'react'
import { Download, Upload, CheckCircle2, XCircle, Pause, Play, ArrowUp, ArrowDown, RotateCcw, X, FolderOpen, CheckSquare, Square, FileText, Clock, Trash2 } from 'lucide-react'
import { call, useCall, useLive } from '../api.ts'
import type { LiveStats } from '../../../core/transfers.ts'
import { Panel, SearchInput, Chip, Button, Empty, ErrorState, Skeleton, Pagination, Thumb, Pill, Progress, MediaPreviewModal, fmtBytes, fmtSpeed, fmtEta, confirm, toast } from '../ui.tsx'

function Sparkline({ data }: { data: number[] }) {
  if (!data || data.length < 2) {
    return (
      <div className="flex h-12 w-full items-center justify-center rounded-lg border border-dashed border-white/10 bg-white/[0.02] text-[11px] text-muted">
        Awaiting transfer activity…
      </div>
    )
  }
  const max = Math.max(1, ...data)
  const width = 240
  const height = 48
  const points = data.map((v, i) => {
    const x = (i / (data.length - 1)) * width
    const y = height - (v / max) * (height - 8) - 4
    return `${x.toFixed(1)},${y.toFixed(1)}`
  }).join(' ')

  return (
    <div className="relative h-12 w-full overflow-hidden rounded-lg bg-black/20 p-1">
      <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className="h-full w-full overflow-visible">
        <defs>
          <linearGradient id="sparkGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#38bdf8" stopOpacity="0.4" />
            <stop offset="100%" stopColor="#38bdf8" stopOpacity="0.0" />
          </linearGradient>
        </defs>
        <polygon points={`0,${height} ${points} ${width},${height}`} fill="url(#sparkGrad)" />
        <polyline points={points} fill="none" stroke="#38bdf8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  )
}

export default function Queue() {
  const [previewItem, setPreviewItem] = useState<any>(null)
  const [tab, setTab] = useState<'downloads' | 'uploads' | 'completed' | 'failed'>('downloads')
  const [status, setStatus] = useState<string>('open')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [selectedIds, setSelectedIds] = useState<number[]>([])

  const liveState = useLive()
  const { data: live } = useCall<LiveStats>('stats.live', {}, ['stats'])
  const liveStats = liveState.stats || live

  const kindParam = tab === 'completed' || tab === 'failed' ? undefined : tab === 'downloads' ? 'download' : 'upload'
  const statusParam = tab === 'completed' ? 'completed' : tab === 'failed' ? 'failed' : status

  const { data: jobs, reload: reloadJobs, error: jobsErr } = useCall<{ items: any[], total: number }>('jobs.list', {
    kind: kindParam,
    status: statusParam,
    q: search || undefined,
    page,
    pageSize: 25,
  }, ['jobs'])

  const counts = liveStats?.counts || { download: {} as Record<string, number>, upload: {} as Record<string, number> }
  const currentCounts = counts[tab === 'uploads' ? 'upload' : 'download'] || {}
  const downloadBadge = (counts.download?.queued || 0) + (counts.download?.active || 0) + (counts.download?.paused || 0)
  const uploadBadge = (counts.upload?.queued || 0) + (counts.upload?.active || 0) + (counts.upload?.paused || 0)

  const liveActiveMap = new Map((liveStats?.active ?? []).map((a: any) => [Number(a.id), a]))
  const rawJobs = jobs?.items ?? (jobs as any)?.jobs ?? []
  const jobList = rawJobs.map((j: any) => {
    const act = liveActiveMap.get(Number(j.id))
    return act ? { ...j, done: act.done, size: act.size || j.size, eta: act.eta, speed: act.speed, finalizing: act.finalizing } : j
  })

  const toggleSelect = (id: number) => {
    setSelectedIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id])
  }

  const toggleSelectAll = () => {
    if (selectedIds.length === jobList.length) {
      setSelectedIds([])
    } else {
      setSelectedIds(jobList.map((j: any) => j.id))
    }
  }

  async function jobAction(action: string, ids?: number[]) {
    try {
      await call('jobs.action', { action, ids })
      reloadJobs()
      setSelectedIds([])
    } catch (e) {
      toast((e as Error).message, 'danger')
    }
  }

  async function revealFile(filePath: string) {
    try {
      await call('library.reveal', { path: filePath })
    } catch (e) {
      toast((e as Error).message, 'danger')
    }
  }

  async function clearAll() {
    const total = (counts.download ? Object.values(counts.download).reduce((a, b) => a + b, 0) : 0) +
      (counts.upload ? Object.values(counts.upload).reduce((a, b) => a + b, 0) : 0)
    if (await confirm({ title: 'Clear All Jobs', message: `Remove all ${total} jobs? Partial downloads are deleted.`, confirm: 'Clear All', danger: true })) {
      await jobAction('cancel')
    }
  }

  return (
    <div className="flex h-full overflow-hidden">
      <MediaPreviewModal
        open={!!previewItem}
        item={previewItem}
        onClose={() => setPreviewItem(null)}
      />
      {/* Left/Center main table */}
      <div className="flex-1 p-6 space-y-4 overflow-y-auto">
        <div className="flex items-center justify-between pr-40">
          <div>
            <h1 className="text-[26px] font-bold text-white tracking-wide">Queue</h1>
            <p className="mt-0.5 text-[13px] text-text-2">Manage your active and pending downloads and uploads</p>
          </div>
        </div>

        {/* Tab row */}
        <div className="flex flex-wrap items-center gap-2">
          {[
            { value: 'downloads', label: 'Downloads', icon: Download, badge: downloadBadge },
            { value: 'uploads', label: 'Uploads', icon: Upload, badge: uploadBadge },
            { value: 'completed', label: 'Completed', icon: CheckCircle2 },
            { value: 'failed', label: 'Failed', icon: XCircle },
          ].map(({ value, label, icon: Icon, badge }) => (
            <button
              key={value}
              onClick={() => { setTab(value as any); setStatus('open'); setPage(1); setSelectedIds([]) }}
              className={`flex items-center gap-2 rounded-xl px-4 py-2 text-[13px] font-medium transition-all ${
                tab === value
                  ? 'bg-primary text-white shadow-sm ring-1 ring-primary/40'
                  : 'border border-white/[0.08] bg-[#0c142b]/60 text-text-2 hover:border-white/20 hover:text-white hover:bg-white/[0.04]'
              }`}
            >
              <Icon size={15} />
              <span>{label}</span>
              {badge !== undefined && badge > 0 && (
                <span className="rounded-full bg-white/20 px-2 py-0.5 text-[11px] font-bold text-white">
                  {badge}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Search & filters */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="w-full max-w-sm">
            <SearchInput
              value={search}
              onChange={(v) => { setSearch(v); setPage(1) }}
              placeholder="Search in queue…"
            />
          </div>

          {(tab === 'downloads' || tab === 'uploads') && (
            <div className="flex flex-wrap items-center gap-1.5">
              <Chip label="All" active={status === 'open'} onClick={() => setStatus('open')} />
              <Chip label={tab === 'downloads' ? 'Downloading' : 'Uploading'} active={status === 'active'} tone="success" count={currentCounts.active} onClick={() => setStatus('active')} />
              <Chip label="Paused" active={status === 'paused'} tone="warning" count={currentCounts.paused} onClick={() => setStatus('paused')} />
              <Chip label="Queued" active={status === 'queued'} count={currentCounts.queued} onClick={() => setStatus('queued')} />
            </div>
          )}
        </div>

        {/* Batch action bar */}
        {selectedIds.length > 0 && (
          <div className="flex items-center justify-between rounded-xl border border-primary/40 bg-primary/15 px-4 py-2.5 text-[13px] text-text shadow-sm">
            <div className="font-semibold">{selectedIds.length} jobs selected</div>
            <div className="flex items-center gap-2">
              <Button variant="secondary" onClick={() => jobAction('pause', selectedIds)} className="py-1 px-3 text-[12px]">Pause</Button>
              <Button variant="secondary" onClick={() => jobAction('resume', selectedIds)} className="py-1 px-3 text-[12px]">Resume</Button>
              <Button variant="secondary" onClick={() => jobAction('retry', selectedIds)} className="py-1 px-3 text-[12px]">Retry</Button>
              <Button variant="tint" tone="danger" onClick={() => jobAction('cancel', selectedIds)} className="py-1 px-3 text-[12px]">Cancel</Button>
              <button onClick={() => setSelectedIds([])} className="text-[12px] text-muted hover:text-white ml-2 underline">Clear</button>
            </div>
          </div>
        )}

        {/* Table Panel */}
        <div className="rounded-xl border border-white/[0.08] bg-[#0c1530]/85 backdrop-blur-md p-4 shadow-sm">
          {jobsErr ? (
            <ErrorState error={jobsErr} onRetry={reloadJobs} />
          ) : !jobs ? (
            <div className="space-y-3 p-4">
              {[...Array(6)].map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
            </div>
          ) : jobList.length === 0 ? (
            <Empty message={
              tab === 'downloads' ? 'No downloads in the queue' :
              tab === 'uploads' ? 'No uploads in the queue' :
              tab === 'completed' ? 'Nothing completed yet' : 'No failed jobs'
            } />
          ) : (
            <div className="space-y-3 overflow-x-auto">
              <table className="w-full text-[13px] table-fixed">
                <thead className="border-b border-white/[0.08] text-[12px] text-muted">
                  <tr>
                    <th className="py-2.5 px-1 text-center w-10">
                      <button onClick={toggleSelectAll} className="text-muted hover:text-white">
                        {selectedIds.length === jobList.length && jobList.length > 0 ? (
                          <CheckSquare size={15} className="text-primary" />
                        ) : (
                          <Square size={15} />
                        )}
                      </button>
                    </th>
                    <th className="py-2.5 px-1 text-center w-10 text-muted font-normal">#</th>
                    <th className="py-2.5 px-3 text-left w-[36%]">Name</th>
                    <th className="py-2.5 px-2 text-center w-24">Size</th>
                    <th className="py-2.5 px-4 text-left w-56">Progress</th>
                    <th className="py-2.5 px-2 text-center w-32">Status</th>
                    <th className="py-2.5 px-2 text-right w-24">ETA</th>
                    <th className="py-2.5 px-3 text-right w-28">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.05]">
                  {jobList.map((j: any, i: number) => {
                    const isSelected = selectedIds.includes(j.id)
                    return (
                      <tr key={j.id} className={`hover:bg-white/[0.03] transition-colors ${isSelected ? 'bg-primary/10' : ''}`}>
                        <td className="py-2.5 px-1 text-center">
                          <button onClick={() => toggleSelect(j.id)} className="text-muted hover:text-white">
                            {isSelected ? <CheckSquare size={15} className="text-primary" /> : <Square size={15} />}
                          </button>
                        </td>
                        <td className="py-2.5 px-1 text-center text-muted text-[11px]">{(page - 1) * 25 + i + 1}</td>
                        <td className="py-2.5 px-3 min-w-0">
                          <div
                            className="flex items-center gap-2.5 cursor-pointer group min-w-0"
                            title="Click for preview"
                            onClick={() => setPreviewItem({ name: j.name, path: j.path, thumb: j.thumb, type: j.type, size: j.size })}
                          >
                            <Thumb src={j.thumb} name={j.name} />
                            <div className="min-w-0 flex-1 truncate">
                              <div className="truncate font-medium text-text group-hover:text-primary transition-colors text-[13px]" title={j.name}>
                                {j.name}
                              </div>
                              {j.chatTitle && <div className="text-[11px] text-muted truncate">{j.chatTitle}</div>}
                            </div>
                          </div>
                        </td>
                        <td className="py-2.5 px-2 text-center tabular-nums text-text-2 font-medium">{fmtBytes(j.size)}</td>
                        <td className="py-2.5 px-4">
                          <Progress done={j.done || 0} size={j.size || 0} tone={j.kind === 'upload' ? 'warning' : 'primary'} />
                        </td>
                        <td className="py-2.5 px-2 text-center">
                          <Pill kind={j.kind} status={j.status} finalizing={j.finalizing} />
                        </td>
                        <td className="py-2.5 px-2 text-right tabular-nums text-[12px]">
                          {j.status === 'active' && j.speed > 0 && (
                            <span className="text-cyan block text-[11px] font-semibold">{fmtSpeed(j.speed)}</span>
                          )}
                          <span className="text-muted">{j.eta ? fmtEta(j.eta) : '-'}</span>
                        </td>
                        <td className="py-2.5 px-3 text-right">
                          <div className="flex items-center justify-end gap-1">
                            {j.status === 'active' && (
                              <button onClick={() => jobAction('pause', [j.id])} className="rounded p-1.5 hover:bg-white/10 text-muted hover:text-white transition-colors" title="Pause">
                                <Pause size={14} />
                              </button>
                            )}
                            {j.status === 'paused' && (
                              <button onClick={() => jobAction('resume', [j.id])} className="rounded p-1.5 hover:bg-white/10 text-muted hover:text-white transition-colors" title="Resume">
                                <Play size={14} />
                              </button>
                            )}
                            {j.status === 'failed' && (
                              <button onClick={() => jobAction('retry', [j.id])} className="rounded p-1.5 hover:bg-warning/20 text-warning transition-colors" title="Retry">
                                <RotateCcw size={14} />
                              </button>
                            )}
                            {j.status === 'completed' && j.path && (
                              <button onClick={() => revealFile(j.path)} className="rounded p-1.5 text-primary hover:bg-primary/20 transition-colors" title="Show in folder">
                                <FolderOpen size={14} />
                              </button>
                            )}
                            <button onClick={() => jobAction('cancel', [j.id])} className="rounded p-1.5 hover:bg-danger/20 text-muted hover:text-danger transition-colors" title="Remove">
                              <X size={14} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>

              {jobs.total > 25 && (
                <div className="pt-3 border-t border-white/[0.08]">
                  <Pagination page={page} pageSize={25} total={jobs.total} onPage={setPage} />
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Right column (~290px) */}
      <div className="w-[300px] shrink-0 border-l border-white/[0.08] bg-[#070d1d]/60 p-4 space-y-4 overflow-y-auto">
        <Panel title="Queue Overview">
          <div className="grid grid-cols-2 gap-2">
            <div className="flex flex-col justify-between rounded-xl border border-white/[0.08] bg-[#0c142b]/80 p-3 hover:border-white/20 transition-colors">
              <div className="flex items-center justify-between text-muted">
                <span className="text-[10px] font-bold tracking-wider uppercase">Total</span>
                <span className="grid size-6 place-items-center rounded-md bg-cyan/15 text-cyan">
                  <FileText size={13} />
                </span>
              </div>
              <div className="mt-2 text-[20px] font-bold tabular-nums text-white">
                {Object.values(currentCounts).reduce((a, b) => a + b, 0)}
              </div>
            </div>

            <div className="flex flex-col justify-between rounded-xl border border-white/[0.08] bg-[#0c142b]/80 p-3 hover:border-white/20 transition-colors">
              <div className="flex items-center justify-between text-muted">
                <span className="text-[10px] font-bold tracking-wider uppercase">{tab === 'uploads' ? 'Uploading' : 'Active'}</span>
                <span className="grid size-6 place-items-center rounded-md bg-success/15 text-success">
                  <Download size={13} />
                </span>
              </div>
              <div className="mt-2 text-[20px] font-bold tabular-nums text-success">
                {currentCounts.active || 0}
              </div>
            </div>

            <div className="flex flex-col justify-between rounded-xl border border-white/[0.08] bg-[#0c142b]/80 p-3 hover:border-white/20 transition-colors">
              <div className="flex items-center justify-between text-muted">
                <span className="text-[10px] font-bold tracking-wider uppercase">Queued</span>
                <span className="grid size-6 place-items-center rounded-md bg-upload/15 text-upload">
                  <Clock size={13} />
                </span>
              </div>
              <div className="mt-2 text-[20px] font-bold tabular-nums text-upload">
                {currentCounts.queued || 0}
              </div>
            </div>

            <div className="flex flex-col justify-between rounded-xl border border-white/[0.08] bg-[#0c142b]/80 p-3 hover:border-white/20 transition-colors">
              <div className="flex items-center justify-between text-muted">
                <span className="text-[10px] font-bold tracking-wider uppercase">Paused</span>
                <span className="grid size-6 place-items-center rounded-md bg-warning/15 text-warning">
                  <Pause size={13} />
                </span>
              </div>
              <div className="mt-2 text-[20px] font-bold tabular-nums text-warning">
                {currentCounts.paused || 0}
              </div>
            </div>
          </div>
        </Panel>

        <Panel title="Live Activity">
          {liveStats && (
            <div className="space-y-3.5">
              <Sparkline data={liveStats.history || []} />
              <div className="rounded-xl border border-white/[0.06] bg-[#0c142b]/60 p-3 text-center">
                <div className="flex items-center justify-center gap-2">
                  <span className={`size-2 rounded-full ${((liveStats.speed?.download || 0) + (liveStats.speed?.upload || 0)) > 0 ? 'bg-cyan animate-pulse' : 'bg-muted'}`} />
                  <span className="text-[22px] font-bold tabular-nums text-cyan tracking-tight">
                    {fmtSpeed((liveStats.speed?.download || 0) + (liveStats.speed?.upload || 0))}
                  </span>
                </div>
                <div className="mt-0.5 text-[11px] text-muted font-medium">Network throughput</div>
              </div>

              <div className="flex items-center justify-around gap-1 rounded-lg border border-white/[0.06] bg-black/20 p-2 text-[11px]">
                <span className="flex items-center gap-1.5 font-medium text-text-2">
                  <span className="size-2 rounded-full bg-success" />
                  <span className="tabular-nums font-bold text-white">{(counts.download?.active || 0) + (counts.upload?.active || 0)}</span> Active
                </span>
                <span className="text-white/10">|</span>
                <span className="flex items-center gap-1.5 font-medium text-text-2">
                  <span className="size-2 rounded-full bg-upload" />
                  <span className="tabular-nums font-bold text-white">{(counts.download?.queued || 0) + (counts.upload?.queued || 0)}</span> Queued
                </span>
                <span className="text-white/10">|</span>
                <span className="flex items-center gap-1.5 font-medium text-text-2">
                  <span className="size-2 rounded-full bg-warning" />
                  <span className="tabular-nums font-bold text-white">{(counts.download?.paused || 0) + (counts.upload?.paused || 0)}</span> Paused
                </span>
              </div>
            </div>
          )}
        </Panel>

        <Panel title="Queue Actions">
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => jobAction('pause')}
              className="flex items-center justify-center gap-2 rounded-lg border border-white/[0.08] bg-[#0f1a38] px-3 py-2 text-[12px] font-medium text-text-2 hover:border-warning/40 hover:text-warning hover:bg-warning/10 transition-colors"
            >
              <Pause size={13} className="text-warning" />
              <span>Pause All</span>
            </button>
            <button
              onClick={() => jobAction('resume')}
              className="flex items-center justify-center gap-2 rounded-lg border border-white/[0.08] bg-[#0f1a38] px-3 py-2 text-[12px] font-medium text-text-2 hover:border-success/40 hover:text-success hover:bg-success/10 transition-colors"
            >
              <Play size={13} className="text-success" />
              <span>Resume All</span>
            </button>
            <button
              onClick={() => jobAction('clear-completed')}
              className="flex items-center justify-center gap-2 rounded-lg border border-white/[0.08] bg-[#0f1a38] px-3 py-2 text-[12px] font-medium text-text-2 hover:border-white/20 hover:text-white hover:bg-white/[0.06] transition-colors"
            >
              <CheckCircle2 size={13} className="text-muted" />
              <span>Clear Done</span>
            </button>
            <button
              onClick={clearAll}
              className="flex items-center justify-center gap-2 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-[12px] font-medium text-danger hover:border-danger hover:bg-danger/20 transition-colors"
            >
              <Trash2 size={13} className="text-danger" />
              <span>Clear All</span>
            </button>
          </div>
        </Panel>
      </div>
    </div>
  )
}
