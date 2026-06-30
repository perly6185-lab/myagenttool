import { createIntegrationArtifactRuntime } from "./integrations/artifacts.mjs";
import { createDiscoveryRuntime } from "./integrations/discovery.mjs";
import { createIntegrationGovernanceRuntime } from "./integrations/governance.mjs";
import { createIntegrationProbeRuntime } from "./integrations/probes.mjs";
import { createIntegrationRegistrationRuntime } from "./integrations/registration.mjs";

export function createIntegrationService({
  state,
  now,
  nextId,
  appendEvent,
  completeInvocation,
  createInvocation,
  disableAgent,
  findAgent,
  registerAgent,
}) {
  const {
    completeDiscoveryRun,
    createDiscoveryRun,
    findDiscoveryRun,
    markDiscoveryStarted,
    nextBridgeDiscoveryRun,
    registerDiscoveredCandidate,
  } = createDiscoveryRuntime({
    state,
    now,
    nextId,
    appendEvent,
    disableAgent,
    registerAgent,
  });

  const {
    buildIntegrationGovernance,
    recordQuotaDecision,
    updateIntegrationRetentionSettings,
  } = createIntegrationGovernanceRuntime({
    state,
    now,
    nextId,
    appendEvent,
  });

  const {
    createIntegrationArtifact,
    findIntegrationArtifact,
    generateIntegrationArtifacts,
    transitionIntegrationArtifact,
  } = createIntegrationArtifactRuntime({
    state,
    now,
    nextId,
    appendEvent,
    buildIntegrationGovernance,
    recordQuotaDecision,
  });

  const {
    completeIntegrationProbeRun,
    createIntegrationProbeRun,
    findIntegrationProbeRun,
    markIntegrationProbeStarted,
    nextBridgeProbeRun,
  } = createIntegrationProbeRuntime({
    state,
    now,
    nextId,
    appendEvent,
    findIntegrationArtifact,
  });

  const {
    registerIntegrationArtifact,
  } = createIntegrationRegistrationRuntime({
    now,
    appendEvent,
    disableAgent,
    registerAgent,
  });

  function draftIntegrationWithPlatformAgent(body = {}) {
    const platformAgent = findAgent("agt_platform_integration_builder");
    if (!platformAgent) {
      throw new Error("Integration Builder platform agent is not registered.");
    }
    const description = String(body.description ?? body.intent ?? "").trim();
    if (!description) {
      throw new Error("Integration intent is required.");
    }
    const platformInvocation = createInvocation(`Draft integration plan: ${description}`, platformAgent, {
      metadata: { integrationBuilder: true, advisoryOnly: true },
    });
    appendEvent({
      invocationId: platformInvocation.id,
      type: "platform_agent_started",
      level: "info",
      message: "Integration Builder started an advisory draft.",
      data: { advisoryOnly: true },
    });
    const artifact = createIntegrationArtifact({
      ...body,
      artifactType: "integration_plan",
      reviewState: "draft",
      generatedByAi: true,
      description,
      summary: "Integration Builder draft plan",
    });
    appendEvent({
      invocationId: platformInvocation.id,
      type: "platform_agent_recommended",
      level: "info",
      message: "Integration Builder drafted a reviewable plan. It cannot enable the integration.",
      data: { artifactId: artifact.id, advisoryOnly: true },
    });
    appendEvent({
      invocationId: platformInvocation.id,
      type: "platform_agent_action_requested",
      level: "info",
      message: "Review, approve, probe, and registration remain explicit user actions.",
      data: { artifactId: artifact.id },
    });
    completeInvocation(platformInvocation, {
      status: "succeeded",
      summary: "Integration Builder drafted a reviewable integration plan.",
      result: {
        summary: "Integration Builder drafted a reviewable integration plan.",
        output: { artifactId: artifact.id, advisoryOnly: true },
        touchedUserFiles: false,
        cost: { model: platformAgent.economics.model, billable: false },
      },
    });
    return { invocation: platformInvocation, artifact };
  }

  return {
    completeDiscoveryRun,
    completeIntegrationProbeRun,
    createDiscoveryRun,
    createIntegrationArtifact,
    createIntegrationProbeRun,
    draftIntegrationWithPlatformAgent,
    findDiscoveryRun,
    findIntegrationArtifact,
    findIntegrationProbeRun,
    generateIntegrationArtifacts,
    markDiscoveryStarted,
    markIntegrationProbeStarted,
    nextBridgeDiscoveryRun,
    nextBridgeProbeRun,
    registerDiscoveredCandidate,
    registerIntegrationArtifact,
    transitionIntegrationArtifact,
    updateIntegrationRetentionSettings,
  };
}
