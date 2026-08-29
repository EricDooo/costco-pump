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
    // w-full: as a flex item (App.tsx's map-page column) this won't stretch
    // to fill on its own when it also has auto margins (mx-auto).
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
