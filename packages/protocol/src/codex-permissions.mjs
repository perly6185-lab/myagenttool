export const codexPermissionModes = ["read_only", "ask", "auto", "full"];

export function normalizeCodexPermissionMode(value, fallback = "ask") {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (codexPermissionModes.includes(normalized)) return normalized;
  const normalizedFallback = String(fallback ?? "ask").trim().toLowerCase();
  return codexPermissionModes.includes(normalizedFallback) ? normalizedFallback : "ask";
}

export function codexPermissionModeFromLegacySandbox(value, fallback = "ask") {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "danger-full-access") return "full";
  if (normalized === "read-only") return "read_only";
  if (normalized === "workspace-write") return "ask";
  return normalizeCodexPermissionMode(value, fallback);
}

export function codexPermissionProfile(value) {
  const mode = normalizeCodexPermissionMode(value);
  if (mode === "full") {
    return {
      mode,
      sandboxMode: "danger-full-access",
      approvalPolicy: "never",
      approvalsReviewer: "user",
      bypassApprovalsAndSandbox: true,
    };
  }
  if (mode === "read_only") {
    return {
      mode,
      sandboxMode: "read-only",
      // A strict read-only run has no authority to cross the sandbox boundary.
      // Asking a person for escalation both stalls harmless reads and turns a
      // read-only contract into a latent write-authority prompt. Refuse any
      // attempted escalation in-process and let ordinary reads run unattended.
      approvalPolicy: "never",
      approvalsReviewer: "user",
      bypassApprovalsAndSandbox: false,
    };
  }
  return {
    mode,
    sandboxMode: "workspace-write",
    approvalPolicy: "on-request",
    approvalsReviewer: mode === "auto" ? "auto_review" : "user",
    bypassApprovalsAndSandbox: false,
  };
}

export function codexExecPermissionArgs(value) {
  const profile = codexPermissionProfile(value);
  if (profile.bypassApprovalsAndSandbox) {
    return ["--dangerously-bypass-approvals-and-sandbox"];
  }
  return [
    "--sandbox",
    profile.sandboxMode,
    "--config",
    `approval_policy="${profile.approvalPolicy}"`,
    "--config",
    `approvals_reviewer="${profile.approvalsReviewer}"`,
  ];
}
