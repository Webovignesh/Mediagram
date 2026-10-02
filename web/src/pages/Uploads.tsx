// Phase 5.3: Uploads page per UI.md & Reference Mockup
import { useState, useRef, type DragEvent } from 'react'
import { UploadCloud, X, Upload, Zap, Clock, CheckCircle2, FileText } from 'lucide-react'
import { call, useCall, useLive, navigate } from '../api.ts'
import type { LiveStats } from '../../../core/transfers.ts'
import { Panel, SearchInput, Chip, Button, Avatar, Toggle, TypeChip, Empty, Skeleton, ErrorState, fmtBytes, toast, triggerFlyToQueue } from '../ui.tsx'

export default function Uploads() {
  const [chatId, setChatId] = useState<number | null>(null)
  const [destSearch, setDestSearch] = useState('')
  const [destKind, setDestKind] = useState<'all' | 'channels' | 'groups' | 'saved'>('all')

  const [files, setFiles] = useState<File[]>([])
  const [caption, setCaption] = useState('')
  const [asAlbum, setAsAlbum] = useState(false)
  const [keepNames, setKeepNames] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const [busy, setBusy] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const { data: chatsData, error: chatsErr, reload: chatsReload } = useCall<{ chats: any[] }>('chats.list', {}, ['chats'])
  const { data: authData } = useCall<{ me?: { captionMax?: number, uploadMax?: number } }>('auth.get', {}, ['auth'])
  const { data: settings } = useCall<any>('settings.get', {}, ['settings'])

  const captionMax = authData?.me?.captionMax || 1024
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
      const paths = files.map((f) => window.teleflow?.pathOf?.(f) || (f as any).path || f.name).filter(Boolean)
      const res = await call<{ added: number }>('uploads.add', {
        chatId: selectedChatId,
        paths,
        caption: caption.trim(),
        album: asAlbum,
        keepNames,
      })
      toast(`Queued ${res.added} uploads to ${selectedChat?.title || 'chat'}`)
      setFiles([])
      setCaption('')
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
      {/* Column 1: Destinations (~300px) */}
      <div className="flex w-[300px] shrink-0 flex-col border-r border-border bg-panel/40">
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

        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {chatsErr ? (
            <ErrorState error={chatsErr} onRetry={chatsReload} />
          ) : !chatsData ? (
            <div className="space-y-2 p-2">
              {[...Array(6)].map((_, i) => <Skeleton key={i} className="h-11 w-full" />)}
            </div>
          ) : filteredDests.length === 0 ? (
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

      {/* Column 2: New Upload (~flexible center) */}
      <div className="flex flex-1 flex-col overflow-y-auto p-6 space-y-4">
        <div className="flex items-center justify-between pr-40">
          <div>
            <h1 className="text-[26px] font-bold text-white tracking-wide">Uploads</h1>
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

            {/* Caption textarea */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-[12px] text-muted">
                <span>Caption (optional)</span>
                <span className="tabular-nums">{caption.length} / {captionMax}</span>
              </div>
              <textarea
                value={caption}
                maxLength={captionMax}
                onChange={(e) => setCaption(e.target.value)}
                placeholder="Add a caption to your upload…"
                rows={2}
                className="w-full rounded-[10px] border border-border bg-tile p-2.5 text-[13px] text-text placeholder:text-muted focus:border-primary outline-none"
              />
            </div>

            {/* Upload options */}
            <div className="space-y-3 pt-1">
              <Toggle label="Upload as album (groups matching files)" checked={asAlbum} onChange={setAsAlbum} />
              <Toggle label="Keep original file names (default sends with Mediagram prefix)" checked={keepNames} onChange={setKeepNames} />
            </div>

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
