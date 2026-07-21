import { findKnownRuntime, runtimeRequirementsForApplicationId } from "./runtime-catalog.mjs";

export function localApplicationReadiness(application, device) {
  if (application?.status === "archived") {
    return readiness("archived", "Application is archived.", null);
  }
  const requirements = resolvedRuntimeRequirements(application);
  if (requirements.length === 0) {
    return readiness("ready", "Application is ready on this computer.", null);
  }
  if (!device || device.status !== "online") {
    return readiness("bridge_offline", "Start the local Desktop Bridge to use this application.", "start_bridge");
  }

  const rows = device.runtimeReadiness ?? device.applicationBinaryReadiness ?? [];
  for (const requirement of requirements.filter((entry) => entry?.required !== false)) {
    const runtime = findKnownRuntime(requirement.runtimeId);
    const row = rows.find((entry) => entry?.runtimeId === requirement.runtimeId
      || (!entry?.runtimeId && runtime && entry?.command === runtime.command));
    if (!row || row.status === "absent" || row.status === "stale") {
      return readiness("repair_required", "A required local component needs repair.", "repair");
    }
    if (row.authenticationStatus === "unauthenticated") {
      return readiness("login_required", "Sign in to finish setting up this application.", "login");
    }
    if (row.authenticationStatus === "unknown") {
      return readiness("repair_required", "Local sign-in status could not be verified.", "retry");
    }
  }
  return readiness("ready", "Application is ready on this computer.", null);
}

function readiness(state, summary, action) {
  return { state, summary, action, scope: "local" };
}

export function withLocalApplicationReadiness(application, device) {
  const runtimeRequirements = resolvedRuntimeRequirements(application);
  return {
    ...application,
    executionScope: "local",
    runtimeRequirements,
    localReadiness: localApplicationReadiness({ ...application, runtimeRequirements }, device),
  };
}

function resolvedRuntimeRequirements(application) {
  if (Array.isArray(application?.runtimeRequirements)) return application.runtimeRequirements;
  return runtimeRequirementsForApplicationId(application?.id);
}
