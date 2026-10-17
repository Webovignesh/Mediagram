import React, { useState, useRef, useEffect, useLayoutEffect, useMemo, useCallback } from 'react'
import { createPortal } from 'react-dom'
import {
  Send, Paperclip, Smile, Reply, Edit3, Pin, Trash2, Copy, Check, Clock, AlertCircle,
  MoreVertical, X, ChevronDown, Download, FolderOpen, Film, Play, FileText, CornerDownRight,
  ExternalLink, CornerUpRight, Eye, Volume2, Search, Upload, Settings, CheckSquare, Sparkles
} from 'lucide-react'
import { call, on, uploadPaths, useCall, useLive } from '../api.ts'
import { Avatar, Dialog, toast, fmtBytes, fmtDuration, MediagramLogo, ChatMediaThumb, triggerFlyToQueue } from '../ui.tsx'
import type { Job } from '../../../core/db.ts'
import type { LiveStats } from '../../../core/transfers.ts'
import type { TextEntity, ReactionItem } from '../../../core/shapes.ts'

function fmtViews(views?: number | null): string {
  if (!views || views <= 0) return ''
  if (views >= 1_000_000) return (views / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M'
  if (views >= 1000) return (views / 1000).toFixed(1).replace(/\.0$/, '') + 'K'
  return String(views)
}



const QUICK_REACTIONS = ['👍', '❤️', '🔥', '🎉', '😂', '👏', '😢', '😍']

const EMOJI_CATEGORIES = {
  smileys: {
    name: 'Smileys',
    emojis: [
      '😀', '😃', '😄', '😁', '😆', '😅', '😂', '🤣', '😊', '😇',
      '🙂', '🙃', '😉', '😌', '😍', '🥰', '😘', '😗', '😙', '😚',
      '😋', '😛', '😝', '😜', '🤪', '🤨', '🧐', '🤓', '😎', '🥳',
      '😏', '😒', '😞', '😔', '😟', '😕', '🙁', '☹️', '😣', '😖',
      '😫', '😩', '🥺', '😢', '😭', '😤', '😠', '😡', '🤬', '🤯',
      '😳', '🥵', '🥶', '😱', '😨', '😰', '😥', '😓', '🤔', '🤫'
    ]
  },
  gestures: {
    name: 'Gestures',
    emojis: [
      '👍', '👎', '👊', '✊', '🤛', '🤜', '👏', '🙌', '👐', '🤲',
      '🤝', '🙏', '✍️', '💅', '🤳', '💪', '🦾', '🦿', '🦵', '🦶',
      '✌️', '🤞', '🫰', '🤟', '🤘', '🤙', '👈', '👉', '👆', '🖕',
      '👇', '☝️', '👋', '🤚', '🖐', '✋', '🖖', '👌', '🤌', '🤏'
    ]
  },
  hearts: {
    name: 'Hearts & Vibes',
    emojis: [
      '❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '🤎', '💔',
      '❣️', '💕', '💞', '💓', '💗', '💖', '💘', '💝', '💟', '🔥',
      '✨', '💥', '💯', '💢', '💨', '💫', '💬', '💭', '🗯', '💤',
      '🎉', '🎊', '🎈', '🎂', '🎁', '🪄', '🏆', '🥇', '🥈', '🥉'
    ]
  }
}

function getMessageTime(timestampSec: number): string {
  return new Date(timestampSec * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
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

function isEmojiOnly(text?: string | null): boolean {
  if (!text) return false
  const t = text.trim()
  if (!t || t.length > 14) return false
  const stripped = t.replace(/(\p{Extended_Pictographic}|\p{Emoji_Presentation}|\p{Emoji}\uFE0F|[\uFE00-\uFE0F\u200D\u200B])/gu, '')
  return stripped.length === 0
}

interface ChatUploadItem {
  id: string
  name: string
  size: number
  type: 'photo' | 'video' | 'audio' | 'document'
  previewUrl?: string
  /** The path the engine queued this file under; it is the key that binds the row to its job. */
  path?: string
  progress: number
  bytesUploaded: number
  speed: number
  status: 'queued' | 'active' | 'paused' | 'completed' | 'failed'
  error?: string
  jobId?: number
}

/** Formatted text renderer supporting Telegram TextEntity slices and markdown syntax */
export function FormattedMessageText({
  text,
  entities = [],
  onOpenLink,
}: {
  text: string
  entities?: TextEntity[]
  onOpenLink: (url: string) => void
}) {
  const [revealedSpoilers, setRevealedSpoilers] = useState<Record<number, boolean>>({})

  if (!text) return null

  // If no TDLib entities are present, fall back to smart markdown and URL linkification
  if (!entities || entities.length === 0) {
    const tokenRegex = /(```[\s\S]*?```|`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*|__[^_]+__|~~[^~]+~~|\|\|[^|]+\|\||https?:\/\/[^\s]+|t\.me\/[^\s]+|tg:\/\/[^\s]+|@\w{4,32})/g
    const parts = text.split(tokenRegex)
    return (
      <div className="whitespace-pre-wrap leading-relaxed text-[13.5px] text-text font-normal break-words">
        {parts.map((part, i) => {
          if (!part) return null
          if (part.startsWith('```') && part.endsWith('```')) {
            const code = part.slice(3, -3).replace(/^\n/, '')
            return (
              <pre key={i} className="my-1.5 rounded-lg bg-panel p-2 font-mono text-[12px] text-primary overflow-x-auto border border-border">
                <code>{code}</code>
              </pre>
            )
          }
          if (part.startsWith('`') && part.endsWith('`')) {
            return (
              <code key={i} className="rounded bg-tile px-1.5 py-0.5 font-mono text-[12px] text-primary border border-border">
                {part.slice(1, -1)}
              </code>
            )
          }
          if (part.startsWith('**') && part.endsWith('**')) {
            return <strong key={i} className="font-bold text-text">{part.slice(2, -2)}</strong>
          }
          if (part.startsWith('*') && part.endsWith('*')) {
            return <em key={i} className="italic text-text/90">{part.slice(1, -1)}</em>
          }
          if (part.startsWith('__') && part.endsWith('__')) {
            return <u key={i} className="underline underline-offset-2">{part.slice(2, -2)}</u>
          }
          if (part.startsWith('~~') && part.endsWith('~~')) {
            return <s key={i} className="line-through text-muted">{part.slice(2, -2)}</s>
          }
          if (part.startsWith('||') && part.endsWith('||')) {
            return (
              <span key={i} className="rounded bg-tile text-text px-1 py-0.5 filter blur-[3px] hover:filter-none transition-all cursor-pointer" title="Click to reveal spoiler">
                {part.slice(2, -2)}
              </span>
            )
          }
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
                className="inline-flex items-center gap-1 text-primary hover:text-primary-hover underline font-medium hover:bg-primary/10 rounded px-1 -mx-0.5 transition-colors cursor-pointer text-left break-all"
                title={isTg ? 'Open Telegram link' : 'Open in browser'}
              >
                {isTg ? <MediagramLogo size={13} className="inline shrink-0 mr-0.5 rounded-[3px]" /> : <ExternalLink size={11} className="inline shrink-0 opacity-75" />}
                <span>{part}</span>
              </button>
            )
          }
          if (/^@\w{4,32}$/.test(part)) {
            return (
              <button
                key={i}
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  onOpenLink(part)
                }}
                className="inline-flex items-center gap-0.5 text-primary font-medium hover:text-primary-hover hover:underline rounded px-1 -mx-0.5 transition-colors cursor-pointer text-left"
                title="Open profile"
              >
                {part}
              </button>
            )
          }
          return <span key={i}>{part}</span>
        })}
      </div>
    )
  }

  // Parse entities into segmented nodes
  const segments: React.ReactNode[] = []
  let lastIndex = 0
  const sorted = [...entities].sort((a, b) => a.offset - b.offset)

  sorted.forEach((entity, idx) => {
    if (entity.offset > lastIndex) {
      segments.push(
        <span key={`plain-${lastIndex}`}>{text.substring(lastIndex, entity.offset)}</span>
      )
    }

    const content = text.substring(entity.offset, entity.offset + entity.length)
    const key = `ent-${idx}-${entity.offset}`

    switch (entity.type) {
      case 'bold':
        segments.push(<strong key={key} className="font-bold text-text">{content}</strong>)
        break
      case 'italic':
        segments.push(<em key={key} className="italic text-text/90">{content}</em>)
        break
      case 'underline':
        segments.push(<u key={key} className="underline underline-offset-2">{content}</u>)
        break
      case 'strikethrough':
        segments.push(<s key={key} className="line-through text-muted">{content}</s>)
        break
      case 'code':
        segments.push(
          <code
            key={key}
            onClick={(e) => {
              e.stopPropagation()
              navigator.clipboard.writeText(content)
            }}
            className="rounded bg-tile px-1.5 py-0.5 font-mono text-[12px] text-primary border border-border select-all cursor-pointer hover:bg-tile/80 transition-colors"
            title="Click to copy code"
          >
            {content}
          </code>
        )
        break
      case 'pre':
        segments.push(
          <div key={key} className="relative my-2 rounded-xl bg-panel p-3 font-mono text-[12px] text-text border border-border overflow-x-auto group/pre">
            <pre className="whitespace-pre">{content}</pre>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                navigator.clipboard.writeText(content)
              }}
              className="absolute top-2 right-2 p-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-muted hover:text-text transition-colors"
              title="Copy code block"
            >
              <Copy size={13} />
            </button>
          </div>
        )
        break
      case 'spoiler': {
        const isRevealed = revealedSpoilers[entity.offset]
        segments.push(
          <span
            key={key}
            onClick={(e) => {
              e.stopPropagation()
              setRevealedSpoilers((prev) => ({ ...prev, [entity.offset]: !prev[entity.offset] }))
            }}
            className={`cursor-pointer rounded px-1 transition-all ${
              isRevealed
                ? 'bg-tile text-text'
                : 'bg-black/40 text-transparent select-none blur-[4px] hover:blur-[3px]'
            }`}
            title="Click to reveal spoiler"
          >
            {content}
          </span>
        )
        break
      }
      case 'url': {
        const targetUrl = entity.url || content
        segments.push(
          <button
            key={key}
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onOpenLink(targetUrl)
            }}
            className="inline-flex items-center gap-0.5 text-primary hover:text-primary-hover underline font-medium hover:bg-primary/10 rounded px-1 -mx-0.5 transition-colors cursor-pointer text-left break-all"
            title="Open link"
          >
            <ExternalLink size={11} className="inline shrink-0 opacity-75 mr-0.5" />
            <span>{content}</span>
          </button>
        )
        break
      }
      case 'mention':
        segments.push(
          <button
            key={key}
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onOpenLink(entity.userId ? `tg://user?id=${entity.userId}` : content)
            }}
            className="inline-flex items-center gap-0.5 text-primary font-medium hover:text-primary-hover hover:underline rounded px-1 -mx-0.5 transition-colors cursor-pointer text-left"
            title="Open profile"
          >
            {content}
          </button>
        )
        break
      case 'botCommand': {
        const botName = content.includes('@') ? content.slice(content.indexOf('@') + 1) : null
        segments.push(
          <button
            key={key}
            type="button"
            disabled={!botName}
            onClick={(e) => {
              e.stopPropagation()
              if (botName) onOpenLink(`@${botName}`)
            }}
            className={`inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 font-mono text-[12px] border border-border transition-colors text-left ${
              botName
                ? 'bg-tile text-primary hover:bg-primary/10 cursor-pointer'
                : 'bg-tile text-text/80 cursor-default opacity-80'
            }`}
            title={botName ? `Open @${botName}` : 'Bot command'}
          >
            {content}
          </button>
        )
        break
      }
      default:
        segments.push(<span key={key}>{content}</span>)
        break
    }

    lastIndex = entity.offset + entity.length
  })

  if (lastIndex < text.length) {
    segments.push(<span key={`tail-${lastIndex}`}>{text.substring(lastIndex)}</span>)
  }

  return <p className="whitespace-pre-wrap leading-relaxed text-[13.5px] text-text font-normal break-words">{segments}</p>
}

interface ChatViewProps {
  chatId: number
  activeChat: any
  allChats?: any[]
  me: any
  messages: any[]
  hasMore: boolean
  loading: boolean
  error: any
  onLoadOlder: () => void
  onReload: () => void
  onOpenViewer: (item: any) => void
  onDownloadItem: (item: { chatId: number, messageId: number }, force?: boolean, e?: React.MouseEvent) => void
  onRevealFile: (path: string) => void
  onOpenLink: (url: string) => void
  activeTyping: string | null
  onSelectChat?: (chatId: number) => void
  onOpenManageSettings?: () => void
}

const EMPTY_CHATS: any[] = []

export function ChatView({
  chatId,
  activeChat,
  allChats = EMPTY_CHATS,
  me,
  messages,
  hasMore,
  loading,
  onLoadOlder,
  onReload,
  onOpenViewer,
  onDownloadItem,
  onRevealFile,
  onOpenLink,
  activeTyping,
  onSelectChat,
  onOpenManageSettings,
}: ChatViewProps) {
  const [inputText, setInputText] = useState('')
  const [sending, setSending] = useState(false)
  const [replyingTo, setReplyingTo] = useState<any | null>(null)
  const [editingMessage, setEditingMessage] = useState<any | null>(null)
  const [forwardingMessage, setForwardingMessage] = useState<any | null>(null)
  const [forwardingMessageIds, setForwardingMessageIds] = useState<number[]>([])
  const [selectedTargetChatIds, setSelectedTargetChatIds] = useState<Set<number>>(new Set())
  const [forwardingBulkProgress, setForwardingBulkProgress] = useState(false)
  const [isSelectingMessages, setIsSelectingMessages] = useState(false)
  const [selectedMessageIds, setSelectedMessageIds] = useState<Set<number>>(new Set())
  const [bulkDeleteModalOpen, setBulkDeleteModalOpen] = useState(false)
  const [bulkDeleteRevoke, setBulkDeleteRevoke] = useState(true)
  const [bulkDeleteBusy, setBulkDeleteBusy] = useState(false)
  const [forwardSearch, setForwardSearch] = useState('')
  const [sendAsCopy, setSendAsCopy] = useState(false)
  const [forwardingTargetId, setForwardingTargetId] = useState<number | null>(null)
  const [chatMsgSearch, setChatMsgSearch] = useState('')
  const [mediaOnly, setMediaOnly] = useState(false)
  const [showScrollBottom, setShowScrollBottom] = useState(false)
  const [emojiPickerOpen, setEmojiPickerOpen] = useState(false)
  const [emojiCategory, setEmojiCategory] = useState<'smileys' | 'gestures' | 'hearts'>('smileys')
  const [optimisticReactions, setOptimisticReactions] = useState<Record<number, ReactionItem[]>>({})
  const [pendingUploads, setPendingUploads] = useState<ChatUploadItem[]>([])
  const { data: uploadJobs, reload: reloadUploads } = useCall<{ items: Job[], total: number }>(
    'jobs.list', { kind: 'upload', chatId, page: 1, pageSize: 100 }, ['jobs'])
  const live = useLive()
  const { data: initialStats } = useCall<LiveStats>('stats.live', {}, [])
  const activeStatsList = (live.stats ?? initialStats)?.active ?? []
  const activeUploads = new Map(activeStatsList.map((j) => [j.id, j]))

  // Active uploads from live stats for this chat (even before jobs.list completes/reloads)
  const activeChatLiveJobs: ChatUploadItem[] = activeStatsList
    .filter((j) => j.kind === 'upload' && Number(j.chatId) === Number(chatId) && !j.finalizing)
    .map((j) => {
      const size = j.size
      const done = Math.min(j.done, size)
      return {
        id: `job-${j.id}`,
        jobId: j.id,
        name: j.name || 'Uploading file…',
        size,
        type: (j.type as ChatUploadItem['type']) || 'document',
        progress: size > 0 ? Math.min(100, Math.round(done / size * 100)) : 0,
        bytesUploaded: done,
        speed: j.speed ?? 0,
        status: (j.status as ChatUploadItem['status']) || 'active',
        error: j.error ?? undefined,
      }
    })

  const dbChatJobs: ChatUploadItem[] = (uploadJobs?.items ?? [])
    .filter((j) => Number(j.chatId) === Number(chatId) && j.status !== 'completed')
    .map((j) => {
      const active = activeUploads.get(j.id)
      const size = active?.size || j.size
      const done = Math.min(active?.done ?? j.done, size)
      return {
        id: `job-${j.id}`,
        jobId: j.id,
        name: j.name,
        size,
        type: j.type as ChatUploadItem['type'],
        progress: size > 0 ? Math.min(100, Math.round(done / size * 100)) : 0,
        bytesUploaded: done,
        speed: active?.speed ?? 0,
        status: j.status,
        error: j.error ?? undefined,
      }
    })

  const seenJobIds = new Set<number>()
  const mergedJobs: ChatUploadItem[] = []
  for (const item of [...dbChatJobs, ...activeChatLiveJobs]) {
    if (item.jobId) {
      if (seenJobIds.has(item.jobId)) continue
      seenJobIds.add(item.jobId)
    }
    mergedJobs.push(item)
  }
  const chatUploads: ChatUploadItem[] = [...pendingUploads, ...mergedJobs]

  // Reconcile optimistic reactions on messages update or chat switch
  useEffect(() => {
    setOptimisticReactions({})
  }, [messages, chatId])

  // Direct subscription to live messages invalidation for instant update
  useEffect(() => {
    if (!chatId) return
    const targetTopic = `messages:${chatId}`
    const unsub = on((event) => {
      if (event.type === 'invalidate' && event.topics.includes(targetTopic)) {
        onReload()
      }
    })
    return unsub
  }, [chatId, onReload])

  async function openSender(message: any) {
    try {
      const result = await call<{ chat: { id: number } }>('chats.openSender', {
        chatId,
        messageId: message.id,
        senderId: message.senderId,
      })
      onSelectChat?.(result.chat.id)
    } catch (e) { toast((e as Error).message, 'danger') }
  }

  // Context Menu State
  const [contextMenu, setContextMenu] = useState<{ x: number, y: number, message: any } | null>(null)
  const [deleteModalOpen, setDeleteModalOpen] = useState(false)
  const [messageToDelete, setMessageToDelete] = useState<any | null>(null)
  const [deleteRevoke, setDeleteRevoke] = useState(true)

  const chatScrollRef = useRef<HTMLDivElement | null>(null)
  const messagesEndRef = useRef<HTMLDivElement | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const emojiPickerRef = useRef<HTMLDivElement | null>(null)
  const lastTypingTime = useRef<number>(0)
  const prevScrollHeightRef = useRef<number>(0)
  const prevScrollTopRef = useRef<number>(0)
  const [localLoadingOlder, setLocalLoadingOlder] = useState(false)

  // Preserve scroll position when older messages are loaded into the top
  useLayoutEffect(() => {
    if (prevScrollHeightRef.current > 0 && chatScrollRef.current) {
      const newScrollHeight = chatScrollRef.current.scrollHeight
      const diff = newScrollHeight - prevScrollHeightRef.current
      if (diff > 0) {
        chatScrollRef.current.scrollTop = prevScrollTopRef.current + diff
      }
      prevScrollHeightRef.current = 0
    }
    const timer = setTimeout(() => setLocalLoadingOlder(false), 300)
    return () => clearTimeout(timer)
  }, [messages.length])

  // Reset reply/edit/forward state on chat change
  useEffect(() => {
    setReplyingTo(null)
    setEditingMessage(null)
    setForwardingMessage(null)
    setForwardingMessageIds([])
    setSelectedTargetChatIds(new Set())
    setIsSelectingMessages(false)
    setSelectedMessageIds(new Set())
    setInputText('')
    setContextMenu(null)
    setEmojiPickerOpen(false)
    setOptimisticReactions({})
    setPendingUploads([])
  }, [chatId])

  function handleSelectForward(m: any) {
    setForwardingMessage(m)
    setForwardingMessageIds([m.id])
    setForwardSearch('')
    setSendAsCopy(false)
    setSelectedTargetChatIds(new Set())
  }

  function handleStartSelectMessage(m: any) {
    setContextMenu(null)
    setIsSelectingMessages(true)
    setSelectedMessageIds(new Set([m.id]))
  }

  function toggleSelectMessage(id: number) {
    setSelectedMessageIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function handleForwardSelectedMessages() {
    if (!selectedMessageIds.size) return
    const ids = Array.from(selectedMessageIds)
    const firstMsg = messages.find((m: any) => ids.includes(m.id))
    setForwardingMessage(firstMsg || { id: ids[0], text: `${ids.length} messages` })
    setForwardingMessageIds(ids)
    setForwardSearch('')
    setSendAsCopy(false)
    setSelectedTargetChatIds(new Set())
  }

  function handleDeleteSelectedMessages() {
    if (!selectedMessageIds.size) return
    setBulkDeleteRevoke(true)
    setBulkDeleteModalOpen(true)
  }

  async function handleConfirmBulkDelete() {
    if (!selectedMessageIds.size) return
    const ids = Array.from(selectedMessageIds).sort((a, b) => a - b)
    const count = ids.length
    setBulkDeleteBusy(true)
    try {
      await call('messages.delete', {
        chatId,
        messageIds: ids,
        revoke: bulkDeleteRevoke,
      })
      toast(`Deleted ${count} message${count > 1 ? 's' : ''}`, 'info')
      setBulkDeleteModalOpen(false)
      setIsSelectingMessages(false)
      setSelectedMessageIds(new Set())
      onReload?.()
    } catch (e: any) {
      toast(e?.message || 'Failed to delete messages', 'danger')
    } finally {
      setBulkDeleteBusy(false)
    }
  }

  function toggleTargetChat(targetId: number) {
    setSelectedTargetChatIds((prev) => {
      const next = new Set(prev)
      if (next.has(targetId)) next.delete(targetId)
      else next.add(targetId)
      return next
    })
  }

  async function handleConfirmForward(targetChat: any) {
    const msgIds = forwardingMessageIds.length > 0 ? forwardingMessageIds : (forwardingMessage ? [forwardingMessage.id] : [])
    if (!msgIds.length) return
    setForwardingTargetId(targetChat.id)
    try {
      await call('messages.forward', {
        fromChatId: chatId,
        toChatId: targetChat.id,
        messageIds: msgIds,
        sendCopy: sendAsCopy,
      })
      toast(`Message${msgIds.length > 1 ? 's' : ''} forwarded to ${targetChat.title}`)
      setForwardingMessage(null)
      setForwardingMessageIds([])
      setSelectedTargetChatIds(new Set())
      if (isSelectingMessages) {
        setIsSelectingMessages(false)
        setSelectedMessageIds(new Set())
      }
    } catch (err: any) {
      toast(err?.message || 'Failed to forward message', 'danger')
    } finally {
      setForwardingTargetId(null)
    }
  }

  async function handleBulkForwardToTargets() {
    if (!selectedTargetChatIds.size || !forwardingMessageIds.length) return
    setForwardingBulkProgress(true)
    const targetIds = Array.from(selectedTargetChatIds)
    const msgIds = forwardingMessageIds
    let successCount = 0
    try {
      for (const targetId of targetIds) {
        await call('messages.forward', {
          fromChatId: chatId,
          toChatId: targetId,
          messageIds: msgIds,
          sendCopy: sendAsCopy,
        }).catch((err) => {
          console.error(`Failed to forward to chat ${targetId}:`, err)
        })
        successCount++
      }
      toast(`Forwarded ${msgIds.length} message${msgIds.length > 1 ? 's' : ''} to ${successCount} chat${successCount > 1 ? 's' : ''}`)
      setForwardingMessage(null)
      setForwardingMessageIds([])
      setSelectedTargetChatIds(new Set())
      if (isSelectingMessages) {
        setIsSelectingMessages(false)
        setSelectedMessageIds(new Set())
      }
    } catch (err: any) {
      toast(err?.message || 'Failed to bulk forward messages', 'danger')
    } finally {
      setForwardingBulkProgress(false)
    }
  }

  // Click outside to close emoji picker
  useEffect(() => {
    if (!emojiPickerOpen) return
    const handleClick = (e: MouseEvent) => {
      if (emojiPickerRef.current && !emojiPickerRef.current.contains(e.target as Node)) {
        setEmojiPickerOpen(false)
      }
    }
    window.addEventListener('mousedown', handleClick)
    return () => window.removeEventListener('mousedown', handleClick)
  }, [emojiPickerOpen])

  function insertEmoji(emoji: string) {
    const el = textareaRef.current
    if (el) {
      const start = el.selectionStart ?? inputText.length
      const end = el.selectionEnd ?? inputText.length
      const next = inputText.slice(0, start) + emoji + inputText.slice(end)
      setInputText(next)
      setTimeout(() => {
        el.focus()
        el.setSelectionRange(start + emoji.length, start + emoji.length)
      }, 0)
    } else {
      setInputText((prev) => prev + emoji)
    }
  }

  // Filter messages
  const filteredMessages = useMemo(() => {
    return messages.filter((m: any) => {
      if (mediaOnly && !m.media) return false
      if (chatMsgSearch.trim()) {
        const q = chatMsgSearch.toLowerCase()
        const textMatch = m.text?.toLowerCase().includes(q)
        const mediaMatch = m.media?.name?.toLowerCase().includes(q)
        if (!textMatch && !mediaMatch) return false
      }
      return true
    })
  }, [messages, mediaOnly, chatMsgSearch])

  const chronologicalMessages = useMemo(() => [...filteredMessages].reverse(), [filteredMessages])

  // Scroll to bottom helper
  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'smooth') => {
    if (chatScrollRef.current) {
      if (behavior === 'smooth') {
        chatScrollRef.current.scrollTo({ top: chatScrollRef.current.scrollHeight, behavior: 'smooth' })
      } else {
        chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight
      }
    } else {
      messagesEndRef.current?.scrollIntoView({ behavior })
    }
  }, [])

  // Scroll to bottom on initial load / chat switch or when uploads/messages arrive
  const initialScrollDone = useRef(false)
  useEffect(() => {
    initialScrollDone.current = false
  }, [chatId])
  useEffect(() => {
    if (!initialScrollDone.current && (messages.length > 0 || chatUploads.length > 0)) {
      initialScrollDone.current = true
      setTimeout(() => scrollToBottom('auto'), 60)
    }
  }, [messages.length, chatUploads.length, scrollToBottom])

  useEffect(() => {
    if (chatId) {
      setTimeout(() => scrollToBottom('auto'), 80)
    }
  }, [chatId, scrollToBottom])

  // Auto-resize textarea
  const adjustTextareaHeight = useCallback(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
      textareaRef.current.style.height = `${Math.min(160, Math.max(42, textareaRef.current.scrollHeight))}px`
    }
  }, [])

  useEffect(() => {
    adjustTextareaHeight()
  }, [inputText, adjustTextareaHeight])

  // Handle typing indicator dispatch
  const handleTyping = useCallback(() => {
    const now = Date.now()
    if (now - lastTypingTime.current > 3000) {
      lastTypingTime.current = now
      call('chats.sendTyping', { chatId, action: 'typing' }).catch(() => {})
    }
  }, [chatId])

  const [stagedFiles, setStagedFiles] = useState<File[]>([])

  useEffect(() => {
    setStagedFiles([])
  }, [chatId])

  // Send message
  async function handleSend() {
    if ((!inputText.trim() && stagedFiles.length === 0) || sending) return
    const textToSend = inputText.trim()
    setSending(true)

    try {
      if (stagedFiles.length > 0) {
        const filesToSend = [...stagedFiles]
        setStagedFiles([])
        await uploadFiles(filesToSend, undefined, textToSend)
        setInputText('')
        if (textareaRef.current) {
          textareaRef.current.style.height = '42px'
        }
        return
      }

      if (editingMessage) {
        await call('messages.edit', { chatId, messageId: editingMessage.id, text: textToSend })
        setEditingMessage(null)
      } else {
        await call('messages.send', {
          chatId,
          text: textToSend,
          replyToMessageId: replyingTo?.id || undefined,
        })
        setReplyingTo(null)
      }

      setInputText('')
      if (textareaRef.current) {
        textareaRef.current.style.height = '42px'
      }
      onReload()
      setTimeout(() => scrollToBottom('smooth'), 150)
    } catch (err: any) {
      toast(err.message || 'Failed to send message', 'danger')
    } finally {
      setSending(false)
    }
  }

  const [isDraggingOver, setIsDraggingOver] = useState(false)
  const dragCounterRef = useRef(0)

  async function uploadFiles(fileList: File[], sourcePoint?: { clientX: number, clientY: number }, caption?: string) {
    if (!fileList.length) return
    if (!canPost) {
      toast("You don't have permission to post in this chat", 'warning')
      return
    }
    const newItems: ChatUploadItem[] = fileList.map((f, i) => ({
      id: `pending-${Date.now()}-${i}`, name: f.name, size: f.size,
      type: f.type.startsWith('image/') ? 'photo' : f.type.startsWith('video/') ? 'video' : f.type.startsWith('audio/') ? 'audio' : 'document',
      progress: 0, bytesUploaded: 0, speed: 0, status: 'queued',
    }))
    setPendingUploads((prev) => [...prev, ...newItems])
    try {
      const paths = await uploadPaths(fileList)
      const captionToSend = (caption !== undefined ? caption : inputText).trim()
      await call('uploads.add', { chatId, paths, caption: captionToSend, album: paths.length > 1, keepNames: true })
      triggerFlyToQueue(sourcePoint)
      setInputText('')
      setPendingUploads((prev) => prev.filter((u) => !newItems.some((n) => n.id === u.id)))
      reloadUploads()
      scrollToBottom('smooth')
    } catch (e) {
      const error = (e as Error).message
      toast(error || 'Failed to upload attachment', 'danger')
      setPendingUploads((prev) => prev.map((u) => newItems.some((n) => n.id === u.id) ? { ...u, status: 'failed', error } : u))
    }
  }

  // Only the brief queue-admission state is local. Accepted transfers are rendered from persisted jobs.
  async function handleAttachFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const fileList = Array.from(e.target.files ?? [])
    e.target.value = ''
    await uploadFiles(fileList)
  }

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dragCounterRef.current += 1
    if (e.dataTransfer?.types && Array.from(e.dataTransfer.types).includes('Files')) {
      setIsDraggingOver(true)
    }
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (e.dataTransfer) {
      e.dataTransfer.dropEffect = 'copy'
    }
  }

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dragCounterRef.current -= 1
    if (dragCounterRef.current <= 0) {
      dragCounterRef.current = 0
      setIsDraggingOver(false)
    }
  }

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dragCounterRef.current = 0
    setIsDraggingOver(false)
    if (!canPost) {
      toast("You don't have permission to post in this chat", 'warning')
      return
    }
    const files = Array.from(e.dataTransfer?.files ?? [])
    if (files.length) {
      setStagedFiles((prev) => [...prev, ...files])
      if (textareaRef.current) {
        textareaRef.current.focus()
      }
    }
  }

  async function handleCancelUpload(uploadId: string) {
    const item = chatUploads.find((u) => u.id === uploadId)
    try {
      if (item?.jobId) await call('jobs.action', { action: 'cancel', ids: [item.jobId] })
      setPendingUploads((prev) => prev.filter((u) => u.id !== uploadId))
      reloadUploads()
    } catch (e) { toast((e as Error).message, 'danger') }
  }

  async function retryUpload(jobId: number) {
    try {
      await call('jobs.action', { action: 'retry', ids: [jobId] })
      reloadUploads()
    } catch (e) { toast((e as Error).message, 'danger') }
  }

  // Context Menu Actions
  function openContextMenu(e: React.MouseEvent, m: any) {
    e.preventDefault()
    e.stopPropagation()
    const menuWidth = 220
    const menuHeight = 280
    const clientX = e.clientX || 400
    const clientY = e.clientY || 300
    const x = clientX + menuWidth > window.innerWidth
      ? Math.max(16, clientX - menuWidth)
      : Math.min(window.innerWidth - menuWidth - 16, Math.max(16, clientX))
    const y = clientY + menuHeight > window.innerHeight
      ? Math.max(16, clientY - menuHeight)
      : Math.min(window.innerHeight - menuHeight - 16, Math.max(16, clientY))
    setContextMenu({ x, y, message: m })
  }

  function handleSelectReply(m: any) {
    setEditingMessage(null)
    setReplyingTo(m)
    setContextMenu(null)
    textareaRef.current?.focus()
  }

  function handleSelectEdit(m: any) {
    setReplyingTo(null)
    setEditingMessage(m)
    setInputText(m.text || '')
    setContextMenu(null)
    textareaRef.current?.focus()
  }

  async function handleTogglePin(m: any) {
    setContextMenu(null)
    try {
      await call('messages.pin', { chatId, messageId: m.id, unpin: Boolean(m.isPinned) })
      onReload()
    } catch (err: any) {
      toast(err.message || 'Failed to pin message', 'danger')
    }
  }

  async function handleAddReaction(m: any, reactionEmoji: string) {
    setContextMenu(null)
    const norm = (s: string) => s.replace(/\uFE0F/g, '')
    const targetNorm = norm(reactionEmoji)
    const currentReactions: ReactionItem[] = optimisticReactions[m.id] !== undefined
      ? [...optimisticReactions[m.id]]
      : [...(m.reactions || [])]

    const existingIndex = currentReactions.findIndex((r) => norm(r.emoji) === targetNorm)
    const shouldRemove = existingIndex >= 0 && Boolean(currentReactions[existingIndex].chosen)

    let nextReactions: ReactionItem[]
    if (shouldRemove) {
      nextReactions = currentReactions
        .map((r, i) => i === existingIndex ? { ...r, count: r.count - 1, chosen: false } : r)
        .filter((r) => r.count > 0 || r.chosen)
    } else {
      if (existingIndex >= 0) {
        nextReactions = currentReactions.map((r, i) =>
          i === existingIndex ? { ...r, count: r.chosen ? r.count : r.count + 1, chosen: true } : r
        )
      } else {
        const displayEmoji = reactionEmoji === '\u2764' ? '❤️' : reactionEmoji
        nextReactions = [...currentReactions, { emoji: displayEmoji, count: 1, chosen: true }]
      }
    }

    setOptimisticReactions((prev) => ({ ...prev, [m.id]: nextReactions }))

    try {
      await call('messages.react', {
        chatId,
        messageId: m.id,
        reaction: reactionEmoji,
        remove: shouldRemove,
      })
      onReload()
    } catch (err: any) {
      setOptimisticReactions((prev) => ({ ...prev, [m.id]: currentReactions }))
      toast(err.message || (shouldRemove ? 'Failed to remove reaction' : 'Failed to add reaction'), 'danger')
    }
  }

  function promptDelete(m: any) {
    setContextMenu(null)
    setMessageToDelete(m)
    setDeleteModalOpen(true)
  }

  async function confirmDelete() {
    if (!messageToDelete) return
    try {
      await call('messages.delete', { chatId, messageIds: [messageToDelete.id], revoke: deleteRevoke })
      setDeleteModalOpen(false)
      setMessageToDelete(null)
      onReload()
    } catch (err: any) {
      toast(err.message || 'Failed to delete message', 'danger')
    }
  }

  // Scroll to target message ID on reply click
  function jumpToMessage(msgId: number) {
    const el = document.getElementById(`msg-${msgId}`)
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      el.classList.add('ring-2', 'ring-primary', 'ring-offset-2', 'ring-offset-panel')
      setTimeout(() => {
        el.classList.remove('ring-2', 'ring-primary', 'ring-offset-2', 'ring-offset-panel')
      }, 1500)
    } else {
      toast(`Message #${msgId} is further up in history`, 'info')
    }
  }

  // Close the context menu on an outside click, or on a scroll the reader actually asked for.
  // A bare `scroll` listener is wrong here: the message list scrolls itself on every new message and on
  // every layout shift, and that closed the menu under the pointer before anything could be clicked.
  useEffect(() => {
    if (!contextMenu) return
    const closeMenu = (e: MouseEvent) => {
      if (e.button === 2) return
      setContextMenu(null)
    }
    const handleContextMenuOutside = (e: MouseEvent) => {
      if (!(e.target as HTMLElement)?.closest?.('[id^="msg-"]')) {
        setContextMenu(null)
      }
    }
    // Wheel, touch and the scroll keys are always the user. A drag on a scrollbar is too, and it is the
    // one gesture that never produces a wheel event.
    let userScroll = false
    let scrollArm: number | undefined
    // A wheel that lands on a list too short to move must not arm the close for the next programmatic scroll.
    const markUserScroll = () => {
      userScroll = true
      clearTimeout(scrollArm)
      scrollArm = window.setTimeout(() => { userScroll = false }, 400)
    }
    const handleScrollKey = (e: KeyboardEvent) => {
      if (['PageDown', 'PageUp', 'Home', 'End', 'ArrowDown', 'ArrowUp', ' ', 'Spacebar'].includes(e.key)) markUserScroll()
    }
    const handlePointerDown = (e: PointerEvent) => {
      const el = e.target as HTMLElement
      const scroller = el?.closest?.('.overflow-y-auto') as HTMLElement | null
      if (!scroller) return
      // Inside the scrollbar gutter (client area excluded): a thumb drag scrolls with no wheel event.
      if (e.clientX - scroller.getBoundingClientRect().left >= scroller.clientWidth) markUserScroll()
    }
    const handleScroll = () => {
      if (!userScroll) return
      userScroll = false
      setContextMenu(null)
    }
    window.addEventListener('wheel', markUserScroll, { passive: true, capture: true })
    window.addEventListener('touchstart', markUserScroll, { passive: true, capture: true })
    window.addEventListener('keydown', handleScrollKey, { capture: true })
    window.addEventListener('pointerdown', handlePointerDown, { capture: true })
    window.addEventListener('click', closeMenu)
    window.addEventListener('contextmenu', handleContextMenuOutside)
    window.addEventListener('scroll', handleScroll, true)
    return () => {
      clearTimeout(scrollArm)
      window.removeEventListener('wheel', markUserScroll, { capture: true } as EventListenerOptions)
      window.removeEventListener('touchstart', markUserScroll, { capture: true } as EventListenerOptions)
      window.removeEventListener('keydown', handleScrollKey, { capture: true })
      window.removeEventListener('pointerdown', handlePointerDown, { capture: true })
      window.removeEventListener('click', closeMenu)
      window.removeEventListener('contextmenu', handleContextMenuOutside)
      window.removeEventListener('scroll', handleScroll, true)
    }
  }, [contextMenu])

  const isChannel = activeChat?.kind === 'channel'
  const canPost = activeChat?.canPost !== false

  return (
    <div
      className="relative flex-1 min-h-0 rounded-2xl border border-border/70 telegram-chat-wallpaper flex flex-col overflow-hidden shadow-2xl"
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Drag & Drop Visual Overlay */}
      {isDraggingOver && (
        <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-background/90 backdrop-blur-md border-2 border-dashed border-primary m-3 rounded-2xl pointer-events-none animate-in fade-in zoom-in-95 duration-200">
          <div className="size-16 rounded-2xl bg-primary/20 border border-primary/40 flex items-center justify-center text-primary mb-3 shadow-glow">
            <Upload size={32} className="animate-bounce" />
          </div>
          <div className="text-[16px] font-bold text-text tracking-wide">Drop files here to send</div>
          <div className="text-[12px] text-muted mt-1">Files will be queued for upload to {activeChat?.title || 'this chat'}</div>
        </div>
      )}

      {/* Hidden file input for attachment upload */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={handleAttachFiles}
      />

      {/* Chat View Header - Seamless edge-to-edge */}
      <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-border bg-panel/95 backdrop-blur-md z-20 shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <Avatar src={activeChat?.photo} name={activeChat?.title || 'Chat'} size={40} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="flex-1 min-w-0 text-[14.5px] font-bold text-text truncate leading-tight tracking-wide" title={activeChat?.title || 'Chat'}>
                {activeChat?.title || 'Chat'}
              </span>
              {activeChat?.pinnedMessageId && (
                <span className="flex items-center gap-1 rounded bg-primary/15 text-primary px-1.5 py-0.5 text-[10.5px] font-medium border border-primary/20">
                  <Pin size={10} />
                  <span>Pinned</span>
                </span>
              )}
            </div>
            <div className="text-[12px] text-muted truncate leading-tight mt-0.5">
              {activeTyping ? (
                <span className="text-primary font-medium flex items-center gap-1.5 leading-none">
                  <span className="relative flex size-2 items-center justify-center shrink-0">
                    <span className="absolute inline-flex size-full rounded-full bg-primary opacity-75 animate-ping" />
                    <span className="relative inline-flex size-1.5 rounded-full bg-primary" />
                  </span>
                  <span className="leading-none">{activeTyping}</span>
                </span>
              ) : (
                <>
                  {activeChat?.username ? (
                    <button
                      type="button"
                      onClick={() => onOpenLink?.(activeChat.username)}
                      className="hover:text-primary hover:underline cursor-pointer"
                      title="Open profile"
                    >
                      @{activeChat.username}
                    </button>
                  ) : (
                    activeChat?.kind || 'Chat'
                  )} • {filteredMessages.length} messages
                </>
              )}
            </div>
          </div>
        </div>

        {/* Search & Media filter */}
        <div className="flex items-center gap-2">

          <div className="relative w-48">
            <Search size={13} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <input
              type="text"
              placeholder="Search in chat…"
              value={chatMsgSearch}
              onChange={(e) => setChatMsgSearch(e.target.value)}
              className="w-full rounded-xl border border-border bg-tile py-1.5 pl-8 pr-7 text-[12px] text-text placeholder:text-muted focus:border-primary focus:ring-1 focus:ring-primary/30 outline-none transition-all shadow-2xs"
            />
            {chatMsgSearch && (
              <button
                type="button"
                onClick={() => setChatMsgSearch('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted hover:text-text cursor-pointer transition-colors"
                title="Clear search"
              >
                <X size={13} />
              </button>
            )}
          </div>
          <button
            type="button"
            onClick={() => setMediaOnly(!mediaOnly)}
            className={`flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-[12px] font-medium border transition-all cursor-pointer ${
              mediaOnly
                ? 'bg-primary text-white border-primary shadow-glow'
                : 'bg-tile border-border text-text-2 hover:text-text hover:bg-tile/80 hover:border-primary/40'
            }`}
            title="Filter media files only"
          >
            <Film size={13} />
            <span>Media only</span>
          </button>
          {(activeChat?.kind === 'channel' || activeChat?.kind === 'group') && (activeChat?.canManage || activeChat?.isCreator) && onOpenManageSettings && (
            <button
              type="button"
              onClick={onOpenManageSettings}
              className="flex items-center gap-1.5 rounded-xl px-2.5 py-1.5 text-[12px] font-medium border border-border bg-tile text-text-2 hover:text-text hover:border-primary/40 hover:bg-tile/80 transition-all cursor-pointer shadow-2xs"
              title={`Manage ${activeChat?.kind === 'channel' ? 'Channel' : 'Group'} Settings`}
            >
              <Settings size={13} className="text-primary" />
              <span>Manage</span>
            </button>
          )}
        </div>
      </div>

      {/* Sticky Pinned Message Header Banner */}
      {activeChat?.pinnedMessageId && (
        <div className="px-4 pt-2 shrink-0 z-10">
          <div
            onClick={() => jumpToMessage(activeChat.pinnedMessageId)}
            className="flex items-center justify-between rounded-xl border border-primary/25 bg-panel/95 backdrop-blur-sm px-3.5 py-2 text-[12px] text-text cursor-pointer hover:bg-panel transition-colors select-none shadow-sm"
          >
            <div className="flex items-center gap-2 min-w-0">
              <Pin size={13} className="text-primary shrink-0" />
              <span className="font-semibold text-primary shrink-0">Pinned Message:</span>
              <span className="truncate opacity-90">Click to view pinned message</span>
            </div>
            <span className="text-[11px] text-primary font-medium shrink-0 ml-2">Jump →</span>
          </div>
        </div>
      )}

      {/* Message Stream */}
      <div
        ref={chatScrollRef}
        onScroll={(e) => {
          const target = e.currentTarget
          const isNearBottom = target.scrollHeight - target.scrollTop - target.clientHeight < 120
          setShowScrollBottom(!isNearBottom)
          if (target.scrollTop < 160 && hasMore && !loading && !localLoadingOlder) {
            prevScrollHeightRef.current = target.scrollHeight
            prevScrollTopRef.current = target.scrollTop
            setLocalLoadingOlder(true)
            onLoadOlder()
          }
        }}
        className="flex-1 overflow-y-auto overflow-x-hidden p-4 space-y-3.5 select-text z-10"
      >

        {loading && filteredMessages.length === 0 && chatUploads.length === 0 ? (
          <div className="space-y-4 py-6 px-2 animate-pulse">
            <div className="flex gap-3 items-end max-w-[70%]">
              <div className="size-8 rounded-full bg-tile/80 shrink-0" />
              <div className="space-y-2 flex-1">
                <div className="h-4 bg-tile/70 rounded-lg w-28" />
                <div className="h-14 bg-tile/60 rounded-2xl w-full" />
              </div>
            </div>
            <div className="flex gap-3 items-end max-w-[65%] ml-auto justify-end">
              <div className="space-y-2 flex-1 items-end">
                <div className="h-12 bg-primary/20 rounded-2xl w-full ml-auto" />
              </div>
            </div>
            <div className="flex gap-3 items-end max-w-[80%]">
              <div className="size-8 rounded-full bg-tile/80 shrink-0" />
              <div className="space-y-2 flex-1">
                <div className="h-4 bg-tile/70 rounded-lg w-32" />
                <div className="h-20 bg-tile/60 rounded-2xl w-full" />
              </div>
            </div>
            <div className="flex gap-3 items-end max-w-[60%] ml-auto justify-end">
              <div className="space-y-2 flex-1 items-end">
                <div className="h-16 bg-primary/20 rounded-2xl w-full ml-auto" />
              </div>
            </div>
          </div>
        ) : filteredMessages.length === 0 && chatUploads.length === 0 ? (
          <div className="py-24 text-center text-muted">
            <p className="text-[13.5px]">No messages found</p>
          </div>
        ) : (
          <div className="space-y-3 pb-2">
            {/* Loading older messages spinner */}
            {(loading || localLoadingOlder) && hasMore && (
              <div className="flex items-center justify-center py-2.5 my-1">
                <div className="flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-tile/95 border border-primary/30 shadow-md backdrop-blur-md text-text">
                  <span className="size-3.5 border-2 border-primary border-t-transparent rounded-full animate-spin shrink-0" />
                  <span className="text-[11.5px] font-medium text-text-2">Loading older messages…</span>
                </div>
              </div>
            )}
            {/* Render in chronological order */}
            {chronologicalMessages.map((m: any, idx: number, arr: any[]) => {
              const currentDateGroup = getDateGroup(m.date)
              const prevDateGroup = idx > 0 ? getDateGroup(arr[idx - 1].date) : null
              const showDateDivider = currentDateGroup !== prevDateGroup

              const isOut = Boolean(
                m.isOutgoing ||
                (me?.name && m.sender && m.sender === me.name) ||
                (me?.firstName && m.sender && m.sender === me.firstName)
              )

              if (m.isService) {
                return (
                  <React.Fragment key={m.id}>
                    {showDateDivider && (
                      <div className="flex justify-center my-4 select-none">
                        <span className="rounded-full bg-tile/90 px-3.5 py-1 text-[11px] font-semibold text-text-2 shadow border border-border">
                          {currentDateGroup}
                        </span>
                      </div>
                    )}
                    <div className="flex justify-center my-2.5 select-none">
                      <span className="rounded-full bg-tile/80 backdrop-blur-sm px-4 py-1.5 text-[11.5px] font-medium text-text-2 shadow-xs border border-border/80 flex items-center gap-1.5 max-w-[80%] text-center">
                        <Sparkles size={12} className="text-primary shrink-0" />
                        <span>{m.text || 'Channel created'}</span>
                      </span>
                    </div>
                  </React.Fragment>
                )
              }

              if (!m.text && !m.media) {
                return null
              }

              const isStandaloneEmoji = !m.media && !m.forwardFrom && !m.replyTo && (Boolean(m.isAnimatedEmoji) || isEmojiOnly(m.text))

              if (isStandaloneEmoji) {
                return (
                  <React.Fragment key={m.id}>
                    {showDateDivider && (
                      <div className="flex justify-center my-4 select-none">
                        <span className="rounded-full bg-tile/90 px-3.5 py-1 text-[11px] font-semibold text-text-2 shadow border border-border">
                          {currentDateGroup}
                        </span>
                      </div>
                    )}
                    <div
                      id={`msg-${m.id}`}
                      onContextMenu={(e) => openContextMenu(e, m)}
                      onClick={isSelectingMessages ? (e) => { e.stopPropagation(); toggleSelectMessage(m.id) } : undefined}
                      className={`flex w-full items-center ${isOut ? 'justify-end' : 'justify-start'} my-2.5 transition-all select-none group/msg ${
                        isSelectingMessages ? 'cursor-pointer hover:opacity-90' : ''
                      }`}
                    >
                      {isSelectingMessages && (
                        <div
                          onClick={(e) => { e.stopPropagation(); toggleSelectMessage(m.id) }}
                          className={`flex items-center justify-center p-1.5 cursor-pointer shrink-0 ${isOut ? 'order-last ml-2' : 'order-first mr-2'}`}
                        >
                          <div className={`size-5 rounded-full border-2 flex items-center justify-center transition-all ${
                            selectedMessageIds.has(m.id)
                              ? 'bg-primary border-primary text-white scale-105 shadow-sm'
                              : 'border-muted/50 hover:border-primary/70 bg-tile/40'
                          }`}>
                            {selectedMessageIds.has(m.id) && <Check size={12} strokeWidth={3} />}
                          </div>
                        </div>
                      )}
                      <div className={`relative flex flex-col ${isOut ? 'items-end' : 'items-start'} max-w-[85%]`}>
                        <div className="relative inline-flex flex-col items-center">
                          <div
                            className="animate-emoji-standalone cursor-pointer active:scale-95 text-[68px] leading-none select-none filter drop-shadow-[0_8px_18px_rgba(0,0,0,0.65)] my-1"
                          >
                            <span className="emoji-glyph">{m.text}</span>
                          </div>

                          {/* Floating Pill Timestamp and Delivery Status */}
                          <div className="flex items-center gap-1.5 rounded-full bg-black/65 backdrop-blur-md px-2.5 py-0.5 text-[10px] text-white/90 shadow border border-white/10 select-none">
                            {m.editDate && <span className="italic text-[9px] text-muted">edited</span>}
                            <span>{getMessageTime(m.date)}</span>
                            {isOut && (
                              <span className="flex items-center leading-none text-primary font-bold text-[10.5px]">
                                {m.deliveryStatus === 'read' ? '✓✓' : '✓'}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  </React.Fragment>
                )
              }

              return (
                <React.Fragment key={m.id}>
                  {showDateDivider && (
                    <div className="flex justify-center my-4 select-none">
                      <span className="rounded-full bg-tile/90 px-3.5 py-1 text-[11px] font-semibold text-text-2 shadow border border-border">
                        {currentDateGroup}
                      </span>
                    </div>
                  )}

                  {(() => {
                    const isVisualMedia = Boolean(
                      m.media && (
                        m.media.type === 'video' ||
                        m.media.type === 'photo' ||
                        m.media.type === 'animation' ||
                        m.media.type === 'video_note'
                      )
                    )
                    const reactionsList: ReactionItem[] = optimisticReactions[m.id] !== undefined
                      ? optimisticReactions[m.id]
                      : (m.reactions ?? [])

                    return (
                      <div
                        id={`msg-${m.id}`}
                        onContextMenu={(e) => openContextMenu(e, m)}
                        onClick={isSelectingMessages ? (e) => { e.stopPropagation(); toggleSelectMessage(m.id) } : undefined}
                        className={`flex w-full items-center ${isOut ? 'justify-end' : 'justify-start'} my-1 transition-all group/msg ${
                          isSelectingMessages ? 'cursor-pointer hover:opacity-95' : ''
                        }`}
                      >
                        {isSelectingMessages && (
                          <div
                            onClick={(e) => { e.stopPropagation(); toggleSelectMessage(m.id) }}
                            className={`flex items-center justify-center p-1.5 cursor-pointer shrink-0 ${isOut ? 'order-last ml-2' : 'order-first mr-2'}`}
                          >
                            <div className={`size-5 rounded-full border-2 flex items-center justify-center transition-all ${
                              selectedMessageIds.has(m.id)
                                ? 'bg-primary border-primary text-white scale-105 shadow-sm'
                                : 'border-muted/50 hover:border-primary/70 bg-tile/40'
                            }`}>
                              {selectedMessageIds.has(m.id) && <Check size={12} strokeWidth={3} />}
                            </div>
                          </div>
                        )}
                        <div className={`flex items-end gap-1.5 ${isOut ? 'flex-row-reverse' : 'flex-row'} ${isVisualMedia ? 'max-w-[460px] min-w-[240px] w-fit' : 'max-w-[85%] w-fit'}`}>
                          {/* Message Bubble Content */}
                          {isVisualMedia ? (
                            m.text ? (
                              /* Case 1: Single Visual Media WITH Caption (Telegram Card Layout) */
                              <div className={`relative overflow-hidden rounded-2xl ${
                                isOut
                                  ? 'rounded-tr-sm bg-primary/20 border-primary/35 shadow-md'
                                  : 'rounded-tl-sm bg-tile border-border shadow-md'
                              } border p-0 hover:border-primary/40 transition-all text-text w-fit max-w-full`}>

                                {/* Forward Header */}
                                {m.forwardFrom && (
                                  <div className="flex items-center gap-1.5 text-[11.5px] text-primary/90 px-3.5 pt-2.5 pb-1 italic select-none">
                                    <CornerDownRight size={12} className="shrink-0" />
                                    <span>Forwarded from {m.forwardFrom.name || m.forwardFrom.chatTitle || 'Channel'}</span>
                                  </div>
                                )}

                                {/* Reply Quote Banner */}
                                {m.replyTo && (
                                  <div className="px-3.5 pt-2 pb-1">
                                    <div
                                      onClick={(e) => {
                                        e.stopPropagation()
                                        jumpToMessage(m.replyTo.id)
                                      }}
                                      className="flex items-center gap-2 rounded-lg border-l-2 border-primary bg-panel/60 px-2.5 py-1.5 text-[11.5px] cursor-pointer hover:bg-panel transition-colors select-none"
                                      title="Jump to replied message"
                                    >
                                      <Reply size={12} className="text-primary shrink-0" />
                                      <div className="min-w-0 flex-1">
                                        <button
                                          type="button"
                                          onClick={(e) => {
                                            e.stopPropagation()
                                            void openSender({ id: m.replyTo.id, senderId: m.replyTo.senderId })
                                          }}
                                          className="font-semibold text-primary leading-tight truncate hover:underline text-left cursor-pointer"
                                          title="Open contact"
                                        >
                                          {m.replyTo.sender}
                                        </button>
                                        <div className="text-text-2 truncate leading-tight mt-0.5">{m.replyTo.text}</div>
                                      </div>
                                    </div>
                                  </div>
                                )}

                                {/* Sender Header for Groups */}
                                {!isOut && !isChannel && (m.sender || activeChat?.title) && (
                                  <div className="flex items-center justify-between text-[11.5px] px-3.5 pt-2 pb-1">
                                    <button type="button" onClick={(e) => { e.stopPropagation(); void openSender(m) }} title="Open contact" className="font-semibold text-primary tracking-wide truncate max-w-[240px] hover:underline cursor-pointer text-left">
                                      {m.sender || activeChat?.title}
                                    </button>
                                  </div>
                                )}

                                {/* Flush Edge-to-Edge Media Container (NO frames, NO double borders!) */}
                                <div
                                  className="relative w-full overflow-hidden bg-black/40 cursor-pointer group/media select-none"
                                  onClick={() => onOpenViewer({ name: m.media.name, path: m.media.path, thumb: m.media.thumb, type: m.media.type, size: m.media.size, duration: m.media.duration, chatId, messageId: m.id })}
                                >
                                  <ChatMediaThumb
                                    src={(m.media.status === 'downloaded' && m.media.path) ? `mediagram://file/${encodeURIComponent(m.media.path)}` : m.media.thumb}
                                    alt={m.media.name}
                                    minHeight="140px"
                                    maxHeight="480px"
                                    className="transition-transform duration-300 group-hover/media:scale-[1.01]"
                                  />

                                  {/* Top & Bottom Vignettes */}
                                  <div className="absolute inset-x-0 top-0 h-16 bg-gradient-to-b from-black/70 via-black/20 to-transparent pointer-events-none" />
                                  <div className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-black/70 via-black/20 to-transparent pointer-events-none" />

                                  {/* Floating Duration Pill (Telegram 0:03 🔊 or duration • size) */}
                                  <div className="absolute top-2.5 left-2.5 flex items-center gap-1.5 rounded-full bg-black/60 backdrop-blur-md px-2.5 py-1 text-[11px] font-semibold text-white/95 border border-white/15 shadow-md pointer-events-none">
                                    {m.media.duration ? (
                                      <>
                                        <span className="tabular-nums">{fmtDuration(m.media.duration)}</span>
                                        <Volume2 size={12} className="text-white/80 shrink-0" />
                                      </>
                                    ) : (
                                      <>
                                        <Film size={11} className="text-cyan shrink-0" />
                                        <span>{fmtBytes(m.media.size)}</span>
                                      </>
                                    )}
                                    {m.media.duration && m.media.size ? (
                                      <>
                                        <span className="opacity-40">•</span>
                                        <span className="text-[10px] opacity-80 tabular-nums">{fmtBytes(m.media.size)}</span>
                                      </>
                                    ) : null}
                                  </div>

                                  {/* Center Frosted Glass Glowing Play Disc */}
                                  {(m.media.type === 'video' || m.media.type === 'animation' || m.media.type === 'video_note') && (
                                    <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                                      <div className="size-14 rounded-full bg-black/45 backdrop-blur-md border border-white/35 flex items-center justify-center shadow-[0_8px_32px_rgba(0,0,0,0.6)] group-hover/media:scale-110 group-hover/media:bg-primary group-hover/media:border-primary/80 group-hover/media:shadow-[0_0_28px_rgba(56,189,248,0.55)] transition-all duration-300">
                                        <Play size={22} className="ml-0.5 fill-white text-white drop-shadow" />
                                      </div>
                                    </div>
                                  )}

                                  {/* Top-Right Quick Action: the 3-dot menu carries Download / Show in folder (bug 38) */}
                                  <div className="absolute top-2.5 right-2.5 flex items-center gap-1.5 z-20">
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation()
                                        openContextMenu(e, m)
                                      }}
                                      className="size-8 rounded-full bg-black/60 hover:bg-black/80 text-white backdrop-blur-md border border-white/20 flex items-center justify-center transition-all hover:scale-110 active:scale-95 shadow-md"
                                      title="Message Options"
                                    >
                                      <MoreVertical size={13} />
                                    </button>
                                  </div>
                                </div>

                                {/* Caption Content Seamless Under Media */}
                                <div className="px-3.5 pt-2.5 pb-2.5 select-text">
                                  <FormattedMessageText
                                    text={m.text}
                                    entities={m.entities}
                                    onOpenLink={onOpenLink}
                                  />

                                  {/* Telegram Bottom Bar: Reactions on left, Views + Time on right */}
                                  <div className="flex items-center justify-between gap-2 mt-2 pt-1 select-none">
                                    <div className="flex flex-wrap gap-1.5 items-center">
                                      {reactionsList.map((r: ReactionItem, rIdx: number) => {
                                        const displayEmoji = r.emoji === '\u2764' ? '❤️' : r.emoji
                                        return (
                                          <button
                                            key={`r-${rIdx}`}
                                            type="button"
                                            onClick={() => handleAddReaction(m, r.emoji)}
                                            className={`flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11.5px] font-medium border transition-all cursor-pointer ${
                                              r.chosen
                                                ? 'bg-primary/25 border-primary/60 ring-1 ring-primary/40 shadow-sm'
                                                : 'bg-tile border-border text-text-2 hover:bg-tile/80 hover:text-text'
                                            }`}
                                            title={`Reaction ${displayEmoji}${r.chosen ? ' (click to remove)' : ''}`}
                                          >
                                            <span className="emoji-glyph text-[13px] leading-none select-none">{displayEmoji}</span>
                                            <span className={`text-[10.5px] tabular-nums font-semibold ${r.chosen ? 'text-primary' : 'text-text-2'}`}>
                                              {r.count}
                                            </span>
                                          </button>
                                        )
                                      })}
                                    </div>

                                    <div className="flex items-center gap-1.5 text-[11px] text-muted/75 tabular-nums ml-auto shrink-0">
                                      {m.views ? (
                                        <span className="flex items-center gap-1 text-muted/75 font-medium" title={`${m.views.toLocaleString()} views`}>
                                          <span>{fmtViews(m.views)}</span>
                                          <Eye size={12} className="opacity-75" />
                                        </span>
                                      ) : null}
                                      {m.editDate && (
                                        <span className="italic text-[10px] text-muted/60">edited</span>
                                      )}
                                      <span>{getMessageTime(m.date)}</span>
                                      {isOut && (
                                        <span className="flex items-center leading-none">
                                          {m.deliveryStatus === 'sending' ? (
                                            <span title="Sending…"><Clock size={11} className="animate-spin text-muted/70" /></span>
                                          ) : m.deliveryStatus === 'failed' ? (
                                            <span title="Message failed to send"><AlertCircle size={12} className="text-danger" /></span>
                                          ) : m.deliveryStatus === 'read' ? (
                                            <span className="text-cyan font-bold text-[11px]" title="Read">✓✓</span>
                                          ) : (
                                            <span title="Sent to server"><Check size={12} className="text-muted/70" /></span>
                                          )}
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                </div>
                              </div>
                            ) : (
                              /* Case 2: Single Visual Media WITHOUT Caption (Borderless Flush Media) */
                              <div className="flex flex-col">
                                {!isOut && !isChannel && (m.sender || activeChat?.title) && (
                                  <div className="flex items-center justify-between text-[11.5px] px-2 pb-1">
                                    <button type="button" onClick={(e) => { e.stopPropagation(); void openSender(m) }} title="Open contact" className="font-semibold text-primary tracking-wide truncate max-w-[240px] hover:underline cursor-pointer text-left">
                                      {m.sender || activeChat?.title}
                                    </button>
                                  </div>
                                )}
                                <div
                                  className="relative rounded-2xl overflow-hidden shadow-xl max-w-[460px] min-w-[220px] w-fit group/media cursor-pointer select-none"
                                  onClick={() => onOpenViewer({ name: m.media.name, path: m.media.path, thumb: m.media.thumb, type: m.media.type, size: m.media.size, duration: m.media.duration, chatId, messageId: m.id })}
                                >
                                <ChatMediaThumb
                                  src={(m.media.status === 'downloaded' && m.media.path) ? `mediagram://file/${encodeURIComponent(m.media.path)}` : m.media.thumb}
                                  alt={m.media.name}
                                  minHeight="140px"
                                  maxHeight="480px"
                                  className="rounded-2xl transition-transform duration-300 group-hover/media:scale-[1.01]"
                                />

                                {/* Top & Bottom Vignettes */}
                                <div className="absolute inset-x-0 top-0 h-16 bg-gradient-to-b from-black/70 via-black/20 to-transparent pointer-events-none" />
                                <div className="absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-black/70 via-black/20 to-transparent pointer-events-none" />

                                {/* Top-Left Duration Pill */}
                                <div className="absolute top-2.5 left-2.5 flex items-center gap-1.5 rounded-full bg-black/60 backdrop-blur-md px-2.5 py-1 text-[11px] font-semibold text-white/95 border border-white/15 shadow-md pointer-events-none">
                                  {m.media.duration ? (
                                    <>
                                      <span className="tabular-nums">{fmtDuration(m.media.duration)}</span>
                                      <Volume2 size={12} className="text-white/80 shrink-0" />
                                    </>
                                  ) : (
                                    <>
                                      <Film size={11} className="text-cyan shrink-0" />
                                      <span>{fmtBytes(m.media.size)}</span>
                                    </>
                                  )}
                                  {m.media.duration && m.media.size ? (
                                    <>
                                      <span className="opacity-40">•</span>
                                      <span className="text-[10px] opacity-80 tabular-nums">{fmtBytes(m.media.size)}</span>
                                    </>
                                  ) : null}
                                </div>

                                {/* Center Frosted Glass Glowing Play Disc */}
                                {(m.media.type === 'video' || m.media.type === 'animation' || m.media.type === 'video_note') && (
                                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                                    <div className="size-14 rounded-full bg-black/45 backdrop-blur-md border border-white/35 flex items-center justify-center shadow-[0_8px_32px_rgba(0,0,0,0.6)] group-hover/media:scale-110 group-hover/media:bg-primary group-hover/media:border-primary/80 group-hover/media:shadow-[0_0_28px_rgba(56,189,248,0.55)] transition-all duration-300">
                                      <Play size={22} className="ml-0.5 fill-white text-white drop-shadow" />
                                    </div>
                                  </div>
                                )}

                                {/* Top-Right Quick Action: the 3-dot menu carries Download / Show in folder (bug 38) */}
                                <div className="absolute top-2.5 right-2.5 flex items-center gap-1.5 z-20 opacity-90 group-hover/media:opacity-100 transition-opacity">
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      openContextMenu(e, m)
                                    }}
                                    className="size-8 rounded-full bg-black/60 hover:bg-black/80 text-white backdrop-blur-md border border-white/20 flex items-center justify-center transition-all hover:scale-110 active:scale-95 shadow-md"
                                    title="Message Options"
                                  >
                                    <MoreVertical size={13} />
                                  </button>
                                </div>
                              </div>
                            )

                                {/* Floating Bottom-Left Reactions (if any) */}
                                {reactionsList.length > 0 && (
                                  <div className="absolute bottom-2.5 left-2.5 flex flex-wrap gap-1 z-10">
                                    {reactionsList.map((r: ReactionItem, rIdx: number) => (
                                      <button
                                        key={`r-${rIdx}`}
                                        type="button"
                                        onClick={(e) => { e.stopPropagation(); handleAddReaction(m, r.emoji) }}
                                        className={`flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-medium backdrop-blur-md border shadow transition-all cursor-pointer ${
                                          r.chosen
                                            ? 'bg-primary/50 border-primary text-white'
                                            : 'bg-black/60 border-white/15 text-white/90 hover:bg-black/80'
                                        }`}
                                      >
                                        <span className="emoji-glyph text-[12px]">{r.emoji === '\u2764' ? '❤️' : r.emoji}</span>
                                        <span className="tabular-nums font-semibold">{r.count}</span>
                                      </button>
                                    ))}
                                  </div>
                                )}

                                {/* Floating Bottom-Right Pill: Views + Time + Status */}
                                <div className="absolute bottom-2.5 right-2.5 flex items-center gap-1.5 rounded-full bg-black/60 backdrop-blur-md px-2.5 py-1 text-[11px] font-semibold text-white/95 border border-white/15 shadow-md pointer-events-none tabular-nums">
                                  {m.views ? (
                                    <span className="flex items-center gap-1 opacity-90" title={`${m.views.toLocaleString()} views`}>
                                      <span>{fmtViews(m.views)}</span>
                                      <Eye size={11} className="opacity-75" />
                                    </span>
                                  ) : null}
                                  {m.editDate && (
                                    <span className="italic text-[9.5px] opacity-75">edited</span>
                                  )}
                                  <span>{getMessageTime(m.date)}</span>
                                  {isOut && (
                                    <span className="flex items-center leading-none">
                                      {m.deliveryStatus === 'sending' ? (
                                        <Clock size={11} className="animate-spin opacity-80" />
                                      ) : m.deliveryStatus === 'failed' ? (
                                        <AlertCircle size={12} className="text-rose-400" />
                                      ) : m.deliveryStatus === 'read' ? (
                                        <span className="text-cyan font-bold text-[11px]">✓✓</span>
                                      ) : (
                                        <Check size={12} className="opacity-80" />
                                      )}
                                    </span>
                                  )}
                                </div>
                              </div>
                            )
                          ) : (
                            /* Case 3: Audio, Voice Note, Document, or Text Bubble */
                            <div className={`relative rounded-2xl ${
                              isOut
                                ? 'rounded-tr-sm bg-primary/20 border-primary/35 shadow-md'
                                : 'rounded-tl-sm bg-tile border-border shadow-md'
                            } border p-3 hover:border-primary/40 transition-all text-text w-full`}>
                              {/* Sender Header Line + Quick Context Trigger */}
                              {!isOut ? (
                                <div className="flex items-center justify-between text-[11.5px] mb-1.5">
                                  <button type="button" onClick={(e) => { e.stopPropagation(); void openSender(m) }} title="Open contact" className="font-semibold text-primary tracking-wide truncate max-w-[240px] hover:underline cursor-pointer text-left">
                                    {m.sender || activeChat?.title || 'Unknown'}
                                  </button>
                                  <div className="opacity-0 group-hover/msg:opacity-100 transition-opacity flex items-center gap-1 ml-2">
                                    <button
                                      type="button"
                                      onClick={(e) => openContextMenu(e, m)}
                                      className="p-1 text-muted hover:text-text rounded hover:bg-tile transition-colors cursor-pointer"
                                      title="Message Options"
                                    >
                                      <MoreVertical size={13} />
                                    </button>
                                  </div>
                                </div>
                              ) : (
                                <div className="absolute top-1.5 right-1.5 opacity-0 group-hover/msg:opacity-100 transition-opacity flex items-center gap-1 z-10">
                                  <button
                                    type="button"
                                    onClick={(e) => openContextMenu(e, m)}
                                    className="p-1 text-muted hover:text-text rounded-full bg-tile/70 hover:bg-tile transition-colors"
                                    title="Message Options"
                                  >
                                    <MoreVertical size={13} />
                                  </button>
                                </div>
                              )}

                              {/* Forwarded Header */}
                              {m.forwardFrom && (
                                <div className="flex items-center gap-1.5 text-[11.5px] text-primary/90 mb-1.5 italic select-none">
                                  <CornerDownRight size={12} className="shrink-0" />
                                  <span>Forwarded from {m.forwardFrom.name || m.forwardFrom.chatTitle || 'Channel'}</span>
                                </div>
                              )}

                              {/* Reply Quote Banner Inside Bubble */}
                              {m.replyTo && (
                                <div
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    jumpToMessage(m.replyTo.id)
                                  }}
                                  className="flex items-center gap-2 rounded-lg border-l-2 border-primary bg-panel/60 px-2.5 py-1.5 text-[11.5px] mb-2 cursor-pointer hover:bg-panel transition-colors select-none"
                                  title="Jump to replied message"
                                >
                                  <Reply size={12} className="text-primary shrink-0" />
                                  <div className="min-w-0 flex-1">
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation()
                                        void openSender({ id: m.replyTo.id, senderId: m.replyTo.senderId })
                                      }}
                                      className="font-semibold text-primary leading-tight truncate hover:underline text-left cursor-pointer"
                                      title="Open contact"
                                    >
                                      {m.replyTo.sender}
                                    </button>
                                    <div className="text-text-2 truncate leading-tight mt-0.5">{m.replyTo.text}</div>
                                  </div>
                                </div>
                              )}

                              {/* Audio / Document Media */}
                              {m.media && (
                                <div className="my-1 w-full">
                                  {m.media.type === 'audio' || m.media.type === 'voice' ? (
                                    <div className={`flex items-center gap-3.5 p-3 rounded-2xl ${
                                      isOut
                                        ? 'bg-primary/10 border-primary/25'
                                        : 'bg-tile/70 border-border'
                                    } border shadow-sm hover:border-primary/40 transition-all select-none w-full max-w-[420px]`}>
                                      <div
                                        onClick={() => onOpenViewer({ name: m.media.name, path: m.media.path, thumb: m.media.thumb, type: m.media.type, size: m.media.size, duration: m.media.duration, chatId, messageId: m.id })}
                                        className="size-11 rounded-full bg-gradient-to-tr from-primary to-cyan text-white shadow-glow flex items-center justify-center shrink-0 cursor-pointer hover:scale-105 active:scale-95 transition-all"
                                        title="Play audio"
                                      >
                                        <Play size={18} className="ml-0.5 fill-white text-white" />
                                      </div>

                                      <div className="min-w-0 flex-1">
                                        <div className="flex items-center justify-between gap-2">
                                          <span className="text-[13px] font-semibold text-text truncate" title={m.media.name}>
                                            {m.media.name || 'Voice Message'}
                                          </span>
                                          <span className="text-[11px] font-medium text-cyan tabular-nums shrink-0">
                                            {m.media.duration ? fmtDuration(m.media.duration) : fmtBytes(m.media.size)}
                                          </span>
                                        </div>

                                        <div className="flex items-center gap-[2.5px] h-5 my-1 overflow-hidden opacity-85">
                                          {[6, 12, 18, 14, 8, 20, 16, 10, 22, 15, 7, 13, 19, 12, 16, 20, 11, 8, 17, 14, 9, 18, 12, 6].map((h, i) => (
                                            <div
                                              key={i}
                                              style={{ height: `${h}px` }}
                                              className={`w-[2.5px] rounded-full ${i < 8 ? 'bg-cyan' : 'bg-muted/30'} transition-all`}
                                            />
                                          ))}
                                        </div>

                                        <div className="flex items-center justify-between text-[10.5px] text-muted">
                                          <span>{fmtBytes(m.media.size)}</span>
                                          <span className="capitalize">{m.media.type === 'voice' ? 'Voice Message' : 'Audio Track'}</span>
                                        </div>
                                      </div>

                                      <div className="shrink-0 flex items-center">
                                        {m.media.status === 'downloaded' && m.media.path ? (
                                          <button
                                            type="button"
                                            onClick={() => onRevealFile(m.media.path)}
                                            className="size-8 rounded-full hover:bg-tile text-cyan flex items-center justify-center transition-colors"
                                            title="Show in folder"
                                          >
                                            <FolderOpen size={15} />
                                          </button>
                                        ) : (
                                          <button
                                            type="button"
                                            onClick={(ev) => onDownloadItem({ chatId, messageId: m.id }, false, ev)}
                                            className="size-8 rounded-full hover:bg-tile text-muted hover:text-text flex items-center justify-center transition-colors"
                                            title="Download audio"
                                          >
                                            <Download size={15} />
                                          </button>
                                        )}
                                      </div>
                                    </div>
                                  ) : (
                                    (() => {
                                      const ext = (m.media.ext || m.media.name?.split('.').pop() || 'FILE').toUpperCase()
                                      let colorClasses = 'from-primary/25 to-cyan/20 border-primary/30 text-cyan'
                                      if (['PDF'].includes(ext)) {
                                        colorClasses = 'from-rose-500/25 to-rose-600/15 border-rose-500/30 text-rose-400'
                                      } else if (['ZIP', 'RAR', '7Z', 'TAR', 'GZ'].includes(ext)) {
                                        colorClasses = 'from-amber-500/25 to-amber-600/15 border-amber-500/30 text-amber-400'
                                      } else if (['DOC', 'DOCX', 'TXT', 'MD', 'XLS', 'XLSX'].includes(ext)) {
                                        colorClasses = 'from-primary/25 to-primary/10 border-primary/30 text-primary'
                                      } else if (['EXE', 'MSI', 'DMG', 'APK', 'ISO'].includes(ext)) {
                                        colorClasses = 'from-purple-500/25 to-indigo-600/15 border-purple-500/30 text-purple-400'
                                      }

                                      return (
                                        <div className={`flex items-center gap-3 p-3 rounded-2xl ${
                                          isOut
                                            ? 'bg-primary/10 border-primary/25'
                                            : 'bg-tile/70 border-border'
                                        } border shadow-sm select-none w-full max-w-[400px] hover:border-primary/40 transition-all`}>
                                          <div className={`size-12 rounded-2xl bg-gradient-to-br ${colorClasses} border flex flex-col items-center justify-center shrink-0 shadow-inner`}>
                                            <FileText size={18} className="opacity-75 mb-0.5" />
                                            <span className="text-[9px] font-black tracking-wider leading-none">{ext.slice(0, 4)}</span>
                                          </div>

                                          <div className="min-w-0 flex-1">
                                            <div className="text-[13px] font-semibold text-text truncate hover:text-primary transition-colors" title={m.media.name}>
                                              {m.media.name}
                                            </div>
                                            <div className="flex items-center gap-2 text-[11px] text-muted mt-0.5 tabular-nums">
                                              <span>{fmtBytes(m.media.size)}</span>
                                              <span>•</span>
                                              <span className={m.media.status === 'downloaded' ? 'text-emerald-400 font-medium' : 'text-muted'}>
                                                {m.media.status === 'downloaded' ? 'Saved' : ext}
                                              </span>
                                            </div>
                                          </div>

                                          <div className="shrink-0 flex items-center">
                                            {m.media.status === 'downloaded' && m.media.path ? (
                                              <button
                                                type="button"
                                                onClick={() => onRevealFile(m.media.path)}
                                                className="size-9 rounded-xl bg-tile hover:bg-primary/20 text-primary border border-border flex items-center justify-center transition-all hover:scale-105 active:scale-95 shadow"
                                                title="Show in folder"
                                              >
                                                <FolderOpen size={15} />
                                              </button>
                                            ) : (
                                              <button
                                                type="button"
                                                onClick={(ev) => onDownloadItem({ chatId, messageId: m.id }, false, ev)}
                                                className="size-9 rounded-xl bg-primary/20 hover:bg-primary text-primary hover:text-white border border-primary/30 flex items-center justify-center transition-all hover:scale-105 active:scale-95 shadow"
                                                title="Download file"
                                              >
                                                <Download size={15} />
                                              </button>
                                            )}
                                          </div>
                                        </div>
                                      )
                                    })()
                                  )}
                                </div>
                              )}

                              {/* Rich Message Text with Entities */}
                              {m.text && (
                                <div className="mt-1 select-text">
                                  <FormattedMessageText
                                    text={m.text}
                                    entities={m.entities}
                                    onOpenLink={onOpenLink}
                                  />
                                </div>
                              )}

                              {/* Reactions Row */}
                              {reactionsList.length > 0 && (
                                <div className="flex flex-wrap gap-1.5 mt-2 pt-1">
                                  {reactionsList.map((r: ReactionItem, rIdx: number) => {
                                    const displayEmoji = r.emoji === '\u2764' ? '❤️' : r.emoji
                                    return (
                                      <button
                                        key={`r-${rIdx}`}
                                        type="button"
                                        onClick={() => handleAddReaction(m, r.emoji)}
                                        className={`flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11.5px] font-medium border transition-all cursor-pointer ${
                                          r.chosen
                                            ? 'bg-primary/25 border-primary/60 ring-1 ring-primary/40 shadow-sm'
                                            : 'bg-tile border-border text-text-2 hover:bg-tile/80 hover:text-text'
                                        }`}
                                        title={`Reaction ${displayEmoji}${r.chosen ? ' (click to remove)' : ''}`}
                                      >
                                        <span className="emoji-glyph text-[13px] leading-none select-none">{displayEmoji}</span>
                                        <span className={`text-[10.5px] tabular-nums font-semibold ${r.chosen ? 'text-primary' : 'text-text-2'}`}>
                                          {r.count}
                                        </span>
                                      </button>
                                    )
                                  })}
                                </div>
                              )}

                              {/* Message Footer: Timestamp, Views, Edited, Checkmarks */}
                              <div className="flex items-center justify-end gap-1.5 mt-1 text-[10.5px] text-muted/70 tabular-nums select-none">
                                {m.views ? (
                                  <span className="flex items-center gap-1 text-muted/70 font-medium mr-1" title={`${m.views.toLocaleString()} views`}>
                                    <span>{fmtViews(m.views)}</span>
                                    <Eye size={11} className="opacity-75" />
                                  </span>
                                ) : null}
                                {m.editDate && (
                                  <span className="italic text-[10px] text-muted/60">edited</span>
                                )}
                                <span>{getMessageTime(m.date)}</span>

                                {isOut && (
                                  <span className="flex items-center leading-none">
                                    {m.deliveryStatus === 'sending' ? (
                                      <span title="Sending…"><Clock size={11} className="animate-spin text-muted/70" /></span>
                                    ) : m.deliveryStatus === 'failed' ? (
                                      <span title="Message failed to send"><AlertCircle size={12} className="text-danger" /></span>
                                    ) : m.deliveryStatus === 'read' ? (
                                      <span className="text-primary font-bold text-[11px]" title="Read">✓✓</span>
                                    ) : (
                                      <span title="Sent to server"><Check size={12} className="text-muted/70" /></span>
                                    )}
                                  </span>
                                )}
                              </div>
                            </div>
                          )}

                          {/* Floating Telegram Forward Button Beside Bubble */}
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation()
                              handleSelectForward(m)
                            }}
                            className={`size-8 rounded-full bg-panel/90 hover:bg-primary text-muted hover:text-white border border-border shadow-lg flex items-center justify-center transition-all hover:scale-110 active:scale-95 cursor-pointer shrink-0 mb-1 ${
                              isChannel ? 'opacity-85 hover:opacity-100' : 'opacity-0 group-hover/msg:opacity-100'
                            }`}
                            title="Forward message"
                          >
                            <CornerUpRight size={14} />
                          </button>
                        </div>
                      </div>
                    )
                  })()}
                </React.Fragment>
              )
            })}

            {/* Live in-chat outgoing upload progress bubbles */}
            {chatUploads.map((u) => (
              <div key={u.id} className="flex w-full justify-end my-2">
                <div className="flex flex-col items-end max-w-[420px] w-full">
                  <div className="relative rounded-2xl rounded-tr-sm bg-panel border border-primary/30 shadow-xl p-3.5 text-text w-full animate-in fade-in slide-in-from-bottom-2 duration-200">
                    <div className="flex items-center gap-3">
                      {/* Circular Progress Indicator with Cancel Button */}
                      <div className="relative size-12 shrink-0 flex items-center justify-center">
                        <svg className="size-12 -rotate-90">
                          <circle cx="24" cy="24" r="20" className="stroke-border" strokeWidth="3" fill="none" />
                          <circle
                            cx="24"
                            cy="24"
                            r="20"
                            className="stroke-primary transition-all duration-300"
                            strokeWidth="3"
                            fill="none"
                            strokeLinecap="round"
                            strokeDasharray="125.6"
                            strokeDashoffset={125.6 * (1 - u.progress / 100)}
                          />
                        </svg>
                        <button
                          type="button"
                          onClick={() => handleCancelUpload(u.id)}
                          className="absolute inset-0 m-auto size-7 rounded-full bg-panel/80 hover:bg-red-500/80 text-text hover:text-white flex items-center justify-center transition-all cursor-pointer shadow border border-border"
                          title={u.status === 'failed' ? 'Remove upload' : 'Cancel upload'}
                          disabled={!u.jobId && u.status !== 'failed'}
                        >
                          <X size={14} />
                        </button>
                      </div>

                      {/* File details and progress bar */}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[13px] font-semibold text-text truncate" title={u.name}>
                            {u.name}
                          </span>
                          <span className="text-[11px] font-bold text-primary tabular-nums shrink-0">
                            {u.progress}%
                          </span>
                        </div>

                        {/* Glowing progress bar */}
                        <div className="h-1.5 w-full bg-tile rounded-full overflow-hidden my-1.5 border border-border">
                          <div
                            style={{ width: `${u.progress}%` }}
                            className="h-full bg-gradient-to-r from-primary to-primary-hover shadow-glow transition-all duration-300 rounded-full"
                          />
                        </div>

                        <div className="flex items-center justify-between text-[10.5px] text-muted tabular-nums">
                          <span>{fmtBytes(u.bytesUploaded)} of {fmtBytes(u.size)}</span>
                          {u.speed > 0 && <span className="text-primary">{fmtBytes(u.speed)}/s</span>}
                        </div>
                      </div>
                    </div>

                    {/* Bubble footer with status */}
                    <div className="flex items-center justify-end gap-1.5 mt-2 pt-1 border-t border-border text-[10px] text-muted">
                      {u.status === 'failed' ? <>
                        <span role="alert" className="text-danger flex-1 text-left break-words">{u.error || 'Upload failed'}</span>
                        {u.jobId && <button type="button" onClick={() => retryUpload(u.jobId!)} className="text-primary hover:underline">Retry upload</button>}
                      </> : <>
                        <span>{u.status === 'paused' ? 'Upload paused' : u.status === 'queued' ? 'Waiting to upload…' : u.progress === 100 ? 'Sending message…' : 'Uploading to chat…'}</span>
                        <Clock size={10} className={u.status === 'active' ? 'animate-spin text-primary' : 'text-muted'} />
                      </>}
                      {u.jobId && <a href="#/queue?tab=uploads" className="ml-2 text-primary hover:underline">View in queue</a>}
                    </div>
                  </div>
                </div>
              </div>
            ))}

            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* Floating Scroll to Bottom Button */}
      {showScrollBottom && (
        <button
          onClick={() => scrollToBottom('smooth')}
          className="absolute bottom-24 right-6 z-30 flex size-10 items-center justify-center rounded-full bg-primary text-white shadow-2xl hover:bg-primary-hover hover:scale-105 active:scale-95 transition-all cursor-pointer border border-white/20"
          title="Scroll to latest"
        >
          <ChevronDown size={19} />
        </button>
      )}

      {/* Context Menu Dropdown */}
      {contextMenu && createPortal(
        <div
          style={{ top: `${contextMenu.y}px`, left: `${contextMenu.x}px` }}
          onClick={(e) => e.stopPropagation()}
          className="fixed z-50 w-52 rounded-2xl border border-border bg-panel/95 backdrop-blur-2xl p-2 shadow-2xl space-y-1 select-none animate-in fade-in zoom-in-95 duration-100"
        >
          {/* Quick Reaction Emoji Strip */}
          <div className="flex items-center justify-between gap-1 pb-2 border-b border-border/50 px-1">
            {QUICK_REACTIONS.map((emoji) => {
              const norm = (s: string) => s.replace(/\uFE0F/g, '')
              const msgReactions = optimisticReactions[contextMenu.message.id] !== undefined
                ? optimisticReactions[contextMenu.message.id]
                : (contextMenu.message?.reactions || [])
              const isChosen = msgReactions.some((r: any) => r.chosen && norm(r.emoji) === norm(emoji))
              return (
                <button
                  key={emoji}
                  type="button"
                  onClick={() => handleAddReaction(contextMenu.message, emoji)}
                  className={`size-7 rounded-lg flex items-center justify-center text-[15px] transition-all cursor-pointer ${
                    isChosen ? 'bg-primary/30 ring-1 ring-primary' : 'hover:bg-white/15'
                  }`}
                  title={isChosen ? `Remove ${emoji}` : `React with ${emoji}`}
                >
                  <span className="emoji-glyph">{emoji}</span>
                </button>
              )
            })}
          </div>

          {/* Context Options */}
          <button
            type="button"
            onClick={() => handleSelectReply(contextMenu.message)}
            className="flex w-full items-center gap-2.5 rounded-xl px-2.5 py-1.5 text-left text-[12.5px] text-text hover:bg-white/10 transition-colors"
          >
            <Reply size={14} className="text-cyan" />
            <span>Reply</span>
          </button>

          <button
            type="button"
            onClick={() => {
              handleSelectForward(contextMenu.message)
              setContextMenu(null)
            }}
            className="flex w-full items-center gap-2.5 rounded-xl px-2.5 py-1.5 text-left text-[12.5px] text-text hover:bg-white/10 transition-colors"
          >
            <CornerUpRight size={14} className="text-cyan" />
            <span>Forward</span>
          </button>

          <button
            type="button"
            onClick={() => handleStartSelectMessage(contextMenu.message)}
            className="flex w-full items-center gap-2.5 rounded-xl px-2.5 py-1.5 text-left text-[12.5px] text-text hover:bg-white/10 transition-colors"
          >
            <CheckSquare size={14} className="text-cyan" />
            <span>Select Messages</span>
          </button>

          {Boolean(
            contextMenu.message.isOutgoing ||
            (me?.name && contextMenu.message.sender && contextMenu.message.sender === me.name) ||
            (me?.firstName && contextMenu.message.sender && contextMenu.message.sender === me.firstName)
          ) && (
            <button
              type="button"
              onClick={() => handleSelectEdit(contextMenu.message)}
              className="flex w-full items-center gap-2.5 rounded-xl px-2.5 py-1.5 text-left text-[12.5px] text-text hover:bg-white/10 transition-colors"
            >
              <Edit3 size={14} className="text-cyan" />
              <span>Edit Message</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => handleTogglePin(contextMenu.message)}
            className="flex w-full items-center gap-2.5 rounded-xl px-2.5 py-1.5 text-left text-[12.5px] text-text hover:bg-white/10 transition-colors"
          >
            <Pin size={14} className="text-muted" />
            <span>{contextMenu.message.isPinned ? 'Unpin Message' : 'Pin Message'}</span>
          </button>

          <button
            type="button"
            onClick={() => {
              const textToCopy = contextMenu.message.text || contextMenu.message.media?.caption || contextMenu.message.media?.name || ''
              if (navigator.clipboard?.writeText) {
                navigator.clipboard.writeText(textToCopy).catch(() => {
                  const ta = document.createElement('textarea')
                  ta.value = textToCopy
                  document.body.appendChild(ta)
                  ta.select()
                  document.execCommand('copy')
                  document.body.removeChild(ta)
                })
              }
              toast('Copied to clipboard', 'info')
              setContextMenu(null)
            }}
            className="flex w-full items-center gap-2.5 rounded-xl px-2.5 py-1.5 text-left text-[12.5px] text-text hover:bg-white/10 transition-colors"
          >
            <Copy size={14} className="text-muted" />
            <span>Copy Text</span>
          </button>

          {/* Media actions live in the 3-dot menu, not a second floating button (bug 38) */}
          {contextMenu.message.media ? (
            contextMenu.message.media.status === 'downloaded' && contextMenu.message.media.path ? (
              <button
                type="button"
                onClick={() => {
                  onRevealFile(contextMenu.message.media.path)
                  setContextMenu(null)
                }}
                className="flex w-full items-center gap-2.5 rounded-xl px-2.5 py-1.5 text-left text-[12.5px] text-text hover:bg-white/10 transition-colors"
              >
                <FolderOpen size={14} className="text-cyan" />
                <span>Show in Folder</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={(e) => {
                  onDownloadItem({ chatId, messageId: contextMenu.message.id }, false, e)
                  setContextMenu(null)
                }}
                className="flex w-full items-center gap-2.5 rounded-xl px-2.5 py-1.5 text-left text-[12.5px] text-text hover:bg-white/10 transition-colors"
              >
                <Download size={14} className="text-cyan" />
                <span>Download Media</span>
              </button>
            )
          ) : null}

          {(() => {
            const isOut = Boolean(
              contextMenu.message.isOutgoing ||
              (me?.name && contextMenu.message.sender && contextMenu.message.sender === me.name) ||
              (me?.firstName && contextMenu.message.sender && contextMenu.message.sender === me.firstName)
            )
            const canDelete = Boolean(
              contextMenu.message.canBeDeleted !== undefined
                ? contextMenu.message.canBeDeleted
                : (
                    isOut ||
                    activeChat?.kind === 'saved' ||
                    activeChat?.kind === 'private' ||
                    activeChat?.canPost
                  )
            )

            if (!canDelete) return null

            return (
              <button
                type="button"
                onClick={() => promptDelete(contextMenu.message)}
                className="flex w-full items-center gap-2.5 rounded-xl px-2.5 py-1.5 text-left text-[12.5px] text-danger hover:bg-danger/15 transition-colors cursor-pointer"
                title="Delete Message"
              >
                <Trash2 size={14} className="text-danger" />
                <span>Delete Message</span>
              </button>
            )
          })()}
        </div>,
        document.body
      )}

      {/* Message Multi-Selection Bottom Action Bar */}
      {isSelectingMessages && (
        <div className="shrink-0 p-3 bg-panel border-t border-border flex items-center justify-between z-20 animate-in fade-in slide-in-from-bottom-2 duration-150">
          <div className="flex items-center gap-3">
            <span className="text-[13px] font-semibold text-text">
              {selectedMessageIds.size} message{selectedMessageIds.size !== 1 ? 's' : ''} selected
            </span>
            <button
              type="button"
              onClick={() => {
                if (selectedMessageIds.size === messages.length) {
                  setSelectedMessageIds(new Set())
                } else {
                  setSelectedMessageIds(new Set(messages.map((m: any) => m.id)))
                }
              }}
              className="text-[12px] text-primary hover:underline cursor-pointer font-medium"
            >
              {selectedMessageIds.size === messages.length ? 'Deselect All' : 'Select All'}
            </button>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={selectedMessageIds.size === 0}
              onClick={handleForwardSelectedMessages}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-primary text-white text-[12px] font-semibold hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed transition-all cursor-pointer shadow-sm"
            >
              <CornerUpRight size={13} />
              <span>Forward{selectedMessageIds.size > 0 ? ` (${selectedMessageIds.size})` : ''}</span>
            </button>
            <button
              type="button"
              disabled={selectedMessageIds.size === 0}
              onClick={handleDeleteSelectedMessages}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-danger/15 text-danger border border-danger/30 text-[12px] font-semibold hover:bg-danger hover:text-white disabled:opacity-40 disabled:cursor-not-allowed transition-all cursor-pointer"
            >
              <Trash2 size={13} />
              <span>Delete{selectedMessageIds.size > 0 ? ` (${selectedMessageIds.size})` : ''}</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setIsSelectingMessages(false)
                setSelectedMessageIds(new Set())
              }}
              className="px-3 py-1.5 rounded-xl border border-border bg-tile text-[12px] text-muted hover:text-text hover:bg-tile/80 transition-all cursor-pointer"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Input Area Toolbar (Replying Banner / Editing Banner + Textarea + Attach + Send) */}
      <div className="p-3 border-t border-border bg-panel/95 backdrop-blur-md flex flex-col gap-1.5 shrink-0 z-20">
        {/* Reply Preview Bar */}
        {replyingTo && (
          <div className="flex items-center justify-between rounded-xl bg-primary/10 border border-primary/20 px-3 py-1.5 text-[12px] animate-in fade-in slide-in-from-bottom-2 duration-150">
            <div className="flex items-center gap-2 min-w-0">
              <Reply size={14} className="text-primary shrink-0" />
              <div className="min-w-0">
                <div className="flex items-center gap-1 font-semibold text-primary leading-tight text-[12px]">
                  <span>Replying to</span>
                  <span>{replyingTo.sender}</span>
                </div>
                <div className="text-text-2 truncate text-[11px] leading-tight mt-0.5">
                  {replyingTo.text || replyingTo.media?.name || 'Attachment'}
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setReplyingTo(null)}
              className="p-1 rounded-full text-muted hover:text-text hover:bg-tile transition-colors cursor-pointer"
              title="Cancel reply"
            >
              <X size={13} />
            </button>
          </div>
        )}

        {/* Edit Preview Bar */}
        {editingMessage && (
          <div className="flex items-center justify-between rounded-xl bg-primary/15 border border-primary/30 px-3 py-1.5 text-[12px] animate-in fade-in slide-in-from-bottom-2 duration-150">
            <div className="flex items-center gap-2 min-w-0">
              <Edit3 size={14} className="text-primary shrink-0" />
              <div className="min-w-0">
                <div className="font-semibold text-primary leading-tight text-[12px]">Editing message</div>
                <div className="text-text-2 truncate text-[11px] leading-tight mt-0.5">
                  {editingMessage.text}
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                setEditingMessage(null)
                setInputText('')
              }}
              className="p-1 rounded-full text-muted hover:text-text hover:bg-tile transition-colors cursor-pointer"
              title="Cancel editing"
            >
              <X size={13} />
            </button>
          </div>
        )}

        {/* Staged Attachments Banner (e.g. from Drag & Drop) */}
        {stagedFiles.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-primary/30 bg-primary/10 px-3 py-2 shadow-xs animate-in fade-in slide-in-from-bottom-2 duration-150">
            <div className="flex items-center gap-1.5 text-[12px] font-semibold text-primary mr-1">
              <Upload size={14} />
              <span>{stagedFiles.length} {stagedFiles.length === 1 ? 'file ready to send' : 'files ready to send'}:</span>
            </div>
            <div className="flex flex-wrap items-center gap-1.5 flex-1 min-w-0">
              {stagedFiles.map((f, i) => (
                <span
                  key={`${f.name}-${i}`}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-panel/90 border border-border px-2.5 py-1 text-[11.5px] text-text font-medium shadow-xs"
                >
                  <span className="max-w-[150px] truncate" title={f.name}>{f.name}</span>
                  <span className="text-muted text-[10.5px] tabular-nums">({fmtBytes(f.size)})</span>
                  <button
                    type="button"
                    onClick={() => setStagedFiles((prev) => prev.filter((_, idx) => idx !== i))}
                    className="text-muted hover:text-danger ml-0.5 p-0.5 rounded cursor-pointer transition-colors"
                    title="Remove file"
                  >
                    <X size={12} />
                  </button>
                </span>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setStagedFiles([])}
              className="text-[11.5px] text-danger hover:underline ml-auto font-medium cursor-pointer"
            >
              Cancel all
            </button>
          </div>
        )}

        {/* Text Input Row */}
        <div className="relative flex items-end gap-2">
          {/* Telegram-style Emoji Picker Popover */}
          {emojiPickerOpen && (
            <div
              ref={emojiPickerRef}
              data-testid="emoji-picker-panel"
              className="absolute bottom-12 left-0 z-40 w-80 rounded-2xl border border-border bg-panel/95 backdrop-blur-2xl p-2.5 shadow-2xl flex flex-col gap-2 select-none animate-in fade-in zoom-in-95 duration-100"
            >
              {/* Category Tabs */}
              <div className="flex items-center gap-1 border-b border-border/50 pb-1.5 px-1">
                {(['smileys', 'gestures', 'hearts'] as const).map((cat) => (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => setEmojiCategory(cat)}
                    className={`px-2.5 py-1 rounded-lg text-[11.5px] font-medium transition-all cursor-pointer ${
                      emojiCategory === cat
                        ? 'bg-primary/25 text-primary border border-primary/40'
                        : 'text-muted hover:text-text hover:bg-tile'
                    }`}
                  >
                    {EMOJI_CATEGORIES[cat].name}
                  </button>
                ))}
              </div>

              {/* Emoji Grid */}
              <div className="grid grid-cols-8 gap-1 overflow-y-auto max-h-48 p-1">
                {EMOJI_CATEGORIES[emojiCategory].emojis.map((emoji) => (
                  <button
                    key={emoji}
                    type="button"
                    onClick={() => insertEmoji(emoji)}
                    className="size-8 rounded-lg hover:bg-tile flex items-center justify-center text-[18px] transition-colors cursor-pointer leading-none"
                    title={emoji}
                  >
                    <span className="emoji-glyph">{emoji}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Attachment Paperclip Button */}
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={!canPost || sending}
            className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-border bg-tile text-muted hover:text-text hover:border-primary disabled:opacity-40 disabled:cursor-not-allowed transition-all cursor-pointer"
            title="Attach file or media"
          >
            <Paperclip size={17} />
          </button>

          {/* Emoji Picker Toggle Button */}
          <button
            type="button"
            data-testid="emoji-picker-btn"
            onClick={() => setEmojiPickerOpen((prev) => !prev)}
            disabled={!canPost || sending}
            className={`flex size-10 shrink-0 items-center justify-center rounded-xl border border-border bg-tile transition-all cursor-pointer ${
              emojiPickerOpen
                ? 'text-primary border-primary bg-primary/10 shadow-glow'
                : 'text-muted hover:text-text hover:border-primary disabled:opacity-40 disabled:cursor-not-allowed'
            }`}
            title="Insert emoji"
          >
            <Smile size={18} />
          </button>

          {/* Auto-resizing Multi-line Textarea */}
          <textarea
            ref={textareaRef}
            rows={1}
            value={inputText}
            disabled={!canPost || sending}
            onChange={(e) => {
              setInputText(e.target.value)
              handleTyping()
            }}
            onPaste={(e) => {
              const pasted = e.clipboardData?.getData('text')
              if (pasted && !inputText) {
                setInputText(pasted)
                handleTyping()
              }
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                handleSend()
              }
            }}
            placeholder={
              !canPost
                ? 'Posting not permitted in this chat'
                : editingMessage
                ? 'Edit your message…'
                : replyingTo
                ? `Replying to ${replyingTo.sender}…`
                : stagedFiles.length > 0
                ? 'Add an optional caption… (Press Enter or click Send to upload)'
                : 'Write a message… (Shift+Enter for new line)'
            }
            className="flex-1 resize-none rounded-xl border border-border bg-tile px-4 py-2.5 text-[13px] text-text placeholder:text-muted focus:border-primary outline-none transition-colors disabled:opacity-40 disabled:cursor-not-allowed leading-relaxed max-h-[160px]"
          />

          {/* Send / Save Button */}
          <button
            type="button"
            onClick={handleSend}
            disabled={(!inputText.trim() && stagedFiles.length === 0) || sending || !canPost}
            className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary text-white shadow-glow hover:bg-primary-hover disabled:opacity-40 disabled:cursor-not-allowed transition-all cursor-pointer"
            title={editingMessage ? 'Save changes' : stagedFiles.length > 0 ? 'Send attached file(s)' : 'Send message'}
          >
            {editingMessage ? <Check size={18} /> : <Send size={16} />}
          </button>
        </div>
      </div>

      {/* Delete Message Confirmation Modal */}
      {deleteModalOpen && (
        <Dialog
          title="Delete Message"
          open={deleteModalOpen}
          onClose={() => setDeleteModalOpen(false)}
        >
          <div className="space-y-4">
            <p className="text-[13px] text-text-2">
              Are you sure you want to delete this message? This action cannot be undone.
            </p>

            <label className="flex items-center gap-2 text-[12.5px] text-text cursor-pointer select-none">
              <input
                type="checkbox"
                checked={deleteRevoke}
                onChange={(e) => setDeleteRevoke(e.target.checked)}
                className="size-4 rounded accent-primary cursor-pointer"
              />
              <span>Also delete for everyone in this chat</span>
            </label>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setDeleteModalOpen(false)}
                className="px-3.5 py-1.5 rounded-lg border border-border bg-tile text-[12.5px] text-text hover:border-primary/40 transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmDelete}
                className="px-3.5 py-1.5 rounded-lg bg-danger text-white text-[12.5px] font-medium hover:bg-danger/90"
              >
                Delete
              </button>
            </div>
          </div>
        </Dialog>
      )}

      {/* Delete Multiple Messages Confirmation Modal */}
      {bulkDeleteModalOpen && (
        <Dialog
          title="Delete Messages"
          open={bulkDeleteModalOpen}
          onClose={() => setBulkDeleteModalOpen(false)}
        >
          <div className="space-y-4">
            <div className="flex items-start gap-3 p-3.5 rounded-xl bg-danger/10 border border-danger/25">
              <div className="size-9 rounded-xl bg-danger/20 text-danger flex items-center justify-center shrink-0">
                <Trash2 size={18} />
              </div>
              <div className="space-y-1">
                <div className="text-[13.5px] font-semibold text-text">
                  Delete {selectedMessageIds.size} selected message{selectedMessageIds.size > 1 ? 's' : ''}?
                </div>
                <p className="text-[12px] text-muted leading-relaxed">
                  Are you sure you want to delete these messages? This action cannot be undone.
                </p>
              </div>
            </div>

            <label className="flex items-center gap-2 text-[12.5px] text-text cursor-pointer select-none">
              <input
                type="checkbox"
                checked={bulkDeleteRevoke}
                onChange={(e) => setBulkDeleteRevoke(e.target.checked)}
                className="size-4 rounded accent-primary cursor-pointer"
              />
              <span>Also delete for everyone in this chat</span>
            </label>

            <div className="flex justify-end gap-2 pt-2 border-t border-border">
              <button
                type="button"
                onClick={() => setBulkDeleteModalOpen(false)}
                className="px-3.5 py-1.5 rounded-lg border border-border bg-tile text-[12.5px] text-text hover:border-primary/40 transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={bulkDeleteBusy}
                onClick={handleConfirmBulkDelete}
                className="px-4 py-1.5 rounded-lg bg-danger text-white text-[12.5px] font-semibold hover:bg-danger/90 transition-colors flex items-center gap-1.5 cursor-pointer"
              >
                {bulkDeleteBusy && <div className="size-3.5 rounded-full border-2 border-white border-t-transparent animate-spin" />}
                <Trash2 size={14} />
                <span>Delete</span>
              </button>
            </div>
          </div>
        </Dialog>
      )}

      {/* Telegram Forward Message Modal */}
      {forwardingMessage && (
        <Dialog
          title="Forward Message"
          open={Boolean(forwardingMessage)}
          onClose={() => {
            setForwardingMessage(null)
            setForwardingMessageIds([])
            setSelectedTargetChatIds(new Set())
          }}
        >
          <div className="space-y-3.5">
            {/* Forward Message Quote Preview */}
            <div className="rounded-xl border-l-4 border-primary bg-panel p-2.5 flex items-start gap-2.5 border border-border">
              <div className="min-w-0 flex-1">
                <div className="text-[12px] font-semibold text-primary truncate">
                  {forwardingMessageIds.length > 1
                    ? `${forwardingMessageIds.length} Messages Selected`
                    : (forwardingMessage.sender || activeChat?.title || 'Unknown')}
                </div>
                <div className="text-[12.5px] text-text truncate mt-0.5">
                  {forwardingMessageIds.length > 1
                    ? `Forwarding ${forwardingMessageIds.length} selected messages`
                    : (forwardingMessage.text || forwardingMessage.media?.name || (forwardingMessage.media?.type ? `[${forwardingMessage.media.type}]` : 'Message'))}
                </div>
              </div>
            </div>

            {/* Send as copy toggle */}
            <label className="flex items-center gap-2 text-[12.5px] text-text-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={sendAsCopy}
                onChange={(e) => setSendAsCopy(e.target.checked)}
                className="size-4 rounded accent-primary cursor-pointer"
              />
              <span>Send without sender name (send as copy)</span>
            </label>

            {/* Search destination chats */}
            <div className="relative">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
              <input
                type="text"
                value={forwardSearch}
                onChange={(e) => setForwardSearch(e.target.value)}
                placeholder="Search chats and channels..."
                className="w-full rounded-xl bg-tile border border-border pl-9 pr-3 py-2 text-[13px] text-text placeholder:text-muted focus:border-primary focus:outline-none"
              />
            </div>

            {/* Target chats scrollable list */}
            <div className="max-h-60 overflow-y-auto space-y-1 pr-1 custom-scrollbar">
              {(allChats.length > 0 ? allChats : (activeChat ? [activeChat] : []))
                .filter((c: any) => {
                  if (!forwardSearch.trim()) return true
                  const q = forwardSearch.toLowerCase()
                  return c.title?.toLowerCase().includes(q) || c.username?.toLowerCase().includes(q)
                })
                .map((c: any) => {
                  const isTargetSelected = selectedTargetChatIds.has(c.id)
                  return (
                    <button
                      key={c.id}
                      type="button"
                      disabled={forwardingTargetId !== null || forwardingBulkProgress}
                      onClick={() => {
                        if (selectedTargetChatIds.size > 0) {
                          toggleTargetChat(c.id)
                        } else {
                          handleConfirmForward(c)
                        }
                      }}
                      className={`w-full flex items-center justify-between p-2 rounded-xl transition-colors text-left group cursor-pointer disabled:opacity-50 ${
                        isTargetSelected ? 'bg-primary/15 border border-primary/30' : 'hover:bg-tile'
                      }`}
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <Avatar size={34} name={c.title} src={c.photo} />
                        <div className="min-w-0 flex-1">
                          <div className="text-[13px] font-medium text-text truncate group-hover:text-primary transition-colors">
                            {c.title}
                          </div>
                          <div className="text-[11px] text-muted capitalize truncate">
                            {c.kind === 'channel' ? 'Channel' : c.kind === 'saved' ? 'Saved Messages' : c.kind || 'Chat'}
                          </div>
                        </div>
                      </div>
                      <div className="shrink-0 ml-2 flex items-center gap-2">
                        {/* Multi-recipient checkbox */}
                        <div
                          onClick={(e) => {
                            e.stopPropagation()
                            toggleTargetChat(c.id)
                          }}
                          className={`size-5 rounded border flex items-center justify-center transition-all ${
                            isTargetSelected ? 'bg-primary border-primary text-white shadow-xs' : 'border-border bg-tile group-hover:border-primary/50'
                          }`}
                          title={isTargetSelected ? 'Deselect chat' : 'Select for multi-chat forward'}
                        >
                          {isTargetSelected && <Check size={12} strokeWidth={3} />}
                        </div>
                        {forwardingTargetId === c.id ? (
                          <div className="size-4 rounded-full border-2 border-cyan border-t-transparent animate-spin" />
                        ) : (
                          <CornerUpRight size={15} className="text-muted group-hover:text-cyan transition-colors" />
                        )}
                      </div>
                    </button>
                  )
                })}
            </div>

            <div className="flex items-center justify-between pt-2 border-t border-border">
              {selectedTargetChatIds.size > 0 ? (
                <span className="text-[12px] font-medium text-text">
                  {selectedTargetChatIds.size} chat{selectedTargetChatIds.size > 1 ? 's' : ''} selected
                </span>
              ) : (
                <span className="text-[11.5px] text-muted">
                  Click a chat to send, or check multiple
                </span>
              )}
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setForwardingMessage(null)
                    setForwardingMessageIds([])
                    setSelectedTargetChatIds(new Set())
                  }}
                  className="px-3.5 py-1.5 rounded-xl border border-border bg-tile text-[12.5px] text-text hover:bg-tile/80 transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                {selectedTargetChatIds.size > 0 && (
                  <button
                    type="button"
                    disabled={forwardingBulkProgress}
                    onClick={handleBulkForwardToTargets}
                    className="px-4 py-1.5 rounded-xl bg-primary text-white text-[12.5px] font-semibold hover:bg-primary/90 transition-colors cursor-pointer flex items-center gap-1.5 shadow-sm"
                  >
                    {forwardingBulkProgress && <div className="size-3.5 rounded-full border-2 border-white border-t-transparent animate-spin" />}
                    <span>Forward to {selectedTargetChatIds.size} chat{selectedTargetChatIds.size > 1 ? 's' : ''}</span>
                  </button>
                )}
              </div>
            </div>
          </div>
        </Dialog>
      )}
    </div>
  )
}
