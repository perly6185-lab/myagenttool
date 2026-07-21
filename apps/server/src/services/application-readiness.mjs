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
    // Stage 3 (#1342): a missing/absent runtime is NOT INSTALLED (offer install),
    // distinct from a `stale` one that IS installed but needs repair.
    if (!row || row.status === "absent") {
      return readiness("not_installed", "Install the required local runtime to use this application.", "install");
    }
    if (row.status === "stale") {
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

// Stage 4 (#1342): the add/install/login/register state-machine CORE, as a pure
// derivation over the Stage 3 local readiness. Given an Application (a catalog
// draft being added, or an already-registered one) and the local device, it
// returns the single next step toward a ready + registered Application:
//   start_bridge → install → login → repair → register → ready
// A runtime-blocked state maps to its remediation step; once the runtime is ready
// (or none is needed) the step is `register` for an unregistered app, else `ready`.
// Pure and endpoint/UI-free so the flow is unit-testable in isolation.
const SETUP_STEP_BY_READINESS = {
  bridge_offline: "start_bridge",
  not_installed: "install",
  login_required: "login",
  repair_required: "repair",
  archived: "none",
};

export function setupNextStep(application, device, { registered = false } = {}) {
  const current = localApplicationReadiness(application, device);
  const step = SETUP_STEP_BY_READINESS[current.state] ?? (registered ? "ready" : "register");
  return {
    step,
    state: current.state,
    summary: current.summary,
    action: current.action ?? (step === "register" ? "register" : null),
    scope: "local",
  };
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
