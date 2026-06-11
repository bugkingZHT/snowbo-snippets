export type Theme = 'light' | 'dark' | 'system'
export type ResolvedTheme = 'light' | 'dark'

export const THEME_STORAGE_KEY = 'theme'
const THEME_BROADCAST_CHANNEL = 'snowbo-theme'

export function getSystemTheme(): ResolvedTheme {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function readStoredTheme(defaultTheme: Theme = 'system'): Theme {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY)
    if (stored === 'light' || stored === 'dark' || stored === 'system') {
      return stored
    }
  } catch {
    // ignore
  }
  return defaultTheme
}

export function resolveTheme(theme: Theme): ResolvedTheme {
  return theme === 'system' ? getSystemTheme() : theme
}

export function applyTheme(theme: Theme): ResolvedTheme {
  const resolved = resolveTheme(theme)
  const root = document.documentElement
  root.classList.remove('light', 'dark')
  root.classList.add(resolved)
  root.style.colorScheme = resolved
  return resolved
}

export function applyStoredTheme(defaultTheme: Theme = 'system'): ResolvedTheme {
  return applyTheme(readStoredTheme(defaultTheme))
}

/** 主窗口改主题时通知其它 webview（如 quick-copy）同步。 */
export function notifyThemeChange() {
  try {
    new BroadcastChannel(THEME_BROADCAST_CHANNEL).postMessage('theme-changed')
  } catch {
    // ignore
  }
}

/** 订阅主题变化并在 `<html>` 上应用 class；供 quick-copy 等独立窗口使用。 */
export function subscribeThemeSync(defaultTheme: Theme = 'system'): () => void {
  applyStoredTheme(defaultTheme)

  const resync = () => {
    applyStoredTheme(defaultTheme)
  }

  const onStorage = (event: StorageEvent) => {
    if (event.key === THEME_STORAGE_KEY || event.key === null) {
      resync()
    }
  }

  const media = window.matchMedia('(prefers-color-scheme: dark)')
  const onSystemChange = () => {
    if (readStoredTheme(defaultTheme) === 'system') {
      resync()
    }
  }

  let channel: BroadcastChannel | undefined
  try {
    channel = new BroadcastChannel(THEME_BROADCAST_CHANNEL)
    channel.onmessage = resync
  } catch {
    // ignore
  }

  window.addEventListener('storage', onStorage)
  media.addEventListener('change', onSystemChange)

  return () => {
    window.removeEventListener('storage', onStorage)
    media.removeEventListener('change', onSystemChange)
    channel?.close()
  }
}
