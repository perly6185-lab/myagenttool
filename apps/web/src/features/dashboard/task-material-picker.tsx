import { useRef, useState } from "react";
import { File, LoaderCircle, Paperclip, RefreshCw, X } from "lucide-react";
import { Button } from "@/components/ui/button";

export const MAX_TASK_MATERIALS = 6;
export const MAX_TASK_MATERIAL_BYTES = 50 * 1024 * 1024;

export type TaskMaterialSelection = {
  id: string;
  file: File;
  status: "selected" | "uploading" | "checking" | "ready" | "failed";
  assetId?: string;
  error?: string;
};

function selectionId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `material-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function selectTaskMaterialFiles(files: FileList | File[], remaining: number) {
  const selected: TaskMaterialSelection[] = [];
  let rejected = false;
  for (const file of Array.from(files)) {
    if (selected.length >= remaining || file.size <= 0 || file.size > MAX_TASK_MATERIAL_BYTES) {
      rejected = true;
      continue;
    }
    selected.push({ id: selectionId(), file, status: "selected" });
  }
  return { selected, rejected };
}

export function TaskMaterialPicker({
  files,
  onFiles,
  onRemove,
  onRetry,
  onCancel,
  label,
  dropLabel,
  limitLabel,
  removeLabel,
  retryLabel,
  cancelLabel,
  checkingLabel,
  feedback,
  disabled = false,
}: {
  files: TaskMaterialSelection[];
  onFiles: (files: FileList) => void;
  onRemove: (id: string) => void;
  onRetry: (id: string) => void;
  onCancel?: (id: string) => void;
  label: string;
  dropLabel: string;
  limitLabel: string;
  removeLabel: (name: string) => string;
  retryLabel: string;
  cancelLabel?: string;
  checkingLabel?: string;
  feedback?: string | null;
  disabled?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [dragging, setDragging] = useState(false);
  return (
    <div className="space-y-2">
      <input
        ref={inputRef}
        type="file"
        multiple
        className="hidden"
        disabled={disabled}
        onChange={(event) => {
          if (event.target.files) onFiles(event.target.files);
          event.target.value = "";
        }}
      />
      <button
        type="button"
        disabled={disabled}
        className={`flex min-h-20 w-full items-center justify-center gap-2 rounded-lg border border-dashed px-3 py-4 text-sm transition ${dragging ? "border-primary bg-primary/5 text-primary" : "border-border text-muted-foreground hover:border-primary/60 hover:text-foreground"}`}
        onClick={() => inputRef.current?.click()}
        onDragEnter={(event) => { event.preventDefault(); if (!disabled) setDragging(true); }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          if (!disabled && event.dataTransfer.files.length) onFiles(event.dataTransfer.files);
        }}
      >
        <Paperclip className="size-4" aria-hidden />
        <span>{dropLabel}</span>
      </button>
      <div className="flex flex-wrap gap-2">
        {files.map((item) => (
          <span key={item.id} className={`inline-flex max-w-full items-center gap-1.5 rounded-md border px-2 py-1 text-xs ${item.status === "failed" ? "border-destructive/40 bg-destructive/5" : "border-border bg-muted/40"}`}>
            {item.status === "uploading" || item.status === "checking" ? <LoaderCircle className="size-3 animate-spin" aria-hidden /> : <File className="size-3 opacity-60" aria-hidden />}
            <span className="max-w-[180px] truncate">{item.file.name}</span>
            <span className="text-muted-foreground">{Math.max(1, Math.round(item.file.size / 1024))}KB</span>
            {item.status === "failed" ? (
              <Button type="button" variant="ghost" size="icon" className="size-5" onClick={() => onRetry(item.id)} aria-label={`${retryLabel}: ${item.file.name}`}>
                <RefreshCw className="size-3" />
              </Button>
            ) : null}
            {item.status === "uploading" && onCancel ? (
              <Button type="button" variant="ghost" size="sm" className="h-6 px-1.5 text-xs" onClick={() => onCancel(item.id)} aria-label={`${cancelLabel ?? "Cancel upload"}: ${item.file.name}`}>
                {cancelLabel ?? "Cancel"}
              </Button>
            ) : null}
            {item.status === "checking" ? <span className="text-muted-foreground">{checkingLabel ?? "Checking…"}</span> : null}
            <button type="button" disabled={item.status === "uploading" || item.status === "checking"} className="grid size-5 place-items-center rounded hover:text-destructive disabled:opacity-40" onClick={() => onRemove(item.id)} aria-label={removeLabel(item.file.name)}>
              <X className="size-3" />
            </button>
          </span>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">{limitLabel}</p>
      {feedback ? <p className="text-xs text-destructive" role="alert">{feedback}</p> : null}
      <span className="sr-only">{label}</span>
    </div>
  );
}
