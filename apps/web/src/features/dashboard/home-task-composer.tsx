import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, CalendarDays, CheckCircle2, ChevronDown, LoaderCircle, Plus, RefreshCw, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { useAppTranslation } from "@/lib/i18n/use-app-translation";
import { api } from "@/data/use-console-actions";
import {
  MAX_TASK_MATERIALS,
  TaskMaterialPicker,
  selectTaskMaterialFiles,
  type TaskMaterialSelection,
} from "@/features/dashboard/task-material-picker";
import type { TaskMaterialDraft } from "@/lib/api-client";
import type { LocalWorkItem } from "@/features/tasks/task-view-types";
import type { SectionKey } from "@/store/ui-store";
import { readinessSetupSection, type AutoRunReadiness } from "@/features/tasks/auto-run-readiness-ui";

type CreateMode = "task" | "ai";

function localDateKey(offsetDays = 0) {
  const value = new Date();
  value.setDate(value.getDate() + offsetDays);
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function clientKey() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `home-task-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function HomeTaskComposer({
  projectId,
  projectName,
  unavailable = false,
  onCreated,
  onOpenTask,
  onOpenSetup,
  onOpenProjects,
  open: openProp,
  onOpenChange,
  showTrigger = true,
  inline = false,
}: {
  projectId: string | null;
  projectName?: string | null;
  worktreeId?: string | null;
  terminalId?: string | null;
  unavailable?: boolean;
  onCreated: () => void;
  onOpenTask: (workItemId: string) => void;
  onOpenSetup?: (section: SectionKey) => void;
  onOpenProjects?: () => void;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  showTrigger?: boolean;
  inline?: boolean;
}) {
  const { i18n } = useAppTranslation();
  const zh = i18n.language.startsWith("zh");
  const copy = zh ? {
    title: "创建一个任务",
    description: "描述你希望最终完成的事情，系统会把它加入任务看板并持续跟踪。",
    placeholder: "例如：整理本周客户反馈，并输出按优先级排序的改进建议",
    due: "希望完成",
    criteria: "完成标准（可选）",
    criteriaHint: "每行一项，例如：覆盖全部反馈\n给出明确优先级\n输出可分享的文档",
    sop: "验收 SOP（交给 AI 前必填）",
    sopHint: "每行一步，例如：按真实使用流程检查结果\n核对自动验证证据\n确认风险后再审核通过",
    contractReview: "已生成执行方案草案。请先确认或修改完成标准和验收 SOP，再次点击“创建并交给 AI”才会启动。",
    more: "补充完成标准或参考资料",
    attach: "添加参考文件",
    attachDrop: "拖放文件到这里，或点击选择文件",
    attachLimit: "最多 6 个文件，每个不超过 5MB",
    retryAttachment: "重试",
    removeAttachment: "移除 {{name}}",
    attachmentRejected: "部分文件未能添加。单个文件不能超过 5MB，最多添加 6 个非空文件。",
    attachmentUploadFailed: "参考文件上传失败，任务尚未创建。请重试或先移除文件。",
    create: "仅创建任务",
    createAi: "创建并交给 AI",
    creating: "正在创建…",
    created: "任务已创建并加入看板。",
    aiStarted: "任务已创建，AI 会自动处理；需要你时会提醒。",
    failed: "任务创建失败，请检查项目和网络状态后重试。",
    preflight: "执行前检查",
    preflightChecking: "正在确认 AI、代码仓库和安全开关…",
    preflightBlocked: "AI 暂时不能启动，请先处理以下问题。",
    preflightWarning: "AI 可以启动，但建议留意以下提醒。",
    preflightUnavailable: "暂时无法完成执行前检查，请重新检查。",
    preflightRetry: "重新检查",
    preflightSetup: "去设置并修复",
    projectChanged: "项目已切换，原项目的参考文件已清除。",
    openProjects: "打开项目设置",
    view: "查看任务",
    noProject: "请先选择或创建一个项目。",
    unavailable: "服务器离线。",
    today: "今天",
    tomorrow: "明天",
  } : {
    title: "Create a task",
    description: "Describe the outcome you want. It will be added to your task boards and tracked through completion.",
    placeholder: "For example: Summarize this week's customer feedback and rank the recommended improvements",
    due: "Complete by",
    criteria: "Definition of done (optional)",
    criteriaHint: "One item per line, for example:\nCover every feedback item\nAssign a clear priority\nProduce a shareable document",
    sop: "Verification SOP (required before AI starts)",
    sopHint: "One step per line, for example:\nExercise the real user flow\nReview automated evidence\nConfirm risks before approval",
    contractReview: "An execution-plan draft is ready. Review or edit the completion criteria and verification SOP, then click “Create and let AI work” again to start.",
    more: "Add completion criteria or references",
    attach: "Add reference files",
    attachDrop: "Drop files here or choose files",
    attachLimit: "Up to 6 files, 5MB each",
    retryAttachment: "Retry",
    removeAttachment: "Remove {{name}}",
    attachmentRejected: "Some files could not be added. Each file must be non-empty and under 5MB; up to 6 files are allowed.",
    attachmentUploadFailed: "Reference files could not be uploaded, so the task was not created. Retry or remove the files.",
    create: "Create task only",
    createAi: "Create and let AI work",
    creating: "Creating…",
    created: "Task created and added to your boards.",
    aiStarted: "Task created. AI will work automatically and notify you only when needed.",
    failed: "The task could not be created. Check the project and connection, then retry.",
    preflight: "Preflight",
    preflightChecking: "Checking the AI, repository, and safety controls…",
    preflightBlocked: "AI cannot start yet. Resolve these issues first.",
    preflightWarning: "AI can start, with these recommendations.",
    preflightUnavailable: "Preflight could not be completed. Recheck before starting AI.",
    preflightRetry: "Recheck",
    preflightSetup: "Open setup and fix",
    projectChanged: "The project changed, so reference files from the previous project were cleared.",
    openProjects: "Open project setup",
    view: "View task",
    noProject: "Choose or create a project first.",
    unavailable: "Server is offline.",
    today: "Today",
    tomorrow: "Tomorrow",
  };
  const [goal, setGoal] = useState("");
  const [dueDate, setDueDate] = useState(() => localDateKey(1));
  const [criteria, setCriteria] = useState("");
  const [verificationSop, setVerificationSop] = useState("");
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [attachments, setAttachments] = useState<TaskMaterialSelection[]>([]);
  const [attachmentFeedback, setAttachmentFeedback] = useState<string | null>(null);
  const [pendingMode, setPendingMode] = useState<CreateMode | null>(null);
  const [feedback, setFeedback] = useState<{ tone: "success" | "warning" | "danger"; text: string; workItemId?: string } | null>(null);
  const [readiness, setReadiness] = useState<AutoRunReadiness | null>(null);
  const [readinessLoading, setReadinessLoading] = useState(false);
  const [internalOpen, setInternalOpen] = useState(false);
  const open = openProp ?? internalOpen;
  const setOpen = (next: boolean) => {
    if (openProp === undefined) setInternalOpen(next);
    onOpenChange?.(next);
  };
  const idempotencyKey = useRef<string | null>(null);
  const materialDraft = useRef<TaskMaterialDraft | null>(null);
  const materialDraftPromise = useRef<Promise<TaskMaterialDraft> | null>(null);
  const readinessRequest = useRef(0);
  const projectIdRef = useRef(projectId);
  const title = useMemo(() => goal.trim().split(/\r?\n/)[0]?.slice(0, 200) ?? "", [goal]);
  const filesReady = attachments.every((attachment) => attachment.status === "ready");
  const canCreate = Boolean(projectId && title && dueDate && !pendingMode && filesReady && !unavailable);
  const canCreateWithAi = canCreate && readiness?.ready === true && !readinessLoading;
  const readinessWarnings = readiness?.checks.filter((check) => check.status === "warn") ?? [];

  async function loadReadiness(targetProjectId = projectId) {
    const requestId = ++readinessRequest.current;
    if (!targetProjectId || unavailable) {
      setReadiness(null);
      setReadinessLoading(false);
      return null;
    }
    setReadinessLoading(true);
    try {
      const response = await api.autoRunReadiness(targetProjectId) as { readiness?: AutoRunReadiness };
      if (!response.readiness || typeof response.readiness.ready !== "boolean" || !Array.isArray(response.readiness.checks)) {
        throw new Error("invalid_auto_run_readiness");
      }
      if (requestId === readinessRequest.current && projectIdRef.current === targetProjectId) setReadiness(response.readiness);
      return response.readiness;
    } catch {
      const unavailableReadiness: AutoRunReadiness = {
        ready: false,
        checks: [{ key: "preflight", label: copy.preflight, status: "blocked", detail: copy.preflightUnavailable }],
      };
      if (requestId === readinessRequest.current && projectIdRef.current === targetProjectId) setReadiness(unavailableReadiness);
      return unavailableReadiness;
    } finally {
      if (requestId === readinessRequest.current) setReadinessLoading(false);
    }
  }

  useEffect(() => {
    const projectChanged = projectIdRef.current !== projectId;
    projectIdRef.current = projectId;
    if (projectChanged) {
      const hadAttachments = attachments.length > 0;
      setAttachments([]);
      materialDraft.current = null;
      materialDraftPromise.current = null;
      idempotencyKey.current = null;
      setFeedback(null);
      setAttachmentFeedback(hadAttachments ? copy.projectChanged : null);
    }
    setReadiness(null);
    void loadReadiness(projectId);
    // The project boundary deliberately invalidates draft state exactly once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, unavailable]);

  function rememberDraft(next: TaskMaterialDraft) {
    if (!materialDraft.current || next.revision >= materialDraft.current.revision) materialDraft.current = next;
  }

  async function ensureMaterialDraft() {
    if (materialDraft.current) return materialDraft.current;
    if (materialDraftPromise.current) return materialDraftPromise.current;
    if (!projectId) throw new Error("project_required");
    const draftProjectId = projectId;
    const pending = (async () => {
      const response = await api.createTaskMaterialDraft(draftProjectId) as { draft: TaskMaterialDraft };
      if (projectIdRef.current !== draftProjectId) throw new Error("project_changed");
      rememberDraft(response.draft);
      return response.draft;
    })();
    materialDraftPromise.current = pending;
    try {
      return await pending;
    } finally {
      if (materialDraftPromise.current === pending) materialDraftPromise.current = null;
    }
  }

  async function uploadAttachment(item: TaskMaterialSelection) {
    if (!projectId) return;
    const uploadProjectId = projectId;
    setAttachments((current) => current.map((candidate) => candidate.id === item.id ? { ...candidate, status: "uploading", error: undefined } : candidate));
    try {
      const draft = await ensureMaterialDraft();
      const response = await api.uploadTaskMaterialFile(uploadProjectId, draft.id, item.id, item.file) as { draft: TaskMaterialDraft; asset: { id: string } };
      if (projectIdRef.current !== uploadProjectId) return;
      rememberDraft(response.draft);
      setAttachments((current) => current.map((candidate) => candidate.id === item.id ? { ...candidate, status: "ready", assetId: response.asset.id, error: undefined } : candidate));
      setAttachmentFeedback(null);
    } catch (error) {
      if (projectIdRef.current !== uploadProjectId) return;
      setAttachments((current) => current.map((candidate) => candidate.id === item.id ? { ...candidate, status: "failed", error: String(error) } : candidate));
      setAttachmentFeedback(copy.attachmentUploadFailed);
    }
  }

  async function addFiles(files: FileList | File[]) {
    const result = selectTaskMaterialFiles(files, Math.max(0, MAX_TASK_MATERIALS - attachments.length));
    setAttachmentFeedback(result.rejected ? copy.attachmentRejected : null);
    if (result.selected.length) {
      idempotencyKey.current = null;
      setAttachments((current) => [...current, ...result.selected].slice(0, MAX_TASK_MATERIALS));
      await Promise.all(result.selected.map((item) => uploadAttachment(item)));
    }
  }

  async function removeAttachment(item: TaskMaterialSelection) {
    if (item.status === "uploading") return;
    const draft = materialDraft.current;
    if (projectId && draft && item.assetId) {
      try {
        const response = await api.removeTaskMaterialFile(projectId, draft.id, item.assetId, draft.revision) as { draft: TaskMaterialDraft };
        rememberDraft(response.draft);
      } catch {
        setAttachmentFeedback(copy.attachmentUploadFailed);
        return;
      }
    }
    idempotencyKey.current = null;
    setAttachments((current) => current.filter((candidate) => candidate.id !== item.id));
    setAttachmentFeedback(null);
  }

  async function create(mode: CreateMode) {
    if (!projectId || !title || !dueDate || pendingMode) return;
    setPendingMode(mode);
    setFeedback(null);
    const key = idempotencyKey.current ?? clientKey();
    idempotencyKey.current = key;
    let created: LocalWorkItem | null = null;
    try {
      if (!filesReady) return;
      if (mode === "ai") {
        const latestReadiness = await loadReadiness(projectId);
        if (projectIdRef.current !== projectId) return;
        if (!latestReadiness?.ready) {
          setFeedback({ tone: "warning", text: copy.preflightBlocked });
          return;
        }
      }
      const draft = materialDraft.current;
      const response = await api.createWorkItem({
        projectId,
        title,
        body: goal.trim(),
        type: "task",
        priority: "p2",
        executionPolicy: mode === "ai" ? "auto" : "manual",
        acceptanceCriteria: criteria.split(/\r?\n/).map((value) => value.trim()).filter(Boolean),
        verificationSop: verificationSop.split(/\r?\n/).map((value) => value.trim()).filter(Boolean),
        requesterRelation: "self",
        intakeChannel: "manual",
        waitingOn: mode === "ai" ? "ai" : "none",
        dueDate,
        plannedDate: mode === "ai" ? localDateKey() : null,
        ...(attachments.length && draft ? { materialDraftId: draft.id, materialDraftRevision: draft.revision } : {}),
        idempotencyKey: key,
      }) as { workItem: LocalWorkItem };
      created = response.workItem;
      if (mode === "ai") {
        setFeedback({ tone: "success", text: copy.aiStarted, workItemId: created.id });
      } else {
        setFeedback({ tone: "success", text: copy.created, workItemId: created.id });
      }
      setGoal("");
      setCriteria("");
      setVerificationSop("");
      setDetailsOpen(false);
      setAttachments([]);
      materialDraft.current = null;
      setAttachmentFeedback(null);
      idempotencyKey.current = null;
      onCreated();
      window.dispatchEvent(new CustomEvent("myagenttool:state-change", { detail: { source: "home-task-create", workItemId: created.id } }));
    } catch {
      setFeedback({ tone: "danger", text: copy.failed });
    } finally {
      setPendingMode(null);
    }
  }

  const composerForm = (
    <Card className="h-full border-primary/25" data-testid="home-task-composer">
      <CardContent className={inline ? "space-y-3 p-4" : "space-y-3 pt-1"}>
        {inline ? (
          <div className="flex items-start gap-2">
            <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary"><Sparkles className="size-4" aria-hidden /></span>
            <div className="min-w-0">
              <h2 className="text-sm font-semibold">{copy.title}</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">{copy.description}</p>
            </div>
          </div>
        ) : null}
        <textarea
          aria-label={copy.title}
          className="min-h-16 w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm outline-none transition focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/20"
          value={goal}
          placeholder={copy.placeholder}
          onChange={(event) => {
            setGoal(event.target.value);
            idempotencyKey.current = null;
            setFeedback(null);
          }}
        />
        <div className="grid gap-2 sm:grid-cols-[minmax(150px,0.8fr)_minmax(0,1fr)_minmax(0,1.15fr)] sm:items-end">
          <label className="grid min-w-0 gap-1 text-xs font-medium text-muted-foreground">
            <span className="inline-flex items-center gap-1"><CalendarDays className="size-3.5" aria-hidden />{copy.due}</span>
            <Input aria-label={copy.due} type="date" value={dueDate} min={localDateKey()} onChange={(event) => { setDueDate(event.target.value); idempotencyKey.current = null; setFeedback(null); }} />
          </label>
          <Button className="w-full" variant="secondary" disabled={!canCreate} onClick={() => void create("task")}>{pendingMode === "task" ? copy.creating : copy.create}</Button>
          <Button className="w-full" data-home-create-action="create-ai" disabled={!canCreateWithAi} title={!readiness?.ready ? copy.preflightBlocked : undefined} onClick={() => void create("ai")}><Sparkles aria-hidden />{pendingMode === "ai" ? copy.creating : copy.createAi}</Button>
        </div>
        {projectId && !unavailable && (readinessLoading || readiness?.ready === false || readinessWarnings.length > 0) ? (
          <section className={`rounded-lg border px-3 py-2 text-sm ${readiness?.ready === false ? "border-warning/40 bg-warning/[0.06]" : "border-border bg-muted/30"}`} aria-label={copy.preflight} role={readiness?.ready === false ? "alert" : "status"}>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <p className="flex items-center gap-2 font-medium">
                  {readinessLoading ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : <AlertTriangle className="size-4 text-warning" aria-hidden />}
                  {readinessLoading ? copy.preflightChecking : readiness?.ready === false ? copy.preflightBlocked : copy.preflightWarning}
                </p>
                {!readinessLoading ? <ul className="mt-1 list-disc space-y-1 pl-5 text-xs text-muted-foreground">
                  {(readiness?.checks ?? []).filter((check) => check.status === (readiness?.ready === false ? "blocked" : "warn")).map((check) => (
                    <li key={check.key}><span className="font-medium text-foreground">{check.label}:</span> {check.detail}</li>
                  ))}
                </ul> : null}
              </div>
              {!readinessLoading ? <div className="flex shrink-0 flex-wrap gap-1">
                <Button size="sm" variant="ghost" onClick={() => { void loadReadiness(); }}><RefreshCw aria-hidden />{copy.preflightRetry}</Button>
                {readiness?.ready === false && onOpenSetup ? <Button size="sm" variant="secondary" onClick={() => onOpenSetup(readinessSetupSection(readiness))}>{copy.preflightSetup}</Button> : null}
              </div> : null}
            </div>
          </section>
        ) : null}
        <details className="group rounded-lg border border-border px-3 py-2" open={detailsOpen} onToggle={(event) => setDetailsOpen(event.currentTarget.open)}>
          <summary className="flex cursor-pointer list-none items-center justify-between gap-2 text-sm font-medium text-muted-foreground">
            {copy.more}<ChevronDown className="size-4 transition-transform group-open:rotate-180" aria-hidden />
          </summary>
          <label className="mt-3 grid gap-1 text-xs font-medium text-muted-foreground">
            {copy.criteria}
            <textarea className="min-h-24 rounded-md border border-border bg-background p-2 text-sm text-foreground" value={criteria} placeholder={copy.criteriaHint} onChange={(event) => { setCriteria(event.target.value); idempotencyKey.current = null; setFeedback(null); }} />
          </label>
          <label className="mt-3 grid gap-1 text-xs font-medium text-muted-foreground">
            {copy.sop}
            <textarea className="min-h-24 rounded-md border border-border bg-background p-2 text-sm text-foreground" value={verificationSop} placeholder={copy.sopHint} onChange={(event) => { setVerificationSop(event.target.value); idempotencyKey.current = null; setFeedback(null); }} />
          </label>
          <div className="mt-3 border-t border-border pt-3">
            <TaskMaterialPicker
              files={attachments}
              onFiles={(files) => { void addFiles(files); }}
              onRemove={(id) => {
                const item = attachments.find((candidate) => candidate.id === id);
                if (item) void removeAttachment(item);
              }}
              onRetry={(id) => {
                const item = attachments.find((candidate) => candidate.id === id);
                if (item) void uploadAttachment(item);
              }}
              label={copy.attach}
              dropLabel={copy.attachDrop}
              limitLabel={copy.attachLimit}
              retryLabel={copy.retryAttachment}
              removeLabel={(name) => copy.removeAttachment.replace("{{name}}", name)}
              disabled={!projectId || unavailable}
              feedback={attachmentFeedback}
            />
          </div>
        </details>
        {unavailable
          ? <p className="text-sm text-warning" role="status">{copy.unavailable}</p>
          : !projectId ? <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-warning" role="status"><span>{copy.noProject}</span>{onOpenProjects ? <Button size="sm" variant="secondary" onClick={onOpenProjects}>{copy.openProjects}</Button> : null}</div> : null}
        {feedback ? (
          <div className={`flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2 text-sm ${feedback.tone === "success" ? "border-success/30 bg-success/[0.06]" : feedback.tone === "warning" ? "border-warning/35 bg-warning/[0.06]" : "border-destructive/35 bg-destructive/[0.05]"}`} role={feedback.tone === "danger" ? "alert" : "status"}>
            {feedback.tone === "success" ? <CheckCircle2 className="size-4 shrink-0 text-success" aria-hidden /> : null}
            <span className="min-w-0 flex-1">{feedback.text}</span>
            {feedback.workItemId ? <Button size="sm" variant="secondary" onClick={() => { setOpen(false); onOpenTask(feedback.workItemId!); }}>{copy.view}</Button> : null}
          </div>
        ) : null}
        {projectName ? <p className="text-[11px] text-muted-foreground">{projectName}</p> : null}
      </CardContent>
    </Card>
  );

  return (
    <>
      {showTrigger ? <Button
        type="button"
        data-testid="home-create-task-trigger"
        className="fixed bottom-5 right-5 z-40 rounded-full px-5 shadow-lg shadow-primary/20 sm:bottom-6 sm:right-6"
        disabled={unavailable}
        title={unavailable ? copy.unavailable : copy.title}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
      >
        <Plus className="size-4" aria-hidden />
        {zh ? "创建任务" : "Create task"}
      </Button> : null}
      {inline ? <div className="h-full" data-testid="home-task-composer-inline">{composerForm}</div> : (
        <Modal
          open={open}
          onClose={() => setOpen(false)}
          title={copy.title}
          description={copy.description}
          size="xl"
          closeDisabled={Boolean(pendingMode)}
        >
          {composerForm}
        </Modal>
      )}
    </>
  );
}

export default HomeTaskComposer;
