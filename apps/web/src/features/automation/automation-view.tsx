import { useState } from "react";
import { Play, Pause, Trash2, Clock, Plus, Pencil, Sparkles } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Select, Textarea } from "@/components/ui/input";
import { Field } from "@/components/common/field";
import { Modal } from "@/components/ui/modal";
import { EmptyState } from "@/components/common/empty-state";
import { useConsoleState } from "@/data/use-console-state";
import { useAsyncAction, api } from "@/data/use-console-actions";
import { useUiStore } from "@/store/ui-store";
import { cn } from "@/lib/cn";
import { readableStatus, statusTone } from "@/lib/readable-labels";
import type { AutomationSnapshot } from "@/lib/console-state";

type ScheduleKind = "weekdays" | "daily" | "interval";

// Preset automation templates (the "Use template" menu). Each pre-fills the
// form's name, prompt, and schedule so common scheduled tasks are one click.
type AutomationTemplate = {
  category: string;
  name: string;
  description: string;
  prompt: string;
  schedule: { kind: ScheduleKind; time?: string; everyMinutes?: number };
};
const TEMPLATES: AutomationTemplate[] = [
  {
    category: "Repo health",
    name: "Weekday repo audit",
    description: "Check dependencies, failing tests, and risky open changes each weekday.",
    prompt:
      "Check the repository's health: dependency updates, failing tests, lint/type-check status, and risky open changes. Summarize findings and recommend next steps.",
    schedule: { kind: "weekdays", time: "09:00" },
  },
  {
    category: "Release prep",
    name: "Release readiness",
    description: "Weekly release-risk summary from the current project state.",
    prompt:
      "Prepare a release-readiness summary: open risks, unmerged work, test and type-check status, and a go/no-go recommendation.",
    schedule: { kind: "weekdays", time: "09:00" },
  },
  {
    category: "Periodic review",
    name: "Daily change review",
    description: "Scan recent work for correctness, UX, and test-coverage risks.",
    prompt:
      "Scan the most recent work and flag correctness, UX, and test-coverage risks. Summarize and suggest concrete follow-ups.",
    schedule: { kind: "daily", time: "18:00" },
  },
  {
    category: "Maintenance",
    name: "Hourly queue check",
    description: "Find stuck work, stale generated files, and failed local validation.",
    prompt:
      "Find stuck work, stale generated files, and failed local validation. Report anything that needs attention.",
    schedule: { kind: "interval", everyMinutes: 60 },
  },
];

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
  const [editing, setEditing] = useState<AutomationSnapshot | null>(null);
  const [detailTab, setDetailTab] = useState<"overview" | "runs">("overview");
  const setSection = useUiStore((s) => s.setSection);
  const setSelectedInvocationId = useUiStore((s) => s.setSelectedInvocationId);

  const selected = automations.find((a) => a.id === selectedId) ?? automations[0] ?? null;
  const agentName = (id: string) => agents.find((a) => a.id === id)?.name ?? id;
  const projectName = (id: string) => projects.find((p) => p.id === id)?.name ?? id;
  // Invocations this rule has triggered (run-now + scheduled), newest first.
  // Guard on `selected`: with no selection, `selected?.id` is undefined and would
  // match every ordinary invocation (whose automationId is also undefined).
  const runs = selected ? (state?.invocations ?? []).filter((i) => i.options?.metadata?.automationId === selected.id) : [];

  function openRun(invId: string) {
    setSelectedInvocationId(invId);
    setSection("invocations");
  }

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
                <Button variant="secondary" size="sm" disabled={pending} onClick={() => setEditing(selected)} title="Edit" aria-label="Edit automation">
                  <Pencil className="size-3.5" />
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
            <div className="flex gap-4 border-b border-border text-sm">
              {(["overview", "runs"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setDetailTab(t)}
                  className={cn(
                    "-mb-px border-b-2 pb-2 capitalize transition",
                    detailTab === t ? "border-primary font-medium text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
                  )}
                >
                  {t === "runs" ? `Runs ${runs.length}` : "Overview"}
                </button>
              ))}
            </div>

            {detailTab === "runs" ? (
              runs.length === 0 ? (
                <EmptyState title="No runs yet" hint="“Run now” or the schedule will create runs here." />
              ) : (
                <div className="overflow-hidden rounded-lg border border-border">
                  <table className="w-full text-sm">
                    <tbody>
                      {runs.map((r) => (
                        <tr key={r.id} className="border-b border-border/60 last:border-0 hover:bg-muted/40">
                          <td className="px-3 py-2 font-mono text-xs text-muted-foreground">{r.id}</td>
                          <td className="px-3 py-2">
                            {r.options?.metadata?.scheduled ? (
                              <Badge tone="neutral">scheduled</Badge>
                            ) : (
                              <Badge tone="neutral">manual</Badge>
                            )}
                          </td>
                          <td className="px-3 py-2">
                            <Badge tone={statusTone(r.status)}>{readableStatus(r.status)}</Badge>
                          </td>
                          <td className="px-3 py-2 text-right">
                            <button type="button" onClick={() => openRun(r.id)} className="text-xs text-primary hover:underline">
                              View →
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )
            ) : (
              <>
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
              </>
            )}
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

      <Modal open={Boolean(editing)} onClose={() => setEditing(null)} title="Edit automation">
        {editing ? (
          <AutomationForm
            automation={editing}
            onDone={(id) => {
              setEditing(null);
              if (id) setSelectedId(id);
            }}
          />
        ) : null}
      </Modal>
    </div>
  );
}

// Create/edit form. With `automation` it pre-fills and PATCHes that rule;
// without, it POSTs a new one. Fields: name, target project/branch, agent,
// schedule, and the prompt the agent runs each time.
function AutomationForm({ automation, onDone }: { automation?: AutomationSnapshot; onDone: (id: string | null) => void }) {
  const { data: state } = useConsoleState();
  const { execute, pending, error } = useAsyncAction();
  const projects = (state?.projects ?? []).filter((p) => p.status !== "archived");
  const agents = state?.agents ?? [];

  const [name, setName] = useState(automation?.name ?? "");
  const [projectId, setProjectId] = useState(automation?.projectId ?? projects[0]?.id ?? "");
  const [branch, setBranch] = useState(automation?.branch ?? "main");
  const [agentId, setAgentId] = useState(automation?.agentId ?? agents[0]?.id ?? "");
  const [kind, setKind] = useState<ScheduleKind>(automation?.schedule.kind ?? "weekdays");
  const [time, setTime] = useState(automation?.schedule.time ?? "09:00");
  const [everyMinutes, setEveryMinutes] = useState(automation?.schedule.everyMinutes ?? 60);
  const [prompt, setPrompt] = useState(automation?.prompt ?? "");
  const [precheck, setPrecheck] = useState(automation && automation.precheck !== "None" ? automation.precheck ?? "" : "");
  const [sessionMode, setSessionMode] = useState<"fresh" | "reuse">(automation?.sessionMode === "reuse" ? "reuse" : "fresh");
  const [graceHours, setGraceHours] = useState(automation?.graceHours ?? 12);
  const [showTemplates, setShowTemplates] = useState(false);

  function applyTemplate(t: AutomationTemplate) {
    setName(t.name);
    setPrompt(t.prompt);
    setKind(t.schedule.kind);
    if (t.schedule.time) setTime(t.schedule.time);
    if (t.schedule.everyMinutes) setEveryMinutes(t.schedule.everyMinutes);
    setShowTemplates(false);
  }

  function submit() {
    if (!name.trim() || !projectId || !prompt.trim()) return;
    const schedule = kind === "interval" ? { kind, everyMinutes } : { kind, time };
    const payload = {
      name: name.trim(),
      projectId,
      branch: branch.trim() || "main",
      agentId: agentId || undefined,
      schedule,
      prompt: prompt.trim(),
      precheck: precheck.trim() || "None",
      sessionMode,
      graceHours,
    };
    void execute(async () => {
      const r = (await (automation
        ? api.updateAutomation(automation.id, payload)
        : api.createAutomation(payload))) as { automation?: { id: string } };
      onDone(r.automation?.id ?? automation?.id ?? null);
      return r;
    });
  }

  return (
    <div className="space-y-3">
      <div className="relative flex justify-end">
        <Button variant="secondary" size="sm" onClick={() => setShowTemplates((v) => !v)}>
          <Sparkles className="mr-1 size-3.5" /> Use template
        </Button>
        {showTemplates ? (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setShowTemplates(false)} aria-hidden />
            <div className="absolute right-0 top-9 z-20 w-80 overflow-hidden rounded-lg border border-border bg-background shadow-lg">
              {TEMPLATES.map((t) => (
                <button
                  key={t.name}
                  type="button"
                  onClick={() => applyTemplate(t)}
                  className="block w-full border-b border-border/60 px-3 py-2.5 text-left last:border-0 hover:bg-muted/60"
                >
                  <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{t.category}</div>
                  <div className="text-sm font-medium">{t.name}</div>
                  <div className="text-xs text-muted-foreground">{t.description}</div>
                </button>
              ))}
            </div>
          </>
        ) : null}
      </div>
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
      <Field label="Pre-check (optional command)">
        <Input value={precheck} placeholder="e.g. gh pr list --json number -q '.[0].number'" onChange={(e) => setPrecheck(e.target.value)} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Session">
          <div className="flex gap-1 rounded-lg bg-muted p-0.5 text-xs">
            {(
              [
                ["fresh", "Fresh each run"],
                ["reuse", "Reuse"],
              ] as ["fresh" | "reuse", string][]
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setSessionMode(key)}
                className={cn(
                  "flex-1 rounded-md px-2 py-1.5 font-medium transition",
                  sessionMode === key ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </Field>
        <Field label="Grace">
          <Select value={String(graceHours)} onChange={(e) => setGraceHours(Number(e.target.value))}>
            {[1, 6, 12, 24, 48].map((h) => (
              <option key={h} value={h}>
                {h} hour{h === 1 ? "" : "s"}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <div className="flex justify-end gap-2 pt-1">
        <Button variant="secondary" size="sm" disabled={pending} onClick={() => onDone(null)}>
          Cancel
        </Button>
        <Button size="sm" disabled={pending || !name.trim() || !projectId || !prompt.trim()} onClick={submit}>
          {automation ? "Save changes" : "Create automation"}
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
