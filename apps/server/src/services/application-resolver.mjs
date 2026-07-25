import { ASSET_CAPABILITY_VERBS } from "./asset-capabilities.mjs";

const INTENT_TO_HINTS = Object.freeze({
  inspect: ["inspect", "preview", "read", "status"],
  edit: ["edit", "apply", "write"],
  transform: ["transform", "convert", "export", "render"],
  compare: ["compare", "diff", "review"],
  publish: ["publish", "push", "send"],
});

export function resolveLocalApplicationCapability({
  intent = null,
  assetVerb = null,
  capabilities = [],
  terminalId,
  availableResourceClasses = ["small", "medium"],
  resourceClass = "small",
  assetFamily = null,
} = {}) {
  const normalizedIntent = typeof intent === "string" && Object.hasOwn(INTENT_TO_HINTS, intent) ? intent : null;
  const normalizedVerb = typeof assetVerb === "string" && ASSET_CAPABILITY_VERBS.includes(assetVerb) ? assetVerb : null;
  if (!terminalId || (!normalizedIntent && !normalizedVerb)) {
    return refusal("invalid_resolver_request", terminalId ?? null);
  }
  const hints = normalizedVerb ? [normalizedVerb] : INTENT_TO_HINTS[normalizedIntent];
  const local = capabilities.filter((candidate) =>
    candidate?.provider?.type === "application"
    && candidate.terminalId === terminalId
    && candidate.invokable !== false
    && candidate.application?.status !== "archived"
    && candidate.application?.status !== "disabled"
    && candidate.status !== "disabled"
    && candidate.metadata?.policy?.allowed !== false
    && supportsAssetFamily(candidate, assetFamily)
    && matches(candidate, hints));
  if (local.length === 0) return waiting("waiting_capability", "no_local_application_capability", terminalId);

  const ranked = local
    .map((candidate) => ({ candidate, score: score(candidate, hints) }))
    .sort((left, right) => right.score - left.score || left.candidate.name.localeCompare(right.candidate.name));
  const selected = ranked[0].candidate;
  const readiness = selected.metadata?.readiness ?? { state: "ready", reason: "registered_application" };
  if (readiness.state !== "ready") {
    return waiting("waiting_capability", readiness.reason ?? "application_not_ready", terminalId, selected);
  }
  if (resourceClass === "large" && !availableResourceClasses.includes("large")) {
    return waiting("waiting_capacity", "local_resource_class_required:large", terminalId, selected);
  }
  const approval = selected.requiresApproval === true
    ? { required: true, state: "waiting_approval" }
    : { required: false, state: "not_required" };
  return {
    state: approval.required ? "waiting_approval" : "ready",
    reason: approval.required ? "capability_requires_approval" : "local_capability_selected",
    terminalId,
    capability: {
      name: selected.name,
      displayName: safeLabel(selected.displayName ?? selected.name),
      applicationId: selected.provider.id,
      riskLevel: selected.riskLevel ?? "medium",
    },
    approval,
    resource: { requiredClass: resourceClass, availableClasses: [...availableResourceClasses] },
    readiness: readinessSnapshot(selected, readiness),
    explanation: {
      requested: normalizedVerb ? { kind: "asset_verb", value: normalizedVerb } : { kind: "intent", value: normalizedIntent },
      matchedHints: hints.filter((hint) => searchable(selected).includes(hint)),
      candidateCount: ranked.length,
      selectionRule: "same_terminal_ready_then_highest_semantic_match",
    },
  };
}

function matches(candidate, hints) {
  const value = searchable(candidate);
  return hints.some((hint) => value.includes(hint));
}

function score(candidate, hints) {
  const value = searchable(candidate);
  return hints.reduce((total, hint, index) => total + (value.includes(hint) ? 100 - index : 0), 0)
    + (candidate.metadata?.readiness?.state === "ready" ? 20 : 0)
    + (candidate.requiresApproval === true ? 0 : 5);
}

function searchable(candidate) {
  return [
    candidate.name, candidate.displayName, candidate.description,
    ...(candidate.metadata?.assetVerbs ?? []),
    ...(candidate.metadata?.intents ?? []),
  ].filter((value) => typeof value === "string").join(" ").toLowerCase();
}

function supportsAssetFamily(candidate, assetFamily) {
  if (!assetFamily) return true;
  const supported = candidate.metadata?.assetFamilies;
  return !Array.isArray(supported) || supported.includes(assetFamily);
}

function readinessSnapshot(candidate, readiness) {
  const credential = candidate.metadata?.credentialReadiness ?? {};
  return {
    registration: candidate.application?.status === "active" ? "ready" : "registered",
    runtime: readiness.state === "needs_setup" ? "missing" : "ready",
    credential: {
      configured: Boolean(credential.configured),
      scopeMatch: credential.scopeMatch !== false,
      expired: credential.expired === true,
    },
    health: candidate.metadata?.health?.status ?? "unknown",
    policy: candidate.metadata?.policy?.allowed === false ? "denied" : "allowed",
  };
}

function safeLabel(value) {
  return String(value).replace(/[\r\n\t]/g, " ").replace(/\s+/g, " ").slice(0, 120);
}

function waiting(state, reason, terminalId, selected = null) {
  return {
    state, reason, terminalId,
    capability: selected ? {
      name: selected.name,
      displayName: safeLabel(selected.displayName ?? selected.name),
      applicationId: selected.provider.id,
      riskLevel: selected.riskLevel ?? "medium",
    } : null,
    approval: { required: selected?.requiresApproval === true, state: "not_evaluated" },
    readiness: selected ? readinessSnapshot(selected, selected.metadata?.readiness ?? {}) : null,
    explanation: { candidateCount: selected ? 1 : 0, selectionRule: "same_terminal_only" },
  };
}

function refusal(reason, terminalId) {
  return { state: "refusal", reason, terminalId, capability: null, approval: { required: false, state: "not_evaluated" } };
}
