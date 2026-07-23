import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/common/empty-state";
import { BudgetsCard } from "@/features/economics/budgets-card";
import { TeamBudgetsCard } from "@/features/economics/team-budgets-card";
import { ChargebackCard } from "@/features/economics/chargeback-card";
import { ImportedUsageCard } from "@/features/economics/imported-usage-card";
import { SpendDashboard } from "@/features/economics/spend-dashboard";
import { useConsoleState } from "@/data/use-console-state";
import { shortTime } from "@/lib/readable-labels";
import { formatUsd as usd } from "@/lib/money";
import type { LedgerEntry } from "@/lib/console-state";
import { useAppTranslation } from "@/lib/i18n/use-app-translation";

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
  // Format from the numeric amountUsd (amountText is only set for unmetered rows).
  // Estimated amounts are prefixed "~" per the table's legend.
  const amount = Number(entry.amountUsd);
  const hasAmount = Number.isFinite(amount) && amount > 0;
  if (entry.amountSource === "reported" && hasAmount) return <span className="tabular-nums">{usd(amount)}</span>;
  if (entry.amountSource === "estimated" && hasAmount)
    return <span className="tabular-nums text-muted-foreground">~{usd(amount)}</span>;
  return <span className="text-muted-foreground">{entry.amountText ?? "unknown"}</span>;
}

export function EconomicsView() {
  const { t } = useAppTranslation();
  const { data: state } = useConsoleState();
  const summary = state?.ledgerSummary;
  const entries = state?.ledgerEntries ?? [];

  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Metric
          label={t("economicsPage.finalizedCost")}
          value={usd(summary?.finalizedUsd ?? 0)}
          hint={t("economicsPage.meteredRuns", { count: summary?.knownEntries ?? 0 })}
        />
        <Metric
          label={t("economicsPage.estimatedCost")}
          value={`~${usd(summary?.estimatedUsd ?? 0)}`}
          hint={t("economicsPage.estimatedRuns", { count: summary?.estimatedEntries ?? 0 })}
        />
        <Metric
          label={t("economicsPage.unmeteredRuns")}
          value={String(summary?.unknownEntries ?? 0)}
          hint={t("economicsPage.noCost")}
        />
        <Metric label={t("economicsPage.billableRuns")} value={String(summary?.billableEntries ?? 0)} hint={t("economicsPage.billableHint")} />
      </div>

      <SpendDashboard summary={summary} entries={entries} />

      <BudgetsCard />
      <TeamBudgetsCard />
      <ImportedUsageCard />

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{t("economicsPage.byAgent")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {!summary?.byAgent?.length ? (
              <EmptyState title={t("economicsPage.noAgentSpend")} hint={t("economicsPage.noAgentSpendHint")} />
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
          <CardTitle>{t("economicsPage.costLedger")}</CardTitle>
          <p className="text-sm text-muted-foreground">
            {t("economicsPage.ledgerHint")}
          </p>
        </CardHeader>
        <CardContent>
          {entries.length === 0 ? (
            <EmptyState title={t("economicsPage.ledgerEmpty")} hint={t("economicsPage.ledgerEmptyHint")} />
          ) : (
            <div className="overflow-hidden rounded-lg border border-border">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    {["time","agent","provider","costOwner","tokens","amount","status"].map((key) => <th key={key} className={`px-3 py-2 ${["tokens","amount","status"].includes(key) ? "text-right" : "text-left"} font-medium`}>{t(`economicsPage.${key}` as never)}</th>)}
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
