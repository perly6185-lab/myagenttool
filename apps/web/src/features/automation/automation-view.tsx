import { useState } from "react";
import { Play, Pause, Trash2, Clock, Plus } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Select, Textarea } from "@/components/ui/input";
import { Field } from "@/components/common/field";
import { Modal } from "@/components/ui/modal";
import { EmptyState } from "@/components/common/empty-state";
import { useConsoleState } from "@/data/use-console-state";
import { useAsyncAction, api } from "@/data/use-console-actions";
import { cn } from "@/lib/cn";
import type { AutomationSnapshot } from "@/lib/console-state";

type ScheduleKind = "weekdays" | "daily" | "interval";

// Automation = a saved task that runs an agent on a schedule/trigger. The cron
// scheduler that fires it is a follow-up; "Run now" already creates a real
// invocation. List on the left, the selected rule's detail on the right.
export function AutomationView() {
  const { data: state } = useConsoleState();
  const { execute, pending } = useAsyncAction();
  const automations = state?.automations ?? [];
  const agents = state?.agents ?? [];
  const projects = state?.projects ?? [];
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const selected = automations.find((a) => a.id === selectedId) ?? automations[0] ?? null;
  const agentName = (id: string) => agents.find((a) => a.id === id)?.name ?? id;
  const projectName = (id: string) => projects.find((p) => p.id === id)?.name ?? id;

  function toggle(a: AutomationSnapshot) {
    void execute(() => api.updateAutomation(a.id, { enabled: !a.enabled }));
  }
  function runNow(a: AutomationSnapshot) {
    void execute(() => api.runAutomation(a.id));
  }
  function remove(a: AutomationSnapshot) {
    if (a.id === selectedId) setSelectedId(null);
    void execute(() => api.deleteAutomation(a.id));
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,320px)_minmax(0,1fr)]">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-2">
            <div>
              <CardTitle>Automation</CardTitle>
              <p className="text-sm text-muted-foreground">Rules that run an agent on a schedule.</p>
            </div>
            <Button variant="secondary" size="sm" onClick={() => setCreating(true)} title="New automation" aria-label="New automation">
              <Plus className="size-4" />
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-2">
          {automations.length === 0 ? (
            <EmptyState title="No automations" hint="Scheduled agent runs will appear here." />
          ) : (
            automations.map((a) => (
              <button
                key={a.id}
                type="button"
                onClick={() => setSelectedId(a.id)}
                className={cn(
                  "block w-full rounded-lg border px-3 py-2.5 text-left transition",
                  selected?.id === a.id ? "border-primary bg-primary/5" : "border-border hover:bg-muted/40",
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="flex min-w-0 items-center gap-2">
                    <span className={cn("size-2 shrink-0 rounded-full", a.enabled ? "bg-success" : "bg-muted-foreground/40")} />
                    <span className="truncate text-sm font-medium">{a.name}</span>
                  </span>
                  <Clock className="size-3.5 shrink-0 text-muted-foreground" />
                </div>
                <div className="mt-1 truncate text-xs text-muted-foreground">{a.schedule.label}</div>
                <div className="mt-0.5 truncate text-xs text-muted-foreground">
                  {projectName(a.projectId)}
                  {a.branch ? ` · ${a.branch}` : ""} · {agentName(a.agentId)}
                </div>
              </button>
            ))
          )}
        </CardContent>
      </Card>

      {selected ? (
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <CardTitle>{selected.name}</CardTitle>
                  <Badge tone={selected.enabled ? "success" : "neutral"}>{selected.enabled ? "Enabled" : "Paused"}</Badge>
                </div>
                <p className="text-sm text-muted-foreground">
                  {projectName(selected.projectId)}
                  {selected.branch ? ` / ${selected.branch}` : ""}
                </p>
              </div>
              <div className="flex items-center gap-1.5">
                <Button size="sm" disabled={pending} onClick={() => runNow(selected)}>
                  <Play className="mr-1 size-3.5" /> Run now
                </Button>
                <Button variant="secondary" size="sm" disabled={pending} onClick={() => toggle(selected)} title={selected.enabled ? "Pause" : "Enable"}>
                  <Pause className="size-3.5" />
                </Button>
                <Button variant="secondary" size="sm" disabled={pending} onClick={() => remove(selected)} title="Delete">
                  <Trash2 className="size-3.5 text-destructive" />
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-lg border border-border p-4">
              <FactGrid
                cols="grid-cols-2 sm:grid-cols-3 lg:grid-cols-4"
                items={[
                  { term: "Schedule", value: selected.schedule.label },
                  { term: "Next run", value: selected.nextRunAt ? new Date(selected.nextRunAt).toLocaleString() : selected.enabled ? "—" : "Paused" },
                  { term: "Run location", value: selected.branch ?? "—" },
                  { term: "Session", value: selected.sessionMode === "fresh" ? "Fresh each run" : selected.sessionMode ?? "—" },
                  { term: "Source", value: `${projectName(selected.projectId)}${selected.branch ? ` · ${selected.branch}` : ""}` },
                  { term: "Grace", value: selected.graceHours != null ? `${selected.graceHours} hours` : "—" },
                  { term: "Pre-check", value: selected.precheck ?? "None" },
                  { term: "Agent", value: agentName(selected.agentId) },
                ]}
              />
            </div>
            <div className="rounded-lg border border-border p-4">
              <FactGrid
                cols="grid-cols-2 sm:grid-cols-4"
                items={[
                  { term: "Last run", value: selected.lastRunAt ? new Date(selected.lastRunAt).toLocaleString() : "Never" },
                  { term: "Runs", value: String(selected.runCount ?? 0) },
                  { term: "Tokens", value: String(selected.tokens ?? 0) },
                  { term: "Usage", value: (selected.runCount ?? 0) > 0 ? `${selected.runCount} run(s)` : "No runs" },
                ]}
              />
            </div>
            <div>
              <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Prompt</p>
              <p className="rounded-lg border border-border bg-muted/30 p-3 text-sm leading-relaxed text-foreground [overflow-wrap:anywhere]">
                {selected.prompt}
              </p>
            </div>
            <p className="text-xs text-muted-foreground">
              Enabled rules fire automatically on their schedule (checked every 30s). “Run now” triggers an extra run immediately.
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-6">
            <EmptyState title="No automation selected" hint="Pick a rule on the left to see its schedule and prompt." />
          </CardContent>
        </Card>
      )}

      <Modal open={creating} onClose={() => setCreating(false)} title="New automation">
        <AutomationForm
          onDone={(id) => {
            setCreating(false);
            if (id) setSelectedId(id);
          }}
        />
      </Modal>
    </div>
  );
}

// Create-automation form (the "+" modal): name, target project/branch, agent,
// schedule, and the prompt the agent runs each time.
function AutomationForm({ onDone }: { onDone: (id: string | null) => void }) {
  const { data: state } = useConsoleState();
  const { execute, pending, error } = useAsyncAction();
  const projects = (state?.projects ?? []).filter((p) => p.status !== "archived");
  const agents = state?.agents ?? [];

  const [name, setName] = useState("");
  const [projectId, setProjectId] = useState(projects[0]?.id ?? "");
  const [branch, setBranch] = useState("main");
  const [agentId, setAgentId] = useState(agents[0]?.id ?? "");
  const [kind, setKind] = useState<ScheduleKind>("weekdays");
  const [time, setTime] = useState("09:00");
  const [everyMinutes, setEveryMinutes] = useState(60);
  const [prompt, setPrompt] = useState("");

  function submit() {
    if (!name.trim() || !projectId || !prompt.trim()) return;
    const schedule = kind === "interval" ? { kind, everyMinutes } : { kind, time };
    void execute(async () => {
      const r = (await api.createAutomation({
        name: name.trim(),
        projectId,
        branch: branch.trim() || "main",
        agentId: agentId || undefined,
        schedule,
        prompt: prompt.trim(),
      })) as { automation?: { id: string } };
      onDone(r.automation?.id ?? null);
      return r;
    });
  }

  return (
    <div className="space-y-3">
      <Field label="Name">
        <Input value={name} placeholder="e.g. Nightly test run" onChange={(e) => setName(e.target.value)} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Project">
          <Select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Branch">
          <Input value={branch} onChange={(e) => setBranch(e.target.value)} />
        </Field>
      </div>
      <Field label="Agent">
        <Select value={agentId} onChange={(e) => setAgentId(e.target.value)}>
          {agents.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </Select>
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Schedule">
          <Select value={kind} onChange={(e) => setKind(e.target.value as ScheduleKind)}>
            <option value="weekdays">Weekdays</option>
            <option value="daily">Daily</option>
            <option value="interval">Every N minutes</option>
          </Select>
        </Field>
        {kind === "interval" ? (
          <Field label="Every (minutes)">
            <Input
              type="number"
              min={1}
              value={everyMinutes}
              onChange={(e) => setEveryMinutes(Math.max(1, Number(e.target.value) || 1))}
            />
          </Field>
        ) : (
          <Field label="Time">
            <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
          </Field>
        )}
      </div>
      <Field label="Prompt">
        <Textarea rows={4} value={prompt} placeholder="What should the agent do each run?" onChange={(e) => setPrompt(e.target.value)} />
      </Field>
      <div className="flex justify-end gap-2 pt-1">
        <Button variant="secondary" size="sm" disabled={pending} onClick={() => onDone(null)}>
          Cancel
        </Button>
        <Button size="sm" disabled={pending || !name.trim() || !projectId || !prompt.trim()} onClick={submit}>
          Create automation
        </Button>
      </div>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}

// Horizontal labelled-fact grid (the overview cards in the detail pane).
function FactGrid({ cols, items }: { cols: string; items: { term: string; value: string }[] }) {
  return (
    <div className={cn("grid gap-4", cols)}>
      {items.map((f) => (
        <div key={f.term} className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{f.term}</p>
          <p className="mt-0.5 text-sm text-foreground [overflow-wrap:anywhere]">{f.value}</p>
        </div>
      ))}
    </div>
  );
}
