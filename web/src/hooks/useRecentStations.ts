import { useCallback, useSyncExternalStore } from 'react'

const STORAGE_KEY = 'costcogas:recent-stations'
const MAX_RECENT = 6

function getStored(): number[] {
  if (typeof window === 'undefined') return []
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '[]')
    return Array.isArray(parsed) ? parsed.filter((v): v is number => typeof v === 'number') : []
  } catch {
    return []
  }
}

// Module-level store, not component state -- same reasoning as useTheme.ts
// and useRegion.ts (read from Sidebar, written from MapView's pill clicks).
let current = getStored()
const listeners = new Set<() => void>()

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function getSnapshot(): number[] {
  return current
}

function setStored(ids: number[]) {
  current = ids
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(ids))
  } catch {
    // localStorage unavailable (private mode, etc.) -- history just won't persist.
  }
  for (const listener of listeners) listener()
}

/** IDs of recently-viewed stations, most-recent-first, persisted. */
export function useRecentStations() {
  const recentIds = useSyncExternalStore(subscribe, getSnapshot)

  const addRecent = useCallback((id: number) => {
    setStored([id, ...current.filter((existing) => existing !== id)].slice(0, MAX_RECENT))
  }, [])

  return { recentIds, addRecent }
}
