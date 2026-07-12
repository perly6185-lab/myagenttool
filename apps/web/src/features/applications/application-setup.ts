import type { ApplicationSnapshot, InvocationSnapshot } from "@/lib/console-state";

// The register → probe → generate orchestration → run path is four scattered
// actions; a freshly-registered application gives no hint of what's next. This
// derives the setup state so the inspector can show a guided checklist. Pure and
// unit-tested; the UI is a thin render over it.

export type SetupStep = "probe" | "generate" | "run" | "done";

export interface SetupState {
  probed: boolean;
  hasOrchestration: boolean;
  hasRun: boolean;
  nextStep: SetupStep;
  /** 0..3 completed of the three guided steps. */
  completed: number;
}

const NEXT_HINT: Record<SetupStep, string> = {
  probe: "Probe the source to infer its governed capabilities.",
  generate: "Generate a governed orchestration (a validated LoopRoutine draft).",
  run: "Run the orchestration to produce its first governed result.",
  done: "Setup complete.",
};

export function applicationSetupState(app: ApplicationSnapshot, invocations: InvocationSnapshot[]): SetupState {
  const probed = Boolean(app.probe?.checkedAt) || (app.probe?.capabilities?.length ?? 0) > 0;
  const hasOrchestration = (app.orchestrations?.length ?? 0) > 0 || (app.orchestrationIds?.length ?? 0) > 0;
  const hasRun = invocations.some(
    (inv) =>
      inv.options?.metadata?.applicationId === app.id &&
      inv.options?.metadata?.source === "application_orchestration",
  );
  const nextStep: SetupStep = !probed ? "probe" : !hasOrchestration ? "generate" : !hasRun ? "run" : "done";
  return {
    probed,
    hasOrchestration,
    hasRun,
    nextStep,
    completed: Number(probed) + Number(hasOrchestration) + Number(hasRun),
  };
}

export function setupNextHint(step: SetupStep): string {
  return NEXT_HINT[step];
}
