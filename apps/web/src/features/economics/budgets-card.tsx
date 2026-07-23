import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input, Select } from "@/components/ui/input";
import { Field } from "@/components/common/field";
import { EmptyState } from "@/components/common/empty-state";
import { useConsoleState } from "@/data/use-console-state";
import { useAsyncAction, api } from "@/data/use-console-actions";
import { useUiStore } from "@/store/ui-store";
import { cn } from "@/lib/cn";
import { formatUsd as usd } from "@/lib/money";
import type { BudgetStatus } from "@/lib/console-state";
import { useAppTranslation } from "@/lib/i18n/use-app-translation";

const POLICY_LABEL: Record<string, string> = {
  warn: "Warn",
  require_approval: "Require approval",
  block: "Block",
};

export function BudgetsCard() {
  const { t } = useAppTranslation();
  const { data: state } = useConsoleState();
  const { execute, pending, error } = useAsyncAction();
  const statuses = state?.budgetStatuses ?? [];
  const projects = state?.projects ?? [];

  const selectedProjectId = useUiStore((s) => s.selectedProjectId);
  const [projectOverride, setProjectOverride] = useState<string | null>(null);
  const projectId = projectOverride ?? selectedProjectId ?? projects[0]?.id ?? "";
  const [limit, setLimit] = useState("1.00");
  const [policy, setPolicy] = useState("require_approval");

  function save() {
    const limitUsd = Number(limit);
    if (!projectId || !Number.isFinite(limitUsd)) return;
    void execute(() => api.setBudget({ projectId, limitUsd, policy }));
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("economicsBudget.title")}</CardTitle>
        <p className="text-sm text-muted-foreground">
          {t("economicsBudget.description")}
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {statuses.length === 0 ? (
          <EmptyState title={t("economicsBudget.empty")} hint={t("economicsBudget.emptyHint")} />
        ) : (
          <div className="space-y-2">
            {statuses.map((status) => (
              <BudgetRow key={status.projectId} status={status} />
            ))}
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto_auto] sm:items-end">
          <Field label={t("economicsBudget.project")}>
            <Select value={projectId} onChange={(e) => setProjectOverride(e.target.value || null)}>
              {projects.length === 0 ? <option value="">{t("economicsBudget.noProject")}</option> : null}
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("economicsBudget.limit")}>
            <Input
              type="number"
              min="0"
              step="0.01"
              value={limit}
              onChange={(e) => setLimit(e.target.value)}
              className="w-28"
            />
          </Field>
          <Field label={t("economicsBudget.policy")}>
            <Select value={policy} onChange={(e) => setPolicy(e.target.value)}>
              <option value="warn">{t("economicsBudget.warn")}</option>
              <option value="require_approval">{t("economicsBudget.requireApproval")}</option>
              <option value="block">{t("economicsBudget.block")}</option>
            </Select>
          </Field>
          <Button disabled={pending} onClick={save}>
            {t("economicsBudget.setBudget")}
          </Button>
        </div>
        {error ? <p className="text-xs text-destructive">{error}</p> : null}
      </CardContent>
    </Card>
  );
}

function BudgetRow({ status }: { status: BudgetStatus }) {
  const { t } = useAppTranslation();
  const limit = status.limitUsd ?? 0;
  const pct = limit > 0 ? Math.min(100, (status.spentUsd / limit) * 100) : status.spentUsd > 0 ? 100 : 0;
  const tone = status.over ? "danger" : pct > 80 ? "warning" : "success";
  return (
    <div className="rounded-lg border border-border px-3 py-2.5">
      <div className="flex items-center justify-between gap-3 text-sm">
        <span className="font-medium">{status.projectName ?? status.projectId}</span>
        <div className="flex items-center gap-2">
          <Badge tone={status.over ? "danger" : "neutral"}>{POLICY_LABEL[status.policy] ?? status.policy}</Badge>
          <span className="tabular-nums text-muted-foreground">
            {usd(status.spentUsd)} / {usd(limit)}
          </span>
        </div>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
        <div
          className={cn(
            "h-full rounded-full",
            tone === "danger" ? "bg-destructive" : tone === "warning" ? "bg-warning" : "bg-success",
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
      {status.estimatedUsd ? (
        <p className="mt-1.5 text-xs text-muted-foreground">
          {t("economicsBudget.includesEstimated", { amount: usd(status.estimatedUsd) })}
        </p>
      ) : null}
      {status.over ? (
        <p className="mt-1 text-xs text-destructive">
          {t("economicsBudget.overBudget")} — {t(status.policy === "block" ? "economicsBudget.blocked" : status.policy === "require_approval" ? "economicsBudget.held" : "economicsBudget.allowedWarning")}.
        </p>
      ) : null}
    </div>
  );
}
