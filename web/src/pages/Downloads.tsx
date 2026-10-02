// Phase 5.2: Downloads page per UI.md & Mockup Reference
import React, { useState, useRef, useEffect, useLayoutEffect } from 'react'
import { Plus, RotateCcw, Download, Folder, CheckSquare, Square, FolderOpen, Send, ExternalLink, Copy, Filter, FileText, ChevronDown, Play, SlidersHorizontal, ArrowDown, Trash2, Film, LogOut, MoreVertical } from 'lucide-react'
import { call, useCall, useLive, navigate } from '../api.ts'
import type { LiveStats } from '../../../core/transfers.ts'
import { Panel, SearchInput, Chip, Select, Button, Avatar, Pill, Thumb, TypeChip, Pagination, Empty, Skeleton, ErrorState, OpenChatDialog, MediaPreviewModal, Dialog, fmtBytes, fmtAgo, fmtDuration, toast, triggerFlyToQueue, confirm } from '../ui.tsx'

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

function getDateGroup(timestampSec: number): string {
  const date = new Date(timestampSec * 1000)
  const today = new Date()
  if (date.toDateString() === today.toDateString()) return 'Today'
  const yesterday = new Date(today)
  yesterday.setDate(today.getDate() - 1)
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday'
  return date.toLocaleDateString(undefined, {
    month: 'long',
    day: 'numeric',
    year: date.getFullYear() !== today.getFullYear() ? 'numeric' : undefined,
  })
}

function getMessageTime(timestampSec: number): string {
  return new Date(timestampSec * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
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

  // Custom filter state
  const [customSizeModalOpen, setCustomSizeModalOpen] = useState(false)
  const [customSizeMin, setCustomSizeMin] = useState('')
  const [customSizeMinUnit, setCustomSizeMinUnit] = useState<'KB' | 'MB' | 'GB'>('MB')
  const [customSizeMax, setCustomSizeMax] = useState('')
  const [customSizeMaxUnit, setCustomSizeMaxUnit] = useState<'KB' | 'MB' | 'GB'>('MB')
  const [appliedCustomSize, setAppliedCustomSize] = useState<{ minBytes: number, maxBytes: number, label: string } | null>(null)

  const [customDurationModalOpen, setCustomDurationModalOpen] = useState(false)
  const [customDurationMin, setCustomDurationMin] = useState('')
  const [customDurationMinUnit, setCustomDurationMinUnit] = useState<'sec' | 'min' | 'hr'>('min')
  const [customDurationMax, setCustomDurationMax] = useState('')
  const [customDurationMaxUnit, setCustomDurationMaxUnit] = useState<'sec' | 'min' | 'hr'>('min')
  const [appliedCustomDuration, setAppliedCustomDuration] = useState<{ minSec: number, maxSec: number, label: string } | null>(null)

  // Chat view state
  const [msgLimit, setMsgLimit] = useState(30)
  const [chatMsgSearch, setChatMsgSearch] = useState('')
  const [mediaOnlyChat, setMediaOnlyChat] = useState(false)
  const chatScrollRef = useRef<HTMLDivElement>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const [showScrollBottom, setShowScrollBottom] = useState(false)

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

  const resolvedSize =
    sizeFilter === 'custom' && appliedCustomSize
      ? `custom:${appliedCustomSize.minBytes}:${appliedCustomSize.maxBytes}`
      : sizeFilter !== 'all' && sizeFilter !== 'largest' && sizeFilter !== 'smallest' && sizeFilter !== 'custom'
      ? sizeFilter
      : undefined

  const resolvedDuration =
    duration === 'custom' && appliedCustomDuration
      ? `custom:${appliedCustomDuration.minSec}:${appliedCustomDuration.maxSec}`
      : duration !== 'all' && duration !== 'longest' && duration !== 'shortest' && duration !== 'custom'
      ? duration
      : undefined

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
    setAppliedCustomSize(null)
    setAppliedCustomDuration(null)
    setPage(1)
    setSelectedIds([])
  }

  const unitToBytes = (u: 'KB' | 'MB' | 'GB') => (u === 'GB' ? 1024 * 1024 * 1024 : u === 'MB' ? 1024 * 1024 : 1024)
  function applyCustomSize() {
    const minVal = parseFloat(customSizeMin)
    const maxVal = parseFloat(customSizeMax)
    const minBytes = !isNaN(minVal) && minVal >= 0 ? Math.round(minVal * unitToBytes(customSizeMinUnit)) : 0
    const maxBytes = !isNaN(maxVal) && maxVal > 0 ? Math.round(maxVal * unitToBytes(customSizeMaxUnit)) : Number.MAX_SAFE_INTEGER
    if (minBytes > maxBytes) {
      toast('Min size cannot be greater than Max size', 'danger')
      return
    }
    const label = `${!isNaN(minVal) && minVal > 0 ? `${minVal} ${customSizeMinUnit}` : '0'} – ${!isNaN(maxVal) && maxVal > 0 ? `${maxVal} ${customSizeMaxUnit}` : '∞'}`
    setAppliedCustomSize({ minBytes, maxBytes, label })
    setSizeFilter('custom')
    setPage(1)
    setCustomSizeModalOpen(false)
  }

  const unitToSec = (u: 'sec' | 'min' | 'hr') => (u === 'hr' ? 3600 : u === 'min' ? 60 : 1)
  function applyCustomDuration() {
    const minVal = parseFloat(customDurationMin)
    const maxVal = parseFloat(customDurationMax)
    const minSec = !isNaN(minVal) && minVal >= 0 ? Math.round(minVal * unitToSec(customDurationMinUnit)) : 0
    const maxSec = !isNaN(maxVal) && maxVal > 0 ? Math.round(maxVal * unitToSec(customDurationMaxUnit)) : Number.MAX_SAFE_INTEGER
    if (minSec > maxSec) {
      toast('Min duration cannot be greater than Max duration', 'danger')
      return
    }
    const label = `${!isNaN(minVal) && minVal > 0 ? `${minVal} ${customDurationMinUnit}` : '0s'} – ${!isNaN(maxVal) && maxVal > 0 ? `${maxVal} ${customDurationMaxUnit}` : '∞'}`
    setAppliedCustomDuration({ minSec, maxSec, label })
    setDuration('custom')
    setPage(1)
    setCustomDurationModalOpen(false)
  }

  const scrollToBottom = (behavior: ScrollBehavior = 'smooth') => {
    messagesEndRef.current?.scrollIntoView({ behavior })
  }

  const prevScrollHeightRef = useRef<number>(0)
  const prevScrollTopRef = useRef<number>(0)
  const [channelMenuOpen, setChannelMenuOpen] = useState(false)

  // Only scroll to bottom when switching chats or entering chat view
  useEffect(() => {
    if (view === 'chat' && activeChatId) {
      setTimeout(() => scrollToBottom('auto'), 80)
    }
  }, [view, activeChatId])

  // Preserve scroll position when older messages are loaded at the top
  useLayoutEffect(() => {
    if (prevScrollHeightRef.current > 0 && chatScrollRef.current) {
      const newScrollHeight = chatScrollRef.current.scrollHeight
      const diff = newScrollHeight - prevScrollHeightRef.current
      if (diff > 0) {
        chatScrollRef.current.scrollTop = prevScrollTopRef.current + diff
      }
      prevScrollHeightRef.current = 0
    }
  }, [messages.length])

  const handleLoadOlder = () => {
    if (chatScrollRef.current) {
      prevScrollHeightRef.current = chatScrollRef.current.scrollHeight
      prevScrollTopRef.current = chatScrollRef.current.scrollTop
    }
    setMsgLimit((l) => Math.min(l + 30, 1000))
  }

  const [newMsgText, setNewMsgText] = useState('')
  const [sendingMsg, setSendingMsg] = useState(false)

  async function handleSendChatMessage() {
    if (!activeChatId || !newMsgText.trim() || sendingMsg) return
    const txt = newMsgText.trim()
    setSendingMsg(true)
    try {
      await call('chats.send', { chatId: activeChatId, text: txt })
      setNewMsgText('')
      toast('Message sent')
      msgReload()
      setTimeout(() => scrollToBottom('smooth'), 200)
    } catch (e) {
      toast((e as Error).message, 'danger')
    } finally {
      setSendingMsg(false)
    }
  }

  async function clearChatHistory(id: number, title: string) {
    if (await confirm({
      title: 'Clear Chat History',
      message: `Delete all messages in "${title}"? This cannot be undone.`,
      confirm: 'Clear History',
      danger: true,
    })) {
      try {
        await call('chats.clear', { chatId: id })
        toast(`Cleared chat history in ${title}`)
        msgReload()
        mediaReload()
      } catch (e) {
        toast((e as Error).message, 'danger')
      }
    }
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

  async function downloadAllFolderMedia() {
    if (!filteredChats.length) return
    try {
      let totalAdded = 0
      for (const c of filteredChats) {
        const res = await call<{ added: number, skipped: number }>('downloads.add', {
          chatId: c.id,
          filters: mediaFilters,
        }).catch(() => ({ added: 0, skipped: 0 }))
        totalAdded += res.added
      }
      toast(`Added ${totalAdded} files from folder channels to download queue`)
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
        const title = res.invite.title || 'Channel'
        const count = res.invite.members ? ` (${res.invite.members} members)` : ''
        if (await confirm({
          title: `Join ${title}?`,
          message: `Would you like to join "${title}"${count} and open its media in Mediagram?`,
          confirm: 'Join & Open',
        })) {
          const joined = await call<any>('chats.open', { link: link.trim(), join: true })
          if (joined.chat?.id) {
            setChatId(joined.chat.id)
            chatsReload()
            toast(`Joined ${joined.chat.title || 'chat'}`)
          }
        }
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

  async function confirmLeaveChat(id: number, title: string) {
    if (await confirm({
      title: 'Leave or Delete Channel',
      message: `Are you sure you want to leave or remove "${title}"? You will stop receiving updates and files from it.`,
      confirm: 'Leave Channel',
      danger: true,
    })) {
      try {
        await call('chats.leave', { chatId: id })
        toast(`Left ${title}`)
        if (chatId === id) {
          setChatId(null)
        }
        chatsReload()
      } catch (e) {
        toast((e as Error).message, 'danger')
      }
    }
  }

  function copyChatLink(username?: string) {
    if (!username) return
    const link = `https://t.me/${username.replace(/^@/, '')}`
    navigator.clipboard?.writeText(link)
    toast('Link copied to clipboard')
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

      {/* Custom Size Dialog */}
      <Dialog
        open={customSizeModalOpen}
        onClose={() => setCustomSizeModalOpen(false)}
        title="Custom Size Filter"
      >
        <div className="space-y-4">
          <p className="text-[12.5px] text-muted leading-relaxed">
            Specify a custom file size range to filter your channel media.
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[12px] font-medium text-text-2 mb-1.5">Min Size</label>
              <div className="flex gap-1.5">
                <input
                  type="number"
                  min="0"
                  step="any"
                  placeholder="0"
                  value={customSizeMin}
                  onChange={(e) => setCustomSizeMin(e.target.value)}
                  className="w-full rounded-md border border-border bg-tile px-2.5 py-1.5 text-[13px] text-text outline-none focus:border-primary"
                />
                <select
                  value={customSizeMinUnit}
                  onChange={(e) => setCustomSizeMinUnit(e.target.value as any)}
                  className="rounded-md border border-border bg-tile px-2 py-1.5 text-[12px] text-text cursor-pointer"
                >
                  <option value="KB">KB</option>
                  <option value="MB">MB</option>
                  <option value="GB">GB</option>
                </select>
              </div>
            </div>
            <div>
              <label className="block text-[12px] font-medium text-text-2 mb-1.5">Max Size</label>
              <div className="flex gap-1.5">
                <input
                  type="number"
                  min="0"
                  step="any"
                  placeholder="No limit"
                  value={customSizeMax}
                  onChange={(e) => setCustomSizeMax(e.target.value)}
                  className="w-full rounded-md border border-border bg-tile px-2.5 py-1.5 text-[13px] text-text outline-none focus:border-primary"
                />
                <select
                  value={customSizeMaxUnit}
                  onChange={(e) => setCustomSizeMaxUnit(e.target.value as any)}
                  className="rounded-md border border-border bg-tile px-2 py-1.5 text-[12px] text-text cursor-pointer"
                >
                  <option value="KB">KB</option>
                  <option value="MB">MB</option>
                  <option value="GB">GB</option>
                </select>
              </div>
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setCustomSizeModalOpen(false)}>Cancel</Button>
            <Button variant="primary" onClick={applyCustomSize}>Apply Filter</Button>
          </div>
        </div>
      </Dialog>

      {/* Custom Duration Dialog */}
      <Dialog
        open={customDurationModalOpen}
        onClose={() => setCustomDurationModalOpen(false)}
        title="Custom Duration Filter"
      >
        <div className="space-y-4">
          <p className="text-[12.5px] text-muted leading-relaxed">
            Specify a custom video/audio length range to filter media.
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[12px] font-medium text-text-2 mb-1.5">Min Duration</label>
              <div className="flex gap-1.5">
                <input
                  type="number"
                  min="0"
                  step="any"
                  placeholder="0"
                  value={customDurationMin}
                  onChange={(e) => setCustomDurationMin(e.target.value)}
                  className="w-full rounded-md border border-border bg-tile px-2.5 py-1.5 text-[13px] text-text outline-none focus:border-primary"
                />
                <select
                  value={customDurationMinUnit}
                  onChange={(e) => setCustomDurationMinUnit(e.target.value as any)}
                  className="rounded-md border border-border bg-tile px-2 py-1.5 text-[12px] text-text cursor-pointer"
                >
                  <option value="sec">Sec</option>
                  <option value="min">Min</option>
                  <option value="hr">Hours</option>
                </select>
              </div>
            </div>
            <div>
              <label className="block text-[12px] font-medium text-text-2 mb-1.5">Max Duration</label>
              <div className="flex gap-1.5">
                <input
                  type="number"
                  min="0"
                  step="any"
                  placeholder="No limit"
                  value={customDurationMax}
                  onChange={(e) => setCustomDurationMax(e.target.value)}
                  className="w-full rounded-md border border-border bg-tile px-2.5 py-1.5 text-[13px] text-text outline-none focus:border-primary"
                />
                <select
                  value={customDurationMaxUnit}
                  onChange={(e) => setCustomDurationMaxUnit(e.target.value as any)}
                  className="rounded-md border border-border bg-tile px-2 py-1.5 text-[12px] text-text cursor-pointer"
                >
                  <option value="sec">Sec</option>
                  <option value="min">Min</option>
                  <option value="hr">Hours</option>
                </select>
              </div>
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setCustomDurationModalOpen(false)}>Cancel</Button>
            <Button variant="primary" onClick={applyCustomDuration}>Apply Filter</Button>
          </div>
        </div>
      </Dialog>

      {/* Column 1: Chats & Channels (~300px) */}
      <div className="flex w-[300px] shrink-0 flex-col border-r border-border bg-panel/40">
        <div className="flex items-center justify-between border-b border-border p-3.5">
          <div className="text-[14px] font-semibold text-text tracking-wide">Chats &amp; Channels</div>
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
                <div
                  key={c.id}
                  onClick={() => {
                    setChatId(c.id)
                    setPage(1)
                    setSelectedIds([])
                    c.unread = 0
                  }}
                  className={`group relative flex w-full items-center gap-2.5 rounded-lg p-2 text-left transition-colors cursor-pointer ${
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
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      confirmLeaveChat(c.id, c.title)
                    }}
                    className="opacity-0 group-hover:opacity-100 transition-opacity rounded p-1 text-muted hover:text-danger hover:bg-danger/15 shrink-0"
                    title="Leave / Delete Channel"
                  >
                    <Trash2 size={13} />
                  </button>
                  {c.unread > 0 && (
                    <span className="rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-bold text-white shrink-0">
                      {c.unread}
                    </span>
                  )}
                </div>
              )
            })
          )}
        </div>
      </div>

      {/* Column 2: Files View / Chat View (Center flexible) */}
      <div className="flex flex-1 flex-col overflow-y-auto p-5 space-y-4">
        {/* View bar & channel search */}
        <div className="flex items-center justify-between gap-3 flex-wrap pr-40">
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

          <div className="w-64">
            <SearchInput
              placeholder="Search files in this channel…"
              value={fileSearch}
              onChange={(v) => { setFileSearch(v); setPage(1) }}
            />
          </div>
        </div>

        {/* Telegram Folder banner if viewing a folder */}
        {chatKind === 'folders' && selectedFolderId !== null && (
          <div className="flex items-center justify-between rounded-xl border border-primary/30 bg-primary/10 px-4 py-3 text-[13px] text-text">
            <div className="flex items-center gap-2.5">
              <div className="grid size-8 place-items-center rounded-lg bg-primary/20 text-primary">
                <Folder size={18} />
              </div>
              <div>
                <div className="font-semibold text-text">
                  Folder: {allFolders.find((f: any) => f.id === selectedFolderId)?.title || allFolders.find((f: any) => f.id === selectedFolderId)?.name || 'Custom Folder'}
                </div>
                <div className="text-[11.5px] text-muted">
                  {filteredChats.length} channels / groups in this folder
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="primary"
                onClick={downloadAllFolderMedia}
                className="py-1.5 px-3.5 text-[12px] flex items-center gap-1.5"
              >
                <Download size={14} /> Download all media in folder
              </Button>
            </div>
          </div>
        )}

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
            {/* Active Channel header in Files View */}
            {activeChat && (
              <div className="flex items-center justify-between pb-3 border-b border-border/40">
                <div className="flex items-center gap-3 min-w-0">
                  <Avatar src={activeChat.photo} name={activeChat.title} size={34} />
                  <div className="min-w-0">
                    <div className="text-[14px] font-bold text-text truncate leading-tight tracking-wide">
                      {activeChat.title}
                    </div>
                    <div className="text-[11.5px] text-muted truncate leading-tight mt-0.5">
                      {activeChat.username ? `@${activeChat.username}` : activeChat.kind || 'Channel'} • {mediaData?.total ?? 0} files
                    </div>
                  </div>
                </div>

                {/* 3-dot channel menu */}
                <div className="relative">
                  <button
                    onClick={() => setChannelMenuOpen(!channelMenuOpen)}
                    className="flex size-8 items-center justify-center rounded-lg border border-border bg-tile text-muted hover:text-white hover:border-primary transition-colors"
                    title="Channel Actions"
                  >
                    <MoreVertical size={16} />
                  </button>
                  {channelMenuOpen && (
                    <div
                      className="absolute right-0 top-full mt-1.5 z-50 w-48 rounded-xl border border-border bg-[#182533] p-1.5 shadow-2xl backdrop-blur-xl space-y-0.5"
                      onClick={() => setChannelMenuOpen(false)}
                    >
                      {activeChat.username && (
                        <button
                          onClick={() => copyChatLink(activeChat.username)}
                          className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[12px] text-text hover:bg-white/10 transition-colors"
                        >
                          <Copy size={13} className="text-muted" />
                          <span>Copy Link</span>
                        </button>
                      )}
                      <button
                        onClick={() => clearChatHistory(activeChat.id, activeChat.title)}
                        className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[12px] text-text hover:bg-white/10 transition-colors"
                      >
                        <RotateCcw size={13} className="text-muted" />
                        <span>Clear Chat History</span>
                      </button>
                      <button
                        onClick={() => confirmLeaveChat(activeChat.id, activeChat.title)}
                        className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[12px] text-danger hover:bg-danger/15 transition-colors"
                      >
                        <Trash2 size={13} />
                        <span>Leave / Delete Channel</span>
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Filter toolbar: Clean 3 selects + Custom + Reset */}
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
                onChange={(v) => {
                  if (v === 'custom') {
                    setCustomSizeModalOpen(true)
                  } else {
                    setSizeFilter(String(v))
                    setAppliedCustomSize(null)
                    setPage(1)
                  }
                }}
                options={[
                  { value: 'all', label: 'Size: Any' },
                  { value: 'small', label: '< 10 MB' },
                  { value: 'medium', label: '10–100 MB' },
                  { value: 'large', label: '100 MB–1 GB' },
                  { value: 'xlarge', label: '> 1 GB' },
                  { value: 'custom', label: appliedCustomSize ? `Size: ${appliedCustomSize.label}` : 'Custom Size…' },
                  { value: 'largest', label: 'Sort: Largest first' },
                  { value: 'smallest', label: 'Sort: Smallest first' },
                ]}
              />
              {sizeFilter === 'custom' && (
                <button
                  type="button"
                  onClick={() => setCustomSizeModalOpen(true)}
                  className="rounded-md border border-primary/40 bg-primary/20 px-2 py-1.5 text-[11px] text-cyan hover:bg-primary/30 transition-colors"
                  title="Edit custom size range"
                >
                  Edit Size
                </button>
              )}
              <Select
                value={duration}
                onChange={(v) => {
                  if (v === 'custom') {
                    setCustomDurationModalOpen(true)
                  } else {
                    setDuration(String(v))
                    setAppliedCustomDuration(null)
                    setPage(1)
                  }
                }}
                options={[
                  { value: 'all', label: 'Duration: Any' },
                  { value: 'short', label: '< 1 min' },
                  { value: 'medium', label: '1–10 min' },
                  { value: 'long', label: '10–30 min' },
                  { value: 'xlong', label: '> 30 min' },
                  { value: 'custom', label: appliedCustomDuration ? `Duration: ${appliedCustomDuration.label}` : 'Custom Duration…' },
                  { value: 'longest', label: 'Sort: Longest first' },
                  { value: 'shortest', label: 'Sort: Shortest first' },
                ]}
              />
              {duration === 'custom' && (
                <button
                  type="button"
                  onClick={() => setCustomDurationModalOpen(true)}
                  className="rounded-md border border-primary/40 bg-primary/20 px-2 py-1.5 text-[11px] text-cyan hover:bg-primary/30 transition-colors"
                  title="Edit custom duration range"
                >
                  Edit Duration
                </button>
              )}
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
                        <th className="py-2.5 px-2 text-center w-24 font-medium">Size</th>
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
                            <td className="py-2.5 px-2 text-center tabular-nums text-text-2 font-medium">
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
          <div className="relative flex-1 rounded-2xl border border-white/[0.08] bg-[#0c1424] backdrop-blur-md p-4 flex flex-col justify-between overflow-hidden shadow-md">
            {/* Chat View Header Toolbar */}
            <div className="flex items-center justify-between gap-3 pb-3 border-b border-white/[0.08] mb-3 flex-wrap bg-[#0c1424]/90 z-20 pr-40">
              <div className="flex items-center gap-3 min-w-0">
                <Avatar src={activeChat?.photo} name={activeChat?.title || 'Chat'} size={36} />
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-[14px] font-bold text-text truncate leading-tight tracking-wide">
                      {activeChat?.title || 'Messages'}
                    </span>
                    {activeChat && (
                      <div className="relative shrink-0">
                        <button
                          onClick={() => setChannelMenuOpen(!channelMenuOpen)}
                          className="flex size-7 items-center justify-center rounded-lg border border-border bg-tile text-muted hover:text-white hover:border-primary transition-colors"
                          title="Channel Actions"
                        >
                          <MoreVertical size={14} />
                        </button>
                        {channelMenuOpen && (
                          <div
                            className="absolute left-0 top-full mt-1.5 z-50 w-48 rounded-xl border border-border bg-[#182533] p-1.5 shadow-2xl backdrop-blur-xl space-y-0.5"
                            onClick={() => setChannelMenuOpen(false)}
                          >
                            {activeChat.username && (
                              <button
                                onClick={() => copyChatLink(activeChat.username)}
                                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[12px] text-text hover:bg-white/10 transition-colors"
                              >
                                <Copy size={13} className="text-muted" />
                                <span>Copy Link</span>
                              </button>
                            )}
                            <button
                              onClick={() => clearChatHistory(activeChat.id, activeChat.title)}
                              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[12px] text-text hover:bg-white/10 transition-colors"
                            >
                              <RotateCcw size={13} className="text-muted" />
                              <span>Clear Chat History</span>
                            </button>
                            <button
                              onClick={() => confirmLeaveChat(activeChat.id, activeChat.title)}
                              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[12px] text-danger hover:bg-danger/15 transition-colors"
                            >
                              <Trash2 size={13} />
                              <span>Leave / Delete Channel</span>
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="text-[11.5px] text-muted truncate leading-tight mt-0.5">
                    {activeChat?.username ? `@${activeChat.username}` : activeChat?.kind || 'Channel'} • {filteredMessages.length} messages
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-52">
                  <SearchInput
                    placeholder="Search in chat…"
                    value={chatMsgSearch}
                    onChange={setChatMsgSearch}
                  />
                </div>
                <button
                  type="button"
                  onClick={() => setMediaOnlyChat(!mediaOnlyChat)}
                  className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-medium border transition-colors ${
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
            <div
              ref={chatScrollRef}
              onScroll={(e) => {
                const target = e.currentTarget
                const isNearBottom = target.scrollHeight - target.scrollTop - target.clientHeight < 120
                setShowScrollBottom(!isNearBottom)
              }}
              className="flex-1 overflow-y-auto space-y-3.5 pr-2"
            >
              {msgErr ? (
                <ErrorState error={msgErr} onRetry={msgReload} />
              ) : !msgData ? (
                <div className="space-y-4 p-4">
                  {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-20 w-3/4 rounded-2xl" />)}
                </div>
              ) : filteredMessages.length === 0 ? (
                <div className="py-20 text-center text-muted">
                  <p>No messages found matching criteria</p>
                </div>
              ) : (
                <div className="space-y-3 pb-2">
                  {/* Load older messages at the TOP */}
                  {msgData.more && (
                    <div className="flex justify-center py-2">
                      <Button
                        variant="secondary"
                        onClick={handleLoadOlder}
                        className="text-[12px] rounded-full px-4 py-1.5 shadow-sm border border-white/10 bg-white/5 hover:bg-white/10"
                      >
                        Load older messages
                      </Button>
                    </div>
                  )}

                  {/* Chronological order: oldest to newest */}
                  {[...filteredMessages].reverse().map((m: any, idx: number, arr: any[]) => {
                    const currentDateGroup = getDateGroup(m.date)
                    const prevDateGroup = idx > 0 ? getDateGroup(arr[idx - 1].date) : null
                    const showDateDivider = currentDateGroup !== prevDateGroup

                    return (
                      <React.Fragment key={m.id}>
                        {showDateDivider && (
                          <div className="flex justify-center my-4 select-none">
                            <span className="rounded-full bg-[#182533] px-3.5 py-1 text-[11px] font-semibold text-slate-300 shadow border border-white/10">
                              {currentDateGroup}
                            </span>
                          </div>
                        )}

                        <div className={`flex flex-col items-start ${m.media ? 'max-w-[480px] w-full' : 'max-w-[85%] w-fit'} group/msg`}>
                          <div className="relative rounded-2xl rounded-tl-sm border border-white/[0.08] bg-[#182533] p-3 shadow-md hover:border-white/20 transition-all text-text w-full">
                            {/* Sender line */}
                            <div className="flex items-center justify-between text-[11.5px] mb-1">
                              <span className="font-semibold text-cyan tracking-wide">
                                {m.sender || activeChat?.title || 'Unknown'}
                              </span>
                              <button
                                onClick={() => copyText(m.text || m.media?.name || '')}
                                className="opacity-0 group-hover/msg:opacity-100 transition-opacity p-1 text-muted hover:text-white rounded"
                                title="Copy text"
                              >
                                <Copy size={13} />
                              </button>
                            </div>

                            {/* Media card */}
                            {m.media && (
                              <div className="rounded-xl overflow-hidden border border-white/[0.08] bg-[#0c1322] my-1.5 shadow-inner">
                                {m.media.type === 'video' || m.media.type === 'photo' || m.media.type === 'animation' ? (
                                  <div
                                    className="relative w-full max-h-[380px] overflow-hidden bg-black/60 cursor-pointer group/media flex items-center justify-center"
                                    onClick={() => setPreviewItem({ name: m.media.name, path: m.media.path, thumb: m.media.thumb, type: m.media.type, size: m.media.size, duration: m.media.duration, messageId: m.id })}
                                  >
                                    {m.media.thumb ? (
                                      <img
                                        src={`teleflow://thumb/${m.media.thumb}`}
                                        alt={m.media.name}
                                        className="w-full max-h-[380px] object-cover transition-transform duration-200 group-hover/media:scale-[1.01]"
                                        loading="eager"
                                      />
                                    ) : (
                                      <div className="flex h-52 w-full items-center justify-center bg-slate-900/80 text-muted">
                                        <Film size={36} />
                                      </div>
                                    )}

                                    {(m.media.type === 'video' || m.media.type === 'animation') && (
                                      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                                        <div className="size-13 rounded-full bg-black/60 backdrop-blur-md text-white flex items-center justify-center group-hover/media:scale-110 group-hover/media:bg-primary transition-all shadow-2xl border border-white/20">
                                          <Play size={22} className="ml-1 fill-white text-white" />
                                        </div>
                                      </div>
                                    )}

                                    <div className="absolute bottom-2 left-2 flex items-center gap-1.5 pointer-events-none">
                                      <span className="rounded-md bg-black/75 backdrop-blur-md px-2 py-0.5 text-[11px] font-semibold text-white tabular-nums border border-white/10 shadow">
                                        {fmtBytes(m.media.size)}
                                      </span>
                                      {m.media.duration ? (
                                        <span className="rounded-md bg-black/75 backdrop-blur-md px-2 py-0.5 text-[11px] font-semibold text-white tabular-nums border border-white/10 shadow">
                                          {fmtDuration(m.media.duration)}
                                        </span>
                                      ) : null}
                                    </div>
                                  </div>
                                ) : (
                                  <div className="flex items-center gap-3 p-3">
                                    <div className="grid size-11 place-items-center rounded-xl bg-primary/20 text-primary shrink-0">
                                      <FileText size={20} />
                                    </div>
                                    <div className="min-w-0 flex-1">
                                      <div className="text-[13px] font-medium text-white truncate" title={m.media.name}>{m.media.name}</div>
                                      <div className="text-[11.5px] text-muted mt-0.5 tabular-nums">{fmtBytes(m.media.size)}</div>
                                    </div>
                                  </div>
                                )}

                                {/* Action footer inside media */}
                                <div className="flex items-center justify-between p-2.5 bg-black/25 border-t border-white/[0.05]">
                                  <span className="text-[12px] font-medium text-text-2 truncate max-w-[280px]" title={m.media.name}>
                                    {m.media.name}
                                  </span>
                                  <div className="flex items-center gap-2 shrink-0">
                                    {m.media.status === 'downloaded' ? (
                                      <>
                                        {m.media.path && (
                                          <button
                                            onClick={() => revealFile(m.media.path)}
                                            className="inline-flex items-center gap-1 text-[11.5px] text-cyan hover:text-cyan/80 bg-cyan/10 hover:bg-cyan/20 px-2.5 py-1 rounded-md transition-colors"
                                            title="Show in folder"
                                          >
                                            <FolderOpen size={13} />
                                            <span>Folder</span>
                                          </button>
                                        )}
                                        <button
                                          onClick={() => downloadItems([{ chatId: activeChatId!, messageId: m.id }], true)}
                                          className="inline-flex items-center gap-1 text-[11.5px] text-muted hover:text-white bg-white/5 hover:bg-white/10 px-2 py-1 rounded-md transition-colors"
                                          title="Download again"
                                        >
                                          <RotateCcw size={13} />
                                        </button>
                                      </>
                                    ) : (
                                      <Button
                                        variant="primary"
                                        onClick={() => downloadItems([{ chatId: activeChatId!, messageId: m.id }], true)}
                                        className="text-[11.5px] py-1 px-3 flex items-center gap-1 font-medium shadow-sm"
                                      >
                                        <Download size={13} /> Download
                                      </Button>
                                    )}
                                  </div>
                                </div>
                              </div>
                            )}

                            {/* Message text / caption */}
                            {m.text && (
                              <div className="mt-1 text-[13.5px] leading-relaxed">
                                <LinkifiedText text={m.text} onOpenLink={handleTelegramLink} />
                              </div>
                            )}

                            {/* Message footer timestamp + double checkmark */}
                            <div className="flex items-center justify-end gap-1 mt-1 text-[10.5px] text-muted/70 tabular-nums">
                              <span>{getMessageTime(m.date)}</span>
                              <span className="text-cyan font-bold text-[11px] leading-none">✓✓</span>
                            </div>
                          </div>
                        </div>
                      </React.Fragment>
                    )
                  })}
                  <div ref={messagesEndRef} />
                </div>
              )}
            </div>

            {/* Floating scroll to bottom button */}
            {showScrollBottom && (
              <button
                onClick={() => scrollToBottom('smooth')}
                className="absolute bottom-16 right-6 z-20 flex size-9 items-center justify-center rounded-full bg-primary text-white shadow-xl hover:bg-primary-hover transition-all"
                title="Scroll to latest"
              >
                <ChevronDown size={18} />
              </button>
            )}

            {/* Chat message typing/input bar */}
            {activeChat && (
              <div className="mt-3 pt-3 border-t border-white/[0.08] flex items-center gap-2">
                <input
                  type="text"
                  placeholder={activeChat.canPost !== false ? `Write a message in ${activeChat.title}…` : 'Posting not permitted in this channel'}
                  disabled={activeChat.canPost === false || sendingMsg}
                  value={newMsgText}
                  onChange={(e) => setNewMsgText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault()
                      handleSendChatMessage()
                    }
                  }}
                  className="flex-1 rounded-xl border border-white/10 bg-[#111b2b] px-4 py-2.5 text-[13px] text-text placeholder:text-muted focus:border-primary outline-none transition-colors"
                />
                <button
                  type="button"
                  onClick={handleSendChatMessage}
                  disabled={!newMsgText.trim() || sendingMsg || activeChat.canPost === false}
                  className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary text-white shadow-glow hover:bg-primary-hover disabled:opacity-40 disabled:cursor-not-allowed transition-all"
                  title="Send message"
                >
                  <Send size={16} />
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
