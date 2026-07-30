import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { useAsyncAction } from "@/data/use-console-actions";
import { useVisibleInterval } from "@/hooks/use-visible-interval";
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
  const text = useRoutineWorkLabels();
  const [execution, setExecution] = useState<RoutineWorkExecution | null>(null);
  const [ledgerPreviews, setLedgerPreviews] = useState<Record<string, LedgerUpsertPreview>>({});

  const refresh = async () => {
    const result = await routineWorkApi.get(workItemId);
    setExecution(result.execution);
    const previews = await routineWorkApi.listLedgerPreviews(result.execution.run.id);
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
