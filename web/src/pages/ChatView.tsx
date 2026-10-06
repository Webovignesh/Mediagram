import React, { useState, useRef, useEffect, useLayoutEffect, useMemo, useCallback } from 'react'
import { createPortal } from 'react-dom'
import {
  Send, Paperclip, Smile, Reply, Edit3, Pin, Trash2, Copy, Check, Clock, AlertCircle,
  MoreVertical, X, ChevronDown, Download, FolderOpen, Film, Play, FileText, CornerDownRight,
  ExternalLink, Sparkles, Music, CornerUpRight, Eye, Volume2, Search
} from 'lucide-react'
import { call, on } from '../api.ts'
import { Avatar, Dialog, toast, fmtBytes, fmtDuration, MediagramLogo, CheckDuplicatesModal, ChatMediaThumb } from '../ui.tsx'
import type { Message, TextEntity, ReactionItem } from '../../../core/shapes.ts'

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
  progress: number
  bytesUploaded: number
  speed: number
  status: 'uploading' | 'completed' | 'failed'
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
    const tokenRegex = /(```[\s\S]*?```|`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*|__[^_]+__|~~[^~]+~~|\|\|[^|]+\|\||https?:\/\/[^\s]+|t\.me\/[^\s]+|tg:\/\/[^\s]+)/g
    const parts = text.split(tokenRegex)
    return (
      <div className="whitespace-pre-wrap leading-relaxed text-[13.5px] text-slate-100 font-normal break-words">
        {parts.map((part, i) => {
          if (!part) return null
          if (part.startsWith('```') && part.endsWith('```')) {
            const code = part.slice(3, -3).replace(/^\n/, '')
            return (
              <pre key={i} className="my-1.5 rounded-lg bg-black/50 p-2 font-mono text-[12px] text-cyan overflow-x-auto border border-white/10">
                <code>{code}</code>
              </pre>
            )
          }
          if (part.startsWith('`') && part.endsWith('`')) {
            return (
              <code key={i} className="rounded bg-black/40 px-1.5 py-0.5 font-mono text-[12px] text-cyan border border-white/10">
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
            return <s key={i} className="line-through opacity-75">{part.slice(2, -2)}</s>
          }
          if (part.startsWith('||') && part.endsWith('||')) {
            return (
              <span key={i} className="rounded bg-white/20 px-1 py-0.5 filter blur-[3px] hover:filter-none transition-all cursor-pointer" title="Click to reveal spoiler">
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
                className="inline-flex items-center gap-1 text-cyan hover:text-cyan/80 underline font-medium hover:bg-cyan/10 rounded px-1 -mx-0.5 transition-colors cursor-pointer text-left break-all"
                title={isTg ? 'Open Telegram link' : 'Open in browser'}
              >
                {isTg ? <MediagramLogo size={13} className="inline shrink-0 mr-0.5 rounded-[3px]" /> : <ExternalLink size={11} className="inline shrink-0 opacity-75" />}
                <span>{part}</span>
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
        segments.push(<s key={key} className="line-through text-slate-400">{content}</s>)
        break
      case 'code':
        segments.push(
          <code
            key={key}
            onClick={(e) => {
              e.stopPropagation()
              navigator.clipboard.writeText(content)
              toast('Code copied to clipboard', 'info')
            }}
            className="rounded bg-black/40 px-1.5 py-0.5 font-mono text-[12px] text-cyan border border-white/10 select-all cursor-pointer hover:bg-black/60 transition-colors"
            title="Click to copy code"
          >
            {content}
          </code>
        )
        break
      case 'pre':
        segments.push(
          <div key={key} className="relative my-2 rounded-xl bg-black/60 p-3 font-mono text-[12px] text-slate-200 border border-white/10 overflow-x-auto group/pre">
            <pre className="whitespace-pre">{content}</pre>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                navigator.clipboard.writeText(content)
                toast('Code block copied', 'info')
              }}
              className="absolute top-2 right-2 p-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-muted hover:text-white transition-colors"
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
                ? 'bg-white/10 text-white'
                : 'bg-slate-700/80 text-transparent select-none blur-[4px] hover:blur-[3px]'
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
            className="inline-flex items-center gap-0.5 text-cyan hover:text-cyan/80 underline font-medium hover:bg-cyan/10 rounded px-1 -mx-0.5 transition-colors cursor-pointer text-left break-all"
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
          <span key={key} className="text-cyan font-medium cursor-pointer hover:underline">
            {content}
          </span>
        )
        break
      default:
        segments.push(<span key={key}>{content}</span>)
        break
    }

    lastIndex = entity.offset + entity.length
  })

  if (lastIndex < text.length) {
    segments.push(<span key={`tail-${lastIndex}`}>{text.substring(lastIndex)}</span>)
  }

  return <p className="whitespace-pre-wrap leading-relaxed text-[13.5px] text-slate-100 font-normal break-words">{segments}</p>
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
}

export function ChatView({
  chatId,
  activeChat,
  allChats = [],
  me,
  messages,
  hasMore,
  loading,
  error,
  onLoadOlder,
  onReload,
  onOpenViewer,
  onDownloadItem,
  onRevealFile,
  onOpenLink,
  activeTyping,
}: ChatViewProps) {
  const [inputText, setInputText] = useState('')
  const [sending, setSending] = useState(false)
  const [replyingTo, setReplyingTo] = useState<any | null>(null)
  const [editingMessage, setEditingMessage] = useState<any | null>(null)
  const [forwardingMessage, setForwardingMessage] = useState<any | null>(null)
  const [forwardSearch, setForwardSearch] = useState('')
  const [sendAsCopy, setSendAsCopy] = useState(false)
  const [forwardingTargetId, setForwardingTargetId] = useState<number | null>(null)
  const [chatMsgSearch, setChatMsgSearch] = useState('')
  const [mediaOnly, setMediaOnly] = useState(false)
  const [showScrollBottom, setShowScrollBottom] = useState(false)
  const [emojiPickerOpen, setEmojiPickerOpen] = useState(false)
  const [emojiCategory, setEmojiCategory] = useState<'smileys' | 'gestures' | 'hearts'>('smileys')
  const [optimisticReactions, setOptimisticReactions] = useState<Record<number, ReactionItem[]>>({})
  const [chatUploads, setChatUploads] = useState<ChatUploadItem[]>([])

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

  // Live in-chat upload progress polling
  useEffect(() => {
    if (chatUploads.length === 0) return
    const interval = setInterval(async () => {
      try {
        const stats = await call<any>('stats.live').catch(() => null)
        if (!stats) return
        const activeUpload = stats.active?.find((a: any) => a.kind === 'upload')
        setChatUploads((prev) => {
          if (!prev.length) return prev
          return prev.map((item) => {
            if (item.status !== 'uploading') return item
            if (activeUpload) {
              const done = activeUpload.done || 0
              const sz = activeUpload.size || item.size || 1
              const pct = Math.min(98, Math.max(item.progress, Math.round((done / sz) * 100)))
              return {
                ...item,
                progress: pct,
                bytesUploaded: done,
                speed: activeUpload.speed || 0,
                jobId: activeUpload.id,
              }
            } else {
              const nextPct = Math.min(95, item.progress + 4)
              return {
                ...item,
                progress: nextPct,
                bytesUploaded: Math.round((nextPct / 100) * item.size),
              }
            }
          })
        })
      } catch {}
    }, 280)
    return () => clearInterval(interval)
  }, [chatUploads.length])

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

  // Reset reply/edit/forward state on chat change
  useEffect(() => {
    setReplyingTo(null)
    setEditingMessage(null)
    setForwardingMessage(null)
    setInputText('')
    setContextMenu(null)
    setEmojiPickerOpen(false)
    setOptimisticReactions({})
    setChatUploads([])
  }, [chatId])

  function handleSelectForward(m: any) {
    setForwardingMessage(m)
    setForwardSearch('')
    setSendAsCopy(false)
  }

  async function handleConfirmForward(targetChat: any) {
    if (!forwardingMessage) return
    setForwardingTargetId(targetChat.id)
    try {
      await call('messages.forward', {
        fromChatId: chatId,
        toChatId: targetChat.id,
        messageIds: [forwardingMessage.id],
        sendCopy: sendAsCopy,
      })
      toast(`Message forwarded to ${targetChat.title}`)
      setForwardingMessage(null)
    } catch (err: any) {
      toast(err?.message || 'Failed to forward message', 'danger')
    } finally {
      setForwardingTargetId(null)
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

  // Scroll to bottom helper
  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'smooth') => {
    messagesEndRef.current?.scrollIntoView({ behavior })
  }, [])

  // Scroll to bottom on initial load / chat switch
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

  // Send message
  async function handleSend() {
    if (!inputText.trim() || sending) return
    const textToSend = inputText.trim()
    setSending(true)

    try {
      if (editingMessage) {
        await call('messages.edit', { chatId, messageId: editingMessage.id, text: textToSend })
        toast('Message edited')
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

  // Handle attachment selection and in-chat direct upload
  async function handleAttachFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files
    if (!files || files.length === 0) return
    const fileList = Array.from(files)

    // Build optimistic in-chat upload items immediately
    const newItems: ChatUploadItem[] = fileList.map((f, i) => {
      let type: 'photo' | 'video' | 'audio' | 'document' = 'document'
      if (f.type.startsWith('image/')) type = 'photo'
      else if (f.type.startsWith('video/')) type = 'video'
      else if (f.type.startsWith('audio/')) type = 'audio'
      return {
        id: `upload-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 6)}`,
        name: f.name,
        size: f.size,
        type,
        previewUrl: f.type.startsWith('image/') ? URL.createObjectURL(f) : undefined,
        progress: 8,
        bytesUploaded: 0,
        speed: 0,
        status: 'uploading',
      }
    })

    setChatUploads((prev) => [...prev, ...newItems])
    setTimeout(() => scrollToBottom('smooth'), 50)

    try {
      const bridge = (window as any).mediagram || (window as any).teleflow
      const paths = fileList.map((f) => bridge?.pathOf?.(f) || (f as any).path || f.name).filter(Boolean)
      if (!paths.length) {
        toast('Could not read file path for upload', 'danger')
        setChatUploads((prev) => prev.filter((item) => !newItems.some((n) => n.id === item.id)))
        return
      }

      await new Promise((r) => setTimeout(r, 25))

      await call('uploads.add', {
        chatId,
        paths,
        caption: inputText.trim(),
        album: paths.length > 1,
        keepNames: true,
      })

      setInputText('')

      // Progressive completion transition
      setTimeout(() => {
        setChatUploads((prev) =>
          prev.map((item) => (newItems.some((n) => n.id === item.id) ? { ...item, progress: 100, status: 'completed' } : item))
        )
        setTimeout(() => {
          onReload()
          setChatUploads((prev) => prev.filter((item) => !newItems.some((n) => n.id === item.id)))
        }, 500)
      }, 1000)
    } catch (err: any) {
      toast(err.message || 'Failed to upload attachment', 'danger')
      setChatUploads((prev) =>
        prev.map((item) => (newItems.some((n) => n.id === item.id) ? { ...item, status: 'failed', error: err.message } : item))
      )
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  async function handleCancelUpload(uploadId: string) {
    const item = chatUploads.find((u) => u.id === uploadId)
    if (item?.jobId) {
      await call('jobs.action', { action: 'cancel', ids: [item.jobId] }).catch(() => {})
    }
    setChatUploads((prev) => prev.filter((u) => u.id !== uploadId))
    toast('Upload canceled')
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
      toast(m.isPinned ? 'Message unpinned' : 'Message pinned')
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
      toast('Message deleted')
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

  // Close context menu on outside click
  useEffect(() => {
    const closeMenu = (e: MouseEvent) => {
      if (e.button === 2) return
      setContextMenu(null)
    }
    const handleContextMenuOutside = (e: MouseEvent) => {
      if (!(e.target as HTMLElement)?.closest?.('[id^="msg-"]')) {
        setContextMenu(null)
      }
    }
    window.addEventListener('click', closeMenu)
    window.addEventListener('contextmenu', handleContextMenuOutside)
    return () => {
      window.removeEventListener('click', closeMenu)
      window.removeEventListener('contextmenu', handleContextMenuOutside)
    }
  }, [])

  const isChannel = activeChat?.kind === 'channel'
  const canPost = activeChat?.canPost !== false

  return (
    <div className="relative flex-1 min-h-0 rounded-2xl border border-white/[0.08] telegram-chat-wallpaper backdrop-blur-md p-4 flex flex-col justify-between overflow-hidden shadow-2xl">
      {/* Hidden file input for attachment upload */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={handleAttachFiles}
      />

      {/* Chat View Header */}
      <div className="flex items-center justify-between gap-3 pb-3 border-b border-border mb-2 flex-wrap bg-panel/90 z-20">
        <div className="flex items-center gap-3 min-w-0">
          <Avatar src={activeChat?.photo} name={activeChat?.title || 'Chat'} size={40} />
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-[14.5px] font-bold text-text truncate leading-tight tracking-wide">
                {activeChat?.title || 'Chat'}
              </span>
              {activeChat?.pinnedMessageId && (
                <span className="flex items-center gap-1 rounded bg-cyan/15 text-cyan px-1.5 py-0.5 text-[10.5px] font-medium border border-cyan/20">
                  <Pin size={10} />
                  <span>Pinned</span>
                </span>
              )}
            </div>
            <div className="text-[12px] text-muted truncate leading-tight mt-0.5">
              {activeTyping ? (
                <span className="text-cyan font-medium animate-pulse flex items-center gap-1.5">
                  <span className="size-1.5 rounded-full bg-cyan animate-ping inline-block" />
                  <span>{activeTyping}</span>
                </span>
              ) : (
                <>{activeChat?.username ? `@${activeChat.username}` : activeChat?.kind || 'Chat'} • {filteredMessages.length} messages</>
              )}
            </div>
          </div>
        </div>

        {/* Search & Media filter */}
        <div className="flex items-center gap-2">
          <div className="relative w-52">
            <input
              type="text"
              placeholder="Search in chat…"
              value={chatMsgSearch}
              onChange={(e) => setChatMsgSearch(e.target.value)}
              className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-1.5 text-[12px] text-text placeholder:text-muted focus:border-primary outline-none transition-colors"
            />
            {chatMsgSearch && (
              <button
                type="button"
                onClick={() => setChatMsgSearch('')}
                className="absolute right-2 top-2 text-muted hover:text-white"
              >
                <X size={13} />
              </button>
            )}
          </div>
          <button
            type="button"
            onClick={() => setMediaOnly(!mediaOnly)}
            className={`flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-[12px] font-medium border transition-all ${
              mediaOnly
                ? 'bg-primary text-white border-primary shadow-glow'
                : 'bg-white/5 border-white/10 text-muted hover:text-white hover:bg-white/10'
            }`}
            title="Filter media files only"
          >
            <Film size={13} />
            <span>Media only</span>
          </button>
        </div>
      </div>

      {/* Sticky Pinned Message Header Banner */}
      {activeChat?.pinnedMessageId && (
        <div
          onClick={() => jumpToMessage(activeChat.pinnedMessageId)}
          className="flex items-center justify-between rounded-xl border border-cyan/20 bg-cyan/10 px-3.5 py-2 text-[12px] text-slate-200 mb-2 cursor-pointer hover:bg-cyan/15 transition-colors select-none"
        >
          <div className="flex items-center gap-2 min-w-0">
            <Pin size={13} className="text-cyan shrink-0" />
            <span className="font-semibold text-cyan shrink-0">Pinned Message:</span>
            <span className="truncate opacity-90">Click to view pinned message</span>
          </div>
          <span className="text-[11px] text-cyan font-medium shrink-0 ml-2">Jump →</span>
        </div>
      )}

      {/* Message Stream */}
      <div
        ref={chatScrollRef}
        onScroll={(e) => {
          const target = e.currentTarget
          const isNearBottom = target.scrollHeight - target.scrollTop - target.clientHeight < 120
          setShowScrollBottom(!isNearBottom)
        }}
        className="flex-1 overflow-y-auto overflow-x-hidden space-y-3.5 pr-2 select-text"
      >
        {/* Load older messages button */}
        {hasMore && (
          <div className="flex justify-center py-2">
            <button
              type="button"
              onClick={onLoadOlder}
              className="text-[12px] rounded-full px-4 py-1.5 shadow-sm border border-white/10 bg-white/5 text-slate-300 hover:bg-white/10 hover:text-white transition-all cursor-pointer"
            >
              Load older messages
            </button>
          </div>
        )}

        {filteredMessages.length === 0 ? (
          <div className="py-24 text-center text-muted">
            <p className="text-[13.5px]">No messages found</p>
          </div>
        ) : (
          <div className="space-y-3 pb-2">
            {/* Render in chronological order */}
            {[...filteredMessages].reverse().map((m: any, idx: number, arr: any[]) => {
              const currentDateGroup = getDateGroup(m.date)
              const prevDateGroup = idx > 0 ? getDateGroup(arr[idx - 1].date) : null
              const showDateDivider = currentDateGroup !== prevDateGroup

              const isOut = Boolean(
                m.isOutgoing ||
                (me?.name && m.sender && m.sender === me.name) ||
                (me?.firstName && m.sender && m.sender === me.firstName)
              )

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
                      className={`flex w-full ${isOut ? 'justify-end' : 'justify-start'} my-2.5 transition-all select-none group/msg`}
                    >
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
                        className={`flex w-full ${isOut ? 'justify-end' : 'justify-start'} my-1 transition-all group/msg`}
                      >
                        <div className={`flex items-end gap-1.5 ${isOut ? 'flex-row-reverse' : 'flex-row'} ${isVisualMedia ? 'max-w-[480px] w-full' : 'max-w-[85%] w-fit'}`}>
                          {/* Message Bubble Content */}
                          {isVisualMedia ? (
                            m.text ? (
                              /* Case 1: Single Visual Media WITH Caption (Telegram Card Layout) */
                              <div className={`relative overflow-hidden rounded-2xl ${
                                isOut
                                  ? 'rounded-tr-sm bg-primary/20 border-primary/35 shadow-md'
                                  : 'rounded-tl-sm bg-tile border-border shadow-md'
                              } border p-0 hover:border-primary/40 transition-all text-text w-full`}>
                                {/* Top Overlay Message Options Menu Trigger */}
                                <div className="absolute top-2.5 right-12 z-20 opacity-0 group-hover/msg:opacity-100 transition-opacity">
                                  <button
                                    type="button"
                                    onClick={(e) => openContextMenu(e, m)}
                                    className="size-8 rounded-full bg-black/60 hover:bg-black/80 text-white backdrop-blur-md border border-white/20 flex items-center justify-center transition-colors"
                                    title="Message Options"
                                  >
                                    <MoreVertical size={13} />
                                  </button>
                                </div>

                                {/* Forward Header */}
                                {m.forwardFrom && (
                                  <div className="flex items-center gap-1.5 text-[11.5px] text-cyan/90 px-3.5 pt-2.5 pb-1 italic select-none">
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
                                      className="flex items-center gap-2 rounded-lg border-l-2 border-cyan bg-black/25 px-2.5 py-1.5 text-[11.5px] cursor-pointer hover:bg-black/35 transition-colors select-none"
                                      title="Jump to replied message"
                                    >
                                      <Reply size={12} className="text-cyan shrink-0" />
                                      <div className="min-w-0 flex-1">
                                        <div className="font-semibold text-cyan leading-tight truncate">{m.replyTo.sender}</div>
                                        <div className="text-slate-300 truncate leading-tight mt-0.5">{m.replyTo.text}</div>
                                      </div>
                                    </div>
                                  </div>
                                )}

                                {/* Sender Header for Groups */}
                                {!isOut && !isChannel && (m.sender || activeChat?.title) && (
                                  <div className="flex items-center justify-between text-[11.5px] px-3.5 pt-2 pb-1">
                                    <span className="font-semibold text-cyan tracking-wide truncate max-w-[240px]">
                                      {m.sender || activeChat?.title}
                                    </span>
                                  </div>
                                )}

                                {/* Flush Edge-to-Edge Media Container (NO frames, NO double borders!) */}
                                <div
                                  className="relative w-full overflow-hidden bg-black/40 cursor-pointer group/media select-none"
                                  onMouseEnter={() => {
                                    if (m.media?.type === 'video' || m.media?.type === 'photo') {
                                      call('media.prepare', { chatId, messageId: m.id }).catch(() => {})
                                    }
                                  }}
                                  onClick={() => onOpenViewer({ name: m.media.name, path: m.media.path, thumb: m.media.thumb, type: m.media.type, size: m.media.size, duration: m.media.duration, chatId, messageId: m.id })}
                                >
                                  <ChatMediaThumb
                                    src={m.media.thumb}
                                    alt={m.media.name}
                                    minHeight="180px"
                                    maxHeight="460px"
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

                                  {/* Top-Right Quick Action Button */}
                                  <div className="absolute top-2.5 right-2.5 flex items-center gap-1.5 z-10 opacity-90 group-hover/media:opacity-100 transition-opacity">
                                    {m.media.status === 'downloaded' && m.media.path ? (
                                      <button
                                        type="button"
                                        onClick={(e) => {
                                          e.stopPropagation()
                                          onRevealFile(m.media.path)
                                        }}
                                        className="size-8 rounded-full bg-black/60 hover:bg-cyan/40 text-cyan backdrop-blur-md border border-white/20 flex items-center justify-center shadow-lg transition-transform hover:scale-110 active:scale-95"
                                        title="Show in folder"
                                      >
                                        <FolderOpen size={14} />
                                      </button>
                                    ) : (
                                      <button
                                        type="button"
                                        onClick={(ev) => {
                                          ev.stopPropagation()
                                          onDownloadItem({ chatId, messageId: m.id }, false, ev)
                                        }}
                                        className="size-8 rounded-full bg-black/60 hover:bg-primary text-white backdrop-blur-md border border-white/20 flex items-center justify-center shadow-lg transition-transform hover:scale-110 active:scale-95"
                                        title="Download media"
                                      >
                                        <Download size={14} />
                                      </button>
                                    )}
                                  </div>
                                </div>

                                {/* Caption Content Seamless Under Media */}
                                <div className="px-3.5 pt-2.5 pb-2.5">
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
                                                : 'bg-black/30 border-white/10 text-slate-300 hover:bg-black/50 hover:text-white'
                                            }`}
                                            title={`Reaction ${displayEmoji}${r.chosen ? ' (click to remove)' : ''}`}
                                          >
                                            <span className="emoji-glyph text-[13px] leading-none select-none">{displayEmoji}</span>
                                            <span className={`text-[10.5px] tabular-nums font-semibold ${r.chosen ? 'text-cyan' : 'text-slate-300'}`}>
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
                              <div
                                className="relative rounded-2xl overflow-hidden shadow-xl max-w-[460px] w-full group/media cursor-pointer select-none"
                                onMouseEnter={() => {
                                  if (m.media?.type === 'video' || m.media?.type === 'photo') {
                                    call('media.prepare', { chatId, messageId: m.id }).catch(() => {})
                                  }
                                }}
                                onClick={() => onOpenViewer({ name: m.media.name, path: m.media.path, thumb: m.media.thumb, type: m.media.type, size: m.media.size, duration: m.media.duration, chatId, messageId: m.id })}
                              >
                                <ChatMediaThumb
                                  src={m.media.thumb}
                                  alt={m.media.name}
                                  minHeight="180px"
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

                                {/* Top-Right Quick Action Button */}
                                <div className="absolute top-2.5 right-2.5 flex items-center gap-1.5 z-10 opacity-90 group-hover/media:opacity-100 transition-opacity">
                                  {m.media.status === 'downloaded' && m.media.path ? (
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation()
                                        onRevealFile(m.media.path)
                                      }}
                                      className="size-8 rounded-full bg-black/60 hover:bg-cyan/40 text-cyan backdrop-blur-md border border-white/20 flex items-center justify-center shadow-lg transition-transform hover:scale-110 active:scale-95"
                                      title="Show in folder"
                                    >
                                      <FolderOpen size={14} />
                                    </button>
                                  ) : (
                                    <button
                                      type="button"
                                      onClick={(ev) => {
                                        ev.stopPropagation()
                                        onDownloadItem({ chatId, messageId: m.id }, false, ev)
                                      }}
                                      className="size-8 rounded-full bg-black/60 hover:bg-primary text-white backdrop-blur-md border border-white/20 flex items-center justify-center shadow-lg transition-transform hover:scale-110 active:scale-95"
                                      title="Download media"
                                    >
                                      <Download size={14} />
                                    </button>
                                  )}
                                </div>

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
                                  <span className="font-semibold text-primary tracking-wide truncate max-w-[240px]">
                                    {m.sender || activeChat?.title || 'Unknown'}
                                  </span>
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
                                    className="p-1 text-slate-300 hover:text-white rounded-full bg-black/40 hover:bg-black/60 transition-colors"
                                    title="Message Options"
                                  >
                                    <MoreVertical size={13} />
                                  </button>
                                </div>
                              )}

                              {/* Forwarded Header */}
                              {m.forwardFrom && (
                                <div className="flex items-center gap-1.5 text-[11.5px] text-cyan/90 mb-1.5 italic select-none">
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
                                  className="flex items-center gap-2 rounded-lg border-l-2 border-cyan bg-black/25 px-2.5 py-1.5 text-[11.5px] mb-2 cursor-pointer hover:bg-black/35 transition-colors select-none"
                                  title="Jump to replied message"
                                >
                                  <Reply size={12} className="text-cyan shrink-0" />
                                  <div className="min-w-0 flex-1">
                                    <div className="font-semibold text-cyan leading-tight truncate">{m.replyTo.sender}</div>
                                    <div className="text-slate-300 truncate leading-tight mt-0.5">{m.replyTo.text}</div>
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
                                        colorClasses = 'from-sky-500/25 to-blue-600/15 border-sky-500/30 text-sky-400'
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
                                              <span className={m.media.status === 'downloaded' ? 'text-emerald-400 font-medium' : 'text-slate-400'}>
                                                {m.media.status === 'downloaded' ? 'Saved' : ext}
                                              </span>
                                            </div>
                                          </div>

                                          <div className="shrink-0 flex items-center">
                                            {m.media.status === 'downloaded' && m.media.path ? (
                                              <button
                                                type="button"
                                                onClick={() => onRevealFile(m.media.path)}
                                                className="size-9 rounded-xl bg-white/5 hover:bg-cyan/20 text-cyan border border-cyan/20 flex items-center justify-center transition-all hover:scale-105 active:scale-95 shadow"
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
                                <div className="mt-1">
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
                                            : 'bg-black/30 border-white/10 text-slate-300 hover:bg-black/50 hover:text-white'
                                        }`}
                                        title={`Reaction ${displayEmoji}${r.chosen ? ' (click to remove)' : ''}`}
                                      >
                                        <span className="emoji-glyph text-[13px] leading-none select-none">{displayEmoji}</span>
                                        <span className={`text-[10.5px] tabular-nums font-semibold ${r.chosen ? 'text-cyan' : 'text-slate-300'}`}>
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
                                      <span className="text-cyan font-bold text-[11px]" title="Read">✓✓</span>
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
                          title="Cancel upload"
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
                            style={{ width: `${Math.max(4, u.progress)}%` }}
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
                      <span>Uploading to chat…</span>
                      <Clock size={10} className="animate-spin text-primary" />
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
              navigator.clipboard.writeText(contextMenu.message.text || contextMenu.message.media?.name || '')
              toast('Copied to clipboard', 'info')
              setContextMenu(null)
            }}
            className="flex w-full items-center gap-2.5 rounded-xl px-2.5 py-1.5 text-left text-[12.5px] text-text hover:bg-white/10 transition-colors"
          >
            <Copy size={14} className="text-muted" />
            <span>Copy Text</span>
          </button>

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

      {/* Input Area Toolbar (Replying Banner / Editing Banner + Textarea + Attach + Send) */}
      <div className="mt-2 pt-2 border-t border-white/[0.08] flex flex-col gap-1.5">
        {/* Reply Preview Bar */}
        {replyingTo && (
          <div className="flex items-center justify-between rounded-xl bg-cyan/10 border border-cyan/20 px-3 py-1.5 text-[12px] animate-in slide-in-from-bottom-2 duration-150">
            <div className="flex items-center gap-2 min-w-0">
              <Reply size={14} className="text-cyan shrink-0" />
              <div className="min-w-0">
                <div className="flex items-center gap-1 font-semibold text-cyan leading-tight text-[12px]">
                  <span>Replying to</span>
                  <span>{replyingTo.sender}</span>
                </div>
                <div className="text-slate-300 truncate text-[11px] leading-tight mt-0.5">
                  {replyingTo.text || replyingTo.media?.name || 'Attachment'}
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setReplyingTo(null)}
              className="p-1 rounded-full text-muted hover:text-white hover:bg-white/10 transition-colors"
              title="Cancel reply"
            >
              <X size={13} />
            </button>
          </div>
        )}

        {/* Edit Preview Bar */}
        {editingMessage && (
          <div className="flex items-center justify-between rounded-xl bg-primary/15 border border-primary/30 px-3 py-1.5 text-[12px] animate-in slide-in-from-bottom-2 duration-150">
            <div className="flex items-center gap-2 min-w-0">
              <Edit3 size={14} className="text-primary shrink-0" />
              <div className="min-w-0">
                <div className="font-semibold text-primary leading-tight text-[12px]">Editing message</div>
                <div className="text-slate-300 truncate text-[11px] leading-tight mt-0.5">
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
              className="p-1 rounded-full text-muted hover:text-white hover:bg-white/10 transition-colors"
              title="Cancel editing"
            >
              <X size={13} />
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
                : 'Write a message… (Shift+Enter for new line)'
            }
            className="flex-1 resize-none rounded-xl border border-border bg-tile px-4 py-2.5 text-[13px] text-text placeholder:text-muted focus:border-primary outline-none transition-colors disabled:opacity-40 disabled:cursor-not-allowed leading-relaxed max-h-[160px]"
          />

          {/* Send / Save Button */}
          <button
            type="button"
            onClick={handleSend}
            disabled={!inputText.trim() || sending || !canPost}
            className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary text-white shadow-glow hover:bg-primary-hover disabled:opacity-40 disabled:cursor-not-allowed transition-all cursor-pointer"
            title={editingMessage ? 'Save changes' : 'Send message'}
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
            <p className="text-[13px] text-slate-300">
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
                className="px-3.5 py-1.5 rounded-lg border border-border bg-tile text-[12.5px] text-text hover:border-white/30"
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

      {/* Telegram Forward Message Modal */}
      {forwardingMessage && (
        <Dialog
          title="Forward Message"
          open={Boolean(forwardingMessage)}
          onClose={() => setForwardingMessage(null)}
        >
          <div className="space-y-3.5">
            {/* Forward Message Quote Preview */}
            <div className="rounded-xl border-l-4 border-cyan bg-black/30 p-2.5 flex items-start gap-2.5">
              <div className="min-w-0 flex-1">
                <div className="text-[12px] font-semibold text-cyan truncate">
                  {forwardingMessage.sender || activeChat?.title || 'Unknown'}
                </div>
                <div className="text-[12.5px] text-slate-200 truncate mt-0.5">
                  {forwardingMessage.text || forwardingMessage.media?.name || (forwardingMessage.media?.type ? `[${forwardingMessage.media.type}]` : 'Message')}
                </div>
              </div>
            </div>

            {/* Send as copy toggle */}
            <label className="flex items-center gap-2 text-[12.5px] text-slate-300 cursor-pointer select-none">
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
                className="w-full rounded-xl bg-black/40 border border-white/10 pl-9 pr-3 py-2 text-[13px] text-text placeholder:text-muted focus:border-primary focus:outline-none"
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
                .map((c: any) => (
                  <button
                    key={c.id}
                    type="button"
                    disabled={forwardingTargetId !== null}
                    onClick={() => handleConfirmForward(c)}
                    className="w-full flex items-center justify-between p-2 rounded-xl hover:bg-tile transition-colors text-left group cursor-pointer disabled:opacity-50"
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
                    <div className="shrink-0 ml-2">
                      {forwardingTargetId === c.id ? (
                        <div className="size-4 rounded-full border-2 border-cyan border-t-transparent animate-spin" />
                      ) : (
                        <CornerUpRight size={15} className="text-muted group-hover:text-cyan transition-colors" />
                      )}
                    </div>
                  </button>
                ))}
            </div>

            <div className="flex justify-end pt-2 border-t border-white/10">
              <button
                type="button"
                onClick={() => setForwardingMessage(null)}
                className="px-4 py-1.5 rounded-xl border border-white/10 bg-white/5 text-[12.5px] text-text hover:bg-white/10 transition-colors cursor-pointer"
              >
                Cancel
              </button>
            </div>
          </div>
        </Dialog>
      )}
    </div>
  )
}
