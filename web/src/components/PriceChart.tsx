import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { PricePoint } from '../lib/api'

export function PriceChart({ history }: { history: PricePoint[] }) {
  if (history.length < 2) {
    return <p className="mt-4 text-sm text-muted">Not enough history yet to chart a trend.</p>
  }

  const data = history.map((point) => ({
    time: new Date(point.time).toLocaleDateString(),
    regular: point.regular_price,
  }))

  return (
    <div className="mt-4 h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ left: 0, right: 12, top: 8, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
          <XAxis dataKey="time" stroke="var(--muted)" fontSize={12} tickMargin={8} minTickGap={40} />
          <YAxis
            stroke="var(--muted)"
            fontSize={12}
            domain={['auto', 'auto']}
            tickFormatter={(v: number) => `$${v.toFixed(2)}`}
            width={56}
          />
          <Tooltip
            formatter={(value: number) => [`$${value.toFixed(2)}`, 'Regular']}
            contentStyle={{
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: 8,
              color: 'var(--foreground)',
            }}
          />
          <Line type="stepAfter" dataKey="regular" stroke="var(--primary)" dot={false} strokeWidth={2} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
