import { useRef } from "react";
import { File, Paperclip, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";

export type StagedWorktreeAttachment = {
  name: string;
  dataBase64: string;
  size: number;
  type: string;
};

export type WorktreeAttachmentRejectionReason = "empty" | "too_large" | "too_many" | "read_failed";

export type WorktreeAttachmentRejection = {
  name: string;
  reason: WorktreeAttachmentRejectionReason;
};

export type WorktreeAttachmentUploadResponse = {
  batchId?: string;
  attachments?: { name: string; path: string; bytes?: number }[];
  skipped?: { name: string; reason: WorktreeAttachmentRejectionReason | string }[];
};

export const MAX_WORKTREE_ATTACHMENTS = 6;
export const MAX_WORKTREE_ATTACHMENT_BYTES = 5 * 1024 * 1024;

export async function stageWorktreeAttachmentFiles(
  files: FileList | File[],
  remainingSlots: number,
): Promise<{ attachments: StagedWorktreeAttachment[]; rejected: WorktreeAttachmentRejection[] }> {
  const candidates: File[] = [];
  const rejected: WorktreeAttachmentRejection[] = [];
  for (const file of Array.from(files)) {
    const name = file.name || "file";
    if (file.size === 0) {
      rejected.push({ name, reason: "empty" });
    } else if (file.size > MAX_WORKTREE_ATTACHMENT_BYTES) {
      rejected.push({ name, reason: "too_large" });
    } else if (candidates.length >= remainingSlots) {
      rejected.push({ name, reason: "too_many" });
    } else {
      candidates.push(file);
    }
  }

  const read = await Promise.all(candidates.map((file) => new Promise<{
    attachment: StagedWorktreeAttachment | null;
    rejection: WorktreeAttachmentRejection | null;
  }>((resolve) => {
    const fail = () => resolve({
      attachment: null,
      rejection: { name: file.name || "file", reason: "read_failed" },
    });
    const reader = new FileReader();
    reader.onload = () => {
      const dataBase64 = String(reader.result ?? "").split(",")[1] ?? "";
      if (!dataBase64) return fail();
      resolve({
        attachment: {
          name: file.name || "file",
          dataBase64,
          size: file.size,
          type: file.type,
        },
        rejection: null,
      });
    };
    reader.onerror = fail;
    reader.onabort = fail;
    try {
      reader.readAsDataURL(file);
    } catch {
      fail();
    }
  })));

  return {
    attachments: read.flatMap((item) => item.attachment ? [item.attachment] : []),
    rejected: [...rejected, ...read.flatMap((item) => item.rejection ? [item.rejection] : [])],
  };
}

export function WorktreeAttachmentPicker({
  attachments,
  onFiles,
  onRemove,
  label,
  title,
  removeLabel,
  disabled = false,
  disabledHint,
  feedback,
  compact = false,
}: {
  attachments: StagedWorktreeAttachment[];
  onFiles: (files: FileList) => void;
  onRemove: (index: number) => void;
  label: string;
  title: string;
  removeLabel: (name: string) => string;
  disabled?: boolean;
  disabledHint?: string;
  feedback?: string | null;
  compact?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  return (
    <div className={compact ? "min-w-0" : "space-y-2"}>
      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={inputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(event) => {
            if (event.target.files) onFiles(event.target.files);
            event.target.value = "";
          }}
        />
        <Button
          type="button"
          variant={compact ? "ghost" : "secondary"}
          size={compact ? "icon" : "sm"}
          className={compact ? "size-8 rounded-full text-muted-foreground" : undefined}
          disabled={disabled}
          onClick={() => inputRef.current?.click()}
          title={disabled ? disabledHint : title}
          aria-label={label}
        >
          {compact ? <Plus /> : <><Paperclip className="mr-1 size-3.5" /> {label}</>}
        </Button>
        {attachments.map((attachment, index) => (
          <span key={`${attachment.name}-${index}`} className="inline-flex items-center gap-1.5 rounded-md border border-border bg-muted/40 py-1 pl-1.5 pr-2 text-xs">
            {attachment.type.startsWith("image/") ? (
              <img
                src={`data:${attachment.type};base64,${attachment.dataBase64}`}
                alt={attachment.name}
                className="size-8 rounded object-cover"
              />
            ) : (
              <File className="size-3 opacity-60" />
            )}
            <span className="max-w-[160px] truncate">{attachment.name}</span>
            <span className="text-muted-foreground">{(attachment.size / 1024).toFixed(0)}KB</span>
            <button
              type="button"
              onClick={() => onRemove(index)}
              aria-label={removeLabel(attachment.name)}
              className="ml-0.5 grid size-4 place-items-center rounded hover:text-destructive"
            >
              <X className="size-3" />
            </button>
          </span>
        ))}
      </div>
      {disabled && disabledHint ? (
        <p className={compact ? "sr-only" : "text-xs text-muted-foreground"}>{disabledHint}</p>
      ) : null}
      {feedback ? <p className="text-xs text-destructive" aria-live="polite">{feedback}</p> : null}
    </div>
  );
}
