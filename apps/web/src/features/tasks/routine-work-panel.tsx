import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { cn } from "@/lib/cn";
import { QuotationDraftPreview } from "./quotation-draft-preview";
import {
  routineRecoveryMessage,
  useRoutineWorkLabels,
  type LedgerUpsertPreview,
  type RoutineWorkExecution,
  type RoutineStepState,
} from "./routine-workflow";

type RoutineAction = () => void;
type RoutineStepAction = (stepKey: string) => void;

const terminalRunStates = new Set(["succeeded", "cancelled"]);
const governedExecutorKinds = new Set(["retrieve", "generate", "create_issue"]);

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

type HumanAttention = {
  kind: "quotation" | "approval" | "condition" | "ledger_review"
    | "ledger_configuration" | "extraction_review" | "failed" | "waiting";
  step: RoutineWorkExecution["steps"][number] | null;
  ledgerPreview?: LedgerUpsertPreview;
};

function findHumanAttention(
  execution: RoutineWorkExecution,
  ledgerPreviews: Record<string, LedgerUpsertPreview>,
): HumanAttention | null {
  if (terminalRunStates.has(execution.run.status)) return null;
  for (const step of execution.steps) {
    if (step.run.state === "failed" && step.run.errorCode?.startsWith("routine_extract_")) {
      return { kind: "extraction_review", step };
    }
    if (step.run.state === "failed") return { kind: "failed", step };
    if (step.kind === "generate"
      && step.run.state === "running"
      && step.run.quotationReview?.status === "needs_input") {
      return { kind: "quotation", step };
    }
    if (step.run.state === "awaiting_approval") return { kind: "approval", step };
    if (step.run.state === "awaiting_condition") return { kind: "condition", step };
    if (step.kind === "ledger_upsert" && step.run.state === "running") {
      const ledgerDefinitionId = typeof step.configuration.ledgerDefinitionId === "string"
        ? step.configuration.ledgerDefinitionId
        : null;
      if (!ledgerDefinitionId) return { kind: "ledger_configuration", step };
      const ledgerPreview = ledgerPreviews[step.key];
      if (!ledgerPreview || ledgerPreview.state === "pending") {
        return { kind: "ledger_review", step, ledgerPreview };
      }
    }
  }
  if (execution.run.waitingReason
    && execution.run.waitingReason !== "device_capacity"
    && execution.run.waitingReason !== "ledger_write_waiting") {
    return { kind: "waiting", step: null };
  }
  return null;
}

export function RoutineWorkPanel({
  execution,
  pending,
  ledgerPreviews,
  onStart,
  onCancel,
  onExecute,
  onQuotationInputs,
  onComplete,
  onPreviewLedger,
  onCommitLedger,
  onBindLedger,
  onRetry,
  onApproval,
  onCondition,
  onOpenWorkflowMemory,
}: {
  execution: RoutineWorkExecution;
  pending: boolean;
  ledgerPreviews: Record<string, LedgerUpsertPreview>;
  onStart: RoutineAction;
  onCancel: RoutineAction;
  onExecute: RoutineStepAction;
  onQuotationInputs: (
    stepKey: string,
    templateArtifactId: string,
    answers: Record<string, string>,
  ) => void;
  onComplete: RoutineStepAction;
  onPreviewLedger: (stepKey: string, ledgerDefinitionId: string) => void;
  onCommitLedger: (stepKey: string, preview: LedgerUpsertPreview) => void;
  onBindLedger: (stepKey: string, ledgerDefinitionId: string) => void;
  onRetry: RoutineStepAction;
  onApproval: (stepKey: string, approved: boolean) => void;
  onCondition: (stepKey: string, outcome: boolean, triggerArtifactIds: string[]) => void;
  onOpenWorkflowMemory: (
    anchor: "workflow-file-review" | "workflow-routine-library",
    retryStepKey?: string,
  ) => void;
}) {
  const text = useRoutineWorkLabels();
  const [selectedOrderArtifactId, setSelectedOrderArtifactId] = useState("");
  const [selectedLedgerDefinitionId, setSelectedLedgerDefinitionId] = useState("");
  const [confirmation, setConfirmation] = useState<{
    type: "ledger" | "approval" | "quotation";
    stepKey: string;
  } | null>(null);
  const [quotationTemplateArtifactId, setQuotationTemplateArtifactId] = useState("");
  const [quotationAnswers, setQuotationAnswers] = useState<Record<string, string>>({});
  const active = !terminalRunStates.has(execution.run.status);
  const completedCount = execution.steps.filter(
    (step) => step.run.state === "succeeded" || step.run.state === "skipped",
  ).length;
  const progress = useMemo(
    () => Math.round((completedCount / Math.max(execution.steps.length, 1)) * 100),
    [completedCount, execution.steps.length],
  );
  const attention = findHumanAttention(execution, ledgerPreviews);

  const openQuotationReview = (step: RoutineWorkExecution["steps"][number]) => {
    const quotationReview = step.run.quotationReview;
    if (!quotationReview) return;
    setQuotationTemplateArtifactId(quotationReview.selectedTemplate?.artifactId ?? "");
    setQuotationAnswers(Object.fromEntries(
      quotationReview.fields
        .filter((field) => field.state !== "confirmed")
        .map((field) => [field.key, ""]),
    ));
    setConfirmation({ type: "quotation", stepKey: step.key });
  };

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
      {attention ? (() => {
        const step = attention.step;
        const orderDecision = attention.kind === "condition" && step
          ? needsConfirmedOrder(step)
          : false;
        const copy = attention.kind === "quotation"
          ? text.help.quotation
          : attention.kind === "approval"
            ? text.help.approval
            : attention.kind === "condition"
              ? orderDecision ? text.help.orderCondition : text.help.condition
              : attention.kind === "ledger_review"
                ? text.help.ledgerReview
                : attention.kind === "ledger_configuration"
                  ? text.help.ledgerConfiguration
                  : attention.kind === "extraction_review"
                    ? text.help.extractionReview
                  : attention.kind === "failed"
                    ? text.help.failed
                    : text.help.waiting;
        const action = attention.kind === "failed"
          ? routineRecoveryMessage(step?.run.errorCode ?? "failed", text)
          : "action" in copy ? copy.action : "";
        const technicalValues = [
          step?.run.errorCode
            ? `${text.technicalErrorCode}: ${step.run.errorCode}`
            : null,
          execution.run.waitingReason
            ? `${text.technicalWaitingReason}: ${execution.run.waitingReason}`
            : null,
        ].filter(Boolean);
        const ledgerDefinitionId = step && typeof step.configuration.ledgerDefinitionId === "string"
          ? step.configuration.ledgerDefinitionId
          : null;
        return (
          <div className="mt-3 rounded-md border border-warning/50 bg-warning/5 p-3"
            role="status" aria-label={text.helpTitle}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-xs font-medium text-warning">
                  {text.helpTitle}
                </p>
                <p className="mt-0.5 text-sm font-semibold">{copy.title}</p>
              </div>
              {step ? <Badge tone="warning">{step.label}</Badge> : null}
            </div>
            <dl className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
              <div>
                <dt className="font-medium">{text.helpBlockedAt}</dt>
                <dd className="mt-0.5 text-muted-foreground">{step?.label ?? execution.definition.name}</dd>
              </div>
              <div>
                <dt className="font-medium">{text.helpWhy}</dt>
                <dd className="mt-0.5 text-muted-foreground">{copy.why}</dd>
              </div>
              <div>
                <dt className="font-medium">{text.helpAction}</dt>
                <dd className="mt-0.5 text-muted-foreground">{action}</dd>
              </div>
              <div>
                <dt className="font-medium">{text.helpAfter}</dt>
                <dd className="mt-0.5 text-muted-foreground">{copy.after}</dd>
              </div>
            </dl>
            {step ? (
              <div className="mt-3 flex flex-wrap items-end gap-2">
                {attention.kind === "quotation" ? (
                  <Button size="sm" disabled={pending} onClick={() => openQuotationReview(step)}>
                    {text.reviewQuotationInputs}
                  </Button>
                ) : null}
                {attention.kind === "approval" ? (
                  <>
                    <Button size="sm" disabled={pending}
                      onClick={() => setConfirmation({ type: "approval", stepKey: step.key })}>
                      {text.reviewResult}
                    </Button>
                    <Button size="sm" variant="secondary" disabled={pending}
                      onClick={() => onApproval(step.key, false)}>{text.reject}</Button>
                  </>
                ) : null}
                {attention.kind === "condition" ? (
                  <>
                    {orderDecision ? (
                      <label className="min-w-56 text-xs font-medium">
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
                    <Button size="sm" disabled={pending || (orderDecision && !selectedOrderArtifactId)}
                      onClick={() => onCondition(
                        step.key,
                        true,
                        selectedOrderArtifactId ? [selectedOrderArtifactId] : [],
                      )}>
                      {orderDecision ? text.orderReceived : text.conditionYes}
                    </Button>
                    <Button size="sm" variant="secondary" disabled={pending}
                      onClick={() => onCondition(step.key, false, [])}>
                      {orderDecision ? text.noOrder : text.conditionNo}
                    </Button>
                  </>
                ) : null}
                {attention.kind === "ledger_review" && ledgerDefinitionId ? (
                  <Button size="sm" disabled={pending || attention.ledgerPreview?.state === "waiting"}
                    onClick={() => {
                      setConfirmation({ type: "ledger", stepKey: step.key });
                      if (!attention.ledgerPreview) onPreviewLedger(step.key, ledgerDefinitionId);
                    }}>
                    {attention.ledgerPreview ? text.reviewAndConfirm : text.reviewLedger}
                  </Button>
                ) : null}
                {attention.kind === "ledger_configuration" ? (
                  (execution.availableLedgers?.length ?? 0) > 0 ? (
                    <>
                      <label className="min-w-64 text-xs font-medium">
                        {text.selectLedger}
                        <Select className="mt-1" value={selectedLedgerDefinitionId}
                          onChange={(event) => setSelectedLedgerDefinitionId(event.target.value)}>
                          <option value="">—</option>
                          {execution.availableLedgers?.map((ledger) => (
                            <option key={ledger.id} value={ledger.id}>
                              {ledger.name} · {text.ledgerTypes[ledger.documentType]} · {ledger.relativePath}
                            </option>
                          ))}
                        </Select>
                      </label>
                      <Button size="sm" disabled={pending || !selectedLedgerDefinitionId}
                        onClick={() => onBindLedger(step.key, selectedLedgerDefinitionId)}>
                        {text.useLedger}
                      </Button>
                    </>
                  ) : (
                    <div className="space-y-2">
                      <p className="max-w-xl text-xs text-muted-foreground">{text.noAvailableLedgers}</p>
                      <Button size="sm" variant="secondary" disabled={pending}
                        onClick={() => onOpenWorkflowMemory("workflow-file-review")}>
                        {text.findLedger}
                      </Button>
                    </div>
                  )
                ) : null}
                {attention.kind === "extraction_review" ? (
                  <Button size="sm" disabled={pending}
                    onClick={() => onOpenWorkflowMemory("workflow-file-review", step.key)}>
                    {text.reviewRecognizedInformation}
                  </Button>
                ) : null}
                {attention.kind === "failed" ? (
                  <Button size="sm" disabled={pending || !active} onClick={() => onRetry(step.key)}>
                    {text.retry}
                  </Button>
                ) : null}
              </div>
            ) : null}
            {technicalValues.length ? (
              <details className="mt-3 text-xs text-muted-foreground">
                <summary className="cursor-pointer font-medium">{text.technicalDetails}</summary>
                {technicalValues.map((value) => <p key={value} className="mt-1 font-mono">{value}</p>)}
              </details>
            ) : null}
          </div>
        );
      })() : execution.run.waitingReason ? (
        <p className="mt-2 rounded bg-muted p-2 text-xs text-muted-foreground">
          {execution.run.waitingReason === "device_capacity"
            ? `${text.waitingCapacity}${
              execution.run.capacity.position
                ? ` ${text.waitingCapacityPosition} ${execution.run.capacity.position}.`
                : ""
            }`
            : execution.run.waitingReason === "routine_step_interrupted"
              ? text.interruptedRecovery
              : execution.run.waitingReason === "routine_quotation_facts_required"
                ? text.quotationFactsRequired
                : text.help.waiting.title}
        </p>
      ) : null}

      <ol className="mt-3 space-y-2">
        {execution.steps.map((step, index) => {
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
              <details className="mt-2 text-xs text-muted-foreground">
                <summary className="cursor-pointer">{text.technicalDetails}</summary>
                <p className="mt-1 font-mono">{text.technicalErrorCode}: {step.run.errorCode}</p>
              </details>
            ) : null}
            {step.run.outputRefs.length ? (
              <ul className="mt-2 list-inside list-disc text-xs text-muted-foreground">
                {step.run.outputRefs.map((output, outputIndex) => (
                  <li key={`${step.key}:output:${outputIndex}`}>{output.summary}</li>
                ))}
              </ul>
            ) : null}

            {step.run.state === "running" && step.kind !== "ledger_upsert" ? (() => {
              const quotationReview = step.kind === "generate" ? step.run.quotationReview : null;
              if (quotationReview?.status === "needs_input") return null;
              if (quotationReview) {
                return (
                  <Button className="mt-2" size="sm" disabled={pending}
                    onClick={() => {
                      if (quotationReview.status === "ready") {
                        onExecute(step.key);
                        return;
                      }
                      openQuotationReview(step);
                    }}>
                    {quotationReview.status === "ready"
                      ? text.generateQuotation
                      : text.reviewQuotationInputs}
                  </Button>
                );
              }
              return (
                <Button className="mt-2" size="sm" disabled={pending}
                  onClick={() => governedExecutorKinds.has(step.kind)
                    ? onExecute(step.key)
                    : onComplete(step.key)}>
                  {step.kind === "retrieve"
                    ? text.retrieveStep
                    : step.kind === "generate"
                      ? text.prepareResult
                      : step.kind === "create_issue"
                        ? text.createFollowUp
                        : text.complete}
                </Button>
              );
            })() : null}
          </li>
          );
        })}
      </ol>
      {confirmation?.type === "quotation" ? (() => {
        const step = execution.steps.find((candidate) => candidate.key === confirmation.stepKey);
        const review = step?.run.quotationReview;
        if (!step || !review) return null;
        const unresolvedFields = review.fields.filter((field) => field.state !== "confirmed");
        const selectedTemplate = review.templateOptions.find(
          (option) => option.artifactId === quotationTemplateArtifactId && option.supported,
        );
        const reviewFieldKeys = new Set(review.fields.map((field) => field.key));
        const templateOnlyFields = (selectedTemplate?.placeholderKeys ?? [])
          .filter((key) => !reviewFieldKeys.has(key))
          .map((key) => ({
            key,
            label: key.replaceAll("_", " "),
            state: "missing" as const,
            value: null,
            conflictingValues: [],
            sourceSummaries: [],
            evidenceArtifactIds: [],
          }));
        const editableFields = [...unresolvedFields, ...templateOnlyFields];
        const displayedFields = [...review.fields, ...templateOnlyFields];
        const answersComplete = editableFields.every((field) =>
          Boolean(quotationAnswers[field.key]?.trim()));
        return (
          <Modal
            open
            onClose={() => setConfirmation(null)}
            title={text.quotationInputDialogTitle}
            description={text.quotationInputDialogDescription}
            closeDisabled={pending}
          >
            <div className="space-y-3">
              <label className="block space-y-1 text-sm font-medium">
                <span>{text.quotationTemplate}</span>
                <Select
                  value={quotationTemplateArtifactId}
                  onChange={(event) => setQuotationTemplateArtifactId(event.target.value)}
                >
                  <option value="">—</option>
                  {review.templateOptions.map((option) => (
                    <option key={option.artifactId} value={option.artifactId}
                      disabled={!option.supported}>
                      {option.label}
                      {option.supported ? "" : ` · ${text.unsupportedTemplate}`}
                    </option>
                  ))}
                </Select>
              </label>
              {!review.templateOptions.some((option) => option.supported) ? (
                <p className="rounded bg-muted p-2 text-xs text-muted-foreground">
                  {text.noQuotationTemplates}
                </p>
              ) : null}
              <div className="space-y-2">
                {displayedFields.map((field) => (
                  <div key={field.key} className="rounded-md border border-border p-2">
                    <div className="flex items-center justify-between gap-2">
                      <label className="text-xs font-medium" htmlFor={`quotation-field-${field.key}`}>
                        {field.label}
                      </label>
                      <Badge tone={field.state === "confirmed" ? "success" : "warning"}>
                        {field.state === "confirmed"
                          ? text.confirmedFact
                          : field.state === "conflict"
                            ? text.conflictingFact
                            : text.missingFact}
                      </Badge>
                    </div>
                    {field.state === "confirmed" ? (
                      <p id={`quotation-field-${field.key}`} className="mt-1 text-sm">{field.value}</p>
                    ) : (
                      <Input
                        id={`quotation-field-${field.key}`}
                        className="mt-1"
                        value={quotationAnswers[field.key] ?? ""}
                        onChange={(event) => setQuotationAnswers((current) => ({
                          ...current,
                          [field.key]: event.target.value,
                        }))}
                      />
                    )}
                    {field.conflictingValues.length ? (
                      <p className="mt-1 text-xs text-muted-foreground">
                        {field.conflictingValues.join(" / ")}
                      </p>
                    ) : null}
                    {field.sourceSummaries.length ? (
                      <p className="mt-1 text-xs text-muted-foreground">
                        {text.factSources}: {field.sourceSummaries.join(", ")}
                      </p>
                    ) : null}
                  </div>
                ))}
              </div>
              {review.plannedOutputPath ? (
                <p className="rounded bg-muted p-2 font-mono text-xs">
                  {text.plannedOutput}: {review.plannedOutputPath}
                </p>
              ) : null}
              <div className="flex justify-end gap-2">
                <Button size="sm" variant="secondary" disabled={pending}
                  onClick={() => setConfirmation(null)}>{text.back}</Button>
                <Button size="sm"
                  disabled={pending || !quotationTemplateArtifactId || !answersComplete}
                  onClick={() => {
                    onQuotationInputs(
                      step.key,
                      quotationTemplateArtifactId,
                      Object.fromEntries(
                        editableFields.map((field) => [
                          field.key,
                          quotationAnswers[field.key]?.trim() ?? "",
                        ]),
                      ),
                    );
                    setConfirmation(null);
                  }}>
                  {text.confirmQuotationInputs}
                </Button>
              </div>
            </div>
          </Modal>
        );
      })() : null}
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
              {preview.state === "waiting" ? (
                <p className="rounded bg-muted p-2 text-xs text-muted-foreground" role="status">
                  {text.waitingLedger}
                  {preview.queue.position
                    ? ` ${text.waitingLedgerPosition} ${preview.queue.position}.`
                    : ""}
                </p>
              ) : null}
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
                <Button size="sm" disabled={pending || preview.state === "waiting"} onClick={() => {
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
        const quotationReview = execution.steps
          .map((candidate) => candidate.run.quotationReview)
          .find((review) => review?.status === "generated");
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
                {quotationReview ? (
                  <div className="mt-2 space-y-1 text-xs">
                    <p className="font-mono">{quotationReview.plannedOutputPath}</p>
                    <p>{text.quotationTemplate}: {quotationReview.selectedTemplate?.label}</p>
                    {quotationReview.fields.map((field) => (
                      <p key={`${step.key}:approval-field:${field.key}`}>
                        <span className="font-medium">{field.label}: </span>
                        {field.value}
                        {field.sourceSummaries.length
                          ? ` · ${text.factSources}: ${field.sourceSummaries.join(", ")}`
                          : ""}
                      </p>
                    ))}
                  </div>
                ) : null}
                {quotationReview?.draftPreview ? (
                  <div className="mt-3">
                    <p className="text-xs font-medium">{text.quotationDraftPreview}</p>
                    <QuotationDraftPreview preview={quotationReview.draftPreview} />
                  </div>
                ) : null}
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
