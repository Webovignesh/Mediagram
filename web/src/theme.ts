export type ThemeDef = {
  id: string
  name: string
  description: string
  accentColor: string
  bgColor: string
  sidebarColor: string
  overlayColor: string
  symbolColor: string
  previewColors: string[]
}

export const THEMES: ThemeDef[] = [
  {
    id: 'dark',
    name: 'Dark Slate',
    description: 'Modern slate dark mode with sapphire glow (Default)',
    accentColor: '#3b82f6',
    bgColor: '#0f172a',
    sidebarColor: '#111c35',
    overlayColor: '#0f172a',
    symbolColor: '#94a3b8',
    previewColors: ['#0f172a', '#1e293b', '#3b82f6'],
  },
  {
    id: 'light',
    name: 'Nordic Frost (Light)',
    description: 'Crisp modern light mode with arctic slate & refined sky blue',
    accentColor: '#0284c7',
    bgColor: '#f8fafc',
    sidebarColor: '#f1f5f9',
    overlayColor: '#f8fafc',
    symbolColor: '#0f172a',
    previewColors: ['#f8fafc', '#ffffff', '#0284c7'],
  },
  {
    id: 'telegram',
    name: 'Telegram Dark',
    description: 'Authentic Telegram Desktop dark slate & classic blue',
    accentColor: '#5288c1',
    bgColor: '#17212b',
    sidebarColor: '#0e1621',
    overlayColor: '#17212b',
    symbolColor: '#8da0b6',
    previewColors: ['#17212b', '#242f3d', '#5288c1'],
  },
  {
    id: 'ocean',
    name: 'Deep Ocean',
    description: 'Deep abyss navy blue with bright cyan highlights',
    accentColor: '#0ea5e9',
    bgColor: '#070e1e',
    sidebarColor: '#0b152d',
    overlayColor: '#070e1e',
    symbolColor: '#7dd3fc',
    previewColors: ['#070e1e', '#16274e', '#0ea5e9'],
  },
  {
    id: 'emerald',
    name: 'Emerald Forest',
    description: 'Deep obsidian & pine dark mode with radiant emerald accents',
    accentColor: '#10b981',
    bgColor: '#08140e',
    sidebarColor: '#0b1a13',
    overlayColor: '#08140e',
    symbolColor: '#34d399',
    previewColors: ['#08140e', '#123324', '#10b981'],
  },
  {
    id: 'tokyo',
    name: 'Tokyo Night',
    description: 'Deep twilight indigo & obsidian with neon lavender aura',
    accentColor: '#7aa2f7',
    bgColor: '#1a1b26',
    sidebarColor: '#16161e',
    overlayColor: '#1a1b26',
    symbolColor: '#7aa2f7',
    previewColors: ['#1a1b26', '#2f354f', '#7aa2f7'],
  },
]

export function getActiveTheme(): ThemeDef {
  try {
    let id = localStorage.getItem('mediagram_theme') || 'dark'
    if (id === 'sunset') id = 'emerald'
    return THEMES.find((t) => t.id === id) || THEMES[0]
  } catch {
    return THEMES[0]
  }
}

export function applyTheme(themeId: string): ThemeDef {
  const theme = THEMES.find((t) => t.id === themeId) || THEMES[0]
  try {
    localStorage.setItem('mediagram_theme', theme.id)
  } catch {}

  document.documentElement.setAttribute('data-theme', theme.id)
  if (typeof window !== 'undefined') {
    const bridge = window.mediagram || window.teleflow
    bridge?.setTheme?.(theme.overlayColor, theme.symbolColor)?.catch(() => {})
  }
  return theme
}
