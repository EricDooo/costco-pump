import { useEffect, useMemo, useState } from 'react'
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { api, type PricePoint, type StationDetailData } from '../lib/api'

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

/** A price change event -- one entry per reading where regular or premium
 * actually moved from the previous reading, not every raw sweep result
 * (readings land roughly hourly regardless of whether the price changed). */
interface ChangeEvent {
  time: string
  regular: number | null
  premium: number | null
  /** undefined = unchanged from the previous reading (or no prior reading
   * to compare against) -- only set when this specific reading actually
   * moved from the one before it. */
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

export function StationPanel({
  stationId,
  regionMedian,
  onClose,
}: {
  stationId: number
  regionMedian: number | null
  onClose: () => void
}) {
  const [station, setStation] = useState<StationDetailData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [rangeDays, setRangeDays] = useState(7)

  useEffect(() => {
    setStation(null)
    setError(null)
    api
      .station(stationId)
      .then(setStation)
      .catch(() => setError('Could not load this station right now.'))
  }, [stationId])

  const chartData = useMemo(() => {
    if (!station) return []
    const cutoff = Date.now() - rangeDays * 24 * 60 * 60 * 1000
    return station.history
      .filter((p) => new Date(p.time).getTime() >= cutoff)
      .map((p) => ({
        time: new Date(p.time).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric' }),
        regular: p.regular_price,
        premium: p.premium_price,
      }))
  }, [station, rangeDays])

  const changes = useMemo(() => (station ? deriveChanges(station.history).slice(0, 12) : []), [station])

  const sevenDayChange = useMemo(() => {
    if (!station) return null
    const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000
    const inWindow = station.history.filter((p) => new Date(p.time).getTime() >= cutoff)
    const first = inWindow[0]
    if (!first) return null
    return {
      regular: first.regular_price !== null && station.regular_price !== null ? station.regular_price - first.regular_price : null,
      premium: first.premium_price !== null && station.premium_price !== null ? station.premium_price - first.premium_price : null,
    }
  }, [station])

  const vsMedian =
    station && regionMedian && station.regular_price !== null
      ? ((station.regular_price - regionMedian) / regionMedian) * 100
      : null

  return (
    <div className="space-y-4">
      <button type="button" onClick={onClose} className="text-sm text-muted hover:text-foreground">
        &larr; Back
      </button>

      {error && <p className="text-sm text-negative">{error}</p>}
      {!error && !station && <p className="text-sm text-muted">Loading...</p>}

      {station && (
        <>
          <div>
            <div className="flex items-start justify-between">
              <h2 className="text-lg font-bold text-foreground">{station.name}</h2>
              <span className="text-xs text-muted">#{station.id}</span>
            </div>
            <p className="mt-1 text-sm text-muted">
              {station.address}
              <br />
              {station.city}, {station.state} {station.zip_code}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
              <span className="rounded-full border border-border px-2 py-0.5 text-muted">
                Updated {formatRelative(station.as_of)}
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

          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-lg bg-blue-600 p-3 text-white">
              <div className="text-xs opacity-80">Regular</div>
              <div className="text-xl font-bold">{formatPrice(station.regular_price)}</div>
            </div>
            <div className="rounded-lg bg-red-600 p-3 text-white">
              <div className="text-xs opacity-80">Premium</div>
              <div className="text-xl font-bold">{formatPrice(station.premium_price)}</div>
            </div>
          </div>

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
            {chartData.length < 2 ? (
              <p className="mt-3 text-sm text-muted">Not enough history yet to chart a trend.</p>
            ) : (
              <div className="mt-2 h-48 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData} margin={{ left: 0, right: 8, top: 8, bottom: 0 }}>
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
                    <Line type="stepAfter" dataKey="regular" name="Regular" stroke="#2563eb" dot={false} strokeWidth={2} />
                    <Line type="stepAfter" dataKey="premium" name="Premium" stroke="#dc2626" dot={false} strokeWidth={2} />
                  </LineChart>
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
              <div className="mt-2 max-h-48 overflow-y-auto">
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

          {station.hours && (
            <div>
              <div className="text-xs font-medium text-muted">Hours</div>
              <ul className="mt-2 space-y-0.5 text-xs text-muted">
                {station.hours.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </div>
  )
}
