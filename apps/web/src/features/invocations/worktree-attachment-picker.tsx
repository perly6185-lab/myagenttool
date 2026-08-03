import { useRef } from "react";
import { File, Paperclip, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";

export type StagedWorktreeAttachment = {
  name: string;
  dataBase64: string;
  size: number;
  type: string;
};

export function WorktreeAttachmentPicker({
  attachments,
  onFiles,
  onRemove,
  label,
  title,
  removeLabel,
  disabled = false,
  disabledHint,
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
    </div>
  );
}
