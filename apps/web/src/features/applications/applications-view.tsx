import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select } from "@/components/ui/input";
import { Field } from "@/components/common/field";
import { EmptyState } from "@/components/common/empty-state";
import { SectionHeading } from "@/components/common/section-heading";
import { useConsoleState } from "@/data/use-console-state";
import { useUiStore } from "@/store/ui-store";
import { cn } from "@/lib/cn";
import type { ApplicationSnapshot, ApplicationSource } from "@/lib/console-state";
import type { Tone } from "@/lib/readable-labels";

function statusTone(status: string): Tone {
  if (status === "active") return "success";
  if (status === "offline" || status === "registered" || status === "draft" || status === "probing") return "warning";
  if (status === "archived" || status === "failed") return "danger";
  return "neutral";
}

export function sourceSummary(source: ApplicationSource): string {
  switch (source.type) {
    case "git":
      return source.url;
    case "local":
      return source.path;
    case "npm":
      return `${source.package}${source.version ? `@${source.version}` : ""}`;
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

  const all = state?.applications ?? [];
  const projectName = useMemo(() => {
    const map = new Map((state?.projects ?? []).map((project) => [project.id, project.name]));
    return (id?: string | null) => (id ? map.get(id) ?? id : null);
  }, [state?.projects]);

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
      />

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
      </div>

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
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
