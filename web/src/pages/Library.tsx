// Phase 5.5: Media Library page per UI.md & Reference Mockup
import { useState } from 'react'
import { FolderOpen, Grid, List, AlertTriangle, CheckSquare, Square, Trash2, RotateCcw, Eye, Download } from 'lucide-react'
import { call, useCall, navigate } from '../api.ts'
import { Panel, SearchInput, Chip, Select, Segmented, Button, Stat, Empty, ErrorState, Skeleton, Pagination, Thumb, TypeChip, Dialog, fmtBytes, fmtDate, confirm, toast } from '../ui.tsx'

export default function Library() {
  const [view, setView] = useState<'grid' | 'list'>('grid')
  const [search, setSearch] = useState('')
  const [type, setType] = useState<string>('all')
  const [chat, setChat] = useState<string>('all')
  const [sort, setSort] = useState<string>('newest')
  const [page, setPage] = useState(1)
  const [selectedPaths, setSelectedPaths] = useState<string[]>([])

  // Verify missing files dialog
  const [verifyOpen, setVerifyOpen] = useState(false)
  const [missingItems, setMissingItems] = useState<any[]>([])
  const [selectedMissing, setSelectedMissing] = useState<any[]>([])
  const [loadingMissing, setLoadingMissing] = useState(false)

  const { data: lib, reload, error: libErr } = useCall<{ items: any[], total: number, stats: { files: number, size: number, missing: number }, chats: string[] }>(
    'library.list', {
      q: search || undefined,
      type: type === 'all' ? undefined : type,
      chat: chat === 'all' ? undefined : chat,
      sort,
      page,
      pageSize: 24,
    }, ['library']
  )

  const items = lib?.items ?? []
  const chatsList = lib?.chats ?? []

  const toggleSelect = (p: string) => {
    setSelectedPaths((prev) => prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p])
  }

  const toggleSelectAll = () => {
    if (selectedPaths.length === items.length) {
      setSelectedPaths([])
    } else {
      setSelectedPaths(items.map((i) => i.path))
    }
  }

  async function openFolder() {
    try {
      await call('app.openPath', { target: 'downloads' })
    } catch (e) {
      toast((e as Error).message, 'danger')
    }
  }

  async function openFile(p: string) {
    try {
      await call('library.open', { path: p })
    } catch (e) {
      toast((e as Error).message, 'danger')
    }
  }

  async function revealFile(p: string) {
    try {
      await call('library.reveal', { path: p })
    } catch (e) {
      toast((e as Error).message, 'danger')
    }
  }

  async function trash(paths: string[]) {
    if (!paths.length) return
    const totalSize = items.filter((i) => paths.includes(i.path)).reduce((sum, i) => sum + i.size, 0)
    if (await confirm({
      title: 'Move to Recycle Bin',
      message: `Move ${paths.length} file${paths.length !== 1 ? 's' : ''} (${fmtBytes(totalSize)}) to the Recycle Bin?`,
      confirm: 'Move to Recycle Bin',
      danger: true,
    })) {
      try {
        const res = await call<{ trashed: number, freed: number }>('library.trash', { paths })
        toast(`Moved ${res.trashed} files (${fmtBytes(res.freed)}) to the Recycle Bin`)
        setSelectedPaths([])
        reload()
      } catch (e) {
        toast((e as Error).message, 'danger')
      }
    }
  }

  async function startVerify() {
    setVerifyOpen(true)
    setLoadingMissing(true)
    try {
      const res = await call<{ items: any[] }>('library.missing')
      setMissingItems(res.items || [])
      setSelectedMissing(res.items || [])
    } catch (e) {
      toast((e as Error).message, 'danger')
    } finally {
      setLoadingMissing(false)
    }
  }

  async function redownloadMissing() {
    if (!selectedMissing.length) return
    try {
      const res = await call<{ added: number, skipped: number }>('downloads.add', {
        items: selectedMissing.map((m) => ({ chatId: m.chatId, messageId: m.messageId })),
        force: true,
      })
      toast(`Re-queued ${res.added} downloads`)
      setVerifyOpen(false)
    } catch (e) {
      toast((e as Error).message, 'danger')
    }
  }

  return (
    <div className="p-6 space-y-4">
      {/* Verify Dialog */}
      {verifyOpen && (
        <Dialog open={verifyOpen} onClose={() => setVerifyOpen(false)} title="Verify Missing Files">
          {loadingMissing ? (
            <div className="p-6 text-center text-muted">Checking downloaded files on disk…</div>
          ) : missingItems.length === 0 ? (
            <div className="py-6 text-center text-text">
              <p className="text-[14px]">All files are present on disk!</p>
              <div className="mt-4 flex justify-end">
                <Button variant="secondary" onClick={() => setVerifyOpen(false)}>Close</Button>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-[13px] text-text-2">
                Found {missingItems.length} downloads whose files were deleted or moved from the download folder:
              </p>
              <div className="max-h-60 overflow-y-auto space-y-1 rounded border border-border p-2">
                {missingItems.map((m) => (
                  <div key={`${m.chatId}-${m.messageId}`} className="flex items-center gap-2 text-[12px] text-text py-1">
                    <input
                      type="checkbox"
                      checked={selectedMissing.some((x) => x.chatId === m.chatId && x.messageId === m.messageId)}
                      onChange={(e) => {
                        if (e.target.checked) setSelectedMissing((p) => [...p, m])
                        else setSelectedMissing((p) => p.filter((x) => !(x.chatId === m.chatId && x.messageId === m.messageId)))
                      }}
                    />
                    <span className="truncate flex-1 font-medium">{m.name}</span>
                    <span className="text-muted text-[11px] shrink-0">{m.chatTitle}</span>
                  </div>
                ))}
              </div>
              <div className="flex items-center justify-between pt-2">
                <Button variant="secondary" onClick={() => setVerifyOpen(false)}>Close</Button>
                <Button onClick={redownloadMissing} disabled={selectedMissing.length === 0}>
                  Re-download {selectedMissing.length} selected
                </Button>
              </div>
            </div>
          )}
        </Dialog>
      )}

      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-[28px] font-bold">Media Library</h1>
          <p className="mt-1 text-[13px] text-text-2">Everything you have downloaded, in one place.</p>
        </div>
        <Button variant="secondary" onClick={openFolder}>
          <FolderOpen size={16} className="mr-2" />Open folder
        </Button>
      </div>

      {/* Stat Strip */}
      <div className="flex gap-4 items-center">
        <Stat icon={<FolderOpen size={16} />} label="Total Files" value={lib?.stats.files} />
        <Stat icon={<FolderOpen size={16} />} label="Total Size" value={lib ? fmtBytes(lib.stats.size) : undefined} />
        <Stat icon={<AlertTriangle size={16} />} tone="warning" label="Missing Files" value={lib?.stats.missing} />
        {(lib?.stats.missing || 0) > 0 && (
          <Button variant="tint" tone="warning" onClick={startVerify}>Verify</Button>
        )}
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-2.5 flex-wrap">
        <div className="flex-1 min-w-[200px]">
          <SearchInput value={search} onChange={(v) => { setSearch(v); setPage(1) }} placeholder="Search files…" />
        </div>
        <div className="flex gap-1.5 flex-wrap">
          <Chip label="All" active={type === 'all'} onClick={() => { setType('all'); setPage(1) }} />
          <Chip label="Videos" active={type === 'video'} onClick={() => { setType('video'); setPage(1) }} />
          <Chip label="Images" active={type === 'image'} onClick={() => { setType('image'); setPage(1) }} />
          <Chip label="Documents" active={type === 'document'} onClick={() => { setType('document'); setPage(1) }} />
          <Chip label="Audio" active={type === 'audio'} onClick={() => { setType('audio'); setPage(1) }} />
        </div>

        {chatsList.length > 0 && (
          <Select
            value={chat}
            onChange={(v) => { setChat(String(v)); setPage(1) }}
            options={[{ value: 'all', label: 'All Chats' }, ...chatsList.map((c) => ({ value: c, label: c }))]}
          />
        )}

        <Select
          value={sort}
          onChange={(v) => { setSort(String(v)); setPage(1) }}
          options={[
            { value: 'newest', label: 'Newest' },
            { value: 'largest', label: 'Largest' },
            { value: 'smallest', label: 'Smallest' },
            { value: 'name', label: 'Name' },
          ]}
        />

        <Segmented
          value={view}
          onChange={(v) => setView(v as any)}
          options={[
            { value: 'grid', label: 'Grid', icon: <Grid size={15} /> },
            { value: 'list', label: 'List', icon: <List size={15} /> },
          ]}
        />
      </div>

      {/* Multi-select action bar */}
      {selectedPaths.length > 0 && (
        <div className="flex items-center justify-between rounded-lg border border-primary/40 bg-primary/15 px-4 py-2 text-[13px] text-text">
          <div className="font-semibold">{selectedPaths.length} files selected</div>
          <div className="flex items-center gap-2">
            <Button variant="tint" tone="danger" onClick={() => trash(selectedPaths)} className="py-1 px-3 text-[12px] flex items-center gap-1.5">
              <Trash2 size={13} />
              <span>Move to Recycle Bin</span>
            </Button>
            <button onClick={() => setSelectedPaths([])} className="text-[12px] text-muted hover:text-text ml-2 underline">Clear</button>
          </div>
        </div>
      )}

      {/* Content */}
      <Panel>
        {libErr ? (
          <ErrorState error={libErr} onRetry={reload} />
        ) : !lib ? (
          <div className="grid grid-cols-4 gap-4 p-4">
            {[...Array(8)].map((_, i) => <Skeleton key={i} className="h-44 w-full rounded-xl" />)}
          </div>
        ) : items.length === 0 ? (
          <Empty message="No downloads found in the library" action={{ label: 'Open Downloads', onClick: () => navigate('/downloads') }} />
        ) : (
          <>
            {view === 'grid' ? (
              <div className="grid grid-cols-4 gap-4">
                {items.map((item: any) => {
                  const isSelected = selectedPaths.includes(item.path)
                  return (
                    <div
                      key={item.path}
                      className={`group relative rounded-xl border bg-tile p-3 transition-colors ${
                        isSelected ? 'border-primary bg-primary/10' : 'border-border hover:border-primary/60'
                      }`}
                    >
                      <button
                        onClick={() => toggleSelect(item.path)}
                        className="absolute top-4 left-4 z-10 text-muted hover:text-text"
                      >
                        {isSelected ? <CheckSquare size={16} className="text-primary" /> : <Square size={16} className="bg-tile/80 rounded" />}
                      </button>
                      <div className="aspect-video mb-2.5 rounded-lg bg-panel flex items-center justify-center overflow-hidden">
                        {item.preview ? (
                          <img src={item.preview} alt={item.name} className="h-full w-full object-cover" />
                        ) : (
                          <TypeChip ext={item.name.split('.').pop() || 'FILE'} />
                        )}
                      </div>
                      <div className="text-[13px] font-medium truncate mb-0.5 text-text" title={item.name}>{item.name}</div>
                      <div className="text-[11px] text-muted truncate">{fmtBytes(item.size)} • {item.chat || 'Telegram'} • {fmtDate(item.mtime)}</div>
                      <div className="mt-2.5 flex items-center gap-1.5 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity">
                        <Button variant="secondary" onClick={() => openFile(item.path)} className="text-[11px] py-1 px-2.5">Open</Button>
                        <Button variant="secondary" onClick={() => revealFile(item.path)} className="text-[11px] py-1 px-2.5">Folder</Button>
                        <Button variant="tint" tone="danger" onClick={() => trash([item.path])} className="text-[11px] py-1 px-2">Delete</Button>
                      </div>
                    </div>
                  )
                })}
              </div>
            ) : (
              <table className="w-full text-[13px]">
                <thead className="text-[12px] text-muted border-b border-border">
                  <tr>
                    <th className="py-2 px-1 text-center w-8">
                      <button onClick={toggleSelectAll} className="text-muted hover:text-text">
                        {selectedPaths.length === items.length && items.length > 0 ? (
                          <CheckSquare size={15} className="text-primary" />
                        ) : (
                          <Square size={15} />
                        )}
                      </button>
                    </th>
                    <th className="text-left p-2">File Name</th>
                    <th className="text-center p-2 w-16">Type</th>
                    <th className="text-right p-2 w-20">Size</th>
                    <th className="text-left p-2">Chat</th>
                    <th className="text-left p-2 w-28">Date</th>
                    <th className="text-right p-2 w-28">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item: any) => {
                    const isSelected = selectedPaths.includes(item.path)
                    return (
                      <tr key={item.path} className={`border-b border-border/50 hover:bg-tile/40 transition-colors ${isSelected ? 'bg-primary/10' : ''}`}>
                        <td className="py-2 px-1 text-center">
                          <button onClick={() => toggleSelect(item.path)} className="text-muted hover:text-text">
                            {isSelected ? <CheckSquare size={15} className="text-primary" /> : <Square size={15} />}
                          </button>
                        </td>
                        <td className="p-2 flex items-center gap-2 max-w-sm">
                          <Thumb src={item.preview} name={item.name} />
                          <span className="truncate font-medium text-text">{item.name}</span>
                        </td>
                        <td className="p-2 text-center"><TypeChip ext={item.name.split('.').pop() || ''} /></td>
                        <td className="p-2 text-right tabular-nums text-text-2">{fmtBytes(item.size)}</td>
                        <td className="p-2 text-muted truncate max-w-[150px]">{item.chat || 'Telegram'}</td>
                        <td className="p-2 text-muted text-[12px]">{fmtDate(item.mtime)}</td>
                        <td className="p-2 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <Button variant="secondary" onClick={() => openFile(item.path)} className="text-[11px] py-1 px-2">Open</Button>
                            <Button variant="secondary" onClick={() => revealFile(item.path)} className="text-[11px] py-1 px-2">Folder</Button>
                            <Button variant="tint" tone="danger" onClick={() => trash([item.path])} className="text-[11px] py-1 px-2">Delete</Button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}

            {lib.total > 24 && (
              <div className="mt-4 pt-3 border-t border-border">
                <Pagination page={page} pageSize={24} total={lib.total} onPage={setPage} />
              </div>
            )}
          </>
        )}
      </Panel>
    </div>
  )
}
