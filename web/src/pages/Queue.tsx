// Phase 5.4: Queue page per UI.md - skeleton with all controls wired
import { useState } from 'react'
import { Download, Upload, CheckCircle2, XCircle, Pause, Play, ArrowUp, ArrowDown, RotateCcw, X } from 'lucide-react'
import { call, useCall } from '../api.ts'
import { Panel, SearchInput, Chip, Button, Avatar, Stat, Empty, ErrorState, Skeleton, Pagination, Thumb, Pill, Progress, fmtBytes, fmtSpeed, fmtEta, confirm, toast } from '../ui.tsx'

export default function Queue() {
  const [tab, setTab] = useState<'downloads' | 'uploads' | 'completed' | 'failed'>('downloads')
  const [status, setStatus] = useState<string>('open')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)

  const { data: live } = useCall<{ speed: { download: number, upload: number }, counts: Record<string, Record<string, number>>, history: number[], waitUntil: { download: number | null, upload: number | null } }>('stats.live', {}, ['stats'])
  const { data: jobs, reload: reloadJobs } = useCall<{ jobs: any[], total: number }>('jobs.list', {
    kind: tab === 'completed' || tab === 'failed' ? undefined : tab === 'downloads' ? 'download' : 'upload',
    status: tab === 'completed' ? 'completed' : tab === 'failed' ? 'failed' : status,
    q: search, page, pageSize: 25,
  }, ['jobs'])

  const counts = live?.counts || { download: {}, upload: {} }
  const downloadBadge = (counts.download.queued || 0) + (counts.download.active || 0) + (counts.download.paused || 0)
  const uploadBadge = (counts.upload.queued || 0) + (counts.upload.active || 0) + (counts.upload.paused || 0)

  async function jobAction(action: string, ids?: number[]) {
    try {
      await call('jobs.action', { action, ids })
      reloadJobs()
    } catch (e) {
      toast((e as Error).message, 'danger')
    }
  }

  async function clearAll() {
    const total = Object.values(counts.download).reduce((a, b) => a + b, 0) + Object.values(counts.upload).reduce((a, b) => a + b, 0)
    if (await confirm({ title: 'Clear All Jobs', message: `Remove all ${total} jobs? Partial downloads are deleted.`, confirm: 'Clear All', danger: true })) {
      await jobAction('cancel')
    }
  }

  return (
    <div className="flex h-full">
      <div className="flex-1 p-6 space-y-4">
        <div>
          <h1 className="text-[28px] font-bold">Queue</h1>
          <p className="mt-1 text-[13px] text-text-2">Manage your active and pending downloads and uploads</p>
        </div>

        <div className="flex gap-2">
          {[
            { value: 'downloads', label: 'Downloads', icon: Download, badge: downloadBadge },
            { value: 'uploads', label: 'Uploads', icon: Upload, badge: uploadBadge },
            { value: 'completed', label: 'Completed', icon: CheckCircle2 },
            { value: 'failed', label: 'Failed', icon: XCircle },
          ].map(({ value, label, icon: Icon, badge }) => (
            <button
              key={value} onClick={() => { setTab(value as any); setStatus('open'); setPage(1) }}
              className={`flex items-center gap-2 rounded-lg px-4 py-2 text-[13px] font-medium transition ${
                tab === value ? 'bg-primary text-text' : 'border border-border hover:border-primary'
              }`}
            >
              <Icon size={16} />{label}
              {badge !== undefined && badge > 0 && <span className="rounded-full bg-primary/20 px-2 py-0.5 text-[11px]">{badge}</span>}
            </button>
          ))}
        </div>

        <SearchInput value={search} onChange={(v) => { setSearch(v); setPage(1) }} placeholder="Search in queue..." />

        {(tab === 'downloads' || tab === 'uploads') && (
          <div className="flex gap-2">
            <Chip label="All" active={status === 'open'} onClick={() => setStatus('open')} />
            <Chip label={tab === 'downloads' ? 'Downloading' : 'Uploading'} active={status === 'active'} tone="success" count={counts[tab].active} onClick={() => setStatus('active')} />
            <Chip label="Paused" active={status === 'paused'} tone="warning" count={counts[tab].paused} onClick={() => setStatus('paused')} />
            <Chip label="Queued" active={status === 'queued'} count={counts[tab].queued} onClick={() => setStatus('queued')} />
          </div>
        )}

        <Panel>
          {!jobs ? <Skeleton className="h-96" /> : jobs.jobs.length === 0 ? (
            <Empty message={
              tab === 'downloads' ? 'No downloads in the queue' :
              tab === 'uploads' ? 'No uploads in the queue' :
              tab === 'completed' ? 'Nothing completed yet' : 'No failed jobs'
            } />
          ) : (
            <>
              <table className="w-full text-[13px]">
                <thead className="text-[12px] text-muted border-b border-border">
                  <tr>
                    <th className="text-left p-2">#</th>
                    <th className="text-left p-2">Name</th>
                    <th className="text-right p-2">Size</th>
                    <th className="text-left p-2">Progress</th>
                    <th className="text-left p-2">Status</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {jobs.jobs.map((j: any, i: number) => (
                    <tr key={j.id} className="border-b border-border hover:bg-tile">
                      <td className="p-2">{(page - 1) * 25 + i + 1}</td>
                      <td className="p-2 flex items-center gap-2">
                        <Thumb src={j.thumb} name={j.name} />
                        <span className="truncate">{j.name}</span>
                      </td>
                      <td className="p-2 text-right tabular-nums">{fmtBytes(j.size)}</td>
                      <td className="p-2"><Progress done={j.done} size={j.size} /></td>
                      <td className="p-2"><Pill kind={j.kind} status={j.status} finalizing={j.finalizing} /></td>
                      <td className="p-2">
                        <div className="flex gap-1">
                          {j.status === 'active' && <Button variant="secondary" onClick={() => jobAction('pause', [j.id])}><Pause size={14} /></Button>}
                          {j.status === 'paused' && <Button variant="secondary" onClick={() => jobAction('resume', [j.id])}><Play size={14} /></Button>}
                          {j.status === 'failed' && <Button variant="secondary" onClick={() => jobAction('retry', [j.id])}><RotateCcw size={14} /></Button>}
                          {(j.status === 'queued' || j.status === 'paused') && <Button variant="secondary" onClick={() => jobAction('up', [j.id])}><ArrowUp size={14} /></Button>}
                          {(j.status === 'queued' || j.status === 'paused') && <Button variant="secondary" onClick={() => jobAction('down', [j.id])}><ArrowDown size={14} /></Button>}
                          <Button variant="tint" tone="danger" onClick={() => jobAction('cancel', [j.id])}><X size={14} /></Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="mt-4">
                <Pagination page={page} pageSize={25} total={jobs.total} onPage={setPage} />
              </div>
            </>
          )}
        </Panel>
      </div>

      {/* Right column */}
      <div className="w-[290px] border-l border-border p-4 space-y-4">
        <Panel title="Queue Overview">
          <div className="grid grid-cols-2 gap-3">
            <Stat icon={<Download size={16} />} tone="primary" label="Total" value={live ? Object.values(counts[tab === 'uploads' ? 'upload' : 'download']).reduce((a, b) => a + b, 0) : undefined} />
            <Stat icon={<CheckCircle2 size={16} />} tone="success" label="Active" value={counts[tab === 'uploads' ? 'upload' : 'download']?.active} />
            <Stat icon={<Pause size={16} />} tone="warning" label="Queued" value={counts[tab === 'uploads' ? 'upload' : 'download']?.queued} />
            <Stat icon={<Pause size={16} />} tone="warning" label="Paused" value={counts[tab === 'uploads' ? 'upload' : 'download']?.paused} />
          </div>
        </Panel>

        <Panel title="Live Activity">
          {live && (
            <>
              <div className="mb-3 text-center">
                <div className="text-[32px] font-bold tabular-nums text-[#38bdf8]">{fmtSpeed((live.speed.download || 0) + (live.speed.upload || 0))}</div>
                <div className="text-[12px] text-muted">Total transfer speed</div>
              </div>
              <div className="space-y-1 text-[12px]">
                <div className="flex items-center gap-2"><div className="h-2 w-2 rounded-full bg-success" /><span>{(counts.download.active || 0) + (counts.upload.active || 0)} Active</span></div>
                <div className="flex items-center gap-2"><div className="h-2 w-2 rounded-full bg-primary" /><span>{(counts.download.queued || 0) + (counts.upload.queued || 0)} Queued</span></div>
                <div className="flex items-center gap-2"><div className="h-2 w-2 rounded-full bg-warning" /><span>{(counts.download.paused || 0) + (counts.upload.paused || 0)} Paused</span></div>
              </div>
            </>
          )}
        </Panel>

        <Panel title="Queue Actions">
          <div className="grid grid-cols-2 gap-2">
            <Button variant="tint" onClick={() => jobAction('pause')}>Pause All</Button>
            <Button variant="tint" tone="success" onClick={() => jobAction('resume')}>Resume All</Button>
            <Button variant="tint" onClick={() => jobAction('clear-completed')}>Clear Completed</Button>
            <Button variant="tint" tone="danger" onClick={clearAll}>Clear All</Button>
          </div>
        </Panel>
      </div>
    </div>
  )
}
