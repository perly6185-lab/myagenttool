function normalizedPlatformId(platformTarget) {
  return String(platformTarget?.id ?? "").trim().toLowerCase();
}

function normalizedAccountId(value) {
  return String(value ?? "").trim() || null;
}

function applicationAccountId(application, facade) {
  return normalizedAccountId(facade?.accountId
    ?? application?.accountId
    ?? application?.source?.manifest?.accountId);
}

function connectionOperational(application) {
  const health = String(application?.health?.status ?? application?.healthStatus ?? "unknown").toLowerCase();
  const session = String(application?.session?.status ?? application?.sessionStatus
    ?? application?.source?.manifest?.sessionStatus ?? "unknown").toLowerCase();
  return !["unhealthy", "failed", "error", "offline"].includes(health)
    && !["expired", "disconnected", "failed", "error", "signed_out", "unauthenticated"].includes(session);
}

function matchingConnections({ applications, platformId, operation, ownerTeamId, accountId = null, applicationId = null }) {
  const matches = [];
  for (const application of applications ?? []) {
    if (ownerTeamId && (application?.ownerTeamId ?? "team_local") !== ownerTeamId) continue;
    if (applicationId && application?.id !== applicationId) continue;
    for (const facade of application?.capabilityFacades ?? []) {
      const contract = facade?.siteOperationContract;
      if (contract?.platformId === platformId && contract?.operation === operation) {
        const connectionAccountId = applicationAccountId(application, facade);
        if (accountId && connectionAccountId !== accountId) continue;
        matches.push({ application, facade, contract, accountId: connectionAccountId });
      }
    }
  }
  return matches;
}

function connectionView({ application, facade, contract, accountId }) {
  return {
    applicationId: application.id,
    applicationName: application.name,
    facadeId: facade.id,
    displayName: facade.displayName ?? facade.id,
    requiresApproval: facade.requiresApproval === true,
    operation: contract.operation,
    inputArtifactKinds: [...(contract.inputArtifactKinds ?? [])],
    outputArtifactKinds: [...(contract.outputArtifactKinds ?? [])],
    ...(accountId ? { accountId } : {}),
  };
}

function operationReadiness({ applications = [], platformTarget = null, ownerTeamId = null, operation }) {
  const platformId = normalizedPlatformId(platformTarget);
  if (!platformId) return { state: "needs_setup", reason: `${operation}_target_required`, platformId: null, connection: null };
  const accountId = normalizedAccountId(platformTarget?.accountId);
  const applicationId = normalizedAccountId(platformTarget?.applicationId);
  const matching = matchingConnections({ applications, platformId, operation, ownerTeamId, accountId, applicationId });
  const active = matching.find(({ application, facade }) =>
    application.status === "active" && connectionOperational(application)
    && facade.directInvocation !== false && facade.requiresApproval === true);
  if (active) return { state: "ready", reason: `governed_${operation}_capability_ready`, platformId, connection: connectionView(active) };
  const unhealthy = matching.find(({ application, facade }) =>
    application.status === "active" && !connectionOperational(application)
    && facade.directInvocation !== false && facade.requiresApproval === true);
  const ungated = matching.find(({ application, facade }) =>
    application.status === "active" && connectionOperational(application)
    && facade.directInvocation !== false && facade.requiresApproval !== true);
  return {
    state: "needs_setup",
    reason: ungated ? `${operation}_approval_gate_required`
      : unhealthy ? `${operation}_connection_unhealthy`
        : matching.length ? `${operation}_connection_inactive`
          : accountId || applicationId ? `${operation}_account_connection_missing` : `${operation}_connection_missing`,
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
    publish_connection_unhealthy: "publication_connection_unhealthy",
    publish_account_connection_missing: "publication_account_connection_missing",
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
