import { useEffect, useMemo, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/badge";
import { Select, Textarea } from "@/components/ui/input";
import { Field } from "@/components/common/field";
import { FactList } from "@/components/common/fact-list";
import { SectionHeading } from "@/components/common/section-heading";
import { Transcript } from "@/features/invocations/transcript";
import { RunTranscriptSection } from "@/features/invocations/run-transcript";
import { DecisionAction } from "@/features/invocations/decision-action";
import { GuidedSetupCard } from "@/features/dashboard/guided-setup-card";
import { EntryJourney } from "@/features/dashboard/entry-journey";
import {
  deriveHomeNextAction,
  hasPendingDecisionForInvocation,
  type HomePrimaryAction,
} from "@/features/dashboard/home-next-action";
import { STARTER_TASK_TEMPLATES } from "@/features/dashboard/starter-task-templates";
import { ActionErrorNotice } from "@/components/common/action-error-notice";
import { useConsoleState } from "@/data/use-console-state";
import { useAsyncAction, api } from "@/data/use-console-actions";
import { resolveAgents, resolveInvocation } from "@/features/selection";
import { useUiStore } from "@/store/ui-store";
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
import type { AgentSnapshot, ConsoleSnapshot, InvocationSnapshot } from "@/lib/console-state";
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
  const selectedProjectId = useUiStore((s) => s.selectedProjectId);
  const setSelectedProjectId = useUiStore((s) => s.setSelectedProjectId);
  const selectedWorktreeId = useUiStore((s) => s.selectedWorktreeId);
  const setSelectedWorktreeId = useUiStore((s) => s.setSelectedWorktreeId);
  const setSection = useUiStore((s) => s.setSection);
  const resumeFromInvocationId = useUiStore((s) => s.resumeFromInvocationId);
  const setResumeFromInvocationId = useUiStore((s) => s.setResumeFromInvocationId);
  const runAction = useAsyncAction();
  const cancelAction = useAsyncAction();
  const runInFlightRef = useRef(false);
  const runIdempotencyKeyRef = useRef<string | null>(null);

  const projects = state?.projects ?? [];
  const projectId = selectedProjectId ?? projects[0]?.id ?? null;
  const targetWorktree =
    (state?.worktrees ?? []).find((w) => w.id === selectedWorktreeId && w.projectId === projectId) ?? null;

  useEffect(() => {
    if (targetWorktree?.agentId) setSelectedAgentId(targetWorktree.agentId);
  }, [targetWorktree?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const [task, setTask] = useState("");
  const taskInputRef = useRef<HTMLTextAreaElement>(null);
  const activityRef = useRef<HTMLDivElement>(null);

  const { agents, agent } = resolveAgents(state, selectedAgentId);
  const invocation = resolveInvocation(state, selectedInvocationId);
  useEffect(() => {
    runIdempotencyKeyRef.current = null;
  }, [agent?.id, projectId, targetWorktree?.id, resumeFromInvocationId]);
  const activeInvocations = useMemo(
    () => (state?.invocations ?? []).filter((item) => RUNNING_STATES.includes(item.status ?? "")),
    [state?.invocations],
  );
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
  // creates a `continue_last` run targeting that specific Codex session.
  const resumeSource = useMemo(
    () => (resumeFromInvocationId ? (state?.invocations ?? []).find((inv) => inv.id === resumeFromInvocationId) ?? null : null),
    [state?.invocations, resumeFromInvocationId],
  );

  async function runTask() {
    if (runInFlightRef.current) return;
    const submitted = task.trim();
    if (!submitted || !agent) return;
    const resumeId = resumeFromInvocationId;
    const options = resumeId ? { codexSessionMode: "continue_last", resumeFromInvocationId: resumeId } : undefined;
    const idempotencyKey = runIdempotencyKeyRef.current ?? createClientIdempotencyKey();
    runIdempotencyKeyRef.current = idempotencyKey;
    runInFlightRef.current = true;
    try {
      await runAction.execute(async () => {
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
      activityRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      activityRef.current?.focus({ preventScroll: true });
      return;
    }
    if (invocation) setSelectedInvocationId(invocation.id);
    setSection(action === "handle_approval" ? "approvals" : "invocations");
  }

  const userTask = invocation?.input?.task;
  // Show a final summary block once the run reaches a terminal state.
  const terminalStatus =
    invocation && invocation.status && !RUNNING_STATES.includes(invocation.status) ? invocation.status : null;
  const retryableFailure = Boolean(terminalStatus && ["failed", "timed_out", "rejected"].includes(terminalStatus));
  const transcriptSummary = terminalStatus
    ? { text: invocation?.result?.summary, status: terminalStatus }
    : undefined;

  return (
    <div className="flex min-h-full flex-col gap-4">
      {/* Visual order is task-first on Home while Workspace retains its transcript-first layout. */}
      {surface === "overview" && activeInvocations.length > 0 ? (
        <div className="order-2">
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
                    onClick={() => setSelectedInvocationId(item.id)}
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
      {surface === "overview" ? <div className="order-3"><GuidedSetupCard /></div> : null}
      {surface === "overview" ? <div className="order-4"><EntryJourney onCreate={() => taskInputRef.current?.focus()} /></div> : null}
      {/* Transcript — the scrolling conversation area. */}
      {invocation ? <div ref={activityRef} tabIndex={-1} className="order-5 flex min-h-48 flex-1 flex-col outline-none focus-visible:ring-2 focus-visible:ring-ring">
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
            onOpenReview={() => setSection("review")}
          />
        </div>
        </Card>
      </div> : null}

      {/* The ordinary Home action is first and stays above supporting status. */}
      <Card className={surface === "overview" ? "order-1 shrink-0" : "order-4 shrink-0"}>
        <CardHeader className="pb-2">
          <CardTitle>{t("dashboard.composerTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {resumeFromInvocationId ? (
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
          <Textarea
            ref={taskInputRef}
            rows={3}
            value={task}
            onChange={(e) => {
              setTask(e.target.value);
              runIdempotencyKeyRef.current = null;
            }}
            aria-label={t("dashboard.task")}
            placeholder={t("dashboard.taskPlaceholder")}
          />
          {!invocation ? (
            <div className="flex flex-wrap items-center gap-2" aria-label={t("dashboard.firstTaskTemplates")}>
              <span className="text-xs text-muted-foreground">{t("dashboard.nextStep")}</span>
              {STARTER_TASK_TEMPLATES.map((template) => (
                <Button
                  key={template.id}
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    setTask(t(template.taskKey));
                    runIdempotencyKeyRef.current = null;
                  }}
                >
                  {t(template.labelKey)}
                </Button>
              ))}
            </div>
          ) : null}

          <div className="grid grid-cols-2 gap-3 rounded-lg border border-border bg-muted/30 p-3 text-sm sm:grid-cols-4">
            <ReviewItem label={t("dashboard.safety")} value={agent?.registrationNotes?.risk ?? t("dashboard.reviewAgent")} />
            <ReviewItem label={t("dashboard.data")} value={agent?.registrationNotes?.data ?? t("dashboard.recorded")} />
            <ReviewItem label={t("dashboard.cost")} value={agent?.registrationNotes?.cost ?? costText(agent?.economics)} />
            <ReviewItem
              label={t("dashboard.cancellation")}
              value={agent?.registrationNotes?.cancellation ?? cancellationText(agent?.adapter)}
            />
          </div>

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
              disabled={homeNextAction.action === "run" ? runDisabled : false}
              onClick={() => performPrimaryAction(homeNextAction.action)}
            >
              {homeNextAction.action === "run" && willQueue
                ? t("dashboard.queue")
                : t(`dashboard.nextAction.action.${homeNextAction.action}` as never)}
            </Button>
            {homeNextAction.state === "running" && hasTask ? (
              <Button
                className="min-h-11"
                variant="secondary"
                disabled={runDisabled}
                onClick={() => void runTask()}
              >
                {willQueue ? t("dashboard.queue") : t("dashboard.run")}
              </Button>
            ) : null}
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
            {blockReason && !runAction.error ? (
              <span className="basis-full text-xs text-muted-foreground" aria-live="polite">
                {blockReason}
              </span>
            ) : null}
          </section>
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
              <div className="grid gap-3 sm:grid-cols-2">
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
                <Field label={t("dashboard.agent")}>
                  <Select
                    value={agent?.id ?? ""}
                    onChange={(e) => setSelectedAgentId(e.target.value || null)}
                    aria-label={t("dashboard.agent")}
                    title={agent ? `${agent.name} — ${readableAgentStatus(agent.status)} — ${readableHealthLabel(agent.health)}` : undefined}
                  >
                    {agents.length === 0 ? <option value="">{t("dashboard.noAgent")}</option> : null}
                    {agents.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name} — {readableAgentStatus(item.status)} — {readableHealthLabel(item.health)}
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
        </CardContent>
      </Card>
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
