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
import type { ApplicationSnapshot } from "@/lib/console-state";
import type { Tone } from "@/lib/readable-labels";
import { useAppTranslation } from "@/lib/i18n/use-app-translation";
import { sourceSummary } from "@/features/applications/application-source-summary";

function statusTone(status: string): Tone {
  if (status === "active") return "success";
  if (status === "offline" || status === "registered" || status === "draft" || status === "probing") return "warning";
  if (status === "archived" || status === "failed") return "danger";
  return "neutral";
}

function readinessTone(state?: string): Tone {
  if (state === "ready") return "success";
  if (["not_installed", "login_required", "repair_required", "bridge_offline"].includes(state ?? "")) return "warning";
  if (state === "archived") return "danger";
  return "neutral";
}

function sweepAgo(iso: string): string {
  const secs = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
  if (secs < 90) return "just now";
  if (secs < 3600) return `${Math.round(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.round(secs / 3600)}h ago`;
  return `${Math.round(secs / 86400)}d ago`;
}

/** Registered applications and their governed capabilities (read-only slice). */
export function ApplicationsView() {
  const { t } = useAppTranslation();
  const { data: state } = useConsoleState();
  const selectedApplicationId = useUiStore((s) => s.selectedApplicationId);
  const setSelectedApplicationId = useUiStore((s) => s.setSelectedApplicationId);

  const [status, setStatus] = useState<"all" | ApplicationSnapshot["status"]>("all");
  const [kind, setKind] = useState<"all" | string>("all");
  const [registerOpen, setRegisterOpen] = useState(false);
  const [setupApplication, setSetupApplication] = useState("");

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
        eyebrow={t("applicationsPage.governed")}
        title={t("applicationsPage.title")}
        description={t("applicationsPage.description")}
        actions={
          <Button size="sm" onClick={() => { setSetupApplication(""); setRegisterOpen(true); }}>
            {t("applicationsPage.add")}
          </Button>
        }
      />

      <RegisterApplicationModal open={registerOpen} initialApplication={setupApplication} onClose={() => setRegisterOpen(false)} />

      {/* No filters before there's anything to filter — the empty state carries the Register CTA (#930). */}
      {all.length ? (
      <div className="flex flex-wrap items-end gap-3">
        <Field label={t("applicationsPage.status")} className="w-40">
          <Select value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
            <option value="all">{t("applicationsPage.allStatuses")}</option>
            <option value="active">{t("applicationsPage.active")}</option>
            <option value="registered">{t("applicationsPage.registered")}</option>
            <option value="offline">{t("applicationsPage.offline")}</option>
            <option value="archived">{t("applicationsPage.archived")}</option>
            <option value="failed">{t("applicationsPage.failed")}</option>
          </Select>
        </Field>
        <Field label={t("applicationsPage.kind")} className="w-44">
          <Select value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="all">{t("applicationsPage.allKinds")}</option>
            {kinds.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </Select>
        </Field>
        <span className="pb-2 text-xs text-muted-foreground">
          {t("applicationsPage.count", { visible: applications.length, total: all.length })}
        </span>
        {state?.applicationHealthSweepStatus?.lastSweepAt ? (
          <span className="pb-2 text-xs text-muted-foreground">
            · {t("applicationsPage.healthSweep")} {sweepAgo(state.applicationHealthSweepStatus.lastSweepAt)}
            {state.applicationHealthSweepStatus.lastError ? (
              <span className="text-destructive"> · {t("applicationsPage.lastError")}: {state.applicationHealthSweepStatus.lastError}</span>
            ) : null}
          </span>
        ) : null}
      </div>
      ) : null}

      {!applications.length ? (
        <EmptyState
          title={t(all.length ? "applicationsPage.noMatches" : "applicationsPage.empty")}
          hint={
            all.length
              ? t("applicationsPage.noMatchesHint")
              : t("applicationsPage.emptyHint")
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
                  <Badge tone={statusTone(app.status)}>{t(`applicationsPage.appStatus.${app.status}` as never, { defaultValue: app.status })}</Badge>
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
                  <Badge tone={readinessTone(app.localReadiness?.state)}>{t(`applicationsPage.readiness.${app.localReadiness?.state ?? "checking"}` as never)}</Badge>
                  {projectName(app.projectId) ? <Badge>{projectName(app.projectId)}</Badge> : null}
                  {app.probe?.capabilities?.length ? (
                    <Badge>{t("applicationsPage.probed", { count: app.probe.capabilities.length })}</Badge>
                  ) : null}
                  {app.orchestrationIds?.length ? (
                    <Badge>{t("applicationsPage.orchestrations", { count: app.orchestrationIds.length })}</Badge>
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
                        {t("applicationsPage.success30d", { rate: Math.round(rate * 100) })}
                      </Badge>
                    );
                  })()}
                </div>
                {app.localReadiness && !["ready", "archived"].includes(app.localReadiness.state) ? (
                  <div className="flex items-center justify-between gap-3 pt-1">
                    <p className="text-xs text-muted-foreground">{app.localReadiness.summary}</p>
                    <Button size="sm" variant="secondary" onClick={(event) => {
                      event.stopPropagation();
                      setSetupApplication(app.source.type === "binary" ? app.source.binary : app.name.toLowerCase());
                      setRegisterOpen(true);
                    }}>
                      {t(app.localReadiness.state === "login_required" ? "applicationsPage.signIn" : app.localReadiness.state === "not_installed" ? "applicationsPage.install" : "applicationsPage.repair")}
                    </Button>
                  </div>
                ) : null}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
