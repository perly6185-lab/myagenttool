import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/common/field";
import { EmptyState } from "@/components/common/empty-state";
import { useConsoleState } from "@/data/use-console-state";
import { useAsyncAction, api } from "@/data/use-console-actions";
import { useUiStore } from "@/store/ui-store";
import { formatUsd as usd } from "@/lib/money";
import type { BudgetStatus, ProjectSnapshot } from "@/lib/console-state";

const SWATCHES = ["#6366f1", "#f59e0b", "#10b981", "#ef4444", "#0ea5e9", "#a855f7"];

export function ProjectsView() {
  const { data: state } = useConsoleState();
  const { execute, pending, error } = useAsyncAction();
  const projects = state?.projects ?? [];
  const budgetByProject = new Map((state?.budgetStatuses ?? []).map((b) => [b.projectId, b]));

  const selectedProjectId = useUiStore((s) => s.selectedProjectId);
  const setSelectedProjectId = useUiStore((s) => s.setSelectedProjectId);
  const activeId = selectedProjectId ?? projects[0]?.id ?? null;

  const [name, setName] = useState("");
  const [color, setColor] = useState(SWATCHES[0]);

  function create() {
    if (!name.trim()) return;
    void execute(async () => {
      const created = (await api.createProject({ name: name.trim(), color })) as { project: { id: string } };
      setSelectedProjectId(created.project.id);
      setName("");
      return created;
    });
  }

  function archive(project: ProjectSnapshot) {
    const next = project.status === "archived" ? "active" : "archived";
    void execute(() => api.updateProject(project.id, { status: next }));
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.7fr)]">
      <Card>
        <CardHeader>
          <CardTitle>Projects</CardTitle>
          <p className="text-sm text-muted-foreground">
            A project groups invocations and owns a budget. New tasks are attributed to the active project.
          </p>
        </CardHeader>
        <CardContent className="space-y-2">
          {projects.length === 0 ? (
            <EmptyState title="No projects" hint="Register your first project on the right." />
          ) : (
            projects.map((project) => (
              <ProjectRow
                key={project.id}
                project={project}
                budget={budgetByProject.get(project.id)}
                active={project.id === activeId}
                onSelect={() => setSelectedProjectId(project.id)}
                onArchive={() => archive(project)}
                busy={pending}
              />
            ))
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Register a project</CardTitle>
          <p className="text-sm text-muted-foreground">Name it and pick a color for the sidebar badge.</p>
        </CardHeader>
        <CardContent className="space-y-4">
          <Field label="Name">
            <Input
              value={name}
              placeholder="e.g. Migrations"
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") create();
              }}
            />
          </Field>
          <Field label="Color">
            <div className="flex flex-wrap gap-2">
              {SWATCHES.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-label={`Color ${c}`}
                  onClick={() => setColor(c)}
                  className="h-7 w-7 rounded-full border-2 transition"
                  style={{ backgroundColor: c, borderColor: color === c ? "var(--foreground)" : "transparent" }}
                />
              ))}
            </div>
          </Field>
          <Button onClick={create} disabled={pending || !name.trim()}>
            Create project
          </Button>
          {error ? <p className="text-xs text-destructive">{error}</p> : null}
        </CardContent>
      </Card>
    </div>
  );
}

function ProjectRow({
  project,
  budget,
  active,
  onSelect,
  onArchive,
  busy,
}: {
  project: ProjectSnapshot;
  budget?: BudgetStatus;
  active: boolean;
  onSelect: () => void;
  onArchive: () => void;
  busy: boolean;
}) {
  return (
    <div
      className={`flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5 text-sm ${
        active ? "border-primary bg-primary/5" : "border-border"
      }`}
    >
      <button type="button" onClick={onSelect} className="flex min-w-0 items-center gap-2.5 text-left">
        <span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: project.color }} />
        <span className="min-w-0">
          <span className="flex items-center gap-2">
            <span className="truncate font-medium">{project.name}</span>
            {active ? <Badge tone="neutral">Active</Badge> : null}
            {project.status === "archived" ? <Badge tone="warning">Archived</Badge> : null}
          </span>
          <span className="block text-xs text-muted-foreground">
            {budget?.exists
              ? `Budget ${usd(budget.spentUsd)} / ${usd(budget.limitUsd ?? 0)}${budget.over ? " · over" : ""}`
              : "No budget set"}
          </span>
        </span>
      </button>
      <Button variant="secondary" size="sm" disabled={busy} onClick={onArchive}>
        {project.status === "archived" ? "Restore" : "Archive"}
      </Button>
    </div>
  );
}
