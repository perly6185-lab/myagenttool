import { useMemo, useState } from "react";
import { CalendarClock } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Field } from "@/components/common/field";
import { EmptyState } from "@/components/common/empty-state";
import { SectionHeading } from "@/components/common/section-heading";
import { useConsoleState } from "@/data/use-console-state";
import { useUiStore } from "@/store/ui-store";
import { cn } from "@/lib/cn";
import { RegisterApplicationModal } from "@/features/applications/register-application-modal";
import {
  applicationMatchesSearch,
  applicationNextStep,
  applicationTriageBucket,
  applicationTriageCounts,
  latestApplicationRecoveryAction,
  sortApplicationsForTriage,
  sourceSummary,
  type ApplicationTriageFilter,
} from "@/features/applications/application-health";
import {
  readableRecoveryActionRequestStatus,
  readableRecoveryActionType,
  readableRecoveryOutcome,
  recoveryActionRequestTone,
  recoveryOutcomeTone,
} from "@/features/recovery/application-recovery-ui";
import type { ApplicationSnapshot } from "@/lib/console-state";
import type { Tone } from "@/lib/readable-labels";
import type { ApplicationEventLevelSelection } from "@/store/ui-store";

function statusTone(status: string): Tone {
  if (status === "active") return "success";
  if (status === "offline" || status === "registered" || status === "draft" || status === "probing") return "warning";
  if (status === "archived" || status === "failed") return "danger";
  return "neutral";
}

function automationScheduleCounts(app: ApplicationSnapshot) {
  return app.healthSummary?.automationCounts ?? { failing: 0, waitingForApproval: 0, paused: 0, attention: 0 };
}

function hasAutomationScheduleSignal(app: ApplicationSnapshot): boolean {
  const counts = automationScheduleCounts(app);
  return counts.failing > 0 || counts.waitingForApproval > 0 || counts.paused > 0;
}

function scheduleLabel(count: number, label: string): string {
  return `${count} ${label}${count === 1 ? "" : "s"}`;
}

function automationScheduleDetail(app: ApplicationSnapshot): string {
  const latest = app.healthSummary?.latestAutomationAttention;
  if (latest?.name && latest.nextAction) return `${latest.name}: ${latest.nextAction}`;
  if (latest?.name && latest.lastErrorSummary) return `${latest.name}: ${latest.lastErrorSummary}`;
  if (latest?.name) return latest.name;
  return "Open schedules to inspect the affected capability automation.";
}

function applicationScheduleButtonLabel(app: ApplicationSnapshot): string {
  const status = app.healthSummary?.latestAutomationAttention?.status;
  if (status === "failing") return "Inspect failing schedule";
  if (status === "waiting_for_approval") return "Review approval";
  if (status === "paused") return "Resume paused schedule";
  return "View schedules";
}

/** Registered applications and their governed capabilities (read-only slice). */
export function ApplicationsView() {
  const { data: state } = useConsoleState();
  const selectedApplicationId = useUiStore((s) => s.selectedApplicationId);
  const setSelectedApplicationId = useUiStore((s) => s.setSelectedApplicationId);
  const setSelectedApplicationRun = useUiStore((s) => s.setSelectedApplicationRun);
  const setSelectedApplicationEventLevel = useUiStore((s) => s.setSelectedApplicationEventLevel);
  const setSelectedApplicationAutomationId = useUiStore((s) => s.setSelectedApplicationAutomationId);

  const [status, setStatus] = useState<"all" | ApplicationSnapshot["status"]>("all");
  const [kind, setKind] = useState<"all" | string>("all");
  const [triage, setTriage] = useState<ApplicationTriageFilter>("all");
  const [search, setSearch] = useState("");
  const [registerOpen, setRegisterOpen] = useState(false);

  const all = state?.applications ?? [];
  const recoveryActions = state?.applicationRecoveryActions ?? [];
  const projectName = useMemo(() => {
    const map = new Map((state?.projects ?? []).map((project) => [project.id, project.name]));
    return (id?: string | null) => (id ? map.get(id) ?? id : null);
  }, [state?.projects]);

  const kinds = useMemo(() => Array.from(new Set(all.map((app) => app.kind))).sort(), [all]);
  const scopedApplications = useMemo(
    () =>
      all.filter(
        (app) => (status === "all" || app.status === status) && (kind === "all" || app.kind === kind),
      ),
    [all, status, kind],
  );
  const searchedApplications = useMemo(
    () => scopedApplications.filter((app) => applicationMatchesSearch(app, search)),
    [scopedApplications, search],
  );
  const triageCounts = useMemo(() => applicationTriageCounts(searchedApplications), [searchedApplications]);
  const applications = useMemo(
    () => sortApplicationsForTriage(
      searchedApplications.filter((app) => triage === "all" || applicationTriageBucket(app) === triage),
    ),
    [searchedApplications, triage],
  );

  function selectApplication(applicationId: string, eventLevel: ApplicationEventLevelSelection = "all", automationId: string | null = null) {
    setSelectedApplicationId(applicationId);
    setSelectedApplicationRun(null);
    setSelectedApplicationEventLevel(eventLevel);
    setSelectedApplicationAutomationId(automationId);
  }

  function selectRecoveryRun(applicationId: string, routineId: string, invocationId: string) {
    setSelectedApplicationId(applicationId);
    setSelectedApplicationRun({ applicationId, routineId, invocationId });
    setSelectedApplicationEventLevel("all");
    setSelectedApplicationAutomationId(null);
  }

  return (
    <div className="space-y-5">
      <SectionHeading
        eyebrow="Governed assets"
        title="Applications"
        description="Applications registered as governed assets from git, local, npm, or manual sources. Select one to inspect its capabilities, probe, and orchestrations."
        actions={
          <Button size="sm" onClick={() => setRegisterOpen(true)}>
            Register application
          </Button>
        }
      />

      <RegisterApplicationModal open={registerOpen} onClose={() => setRegisterOpen(false)} />

      <div className="flex flex-wrap items-end gap-3">
        <Field label="Search" className="w-64">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Name, id, source, path"
          />
        </Field>
        <Field label="Status" className="w-40">
          <Select value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
            <option value="all">All statuses</option>
            <option value="active">Active</option>
            <option value="registered">Registered</option>
            <option value="probing">Probing</option>
            <option value="offline">Offline</option>
            <option value="archived">Archived</option>
            <option value="failed">Failed</option>
          </Select>
        </Field>
        <Field label="Kind" className="w-44">
          <Select value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="all">All kinds</option>
            {kinds.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Triage" className="w-48">
          <Select value={triage} onChange={(e) => setTriage(e.target.value as ApplicationTriageFilter)}>
            <option value="all">All triage states</option>
            <option value="attention">Needs attention</option>
            <option value="warning">Watch</option>
            <option value="ready">Ready</option>
          </Select>
        </Field>
        <div className="flex flex-wrap items-center gap-2 pb-2">
          <span className="text-xs text-muted-foreground">
            {applications.length} of {searchedApplications.length} application(s)
          </span>
          {triageCounts.attention ? <Badge tone="danger">{triageCounts.attention} attention</Badge> : null}
          {triageCounts.warning ? <Badge tone="warning">{triageCounts.warning} watch</Badge> : null}
          {triageCounts.ready ? <Badge tone="success">{triageCounts.ready} ready</Badge> : null}
        </div>
      </div>

      {!applications.length ? (
        <EmptyState
          title={all.length ? "No applications match these filters" : "No applications registered"}
          hint={
            all.length
              ? "Loosen the search, status, kind, or triage filter."
              : "Register an application (git, local, npm, or manual) to expose its governed capabilities."
          }
        />
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          {applications.map((app) => {
            const nextStep = applicationNextStep(app);
            const latestRecoveryAction = app.healthSummary?.latestRecoveryAction ?? latestApplicationRecoveryAction(app.id, recoveryActions);
            const automationCounts = automationScheduleCounts(app);
            const attentionEventLevel: ApplicationEventLevelSelection | null = (app.healthSummary?.eventCounts.error ?? 0) > 0
              ? "error"
              : (app.healthSummary?.eventCounts.warning ?? 0) > 0
                ? "warning"
                : null;
            return (
              <Card
                key={app.id}
                onClick={() => selectApplication(app.id)}
                onFocusCapture={() => selectApplication(app.id)}
                tabIndex={0}
                className={cn(
                  "cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  selectedApplicationId === app.id && "border-primary/50",
                )}
              >
                <CardHeader>
                  <div className="flex items-start justify-between gap-3">
                    <CardTitle>{app.name}</CardTitle>
                    <Badge tone={statusTone(app.status)}>{app.status}</Badge>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {app.kind} · {app.source.type}
                  </p>
                </CardHeader>
                <CardContent className="space-y-3">
                  <p className="[overflow-wrap:anywhere] font-mono text-xs text-muted-foreground">
                    {sourceSummary(app.source)}
                  </p>
                  <div className="rounded-md border border-border bg-muted/40 p-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={nextStep.tone}>{nextStep.title}</Badge>
                      {app.lifecycle?.lastOperation ? (
                        <span className="text-xs text-muted-foreground">Last: {app.lifecycle.lastOperation}</span>
                      ) : null}
                    </div>
                    <p className="mt-1 [overflow-wrap:anywhere] text-xs text-muted-foreground">{nextStep.detail}</p>
                    {attentionEventLevel ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="mt-2 h-7 px-2 text-xs"
                        onClick={(event) => {
                          event.stopPropagation();
                          selectApplication(app.id, attentionEventLevel);
                        }}
                      >
                        {attentionEventLevel === "error" ? "View errors" : "View warnings"}
                      </Button>
                    ) : null}
                  </div>
                  {hasAutomationScheduleSignal(app) ? (
                    <div className="rounded-md border border-border bg-muted/40 p-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs font-medium">Schedules</span>
                        {automationCounts.failing > 0 ? (
                          <Badge tone="danger">{scheduleLabel(automationCounts.failing, "failing schedule")}</Badge>
                        ) : null}
                        {automationCounts.waitingForApproval > 0 ? (
                          <Badge tone="warning">{automationCounts.waitingForApproval} waiting approval</Badge>
                        ) : null}
                        {automationCounts.paused > 0 ? (
                          <Badge tone="neutral">{scheduleLabel(automationCounts.paused, "paused schedule")}</Badge>
                        ) : null}
                      </div>
                      <p className="mt-1 [overflow-wrap:anywhere] text-xs text-muted-foreground">
                        {automationScheduleDetail(app)}
                      </p>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="mt-2 h-7 px-2 text-xs"
                        onClick={(event) => {
                          event.stopPropagation();
                          selectApplication(app.id, "all", app.healthSummary?.latestAutomationAttention?.automationId ?? null);
                        }}
                      >
                        <CalendarClock />
                        {applicationScheduleButtonLabel(app)}
                      </Button>
                    </div>
                  ) : null}
                  {latestRecoveryAction ? (
                    <div className="rounded-md border border-border bg-muted/40 p-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs font-medium">Latest recovery</span>
                        <Badge tone={recoveryActionRequestTone(latestRecoveryAction.status)}>
                          {readableRecoveryActionRequestStatus(latestRecoveryAction.status)}
                        </Badge>
                        <span className="text-xs text-muted-foreground">{readableRecoveryActionType(latestRecoveryAction.actionType)}</span>
                        {latestRecoveryAction.recoveryCategory ? (
                          <span className="text-xs text-muted-foreground">{latestRecoveryAction.recoveryCategory}</span>
                        ) : null}
                        {latestRecoveryAction.outcome?.state ? (
                          <Badge tone={recoveryOutcomeTone(latestRecoveryAction.outcome.state)}>
                            {readableRecoveryOutcome(latestRecoveryAction.outcome.state)}
                          </Badge>
                        ) : null}
                      </div>
                      <p className="mt-1 [overflow-wrap:anywhere] text-xs text-muted-foreground">
                        {latestRecoveryAction.explanation?.nextStep
                          ?? latestRecoveryAction.outcome?.nextStep
                          ?? latestRecoveryAction.outcome?.summary
                          ?? latestRecoveryAction.reason
                          ?? "Open diagnostics to inspect the latest recovery action."}
                      </p>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="mt-2 h-7 px-2 text-xs"
                        onClick={(event) => {
                          event.stopPropagation();
                          selectRecoveryRun(app.id, latestRecoveryAction.routineId, latestRecoveryAction.invocationId);
                        }}
                      >
                        View recovery
                      </Button>
                    </div>
                  ) : null}
                  <div className="flex flex-wrap gap-1.5">
                    {projectName(app.projectId) ? <Badge>{projectName(app.projectId)}</Badge> : null}
                    {app.probe?.capabilities?.length ? (
                      <Badge>{app.probe.capabilities.length} probed capabilities</Badge>
                    ) : null}
                    {app.orchestrationIds?.length ? (
                      <Badge>{app.orchestrationIds.length} orchestration(s)</Badge>
                    ) : null}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
