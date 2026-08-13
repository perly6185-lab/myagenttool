import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, ArrowUp, Bot } from "lucide-react";
import { normalizeCodexPermissionMode, type CodexPermissionMode } from "@myagenttool/protocol/codex-permissions";
import { defaultModelForAgentAdapter, modelIdsForAgentAdapter } from "@myagenttool/protocol/agent-models";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/badge";
import { Select } from "@/components/ui/input";
import { Field } from "@/components/common/field";
import { FactList } from "@/components/common/fact-list";
import { SectionHeading } from "@/components/common/section-heading";
import { Transcript } from "@/features/invocations/transcript";
import { RunTranscriptSection } from "@/features/invocations/run-transcript";
import { DecisionAction } from "@/features/invocations/decision-action";
import { AgentRunComposer } from "@/features/invocations/agent-run-composer";
import { permissionModeForAgent } from "@/features/invocations/agent-permission";
import {
  MAX_WORKTREE_ATTACHMENTS,
  WorktreeAttachmentPicker,
  stageWorktreeAttachmentFiles,
  type StagedWorktreeAttachment,
  type WorktreeAttachmentRejection,
  type WorktreeAttachmentUploadResponse,
} from "@/features/invocations/worktree-attachment-picker";
import { GuidedSetupCard } from "@/features/dashboard/guided-setup-card";
import { HomeTaskComposer } from "@/features/dashboard/home-task-composer";
import { localScheduleApi } from "@/features/dashboard/local-schedule-api";
import type { LocalWorkItem } from "@/features/tasks/task-view-types";
import type { HomeWorkbench } from "@/features/dashboard/home-workbench-types";
import type {
  LocalScheduleCapacityResponse,
  LocalSchedulePreviewResponse,
  LocalScheduleRolloverResponse,
  LocalScheduleUrgentResponse,
} from "@/lib/api-client";
import {
  deriveHomeNextAction,
  hasPendingDecisionForInvocation,
  type HomePrimaryAction,
} from "@/features/dashboard/home-next-action";
import { STARTER_TASK_TEMPLATES } from "@/features/dashboard/starter-task-templates";
import { ActionErrorNotice } from "@/components/common/action-error-notice";
import { useConsoleState } from "@/data/use-console-state";
import { useAsyncAction, api } from "@/data/use-console-actions";
import { useCurrentProjectSelection } from "@/hooks/use-current-project-selection";
import { usePageNavigation } from "@/hooks/use-page-navigation";
import { useSessionUser } from "@/hooks/use-session-user";
import { resolveAgents, resolveInvocation } from "@/features/selection";
import { useUiStore, type InvocationStatusFilter, type SectionKey } from "@/store/ui-store";
import {
  adapterText,
  cancellationText,
  costText,
  lifecycleText,
  readableAgentStatus,
  readableHealthLabel,
  statusTone,
} from "@/lib/readable-labels";
import {
  invocationStatus,
  resultHeading,
} from "@/lib/i18n/readable-labels";

const DailyWorkBoard = lazy(async () => {
  const module = await import("@/features/dashboard/daily-work-board");
  return { default: module.DailyWorkBoard };
});
import type { AgentSnapshot, ConsoleSnapshot, InvocationSnapshot, PendingDecision, WorkItem } from "@/lib/console-state";
import { useAppTranslation } from "@/lib/i18n/use-app-translation";

type Translate = ReturnType<typeof useAppTranslation>["t"];

const RUNNING_STATES = ["queued", "dispatching", "waiting_for_local_approval", "running", "cancelling"];
const CANCELLABLE_STATES = ["queued", "dispatching", "waiting_for_local_approval", "running"];

function runBlockReason(
  state: ConsoleSnapshot | undefined,
  agent: AgentSnapshot | null,
  hasTask: boolean,
  t: Translate,
): string {
  if (!state) return t("dashboard.block.offline");
  if (!hasTask) return t("dashboard.block.task");
  if (!agent) return t("dashboard.block.agent");
  if (agent.status === "disabled")
    return t("dashboard.block.disabled", { name: agent.name });
  if (agent.health?.status === "unhealthy")
    return t("dashboard.block.unhealthy", { name: agent.name });
  return "";
}

export function eventsForInvocation(
  state: ConsoleSnapshot | undefined,
  invocation: InvocationSnapshot | null,
) {
  if (!state) return [];
  const filtered = invocation
    ? state.events.filter((event) => event.invocationId === invocation.id)
    : state.events;
  return [...filtered]
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .slice(-50);
}

function createClientIdempotencyKey() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function")
    return crypto.randomUUID();
  return `web-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

async function settled<T>(promise: Promise<T>): Promise<{ ok: true; value: T } | { ok: false }> {
  try {
    return { ok: true, value: await promise };
  } catch {
    return { ok: false };
  }
}

/**
 * Where the composer is embedded. "overview" is the home surface and shows the
 * first-run onboarding checklist; "workspace" reuses the same composer + activity
 * inside the files/history view, where the onboarding card would be redundant (#927).
 */
export type DashboardSurface = "overview" | "workspace";

export function DashboardView({ surface = "overview" }: { surface?: DashboardSurface } = {}) {
  const { t } = useAppTranslation();
  const { data: state } = useConsoleState();
  const selectedAgentId = useUiStore((s) => s.selectedAgentId);
  const setSelectedAgentId = useUiStore((s) => s.setSelectedAgentId);
  const selectedInvocationId = useUiStore((s) => s.selectedInvocationId);
  const setSelectedInvocationId = useUiStore((s) => s.setSelectedInvocationId);
  const setSelectedApplicationId = useUiStore((s) => s.setSelectedApplicationId);
  const openWorkItem = useUiStore((s) => s.openWorkItem);
  const setSelectedProjectId = useUiStore((s) => s.setSelectedProjectId);
  const selectedWorktreeId = useUiStore((s) => s.selectedWorktreeId);
  const setSelectedWorktreeId = useUiStore((s) => s.setSelectedWorktreeId);
  const navigate = usePageNavigation();
  const resumeFromInvocationId = useUiStore((s) => s.resumeFromInvocationId);
  const setResumeFromInvocationId = useUiStore((s) => s.setResumeFromInvocationId);
  const composerDraftTask = useUiStore((s) => s.composerDraftTask);
  const setComposerDraftTask = useUiStore((s) => s.setComposerDraftTask);
  const setInvocationStatusFilter = useUiStore((s) => s.setInvocationStatusFilter);
  const runAction = useAsyncAction();
  const cancelAction = useAsyncAction();
  const scheduleAction = useAsyncAction();
  const rolloverAction = useAsyncAction();
  const urgentAction = useAsyncAction();
  const projectSelection = useCurrentProjectSelection();
  const sessionUser = useSessionUser();
  const canOperate = sessionUser?.role !== "viewer";
  const runInFlightRef = useRef(false);
  const runIdempotencyKeyRef = useRef<string | null>(null);
  const attachmentWorktreeRef = useRef<string | null>(null);

  const projects = state?.projects ?? [];
  // The server-selected project is the single business context. The local
  // selection remains useful for focusing a project/worktree page, but must
  // never silently change where Home creates a task.
  const projectId = state?.currentProjectId ?? projects[0]?.id ?? null;
  const project = projects.find((item) => item.id === projectId) ?? null;
  const targetWorktree =
    (state?.worktrees ?? []).find((w) => w.id === selectedWorktreeId && w.projectId === projectId) ?? null;

  useEffect(() => {
    if (targetWorktree?.agentId) setSelectedAgentId(targetWorktree.agentId);
  }, [targetWorktree?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const [task, setTask] = useState("");
  const [permissionLevel, setPermissionLevel] = useState<CodexPermissionMode>("ask");
  const [selectedModel, setSelectedModel] = useState("");
  const [attachments, setAttachments] = useState<StagedWorktreeAttachment[]>([]);
  const [attachmentFeedback, setAttachmentFeedback] = useState<string | null>(null);
  const [dailyWorkItems, setDailyWorkItems] = useState<LocalWorkItem[]>([]);
  const [homeWorkbench, setHomeWorkbench] = useState<HomeWorkbench>();
  const [dailyRefreshVersion, setDailyRefreshVersion] = useState(0);
  const [dailyBriefContainer, setDailyBriefContainer] = useState<HTMLDivElement | null>(null);
  const [homeFocusSession, setHomeFocusSession] = useState<{
    active: boolean;
    projectId: string | null;
    pendingWorkItemId: string | null;
    resolvedWorkItemId: string | null;
  }>({
    active: false,
    projectId: null,
    pendingWorkItemId: null,
    resolvedWorkItemId: null,
  });
  const [dailyLoadFailureCount, setDailyLoadFailureCount] = useState(0);
  const [dailyLoading, setDailyLoading] = useState(surface === "overview");
  const [dailyUpdatedAt, setDailyUpdatedAt] = useState<string | null>(null);
  const [mobileTaskComposerOpen, setMobileTaskComposerOpen] = useState(false);
  const [rolloverPromptSuppressed, setRolloverPromptSuppressed] = useState(false);
  const [localScheduleCapacity, setLocalScheduleCapacity] = useState<LocalScheduleCapacityResponse>();
  const [localSchedulePreview, setLocalSchedulePreview] = useState<LocalSchedulePreviewResponse>();
  const [localScheduleRollover, setLocalScheduleRollover] = useState<LocalScheduleRolloverResponse>();
  const [localScheduleUrgent, setLocalScheduleUrgent] = useState<LocalScheduleUrgentResponse>();
  const taskInputRef = useRef<HTMLTextAreaElement>(null);
  const activityRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setHomeFocusSession((current) => current.active && current.projectId !== projectId
      ? { active: false, projectId: null, pendingWorkItemId: null, resolvedWorkItemId: null }
      : current);
  }, [projectId]);

  useEffect(() => {
    const refreshDailyWork = (event: Event) => {
      setDailyRefreshVersion((version) => version + 1);
      const detail = (event as CustomEvent<{ source?: string; workItemId?: string }>).detail;
      const resolvesFocusStep = [
        "work-item-start-ai",
        "work-item-request-changes",
        "work-item-completed",
        "work-item-retry",
        "work-item-progress",
      ].includes(detail?.source ?? "");
      if (!resolvesFocusStep || !detail?.workItemId) return;
      setHomeFocusSession((current) => current.pendingWorkItemId === detail.workItemId
        ? { ...current, pendingWorkItemId: null, resolvedWorkItemId: detail.workItemId ?? null }
        : current);
    };
    window.addEventListener("myagenttool:state-change", refreshDailyWork);
    return () => window.removeEventListener("myagenttool:state-change", refreshDailyWork);
  }, []);

  useEffect(() => {
    if (surface !== "overview") return undefined;
    let cancelled = false;
    setDailyLoading(true);
    const workItems = import("@/features/dashboard/dashboard-work-items");
    void Promise.all([
      settled(workItems.then(({ listAllDashboardWorkItems }) => listAllDashboardWorkItems({ terminalId: "local" }))),
      settled(workItems.then(({ getDashboardHomeWorkbench }) => getDashboardHomeWorkbench())),
      settled(localScheduleApi.capacity()),
      settled(localScheduleApi.preview()),
      settled(localScheduleApi.rolloverPreview()),
      settled(localScheduleApi.urgentPreview()),
    ])
      .then(([all, workbench, capacity, preview, rollover, urgent]) => {
        if (!cancelled) {
          if (all.ok) setDailyWorkItems(all.value);
          if (workbench.ok) setHomeWorkbench(workbench.value);
          if (capacity.ok) setLocalScheduleCapacity(capacity.value);
          if (preview.ok) setLocalSchedulePreview(preview.value);
          if (rollover.ok) setLocalScheduleRollover(rollover.value);
          if (urgent.ok) setLocalScheduleUrgent(urgent.value);
          setDailyLoadFailureCount([all, workbench, capacity, preview, rollover, urgent]
            .filter((result) => !result.ok).length);
          setDailyUpdatedAt(new Date().toISOString());
          setDailyLoading(false);
        }
      });
    return () => { cancelled = true; };
  }, [surface, state?.workItemSummary?.homeWorkbenchUpdatedAt ?? state?.workItemSummary?.updatedAt, dailyRefreshVersion]);

  const { agents, agent } = resolveAgents(state, selectedAgentId);
  const availableModels = useMemo(() => modelIdsForAgentAdapter(agent?.adapter), [agent?.adapter]);
  const availableModelKey = availableModels.join("\0");
  const defaultModel = useMemo(() => defaultModelForAgentAdapter(agent?.adapter), [agent?.adapter]);
  const resolvedInvocation = resolveInvocation(state, selectedInvocationId);
  useEffect(() => {
    setPermissionLevel(permissionModeForAgent(agent));
  }, [agent?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    // Preserve a compatible explicit choice, but never carry an incompatible
    // model into a different Agent's invocation.
    setSelectedModel((current) => current && availableModels.includes(current) ? current : "");
  }, [agent?.id, availableModelKey]); // eslint-disable-line react-hooks/exhaustive-deps
  attachmentWorktreeRef.current = targetWorktree?.id ?? null;
  useEffect(() => {
    setAttachments([]);
    setAttachmentFeedback(null);
  }, [targetWorktree?.id]);
  useEffect(() => {
    runIdempotencyKeyRef.current = null;
  }, [agent?.id, permissionLevel, selectedModel, projectId, targetWorktree?.id, resumeFromInvocationId]);
  const activeInvocations = useMemo(
    () => (state?.invocations ?? []).filter((item) => RUNNING_STATES.includes(item.status ?? "")),
    [state?.invocations],
  );
  const invocation = surface === "overview"
    ? activeInvocations.find((item) => item.id === selectedInvocationId) ?? activeInvocations[0] ?? null
    : resolvedInvocation;
  const trackedInvocationItem = invocation
    ? homeWorkbench?.items?.find((item) => item.ai?.invocationId === invocation.id) ?? null
    : null;
  const attachmentWorktree = targetWorktree
    ?? (state?.worktrees ?? []).find((item) => item.projectId === projectId)
    ?? null;
  const localInFlightCount = useMemo(
    () => activeInvocations.filter((item) => {
      if (["queued", "waiting_for_local_approval"].includes(item.status ?? "")) return false;
      return (state?.agents ?? []).find((candidate) => candidate.id === item.agentId)?.location?.type === "local_device";
    }).length,
    [activeInvocations, state?.agents],
  );

  const hasTask = task.trim().length > 0;
  const homeNextAction = deriveHomeNextAction({
    invocation,
    hasPendingDecision: hasPendingDecisionForInvocation(
      state?.pendingDecisions,
      invocation,
      projectId,
    ),
  });
  const trackedWorkItemId = homeNextAction.state === "running" ? trackedInvocationItem?.workItemId ?? null : null;
  const unhealthy = agent?.health?.status === "unhealthy";
  const disabledAgent = agent?.status === "disabled";
  const localOffline = agent?.location?.type === "local_device" && state?.device?.status !== "online";
  const maxLocalConcurrency = state?.device?.maxConcurrency || 1;
  const selectedWorktreeBusy = Boolean(targetWorktree?.id) && activeInvocations.some(
    (item) => item.worktreeId === targetWorktree?.id && item.status !== "queued",
  );
  const willQueue =
    localOffline ||
    (agent?.location?.type === "local_device" && (localInFlightCount >= maxLocalConcurrency || selectedWorktreeBusy));

  const runDisabled = !state || !hasTask || !agent || disabledAgent || unhealthy || runAction.pending;
  const cancelDisabled = !invocation || !CANCELLABLE_STATES.includes(invocation.status ?? "");
  const blockReason = runBlockReason(state, agent, hasTask, t);

  // Ascending (oldest → newest) so the transcript reads as a conversation and
  // new blocks append at the bottom.
  const events = useMemo(() => eventsForInvocation(state, invocation), [state, invocation]);

  // Auto-scroll to the newest block only when the user is already at the bottom,
  // so reading back through history isn't yanked away by streaming updates.
  const scrollRef = useRef<HTMLDivElement>(null);
  const pinnedRef = useRef(true);
  const onTranscriptScroll = () => {
    const el = scrollRef.current;
    if (el) pinnedRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
  };
  useEffect(() => {
    const el = scrollRef.current;
    if (el && pinnedRef.current) el.scrollTop = el.scrollHeight;
  }, [events.length, invocation?.id, invocation?.input?.task]);

  // Resume mode (#163): when a session was picked to continue, the next send
  // creates a provider-specific exact continuation targeting that invocation.
  const resumeSource = useMemo(
    () => (resumeFromInvocationId ? (state?.invocations ?? []).find((inv) => inv.id === resumeFromInvocationId) ?? null : null),
    [state?.invocations, resumeFromInvocationId],
  );

  useEffect(() => {
    if (surface !== "workspace" || composerDraftTask == null) return;
    setTask(composerDraftTask);
    setComposerDraftTask(null);
    runIdempotencyKeyRef.current = null;
    taskInputRef.current?.focus();
  }, [composerDraftTask, setComposerDraftTask, surface]);

  function attachmentRejectionMessage(rejected: WorktreeAttachmentRejection[]) {
    const reasons = [...new Set(rejected.map((item) => item.reason))]
      .map((reason) => t(`agentComposer.attachmentReason.${reason}`))
      .join("; ");
    return t("agentComposer.attachmentRejected", { reasons });
  }

  async function addFiles(files: FileList | File[]) {
    const worktreeId = targetWorktree?.id ?? null;
    if (!worktreeId) return;
    const result = await stageWorktreeAttachmentFiles(
      files,
      Math.max(0, MAX_WORKTREE_ATTACHMENTS - attachments.length),
    );
    if (attachmentWorktreeRef.current !== worktreeId) return;
    setAttachmentFeedback(result.rejected.length > 0 ? attachmentRejectionMessage(result.rejected) : null);
    if (result.attachments.length > 0) {
      runIdempotencyKeyRef.current = null;
      setAttachments((current) => [...current, ...result.attachments].slice(0, MAX_WORKTREE_ATTACHMENTS));
    }
  }

  async function runTask() {
    if (runInFlightRef.current) return;
    let submitted = task.trim();
    if (!submitted || !agent) return;
    const resumeId = resumeFromInvocationId;
    const command = String(agent?.adapter?.command ?? "").toLowerCase();
    const claude = ["claude", "claude.exe", "claude.cmd", "claude.ps1"].some(
      (name) => command === name || command.endsWith(`/${name}`) || command.endsWith(`\\${name}`),
    );
    const options = {
      permissionLevel,
      ...(selectedModel ? { model: selectedModel } : {}),
      ...(resumeId
        ? {
            ...(claude
              ? { claudeSessionMode: "continue_last" }
              : { codexSessionMode: "continue_last" }),
            resumeFromInvocationId: resumeId,
          }
        : {}),
    };
    const idempotencyKey = runIdempotencyKeyRef.current ?? createClientIdempotencyKey();
    runIdempotencyKeyRef.current = idempotencyKey;
    runInFlightRef.current = true;
    try {
      await runAction.execute(async () => {
        if (targetWorktree && attachments.length > 0) {
          const response = (await api.uploadWorktreeAttachments(
            targetWorktree.id,
            attachments.map((attachment) => ({
              name: attachment.name,
              dataBase64: attachment.dataBase64,
            })),
            idempotencyKey,
          )) as WorktreeAttachmentUploadResponse;
          const saved = response.attachments ?? [];
          if ((response.skipped?.length ?? 0) > 0 || saved.length !== attachments.length) {
            throw new Error(t("agentComposer.attachmentUploadRejected"));
          }
          if (saved.length > 0) {
            submitted += `\n\nAttached files (in the worktree):\n${saved.map((item) => `- ${item.path}`).join("\n")}`;
          }
        }
        const created = (await api.createInvocation(
          submitted,
          agent.id,
          projectId,
          targetWorktree?.id ?? null,
          options,
          idempotencyKey,
        )) as { invocation: { id: string } };
        setSelectedInvocationId(created.invocation.id);
        setTask(""); // clear the composer on send; the task shows as the user bubble
        setAttachments([]);
        setAttachmentFeedback(null);
        setResumeFromInvocationId(null); // one-shot: consume the resume intent
        runIdempotencyKeyRef.current = null;
        return created;
      });
    } finally {
      runInFlightRef.current = false;
    }
  }

  async function cancelTask() {
    if (!invocation) return;
    await cancelAction.execute(() => api.cancelInvocation(invocation.id));
  }

  function performPrimaryAction(action: HomePrimaryAction) {
    if (action === "run") {
      void runTask();
      return;
    }
    if (action === "view_progress") {
      if (invocation) setSelectedInvocationId(invocation.id);
      setInvocationStatusFilter("active");
      navigate("invocations");
      return;
    }
    if (invocation) setSelectedInvocationId(invocation.id);
    navigate(action === "handle_approval" ? "approvals" : "invocations");
  }

  function openRunFilter(filter: InvocationStatusFilter) {
    const matching = (state?.invocations ?? []).find((item) => {
      if (filter === "active") return RUNNING_STATES.includes(item.status ?? "");
      if (filter === "completed") return item.status === "succeeded";
      if (filter === "failed") return ["failed", "timed_out", "rejected"].includes(item.status ?? "");
      return true;
    });
    setInvocationStatusFilter(filter);
    setSelectedInvocationId(matching?.id ?? null);
    navigate("invocations");
  }

  function openDailyWorkItem(item: WorkItem) {
    if (item.section === "task" && item.targetId) {
      openWorkItem(item.targetId, item.kind === "home_report_review"
        ? { mode: "expert", section: "report" }
        : undefined);
      return;
    }
    if (item.section === "invocations" && item.targetId) setSelectedInvocationId(item.targetId);
    if (item.section === "applications" && item.targetId) setSelectedApplicationId(item.targetId);
    if (item.section === "autoRuns" && item.targetId) {
      const url = new URL(window.location.href);
      url.searchParams.set("autoRun", item.targetId);
      window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
    }
    if (item.section === "approvals" && item.targetId) {
      const url = new URL(window.location.href);
      url.searchParams.set("approval", item.targetId);
      window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
    }
    if (item.section === "evidence" && item.id.startsWith("refusal:")) {
      const url = new URL(window.location.href);
      url.searchParams.set("refusal", item.id.slice("refusal:".length));
      window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
    }
    navigate(item.section as SectionKey);
  }

  function openHomeTaskComposer() {
    setRolloverPromptSuppressed(true);
    setMobileTaskComposerOpen(true);
    window.requestAnimationFrame(() => {
      const input = document.querySelector<HTMLTextAreaElement>("[data-testid='home-task-composer'] textarea");
      input?.scrollIntoView({ behavior: "smooth", block: "center" });
      input?.focus({ preventScroll: true });
    });
  }

  function openApproval(decision: PendingDecision) {
    const url = new URL(window.location.href);
    url.searchParams.set("approval", decision.ref?.approvalId ?? decision.id);
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
    navigate("approvals");
  }

  const userTask = invocation?.input?.task;
  // Show a final summary block once the run reaches a terminal state.
  const terminalStatus =
    invocation && invocation.status && !RUNNING_STATES.includes(invocation.status) ? invocation.status : null;
  const retryableFailure = Boolean(terminalStatus && ["failed", "timed_out", "rejected"].includes(terminalStatus));
  const transcriptSummary = terminalStatus
    ? { text: invocation?.result?.summary, status: terminalStatus }
    : undefined;
  const composerTitle = targetWorktree
    ? t("dashboard.runTitle.worktree")
    : project
      ? t("dashboard.runTitle.project")
      : t("dashboard.runTitle.computer");
  const composerContext = targetWorktree?.path
    ?? project?.path
    ?? project?.git?.repoPath
    ?? project?.name
    ?? state?.device?.name
    ?? null;
  const composerToolbar = (
    <div className="flex flex-wrap items-center justify-between gap-1.5">
      <div className="flex min-w-0 flex-wrap items-center gap-1">
        <WorktreeAttachmentPicker
          compact
          attachments={attachments}
          onFiles={(files) => { void addFiles(files); }}
          onRemove={(index) => {
            runIdempotencyKeyRef.current = null;
            setAttachments((current) => current.filter((_, itemIndex) => itemIndex !== index));
            setAttachmentFeedback(null);
          }}
          label={t("agentComposer.attach")}
          title={t("agentComposer.attachTitle")}
          removeLabel={(name) => t("agentComposer.removeAttachment", { name })}
          disabled={!targetWorktree}
          disabledHint={!targetWorktree ? t("dashboard.attachNeedsWorktree") : undefined}
          feedback={attachmentFeedback}
        />
        {!invocation ? (
          <Select
            value=""
            onChange={(event) => {
              const template = STARTER_TASK_TEMPLATES.find((item) => item.id === event.target.value);
              if (!template) return;
              setTask(t(template.taskKey));
              runIdempotencyKeyRef.current = null;
            }}
            aria-label={t("dashboard.firstTaskTemplates")}
            title={t("dashboard.nextStep")}
            className="h-8 w-auto max-w-36 border-0 bg-transparent px-2 pr-7 shadow-none focus-visible:ring-1"
          >
            <option value="">{t("dashboard.firstTaskTemplates")}</option>
            {STARTER_TASK_TEMPLATES.map((template) => (
              <option key={template.id} value={template.id}>{t(template.labelKey)}</option>
            ))}
          </Select>
        ) : null}
        <Select
          value={permissionLevel}
          onChange={(event) => setPermissionLevel(normalizeCodexPermissionMode(event.target.value))}
          aria-label={t("agentComposer.permissionLevel")}
          title={t("agentComposer.permissionTitle")}
          className="h-8 w-auto max-w-36 border-0 bg-transparent px-2 pr-7 shadow-none focus-visible:ring-1"
        >
          <option value="ask">{t("agentComposer.permission.ask")}</option>
          <option value="auto">{t("agentComposer.permission.auto")}</option>
          <option value="full">{t("agentComposer.permission.full")}</option>
        </Select>
      </div>
      <div className="ml-auto flex min-w-0 items-center gap-1">
        <Select
          value={agent?.id ?? ""}
          onChange={(event) => setSelectedAgentId(event.target.value || null)}
          aria-label={t("dashboard.agent")}
          title={agent ? `${agent.name} — ${readableAgentStatus(agent.status)} — ${readableHealthLabel(agent.health)}` : undefined}
          className="h-8 w-auto max-w-44 border-0 bg-transparent px-2 pr-7 shadow-none focus-visible:ring-1"
        >
          {agents.length === 0 ? <option value="">{t("dashboard.noAgent")}</option> : null}
          {agents.map((item) => (
            <option key={item.id} value={item.id}>{item.name}</option>
          ))}
        </Select>
        {availableModels.length > 0 ? (
          <Select
            value={selectedModel}
            onChange={(event) => setSelectedModel(event.target.value)}
            aria-label={t("agentComposer.model")}
            title={t("agentComposer.modelTitle")}
            className="h-8 w-auto max-w-40 border-0 bg-transparent px-2 pr-7 shadow-none focus-visible:ring-1"
          >
            <option value="">
              {defaultModel
                ? `${t("agentComposer.agentDefaultModel")} (${defaultModel})`
                : t("agentComposer.agentDefaultModel")}
            </option>
            {availableModels.map((model) => <option key={model} value={model}>{model}</option>)}
          </Select>
        ) : null}
        <Button
          data-home-primary-action={homeNextAction.state === "idle" ? "run" : undefined}
          size="icon"
          className="size-8 shrink-0 rounded-full"
          variant={homeNextAction.state === "idle" ? "primary" : "secondary"}
          disabled={runDisabled}
          onClick={() => void runTask()}
          aria-label={runAction.pending ? t("agentComposer.starting") : willQueue ? t("dashboard.queue") : t("dashboard.run")}
          title={runAction.pending ? t("agentComposer.starting") : willQueue ? t("dashboard.queue") : t("dashboard.run")}
        >
          <ArrowUp />
        </Button>
      </div>
    </div>
  );

  return (
    <div className="flex min-h-full flex-col gap-4">
      {surface === "overview" ? (
        <>
          <div
            data-testid="daily-brief-create-layout"
            className="order-2 grid min-w-0 gap-4 lg:grid-cols-2 lg:items-stretch"
          >
            <div className="contents" data-testid="home-schedule-column">
              <div ref={setDailyBriefContainer} className="order-1 min-w-0 lg:col-start-1 lg:row-start-1" />
              <div className="order-3 min-w-0 lg:col-span-2 lg:row-start-2">
          {dailyLoadFailureCount > 0 ? (
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-md border border-warning/40 bg-warning/5 px-3 py-2 text-sm" role="alert">
              <span>{t("dashboard.workbenchLoadFailed", { count: dailyLoadFailureCount })}</span>
              <Button size="sm" variant="secondary" onClick={() => setDailyRefreshVersion((version) => version + 1)}>
                {t("dashboard.workbenchRetry")}
              </Button>
            </div>
          ) : null}
          <Suspense fallback={null}>
            <DailyWorkBoard
              board={state?.workBoard}
              report={state?.workReport}
              plannedItems={dailyWorkItems}
              workbench={homeWorkbench}
              capacity={localScheduleCapacity}
              preview={localSchedulePreview}
              rollover={localScheduleRollover}
              autoRolloverPrompt={surface === "overview" && !rolloverPromptSuppressed}
              urgent={localScheduleUrgent}
              approvals={canOperate ? state?.pendingDecisions?.filter((decision) => decision.kind !== "clarify") : []}
              canOperate={canOperate}
              onOpenApproval={canOperate ? openApproval : undefined}
              refreshing={dailyLoading}
              updatedAt={dailyUpdatedAt}
              dailyBriefContainer={dailyBriefContainer}
              onOpenItem={openDailyWorkItem}
              onOpenTasks={() => navigate("task")}
              onCreateTask={canOperate ? openHomeTaskComposer : undefined}
              onOpenAttention={() => {
                if ((state?.pendingDecisions?.length ?? 0) > 0) navigate("approvals");
                else if ((state?.evidenceLedger ?? []).some((item) => item.attention)) navigate("evidence");
                else navigate("workBoard");
              }}
              onOpenActive={() => openRunFilter("active")}
              onOpenCompleted={() => openRunFilter("completed")}
              onOpenFailed={() => openRunFilter("failed")}
              onStartAi={canOperate ? async (item) => {
                await api.startWorkItemAutoRun(item.workItemId);
                window.dispatchEvent(new CustomEvent("myagenttool:state-change", {
                  detail: { source: "dashboard-hand-off-ai", workItemId: item.workItemId },
                }));
              } : undefined}
              onUpdatePlannedDate={canOperate ? async (item, plannedDate) => {
                await api.updateWorkItem(item.workItemId, {
                  expectedRevision: item.revision,
                  plannedDate,
                });
                setDailyRefreshVersion((version) => version + 1);
              } : undefined}
              focusSessionActive={homeFocusSession.active && homeFocusSession.projectId === projectId}
              focusPendingWorkItemId={homeFocusSession.pendingWorkItemId}
              focusResolvedWorkItemId={homeFocusSession.resolvedWorkItemId}
              onStartFocusSession={() => setHomeFocusSession({
                active: true,
                projectId,
                pendingWorkItemId: null,
                resolvedWorkItemId: null,
              })}
              onFocusActionLaunched={(workItemId) => setHomeFocusSession({
                active: true,
                projectId,
                pendingWorkItemId: workItemId,
                resolvedWorkItemId: null,
              })}
              onFocusActionResolved={(workItemId) => setHomeFocusSession({
                active: true,
                projectId,
                pendingWorkItemId: null,
                resolvedWorkItemId: workItemId,
              })}
              onEndFocusSession={() => setHomeFocusSession({
                active: false,
                projectId: null,
                pendingWorkItemId: null,
                resolvedWorkItemId: null,
              })}
              onApplyPlan={canOperate && localSchedulePreview ? () => {
                void scheduleAction.execute(() => localScheduleApi.applyPlan(localSchedulePreview.planRevision));
              } : undefined}
              applyingPlan={scheduleAction.pending}
              onRollover={canOperate && localScheduleRollover ? (confirmPinned) => rolloverAction.execute(() => localScheduleApi.applyRollover(
                  localScheduleRollover.rolloverRevision,
                  confirmPinned,
                )) : undefined}
              rollingOver={rolloverAction.pending}
              onApplyUrgent={canOperate && localScheduleUrgent ? (confirmPinned) => {
                void urgentAction.execute(() => localScheduleApi.applyUrgent(
                  localScheduleUrgent.urgentRevision,
                  confirmPinned,
                ));
              } : undefined}
              applyingUrgent={urgentAction.pending}
            />
          </Suspense>
              </div>
            </div>
            <aside
              className="order-2 min-w-0 lg:col-start-2 lg:row-start-1"
              data-testid="home-create-column"
              onFocusCapture={() => setRolloverPromptSuppressed(true)}
              onInputCapture={() => setRolloverPromptSuppressed(true)}
            >
              <HomeTaskComposer
                inline
                mobileOpen={mobileTaskComposerOpen}
                onMobileOpenChange={setMobileTaskComposerOpen}
                projectId={projectId}
                projectName={project?.name}
                projects={projects.map((item) => ({ id: item.id, name: item.name }))}
                onProjectChange={(nextProjectId) => projectSelection.selectProject(nextProjectId, projectId)}
                projectError={projectSelection.error}
                draftGoal={composerDraftTask}
                onDraftGoalApplied={() => setComposerDraftTask(null)}
                reviewFacts={{
                  computer: state?.device ? `${state.device.name} — ${readableAgentStatus(state.device.status)}` : "—",
                  agent: agent?.name ?? t("dashboard.noAgent"),
                  risk: agent?.registrationNotes?.risk ?? t("dashboard.reviewAgent"),
                  cost: agent?.registrationNotes?.cost ?? costText(agent?.economics),
                  data: agent?.registrationNotes?.data ?? t("dashboard.recorded"),
                  cancellation: agent?.registrationNotes?.cancellation ?? cancellationText(agent?.adapter),
                }}
                worktreeId={attachmentWorktree?.id}
                terminalId={state?.device?.id}
                unavailable={!state}
                readOnly={!canOperate}
                showTrigger={false}
                onCreated={() => setDailyRefreshVersion((version) => version + 1)}
                onOpenTask={(workItemId) => openWorkItem(workItemId)}
                onOpenSetup={(section) => navigate(section)}
                onOpenProjects={() => navigate("projects")}
              />
            </aside>
          </div>
        </>
      ) : null}
      {surface === "overview" && invocation && homeNextAction.state !== "approval" ? (
        <Card
          className="order-0 border-primary/30"
          data-testid="home-ai-work-status"
          data-home-work-state={homeNextAction.state}
        >
          <CardContent className="flex flex-col gap-4 pt-5 sm:flex-row sm:items-center">
            <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
              <Bot className="size-5" aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="font-semibold">{t("dashboard.simpleRun.title")}</h2>
                <StatusBadge tone={homeStateTone(homeNextAction.state)}>
                  {t(`dashboard.nextAction.state.${homeNextAction.state}` as never)}
                </StatusBadge>
              </div>
              <p className="mt-1 truncate text-sm font-medium [overflow-wrap:anywhere]">
                {trackedInvocationItem?.title ?? invocation.input?.task ?? t("dashboard.untitledTask")}
              </p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                {trackedInvocationItem ? t("dashboard.simpleRun.trackedHint") : t("dashboard.simpleRun.temporaryHint")}
              </p>
            </div>
            <div className="grid shrink-0 gap-2 sm:flex">
              <Button
                className="min-h-11"
                data-home-primary-action={trackedWorkItemId ? "open_task" : homeNextAction.action}
                onClick={() => trackedWorkItemId
                  ? openWorkItem(trackedWorkItemId)
                  : performPrimaryAction(homeNextAction.action)}
              >
                {trackedWorkItemId
                  ? t("dashboard.simpleRun.openTask")
                  : t(`dashboard.nextAction.action.${homeNextAction.action}` as never)}
                <ArrowRight aria-hidden />
              </Button>
              {homeNextAction.state === "running" ? (
                <Button
                  className="min-h-11"
                  variant="secondary"
                  disabled={cancelDisabled || cancelAction.pending}
                  onClick={() => void cancelTask()}
                >
                  {t("dashboard.cancel")}
                </Button>
              ) : null}
            </div>
          </CardContent>
        </Card>
      ) : null}
      {surface === "overview" && activeInvocations.length > 1 ? (
        <div className="order-4">
          <Card>
            <CardHeader className="flex-row items-center justify-between gap-3 pb-2">
              <div>
                <CardTitle>{t("dashboard.activeTasks")}</CardTitle>
                <p className="mt-1 text-xs text-muted-foreground">{t("dashboard.parallelHint")}</p>
              </div>
              <StatusBadge tone={localInFlightCount >= maxLocalConcurrency ? "warning" : "neutral"}>
                {t("dashboard.capacity", { count: localInFlightCount, total: maxLocalConcurrency })}
              </StatusBadge>
            </CardHeader>
            <CardContent className="grid gap-2 sm:grid-cols-2">
              {activeInvocations.slice(0, 6).map((item) => {
                const itemAgent = (state?.agents ?? []).find((candidate) => candidate.id === item.agentId);
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      setSelectedInvocationId(item.id);
                      setInvocationStatusFilter("active");
                      navigate("invocations");
                    }}
                    className="flex min-w-0 items-center justify-between gap-3 rounded-md border border-border px-3 py-2 text-left hover:bg-muted/50"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">{item.input?.task || t("dashboard.untitledTask")}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {itemAgent?.name ?? item.agentId ?? "—"}
                      </span>
                    </span>
                    <StatusBadge tone={statusTone(item.status)}>{invocationStatus(t, item.status)}</StatusBadge>
                  </button>
                );
              })}
            </CardContent>
          </Card>
        </div>
      ) : null}
      {surface === "overview" && !invocation ? <div className="order-first"><GuidedSetupCard /></div> : null}
      {/* Transcript — the scrolling conversation area. */}
      {surface === "workspace" && invocation ? <div ref={activityRef} tabIndex={-1} className="order-6 flex min-h-48 flex-1 flex-col outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <Card className="flex min-h-48 flex-1 flex-col">
        <CardHeader>
          <SectionHeading
            eyebrow={t("dashboard.activity")}
            title={resultHeading(t, invocation?.status)}
            actions={<StatusBadge tone={statusTone(invocation?.status)}>{invocationStatus(t, invocation?.status)}</StatusBadge>}
          />
        </CardHeader>
        <div ref={scrollRef} onScroll={onTranscriptScroll} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 pb-5">
          {userTask ? (
            <div className="flex justify-end">
              <div className="max-w-[85%] rounded-lg rounded-br-sm bg-primary/10 px-3 py-2 text-sm [overflow-wrap:anywhere]">
                {userTask}
              </div>
            </div>
          ) : null}
          {/* #1074/#1086: the rich per-run transcript (thinking / tool IN-OUT /
              Markdown). While running it announces itself honestly; the fetch
              only fires once the run is terminal. */}
          <RunTranscriptSection invocationId={invocation?.id} terminal={Boolean(terminalStatus)} />
          <Transcript
            events={events}
            renderAction={(event) => <DecisionAction event={event} />}
            summary={transcriptSummary}
            onOpenReview={() => navigate("review")}
          />
        </div>
        </Card>
      </div> : null}

      {surface === "workspace" ? (
      <details className="contents" open>
        <summary className="hidden">{t("dashboard.temporaryRun")}</summary>
      <AgentRunComposer
        compact
        disabled={runAction.pending}
        className="order-4 shrink-0"
        title={composerTitle}
        context={composerContext}
        task={task}
        taskLabel={t("dashboard.task")}
        placeholder={t("dashboard.taskPlaceholder")}
        rows={3}
        textareaRef={taskInputRef}
        onTaskChange={(value) => {
          setTask(value);
          runIdempotencyKeyRef.current = null;
        }}
        onTaskPaste={(event) => {
          if (targetWorktree && event.clipboardData.files.length > 0) {
            event.preventDefault();
            void addFiles(event.clipboardData.files);
          }
        }}
        headerAction={null}
        beforeInput={resumeFromInvocationId ? (
            <div className="flex items-center justify-between gap-2 rounded-md border border-primary/40 bg-primary/5 px-3 py-2 text-xs">
              <span className="min-w-0">
                {t("dashboard.continueSession")}
                <span className="block truncate font-medium [overflow-wrap:anywhere]">
                  {resumeSource?.input?.task ?? resumeFromInvocationId}
                </span>
              </span>
              <button
                type="button"
                onClick={() => setResumeFromInvocationId(null)}
                className="shrink-0 text-muted-foreground hover:text-foreground"
              >
                {t("dashboard.startFresh")}
              </button>
            </div>
          ) : null}
        toolbar={composerToolbar}
      >
          {blockReason && (hasTask || !agent) && !runAction.error ? (
            <p className="text-xs text-muted-foreground" aria-live="polite">{blockReason}</p>
          ) : null}

          {homeNextAction.state !== "idle" ? (
            <section
              aria-label={t("dashboard.nextAction.label")}
              data-home-work-state={homeNextAction.state}
              className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-muted/30 p-3"
            >
              <div className="min-w-0 flex-1">
                <StatusBadge tone={homeStateTone(homeNextAction.state)}>
                  {t(`dashboard.nextAction.state.${homeNextAction.state}` as never)}
                </StatusBadge>
                <p className="mt-1 text-xs text-muted-foreground">
                  {t(`dashboard.nextAction.hint.${homeNextAction.state}` as never)}
                </p>
              </div>
              <Button
                data-home-primary-action={homeNextAction.action}
                className="min-h-11"
                onClick={() => performPrimaryAction(homeNextAction.action)}
              >
                {t(`dashboard.nextAction.action.${homeNextAction.action}` as never)}
              </Button>
            {homeNextAction.state === "running" ? (
              <Button
                className="min-h-11"
                variant="secondary"
                disabled={cancelDisabled || cancelAction.pending}
                onClick={() => void cancelTask()}
              >
                {t("dashboard.cancel")}
              </Button>
            ) : null}
            {retryableFailure && invocation?.input?.task ? (
              <Button
                className="min-h-11"
                variant="secondary"
                onClick={() => {
                  setTask(invocation.input?.task ?? "");
                  runIdempotencyKeyRef.current = null;
                  taskInputRef.current?.focus();
                }}
              >
                {t("dashboard.retryTask")}
              </Button>
            ) : null}
            </section>
          ) : null}
          {retryableFailure ? (
            <p className="text-xs text-muted-foreground">{t("dashboard.retryHint")}</p>
          ) : null}
          {runAction.error ? <ActionErrorNotice error={runAction.error} onRetry={runTask} labels={{
            cause: t("actionError.cause"), impact: t("actionError.impact"), remedy: t("actionError.remedy"), retry: t("actionError.retry"),
          }} /> : null}
          {cancelAction.error ? <ActionErrorNotice error={cancelAction.error} onRetry={cancelTask} labels={{
            cause: t("actionError.cause"), impact: t("actionError.impact"), remedy: t("actionError.remedy"), retry: t("actionError.retry"),
          }} /> : null}

          <details className="group rounded-lg border border-border px-3 py-2">
            <summary className="min-h-7 cursor-pointer list-none py-1 text-sm font-medium text-muted-foreground">
              {t("dashboard.preRunReview")}
            </summary>
            <div className="space-y-3 pt-3">
              <div className="grid grid-cols-2 gap-3 rounded-lg border border-border bg-muted/30 p-3 text-sm sm:grid-cols-4">
                <ReviewItem label={t("dashboard.safety")} value={agent?.registrationNotes?.risk ?? t("dashboard.reviewAgent")} />
                <ReviewItem label={t("dashboard.data")} value={agent?.registrationNotes?.data ?? t("dashboard.recorded")} />
                <ReviewItem label={t("dashboard.cost")} value={agent?.registrationNotes?.cost ?? costText(agent?.economics)} />
                <ReviewItem
                  label={t("dashboard.cancellation")}
                  value={agent?.registrationNotes?.cancellation ?? cancellationText(agent?.adapter)}
                />
              </div>
              <div className="grid gap-3">
                <Field label={t("dashboard.project")}>
                  <Select
                    value={projectId ?? ""}
                    onChange={(e) => setSelectedProjectId(e.target.value || null)}
                    aria-label={t("dashboard.project")}
                  >
                    {projects.length === 0 ? <option value="">{t("dashboard.noProject")}</option> : null}
                    {projects.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>

              {targetWorktree ? (
                <div className="flex items-center justify-between gap-2 rounded-md border border-primary/40 bg-primary/5 px-3 py-2 text-xs">
                  <span className="min-w-0">
                    {t("dashboard.runningIn", { branch: targetWorktree.branch })}
                    <span className="block truncate font-mono text-[11px] text-muted-foreground">{targetWorktree.path}</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => setSelectedWorktreeId(null)}
                    className="shrink-0 text-muted-foreground hover:text-foreground"
                  >
                    {t("dashboard.projectDefault")}
                  </button>
                </div>
              ) : null}
              <FactList
                facts={[
                  { term: t("dashboard.computer"), value: state?.device ? `${state.device.name} — ${readableAgentStatus(state.device.status)}` : "—" },
                  { term: t("dashboard.adapter"), value: adapterText(agent?.adapter) },
                  { term: t("dashboard.lifecycle"), value: lifecycleText(agent) },
                  { term: t("dashboard.taskId"), value: invocation?.id ?? t("dashboard.noTask") },
                  { term: t("dashboard.trace"), value: invocation?.traceId ?? t("dashboard.noTrace") },
                  {
                    term: t("dashboard.state"),
                    value: invocation
                      ? `${invocation.status} / ${invocation.delivery?.state ?? t("dashboard.noDelivery")}`
                      : t("dashboard.noTask"),
                  },
                ]}
              />
            </div>
          </details>
      </AgentRunComposer>
      </details>
      ) : null}
    </div>
  );
}

function ReviewItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-0.5">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="text-sm [overflow-wrap:anywhere]">{value}</p>
    </div>
  );
}

function homeStateTone(state: ReturnType<typeof deriveHomeNextAction>["state"]) {
  if (state === "running") return "running" as const;
  if (state === "approval") return "warning" as const;
  if (state === "failed") return "danger" as const;
  if (state === "succeeded") return "success" as const;
  return "neutral" as const;
}
