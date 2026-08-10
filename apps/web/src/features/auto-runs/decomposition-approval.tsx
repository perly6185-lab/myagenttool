import { useState } from "react";
import { Check, Loader2, MessageSquareX, GitFork } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { api, useAsyncAction } from "@/data/use-console-actions";
import type { AutoRunRecord } from "./auto-run-model";
import { useAppTranslation } from "@/lib/i18n/use-app-translation";

// Epic S3 (EPIC_DECOMPOSITION_PLAN.md): the human gate on a proposed decomposition.
// Approve spawns the N governed child issues (the click IS the authorization);
// request-changes posts feedback back to the epic. Both audited server-side. The
// children are never auto-implemented — a human still labels each `auto`.
export function DecompositionApproval({ run, onDone }: { run: AutoRunRecord; onDone: () => Promise<void> | void }) {
  const { t } = useAppTranslation();
  const [rejecting, setRejecting] = useState(false);
  const [feedback, setFeedback] = useState("");
  const { execute, pending, error } = useAsyncAction();

  const approval = run.decompositionApproval;
  if (approval?.status === "approved") {
    return (
      <Badge tone="success" title={`approved by ${approval.by ?? "?"}`}>
        {t("autoRunActions.childrenCreated", { count: run.childIssues?.length ?? approval.created ?? 0 })}
      </Badge>
    );
  }
  if (approval?.status === "rejected") {
    return <Badge tone="warning" title={approval.feedback ?? undefined}>{t("autoRunActions.changesRequested")}</Badge>;
  }

  const plan = run.decompositionPlan;
  const children = plan?.tree?.issues ?? [];
  const blocking = plan?.failures ?? [];
  const overlaps = plan?.overlap?.flagged ?? [];

  const act = async (action: "approve" | "reject") => {
    const ok = await execute(() => api.decompositionApproval(run.id, action, action === "reject" ? feedback : undefined));
    if (ok) {
      setRejecting(false);
      setFeedback("");
      void onDone();
    }
  };

  return (
    <div className="flex w-full flex-col gap-1.5 rounded-lg border border-border bg-muted/30 p-2">
      <span className="flex items-center gap-1 text-xs font-medium text-foreground/80">
        <GitFork className="size-3.5" /> {t("autoRunActions.proposedDecomposition", { count: children.length })}
      </span>
      {children.length ? (
        <ol className="ml-4 list-decimal text-[11px] text-muted-foreground">
          {children.map((c, i) => (
            <li key={i} className="truncate" title={c.title}>{c.title}</li>
          ))}
        </ol>
      ) : (
        <span className="text-[11px] text-amber-600 dark:text-amber-400">{t("autoRunActions.noChildren")}</span>
      )}
      {blocking.length ? (
        <p className="rounded-md border border-amber-500/40 bg-amber-500/5 px-2 py-1 text-[11px] text-amber-700 dark:text-amber-300">
          {t("autoRunActions.governanceIssues", { count: blocking.length })}
        </p>
      ) : null}
      {overlaps.length ? (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/5 px-2 py-1 text-[11px] text-amber-700 dark:text-amber-300">
          <span className="font-medium">{t("autoRunActions.possibleOverlap")}</span> — {t("autoRunActions.overlapHint")}:
          <ul className="ml-3 list-disc">
            {overlaps.slice(0, 3).map((p, i) => (
              <li key={i}>#{p.a + 1} ↔ #{p.b + 1} ({Math.round(p.score * 100)}%)</li>
            ))}
          </ul>
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-1.5">
        <Button
          variant="primary" size="sm" className="h-6 px-2 text-xs"
          disabled={pending || !children.length || blocking.length > 0}
          onClick={() => void act("approve")}
          title={t(blocking.length ? "autoRunActions.resolveGovernance" : "autoRunActions.approveChildrenHint")}
        >
          {pending && !rejecting ? <Loader2 className="mr-1 size-3 animate-spin" /> : <Check className="mr-1 size-3" />} {t("autoRunActions.approveCreate", { count: children.length })}
        </Button>
        <Button variant="secondary" size="sm" className="h-6 px-2 text-xs" disabled={pending} onClick={() => setRejecting((v) => !v)}
          title={t("autoRunActions.requestEpicChangesHint")}>
          <MessageSquareX className="mr-1 size-3" /> {t("autoRunActions.requestChanges")}
        </Button>
      </div>
      {rejecting ? (
        <div className="flex flex-col gap-1">
          <textarea
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            rows={2}
            placeholder={t("autoRunActions.breakdownFeedback")}
            className="rounded-md border border-border bg-background px-2 py-1 text-xs"
          />
          <Button variant="secondary" size="sm" className="h-6 self-start px-2 text-xs" disabled={pending} onClick={() => void act("reject")}>
            {pending ? <Loader2 className="mr-1 size-3 animate-spin" /> : null} {t("autoRunActions.sendFeedback")}
          </Button>
        </div>
      ) : null}
      {error ? <p className="text-xs text-red-600 dark:text-red-400">{error}</p> : null}
    </div>
  );
}
