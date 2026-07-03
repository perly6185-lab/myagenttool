import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/common/empty-state";
import { useConsoleState } from "@/data/use-console-state";
import { formatUsd as usd } from "@/lib/money";
import type { ImportedUsageEstimate } from "@/lib/console-state";

function periodOf(row: ImportedUsageEstimate): string {
  return row.date ?? row.month ?? row.week ?? row.periodStart ?? "—";
}

/**
 * ccusage-imported usage estimates. Kept visually distinct from the metered
 * ledger: these are non-authoritative, externally-billed figures the ledger
 * must never treat as platform-metered cost.
 */
export function ImportedUsageCard() {
  const { data: state } = useConsoleState();
  const estimates = state?.importedUsageEstimates ?? [];

  const totalUsd = estimates.reduce((sum, row) => sum + (row.estimatedCostUsd ?? 0), 0);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <CardTitle>Imported usage (ccusage)</CardTitle>
          <div className="flex shrink-0 gap-1.5">
            <Badge tone="neutral">Non-authoritative</Badge>
            <Badge tone="neutral">External-billed</Badge>
          </div>
        </div>
        <p className="text-sm text-muted-foreground">
          Estimated token/cost rows imported from governed ccusage reports. Billed by the external
          Codex/Claude account — shown for visibility, never rolled into metered ledger cost.
        </p>
      </CardHeader>
      <CardContent>
        {!estimates.length ? (
          <EmptyState
            title="No imported usage yet"
            hint="Run the ccusage.report tool from the Tools panel to import estimates."
          />
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              {estimates.length} row(s) · <span className="tabular-nums text-foreground">~{usd(totalUsd)}</span>{" "}
              estimated (external)
            </p>
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
                  {estimates.slice(0, 50).map((row) => (
                    <tr key={row.id} className="border-t border-border">
                      <td className="px-3 py-2">{row.provider ?? row.sourceAgent ?? "unknown"}</td>
                      <td className="px-3 py-2 text-muted-foreground">{row.model ?? "—"}</td>
                      <td className="px-3 py-2 font-mono text-xs text-muted-foreground">{periodOf(row)}</td>
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
            {estimates.length > 50 ? (
              <p className="text-xs text-muted-foreground">Showing the first 50 of {estimates.length} rows.</p>
            ) : null}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
