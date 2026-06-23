import { Hexagon } from "lucide-react";
import { SECTIONS } from "@/app/sections";
import { cn } from "@/lib/cn";
import { useUiStore } from "@/store/ui-store";

export function NavRail() {
  const section = useUiStore((s) => s.section);
  const setSection = useUiStore((s) => s.setSection);

  return (
    <nav
      aria-label="Control plane sections"
      className="flex h-full w-60 shrink-0 flex-col border-r border-sidebar-border bg-sidebar"
    >
      <div className="flex items-center gap-2.5 px-5 py-4">
        <span className="grid size-8 place-items-center rounded-lg bg-primary text-primary-foreground">
          <Hexagon className="size-4" />
        </span>
        <div className="leading-tight">
          <p className="text-sm font-semibold">MyAgentTool</p>
          <p className="text-xs text-muted-foreground">Control plane</p>
        </div>
      </div>

      <ul className="flex flex-1 flex-col gap-0.5 overflow-y-auto px-3 py-2">
        {SECTIONS.map((item) => {
          const Icon = item.icon;
          const active = item.key === section;
          return (
            <li key={item.key}>
              <button
                type="button"
                aria-current={active ? "page" : undefined}
                onClick={() => setSection(item.key)}
                className={cn(
                  "flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm transition-colors",
                  active
                    ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                    : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-foreground",
                )}
              >
                <Icon className="size-4 shrink-0" />
                {item.label}
              </button>
            </li>
          );
        })}
      </ul>

      <p className="px-5 py-4 text-xs text-muted-foreground">
        Register agents, route calls, enforce permission, and record what happened.
      </p>
    </nav>
  );
}
