import { useId, useState, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/cn";

// #1073 (Epic #1070): the console's collapse affordance, as a shared primitive
// instead of another one-off useState block. A real <button> header keeps it
// keyboard-operable for free; content is unmounted while closed so a heavy
// panel (a 256KB transcript payload) costs nothing until opened.

export function CollapsiblePanel({
  label,
  meta,
  defaultOpen = false,
  className,
  contentClassName,
  children,
}: {
  label: ReactNode;
  // Right-aligned slot on the header row (e.g. a size hint or error badge),
  // visible in both states.
  meta?: ReactNode;
  defaultOpen?: boolean;
  className?: string;
  contentClassName?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const contentId = useId();
  return (
    <div className={cn("min-w-0 rounded-md border border-border", className)}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={contentId}
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-xs font-medium text-muted-foreground hover:bg-muted/40 hover:text-foreground"
      >
        <ChevronRight aria-hidden className={cn("h-3.5 w-3.5 shrink-0 transition-transform", open && "rotate-90")} />
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {meta ? <span className="ml-auto shrink-0 text-[11px] font-normal">{meta}</span> : null}
      </button>
      {open ? (
        <div id={contentId} className={cn("border-t border-border px-2 py-1.5", contentClassName)}>
          {children}
        </div>
      ) : null}
    </div>
  );
}
