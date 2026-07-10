import type { ApplicationSnapshot } from "@/lib/console-state";
import type { Tone } from "@/lib/readable-labels";

export type ApplicationPostSaveActionKind = "probe" | "consent" | "orchestration" | "smoke_plan";

export interface ApplicationPostSaveAction {
  id: string;
  kind: ApplicationPostSaveActionKind;
  title: string;
  detail: string;
  tone: Tone;
  actionLabel: string;
  steps?: string[];
}

export function applicationPostSaveActions(application: ApplicationSnapshot): ApplicationPostSaveAction[] {
  if (application.lifecycle?.lastOperation !== "update_descriptors") return [];
  const actions: ApplicationPostSaveAction[] = [];

  const descriptorEditedAt = timestampValue(application.lifecycle.lastOperationAt);
  const probedAt = timestampValue(application.probe?.checkedAt);
  if (!application.probe || (descriptorEditedAt > 0 && probedAt > 0 && descriptorEditedAt > probedAt)) {
    actions.push({
      id: "probe_after_descriptor_save",
      kind: "probe",
      title: "Probe descriptors",
      detail: "Run a probe so capability projection, MCP candidates, and wrapper readiness reflect the saved descriptors.",
      tone: "warning",
      actionLabel: "Run probe",
    });
  }

  const elevatedCommands = elevatedWrapperCommands(application);
  if (elevatedCommands.length) {
    actions.push({
      id: "review_wrapper_policy_consent",
      kind: "consent",
      title: "Review policy consent",
      detail: `${elevatedCommands.length} wrapper command(s) request write-capable file access or network access.`,
      tone: "danger",
      actionLabel: "Review run controls",
    });
  }

  if (application.probe && !application.orchestrationIds?.length && application.status !== "archived" && application.status !== "offline") {
    actions.push({
      id: "generate_orchestration_after_descriptor_save",
      kind: "orchestration",
      title: "Generate orchestration",
      detail: "Create a governed maintenance routine after probe evidence is available.",
      tone: "success",
      actionLabel: "Generate orchestration",
    });
  }

  const smokeTests = application.integrationBrief?.smokeTests ?? [];
  if (smokeTests.length) {
    actions.push({
      id: "review_smoke_plan",
      kind: "smoke_plan",
      title: "Run smoke path",
      detail: smokeTests.join(", "),
      tone: "neutral",
      actionLabel: "Review smoke plan",
      steps: smokeTests,
    });
  }

  return actions;
}

function elevatedWrapperCommands(application: ApplicationSnapshot) {
  return (application.wrapper?.commands ?? []).filter((command) => {
    if (command.status !== "approved") return false;
    return (command.filePolicy ?? "read_only") !== "read_only"
      || (command.networkPolicy ?? "forbidden") !== "forbidden";
  });
}

function timestampValue(value?: string | null): number {
  const timestamp = Date.parse(value ?? "");
  return Number.isNaN(timestamp) ? 0 : timestamp;
}
