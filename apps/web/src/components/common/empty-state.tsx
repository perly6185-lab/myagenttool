import { cn } from "@/lib/cn";

export function EmptyState({
  title,
  hint,
  className,
}: {
  title: string;
  hint?: string;
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
    </div>
  );
}
