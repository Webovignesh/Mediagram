import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { Plus, RotateCcw, Download, Folder, CheckSquare, Square, FolderOpen, FileText, MessageSquare, Play, Pause, Music, Film, LogOut, RefreshCw, AlertCircle, Clock, LayoutGrid, List, Check, Sparkles, Image as ImageIcon, Pin, PinOff, Bell, BellOff, Archive, FolderUp, ArrowLeft, SquarePen, Settings, Trash2, Eraser } from 'lucide-react'
import { call, useCall, useTyping, useRouteQuery, isThumbLoaded, markThumbLoaded } from '../api.ts'
import { SearchInput, Chip, Select, Button, Avatar, Pill, Thumb, TypeChip, Pagination, Empty, ErrorState, OpenChatDialog, MediaPreviewModal, Dialog, fmtBytes, fmtAgo, fmtDate, fmtDuration, toast, triggerFlyToQueue, CheckDuplicatesModal, TelegramInviteModal, CreateChatModal, ManageChatSettingsModal, type DuplicateCheckResult } from '../ui.tsx'
import { ChatView } from './ChatView.tsx'
import { useNotifications, registerMutedChats } from '../notifications.ts'

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
  fileViewMode?: 'table' | 'grid'
  gridSize?: 'md' | 'lg' | 'xl'
}

const CHAT_FILTERS_STORAGE_KEY = 'mediagram_chat_filters'
const MEDIA_VIEW_MODE_KEY = 'mediagram_media_view_mode'
const MEDIA_GRID_SIZE_KEY = 'mediagram_media_grid_size'

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
  fileViewMode: 'table',
  gridSize: 'md',
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

function loadInitialFileViewMode(): 'table' | 'grid' {
  try {
    const raw = localStorage.getItem(MEDIA_VIEW_MODE_KEY)
    if (raw === 'grid' || raw === 'table') return raw
  } catch {}
  return 'table'
}

function loadInitialGridSize(): 'md' | 'lg' | 'xl' {
  try {
    const raw = localStorage.getItem(MEDIA_GRID_SIZE_KEY)
    if (raw === 'md' || raw === 'lg' || raw === 'xl') return raw
  } catch {}
  return 'md'
}

const MediaGridThumb = React.memo(function MediaGridThumb({
  thumb,
  name,
  type,
  aspectClass,
}: {
  thumb: string | null
  name: string
  type: string
  aspectClass: string
}) {
  const [failed, setFailed] = useState(false)
  const ext = (name.split('.').pop() || 'FILE').toUpperCase()

  const url = thumb && !failed
    ? (thumb.startsWith('mediagram://') || thumb.startsWith('teleflow://') || thumb.startsWith('data:') || thumb.startsWith('blob:') || thumb.startsWith('http')
        ? thumb
        : `teleflow://thumb/${thumb}`)
    : null
  const [loaded, setLoaded] = useState(() => isThumbLoaded(url))

  useEffect(() => {
    if (url && isThumbLoaded(url)) setLoaded(true)
  }, [url])

  const getMediaIcon = () => {
    switch (type) {
      case 'video':
      case 'video_note':
        return <Film size={26} className="text-primary/75" />
      case 'photo':
        return <ImageIcon size={26} className="text-cyan/75" />
      case 'audio':
        return <Music size={26} className="text-amber-400/75" />
      case 'animation':
        return <Sparkles size={26} className="text-pink-400/75" />
      default:
        return <FileText size={26} className="text-slate-400" />
    }
  }

  return (
    <div className={`relative w-full ${aspectClass} overflow-hidden bg-tile/90 select-none`}>
      {url ? (
        <>
          {!loaded && (
            <div className="absolute inset-0 bg-panel/90 flex flex-col items-center justify-center gap-1.5 z-10">
              <div className="size-10 rounded-xl bg-tile border border-border/60 flex items-center justify-center">
                {getMediaIcon()}
              </div>
              <span className="text-[9px] uppercase font-bold tracking-wider text-muted/70">{ext}</span>
            </div>
          )}
          <img
            src={url}
            alt={name}
            draggable={false}
            loading="lazy"
            decoding="async"
            onLoad={() => {
              markThumbLoaded(url)
              setLoaded(true)
            }}
            onError={() => setFailed(true)}
            className={`w-full h-full object-cover transition-transform duration-300 group-hover:scale-105 pointer-events-none ${loaded ? 'opacity-100' : 'opacity-0'}`}
          />
        </>
      ) : (
        <div className="w-full h-full flex flex-col items-center justify-center gap-1.5 bg-gradient-to-br from-panel/90 via-tile/80 to-panel/90 text-muted p-2">
          <div className="size-11 rounded-xl bg-panel/85 border border-border/60 flex items-center justify-center shadow-xs">
            {getMediaIcon()}
          </div>
          <span className="text-[10px] font-bold uppercase tracking-wider text-muted">{ext}</span>
        </div>
      )}
    </div>
  )
})

const MediaGridCard = React.memo(function MediaGridCard({
  item,
  isSelected,
  selectedCount,
  aspectClass,
  isHighlighted,
  onToggleSelect,
  onPreview,
  onDownload,
  onReveal,
}: {
  item: any
  isSelected: boolean
  selectedCount: number
  aspectClass: string
  isHighlighted?: boolean
  onToggleSelect: () => void
  onPreview: () => void
  onDownload: (force: boolean, e?: React.MouseEvent) => void
  onReveal: () => void
}) {
  const isVideo = item.type === 'video' || item.type === 'video_note'

  return (
    <div
      data-testid="media-grid-card"
      data-message-id={item.messageId}
      className={`group relative flex flex-col rounded-xl border transition-all duration-300 overflow-hidden ${
        isHighlighted
          ? 'border-primary bg-primary/20 ring-2 ring-primary ring-offset-2 ring-offset-panel shadow-[0_0_24px_rgba(56,189,248,0.55)] scale-[1.03] z-20'
          : isSelected
          ? 'border-primary bg-primary/10 ring-2 ring-primary/40 shadow-lg shadow-primary/10'
          : 'border-border/80 bg-tile/60 hover:bg-tile hover:border-primary/50 hover:shadow-md'
      }`}
    >
      {isHighlighted && (
        <div className="absolute top-2 right-2 z-30 rounded-full bg-primary text-white text-[10.5px] font-semibold px-2 py-0.5 shadow-lg shadow-primary/40 animate-pulse">
          Highlighted
        </div>
      )}
      {/* Thumbnail Area with Overlays */}
      <div
        className="relative cursor-pointer overflow-hidden"
        onClick={onPreview}
        title="Click to preview"
      >
        <MediaGridThumb
          thumb={item.thumb}
          name={item.name}
          type={item.type}
          aspectClass={aspectClass}
        />

        {/* Ambient Dark Gradient on Hover */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/20 to-black/35 opacity-40 group-hover:opacity-75 transition-opacity pointer-events-none" />

        {/* Telegram Center Play Overlay for Videos */}
        {isVideo && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none opacity-0 group-hover:opacity-100 transition-all duration-200">
            <div className="size-11 rounded-full bg-black/60 backdrop-blur-md border border-white/25 text-white flex items-center justify-center shadow-xl group-hover:scale-110 transition-transform">
              <Play size={18} className="fill-white ml-0.5" />
            </div>
          </div>
        )}

        {/* Top-Left: Selection Checkbox (refined Telegram circle) */}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onToggleSelect()
          }}
          className={`absolute top-2 left-2 z-20 size-[19px] rounded-full flex items-center justify-center transition-all cursor-pointer ${
            isSelected
              ? 'bg-primary text-white border-[1.5px] border-white shadow-sm opacity-100 scale-100'
              : `bg-black/40 hover:bg-black/70 backdrop-blur-xs border-[1.5px] border-white/60 text-transparent hover:border-white shadow-xs ${
                  selectedCount > 0 ? 'opacity-90' : 'opacity-0 group-hover:opacity-90'
                }`
          }`}
          title={isSelected ? 'Deselect item' : 'Select item'}
        >
          <Check size={11} className={isSelected ? 'stroke-[3] text-white' : 'opacity-0'} />
        </button>

        {/* Top-Right: Quick Download / Saved Status */}
        <div className="absolute top-2 right-2 z-20 flex items-center gap-1">
          {item.status === 'downloaded' ? (
            <div className="flex items-center gap-1">
              <span className="flex items-center gap-1 rounded-full bg-emerald-500/90 backdrop-blur-md px-2 py-0.5 text-[10px] font-semibold text-white shadow-sm pointer-events-none">
                <Check size={11} className="stroke-[3]" />
                <span className="inline">Saved</span>
              </span>
              {item.path && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    onReveal()
                  }}
                  className="size-6.5 rounded-full bg-black/60 hover:bg-primary backdrop-blur-md border border-white/20 text-white flex items-center justify-center shadow-md transition-all hover:scale-110 cursor-pointer opacity-0 group-hover:opacity-100"
                  title="Show in folder"
                >
                  <FolderOpen size={12} />
                </button>
              )}
            </div>
          ) : (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                onDownload(false, e)
              }}
              className="size-7 rounded-full bg-black/60 hover:bg-primary backdrop-blur-md border border-white/25 text-white flex items-center justify-center shadow-md transition-all hover:scale-110 cursor-pointer"
              title="Download"
            >
              <Download size={13} />
            </button>
          )}
        </div>

        {/* Bottom-Right: Duration Badge */}
        {item.duration ? (
          <span className="absolute bottom-2 right-2 flex items-center gap-1 rounded-full bg-black/75 backdrop-blur-md px-2 py-0.5 text-[10.5px] font-medium text-white shadow-sm pointer-events-none">
            <Play size={9} className="fill-white" />
            <span>{fmtDuration(item.duration)}</span>
          </span>
        ) : null}

        {/* Bottom-Left: Size Badge */}
        <span className="absolute bottom-2 left-2 rounded-md bg-black/70 backdrop-blur-md px-1.5 py-0.5 text-[10px] font-medium text-slate-200 tabular-nums pointer-events-none shadow-sm">
          {fmtBytes(item.size)}
        </span>
      </div>

      {/* Card Info Strip */}
      <div className="p-2.5 flex flex-col justify-between flex-1 gap-1.5 bg-tile/40">
        <div
          className="font-medium text-[12.5px] text-text truncate group-hover:text-primary transition-colors cursor-pointer"
          title={item.name}
          onClick={onPreview}
        >
          {item.name}
        </div>
        <div className="flex items-center justify-between gap-1 text-[11px] text-muted">
          <div className="flex items-center gap-1.5 min-w-0">
            <TypeChip ext={item.ext} />
            <span className="text-[11px] tabular-nums text-text-2 font-medium shrink-0">{fmtBytes(item.size)}</span>
            {item.status === 'downloaded' ? (
              <span className="text-[10.5px] text-emerald-400 font-semibold flex items-center gap-1 shrink-0">
                <span className="size-1.5 rounded-full bg-emerald-400" />
                Saved
              </span>
            ) : item.status === 'active' || item.status === 'downloading' ? (
              <span className="text-[10.5px] text-cyan font-semibold flex items-center gap-1 animate-pulse shrink-0">
                <span className="size-1.5 rounded-full bg-cyan" />
                Downloading
              </span>
            ) : item.status === 'queued' ? (
              <span className="text-[10.5px] text-amber-400 font-semibold shrink-0">Queued</span>
            ) : null}
          </div>
          {item.status === 'downloaded' ? (
            <div className="flex items-center gap-1 shrink-0">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  onDownload(true, e)
                }}
                className="rounded p-1 text-muted hover:text-primary hover:bg-tile transition-colors cursor-pointer"
                title="Download again"
              >
                <RotateCcw size={13} />
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
})

const EMPTY_ARGS = {}

export default function Downloads() {
  const [openChat, setOpenChat] = useState(false)
  const [createChatOpen, setCreateChatOpen] = useState(false)
  const [manageChatId, setManageChatId] = useState<number | null>(null)
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
  const [globalFileViewMode, setGlobalFileViewMode] = useState<'table' | 'grid'>(loadInitialFileViewMode)
  const [globalGridSize, setGlobalGridSize] = useState<'md' | 'lg' | 'xl'>(loadInitialGridSize)

  const [sidebarWidth, setSidebarWidth] = useState<number>(() => {
    try {
      const saved = localStorage.getItem('mediagram_chats_sidebar_width')
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
        localStorage.setItem('mediagram_chats_sidebar_width', String(sidebarWidthRef.current))
      } catch {}
    }

    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
  }, [])

  // `#/downloads?chat=2` (Overview cards, notification clicks). The query lives in the hash: App routing
  // strips it before the page name, so it is read from the route and not from window.location.search.
  const routeQuery = useRouteQuery()
  const deepLinkChat = routeQuery.get('chat')
  const deepLinkMessageId = routeQuery.get('messageId')
  const deepLinkView = routeQuery.get('view')
  const deepLinkName = routeQuery.get('name')

  const [highlightedMessageId, setHighlightedMessageId] = useState<number | null>(null)

  useEffect(() => {
    if (!deepLinkChat) return
    const id = Number(deepLinkChat)
    if (!isNaN(id) && id !== 0) {
      setChatId(id)
      const targetView = (deepLinkView === 'files' || deepLinkMessageId) ? 'files' : (deepLinkView === 'chat' ? 'chat' : 'files')
      setView(targetView)
      setChatViewModes((prev) => ({ ...prev, [id]: targetView }))
    }
    if (deepLinkMessageId) {
      const msgId = Number(deepLinkMessageId)
      if (!isNaN(msgId) && msgId > 0) {
        setHighlightedMessageId(msgId)
      }
    }
  }, [deepLinkChat, deepLinkMessageId, deepLinkView])

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

  // Dedupe check modal state
  const [dedupeModalOpen, setDedupeModalOpen] = useState(false)
  const [dedupeLoading, setDedupeLoading] = useState(false)
  const [dedupeSelectedCount, setDedupeSelectedCount] = useState(0)
  const [dedupeResult, setDedupeResult] = useState<DuplicateCheckResult | null>(null)
  const [customScanPath, setCustomScanPath] = useState<string | null>(null)
  const lastDedupeTargetRef = useRef<
    | { type: 'items', items: { chatId: number, messageId: number }[] }
    | { type: 'matching', chatId?: number, filters?: any }
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

  // Notification & Chat management (Pin, Mute, Archive, Leave, Select)
  const { isPinned, togglePin, isMuted, toggleMute, isArchived, toggleArchive } = useNotifications()
  const [inArchiveFolder, setInArchiveFolder] = useState(false)
  const [chatContextMenu, setChatContextMenu] = useState<{ x: number, y: number, chat: any } | null>(null)
  const [leaveChatModal, setLeaveChatModal] = useState<any | null>(null)
  const [deleteChatModal, setDeleteChatModal] = useState<any | null>(null)
  const [clearChatModal, setClearChatModal] = useState<any | null>(null)
  const [clearingChat, setClearingChat] = useState(false)
  const [clearChatRevokeForAll, setClearChatRevokeForAll] = useState(false)

  // Close context menu on outside click or scroll
  useEffect(() => {
    const closeMenu = (e: MouseEvent) => {
      if (e.button === 2) return
      setChatContextMenu(null)
    }
    const handleScroll = () => {
      setChatContextMenu(null)
    }
    window.addEventListener('click', closeMenu)
    window.addEventListener('scroll', handleScroll, true)
    return () => {
      window.removeEventListener('click', closeMenu)
      window.removeEventListener('scroll', handleScroll, true)
    }
  }, [])

  // Data fetching
  const { data: authData } = useCall<any>('auth.get', undefined, ['auth'])
  const me = authData?.me

  const { data: chatsData, error: chatsErr, reload: chatsReload } = useCall<{ chats: any[], folders: any[] }>('chats.list', EMPTY_ARGS, ['chats'])

  // Register muted chats from chatsData
  useEffect(() => {
    if (chatsData?.chats) {
      const mutedIds = chatsData.chats.filter((c: any) => c.isMuted).map((c: any) => c.id)
      if (mutedIds.length > 0) registerMutedChats(mutedIds)
    }
  }, [chatsData])

  // Chat action helpers
  const handleTogglePinChat = async (c: any) => {
    setChatContextMenu(null)
    const next = !isPinned(c.id)
    togglePin(c.id)
    try {
      await call('chats.pin', { chatId: c.id, pin: next })
      chatsReload()
    } catch {}
  }

  const handleToggleMuteChat = async (c: any) => {
    setChatContextMenu(null)
    const next = !isMuted(c.id)
    toggleMute(c.id)
    try {
      await call('chats.mute', { chatId: c.id, mute: next })
      chatsReload()
    } catch {}
  }

  const handleToggleArchiveChat = async (c: any) => {
    setChatContextMenu(null)
    const next = !isArchived(c.id)
    toggleArchive(c.id)
    try {
      await call('chats.archive', { chatId: c.id, archive: next })
      chatsReload()
    } catch {}
  }

  const handleLeaveChatConfirm = async () => {
    if (!leaveChatModal) return
    const targetChat = leaveChatModal
    setLeaveChatModal(null)
    // The row animates out first (bug 32); the leave call and the reload follow, so the list still
    // holds the chat while the exit plays.
    setLeavingChatId(targetChat.id)
    await new Promise((r) => setTimeout(r, 280))
    try {
      await call('chats.leave', { chatId: targetChat.id })
      toast(`Left "${targetChat.title}"`)
      if (activeChatId === targetChat.id) {
        setChatId(null)
      }
      chatsReload()
    } catch (e: any) {
      toast(e.message || 'Failed to leave chat', 'danger')
    } finally {
      setLeavingChatId(null)
    }
  }

  const handleDeleteChatConfirm = async () => {
    if (!deleteChatModal) return
    const targetChat = deleteChatModal
    setDeleteChatModal(null)
    setLeavingChatId(targetChat.id)
    await new Promise((r) => setTimeout(r, 280))
    try {
      await call('chats.delete', { chatId: targetChat.id })
      toast(`Deleted "${targetChat.title}"`)
      if (activeChatId === targetChat.id) {
        setChatId(null)
      }
      chatsReload()
    } catch (e: any) {
      toast(e.message || 'Failed to delete chat', 'danger')
    } finally {
      setLeavingChatId(null)
    }
  }

  const handleClearChatConfirm = async () => {
    if (!clearChatModal) return
    const targetChat = clearChatModal
    setClearingChat(true)
    try {
      const isPrivate = targetChat.kind === 'private'
      const revoke = isPrivate ? clearChatRevokeForAll : true
      await call('chats.clear', { chatId: targetChat.id, revoke })
      toast(`Cleared message history in "${targetChat.title}"`)
      chatsReload()
      if (activeChatId === targetChat.id) {
        msgReload()
        mediaReload()
      }
      setClearChatModal(null)
    } catch (e: any) {
      toast(e.message || 'Failed to clear chat history', 'danger')
    } finally {
      setClearingChat(false)
    }
  }

  // chats.list already arrives in Telegram's own order (main-list position: pinned first, then most recent),
  // so the sidebar keeps it: re-sorting by date would sink pinned chats and the chats TDLib has no last message for.
  const allChats = chatsData?.chats ?? []
  const allFolders = chatsData?.folders ?? []

  // Join/leave motion for the chat rows (bug 32): a chat that just appeared slides in once; a chat being
  // left fades out over the row before the leave call and the reload remove it from the list.
  const knownChatIdsRef = useRef<Set<number> | null>(null)
  const [enteringIds, setEnteringIds] = useState<ReadonlySet<number>>(new Set())
  const [leavingChatId, setLeavingChatId] = useState<number | null>(null)
  useEffect(() => {
    if (!chatsData?.chats || chatsData.chats.length === 0) return
    const next = new Set<number>(chatsData.chats.map((c: any) => c.id))
    if (knownChatIdsRef.current === null) { knownChatIdsRef.current = next; return } // first load: no motion
    const known = knownChatIdsRef.current
    const added = [...next].filter((id) => !known.has(id))
    knownChatIdsRef.current = next
    if (!added.length) return
    setEnteringIds(new Set(added))
    const t = setTimeout(() => setEnteringIds(new Set()), 450)
    return () => clearTimeout(t)
  }, [chatsData])

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
    return { ...defaultChatFilter, ...chatFilters[activeChatId] }
  }, [activeChatId, chatFilters])

  const updateActiveChatFilter = useCallback((patch: Partial<ChatFilterState>) => {
    if (!activeChatId) return
    setChatFilters((prev) => {
      const nextChat = { ...prev[activeChatId], ...patch }
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
  const page = currentFilter.page

  // Setters that update persistent filter for active chat
  const setMediaType = (v: string) => updateActiveChatFilter({ mediaType: v, page: 1 })
  const setSizeFilter = (v: string) => updateActiveChatFilter({ sizeFilter: v, appliedCustomSize: v === 'custom' ? appliedCustomSize : null, page: 1 })
  const setAppliedCustomSize = (v: any) => updateActiveChatFilter({ appliedCustomSize: v })
  const setDuration = (v: string) => updateActiveChatFilter({ duration: v, appliedCustomDuration: v === 'custom' ? appliedCustomDuration : null, page: 1 })
  const setAppliedCustomDuration = (v: any) => updateActiveChatFilter({ appliedCustomDuration: v })
  const setFileSearch = (v: string) => updateActiveChatFilter({ fileSearch: v, page: 1 })
  const setPage = (p: number | ((prev: number) => number)) => updateActiveChatFilter({ page: typeof p === 'function' ? p(page) : p })

  const fileViewMode = currentFilter.fileViewMode || globalFileViewMode
  const gridSize = currentFilter.gridSize || globalGridSize

  const setFileViewMode = (mode: 'table' | 'grid') => {
    setGlobalFileViewMode(mode)
    try {
      localStorage.setItem(MEDIA_VIEW_MODE_KEY, mode)
    } catch {}
    setPage(1)
    updateActiveChatFilter({ fileViewMode: mode, page: 1 })
  }

  const setGridSize = (size: 'md' | 'lg' | 'xl') => {
    setGlobalGridSize(size)
    try {
      localStorage.setItem(MEDIA_GRID_SIZE_KEY, size)
    } catch {}
    updateActiveChatFilter({ gridSize: size })
  }

  // Archived chats list
  const archivedChatsList = useMemo(() => {
    return allChats.filter((c: any) => isArchived(c.id) || c.isArchived)
  }, [allChats, isArchived])

  // Filter chats by kind/search/archive, with pinned chats pinned to the top
  const filteredChats = useMemo(() => {
    const sourceList = inArchiveFolder
      ? archivedChatsList
      : allChats.filter((c: any) => !(isArchived(c.id) || c.isArchived))

    const list = sourceList.filter((c: any) => {
      if (chatSearch && !c.title.toLowerCase().includes(chatSearch.toLowerCase()) && !(c.username && c.username.toLowerCase().includes(chatSearch.toLowerCase()))) {
        return false
      }
      if (inArchiveFolder) return true
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

    // Sort: pinned chats always stay on top
    return [...list].sort((a: any, b: any) => {
      const aPin = (isPinned(a.id) || a.isPinned) ? 1 : 0
      const bPin = (isPinned(b.id) || b.isPinned) ? 1 : 0
      if (aPin !== bPin) return bPin - aPin
      return 0
    })
  }, [allChats, inArchiveFolder, archivedChatsList, chatSearch, chatKind, selectedFolderId, allFolders, isPinned, isArchived])

  // Media query params with custom size/duration sorting
  const resolvedSort =
    sizeFilter === 'largest' || sizeFilter === 'smallest' ? sizeFilter :
    duration === 'longest' ? 'longest' :
    duration === 'shortest' ? 'shortest' : 'newest'

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

  const mediaPageSize = fileViewMode === 'grid' ? 60 : 20
  const mediaFilters = useMemo(() => ({
    chatId: activeChatId || 0,
    type: mediaType !== 'all' ? mediaType : undefined,
    duration: resolvedDuration,
    size: resolvedSize,
    sort: resolvedSort,
    q: fileSearch || undefined,
    page,
    pageSize: mediaPageSize,
  }), [activeChatId, mediaType, resolvedDuration, resolvedSize, resolvedSort, fileSearch, page, mediaPageSize])

  // downloads.checkDuplicates takes the same filters as chats.media, minus the fields that call carries itself.
  const dupFilters = useMemo(() => {
    const { chatId: _chatId, page: _page, pageSize: _pageSize, ...rest } = mediaFilters
    return rest
  }, [mediaFilters])

  const { data: mediaData, error: mediaErr, reload: mediaReload } = useCall<{ items: any[], total: number, exts: string[], scan: { state: 'scanning' | 'failed' | 'paused' | 'done' | 'idle', indexed: number, total: number | null, error?: string } }>(
    'chats.media', activeChatId ? mediaFilters : null, activeChatId ? [`media:${activeChatId}`] : []
  )

  const [loadingOlder, setLoadingOlder] = useState(false)

  const msgArgs = useMemo(() => {
    return activeChatId && view === 'chat' ? { chatId: activeChatId, limit: msgLimit } : null
  }, [activeChatId, view, msgLimit])

  const msgTopics = useMemo(() => {
    return activeChatId ? [`messages:${activeChatId}`] : []
  }, [activeChatId])

  const { data: msgData, error: msgErr, loading: msgLoading, reload: msgReload } = useCall<{ messages: any[], more: boolean }>(
    'chats.messages', msgArgs, msgTopics
  )

  useEffect(() => {
    setLoadingOlder(false)
  }, [msgData, activeChatId])

  const mediaItems = mediaData?.items ?? (mediaData as any)?.media ?? []
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

  // Scroll and highlight entry in Files View when navigating via deep link
  useEffect(() => {
    if (!highlightedMessageId || !mediaItems.length) return
    const found = mediaItems.some((m: any) => m.messageId === highlightedMessageId)
    if (found) {
      const timer = setTimeout(() => {
        const el = document.querySelector(`[data-message-id="${highlightedMessageId}"]`)
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' })
          const scrollWrap = el.closest('.overflow-x-auto')
          if (scrollWrap) {
            scrollWrap.scrollLeft = 0
          }
        }
      }, 150)
      return () => clearTimeout(timer)
    } else if (deepLinkName && !fileSearch) {
      // If the target message is not on page 1 of mediaItems, search for its filename to reveal it
      setFileSearch(deepLinkName)
    }
  }, [highlightedMessageId, mediaItems, deepLinkName, fileSearch])

  useEffect(() => {
    if (!highlightedMessageId) return
    const timer = setTimeout(() => {
      setHighlightedMessageId(null)
    }, 8000)
    return () => clearTimeout(timer)
  }, [highlightedMessageId])

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



  const handleLoadOlder = () => {
    setLoadingOlder(true)
    setMsgLimit((l) => Math.min(l + 30, 1000))
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

  // Marquee drag-selection state for Files View (Grid & Table)
  const [marqueeBox, setMarqueeBox] = useState<{
    left: number
    top: number
    width: number
    height: number
  } | null>(null)
  const filesContainerRef = useRef<HTMLDivElement>(null)
  const dragCleanupRef = useRef<(() => void) | null>(null)

  const [containerBounds, setContainerBounds] = useState<{ left: number, width: number } | null>(null)

  useEffect(() => {
    return () => {
      dragCleanupRef.current?.()
    }
  }, [])

  useEffect(() => {
    const updateBounds = () => {
      const el = filesContainerRef.current
      if (el) {
        const rect = el.getBoundingClientRect()
        setContainerBounds({ left: rect.left, width: rect.width })
      }
    }

    updateBounds()

    const el = filesContainerRef.current
    let ro: ResizeObserver | null = null
    if (el) {
      ro = new ResizeObserver(updateBounds)
      ro.observe(el)
    }

    window.addEventListener('resize', updateBounds)

    return () => {
      ro?.disconnect()
      window.removeEventListener('resize', updateBounds)
    }
  }, [sidebarWidth, selectedIds.length > 0, fileViewMode])

  const handleDragSelectMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    // Only primary (left) mouse button
    if (e.button !== 0) return

    const target = e.target as HTMLElement
    // Ignore interactive controls so buttons, links, inputs, selects work without interference
    if (target.closest('button, a, input, select, textarea, [role="button"], [role="checkbox"]')) {
      return
    }

    const container = filesContainerRef.current
    if (!container) return

    const startX = e.clientX
    const startY = e.clientY
    const isAdditive = e.shiftKey || e.ctrlKey || e.metaKey
    const initialSelected = isAdditive ? [...selectedIds] : []
    const clickedCardOrRow = Boolean(target.closest('[data-message-id]'))

    let hasDragged = false

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const curX = moveEvent.clientX
      const curY = moveEvent.clientY
      const dist = Math.hypot(curX - startX, curY - startY)

      if (!hasDragged) {
        if (dist < 5) return
        hasDragged = true
        document.body.style.userSelect = 'none'
        window.getSelection()?.removeAllRanges()
      }

      moveEvent.preventDefault()

      const boxLeft = Math.min(startX, curX)
      const boxTop = Math.min(startY, curY)
      const boxRight = Math.max(startX, curX)
      const boxBottom = Math.max(startY, curY)

      setMarqueeBox({
        left: boxLeft,
        top: boxTop,
        width: boxRight - boxLeft,
        height: boxBottom - boxTop,
      })

      // Query selectable items within files container
      const itemElements = Array.from(container.querySelectorAll<HTMLElement>('[data-message-id]'))
      const newlyIntersected: number[] = []

      for (const itemEl of itemElements) {
        const idStr = itemEl.getAttribute('data-message-id')
        if (!idStr) continue
        const id = Number(idStr)
        if (Number.isNaN(id)) continue

        const rect = itemEl.getBoundingClientRect()
        const condL = boxLeft < rect.right
        const condR = boxRight > rect.left
        const condT = boxTop < rect.bottom
        const condB = boxBottom > rect.top
        const intersects = condL && condR && condT && condB

        if (intersects) {
          newlyIntersected.push(id)
        }
      }

      const additiveNow = moveEvent.shiftKey || moveEvent.ctrlKey || moveEvent.metaKey || isAdditive
      if (additiveNow) {
        setSelectedIds(Array.from(new Set([...initialSelected, ...newlyIntersected])))
      } else {
        setSelectedIds(newlyIntersected)
      }
    }

    const cleanup = () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
      window.removeEventListener('dragstart', preventDrag, true)
      window.removeEventListener('keydown', handleKeyDown)
      document.body.style.userSelect = ''
      dragCleanupRef.current = null
    }

    const handleKeyDown = (keyEvent: KeyboardEvent) => {
      if (keyEvent.key === 'Escape') {
        cleanup()
        setMarqueeBox(null)
        if (isAdditive) {
          setSelectedIds(initialSelected)
        }
      }
    }

    const handleMouseUp = () => {
      cleanup()

      if (hasDragged) {
        setMarqueeBox(null)
        // Suppress follow-up click event from triggering item preview modal
        const stopClick = (clickEvent: MouseEvent) => {
          clickEvent.stopPropagation()
          clickEvent.preventDefault()
          window.removeEventListener('click', stopClick, true)
        }
        window.addEventListener('click', stopClick, true)
        setTimeout(() => {
          window.removeEventListener('click', stopClick, true)
        }, 100)
      } else {
        // Simple click without dragging: deselect if clicking container empty space
        if (!clickedCardOrRow && !isAdditive) {
          setSelectedIds([])
        }
      }
    }

    const preventDrag = (dragEvent: DragEvent) => {
      dragEvent.preventDefault()
    }

    dragCleanupRef.current = cleanup
    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
    window.addEventListener('dragstart', preventDrag, true)
    window.addEventListener('keydown', handleKeyDown)
  }, [selectedIds])

  async function runDuplicateCheck(
    target: { type: 'items', items: { chatId: number, messageId: number }[] } | { type: 'matching', chatId?: number, filters?: any } | { type: 'folder' } | null,
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
        const cId = target.chatId || activeChatId
        if (!cId) return
        const res = await call<DuplicateCheckResult>('downloads.checkDuplicates', {
          chatId: cId,
          filters: target.filters || dupFilters,
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
          inSelectionCount: validResults.reduce((acc, r) => acc + (r.inSelectionCount ?? 0), 0),
          totalDuplicates: validResults.reduce((acc, r) => acc + (r.totalDuplicates ?? r.onDiskCount), 0),
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
        await runDuplicateCheck(lastDedupeTargetRef.current, res.path)
      }
    } catch (e) {
      toast((e as Error).message, 'danger')
    }
  }

  async function handleResetCustomScanPath() {
    setCustomScanPath(null)
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
    setCustomScanPath(null)
    try {
      const res = await call<DuplicateCheckResult>('downloads.checkDuplicates', {
        items,
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
    setCustomScanPath(null)
    lastDedupeTargetRef.current = null
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

  async function downloadAllMatching() {
    if (!activeChatId) return
    lastDedupeTargetRef.current = { type: 'matching', chatId: activeChatId, filters: dupFilters }
    const total = mediaData?.total ?? 0
    setDedupeSelectedCount(total)
    setDedupeLoading(true)
    setDedupeModalOpen(true)
    setDedupeResult(null)
    setCustomScanPath(null)
    try {
      const res = await call<DuplicateCheckResult>('downloads.checkDuplicates', {
        chatId: activeChatId,
        filters: dupFilters,
      })
      setDedupeResult(res)
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
        setView('chat')
        chatsReload()
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

  const handleChatDownloadItem = useCallback((item: any, force?: boolean, e?: any) => {
    downloadItems([item], force, e)
  }, [activeChatId])

  const handleSelectChatInView = useCallback((id: number) => {
    setChatId(id)
    handleSetView('chat')
    chatsReload()
  }, [chatsReload, handleSetView])

  const handleOpenManageChatSettings = useCallback(() => {
    setManageChatId(activeChatId)
  }, [activeChatId])

  return (
    <div className="flex h-full overflow-hidden">
      <OpenChatDialog
        open={openChat}
        onClose={() => setOpenChat(false)}
        onSuccess={(id) => { setChatId(id); chatsReload() }}
      />

      <CreateChatModal
        open={createChatOpen}
        onClose={() => setCreateChatOpen(false)}
        onSuccess={(id) => {
          setChatId(id)
          setView('chat')
          chatsReload()
        }}
      />

      <ManageChatSettingsModal
        open={!!manageChatId}
        chatId={manageChatId}
        onClose={() => setManageChatId(null)}
        onUpdated={() => {
          chatsReload()
          msgReload()
        }}
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
        onClose={() => {
          setDedupeModalOpen(false)
          setDedupeResult(null)
          setCustomScanPath(null)
          lastDedupeTargetRef.current = null
        }}
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
                <Select
                  value={customSizeMinUnit}
                  onChange={(v) => setCustomSizeMinUnit(v as any)}
                  options={[
                    { value: 'KB', label: 'KB' },
                    { value: 'MB', label: 'MB' },
                    { value: 'GB', label: 'GB' },
                  ]}
                  className="w-20"
                />
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
                <Select
                  value={customSizeMaxUnit}
                  onChange={(v) => setCustomSizeMaxUnit(v as any)}
                  options={[
                    { value: 'KB', label: 'KB' },
                    { value: 'MB', label: 'MB' },
                    { value: 'GB', label: 'GB' },
                  ]}
                  className="w-20"
                />
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
                <Select
                  value={customDurationMinUnit}
                  onChange={(v) => setCustomDurationMinUnit(v as any)}
                  options={[
                    { value: 'sec', label: 'Sec' },
                    { value: 'min', label: 'Min' },
                    { value: 'hr', label: 'Hours' },
                  ]}
                  className="w-20"
                />
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
                <Select
                  value={customDurationMaxUnit}
                  onChange={(v) => setCustomDurationMaxUnit(v as any)}
                  options={[
                    { value: 'sec', label: 'Sec' },
                    { value: 'min', label: 'Min' },
                    { value: 'hr', label: 'Hours' },
                  ]}
                  className="w-20"
                />
              </div>
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setCustomDurationModalOpen(false)}>Cancel</Button>
            <Button variant="primary" onClick={applyCustomDuration}>Apply Filter</Button>
          </div>
        </div>
      </Dialog>

      {/* Chat Right-Click Context Menu Tool Box */}
      {chatContextMenu && createPortal(
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setChatContextMenu(null)}
            onContextMenu={(e) => {
              e.preventDefault()
              setChatContextMenu(null)
            }}
          />
          <div
            style={{
              top: `${chatContextMenu.y}px`,
              left: `${chatContextMenu.x}px`,
            }}
            className="fixed z-50 min-w-[220px] rounded-2xl border border-border/80 bg-panel/95 backdrop-blur-xl p-1.5 shadow-2xl animate-in fade-in zoom-in-95 duration-100 select-none"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Target Chat Info preview */}
            <div className="flex items-center gap-2 px-3 py-2 border-b border-border/50 mb-1">
              <Avatar src={chatContextMenu.chat.photo} name={chatContextMenu.chat.title} size={24} />
              <div className="min-w-0 flex-1">
                <div className="text-[12px] font-semibold text-text truncate">{chatContextMenu.chat.title}</div>
                <div className="text-[10.5px] text-muted truncate">
                  {chatContextMenu.chat.username ? `@${chatContextMenu.chat.username}` : chatContextMenu.chat.kind}
                </div>
              </div>
            </div>

            {/* PIN / UNPIN */}
            <button
              type="button"
              onClick={() => handleTogglePinChat(chatContextMenu.chat)}
              className="flex items-center gap-2.5 w-full px-3 py-2 text-[12.5px] rounded-xl text-text hover:bg-tile transition-colors cursor-pointer text-left"
            >
              {isPinned(chatContextMenu.chat.id) || chatContextMenu.chat.isPinned ? (
                <>
                  <PinOff size={15} className="text-muted" />
                  <span>Unpin from Top</span>
                </>
              ) : (
                <>
                  <Pin size={15} className="text-primary" />
                  <span>Pin to Top</span>
                </>
              )}
            </button>

            {/* MUTE / UNMUTE (wired to notifications) */}
            <button
              type="button"
              onClick={() => handleToggleMuteChat(chatContextMenu.chat)}
              className="flex items-center gap-2.5 w-full px-3 py-2 text-[12.5px] rounded-xl text-text hover:bg-tile transition-colors cursor-pointer text-left"
            >
              {isMuted(chatContextMenu.chat.id) || chatContextMenu.chat.isMuted ? (
                <>
                  <Bell size={15} className="text-primary" />
                  <span>Unmute Notifications</span>
                </>
              ) : (
                <>
                  <BellOff size={15} className="text-muted" />
                  <span>Mute Notifications</span>
                </>
              )}
            </button>

            {/* ARCHIVE / UNARCHIVE (make archive work like a folder) */}
            <button
              type="button"
              onClick={() => handleToggleArchiveChat(chatContextMenu.chat)}
              className="flex items-center gap-2.5 w-full px-3 py-2 text-[12.5px] rounded-xl text-text hover:bg-tile transition-colors cursor-pointer text-left"
            >
              {isArchived(chatContextMenu.chat.id) || chatContextMenu.chat.isArchived ? (
                <>
                  <FolderUp size={15} className="text-primary" />
                  <span>Unarchive Chat</span>
                </>
              ) : (
                <>
                  <Archive size={15} className="text-muted" />
                  <span>Archive Chat</span>
                </>
              )}
            </button>

            {/* MANAGE CHANNEL / GROUP */}
            {(chatContextMenu.chat.kind === 'channel' || chatContextMenu.chat.kind === 'group') && (chatContextMenu.chat.canManage || chatContextMenu.chat.isCreator) && (
              <button
                type="button"
                onClick={() => {
                  const target = chatContextMenu.chat
                  setChatContextMenu(null)
                  setManageChatId(target.id)
                }}
                className="flex items-center gap-2.5 w-full px-3 py-2 text-[12.5px] rounded-xl text-text hover:bg-tile transition-colors cursor-pointer text-left"
              >
                <Settings size={15} className="text-primary" />
                <span>Manage {chatContextMenu.chat.kind === 'channel' ? 'Channel' : 'Group'}</span>
              </button>
            )}

            {/* CLEAR CHAT HISTORY */}
            <button
              type="button"
              onClick={() => {
                const target = chatContextMenu.chat
                setChatContextMenu(null)
                setClearChatRevokeForAll(target.kind !== 'private')
                setClearChatModal(target)
              }}
              className="flex items-center gap-2.5 w-full px-3 py-2 text-[12.5px] rounded-xl text-text hover:bg-tile transition-colors cursor-pointer text-left"
            >
              <Eraser size={15} className="text-amber-500" />
              <span>Clear Chat History</span>
            </button>

            {/* LEAVE CHAT / CHANNEL (Only for chats the user joined, not own created channel/group or personal Saved Messages) */}
            {chatContextMenu.chat.kind !== 'saved' && !chatContextMenu.chat.isCreator && (
              <>
                <div className="h-px bg-border/50 my-1" />
                <button
                  type="button"
                  onClick={() => {
                    const target = chatContextMenu.chat
                    setChatContextMenu(null)
                    setLeaveChatModal(target)
                  }}
                  className="flex items-center gap-2.5 w-full px-3 py-2 text-[12.5px] rounded-xl text-danger hover:bg-danger/10 transition-colors cursor-pointer text-left font-medium"
                >
                  <LogOut size={15} className="text-danger" />
                  <span>{chatContextMenu.chat.kind === 'channel' ? 'Leave Channel' : 'Leave Chat'}</span>
                </button>
              </>
            )}
          </div>
        </>,
        document.body
      )}

      {/* Leave Chat / Channel Confirmation Dialog */}
      <Dialog
        open={!!leaveChatModal}
        onClose={() => setLeaveChatModal(null)}
        title={leaveChatModal?.kind === 'channel' ? 'Leave Channel' : 'Leave Chat'}
      >
        <div className="space-y-4">
          <p className="text-[13px] text-text-2 leading-relaxed">
            Are you sure you want to leave <strong className="text-text font-semibold">{leaveChatModal?.title}</strong>? You will no longer receive new messages or media from this {leaveChatModal?.kind || 'chat'}.
          </p>
          <div className="flex justify-end gap-2 pt-2 border-t border-border">
            <Button
              variant="secondary"
              onClick={() => setLeaveChatModal(null)}
              className="px-4 py-1.5 text-[12.5px]"
            >
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={handleLeaveChatConfirm}
              className="flex items-center gap-1.5 px-4 py-1.5 text-[12.5px]"
            >
              <LogOut size={14} />
              <span>Leave {leaveChatModal?.kind === 'channel' ? 'Channel' : 'Chat'}</span>
            </Button>
          </div>
        </div>
      </Dialog>

      {/* Delete Chat / Channel Confirmation Dialog */}
      <Dialog
        open={!!deleteChatModal}
        onClose={() => setDeleteChatModal(null)}
        title={deleteChatModal?.kind === 'channel' ? 'Delete Channel' : 'Delete Group'}
      >
        <div className="space-y-4">
          <div className="flex items-start gap-3 p-3.5 rounded-xl bg-danger/10 border border-danger/25">
            <div className="size-9 rounded-xl bg-danger/20 text-danger flex items-center justify-center shrink-0">
              <Trash2 size={18} />
            </div>
            <div className="space-y-1">
              <div className="text-[13.5px] font-semibold text-text">
                Permanently delete "{deleteChatModal?.title}"?
              </div>
              <p className="text-[12px] text-muted leading-relaxed">
                This will delete the {deleteChatModal?.kind || 'chat'} and all its messages for all members. This action cannot be undone.
              </p>
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2 border-t border-border">
            <Button
              variant="secondary"
              onClick={() => setDeleteChatModal(null)}
              className="px-4 py-1.5 text-[12.5px]"
            >
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={handleDeleteChatConfirm}
              className="flex items-center gap-1.5 px-4 py-1.5 text-[12.5px] font-semibold"
            >
              <Trash2 size={14} />
              <span>Delete {deleteChatModal?.kind === 'channel' ? 'Channel' : 'Group'}</span>
            </Button>
          </div>
        </div>
      </Dialog>

      {/* Clear Chat History Confirmation Dialog */}
      <Dialog
        open={!!clearChatModal}
        onClose={() => !clearingChat && setClearChatModal(null)}
        title="Clear Chat History"
      >
        <div className="space-y-4">
          <div className="flex items-start gap-3 p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/25">
            <div className="size-9 rounded-xl bg-amber-500/20 text-amber-500 flex items-center justify-center shrink-0">
              <Eraser size={18} />
            </div>
            <div className="space-y-1">
              <div className="text-[13.5px] font-semibold text-text">
                Clear all messages in "{clearChatModal?.title}"?
              </div>
              <p className="text-[12px] text-muted leading-relaxed">
                {clearChatModal?.kind === 'private'
                  ? clearChatRevokeForAll
                    ? `This will delete all message history in this chat for both you and ${clearChatModal?.title}.`
                    : `This will delete all message history in this chat for you only. ${clearChatModal?.title} will still see the messages.`
                  : `This will delete all message history in this ${clearChatModal?.kind === 'channel' ? 'channel' : 'group'} for all members.`}
                {' '}The chat itself will remain in your chat list. This action cannot be undone.
              </p>
            </div>
          </div>

          {clearChatModal?.kind === 'private' && (
            <label className="flex items-center gap-2.5 px-1 py-1 cursor-pointer select-none text-[12.5px] text-text font-medium">
              <input
                type="checkbox"
                checked={clearChatRevokeForAll}
                onChange={(e) => setClearChatRevokeForAll(e.target.checked)}
                className="rounded border-border text-primary focus:ring-primary size-4"
              />
              <span>Also delete for {clearChatModal?.title}</span>
            </label>
          )}

          <div className="flex justify-end gap-2 pt-2 border-t border-border">
            <Button
              variant="secondary"
              disabled={clearingChat}
              onClick={() => setClearChatModal(null)}
              className="px-4 py-1.5 text-[12.5px]"
            >
              Cancel
            </Button>
            <Button
              variant="danger"
              busy={clearingChat}
              onClick={handleClearChatConfirm}
              className="flex items-center gap-1.5 px-4 py-1.5 text-[12.5px] font-semibold"
            >
              <Eraser size={14} />
              <span>Clear History</span>
            </Button>
          </div>
        </div>
      </Dialog>

      {/* Column 1: Chats & Channels (Resizable) */}
      <div
        style={{ width: `${sidebarWidth}px`, minWidth: 300, maxWidth: 520 }}
        className="flex shrink-0 flex-col border-r border-border bg-panel/40 select-none overflow-hidden"
      >
        <div className="flex items-center justify-between border-b border-border px-3.5 py-3">
          <div className="text-[13.5px] font-semibold text-text tracking-wide">Chats &amp; Channels</div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setCreateChatOpen(true)}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-primary hover:bg-primary/90 text-white text-[12px] font-semibold shadow-xs transition-all active:scale-95 cursor-pointer"
              title="Create Channel or Group"
            >
              <SquarePen size={13} strokeWidth={2.2} />
              <span>Create</span>
            </button>
            <button
              type="button"
              onClick={() => setOpenChat(true)}
              className="flex items-center gap-1.5 px-2 py-1 rounded-lg border border-border bg-tile/70 hover:bg-tile hover:border-primary/50 text-text-2 hover:text-text text-[12px] font-medium transition-all active:scale-95 cursor-pointer"
              title="Connect Channel"
            >
              <Plus size={13} strokeWidth={2.2} />
              <span>Join</span>
            </button>
          </div>
        </div>

        <div className="p-3 border-b border-border space-y-2">
          <SearchInput
            placeholder="Search chats or channels…"
            value={chatSearch}
            onChange={setChatSearch}
          />
          <div className="flex flex-wrap gap-1">
            <Chip
              label="All"
              active={!inArchiveFolder && chatKind === 'all'}
              onClick={() => { setInArchiveFolder(false); setChatKind('all'); setSelectedFolderId(null) }}
            />
            <Chip
              label="Channels"
              active={!inArchiveFolder && chatKind === 'channels'}
              onClick={() => { setInArchiveFolder(false); setChatKind('channels'); setSelectedFolderId(null) }}
            />
            <Chip
              label="Groups"
              active={!inArchiveFolder && chatKind === 'groups'}
              onClick={() => { setInArchiveFolder(false); setChatKind('groups'); setSelectedFolderId(null) }}
            />
            {allFolders.length > 0 && (
              <Chip
                label="Folders"
                active={!inArchiveFolder && chatKind === 'folders'}
                onClick={() => {
                  setInArchiveFolder(false)
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



        <div className="flex-1 overflow-y-auto p-2 space-y-1 no-scrollbar">
          {chatsErr ? (
            <ErrorState error={chatsErr} onRetry={chatsReload} />
          ) : !chatsData ? (
            <div className="space-y-1 p-1">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3 rounded-xl py-2.5 px-3 min-h-[58px] bg-tile/40 animate-pulse">
                  <div className="size-[38px] rounded-full bg-tile/80 shrink-0" />
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <div className="h-3.5 bg-tile/80 rounded w-3/4" />
                    <div className="h-2.5 bg-tile/60 rounded w-1/2" />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <>
              {/* In Archive Folder header */}
              {inArchiveFolder && (
                <div className="flex items-center justify-between p-2 mb-1.5 rounded-xl border border-primary/30 bg-primary/10">
                  <button
                    type="button"
                    onClick={() => setInArchiveFolder(false)}
                    className="flex items-center gap-2 text-[12.5px] font-semibold text-text hover:text-primary transition-colors cursor-pointer"
                  >
                    <ArrowLeft size={15} />
                    <span>Archived Chats</span>
                    <span className="text-[11px] text-muted font-normal">({archivedChatsList.length})</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setInArchiveFolder(false)}
                    className="text-[11px] text-primary hover:underline cursor-pointer"
                  >
                    Back
                  </button>
                </div>
              )}

              {/* Archive folder item row at top of main chat list (hidden in Folders tab) */}
              {!inArchiveFolder && chatKind !== 'folders' && archivedChatsList.length > 0 && (
                <div
                  onClick={() => {
                    setInArchiveFolder(true)
                    setSelectedFolderId(null)
                  }}
                  className="flex w-full items-center gap-2.5 rounded-xl p-2 text-left transition-colors cursor-pointer hover:bg-tile/80 border border-border/60 bg-tile/40 group mb-1.5 shadow-2xs"
                >
                  <span className="grid size-8 shrink-0 place-items-center rounded-lg border border-primary/25 bg-primary/10 text-primary">
                    <Archive size={16} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between">
                      <div className="text-[13px] font-semibold text-text group-hover:text-primary transition-colors">Archived Chats</div>
                      <span className="text-[10.5px] font-medium text-muted bg-panel px-1.5 py-0.5 rounded border border-border">
                        {archivedChatsList.length}
                      </span>
                    </div>
                    <div className="text-[11px] text-muted truncate mt-0.5">
                      {archivedChatsList.length === 1 ? '1 chat archived' : `${archivedChatsList.length} chats archived`}
                    </div>
                  </div>
                </div>
              )}

              {filteredChats.length === 0 ? (
                <div className="py-8 text-center text-muted text-[12px]">
                  <p>{inArchiveFolder ? 'No archived chats' : chatKind === 'folders' ? 'No chats in this folder' : 'No chats found'}</p>
                  {inArchiveFolder ? (
                    <Button variant="secondary" className="mt-2 text-[11px] py-1 px-3" onClick={() => setInArchiveFolder(false)}>Back to Chats</Button>
                  ) : (
                    <Button variant="secondary" className="mt-2 text-[11px] py-1 px-3" onClick={() => setOpenChat(true)}>Connect Channel</Button>
                  )}
                </div>
              ) : (
                filteredChats.map((c: any) => {
                  const active = activeChatId === c.id
                  const isChatPinnedNow = isPinned(c.id) || Boolean(c.isPinned)
                  const isChatMutedNow = isMuted(c.id) || Boolean(c.isMuted)

                  return (
                    <div
                      key={c.id}
                      onContextMenu={(e) => {
                        e.preventDefault()
                        e.stopPropagation()
                        const menuWidth = 220
                        const menuHeight = 280
                        const clientX = e.clientX || 200
                        const clientY = e.clientY || 200
                        const x = clientX + menuWidth > window.innerWidth
                          ? Math.max(10, clientX - menuWidth)
                          : Math.min(window.innerWidth - menuWidth - 10, Math.max(10, clientX))
                        const y = clientY + menuHeight > window.innerHeight
                          ? Math.max(10, clientY - menuHeight)
                          : Math.min(window.innerHeight - menuHeight - 10, Math.max(10, clientY))
                        setChatContextMenu({ x, y, chat: c })
                      }}
                      onClick={() => {
                        if (c.id !== activeChatId) {
                          const savedMode = chatViewModes[c.id] || 'files'
                          setView(savedMode)
                        }
                        setChatId(c.id)
                        setSelectedIds([])
                        c.unread = 0
                      }}
                      className={`group relative flex w-full items-center gap-3 rounded-xl py-2.5 px-3 text-left transition-all cursor-pointer select-none min-h-[58px] ${
                        active
                          ? 'bg-primary/20 border border-primary/30 text-text'
                          : 'hover:bg-tile/80 text-text-2 hover:text-text border border-transparent'
                      }${enteringIds.has(c.id) ? ' animate-in fade-in slide-in-from-left-4 duration-300' : ''}${
                        leavingChatId === c.id ? ' animate-out fade-out slide-out-to-left-4 duration-200 pointer-events-none' : ''
                      }`}
                    >
                      <Avatar src={c.photo} name={c.title} size={38} />
                      <div className="min-w-0 flex-1 flex flex-col justify-center gap-1">
                        <div className="flex items-center justify-between gap-1.5 leading-tight">
                          <span className="flex-1 min-w-0 truncate text-[13.5px] font-semibold text-text" title={c.title}>
                            {c.title}
                          </span>
                          <div className="flex items-center gap-1.5 shrink-0">
                            {isChatMutedNow && (
                              <span title="Muted notifications" className="inline-flex items-center text-muted">
                                <BellOff size={11} />
                              </span>
                            )}
                            {isChatPinnedNow && (
                              <span title="Pinned to top" className="inline-flex items-center text-primary">
                                <Pin size={11} />
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center justify-between gap-2 text-[11.5px] text-muted leading-tight">
                          {typingMap[c.id] ? (
                            <span className="min-w-0 truncate text-cyan font-medium flex items-center gap-1.5 leading-none">
                              <span className="relative flex size-2 items-center justify-center shrink-0">
                                <span className="absolute inline-flex size-full rounded-full bg-cyan opacity-75 animate-ping" />
                                <span className="relative inline-flex size-1.5 rounded-full bg-cyan" />
                              </span>
                              <span className="min-w-0 truncate leading-none">{typingMap[c.id]}</span>
                            </span>
                          ) : (
                            <span className="min-w-0 truncate" title={c.username ? `@${c.username}` : c.kind}>
                              {c.username ? `@${c.username}` : c.kind}
                            </span>
                          )}
                          <div className="flex items-center gap-1.5 shrink-0">
                            {/* The date rides the subtitle row so the title keeps the whole first row (bug 35). */}
                            {c.lastDate ? (
                              <span className="whitespace-nowrap text-[11px] text-muted" title={fmtDate(c.lastDate)}>
                                {fmtAgo(c.lastDate)}
                              </span>
                            ) : null}
                            {c.unread > 0 && (
                              <span className="flex items-center justify-center min-w-5 h-4.5 px-1.5 rounded-full bg-primary text-[10.5px] font-bold text-white shadow-xs">
                                {c.unread > 99 ? '99+' : c.unread}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  )
                })
              )}
            </>
          )}
        </div>
      </div>

      {/* Resize Handle / Support Divider */}
      <div
        onMouseDown={handleSidebarResizeStart}
        className={`relative w-2.5 -ml-1 shrink-0 z-20 cursor-col-resize select-none group flex items-center justify-center transition-colors ${
          isResizingSidebar ? 'bg-transparent' : 'hover:bg-primary/25'
        }`}
        title="Drag to resize Chats & Channels panel"
      >
        <div className={`w-0.5 h-10 rounded-full transition-colors ${
          isResizingSidebar ? 'bg-border' : 'bg-border/80 group-hover:bg-primary'
        }`} />
      </div>

      {/* Column 2: Files View / Chat View (Center flexible) */}
      <div className={`flex flex-1 flex-col ${view === 'chat' ? 'overflow-hidden min-h-0' : 'overflow-y-auto [scrollbar-gutter:stable]'} p-5 space-y-4`}>
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


        {/* Media index bar: modern elevated SaaS status card */}
        {scan && (scan.state === 'scanning' || scan.state === 'failed' || scan.state === 'paused') && (
          <div
            role="status"
            aria-live="polite"
            className={`rounded-xl border p-3 shadow-xs transition-all duration-300 ${
              scan.state === 'failed'
                ? 'border-danger/35 bg-danger/10'
                : scan.state === 'paused'
                ? 'border-amber-400/35 bg-amber-400/10'
                : 'border-primary/35 bg-card/90 backdrop-blur-md shadow-[0_2px_12px_rgba(59,130,246,0.06)]'
            }`}
          >
            <div className="flex items-center justify-between gap-3 flex-wrap sm:flex-nowrap">
              <div className="flex items-center gap-3 min-w-0">
                <div
                  className={`size-8 rounded-lg flex items-center justify-center shrink-0 border ${
                    scan.state === 'failed'
                      ? 'bg-danger/15 text-danger border-danger/30'
                      : scan.state === 'paused'
                      ? 'bg-amber-400/15 text-amber-500 border-amber-400/30'
                      : 'bg-primary/15 text-primary border-primary/30'
                  }`}
                >
                  {scan.state === 'scanning' && <RefreshCw size={15} className="animate-spin text-primary" />}
                  {scan.state === 'paused' && <Pause size={15} className="text-amber-500" />}
                  {scan.state === 'failed' && <AlertCircle size={15} className="text-danger" />}
                </div>

                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-[12.5px] font-semibold text-text leading-tight">
                      {scan.state === 'scanning'
                        ? 'Indexing Channel Media'
                        : scan.state === 'paused'
                        ? 'Indexing Paused'
                        : 'Indexing Interrupted'}
                    </span>
                  </div>

                  <div className="flex items-center gap-2 mt-0.5 text-[11px] text-muted flex-wrap">
                    {scan.state === 'scanning' && (
                      <>
                        <span className="font-mono text-text tabular-nums font-medium">
                          {scan.indexed.toLocaleString()}
                          {scan.total ? ` of ~${scan.total.toLocaleString()} items` : ' items found'}
                        </span>
                        {scan.total ? (
                          <span className="font-mono text-primary font-semibold">({scanPct}%)</span>
                        ) : null}
                        {scanEta !== null ? (
                          <span className="inline-flex items-center gap-1 text-muted/90 bg-border/40 px-1.5 py-0.2 rounded text-[10.5px]">
                            <Clock size={10} className="opacity-75" /> {fmtLeft(scanEta)} left
                          </span>
                        ) : null}
                      </>
                    )}
                    {scan.state === 'paused' && (
                      <span className="font-mono text-text tabular-nums">
                        Paused at {scan.indexed.toLocaleString()}
                        {scan.total ? ` of ~${scan.total.toLocaleString()} items` : ' files'}
                        {scan.total ? ` (${scanPct}%)` : ''}
                      </span>
                    )}
                    {scan.state === 'failed' && (
                      <span className="text-danger/90">
                        {scan.error || 'Telegram refused the request or connection reset'}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0 ml-auto">
                {scan.state === 'scanning' && (
                  <Button
                    variant="secondary"
                    className="py-1 px-3 text-[11px] shrink-0 flex items-center gap-1.5 cursor-pointer shadow-xs"
                    onClick={() => rescan('chats.stopScan')}
                    title="Stop indexing media in this channel"
                  >
                    <Pause size={12} className="opacity-80" />
                    <span>Stop</span>
                  </Button>
                )}
                {scan.state !== 'scanning' && (
                  <Button
                    variant="primary"
                    className="py-1 px-3.5 text-[11px] shrink-0 flex items-center gap-1.5 cursor-pointer shadow-sm font-semibold"
                    onClick={() => rescan('chats.rescan')}
                    title={scan.state === 'failed' ? 'Retry indexing' : 'Resume indexing'}
                  >
                    {scan.state === 'failed' ? (
                      <>
                        <RotateCcw size={12} />
                        <span>Retry</span>
                      </>
                    ) : (
                      <>
                        <Play size={12} fill="currentColor" />
                        <span>Resume</span>
                      </>
                    )}
                  </Button>
                )}
              </div>
            </div>

            {scan.state !== 'failed' && (
              <div className="mt-2 h-1.5 w-full rounded-full bg-border/50 overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-300 ${
                    scan.total
                      ? 'bg-gradient-to-r from-primary to-blue-500 shadow-xs'
                      : 'w-1/2 animate-pulse bg-primary/75'
                  }`}
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
            {(activeChat || (!chatsData && !chatsErr)) && (
              <div className="flex items-center justify-between pb-3 border-b border-border/40 gap-4">
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  {activeChat ? (
                    <Avatar src={activeChat.photo} name={activeChat.title} size={34} />
                  ) : (
                    <div className="size-[34px] shrink-0 rounded-full bg-tile" />
                  )}
                  <div className="min-w-0">
                    <div className="text-[14px] font-bold text-text truncate leading-tight tracking-wide">
                      {activeChat ? activeChat.title : <span className="inline-block h-4 w-44 rounded bg-tile" />}
                    </div>
                    <div className="text-[11.5px] text-muted truncate leading-tight mt-0.5">
                      {activeChat ? (
                        <>{activeChat.username ? `@${activeChat.username}` : activeChat.kind || 'Channel'} • {mediaData?.total ?? 0} files</>
                      ) : (
                        <span className="inline-block h-3 w-64 rounded bg-tile" />
                      )}
                    </div>
                  </div>
                </div>

                {/* Search files in this channel aligned with chat name */}
                <div className="w-72 shrink-0">
                  <SearchInput
                    placeholder="Search files in this channel…"
                    value={fileSearch}
                    onChange={(v) => { setFileSearch(v); setPage(1) }}
                  />
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

              {/* View mode toggle switch */}
              <div className="flex items-center rounded-md border border-border bg-tile p-0.5" role="group" aria-label="View mode">
                <button
                  type="button"
                  onClick={() => setFileViewMode('table')}
                  className={`flex items-center gap-1.5 rounded px-2.5 py-1 text-[12px] transition-colors cursor-pointer ${
                    fileViewMode === 'table' ? 'bg-primary text-white font-medium shadow-xs' : 'text-text-2 hover:text-text'
                  }`}
                  title="Table view"
                >
                  <List size={13} />
                  <span>Table</span>
                </button>
                <button
                  type="button"
                  onClick={() => setFileViewMode('grid')}
                  className={`flex items-center gap-1.5 rounded px-2.5 py-1 text-[12px] transition-colors cursor-pointer ${
                    fileViewMode === 'grid' ? 'bg-primary text-white font-medium shadow-xs' : 'text-text-2 hover:text-text'
                  }`}
                  title="Grid view (Telegram)"
                >
                  <LayoutGrid size={13} />
                  <span>Grid</span>
                </button>
              </div>

              {/* Grid size switch (visible when Grid View is active) */}
              {fileViewMode === 'grid' && (
                <div className="flex items-center rounded-md border border-border bg-tile p-0.5 text-xs text-text-2" role="group" aria-label="Grid size">
                  {(['md', 'lg', 'xl'] as const).map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => setGridSize(s)}
                      className={`rounded px-2.5 py-0.5 uppercase text-[11px] font-semibold transition-colors cursor-pointer ${
                        gridSize === s ? 'bg-primary text-white shadow-xs' : 'text-muted hover:text-text'
                      }`}
                      title={`Grid size: ${s === 'md' ? 'Medium' : s === 'lg' ? 'Large' : 'Extra Large'}`}
                    >
                      {s.toUpperCase()}
                    </button>
                  ))}
                </div>
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

            {/* Selection bar if items are selected - Floating bottom action bar centered inside table */}
            {selectedIds.length > 0 && (
              <div
                className="pointer-events-none fixed bottom-6 z-40 flex justify-center"
                style={{
                  left: containerBounds ? `${containerBounds.left}px` : undefined,
                  width: containerBounds ? `${containerBounds.width}px` : undefined,
                  ...(containerBounds ? {} : { left: '50%', transform: 'translateX(-50%)' }),
                }}
              >
                <div
                  data-testid="selection-action-bar"
                  className="pointer-events-auto flex items-center gap-4 rounded-xl border border-primary/40 bg-panel/95 px-5 py-3 text-[13px] text-text shadow-2xl backdrop-blur-md animate-in fade-in slide-in-from-bottom-3 duration-200"
                >
                  <div className="font-semibold flex items-center gap-2 text-text">
                    <CheckSquare size={16} className="text-primary" />
                    <span>{selectedIds.length} items selected</span>
                  </div>
                  <div className="h-4 w-px bg-border/80" />
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
                      className="text-[12px] text-muted hover:text-text ml-1 underline cursor-pointer"
                    >
                      Clear
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Files View Table or Telegram Grid */}
            {(() => {
              const gridColsClass =
                gridSize === 'md'
                  ? 'grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7 gap-3.5'
                  : gridSize === 'lg'
                  ? 'grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4'
                  : 'grid grid-cols-1 sm:grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5'

              const aspectClass =
                gridSize === 'md' ? 'aspect-[16/10]' : 'aspect-video'

              return (
                <div
                  ref={filesContainerRef}
                  onMouseDown={handleDragSelectMouseDown}
                  className="relative rounded-[14px] border border-border bg-panel/85 p-3 flex-1 flex flex-col justify-between"
                >
                  {mediaErr ? (
                    <ErrorState error={mediaErr} onRetry={mediaReload} />
                  ) : !mediaData ? (
                    fileViewMode === 'grid' ? (
                      <div className={gridColsClass}>
                        {Array.from({ length: 12 }).map((_, i) => (
                          <div key={i} className="flex flex-col rounded-xl border border-border/50 bg-tile/40 overflow-hidden animate-pulse">
                            <div className={`w-full ${aspectClass} bg-tile/70`} />
                            <div className="p-2.5 space-y-2">
                              <div className="h-3.5 bg-tile rounded w-3/4" />
                              <div className="h-2.5 bg-tile/80 rounded w-1/2" />
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="space-y-2.5 p-2">
                        {Array.from({ length: 10 }).map((_, i) => (
                          <div key={i} className="flex items-center gap-3 py-2.5 px-3 rounded-lg bg-tile/30 animate-pulse">
                            <div className="size-4 bg-tile rounded" />
                            <div className="h-7 w-10 bg-tile rounded" />
                            <div className="h-3.5 bg-tile rounded flex-1" />
                            <div className="h-3.5 bg-tile rounded w-20" />
                            <div className="h-3.5 bg-tile rounded w-20" />
                          </div>
                        ))}
                      </div>
                    )
                  ) : mediaItems.length === 0 ? (
                    <div className="py-16 text-center">
                      <Empty message="No media files found matching the criteria" />
                      <Button variant="secondary" onClick={resetFilters} className="mt-2 text-[12px]">Reset filters</Button>
                    </div>
                  ) : fileViewMode === 'grid' ? (
                    <div>
                      {/* Grid sub-toolbar: Select all and item counter */}
                      <div className="flex items-center justify-between pb-2.5 mb-3 border-b border-border/60 text-[12px] text-muted">
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={toggleSelectAll}
                            className="flex items-center gap-1.5 text-muted hover:text-text transition-colors cursor-pointer select-none"
                          >
                            {selectedIds.length === mediaItems.length && mediaItems.length > 0 ? (
                              <CheckSquare size={15} className="text-primary" />
                            ) : (
                              <Square size={15} />
                            )}
                            <span className="font-medium">Select All</span>
                          </button>
                          {selectedIds.length > 0 && (
                            <span className="text-primary font-semibold">({selectedIds.length} selected)</span>
                          )}
                        </div>
                        <div className="tabular-nums">
                          Showing {mediaItems.length} of {mediaData.total} items
                        </div>
                      </div>

                      {/* Telegram Media Grid */}
                      <div className={gridColsClass}>
                        {mediaItems.map((m: any) => {
                          const isSelected = selectedIds.includes(m.messageId)
                          return (
                            <MediaGridCard
                              key={m.messageId}
                              item={m}
                              isSelected={isSelected}
                              isHighlighted={m.messageId === highlightedMessageId}
                              selectedCount={selectedIds.length}
                              aspectClass={aspectClass}
                              onToggleSelect={() => toggleSelect(m.messageId)}
                              onPreview={() => setPreviewItem({ name: m.name, path: m.path, thumb: m.thumb, type: m.type, size: m.size, duration: m.duration, chatId: activeChatId || m.chatId, messageId: m.messageId })}
                              onDownload={(force, e) => downloadItems([{ chatId: activeChatId!, messageId: m.messageId }], force, e)}
                              onReveal={() => m.path && revealFile(m.path)}
                            />
                          )
                        })}
                      </div>
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-[13px] table-fixed">
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
                            <th className="py-2.5 px-2 text-center w-14 font-medium">Preview</th>
                            <th className="py-2.5 px-3 text-left w-auto font-medium">File Name</th>
                            <th className="py-2.5 px-2 text-center w-20 font-medium">Type</th>
                            <th className="py-2.5 px-2 text-center w-24 font-medium">Size</th>
                            <th className="py-2.5 px-2 text-center w-20 font-medium">Duration</th>
                            <th className="py-2.5 px-2 text-center w-32 font-medium">Status</th>
                            <th className="py-2.5 px-3 text-right w-24 font-medium">Action</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                        {mediaItems.map((m: any, i: number) => {
                            const isSelected = selectedIds.includes(m.messageId)
                            const isHighlighted = m.messageId === highlightedMessageId
                            return (
                              <tr
                                key={m.messageId}
                                data-message-id={m.messageId}
                                data-testid="media-table-row"
                                className={`transition-all duration-300 ${
                                  isHighlighted
                                    ? 'bg-primary/20 ring-2 ring-primary ring-inset shadow-md font-medium text-text'
                                    : isSelected
                                    ? 'bg-primary/10 hover:bg-tile/70'
                                    : 'hover:bg-tile/70'
                                }`}
                              >
                                <td className="py-2.5 px-1 text-center">
                                  <button onClick={() => toggleSelect(m.messageId)} className="text-muted hover:text-text">
                                    {isSelected ? <CheckSquare size={15} className="text-primary" /> : <Square size={15} />}
                                  </button>
                                </td>
                                <td className="py-2.5 px-1 text-center text-muted text-[11px]">{(page - 1) * mediaPageSize + i + 1}</td>
                                <td
                                  className="py-2.5 px-2 text-center cursor-pointer hover:opacity-80 transition-opacity"
                                  title="Click for preview"
                                  onClick={() => setPreviewItem({ name: m.name, path: m.path, thumb: m.thumb, type: m.type, size: m.size, duration: m.duration, chatId: activeChatId || m.chatId, messageId: m.messageId })}
                                >
                                  <div className="flex justify-center">
                                    <Thumb src={m.thumb ? `teleflow://thumb/${m.thumb}` : null} name={m.name} />
                                  </div>
                                </td>
                                <td className="py-2.5 px-3 min-w-0 overflow-hidden">
                                  <div className="flex items-center gap-2 min-w-0 w-full">
                                    <div
                                      className="font-medium truncate text-text cursor-pointer hover:text-primary transition-colors text-[13px] min-w-0"
                                      title={m.name}
                                      onClick={() => setPreviewItem({ name: m.name, path: m.path, thumb: m.thumb, type: m.type, size: m.size, duration: m.duration, chatId: activeChatId || m.chatId, messageId: m.messageId })}
                                    >
                                      {m.name}
                                    </div>
                                    {isHighlighted && (
                                      <span className="shrink-0 rounded-full bg-primary/20 border border-primary/40 px-2 py-0.5 text-[10px] font-semibold text-primary animate-pulse">
                                        Highlighted
                                      </span>
                                    )}
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
                  {mediaData && mediaData.total > mediaPageSize && (
                    <div className="pt-3 border-t border-border mt-3">
                      <Pagination
                        page={page}
                        pageSize={mediaPageSize}
                        total={mediaData.total}
                        onPage={setPage}
                      />
                    </div>
                  )}

                  {/* Selection Marquee Overlay */}
                  {marqueeBox && (
                    <div
                      data-testid="selection-marquee"
                      className="fixed pointer-events-none z-50 rounded-lg border-2 border-primary bg-primary/20 shadow-sm backdrop-blur-[0.5px]"
                      style={{
                        left: marqueeBox.left,
                        top: marqueeBox.top,
                        width: marqueeBox.width,
                        height: marqueeBox.height,
                      }}
                    />
                  )}
                </div>
              )
            })()}
          </div>
        ) : (
          <div className="flex-1 flex flex-col min-h-0 h-full w-full">
            <ChatView
              key={activeChatId}
              chatId={activeChatId!}
              activeChat={activeChat}
              allChats={allChats}
              me={me}
              messages={msgData?.messages ?? []}
              hasMore={Boolean(msgData?.more)}
              loading={Boolean(msgLoading || loadingOlder || !msgData)}
              error={msgErr}
              onLoadOlder={handleLoadOlder}
              onReload={msgReload}
              onOpenViewer={setPreviewItem}
              onDownloadItem={handleChatDownloadItem}
              onRevealFile={revealFile}
              onOpenLink={handleTelegramLink}
              activeTyping={activeTyping}
              onSelectChat={handleSelectChatInView}
              onOpenManageSettings={handleOpenManageChatSettings}
            />
          </div>
        )}
      </div>
    </div>
  )
}
