import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { useAsyncAction } from "@/data/use-console-actions";
import { useVisibleInterval } from "@/hooks/use-visible-interval";
import { usePageNavigation } from "@/hooks/use-page-navigation";
import { RoutineWorkPanel } from "./routine-work-panel";
import {
  routineWorkApi,
  routineRecoveryMessage,
  useRoutineWorkLabels,
  type LedgerUpsertPreview,
  type RoutineWorkExecution,
} from "./routine-workflow";

export default function RoutineWorkController({
  workItemId,
  onChanged,
}: {
  workItemId: string;
  onChanged: () => void;
}) {
  const { execute, pending, error } = useAsyncAction();
  const navigate = usePageNavigation();
  const text = useRoutineWorkLabels();
  const [execution, setExecution] = useState<RoutineWorkExecution | null>(null);
  const [ledgerPreviews, setLedgerPreviews] = useState<Record<string, LedgerUpsertPreview>>({});

  const refresh = async () => {
    const result = await routineWorkApi.get(workItemId);
    let nextExecution = result.execution;
    if (nextExecution.recovery?.kind === "retry_after_source_review") {
      try {
        const resumed = await routineWorkApi.resumeRecovery(workItemId, nextExecution.run.revision);
        nextExecution = resumed.execution;
        if (resumed.resumed) onChanged();
      } catch {
        // The recovery intent is persisted by the service. A later refresh can
        // safely try again without relying on this browser session.
      }
    }
    setExecution(nextExecution);
    const previews = await routineWorkApi.listLedgerPreviews(nextExecution.run.id);
    setLedgerPreviews(Object.fromEntries(
      previews.previews
        .filter((preview) => preview.routineStepKey)
        .map((preview) => [preview.routineStepKey!, preview]),
    ));
  };

  useEffect(() => {
    setExecution(null);
    setLedgerPreviews({});
    void refresh().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workItemId]);

  useVisibleInterval(() => {
    if (!execution || ["succeeded", "cancelled"].includes(execution.run.status)) return;
    void refresh().catch(() => {});
  }, 1_500, Boolean(execution));

  const run = (
    action: () => Promise<{ execution: RoutineWorkExecution; childWorkItem?: { id: string } | null }>,
  ) => {
    let nextExecution: RoutineWorkExecution | null = null;
    void execute(async () => {
      const result = await action();
      nextExecution = result.execution;
      return result;
    }).then((ok) => {
      if (!ok || !nextExecution) return;
      setExecution(nextExecution);
      onChanged();
    });
  };

  if (!execution) return null;
  const previewLedger = (stepKey: string, ledgerDefinitionId: string) => {
    let preview: LedgerUpsertPreview | null = null;
    void execute(async () => {
      const result = await routineWorkApi.previewLedger(ledgerDefinitionId, execution.run.id, stepKey);
      preview = result.preview;
      return result;
    }).then((ok) => {
      if (ok && preview) setLedgerPreviews((current) => ({ ...current, [stepKey]: preview! }));
    });
  };
  const commitLedger = (stepKey: string, preview: LedgerUpsertPreview) => {
    let nextExecution: RoutineWorkExecution | null = null;
    void execute(async () => {
      const result = await routineWorkApi.commitLedger(preview.id, preview.revision);
      nextExecution = result.execution;
      return result;
    }).then((ok) => {
      if (!ok) return;
      setLedgerPreviews((current) => {
        const next = { ...current };
        delete next[stepKey];
        return next;
      });
      if (nextExecution) setExecution(nextExecution);
      else void refresh().catch(() => {});
      onChanged();
    });
  };
  const bindLedger = (stepKey: string, ledgerDefinitionId: string) => {
    let nextExecution: RoutineWorkExecution | null = null;
    let preview: LedgerUpsertPreview | null = null;
    void execute(async () => {
      const bound = await routineWorkApi.bindLedger(
        workItemId,
        stepKey,
        execution.run.revision,
        ledgerDefinitionId,
      );
      nextExecution = bound.execution;
      const previewed = await routineWorkApi.previewLedger(
        ledgerDefinitionId,
        bound.execution.run.id,
        stepKey,
      );
      preview = previewed.preview;
      return previewed;
    }).then((ok) => {
      if (nextExecution) {
        setExecution(nextExecution);
        onChanged();
      }
      if (ok && preview) {
        setLedgerPreviews((current) => ({ ...current, [stepKey]: preview! }));
      }
    });
  };
  const navigateToWorkflowMemory = (anchor: "workflow-file-review" | "workflow-routine-library") => {
    const url = new URL(window.location.href);
    url.searchParams.set("section", "workflowMemory");
    url.searchParams.set("returnWorkItemId", workItemId);
    if (execution.sourceId) url.searchParams.set("sourceId", execution.sourceId);
    url.hash = anchor;
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
    navigate("workflowMemory");
    window.requestAnimationFrame?.(() => {
      document.getElementById(anchor)?.scrollIntoView?.({ behavior: "smooth", block: "start" });
    });
  };
  const openWorkflowMemory = (
    anchor: "workflow-file-review" | "workflow-routine-library",
    reviewStepKey?: string,
  ) => {
    if (!reviewStepKey) {
      navigateToWorkflowMemory(anchor);
      return;
    }
    let prepared: RoutineWorkExecution | null = null;
    void execute(async () => {
      const result = await routineWorkApi.requestSourceReview(
        workItemId,
        reviewStepKey,
        execution.run.revision,
      );
      prepared = result.execution;
      return result;
    }).then((ok) => {
      if (!ok || !prepared) return;
      setExecution(prepared);
      navigateToWorkflowMemory(anchor);
    });
  };
  return (
    <>
      <RoutineWorkPanel
        execution={execution}
        pending={pending}
        ledgerPreviews={ledgerPreviews}
        onStart={() => run(() => routineWorkApi.start(workItemId, execution.run.revision))}
        onCancel={() => run(() => routineWorkApi.cancel(workItemId, execution.run.revision))}
        onExecute={(stepKey) => run(() =>
          routineWorkApi.executeStep(workItemId, stepKey, execution.run.revision))}
        onQuotationInputs={(stepKey, templateArtifactId, answers) => run(() =>
          routineWorkApi.confirmQuotationInputs(
            workItemId,
            stepKey,
            execution.run.revision,
            templateArtifactId,
            answers,
          ))}
        onComplete={(stepKey) => run(() =>
          routineWorkApi.complete(workItemId, stepKey, execution.run.revision))}
        onPreviewLedger={previewLedger}
        onCommitLedger={commitLedger}
        onBindLedger={bindLedger}
        onRetry={(stepKey) => run(() =>
          routineWorkApi.retry(workItemId, stepKey, execution.run.revision))}
        onApproval={(stepKey, approved) => run(() =>
          routineWorkApi.approve(workItemId, stepKey, execution.run.revision, approved))}
        onCondition={(stepKey, outcome, triggerArtifactIds) => run(() =>
          routineWorkApi.condition(
            workItemId,
            stepKey,
            execution.run.revision,
            outcome,
            triggerArtifactIds,
          ))}
        onOpenWorkflowMemory={openWorkflowMemory}
      />
      {error ? (
        <div className="mt-2 rounded-md border border-destructive/40 bg-destructive/5 p-3" role="alert">
          <p className="text-sm text-destructive">{routineRecoveryMessage(error, text)}</p>
          <details className="mt-2 text-xs text-muted-foreground">
            <summary className="cursor-pointer">{error}</summary>
          </details>
          <Button className="mt-2" size="sm" variant="secondary" disabled={pending}
            onClick={() => void refresh().catch(() => {})}>
            {text.refreshAction}
          </Button>
        </div>
      ) : null}
    </>
  );
}
