// Phase 5.1: Overview page per UI.md & Mockup Reference
import { useState } from 'react'
import { Activity, CheckCircle2, FileStack, AlertTriangle, MoreVertical, Play, Pause, ArrowDown, ArrowUp, XCircle } from 'lucide-react'
import { call, useCall, useLive, navigate } from '../api.ts'
import type { LiveStats } from '../../../core/transfers.ts'
import { Panel, Stat, Select, Avatar, Pill, Progress, IconButton, Menu, Empty, ErrorState, Skeleton, MediaPreviewModal, fmtBytes, fmtAgo, fmtEta, fmtSpeed, typeLabel, toast } from '../ui.tsx'

type KindCount = { download: number, upload: number }
type OverviewStats = { completedToday: KindCount, totalFiles: KindCount, recent: RecentItem[] }
type TopChat = { chatId: number, title: string, photo: string | null, count: number }
type RecentItem = { id: number, kind: 'download' | 'upload', preview: string | null, type: string, chatTitle: string, name: string, finishedAt: number, size: number, status: 'completed' | 'failed' }
type Job = { id: number, kind: 'download' | 'upload', chatId: number, chatTitle: string, chatUsername: string | null, chatPhoto: string | null, name: string, size: number, done: number, status: string, finalizing: boolean, eta: number | null, path?: string | null, thumb?: string | null, type?: string, speed?: number }

function AreaChart({
  activity,
  range,
}: {
  activity?: { buckets: any[], download?: number[], upload?: number[] }
  range: string
}) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null)
  
  const rawBuckets = Array.isArray(activity?.buckets) ? activity.buckets : []
  let buckets: any[] = []
  let download: number[] = Array.isArray(activity?.download) ? activity.download : []
  let upload: number[] = Array.isArray(activity?.upload) ? activity.upload : []

  if (rawBuckets.length > 0 && typeof rawBuckets[0] === 'object' && rawBuckets[0] !== null) {
    buckets = rawBuckets.map((b: any, i: number) => b.label || String(i))
    download = rawBuckets.map((b: any) => Number(b.download) || 0)
    upload = rawBuckets.map((b: any) => Number(b.upload) || 0)
  } else {
    buckets = rawBuckets
  }

  if (!buckets.length) {
    return <div className="flex h-44 items-center justify-center text-[13px] text-muted">No transfers in this period</div>
  }

  const n = buckets.length
  const maxVal = Math.max(1, ...(download.length ? download : [0]), ...(upload.length ? upload : [0]))

  const width = 420
  const height = 150
  const padL = 28
  const padR = 12
  const padT = 12
  const padB = 22
  const innerW = width - padL - padR
  const innerH = height - padT - padB

  const getX = (i: number) => padL + (i / Math.max(1, n - 1)) * innerW
  const getY = (v: number) => padT + innerH - (v / maxVal) * innerH

  const formatBucketLabel = (tsOrLabel: any) => {
    if (typeof tsOrLabel === 'string') return tsOrLabel
    const d = new Date(Number(tsOrLabel))
    if (isNaN(d.getTime())) return String(tsOrLabel)
    if (range === '24h') return `${String(d.getHours()).padStart(2, '0')}:00`
    if (range === '7d') return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()]
    return `${d.getMonth() + 1}/${d.getDate()}`
  }

  const makePath = (data: number[]) => {
    if (!data.length) return ''
    const points = data.map((v, i) => ({ x: getX(i), y: getY(v) }))
    let d = `M ${points[0].x} ${points[0].y}`
    for (let i = 0; i < points.length - 1; i++) {
      const p0 = points[Math.max(0, i - 1)]
      const p1 = points[i]
      const p2 = points[i + 1]
      const p3 = points[Math.min(points.length - 1, i + 2)]
      const cp1x = p1.x + (p2.x - p0.x) / 6
      const cp1y = p1.y + (p2.y - p0.y) / 6
      const cp2x = p2.x - (p3.x - p1.x) / 6
      const cp2y = p2.y - (p3.y - p1.y) / 6
      d += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${p2.x} ${p2.y}`
    }
    return d
  }

  const dlLine = makePath(download)
  const upLine = makePath(upload)
  const dlArea = `${dlLine} L ${getX(n - 1)} ${padT + innerH} L ${getX(0)} ${padT + innerH} Z`
  const upArea = `${upLine} L ${getX(n - 1)} ${padT + innerH} L ${getX(0)} ${padT + innerH} Z`

  const yTicks = [0, Math.round(maxVal / 2), maxVal]
  const step = range === '24h' ? 4 : range === '7d' ? 1 : 5

  return (
    <div className="relative select-none" onMouseLeave={() => setHoverIndex(null)}>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-44 w-full overflow-visible"
        onMouseMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect()
          const relX = ((e.clientX - rect.left) / rect.width) * width
          const index = Math.round(((relX - padL) / innerW) * (n - 1))
          if (index >= 0 && index < n) setHoverIndex(index)
        }}
      >
        <defs>
          <linearGradient id="dlGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#38bdf8" stopOpacity="0.45" />
            <stop offset="100%" stopColor="#38bdf8" stopOpacity="0.0" />
          </linearGradient>
          <linearGradient id="upGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#a855f7" stopOpacity="0.45" />
            <stop offset="100%" stopColor="#a855f7" stopOpacity="0.0" />
          </linearGradient>
        </defs>

        {yTicks.map((val) => (
          <g key={val}>
            <line x1={padL} y1={getY(val)} x2={width - padR} y2={getY(val)} stroke="rgba(96, 140, 255, 0.12)" strokeDasharray="3 3" />
            <text x={padL - 6} y={getY(val) + 3} textAnchor="end" className="fill-[#7a88a8] text-[9px] font-mono">{val}</text>
          </g>
        ))}

        <path d={dlArea} fill="url(#dlGrad)" />
        <path d={upArea} fill="url(#upGrad)" />
        <path d={dlLine} fill="none" stroke="#38bdf8" strokeWidth="2" strokeLinecap="round" />
        <path d={upLine} fill="none" stroke="#a855f7" strokeWidth="2" strokeLinecap="round" />

        {buckets.map((b, i) => {
          if (i % step !== 0 && i !== n - 1) return null
          return (
            <text key={b} x={getX(i)} y={height - 4} textAnchor="middle" className="fill-[#7a88a8] text-[9px]">
              {formatBucketLabel(b)}
            </text>
          )
        })}

        {hoverIndex !== null && (
          <g>
            <line
              x1={getX(hoverIndex)} y1={padT}
              x2={getX(hoverIndex)} y2={padT + innerH}
              stroke="rgba(255, 255, 255, 0.3)" strokeDasharray="2 2"
            />
            <circle cx={getX(hoverIndex)} cy={getY(download[hoverIndex])} r="3.5" fill="#38bdf8" stroke="#060b18" strokeWidth="2" />
            <circle cx={getX(hoverIndex)} cy={getY(upload[hoverIndex])} r="3.5" fill="#a855f7" stroke="#060b18" strokeWidth="2" />
          </g>
        )}
      </svg>

      {hoverIndex !== null && (
        <div
          className="pointer-events-none absolute -top-1 z-20 rounded-lg border border-border bg-[#070d1d]/95 p-2 text-[11px] shadow-xl backdrop-blur"
          style={{ left: `${Math.min(78, Math.max(12, (getX(hoverIndex) / width) * 100))}%`, transform: 'translateX(-50%)' }}
        >
          <div className="mb-1 font-semibold text-text">{formatBucketLabel(buckets[hoverIndex])}</div>
          <div className="flex items-center gap-1.5 text-[#38bdf8]">
            <span className="size-2 rounded-full bg-[#38bdf8]" />
            <span>Downloads: <strong>{download[hoverIndex]}</strong></span>
          </div>
          <div className="flex items-center gap-1.5 text-[#a855f7]">
            <span className="size-2 rounded-full bg-[#a855f7]" />
            <span>Uploads: <strong>{upload[hoverIndex]}</strong></span>
          </div>
        </div>
      )}

      <div className="mt-1 flex items-center justify-center gap-4 text-[11px] text-muted">
        <div className="flex items-center gap-1.5">
          <span className="size-2 rounded-full bg-[#38bdf8]" />
          <span>Downloads</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="size-2 rounded-full bg-[#a855f7]" />
          <span>Uploads</span>
        </div>
      </div>
    </div>
  )
}

export default function Overview() {
  const [previewItem, setPreviewItem] = useState<any>(null)
  const liveState = useLive()
  const { data: live, error: liveErr } = useCall<LiveStats>('stats.live', {}, ['stats'])
  const liveStats = liveState.stats || live
  const { data: overview, error: ovErr, loading: ovLoad, reload: ovReload } = useCall<OverviewStats>('stats.overview', {}, ['history'])
  const [actRange, setActRange] = useState('7d')
  const { data: activity, error: actErr, reload: actReload } = useCall<{ buckets: number[], download: number[], upload: number[] }>('stats.activity', { range: actRange }, ['history'])
  const [chatRange, setChatRange] = useState('7d')
  const { data: chats, error: chatErr, reload: chatReload } = useCall<{ items: TopChat[], top?: TopChat[] }>('stats.chats', { range: chatRange }, ['history', 'chats'])
  const [jobFilter, setJobFilter] = useState<'all' | 'download' | 'upload'>('all')
  const { data: jobs, error: jobErr, reload: jobReload } = useCall<{ items: Job[], total: number }>('jobs.list', {
    kind: jobFilter === 'all' ? undefined : jobFilter, status: 'open', pageSize: 8
  }, ['jobs'])

  const activeDownloads = liveStats?.counts.download.active ?? 0
  const activeUploads = liveStats?.counts.upload.active ?? 0
  const completedD = overview?.completedToday.download ?? 0
  const completedU = overview?.completedToday.upload ?? 0
  const filesD = overview?.totalFiles.download ?? 0
  const filesU = overview?.totalFiles.upload ?? 0
  const failedD = liveStats?.counts.download.failed ?? 0
  const failedU = liveStats?.counts.upload.failed ?? 0

  const topChats = (chats?.items ?? chats?.top ?? []) as TopChat[]
  const maxChatCount = Math.max(1, ...topChats.map((c) => c.count))
  const recentList = overview?.recent ?? []
  
  const liveActiveMap = new Map((liveStats?.active ?? []).map((a: any) => [a.id, a]))
  const rawJobs = (jobs?.items ?? (jobs as any)?.jobs ?? []) as Job[]
  const currentJobs = rawJobs.map((j) => {
    const act = liveActiveMap.get(j.id)
    return act ? { ...j, done: act.done, size: act.size || j.size, eta: act.eta, speed: act.speed, finalizing: act.finalizing } : j
  })

  async function jobAction(action: 'pause' | 'resume' | 'cancel', id: number) {
    try {
      await call('jobs.action', { action, ids: [id] })
      jobReload()
    } catch (e) {
      toast((e as Error).message, 'danger')
    }
  }

  return (
    <div className="space-y-4 p-6">
      <MediaPreviewModal
        open={!!previewItem}
        item={previewItem}
        onClose={() => setPreviewItem(null)}
      />

      <div className="flex items-center justify-between pr-40">
        <div>
          <h1 className="text-[26px] font-bold text-white tracking-wide">Welcome to Mediagram</h1>
          <p className="mt-1 text-[13px] text-text-2">Manage your Telegram video downloads and uploads in one powerful workspace.</p>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-4">
        <div className="rounded-[14px] border border-border bg-panel/85 p-4">
          <Stat icon={<Activity size={18} />} tone="primary" label="Active Transfers" 
            value={live ? activeDownloads + activeUploads : undefined}
            split={live ? `${activeDownloads} downloads • ${activeUploads} uploads` : undefined} />
        </div>
        <div className="rounded-[14px] border border-border bg-panel/85 p-4">
          <Stat icon={<CheckCircle2 size={18} />} tone="success" label="Completed Today" 
            value={overview ? completedD + completedU : undefined}
            split={overview ? `${completedD} downloads • ${completedU} uploads` : undefined} />
        </div>
        <div className="rounded-[14px] border border-border bg-panel/85 p-4">
          <Stat icon={<FileStack size={18} />} tone="neutral" label="Total Files" 
            value={overview ? filesD + filesU : undefined}
            split={overview ? `${filesD} downloads • ${filesU} uploads` : undefined} />
        </div>
        <div className="rounded-[14px] border border-border bg-panel/85 p-4">
          <Stat icon={<AlertTriangle size={18} />} tone="danger" label="Failed Jobs" 
            value={live ? failedD + failedU : undefined}
            split={live ? `${failedD} downloads • ${failedU} uploads` : undefined} />
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <Panel title="Transfer Activity" subtitle="Downloads and uploads over time" 
          action={<Select value={actRange} options={[{ value: '24h', label: 'Last 24 hours' }, { value: '7d', label: 'Last 7 days' }, { value: '30d', label: 'Last 30 days' }]} onChange={(v) => setActRange(String(v))} />}>
          {actErr ? <ErrorState error={actErr} onRetry={actReload} /> : !activity ? <Skeleton className="h-44" /> : (
            <AreaChart activity={activity} range={actRange} />
          )}
        </Panel>

        <Panel title="Channel Activity" subtitle="Top channels by transfer volume"
          action={<Select value={chatRange} options={[{ value: '24h', label: 'Last 24 hours' }, { value: '7d', label: 'Last 7 days' }, { value: '30d', label: 'Last 30 days' }]} onChange={(v) => setChatRange(String(v))} />}>
          {chatErr ? <ErrorState error={chatErr} onRetry={chatReload} /> : !chats ? <Skeleton className="h-48" /> : topChats.length === 0 ? (
            <Empty message="No transfers yet" action={{ label: 'Open Downloads', onClick: () => navigate('/downloads') }} />
          ) : (
            <div className="space-y-3">
              {topChats.map((c, i) => {
                const barPercent = Math.min(100, Math.round((c.count / maxChatCount) * 100))
                const barColor = i % 2 === 0 ? 'bg-primary' : 'bg-upload'
                return (
                  <button key={c.chatId} onClick={() => navigate(`/downloads?chat=${c.chatId}`)} className="flex w-full items-center gap-3 rounded-lg p-2 text-left hover:bg-tile transition-colors">
                    <Avatar src={c.photo} name={c.title} size={32} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between text-[13px] font-medium mb-1">
                        <span className="truncate">{c.title}</span>
                        <span className="text-[11px] text-muted shrink-0 ml-2">{c.count} files</span>
                      </div>
                      <div className="h-1.5 w-full rounded-full bg-[#1e2a47] overflow-hidden">
                        <div className={`h-full rounded-full ${barColor} transition-all duration-300`} style={{ width: `${barPercent}%` }} />
                      </div>
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </Panel>

        <Panel title="Recent Activity" action={<button onClick={() => navigate('/queue?tab=completed')} className="text-[13px] text-primary hover:underline">View All</button>}>
          {ovErr ? <ErrorState error={ovErr} onRetry={ovReload} /> : ovLoad ? <Skeleton className="h-48" /> : recentList.length === 0 ? (
            <Empty message="Nothing transferred yet" />
          ) : (
            <div className="space-y-2">
              {recentList.slice(0, 5).map((r, i) => (
                <div
                  key={r.id || i}
                  onClick={() => setPreviewItem({ name: r.name, path: null, thumb: r.preview, type: r.type, size: r.size })}
                  className="flex items-center gap-3 rounded-lg p-1.5 hover:bg-tile transition-colors cursor-pointer"
                  title="Click to preview"
                >
                  <div className={`flex size-8 shrink-0 items-center justify-center rounded-lg ${r.kind === 'download' ? 'bg-primary/20 text-primary' : 'bg-upload/20 text-upload'}`}>
                    {r.kind === 'download' ? <ArrowDown size={14} /> : <ArrowUp size={14} />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[12px] font-medium text-text">
                      {r.kind === 'download' ? 'Downloaded' : 'Uploaded'} {typeLabel[r.type] || r.type} from {r.chatTitle}
                    </div>
                    <div className="text-[11px] text-muted">{fmtAgo(r.finishedAt)}</div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="text-[11px] tabular-nums text-text-2">{fmtBytes(r.size)}</div>
                    {r.status === 'completed' ? (
                      <CheckCircle2 size={13} className="inline text-success mt-0.5" />
                    ) : (
                      <XCircle size={13} className="inline text-danger mt-0.5" />
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Panel>
      </div>

      <Panel title="Current Jobs" subtitle="Active downloads and uploads"
        action={<Select value={jobFilter} options={[{ value: 'all', label: 'All Jobs' }, { value: 'download', label: 'Downloads' }, { value: 'upload', label: 'Uploads' }]} onChange={(v) => setJobFilter(v as any)} />}>
        {jobErr ? <ErrorState error={jobErr} onRetry={jobReload} /> : !jobs ? <Skeleton className="h-32" /> : currentJobs.length === 0 ? (
          <Empty message="No active jobs" action={{ label: 'Open Downloads', onClick: () => navigate('/downloads') }} />
        ) : (
          <div className="space-y-2 overflow-x-auto">
            <table className="w-full text-[13px] table-fixed">
              <thead className="border-b border-white/[0.08] text-[12px] text-muted">
                <tr>
                  <th className="w-10 text-center py-2.5 px-1 font-normal">#</th>
                  <th className="w-[24%] text-left py-2.5 px-2 font-medium">Source</th>
                  <th className="w-[28%] text-left py-2.5 px-2 font-medium">Name</th>
                  <th className="w-20 text-center py-2.5 px-2 font-medium">Size</th>
                  <th className="w-24 text-center py-2.5 px-2 font-medium">Direction</th>
                  <th className="w-44 text-left py-2.5 px-3 font-medium">Progress</th>
                  <th className="w-28 text-center py-2.5 px-2 font-medium">Status</th>
                  <th className="w-20 text-right py-2.5 px-2 font-medium">ETA</th>
                  <th className="w-24 text-right py-2.5 pr-3 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.05]">
                {currentJobs.map((j, i) => (
                  <tr key={j.id} className="hover:bg-white/[0.03] transition-colors">
                    <td className="py-2.5 px-1 text-center text-muted text-[11px]">{i + 1}</td>
                    <td className="py-2.5 px-2 min-w-0">
                      <div className="flex items-center gap-2 min-w-0">
                        <Avatar src={j.chatPhoto} name={j.chatTitle} size={26} />
                        <div className="min-w-0 flex-1 text-[12px] truncate">
                          <div className="font-medium text-text truncate">{j.chatTitle}</div>
                          {j.chatUsername && <div className="text-[10px] text-muted truncate">@{j.chatUsername}</div>}
                        </div>
                      </div>
                    </td>
                    <td className="py-2.5 px-2 min-w-0">
                      <div
                        className="truncate font-medium text-text cursor-pointer hover:text-primary transition-colors text-[13px]"
                        title={j.name}
                        onClick={() => setPreviewItem({ name: j.name, path: j.path, thumb: j.thumb, type: j.type, size: j.size })}
                      >
                        {j.name}
                      </div>
                    </td>
                    <td className="py-2.5 px-2 text-center tabular-nums text-text-2 font-medium">{fmtBytes(j.size)}</td>
                    <td className="py-2.5 px-2 text-center">
                      <span className={`inline-flex items-center gap-1 text-[11px] font-medium ${j.kind === 'download' ? 'text-cyan' : 'text-upload'}`}>
                        {j.kind === 'download' ? <ArrowDown size={12} /> : <ArrowUp size={12} />}
                        {j.kind === 'download' ? 'Download' : 'Upload'}
                      </span>
                    </td>
                    <td className="py-2.5 px-3">
                      <Progress done={j.done || 0} size={j.size || 0} tone={j.kind === 'upload' ? 'warning' : 'primary'} />
                    </td>
                    <td className="py-2.5 px-2 text-center">
                      <Pill kind={j.kind} status={j.status as any} finalizing={j.finalizing} />
                    </td>
                    <td className="py-2.5 px-2 text-right tabular-nums text-[12px]">
                      {j.status === 'active' && j.speed > 0 && <span className="text-cyan block text-[11px] font-semibold">{fmtSpeed(j.speed)}</span>}
                      <span className="text-muted">{j.eta ? fmtEta(j.eta) : '-'}</span>
                    </td>
                    <td className="py-2.5 pr-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <IconButton icon={j.status === 'paused' ? <Play size={13} /> : <Pause size={13} />} label={j.status === 'paused' ? 'Resume' : 'Pause'} 
                          onClick={() => jobAction(j.status === 'paused' ? 'resume' : 'pause', j.id)} variant="secondary" />
                        <Menu trigger={<IconButton icon={<MoreVertical size={13} />} label="More" onClick={() => {}} variant="secondary" />}
                          items={[
                            { label: 'Open chat', onClick: () => navigate(`/${j.kind}s?chat=${j.chatId}`) },
                            { label: 'Cancel', onClick: () => jobAction('cancel', j.id), danger: true },
                          ]} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <button onClick={() => navigate('/queue?tab=downloads')} className="text-[13px] text-primary hover:underline">View queue</button>
          </div>
        )}
      </Panel>
    </div>
  )
}
