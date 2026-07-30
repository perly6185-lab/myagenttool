import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { cn } from "@/lib/cn";
import {
  useRoutineWorkLabels,
  type LedgerUpsertPreview,
  type RoutineWorkExecution,
  type RoutineStepState,
} from "./routine-workflow";

type RoutineAction = () => void;
type RoutineStepAction = (stepKey: string) => void;

const terminalRunStates = new Set(["succeeded", "cancelled"]);

function stateTone(state: RoutineStepState) {
  if (state === "succeeded") return "success";
  if (state === "failed") return "danger";
  if (state === "running") return "running";
  if (state === "awaiting_approval" || state === "awaiting_condition") return "warning";
  return "neutral";
}

function needsConfirmedOrder(step: RoutineWorkExecution["steps"][number]) {
  return /order/i.test(`${step.key} ${step.label} ${String(step.configuration.condition ?? "")}`);
}

export function RoutineWorkPanel({
  execution,
  pending,
  ledgerPreviews,
  onStart,
  onCancel,
  onComplete,
  onPreviewLedger,
  onCommitLedger,
  onRetry,
  onApproval,
  onCondition,
}: {
  execution: RoutineWorkExecution;
  pending: boolean;
  ledgerPreviews: Record<string, LedgerUpsertPreview>;
  onStart: RoutineAction;
  onCancel: RoutineAction;
  onComplete: RoutineStepAction;
  onPreviewLedger: (stepKey: string, ledgerDefinitionId: string) => void;
  onCommitLedger: (stepKey: string, preview: LedgerUpsertPreview) => void;
  onRetry: RoutineStepAction;
  onApproval: (stepKey: string, approved: boolean) => void;
  onCondition: (stepKey: string, outcome: boolean, triggerArtifactIds: string[]) => void;
}) {
  const text = useRoutineWorkLabels();
  const [selectedOrderArtifactId, setSelectedOrderArtifactId] = useState("");
  const [confirmation, setConfirmation] = useState<{
    type: "ledger" | "approval";
    stepKey: string;
  } | null>(null);
  const active = !terminalRunStates.has(execution.run.status);
  const conditionStep = execution.steps.find((step) => step.run.state === "awaiting_condition");
  const orderRequired = conditionStep ? needsConfirmedOrder(conditionStep) : false;
  const completedCount = execution.steps.filter(
    (step) => step.run.state === "succeeded" || step.run.state === "skipped",
  ).length;
  const progress = useMemo(
    () => Math.round((completedCount / Math.max(execution.steps.length, 1)) * 100),
    [completedCount, execution.steps.length],
  );

  useEffect(() => {
    if (selectedOrderArtifactId
      && !execution.availableOrderTriggers.some((entry) => entry.artifactId === selectedOrderArtifactId)) {
      setSelectedOrderArtifactId("");
    }
  }, [execution.availableOrderTriggers, selectedOrderArtifactId]);

  return (
    <section className="scroll-mt-12 rounded-md border border-border p-3" aria-labelledby="routine-work-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 id="routine-work-title" className="text-sm font-semibold">{text.title}</h3>
          <p className="text-xs text-muted-foreground">
            {execution.definition.name} · {text.version} {execution.definition.version}
          </p>
        </div>
        {execution.run.status === "planned" ? (
          <Button disabled={pending} onClick={onStart}>
            {execution.run.waitingReason ? text.continueAction : text.primaryAction}
          </Button>
        ) : active ? (
          <Button variant="secondary" disabled={pending} onClick={onCancel}>{text.cancel}</Button>
        ) : (
          <Badge tone={execution.run.status === "succeeded" ? "success" : "neutral"}>
            {text.states[execution.run.status]}
          </Badge>
        )}
      </div>

      <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted" role="progressbar"
        aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}>
        <div className="h-full bg-primary transition-[width] motion-reduce:transition-none" style={{ width: `${progress}%` }} />
      </div>
      <p className="mt-1 text-xs text-muted-foreground">{completedCount}/{execution.steps.length} · {progress}%</p>
      {execution.run.waitingReason ? (
        <p className="mt-2 rounded bg-muted p-2 text-xs text-muted-foreground">
          {execution.run.waitingReason === "device_capacity"
            ? text.waitingCapacity
            : execution.run.waitingReason === "routine_step_interrupted"
              ? text.interruptedRecovery
              : execution.run.waitingReason}
        </p>
      ) : null}

      <ol className="mt-3 space-y-2">
        {execution.steps.map((step, index) => {
          const ledgerDefinitionId = typeof step.configuration.ledgerDefinitionId === "string"
            ? step.configuration.ledgerDefinitionId
            : null;
          const ledgerPreview = ledgerPreviews[step.key];
          return (
          <li key={step.key} className={cn(
            "rounded-md border p-3",
            ["running", "awaiting_approval", "awaiting_condition"].includes(step.run.state)
              ? "border-primary/40 bg-primary/5"
              : "border-border",
          )}>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="text-sm font-medium">{index + 1}. {step.label}</p>
                <p className="text-xs text-muted-foreground">
                  {step.required ? text.required : text.conditional}
                  {step.run.attempts ? ` · ${step.run.attempts} ${text.attempts}` : ""}
                </p>
              </div>
              <Badge tone={stateTone(step.run.state)}>{text.states[step.run.state]}</Badge>
            </div>

            {step.run.errorCode ? (
              <p className="mt-2 text-xs text-destructive">{step.run.errorCode}</p>
            ) : null}
            {step.run.outputRefs.length ? (
              <ul className="mt-2 list-inside list-disc text-xs text-muted-foreground">
                {step.run.outputRefs.map((output, outputIndex) => (
                  <li key={`${step.key}:output:${outputIndex}`}>{output.summary}</li>
                ))}
              </ul>
            ) : null}

            {step.run.state === "running" && step.kind !== "ledger_upsert" ? (
              <Button className="mt-2" size="sm" disabled={pending} onClick={() => onComplete(step.key)}>
                {text.complete}
              </Button>
            ) : null}
            {step.run.state === "running" && step.kind === "ledger_upsert" ? (
              <div className="mt-2 space-y-2">
                {!ledgerDefinitionId ? (
                  <p className="rounded bg-muted p-2 text-xs text-muted-foreground">
                    {text.ledgerConfigurationMissing}
                  </p>
                ) : !ledgerPreview ? (
                  <Button size="sm" disabled={pending}
                    onClick={() => {
                      setConfirmation({ type: "ledger", stepKey: step.key });
                      onPreviewLedger(step.key, ledgerDefinitionId);
                    }}>
                    {text.reviewLedger}
                  </Button>
                ) : (
                  <div className="rounded-md border border-border bg-background p-3">
                    <p className="text-sm font-medium">
                      {ledgerPreview.action === "insert"
                        ? text.ledgerInsert
                        : ledgerPreview.action === "update"
                          ? text.ledgerUpdate
                          : text.ledgerNoOp}
                      {ledgerPreview.rowNumber ? ` · ${text.row} ${ledgerPreview.rowNumber}` : ""}
                    </p>
                    <Button className="mt-3" size="sm" disabled={pending}
                      onClick={() => setConfirmation({ type: "ledger", stepKey: step.key })}>
                      {text.reviewAndConfirm}
                    </Button>
                  </div>
                )}
              </div>
            ) : null}
            {step.run.state === "failed" ? (
              <Button className="mt-2" size="sm" disabled={pending || !active} onClick={() => onRetry(step.key)}>
                {text.retry}
              </Button>
            ) : null}
            {step.run.state === "awaiting_approval" ? (
              <div className="mt-2 flex flex-wrap gap-2">
                <Button size="sm" disabled={pending}
                  onClick={() => setConfirmation({ type: "approval", stepKey: step.key })}>
                  {text.approve}
                </Button>
                <Button size="sm" variant="secondary" disabled={pending}
                  onClick={() => onApproval(step.key, false)}>{text.reject}</Button>
              </div>
            ) : null}
            {step.run.state === "awaiting_condition" ? (
              <div className="mt-2 space-y-2">
                {orderRequired ? (
                  <label className="block text-xs font-medium">
                    {text.selectOrder}
                    <Select className="mt-1" value={selectedOrderArtifactId}
                      onChange={(event) => setSelectedOrderArtifactId(event.target.value)}>
                      <option value="">—</option>
                      {execution.availableOrderTriggers.map((trigger) => (
                        <option key={trigger.artifactId} value={trigger.artifactId}>{trigger.label}</option>
                      ))}
                    </Select>
                  </label>
                ) : null}
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" disabled={pending || (orderRequired && !selectedOrderArtifactId)}
                    onClick={() => onCondition(
                      step.key,
                      true,
                      selectedOrderArtifactId ? [selectedOrderArtifactId] : [],
                    )}>
                    {text.orderReceived}
                  </Button>
                  <Button size="sm" variant="secondary" disabled={pending}
                    onClick={() => onCondition(step.key, false, [])}>
                    {text.noOrder}
                  </Button>
                </div>
              </div>
            ) : null}
          </li>
          );
        })}
      </ol>
      {confirmation?.type === "ledger" ? (() => {
        const step = execution.steps.find((candidate) => candidate.key === confirmation.stepKey);
        const preview = ledgerPreviews[confirmation.stepKey];
        if (!step || !preview) return null;
        return (
          <Modal
            open
            onClose={() => setConfirmation(null)}
            title={text.ledgerDialogTitle}
            description={text.ledgerDialogDescription}
            closeDisabled={pending}
          >
            <div className="space-y-3">
              <div className="rounded-md border bg-muted/20 p-3">
                <p className="text-sm font-medium">
                  {preview.action === "insert"
                    ? text.ledgerInsert
                    : preview.action === "update"
                      ? text.ledgerUpdate
                      : text.ledgerNoOp}
                  {preview.rowNumber ? ` · ${text.row} ${preview.rowNumber}` : ""}
                </p>
                {preview.changedCells.length ? (
                  <ul className="mt-2 space-y-1 text-xs">
                    {preview.changedCells.map((cell) => (
                      <li key={`${step.key}:${cell.field}`}>
                        <span className="font-medium">{cell.column}</span>
                        {" · "}
                        <span className="text-muted-foreground">{String(cell.before ?? "—")}</span>
                        {" → "}
                        <span>{String(cell.after ?? "—")}</span>
                      </li>
                    ))}
                  </ul>
                ) : <p className="mt-2 text-xs text-muted-foreground">{text.noLedgerChanges}</p>}
                {preview.warnings.map((warning) => (
                  <p key={warning} className="mt-2 text-xs text-warning">{warning}</p>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">{text.ledgerNextAction}</p>
              <div className="flex justify-end gap-2">
                <Button size="sm" variant="secondary" disabled={pending}
                  onClick={() => setConfirmation(null)}>{text.back}</Button>
                <Button size="sm" disabled={pending} onClick={() => {
                  onCommitLedger(step.key, preview);
                  setConfirmation(null);
                }}>
                  {preview.action === "no_op" ? text.confirmNoLedgerChange : text.commitLedger}
                </Button>
              </div>
            </div>
          </Modal>
        );
      })() : null}
      {confirmation?.type === "approval" ? (() => {
        const step = execution.steps.find((candidate) => candidate.key === confirmation.stepKey);
        if (!step) return null;
        const outputs = execution.steps
          .flatMap((candidate) => candidate.run.outputRefs)
          .filter((output) => output.summary);
        return (
          <Modal
            open
            onClose={() => setConfirmation(null)}
            title={text.approvalDialogTitle}
            description={text.approvalDialogDescription}
            closeDisabled={pending}
          >
            <div className="space-y-3">
              <div className="rounded-md border bg-muted/20 p-3">
                <p className="text-sm font-medium">{step.label}</p>
                {outputs.length ? (
                  <ul className="mt-2 list-inside list-disc text-xs text-muted-foreground">
                    {outputs.map((output, index) => (
                      <li key={`${step.key}:approval-output:${index}`}>{output.summary}</li>
                    ))}
                  </ul>
                ) : <p className="mt-2 text-xs text-muted-foreground">{text.noApprovalOutputs}</p>}
              </div>
              <p className="text-xs text-muted-foreground">{text.approvalNextAction}</p>
              <div className="flex justify-end gap-2">
                <Button size="sm" variant="secondary" disabled={pending}
                  onClick={() => setConfirmation(null)}>{text.back}</Button>
                <Button size="sm" disabled={pending} onClick={() => {
                  onApproval(step.key, true);
                  setConfirmation(null);
                }}>{text.approve}</Button>
              </div>
            </div>
          </Modal>
        );
      })() : null}
    </section>
  );
}
