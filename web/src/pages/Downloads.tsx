import React, { useState, useRef, useEffect, useLayoutEffect, useMemo, useCallback } from 'react'
import { Plus, RotateCcw, Download, Folder, CheckSquare, Square, FolderOpen, Send, ExternalLink, Copy, Filter, FileText, MessageSquare, ChevronDown, Play, Pause, Music, SlidersHorizontal, ArrowDown, Trash2, Film, LogOut, MoreVertical } from 'lucide-react'
import { call, useCall, useLive, useTyping, navigate } from '../api.ts'
import { Panel, SearchInput, Chip, Select, Button, Avatar, Pill, Thumb, TypeChip, Pagination, Empty, Skeleton, ErrorState, OpenChatDialog, MediaPreviewModal, Dialog, fmtBytes, fmtAgo, fmtDate, fmtDuration, toast, triggerFlyToQueue, confirm, CheckDuplicatesModal, MediagramLogo, TelegramInviteModal, type DuplicateCheckResult } from '../ui.tsx'
import { ChatView } from './ChatView.tsx'

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
              {isTg ? <MediagramLogo size={13} className="inline shrink-0 mr-0.5 rounded-[3px]" /> : <ExternalLink size={11} className="inline shrink-0 opacity-75" />}
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

function TelegramAudioPlayer({
  media,
  chatId,
  messageId,
  onDownload,
  onOpenViewer,
}: {
  media: any
  chatId: number
  messageId: number
  onDownload: () => void
  onOpenViewer: () => void
}) {
  const [playing, setPlaying] = useState(false)
  const [loading, setLoading] = useState(false)
  const [audioUrl, setAudioUrl] = useState<string | null>(media.path ? `teleflow://file/${encodeURIComponent(media.path)}` : null)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(media.duration || 0)
  const audioRef = useRef<HTMLAudioElement | null>(null)

  const handlePlayToggle = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!audioUrl) {
      setLoading(true)
      try {
        const res = await call<{ completed: boolean, path: string | null }>('media.prepare', { chatId, messageId })
        if (res.completed && res.path) {
          const url = `teleflow://file/${encodeURIComponent(res.path)}`
          setAudioUrl(url)
          setLoading(false)
          setTimeout(() => {
            if (audioRef.current) {
              audioRef.current.play()
              setPlaying(true)
            }
          }, 50)
          return
        }
      } catch {}
      setLoading(false)
      onOpenViewer()
      return
    }

    if (audioRef.current) {
      if (playing) {
        audioRef.current.pause()
        setPlaying(false)
      } else {
        audioRef.current.play()
        setPlaying(true)
      }
    }
  }

  return (
    <div className="flex items-center gap-3 p-3 rounded-2xl bg-tile my-1 w-full max-w-[380px] border border-border shadow-sm select-none" onClick={(e) => e.stopPropagation()}>
      {audioUrl && (
        <audio
          ref={audioRef}
          src={audioUrl}
          onTimeUpdate={() => audioRef.current && setCurrentTime(audioRef.current.currentTime)}
          onLoadedMetadata={() => audioRef.current && setDuration(audioRef.current.duration || media.duration || 0)}
          onEnded={() => setPlaying(false)}
        />
      )}

      {/* Telegram Play/Pause circular button */}
      <button
        type="button"
        onClick={handlePlayToggle}
        className="size-11 rounded-full bg-primary hover:bg-primary-hover text-white flex items-center justify-center shrink-0 shadow-md transition-transform hover:scale-105 active:scale-95"
        title={playing ? 'Pause' : 'Play audio'}
      >
        {loading ? (
          <div className="size-5 rounded-full border-2 border-white/30 border-t-white animate-spin" />
        ) : playing ? (
          <Pause size={18} className="fill-white" />
        ) : (
          <Play size={18} className="ml-0.5 fill-white" />
        )}
      </button>

      {/* Info & scrubber */}
      <div className="min-w-0 flex-1 flex flex-col justify-center">
        <div className="text-[13px] font-semibold text-text truncate cursor-pointer hover:text-primary transition-colors" onClick={onOpenViewer} title={media.name}>
          {media.name}
        </div>
        <div className="mt-1 flex items-center gap-2">
          <input
            type="range"
            min="0"
            max={duration || 100}
            value={currentTime}
            onChange={(e) => {
              const val = Number(e.target.value)
              setCurrentTime(val)
              if (audioRef.current) audioRef.current.currentTime = val
            }}
            className="w-full h-1 bg-border rounded-lg appearance-none cursor-pointer accent-primary"
          />
        </div>
        <div className="flex items-center justify-between text-[10.5px] text-muted mt-0.5 tabular-nums">
          <span>{fmtDuration(Math.round(currentTime))}</span>
          <span>{duration ? fmtDuration(Math.round(duration)) : fmtBytes(media.size)}</span>
        </div>
      </div>

      {/* Action: Download / Open */}
      <div className="shrink-0 flex items-center">
        <button
          type="button"
          onClick={onDownload}
          className="size-8 rounded-full hover:bg-tile text-muted hover:text-text flex items-center justify-center transition-colors"
          title={media.status === 'downloaded' ? 'Show in folder' : 'Download audio'}
        >
          {media.status === 'downloaded' ? <FolderOpen size={15} className="text-primary" /> : <Download size={15} />}
        </button>
      </div>
    </div>
  )
}

interface ChatFilterState {
  mediaType: string
  sizeFilter: string
  appliedCustomSize: { minBytes: number, maxBytes: number, label: string } | null
  duration: string
  appliedCustomDuration: { minSec: number, maxSec: number, label: string } | null
  fileSearch: string
  fileExt: string
  page: number
  mediaOnlyChat: boolean
  chatMsgSearch: string
}

const CHAT_FILTERS_STORAGE_KEY = 'mediagram_chat_filters'

const defaultChatFilter: ChatFilterState = {
  mediaType: 'all',
  sizeFilter: 'all',
  appliedCustomSize: null,
  duration: 'all',
  appliedCustomDuration: null,
  fileSearch: '',
  fileExt: 'all',
  page: 1,
  mediaOnlyChat: false,
  chatMsgSearch: '',
}

function loadInitialChatFilters(): Record<number, Partial<ChatFilterState>> {
  try {
    const raw = localStorage.getItem(CHAT_FILTERS_STORAGE_KEY)
    if (raw) return JSON.parse(raw)
  } catch {}
  return {}
}

const CHAT_VIEW_MODES_KEY = 'mediagram_chat_view_modes'

function loadInitialChatViewModes(): Record<number, 'files' | 'chat'> {
  try {
    const raw = localStorage.getItem(CHAT_VIEW_MODES_KEY)
    if (raw) return JSON.parse(raw)
  } catch {}
  return {}
}

export default function Downloads() {
  const [openChat, setOpenChat] = useState(false)
  const [previewItem, setPreviewItem] = useState<any>(null)
  const [chatViewModes, setChatViewModes] = useState<Record<number, 'files' | 'chat'>>(loadInitialChatViewModes)
  const [chatId, setChatId] = useState<number | null>(() => {
    try {
      const saved = localStorage.getItem('mediagram_active_chat_id')
      return saved ? Number(saved) : null
    } catch {
      return null
    }
  })
  const [view, setView] = useState<'files' | 'chat'>(() => {
    try {
      const savedChatId = localStorage.getItem('mediagram_active_chat_id')
      if (savedChatId) {
        const modes = loadInitialChatViewModes()
        if (modes[Number(savedChatId)]) return modes[Number(savedChatId)]!
      }
      const saved = localStorage.getItem('mediagram_downloads_view')
      return (saved === 'chat' || saved === 'files') ? (saved as 'files' | 'chat') : 'files'
    } catch {
      return 'files'
    }
  })

  useEffect(() => {
    try {
      if (chatId != null) {
        localStorage.setItem('mediagram_active_chat_id', String(chatId))
      }
    } catch {}
  }, [chatId])

  useEffect(() => {
    try {
      localStorage.setItem('mediagram_downloads_view', view)
    } catch {}
  }, [view])

  const [chatSearch, setChatSearch] = useState('')
  const [chatKind, setChatKind] = useState<'all' | 'channels' | 'groups' | 'folders'>('all')
  const [selectedFolderId, setSelectedFolderId] = useState<number | null>(null)

  // Files view filters & pagination
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [sortBy, setSortBy] = useState<string>('newest')
  const [selectedIds, setSelectedIds] = useState<number[]>([])

  // Custom filter modal state
  const [customSizeModalOpen, setCustomSizeModalOpen] = useState(false)
  const [customSizeMin, setCustomSizeMin] = useState('')
  const [customSizeMinUnit, setCustomSizeMinUnit] = useState<'KB' | 'MB' | 'GB'>('MB')
  const [customSizeMax, setCustomSizeMax] = useState('')
  const [customSizeMaxUnit, setCustomSizeMaxUnit] = useState<'KB' | 'MB' | 'GB'>('MB')

  const [customDurationModalOpen, setCustomDurationModalOpen] = useState(false)
  const [customDurationMin, setCustomDurationMin] = useState('')
  const [customDurationMinUnit, setCustomDurationMinUnit] = useState<'sec' | 'min' | 'hr'>('min')
  const [customDurationMax, setCustomDurationMax] = useState('')
  const [customDurationMaxUnit, setCustomDurationMaxUnit] = useState<'sec' | 'min' | 'hr'>('min')

  // Chat view state
  const [msgLimit, setMsgLimit] = useState(30)
  const chatScrollRef = useRef<HTMLDivElement>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const [showScrollBottom, setShowScrollBottom] = useState(false)

  // Dedupe check modal state
  const [dedupeModalOpen, setDedupeModalOpen] = useState(false)
  const [dedupeLoading, setDedupeLoading] = useState(false)
  const [dedupeSelectedCount, setDedupeSelectedCount] = useState(0)
  const [dedupeResult, setDedupeResult] = useState<DuplicateCheckResult | null>(null)
  const [customScanPath, setCustomScanPath] = useState<string | null>(null)
  const lastDedupeTargetRef = useRef<
    | { type: 'items', items: { chatId: number, messageId: number }[] }
    | { type: 'matching' }
    | { type: 'folder' }
    | null
  >(null)

  // Telegram Invite / Join Request Modal
  const [inviteModalOpen, setInviteModalOpen] = useState(false)
  const [inviteData, setInviteData] = useState<{
    title: string
    members?: number
    photo?: string | null
    about?: string
    createsJoinRequest?: boolean
    isPublic?: boolean
    link: string
  } | null>(null)
  const [inviteLoading, setInviteLoading] = useState(false)
  const [inviteRequestSent, setInviteRequestSent] = useState(false)

  // Data fetching
  const { data: authData } = useCall<any>('auth.get', undefined, ['auth'])
  const me = authData?.me

  const { data: chatsData, error: chatsErr, reload: chatsReload } = useCall<{ chats: any[], folders: any[] }>('chats.list', {}, ['chats'])

  // chats.list already arrives in Telegram's own order (main-list position: pinned first, then most recent),
  // so the sidebar keeps it: re-sorting by date would sink pinned chats and the chats TDLib has no last message for.
  const allChats = chatsData?.chats ?? []
  const allFolders = chatsData?.folders ?? []

  // Resolve current chat
  const activeChatId = chatId ?? (allChats[0]?.id ?? null)
  const activeChat = allChats.find((c) => c.id === activeChatId)
  const typingMap = useTyping()
  const activeTyping = activeChatId ? typingMap[activeChatId] : null

  // Restore persisted view mode for activeChatId if not explicitly set yet
  const initialModeSyncedRef = useRef(false)
  useEffect(() => {
    if (activeChatId && !initialModeSyncedRef.current) {
      initialModeSyncedRef.current = true
      const mode = chatViewModes[activeChatId]
      if (mode) setView(mode)
    }
  }, [activeChatId, chatViewModes])

  // Persistent chat filters map
  const [chatFilters, setChatFilters] = useState<Record<number, Partial<ChatFilterState>>>(loadInitialChatFilters)

  // Current active chat filters
  const currentFilter = useMemo<ChatFilterState>(() => {
    if (!activeChatId) return defaultChatFilter
    return { ...defaultChatFilter, ...(chatFilters[activeChatId] || {}) }
  }, [activeChatId, chatFilters])

  const updateActiveChatFilter = useCallback((patch: Partial<ChatFilterState>) => {
    if (!activeChatId) return
    setChatFilters((prev) => {
      const nextChat = { ...(prev[activeChatId] || {}), ...patch }
      const nextMap = { ...prev, [activeChatId]: nextChat }
      try {
        localStorage.setItem(CHAT_FILTERS_STORAGE_KEY, JSON.stringify(nextMap))
      } catch {}
      return nextMap
    })
  }, [activeChatId])

  const handleSetView = useCallback((newView: 'files' | 'chat') => {
    setView(newView)
    if (activeChatId) {
      setChatViewModes((prev) => {
        const next = { ...prev, [activeChatId]: newView }
        try {
          localStorage.setItem(CHAT_VIEW_MODES_KEY, JSON.stringify(next))
        } catch {}
        return next
      })
    }
    try {
      localStorage.setItem('mediagram_downloads_view', newView)
    } catch {}
  }, [activeChatId])

  // Getters for current filters
  const mediaType = currentFilter.mediaType
  const sizeFilter = currentFilter.sizeFilter
  const appliedCustomSize = currentFilter.appliedCustomSize
  const duration = currentFilter.duration
  const appliedCustomDuration = currentFilter.appliedCustomDuration
  const fileSearch = currentFilter.fileSearch
  const fileExt = currentFilter.fileExt
  const page = currentFilter.page
  const mediaOnlyChat = currentFilter.mediaOnlyChat
  const chatMsgSearch = currentFilter.chatMsgSearch

  // Setters that update persistent filter for active chat
  const setMediaType = (v: string) => updateActiveChatFilter({ mediaType: v, page: 1 })
  const setSizeFilter = (v: string) => updateActiveChatFilter({ sizeFilter: v, appliedCustomSize: v === 'custom' ? appliedCustomSize : null, page: 1 })
  const setAppliedCustomSize = (v: any) => updateActiveChatFilter({ appliedCustomSize: v })
  const setDuration = (v: string) => updateActiveChatFilter({ duration: v, appliedCustomDuration: v === 'custom' ? appliedCustomDuration : null, page: 1 })
  const setAppliedCustomDuration = (v: any) => updateActiveChatFilter({ appliedCustomDuration: v })
  const setFileSearch = (v: string) => updateActiveChatFilter({ fileSearch: v, page: 1 })
  const setFileExt = (v: string) => updateActiveChatFilter({ fileExt: v, page: 1 })
  const setPage = (p: number | ((prev: number) => number)) => updateActiveChatFilter({ page: typeof p === 'function' ? p(page) : p })
  const setMediaOnlyChat = (v: boolean | ((prev: boolean) => boolean)) => updateActiveChatFilter({ mediaOnlyChat: typeof v === 'function' ? v(mediaOnlyChat) : v })
  const setChatMsgSearch = (v: string) => updateActiveChatFilter({ chatMsgSearch: v })

  // Filter chats by kind/search; the order stays Telegram's - newest activity (and pinned chats) at the top
  const filteredChats = allChats
    .filter((c) => {
      if (chatSearch && !c.title.toLowerCase().includes(chatSearch.toLowerCase()) && !(c.username && c.username.toLowerCase().includes(chatSearch.toLowerCase()))) {
        return false
      }
      if (chatKind === 'channels') return c.kind === 'channel'
      if (chatKind === 'groups') return c.kind === 'group' || c.kind === 'supergroup'
      if (chatKind === 'folders') {
        const targetFolder = selectedFolderId ?? allFolders[0]?.id
        if (targetFolder !== undefined && targetFolder !== null) {
          return Array.isArray(c.folders) && c.folders.includes(targetFolder)
        }
        return Array.isArray(c.folders) && c.folders.length > 0
      }
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
  // downloads.checkDuplicates takes the same filters as chats.media, minus the fields that call carries itself.
  const { chatId: _chatId, page: _page, pageSize: _pageSize, ...dupFilters } = mediaFilters

  const { data: mediaData, error: mediaErr, reload: mediaReload } = useCall<{ items: any[], total: number, exts: string[], scan: { state: 'scanning' | 'failed' | 'paused' | 'done' | 'idle', indexed: number, total: number | null, error?: string } }>(
    'chats.media', activeChatId ? mediaFilters : null, activeChatId ? [`media:${activeChatId}`] : []
  )

  const { data: msgData, error: msgErr, reload: msgReload } = useCall<{ messages: any[], more: boolean }>(
    'chats.messages', activeChatId && view === 'chat' ? { chatId: activeChatId, limit: msgLimit } : null, activeChatId ? [`messages:${activeChatId}`] : []
  )

  const mediaItems = mediaData?.items ?? (mediaData as any)?.media ?? []
  const availableExts = mediaData?.exts ?? []
  const scan = mediaData?.scan

  // The scan reports `indexed` at most once a second, and it can go quiet for a while (a flood wait, or a page that
  // held no media). The ETA is therefore a ticker of its own: one sample a second into a 20 s window, the rate is the
  // slope across that window, and the seconds are counted down from the wall clock rather than waiting for the next
  // report - so a break makes the ETA grow instead of freezing on a time that is no longer true.
  const scanRef = useRef(scan)
  scanRef.current = scan
  const scanWindow = useRef<{ t: number, n: number }[]>([])
  const [scanEta, setScanEta] = useState<number | null>(null)
  useEffect(() => {
    const idle = () => { scanWindow.current = []; setScanEta(null) }
    if (scan?.state !== 'scanning') { idle(); return }
    const tick = () => {
      const now = Date.now(), live = scanRef.current
      if (live?.state !== 'scanning') { idle(); return }
      const w = scanWindow.current
      w.push({ t: now, n: live.indexed })
      while (w.length > 2 && now - w[0]!.t > 20_000) w.shift()
      const first = w[0]!, span = (now - first.t) / 1000
      const rate = w.length > 2 && span >= 4 ? (live.indexed - first.n) / span : 0
      const left = live.total ? Math.max(0, live.total - live.indexed) : 0
      setScanEta(rate > 0 && left > 0 ? left / rate : null)
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [scan?.state])
  const fmtLeft = (s: number) =>
    s < 60 ? `${Math.max(1, Math.round(s))}s` : s < 3600 ? `${Math.round(s / 60)}m` : `${Math.floor(s / 3600)}h ${Math.round((s % 3600) / 60)}m`
  const scanPct = scan?.total ? Math.min(100, Math.round((scan.indexed / scan.total) * 100)) : 0
  const rescan = async (method: 'chats.stopScan' | 'chats.rescan') => {
    if (!activeChatId) return
    try { await call(method, { chatId: activeChatId }) } catch (e) { toast((e as Error).message); return }
    mediaReload()
  }
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
    if (activeChatId) {
      updateActiveChatFilter({
        mediaType: 'all',
        sizeFilter: 'all',
        appliedCustomSize: null,
        duration: 'all',
        appliedCustomDuration: null,
        fileSearch: '',
        fileExt: 'all',
        page: 1,
        mediaOnlyChat: false,
        chatMsgSearch: '',
      })
    }
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
    updateActiveChatFilter({
      appliedCustomSize: { minBytes, maxBytes, label },
      sizeFilter: 'custom',
      page: 1,
    })
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
    updateActiveChatFilter({
      appliedCustomDuration: { minSec, maxSec, label },
      duration: 'custom',
      page: 1,
    })
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
    setChannelMenuOpen(false)
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

  async function runDuplicateCheck(
    target: { type: 'items', items: { chatId: number, messageId: number }[] } | { type: 'matching' } | { type: 'folder' } | null,
    scanPath: string | null
  ) {
    if (!target) return
    setDedupeLoading(true)
    try {
      if (target.type === 'items') {
        const res = await call<DuplicateCheckResult>('downloads.checkDuplicates', {
          items: target.items,
          ...(scanPath ? { customPath: scanPath } : {}),
        })
        setDedupeResult(res)
      } else if (target.type === 'matching') {
        if (!activeChatId) return
        const res = await call<DuplicateCheckResult>('downloads.checkDuplicates', {
          chatId: activeChatId,
          filters: dupFilters,
          ...(scanPath ? { customPath: scanPath } : {}),
        })
        setDedupeResult(res)
      } else if (target.type === 'folder') {
        if (!filteredChats.length) return
        const checkResults = await Promise.all(
          filteredChats.map((c) =>
            call<DuplicateCheckResult>('downloads.checkDuplicates', {
              chatId: c.id,
              filters: dupFilters,
              ...(scanPath ? { customPath: scanPath } : {}),
            }).catch(() => null)
          )
        )
        const validResults = checkResults.filter((r): r is DuplicateCheckResult => r !== null)
        if (!validResults.length) {
          setDedupeModalOpen(false)
          toast('No media found in the chats of this folder', 'info')
          return
        }
        const combined: DuplicateCheckResult = {
          scannedPath: scanPath || validResults[0].scannedPath,
          filesScanned: validResults.reduce((acc, r) => acc + r.filesScanned, 0),
          totalSelected: validResults.reduce((acc, r) => acc + r.totalSelected, 0),
          onDiskCount: validResults.reduce((acc, r) => acc + r.onDiskCount, 0),
          willDownloadCount: validResults.reduce((acc, r) => acc + r.willDownloadCount, 0),
          skippedBytes: validResults.reduce((acc, r) => acc + r.skippedBytes, 0),
          duplicates: validResults.flatMap((r) => r.duplicates),
          willDownload: validResults.flatMap((r) => r.willDownload),
        }
        setDedupeResult(combined)
      }
    } catch (err) {
      toast((err as Error).message, 'danger')
    } finally {
      setDedupeLoading(false)
    }
  }

  async function handlePickCustomScanPath() {
    try {
      const res = await call<{ path: string | null }>('app.pickFolder', { title: 'Select custom folder to scan for duplicates' })
      if (res?.path) {
        setCustomScanPath(res.path)
        toast(`Scanning folder: ${res.path}`)
        await runDuplicateCheck(lastDedupeTargetRef.current, res.path)
      }
    } catch (e) {
      toast((e as Error).message, 'danger')
    }
  }

  async function handleResetCustomScanPath() {
    setCustomScanPath(null)
    toast('Reset to default download folder')
    await runDuplicateCheck(lastDedupeTargetRef.current, null)
  }

  async function downloadItems(items: { chatId: number, messageId: number }[], force = false, e?: React.MouseEvent) {
    if (force) {
      try {
        const res = await call<{ added: number, skipped: number }>('downloads.add', { items, force: true })
        toast(`Added ${res.added}${res.skipped > 0 ? `, skipped ${res.skipped}` : ''}`)
        setSelectedIds([])
        if (res.added > 0) {
          triggerFlyToQueue(e)
        }
      } catch (err) {
        toast((err as Error).message, 'danger')
      }
      return
    }

    lastDedupeTargetRef.current = { type: 'items', items }
    setDedupeSelectedCount(items.length)
    setDedupeLoading(true)
    setDedupeModalOpen(true)
    setDedupeResult(null)
    try {
      const res = await call<DuplicateCheckResult>('downloads.checkDuplicates', {
        items,
        ...(customScanPath ? { customPath: customScanPath } : {}),
      })
      setDedupeResult(res)
      setDedupeLoading(false)
    } catch (err) {
      setDedupeModalOpen(false)
      toast((err as Error).message, 'danger')
    }
  }

  async function handleDedupeContinue(itemsToDownload: { chatId: number, messageId: number }[], force: boolean) {
    setDedupeModalOpen(false)
    setDedupeResult(null)
    if (!itemsToDownload.length) {
      toast('All duplicate files were skipped.', 'info')
      return
    }
    try {
      const res = await call<{ added: number, skipped: number }>('downloads.add', { items: itemsToDownload, force })
      toast(`Added ${res.added}${res.skipped > 0 ? `, skipped ${res.skipped}` : ''}`)
      setSelectedIds([])
      if (res.added > 0) {
        triggerFlyToQueue()
      }
    } catch (err) {
      toast((err as Error).message, 'danger')
    }
  }

  async function downloadAllMatching(e?: React.MouseEvent) {
    if (!activeChatId) return
    lastDedupeTargetRef.current = { type: 'matching' }
    const total = mediaData?.total ?? 0
    setDedupeSelectedCount(total)
    setDedupeLoading(true)
    setDedupeModalOpen(true)
    setDedupeResult(null)
    try {
      const res = await call<DuplicateCheckResult>('downloads.checkDuplicates', {
        chatId: activeChatId,
        filters: dupFilters,
        ...(customScanPath ? { customPath: customScanPath } : {}),
      })
      setDedupeResult(res)
      setDedupeLoading(false)
    } catch (err) {
      setDedupeModalOpen(false)
      toast((err as Error).message, 'danger')
    }
  }

  async function downloadAllFolderMedia() {
    if (!filteredChats.length) return
    lastDedupeTargetRef.current = { type: 'folder' }
    setDedupeSelectedCount(filteredChats.length * 30)
    setDedupeLoading(true)
    setDedupeModalOpen(true)
    setDedupeResult(null)
    try {
      const checkResults = await Promise.all(
        filteredChats.map((c) =>
          call<DuplicateCheckResult>('downloads.checkDuplicates', {
            chatId: c.id,
            filters: dupFilters,
            ...(customScanPath ? { customPath: customScanPath } : {}),
          }).catch(() => null)
        )
      )
      const validResults = checkResults.filter((r): r is DuplicateCheckResult => r !== null)
      if (!validResults.length) {
        setDedupeModalOpen(false)
        toast('No media found in the chats of this folder', 'info')
        return
      }
      const combined: DuplicateCheckResult = {
        scannedPath: customScanPath || validResults[0].scannedPath,
        filesScanned: validResults.reduce((acc, r) => acc + r.filesScanned, 0),
        totalSelected: validResults.reduce((acc, r) => acc + r.totalSelected, 0),
        onDiskCount: validResults.reduce((acc, r) => acc + r.onDiskCount, 0),
        willDownloadCount: validResults.reduce((acc, r) => acc + r.willDownloadCount, 0),
        skippedBytes: validResults.reduce((acc, r) => acc + r.skippedBytes, 0),
        duplicates: validResults.flatMap((r) => r.duplicates),
        willDownload: validResults.flatMap((r) => r.willDownload),
      }
      setDedupeResult(combined)
      setDedupeLoading(false)
    } catch (err) {
      setDedupeModalOpen(false)
      toast((err as Error).message, 'danger')
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
    const cleanLink = link.trim().replace(/[.,!?;:)\]]+$/, '')
    const isTg = /^(?:https?:\/\/)?(?:www\.)?(?:t\.me|telegram\.me|telegram\.dog)\/|^tg:\/\//i.test(cleanLink) || /^@\w{4,32}$/.test(cleanLink)
    try {
      const res = await call<any>('chats.open', { link: cleanLink, join: false })
      if (res.chat?.id) {
        setChatId(res.chat.id)
        chatsReload()
        toast(`Opened ${res.chat.title || 'chat'}`)
      } else if (res.invite) {
        setInviteData({
          title: res.invite.title || 'Channel',
          members: res.invite.members,
          photo: res.invite.photo,
          about: res.invite.about,
          createsJoinRequest: res.invite.createsJoinRequest,
          isPublic: res.invite.isPublic,
          link: cleanLink,
        })
        setInviteRequestSent(false)
        setInviteModalOpen(true)
      } else if (!isTg) {
        window.open(cleanLink.startsWith('http') ? cleanLink : `https://${cleanLink}`, '_blank')
      }
    } catch (err: any) {
      if (err?.status === 409 || err?.message?.includes('request to join was sent')) {
        setInviteData({
          title: 'Telegram Channel',
          link: cleanLink,
          createsJoinRequest: true,
        })
        setInviteRequestSent(true)
        setInviteModalOpen(true)
      } else if (isTg) {
        toast(err?.message || 'Could not open Telegram channel, bot, or group', 'danger')
      } else {
        window.open(cleanLink.startsWith('http') ? cleanLink : `https://${cleanLink}`, '_blank')
      }
    }
  }

  async function handleJoinInvite() {
    if (!inviteData) return
    setInviteLoading(true)
    try {
      const joined = await call<any>('chats.open', { link: inviteData.link, join: true })
      if (joined.chat?.id) {
        setChatId(joined.chat.id)
        chatsReload()
        setInviteModalOpen(false)
        toast(`Joined ${joined.chat.title || inviteData.title}`)
      }
    } catch (err: any) {
      if (err?.status === 409 || err?.message?.includes('request to join was sent')) {
        setInviteRequestSent(true)
        toast('Join request sent to channel admins')
      } else {
        toast(err?.message || 'Could not join channel', 'danger')
      }
    } finally {
      setInviteLoading(false)
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
        onDownload={previewItem?.messageId && activeChatId ? () => downloadItems([{ chatId: activeChatId, messageId: previewItem.messageId }]) : undefined}
      />

      <TelegramInviteModal
        open={inviteModalOpen}
        invite={inviteData}
        loading={inviteLoading}
        requestSent={inviteRequestSent}
        onClose={() => {
          setInviteModalOpen(false)
          setInviteData(null)
          setInviteRequestSent(false)
        }}
        onJoin={handleJoinInvite}
      />

      <CheckDuplicatesModal
        open={dedupeModalOpen}
        loading={dedupeLoading}
        selectedCount={dedupeSelectedCount}
        result={dedupeResult}
        customPath={customScanPath}
        onClose={() => { setDedupeModalOpen(false); setDedupeResult(null) }}
        onContinue={handleDedupeContinue}
        onPickCustomPath={handlePickCustomScanPath}
        onResetCustomPath={handleResetCustomScanPath}
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
              <Chip
                label="Folders"
                active={chatKind === 'folders'}
                onClick={() => {
                  setChatKind('folders')
                  if (selectedFolderId === null && allFolders.length > 0) {
                    setSelectedFolderId(allFolders[0].id)
                  }
                }}
              />
            )}
          </div>
        </div>

        {chatKind === 'folders' && allFolders.length > 0 && (
          <div className="p-2 space-y-1 overflow-y-auto max-h-48 border-b border-border bg-panel/30">
            <div className="text-[11px] text-muted px-2 py-1 font-semibold uppercase flex items-center justify-between">
              <span>Telegram Folders</span>
              <span className="text-[10px] lowercase text-text-2">
                {filteredChats.length} {filteredChats.length === 1 ? 'chat' : 'chats'}
              </span>
            </div>
            {allFolders.map((f: any) => {
              const activeFolder = (selectedFolderId ?? allFolders[0]?.id) === f.id
              const countInFolder = allChats.filter((c) => Array.isArray(c.folders) && c.folders.includes(f.id)).length
              return (
                <button
                  key={f.id}
                  onClick={() => setSelectedFolderId(f.id)}
                  className={`flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left text-[12px] transition-colors ${
                    activeFolder ? 'bg-primary/20 text-primary font-semibold border border-primary/30' : 'hover:bg-tile text-text'
                  }`}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <Folder size={14} className={activeFolder ? 'text-primary' : 'text-muted'} />
                    <span className="truncate">{f.title || f.name}</span>
                  </div>
                  <span className={`text-[10.5px] tabular-nums px-1.5 py-0.5 rounded ${activeFolder ? 'bg-primary/25 text-primary' : 'text-muted'}`}>
                    {countInFolder}
                  </span>
                </button>
              )
            })}
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
              <p>{chatKind === 'folders' ? 'No chats in this folder' : 'No chats found'}</p>
              <Button variant="secondary" className="mt-2 text-[11px] py-1 px-3" onClick={() => setOpenChat(true)}>Connect Channel</Button>
            </div>
          ) : (
            filteredChats.map((c: any) => {
              const active = activeChatId === c.id
              return (
                <div
                  key={c.id}
                  onClick={() => {
                    if (c.id !== activeChatId) {
                      const savedMode = chatViewModes[c.id] || 'files'
                      setView(savedMode)
                    }
                    setChatId(c.id)
                    setSelectedIds([])
                    setChannelMenuOpen(false)
                    c.unread = 0
                  }}
                  className={`group relative flex w-full items-center gap-2.5 rounded-lg p-2 text-left transition-colors cursor-pointer ${
                    active ? 'bg-primary/20 border border-primary/30 text-text' : 'hover:bg-tile text-text-2 hover:text-text'
                  }`}
                >
                  <Avatar src={c.photo} name={c.title} size={32} />
                  <div className="min-w-0 flex-1">
                    {/* Line 1 never moves: the time is nowrap, so an unread badge (line 2) cannot squeeze it
                        into a second line or push the title around. */}
                    <div className="flex items-center gap-2">
                      <div className="min-w-0 flex-1 truncate text-[13px] font-medium text-text" title={c.title}>{c.title}</div>
                      {c.lastDate ? (
                        <span className="shrink-0 whitespace-nowrap text-[11px] text-muted" title={fmtDate(c.lastDate)}>
                          {fmtAgo(c.lastDate)}
                        </span>
                      ) : null}
                    </div>
                    <div className="flex items-center justify-between gap-2 text-[11px] text-muted">
                      {typingMap[c.id] ? (
                        <span className="min-w-0 truncate text-cyan font-medium animate-pulse flex items-center gap-1">
                          <span className="size-1.5 rounded-full bg-cyan animate-ping inline-block shrink-0" />
                          <span className="min-w-0 truncate">{typingMap[c.id]}</span>
                        </span>
                      ) : (
                        <span className="min-w-0 truncate" title={c.username ? `@${c.username}` : c.kind}>
                          {c.username ? `@${c.username}` : c.kind}
                        </span>
                      )}
                      {c.unread > 0 && (
                        <span className="shrink-0 rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-bold text-white">
                          {c.unread}
                        </span>
                      )}
                    </div>
                  </div>
                  {active && scan?.state === 'scanning' && (
                    <span
                      className="flex shrink-0 items-center gap-1 rounded-full bg-primary/20 px-1.5 py-0.5 text-[10px] font-semibold text-primary"
                      title="Indexing this chat's media"
                    >
                      <span className="size-1.5 animate-pulse rounded-full bg-primary" /> Indexing
                    </span>
                  )}
                </div>
              )
            })
          )}
        </div>
      </div>

      {/* Column 2: Files View / Chat View (Center flexible) */}
      <div className={`flex flex-1 flex-col ${view === 'chat' ? 'overflow-hidden min-h-0' : 'overflow-y-auto'} p-5 space-y-4`}>
        {/* View switcher bar */}
        <div className="flex items-center gap-2">
          <Button
            variant={view === 'files' ? 'primary' : 'secondary'}
            onClick={() => handleSetView('files')}
            className="flex items-center gap-1.5"
          >
            <FileText size={15} />
            <span>Files View</span>
          </Button>
          <Button
            variant={view === 'chat' ? 'primary' : 'secondary'}
            onClick={() => handleSetView('chat')}
            className="flex items-center gap-1.5"
          >
            <MessageSquare size={15} />
            <span>Chat View</span>
          </Button>
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

        {/* Media index bar: how fast and how much is left while it runs, and why it stopped when it did */}
        {scan && (scan.state === 'scanning' || scan.state === 'failed' || scan.state === 'paused') && (
          <div
            role="status"
            aria-live="polite"
            className={`rounded-lg border p-2.5 text-[12px] text-text ${
              scan.state === 'failed' ? 'border-danger/40 bg-danger/10'
                : scan.state === 'paused' ? 'border-amber-400/40 bg-amber-400/10'
                : 'border-primary/30 bg-primary/10'
            }`}
          >
            <div className="flex items-center justify-between gap-3">
              <span className="min-w-0 truncate">
                {scan.state === 'scanning' && (
                  <>
                    Indexing media… {scan.indexed.toLocaleString()}
                    {scan.total ? ` of about ${scan.total.toLocaleString()}` : ''}
                    {scanEta !== null ? ` · ${fmtLeft(scanEta)} left` : ''}
                  </>
                )}
                {scan.state === 'failed' && <>Indexing stopped: {scan.error || 'Telegram refused the request'}</>}
                {scan.state === 'paused' && (
                  <>Indexing paused at {scan.indexed.toLocaleString()}
                  {scan.total ? ` of about ${scan.total.toLocaleString()}` : ''} files</>
                )}
              </span>
              {scan.state === 'scanning' && (
                <Button variant="secondary" className="py-1 px-2.5 text-[11px] shrink-0" onClick={() => rescan('chats.stopScan')}>Stop</Button>
              )}
              {scan.state !== 'scanning' && (
                <Button
                  variant="primary"
                  className="py-1 px-2.5 text-[11px] shrink-0"
                  onClick={() => rescan('chats.rescan')}
                >
                  {scan.state === 'failed' ? 'Retry' : 'Resume'}
                </Button>
              )}
            </div>
            {scan.state !== 'failed' && (
              <div className="mt-1.5 h-1.5 w-full rounded-full bg-border/60 overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-300 ${scan.total ? 'bg-primary' : 'w-1/2 animate-pulse bg-primary/70'}`}
                  style={scan.total ? { width: `${scanPct}%` } : undefined}
                />
              </div>
            )}
          </div>
        )}

        {/* Main area depending on Files View vs Chat View */}
        {view === 'files' ? (
          <div className="space-y-3 flex-1 flex flex-col">
            {/* Active Channel header in Files View with aligned Search bar */}
            {activeChat && (
              <div className="flex items-center justify-between pb-3 border-b border-border/40 gap-4">
                <div className="flex items-center gap-3 min-w-0 flex-1">
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

                {/* Search files in this channel aligned with chat name */}
                <div className="w-64 shrink-0">
                  <SearchInput
                    placeholder="Search files in this channel…"
                    value={fileSearch}
                    onChange={(v) => { setFileSearch(v); setPage(1) }}
                  />
                </div>

                {/* 3-dot channel menu */}
                <div className="relative">
                  <button
                    onClick={() => setChannelMenuOpen(!channelMenuOpen)}
                    className="flex size-8 items-center justify-center rounded-lg border border-border bg-tile text-muted hover:text-text hover:border-primary transition-colors cursor-pointer"
                    title="Channel Actions"
                  >
                    <MoreVertical size={16} />
                  </button>
                  {channelMenuOpen && (
                    <>
                      <div className="fixed inset-0 z-40" onClick={() => setChannelMenuOpen(false)} />
                      <div
                        className="absolute right-0 top-full mt-1.5 z-50 w-48 rounded-xl border border-border bg-panel p-1.5 shadow-2xl backdrop-blur-xl space-y-0.5"
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
                    </>
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
                    onClick={() => void downloadItems(selectedIds.map((id) => ({ chatId: activeChatId!, messageId: id })), false)}
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
                    <thead className="border-b border-border text-[12px] text-muted">
                      <tr>
                        <th className="py-2.5 px-1 text-center w-10">
                          <button onClick={toggleSelectAll} className="text-muted hover:text-text">
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
                    <tbody className="divide-y divide-border">
                      {mediaItems.map((m: any, i: number) => {
                        const isSelected = selectedIds.includes(m.messageId)
                        return (
                          <tr key={m.messageId} className={`hover:bg-tile/70 transition-colors ${isSelected ? 'bg-primary/10' : ''}`}>
                            <td className="py-2.5 px-1 text-center">
                              <button onClick={() => toggleSelect(m.messageId)} className="text-muted hover:text-text">
                                {isSelected ? <CheckSquare size={15} className="text-primary" /> : <Square size={15} />}
                              </button>
                            </td>
                            <td className="py-2.5 px-1 text-center text-muted text-[11px]">{(page - 1) * 20 + i + 1}</td>
                            <td
                              className="py-2.5 px-2 text-center cursor-pointer hover:opacity-80 transition-opacity"
                              title="Click for preview"
                              onMouseEnter={() => {
                                if ((m.type === 'video' || m.type === 'video_note') && m.messageId && activeChatId) {
                                  call('media.prepare', { chatId: activeChatId, messageId: m.messageId }).catch(() => {})
                                }
                              }}
                              onClick={() => setPreviewItem({ name: m.name, path: m.path, thumb: m.thumb, type: m.type, size: m.size, duration: m.duration, chatId: activeChatId || m.chatId, messageId: m.messageId })}
                            >
                              <div className="flex justify-center">
                                <Thumb src={m.thumb ? `teleflow://thumb/${m.thumb}` : null} name={m.name} />
                              </div>
                            </td>
                            <td className="py-2.5 px-3 min-w-0">
                              <div
                                className="font-medium truncate text-text cursor-pointer hover:text-primary transition-colors text-[13px]"
                                title={m.name}
                                onMouseEnter={() => {
                                  if ((m.type === 'video' || m.type === 'video_note') && m.messageId && activeChatId) {
                                    call('media.prepare', { chatId: activeChatId, messageId: m.messageId }).catch(() => {})
                                  }
                                }}
                                onClick={() => setPreviewItem({ name: m.name, path: m.path, thumb: m.thumb, type: m.type, size: m.size, duration: m.duration, chatId: activeChatId || m.chatId, messageId: m.messageId })}
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
                                    className="rounded p-1.5 text-muted hover:text-primary hover:bg-tile transition-colors"
                                    title="Download again"
                                  >
                                    <RotateCcw size={15} />
                                  </button>
                                </div>
                              ) : (
                                  <button
                                    onClick={(e) => downloadItems([{ chatId: activeChatId!, messageId: m.messageId }], false, e)}
                                    className="rounded p-1.5 text-muted hover:text-primary hover:bg-tile transition-colors"
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
          <ChatView
            chatId={activeChatId!}
            activeChat={activeChat}
            allChats={allChats}
            me={me}
            messages={msgData?.messages ?? []}
            hasMore={Boolean(msgData?.more)}
            loading={!msgData}
            error={msgErr}
            onLoadOlder={handleLoadOlder}
            onReload={msgReload}
            onOpenViewer={setPreviewItem}
            onDownloadItem={(item, force, e) => downloadItems([item], force, e)}
            onRevealFile={revealFile}
            onOpenLink={handleTelegramLink}
            activeTyping={activeTyping}
          />
        )}
      </div>
    </div>
  )
}
