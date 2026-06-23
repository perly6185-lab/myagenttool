import { useMemo, useState } from "react";
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
import type { BudgetStatus } from "@/lib/console-state";

const POLICY_LABEL: Record<string, string> = {
  warn: "Warn",
  require_approval: "Require approval",
  block: "Block",
};

export function BudgetsCard() {
  const { data: state } = useConsoleState();
  const { execute, pending, error } = useAsyncAction();
  const statuses = state?.budgetStatuses ?? [];

  // Offer the cost owners we already know about, plus free entry.
  const knownOwners = useMemo(() => {
    const owners = new Set<string>();
    state?.ledgerSummary?.byCostOwner?.forEach((o) => owners.add(o.costOwner));
    state?.agents?.forEach((a) => a.economics?.costOwner && owners.add(a.economics.costOwner));
    statuses.forEach((s) => owners.add(s.costOwner));
    return [...owners].filter((o) => o && o !== "unknown");
  }, [state, statuses]);

  const [costOwner, setCostOwner] = useState("usr_local");
  const [limit, setLimit] = useState("1.00");
  const [policy, setPolicy] = useState("require_approval");

  function save() {
    const limitUsd = Number(limit);
    if (!costOwner.trim() || !Number.isFinite(limitUsd)) return;
    void execute(() => api.setBudget({ costOwner: costOwner.trim(), limitUsd, policy }));
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Budget pools</CardTitle>
        <p className="text-sm text-muted-foreground">
          Cap a cost owner's metered spend. Over budget, the policy decides: warn, require approval, or block new runs.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {statuses.length === 0 ? (
          <EmptyState title="No budgets set" hint="Set a budget below to enforce spend limits." />
        ) : (
          <div className="space-y-2">
            {statuses.map((status) => (
              <BudgetRow key={status.costOwner} status={status} />
            ))}
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto_auto] sm:items-end">
          <Field label="Cost owner">
            <Input
              list="budget-owners"
              value={costOwner}
              onChange={(e) => setCostOwner(e.target.value)}
            />
            <datalist id="budget-owners">
              {knownOwners.map((o) => (
                <option key={o} value={o} />
              ))}
            </datalist>
          </Field>
          <Field label="Limit (USD)">
            <Input
              type="number"
              min="0"
              step="0.01"
              value={limit}
              onChange={(e) => setLimit(e.target.value)}
              className="w-28"
            />
          </Field>
          <Field label="Policy">
            <Select value={policy} onChange={(e) => setPolicy(e.target.value)}>
              <option value="warn">Warn</option>
              <option value="require_approval">Require approval</option>
              <option value="block">Block</option>
            </Select>
          </Field>
          <Button disabled={pending} onClick={save}>
            Set budget
          </Button>
        </div>
        {error ? <p className="text-xs text-destructive">{error}</p> : null}
      </CardContent>
    </Card>
  );
}

function BudgetRow({ status }: { status: BudgetStatus }) {
  const limit = status.limitUsd ?? 0;
  const pct = limit > 0 ? Math.min(100, (status.spentUsd / limit) * 100) : status.spentUsd > 0 ? 100 : 0;
  const tone = status.over ? "danger" : pct > 80 ? "warning" : "success";
  return (
    <div className="rounded-lg border border-border px-3 py-2.5">
      <div className="flex items-center justify-between gap-3 text-sm">
        <span className="font-medium">{status.costOwner}</span>
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
          Includes ~{usd(status.estimatedUsd)} token-estimated spend.
        </p>
      ) : null}
      {status.over ? (
        <p className="mt-1 text-xs text-destructive">
          Over budget — new runs are {status.policy === "block" ? "blocked" : status.policy === "require_approval" ? "held for approval" : "allowed with a warning"}.
        </p>
      ) : null}
    </div>
  );
}
