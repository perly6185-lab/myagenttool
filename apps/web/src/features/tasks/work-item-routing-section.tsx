import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useAppTranslation } from "@/lib/i18n/use-app-translation";
import { statusTone } from "@/lib/readable-labels";
import type { LocalWorkItemAutoRun, LocalWorkItemObservability } from "./task-view-types";

type SuggestedAction = NonNullable<NonNullable<LocalWorkItemAutoRun["decision"]>["suggestedActions"]>[number];

export function WorkItemRoutingSection({
  run,
  observability,
  pending,
  onAnswer,
  onOpen,
}: {
  run: LocalWorkItemAutoRun;
  observability: LocalWorkItemObservability | null;
  pending: boolean;
  onAnswer: (action: SuggestedAction) => Promise<void>;
  onOpen: () => void;
}) {
  const { t } = useAppTranslation();
  const decision = run.decision;
  if (!decision) return null;
  const estimate = observability?.estimate;

  return (
    <section className="space-y-2 rounded-md border border-border p-3 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold">{t("taskCockpit.routingTitle")}</h3>
        <Badge tone={decision.confidence < 0.6 ? "warning" : "success"}>{decision.path}</Badge>
        <span>{Math.round(decision.confidence * 100)}%</span>
        <span className="text-muted-foreground">{decision.via ?? decision.decidedBy}</span>
        {decision.latencyMs != null ? <span className="text-muted-foreground">{decision.latencyMs} ms</span> : null}
      </div>
      {decision.rationale ? <p className="whitespace-pre-wrap">{decision.rationale}</p> : null}
      {decision.evidence ? (
        <p className="font-mono text-[10px] text-muted-foreground">
          {t("executionUi.routingEvidence.policy", { version: decision.evidence.policyVersion })}
          {decision.evidence.modelVersion ? ` · ${t("executionUi.routingEvidence.model", { version: decision.evidence.modelVersion })}` : ""}
          {` · ${t("executionUi.routingEvidence.input", { digest: decision.evidence.inputDigest.slice(0, 12) })}`}
        </p>
      ) : null}
      {(decision.clarifyingQuestions ?? []).length ? (
        <ul className="list-inside list-disc text-muted-foreground">
          {decision.clarifyingQuestions?.map((question) => <li key={question}>{question}</li>)}
        </ul>
      ) : null}
      {(decision.suggestedActions ?? []).length ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {decision.suggestedActions?.map((action) => (
            <Button key={action.id} variant={action.id === "evaluate" ? "primary" : "secondary"} size="sm" disabled={pending} onClick={() => void onAnswer(action)}>
              {action.label}
            </Button>
          ))}
        </div>
      ) : null}
      {observability?.routingExplanation ? (
        <details>
          <summary className="cursor-pointer font-semibold">{t("aiOps.whyRoute")}</summary>
          <div className="mt-2 space-y-1">
            {observability.routingExplanation.humanCorrection ? (
              <p className="rounded bg-muted p-2 font-semibold">
                {t("executionUi.routingEvidence.humanCorrection", {
                  path: observability.routingExplanation.humanCorrection.actualPath,
                  reason: observability.routingExplanation.humanCorrection.reason,
                })}
              </p>
            ) : null}
            {observability.routingExplanation.candidates.map((candidate) => (
              <p key={candidate.path} className={candidate.selected ? "font-semibold" : "text-muted-foreground"}>
                {candidate.path}{candidate.score != null ? ` ${Math.round(candidate.score * 100)}%` : ""}: {candidate.reason}
              </p>
            ))}
          </div>
        </details>
      ) : null}
      {estimate ? (
        <p className="text-muted-foreground">
          {estimate.remainingMs != null
            ? t("executionUi.routingEvidence.estimatedRemaining", { minutes: Math.ceil(estimate.remainingMs / 60_000) })
            : t("aiOps.estimateUnavailable")}
          {` · ${t("executionUi.routingEvidence.estimateDetails", {
            confidence: t(`executionUi.routingEvidence.confidence.${estimate.confidence}` as never, { defaultValue: estimate.confidence }),
            count: estimate.sampleCount,
          })}`}
          {estimate.p90DurationMs != null ? ` · ${t("executionUi.routingEvidence.p90", { minutes: Math.ceil(estimate.p90DurationMs / 60_000) })}` : ""}
          {estimate.calibrationMaeMs != null ? ` · ${t("executionUi.routingEvidence.historicalMae", { minutes: Math.ceil(estimate.calibrationMaeMs / 60_000) })}` : ""}
        </p>
      ) : null}
      <div className="flex items-center gap-2">
        <Badge tone={statusTone(run.status)}>{t(`autoRuns.status.${run.status}` as never, { defaultValue: run.status })}</Badge>
        {run.terminalOutcome ? <span>{t("executionUi.routingEvidence.terminalOutcome", {
          disposition: run.terminalOutcome.disposition,
          source: run.terminalOutcome.source,
        })}</span> : null}
        <Button className="ml-auto" variant="secondary" size="sm" onClick={onOpen}>{t("taskCockpit.openAutoRuns")}</Button>
      </div>
    </section>
  );
}
