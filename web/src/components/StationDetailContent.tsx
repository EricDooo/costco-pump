import { useMemo, useState } from 'react'
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { PricePoint, StationDetailData, StationSummary } from '../lib/api'

function formatPrice(price: number | null): string {
  return price === null ? '--' : `$${price.toFixed(2)}`
}

function formatRelative(iso: string | null): string {
  if (!iso) return 'never'
  const ms = Date.now() - new Date(iso).getTime()
  const minutes = Math.round(ms / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`
  const days = Math.round(hours / 24)
  return `${days} day${days === 1 ? '' : 's'} ago`
}

const RANGE_OPTIONS: { label: string; days: number }[] = [
  { label: '7d', days: 7 },
  { label: '14d', days: 14 },
  { label: '30d', days: 30 },
]

// Light tint, not a solid fill -- the app themes via CSS custom properties
// (see theme.css), not Tailwind's class-based dark mode, so a plain `dark:`
// variant here would never activate.
const FUEL_CARDS: { key: 'regular_price' | 'premium_price' | 'diesel_price'; label: string; tint: string; text: string }[] = [
  { key: 'regular_price', label: 'Regular unleaded', tint: 'bg-blue-500/10', text: 'text-blue-600' },
  { key: 'premium_price', label: 'Premium unleaded', tint: 'bg-red-500/10', text: 'text-red-600' },
  { key: 'diesel_price', label: 'Diesel', tint: 'bg-emerald-500/10', text: 'text-emerald-600' },
]

/** One entry per reading where regular or premium actually moved, not every
 * raw sweep result (readings land roughly hourly either way). */
interface ChangeEvent {
  time: string
  regular: number | null
  premium: number | null
  /** undefined = unchanged from the prior reading (or no prior reading). */
  regularUp?: boolean
  premiumUp?: boolean
}

function deriveChanges(history: PricePoint[]): ChangeEvent[] {
  const events: ChangeEvent[] = []
  let prevRegular: number | null = null
  let prevPremium: number | null = null
  for (const point of history) {
    const regularUp =
      prevRegular !== null && point.regular_price !== null && point.regular_price !== prevRegular
        ? point.regular_price > prevRegular
        : undefined
    const premiumUp =
      prevPremium !== null && point.premium_price !== null && point.premium_price !== prevPremium
        ? point.premium_price > prevPremium
        : undefined
    if (regularUp !== undefined || premiumUp !== undefined) {
      events.push({ time: point.time, regular: point.regular_price, premium: point.premium_price, regularUp, premiumUp })
    }
    if (point.regular_price !== null) prevRegular = point.regular_price
    if (point.premium_price !== null) prevPremium = point.premium_price
  }
  return events.reverse()
}

function ChangeCell({ value, up }: { value: number | null; up: boolean | undefined }) {
  if (value === null) return <span className="text-muted">--</span>
  if (up === undefined) return <span className="text-muted">{formatPrice(value)}</span>
  return (
    <span className={up ? 'text-negative' : 'text-positive'}>
      {up ? '↑' : '↓'} {formatPrice(value)}
    </span>
  )
}

/** Price cards, trend chart, 7-day change, recorded changes, hours -- shared
 * between StationPanel (map sidebar) and StationDetail (standalone page). */
export function StationDetailContent({
  station,
  detail,
  regionMedian,
}: {
  /** Already-loaded summary fields, rendered before `detail` arrives. */
  station: StationSummary
  /** History/hours -- null while in flight; sections below wait on it. */
  detail: StationDetailData | null
  regionMedian: number | null
}) {
  const [rangeDays, setRangeDays] = useState(7)

  const chartData = useMemo(() => {
    if (!detail) return []
    const cutoff = Date.now() - rangeDays * 24 * 60 * 60 * 1000
    return detail.history
      .filter((p) => new Date(p.time).getTime() >= cutoff)
      .map((p) => ({
        time: new Date(p.time).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric' }),
        regular: p.regular_price,
        premium: p.premium_price,
      }))
  }, [detail, rangeDays])

  const changes = useMemo(() => (detail ? deriveChanges(detail.history).slice(0, 12) : []), [detail])

  const sevenDayChange = useMemo(() => {
    if (!detail) return null
    const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000
    const inWindow = detail.history.filter((p) => new Date(p.time).getTime() >= cutoff)
    const first = inWindow[0]
    if (!first) return null
    return {
      regular: first.regular_price !== null && detail.regular_price !== null ? detail.regular_price - first.regular_price : null,
      premium: first.premium_price !== null && detail.premium_price !== null ? detail.premium_price - first.premium_price : null,
    }
  }, [detail])

  const vsMedian =
    regionMedian && station.regular_price !== null ? ((station.regular_price - regionMedian) / regionMedian) * 100 : null

  return (
    <div className="space-y-4">
      <div>
        <div className="flex items-start justify-between gap-2">
          <h2 className="text-lg font-bold text-foreground">{station.name}</h2>
          <span className="flex-shrink-0 text-xs text-muted">#{station.id}</span>
        </div>
        <p className="mt-1 text-sm text-muted">
          {station.address}
          <br />
          {station.city}, {station.state} {station.zip_code}
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
          <span className="rounded-full border border-border px-2 py-0.5 text-muted">
            Refreshed {formatRelative(station.as_of)}
          </span>
          {vsMedian !== null && (
            <span
              className={`rounded-full px-2 py-0.5 font-medium ${vsMedian >= 0 ? 'bg-negative/10 text-negative' : 'bg-positive/10 text-positive'}`}
            >
              {vsMedian >= 0 ? '+' : ''}
              {vsMedian.toFixed(1)}% vs regional median
            </span>
          )}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2">
        {FUEL_CARDS.map((card) => {
          const price = station[card.key]
          return (
            <div key={card.key} className={`rounded-lg border border-border ${card.tint} p-3`}>
              <div className="text-[10px] font-medium tracking-wide text-muted uppercase">{card.label}</div>
              {price !== null ? (
                <>
                  <div className={`mt-1 text-lg font-bold ${card.text}`}>{formatPrice(price)}</div>
                  <div className="text-[10px] text-muted">per gallon</div>
                </>
              ) : (
                <div className="mt-1 text-xs text-muted">Not sold here</div>
              )}
            </div>
          )
        })}
      </div>
      <p className="-mt-3 text-xs text-muted">Always verify at the pump.</p>

      <div>
        <div className="flex items-center justify-between">
          <div className="text-xs font-medium text-muted">Price history</div>
          <div className="flex gap-1">
            {RANGE_OPTIONS.map((opt) => (
              <button
                key={opt.days}
                type="button"
                onClick={() => setRangeDays(opt.days)}
                className={`rounded-full px-2 py-0.5 text-xs ${
                  rangeDays === opt.days
                    ? 'bg-primary text-primary-foreground'
                    : 'border border-border text-muted hover:text-foreground'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
        {!detail ? (
          <p className="mt-3 text-sm text-muted">Loading...</p>
        ) : chartData.length < 2 ? (
          <p className="mt-3 text-sm text-muted">Not enough history yet to chart a trend.</p>
        ) : (
          <div className="mt-2 h-48 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData} margin={{ left: 0, right: 8, top: 8, bottom: 0 }}>
                <defs>
                  <linearGradient id="regularFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#2563eb" stopOpacity={0.25} />
                    <stop offset="100%" stopColor="#2563eb" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="premiumFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#dc2626" stopOpacity={0.25} />
                    <stop offset="100%" stopColor="#dc2626" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="time" stroke="var(--muted)" fontSize={10} tickMargin={6} minTickGap={30} />
                <YAxis
                  stroke="var(--muted)"
                  fontSize={10}
                  domain={['auto', 'auto']}
                  tickFormatter={(v: number) => `$${v.toFixed(2)}`}
                  width={44}
                />
                <Tooltip
                  formatter={(value: number, name: string) => [`$${value.toFixed(2)}`, name]}
                  contentStyle={{
                    background: 'var(--surface)',
                    border: '1px solid var(--border)',
                    borderRadius: 8,
                    color: 'var(--foreground)',
                    fontSize: 12,
                  }}
                />
                <Area
                  type="stepAfter"
                  dataKey="regular"
                  name="Regular"
                  stroke="#2563eb"
                  fill="url(#regularFill)"
                  strokeWidth={2}
                />
                <Area
                  type="stepAfter"
                  dataKey="premium"
                  name="Premium"
                  stroke="#dc2626"
                  fill="url(#premiumFill)"
                  strokeWidth={2}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {sevenDayChange && (sevenDayChange.regular !== null || sevenDayChange.premium !== null) && (
        <div>
          <div className="text-xs font-medium text-muted">7-day change</div>
          <div className="mt-2 space-y-1 text-sm">
            {sevenDayChange.regular !== null && (
              <div className="flex items-center justify-between">
                <span className="text-foreground">Regular</span>
                <span className={sevenDayChange.regular > 0 ? 'text-negative' : 'text-positive'}>
                  {sevenDayChange.regular > 0 ? '+' : ''}
                  {sevenDayChange.regular.toFixed(3)}
                </span>
              </div>
            )}
            {sevenDayChange.premium !== null && (
              <div className="flex items-center justify-between">
                <span className="text-foreground">Premium</span>
                <span className={sevenDayChange.premium > 0 ? 'text-negative' : 'text-positive'}>
                  {sevenDayChange.premium > 0 ? '+' : ''}
                  {sevenDayChange.premium.toFixed(3)}
                </span>
              </div>
            )}
          </div>
        </div>
      )}

      {changes.length > 0 && (
        <div>
          <div className="text-xs font-medium text-muted">Recorded changes</div>
          <div className="scrollbar-thin mt-2 max-h-48 overflow-y-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-muted">
                  <th className="pb-1 font-medium">Date</th>
                  <th className="pb-1 text-right font-medium">Reg</th>
                  <th className="pb-1 text-right font-medium">Prem</th>
                </tr>
              </thead>
              <tbody>
                {changes.map((c) => (
                  <tr key={c.time} className="border-t border-border">
                    <td className="py-1 text-muted">
                      {new Date(c.time).toLocaleString(undefined, {
                        month: 'short',
                        day: 'numeric',
                        hour: 'numeric',
                        minute: '2-digit',
                      })}
                    </td>
                    <td className="py-1 text-right">
                      <ChangeCell value={c.regular} up={c.regularUp} />
                    </td>
                    <td className="py-1 text-right">
                      <ChangeCell value={c.premium} up={c.premiumUp} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {detail?.hours && (
        <div>
          <div className="text-xs font-medium text-muted">Hours</div>
          <ul className="mt-2 space-y-0.5 text-xs text-muted">
            {detail.hours.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
