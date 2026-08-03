import type { ClipboardEventHandler, ReactNode, Ref } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/input";

export function AgentRunComposer({
  title,
  context,
  task,
  taskLabel,
  placeholder,
  rows = 4,
  textareaRef,
  onTaskChange,
  onTaskPaste,
  headerAction,
  beforeInput,
  toolbar,
  disabled = false,
  compact = false,
  children,
  className,
}: {
  title: string;
  context?: string | null;
  task: string;
  taskLabel: string;
  placeholder?: string;
  rows?: number;
  textareaRef?: Ref<HTMLTextAreaElement>;
  onTaskChange: (value: string) => void;
  onTaskPaste?: ClipboardEventHandler<HTMLTextAreaElement>;
  headerAction?: ReactNode;
  beforeInput?: ReactNode;
  toolbar?: ReactNode;
  disabled?: boolean;
  compact?: boolean;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <Card className={className} aria-busy={disabled}>
      <CardHeader className={compact ? "flex-row items-start justify-between gap-3 px-4 pb-2 pt-3" : "flex-row items-start justify-between gap-3 pb-3"}>
        <div className={compact ? "flex min-w-0 flex-1 items-baseline gap-2" : "min-w-0"}>
          <CardTitle>{title}</CardTitle>
          {context ? (
            <p className={compact ? "min-w-0 truncate font-mono text-[11px] text-muted-foreground" : "mt-1 truncate font-mono text-[11px] text-muted-foreground"} title={context}>
              {context}
            </p>
          ) : null}
        </div>
        {headerAction}
      </CardHeader>
      <CardContent className={compact ? "px-4 pb-3" : undefined}>
        <fieldset disabled={disabled} className={compact ? "min-w-0 space-y-2 border-0 p-0" : "min-w-0 space-y-3 border-0 p-0"}>
          {beforeInput}
          {compact ? (
            <div className="overflow-hidden rounded-xl border border-border bg-input/20 shadow-sm transition-colors focus-within:border-ring focus-within:ring-1 focus-within:ring-ring">
              <Textarea
                ref={textareaRef}
                rows={rows}
                value={task}
                onChange={(event) => onTaskChange(event.target.value)}
                onPaste={onTaskPaste}
                aria-label={taskLabel}
                placeholder={placeholder}
                className="min-h-20 resize-y rounded-none border-0 bg-transparent px-3 pb-2 pt-3 shadow-none focus-visible:ring-0"
              />
              {toolbar ? <div className="px-2 pb-2">{toolbar}</div> : null}
            </div>
          ) : (
            <Textarea
              ref={textareaRef}
              rows={rows}
              value={task}
              onChange={(event) => onTaskChange(event.target.value)}
              onPaste={onTaskPaste}
              aria-label={taskLabel}
              placeholder={placeholder}
            />
          )}
          {children}
        </fieldset>
      </CardContent>
    </Card>
  );
}
