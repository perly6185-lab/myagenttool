import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/common/empty-state";
import { formatUsd } from "@/lib/money";
import type { LedgerEntry, LedgerSummary } from "@/lib/console-state";

// --- pure aggregation (exported for tests) ----------------------------------

/** Total billable USD per UTC day, oldest→newest, last `limit` active days. */
export function dailySpend(entries: LedgerEntry[], limit = 14): { date: string; usd: number }[] {
  const byDay = new Map<string, number>();
  for (const entry of entries) {
    const day = typeof entry.createdAt === "string" ? entry.createdAt.slice(0, 10) : null;
    const amount = Number(entry.amountUsd);
    if (!day || !Number.isFinite(amount) || amount <= 0) continue;
    byDay.set(day, (byDay.get(day) ?? 0) + amount);
  }
  return [...byDay.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .slice(-limit)
    .map(([date, usd]) => ({ date, usd }));
}

type Rollup = { label: string; usd: number };

/** Top `limit` rows by USD (known + estimated), descending, positives only. */
export function topSpend(
  rows: { knownCostUsd?: number; estimatedCostUsd?: number }[] | undefined,
  label: (row: Record<string, unknown>) => string,
  limit = 6,
): Rollup[] {
  return (rows ?? [])
    .map((row) => ({ label: label(row as Record<string, unknown>), usd: (row.knownCostUsd ?? 0) + (row.estimatedCostUsd ?? 0) }))
    .filter((row) => row.usd > 0)
    .sort((a, b) => b.usd - a.usd)
    .slice(0, limit);
}

// --- marks ------------------------------------------------------------------

function TrendChart({ data }: { data: { date: string; usd: number }[] }) {
  const max = Math.max(...data.map((d) => d.usd), Number.EPSILON);
  return (
    <div className="flex h-32 items-end gap-1" role="img" aria-label="Daily spend trend">
      {data.map((day) => (
        <div
          key={day.date}
          className="flex-1 rounded-t bg-primary/70"
          style={{ height: `${Math.max(2, (day.usd / max) * 100)}%` }}
          title={`${day.date}: ${formatUsd(day.usd)}`}
        />
      ))}
    </div>
  );
}

function BreakdownBars({ title, rows }: { title: string; rows: Rollup[] }) {
  const max = Math.max(...rows.map((r) => r.usd), Number.EPSILON);
  return (
    <div className="space-y-2">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{title}</p>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No priced spend yet.</p>
      ) : (
        rows.map((row) => (
          <div key={row.label} className="flex items-center gap-2 text-sm">
            <span className="w-28 shrink-0 truncate text-muted-foreground [overflow-wrap:anywhere]" title={row.label}>{row.label}</span>
            <div className="h-3 flex-1 overflow-hidden rounded bg-muted">
              <div className="h-3 rounded bg-primary/70" style={{ width: `${Math.max(2, (row.usd / max) * 100)}%` }} />
            </div>
            <span className="w-16 shrink-0 text-right tabular-nums">{formatUsd(row.usd)}</span>
          </div>
        ))
      )}
    </div>
  );
}

export function SpendDashboard({ summary, entries }: { summary?: LedgerSummary; entries: LedgerEntry[] }) {
  const trend = dailySpend(entries);
  const byAgent = topSpend(summary?.byAgent, (row) => String(row.agentName ?? row.agentId ?? "unknown"));
  const byProject = topSpend(summary?.byProject, (row) => String(row.projectName ?? row.projectId ?? "unknown"));
  const byModel = topSpend(summary?.byModel, (row) => String(row.model ?? "unknown"));
  const hasData = trend.length > 0 || byAgent.length > 0 || byProject.length > 0 || byModel.length > 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Spend dashboard</CardTitle>
        <p className="text-sm text-muted-foreground">
          Daily spend and the top cost drivers, from the metered ledger.
        </p>
      </CardHeader>
      <CardContent className="space-y-5">
        {!hasData ? (
          <EmptyState title="No spend yet" hint="Priced runs will chart here as they complete." />
        ) : (
          <>
            {trend.length > 0 ? (
              <div className="space-y-1">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Daily spend</p>
                <TrendChart data={trend} />
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>{trend[0]?.date}</span>
                  <span>{trend[trend.length - 1]?.date}</span>
                </div>
              </div>
            ) : null}
            <div className="grid gap-5 sm:grid-cols-2">
              <BreakdownBars title="Top agents" rows={byAgent} />
              <BreakdownBars title="Top projects" rows={byProject} />
              <BreakdownBars title="Top models" rows={byModel} />
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
