export const codexPermissionModes = ["read_only", "ask", "auto", "full"] as const;

export type CodexPermissionMode = (typeof codexPermissionModes)[number];

export interface CodexPermissionProfile {
  mode: CodexPermissionMode;
  sandboxMode: "read-only" | "workspace-write" | "danger-full-access";
  approvalPolicy: "on-request" | "never";
  approvalsReviewer: "user" | "auto_review";
  bypassApprovalsAndSandbox: boolean;
}

export function normalizeCodexPermissionMode(
  value: unknown,
  fallback: CodexPermissionMode = "ask",
): CodexPermissionMode {
  const normalized = String(value ?? "").trim().toLowerCase();
  if ((codexPermissionModes as readonly string[]).includes(normalized)) {
    return normalized as CodexPermissionMode;
  }
  return (codexPermissionModes as readonly string[]).includes(fallback) ? fallback : "ask";
}

export function codexPermissionModeFromLegacySandbox(
  value: unknown,
  fallback: CodexPermissionMode = "ask",
): CodexPermissionMode {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "danger-full-access") return "full";
  if (normalized === "read-only") return "read_only";
  if (normalized === "workspace-write") return "ask";
  return normalizeCodexPermissionMode(value, fallback);
}

export function codexPermissionProfile(value: unknown): CodexPermissionProfile {
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
      // Strict read-only work cannot be widened by an approval prompt. Codex
      // may perform reads in the sandbox; attempted escalation is refused.
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

export function codexExecPermissionArgs(value: unknown): string[] {
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
