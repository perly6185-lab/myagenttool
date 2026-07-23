import { CheckCircle2, Circle, Rocket } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { useConsoleState } from "@/data/use-console-state";
import { useUiStore, type SectionKey } from "@/store/ui-store";
import { useAppTranslation } from "@/lib/i18n/use-app-translation";

// First-run guidance. The console opens to mostly-empty sections; this composes the
// snapshot's readiness signals into the few steps that unlock real value, each with
// a jump to the section that completes it. Renders NOTHING once everything is set up,
// so it never nags a configured workspace.
export function GettingStartedCard() {
  const { t } = useAppTranslation();
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
    { key: "device", label: t("dashboard.device"), done: device?.status === "online", detail: device?.status === "online" ? t("dashboard.deviceOnline") : t("dashboard.deviceDetail"), section: "devices" },
    { key: "project", label: t("dashboard.registerProject"), done: projectReady, detail: projectReady ? t("dashboard.projects", { count: projects.length }) : t("dashboard.projectDetail"), section: "projects" },
    { key: "agent", label: t("dashboard.readyAgent"), done: agentReady, detail: agentReady ? t("dashboard.agentReady") : t("dashboard.agentDetail"), section: "agents" },
    { key: "task", label: t("dashboard.firstTask"), done: invocations.length > 0, detail: invocations.length ? t("dashboard.runs", { count: invocations.length }) : t("dashboard.taskDetail"), section: "dashboard" },
  ];

  const doneCount = steps.filter((s) => s.done).length;
  if (doneCount === steps.length) return null; // fully set up — no nag

  return (
    <Card>
      <CardHeader className="py-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Rocket className="size-4" /> {t("dashboard.gettingStarted")}
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
              <Button variant="ghost" size="sm" className="ml-auto h-6 shrink-0 px-2 text-xs" onClick={() => setSection(s.section)}>{t("dashboard.go")}</Button>
            ) : null}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
