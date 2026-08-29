import { useCallback, useSyncExternalStore } from 'react'
import { REGIONS, regionById, type RegionId } from '../lib/regions'

const STORAGE_KEY = 'costcogas:region'

function getStoredRegion(): RegionId {
  if (typeof window === 'undefined') return 'us'
  const stored = window.localStorage.getItem(STORAGE_KEY)
  return REGIONS.some((r) => r.id === stored) ? (stored as RegionId) : 'us'
}

// Module-level store, not component state -- the region changer now lives
// in the global Header, but Map/Analytics/Fuel Stations all need to react
// to it, same reasoning as useTheme.ts's own module-level store.
let currentRegionId = getStoredRegion()
const listeners = new Set<() => void>()

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function getSnapshot(): RegionId {
  return currentRegionId
}

function setStoredRegion(id: RegionId) {
  currentRegionId = id
  try {
    window.localStorage.setItem(STORAGE_KEY, id)
  } catch {
    // localStorage unavailable (private mode, etc.) -- selection just won't persist.
  }
  for (const listener of listeners) listener()
}

/** The site-wide selected country/region -- persisted, shared across every
 * page via the Header's changer. */
export function useRegion() {
  const regionId = useSyncExternalStore(subscribe, getSnapshot)

  const setRegionId = useCallback((id: RegionId) => {
    setStoredRegion(id)
  }, [])

  return { regionId, region: regionById(regionId), setRegionId }
}
