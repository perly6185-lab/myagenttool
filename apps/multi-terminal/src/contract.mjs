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
