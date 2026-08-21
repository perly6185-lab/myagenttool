import { Check, Copy, Download, Eye, FolderOpen, Link2, ShieldCheck, Trash2 } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/common/empty-state";
import { Field } from "@/components/common/field";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import type { LocalContentPreview, LocalContentRecord } from "./local-content-types";
import type { LocalWorkItem } from "@/features/tasks/task-view-types";
import type { LocalLibraryCopy } from "./local-library-copy";

function formatBytes(value: number | null, locale: string) {
  if (value == null) return "—";
  const units = ["B", "KB", "MB", "GB"];
  let amount = value;
  let unit = 0;
  while (amount >= 1024 && unit < units.length - 1) {
    amount /= 1024;
    unit += 1;
  }
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: unit ? 1 : 0 }).format(amount)} ${units[unit]}`;
}

function formatDate(value: string | null, locale: string) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function metadataText(metadata: Record<string, unknown>, key: string) {
  const value = metadata[key];
  return typeof value === "string" && value.trim() ? value : null;
}

function DetailField({ label, value }: { label: string; value: string }) {
  return <div className="min-w-0"><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-0.5 text-sm [overflow-wrap:anywhere]">{value}</dd></div>;
}

export function LocalContentDetailModal({
  target,
  copy,
  locale,
  onClose,
  onPreview,
  onLocate,
  onChoose,
  canRemove,
  removing,
  onRemove,
}: {
  target: LocalContentRecord | null;
  copy: LocalLibraryCopy;
  locale: string;
  onClose: () => void;
  onPreview: (record: LocalContentRecord) => void;
  onLocate: (record: LocalContentRecord) => void;
  onChoose: (record: LocalContentRecord) => void;
  canRemove: boolean;
  removing: boolean;
  onRemove: (record: LocalContentRecord) => void;
}) {
  if (!target) return null;
  const taskName = metadataText(target.metadata, "taskTitle") ?? target.relations.find((relation) => relation.title)?.title ?? "—";
  const projectName = metadataText(target.metadata, "projectName") ?? target.projectId ?? "—";
  const sender = metadataText(target.metadata, "from");
  const account = metadataText(target.metadata, "accountLabel");
  const attachmentCount = typeof target.metadata.attachmentCount === "number" ? String(target.metadata.attachmentCount) : null;
  const location = target.relativePath?.replaceAll("\\", "/") ?? target.sourceLabel ?? target.source.id ?? "—";
  const storageLabels: Record<LocalContentRecord["storageMode"], string> = {
    managed: locale.startsWith("zh") ? "本机托管" : "Managed locally",
    referenced: locale.startsWith("zh") ? "原件引用" : "Original reference",
    snapshot: locale.startsWith("zh") ? "安全快照" : "Safe snapshot",
    state_record: locale.startsWith("zh") ? "应用记录" : "Application record",
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={copy.detailsTitle}
      description={target.title}
      size="2xl"
      footer={<div className="flex flex-wrap justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>{copy.closeDetails}</Button>
        {target.original.available ? <Button variant="secondary" onClick={() => onPreview(target)}><Eye aria-hidden />{copy.preview}</Button> : null}
        {target.original.available && target.storageMode !== "state_record" ? <Button variant="ghost" onClick={() => onLocate(target)}><FolderOpen aria-hidden />{copy.locate}</Button> : null}
        {target.original.available ? <Button onClick={() => onChoose(target)}>{copy.addToTask}</Button> : null}
        {canRemove ? <Button variant="ghost" disabled={removing} onClick={() => onRemove(target)}><Trash2 aria-hidden />{removing ? copy.removing : copy.removeFromLibrary}</Button> : null}
      </div>}
    >
      <div className="space-y-5">
        <div className="flex flex-wrap gap-1.5">
          <Badge tone="neutral">{copy.kinds[target.kind]}</Badge>
          <Badge tone={target.original.available ? "success" : "warning"}>{target.original.available ? copy.available : copy.unavailable}</Badge>
          <Badge tone={target.indexStatus === "ready" ? "success" : "warning"}>{target.indexStatus === "ready" ? copy.ready : target.indexStatus === "metadata_only" ? copy.metadataOnly : target.indexStatus === "missing" ? copy.missing : copy.partial}</Badge>
        </div>
        <section>
          <h3 className="text-sm font-semibold">{copy.detailsSummary}</h3>
          <p className="mt-2 whitespace-pre-wrap break-words rounded-lg border border-border bg-muted/30 p-3 text-sm leading-relaxed text-muted-foreground">{target.summary || target.matchSnippet || "—"}</p>
        </section>
        <section>
          <h3 className="text-sm font-semibold">{copy.detailsInfo}</h3>
          <dl className="mt-2 grid gap-x-5 gap-y-3 rounded-lg border border-border p-3 sm:grid-cols-2">
            {sender ? <DetailField label={copy.sender} value={sender} /> : null}
            {account ? <DetailField label={copy.mailAccount} value={account} /> : null}
            {attachmentCount ? <DetailField label={copy.attachments} value={attachmentCount} /> : null}
            <DetailField label={copy.source} value={target.sourceLabel ?? target.source.type ?? "—"} />
            <DetailField label={copy.projectName} value={projectName} />
            <DetailField label={copy.taskName} value={taskName} />
            <DetailField label={copy.fileName} value={location} />
            <DetailField label={copy.fileType} value={target.mimeType ?? "—"} />
            <DetailField label={copy.fileSize} value={formatBytes(target.size, locale)} />
            <DetailField label={copy.storageMode} value={storageLabels[target.storageMode]} />
            <DetailField label={copy.originalStatus} value={target.original.available ? copy.available : copy.unavailable} />
            <DetailField label={copy.indexStateValue} value={target.indexStatus === "ready" ? copy.ready : target.indexStatus === "metadata_only" ? copy.metadataOnly : target.indexStatus === "missing" ? copy.missing : copy.partial} />
            <DetailField label={copy.contentTime} value={formatDate(target.occurredAt ?? target.importedAt, locale)} />
            <DetailField label={copy.modifiedTime} value={formatDate(target.modifiedAt, locale)} />
          </dl>
        </section>
        <section>
          <h3 className="flex items-center gap-2 text-sm font-semibold"><Link2 className="size-4" aria-hidden />{copy.detailsRelations}</h3>
          {target.relations.length ? <ul className="mt-2 space-y-2">{target.relations.map((relation) => (
            <li key={`${relation.direction}:${relation.type}:${relation.contentId}`} className="rounded-lg border border-border px-3 py-2 text-sm">
              <p className="font-medium">{relation.title ?? relation.contentId}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">{relation.type.replaceAll("_", " ")}</p>
            </li>
          ))}</ul> : <p className="mt-2 text-sm text-muted-foreground">{copy.noRelations}</p>}
        </section>
      </div>
    </Modal>
  );
}

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
  canRemove: boolean;
  removing: boolean;
  onClose: () => void;
  onRetry: () => void;
  onLocate: (record: LocalContentRecord) => void;
  onChoose: (record: LocalContentRecord) => void;
  onRemove: (record: LocalContentRecord) => void;
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
  canRemove,
  removing,
  onRemove,
}: PreviewModalProps) {
  const [copied, setCopied] = useState(false);

  async function copyText() {
    if (!preview?.text || !navigator.clipboard) return;
    try {
      await navigator.clipboard.writeText(preview.text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1_500);
    } catch {
      setCopied(false);
    }
  }

  function downloadText() {
    if (!preview?.text) return;
    const blob = new Blob([preview.text], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${(target?.title || "myagenttool-content").replace(/[\\/:*?"<>|]/g, "_").slice(0, 80)}.md`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

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
              <Button size="sm" variant="ghost" onClick={() => void copyText()} disabled={!navigator.clipboard}>{copied ? <Check aria-hidden /> : <Copy aria-hidden />}{copied ? copy.copied : copy.copyText}</Button>
              <Button size="sm" variant="ghost" onClick={downloadText}><Download aria-hidden />{copy.downloadText}</Button>
              {target && target.storageMode !== "state_record" ? <Button size="sm" variant="ghost" disabled={locating} onClick={() => onLocate(target)}><FolderOpen aria-hidden />{copy.locate}</Button> : null}
              {target ? <Button size="sm" onClick={() => onChoose(target)}>{copy.addToTask}</Button> : null}
              {canRemove && target ? <Button size="sm" variant="ghost" disabled={removing} onClick={() => onRemove(target)}><Trash2 aria-hidden />{removing ? copy.removing : copy.removeFromLibrary}</Button> : null}
            </div>
          </>
        ) : null}
      </div>
    </Modal>
  );
}
