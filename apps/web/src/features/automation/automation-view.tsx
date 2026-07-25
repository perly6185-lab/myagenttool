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
import { statusTone } from "@/lib/readable-labels";
import { invocationStatus } from "@/lib/i18n/readable-labels";
import { useAppTranslation } from "@/lib/i18n/use-app-translation";
import {
  healthFor,
  matchesScheduleFilter,
  scheduleHealthTone,
  SCHEDULE_FILTERS,
  type ScheduleFilter,
} from "@/features/automation/schedule-health-ui";
import type { AutomationSnapshot } from "@/lib/console-state";
import { AutoRunConfigCard } from "@/features/auto-runs/auto-run-config-card";

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
  const { t } = useAppTranslation();
  const { data: state } = useConsoleState();
  const { execute, pending } = useAsyncAction();
  const automations = state?.automations ?? [];
  const agents = state?.agents ?? [];
  const projects = state?.projects ?? [];
  // Selection lives in the store so a focused schedule survives a deep link and a
  // refresh (#849) — an attention badge that cannot be linked to is a dead end.
  const selectedId = useUiStore((s) => s.selectedAutomationId);
  const setSelectedId = useUiStore((s) => s.setSelectedAutomationId);
  const [filter, setFilter] = useState<ScheduleFilter["key"]>("all");
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<AutomationSnapshot | null>(null);
  const [detailTab, setDetailTab] = useState<"overview" | "runs">("overview");
  const setSection = useUiStore((s) => s.setSection);
  const setSelectedInvocationId = useUiStore((s) => s.setSelectedInvocationId);

  const scheduleHealth = state?.scheduleHealth ?? [];
  const visible = automations.filter((a) => matchesScheduleFilter(healthFor(a.id, scheduleHealth), filter));
  const selected = automations.find((a) => a.id === selectedId) ?? visible[0] ?? automations[0] ?? null;
  const selectedHealth = selected ? healthFor(selected.id, scheduleHealth) : undefined;
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
    <div className="space-y-4">
      <AutoRunConfigCard />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,320px)_minmax(0,1fr)]">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-2">
            <div>
              <CardTitle>{t("automationPage.title")}</CardTitle>
              <p className="text-sm text-muted-foreground">{t("automationPage.description")}</p>
            </div>
            <Button variant="secondary" size="sm" onClick={() => setCreating(true)} title={t("automationPage.new")} aria-label={t("automationPage.new")}>
              <Plus className="size-4" />
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="flex flex-wrap gap-1.5">
            {SCHEDULE_FILTERS.map((option) => {
              const count = automations.filter((a) =>
                matchesScheduleFilter(healthFor(a.id, scheduleHealth), option.key),
              ).length;
              if (option.key !== "all" && option.key !== "attention" && count === 0) return null;
              return (
                <button
                  key={option.key}
                  type="button"
                  onClick={() => setFilter(option.key)}
                  className={cn(
                    "rounded-full border px-2.5 py-0.5 text-xs transition",
                    filter === option.key
                      ? "border-primary bg-primary/10 text-foreground"
                      : "border-border text-muted-foreground hover:bg-muted/40",
                  )}
                >
                  {t(`automationHealth.${option.key}` as never)} ({count})
                </button>
              );
            })}
          </div>

          {automations.length === 0 ? (
            <EmptyState title={t("automationPage.empty")} hint={t("automationPage.emptyHint")} />
          ) : visible.length === 0 ? (
            <EmptyState title={t("automationPage.noMatches")} hint={t("automationPage.noMatchesHint")} />
          ) : (
            visible.map((a) => {
              const health = healthFor(a.id, scheduleHealth);
              return (
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
                    {health ? (
                      <Badge tone={scheduleHealthTone(health.state)}>{t(`automationHealth.${health.state}` as never)}</Badge>
                    ) : (
                      <Clock className="size-3.5 shrink-0 text-muted-foreground" />
                    )}
                  </div>
                  <div className="mt-1 truncate text-xs text-muted-foreground">{a.schedule.label}</div>
                  <div className="mt-0.5 truncate text-xs text-muted-foreground">
                    {projectName(a.projectId)}
                    {a.target?.kind === "capability"
                      ? ` · ${a.target.capability}`
                      : `${a.branch ? ` · ${a.branch}` : ""} · ${agentName(a.agentId)}`}
                  </div>
                </button>
              );
            })
          )}
        </CardContent>
      </Card>

      {selected ? (
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <CardTitle>{selected.name}</CardTitle>
                  <Badge tone={selected.enabled ? "success" : "neutral"}>{t(selected.enabled ? "automationPage.enabled" : "automationPage.paused")}</Badge>
                  {selectedHealth ? (
                    <Badge tone={scheduleHealthTone(selectedHealth.state)}>
                      {t(`automationHealth.${selectedHealth.state}` as never)}
                    </Badge>
                  ) : null}
                </div>
                <p className="text-sm text-muted-foreground">
                  {projectName(selected.projectId)}
                  {selected.branch ? ` / ${selected.branch}` : ""}
                </p>
                {/*
                  The reason, in words. A schedule parked on an approval produces no
                  error and no failed run — it simply stops, and looks exactly like a
                  schedule with nothing to do. Saying so is the entire point (#848).
                */}
                {selectedHealth?.reason ? (
                  <p
                    className={cn(
                      "mt-1 text-xs",
                      selectedHealth.needsAttention ? "text-warning" : "text-muted-foreground",
                    )}
                  >
                    {selectedHealth.reason}
                  </p>
                ) : null}
              </div>
              <div className="flex items-center gap-1.5">
                <Button size="sm" disabled={pending} onClick={() => runNow(selected)}>
                  <Play className="mr-1 size-3.5" /> {t("automationPage.runNow")}
                </Button>
                <Button variant="secondary" size="sm" disabled={pending} onClick={() => setEditing(selected)} title={t("automationPage.edit")} aria-label={t("automationPage.edit")}>
                  <Pencil className="size-3.5" />
                </Button>
                <Button variant="secondary" size="sm" disabled={pending} onClick={() => toggle(selected)} title={t(selected.enabled ? "automationPage.pause" : "automationPage.enable")}>
                  <Pause className="size-3.5" />
                </Button>
                <Button variant="secondary" size="sm" disabled={pending} onClick={() => remove(selected)} title={t("automationPage.delete")}>
                  <Trash2 className="size-3.5 text-destructive" />
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex gap-4 border-b border-border text-sm">
              {(["overview", "runs"] as const).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setDetailTab(tab)}
                  className={cn(
                    "-mb-px border-b-2 pb-2 capitalize transition",
                    detailTab === tab ? "border-primary font-medium text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
                  )}
                >
                  {tab === "runs" ? `${t("automationPage.runs")} ${runs.length}` : t("automationPage.overview")}
                </button>
              ))}
            </div>

            {detailTab === "runs" ? (
              runs.length === 0 ? (
                <EmptyState title={t("automationPage.noRuns")} hint={t("automationPage.noRunsHint")} />
              ) : (
                <div className="overflow-hidden rounded-lg border border-border">
                  <table className="w-full text-sm">
                    <tbody>
                      {runs.map((r) => (
                        <tr key={r.id} className="border-b border-border/60 last:border-0 hover:bg-muted/40">
                          <td className="px-3 py-2 font-mono text-xs text-muted-foreground">{r.id}</td>
                          <td className="px-3 py-2">
                            {r.options?.metadata?.scheduled ? (
                              <Badge tone="neutral">{t("automationPage.scheduled")}</Badge>
                            ) : (
                              <Badge tone="neutral">{t("automationPage.manual")}</Badge>
                            )}
                          </td>
                          <td className="px-3 py-2">
                            <Badge tone={statusTone(r.status)}>{invocationStatus(t, r.status)}</Badge>
                          </td>
                          <td className="px-3 py-2 text-right">
                            <button type="button" onClick={() => openRun(r.id)} className="text-xs text-primary hover:underline">
                              {t("automationPage.view")} →
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
                  { term: t("automationPage.schedule"), value: selected.schedule.label },
                  { term: t("automationPage.nextRun"), value: selected.nextRunAt ? new Date(selected.nextRunAt).toLocaleString() : selected.enabled ? "—" : t("automationPage.paused") },
                  { term: t("automationPage.runLocation"), value: selected.branch ?? "—" },
                  { term: t("automationPage.session"), value: selected.sessionMode === "fresh" ? t("automationPage.freshEach") : selected.sessionMode ?? "—" },
                  { term: t("automationPage.source"), value: `${projectName(selected.projectId)}${selected.branch ? ` · ${selected.branch}` : ""}` },
                  { term: t("automationPage.grace"), value: selected.graceHours != null ? t("automationPage.hours", { count: selected.graceHours }) : "—" },
                  { term: t("automationPage.precheck"), value: selected.precheck ?? t("automationPage.none") },
                  { term: t("automationPage.agent"), value: agentName(selected.agentId) },
                ]}
              />
            </div>
            <div className="rounded-lg border border-border p-4">
              <FactGrid
                cols="grid-cols-2 sm:grid-cols-4"
                items={[
                  { term: t("automationPage.lastRun"), value: selected.lastRunAt ? new Date(selected.lastRunAt).toLocaleString() : t("automationPage.never") },
                  { term: t("automationPage.runs"), value: String(selected.runCount ?? 0) },
                  { term: t("automationPage.tokens"), value: String(selected.tokens ?? 0) },
                  { term: t("automationPage.usage"), value: (selected.runCount ?? 0) > 0 ? t("automationPage.runCount", { count: selected.runCount }) : t("automationPage.noRunsShort") },
                ]}
              />
            </div>
            <div>
              <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">{t("automationPage.prompt")}</p>
              <p className="rounded-lg border border-border bg-muted/30 p-3 text-sm leading-relaxed text-foreground [overflow-wrap:anywhere]">
                {selected.prompt}
              </p>
            </div>
            <p className="text-xs text-muted-foreground">
              {t("automationPage.enabledHint")}
            </p>
              </>
            )}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-6">
            <EmptyState title={t("automationPage.noneSelected")} hint={t("automationPage.noneSelectedHint")} />
          </CardContent>
        </Card>
      )}

      <Modal open={creating} onClose={() => setCreating(false)} title={t("automationPage.new")}>
        <AutomationForm
          onDone={(id) => {
            setCreating(false);
            if (id) setSelectedId(id);
          }}
        />
      </Modal>

      <Modal open={Boolean(editing)} onClose={() => setEditing(null)} title={t("automationPage.edit")}>
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
    </div>
  );
}

// Create/edit form. With `automation` it pre-fills and PATCHes that rule;
// without, it POSTs a new one. Fields: name, target project/branch, agent,
// schedule, and the prompt the agent runs each time.
function AutomationForm({ automation, onDone }: { automation?: AutomationSnapshot; onDone: (id: string | null) => void }) {
  const { t } = useAppTranslation();
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
          <Sparkles className="mr-1 size-3.5" /> {t("automationPage.useTemplate")}
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
      <Field label={t("automationPage.name")}>
        <Input value={name} placeholder={t("automationPage.namePlaceholder")} onChange={(e) => setName(e.target.value)} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t("automationPage.project")}>
          <Select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("automationPage.branch")}>
          <Input value={branch} onChange={(e) => setBranch(e.target.value)} />
        </Field>
      </div>
      <Field label={t("automationPage.agent")}>
        <Select value={agentId} onChange={(e) => setAgentId(e.target.value)}>
          {agents.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </Select>
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t("automationPage.schedule")}>
          <Select value={kind} onChange={(e) => setKind(e.target.value as ScheduleKind)}>
            <option value="weekdays">{t("automationPage.weekdays")}</option>
            <option value="daily">{t("automationPage.daily")}</option>
            <option value="interval">{t("automationPage.interval")}</option>
          </Select>
        </Field>
        {kind === "interval" ? (
          <Field label={t("automationPage.everyMinutes")}>
            <Input
              type="number"
              min={1}
              value={everyMinutes}
              onChange={(e) => setEveryMinutes(Math.max(1, Number(e.target.value) || 1))}
            />
          </Field>
        ) : (
          <Field label={t("automationPage.time")}>
            <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
          </Field>
        )}
      </div>
      <Field label={t("automationPage.prompt")}>
        <Textarea rows={4} value={prompt} placeholder={t("automationPage.promptPlaceholder")} onChange={(e) => setPrompt(e.target.value)} />
      </Field>
      <Field label={t("automationPage.precheckOptional")}>
        <Input value={precheck} placeholder="e.g. gh pr list --json number -q '.[0].number'" onChange={(e) => setPrecheck(e.target.value)} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t("automationPage.session")}>
          <div className="flex gap-1 rounded-lg bg-muted p-0.5 text-xs">
            {(
              [
                ["fresh", t("automationPage.freshEach")],
                ["reuse", t("automationPage.reuse")],
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
        <Field label={t("automationPage.grace")}>
          <Select value={String(graceHours)} onChange={(e) => setGraceHours(Number(e.target.value))}>
            {[1, 6, 12, 24, 48].map((h) => (
              <option key={h} value={h}>
                {t("automationPage.hours", { count: h })}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <div className="flex justify-end gap-2 pt-1">
        <Button variant="secondary" size="sm" disabled={pending} onClick={() => onDone(null)}>
          {t("automationPage.cancel")}
        </Button>
        <Button size="sm" disabled={pending || !name.trim() || !projectId || !prompt.trim()} onClick={submit}>
          {t(automation ? "automationPage.save" : "automationPage.create")}
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
