import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/common/empty-state";
import { useConsoleState } from "@/data/use-console-state";
import { formatUsd as usd } from "@/lib/money";
import type { LedgerEntry } from "@/lib/console-state";
import { useAppTranslation } from "@/lib/i18n/use-app-translation";

function toCsv(entries: LedgerEntry[]): string {
  const header = [
    "id",
    "createdAt",
    "projectId",
    "costOwner",
    "agent",
    "provider",
    "inputTokens",
    "outputTokens",
    "amountUsd",
    "amountSource",
    "billable",
    "status",
  ];
  const rows = entries.map((e) => [
    e.id,
    e.createdAt,
    e.projectId ?? "",
    e.costOwner ?? "",
    e.agentName ?? e.agentId ?? "",
    e.provider ?? "",
    String(e.inputTokens ?? 0),
    String(e.outputTokens ?? 0),
    typeof e.amountUsd === "number" ? e.amountUsd.toFixed(6) : "",
    e.amountSource ?? "",
    String(Boolean(e.billable)),
    e.status ?? "",
  ]);
  return [header, ...rows].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
}

export function ChargebackCard() {
  const { t } = useAppTranslation();
  const { data: state } = useConsoleState();
  const rollups = state?.ledgerSummary?.byProject ?? [];
  const entries = state?.ledgerEntries ?? [];

  function exportCsv() {
    const blob = new Blob([toCsv(entries)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "myagenttool-ledger.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between">
        <div>
          <CardTitle>{t("economicsChargeback.title")}</CardTitle>
          <p className="text-sm text-muted-foreground">{t("economicsChargeback.description")}</p>
        </div>
        <Button variant="secondary" size="sm" disabled={!entries.length} onClick={exportCsv}>
          {t("economicsChargeback.export")}
        </Button>
      </CardHeader>
      <CardContent>
        {rollups.length === 0 ? (
          <EmptyState title={t("economicsChargeback.empty")} hint={t("economicsChargeback.emptyHint")} />
        ) : (
          <div className="overflow-hidden rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  {["project","runs","finalized","estimated","unmetered","total"].map((key, index) => <th key={key} className={`px-3 py-2 ${index ? "text-right" : "text-left"} font-medium`}>{t(`economicsChargeback.${key}` as never)}</th>)}
                </tr>
              </thead>
              <tbody>
                {rollups.map((o) => (
                  <tr key={o.projectId} className="border-t border-border">
                    <td className="px-3 py-2 font-medium">{o.projectName ?? o.projectId}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{o.entries}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{usd(o.knownCostUsd)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">~{usd(o.estimatedCostUsd)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{o.unknownEntries}</td>
                    <td className="px-3 py-2 text-right tabular-nums font-medium">
                      {usd(o.knownCostUsd + o.estimatedCostUsd)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
