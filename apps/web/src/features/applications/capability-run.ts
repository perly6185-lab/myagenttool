import type { ApplicationCapability } from "@/lib/console-state";

/**
 * The rules behind the capability run panel (#800), kept out of the JSX so they
 * can be tested without a DOM — and so the panel stays generic. Nothing here
 * knows what git is.
 */

export interface CapabilityInput {
  key: string;
  /** date | token | string | enum | boolean-flag | git-rev — the server's declared type. */
  type: string;
  values: string[];
}

export interface CapabilityRunContract {
  invokable: boolean;
  /** Why it cannot be run, in words an operator can act on. */
  blockedReason: string | null;
  /**
   * A cwdPolicy:"invocation_root" command IS its repository — the server refuses
   * it without one (`invocation_root_requires_project`). The panel must therefore
   * ask for a project rather than let the run 409.
   */
  needsProject: boolean;
  requiresApproval: boolean;
  inputs: CapabilityInput[];
}

export function capabilityRunContract(capability: ApplicationCapability): CapabilityRunContract {
  const wrapper = capability.metadata?.wrapper;
  const needsProject = wrapper?.cwdPolicy === "invocation_root";
  const inputs = declaredInputs(capability);
  const blockedReason =
    capability.status === "disabled"
      ? "This capability is disabled while the application is offline or archived."
      : capability.invocationMode === "not_invokable"
        ? "This capability was discovered but has no approved wrapper — it cannot be invoked."
        : null;
  return {
    invokable: blockedReason === null,
    blockedReason,
    needsProject,
    requiresApproval: capability.requiresApproval === true,
    inputs,
  };
}

/** The declared inputs, from the capability's published schema — never guessed. */
function declaredInputs(capability: ApplicationCapability): CapabilityInput[] {
  const properties = (capability.inputSchema?.properties ?? {}) as Record<
    string,
    { type?: string; enum?: string[] }
  >;
  return Object.entries(properties).map(([key, schema]) => ({
    key,
    type: schema?.type ?? "string",
    values: Array.isArray(schema?.enum) ? schema.enum : [],
  }));
}

export interface RunFormState {
  projectId: string;
  values: Record<string, string>;
}

/**
 * Validate ONE input's value against its declared type, mirroring the server's
 * argInput validators. Returns an operator-facing error, or null when the value is
 * empty (optional) or valid. This is why it matters (#869, U5): the server SILENTLY
 * DROPS a declared value that fails its validator, so an invalid `author`/`since`/
 * `rev` used to run the command WITHOUT that filter and still return 200 — the
 * operator's intent quietly ignored. For `diff_ref` a dropped `rev` even collapses
 * `git diff --stat <rev>` into a different command. Catch it before submit instead.
 */
export function inputError(input: CapabilityInput, rawValue: string): string | null {
  const value = (rawValue ?? "").trim();
  if (!value) return null; // empty = omitted, not invalid
  if (value.startsWith("-")) return "Cannot start with “-”.";
  switch (input.type) {
    case "date":
      return /^\d{4}-\d{2}-\d{2}$/.test(value) ? null : "Use the date picker (YYYY-MM-DD).";
    case "token":
      return /^[A-Za-z0-9_+/:.][A-Za-z0-9_+/:.-]{0,63}$/.test(value) ? null : "Letters, digits, and _ + / : . - only (max 64).";
    case "count":
      return /^\d{1,4}$/.test(value) && Number(value) >= 1 && Number(value) <= 1000 ? null : "A whole number from 1 to 1000.";
    case "git-rev":
      return /^[A-Za-z0-9._/-]{1,100}$/.test(value) && !value.includes("..")
        ? null
        : "A branch, tag, or commit — no “..” ranges.";
    case "enum":
      return input.values.length === 0 || input.values.includes(value) ? null : `Choose one of: ${input.values.join(", ")}.`;
    case "string":
      return value.length <= 200 && !/[\r\n]/.test(value) ? null : "Keep it on one line, 200 characters or fewer.";
    default:
      return null; // an unknown/future type is validated server-side, not blocked here
  }
}

/** Per-field errors for the values currently entered (empty fields excluded). */
export function fieldErrors(contract: CapabilityRunContract, form: RunFormState): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const input of contract.inputs) {
    const error = inputError(input, form.values[input.key] ?? "");
    if (error) errors[input.key] = error;
  }
  return errors;
}

/**
 * Can this form be submitted? A missing project on an invocation-root capability
 * is blocked HERE rather than sent — the server would refuse it, and an error the
 * UI could have prevented is not an error worth showing an operator. An invalid
 * declared value is likewise blocked, not sent to be silently dropped (#869).
 */
export function runBlocker(contract: CapabilityRunContract, form: RunFormState): string | null {
  if (contract.blockedReason) return contract.blockedReason;
  if (contract.needsProject && !form.projectId) {
    return "Choose the repository this command runs in.";
  }
  if (Object.keys(fieldErrors(contract, form)).length > 0) {
    return "Fix the highlighted inputs before running.";
  }
  return null;
}

/**
 * The request body. Only DECLARED keys with a non-empty value are sent: an
 * undeclared field cannot be smuggled in through the form, and an empty one is
 * omitted rather than sent as "" (the server drops it anyway — but a request
 * should say what it means).
 */
export function buildInvokeBody(
  contract: CapabilityRunContract,
  form: RunFormState,
): Record<string, string> {
  const body: Record<string, string> = {};
  if (form.projectId) body.projectId = form.projectId;
  for (const input of contract.inputs) {
    const value = (form.values[input.key] ?? "").trim();
    if (value) body[input.key] = value;
  }
  return body;
}

/** A run refusal, rendered as something an operator can act on rather than a code. */
export function explainRunFailure(error: string): string {
  if (error.includes("invocation_root_requires_project")) {
    return "This command runs inside a repository, but no project was scoped to the run. Choose a project and try again.";
  }
  if (error.includes("approval_required")) {
    return "This capability needs an explicit approval before it can run.";
  }
  if (error.includes("binary_unavailable")) {
    return "The device that owns this project doesn't have the required program installed (e.g. git). Install it there, or route the run to a device that has it.";
  }
  if (error.includes("application_offline")) {
    return "The application is offline. Bring it back online to run its capabilities.";
  }
  if (error.includes("application_archived")) {
    return "The application is archived. It cannot run until it is restored.";
  }
  if (error.includes("agent_not_available")) {
    return "The platform wrapper runner is not available on this control plane.";
  }
  if (error.includes("capability_not_found")) {
    return "This capability is no longer projected by the application.";
  }
  return error;
}
