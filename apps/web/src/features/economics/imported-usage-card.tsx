import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/common/empty-state";
import { useConsoleState } from "@/data/use-console-state";
import { formatUsd as usd } from "@/lib/money";
import { shortTime } from "@/lib/readable-labels";
import { ImportedUsageTable } from "@/features/economics/imported-usage-table";

/**
 * ccusage-imported usage estimates. Kept visually distinct from the metered
 * ledger: these are non-authoritative, externally-billed figures the ledger
 * must never treat as platform-metered cost.
 */
export function ImportedUsageCard() {
  const { data: state } = useConsoleState();
  const estimates = state?.importedUsageEstimates ?? [];

  const totalUsd = estimates.reduce((sum, row) => sum + (row.estimatedCostUsd ?? 0), 0);
  // Freshness: the newest row's import time, so stale/paused data doesn't look current.
  const lastImported = estimates.reduce((latest, row) => (row.createdAt > latest ? row.createdAt : latest), "");

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
              {lastImported ? <> · last imported {shortTime(lastImported)}</> : null}
            </p>
            <ImportedUsageTable rows={estimates} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
