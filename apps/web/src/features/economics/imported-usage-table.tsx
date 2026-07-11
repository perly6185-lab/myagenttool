import { formatUsd as usd } from "@/lib/money";
import type { ImportedUsageEstimate } from "@/lib/console-state";

export function importedUsagePeriod(row: ImportedUsageEstimate): string {
  return row.date ?? row.month ?? row.week ?? row.periodStart ?? "—";
}

/**
 * The imported-estimate rows table, shared between the Economics card (all rows)
 * and the Invocations detail (this run's rows). Estimates are non-authoritative
 * external-billed figures — callers own that framing; this renders the data.
 */
export function ImportedUsageTable({ rows, limit = 50 }: { rows: ImportedUsageEstimate[]; limit?: number }) {
  return (
    <>
      <div className="overflow-hidden rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left font-medium">Provider</th>
              <th className="px-3 py-2 text-left font-medium">Model</th>
              <th className="px-3 py-2 text-left font-medium">Period</th>
              <th className="px-3 py-2 text-right font-medium">Tokens</th>
              <th className="px-3 py-2 text-right font-medium">Est. cost</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, limit).map((row) => (
              <tr key={row.id} className="border-t border-border">
                <td className="px-3 py-2">{row.provider ?? row.sourceAgent ?? "unknown"}</td>
                <td className="px-3 py-2 text-muted-foreground">{row.model ?? "—"}</td>
                <td className="px-3 py-2 font-mono text-xs text-muted-foreground">{importedUsagePeriod(row)}</td>
                <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                  {(row.totalTokens ?? (row.inputTokens ?? 0) + (row.outputTokens ?? 0)) || "—"}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                  {row.estimatedCostUsd != null ? `~${usd(row.estimatedCostUsd)}` : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length > limit ? (
        <p className="text-xs text-muted-foreground">Showing the first {limit} of {rows.length} rows.</p>
      ) : null}
    </>
  );
}
