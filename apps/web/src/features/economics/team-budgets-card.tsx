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
        <CardTitle>Team budget pools</CardTitle>
        <p className="text-sm text-muted-foreground">
          A pool caps a team's summed spend across all of its projects. With a block policy, an
          over-budget team's projects reject new runs.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {rows.length === 0 ? (
          <EmptyState title="No team spend yet" hint="Team rollups appear once projects record spend." />
        ) : (
          <div className="space-y-2">
            {rows.map((row) => (
              <TeamBudgetRow key={row.teamId} row={row} />
            ))}
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto_auto] sm:items-end">
          <Field label="Team">
            <Select value={targetTeamId} onChange={(e) => setTeamId(e.target.value)}>
              {teams.map((team) => (
                <option key={team.id} value={team.id}>
                  {team.name ?? team.id}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Limit (USD)">
            <Input className="w-28" value={limit} onChange={(e) => setLimit(e.target.value)} inputMode="decimal" />
          </Field>
          <Field label="Policy">
            <Select value={policy} onChange={(e) => setPolicy(e.target.value)}>
              <option value="warn">Warn</option>
              <option value="block">Block</option>
            </Select>
          </Field>
          <Button onClick={save} disabled={pending || !targetTeamId}>
            {pending ? "Saving…" : "Set pool"}
          </Button>
        </div>
        {error ? <p className="text-xs text-destructive">{error}</p> : null}
      </CardContent>
    </Card>
  );
}

function TeamBudgetRow({ row }: { row: TeamBudgetStatus }) {
  const limit = row.limitUsd ?? 0;
  const pct = limit > 0 ? Math.min(100, (row.spentUsd / limit) * 100) : row.spentUsd > 0 ? 100 : 0;
  const tone = row.over ? "danger" : pct > 80 ? "warning" : "success";
  return (
    <div className="rounded-lg border border-border px-3 py-2.5">
      <div className="flex items-center justify-between gap-3 text-sm">
        <span className="font-medium">
          {row.teamName ?? row.teamId}
          <span className="ml-2 text-xs text-muted-foreground">{row.projectCount} project{row.projectCount === 1 ? "" : "s"}</span>
        </span>
        <div className="flex items-center gap-2">
          {row.exists ? (
            <Badge tone={row.over ? "danger" : "neutral"}>{POLICY_LABEL[row.policy] ?? row.policy}</Badge>
          ) : (
            <Badge tone="neutral">No pool</Badge>
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
          Over the team pool — new runs are {row.policy === "block" ? "blocked" : "allowed with a warning"}.
        </p>
      ) : null}
    </div>
  );
}
