// Notification Manager & Audio Engine for Mediagram
import { useState, useEffect, useCallback } from 'react'

export type NotificationType = 'download' | 'upload' | 'failed' | 'message' | 'chat' | 'system'

export interface AppNotification {
  id: string
  title: string
  body: string
  type: NotificationType
  timestamp: number
  read: boolean
  chatId?: number
  messageId?: number
  link?: string
}

export interface NotificationSettings {
  enabled: boolean
  desktopNotifications: boolean
  notifyComplete: boolean
  notifyFailed: boolean
  notifyMessages: boolean
  previewMessages: boolean
  sound: boolean
  showBadge: boolean
}

const STORAGE_KEY = 'mediagram_notifications_v2'
const SETTINGS_KEY = 'mediagram_notification_settings_v1'
const MUTED_CHATS_KEY = 'mediagram_muted_chats_v1'
const PINNED_CHATS_KEY = 'mediagram_pinned_chats_v1'
const ARCHIVED_CHATS_KEY = 'mediagram_archived_chats_v1'

const DEFAULT_SETTINGS: NotificationSettings = {
  enabled: true,
  desktopNotifications: true,
  notifyComplete: true,
  notifyFailed: true,
  notifyMessages: true,
  previewMessages: true,
  sound: false,
  showBadge: true,
}

// Inbuilt notification sound removed per user request (desktop OS handles notification audio)
export function playNotificationSound() {}

export function getNotificationSettings(): NotificationSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    if (raw) return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) }
  } catch {}
  return DEFAULT_SETTINGS
}

export function saveNotificationSettings(partial: Partial<NotificationSettings>): NotificationSettings {
  const current = getNotificationSettings()
  const next = { ...current, ...partial }
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(next))
    window.dispatchEvent(new CustomEvent('mediagram-notification-settings-changed', { detail: next }))
  } catch {}
  return next
}

// Muted chats management
const knownMutedChatIds = new Set<number>()

export function registerMutedChats(chatIds: number[]): void {
  for (const id of chatIds) knownMutedChatIds.add(id)
}

export function getMutedChatIds(): number[] {
  try {
    const raw = localStorage.getItem(MUTED_CHATS_KEY)
    if (raw) return JSON.parse(raw)
  } catch {}
  return []
}

export function isChatMuted(chatId: number): boolean {
  if (getMutedChatIds().includes(chatId)) return true
  if (knownMutedChatIds.has(chatId)) return true
  return false
}

export function setChatMuted(chatId: number, muted: boolean): void {
  try {
    const current = getMutedChatIds()
    const set = new Set(current)
    if (muted) {
      set.add(chatId)
      knownMutedChatIds.add(chatId)
    } else {
      set.delete(chatId)
      knownMutedChatIds.delete(chatId)
    }
    const arr = Array.from(set)
    localStorage.setItem(MUTED_CHATS_KEY, JSON.stringify(arr))
    window.dispatchEvent(new CustomEvent('mediagram-muted-chats-changed', { detail: arr }))
  } catch {}
}

// Pinned chats management
export function getPinnedChatIds(): number[] {
  try {
    const raw = localStorage.getItem(PINNED_CHATS_KEY)
    if (raw) return JSON.parse(raw)
  } catch {}
  return []
}

export function isChatPinned(chatId: number): boolean {
  return getPinnedChatIds().includes(chatId)
}

export function setChatPinned(chatId: number, pinned: boolean): void {
  try {
    const current = getPinnedChatIds()
    const set = new Set(current)
    if (pinned) set.add(chatId)
    else set.delete(chatId)
    const arr = Array.from(set)
    localStorage.setItem(PINNED_CHATS_KEY, JSON.stringify(arr))
    window.dispatchEvent(new CustomEvent('mediagram-pinned-chats-changed', { detail: arr }))
  } catch {}
}

// Archived chats management
export function getArchivedChatIds(): number[] {
  try {
    const raw = localStorage.getItem(ARCHIVED_CHATS_KEY)
    if (raw) return JSON.parse(raw)
  } catch {}
  return []
}

export function isChatArchived(chatId: number): boolean {
  return getArchivedChatIds().includes(chatId)
}

export function setChatArchived(chatId: number, archived: boolean): void {
  try {
    const current = getArchivedChatIds()
    const set = new Set(current)
    if (archived) set.add(chatId)
    else set.delete(chatId)
    const arr = Array.from(set)
    localStorage.setItem(ARCHIVED_CHATS_KEY, JSON.stringify(arr))
    window.dispatchEvent(new CustomEvent('mediagram-archived-chats-changed', { detail: arr }))
  } catch {}
}

// Notification items persistence
const SEED_NOTIFICATIONS: AppNotification[] = [
  {
    id: 'seed-1',
    title: 'Welcome to Mediagram Notifications',
    body: 'Get real-time updates for active downloads, channel messages, and file transfers.',
    type: 'system',
    timestamp: Date.now() - 3600_000 * 2,
    read: false,
  },
  {
    id: 'seed-2',
    title: 'Download completed',
    body: 'Your media download finished successfully and is ready in your library.',
    type: 'download',
    timestamp: Date.now() - 3600_000 * 5,
    read: true,
  },
]

export function getNotifications(): AppNotification[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return JSON.parse(raw)
    // Seed initial notifications on first run
    localStorage.setItem(STORAGE_KEY, JSON.stringify(SEED_NOTIFICATIONS))
    return SEED_NOTIFICATIONS
  } catch {}
  return []
}

function saveNotifications(items: AppNotification[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items))
    window.dispatchEvent(new CustomEvent('mediagram-notifications-changed', { detail: items }))
  } catch {}
}

export function addNotification(
  notif: Omit<AppNotification, 'id' | 'timestamp' | 'read'> & { read?: boolean }
): AppNotification | null {
  const settings = getNotificationSettings()
  if (!settings.enabled) return null

  // Check if chat is muted
  if (notif.chatId && isChatMuted(notif.chatId)) {
    return null // Muted chat notifications are suppressed
  }

  // Type specific filter
  if ((notif.type === 'download' || notif.type === 'upload') && !settings.notifyComplete) return null
  if (notif.type === 'failed' && !settings.notifyFailed) return null
  if (notif.type === 'message' && !settings.notifyMessages) return null

  const newNotif: AppNotification = {
    id: `notif-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    title: notif.title,
    body: notif.body,
    type: notif.type,
    timestamp: Date.now(),
    read: notif.read ?? false,
    chatId: notif.chatId,
    messageId: notif.messageId,
    link: notif.link,
  }

  const list = getNotifications()
  // Keep up to 60 most recent notifications
  const nextList = [newNotif, ...list.slice(0, 59)]
  saveNotifications(nextList)

  if (!newNotif.read && (settings.desktopNotifications ?? true)) {
    try {
      if ((window as any).mediagram?.call) {
        ;(window as any).mediagram.call('app.notify', { title: newNotif.title, body: newNotif.body }).catch(() => {})
      } else if (typeof window !== 'undefined' && 'Notification' in window) {
        if (Notification.permission === 'granted') {
          new Notification(newNotif.title, { body: newNotif.body })
        } else if (Notification.permission !== 'denied') {
          Notification.requestPermission().then((perm) => {
            if (perm === 'granted') new Notification(newNotif.title, { body: newNotif.body })
          }).catch(() => {})
        }
      }
    } catch {}
  }

  return newNotif
}

export function markNotificationRead(id: string, read = true) {
  const list = getNotifications()
  const next = list.map((n) => (n.id === id ? { ...n, read } : n))
  saveNotifications(next)
}

export function markAllNotificationsRead() {
  const list = getNotifications()
  const next = list.map((n) => ({ ...n, read: true }))
  saveNotifications(next)
}

export function removeNotification(id: string) {
  const list = getNotifications()
  const next = list.filter((n) => n.id !== id)
  saveNotifications(next)
}

export function clearAllNotifications() {
  saveNotifications([])
}

export function useNotifications() {
  const [notifications, setNotifications] = useState<AppNotification[]>(getNotifications)
  const [settings, setSettings] = useState<NotificationSettings>(getNotificationSettings)
  const [mutedChats, setMutedChats] = useState<number[]>(getMutedChatIds)
  const [pinnedChats, setPinnedChats] = useState<number[]>(getPinnedChatIds)
  const [archivedChats, setArchivedChats] = useState<number[]>(getArchivedChatIds)

  useEffect(() => {
    const handleNotifChange = () => setNotifications(getNotifications())
    const handleSettingsChange = () => setSettings(getNotificationSettings())
    const handleMutedChange = () => setMutedChats(getMutedChatIds())
    const handlePinnedChange = () => setPinnedChats(getPinnedChatIds())
    const handleArchivedChange = () => setArchivedChats(getArchivedChatIds())

    window.addEventListener('mediagram-notifications-changed', handleNotifChange)
    window.addEventListener('mediagram-notification-settings-changed', handleSettingsChange)
    window.addEventListener('mediagram-muted-chats-changed', handleMutedChange)
    window.addEventListener('mediagram-pinned-chats-changed', handlePinnedChange)
    window.addEventListener('mediagram-archived-chats-changed', handleArchivedChange)

    return () => {
      window.removeEventListener('mediagram-notifications-changed', handleNotifChange)
      window.removeEventListener('mediagram-notification-settings-changed', handleSettingsChange)
      window.removeEventListener('mediagram-muted-chats-changed', handleMutedChange)
      window.removeEventListener('mediagram-pinned-chats-changed', handlePinnedChange)
      window.removeEventListener('mediagram-archived-chats-changed', handleArchivedChange)
    }
  }, [])

  const unreadCount = notifications.filter((n) => !n.read).length

  const updateSettings = useCallback((partial: Partial<NotificationSettings>) => {
    const updated = saveNotificationSettings(partial)
    setSettings(updated)
  }, [])

  return {
    notifications,
    unreadCount,
    settings,
    mutedChats,
    pinnedChats,
    archivedChats,
    addNotification,
    markAsRead: markNotificationRead,
    markAllAsRead: markAllNotificationsRead,
    removeNotification,
    clearAll: clearAllNotifications,
    updateSettings,
    playNotificationSound,
    isMuted: (id: number) => mutedChats.includes(id),
    toggleMute: (id: number) => setChatMuted(id, !mutedChats.includes(id)),
    isPinned: (id: number) => pinnedChats.includes(id),
    togglePin: (id: number) => setChatPinned(id, !pinnedChats.includes(id)),
    isArchived: (id: number) => archivedChats.includes(id),
    toggleArchive: (id: number) => setChatArchived(id, !archivedChats.includes(id)),
  }
}
