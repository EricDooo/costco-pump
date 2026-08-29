import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { AllStatesTable } from '../components/AllStatesTable'
import { StatsHeader } from '../components/StatsHeader'
import { useRegion } from '../hooks/useRegion'
import { api, type StateChangeStat, type StateFuelStat, type StatsSummary, type TrendSummary } from '../lib/api'
import { stateName } from '../lib/stateNames'

const TREND_DAYS = 30

function formatPrice(price: number | null): string {
  return price === null ? '--' : `$${price.toFixed(3)}`
}

function formatCents(dollars: number): string {
  const cents = Math.round(Math.abs(dollars) * 100 * 10) / 10
  return `${dollars >= 0 ? '+' : '-'}${cents.toFixed(1)}¢`
}

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <div className="text-[10px] font-medium tracking-wide text-muted uppercase">{label}</div>
      <div className="mt-1 text-xl font-bold text-foreground">{value}</div>
      {sub && <div className="mt-1 text-xs text-muted">{sub}</div>}
    </div>
  )
}

function ActivityBar({ hikes, cuts }: { hikes: number; cuts: number }) {
  const total = hikes + cuts
  const cutsPct = total > 0 ? (cuts / total) * 100 : 50
  const label = total === 0 ? 'No moves yet' : hikes === cuts ? 'Even split' : hikes > cuts ? 'More hikes' : 'More cuts'
  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <div className="text-[10px] font-medium tracking-wide text-muted uppercase">Latest day activity</div>
      <div className="mt-1 text-xl font-bold text-foreground">{label}</div>
      <div className="mt-3 flex h-1.5 overflow-hidden rounded-full">
        <div className="bg-positive" style={{ width: `${cutsPct}%` }} />
        <div className="flex-1 bg-negative" />
      </div>
      <div className="mt-1.5 flex justify-between text-xs">
        <span className="text-positive">{cuts} cuts</span>
        <span className="text-negative">{hikes} hikes</span>
      </div>
    </div>
  )
}

function ChangesByStateTable({ rows }: { rows: StateChangeStat[] }) {
  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-surface p-4">
        <div className="text-xs font-medium text-muted">Price changes by state (last 24h)</div>
        <p className="mt-3 text-sm text-muted">No price moves recorded in this window yet.</p>
      </div>
    )
  }
  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <div className="text-xs font-medium text-muted">Price changes by state (last 24h)</div>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-muted">
              <th className="pb-2 font-medium">State</th>
              <th className="pb-2 text-right font-medium">Cuts</th>
              <th className="pb-2 text-right font-medium">Hikes</th>
              <th className="pb-2 text-right font-medium">Avg change</th>
              <th className="pb-2 text-right font-medium">Biggest move</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.state} className="border-t border-border">
                <td className="py-1.5">
                  <Link to={`/analytics/state/${r.state}`} className="text-foreground hover:text-primary hover:underline">
                    {stateName(r.state)}
                  </Link>
                </td>
                <td className="py-1.5 text-right font-mono text-positive">{r.cuts}</td>
                <td className="py-1.5 text-right font-mono text-negative">{r.hikes}</td>
                <td className={`py-1.5 text-right font-mono ${r.avg_change >= 0 ? 'text-negative' : 'text-positive'}`}>
                  {formatCents(r.avg_change)}
                </td>
                <td className="py-1.5 text-right font-mono text-muted">{formatCents(r.biggest_move)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

/** The national trend chart -- median regular/premium/diesel over time,
 * shared with AnalyticsState.tsx's per-state version. */
export function TrendChart({ trend }: { trend: TrendSummary | null }) {
  const chartData =
    trend?.points.map((p) => ({
      date: new Date(p.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
      regular: p.median_regular,
      premium: p.median_premium,
      diesel: p.median_diesel,
    })) ?? []

  if (!trend) return <p className="mt-4 text-sm text-muted">Loading...</p>
  if (chartData.length < 2) {
    return <p className="mt-4 text-sm text-muted">Not enough history yet to chart a trend.</p>
  }

  return (
    <div className="mt-4 h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={chartData} margin={{ left: 0, right: 12, top: 8, bottom: 0 }}>
          <defs>
            <linearGradient id="regularArea" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#2563eb" stopOpacity={0.2} />
              <stop offset="100%" stopColor="#2563eb" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="premiumArea" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#dc2626" stopOpacity={0.2} />
              <stop offset="100%" stopColor="#dc2626" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="dieselArea" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#16a34a" stopOpacity={0.2} />
              <stop offset="100%" stopColor="#16a34a" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
          <XAxis dataKey="date" stroke="var(--muted)" fontSize={12} tickMargin={8} minTickGap={30} />
          <YAxis
            stroke="var(--muted)"
            fontSize={12}
            domain={['auto', 'auto']}
            tickFormatter={(v: number) => `$${v.toFixed(2)}`}
            width={56}
          />
          <Tooltip
            formatter={(value: number, name: string) => [`$${value.toFixed(3)}`, name]}
            contentStyle={{
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: 8,
              color: 'var(--foreground)',
            }}
          />
          <Area type="monotone" dataKey="regular" name="Regular" stroke="#2563eb" fill="url(#regularArea)" strokeWidth={2} connectNulls />
          <Area type="monotone" dataKey="premium" name="Premium" stroke="#dc2626" fill="url(#premiumArea)" strokeWidth={2} connectNulls />
          <Area type="monotone" dataKey="diesel" name="Diesel" stroke="#16a34a" fill="url(#dieselArea)" strokeWidth={2} connectNulls />
        </AreaChart>
      </ResponsiveContainer>
      <div className="mt-2 flex justify-center gap-4 text-xs">
        <span className="flex items-center gap-1.5 text-muted">
          <span className="h-2 w-2 rounded-full bg-blue-600" /> Regular
        </span>
        <span className="flex items-center gap-1.5 text-muted">
          <span className="h-2 w-2 rounded-full bg-red-600" /> Premium
        </span>
        <span className="flex items-center gap-1.5 text-muted">
          <span className="h-2 w-2 rounded-full bg-green-600" /> Diesel
        </span>
      </div>
    </div>
  )
}

export function Analytics() {
  const { regionId, region } = useRegion()
  const [stats, setStats] = useState<StatsSummary | null>(null)
  const [trend, setTrend] = useState<TrendSummary | null>(null)
  const [changesByState, setChangesByState] = useState<StateChangeStat[] | null>(null)
  const [allStates, setAllStates] = useState<StateFuelStat[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setTrend(null)
    setChangesByState(null)
    setAllStates(null)
    setError(null)
    const calls = [
      api.statsSummary(),
      api.trend({ days: TREND_DAYS, region: regionId }),
      region.showStateBreakdown ? api.changesByState({ region: regionId }) : Promise.resolve([]),
      region.showStateBreakdown ? api.states(regionId) : Promise.resolve([]),
    ] as const
    Promise.all(calls)
      .then(([s, t, c, a]) => {
        setStats(s)
        setTrend(t)
        setChangesByState(c)
        setAllStates(a)
      })
      .catch(() => setError('Could not load live data right now.'))
  }, [regionId, region.showStateBreakdown])

  return (
    <div className="mx-auto max-w-content px-6 py-12">
      <h1 className="text-2xl font-bold text-foreground">Analytics</h1>
      <p className="mt-2 max-w-2xl text-sm text-muted">
        Aggregate trends for {region.label} -- price movement over time, and which{' '}
        {region.showStateBreakdown ? 'states/provinces' : 'stations'} run cheapest and priciest. Change the country in
        the header to see another region.
      </p>

      {error && <p className="mt-8 text-sm text-negative">{error}</p>}
      {!error && !stats && <p className="mt-8 text-sm text-muted">Loading...</p>}

      {stats && (
        <>
          <div className="mt-8">
            <StatsHeader stats={stats} />
          </div>

          <div className="mt-8 grid grid-cols-1 gap-4 lg:grid-cols-[1fr_240px]">
            <div className="rounded-lg border border-border bg-surface p-4">
              <div className="text-sm font-bold text-foreground">{region.label} trend</div>
              <p className="text-xs text-muted">
                Median regular/premium/diesel price across tracked Costco stations -- last {TREND_DAYS} days
              </p>
              {trend?.move !== null && trend?.move !== undefined && (
                <p className="mt-1 text-xs text-muted">
                  The regional regular median {trend.move >= 0 ? 'rose' : 'fell'}{' '}
                  {formatCents(trend.move).replace('+', '').replace('-', '')} over this window.
                </p>
              )}
              <TrendChart trend={trend} />
            </div>

            <div className="grid grid-cols-2 gap-4 lg:grid-cols-1">
              <StatCard
                label="Current median"
                value={formatPrice(trend?.current_median ?? null)}
                sub={trend ? `${trend.stations_reporting} stations reporting` : undefined}
              />
              <StatCard
                label={`${TREND_DAYS}-day move`}
                value={trend?.move !== null && trend?.move !== undefined ? formatCents(trend.move) : '--'}
              />
              <div className="col-span-2 lg:col-span-1">
                <ActivityBar hikes={trend?.latest_day_hikes ?? 0} cuts={trend?.latest_day_cuts ?? 0} />
              </div>
            </div>
          </div>

          {region.showStateBreakdown && (
            <>
              <div className="mt-8">{changesByState && <ChangesByStateTable rows={changesByState} />}</div>
              <div className="mt-8">{allStates && <AllStatesTable rows={allStates} />}</div>
            </>
          )}
        </>
      )}
    </div>
  )
}
