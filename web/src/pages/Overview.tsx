// Phase 5.1: Overview page per UI.md
import { useState } from 'react'
import { Activity, CheckCircle2, FileStack, AlertTriangle, Link2, MoreVertical, Play, Pause } from 'lucide-react'
import { call, useCall, navigate } from '../api.ts'
import { Panel, Stat, Button, Select, Avatar, Pill, Progress, IconButton, Menu, Empty, ErrorState, Skeleton, fmtBytes, fmtAgo, fmtEta, typeLabel, toast } from '../ui.tsx'

type KindCount = { download: number, upload: number }
type OverviewStats = { completedToday: KindCount, totalFiles: KindCount }
type ActivityBucket = { label: string, download: number, upload: number }
type TopChat = { chatId: number, title: string, photo: string | null, count: number }
type RecentItem = { kind: 'download' | 'upload', preview: string | null, type: string, chatTitle: string, name: string, finishedAt: number, size: number, status: 'completed' | 'failed' }
type Job = { id: number, kind: 'download' | 'upload', chatId: number, chatTitle: string, chatUsername: string | null, chatPhoto: string | null, name: string, size: number, done: number, status: string, finalizing: boolean, eta: number | null }

export default function Overview() {
  const { data: live, error: liveErr } = useCall<{ speed: KindCount, counts: Record<'download' | 'upload', Record<string, number>>, active: any[] }>('stats.live', {}, ['stats'])
  const { data: overview, error: ovErr, loading: ovLoad, reload: ovReload } = useCall<OverviewStats>('stats.overview', {}, ['history'])
  const [actRange, setActRange] = useState('7d')
  const { data: activity, error: actErr, reload: actReload } = useCall<{ buckets: ActivityBucket[] }>('stats.activity', { range: actRange }, ['history'])
  const [chatRange, setChatRange] = useState('7d')
  const { data: chats, error: chatErr, reload: chatReload } = useCall<{ top: TopChat[] }>('stats.chats', { range: chatRange }, ['history', 'chats'])
  const [jobFilter, setJobFilter] = useState<'all' | 'download' | 'upload'>('all')
  const { data: jobs, error: jobErr, reload: jobReload } = useCall<{ jobs: Job[], total: number }>('jobs.list', {
    kind: jobFilter === 'all' ? undefined : jobFilter, status: 'open', pageSize: 8
  }, ['jobs'])

  const activeDownloads = live?.counts.download.active ?? 0
  const activeUploads = live?.counts.upload.active ?? 0
  const completedD = overview?.completedToday.download ?? 0
  const completedU = overview?.completedToday.upload ?? 0
  const filesD = overview?.totalFiles.download ?? 0
  const filesU = overview?.totalFiles.upload ?? 0
  const failedD = live?.counts.download.failed ?? 0
  const failedU = live?.counts.upload.failed ?? 0

  async function jobAction(action: 'pause' | 'resume' | 'cancel', id: number) {
    try {
      await call('jobs.action', { action, ids: [id] })
      jobReload()
    } catch (e) {
      toast((e as Error).message, 'danger')
    }
  }

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-[28px] font-bold">Welcome to TeleFlow</h1>
          <p className="mt-1 text-[13px] text-text-2">Manage your Telegram video downloads and uploads in one powerful workspace.</p>
        </div>
        <Button variant="secondary" onClick={() => {/* OpenChatDialog TODO */}}>
          <Link2 size={16} className="mr-2" />Connect Channel
        </Button>
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
          {actErr ? <ErrorState error={actErr} onRetry={actReload} /> : !activity ? <Skeleton className="h-48" /> : (
            <div className="h-48 text-[11px] text-muted">Chart: {activity.buckets.length} buckets</div>
          )}
        </Panel>

        <Panel title="Channel Activity" subtitle="Top channels by transfer volume"
          action={<Select value={chatRange} options={[{ value: '24h', label: 'Last 24 hours' }, { value: '7d', label: 'Last 7 days' }, { value: '30d', label: 'Last 30 days' }]} onChange={(v) => setChatRange(String(v))} />}>
          {chatErr ? <ErrorState error={chatErr} onRetry={chatReload} /> : !chats ? <Skeleton className="h-48" /> : chats.top.length === 0 ? (
            <Empty message="No transfers yet" action={{ label: 'Open Downloads', onClick: () => navigate('/downloads') }} />
          ) : (
            <div className="space-y-2">
              {chats.top.map((c) => (
                <button key={c.chatId} onClick={() => navigate(`/downloads?chat=${c.chatId}`)} className="flex w-full items-center gap-3 rounded-lg p-2 hover:bg-tile">
                  <Avatar src={c.photo} name={c.title} size={32} />
                  <div className="flex-1 text-left">
                    <div className="text-[13px] font-medium">{c.title}</div>
                    <div className="text-[11px] text-muted">{c.count} files</div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </Panel>

        <Panel title="Recent Activity" action={<button onClick={() => navigate('/queue?tab=completed')} className="text-[13px] text-primary hover:underline">View All</button>}>
          {ovErr ? <ErrorState error={ovErr} onRetry={ovReload} /> : ovLoad ? <Skeleton className="h-48" /> : (
            <Empty message="Nothing transferred yet" />
          )}
        </Panel>
      </div>

      <Panel title="Current Jobs" subtitle="Active downloads and uploads"
        action={<Select value={jobFilter} options={[{ value: 'all', label: 'All Jobs' }, { value: 'download', label: 'Downloads' }, { value: 'upload', label: 'Uploads' }]} onChange={(v) => setJobFilter(v as any)} />}>
        {jobErr ? <ErrorState error={jobErr} onRetry={jobReload} /> : !jobs ? <Skeleton className="h-32" /> : jobs.jobs.length === 0 ? (
          <Empty message="No active jobs" action={{ label: 'Open Downloads', onClick: () => navigate('/downloads') }} />
        ) : (
          <div className="space-y-2">
            <table className="w-full text-[13px]">
              <thead className="text-[12px] text-muted">
                <tr><th className="text-left">#</th><th className="text-left">Source</th><th className="text-left">Name</th><th className="text-right">Size</th><th className="text-center">Direction</th><th className="text-left">Progress</th><th className="text-left">Status</th><th className="text-right">ETA</th><th></th></tr>
              </thead>
              <tbody>
                {jobs.jobs.map((j, i) => (
                  <tr key={j.id} className="border-t border-border">
                    <td className="py-2">{i + 1}</td>
                    <td><div className="flex items-center gap-2"><Avatar src={j.chatPhoto} name={j.chatTitle} size={28} /><div className="text-[12px]">{j.chatTitle}</div></div></td>
                    <td className="max-w-xs truncate">{j.name}</td>
                    <td className="text-right tabular-nums">{fmtBytes(j.size)}</td>
                    <td className="text-center">{j.kind === 'download' ? '↓' : '↑'}</td>
                    <td><Progress done={j.done} size={j.size} /></td>
                    <td><Pill kind={j.kind} status={j.status as any} finalizing={j.finalizing} /></td>
                    <td className="text-right text-muted tabular-nums">{j.eta ? fmtEta(j.eta) : '-'}</td>
                    <td>
                      <div className="flex gap-1">
                        <IconButton icon={j.status === 'paused' ? <Play size={14} /> : <Pause size={14} />} label={j.status === 'paused' ? 'Resume' : 'Pause'} 
                          onClick={() => jobAction(j.status === 'paused' ? 'resume' : 'pause', j.id)} variant="secondary" />
                        <Menu trigger={<IconButton icon={<MoreVertical size={14} />} label="More" onClick={() => {}} variant="secondary" />}
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
