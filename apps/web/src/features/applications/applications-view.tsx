import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/input";
import { Field } from "@/components/common/field";
import { EmptyState } from "@/components/common/empty-state";
import { SectionHeading } from "@/components/common/section-heading";
import { useConsoleState } from "@/data/use-console-state";
import { useUiStore } from "@/store/ui-store";
import { cn } from "@/lib/cn";
import { RegisterApplicationModal } from "@/features/applications/register-application-modal";
import { applicationOpsBadges } from "@/features/applications/application-ops-ui";
import {
  applicationAttentionSummary,
  firstAttentionAutomationId,
} from "@/features/automation/schedule-health-ui";
import { durableSuccessRate } from "@/features/applications/application-executions";
import type { ApplicationSnapshot, ApplicationSource } from "@/lib/console-state";
import type { Tone } from "@/lib/readable-labels";

function statusTone(status: string): Tone {
  if (status === "active") return "success";
  if (status === "offline" || status === "registered" || status === "draft" || status === "probing") return "warning";
  if (status === "archived" || status === "failed") return "danger";
  return "neutral";
}

function sweepAgo(iso: string): string {
  const secs = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
  if (secs < 90) return "just now";
  if (secs < 3600) return `${Math.round(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.round(secs / 3600)}h ago`;
  return `${Math.round(secs / 86400)}d ago`;
}

export function sourceSummary(source: ApplicationSource): string {
  switch (source.type) {
    case "git":
      return source.url;
    case "local":
      return source.path;
    case "npm":
      return `${source.package}${source.version ? `@${source.version}` : ""}`;
    case "binary":
      return `${source.binary} (system binary on the device)`;
    default:
      return source.uri ?? "manual manifest";
  }
}

/** Registered applications and their governed capabilities (read-only slice). */
export function ApplicationsView() {
  const { data: state } = useConsoleState();
  const selectedApplicationId = useUiStore((s) => s.selectedApplicationId);
  const setSelectedApplicationId = useUiStore((s) => s.setSelectedApplicationId);

  const [status, setStatus] = useState<"all" | ApplicationSnapshot["status"]>("all");
  const [kind, setKind] = useState<"all" | string>("all");
  const [registerOpen, setRegisterOpen] = useState(false);

  const all = state?.applications ?? [];
  const projectName = useMemo(() => {
    const map = new Map((state?.projects ?? []).map((project) => [project.id, project.name]));
    return (id?: string | null) => (id ? map.get(id) ?? id : null);
  }, [state?.projects]);

  const setSection = useUiStore((s) => s.setSection);
  const setSelectedAutomationId = useUiStore((s) => s.setSelectedAutomationId);

  // Route the operator to the exact schedule, focused. An attention badge that
  // only says "something is wrong" and then leaves them to search is the thing
  // this slice exists to end (#849).
  function focusAttentionSchedule(app: ApplicationSnapshot) {
    const automationId = firstAttentionAutomationId(app.scheduleHealth);
    if (!automationId) return;
    setSelectedAutomationId(automationId);
    setSection("automation");
  }

  const kinds = useMemo(() => Array.from(new Set(all.map((app) => app.kind))).sort(), [all]);
  const applications = useMemo(
    () =>
      all.filter(
        (app) => (status === "all" || app.status === status) && (kind === "all" || app.kind === kind),
      ),
    [all, status, kind],
  );

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

      {/* No filters before there's anything to filter — the empty state carries the Register CTA (#930). */}
      {all.length ? (
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Status" className="w-40">
          <Select value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
            <option value="all">All statuses</option>
            <option value="active">Active</option>
            <option value="registered">Registered</option>
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
        <span className="pb-2 text-xs text-muted-foreground">
          {applications.length} of {all.length} application(s)
        </span>
        {state?.applicationHealthSweepStatus?.lastSweepAt ? (
          <span className="pb-2 text-xs text-muted-foreground">
            · health sweep {sweepAgo(state.applicationHealthSweepStatus.lastSweepAt)}
            {state.applicationHealthSweepStatus.lastError ? (
              <span className="text-destructive"> · last error: {state.applicationHealthSweepStatus.lastError}</span>
            ) : null}
          </span>
        ) : null}
      </div>
      ) : null}

      {!applications.length ? (
        <EmptyState
          title={all.length ? "No applications match these filters" : "No applications registered"}
          hint={
            all.length
              ? "Loosen the status or kind filter."
              : "Register an application (git, local, npm, or manual) to expose its governed capabilities."
          }
        />
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          {applications.map((app) => (
            <Card
              key={app.id}
              onClick={() => setSelectedApplicationId(app.id)}
              onFocusCapture={() => setSelectedApplicationId(app.id)}
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
              <CardContent className="space-y-2">
                <p className="[overflow-wrap:anywhere] font-mono text-xs text-muted-foreground">
                  {sourceSummary(app.source)}
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {projectName(app.projectId) ? <Badge>{projectName(app.projectId)}</Badge> : null}
                  {app.probe?.capabilities?.length ? (
                    <Badge>{app.probe.capabilities.length} probed capabilities</Badge>
                  ) : null}
                  {app.orchestrationIds?.length ? (
                    <Badge>{app.orchestrationIds.length} orchestration(s)</Badge>
                  ) : null}
                  {applicationOpsBadges(app).map((badge) => (
                    <Badge key={badge.label} tone={badge.tone}>{badge.label}</Badge>
                  ))}
                  {/*
                    An application whose schedules are failing or parked is not
                    healthy — the health sweep only ever checked its own source,
                    never what it was asked to do on a timer (#848). The badge names
                    WHAT is wrong and takes the operator straight to the schedule:
                    "something is wrong here, go find it" is the state this replaces.
                  */}
                  {applicationAttentionSummary(app.scheduleHealth) ? (
                    <Badge
                      tone="warning"
                      role="button"
                      tabIndex={0}
                      className="cursor-pointer"
                      onClick={(event) => {
                        event.stopPropagation();
                        focusAttentionSchedule(app);
                      }}
                      onKeyDown={(event) => {
                        if (event.key !== "Enter" && event.key !== " ") return;
                        event.stopPropagation();
                        event.preventDefault();
                        focusAttentionSchedule(app);
                      }}
                    >
                      {applicationAttentionSummary(app.scheduleHealth)}
                    </Badge>
                  ) : null}
                  {(() => {
                    const rate = durableSuccessRate(state?.applicationDailyStats ?? [], app.id, 30);
                    return rate == null ? null : (
                      <Badge tone={rate >= 0.9 ? "success" : rate >= 0.5 ? "warning" : "danger"}>
                        {Math.round(rate * 100)}% success · 30d
                      </Badge>
                    );
                  })()}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
