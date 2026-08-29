import { useCallback, useSyncExternalStore } from 'react'

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

// Module-level store, not component state -- called from both Header and
// GasMap, and per-call-site useState left GasMap's basemap flavor stale
// after a toggle elsewhere.
let currentTheme = getStoredTheme()
const listeners = new Set<() => void>()

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function getSnapshot(): Theme {
  return currentTheme
}

function setStoredTheme(theme: Theme) {
  currentTheme = theme
  applyTheme(theme)
  try {
    if (theme === 'system') {
      window.localStorage.removeItem(STORAGE_KEY)
    } else {
      window.localStorage.setItem(STORAGE_KEY, theme)
    }
  } catch {
    // localStorage unavailable (private mode, etc.) -- theme just won't persist.
  }
  for (const listener of listeners) listener()
}

// Reflect the initial theme on <html> once, at module load.
if (typeof window !== 'undefined') {
  applyTheme(currentTheme)
}

/** Tracks light/dark/system, persists it, and flips `data-theme` on <html>
 * -- actual colors live in theme.css as CSS variables. */
export function useTheme() {
  const theme = useSyncExternalStore(subscribe, getSnapshot)

  const setTheme = useCallback((next: Theme) => {
    setStoredTheme(next)
  }, [])

  const toggle = useCallback(() => {
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
    const currentlyDark = currentTheme === 'dark' || (currentTheme === 'system' && prefersDark)
    setStoredTheme(currentlyDark ? 'light' : 'dark')
  }, [])

  return { theme, setTheme, toggle }
}
