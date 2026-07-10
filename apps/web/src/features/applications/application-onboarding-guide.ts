import type { ApplicationSource } from "@/lib/console-state";
import type { Tone } from "@/lib/readable-labels";

export type ApplicationOnboardingStepStatus = "done" | "current" | "pending";

export interface ApplicationOnboardingGuideInput {
  sourceType: ApplicationSource["type"];
  sourceReady: boolean;
  hasIntegrationBrief: boolean;
  hasDescriptorDraft: boolean;
  smokeTests: string[];
  autoProbeAfterRegister: boolean;
}

export interface ApplicationOnboardingStep {
  id: "source" | "brief" | "descriptors" | "smoke";
  title: string;
  detail: string;
  status: ApplicationOnboardingStepStatus;
  tone: Tone;
}

export interface ApplicationOnboardingGuide {
  readinessLabel: string;
  readinessTone: Tone;
  steps: ApplicationOnboardingStep[];
}

export function applicationOnboardingGuide(input: ApplicationOnboardingGuideInput): ApplicationOnboardingGuide {
  const sourceDone = input.sourceReady;
  const briefDone = input.hasIntegrationBrief;
  const descriptorsDone = input.hasDescriptorDraft;
  const smokeDone = input.smokeTests.length > 0 || input.autoProbeAfterRegister;
  const doneCount = [sourceDone, briefDone, descriptorsDone, smokeDone].filter(Boolean).length;

  return {
    readinessLabel: doneCount === 4
      ? "ready for reviewed registration"
      : doneCount >= 2
        ? `${doneCount}/4 onboarding inputs ready`
        : "capture onboarding inputs",
    readinessTone: doneCount === 4 ? "success" : doneCount >= 2 ? "warning" : "neutral",
    steps: [
      {
        id: "source",
        title: "Choose source",
        detail: sourceDone
          ? `${readableSourceType(input.sourceType)} source is ready.`
          : "Select a source and provide the package, path, repository, or URI.",
        status: sourceDone ? "done" : "current",
        tone: sourceDone ? "success" : "warning",
      },
      {
        id: "brief",
        title: "Capture brief",
        detail: briefDone
          ? "Codex draft inputs are saved with the registration payload."
          : "Add intent, data boundary, commands, result import, and recovery notes.",
        status: briefDone ? "done" : sourceDone ? "current" : "pending",
        tone: briefDone ? "success" : sourceDone ? "warning" : "neutral",
      },
      {
        id: "descriptors",
        title: "Review descriptors",
        detail: descriptorsDone
          ? "Descriptor draft JSON is attached for operator review."
          : descriptorGuidance(input.sourceType),
        status: descriptorsDone ? "done" : briefDone ? "current" : "pending",
        tone: descriptorsDone ? "success" : briefDone ? "warning" : "neutral",
      },
      {
        id: "smoke",
        title: "Plan smoke path",
        detail: smokeDone
          ? smokeDetail(input)
          : "Add smoke checks so registration, probe, invocation, evidence, and restart can be verified.",
        status: smokeDone ? "done" : (briefDone || descriptorsDone) ? "current" : "pending",
        tone: smokeDone ? "success" : (briefDone || descriptorsDone) ? "warning" : "neutral",
      },
    ],
  };
}

function readableSourceType(sourceType: ApplicationSource["type"]): string {
  if (sourceType === "npm") return "npm";
  if (sourceType === "git") return "Git";
  if (sourceType === "local") return "Local";
  return "Manual";
}

function descriptorGuidance(sourceType: ApplicationSource["type"]): string {
  if (sourceType === "npm") return "Add or generate an npm wrapper descriptor before approving execution.";
  if (sourceType === "manual") return "Add a manual manifest or MCP descriptor before projecting capabilities.";
  return "Use probe evidence or descriptor drafts before enabling shared capabilities.";
}

function smokeDetail(input: ApplicationOnboardingGuideInput): string {
  const smokeLabel = input.smokeTests.length
    ? `${input.smokeTests.length} smoke check(s) captured.`
    : "Probe will run after registration.";
  return input.autoProbeAfterRegister ? `${smokeLabel} Auto-probe is enabled.` : smokeLabel;
}
