// Phase 5.2: Downloads page per UI.md & Mockup Reference
import React, { useState } from 'react'
import { Plus, RotateCcw, Download, Folder, CheckSquare, Square, FolderOpen, Send, ExternalLink, Copy, Filter, FileText } from 'lucide-react'
import { call, useCall, useLive, navigate } from '../api.ts'
import type { LiveStats } from '../../../core/transfers.ts'
import { Panel, SearchInput, Chip, Select, Button, Avatar, Pill, Thumb, TypeChip, Pagination, Empty, Skeleton, ErrorState, OpenChatDialog, MediaPreviewModal, fmtBytes, fmtAgo, fmtDuration, toast, triggerFlyToQueue } from '../ui.tsx'

function LinkifiedText({
  text,
  onOpenLink,
}: {
  text: string
  onOpenLink: (url: string) => void
}) {
  if (!text) return null
  const urlRegex = /(https?:\/\/[^\s]+|t\.me\/[^\s]+|tg:\/\/[^\s]+)/gi
  const parts = text.split(urlRegex)
  return (
    <p className="whitespace-pre-wrap leading-relaxed text-[13.5px] text-slate-100 font-normal break-words">
      {parts.map((part, i) => {
        if (/^(https?:\/\/|t\.me\/|tg:\/\/)/i.test(part)) {
          const isTg = /^(https?:\/\/)?(www\.)?(t\.me|telegram\.me|telegram\.dog)\/|^tg:\/\//i.test(part)
          return (
            <button
              key={i}
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                onOpenLink(part)
              }}
              className="inline-flex items-center gap-1 text-cyan hover:text-cyan/80 underline font-medium hover:bg-cyan/10 rounded px-1 -mx-0.5 transition-colors cursor-pointer text-left break-all"
              title={isTg ? 'Open Telegram link in Mediagram' : 'Open in browser'}
            >
              {isTg ? <Send size={11} className="inline shrink-0" /> : <ExternalLink size={11} className="inline shrink-0 opacity-75" />}
              <span>{part}</span>
            </button>
          )
        }
        return <span key={i}>{part}</span>
      })}
    </p>
  )
}

export default function Downloads() {
  const [openChat, setOpenChat] = useState(false)
  const [previewItem, setPreviewItem] = useState<any>(null)
  const [chatId, setChatId] = useState<number | null>(null)
  const [view, setView] = useState<'files' | 'chat'>('files')
  const [chatSearch, setChatSearch] = useState('')
  const [chatKind, setChatKind] = useState<'all' | 'channels' | 'groups' | 'folders'>('all')
  const [selectedFolderId, setSelectedFolderId] = useState<number | null>(null)

  // Files view filters & pagination
  const [fileSearch, setFileSearch] = useState('')
  const [mediaType, setMediaType] = useState<string>('all')
  const [fileExt, setFileExt] = useState<string>('all')
  const [duration, setDuration] = useState<string>('all')
  const [sizeFilter, setSizeFilter] = useState<string>('all')
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [sortBy, setSortBy] = useState<string>('newest')
  const [page, setPage] = useState(1)
  const [selectedIds, setSelectedIds] = useState<number[]>([])

  // Chat view state
  const [msgLimit, setMsgLimit] = useState(30)
  const [chatMsgSearch, setChatMsgSearch] = useState('')
  const [mediaOnlyChat, setMediaOnlyChat] = useState(false)

  // Data fetching
  const { data: chatsData, error: chatsErr, reload: chatsReload } = useCall<{ chats: any[], folders: any[] }>('chats.list', {}, ['chats'])

  const allChats = chatsData?.chats ?? []
  const allFolders = chatsData?.folders ?? []

  // Resolve current chat
  const activeChatId = chatId ?? (allChats[0]?.id ?? null)
  const activeChat = allChats.find((c) => c.id === activeChatId)

  // Filter chats by kind/search
  const filteredChats = allChats.filter((c) => {
    if (chatSearch && !c.title.toLowerCase().includes(chatSearch.toLowerCase()) && !(c.username && c.username.toLowerCase().includes(chatSearch.toLowerCase()))) {
      return false
    }
    if (chatKind === 'channels') return c.kind === 'channel'
    if (chatKind === 'groups') return c.kind === 'group' || c.kind === 'supergroup'
    if (chatKind === 'folders' && selectedFolderId !== null) return c.folders?.includes(selectedFolderId)
    return true
  })

  // Media query params with custom size/duration sorting
  const resolvedSort =
    sizeFilter === 'largest' || sizeFilter === 'smallest' ? sizeFilter :
    duration === 'longest' ? 'longest' :
    duration === 'shortest' ? 'oldest' : 'newest'

  const resolvedSize = sizeFilter !== 'all' && sizeFilter !== 'largest' && sizeFilter !== 'smallest' ? sizeFilter : undefined
  const resolvedDuration = duration !== 'all' && duration !== 'longest' && duration !== 'shortest' ? duration : undefined

  const mediaFilters = {
    chatId: activeChatId || 0,
    type: mediaType !== 'all' ? mediaType : undefined,
    duration: resolvedDuration,
    size: resolvedSize,
    sort: resolvedSort,
    q: fileSearch || undefined,
    page,
    pageSize: 20,
  }

  const { data: mediaData, error: mediaErr, reload: mediaReload } = useCall<{ items: any[], total: number, exts: string[], scan: { state: string, indexed: number, total: number | null } }>(
    'chats.media', activeChatId ? mediaFilters : null, activeChatId ? [`media:${activeChatId}`] : []
  )

  const { data: msgData, error: msgErr, reload: msgReload } = useCall<{ messages: any[], more: boolean }>(
    'chats.messages', activeChatId && view === 'chat' ? { chatId: activeChatId, limit: msgLimit } : null, activeChatId ? [`messages:${activeChatId}`] : []
  )

  const mediaItems = mediaData?.items ?? (mediaData as any)?.media ?? []
  const availableExts = mediaData?.exts ?? []
  const scan = mediaData?.scan
  const messages = msgData?.messages ?? []
  const filteredMessages = messages.filter((m: any) => {
    if (mediaOnlyChat && !m.media) return false
    if (chatMsgSearch) {
      const q = chatMsgSearch.toLowerCase()
      const matchesText = m.text?.toLowerCase().includes(q)
      const matchesMedia = m.media?.name?.toLowerCase().includes(q)
      if (!matchesText && !matchesMedia) return false
    }
    return true
  })

  const resetFilters = () => {
    setFileSearch('')
    setMediaType('all')
    setDuration('all')
    setSizeFilter('all')
    setPage(1)
    setSelectedIds([])
  }

  const toggleSelect = (id: number) => {
    setSelectedIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id])
  }

  const toggleSelectAll = () => {
    if (selectedIds.length === mediaItems.length) {
      setSelectedIds([])
    } else {
      setSelectedIds(mediaItems.map((m: any) => m.messageId))
    }
  }

  const liveState = useLive()
  const liveStats = liveState.stats

  async function downloadItems(items: { chatId: number, messageId: number }[], force = false, e?: React.MouseEvent) {
    try {
      const res = await call<{ added: number, skipped: number }>('downloads.add', { items, force })
      toast(`Added ${res.added}${res.skipped > 0 ? `, skipped ${res.skipped}` : ''}`)
      setSelectedIds([])
      if (res.added > 0) {
        triggerFlyToQueue(e)
      }
    } catch (e) {
      toast((e as Error).message, 'danger')
    }
  }

  async function downloadAllMatching(e?: React.MouseEvent) {
    if (!activeChatId) return
    try {
      const res = await call<{ added: number, skipped: number }>('downloads.add', {
        chatId: activeChatId,
        filters: mediaFilters,
      })
      toast(`Added ${res.added}${res.skipped > 0 ? `, skipped ${res.skipped}` : ''}`)
      if (res.added > 0) {
        triggerFlyToQueue(e)
      }
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

  async function handleTelegramLink(link: string) {
    try {
      const res = await call<any>('chats.open', { link: link.trim(), join: false })
      if (res.chat?.id) {
        setChatId(res.chat.id)
        chatsReload()
        toast(`Opened ${res.chat.title || 'chat'}`)
      } else if (res.invite) {
        setOpenChat(true)
      } else {
        window.open(link.startsWith('http') ? link : `https://${link}`, '_blank')
      }
    } catch {
      window.open(link.startsWith('http') ? link : `https://${link}`, '_blank')
    }
  }

  function copyText(txt: string) {
    navigator.clipboard?.writeText(txt)
    toast('Copied to clipboard')
  }

  return (
    <div className="flex h-full overflow-hidden">
      <OpenChatDialog
        open={openChat}
        onClose={() => setOpenChat(false)}
        onSuccess={(id) => { setChatId(id); chatsReload() }}
      />

      <MediaPreviewModal
        open={!!previewItem}
        item={previewItem}
        onClose={() => setPreviewItem(null)}
        onDownload={previewItem?.messageId && activeChatId ? () => downloadItems([{ chatId: activeChatId, messageId: previewItem.messageId }], true) : undefined}
      />

      {/* Column 1: Chats & Channels (~240px) */}
      <div className="flex w-[240px] shrink-0 flex-col border-r border-border bg-panel/40">
        <div className="flex items-center justify-between border-b border-border p-3.5">
          <div className="text-[14px] font-semibold text-text">Chats &amp; Channels</div>
          <button
            onClick={() => setOpenChat(true)}
            className="flex size-7 items-center justify-center rounded-lg border border-border bg-tile hover:border-primary text-text transition-colors"
            title="Connect Channel"
          >
            <Plus size={14} />
          </button>
        </div>

        <div className="p-3 border-b border-border space-y-2">
          <SearchInput
            placeholder="Search chats or channels…"
            value={chatSearch}
            onChange={setChatSearch}
          />
          <div className="flex flex-wrap gap-1">
            <Chip label="All" active={chatKind === 'all'} onClick={() => { setChatKind('all'); setSelectedFolderId(null) }} />
            <Chip label="Channels" active={chatKind === 'channels'} onClick={() => { setChatKind('channels'); setSelectedFolderId(null) }} />
            <Chip label="Groups" active={chatKind === 'groups'} onClick={() => { setChatKind('groups'); setSelectedFolderId(null) }} />
            {allFolders.length > 0 && (
              <Chip label="Folders" active={chatKind === 'folders'} onClick={() => setChatKind('folders')} />
            )}
          </div>
        </div>

        {chatKind === 'folders' && selectedFolderId === null && (
          <div className="p-2 space-y-1 overflow-y-auto max-h-40 border-b border-border">
            <div className="text-[11px] text-muted px-2 py-1 font-semibold uppercase">Telegram Folders</div>
            {allFolders.map((f: any) => (
              <button
                key={f.id}
                onClick={() => setSelectedFolderId(f.id)}
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[12px] hover:bg-tile text-text"
              >
                <Folder size={14} className="text-primary" />
                <span className="truncate">{f.title || f.name}</span>
              </button>
            ))}
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {chatsErr ? (
            <ErrorState error={chatsErr} onRetry={chatsReload} />
          ) : !chatsData ? (
            <div className="space-y-2 p-2">
              {[...Array(6)].map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
            </div>
          ) : filteredChats.length === 0 ? (
            <div className="py-8 text-center text-muted text-[12px]">
              <p>No chats found</p>
              <Button variant="secondary" className="mt-2 text-[11px] py-1 px-3" onClick={() => setOpenChat(true)}>Connect Channel</Button>
            </div>
          ) : (
            filteredChats.map((c: any) => {
              const active = activeChatId === c.id
              return (
                <button
                  key={c.id}
                  onClick={() => { setChatId(c.id); setPage(1); setSelectedIds([]) }}
                  className={`flex w-full items-center gap-2.5 rounded-lg p-2 text-left transition-colors ${
                    active ? 'bg-primary/20 border border-primary/30 text-text' : 'hover:bg-tile text-text-2 hover:text-text'
                  }`}
                >
                  <Avatar src={c.photo} name={c.title} size={32} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-medium text-text">{c.title}</div>
                    <div className="flex items-center justify-between text-[11px] text-muted">
                      <span className="truncate">{c.username ? `@${c.username}` : c.kind}</span>
                      {c.lastDate ? <span>{fmtAgo(c.lastDate)}</span> : null}
                    </div>
                  </div>
                  {c.unread > 0 && (
                    <span className="rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-bold text-white">
                      {c.unread}
                    </span>
                  )}
                </button>
              )
            })
          )}
        </div>
      </div>

      {/* Column 2: Files View / Chat View (Center flexible) */}
      <div className="flex flex-1 flex-col overflow-y-auto p-5 space-y-4">
        {/* View bar & channel search */}
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <Button
              variant={view === 'files' ? 'primary' : 'secondary'}
              onClick={() => setView('files')}
              className="flex items-center gap-1.5"
            >
              <FileText size={15} />
              <span>Files View</span>
            </Button>
            <Button
              variant={view === 'chat' ? 'primary' : 'secondary'}
              onClick={() => setView('chat')}
              className="flex items-center gap-1.5"
            >
              <span>Chat View</span>
            </Button>
          </div>

          {activeChat && (
            <div className="text-[13px] text-text font-medium truncate max-w-xs">
              {activeChat.title} {activeChat.username && <span className="text-muted text-[11px]">(@{activeChat.username})</span>}
            </div>
          )}

          <div className="w-64">
            <SearchInput
              placeholder="Search files in this channel…"
              value={fileSearch}
              onChange={(v) => { setFileSearch(v); setPage(1) }}
            />
          </div>
        </div>

        {/* Index bar while scanning */}
        {scan && scan.state === 'scanning' && (
          <div className="rounded-lg border border-primary/30 bg-primary/10 p-2.5 text-[12px] text-text">
            <div className="flex items-center justify-between mb-1.5">
              <span>Indexing media… {scan.indexed} {scan.total ? `of about ${scan.total}` : 'found'}</span>
            </div>
            <div className="h-1.5 w-full rounded-full bg-[#1e2a47] overflow-hidden">
              <div
                className="h-full bg-primary rounded-full transition-all duration-300"
                style={{ width: scan.total ? `${Math.min(100, Math.round((scan.indexed / scan.total) * 100))}%` : '50%' }}
              />
            </div>
          </div>
        )}

        {/* Main area depending on Files View vs Chat View */}
        {view === 'files' ? (
          <div className="space-y-3 flex-1 flex flex-col">
            {/* Filter toolbar: Clean 3 selects + Reset */}
            <div className="flex items-center gap-2 flex-wrap">
              <Select
                value={mediaType}
                onChange={(v) => { setMediaType(String(v)); setPage(1) }}
                options={[
                  { value: 'all', label: 'Media: All' },
                  { value: 'video', label: 'Videos' },
                  { value: 'photo', label: 'Photos' },
                  { value: 'document', label: 'Documents' },
                  { value: 'audio', label: 'Audio' },
                  { value: 'animation', label: 'GIFs' },
                ]}
              />
              <Select
                value={sizeFilter}
                onChange={(v) => { setSizeFilter(String(v)); setPage(1) }}
                options={[
                  { value: 'all', label: 'Size: Any' },
                  { value: 'small', label: '< 10 MB' },
                  { value: 'medium', label: '10–100 MB' },
                  { value: 'large', label: '100 MB–1 GB' },
                  { value: 'xlarge', label: '> 1 GB' },
                  { value: 'largest', label: 'Sort: Largest first' },
                  { value: 'smallest', label: 'Sort: Smallest first' },
                ]}
              />
              <Select
                value={duration}
                onChange={(v) => { setDuration(String(v)); setPage(1) }}
                options={[
                  { value: 'all', label: 'Duration: Any' },
                  { value: 'short', label: '< 1 min' },
                  { value: 'medium', label: '1–10 min' },
                  { value: 'long', label: '10–30 min' },
                  { value: 'xlong', label: '> 30 min' },
                  { value: 'longest', label: 'Sort: Longest first' },
                  { value: 'shortest', label: 'Sort: Shortest first' },
                ]}
              />
              <button
                onClick={resetFilters}
                className="flex items-center gap-1 rounded-md border border-border bg-tile px-2.5 py-1.5 text-[12px] text-text-2 hover:border-primary hover:text-text transition-colors"
                title="Reset filters"
              >
                <RotateCcw size={13} />
                <span>Reset</span>
              </button>
            </div>

            {/* Selection bar if items are selected */}
            {selectedIds.length > 0 && (
              <div className="flex items-center justify-between rounded-lg border border-primary/40 bg-primary/15 px-4 py-2.5 text-[13px] text-text">
                <div className="font-semibold">{selectedIds.length} items selected</div>
                <div className="flex items-center gap-2">
                  <Button
                    onClick={() => downloadItems(selectedIds.map((id) => ({ chatId: activeChatId!, messageId: id })), true)}
                    className="py-1 px-3 text-[12px]"
                  >
                    Download selected
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={downloadAllMatching}
                    className="py-1 px-3 text-[12px]"
                  >
                    Download all {mediaData?.total ?? 0} matching
                  </Button>
                  <button
                    onClick={() => setSelectedIds([])}
                    className="text-[12px] text-muted hover:text-text ml-2 underline"
                  >
                    Clear
                  </button>
                </div>
              </div>
            )}

            {/* Files View Table */}
            <div className="rounded-[14px] border border-border bg-panel/85 p-3 flex-1 flex flex-col justify-between">
              {mediaErr ? (
                <ErrorState error={mediaErr} onRetry={mediaReload} />
              ) : !mediaData ? (
                <div className="space-y-3 p-4">
                  {[...Array(7)].map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
                </div>
              ) : mediaItems.length === 0 ? (
                <div className="py-16 text-center">
                  <Empty message="No media files found matching the criteria" />
                  <Button variant="secondary" onClick={resetFilters} className="mt-2 text-[12px]">Reset filters</Button>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-[13px]">
                    <thead className="border-b border-white/[0.08] text-[12px] text-muted">
                      <tr>
                        <th className="py-2.5 px-1 text-center w-10">
                          <button onClick={toggleSelectAll} className="text-muted hover:text-white">
                            {selectedIds.length === mediaItems.length && mediaItems.length > 0 ? (
                              <CheckSquare size={15} className="text-primary" />
                            ) : (
                              <Square size={15} />
                            )}
                          </button>
                        </th>
                        <th className="py-2.5 px-1 text-center w-10 text-muted font-normal">#</th>
                        <th className="py-2.5 px-2 text-center w-16 font-medium">Preview</th>
                        <th className="py-2.5 px-3 text-left w-[36%] font-medium">File Name</th>
                        <th className="py-2.5 px-2 text-center w-20 font-medium">Type</th>
                        <th className="py-2.5 px-2 text-right w-24 font-medium">Size</th>
                        <th className="py-2.5 px-2 text-center w-24 font-medium">Duration</th>
                        <th className="py-2.5 px-2 text-center w-32 font-medium">Status</th>
                        <th className="py-2.5 px-3 text-right w-24 font-medium">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/[0.05]">
                      {mediaItems.map((m: any, i: number) => {
                        const isSelected = selectedIds.includes(m.messageId)
                        return (
                          <tr key={m.messageId} className={`hover:bg-white/[0.03] transition-colors ${isSelected ? 'bg-primary/10' : ''}`}>
                            <td className="py-2.5 px-1 text-center">
                              <button onClick={() => toggleSelect(m.messageId)} className="text-muted hover:text-white">
                                {isSelected ? <CheckSquare size={15} className="text-primary" /> : <Square size={15} />}
                              </button>
                            </td>
                            <td className="py-2.5 px-1 text-center text-muted text-[11px]">{(page - 1) * 20 + i + 1}</td>
                            <td
                              className="py-2.5 px-2 text-center cursor-pointer hover:opacity-80 transition-opacity"
                              title="Click for preview"
                              onClick={() => setPreviewItem({ name: m.name, path: m.path, thumb: m.thumb, type: m.type, size: m.size, duration: m.duration, messageId: m.messageId })}
                            >
                              <div className="flex justify-center">
                                <Thumb src={m.thumb ? `teleflow://thumb/${m.thumb}` : null} name={m.name} />
                              </div>
                            </td>
                            <td className="py-2.5 px-3 min-w-0">
                              <div
                                className="font-medium truncate text-text cursor-pointer hover:text-primary transition-colors text-[13px]"
                                title={m.name}
                                onClick={() => setPreviewItem({ name: m.name, path: m.path, thumb: m.thumb, type: m.type, size: m.size, duration: m.duration, messageId: m.messageId })}
                              >
                                {m.name}
                              </div>
                            </td>
                            <td className="py-2.5 px-2 text-center">
                              <TypeChip ext={m.ext} />
                            </td>
                            <td className="py-2.5 px-2 text-right tabular-nums text-text-2 font-medium">
                              {fmtBytes(m.size)}
                            </td>
                            <td className="py-2.5 px-2 text-center tabular-nums text-muted text-[12px]">
                              {m.duration ? fmtDuration(m.duration) : '-'}
                            </td>
                            <td className="py-2.5 px-2 text-center">
                              <Pill status={m.status} />
                            </td>
                            <td className="py-2.5 px-3 text-right">
                              {m.status === 'downloaded' ? (
                                <div className="flex items-center justify-end gap-1">
                                  {m.path && (
                                    <button
                                      onClick={() => revealFile(m.path)}
                                      className="rounded p-1.5 text-primary hover:bg-primary/20 transition-colors"
                                      title="Show in folder"
                                    >
                                      <FolderOpen size={16} />
                                    </button>
                                  )}
                                  <button
                                    onClick={() => downloadItems([{ chatId: activeChatId!, messageId: m.messageId }], true)}
                                    className="rounded p-1.5 text-muted hover:text-primary hover:bg-white/10 transition-colors"
                                    title="Download again"
                                  >
                                    <RotateCcw size={15} />
                                  </button>
                                </div>
                              ) : (
                                <button
                                  onClick={() => downloadItems([{ chatId: activeChatId!, messageId: m.messageId }], true)}
                                  className="rounded p-1.5 text-muted hover:text-primary hover:bg-white/10 transition-colors"
                                  title="Download"
                                >
                                  <Download size={16} />
                                </button>
                              )}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Pagination */}
              {mediaData && mediaData.total > 20 && (
                <div className="pt-3 border-t border-border mt-3">
                  <Pagination
                    page={page}
                    pageSize={20}
                    total={mediaData.total}
                    onPage={setPage}
                  />
                </div>
              )}
            </div>
          </div>
        ) : (
          /* Real Telegram Clone Chat View */
          <div className="flex-1 rounded-xl border border-white/[0.08] bg-[#0c1530]/85 backdrop-blur-md p-4 flex flex-col justify-between overflow-hidden shadow-sm">
            {/* Chat View Header Toolbar */}
            <div className="flex items-center justify-between gap-3 pb-3 border-b border-white/[0.08] mb-3 flex-wrap">
              <div className="flex items-center gap-2.5 min-w-0">
                <Avatar src={activeChat?.photo} name={activeChat?.title || 'Chat'} size={32} />
                <div className="min-w-0">
                  <div className="text-[13px] font-bold text-text truncate leading-tight">
                    {activeChat?.title || 'Messages'}
                  </div>
                  <div className="text-[11px] text-muted truncate leading-tight mt-0.5">
                    {activeChat?.username ? `@${activeChat.username}` : activeChat?.kind || 'Channel'} • {filteredMessages.length} messages
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-48">
                  <SearchInput
                    placeholder="Search in chat…"
                    value={chatMsgSearch}
                    onChange={setChatMsgSearch}
                  />
                </div>
                <button
                  type="button"
                  onClick={() => setMediaOnlyChat(!mediaOnlyChat)}
                  className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12px] font-medium border transition-colors ${
                    mediaOnlyChat
                      ? 'bg-primary text-white border-primary shadow-sm'
                      : 'bg-white/5 border-white/10 text-muted hover:text-white hover:bg-white/10'
                  }`}
                  title="Filter messages that contain media files"
                >
                  <Filter size={13} />
                  <span>Media only</span>
                </button>
              </div>
            </div>

            {/* Message Stream */}
            <div className="flex-1 overflow-y-auto space-y-3 pr-1">
              {msgErr ? (
                <ErrorState error={msgErr} onRetry={msgReload} />
              ) : !msgData ? (
                <div className="space-y-4 p-4">
                  {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-20 w-3/4 rounded-2xl" />)}
                </div>
              ) : filteredMessages.length === 0 ? (
                <div className="py-16 text-center text-muted">
                  <p>No messages found matching criteria</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {msgData.more && (
                    <div className="text-center py-2">
                      <Button variant="secondary" onClick={() => setMsgLimit((l) => Math.min(l + 30, 1000))} className="text-[12px]">
                        Load older messages
                      </Button>
                    </div>
                  )}
                  {filteredMessages.map((m: any) => (
                    <div
                      key={m.id}
                      className="rounded-2xl border border-white/[0.08] bg-[#1e293b]/90 p-4 shadow-sm hover:border-white/20 transition-all max-w-3xl"
                    >
                      {/* Message header */}
                      <div className="flex items-center justify-between text-[11px] text-muted mb-2">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-primary text-[13px]">{m.sender || activeChat?.title || 'Unknown'}</span>
                          <span className="text-white/20">•</span>
                          <span>{fmtAgo(m.date)}</span>
                        </div>
                        <div className="flex items-center gap-1">
                          {m.text && (
                            <button
                              onClick={() => copyText(m.text)}
                              className="rounded p-1 hover:bg-white/10 text-muted hover:text-white transition-colors"
                              title="Copy message text"
                            >
                              <Copy size={13} />
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Text content with clickable links */}
                      {m.text && (
                        <div className="mb-2">
                          <LinkifiedText text={m.text} onOpenLink={handleTelegramLink} />
                        </div>
                      )}

                      {/* Media Card */}
                      {m.media && (
                        <div className="flex items-center justify-between rounded-xl border border-white/[0.08] bg-[#0f172a]/70 p-3 mt-2 shadow-inner">
                          <div
                            className="flex items-center gap-3 overflow-hidden cursor-pointer group flex-1 min-w-0 pr-3"
                            title="Click for preview"
                            onClick={() => setPreviewItem({ name: m.media.name, path: m.media.path, thumb: m.media.thumb, type: m.media.type, size: m.media.size, duration: m.media.duration, messageId: m.id })}
                          >
                            <Thumb src={m.media.thumb ? `teleflow://thumb/${m.media.thumb}` : null} name={m.media.name} />
                            <div className="truncate min-w-0 flex-1">
                              <div className="text-[13px] font-medium text-text truncate group-hover:text-primary transition-colors">
                                {m.media.name}
                              </div>
                              <div className="flex items-center gap-2 text-[11px] text-muted mt-0.5">
                                <span>{fmtBytes(m.media.size)}</span>
                                {m.media.duration ? <span>• {fmtDuration(m.media.duration)}</span> : null}
                              </div>
                            </div>
                          </div>

                          <div className="shrink-0 flex items-center gap-1.5">
                            {m.media.status === 'downloaded' ? (
                              <>
                                {m.media.path && (
                                  <Button variant="secondary" onClick={() => revealFile(m.media.path)} className="text-[11px] py-1 px-2.5">
                                    Show in folder
                                  </Button>
                                )}
                                <Button
                                  variant="primary"
                                  onClick={() => downloadItems([{ chatId: activeChatId!, messageId: m.id }], true)}
                                  className="text-[11px] py-1 px-2.5 flex items-center gap-1"
                                >
                                  <RotateCcw size={12} /> Re-download
                                </Button>
                              </>
                            ) : (
                              <Button
                                variant="primary"
                                onClick={() => downloadItems([{ chatId: activeChatId!, messageId: m.id }], true)}
                                className="text-[11px] py-1.5 px-3 flex items-center gap-1 font-medium"
                              >
                                <Download size={13} /> Download
                              </Button>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
