import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/badge";
import { Select, Textarea } from "@/components/ui/input";
import { Field } from "@/components/common/field";
import { FactList } from "@/components/common/fact-list";
import { SectionHeading } from "@/components/common/section-heading";
import { EventTimeline } from "@/features/invocations/event-timeline";
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
  const { execute, pending, error } = useAsyncAction();

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

  const events = useMemo(() => {
    if (!state) return [];
    if (invocation) {
      return state.events
        .filter((e) => e.invocationId === invocation.id || e.data?.agentId === agent?.id)
        .slice(0, 30);
    }
    return state.events.slice(0, 30);
  }, [state, invocation, agent?.id]);

  async function runTask() {
    await execute(async () => {
      const created = (await api.createInvocation(task.trim(), agent?.id ?? null)) as {
        invocation: { id: string };
      };
      setSelectedInvocationId(created.invocation.id);
      return created;
    });
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)]">
      <Card>
        <CardHeader>
          <CardTitle>What should your computer do?</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Textarea rows={6} value={task} onChange={(e) => setTask(e.target.value)} aria-label="Task" />

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Computer">
              <Select disabled value={state?.device?.id ?? ""}>
                <option value={state?.device?.id ?? ""}>
                  {state?.device ? `${state.device.name} — ${readableAgentStatus(state.device.status)}` : "—"}
                </option>
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

          <div className="flex flex-wrap gap-2">
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
          </div>
          {blockReason || error ? (
            <p className="text-xs text-muted-foreground" aria-live="polite">
              {error ?? blockReason}
            </p>
          ) : null}

          <div className="grid grid-cols-2 gap-3 rounded-lg border border-border bg-muted/30 p-3 text-sm sm:grid-cols-4">
            <ReviewItem label="Safety" value={agent?.registrationNotes?.risk ?? "Review the selected agent before running."} />
            <ReviewItem label="Data" value={agent?.registrationNotes?.data ?? "Task input and result are recorded."} />
            <ReviewItem label="Cost" value={agent?.registrationNotes?.cost ?? costText(agent?.economics)} />
            <ReviewItem
              label="Cancellation"
              value={agent?.registrationNotes?.cancellation ?? cancellationText(agent?.adapter)}
            />
          </div>

          <details className="group rounded-lg border border-border px-3 py-2">
            <summary className="cursor-pointer list-none text-sm font-medium text-muted-foreground">
              Technical details
            </summary>
            <div className="pt-3">
              <FactList
                facts={[
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

      <Card>
        <CardHeader>
          <SectionHeading
            eyebrow="Activity"
            title={activityTitle(invocation?.status)}
            actions={<StatusBadge tone={statusTone(invocation?.status)}>{readableStatus(invocation?.status)}</StatusBadge>}
          />
        </CardHeader>
        <CardContent>
          <EventTimeline events={events} />
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
