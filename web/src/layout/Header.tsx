import { NavLink } from 'react-router-dom'
import { useRegion } from '../hooks/useRegion'
import { useTheme } from '../hooks/useTheme'
import { cn } from '../lib/cn'
import { REGIONS, type RegionId } from '../lib/regions'

const tabs = [
  { to: '/', label: 'Map', end: true },
  { to: '/analytics', label: 'Analytics' },
  { to: '/stations', label: 'Fuel Stations' },
  { to: '/about', label: 'About' },
]

// Two rows, both centered in the same max-w-content column with the same
// horizontal padding, so title/nav/region all line up on one shared edge.
export function Header() {
  const { toggle } = useTheme()
  const { regionId, setRegionId } = useRegion()

  return (
    <header className="w-full border-b border-border">
      <div className="mx-auto flex w-full max-w-content items-center gap-2 px-4 py-3 sm:px-6">
        <span aria-hidden className="text-xl">
          ⛽
        </span>
        <div className="leading-tight">
          <div className="text-base font-bold text-foreground">Costco Gas Prices</div>
          <div className="text-xs text-muted">Live prices, tracked automatically</div>
        </div>
      </div>
      <div className="border-t border-border bg-surface">
        <div className="mx-auto flex w-full max-w-content items-center justify-between gap-4 px-4 py-2.5 sm:px-6">
          <nav className="flex items-center gap-4">
            {tabs.map((tab) => (
              <NavLink
                key={tab.to}
                to={tab.to}
                end={tab.end}
                className={({ isActive }) =>
                  cn('text-sm font-medium', isActive ? 'text-foreground' : 'text-muted hover:text-foreground')
                }
              >
                {tab.label}
              </NavLink>
            ))}
          </nav>
          <div className="flex items-center gap-4">
            <label>
              <span className="sr-only">Region</span>
              <select
                value={regionId}
                onChange={(e) => setRegionId(e.target.value as RegionId)}
                className="rounded-md border border-border bg-background px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
              >
                {REGIONS.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.label}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              onClick={toggle}
              aria-label="Toggle theme"
              className="rounded-md border border-border px-3 py-1.5 text-xs text-muted hover:bg-surface"
            >
              Theme
            </button>
          </div>
        </div>
      </div>
    </header>
  )
}
