const SPECIALIZED_TASK_CAPABILITIES = Object.freeze({
  content_image: { label: "图片生成能力", capabilityId: "media.image.generate", operation: "generate", outputArtifactKind: "image_set" },
  content_comic: { label: "漫画或图片生成能力", capabilityId: "media.image.generate", operation: "generate", outputArtifactKind: "comic_package", compatibleOutputArtifactKinds: ["image_set"] },
  content_voiceover: { label: "语音生成能力", capabilityId: "media.speech.generate", operation: "generate", outputArtifactKind: "voiceover_package" },
  content_video: { label: "视频生成能力", capabilityId: "media.video.generate", operation: "generate", outputArtifactKind: "video_package" },
});

function healthyApplication(application) {
  if (!["active", "available", "ready", "connected"].includes(String(application?.status ?? "").toLowerCase())) return false;
  if (["unhealthy", "offline", "failed", "unknown"].includes(String(application?.health?.status ?? "").toLowerCase())) return false;
  if (application?.healthProbe?.enabled === true) return application?.health?.status === "healthy";
  return application?.health?.status === "healthy" || application?.taskCapabilityHealth === "managed_runtime";
}

function healthyAgent(agent) {
  return ["available", "active", "ready"].includes(String(agent?.status ?? "").toLowerCase())
    && agent?.health?.status === "healthy";
}

function contractMatches(contract, requirement) {
  if (!contract || contract.id !== requirement.capabilityId) return false;
  const operations = new Set(contract.operations ?? []);
  const outputs = new Set(contract.outputArtifactKinds ?? []);
  const acceptedOutputs = [requirement.outputArtifactKind, ...(requirement.compatibleOutputArtifactKinds ?? [])];
  return operations.has(requirement.operation) && acceptedOutputs.some((kind) => outputs.has(kind));
}

function matchingCapability(state, requirement) {
  for (const application of state?.applications ?? []) {
    if (!healthyApplication(application)) continue;
    for (const facade of application.capabilityFacades ?? []) {
      if (facade.directInvocation === false) continue;
      if (contractMatches(facade.taskCapabilityContract, requirement)) {
        return { providerType: "application", providerId: application.id, facadeId: facade.id };
      }
    }
  }
  for (const agent of state?.agents ?? []) {
    if (!healthyAgent(agent)) continue;
    for (const capability of agent.capabilities ?? []) {
      if (contractMatches(capability.taskCapabilityContract ?? capability.contract, requirement)) {
        return { providerType: "agent", providerId: agent.id, facadeId: null };
      }
    }
  }
  return null;
}

export function taskCapabilityReadiness(state, taskKind) {
  const requirement = SPECIALIZED_TASK_CAPABILITIES[String(taskKind ?? "")];
  if (!requirement) return { ready: true, taskKind, requiredCapability: null, reason: "general_agent_capability" };
  const match = matchingCapability(state, requirement);
  return {
    ready: Boolean(match),
    taskKind,
    requiredCapability: requirement.label,
    reason: match ? "specialized_capability_contract_ready" : "specialized_capability_unavailable",
    setupSection: match ? null : "applications",
    ...(match ? {
      capabilityId: requirement.capabilityId,
      operation: requirement.operation,
      outputArtifactKind: requirement.outputArtifactKind,
      provider: { type: match.providerType, id: match.providerId, facadeId: match.facadeId },
    } : {}),
  };
}

export function taskPlanCapabilityReadiness(state, tasks = []) {
  const checks = tasks.map((task) => taskCapabilityReadiness(state, task.kind));
  return { ready: checks.every((check) => check.ready), blockers: checks.filter((check) => !check.ready) };
}
