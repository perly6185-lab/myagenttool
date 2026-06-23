import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/common/empty-state";
import { useConsoleState } from "@/data/use-console-state";
import type { LedgerEntry } from "@/lib/console-state";

function usd(value: number): string {
  return `$${value.toFixed(value < 1 ? 4 : 2)}`;
}

function toCsv(entries: LedgerEntry[]): string {
  const header = [
    "id",
    "createdAt",
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
  const { data: state } = useConsoleState();
  const owners = state?.ledgerSummary?.byCostOwner ?? [];
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
          <CardTitle>Chargeback statement</CardTitle>
          <p className="text-sm text-muted-foreground">Settlement-ready rollup per cost owner.</p>
        </div>
        <Button variant="secondary" size="sm" disabled={!entries.length} onClick={exportCsv}>
          Export CSV
        </Button>
      </CardHeader>
      <CardContent>
        {owners.length === 0 ? (
          <EmptyState title="Nothing to settle" hint="Run agents to build a chargeback statement." />
        ) : (
          <div className="overflow-hidden rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Cost owner</th>
                  <th className="px-3 py-2 text-right font-medium">Runs</th>
                  <th className="px-3 py-2 text-right font-medium">Finalized</th>
                  <th className="px-3 py-2 text-right font-medium">Estimated</th>
                  <th className="px-3 py-2 text-right font-medium">Unmetered</th>
                  <th className="px-3 py-2 text-right font-medium">Total</th>
                </tr>
              </thead>
              <tbody>
                {owners.map((o) => (
                  <tr key={o.costOwner} className="border-t border-border">
                    <td className="px-3 py-2 font-medium">{o.costOwner}</td>
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
