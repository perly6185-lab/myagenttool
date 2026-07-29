import {
  Check,
  FolderLock,
  History,
  Pencil,
  Trash2,
  X,
} from "lucide-react";
import { useState } from "react";

import { ConfirmModal } from "@/components/common/confirm-modal";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/input";
import { useConsoleState, useRefreshConsoleState } from "@/data/use-console-state";
import { api } from "@/lib/api-client";
import { i18n } from "@/lib/i18n";
import { useAppTranslation } from "@/lib/i18n/use-app-translation";
import type {
  WorkProfileAuditEvent,
  WorkProfileCategory,
  WorkProfileInference,
  WorkProfileStatus,
} from "@/lib/console-state";

const CATEGORIES: WorkProfileCategory[] = ["role", "domain", "work_type", "skill", "preference"];

export function WorkProfileReview() {
  const { t } = useAppTranslation();
  const { data: state } = useConsoleState();
  const refresh = useRefreshConsoleState();
  const inferences = state?.workProfileInferences ?? [];
  const audits = state?.workProfileAuditEvents ?? [];
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftCategory, setDraftCategory] = useState<WorkProfileCategory>("work_type");
  const [draftValue, setDraftValue] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<WorkProfileInference | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function startEditing(inference: WorkProfileInference) {
    setEditingId(inference.id);
    setDraftCategory(inference.category);
    setDraftValue(displayValue(inference.value, t));
    setError(null);
  }

  async function run(id: string, operation: () => Promise<unknown>, after?: () => void) {
    setPendingId(id);
    setError(null);
    try {
      await operation();
      await refresh();
      after?.();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setPendingId(null);
    }
  }

  async function saveCorrection(inference: WorkProfileInference) {
    const value = draftValue.trim();
    if (!value) return;
    await run(
      inference.id,
      () => api.updateWorkProfileInference(inference.id, {
        category: draftCategory,
        value,
        reason: t("workProfile.auditReason"),
      }),
      () => setEditingId(null),
    );
  }

  async function deleteInference() {
    if (!deleteTarget) return;
    const target = deleteTarget;
    await run(
      target.id,
      () => api.deleteWorkProfileInference(target.id, t("workProfile.deleteReason")),
      () => {
        setDeleteTarget(null);
        if (editingId === target.id) setEditingId(null);
      },
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <CardTitle>{t("workProfile.title")}</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">{t("workProfile.description")}</p>
          </div>
          <Badge tone={inferences.some((row) => row.status === "pending") ? "warning" : "neutral"}>
            {t("workProfile.pendingCount", {
              count: inferences.filter((row) => row.status === "pending").length,
            })}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {error ? (
          <p className="rounded-lg border border-destructive/40 px-3 py-2 text-sm text-destructive" role="alert">
            {error}
          </p>
        ) : null}

        {inferences.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
            {t("workProfile.empty")}
          </div>
        ) : (
          inferences.map((inference) => {
            const editing = editingId === inference.id;
            const pending = pendingId === inference.id;
            return (
              <article key={inference.id} className="rounded-xl border border-border p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      {t("workProfile.systemUnderstanding")}
                    </p>
                    {editing ? (
                      <div className="mt-2 grid gap-2 sm:grid-cols-[10rem_1fr]">
                        <label className="space-y-1 text-xs">
                          <span>{t("workProfile.classification")}</span>
                          <Select
                            aria-label={t("workProfile.classification")}
                            value={draftCategory}
                            onChange={(event) => setDraftCategory(event.target.value as WorkProfileCategory)}
                          >
                            {CATEGORIES.map((category) => (
                              <option key={category} value={category}>
                                {t(`workProfile.category.${category}`)}
                              </option>
                            ))}
                          </Select>
                        </label>
                        <label className="space-y-1 text-xs">
                          <span>{t("workProfile.understanding")}</span>
                          <Input
                            aria-label={t("workProfile.understanding")}
                            value={draftValue}
                            maxLength={120}
                            onChange={(event) => setDraftValue(event.target.value)}
                          />
                        </label>
                      </div>
                    ) : (
                      <h3 className="mt-1 text-base font-semibold">
                        {t(`workProfile.category.${inference.category}`)} · {displayValue(inference.value, t)}
                      </h3>
                    )}
                  </div>
                  <Status status={inference.status} />
                </div>

                <div className="mt-3 rounded-lg bg-muted/40 p-3">
                  <div className="mb-2 flex items-center gap-2 text-xs font-medium">
                    <FolderLock className="size-4" aria-hidden="true" />
                    {t("workProfile.evidenceSource")}
                  </div>
                  {inference.evidence.length ? inference.evidence.map((evidence) => (
                    <div key={`${inference.id}-${evidence.projectId}`} className="text-xs">
                      <span className="font-medium">{evidence.projectName ?? evidence.projectId}</span>
                      <code
                        className="mt-1 block break-all rounded bg-background px-2 py-1 text-muted-foreground"
                        title={evidence.authorizedDirectory}
                      >
                        {evidence.authorizedDirectory}
                      </code>
                      <span className="mt-1 block text-muted-foreground">
                        {t("workProfile.authorizedDirectory")}
                      </span>
                    </div>
                  )) : (
                    <span className="text-xs text-muted-foreground">{t("workProfile.noEvidence")}</span>
                  )}
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {editing ? (
                    <>
                      <Button
                        size="sm"
                        disabled={pending || !draftValue.trim()}
                        onClick={() => saveCorrection(inference)}
                      >
                        <Check />{t("workProfile.saveCorrection")}
                      </Button>
                      <Button size="sm" variant="secondary" disabled={pending} onClick={() => setEditingId(null)}>
                        <X />{t("shared.cancel")}
                      </Button>
                    </>
                  ) : (
                    <>
                      <Button
                        size="sm"
                        disabled={pending || inference.status === "confirmed"}
                        onClick={() => run(inference.id, () => api.confirmWorkProfileInference(inference.id))}
                      >
                        <Check />{t("workProfile.confirm")}
                      </Button>
                      <Button size="sm" variant="secondary" disabled={pending} onClick={() => startEditing(inference)}>
                        <Pencil />{t("workProfile.modify")}
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={pending || inference.status === "rejected"}
                        onClick={() => run(
                          inference.id,
                          () => api.rejectWorkProfileInference(inference.id, t("workProfile.rejectReason")),
                        )}
                      >
                        <X />{t("workProfile.reject")}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={pending}
                        className="text-destructive"
                        onClick={() => setDeleteTarget(inference)}
                      >
                        <Trash2 />{t("workProfile.delete")}
                      </Button>
                    </>
                  )}
                  <span className="ml-auto text-xs text-muted-foreground">
                    {t("workProfile.confidence", { value: Math.round(inference.confidence * 100) })}
                  </span>
                </div>
              </article>
            );
          })
        )}

        <AuditHistory audits={audits} />
      </CardContent>

      <ConfirmModal
        open={Boolean(deleteTarget)}
        title={t("workProfile.deleteTitle")}
        description={t("workProfile.deleteDescription")}
        confirmLabel={t("workProfile.delete")}
        destructive
        pending={Boolean(deleteTarget && pendingId === deleteTarget.id)}
        onConfirm={deleteInference}
        onClose={() => setDeleteTarget(null)}
      />
    </Card>
  );
}

function Status({ status }: { status: WorkProfileStatus }) {
  const { t } = useAppTranslation();
  const tone = status === "confirmed" ? "success" : status === "rejected" ? "danger" : "warning";
  return <Badge tone={tone}>{t(`workProfile.status.${status}`)}</Badge>;
}

function AuditHistory({ audits }: { audits: WorkProfileAuditEvent[] }) {
  const { t } = useAppTranslation();
  return (
    <section aria-labelledby="work-profile-audit-title" className="border-t border-border pt-4">
      <div className="flex items-center gap-2">
        <History className="size-4 text-muted-foreground" aria-hidden="true" />
        <h3 id="work-profile-audit-title" className="text-sm font-semibold">{t("workProfile.auditTitle")}</h3>
        <Badge tone="neutral">{audits.length}</Badge>
      </div>
      {audits.length === 0 ? (
        <p className="mt-2 text-xs text-muted-foreground">{t("workProfile.auditEmpty")}</p>
      ) : (
        <ol className="mt-2 space-y-2">
          {audits.slice(0, 8).map((audit) => (
            <li key={audit.id} className="rounded-lg border border-border px-3 py-2 text-xs">
              <div className="flex flex-wrap justify-between gap-2">
                <span className="font-medium">{t(`workProfile.auditAction.${audit.action}`)}</span>
                <time className="text-muted-foreground">
                  {new Date(audit.at).toLocaleString(i18n.resolvedLanguage)}
                </time>
              </div>
              <p className="mt-1 text-muted-foreground">
                {audit.action === "modified" && audit.after
                  ? t("workProfile.auditChange", {
                    before: `${t(`workProfile.category.${audit.before.category}`)} · ${displayValue(audit.before.value, t)}`,
                    after: `${t(`workProfile.category.${audit.after.category}`)} · ${displayValue(audit.after.value, t)}`,
                  })
                  : t("workProfile.auditActor", { actor: audit.actorId })}
              </p>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function displayValue(value: string, t: ReturnType<typeof useAppTranslation>["t"]) {
  return value === "software_development" ? t("workProfile.value.software_development") : value;
}
