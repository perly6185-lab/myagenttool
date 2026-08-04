import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, FileText, RefreshCw } from "lucide-react";
import { ConfirmModal } from "@/components/common/confirm-modal";
import { Field } from "@/components/common/field";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Select, Textarea } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { useSafeNavigation } from "@/hooks/use-safe-navigation";
import { ApiError } from "@/lib/api-client";
import { useAppTranslation } from "@/lib/i18n/use-app-translation";
import { installWorkItemFollowUpTranslations } from "@/lib/i18n/work-item-follow-up-resources";
import { installWorkItemReportTranslations } from "@/lib/i18n/work-item-report-resources";
import type { LocalWorkItem, WorkItemRequesterRelation } from "./task-view-types";
import { workItemReportApi } from "./work-item-report-api";
import type {
  WorkItemReportAudience,
  WorkItemReportDraft,
  WorkItemReportLocale,
  WorkItemReportTone,
} from "./work-item-report-types";

installWorkItemFollowUpTranslations();
installWorkItemReportTranslations();

const RELATIONS: WorkItemRequesterRelation[] = ["boss", "manager", "customer", "colleague", "self", "unknown"];
const TONES: WorkItemReportTone[] = ["concise", "formal", "warm"];

type ReportEditorBaseline = {
  draftId: string | null;
  audience: WorkItemReportAudience;
  tone: WorkItemReportTone;
  content: string;
};

function operationKey(prefix: string) {
  return globalThis.crypto?.randomUUID?.()
    ?? `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function normalizeAudience(audience: WorkItemReportAudience): WorkItemReportAudience {
  if (audience.relation === "self") {
    return { relation: "self", name: null, organization: null, userId: null };
  }
  return {
    relation: audience.relation,
    name: audience.name ?? null,
    organization: audience.organization ?? null,
    userId: audience.userId ?? null,
  };
}

function initialAudience(item: LocalWorkItem): WorkItemReportAudience {
  return normalizeAudience({
    relation: item.requesterRelation,
    name: item.requesterName,
    organization: item.requesterOrganization,
    userId: item.requesterUserId,
  });
}

function editorBaseline(draft: WorkItemReportDraft | null, item: LocalWorkItem): ReportEditorBaseline {
  return draft
    ? {
        draftId: draft.id,
        audience: normalizeAudience(draft.audience),
        tone: draft.tone,
        content: draft.content,
      }
    : {
        draftId: null,
        audience: initialAudience(item),
        tone: "concise",
        content: "",
      };
}

function audiencesEqual(left: WorkItemReportAudience, right: WorkItemReportAudience) {
  return left.relation === right.relation
    && left.name === right.name
    && left.organization === right.organization
    && left.userId === right.userId;
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
  onDirtyChange,
}: {
  item: LocalWorkItem;
  onChanged?: () => void | Promise<void>;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const { t: typedT, i18n } = useAppTranslation();
  const t = typedT as unknown as (key: string, options?: Record<string, unknown>) => string;
  const locale: WorkItemReportLocale = i18n.language.startsWith("zh") ? "zh-CN" : "en-US";
  const initialEditor = useRef(editorBaseline(null, item)).current;
  const [drafts, setDrafts] = useState<WorkItemReportDraft[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [audience, setAudience] = useState<WorkItemReportAudience>(initialEditor.audience);
  const [tone, setTone] = useState<WorkItemReportTone>(initialEditor.tone);
  const [content, setContent] = useState(initialEditor.content);
  const [baseline, setBaseline] = useState<ReportEditorBaseline>(initialEditor);
  const [loading, setLoading] = useState(true);
  const [listReady, setListReady] = useState(false);
  const [permissionsReady, setPermissionsReady] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [draftMissing, setDraftMissing] = useState(false);
  const [pending, setPending] = useState<"generate" | "save" | "confirm" | "discard" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);
  const generateKey = useRef(operationKey("report-generate"));
  const generateInput = useRef<string | null>(null);
  const commandKeys = useRef<Record<string, string>>({});
  const refreshSequence = useRef(0);
  const activeItemId = useRef(item.id);
  activeItemId.current = item.id;
  const lastItemRevision = useRef(item.revision);
  const audienceRef = useRef(audience);
  const toneRef = useRef(tone);
  const contentRef = useRef(content);
  const baselineRef = useRef(baseline);
  const dirtyRef = useRef(false);

  const selected = useMemo(
    () => drafts.find((draft) => draft.id === selectedId) ?? null,
    [drafts, selectedId],
  );
  const editorMatchesSelection = baseline.draftId === (selected?.id ?? null);
  const reportDirty = editorMatchesSelection && (
    !audiencesEqual(audience, baseline.audience)
    || tone !== baseline.tone
    || content !== baseline.content
  );
  dirtyRef.current = reportDirty;

  const hydrateEditor = useCallback((draft: WorkItemReportDraft | null, sourceItem: LocalWorkItem) => {
    const next = editorBaseline(draft, sourceItem);
    audienceRef.current = next.audience;
    toneRef.current = next.tone;
    contentRef.current = next.content;
    baselineRef.current = next;
    dirtyRef.current = false;
    setAudience(next.audience);
    setTone(next.tone);
    setContent(next.content);
    setBaseline(next);
  }, []);

  const restoreBaseline = useCallback(() => {
    const next = baselineRef.current;
    audienceRef.current = next.audience;
    toneRef.current = next.tone;
    contentRef.current = next.content;
    dirtyRef.current = false;
    setAudience(next.audience);
    setTone(next.tone);
    setContent(next.content);
  }, []);

  const changeAudience = (update: (current: WorkItemReportAudience) => WorkItemReportAudience) => {
    setAudience((current) => {
      const next = normalizeAudience(update(current));
      audienceRef.current = next;
      return next;
    });
  };

  const changeTone = (next: WorkItemReportTone) => {
    toneRef.current = next;
    setTone(next);
  };

  const changeContent = (next: string) => {
    contentRef.current = next;
    setContent(next);
  };

  const refresh = useCallback(async (preferredId?: string | null) => {
    if (activeItemId.current !== item.id) return false;
    const sequence = ++refreshSequence.current;
    setLoading(true);
    setPermissionsReady(false);
    try {
      const result = await workItemReportApi.list(item.id);
      if (sequence !== refreshSequence.current || activeItemId.current !== item.id) return false;
      const editedDraftId = baselineRef.current.draftId;
      if (dirtyRef.current && editedDraftId && !result.reportDrafts.some((draft) => draft.id === editedDraftId)) {
        setDraftMissing(true);
        setLoadError(null);
        return false;
      }
      setDrafts(result.reportDrafts);
      setSelectedId((current) => {
        const requested = preferredId ?? current;
        if (requested && result.reportDrafts.some((draft) => draft.id === requested)) return requested;
        return result.reportDrafts.find((draft) => draft.status === "draft")?.id
          ?? result.reportDrafts.find((draft) => draft.status === "confirmed")?.id
          ?? result.reportDrafts[0]?.id
          ?? null;
      });
      setListReady(true);
      setPermissionsReady(true);
      setLoadError(null);
      setDraftMissing(false);
      setError(null);
      return true;
    } catch (caught) {
      if (sequence !== refreshSequence.current || activeItemId.current !== item.id) return false;
      setLoadError(caught instanceof Error ? caught.message : "");
      setPermissionsReady(false);
      return false;
    } finally {
      if (sequence === refreshSequence.current && activeItemId.current === item.id) setLoading(false);
    }
  }, [item.id]);

  useEffect(() => {
    activeItemId.current = item.id;
    lastItemRevision.current = item.revision;
    refreshSequence.current += 1;
    setDrafts([]);
    setSelectedId(null);
    setListReady(false);
    setPermissionsReady(false);
    setLoading(true);
    setLoadError(null);
    setDraftMissing(false);
    setNotice(null);
    setError(null);
    setConfirmOpen(false);
    setDiscardOpen(false);
    setPending(null);
    generateKey.current = operationKey("report-generate");
    generateInput.current = null;
    commandKeys.current = {};
    hydrateEditor(null, item);
    void refresh(null);
  }, [hydrateEditor, item.id, refresh]);

  useEffect(() => {
    if (activeItemId.current !== item.id || lastItemRevision.current === item.revision) return;
    lastItemRevision.current = item.revision;
    if (!dirtyRef.current && !selectedId) hydrateEditor(null, item);
    if (listReady) void refresh(selectedId);
  }, [hydrateEditor, item, listReady, refresh, selectedId]);

  useEffect(() => {
    if (!selected || selected.workItemId !== item.id) return;
    if (baselineRef.current.draftId === selected.id && dirtyRef.current) return;
    hydrateEditor(selected, item);
    setError(null);
    setNotice(null);
  }, [hydrateEditor, item, selected]);

  useEffect(() => {
    onDirtyChange?.(reportDirty);
  }, [onDirtyChange, reportDirty]);
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);

  const reportNavigation = useSafeNavigation(reportDirty);

  const commandKey = (draftId: string, command: "confirm" | "discard") => {
    const mapKey = `${draftId}:${command}`;
    return commandKeys.current[mapKey] ??= operationKey(`report-${command}`);
  };

  const applyServerDraft = (draft: WorkItemReportDraft) => {
    if (activeItemId.current !== item.id || draft.workItemId !== item.id) return false;
    setDrafts((current) => current.some((row) => row.id === draft.id)
      ? current.map((row) => row.id === draft.id ? draft : row)
      : [draft, ...current]);
    setSelectedId(draft.id);
    hydrateEditor(draft, item);
    return true;
  };

  const complete = async (draft: WorkItemReportDraft, message: string) => {
    if (!applyServerDraft(draft)) return false;
    const refreshed = await refresh(draft.id);
    if (activeItemId.current !== item.id) return false;
    setNotice(message);
    await onChanged?.();
    return refreshed;
  };

  const handleFailure = async (caught: unknown, nonConflictMessage?: string) => {
    if (activeItemId.current !== item.id) return;
    const conflict = caught instanceof ApiError && caught.status === 409;
    if (conflict) await refresh(selectedId);
    if (activeItemId.current !== item.id) return;
    setError(conflict
      ? t("taskReport.conflict")
      : nonConflictMessage ?? (caught instanceof Error ? caught.message : t("taskReport.actionFailed")));
  };

  const generate = async () => {
    if (pending || !permissionsReady) return;
    const currentAudience = audienceRef.current;
    const currentTone = toneRef.current;
    const input = JSON.stringify({ audience: currentAudience, tone: currentTone, locale });
    if (generateInput.current !== null && generateInput.current !== input) {
      generateKey.current = operationKey("report-generate");
    }
    generateInput.current = input;
    setPending("generate");
    setError(null);
    setNotice(null);
    try {
      const result = await workItemReportApi.generate(item.id, {
        expectedWorkItemRevision: item.revision,
        idempotencyKey: generateKey.current,
        audience: currentAudience,
        tone: currentTone,
        locale,
      });
      if (activeItemId.current !== item.id) return;
      generateKey.current = operationKey("report-generate");
      generateInput.current = null;
      await complete(result.reportDraft, t("taskReport.generated"));
    } catch (caught) {
      await handleFailure(caught);
    } finally {
      if (activeItemId.current === item.id) setPending(null);
    }
  };

  const persistDraft = async (draft: WorkItemReportDraft) => {
    const result = await workItemReportApi.update(item.id, draft.id, {
      expectedRevision: draft.revision,
      audience: audienceRef.current,
      tone: toneRef.current,
      content: contentRef.current.trim(),
    });
    return applyServerDraft(result.reportDraft) ? result.reportDraft : null;
  };

  const save = async (afterSave?: () => void) => {
    if (!selected || pending || !permissionsReady || !selected.canEdit || !contentRef.current.trim()) return;
    setPending("save");
    setError(null);
    setNotice(null);
    let succeeded = false;
    try {
      const saved = await persistDraft(selected);
      if (!saved) return;
      succeeded = await complete(saved, t("taskReport.saved"));
    } catch (caught) {
      await handleFailure(caught);
    } finally {
      if (activeItemId.current === item.id) setPending(null);
    }
    if (succeeded) afterSave?.();
  };

  const confirm = async () => {
    if (!selected || pending || !permissionsReady || !selected.canConfirm || !contentRef.current.trim()) return;
    setPending("confirm");
    setError(null);
    setNotice(null);
    let draftToConfirm = selected;
    let savedBeforeConfirm = false;
    try {
      if (dirtyRef.current) {
        try {
          const saved = await persistDraft(selected);
          if (!saved) return;
          draftToConfirm = saved;
          savedBeforeConfirm = true;
        } catch (caught) {
          await handleFailure(caught, t("taskReport.confirmSaveFailed"));
          return;
        }
      }
      try {
        const result = await workItemReportApi.confirm(item.id, draftToConfirm.id, {
          expectedRevision: draftToConfirm.revision,
          idempotencyKey: commandKey(draftToConfirm.id, "confirm"),
        });
        if (activeItemId.current !== item.id) return;
        delete commandKeys.current[`${draftToConfirm.id}:confirm`];
        setConfirmOpen(false);
        await complete(result.reportDraft, t("taskReport.confirmed"));
      } catch (caught) {
        await handleFailure(caught, savedBeforeConfirm ? t("taskReport.confirmAfterSaveFailed") : undefined);
      }
    } finally {
      if (activeItemId.current === item.id) setPending(null);
    }
  };

  const discard = async () => {
    if (!selected || pending || !permissionsReady || selected.status !== "draft") return;
    setPending("discard");
    setError(null);
    try {
      const result = await workItemReportApi.discard(item.id, selected.id, {
        expectedRevision: selected.revision,
        idempotencyKey: commandKey(selected.id, "discard"),
      });
      if (activeItemId.current !== item.id) return;
      delete commandKeys.current[`${selected.id}:discard`];
      setDiscardOpen(false);
      await complete(result.reportDraft, t("taskReport.discarded"));
    } catch (caught) {
      await handleFailure(caught);
    } finally {
      if (activeItemId.current === item.id) setPending(null);
    }
  };

  const audienceFields = (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label={t("taskReport.audience")}>
        <Select
          value={audience.relation}
          disabled={Boolean(pending) || !permissionsReady || Boolean(selected && !selected.canEdit)}
          onChange={(event) => changeAudience((current) => {
            const relation = event.target.value as WorkItemRequesterRelation;
            if (relation === current.relation) return current;
            return {
              relation,
              name: relation === "self" ? null : current.name,
              organization: relation === "self" ? null : current.organization,
              userId: null,
            };
          })}
        >
          {RELATIONS.map((relation) => <option key={relation} value={relation}>{t(`taskFollowUp.relation.${relation}`)}</option>)}
        </Select>
      </Field>
      <Field label={t("taskReport.tone")}>
        <Select
          value={tone}
          disabled={Boolean(pending) || !permissionsReady || Boolean(selected && !selected.canEdit)}
          onChange={(event) => changeTone(event.target.value as WorkItemReportTone)}
        >
          {TONES.map((value) => <option key={value} value={value}>{t(`taskReport.toneOption.${value}`)}</option>)}
        </Select>
      </Field>
      {audience.relation !== "self" ? (
        <>
          <Field label={t("taskReport.audienceName")}>
            <Input
              value={audience.name ?? ""}
              disabled={Boolean(pending) || !permissionsReady || Boolean(selected && !selected.canEdit)}
              onChange={(event) => changeAudience((current) => ({
                ...current,
                name: event.target.value || null,
                userId: null,
              }))}
            />
          </Field>
          <Field label={t("taskReport.organization")}>
            <Input
              value={audience.organization ?? ""}
              disabled={Boolean(pending) || !permissionsReady || Boolean(selected && !selected.canEdit)}
              onChange={(event) => changeAudience((current) => ({
                ...current,
                organization: event.target.value || null,
                userId: null,
              }))}
            />
          </Field>
        </>
      ) : null}
    </div>
  );

  const unsavedModal = (
    <Modal
      open={reportNavigation.pendingNavigation}
      title={t("taskReport.unsavedTitle")}
      description={t("taskReport.unsavedDescription")}
      onClose={reportNavigation.cancelNavigation}
    >
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="secondary" onClick={reportNavigation.cancelNavigation}>{t("shared.cancel")}</Button>
        <Button
          variant="destructive"
          onClick={() => {
            restoreBaseline();
            reportNavigation.discardAndContinue();
          }}
        >
          {t("taskReport.discardChanges")}
        </Button>
        {permissionsReady && selected?.canEdit && content.trim() ? (
          <Button onClick={() => reportNavigation.saveAndContinue((action) => { void save(action); })}>
            {t("taskReport.save")}
          </Button>
        ) : null}
      </div>
    </Modal>
  );

  if (loading && !listReady) {
    return <p className="text-sm text-muted-foreground" role="status">{t("taskReport.loading")}</p>;
  }

  if (!listReady) {
    return (
      <section className="space-y-4 rounded-md border border-destructive/40 p-4" aria-labelledby={`work-item-report-title-${item.id}`}>
        <div role="alert">
          <h3 id={`work-item-report-title-${item.id}`} className="text-sm font-semibold text-destructive">{t("taskReport.loadFailed")}</h3>
          <p className="mt-1 text-xs text-muted-foreground">{t("taskReport.loadFailedDescription")}</p>
          {loadError ? <p className="mt-1 text-xs text-destructive">{loadError}</p> : null}
        </div>
        <div className="flex justify-end">
          <Button variant="secondary" size="sm" disabled={loading} onClick={() => void refresh(null)}>
            {t("taskReport.retry")}
          </Button>
        </div>
      </section>
    );
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
        {loadError ? <p className="text-sm text-destructive" role="alert">{t("taskReport.loadFailed")} {loadError}</p> : null}
        {error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}
        <div className="flex flex-wrap justify-end gap-2">
          {loadError ? (
            <Button variant="secondary" size="sm" onClick={() => reportNavigation.requestNavigation(() => { void refresh(null); })}>
              {t("taskReport.retry")}
            </Button>
          ) : null}
          <Button size="sm" disabled={Boolean(pending) || !permissionsReady} onClick={() => void generate()}>
            {pending === "generate" ? t("taskReport.generating") : t("taskReport.generate")}
          </Button>
        </div>
        {unsavedModal}
      </section>
    );
  }

  if (!selected) return null;
  const readOnly = !permissionsReady || !selected.canEdit;

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
        <Textarea
          value={content}
          rows={10}
          maxLength={20_000}
          disabled={Boolean(pending) || readOnly}
          onChange={(event) => changeContent(event.target.value)}
        />
      </Field>

      <div className="rounded-md border border-border bg-muted/30 p-3 text-xs">
        <p className="font-medium">{t("taskReport.generation")}</p>
        <p className="mt-1">
          {selected.generation.generator === "structured"
            ? t("taskReport.structuredGenerator")
            : selected.generation.generator}
          {` · ${t("taskReport.policyVersion", { policy: selected.generation.policyVersion })}`}
        </p>
        <p className="mt-1 text-muted-foreground">
          {selected.generation.modelVersion
            ? t("taskReport.modelVersion", { model: selected.generation.modelVersion })
            : t("taskReport.noModel")}
        </p>
      </div>

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

      {loadError ? <p className="text-sm text-destructive" role="alert">{t("taskReport.loadFailed")} {loadError}</p> : null}
      {draftMissing ? <p className="text-sm text-destructive" role="alert">{t("taskReport.draftMissing")}</p> : null}
      {error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}
      {notice ? <p className="text-sm text-success" role="status">{notice}</p> : null}

      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button
          variant="ghost"
          size="sm"
          disabled={Boolean(pending)}
          onClick={() => reportNavigation.requestNavigation(() => { void refresh(selected.id); })}
        >
          <RefreshCw aria-hidden />{t("taskReport.refresh")}
        </Button>
        {selected.status === "draft" ? (
          <Button variant="destructive" size="sm" disabled={Boolean(pending) || !permissionsReady} onClick={() => setDiscardOpen(true)}>{t("taskReport.discard")}</Button>
        ) : null}
        <Button
          variant="secondary"
          size="sm"
          disabled={Boolean(pending) || !permissionsReady}
          onClick={() => reportNavigation.requestNavigation(() => { void generate(); })}
        >
          {pending === "generate" ? t("taskReport.generating") : t("taskReport.regenerate")}
        </Button>
        {selected.canEdit ? (
          <Button variant="secondary" size="sm" disabled={Boolean(pending) || !permissionsReady || !content.trim()} onClick={() => { void save(); }}>
            {pending === "save" ? t("taskReport.saving") : t("taskReport.save")}
          </Button>
        ) : null}
        {selected.canConfirm ? (
          <Button size="sm" disabled={Boolean(pending) || !permissionsReady || !content.trim()} onClick={() => setConfirmOpen(true)}>{t("taskReport.confirm")}</Button>
        ) : null}
      </div>

      <div className="border-t border-border pt-3">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("taskReport.history")}</h4>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {drafts.map((draft) => (
            <button
              key={draft.id}
              type="button"
              aria-pressed={draft.id === selected.id}
              onClick={() => reportNavigation.requestNavigation(() => setSelectedId(draft.id))}
              className={`rounded-md border p-2 text-left text-xs ${draft.id === selected.id ? "border-primary bg-primary/5" : "border-border hover:bg-muted/50"}`}
            >
              <span className="flex items-center justify-between gap-2">
                <span className="font-medium">{draft.stale ? t("taskReport.status.stale") : t(`taskReport.status.${draft.status}`)}</span>
                <span className="text-muted-foreground">v{draft.revision}</span>
              </span>
              <span className="mt-1 block text-muted-foreground">{new Date(draft.updatedAt).toLocaleString(locale)}</span>
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
        onConfirm={() => { void confirm(); }}
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
        onConfirm={() => { void discard(); }}
      />
      {unsavedModal}
    </section>
  );
}

export default WorkItemReportSection;
