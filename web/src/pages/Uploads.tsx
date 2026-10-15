import React, { useState, useRef, useEffect, useCallback, useMemo, type DragEvent } from 'react'
import {
  UploadCloud, X, ArrowUpRight, ListOrdered,
  Layers, Send, Check, Play, Pause, Film, Music, Image as ImageIcon, FileText, Archive,
} from 'lucide-react'
import { call, getBridge, uploadPaths, useCall, useLive, useRouteQuery, navigate } from '../api.ts'
import type { LiveStats } from '../../../core/transfers.ts'
import type { Job } from '../../../core/db.ts'
import {
  SearchInput, Chip, Button, Avatar, TypeChip, ErrorState,
  fmtBytes, fmtSpeed, toast, triggerFlyToQueue,
} from '../ui.tsx'

function getFileIcon(type?: string) {
  switch (type) {
    case 'video':
      return <Film size={16} />
    case 'image':
    case 'photo':
      return <ImageIcon size={16} />
    case 'audio':
      return <Music size={16} />
    case 'archive':
      return <Archive size={16} />
    default:
      return <FileText size={16} />
  }
}

interface StagedFile {
  id: string
  name: string
  size: number
  path: string
  ext: string
  file?: File
}

export default function Uploads() {
  const [chatId, setChatId] = useState<number | null>(() => {
    try {
      const saved = localStorage.getItem('mediagram_uploads_chat_id')
      return saved ? Number(saved) : null
    } catch {
      return null
    }
  })

  const [sidebarWidth, setSidebarWidth] = useState<number>(() => {
    try {
      const saved = localStorage.getItem('mediagram_destinations_sidebar_width')
      if (saved) {
        const parsed = parseInt(saved, 10)
        if (!isNaN(parsed) && parsed <= 520) return Math.max(300, parsed)
      }
    } catch {}
    return 300
  })
  const [isResizingSidebar, setIsResizingSidebar] = useState(false)
  const sidebarWidthRef = useRef(sidebarWidth)
  sidebarWidthRef.current = sidebarWidth

  const handleSidebarResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    setIsResizingSidebar(true)
    const startX = e.clientX
    const startWidth = sidebarWidthRef.current

    const onMouseMove = (moveEvent: MouseEvent) => {
      const delta = moveEvent.clientX - startX
      const newWidth = Math.min(520, Math.max(300, startWidth + delta))
      setSidebarWidth(newWidth)
    }

    const onMouseUp = () => {
      setIsResizingSidebar(false)
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
      try {
        localStorage.setItem('mediagram_destinations_sidebar_width', String(sidebarWidthRef.current))
      } catch {}
    }

    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
  }, [])

  const [destSearch, setDestSearch] = useState('')
  const [destKind, setDestKind] = useState<'all' | 'channels' | 'groups' | 'saved'>('all')

  const [stagedFiles, setStagedFiles] = useState<StagedFile[]>([])
  const [isDragging, setIsDragging] = useState(false)
  const [busy, setBusy] = useState(false)
  const [sendAsAlbum, setSendAsAlbum] = useState(false)
  const [captionText, setCaptionText] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Real-time transfer stats
  const liveState = useLive()
  const { data: initialLive } = useCall<LiveStats>('stats.live', {}, [])
  const live = liveState.stats ?? initialLive

  const { data: chatsData, error: chatsErr, reload: chatsReload } = useCall<{ chats: any[] }>('chats.list', {}, ['chats'])
  const { data: authData } = useCall<{ me?: { uploadMax?: number, isPremium?: boolean } }>('auth.get', {}, ['auth'])
  const { data: settings } = useCall<any>('settings.get', {}, ['settings'])

  // Live queue data for Uploads snapshot table
  const { data: queueData, reload: reloadQueue } = useCall<{ items: Job[], total: number }>(
    'jobs.list',
    { kind: 'upload', status: 'open', pageSize: 15 },
    ['jobs']
  )
  const uploadJobs = (queueData?.items ?? (queueData as any)?.jobs ?? []) as Job[]
  const activeJobsMap = useMemo(() => new Map((live?.active ?? []).map((j: any) => [j.id, j])), [live?.active])

  const handleJobAction = async (jobId: number, action: 'pause' | 'resume' | 'cancel') => {
    try {
      await call('jobs.action', { action, ids: [jobId] })
      reloadQueue()
    } catch (e: any) {
      toast(e.message || 'Action failed', 'danger')
    }
  }

  const uploadMax = authData?.me?.uploadMax || 2097152000

  const allChats = chatsData?.chats ?? []
  const postableChats = allChats.filter((c) => c.canPost || c.kind === 'saved')

  const filteredDests = postableChats.filter((c) => {
    if (destSearch && !c.title.toLowerCase().includes(destSearch.toLowerCase()) && !(c.username && c.username.toLowerCase().includes(destSearch.toLowerCase()))) {
      return false
    }
    if (destKind === 'channels') return c.kind === 'channel'
    if (destKind === 'groups') return c.kind === 'group' || c.kind === 'supergroup'
    if (destKind === 'saved') return c.kind === 'saved'
    return true
  })

  const defaultChat = settings?.defaultUploadChat ? postableChats.find((c) => c.id === settings.defaultUploadChat)?.id : null
  const selectedChatId = postableChats.some((c) => c.id === chatId) ? chatId : defaultChat || postableChats[0]?.id || null
  const selectedChat = postableChats.find((c) => c.id === selectedChatId)

  // `#/uploads?chat=2` deep linking
  const deepLinkChat = useRouteQuery().get('chat')
  useEffect(() => {
    if (!deepLinkChat) return
    const id = Number(deepLinkChat)
    if (!isNaN(id) && id !== 0) setChatId(id)
  }, [deepLinkChat])

  useEffect(() => {
    try {
      if (selectedChatId != null) {
        localStorage.setItem('mediagram_uploads_chat_id', String(selectedChatId))
      }
    } catch {}
  }, [selectedChatId])

  // Native File Picker or Fallback
  async function handleBrowseFiles() {
    try {
      const res = await call<{ paths: string[], files?: { path: string, name: string, size: number }[] }>('app.pickFiles', {
        title: 'Select files to upload',
      })
      if (res?.files?.length) {
        const newStaged: StagedFile[] = res.files.map((f, i) => ({
          id: `${f.name}-${f.size}-${Date.now()}-${i}`,
          name: f.name,
          size: f.size,
          path: f.path,
          ext: f.name.split('.').pop()?.toUpperCase() || 'FILE',
        }))
        setStagedFiles((prev) => {
          const existingPaths = new Set(prev.map((p) => p.path))
          return [...prev, ...newStaged.filter((n) => !existingPaths.has(n.path))]
        })
        return
      }
    } catch {}
    // Fallback to HTML input if native picker wasn't available
    fileInputRef.current?.click()
  }

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)
    if (e.dataTransfer.files?.length) {
      const dropped = Array.from(e.dataTransfer.files)
      const bridge = getBridge()
      const newStaged: StagedFile[] = dropped.map((f, i) => {
        let p = ''
        try {
          if (bridge?.pathOf) p = bridge.pathOf(f)
        } catch {}
        if (!p) p = (f as any).path || ''
        return {
          id: `${f.name}-${f.size}-${Date.now()}-${i}`,
          name: f.name,
          size: f.size,
          path: p,
          ext: f.name.split('.').pop()?.toUpperCase() || 'FILE',
          file: f,
        }
      })
      setStagedFiles((prev) => [...prev, ...newStaged])
    }
  }

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.length) {
      const selected = Array.from(e.target.files)
      const bridge = getBridge()
      const newStaged: StagedFile[] = selected.map((f, i) => {
        let p = ''
        try {
          if (bridge?.pathOf) p = bridge.pathOf(f)
        } catch {}
        if (!p) p = (f as any).path || ''
        return {
          id: `${f.name}-${f.size}-${Date.now()}-${i}`,
          name: f.name,
          size: f.size,
          path: p,
          ext: f.name.split('.').pop()?.toUpperCase() || 'FILE',
          file: f,
        }
      })
      setStagedFiles((prev) => [...prev, ...newStaged])
    }
    e.target.value = ''
  }

  const removeFile = (idx: number) => {
    setStagedFiles((prev) => prev.filter((_, i) => i !== idx))
  }

  async function handleUpload(e?: React.MouseEvent) {
    if (!selectedChatId || stagedFiles.length === 0) return
    setBusy(true)
    try {
      const paths: string[] = []
      const filesNeedingResolution: File[] = []
      for (const item of stagedFiles) {
        if (item.path) {
          paths.push(item.path)
        } else if (item.file) {
          filesNeedingResolution.push(item.file)
        }
      }
      if (filesNeedingResolution.length) {
        const resolved = await uploadPaths(filesNeedingResolution)
        paths.push(...resolved)
      }
      if (!paths.length) {
        throw new Error('Please choose files from this computer before uploading.')
      }

      const res = await call<{ added: number }>('uploads.add', {
        chatId: selectedChatId,
        paths,
        caption: captionText.trim(),
        album: sendAsAlbum && paths.length > 1,
        keepNames: true,
      })
      toast(`Queued ${res.added} ${res.added === 1 ? 'upload' : 'uploads'} to ${selectedChat?.title || 'chat'}`)
      setStagedFiles([])
      setCaptionText('')
      if (res.added > 0) {
        triggerFlyToQueue(e)
      }
    } catch (err) {
      toast((err as Error).message || 'Failed to upload files', 'danger')
    } finally {
      setBusy(false)
    }
  }

  const totalFilesSize = stagedFiles.reduce((acc, f) => acc + f.size, 0)
  const hasOversized = stagedFiles.some((f) => f.size > uploadMax)

  return (
    <div className="flex h-full overflow-hidden">
      {/* Column 1: Destinations (Resizable) */}
      <div
        style={{ width: `${sidebarWidth}px`, minWidth: 300, maxWidth: 520 }}
        className="flex shrink-0 flex-col border-r border-border bg-panel/40 select-none overflow-hidden"
      >
        <div className="border-b border-border p-3.5">
          <div className="text-[14px] font-semibold text-text tracking-wide">Destinations</div>
          <div className="text-[11px] text-muted">Chats where you can post</div>
        </div>

        <div className="p-3 border-b border-border space-y-2">
          <SearchInput
            placeholder="Search destination…"
            value={destSearch}
            onChange={setDestSearch}
          />
          <div className="flex flex-wrap gap-1">
            <Chip label="All" active={destKind === 'all'} onClick={() => setDestKind('all')} />
            <Chip label="Channels" active={destKind === 'channels'} onClick={() => setDestKind('channels')} />
            <Chip label="Groups" active={destKind === 'groups'} onClick={() => setDestKind('groups')} />
            <Chip label="Saved" active={destKind === 'saved'} onClick={() => setDestKind('saved')} />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-2 space-y-1 no-scrollbar">
          {chatsErr ? (
            <ErrorState error={chatsErr} onRetry={chatsReload} />
          ) : !chatsData ? null : filteredDests.length === 0 ? (
            <div className="py-8 text-center text-muted text-[12px]">
              <p>No chats you can post to</p>
            </div>
          ) : (
            filteredDests.map((c: any) => {
              const active = selectedChatId === c.id
              return (
                <button
                  key={c.id}
                  onClick={() => setChatId(c.id)}
                  className={`flex w-full items-center gap-2.5 rounded-xl p-2.5 text-left transition-all cursor-pointer ${
                    active ? 'bg-primary/20 border border-primary/35 text-text shadow-xs' : 'hover:bg-tile text-text-2 hover:text-text border border-transparent'
                  }`}
                >
                  <Avatar src={c.photo} name={c.title} size={32} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-medium text-text">{c.title}</div>
                    <div className="text-[11px] text-muted truncate flex items-center gap-1.5">
                      <span>{c.username ? `@${c.username}` : c.kind}</span>
                      {c.isCreator && <span className="text-[10px] text-primary font-semibold uppercase">Admin</span>}
                    </div>
                  </div>
                </button>
              )
            })
          )}
        </div>
      </div>

      {/* Resize Handle / Support Divider */}
      <div
        onMouseDown={handleSidebarResizeStart}
        className={`relative w-2.5 -ml-1 shrink-0 z-20 cursor-col-resize select-none group flex items-center justify-center transition-colors ${
          isResizingSidebar ? 'bg-transparent' : 'hover:bg-primary/25'
        }`}
        title="Drag to resize Destinations panel"
      >
        <div className={`w-0.5 h-10 rounded-full transition-colors ${
          isResizingSidebar ? 'bg-border' : 'bg-border/80 group-hover:bg-primary'
        }`} />
      </div>

      {/* Column 2: Uploads Dashboard & Studio */}
      <div className="flex flex-1 flex-col overflow-y-auto [scrollbar-gutter:stable] p-6 space-y-5">
        {/* Header */}
        <div className="pb-2 border-b border-border/60">
          <h1 className="text-[24px] font-bold text-text tracking-tight">Uploads</h1>
          <p className="mt-0.5 text-[12.5px] text-muted">
            Transfer media files, videos, and documents directly to your Telegram channels and chats.
          </p>
        </div>

        {/* Studio Upload Workspace */}
        <div className="rounded-2xl border border-border bg-panel/75 backdrop-blur-md p-5 space-y-4 shadow-sm">
          {/* Destination banner */}
          <div className="flex flex-wrap items-center justify-between gap-3 p-3 rounded-xl border border-border bg-tile/50">
            <div className="flex items-center gap-3 min-w-0">
              <div className="text-[12px] font-medium text-muted uppercase tracking-wider shrink-0">Destination:</div>
              {selectedChat ? (
                <div className="flex items-center gap-2 min-w-0">
                  <Avatar src={selectedChat.photo} name={selectedChat.title} size={28} />
                  <div className="min-w-0">
                    <div className="text-[13.5px] font-semibold text-text truncate">{selectedChat.title}</div>
                    <div className="text-[11px] text-muted truncate">
                      {selectedChat.username ? `@${selectedChat.username}` : selectedChat.kind}
                    </div>
                  </div>
                </div>
              ) : (
                <span className="text-[12.5px] text-amber-500 font-medium">Select a chat from the left sidebar</span>
              )}
            </div>

            {selectedChat && (
              <div className="flex items-center gap-1.5 text-[11px] text-emerald-500 bg-emerald-500/10 px-2.5 py-1 rounded-full border border-emerald-500/25 shrink-0 font-medium">
                <Check size={13} />
                <span>Ready to post</span>
              </div>
            )}
          </div>

          {/* SaaS Drag & Drop Zone */}
          <div
            onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setIsDragging(true) }}
            onDragLeave={(e) => { e.preventDefault(); e.stopPropagation(); setIsDragging(false) }}
            onDrop={handleDrop}
            className={`relative rounded-2xl border-2 border-dashed p-8 text-center transition-all cursor-pointer ${
              isDragging
                ? 'border-primary bg-primary/10 shadow-glow'
                : 'border-border/80 hover:border-primary/50 bg-tile/30 hover:bg-tile/45'
            }`}
            onClick={handleBrowseFiles}
          >
            <div className="size-14 rounded-2xl bg-primary/15 text-primary flex items-center justify-center mx-auto mb-3 border border-primary/25 shadow-xs transition-transform group-hover:scale-105">
              <UploadCloud size={28} />
            </div>

            <div className="space-y-1">
              <div className="text-[15px] font-semibold text-text">
                Drop files here, or{' '}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    handleBrowseFiles()
                  }}
                  className="text-primary hover:underline font-semibold cursor-pointer"
                >
                  Browse Files
                </button>
              </div>
              <p className="text-[12px] text-muted max-w-md mx-auto leading-relaxed">
                Supports video (MP4, MKV), photos (JPG, PNG), music, and any document up to {fmtBytes(uploadMax)} per file.
              </p>
            </div>

            {/* Hidden HTML input for fallback or automated tests */}
            <input
              type="file"
              ref={fileInputRef}
              multiple
              className="hidden"
              onChange={handleFileInputChange}
            />
          </div>

          {/* Selected Files Staged List */}
          {stagedFiles.length > 0 && (
            <div className="rounded-xl border border-border bg-tile/40 p-4 space-y-3">
              <div className="flex items-center justify-between pb-2 border-b border-border/50 text-[12.5px]">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-text">
                    {stagedFiles.length} {stagedFiles.length === 1 ? 'file' : 'files'} ready
                  </span>
                  <span className="text-muted font-normal">
                    ({fmtBytes(totalFilesSize)})
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setStagedFiles([])}
                  className="text-[11.5px] text-muted hover:text-danger font-medium transition-colors cursor-pointer"
                >
                  Clear all
                </button>
              </div>

              {/* Scrollable files table */}
              <div className="max-h-60 overflow-y-auto space-y-1.5 divide-y divide-border/30 pr-1">
                {stagedFiles.map((f, i) => {
                  const tooLarge = f.size > uploadMax
                  return (
                    <div key={f.id || i} className="flex items-center justify-between pt-2 text-[12.5px]">
                      <div className="flex items-center gap-2.5 min-w-0 flex-1 pr-2">
                        <TypeChip ext={f.ext} />
                        <span className={`truncate font-medium ${tooLarge ? 'text-danger' : 'text-text'}`} title={f.name}>
                          {f.name}
                        </span>
                        {tooLarge && (
                          <span className="text-[10px] text-danger bg-danger/15 px-1.5 py-0.5 rounded font-semibold shrink-0">
                            Exceeds {fmtBytes(uploadMax)} limit
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        <span className="text-muted text-[12px] tabular-nums">{fmtBytes(f.size)}</span>
                        <button
                          type="button"
                          onClick={() => removeFile(i)}
                          className="size-6 rounded-lg text-muted hover:text-danger hover:bg-danger/10 flex items-center justify-center transition-colors cursor-pointer"
                          title="Remove file"
                        >
                          <X size={14} />
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>

              {/* Upload Configuration Options */}
              <div className="pt-3 border-t border-border/50 space-y-3">
                {/* Send as Album toggle */}
                {stagedFiles.length > 1 && (
                  <label className="flex items-center justify-between p-2 rounded-xl bg-tile/60 hover:bg-tile transition-colors cursor-pointer select-none">
                    <div className="flex items-center gap-2">
                      <Layers size={16} className="text-primary" />
                      <div>
                        <div className="text-[12.5px] font-medium text-text">Group as Media Album</div>
                        <div className="text-[11px] text-muted">Combines multiple photos or videos into a single message album</div>
                      </div>
                    </div>
                    <input
                      type="checkbox"
                      checked={sendAsAlbum}
                      onChange={(e) => setSendAsAlbum(e.target.checked)}
                      className="size-4 rounded accent-primary cursor-pointer"
                    />
                  </label>
                )}

                {/* Optional Caption */}
                <div className="space-y-1">
                  <div className="flex items-center justify-between text-[12px]">
                    <span className="text-muted font-medium">Caption (optional)</span>
                    <span className="text-[11px] text-muted">{captionText.length}/4096</span>
                  </div>
                  <input
                    type="text"
                    maxLength={4096}
                    placeholder="Add a caption to this post…"
                    value={captionText}
                    onChange={(e) => setCaptionText(e.target.value)}
                    className="w-full rounded-xl border border-border bg-tile px-3.5 py-2 text-[13px] text-text focus:border-primary outline-none transition-colors"
                  />
                </div>
              </div>
            </div>
          )}

          {/* Action Button */}
          <div className="pt-2">
            <Button
              variant="primary"
              onClick={handleUpload}
              disabled={stagedFiles.length === 0 || !selectedChatId || hasOversized || busy}
              busy={busy}
              className="w-full py-2.5 text-[13.5px] font-semibold rounded-xl flex items-center justify-center gap-2 cursor-pointer shadow-md"
            >
              <Send size={15} />
              <span>
                Upload {stagedFiles.length} {stagedFiles.length === 1 ? 'file' : 'files'}{' '}
                {stagedFiles.length > 0 ? `(${fmtBytes(totalFilesSize)}) ` : ''}to {selectedChat?.title || 'Selected Chat'}
              </span>
            </Button>
          </div>
        </div>

        {/* Section: Active Upload Queue */}
        <div className="rounded-2xl border border-border bg-panel/75 backdrop-blur-md overflow-hidden shadow-xs space-y-0">
          <div className="flex items-center justify-between px-5 py-3.5 border-b border-border/70 bg-tile/30">
            <div className="flex items-center gap-2.5">
              <div className="size-7 rounded-xl bg-primary/15 text-primary flex items-center justify-center">
                <ListOrdered size={15} />
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[13.5px] font-semibold text-text">Active Upload Queue</span>
                {uploadJobs.length > 0 && (
                  <span className="px-2 py-0.5 rounded-full text-[10.5px] font-bold bg-primary/20 text-primary border border-primary/30 tabular-nums">
                    {uploadJobs.length} {uploadJobs.length === 1 ? 'task' : 'tasks'}
                  </span>
                )}
              </div>
            </div>
          </div>

          {uploadJobs.length === 0 ? (
            <div className="p-7 text-center text-muted text-[12.5px] flex flex-col items-center justify-center space-y-2">
              <div className="size-9 rounded-2xl bg-tile/60 flex items-center justify-center text-muted/60">
                <UploadCloud size={18} />
              </div>
              <p className="font-medium text-text">Upload queue is currently empty</p>
              <p className="text-[11.5px] text-muted">Files dropped or picked above will enter the active queue automatically.</p>
              <button
                type="button"
                onClick={() => navigate('/queue?tab=uploads')}
                className="mt-1 flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-tile hover:bg-tile/80 border border-border hover:border-primary/50 text-text text-[12px] font-semibold transition-all cursor-pointer shadow-xs"
              >
                <ListOrdered size={14} className="text-primary" />
                <span>Go to Queue</span>
                <ArrowUpRight size={13} className="text-muted ml-0.5" />
              </button>
            </div>
          ) : (
            <div className="relative">
              <div className={`divide-y divide-border/40 pb-8 ${uploadJobs.length > 2 ? 'max-h-[190px] overflow-hidden' : ''}`}>
                {uploadJobs.slice(0, 5).map((job) => {
                  const running = activeJobsMap.get(job.id)
                  const isPaused = job.status === 'paused'
                  const size = running?.size || job.size || 0
                  const done = Math.min(running?.done ?? job.done ?? 0, size || Infinity)
                  const progressPct = size > 0 ? Math.min(100, Math.round((done / size) * 100)) : 0
                  const speed = running?.speed ?? 0

                  return (
                    <div
                      key={job.id}
                      className="flex items-center justify-between gap-4 px-5 py-3 hover:bg-tile/30 transition-colors text-[12.5px]"
                    >
                      {/* File Icon & Info */}
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        <div className="size-9 rounded-xl bg-tile/90 border border-border/80 flex items-center justify-center text-primary shrink-0 shadow-xs">
                          {getFileIcon(job.type)}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="font-medium text-text truncate max-w-sm" title={job.name}>
                            {job.name}
                          </div>
                          <div className="flex items-center gap-2 text-[11px] text-muted mt-0.5">
                            <span>{fmtBytes(done)} of {fmtBytes(size)}</span>
                            {job.chatTitle && (
                              <>
                                <span className="opacity-40">•</span>
                                <span className="truncate max-w-[140px] text-text-2">to {job.chatTitle}</span>
                              </>
                            )}
                            {speed > 0 && !isPaused && (
                              <>
                                <span className="opacity-40">•</span>
                                <span className="text-primary font-medium">{fmtSpeed(speed)}</span>
                              </>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Progress Bar & Status */}
                      <div className="hidden sm:flex flex-col w-36 gap-1 shrink-0">
                        <div className="flex justify-between text-[10.5px] text-muted tabular-nums">
                          <span>{progressPct}%</span>
                          <span className={isPaused ? 'text-amber-500 font-medium' : speed > 0 ? 'text-primary font-medium' : ''}>
                            {isPaused ? 'Paused' : speed > 0 ? 'Transferring' : 'Queued'}
                          </span>
                        </div>
                        <div className="h-1.5 w-full bg-border/80 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all duration-300 ${
                              isPaused ? 'bg-amber-500' : 'bg-primary'
                            }`}
                            style={{ width: `${Math.max(2, Math.min(100, progressPct))}%` }}
                          />
                        </div>
                      </div>

                      {/* Controls */}
                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          onClick={() => handleJobAction(job.id, isPaused ? 'resume' : 'pause')}
                          title={isPaused ? 'Resume upload' : 'Pause upload'}
                          className="p-1.5 rounded-lg text-muted hover:text-text hover:bg-tile transition-colors cursor-pointer"
                        >
                          {isPaused ? <Play size={14} /> : <Pause size={14} />}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleJobAction(job.id, 'cancel')}
                          title="Cancel upload"
                          className="p-1.5 rounded-lg text-muted hover:text-danger hover:bg-danger/10 transition-colors cursor-pointer"
                        >
                          <X size={14} />
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>

              {/* Blur Hide Overlay at bottom with Centered Pill Queue CTA */}
              <div className="pointer-events-none absolute bottom-0 inset-x-0 h-16 bg-gradient-to-t from-panel via-panel/90 to-transparent backdrop-blur-[2px] flex items-center justify-center pt-2">
                <button
                  type="button"
                  onClick={() => navigate('/queue?tab=uploads')}
                  className="pointer-events-auto flex items-center gap-2 px-4 py-1.5 rounded-full bg-primary/20 hover:bg-primary/30 border border-primary/40 text-primary hover:text-text text-[12px] font-semibold transition-all cursor-pointer shadow-md hover:shadow-glow backdrop-blur-md"
                >
                  <ListOrdered size={14} />
                  <span>View all {uploadJobs.length} in Queue</span>
                  <ArrowUpRight size={13} className="text-muted ml-0.5" />
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
