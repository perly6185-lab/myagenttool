import { RefreshCw, ShieldCheck, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api } from "@/data/use-console-actions";
import { cn } from "@/lib/cn";
import { useAppTranslation } from "@/lib/i18n/use-app-translation";
import { autoRunApi } from "./auto-run-api";
import type { AutoRunRecord } from "./auto-run-model";

interface AutoRunActionsProps {
  run: AutoRunRecord;
  pending: boolean;
  onAction: (runId: string, action: () => Promise<unknown>) => Promise<void>;
}

export function canReverifyAutoRun(run: AutoRunRecord): boolean {
  return (["done", "pr_open"].includes(run.status) && !run.verification?.verified)
    || (run.status === "blocked" && Boolean(run.verification?.verified))
    || (run.status === "cancelled" && Boolean(run.verification));
}

export function canCancelAutoRun(status: string): boolean {
  return ["materializing", "running", "waiting_capacity", "verifying", "publishing", "needs_input"].includes(status);
}

export function AutoRunActions({ run, pending, onAction }: AutoRunActionsProps) {
  const { t } = useAppTranslation();

  return (
    <>
      {run.status === "failed" || run.status === "blocked" ? (
        <div>
          <Button
            variant="secondary"
            size="sm"
            disabled={pending}
            onClick={() => void onAction(run.id, () => api.retryAutoRun(run.id))}
            title={t("autoRuns.retryHint")}
          >
            <RefreshCw className={cn("mr-1 size-3", pending && "animate-spin")} /> {t("autoRuns.retry")}
          </Button>
        </div>
      ) : null}

      {canReverifyAutoRun(run) ? (
        <div>
          <Button
            variant="secondary"
            size="sm"
            disabled={pending}
            onClick={() => void onAction(run.id, () => autoRunApi.reverify(run.id))}
            title="Run the platform-owned verification checks in this task's worktree."
          >
            <ShieldCheck className={cn("mr-1 size-3", pending && "animate-pulse")} />
            重新验证
          </Button>
        </div>
      ) : null}

      {canCancelAutoRun(run.status) ? (
        <div>
          <Button
            variant="secondary"
            size="sm"
            disabled={pending}
            onClick={() => {
              if (!window.confirm("Cancel this run? The running agent is stopped and the run is marked cancelled (its worktree is kept).")) return;
              void onAction(run.id, () => api.cancelAutoRun(run.id));
            }}
            title={t("autoRuns.cancelHint")}
          >
            <X className="mr-1 size-3" /> {t("autoRuns.cancel")}
          </Button>
        </div>
      ) : null}

      {run.status === "awaiting_approval" && run.pendingApproval ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-500/40 bg-amber-500/5 px-3 py-2">
          <span className="text-xs text-muted-foreground">
            {t("autoRuns.needsApproval")}
            {run.pendingApproval.riskLevel ? ` · risk: ${run.pendingApproval.riskLevel}` : ""}
            {run.pendingApproval.riskTags.length ? ` (${run.pendingApproval.riskTags.join(", ")})` : ""}. The {run.decision?.path ?? "develop"} agent will edit code for this issue.
          </span>
          <div className="flex shrink-0 gap-2">
            <Button
              size="sm"
              variant="primary"
              className="h-6 px-2 text-xs"
              disabled={pending}
              onClick={() => void onAction(run.id, () => api.approveApproval(run.pendingApproval!.id))}
              title={t("autoRuns.approveHint")}
            >
              {t("autoRuns.approve")}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              className="h-6 px-2 text-xs"
              disabled={pending}
              onClick={() => {
                if (!window.confirm("Deny this run? The agent will be blocked.")) return;
                void onAction(run.id, () => api.denyApproval(run.pendingApproval!.id));
              }}
              title={t("autoRuns.denyHint")}
            >
              {t("autoRuns.deny")}
            </Button>
          </div>
        </div>
      ) : null}
    </>
  );
}
