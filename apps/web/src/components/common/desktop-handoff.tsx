import { MonitorUp } from "lucide-react";
import { cn } from "@/lib/cn";
import type { SectionKey } from "@/store/ui-store";

type DesktopAction =
  | "mail-attachment"
  | "compose-attachment"
  | "open-local-document"
  | "open-system-document"
  | "add-real-case"
  | "choose-source-folder"
  | "open-desktop-page";

export function desktopHandoffHref(
  section: SectionKey,
  desktopAction: DesktopAction,
  params: Record<string, string | null | undefined> = {},
) {
  const query = new URLSearchParams({ section, desktopAction });
  for (const [key, value] of Object.entries(params)) if (value) query.set(key, value);
  return `myagenttool://open?${query.toString()}`;
}

export function DesktopHandoffLink({
  section,
  action,
  params,
  children,
  className,
  compact = false,
}: {
  section: SectionKey;
  action: DesktopAction;
  params?: Record<string, string | null | undefined>;
  children: React.ReactNode;
  className?: string;
  compact?: boolean;
}) {
  return (
    <a
      href={desktopHandoffHref(section, action, params)}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-md border border-border bg-secondary font-medium text-secondary-foreground transition-colors hover:bg-secondary/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        compact ? "h-8 px-3 text-xs" : "h-9 px-4 text-sm",
        className,
      )}
    >
      <MonitorUp className="size-4" />
      {children}
    </a>
  );
}
