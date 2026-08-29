import { useEffect, useState } from 'react'
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { StatsHeader } from '../components/StatsHeader'
import { api, type StateStat, type StatsSummary } from '../lib/api'

function StateTable({ title, rows }: { title: string; rows: StateStat[] }) {
  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <div className="text-xs font-medium text-muted">{title}</div>
      <ol className="mt-3 space-y-2">
        {rows.map((s, i) => (
          <li key={s.state} className="flex items-center justify-between text-sm">
            <span className="text-foreground">
              <span className="mr-2 text-muted">{i + 1}</span>
              {s.state}
            </span>
            <span className="font-mono text-muted">${s.avg_regular_price.toFixed(2)}</span>
          </li>
        ))}
      </ol>
    </div>
  )
}

export function Analytics() {
  const [stats, setStats] = useState<StatsSummary | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api.statsSummary().then(setStats).catch(() => setError('Could not load live data right now.'))
  }, [])

  const monthly = stats?.monthly_averages.map((m) => ({ month: m.month, avg: m.avg_regular_price })) ?? []

  return (
    <div className="mx-auto max-w-content px-6 py-12">
      <h1 className="text-2xl font-bold text-foreground">Analytics</h1>
      <p className="mt-2 max-w-2xl text-sm text-muted">
        Aggregate trends across every tracked warehouse -- national price movement over
        time, and which US states/Canadian provinces run cheapest and priciest.
      </p>

      {error && <p className="mt-8 text-sm text-negative">{error}</p>}
      {!error && !stats && <p className="mt-8 text-sm text-muted">Loading...</p>}

      {stats && (
        <>
          <div className="mt-8">
            <StatsHeader stats={stats} />
          </div>

          <div className="mt-8 rounded-lg border border-border bg-surface p-4">
            <div className="text-xs font-medium text-muted">National monthly average (regular)</div>
            {monthly.length < 2 ? (
              <p className="mt-4 text-sm text-muted">Not enough history yet to chart a trend.</p>
            ) : (
              <div className="mt-4 h-72 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={monthly} margin={{ left: 0, right: 12, top: 8, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                    <XAxis dataKey="month" stroke="var(--muted)" fontSize={12} tickMargin={8} />
                    <YAxis
                      stroke="var(--muted)"
                      fontSize={12}
                      domain={['auto', 'auto']}
                      tickFormatter={(v: number) => `$${v.toFixed(2)}`}
                      width={56}
                    />
                    <Tooltip
                      formatter={(value: number) => [`$${value.toFixed(2)}`, 'Avg regular']}
                      contentStyle={{
                        background: 'var(--surface)',
                        border: '1px solid var(--border)',
                        borderRadius: 8,
                        color: 'var(--foreground)',
                      }}
                    />
                    <Line type="monotone" dataKey="avg" stroke="var(--primary)" dot={false} strokeWidth={2} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>

          <div className="mt-8 grid grid-cols-1 gap-6 sm:grid-cols-2">
            <StateTable title="Cheapest (7-day avg)" rows={stats.cheapest_states.slice(0, 5)} />
            <StateTable title="Priciest (7-day avg)" rows={stats.priciest_states.slice(0, 5)} />
          </div>
        </>
      )}
    </div>
  )
}
