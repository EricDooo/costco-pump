import type { StatsSummary } from '../lib/api'

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-2xl font-bold text-foreground">{value}</div>
      <div className="text-xs text-muted">{label}</div>
    </div>
  )
}

export function StatsHeader({ stats }: { stats: StatsSummary }) {
  const netLabel =
    stats.cuts === stats.hikes
      ? 'even'
      : stats.cuts > stats.hikes
        ? `${stats.cuts - stats.hikes} more cuts than hikes`
        : `${stats.hikes - stats.cuts} more hikes than cuts`

  return (
    <section className="grid grid-cols-2 gap-6 border-b border-border pb-8 sm:grid-cols-4">
      <Stat label="Days tracked" value={String(stats.tracked_days)} />
      <Stat label="Price moves logged" value={stats.total_price_moves.toLocaleString()} />
      <Stat label="Cuts vs hikes" value={`${stats.cuts.toLocaleString()} / ${stats.hikes.toLocaleString()}`} />
      <Stat label="Net" value={netLabel} />
    </section>
  )
}
