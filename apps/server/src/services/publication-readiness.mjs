function normalizedPlatformId(platformTarget) {
  return String(platformTarget?.id ?? "").trim().toLowerCase();
}

function matchingConnections({ applications, platformId, operation, ownerTeamId }) {
  const matches = [];
  for (const application of applications ?? []) {
    if (ownerTeamId && (application?.ownerTeamId ?? "team_local") !== ownerTeamId) continue;
    for (const facade of application?.capabilityFacades ?? []) {
      const contract = facade?.siteOperationContract;
      if (contract?.platformId === platformId && contract?.operation === operation) {
        matches.push({ application, facade, contract });
      }
    }
  }
  return matches;
}

function connectionView({ application, facade, contract }) {
  return {
    applicationId: application.id,
    applicationName: application.name,
    facadeId: facade.id,
    displayName: facade.displayName ?? facade.id,
    requiresApproval: facade.requiresApproval === true,
    operation: contract.operation,
    inputArtifactKinds: [...(contract.inputArtifactKinds ?? [])],
    outputArtifactKinds: [...(contract.outputArtifactKinds ?? [])],
  };
}

function operationReadiness({ applications = [], platformTarget = null, ownerTeamId = null, operation }) {
  const platformId = normalizedPlatformId(platformTarget);
  if (!platformId) return { state: "needs_setup", reason: `${operation}_target_required`, platformId: null, connection: null };
  const matching = matchingConnections({ applications, platformId, operation, ownerTeamId });
  const active = matching.find(({ application, facade }) =>
    application.status === "active" && facade.directInvocation !== false && facade.requiresApproval === true);
  if (active) return { state: "ready", reason: `governed_${operation}_capability_ready`, platformId, connection: connectionView(active) };
  const ungated = matching.find(({ application, facade }) =>
    application.status === "active" && facade.directInvocation !== false && facade.requiresApproval !== true);
  return {
    state: "needs_setup",
    reason: ungated ? `${operation}_approval_gate_required` : matching.length ? `${operation}_connection_inactive` : `${operation}_connection_missing`,
    platformId,
    connection: matching.length ? connectionView(matching[0]) : null,
  };
}

export function publicationCapabilityReadiness(input = {}) {
  const result = operationReadiness({ ...input, operation: "publish" });
  const reasonAliases = {
    publish_target_required: "publication_target_required",
    governed_publish_capability_ready: "governed_publication_capability_ready",
    publish_approval_gate_required: "publication_approval_gate_required",
    publish_connection_inactive: "publication_connection_inactive",
    publish_connection_missing: "publication_connection_missing",
  };
  return { ...result, reason: reasonAliases[result.reason] ?? result.reason };
}

export function draftSyncCapabilityReadiness(input = {}) {
  const platformId = normalizedPlatformId(input.platformTarget);
  if (platformId !== "wechat_official") {
    return { state: "needs_setup", reason: "draft_sync_target_unsupported", platformId: platformId || null, connection: null };
  }
  return operationReadiness({ ...input, operation: "draft_sync" });
}
