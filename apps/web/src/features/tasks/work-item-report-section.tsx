import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, FileText, RefreshCw } from "lucide-react";
import { ConfirmModal } from "@/components/common/confirm-modal";
import { Field } from "@/components/common/field";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Select, Textarea } from "@/components/ui/input";
import { ApiError } from "@/lib/api-client";
import { useAppTranslation } from "@/lib/i18n/use-app-translation";
import { installWorkItemFollowUpTranslations } from "@/lib/i18n/work-item-follow-up-resources";
import { installWorkItemReportTranslations } from "@/lib/i18n/work-item-report-resources";
import type { LocalWorkItem, WorkItemRequesterRelation } from "./task-view-types";
import { workItemReportApi } from "./work-item-report-api";
import type {
  WorkItemReportAudience,
  WorkItemReportDraft,
  WorkItemReportTone,
} from "./work-item-report-types";

installWorkItemFollowUpTranslations();
installWorkItemReportTranslations();

const RELATIONS: WorkItemRequesterRelation[] = ["boss", "manager", "customer", "colleague", "self", "unknown"];
const TONES: WorkItemReportTone[] = ["concise", "formal", "warm"];

function operationKey(prefix: string) {
  return globalThis.crypto?.randomUUID?.()
    ?? `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function initialAudience(item: LocalWorkItem): WorkItemReportAudience {
  return {
    relation: item.requesterRelation,
    name: item.requesterName,
    organization: item.requesterOrganization,
    userId: item.requesterUserId,
  };
}

function draftTone(status: WorkItemReportDraft["status"], stale: boolean) {
  if (stale) return "warning" as const;
  if (status === "confirmed") return "success" as const;
  if (status === "draft") return "running" as const;
  return "neutral" as const;
}

export function WorkItemReportSection({
  item,
  onChanged,
}: {
  item: LocalWorkItem;
  onChanged?: () => void | Promise<void>;
}) {
  const { t: typedT } = useAppTranslation();
  const t = typedT as unknown as (key: string, options?: Record<string, unknown>) => string;
  const [drafts, setDrafts] = useState<WorkItemReportDraft[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [audience, setAudience] = useState<WorkItemReportAudience>(() => initialAudience(item));
  const [tone, setTone] = useState<WorkItemReportTone>("concise");
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState<"generate" | "save" | "confirm" | "discard" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);
  const generateKey = useRef(operationKey("report-generate"));
  const commandKeys = useRef<Record<string, string>>({});

  const selected = useMemo(
    () => drafts.find((draft) => draft.id === selectedId) ?? null,
    [drafts, selectedId],
  );

  const refresh = useCallback(async (preferredId?: string | null) => {
    setLoading(true);
    try {
      const result = await workItemReportApi.list(item.id);
      setDrafts(result.reportDrafts);
      setSelectedId((current) => {
        const requested = preferredId ?? current;
        if (requested && result.reportDrafts.some((draft) => draft.id === requested)) return requested;
        return result.reportDrafts.find((draft) => draft.status === "draft")?.id
          ?? result.reportDrafts.find((draft) => draft.status === "confirmed")?.id
          ?? result.reportDrafts[0]?.id
          ?? null;
      });
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("taskReport.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [item.id, t]);

  useEffect(() => {
    setAudience(initialAudience(item));
    setTone("concise");
    setContent("");
    setDrafts([]);
    setSelectedId(null);
    setNotice(null);
    setError(null);
    generateKey.current = operationKey("report-generate");
    void refresh(null);
  }, [item.id, refresh]);

  useEffect(() => {
    if (!selected) return;
    setAudience(selected.audience);
    setTone(selected.tone);
    setContent(selected.content);
    setError(null);
    setNotice(null);
  }, [selected?.id, selected?.revision]);

  const commandKey = (draftId: string, command: "confirm" | "discard") => {
    const mapKey = `${draftId}:${command}`;
    return commandKeys.current[mapKey] ??= operationKey(`report-${command}`);
  };

  const complete = async (draft: WorkItemReportDraft, message: string) => {
    await refresh(draft.id);
    setNotice(message);
    await onChanged?.();
  };

  const handleFailure = async (caught: unknown) => {
    const conflict = caught instanceof ApiError && caught.status === 409;
    if (conflict) await refresh(selectedId);
    setError(conflict ? t("taskReport.conflict") : caught instanceof Error ? caught.message : t("taskReport.actionFailed"));
  };

  const generate = async () => {
    if (pending) return;
    setPending("generate");
    setError(null);
    setNotice(null);
    try {
      const result = await workItemReportApi.generate(item.id, {
        expectedWorkItemRevision: item.revision,
        idempotencyKey: generateKey.current,
        audience,
        tone,
      });
      generateKey.current = operationKey("report-generate");
      await complete(result.reportDraft, t("taskReport.generated"));
    } catch (caught) {
      await handleFailure(caught);
    } finally {
      setPending(null);
    }
  };

  const save = async () => {
    if (!selected || pending || !selected.canEdit || !content.trim()) return;
    setPending("save");
    setError(null);
    setNotice(null);
    try {
      const result = await workItemReportApi.update(item.id, selected.id, {
        expectedRevision: selected.revision,
        audience,
        tone,
        content: content.trim(),
      });
      await complete(result.reportDraft, t("taskReport.saved"));
    } catch (caught) {
      await handleFailure(caught);
    } finally {
      setPending(null);
    }
  };

  const confirm = async () => {
    if (!selected || pending || !selected.canConfirm) return;
    setPending("confirm");
    setError(null);
    try {
      const result = await workItemReportApi.confirm(item.id, selected.id, {
        expectedRevision: selected.revision,
        idempotencyKey: commandKey(selected.id, "confirm"),
      });
      delete commandKeys.current[`${selected.id}:confirm`];
      setConfirmOpen(false);
      await complete(result.reportDraft, t("taskReport.confirmed"));
    } catch (caught) {
      await handleFailure(caught);
    } finally {
      setPending(null);
    }
  };

  const discard = async () => {
    if (!selected || pending || selected.status !== "draft") return;
    setPending("discard");
    setError(null);
    try {
      const result = await workItemReportApi.discard(item.id, selected.id, {
        expectedRevision: selected.revision,
        idempotencyKey: commandKey(selected.id, "discard"),
      });
      delete commandKeys.current[`${selected.id}:discard`];
      setDiscardOpen(false);
      await complete(result.reportDraft, t("taskReport.discarded"));
    } catch (caught) {
      await handleFailure(caught);
    } finally {
      setPending(null);
    }
  };

  const audienceFields = (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label={t("taskReport.audience")}>
        <Select
          value={audience.relation}
          disabled={Boolean(pending) || Boolean(selected && !selected.canEdit)}
          onChange={(event) => setAudience((current) => ({
            ...current,
            relation: event.target.value as WorkItemRequesterRelation,
            userId: event.target.value === current.relation ? current.userId : null,
          }))}
        >
          {RELATIONS.map((relation) => <option key={relation} value={relation}>{t(`taskFollowUp.relation.${relation}`)}</option>)}
        </Select>
      </Field>
      <Field label={t("taskReport.tone")}>
        <Select value={tone} disabled={Boolean(pending) || Boolean(selected && !selected.canEdit)} onChange={(event) => setTone(event.target.value as WorkItemReportTone)}>
          {TONES.map((value) => <option key={value} value={value}>{t(`taskReport.toneOption.${value}`)}</option>)}
        </Select>
      </Field>
      {audience.relation !== "self" ? (
        <>
          <Field label={t("taskReport.audienceName")}>
            <Input value={audience.name ?? ""} disabled={Boolean(pending) || Boolean(selected && !selected.canEdit)} onChange={(event) => setAudience((current) => ({ ...current, name: event.target.value || null }))} />
          </Field>
          <Field label={t("taskReport.organization")}>
            <Input value={audience.organization ?? ""} disabled={Boolean(pending) || Boolean(selected && !selected.canEdit)} onChange={(event) => setAudience((current) => ({ ...current, organization: event.target.value || null }))} />
          </Field>
        </>
      ) : null}
    </div>
  );

  if (loading && !drafts.length) {
    return <p className="text-sm text-muted-foreground" role="status">{t("taskReport.loading")}</p>;
  }

  if (!drafts.length) {
    return (
      <section className="space-y-4 rounded-md border border-border p-4" aria-labelledby={`work-item-report-title-${item.id}`}>
        <div className="flex gap-3">
          <FileText className="mt-0.5 size-5 text-muted-foreground" aria-hidden />
          <div>
            <h3 id={`work-item-report-title-${item.id}`} className="text-sm font-semibold">{t("taskReport.emptyTitle")}</h3>
            <p className="mt-1 text-xs text-muted-foreground">{t("taskReport.emptyDescription")}</p>
          </div>
        </div>
        {audienceFields}
        {error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}
        <div className="flex flex-wrap justify-end gap-2">
          {error ? <Button variant="secondary" size="sm" onClick={() => void refresh(null)}>{t("taskReport.refresh")}</Button> : null}
          <Button size="sm" disabled={Boolean(pending)} onClick={() => void generate()}>
            {pending === "generate" ? t("taskReport.generating") : t("taskReport.generate")}
          </Button>
        </div>
      </section>
    );
  }

  if (!selected) return null;
  const readOnly = !selected.canEdit;

  return (
    <section className="space-y-4" aria-labelledby={`work-item-report-title-${item.id}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 id={`work-item-report-title-${item.id}`} className="text-sm font-semibold">{t("taskReport.title")}</h3>
          <p className="mt-1 text-xs text-muted-foreground">{t("taskReport.description")}</p>
        </div>
        <Badge tone={draftTone(selected.status, selected.stale)}>
          {selected.stale ? t("taskReport.status.stale") : t(`taskReport.status.${selected.status}`)}
        </Badge>
      </div>

      {selected.stale ? (
        <div className="rounded-md border border-warning/40 bg-warning/10 p-3" role="alert">
          <div className="flex gap-2">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
            <div>
              <p className="text-sm font-medium">{t("taskReport.staleTitle")}</p>
              <p className="mt-1 text-xs text-muted-foreground">{t("taskReport.staleDescription")}</p>
            </div>
          </div>
        </div>
      ) : null}

      {selected.status === "confirmed" ? (
        <div className="rounded-md border border-success/30 bg-success/10 p-3">
          <div className="flex gap-2">
            <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
            <div>
              <p className="text-sm font-medium">{t("taskReport.confirmed")}</p>
              <p className="mt-1 text-xs text-muted-foreground">{t("taskReport.confirmedHint")}</p>
            </div>
          </div>
        </div>
      ) : null}

      {audienceFields}
      <Field label={t("taskReport.content")}>
        <Textarea value={content} rows={10} maxLength={20_000} disabled={Boolean(pending) || readOnly} onChange={(event) => setContent(event.target.value)} />
      </Field>

      <details className="rounded-md border border-border p-3">
        <summary className="cursor-pointer text-sm font-medium">{t("taskReport.source")}</summary>
        <div className="mt-3 space-y-3 text-xs">
          <p className="text-muted-foreground">{t("taskReport.sourceRevision", { revision: selected.source.workItemRevision })}</p>
          {selected.source.progressActivities.length ? (
            <div>
              <p className="font-medium">{t("taskReport.progressSources")}</p>
              <ul className="mt-1 list-disc space-y-1 pl-5">
                {selected.source.progressActivities.map((source) => <li key={source.activityId}>{source.summary}</li>)}
              </ul>
            </div>
          ) : null}
          {selected.source.executionResults.length ? (
            <div>
              <p className="font-medium">{t("taskReport.executionSources")}</p>
              <ul className="mt-1 list-disc space-y-1 pl-5">
                {selected.source.executionResults.map((source) => <li key={`${source.kind}:${source.id}`}>{source.summary}</li>)}
              </ul>
            </div>
          ) : null}
          {!selected.source.progressActivities.length && !selected.source.executionResults.length
            ? <p className="text-muted-foreground">{t("taskReport.noSources")}</p>
            : null}
        </div>
      </details>

      {error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}
      {notice ? <p className="text-sm text-success" role="status">{notice}</p> : null}

      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button variant="ghost" size="sm" disabled={Boolean(pending)} onClick={() => void refresh(selected.id)}>
          <RefreshCw aria-hidden />{t("taskReport.refresh")}
        </Button>
        {selected.status === "draft" ? (
          <Button variant="destructive" size="sm" disabled={Boolean(pending)} onClick={() => setDiscardOpen(true)}>{t("taskReport.discard")}</Button>
        ) : null}
        <Button variant="secondary" size="sm" disabled={Boolean(pending)} onClick={() => void generate()}>
          {pending === "generate" ? t("taskReport.generating") : t("taskReport.regenerate")}
        </Button>
        {selected.canEdit ? <Button variant="secondary" size="sm" disabled={Boolean(pending) || !content.trim()} onClick={() => void save()}>{pending === "save" ? t("taskReport.saving") : t("taskReport.save")}</Button> : null}
        {selected.canConfirm ? <Button size="sm" disabled={Boolean(pending)} onClick={() => setConfirmOpen(true)}>{t("taskReport.confirm")}</Button> : null}
      </div>

      <div className="border-t border-border pt-3">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("taskReport.history")}</h4>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {drafts.map((draft) => (
            <button
              key={draft.id}
              type="button"
              aria-pressed={draft.id === selected.id}
              onClick={() => setSelectedId(draft.id)}
              className={`rounded-md border p-2 text-left text-xs ${draft.id === selected.id ? "border-primary bg-primary/5" : "border-border hover:bg-muted/50"}`}
            >
              <span className="flex items-center justify-between gap-2">
                <span className="font-medium">{draft.stale ? t("taskReport.status.stale") : t(`taskReport.status.${draft.status}`)}</span>
                <span className="text-muted-foreground">v{draft.revision}</span>
              </span>
              <span className="mt-1 block text-muted-foreground">{new Date(draft.updatedAt).toLocaleString()}</span>
            </button>
          ))}
        </div>
      </div>

      <ConfirmModal
        open={confirmOpen}
        title={t("taskReport.confirmTitle")}
        description={t("taskReport.confirmDescription")}
        confirmLabel={t("taskReport.confirm")}
        pending={pending === "confirm"}
        error={confirmOpen ? error : null}
        onClose={() => setConfirmOpen(false)}
        onConfirm={() => void confirm()}
      />
      <ConfirmModal
        open={discardOpen}
        title={t("taskReport.discardTitle")}
        description={t("taskReport.discardDescription")}
        confirmLabel={t("taskReport.discard")}
        destructive
        pending={pending === "discard"}
        error={discardOpen ? error : null}
        onClose={() => setDiscardOpen(false)}
        onConfirm={() => void discard()}
      />
    </section>
  );
}

export default WorkItemReportSection;
