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
import { GettingStartedCard } from "@/features/dashboard/getting-started-card";
import { EntryJourney } from "@/features/dashboard/entry-journey";
import { useConsoleState } from "@/data/use-console-state";
import { useAsyncAction, api } from "@/data/use-console-actions";
import { resolveAgents, resolveInvocation } from "@/features/selection";
import { useUiStore } from "@/store/ui-store";
import {
  activityTitle,
  adapterText,
  cancellationText,
  costText,
  lifecycleText,
  readableAgentStatus,
  readableHealthLabel,
  readableStatus,
  statusTone,
} from "@/lib/readable-labels";
import type { AgentSnapshot, ConsoleSnapshot, InvocationSnapshot } from "@/lib/console-state";
import { useAppTranslation } from "@/lib/i18n/use-app-translation";

type Translate = ReturnType<typeof useAppTranslation>["t"];

const RUNNING_STATES = ["queued", "dispatching", "waiting_for_local_approval", "running", "cancelling"];
const CANCELLABLE_STATES = ["queued", "dispatching", "waiting_for_local_approval", "running"];

function runBlockReason(
  state: ConsoleSnapshot | undefined,
  agent: AgentSnapshot | null,
  hasTask: boolean,
  invocation: InvocationSnapshot | null,
  t: Translate,
): string {
  if (!state) return t("dashboard.block.offline");
  if (!hasTask) return t("dashboard.block.task");
  if (!agent) return t("dashboard.block.agent");
  if (agent.status === "disabled")
    return t("dashboard.block.disabled", { name: agent.name });
  if (agent.health?.status === "unhealthy")
    return t("dashboard.block.unhealthy", { name: agent.name });
  if (RUNNING_STATES.includes(invocation?.status ?? ""))
    return t("dashboard.block.running");
  return "";
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
  const { execute, pending, error } = useAsyncAction();

  const projects = state?.projects ?? [];
  const projectId = selectedProjectId ?? projects[0]?.id ?? null;
  const targetWorktree =
    (state?.worktrees ?? []).find((w) => w.id === selectedWorktreeId && w.projectId === projectId) ?? null;

  useEffect(() => {
    if (targetWorktree?.agentId) setSelectedAgentId(targetWorktree.agentId);
  }, [targetWorktree?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const [task, setTask] = useState<string>(
    t("dashboard.defaultTask"),
  );

  const { agents, agent } = resolveAgents(state, selectedAgentId);
  const invocation = resolveInvocation(state, selectedInvocationId);

  const hasTask = task.trim().length > 0;
  const isRunning = RUNNING_STATES.includes(invocation?.status ?? "");
  const unhealthy = agent?.health?.status === "unhealthy";
  const disabledAgent = agent?.status === "disabled";
  const localOffline = agent?.location?.type === "local_device" && state?.device?.status !== "online";

  const runDisabled = !state || !hasTask || !agent || isRunning || disabledAgent || unhealthy || pending;
  const cancelDisabled = !invocation || !CANCELLABLE_STATES.includes(invocation.status ?? "");
  const blockReason = runBlockReason(state, agent, hasTask, invocation, t);

  // Ascending (oldest → newest) so the transcript reads as a conversation and
  // new blocks append at the bottom.
  const events = useMemo(() => {
    if (!state) return [];
    const filtered = invocation
      ? state.events.filter((e) => e.invocationId === invocation.id || e.data?.agentId === agent?.id)
      : state.events;
    return [...filtered].sort((a, b) => a.createdAt.localeCompare(b.createdAt)).slice(-50);
  }, [state, invocation, agent?.id]);

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
    const submitted = task.trim();
    const resumeId = resumeFromInvocationId;
    const options = resumeId ? { codexSessionMode: "continue_last", resumeFromInvocationId: resumeId } : undefined;
    await execute(async () => {
      const created = (await api.createInvocation(submitted, agent?.id ?? null, projectId, targetWorktree?.id ?? null, options)) as {
        invocation: { id: string };
      };
      setSelectedInvocationId(created.invocation.id);
      setTask(""); // clear the composer on send; the task shows as the user bubble
      setResumeFromInvocationId(null); // one-shot: consume the resume intent
      return created;
    });
  }

  const userTask = invocation?.input?.task;
  // Show a final summary block once the run reaches a terminal state.
  const terminalStatus =
    invocation && invocation.status && !RUNNING_STATES.includes(invocation.status) ? invocation.status : null;
  const transcriptSummary = terminalStatus
    ? { text: invocation?.result?.summary, status: terminalStatus }
    : undefined;

  return (
    <div className="flex min-h-full flex-col gap-4">
      {/* Onboarding is a home concern — Workspace embeds the composer without it (#927). */}
      {surface === "overview" ? <GettingStartedCard /> : null}
      {surface === "overview" ? <EntryJourney /> : null}
      {/* Transcript — the scrolling conversation area. */}
      <Card className="flex min-h-48 flex-1 flex-col">
        <CardHeader>
          <SectionHeading
            eyebrow={t("dashboard.activity")}
            title={activityTitle(invocation?.status)}
            actions={<StatusBadge tone={statusTone(invocation?.status)}>{readableStatus(invocation?.status)}</StatusBadge>}
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

      {/* Composer — pinned below the transcript. */}
      <Card className="shrink-0">
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
          <Textarea rows={3} value={task} onChange={(e) => setTask(e.target.value)} aria-label={t("dashboard.task")} />

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

          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={runTask} disabled={runDisabled}>
              {localOffline ? t("dashboard.queue") : t("dashboard.run")}
            </Button>
            <Button
              variant="secondary"
              disabled={cancelDisabled || pending}
              onClick={() => invocation && execute(() => api.cancelInvocation(invocation.id))}
            >
              {t("dashboard.cancel")}
            </Button>
            {blockReason || error ? (
              <span className="text-xs text-muted-foreground" aria-live="polite">
                {error ?? blockReason}
              </span>
            ) : null}
          </div>

          <details className="group rounded-lg border border-border px-3 py-2">
            <summary className="cursor-pointer list-none text-sm font-medium text-muted-foreground">
              {t("dashboard.details")}
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
