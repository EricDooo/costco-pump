import { NavLink } from 'react-router-dom'
import { useTheme } from '../hooks/useTheme'
import { cn } from '../lib/cn'

const tabs = [
  { to: '/', label: 'Map', end: true },
  { to: '/analytics', label: 'Analytics' },
  { to: '/stations', label: 'Fuel Stations' },
  { to: '/about', label: 'About' },
]

export function Header() {
  const { toggle } = useTheme()

  return (
    // w-full: on the map page, App.tsx makes this a flex item (column
    // direction) so the routed content below can claim "the rest of the
    // viewport height" -- a flex item's cross-axis (width, here) doesn't
    // stretch to fill when it also has auto margins (mx-auto), it sizes to
    // content and centers within that instead. w-full first, then mx-auto
    // + max-w-content center the actual content block inside that full
    // width the same way it always has on every other (non-flex-parent)
    // page.
    <header className="mx-auto flex w-full max-w-content items-center justify-between px-4 py-3 sm:px-6 sm:py-4">
      <div className="flex items-center gap-6">
        <span className="font-mono text-sm font-bold text-foreground">⛽ costco-pump</span>
        <nav className="flex items-center gap-4">
          {tabs.map((tab) => (
            <NavLink
              key={tab.to}
              to={tab.to}
              end={tab.end}
              className={({ isActive }) =>
                cn(
                  'text-sm font-medium',
                  isActive ? 'text-foreground' : 'text-muted hover:text-foreground',
                )
              }
            >
              {tab.label}
            </NavLink>
          ))}
        </nav>
      </div>
      <button
        type="button"
        onClick={toggle}
        aria-label="Toggle theme"
        className="rounded-md border border-border px-3 py-1.5 text-xs text-muted hover:bg-surface"
      >
        Theme
      </button>
    </header>
  )
}
