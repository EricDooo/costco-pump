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

// Module-level store, not component state -- useTheme is called from more
// than one component now (Header's toggle button, GasMap for basemap
// flavor), and plain useState per call site meant each instance had its own
// copy: toggling in Header updated Header's own state (and localStorage,
// and the DOM attribute) but left GasMap's independent state -- and
// therefore its basemap colors -- stale until a full remount. A shared
// store with useSyncExternalStore keeps every call site in sync with a
// single source of truth.
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

// Reflect the initial (possibly localStorage-restored) theme on <html> as
// soon as this module loads, same as the old hook's mount-time effect --
// but here it only needs to happen once, globally, not per component instance.
if (typeof window !== 'undefined') {
  applyTheme(currentTheme)
}

/**
 * Tracks the user's explicit light/dark/system choice, persists it, and
 * reflects it as `data-theme` on <html>. The actual colors live in
 * theme.css as CSS variables -- this hook only ever flips one attribute.
 * Shared across every call site (see the module-level store above).
 */
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
