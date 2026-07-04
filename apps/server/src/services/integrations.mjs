import { createIntegrationArtifactRuntime } from "./integrations/artifacts.mjs";
import { createDiscoveryRuntime } from "./integrations/discovery.mjs";
import { createIntegrationGovernanceRuntime } from "./integrations/governance.mjs";
import { createIntegrationPlatformDraftRuntime } from "./integrations/platform-draft.mjs";
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
  persistStateSoon = () => {},
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
    persistStateSoon,
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
    persistStateSoon,
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
    persistStateSoon,
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
    persistStateSoon,
  });

  const {
    registerIntegrationArtifact,
  } = createIntegrationRegistrationRuntime({
    now,
    appendEvent,
    disableAgent,
    registerAgent,
    persistStateSoon,
  });

  const {
    draftIntegrationWithPlatformAgent,
  } = createIntegrationPlatformDraftRuntime({
    appendEvent,
    completeInvocation,
    createIntegrationArtifact,
    createInvocation,
    findAgent,
  });

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
