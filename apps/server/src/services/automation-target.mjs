/*
 * What a scheduled automation fires (#847).
 *
 * An automation used to be one thing implicitly: an agent prompt. Adding a second
 * kind means the target has to become explicit — but the ~existing automations in
 * every live snapshot carry no `target` field at all, so ABSENT MUST KEEP MEANING
 * "agent". That is the migration seam, and it is the part most likely to be
 * broken by someone later "tidying up" the default.
 *
 * Inputs for a capability target are validated against the capability's OWN
 * published contract (#800: declared inputs as key + type). There is no second
 * validator here, and there must never be: the moment the scheduler validates
 * differently from the invocation path, a schedule can save an input the run
 * would refuse — or worse, fire one the run would have dropped.
 */

export const AUTOMATION_TARGET_KINDS = ["agent", "capability"];

/** Absent target → the agent prompt every existing automation already is. */
export function normalizeAutomationTarget(raw) {
  const value = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const kind = AUTOMATION_TARGET_KINDS.includes(value.kind) ? value.kind : "agent";
  if (kind === "agent") return { kind: "agent" };
  return {
    kind: "capability",
    capability: String(value.capability ?? "").trim(),
    inputs: plainInputs(value.inputs),
  };
}

export function isCapabilityTarget(automation) {
  return automation?.target?.kind === "capability";
}

/**
 * Validate a capability target against the live contract. Returns `null` when it
 * is fine, or a reason an operator can act on.
 *
 * Called at SAVE time and again at FIRE time — deliberately. A capability can be
 * re-registered, disabled, or have its declared inputs changed between the two,
 * and a schedule that quietly fires the wrong argv is worse than one that refuses.
 */
export function capabilityTargetProblem({ target, capability, projectId }) {
  if (!target?.capability) {
    return "A capability automation must name a capability.";
  }
  if (!capability) {
    return `The capability ${target.capability} is not available to this automation.`;
  }
  if (capability.status === "disabled") {
    return `The capability ${target.capability} is disabled — its application is offline or archived.`;
  }
  if (capability.invocationMode === "not_invokable") {
    return `The capability ${target.capability} cannot be invoked.`;
  }
  // A cwdPolicy:"invocation_root" command IS its repository (#773/#794): dispatch
  // refuses it without one, so a schedule that lacks a project is a schedule that
  // can only ever fail. Catch it when it is saved, not on the first tick.
  if (capability.metadata?.wrapper?.cwdPolicy === "invocation_root" && !projectId) {
    return `The capability ${target.capability} runs inside a repository, so the automation needs a project.`;
  }
  const declared = capability.inputSchema?.properties ?? {};
  for (const key of Object.keys(target.inputs ?? {})) {
    if (!Object.hasOwn(declared, key)) {
      return `"${key}" is not a declared input of ${target.capability}.`;
    }
  }
  return null;
}

/** The body a capability target dispatches with — the same shape the run panel sends. */
export function capabilityInvocationInput(automation) {
  return {
    ...(automation.projectId ? { projectId: automation.projectId } : {}),
    ...(automation.target?.inputs ?? {}),
  };
}

// Only string-valued, plainly-named inputs are stored. The invocation path drops
// anything undeclared anyway, but a schedule should not persist what it cannot
// send — a saved field nobody honours is a lie an operator will eventually read.
function plainInputs(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const inputs = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!/^[a-zA-Z][a-zA-Z0-9_]{0,39}$/.test(key)) continue;
    if (value === null || value === undefined) continue;
    if (typeof value === "object") continue;
    inputs[key] = String(value);
  }
  return inputs;
}
