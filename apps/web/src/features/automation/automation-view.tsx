import { useState } from "react";
import { Play, Pause, Trash2, Clock } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/common/empty-state";
import { useConsoleState } from "@/data/use-console-state";
import { useAsyncAction, api } from "@/data/use-console-actions";
import { cn } from "@/lib/cn";
import type { AutomationSnapshot } from "@/lib/console-state";

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
          <CardTitle>Automation</CardTitle>
          <p className="text-sm text-muted-foreground">Rules that run an agent on a schedule.</p>
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
                <div className="mt-1 truncate text-xs text-muted-foreground">{a.schedule}</div>
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
                  { term: "Schedule", value: selected.schedule },
                  { term: "Next run", value: selected.nextRunAt ? new Date(selected.nextRunAt).toLocaleString() : "Scheduler pending" },
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
              Scheduling is descriptive for now — the cron trigger that fires this rule is a follow-up. “Run now” starts a real invocation.
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
