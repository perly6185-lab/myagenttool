import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/common/empty-state";
import { useConsoleState } from "@/data/use-console-state";
import { useAsyncAction, api } from "@/data/use-console-actions";
import { formatUsd as usd } from "@/lib/money";
import { shortTime } from "@/lib/readable-labels";
import { ImportedUsageTable } from "@/features/economics/imported-usage-table";

// The daily ccusage report capability an opt-in automation targets.
const CCUSAGE_DAILY_CAPABILITY = "app.app_ccusage.wrapper.daily";

/**
 * ccusage-imported usage estimates. Kept visually distinct from the metered
 * ledger: these are non-authoritative, externally-billed figures the ledger
 * must never treat as platform-metered cost.
 */
export function ImportedUsageCard() {
  const { data: state } = useConsoleState();
  const estimates = state?.importedUsageEstimates ?? [];
  const { execute, pending, error } = useAsyncAction();

  const totalUsd = estimates.reduce((sum, row) => sum + (row.estimatedCostUsd ?? 0), 0);
  // Freshness: the newest row's import time, so stale/paused data doesn't look current.
  const lastImported = estimates.reduce((latest, row) => (row.createdAt > latest ? row.createdAt : latest), "");

  // Opt-in daily auto-import: a capability automation for the ccusage daily
  // report (#901). Idempotent now that imports dedup (#882). Off by default.
  const autoImport = (state?.automations ?? []).find(
    (automation) => automation.target?.kind === "capability" && automation.target?.capability === CCUSAGE_DAILY_CAPABILITY,
  );
  const projectId = state?.currentProjectId ?? null;

  function toggleAutoImport() {
    if (autoImport) {
      void execute(() => api.deleteAutomation(autoImport.id));
    } else if (projectId) {
      void execute(() => api.createAutomation({
        projectId,
        name: "ccusage daily auto-import",
        schedule: { kind: "daily", time: "09:00" },
        target: { kind: "capability", capability: CCUSAGE_DAILY_CAPABILITY },
      }));
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <CardTitle>Imported usage (ccusage)</CardTitle>
          <div className="flex shrink-0 items-center gap-1.5">
            <Badge tone="neutral">Non-authoritative</Badge>
            <Badge tone="neutral">External-billed</Badge>
            <Button
              variant={autoImport ? "secondary" : "ghost"}
              size="sm"
              className="h-7 px-2 text-xs"
              disabled={pending || (!autoImport && !projectId)}
              onClick={toggleAutoImport}
              title={!autoImport && !projectId ? "Select a project first" : "Schedule a daily ccusage report to import automatically"}
            >
              {autoImport ? "Auto-import daily: on" : "Enable daily auto-import"}
            </Button>
          </div>
        </div>
        <p className="text-sm text-muted-foreground">
          Estimated token/cost rows imported from governed ccusage reports. Billed by the external
          Codex/Claude account — shown for visibility, never rolled into metered ledger cost.
        </p>
        {error ? <p className="text-xs text-destructive">{String(error)}</p> : null}
      </CardHeader>
      <CardContent>
        {!estimates.length ? (
          <EmptyState
            title="No imported usage yet"
            hint="Enable daily auto-import above, or run the ccusage.report tool from the Tools panel."
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
