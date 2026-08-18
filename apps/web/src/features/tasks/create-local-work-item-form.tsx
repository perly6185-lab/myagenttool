import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Field } from "@/components/common/field";
import { useAsyncAction, api } from "@/data/use-console-actions";
import { useAppTranslation } from "@/lib/i18n/use-app-translation";
import type { LocalWorkItem } from "./task-view-types";
import type { ArticleInspection } from "./article-workflow-types";
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
}: {
  projects: { id: string; name: string }[];
  users: WorkItemFollowUpUser[];
  initialProjectId: string;
  onDone: () => void;
}) {
  const { t, i18n } = useAppTranslation();
  const plannedDateLabel = i18n.language.startsWith("zh") ? "计划 AI 执行日期" : "Planned AI execution date";
  const expectedCompletionLabel = i18n.language.startsWith("zh") ? "预期完成日期" : "Expected completion date";
  const verificationSopLabel = i18n.language.startsWith("zh") ? "检查步骤" : "Verification steps";
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
  const inspectionRequest = useRef(0);

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
      const aiTask = sourceMode === "url";
      await api.createWorkItem({
        projectId,
        title,
        body: aiTask && inspection
          ? [
            body,
            `Source: ${inspection.canonicalUrl}`,
            `Detected as ${inspection.provider} / ${inspection.contentType}.`,
          ].filter(Boolean).join("\n\n")
          : body,
        type,
        status: aiTask ? "ready" : "backlog",
        priority,
        executionPolicy: aiTask ? "auto" : "manual",
        labels: labels.split(",").map((value) => value.trim()).filter(Boolean),
        acceptanceCriteria: acceptance.split("\n").map((value) => value.trim()).filter(Boolean),
        verificationSop: verificationSop.split("\n").map((value) => value.trim()).filter(Boolean),
        ...(assigneeIds.length ? { assigneeIds } : {}),
        dueDate: dueDate || null,
        milestone,
        estimatePoints: Number(estimatePoints),
        ...followUpPayload(followUp),
        waitingOn: aiTask ? "ai" : followUp.waitingOn,
        plannedDate: aiTask ? (plannedDate || localDateKey()) : (plannedDate || null),
      });
      return { completed: true };
    }).then((ok) => {
      if (ok) onDone();
    });
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
        disabled={pending}
      />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Field label={plannedDateLabel}><Input type="date" value={plannedDate} onChange={(event) => setPlannedDate(event.target.value)} /></Field>
        <Field label={expectedCompletionLabel}><Input type="date" required value={dueDate} onChange={(event) => setDueDate(event.target.value)} /></Field>
        <Field label={t("taskLocal.milestone")}><Input value={milestone} onChange={(event) => setMilestone(event.target.value)} /></Field>
        <Field label={t("planningInsights.estimatePoints")}><Input type="number" min="0" max="1000" value={estimatePoints} onChange={(event) => setEstimatePoints(event.target.value)} /></Field>
      </div>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
      <div className="flex justify-end gap-2">
        <Button
          disabled={pending || Boolean(validateFollowUpDraft(followUp)) || !projectId || !dueDate || !title.trim() || (sourceMode === "url" && (!sourceUrl.trim() || !inspection))}
          onClick={submit}
        >
          {sourceMode === "url"
            ? articleText.createAndRun
            : t("tasks.createLocal")}
        </Button>
      </div>
    </div>
  );
}

function localDateKey(value = new Date()) {
  const local = new Date(value.getTime() - value.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

function mergeCommaLabels(current: string, additions: string[]) {
  return [...new Set([
    ...current.split(",").map((value) => value.trim()).filter(Boolean),
    ...additions.filter(Boolean),
  ])].join(", ");
}
