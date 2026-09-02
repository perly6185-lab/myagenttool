import { useEffect, useState } from "react";
import { CheckCircle2, Database, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { api } from "@/data/use-console-actions";
import type { LocalWorkItem } from "./task-view-types";

type LedgerPostingPlanResponse = {
  plan: NonNullable<LocalWorkItem["ledgerPostingPlan"]>;
  preview: Record<string, unknown> | null;
  batchPreview: Record<string, unknown> | null;
};

export function WorkItemLedgerPostingPlan({
  item,
  language,
  canOperate,
}: {
  item: LocalWorkItem;
  language: string;
  canOperate: boolean;
}) {
  const [data, setData] = useState<LedgerPostingPlanResponse | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    if (!item.ledgerPostingPlanId) {
      setData(null);
      setError(null);
      return () => { active = false; };
    }
    void api.getWorkItemLedgerPostingPlan(item.id)
      .then((result) => {
        if (active) setData(result as LedgerPostingPlanResponse);
      })
      .catch(() => {
        if (active) setError(language === "zh" ? "台账变更计划暂时无法加载。" : "The ledger posting plan could not be loaded.");
      });
    return () => { active = false; };
  }, [item.id, item.ledgerPostingPlanId, item.revision, language]);

  if (!item.ledgerPostingPlanId && !error) return null;
  const plan = data?.plan ?? null;
  const preview = data?.preview ?? data?.batchPreview;
  const changedCells = Array.isArray(preview?.changedCells)
    ? preview.changedCells as Array<{ field?: string; before?: unknown; after?: unknown }>
    : [];
  const committed = plan?.status === "committed" || plan?.state === "committed";
  const invalidated = plan?.status === "invalidated" || plan?.state === "invalidated";

  const refresh = async () => {
    if (!plan || pending || !canOperate || !invalidated) return;
    setPending(true);
    setError(null);
    setNotice(null);
    try {
      const result = await api.prepareWorkItemLedgerPostingPlan(item.id, {
        expectedRevision: item.revision,
        primary: plan.primary,
        related: plan.related,
      });
      setData(result as LedgerPostingPlanResponse);
      setNotice(language === "zh"
        ? "已按当前任务修订重新检查拟写入内容，请核对新差异后重新审批。"
        : "The proposed write was checked against the current task revision. Review the fresh diff before approving.");
      window.dispatchEvent(new CustomEvent("myagenttool:state-change", { detail: { source: "task-ledger-posting-refreshed", workItemId: item.id } }));
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      setError(message.includes("revision")
        ? (language === "zh" ? "任务再次发生变化，请重新加载后生成方案。" : "The task changed again. Reload it before generating a fresh plan.")
        : (language === "zh" ? "暂时无法重新生成台账方案，请稍后重试。" : "A fresh ledger plan could not be generated. Try again later."));
    } finally {
      setPending(false);
    }
  };

  const commit = async () => {
    if (!plan || pending || !canOperate) return;
    setPending(true);
    setError(null);
    setNotice(null);
    try {
      const grant = await api.issueApprovalGrant("ledger_posting_plan_commit", plan.id);
      const result = await api.commitWorkItemLedgerPostingPlan(item.id, {
        planId: plan.id,
        expectedRevision: item.revision,
        approvalToken: grant.token,
      });
      setData((current) => current ? { ...current, plan: result.plan } : current);
      setNotice(language === "zh" ? "台账已写入，变更已记录。" : "The ledger was updated and the change was recorded.");
      window.dispatchEvent(new CustomEvent("myagenttool:state-change", { detail: { source: "task-ledger-posting-committed", workItemId: item.id } }));
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      const stale = message.includes("stale") || message.includes("revision");
      if (stale) {
        try {
          const latest = await api.getWorkItemLedgerPostingPlan(item.id);
          setData(latest as LedgerPostingPlanResponse);
        } catch { /* keep the current preview and recovery message */ }
      }
      setError(stale
        ? (language === "zh" ? "任务或资料已变化，旧审批已失效。请重新生成方案。" : "The task or materials changed, so the old approval is no longer valid. Generate a fresh plan.")
        : (language === "zh" ? "台账写入未完成，请检查最新状态后重新审批。" : "The ledger was not updated. Check the latest state before approving again."));
    } finally {
      setPending(false);
    }
  };

  return (
    <section className="rounded-xl border border-warning/40 bg-warning/[0.04] p-4" aria-labelledby={`work-item-ledger-plan-${item.id}`}>
      <div className="flex items-start gap-2">
        <Database className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
        <div className="min-w-0 flex-1">
          <h4 id={`work-item-ledger-plan-${item.id}`} className="text-sm font-semibold">{language === "zh" ? "台账变更审批" : "Ledger change approval"}</h4>
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
            {committed
              ? (language === "zh" ? "这项变更已经写入本地台账。" : "This change has been written to the local ledger.")
              : invalidated
                ? (language === "zh" ? "任务或资料已变化，旧方案和审批已失效。请基于当前资料重新生成。" : "The task or materials changed, so the old plan and approval are no longer valid. Generate a fresh plan from the current data.")
              : (language === "zh" ? "请先检查变更预览，再批准写入本地台账。" : "Review the change preview before approving the local ledger write.")}
          </p>
        </div>
        {plan ? <Badge tone={committed ? "success" : "warning"}>{committed ? (language === "zh" ? "已完成" : "Committed") : invalidated ? (language === "zh" ? "需刷新" : "Refresh required") : (language === "zh" ? "待审批" : "Pending approval")}</Badge> : null}
      </div>
      {!invalidated && changedCells.length ? (
        <div className="mt-3 overflow-x-auto rounded-lg border border-border bg-background">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-border text-muted-foreground"><tr><th className="px-3 py-2">{language === "zh" ? "字段" : "Field"}</th><th className="px-3 py-2">{language === "zh" ? "之前" : "Before"}</th><th className="px-3 py-2">{language === "zh" ? "之后" : "After"}</th></tr></thead>
            <tbody>{changedCells.slice(0, 50).map((cell, index) => <tr key={`${cell.field ?? "field"}-${index}`} className="border-b border-border last:border-0"><td className="px-3 py-2 font-medium">{cell.field ?? "—"}</td><td className="px-3 py-2">{String(cell.before ?? "—")}</td><td className="px-3 py-2">{String(cell.after ?? "—")}</td></tr>)}</tbody>
          </table>
        </div>
      ) : null}
      {!committed && plan && canOperate ? (
        <div className="mt-3 flex justify-end">
          {invalidated ? (
            <Button size="sm" disabled={pending} onClick={() => void refresh()}>
              <RefreshCw className={pending ? "animate-spin" : undefined} aria-hidden />
              {pending ? (language === "zh" ? "重新生成中…" : "Generating…") : (language === "zh" ? "刷新方案并重新审批" : "Refresh plan and review again")}
            </Button>
          ) : (
            <Button size="sm" disabled={pending} onClick={() => void commit()}><CheckCircle2 aria-hidden />{pending ? (language === "zh" ? "审批并写入中…" : "Approving and writing…") : (language === "zh" ? "审批并写入台账" : "Approve and write ledger")}</Button>
          )}
        </div>
      ) : null}
      {notice ? <p className="mt-2 text-sm text-success" role="status">{notice}</p> : null}
      {error ? <p className="mt-2 text-sm text-destructive" role="alert">{error}</p> : null}
    </section>
  );
}
