const TERMINAL_ID = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;
const RESOURCE_ID = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,255}$/;

export const FORBIDDEN_PATHS = [
  "/api/bridge",
  "/api/settings",
  "/api/credentials",
  "/api/files",
  "/api/filesystem",
];

export const ALLOWED_ACTIONS = new Set(["cancel", "retry", "replay", "maintenance"]);

export function resourceRef(terminalId, localResourceId) {
  if (!TERMINAL_ID.test(terminalId ?? "") || !RESOURCE_ID.test(localResourceId ?? "")) {
    throw new Error("invalid terminal resource reference");
  }
  return `${terminalId}:${localResourceId}`;
}

export function assertPublicTerminalPath(pathname) {
  if (FORBIDDEN_PATHS.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))) {
    throw new Error("terminal-private endpoint is not available to the composition service");
  }
  return pathname;
}

export function assertNoSchedulingOverride(body) {
  for (const field of ["targetTerminalId", "deviceId", "terminalId", "failover", "migrate", "capacityPool"]) {
    if (body && Object.prototype.hasOwnProperty.call(body, field)) {
      throw new Error(`unsupported scheduling field: ${field}`);
    }
  }
}

export function ownerOperation({ resourceType, localResourceId, action, body = {} }) {
  assertNoSchedulingOverride(body);
  resourceRef("owner", localResourceId);
  if (action === "cancel" && resourceType === "invocations") {
    return { method: "POST", path: `/api/invocations/${encodeURIComponent(localResourceId)}/cancel`, body: {} };
  }
  if (action === "retry" && resourceType === "application-runs") {
    const applicationId = String(body.applicationId ?? "");
    const routineId = String(body.routineId ?? "");
    resourceRef("owner", applicationId);
    resourceRef("owner", routineId);
    return {
      method: "POST",
      path: `/api/applications/${encodeURIComponent(applicationId)}/orchestrations/${encodeURIComponent(routineId)}/runs/${encodeURIComponent(localResourceId)}/recovery/actions`,
      body: { actionType: "retry", reason: String(body.reason ?? "Retry requested from the multi-terminal console.").slice(0, 500) },
    };
  }
  if (action === "replay" && resourceType === "deliveries") {
    const provider = String(body.provider ?? "");
    if (!["github", "gitlab", "gitea"].includes(provider)) throw new Error("unsupported delivery provider");
    const prefix = provider === "github" ? "github" : provider;
    return { method: "POST", path: `/api/work-items/${prefix}/deliveries/${encodeURIComponent(localResourceId)}/replay`, body: {} };
  }
  if (action === "maintenance" && resourceType === "applications") {
    return { method: "POST", path: `/api/applications/${encodeURIComponent(localResourceId)}/refresh`, body: {} };
  }
  throw new Error(`unsupported owner operation: ${resourceType}.${action}`);
}
