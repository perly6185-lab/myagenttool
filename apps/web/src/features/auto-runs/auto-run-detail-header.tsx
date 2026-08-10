import { ExternalLink, GitBranch, GitPullRequest, Rocket, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useAppTranslation } from "@/lib/i18n/use-app-translation";
import { AutoRunTraceLinks } from "./auto-run-artifacts";
import { AutoRunMergeControl } from "./auto-run-merge-control";
import { statusTone, type AutoRunAttempt, type AutoRunRecord } from "./auto-run-model";
import { AutoRunRoutingFeedback, AutoRunStepper, hasDevelopStepper } from "./auto-run-runtime";

interface AutoRunDetailHeaderProps {
  run: AutoRunRecord;
  attempt?: AutoRunAttempt;
  onReload: (refresh?: boolean, quiet?: boolean) => Promise<void>;
}

export function AutoRunDetailHeader({ run, attempt, onReload }: AutoRunDetailHeaderProps) {
  const { t } = useAppTranslation();

  return (
    <>
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <Badge tone={statusTone(run.status)}>
            {run.status === "done" ? t("executionUi.done") : t(`autoRuns.status.${run.status}` as never, { defaultValue: run.status })}
          </Badge>
          {attempt && attempt.total > 1 ? (
            <Badge tone="neutral">{t("executionUi.attempt", { attempt: attempt.attempt, total: attempt.total })}</Badge>
          ) : null}
          {run.promptInjection?.suspicious ? (
            <Badge tone="danger" title={t("autoRuns.injectionHint", { markers: run.promptInjection.markers.join(", ") })}>
              {t("autoRuns.injection")}
            </Badge>
          ) : null}
          {run.link ? (
            <span className="truncate text-sm font-medium">
              {run.link.type === "pr" ? "PR" : "Issue"} #{run.link.number}: {run.link.title}
            </span>
          ) : (
            <span className="truncate text-sm text-muted-foreground">{run.id}</span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {run.prUrl ? (
            <a href={run.prUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
              <GitPullRequest className="size-3.5" /> PR #{run.prNumber}
            </a>
          ) : null}
          {run.prState === "MERGED" ? <Badge tone="success">{t("autoRuns.merged")}</Badge> : null}
          {run.deployment ? (
            <Badge
              tone={run.deployment.status === "deployed" ? "success" : run.deployment.status === "rolled_back" ? "warning" : "danger"}
              title={[run.deployment.summary, run.deployment.at].filter(Boolean).join(" · ") || undefined}
            >
              {t(`autoRuns.deployment.${run.deployment.status}` as never)}
            </Badge>
          ) : null}
          {run.remediationIssue ? (
            run.remediationIssue.url ? (
              <a
                href={run.remediationIssue.url}
                target="_blank"
                rel="noreferrer"
                title={run.remediationIssue.culpritPr ? `Fix-forward remediation for the failed deploy of PR #${run.remediationIssue.culpritPr}` : "Remediation issue for the failed deploy"}
              >
                <Badge tone="warning">
                  <Rocket className="mr-1 size-3" /> remediating #{run.remediationIssue.number}
                </Badge>
              </a>
            ) : (
              <Badge tone="warning" title={run.remediationIssue.culpritPr ? `Fix-forward for PR #${run.remediationIssue.culpritPr}` : undefined}>
                <Rocket className="mr-1 size-3" /> remediating #{run.remediationIssue.number}
              </Badge>
            )
          ) : null}
          {run.prState === "CLOSED" ? <Badge tone="warning">{t("autoRuns.closed")}</Badge> : null}
          {run.prNumber && run.status === "pr_open" && run.prState !== "MERGED" && run.prState !== "CLOSED" ? (
            <AutoRunMergeControl run={run} onDone={onReload} />
          ) : null}
          {(run.childIssues ?? []).map((child) => child.url ? (
            <a key={child.number} href={child.url} target="_blank" rel="noreferrer" className="text-xs text-primary hover:underline" title={t("autoRunLinks.pendingDecisionIssue")}>
              → #{child.number}
            </a>
          ) : (
            <span key={child.number} className="text-xs text-muted-foreground">→ #{child.number}</span>
          ))}
          {run.link?.url ? (
            <a href={run.link.url} target="_blank" rel="noreferrer" className="text-muted-foreground hover:text-foreground" title={t("autoRunLinks.openGithub")}>
              <ExternalLink className="size-4" />
            </a>
          ) : null}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {hasDevelopStepper(run.status) ? <AutoRunStepper status={run.status} /> : null}
        {run.decision ? (
          <span
            className="rounded bg-muted px-1.5 py-0.5 font-medium"
            title={`${run.decision.rationale ?? ""} (${run.decision.via ? `${run.decision.via}, ` : ""}by ${run.decision.decidedBy}, confidence ${Math.round((run.decision.confidence ?? 0) * 100)}%)`}
          >
            {run.decision.path}
            {run.decision.via ? <span className="ml-1 font-normal text-muted-foreground">· {run.decision.via}</span> : null}
          </span>
        ) : null}
        {run.decision ? <AutoRunRoutingFeedback run={run} onSaved={() => void onReload()} /> : null}
        {run.branchName ? (
          <span className="inline-flex items-center gap-1"><GitBranch className="size-3" /> {run.branchName}</span>
        ) : null}
        {run.phase || run.executionStage ? (
          <span
            className="rounded bg-muted px-1.5 py-0.5"
            title={`Turn budget ${run.executionBudget?.turnTimeoutSeconds ?? "?"}s · total budget ${run.executionBudget?.totalBudgetSeconds ?? "?"}s · no-progress streak ${run.executionBudget?.noProgressStreak ?? 0}`}
          >
            {t("executionUi.stage")}: {run.phase
              ? t(`executionUi.phase.${run.phase}`)
              : run.executionStage === "analysis"
                ? t("executionUi.analysis")
                : run.executionStage === "implementation"
                  ? t("executionUi.implementation")
                  : run.executionStage === "verification"
                    ? t("executionUi.verification")
                    : run.executionStage}
            {(run.timeoutRecoveryAttempts ?? 0) > 0 ? ` · ${t("executionUi.continuation", { count: run.timeoutRecoveryAttempts ?? 0 })}` : ""}
            {Number.isFinite(run.executionBudget?.elapsedSeconds)
              ? ` · ${t("executionUi.elapsed", { seconds: run.executionBudget?.elapsedSeconds ?? 0 })}`
              : ""}
          </span>
        ) : null}
        {run.agentId ? <span>{t("executionUi.agent")}: {run.agentId}</span> : null}
        {run.capacityRetry?.status === "scheduled" ? (
          <span className="rounded bg-amber-500/10 px-1.5 py-0.5 text-amber-700 dark:text-amber-300" title={run.capacityRetry.lastError ?? undefined}>
            容量等待 · 自动重试 {run.capacityRetry.attempt ?? "?"}/{run.capacityRetry.maxAttempts ?? "?"}
            {run.capacityRetry.retryAt ? ` · ${new Date(run.capacityRetry.retryAt).toLocaleTimeString()}` : ""}
          </span>
        ) : null}
        {run.verification ? (
          <span className="inline-flex items-center gap-1">
            <ShieldCheck className="size-3" />
            {run.verification.verified ? (run.verification.passed ? "verified" : "check failed") : "unverified"}
          </span>
        ) : null}
        {run.status === "done" && (!run.verification?.verified || !run.verification?.passed) ? (
          <Badge tone="warning">完成但未验证</Badge>
        ) : null}
        {run.judgment ? (
          <span
            className="inline-flex items-center gap-1"
            title={`${run.judgment.summary ?? ""}${(run.judgment.gaps ?? []).map((gap) => `\n- ${gap}`).join("")}`}
          >
            ⚖ {run.judgment.solved === true ? "solves issue" : run.judgment.solved === false ? "does NOT solve issue" : "judge unavailable"}
          </span>
        ) : null}
        <AutoRunTraceLinks run={run} />
      </div>
    </>
  );
}
