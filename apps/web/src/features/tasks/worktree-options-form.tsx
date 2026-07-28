import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Field } from "@/components/common/field";
import { useConsoleState } from "@/data/use-console-state";
import { api, useAsyncAction } from "@/data/use-console-actions";
import { useAppTranslation } from "@/lib/i18n/use-app-translation";
import { branchFromIssue, worktreeLinkFor } from "@/features/projects/worktree-payload";
import type { Row } from "./task-view-types";

export function WorktreeOptionsForm({ row, onDone }: {
  row: Row;
  onDone: (worktree: { id: string; projectId: string } | null) => void;
}) {
  const { t } = useAppTranslation();
  const { data: state } = useConsoleState();
  const { execute, pending, error } = useAsyncAction();
  const agents = state?.agents ?? [];
  const isPr = row.type === "pr";
  const [branch, setBranch] = useState(branchFromIssue(row));
  const [base, setBase] = useState("main");
  const [agentId, setAgentId] = useState(agents[0]?.id ?? "");
  const [suggesting, setSuggesting] = useState(false);

  async function suggest() {
    setSuggesting(true);
    try {
      const result = (await api.suggestWorktreeName(row.title)) as { name?: string };
      if (result.name) setBranch(result.name);
    } catch {
      // Retain the deterministic issue slug when AI suggestion is unavailable.
    } finally {
      setSuggesting(false);
    }
  }

  function create() {
    const link = worktreeLinkFor(row);
    const payload = isPr
      ? { prNumber: row.number, agentId: agentId || undefined, link }
      : { name: branch.trim() || branchFromIssue(row), startPoint: base.trim() || undefined, agentId: agentId || undefined, link };
    void execute(async () => {
      const result = (await api.createWorktree(row.projectId, payload)) as { worktree?: { id: string; projectId: string } };
      onDone(result.worktree ?? null);
      return result;
    });
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        {isPr ? (
          <>{t("tasks.checkoutPr", { number: row.number })}{row.headRefName ? <> (<span className="font-mono">{row.headRefName}</span>)</> : null}.</>
        ) : <>{t("tasks.createIssueBranch", { number: row.number })}</>}
      </p>
      {!isPr ? (
        <>
          <Field label={t("tasks.branchName")}>
            <div className="flex gap-2">
              <Input value={branch} onChange={(event) => setBranch(event.target.value)} className="font-mono" />
              <Button variant="secondary" size="sm" disabled={suggesting} onClick={suggest} title={t("tasks.suggestName")}>
                {t("tasks.suggest")}
              </Button>
            </div>
          </Field>
          <Field label={t("tasks.baseBranch")}>
            <Input value={base} onChange={(event) => setBase(event.target.value)} className="font-mono" placeholder="main" />
          </Field>
        </>
      ) : null}
      <Field label={t("tasks.agent")}>
        <Select value={agentId} onChange={(event) => setAgentId(event.target.value)}>
          {agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
        </Select>
      </Field>
      <div className="flex justify-end gap-2 pt-1">
        <Button variant="secondary" size="sm" disabled={pending} onClick={() => onDone(null)}>{t("tasks.cancel")}</Button>
        <Button size="sm" disabled={pending} onClick={create}>{t("tasks.createWorktree")}</Button>
      </div>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
