import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Circle, LoaderCircle, Rocket } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useConsoleState } from "@/data/use-console-state";
import { useUiStore, type SectionKey } from "@/store/ui-store";
import { useAppTranslation } from "@/lib/i18n/use-app-translation";
import type { ConsoleSnapshot, GuidedSetupSnapshot } from "@/lib/console-state";
import { commandGuidedSetup, type GuidedSetupCommand } from "@/lib/api-client";

function fallbackGuidedSetup(state: ConsoleSnapshot | undefined): GuidedSetupSnapshot {
  const computerReady = state?.device?.status === "online";
  const projectTargets = state?.projectTargets ?? [];
  const workspaceReady = projectTargets.length > 0
    ? projectTargets.some((target) => target.state === "ready")
    : Boolean((state?.projects ?? []).length);
  const executionReady = (state?.agents ?? []).some((agent) =>
    agent.status !== "disabled" && agent.status !== "unavailable" && agent.health?.status !== "unhealthy");
  const currentStep = !computerReady ? "computer" : !workspaceReady ? "workspace" : !executionReady ? "execution" : "complete";
  const stepKeys = ["computer", "workspace", "execution"] as const;
  const ready = { computer: computerReady, workspace: workspaceReady, execution: executionReady };
  const section = currentStep === "computer" ? "devices" : currentStep === "workspace" ? "projects" : "agents";
  return {
    version: 1,
    status: currentStep === "complete" ? "ready" : "action_required",
    currentStep,
    reason: currentStep === "computer" ? "computer_offline" : currentStep === "workspace" ? "workspace_missing" : currentStep === "execution" ? "execution_missing" : "ready",
    action: currentStep === "complete" ? null : { kind: "open_section", section },
    runId: null,
    completedCount: Object.values(ready).filter(Boolean).length,
    totalCount: stepKeys.length,
    steps: stepKeys.map((key) => ({
      key,
      state: ready[key] ? "complete" : key === currentStep ? "current" : "pending",
    })),
  };
}

export function GuidedSetupCard() {
  const { t } = useAppTranslation();
  const stateQuery = useConsoleState();
  const { data: state } = stateQuery;
  const setSection = useUiStore((store) => store.setSection);
  const serverSetup = useMemo(() => state?.guidedSetup ?? fallbackGuidedSetup(state), [state]);
  const [commandSetup, setCommandSetup] = useState<GuidedSetupSnapshot | null>(null);
  const [pendingCommand, setPendingCommand] = useState<GuidedSetupCommand | null>(null);
  const [commandError, setCommandError] = useState(false);
  const setup = commandSetup ?? serverSetup;
  const started = Boolean(setup.runId);
  const checking = pendingCommand !== null;

  useEffect(() => {
    if (
      commandSetup?.runId
      && serverSetup.runId === commandSetup.runId
      && serverSetup.updatedAt
      && serverSetup.updatedAt === commandSetup.updatedAt
    ) {
      setCommandSetup(null);
    }
  }, [commandSetup, serverSetup]);

  if (setup.status === "ready") return null;

  const visibleStatus = checking ? "checking" : setup.status;
  const reasonKey = `guidedSetup.reasons.${setup.reason}` as never;
  const actionKey = setup.reason === "install_cancelled"
    ? "guidedSetup.actions.install_cancelled" as never
    : setup.status === "action_required"
      ? `guidedSetup.actions.${setup.currentStep}` as never
      : `guidedSetup.actions.${setup.status}` as never;

  async function runCommand(command: GuidedSetupCommand) {
    setPendingCommand(command);
    setCommandError(false);
    try {
      const response = await commandGuidedSetup(command, setup.runId);
      setCommandSetup(response.guidedSetup);
      if (stateQuery.refetch) await stateQuery.refetch();
    } catch {
      setCommandError(true);
    } finally {
      setPendingCommand(null);
    }
  }

  function openCurrentAction() {
    if (setup.reason === "setup_cancelled") {
      void runCommand("resume");
      return;
    }
    if (setup.action?.kind === "open_section") setSection(setup.action.section as SectionKey);
  }

  return (
    <Card data-testid="guided-setup">
      <CardContent className="space-y-3 pt-5">
        <div className="flex items-start gap-3">
          <Rocket className="mt-0.5 size-5 shrink-0 text-primary" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-semibold">{t("guidedSetup.title")}</h3>
              {started ? <Badge tone={setup.status === "failed" ? "danger" : setup.status === "cancelled" ? "neutral" : "warning"}>
                {t(`guidedSetup.status.${visibleStatus}` as never)}
              </Badge> : null}
              {started ? <Badge tone="neutral">{setup.completedCount}/{setup.totalCount}</Badge> : null}
            </div>
            <p className="text-sm text-muted-foreground">{t("guidedSetup.description")}</p>
          </div>
        </div>

        {!started ? (
          <Button className="min-h-11" disabled={checking} onClick={() => void runCommand("start")}>
            {checking ? t("guidedSetup.checkingAction") : t("guidedSetup.start")}
          </Button>
        ) : (
          <>
            <ol className="grid grid-cols-3 gap-2" aria-label={t("guidedSetup.progress")}>
              {setup.steps.map((step, index) => (
                <li key={step.key} className="flex min-h-11 items-center gap-2 rounded-lg border px-2 py-2 text-sm">
                  {checking && step.key === setup.currentStep
                    ? <LoaderCircle className="size-4 animate-spin text-primary" />
                    : step.state === "complete"
                      ? <CheckCircle2 className="size-4 text-success" />
                      : step.state === "failed"
                        ? <AlertTriangle className="size-4 text-destructive" />
                        : <Circle className="size-4 text-muted-foreground" />}
                  <span><b>{index + 1}. {t(`guidedSetup.steps.${step.key}` as never)}</b>
                    <span className="block text-xs text-muted-foreground">{t(`guidedSetup.stepState.${step.state}` as never)}</span>
                  </span>
                </li>
              ))}
            </ol>

            {!checking ? (
              <div className="rounded-lg bg-muted/40 p-3 text-sm" aria-live="polite">
                <p><b>{t("guidedSetup.cause")}：</b>{t(`${reasonKey}.cause` as never)}</p>
                <p><b>{t("guidedSetup.impact")}：</b>{t(`${reasonKey}.impact` as never)}</p>
                <p><b>{t("guidedSetup.next")}：</b>{t(`${reasonKey}.remedy` as never)}</p>
              </div>
            ) : <p className="text-sm text-muted-foreground" role="status">{t("guidedSetup.checking")}</p>}

            {!checking && (setup.action || setup.reason === "setup_cancelled") ? (
              <Button className="min-h-11" onClick={openCurrentAction}>{t(actionKey)}</Button>
            ) : null}
            {!checking && setup.reason !== "setup_cancelled" ? (
              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" className="min-h-11" onClick={() => void runCommand("recheck")}>
                  {t("guidedSetup.recheck")}
                </Button>
                <Button variant="ghost" className="min-h-11" onClick={() => void runCommand("cancel")}>
                  {t("guidedSetup.cancel")}
                </Button>
              </div>
            ) : null}
            {commandError ? <p className="text-sm text-destructive" role="alert">{t("guidedSetup.commandFailed")}</p> : null}
            <p className="text-xs text-muted-foreground">{t("guidedSetup.governance")}</p>
            {setup.runId ? (
              <details className="text-xs text-muted-foreground">
                <summary>{t("guidedSetup.details")}</summary>
                <p className="pt-1 font-mono">{t("guidedSetup.guideRun")}：{setup.runId}</p>
                {setup.operationRunId ? <p className="font-mono">{t("guidedSetup.operationRun")}：{setup.operationRunId}</p> : null}
              </details>
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  );
}
