import { CheckCircle2, Circle, Rocket } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { useConsoleState } from "@/data/use-console-state";
import { useUiStore, type SectionKey } from "@/store/ui-store";

// First-run guidance. The console opens to mostly-empty sections; this composes the
// snapshot's readiness signals into the few steps that unlock real value, each with
// a jump to the section that completes it. Renders NOTHING once everything is set up,
// so it never nags a configured workspace.
export function GettingStartedCard() {
  const { data: state } = useConsoleState();
  const setSection = useUiStore((s) => s.setSection);

  const device = state?.device;
  const projects = state?.projects ?? [];
  const targets = state?.projectTargets ?? [];
  const agents = state?.agents ?? [];
  const invocations = state?.invocations ?? [];

  const projectReady = targets.some((t) => t.state === "ready") || projects.length > 0;
  const agentReady = agents.some((a) => a.status !== "disabled" && a.health?.status !== "unhealthy");

  const steps: { key: string; label: string; done: boolean; detail: string; section: SectionKey }[] = [
    { key: "device", label: "Link a local device", done: device?.status === "online", detail: device?.status === "online" ? "Device online" : "The local bridge runs your agents", section: "devices" },
    { key: "project", label: "Register a project", done: projectReady, detail: projectReady ? `${projects.length} project(s)` : "Clone or link a repo to work in", section: "projects" },
    { key: "agent", label: "Have a ready agent", done: agentReady, detail: agentReady ? "an agent is ready" : "an agent executes your tasks", section: "agents" },
    { key: "task", label: "Run your first task", done: invocations.length > 0, detail: invocations.length ? `${invocations.length} run(s)` : "use the composer below", section: "dashboard" },
  ];

  const doneCount = steps.filter((s) => s.done).length;
  if (doneCount === steps.length) return null; // fully set up — no nag

  return (
    <Card>
      <CardHeader className="py-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Rocket className="size-4" /> Getting started
          <Badge tone="neutral">{doneCount}/{steps.length}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-1.5">
        {steps.map((s) => (
          <div key={s.key} className="flex items-center gap-2 text-sm">
            {s.done ? <CheckCircle2 className="size-4 shrink-0 text-success" /> : <Circle className="size-4 shrink-0 text-muted-foreground" />}
            <span className={cn(s.done && "text-muted-foreground line-through")}>{s.label}</span>
            <span className="truncate text-xs text-muted-foreground">— {s.detail}</span>
            {!s.done && s.section !== "dashboard" ? (
              <Button variant="ghost" size="sm" className="ml-auto h-6 shrink-0 px-2 text-xs" onClick={() => setSection(s.section)}>Go →</Button>
            ) : null}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
