import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/common/empty-state";
import { BudgetsCard } from "@/features/economics/budgets-card";
import { ChargebackCard } from "@/features/economics/chargeback-card";
import { useConsoleState } from "@/data/use-console-state";
import { shortTime } from "@/lib/readable-labels";
import type { LedgerEntry } from "@/lib/console-state";

function usd(value: number): string {
  return `$${value.toFixed(value < 1 ? 4 : 2)}`;
}

function statusTone(status?: string): "neutral" | "success" | "warning" {
  if (status === "finalized") return "success";
  if (status === "voided") return "warning";
  return "neutral";
}

function Metric({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card>
      <CardContent className="space-y-1 p-5">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
        <p className="text-2xl font-semibold tabular-nums">{value}</p>
        {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      </CardContent>
    </Card>
  );
}

function amountCell(entry: LedgerEntry) {
  if (entry.amountSource === "reported") return <span className="tabular-nums">{entry.amountText}</span>;
  if (entry.amountSource === "estimated")
    return <span className="tabular-nums text-muted-foreground">{entry.amountText}</span>;
  return <span className="text-muted-foreground">unknown</span>;
}

export function EconomicsView() {
  const { data: state } = useConsoleState();
  const summary = state?.ledgerSummary;
  const entries = state?.ledgerEntries ?? [];

  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Metric
          label="Finalized cost"
          value={usd(summary?.finalizedUsd ?? 0)}
          hint={`${summary?.knownEntries ?? 0} metered run(s)`}
        />
        <Metric
          label="Estimated cost"
          value={`~${usd(summary?.estimatedUsd ?? 0)}`}
          hint={`${summary?.estimatedEntries ?? 0} token-estimated run(s)`}
        />
        <Metric
          label="Unmetered runs"
          value={String(summary?.unknownEntries ?? 0)}
          hint="No cost reported or estimable"
        />
        <Metric label="Billable runs" value={String(summary?.billableEntries ?? 0)} hint="Flagged billable by the agent" />
      </div>

      <BudgetsCard />

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>By agent</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {!summary?.byAgent?.length ? (
              <EmptyState title="No agent spend yet" hint="Codex/Claude runs report cost here." />
            ) : (
              summary.byAgent.map((agent) => (
                <div
                  key={agent.agentId}
                  className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2 text-sm"
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium">{agent.agentName ?? agent.agentId}</p>
                    <p className="text-xs text-muted-foreground">
                      {agent.provider ?? "unknown"} · {agent.entries} run(s)
                      {agent.estimatedCostUsd ? ` · ~${usd(agent.estimatedCostUsd)} est.` : ""}
                      {agent.unknownEntries ? ` · ${agent.unknownEntries} unmetered` : ""}
                    </p>
                  </div>
                  <span className="tabular-nums font-medium">{usd(agent.knownCostUsd + agent.estimatedCostUsd)}</span>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <ChargebackCard />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Cost ledger</CardTitle>
          <p className="text-sm text-muted-foreground">
            One entry per completed invocation — reported amounts are finalized; token estimates are marked ~.
          </p>
        </CardHeader>
        <CardContent>
          {entries.length === 0 ? (
            <EmptyState title="Ledger is empty" hint="Run an agent (Codex/Claude report real cost) to record entries." />
          ) : (
            <div className="overflow-hidden rounded-lg border border-border">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">Time</th>
                    <th className="px-3 py-2 text-left font-medium">Agent</th>
                    <th className="px-3 py-2 text-left font-medium">Provider</th>
                    <th className="px-3 py-2 text-left font-medium">Cost owner</th>
                    <th className="px-3 py-2 text-right font-medium">Tokens</th>
                    <th className="px-3 py-2 text-right font-medium">Amount</th>
                    <th className="px-3 py-2 text-right font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.slice(0, 50).map((entry) => (
                    <tr key={entry.id} className="border-t border-border">
                      <td className="px-3 py-2 font-mono text-xs text-muted-foreground">{shortTime(entry.createdAt)}</td>
                      <td className="px-3 py-2">{entry.agentName ?? entry.agentId}</td>
                      <td className="px-3 py-2 text-muted-foreground">{entry.provider ?? "unknown"}</td>
                      <td className="px-3 py-2 text-muted-foreground">{entry.costOwner ?? "unknown"}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                        {(entry.inputTokens ?? 0) + (entry.outputTokens ?? 0) || "—"}
                      </td>
                      <td className="px-3 py-2 text-right">{amountCell(entry)}</td>
                      <td className="px-3 py-2 text-right">
                        <Badge tone={statusTone(entry.status)}>{entry.status ?? "estimated"}</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
