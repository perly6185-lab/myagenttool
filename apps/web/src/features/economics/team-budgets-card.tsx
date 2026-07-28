import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input, Select } from "@/components/ui/input";
import { Field } from "@/components/common/field";
import { EmptyState } from "@/components/common/empty-state";
import { useConsoleState } from "@/data/use-console-state";
import { useAsyncAction, api } from "@/data/use-console-actions";
import { cn } from "@/lib/cn";
import { formatUsd as usd } from "@/lib/money";
import type { TeamBudgetStatus } from "@/lib/console-state";
import { useAppTranslation } from "@/lib/i18n/use-app-translation";

const POLICY_LABEL: Record<string, string> = {
  warn: "Warn",
  require_approval: "Require approval",
  block: "Block",
};

/**
 * Team budget pools: each team's spend rolled up across every project it owns,
 * with an optional pool cap. Over a block-policy pool, new runs for the team's
 * projects are rejected server-side.
 */
export function TeamBudgetsCard() {
  const { t } = useAppTranslation();
  const { data: state } = useConsoleState();
  const { execute, pending, error } = useAsyncAction();
  const rows = state?.teamBudgetStatuses ?? [];
  const teams = state?.teams ?? [];

  const [teamId, setTeamId] = useState("");
  const [limit, setLimit] = useState("10.00");
  const [policy, setPolicy] = useState("warn");
  const targetTeamId = teamId || teams[0]?.id || "";

  function save() {
    const limitUsd = Number(limit);
    if (!targetTeamId || !Number.isFinite(limitUsd)) return;
    void execute(() => api.setTeamBudget({ teamId: targetTeamId, limitUsd, policy }));
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("economicsDetails.teamBudgets")}</CardTitle>
        <p className="text-sm text-muted-foreground">
          {t("economicsDetails.teamBudgetsHint")}
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {rows.length === 0 ? (
          <EmptyState title={t("economicsDetails.noTeamSpend")} hint={t("economicsDetails.noTeamSpendHint")} />
        ) : (
          <div className="space-y-2">
            {rows.map((row) => (
              <TeamBudgetRow key={row.teamId} row={row} />
            ))}
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto_auto] sm:items-end">
          <Field label={t("economicsDetails.team")}>
            <Select value={targetTeamId} onChange={(e) => setTeamId(e.target.value)}>
              {teams.map((team) => (
                <option key={team.id} value={team.id}>
                  {team.name ?? team.id}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("economicsBudget.limit")}>
            <Input className="w-28" value={limit} onChange={(e) => setLimit(e.target.value)} inputMode="decimal" />
          </Field>
          <Field label={t("economicsBudget.policy")}>
            <Select value={policy} onChange={(e) => setPolicy(e.target.value)}>
              <option value="warn">{t("economicsBudget.warn")}</option>
              <option value="block">{t("economicsBudget.block")}</option>
            </Select>
          </Field>
          <Button onClick={save} disabled={pending || !targetTeamId}>
            {pending ? t("economicsDetails.saving") : t("economicsDetails.setPool")}
          </Button>
        </div>
        {error ? <p className="text-xs text-destructive">{error}</p> : null}
      </CardContent>
    </Card>
  );
}

function TeamBudgetRow({ row }: { row: TeamBudgetStatus }) {
  const { t } = useAppTranslation();
  const limit = row.limitUsd ?? 0;
  const pct = limit > 0 ? Math.min(100, (row.spentUsd / limit) * 100) : row.spentUsd > 0 ? 100 : 0;
  const tone = row.over ? "danger" : pct > 80 ? "warning" : "success";
  return (
    <div className="rounded-lg border border-border px-3 py-2.5">
      <div className="flex items-center justify-between gap-3 text-sm">
        <span className="font-medium">
          {row.teamName ?? row.teamId}
          <span className="ml-2 text-xs text-muted-foreground">{t("economicsDetails.projectCount", { count: row.projectCount })}</span>
        </span>
        <div className="flex items-center gap-2">
          {row.exists ? (
            <Badge tone={row.over ? "danger" : "neutral"}>{POLICY_LABEL[row.policy] ?? row.policy}</Badge>
          ) : (
            <Badge tone="neutral">{t("economicsDetails.noPool")}</Badge>
          )}
          <span className="tabular-nums text-muted-foreground">
            {usd(row.spentUsd)}{row.exists ? ` / ${usd(limit)}` : ""}
          </span>
        </div>
      </div>
      {row.exists ? (
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
          <div
            className={cn(
              "h-full rounded-full",
              tone === "danger" ? "bg-destructive" : tone === "warning" ? "bg-warning" : "bg-success",
            )}
            style={{ width: `${pct}%` }}
          />
        </div>
      ) : null}
      {row.over ? (
        <p className="mt-1 text-xs text-destructive">
          {t("economicsDetails.overTeamPool")} — {t(row.policy === "block" ? "economicsBudget.blocked" : "economicsBudget.allowedWarning")}.
        </p>
      ) : null}
    </div>
  );
}
