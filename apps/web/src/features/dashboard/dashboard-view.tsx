import { useEffect, useMemo, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/badge";
import { Select, Textarea } from "@/components/ui/input";
import { Field } from "@/components/common/field";
import { FactList } from "@/components/common/fact-list";
import { SectionHeading } from "@/components/common/section-heading";
import { Transcript } from "@/features/invocations/transcript";
import { DecisionAction } from "@/features/invocations/decision-action";
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

const RUNNING_STATES = ["queued", "dispatching", "waiting_for_local_approval", "running", "cancelling"];
const CANCELLABLE_STATES = ["queued", "dispatching", "waiting_for_local_approval", "running"];

function runBlockReason(
  state: ConsoleSnapshot | undefined,
  agent: AgentSnapshot | null,
  hasTask: boolean,
  invocation: InvocationSnapshot | null,
): string {
  if (!state) return "Server is offline.";
  if (!hasTask) return "Enter a task before running.";
  if (!agent) return "Select an agent before running.";
  if (agent.status === "disabled")
    return `${agent.name} is disabled. Enable it before running a new task.`;
  if (agent.health?.status === "unhealthy")
    return `${agent.name} is unhealthy. Run a health check after fixing it.`;
  if (RUNNING_STATES.includes(invocation?.status ?? ""))
    return "Wait for the current task to finish or cancel it.";
  return "";
}

export function DashboardView() {
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
  const { execute, pending, error } = useAsyncAction();

  const projects = state?.projects ?? [];
  const projectId = selectedProjectId ?? projects[0]?.id ?? null;
  const targetWorktree =
    (state?.worktrees ?? []).find((w) => w.id === selectedWorktreeId && w.projectId === projectId) ?? null;

  useEffect(() => {
    if (targetWorktree?.agentId) setSelectedAgentId(targetWorktree.agentId);
  }, [targetWorktree?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const [task, setTask] = useState(
    "Summarize the local demo state and confirm the bridge is working.",
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
  const blockReason = runBlockReason(state, agent, hasTask, invocation);

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

  async function runTask() {
    const submitted = task.trim();
    await execute(async () => {
      const created = (await api.createInvocation(submitted, agent?.id ?? null, projectId, targetWorktree?.id ?? null)) as {
        invocation: { id: string };
      };
      setSelectedInvocationId(created.invocation.id);
      setTask(""); // clear the composer on send; the task shows as the user bubble
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
    <div className="flex h-full flex-col gap-4">
      {/* Transcript — the scrolling conversation area. */}
      <Card className="flex min-h-0 flex-1 flex-col">
        <CardHeader>
          <SectionHeading
            eyebrow="Activity"
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
          <CardTitle>What should your computer do?</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Textarea rows={3} value={task} onChange={(e) => setTask(e.target.value)} aria-label="Task" />

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Project">
              <Select
                value={projectId ?? ""}
                onChange={(e) => setSelectedProjectId(e.target.value || null)}
                aria-label="Project"
              >
                {projects.length === 0 ? <option value="">No project</option> : null}
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Agent">
              <Select
                value={agent?.id ?? ""}
                onChange={(e) => setSelectedAgentId(e.target.value || null)}
                aria-label="Agent"
              >
                {agents.length === 0 ? <option value="">No agent registered</option> : null}
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
                Running in worktree <span className="font-medium">{targetWorktree.branch}</span>
                <span className="block truncate font-mono text-[11px] text-muted-foreground">{targetWorktree.path}</span>
              </span>
              <button
                type="button"
                onClick={() => setSelectedWorktreeId(null)}
                className="shrink-0 text-muted-foreground hover:text-foreground"
              >
                Use project default
              </button>
            </div>
          ) : null}

          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={runTask} disabled={runDisabled}>
              {localOffline ? "Queue for this computer" : "Run on this computer"}
            </Button>
            <Button
              variant="secondary"
              disabled={cancelDisabled || pending}
              onClick={() => invocation && execute(() => api.cancelInvocation(invocation.id))}
            >
              Cancel task
            </Button>
            {blockReason || error ? (
              <span className="text-xs text-muted-foreground" aria-live="polite">
                {error ?? blockReason}
              </span>
            ) : null}
          </div>

          <details className="group rounded-lg border border-border px-3 py-2">
            <summary className="cursor-pointer list-none text-sm font-medium text-muted-foreground">
              Technical details
            </summary>
            <div className="space-y-3 pt-3">
              <div className="grid grid-cols-2 gap-3 rounded-lg border border-border bg-muted/30 p-3 text-sm sm:grid-cols-4">
                <ReviewItem label="Safety" value={agent?.registrationNotes?.risk ?? "Review the selected agent before running."} />
                <ReviewItem label="Data" value={agent?.registrationNotes?.data ?? "Task input and result are recorded."} />
                <ReviewItem label="Cost" value={agent?.registrationNotes?.cost ?? costText(agent?.economics)} />
                <ReviewItem
                  label="Cancellation"
                  value={agent?.registrationNotes?.cancellation ?? cancellationText(agent?.adapter)}
                />
              </div>
              <FactList
                facts={[
                  { term: "Computer", value: state?.device ? `${state.device.name} — ${readableAgentStatus(state.device.status)}` : "—" },
                  { term: "Adapter", value: adapterText(agent?.adapter) },
                  { term: "Lifecycle", value: lifecycleText(agent) },
                  { term: "Task ID", value: invocation?.id ?? "No task yet" },
                  { term: "Trace", value: invocation?.traceId ?? "No trace yet" },
                  {
                    term: "State",
                    value: invocation
                      ? `${invocation.status} / ${invocation.delivery?.state ?? "no delivery"}`
                      : "No task yet",
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
