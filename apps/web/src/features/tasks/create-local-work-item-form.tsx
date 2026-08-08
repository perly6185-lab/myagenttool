import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Field } from "@/components/common/field";
import { useAsyncAction, api } from "@/data/use-console-actions";
import { useAppTranslation } from "@/lib/i18n/use-app-translation";
import type { LocalWorkItem } from "./task-view-types";
import type { ArticleImportJob, ArticleInspection } from "./article-workflow-types";
import { articleApi } from "./article-workflow-api";
import ArticleImportFields from "./article-import-fields";
import { useArticleTaskLabels } from "./article-task-labels";
import {
  DEFAULT_WORK_ITEM_FOLLOW_UP_DRAFT,
  followUpPayload,
  validateFollowUpDraft,
  type WorkItemFollowUpDraft,
  type WorkItemFollowUpUser,
} from "./work-item-follow-up-model";
import { WorkItemFollowUpFields } from "./work-item-follow-up-fields";

export default function CreateLocalWorkItemForm({
  projects,
  users,
  initialProjectId,
  onDone,
  onImportActivityChange,
}: {
  projects: { id: string; name: string }[];
  users: WorkItemFollowUpUser[];
  initialProjectId: string;
  onDone: () => void;
  onImportActivityChange: (active: boolean) => void;
}) {
  const { t, i18n } = useAppTranslation();
  const plannedDateLabel = i18n.language.startsWith("zh") ? "计划 AI 执行日期" : "Planned AI execution date";
  const expectedCompletionLabel = i18n.language.startsWith("zh") ? "预期完成日期" : "Expected completion date";
  const verificationSopLabel = i18n.language.startsWith("zh") ? "验收 SOP" : "Verification SOP";
  const articleText = useArticleTaskLabels();
  const { execute, pending, error } = useAsyncAction();
  const [projectId, setProjectId] = useState(initialProjectId);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [type, setType] = useState<LocalWorkItem["type"]>("task");
  const [priority, setPriority] = useState<LocalWorkItem["priority"]>("p2");
  const [labels, setLabels] = useState("");
  const [acceptance, setAcceptance] = useState("");
  const [verificationSop, setVerificationSop] = useState("");
  const [plannedDate, setPlannedDate] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [milestone, setMilestone] = useState("");
  const [estimatePoints, setEstimatePoints] = useState("0");
  const [assigneeIds, setAssigneeIds] = useState<string[]>([]);
  const [followUp, setFollowUp] = useState<WorkItemFollowUpDraft>({ ...DEFAULT_WORK_ITEM_FOLLOW_UP_DRAFT });
  const [assistNote, setAssistNote] = useState("");
  const [sourceMode, setSourceMode] = useState<"manual" | "url">("manual");
  const [sourceUrl, setSourceUrl] = useState("");
  const [inspection, setInspection] = useState<ArticleInspection | null>(null);
  const [activeImport, setActiveImport] = useState<{ workItemId: string; jobId: string } | null>(null);
  const [importStatus, setImportStatus] = useState("");
  const [createdWorkItemId, setCreatedWorkItemId] = useState<string | null>(null);
  const [createdWorktreeId, setCreatedWorktreeId] = useState<string | null>(null);
  const inspectionRequest = useRef(0);
  const resumeAttempted = useRef(false);

  useEffect(() => {
    onImportActivityChange(Boolean(activeImport));
    return () => onImportActivityChange(false);
  }, [activeImport, onImportActivityChange]);

  const trackImport = async (workItemId: string, jobId: string) => {
    setActiveImport({ workItemId, jobId });
    try {
      const job = await waitForArticleImport(workItemId, jobId, (next) => {
        setImportStatus(articleText.importState[next.state]);
      });
      if (job.state === "completed" || job.state === "canceled") clearStoredArticleImport(workItemId, jobId);
      if (job.state !== "completed") {
        const message = job.error === "article_import_interrupted"
          ? articleText.interrupted
          : articleText.importState[job.state];
        setImportStatus(message);
        throw new Error(message);
      }
      setImportStatus(articleText.importState.completed);
      return job;
    } finally {
      setActiveImport(null);
    }
  };

  useEffect(() => {
    if (resumeAttempted.current) return;
    resumeAttempted.current = true;
    const stored = readStoredArticleImport();
    if (!stored || !projects.some((project) => project.id === stored.projectId)) return;
    setProjectId(stored.projectId);
    setCreatedWorkItemId(stored.workItemId);
    setCreatedWorktreeId(stored.worktreeId);
    setSourceMode("url");
    setFollowUp((current) => ({ ...current, intakeChannel: "import" }));
    setSourceUrl(stored.sourceUrl);
    void execute(() => trackImport(stored.workItemId, stored.jobId)).then((ok) => {
      if (ok) onDone();
    });
    // Resume exactly once from the browser hand-off.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const assist = () => {
    let draft: {
      body: string;
      type: LocalWorkItem["type"];
      priority: LocalWorkItem["priority"];
      acceptanceCriteria: string[];
      verificationSop: string[];
      suggestedRoute: string;
      risks: string[];
      evidence: { generator: string; policyVersion: string; confidence: number };
    } | null = null;
    void execute(async () => {
      const result = await api.suggestWorkItemDraft({ projectId, title, body }) as { draft: NonNullable<typeof draft> };
      draft = result.draft;
      return result;
    }).then((ok) => {
      if (!ok || !draft) return;
      setBody(draft.body);
      setType(draft.type);
      setPriority(draft.priority);
      setAcceptance(draft.acceptanceCriteria.join("\n"));
      setVerificationSop(draft.verificationSop.join("\n"));
      setAssistNote(
        `Suggested route: ${draft.suggestedRoute}. ${draft.evidence.generator} ${Math.round(draft.evidence.confidence * 100)}%. ${draft.risks.join(" ")}`,
      );
    });
  };

  const inspectSource = () => {
    const requestId = ++inspectionRequest.current;
    const requestedUrl = sourceUrl.trim();
    let nextInspection: ArticleInspection | null = null;
    setInspection(null);
    void execute(async () => {
      const result = await articleApi.inspect({ projectId, url: requestedUrl }) as { inspection: ArticleInspection };
      nextInspection = result.inspection;
      return result;
    }).then((ok) => {
      if (!ok || !nextInspection || inspectionRequest.current !== requestId) return;
      setInspection(nextInspection);
      if (!title.trim()) setTitle(nextInspection.title);
      setLabels((current) => mergeCommaLabels(current, [
        `source:${nextInspection?.provider}`,
        `content:${nextInspection?.contentType}`,
      ]));
    });
  };

  const submit = () => {
    if (validateFollowUpDraft(followUp)) return;
    void execute(async () => {
      let workItemId = createdWorkItemId;
      if (!workItemId) {
        const created = await api.createWorkItem({
          projectId,
          title,
          body: sourceMode === "url" && inspection
            ? [
              body,
              `Source: ${inspection.canonicalUrl}`,
              `Detected as ${inspection.provider} / ${inspection.contentType}.`,
            ].filter(Boolean).join("\n\n")
            : body,
          type,
          priority,
          labels: labels.split(",").map((value) => value.trim()).filter(Boolean),
          acceptanceCriteria: acceptance.split("\n").map((value) => value.trim()).filter(Boolean),
          verificationSop: verificationSop.split("\n").map((value) => value.trim()).filter(Boolean),
          assigneeIds,
          plannedDate: plannedDate || null,
          dueDate: dueDate || null,
          milestone,
          estimatePoints: Number(estimatePoints),
          ...followUpPayload(followUp),
        }) as { workItem: { id: string } };
        workItemId = created.workItem.id;
        setCreatedWorkItemId(workItemId);
      }
      if (sourceMode === "manual") return { completed: true };
      let worktreeId = createdWorktreeId;
      if (!worktreeId) {
        setImportStatus(articleText.creatingWorktree);
        const createdWorktree = await api.createWorkItemWorktree(workItemId) as { worktree: { id: string } };
        worktreeId = createdWorktree.worktree.id;
        setCreatedWorktreeId(worktreeId);
      }
      setImportStatus(articleText.importQueued);
      const started = await articleApi.startImport(workItemId, {
        url: sourceUrl,
        worktreeId,
      }) as { job: ArticleImportJob };
      storeArticleImport({ projectId, workItemId, worktreeId, jobId: started.job.id, sourceUrl });
      if (started.job.state === "completed") {
        clearStoredArticleImport(workItemId, started.job.id);
        setImportStatus(articleText.importState.completed);
      } else {
        await trackImport(workItemId, started.job.id);
      }
      return { completed: true };
    }).then((ok) => {
      if (ok) onDone();
    });
  };

  const cancelImport = () => {
    if (!activeImport) return;
    void articleApi.cancelImport(activeImport.workItemId, activeImport.jobId)
      .then(() => setImportStatus(articleText.importState.canceled))
      .catch(() => setImportStatus(articleText.importState.failed));
  };

  return (
    <div className="space-y-3">
      <Field label={t("tasks.project")}>
        <Select value={projectId} onChange={(event) => {
          inspectionRequest.current += 1;
          setInspection(null);
          setProjectId(event.target.value);
        }}>
          {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
        </Select>
      </Field>
      <ArticleImportFields
        mode={sourceMode}
        sourceUrl={sourceUrl}
        projectId={projectId}
        inspection={inspection}
        pending={pending}
        onModeChange={(mode) => {
          setSourceMode(mode);
          setFollowUp((current) => ({
            ...current,
            intakeChannel: mode === "url"
              ? "import"
              : current.intakeChannel === "import" ? "manual" : current.intakeChannel,
          }));
        }}
        onUrlChange={(value) => {
          inspectionRequest.current += 1;
          setSourceUrl(value);
          setInspection(null);
        }}
        onInspect={inspectSource}
      />
      <Field label={t("tasks.localTitle")}>
        <Input value={title} onChange={(event) => setTitle(event.target.value)} autoFocus={sourceMode === "manual"} />
      </Field>
      <div className="flex items-center gap-2">
        <Button variant="secondary" disabled={pending || !projectId || !title.trim()} onClick={assist}>
          {t("aiOps.assist")}
        </Button>
        {assistNote ? <span className="text-xs text-muted-foreground">{assistNote}</span> : null}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t("tasks.type")}>
          <Select value={type} onChange={(event) => setType(event.target.value as LocalWorkItem["type"])}>
            {(["task", "bug", "feature", "initiative"] as const).map((value) => <option key={value} value={value}>{t(`tasks.localType.${value}`)}</option>)}
          </Select>
        </Field>
        <Field label={t("tasks.priority")}>
          <Select value={priority} onChange={(event) => setPriority(event.target.value as LocalWorkItem["priority"])}>
            {(["p0", "p1", "p2", "p3"] as const).map((value) => <option key={value} value={value}>{value.toUpperCase()}</option>)}
          </Select>
        </Field>
      </div>
      <Field label={t("tasks.descriptionField")}>
        <textarea className="min-h-24 w-full rounded-md border border-border bg-background p-2 text-sm" value={body} onChange={(event) => setBody(event.target.value)} />
      </Field>
      <Field label={t("tasks.labels")}>
        <Input value={labels} onChange={(event) => setLabels(event.target.value)} placeholder={t("tasks.labelsPlaceholder")} />
      </Field>
      <Field label={t("tasks.acceptanceCriteria")}>
        <textarea className="min-h-20 w-full rounded-md border border-border bg-background p-2 text-sm" value={acceptance} onChange={(event) => setAcceptance(event.target.value)} placeholder={t("tasks.acceptancePlaceholder")} />
      </Field>
      <Field label={verificationSopLabel}>
        <textarea className="min-h-20 w-full rounded-md border border-border bg-background p-2 text-sm" value={verificationSop} onChange={(event) => setVerificationSop(event.target.value)} placeholder={i18n.language.startsWith("zh") ? "每行一步；交给 AI 前请与完成标准一起确认。" : "One step per line; confirm together with completion criteria before AI starts."} />
      </Field>
      <WorkItemFollowUpFields
        value={followUp}
        onChange={setFollowUp}
        users={users}
        assigneeIds={assigneeIds}
        onAssigneeIdsChange={setAssigneeIds}
        disabled={pending || Boolean(createdWorkItemId)}
      />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Field label={plannedDateLabel}><Input type="date" value={plannedDate} onChange={(event) => setPlannedDate(event.target.value)} /></Field>
        <Field label={expectedCompletionLabel}><Input type="date" required value={dueDate} onChange={(event) => setDueDate(event.target.value)} /></Field>
        <Field label={t("taskLocal.milestone")}><Input value={milestone} onChange={(event) => setMilestone(event.target.value)} /></Field>
        <Field label={t("planningInsights.estimatePoints")}><Input type="number" min="0" max="1000" value={estimatePoints} onChange={(event) => setEstimatePoints(event.target.value)} /></Field>
      </div>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
      {importStatus ? <p className="text-xs text-muted-foreground">{importStatus}</p> : null}
      <div className="flex justify-end gap-2">
        {activeImport ? <Button variant="secondary" onClick={cancelImport}>{t("tasks.cancel")}</Button> : null}
        <Button
          disabled={pending || Boolean(validateFollowUpDraft(followUp)) || !projectId || (!dueDate && !createdWorkItemId) || (!title.trim() && !createdWorkItemId) || (sourceMode === "url" && (!sourceUrl.trim() || (!inspection && !createdWorkItemId)))}
          onClick={submit}
        >
          {sourceMode === "url"
            ? (createdWorkItemId ? articleText.retryImport : articleText.createAndImport)
            : t("tasks.createLocal")}
        </Button>
      </div>
    </div>
  );
}

function mergeCommaLabels(current: string, additions: string[]) {
  return [...new Set([
    ...current.split(",").map((value) => value.trim()).filter(Boolean),
    ...additions.filter(Boolean),
  ])].join(", ");
}

const ARTICLE_IMPORT_STORAGE_KEY = "myagenttool.article-import.active.v1";

type StoredArticleImport = {
  projectId: string;
  workItemId: string;
  worktreeId: string;
  jobId: string;
  sourceUrl: string;
};

async function waitForArticleImport(
  workItemId: string,
  jobId: string,
  onProgress: (job: ArticleImportJob) => void,
) {
  let job: ArticleImportJob;
  while (true) {
    const next = await articleApi.getImport(workItemId, jobId) as { job: ArticleImportJob };
    job = next.job;
    onProgress(job);
    if (!["queued", "running"].includes(job.state)) return job;
    await new Promise((resolve) => setTimeout(resolve, 750));
  }
}

function storeArticleImport(value: StoredArticleImport) {
  try {
    window.localStorage.setItem(ARTICLE_IMPORT_STORAGE_KEY, JSON.stringify(value));
  } catch {
    // The modal remains locked while the in-memory job is active.
  }
}

function readStoredArticleImport(): StoredArticleImport | null {
  try {
    const value = JSON.parse(window.localStorage.getItem(ARTICLE_IMPORT_STORAGE_KEY) ?? "null");
    if (!value || typeof value !== "object") return null;
    if (!["projectId", "workItemId", "worktreeId", "jobId", "sourceUrl"].every((key) => typeof value[key] === "string" && value[key])) {
      return null;
    }
    return value as StoredArticleImport;
  } catch {
    return null;
  }
}

function clearStoredArticleImport(workItemId: string, jobId: string) {
  const current = readStoredArticleImport();
  if (!current || (current.workItemId === workItemId && current.jobId === jobId)) {
    try {
      window.localStorage.removeItem(ARTICLE_IMPORT_STORAGE_KEY);
    } catch {
      // Ignore unavailable storage.
    }
  }
}
