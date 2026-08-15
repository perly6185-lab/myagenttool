import { FolderOpen, ShieldCheck } from "lucide-react";
import { EmptyState } from "@/components/common/empty-state";
import { Field } from "@/components/common/field";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import type { LocalContentPreview, LocalContentRecord } from "./local-content-types";
import type { LocalWorkItem } from "@/features/tasks/task-view-types";
import type { LocalLibraryCopy } from "./local-library-copy";

type AddToTaskModalProps = {
  open: boolean;
  copy: LocalLibraryCopy;
  adding: boolean;
  addedTask: LocalWorkItem | null;
  candidates: LocalWorkItem[];
  targetTaskId: string;
  purpose: "reference" | "required_input";
  projects: Array<{ id: string; name: string }>;
  createProjectId: string;
  createTaskTitle: string;
  creatingTask: boolean;
  taskListTruncated: boolean;
  taskListLimit: number;
  error: string | null;
  tasksLoading: boolean;
  tasksError: boolean;
  onClose: () => void;
  onOpenTask: () => void;
  onRetryTasks: () => void;
  onTargetChange: (taskId: string) => void;
  onPurposeChange: (purpose: "reference" | "required_input") => void;
  onCreateProjectChange: (projectId: string) => void;
  onCreateTaskTitleChange: (title: string) => void;
  onAdd: () => void;
  onCreateTask: () => void;
};

export function AddToTaskModal({
  open,
  copy,
  adding,
  addedTask,
  candidates,
  targetTaskId,
  purpose,
  projects,
  createProjectId,
  createTaskTitle,
  creatingTask,
  taskListTruncated,
  taskListLimit,
  error,
  tasksLoading,
  tasksError,
  onClose,
  onOpenTask,
  onRetryTasks,
  onTargetChange,
  onPurposeChange,
  onCreateProjectChange,
  onCreateTaskTitleChange,
  onAdd,
  onCreateTask,
}: AddToTaskModalProps) {
  const busy = adding || creatingTask;
  return (
    <Modal open={open} onClose={onClose} title={copy.chooseTask} description={copy.chooseTaskHint} closeDisabled={busy}>
      {addedTask ? (
        <div className="space-y-4">
          <p className={error
            ? "rounded-lg border border-warning/40 bg-warning/[0.07] px-3 py-2 text-sm"
            : "rounded-lg border border-success/30 bg-success/[0.06] px-3 py-2 text-sm"} role="status">
            {error ?? copy.added.replace("{{task}}", addedTask.title)}
          </p>
          <div className="flex justify-end gap-2"><Button variant="ghost" onClick={onClose}>{copy.close}</Button><Button onClick={onOpenTask}>{copy.openTask}</Button></div>
        </div>
      ) : tasksLoading ? (
        <p className="text-sm text-muted-foreground" role="status">{copy.loadingTasks}</p>
      ) : tasksError ? (
        <EmptyState title={copy.addFailed} action={<Button size="sm" variant="secondary" onClick={onRetryTasks}>{copy.retry}</Button>} />
      ) : (
        <div className="space-y-4">
          {candidates.length ? (
            <Field label={copy.task}>
              <Select value={targetTaskId} onChange={(event) => onTargetChange(event.target.value)}>
                <option value="" disabled>{copy.chooseTaskPlaceholder}</option>
                {candidates.map((task) => <option key={task.id} value={task.id}>{task.localRef ? `${task.localRef} · ` : ""}{task.title}</option>)}
              </Select>
            </Field>
          ) : (
            <>
              <EmptyState title={copy.noTasks} />
              <Field label={copy.createTaskProject}>
                <Select disabled={projects.length === 1} value={createProjectId} onChange={(event) => onCreateProjectChange(event.target.value)}>
                  <option value="" disabled>{copy.createTaskProject}</option>
                  {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
                </Select>
              </Field>
              <Field label={copy.createTaskTitle}>
                <Input value={createTaskTitle} onChange={(event) => onCreateTaskTitleChange(event.target.value)} />
              </Field>
            </>
          )}
          <Field label={copy.purpose}>
            <Select value={purpose} onChange={(event) => onPurposeChange(event.target.value as "reference" | "required_input")}>
              <option value="required_input">{copy.requiredInput}</option>
              <option value="reference">{copy.optionalReference}</option>
            </Select>
            <p className="mt-1 text-xs text-muted-foreground">{purpose === "required_input" ? copy.requiredInputHint : copy.optionalReferenceHint}</p>
          </Field>
          {taskListTruncated ? <p className="text-xs text-warning">{copy.taskListLimited.replace("{{count}}", String(taskListLimit))}</p> : null}
          {error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" disabled={busy} onClick={onClose}>{copy.cancel}</Button>
            {candidates.length
              ? <Button disabled={!targetTaskId || busy} onClick={onAdd}>{adding ? copy.adding : copy.add}</Button>
              : <Button disabled={!createProjectId || !createTaskTitle.trim() || busy} onClick={onCreateTask}>{creatingTask ? copy.creatingTask : copy.createTask}</Button>}
          </div>
        </div>
      )}
    </Modal>
  );
}

type PreviewModalProps = {
  target: LocalContentRecord | null;
  copy: LocalLibraryCopy;
  locale: string;
  loading: boolean;
  error: boolean;
  errorMessage: string;
  preview: LocalContentPreview | null;
  locating: boolean;
  onClose: () => void;
  onRetry: () => void;
  onLocate: (record: LocalContentRecord) => void;
  onChoose: (record: LocalContentRecord) => void;
};

export function PreviewModal({
  target,
  copy,
  locale,
  loading,
  error,
  errorMessage,
  preview,
  locating,
  onClose,
  onRetry,
  onLocate,
  onChoose,
}: PreviewModalProps) {
  return (
    <Modal open={Boolean(target)} onClose={onClose} title={copy.previewTitle} description={target?.title} size="lg">
      <div className="space-y-3">
        <p className="flex items-start gap-2 rounded-lg border border-success/30 bg-success/[0.06] px-3 py-2 text-xs leading-relaxed"><ShieldCheck className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />{copy.previewSafety}</p>
        {loading ? <p className="text-sm text-muted-foreground" role="status">{copy.previewLoading}</p> : error ? (
          <div className="space-y-3">
            <p className="text-sm text-destructive" role="alert">{errorMessage}</p>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" onClick={onRetry}>{copy.retry}</Button>
              {target && target.storageMode !== "state_record" ? <Button size="sm" variant="ghost" disabled={locating} onClick={() => onLocate(target)}><FolderOpen aria-hidden />{copy.locate}</Button> : null}
            </div>
          </div>
        ) : preview ? (
          <>
            {preview.truncated ? <p className="text-xs text-warning">{copy.previewTruncated.replace("{{size}}", new Intl.NumberFormat(locale, { style: "unit", unit: "megabyte", maximumFractionDigits: 1 }).format(preview.totalBytes / (1024 * 1024)))}</p> : null}
            <pre className="max-h-[60vh] overflow-auto whitespace-pre-wrap break-words rounded-lg border border-border bg-muted/35 p-3 text-sm leading-relaxed" tabIndex={0}>{preview.text}</pre>
            <div className="flex flex-wrap justify-end gap-2">
              {target && target.storageMode !== "state_record" ? <Button size="sm" variant="ghost" disabled={locating} onClick={() => onLocate(target)}><FolderOpen aria-hidden />{copy.locate}</Button> : null}
              {target ? <Button size="sm" onClick={() => onChoose(target)}>{copy.addToTask}</Button> : null}
            </div>
          </>
        ) : null}
      </div>
    </Modal>
  );
}
