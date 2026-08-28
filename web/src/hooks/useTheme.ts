import { useCallback, useEffect, useState } from 'react'

type Theme = 'light' | 'dark' | 'system'

const STORAGE_KEY = 'theme'

function applyTheme(theme: Theme) {
  const root = document.documentElement
  if (theme === 'system') {
    root.removeAttribute('data-theme')
  } else {
    root.setAttribute('data-theme', theme)
  }
}

function getStoredTheme(): Theme {
  if (typeof window === 'undefined') return 'system'
  const stored = window.localStorage.getItem(STORAGE_KEY)
  return stored === 'light' || stored === 'dark' ? stored : 'system'
}

/**
 * Tracks the user's explicit light/dark/system choice, persists it, and
 * reflects it as `data-theme` on <html>. The actual colors live in
 * theme.css as CSS variables -- this hook only ever flips one attribute.
 */
export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(() => getStoredTheme())

  useEffect(() => {
    applyTheme(theme)
  }, [theme])

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next)
    try {
      if (next === 'system') {
        window.localStorage.removeItem(STORAGE_KEY)
      } else {
        window.localStorage.setItem(STORAGE_KEY, next)
      }
    } catch {
      // localStorage unavailable (private mode, etc.) -- theme just won't persist.
    }
  }, [])

  const toggle = useCallback(() => {
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
    const currentlyDark = theme === 'dark' || (theme === 'system' && prefersDark)
    setTheme(currentlyDark ? 'light' : 'dark')
  }, [theme, setTheme])

  return { theme, setTheme, toggle }
}
