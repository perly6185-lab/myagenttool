export const codexPermissionModes = ["ask", "auto", "full"];

export function normalizeCodexPermissionMode(value, fallback = "ask") {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (codexPermissionModes.includes(normalized)) return normalized;
  const normalizedFallback = String(fallback ?? "ask").trim().toLowerCase();
  return codexPermissionModes.includes(normalizedFallback) ? normalizedFallback : "ask";
}

export function codexPermissionModeFromLegacySandbox(value, fallback = "ask") {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "danger-full-access") return "full";
  if (normalized === "workspace-write" || normalized === "read-only") return "ask";
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
