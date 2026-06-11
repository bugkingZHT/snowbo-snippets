"use client"

import * as React from "react"
import {
  applyTheme,
  notifyThemeChange,
  readStoredTheme,
  THEME_STORAGE_KEY,
  type ResolvedTheme,
  type Theme,
} from '@/lib/theme'

interface ThemeContextValue {
  theme: Theme | undefined
  setTheme: (theme: Theme) => void
  resolvedTheme: ResolvedTheme | undefined
}

const ThemeContext = React.createContext<ThemeContextValue>({
  theme: undefined,
  setTheme: () => {},
  resolvedTheme: undefined,
})

export function ThemeProvider({
  children,
  defaultTheme = "system",
}: React.PropsWithChildren<{
  defaultTheme?: Theme
  attribute?: "class"
  enableSystem?: boolean
}>) {
  const [theme, setThemeState] = React.useState<Theme | undefined>(undefined)
  const [resolvedTheme, setResolvedTheme] = React.useState<ResolvedTheme | undefined>(
    undefined,
  )

  React.useEffect(() => {
    const stored = readStoredTheme(defaultTheme)
    setThemeState(stored)
    setResolvedTheme(applyTheme(stored))
  }, [defaultTheme])

  React.useEffect(() => {
    if (theme !== "system") return
    const media = window.matchMedia("(prefers-color-scheme: dark)")
    const onChange = () => setResolvedTheme(applyTheme("system"))
    media.addEventListener("change", onChange)
    return () => media.removeEventListener("change", onChange)
  }, [theme])

  const setTheme = React.useCallback((next: Theme) => {
    setThemeState(next)
    setResolvedTheme(applyTheme(next))
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next)
    } catch {
      // ignore
    }
    notifyThemeChange()
  }, [])

  const value = React.useMemo(
    () => ({ theme, setTheme, resolvedTheme }),
    [theme, setTheme, resolvedTheme],
  )

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme() {
  return React.useContext(ThemeContext)
}
