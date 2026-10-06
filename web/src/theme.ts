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
    bgColor: '#0b1329',
    sidebarColor: '#111c35',
    overlayColor: '#0b1329',
    symbolColor: '#cbd5e1',
    previewColors: ['#0b1329', '#1e293b', '#3b82f6'],
  },
  {
    id: 'fulldark',
    name: 'Obsidian Black (Full Dark)',
    description: 'Pure OLED black mode with ultra-high contrast crisp typography',
    accentColor: '#38bdf8',
    bgColor: '#000000',
    sidebarColor: '#09090b',
    overlayColor: '#000000',
    symbolColor: '#ffffff',
    previewColors: ['#000000', '#121215', '#38bdf8'],
  },
  {
    id: 'cream',
    name: 'Velvet Cream',
    description: 'Warm creamy vanilla & soft latte with rich golden caramel accents',
    accentColor: '#c27803',
    bgColor: '#faf6ee',
    sidebarColor: '#f3ece0',
    overlayColor: '#faf6ee',
    symbolColor: '#292524',
    previewColors: ['#faf6ee', '#f3ece0', '#c27803'],
  },
  {
    id: 'ocean',
    name: 'Deep Ocean',
    description: 'Deep abyss navy blue with bright cyan highlights',
    accentColor: '#0ea5e9',
    bgColor: '#070e1e',
    sidebarColor: '#0b152d',
    overlayColor: '#070e1e',
    symbolColor: '#38bdf8',
    previewColors: ['#070e1e', '#16274e', '#0ea5e9'],
  },
  {
    id: 'telegram',
    name: 'Telegram Dark',
    description: 'Authentic Telegram Desktop dark slate & classic blue',
    accentColor: '#5288c1',
    bgColor: '#17212b',
    sidebarColor: '#0e1621',
    overlayColor: '#17212b',
    symbolColor: '#ffffff',
    previewColors: ['#17212b', '#242f3d', '#5288c1'],
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
]

export function getActiveTheme(): ThemeDef {
  try {
    let id = localStorage.getItem('mediagram_theme') || 'dark'
    if (id === 'sunset' || id === 'emerald') id = 'cream'
    if (id === 'tokyo') id = 'fulldark'
    return THEMES.find((t) => t.id === id) || THEMES[0]
  } catch {
    return THEMES[0]
  }
}

export function applyTheme(themeId: string): ThemeDef {
  let normalizedId = themeId
  if (normalizedId === 'tokyo') normalizedId = 'fulldark'
  if (normalizedId === 'sunset' || normalizedId === 'emerald') normalizedId = 'cream'
  const theme = THEMES.find((t) => t.id === normalizedId) || THEMES[0]
  try {
    localStorage.setItem('mediagram_theme', theme.id)
  } catch {}

  document.documentElement.setAttribute('data-theme', theme.id)
  if (typeof window !== 'undefined') {
    const bridge = window.mediagram || window.teleflow
    bridge?.setTheme?.(theme.overlayColor, theme.symbolColor, theme.id)?.catch(() => {})
  }
  return theme
}
