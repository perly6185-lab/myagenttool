import { useEffect, useState } from "react";
import { Field } from "@/components/common/field";
import { Button } from "@/components/ui/button";
import { Input, Select, Textarea } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { api } from "@/data/use-console-actions";
import { useAppTranslation } from "@/lib/i18n/use-app-translation";
import { installWorkItemFollowUpTranslations } from "@/lib/i18n/work-item-follow-up-resources";
import type { LocalWorkItem, WorkItemRequesterRelation, WorkItemWaitingOn } from "./task-view-types";
import { isoToLocalDateTimeInput, localDateTimeInputToIso } from "./work-item-follow-up-model";

installWorkItemFollowUpTranslations();

export type WorkItemProgressTarget = {
  id: string;
  title: string;
  revision: number;
  requesterRelation: WorkItemRequesterRelation;
  waitingOn: WorkItemWaitingOn;
  nextFollowUpAt: string | null;
};

function operationKey() {
  return globalThis.crypto?.randomUUID?.()
    ?? `progress-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function WorkItemProgressDialog({
  target,
  open,
  onClose,
  onSaved,
}: {
  target: WorkItemProgressTarget | null;
  open: boolean;
  onClose: () => void;
  onSaved: (workItem: LocalWorkItem) => void | Promise<void>;
}) {
  const { t: typedT } = useAppTranslation();
  const t = typedT as unknown as (key: string) => string;
  const [summary, setSummary] = useState("");
  const [waitingOn, setWaitingOn] = useState<WorkItemWaitingOn>("none");
  const [nextFollowUpAt, setNextFollowUpAt] = useState("");
  const [idempotencyKey, setIdempotencyKey] = useState(operationKey);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !target) return;
    setSummary("");
    setWaitingOn(target.waitingOn);
    setNextFollowUpAt(isoToLocalDateTimeInput(target.nextFollowUpAt));
    setIdempotencyKey(operationKey());
    setError(null);
  }, [open, target?.id, target?.waitingOn, target?.nextFollowUpAt]);

  const submit = async () => {
    if (!target || pending) return;
    const normalizedSummary = summary.trim();
    if (!normalizedSummary) {
      setError(t("taskFollowUp.progressRequired"));
      return;
    }
    if (normalizedSummary.length > 2_000) {
      setError(t("taskFollowUp.progressTooLong"));
      return;
    }
    const next = localDateTimeInputToIso(nextFollowUpAt);
    if (nextFollowUpAt && (!next || Date.parse(next) <= Date.now())) {
      setError(t("taskFollowUp.validation.followUpPast"));
      return;
    }
    setPending(true);
    setError(null);
    try {
      const result = await api.recordWorkItemProgress(target.id, {
        expectedRevision: target.revision,
        idempotencyKey,
        summary: normalizedSummary,
        waitingOn,
        nextFollowUpAt: next,
      }) as { workItem: LocalWorkItem };
      await onSaved(result.workItem);
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setPending(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t("taskFollowUp.recordProgress")}
      description={target ? `${target.title} · ${t("taskFollowUp.progressDescription")}` : t("taskFollowUp.progressDescription")}
      closeDisabled={pending}
    >
      <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
        <Field label={t("taskFollowUp.progressSummary")}>
          <Textarea
            autoFocus
            value={summary}
            maxLength={2_000}
            rows={5}
            placeholder={t("taskFollowUp.progressPlaceholder")}
            disabled={pending}
            onChange={(event) => setSummary(event.target.value)}
          />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t("taskFollowUp.waitingOn")}>
            <Select value={waitingOn} disabled={pending} onChange={(event) => setWaitingOn(event.target.value as WorkItemWaitingOn)}>
              {(["me", "requester", "internal", "ai", "none"] as const)
                .filter((value) => value !== "requester" || !["self", "unknown"].includes(target?.requesterRelation ?? "unknown"))
                .map((value) => <option key={value} value={value}>{t(`taskFollowUp.waiting.${value}`)}</option>)}
            </Select>
          </Field>
          <Field label={t("taskFollowUp.nextFollowUpAt")}>
            <Input type="datetime-local" value={nextFollowUpAt} disabled={pending} onChange={(event) => setNextFollowUpAt(event.target.value)} />
          </Field>
        </div>
        {error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" disabled={pending} onClick={onClose}>{t("shared.cancel")}</Button>
          <Button type="submit" disabled={pending || !summary.trim()}>{pending ? t("taskFollowUp.progressSaving") : t("taskFollowUp.progressSave")}</Button>
        </div>
      </form>
    </Modal>
  );
}

export default WorkItemProgressDialog;
