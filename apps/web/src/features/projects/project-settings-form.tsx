import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/common/field";
import { useAsyncAction, api } from "@/data/use-console-actions";
import { cn } from "@/lib/cn";
import { SWATCHES } from "@/features/projects/project-register-form";
import type { ProjectSnapshot } from "@/lib/console-state";
import { useAppTranslation } from "@/lib/i18n/use-app-translation";

// Edit an existing project: name, badge color, per-run worktree isolation, and
// archive/restore. Backed by PATCH /api/projects/:id. Used by the gear button
// on each project node in the nav tree.
export function ProjectSettingsForm({ project, onDone }: { project: ProjectSnapshot; onDone?: () => void }) {
  const { t, i18n } = useAppTranslation();
  const zh = i18n.language.startsWith("zh");
  const { execute, pending, error } = useAsyncAction();
  const [name, setName] = useState(project.name);
  const [color, setColor] = useState(project.color);
  const [isolation, setIsolation] = useState<"shared" | "worktree">(project.isolation);
  const [autoExecutionEnabled, setAutoExecutionEnabled] = useState(project.autoExecutionEnabled === true);
  const [futurePullForwardEnabled, setFuturePullForwardEnabled] = useState(project.futurePullForwardEnabled !== false);

  function save() {
    void execute(async () => {
      const r = await api.updateProject(project.id, {
        name: name.trim() || project.name,
        color,
        isolation,
        autoExecutionEnabled,
        futurePullForwardEnabled,
      });
      onDone?.();
      return r;
    });
  }

  function toggleArchive() {
    const next = project.status === "archived" ? "active" : "archived";
    void execute(async () => {
      const r = await api.updateProject(project.id, { status: next });
      onDone?.();
      return r;
    });
  }

  return (
    <div className="space-y-4">
      <Field label={t("projectsShared.name")}>
        <Input value={name} onChange={(e) => setName(e.target.value)} />
      </Field>

      <div className="space-y-3 rounded-lg border border-border p-3">
        <label className="flex cursor-pointer items-start gap-3 text-sm">
          <input
            className="mt-0.5 size-4"
            type="checkbox"
            checked={autoExecutionEnabled}
            onChange={(event) => setAutoExecutionEnabled(event.target.checked)}
          />
          <span>
            <span className="font-medium">{zh ? "本项目任务默认交给 AI" : "Let AI handle project tasks by default"}</span>
            <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">
              {zh
                ? "开启后，新任务默认自动处理；你仍可单独暂停或手动交给 AI。"
                : "New tasks inherit automatic handling; individual tasks can still be paused or handed to AI manually."}
            </span>
          </span>
        </label>
        <label className={`flex items-start gap-3 text-sm ${autoExecutionEnabled ? "cursor-pointer" : "cursor-not-allowed opacity-60"}`}>
          <input
            className="mt-0.5 size-4"
            type="checkbox"
            checked={futurePullForwardEnabled}
            disabled={!autoExecutionEnabled}
            onChange={(event) => setFuturePullForwardEnabled(event.target.checked)}
          />
          <span>
            <span className="font-medium">{zh ? "空闲时提前处理未来任务" : "Pull future work forward when idle"}</span>
            <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">
              {zh ? "计划日期是软提示；明确设置“最早开始时间”的任务不会提前。" : "Planned dates are guidance; a task with an explicit earliest start time will never start early."}
            </span>
          </span>
        </label>
      </div>

      <Field label={t("projectsShared.color")}>
        <div className="flex flex-wrap gap-2">
          {SWATCHES.map((c) => (
            <button
              key={c}
              type="button"
              aria-label={t("projectsRegister.colorValue", { color: c })}
              onClick={() => setColor(c)}
              className="h-7 w-7 rounded-full border-2 transition"
              style={{ backgroundColor: c, borderColor: color === c ? "var(--foreground)" : "transparent" }}
            />
          ))}
        </div>
      </Field>

      <Field label={t("projectsShared.runIsolation")}>
        <div className="flex gap-1 rounded-lg bg-muted p-1">
          {(
            [
              ["shared", t("projectsShared.sharedWorktree")],
              ["worktree", t("projectsShared.perRunWorktree")],
            ] as ["shared" | "worktree", string][]
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setIsolation(key)}
              className={cn(
                "flex-1 rounded-md px-2 py-1.5 text-xs font-medium transition",
                isolation === key ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </Field>

      <div className="flex items-center justify-between gap-2 pt-1">
        <Button onClick={save} disabled={pending}>
          {t("projectsShared.saveChanges")}
        </Button>
        <Button variant="secondary" onClick={toggleArchive} disabled={pending}>
          {t(project.status === "archived" ? "projects.restore" : "projects.archive")}
        </Button>
      </div>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
