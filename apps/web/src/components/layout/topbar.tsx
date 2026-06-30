import { SECTIONS } from "@/app/sections";
import { StatusBadge } from "@/components/ui/badge";
import { useConsoleState } from "@/data/use-console-state";
import { readableDeviceStatus } from "@/lib/readable-labels";
import { useUiStore } from "@/store/ui-store";

export function Topbar() {
  const section = useUiStore((s) => s.section);
  const { data: state, isError, isLoading } = useConsoleState();
  const current = SECTIONS.find((item) => item.key === section);

  const connection = isError
    ? { tone: "danger" as const, label: "Server offline" }
    : isLoading
      ? { tone: "running" as const, label: "Connecting" }
      : { tone: "success" as const, label: "Connected" };

  return (
    <header className="flex h-14 shrink-0 items-center justify-between gap-4 border-b border-border bg-background/80 px-6 backdrop-blur">
      <div className="min-w-0">
        <h1 className="truncate text-sm font-semibold">{current?.label ?? "Overview"}</h1>
        <p className="truncate text-xs text-muted-foreground">{current?.blurb}</p>
      </div>
      <div className="flex items-center gap-3">
        {state?.device ? (
          <span className="hidden text-xs text-muted-foreground sm:inline">
            {state.device.name} · {readableDeviceStatus(state.device.status)}
          </span>
        ) : null}
        <StatusBadge tone={connection.tone}>{connection.label}</StatusBadge>
      </div>
    </header>
  );
}
