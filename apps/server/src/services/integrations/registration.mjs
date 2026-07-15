import {
  cancellationTextForAdapter,
  defaultRiskTags,
  isAgentDisabled,
  isCodexCliCommand,
} from "../agents.mjs";
import {
  adapterFromArtifact,
  dataNotesForIntegration,
  suggestedAgentId,
} from "./helpers.mjs";
import { makeRunTx } from "../../runtime/store/run-tx.mjs";

export function createIntegrationRegistrationRuntime({
  now,
  appendEvent,
  disableAgent,
  registerAgent,
  persistStateSoon = () => {},
  store,
}) {
  const runTx = makeRunTx({ store, persistStateSoon });
  function registerIntegrationArtifact(artifact) {
    if (artifact.artifactType !== "adapter_config") {
      throw new Error("Only adapter config artifacts can register an agent.");
    }
    if (artifact.reviewState !== "tested") {
      throw new Error("Run and pass a probe before registering this integration.");
    }
    return runTx(() => {
    const adapter = adapterFromArtifact(artifact);
    const agent = registerAgent({
      id: suggestedAgentId(artifact),
      type: adapter.type,
      name: artifact.payload?.title ?? "Generated Integration Agent",
      description: artifact.payload?.description ?? artifact.summary,
      command: adapter.type === "cli" ? adapter.command : undefined,
      args: adapter.type === "cli" ? adapter.args : undefined,
      outputFormat: adapter.type === "cli" ? adapter.outputFormat : undefined,
      sandbox: adapter.type === "cli" ? adapter.sandbox : undefined,
      baseUrl: adapter.type === "http" ? adapter.baseUrl : undefined,
      requestPath: adapter.type === "http" ? adapter.requestPath : undefined,
      healthPath: adapter.type === "http" ? adapter.healthPath : undefined,
      timeoutSeconds: adapter.timeoutSeconds,
      cancellation: adapter.cancellation,
      riskLevel: artifact.governance?.riskLevel ?? "medium",
      riskTags: artifact.governance?.riskTags ?? defaultRiskTags(adapter.type),
      economicModel: artifact.governance?.economics?.model ?? "unknown",
      costOwner: artifact.governance?.economics?.costOwner ?? "usr_local",
      unknownCostPolicy: artifact.governance?.economics?.unknownCostPolicy ?? "warn",
    });
    agent.registrationNotes = {
      risk: artifact.payload?.riskNotes ?? "Generated integration requires review before use.",
      data: artifact.payload?.dataNotes ?? dataNotesForIntegration(adapter.type),
      cost: artifact.payload?.costNotes ?? "Cost is unknown.",
      cancellation: artifact.payload?.cancellationNotes ?? cancellationTextForAdapter(adapter),
    };
    agent.integrationArtifactId = artifact.id;
    if (!isCodexCliCommand(agent.adapter?.command)) {
      disableAgent(agent);
    }
    artifact.reviewState = "enabled";
    artifact.enabledAgentId = agent.id;
    artifact.updatedAt = now();
    appendEvent({
      invocationId: null,
      type: "integration_enabled",
      level: "info",
      message: isCodexCliCommand(agent.adapter?.command)
        ? `${agent.name} registered from tested artifact and is available through Codex CLI native controls.`
        : `${agent.name} registered from tested artifact and left disabled.`,
      data: { artifactId: artifact.id, agentId: agent.id, disabled: isAgentDisabled(agent) },
    });
    return agent;
    });
  }

  return {
    registerIntegrationArtifact,
  };
}
