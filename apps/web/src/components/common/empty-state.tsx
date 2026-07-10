import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export function EmptyState({
  title,
  hint,
  action,
  className,
}: {
  title: string;
  hint?: string;
  /** Optional CTA (e.g. a Button) so an empty state can take the user to the fix, not just describe it. */
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center gap-1 rounded-lg border border-dashed border-border px-4 py-8 text-center",
        className,
      )}
    >
      <strong className="text-sm font-medium text-foreground">{title}</strong>
      {hint ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}
