// Phase 5.3: Uploads page per UI.md & Reference Mockup
import React, { useState, useRef, useEffect, useCallback, type DragEvent } from 'react'
import { UploadCloud, X, Upload, Zap, Clock, CheckCircle2, FileText } from 'lucide-react'
import { call, useCall, useLive, navigate } from '../api.ts'
import type { LiveStats } from '../../../core/transfers.ts'
import { Panel, SearchInput, Chip, Button, Avatar, TypeChip, Empty, ErrorState, fmtBytes, toast, triggerFlyToQueue } from '../ui.tsx'

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
        if (parsed >= 260 && parsed <= 520) return parsed
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
      const newWidth = Math.min(520, Math.max(260, startWidth + delta))
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

  const [files, setFiles] = useState<File[]>([])
  const [isDragging, setIsDragging] = useState(false)
  const [busy, setBusy] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const { data: chatsData, error: chatsErr, reload: chatsReload } = useCall<{ chats: any[] }>('chats.list', {}, ['chats'])
  const { data: authData } = useCall<{ me?: { uploadMax?: number } }>('auth.get', {}, ['auth'])
  const { data: settings } = useCall<any>('settings.get', {}, ['settings'])

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
  const selectedChatId = chatId || defaultChat || postableChats[0]?.id || null
  const selectedChat = postableChats.find((c) => c.id === selectedChatId)

  useEffect(() => {
    try {
      if (selectedChatId != null) {
        localStorage.setItem('mediagram_uploads_chat_id', String(selectedChatId))
      }
    } catch {}
  }, [selectedChatId])

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setIsDragging(false)
    if (e.dataTransfer.files?.length) {
      const dropped = Array.from(e.dataTransfer.files)
      setFiles((prev) => [...prev, ...dropped])
    }
  }

  const removeFile = (idx: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== idx))
  }

  async function handleUpload(e?: React.MouseEvent) {
    if (!selectedChatId || files.length === 0) return
    setBusy(true)
    try {
      const bridge = window.mediagram || window.teleflow
      const paths = files.map((f) => bridge?.pathOf?.(f) || (f as any).path || f.name).filter(Boolean)
      const res = await call<{ added: number }>('uploads.add', {
        chatId: selectedChatId,
        paths,
        caption: '',
        album: false,
        keepNames: true,
      })
      toast(`Queued ${res.added} uploads to ${selectedChat?.title || 'chat'}`)
      setFiles([])
      if (res.added > 0) {
        triggerFlyToQueue(e)
      }
    } catch (e) {
      toast((e as Error).message, 'danger')
    } finally {
      setBusy(false)
    }
  }

  const totalFilesSize = files.reduce((acc, f) => acc + f.size, 0)
  const hasOversized = files.some((f) => f.size > uploadMax)

  return (
    <div className="flex h-full overflow-hidden">
      {/* Column 1: Destinations (Resizable) */}
      <div
        style={{ width: `${sidebarWidth}px`, minWidth: 260, maxWidth: 520 }}
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
                  className={`flex w-full items-center gap-2.5 rounded-lg p-2 text-left transition-colors ${
                    active ? 'bg-primary/20 border border-primary/30 text-text' : 'hover:bg-tile text-text-2 hover:text-text'
                  }`}
                >
                  <Avatar src={c.photo} name={c.title} size={30} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-medium text-text">{c.title}</div>
                    <div className="text-[11px] text-muted truncate">{c.username ? `@${c.username}` : c.kind}</div>
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

      {/* Column 2: New Upload (~flexible center) */}
      <div className="flex flex-1 flex-col overflow-y-auto [scrollbar-gutter:stable] p-6 space-y-4">
        <div className="flex items-center justify-between pr-40">
          <div>
            <h1 className="text-[26px] font-bold text-text tracking-wide">Uploads</h1>
            <p className="mt-1 text-[13px] text-text-2">
              Send media files directly to your Telegram channels, groups, and Saved Messages.
            </p>
          </div>
        </div>

        <Panel title="New Upload">
          <div className="space-y-4">
            {/* Target indicator */}
            {selectedChat && (
              <div className="flex items-center gap-2 rounded-lg border border-border bg-tile px-3 py-2 text-[13px] text-text">
                <span className="text-muted text-[12px]">Destination:</span>
                <Avatar src={selectedChat.photo} name={selectedChat.title} size={22} />
                <span className="font-semibold">{selectedChat.title}</span>
                {selectedChat.username && <span className="text-muted text-[11px]">(@{selectedChat.username})</span>}
              </div>
            )}

            {/* Dropzone */}
            <div
              onDragOver={(e) => { e.preventDefault(); setIsDragging(true) }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`rounded-xl border-2 border-dashed p-8 text-center cursor-pointer transition-colors ${
                isDragging ? 'border-primary bg-primary/10' : 'border-border hover:border-primary/50 bg-tile/40'
              }`}
            >
              <UploadCloud size={44} className={`mx-auto mb-2 ${isDragging ? 'text-primary' : 'text-muted'}`} />
              <div className="text-[14px] font-medium text-text">
                Drop files here or <span className="text-primary underline">Browse</span>
              </div>
              <div className="text-[11px] text-muted mt-1">
                Supports video, audio, photos, and any document up to {fmtBytes(uploadMax)}
              </div>
              <input
                type="file"
                ref={fileInputRef}
                multiple
                className="hidden"
                onChange={(e) => {
                  if (e.target.files?.length) {
                    setFiles((prev) => [...prev, ...Array.from(e.target.files!)])
                  }
                }}
              />
            </div>

            {/* Selected files table */}
            {files.length > 0 && (
              <div className="rounded-lg border border-border bg-tile/60 p-3 space-y-2">
                <div className="flex items-center justify-between text-[12px]">
                  <span className="font-semibold text-text">{files.length} files selected ({fmtBytes(totalFilesSize)})</span>
                  <button onClick={() => setFiles([])} className="text-muted hover:text-danger text-[11px]">Clear all</button>
                </div>
                <div className="max-h-56 overflow-y-auto space-y-1.5 divide-y divide-border/40">
                  {files.map((f, i) => {
                    const ext = f.name.split('.').pop()?.toUpperCase() || ''
                    const tooLarge = f.size > uploadMax
                    return (
                      <div key={i} className="flex items-center justify-between pt-1.5 text-[12px]">
                        <div className="flex items-center gap-2 min-w-0 flex-1">
                          <TypeChip ext={ext} />
                          <span className={`truncate ${tooLarge ? 'text-danger font-medium' : 'text-text'}`} title={f.name}>{f.name}</span>
                          {tooLarge && <span className="text-[10px] text-danger bg-danger/10 px-1.5 py-0.5 rounded">Exceeds limit</span>}
                        </div>
                        <div className="flex items-center gap-3 shrink-0 ml-2">
                          <span className="text-muted tabular-nums">{fmtBytes(f.size)}</span>
                          <button onClick={() => removeFile(i)} className="text-muted hover:text-danger p-0.5" title="Remove">
                            <X size={14} />
                          </button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {/* Submit button */}
            <div className="pt-2">
              <Button
                onClick={() => handleUpload()}
                disabled={files.length === 0 || !selectedChatId || hasOversized || busy}
                busy={busy}
                className="w-full py-2.5 text-[14px]"
              >
                Upload {files.length} {files.length === 1 ? 'file' : 'files'} to {selectedChat?.title || 'Selected Chat'}
              </Button>
            </div>
          </div>
        </Panel>
      </div>
    </div>
  )
}
