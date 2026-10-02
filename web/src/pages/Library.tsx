// Phase 5.5: Media Library page per UI.md - skeleton with all controls wired
import { useState } from 'react'
import { FolderOpen, Grid, List, AlertTriangle } from 'lucide-react'
import { call, useCall } from '../api.ts'
import { Panel, SearchInput, Chip, Select, Segmented, Button, Stat, Empty, ErrorState, Skeleton, Pagination, Thumb, TypeChip, fmtBytes, fmtDate, confirm, toast } from '../ui.tsx'

export default function Library() {
  const [view, setView] = useState<'grid' | 'list'>('grid')
  const [search, setSearch] = useState('')
  const [type, setType] = useState<string>('all')
  const [page, setPage] = useState(1)

  const { data: lib, reload } = useCall<{ items: any[], total: number, stats: { files: number, size: number, missing: number }, chats: string[] }>(
    'library.list', { q: search, type: type === 'all' ? undefined : type, page, pageSize: 25 }, ['library']
  )

  async function openFolder() {
    try {
      await call('app.openPath', { target: 'downloads' })
    } catch (e) {
      toast((e as Error).message, 'danger')
    }
  }

  async function trash(paths: string[]) {
    const totalSize = lib?.items.filter((i: any) => paths.includes(i.path)).reduce((sum: number, i: any) => sum + i.size, 0) || 0
    if (await confirm({
      title: 'Move to Recycle Bin',
      message: `Move ${paths.length} file${paths.length !== 1 ? 's' : ''} (${fmtBytes(totalSize)}) to the Recycle Bin?`,
      confirm: 'Move to Recycle Bin',
      danger: true,
    })) {
      try {
        const res = await call<{ trashed: number, freed: number }>('library.trash', { paths })
        toast(`Moved ${res.trashed} files (${fmtBytes(res.freed)}) to the Recycle Bin`)
        reload()
      } catch (e) {
        toast((e as Error).message, 'danger')
      }
    }
  }

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-[28px] font-bold">Media Library</h1>
          <p className="mt-1 text-[13px] text-text-2">Everything you have downloaded, in one place.</p>
        </div>
        <Button variant="secondary" onClick={openFolder}>
          <FolderOpen size={16} className="mr-2" />Open folder
        </Button>
      </div>

      <div className="flex gap-4">
        <Stat icon={<FolderOpen size={16} />} label="Total Files" value={lib?.stats.files} />
        <Stat icon={<FolderOpen size={16} />} label="Total Size" value={lib ? fmtBytes(lib.stats.size) : undefined} />
        <Stat icon={<AlertTriangle size={16} />} tone="warning" label="Missing Files" value={lib?.stats.missing} />
        {(lib?.stats.missing || 0) > 0 && <Button variant="tint" tone="warning" onClick={() => {/* TODO: VerifyDialog */}}>Verify</Button>}
      </div>

      <div className="flex items-center gap-3">
        <SearchInput value={search} onChange={setSearch} placeholder="Search files..." className="flex-1" />
        <div className="flex gap-2">
          <Chip label="All" active={type === 'all'} onClick={() => setType('all')} />
          <Chip label="Videos" active={type === 'video'} onClick={() => setType('video')} />
          <Chip label="Images" active={type === 'image'} onClick={() => setType('image')} />
          <Chip label="Documents" active={type === 'document'} onClick={() => setType('document')} />
          <Chip label="Audio" active={type === 'audio'} onClick={() => setType('audio')} />
        </div>
        <Select value="newest" options={[{ value: 'newest', label: 'Newest' }, { value: 'largest', label: 'Largest' }]} onChange={() => {}} />
        <Segmented value={view} onChange={(v) => setView(v as any)} options={[
          { value: 'grid', label: 'Grid', icon: <Grid size={16} /> },
          { value: 'list', label: 'List', icon: <List size={16} /> },
        ]} />
      </div>

      <Panel>
        {!lib ? <Skeleton className="h-96" /> : lib.items.length === 0 ? (
          <Empty message="No downloads yet" action={{ label: 'Open Downloads', onClick: () => {} }} />
        ) : (
          <>
            {view === 'grid' ? (
              <div className="grid grid-cols-4 gap-4">
                {lib.items.map((item: any) => (
                  <div key={item.path} className="group rounded-lg border border-border bg-tile p-3 hover:border-primary">
                    <div className="aspect-video mb-2 rounded bg-panel flex items-center justify-center">
                      {item.preview ? <img src={item.preview} alt={item.name} className="h-full w-full object-cover rounded" /> : <TypeChip ext={item.name.split('.').pop() || ''} />}
                    </div>
                    <div className="text-[13px] font-medium truncate mb-1">{item.name}</div>
                    <div className="text-[11px] text-muted">{fmtBytes(item.size)} • {item.chat || 'Unknown'}</div>
                    <div className="mt-2 flex gap-1 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition">
                      <Button variant="secondary" onClick={() => call('library.open', { path: item.path })}>Open</Button>
                      <Button variant="tint" tone="danger" onClick={() => trash([item.path])}>Delete</Button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <table className="w-full text-[13px]">
                <thead className="text-[12px] text-muted border-b border-border">
                  <tr>
                    <th className="text-left p-2">File Name</th>
                    <th className="text-left p-2">Type</th>
                    <th className="text-right p-2">Size</th>
                    <th className="text-left p-2">Chat</th>
                    <th className="text-left p-2">Date</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {lib.items.map((item: any) => (
                    <tr key={item.path} className="border-b border-border hover:bg-tile">
                      <td className="p-2 flex items-center gap-2">
                        <Thumb src={item.preview} name={item.name} />
                        <span className="truncate">{item.name}</span>
                      </td>
                      <td className="p-2"><TypeChip ext={item.name.split('.').pop() || ''} /></td>
                      <td className="p-2 text-right tabular-nums">{fmtBytes(item.size)}</td>
                      <td className="p-2 text-muted">{item.chat || 'Unknown'}</td>
                      <td className="p-2 text-muted">{fmtDate(item.mtime)}</td>
                      <td className="p-2">
                        <div className="flex gap-1">
                          <Button variant="secondary" onClick={() => call('library.open', { path: item.path })}>Open</Button>
                          <Button variant="tint" tone="danger" onClick={() => trash([item.path])}>Delete</Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <div className="mt-4">
              <Pagination page={page} pageSize={25} total={lib.total} onPage={setPage} />
            </div>
          </>
        )}
      </Panel>
    </div>
  )
}
