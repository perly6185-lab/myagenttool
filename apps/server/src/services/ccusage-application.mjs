// Canonical ccusage Application spec (ADR 0007, #355 Phase 1).
//
// ccusage is an npm-sourced asset under management, not an autonomous agent. This
// registers it as an Application whose six reports are projected as governed
// npm-wrapper capabilities. This slice is descriptor-only and additive: the
// existing `ccusage.report` governed tool + agents stay authoritative and
// untouched. Backing the tool facade with these capabilities (and wiring real
// execution) is a later phase, gated on the application-capability execution
// runtime.

export const CCUSAGE_APPLICATION_ID = "app_ccusage";
export const CCUSAGE_DEFAULT_VERSION = "20.0.14";

// One wrapper command per report, mirroring the governed ccusage agents
// (daily/weekly/monthly/session/codex_daily/claude_daily). All read-only and
// offline by default — usage reports never write files or need network.
export const CCUSAGE_REPORT_WRAPPERS = [
  { id: "daily", displayName: "ccusage Daily Report", args: ["daily", "--json"] },
  { id: "weekly", displayName: "ccusage Weekly Report", args: ["weekly", "--json"] },
  { id: "monthly", displayName: "ccusage Monthly Report", args: ["monthly", "--json"] },
  { id: "session", displayName: "ccusage Session Report", args: ["session", "--json"] },
  { id: "codex_daily", displayName: "ccusage Codex Daily Report", args: ["codex", "daily", "--json"] },
  { id: "claude_daily", displayName: "ccusage Claude Daily Report", args: ["claude", "daily", "--json"] },
];

/**
 * Build a `registerApplication` body for the canonical ccusage application.
 * Registered (not auto-online) by default so it stays conservative — enabling is
 * an explicit lifecycle step, matching the rest of the registry.
 */
export function createCcusageApplicationRegistration({
  version = CCUSAGE_DEFAULT_VERSION,
  autoOnline = false,
} = {}) {
  return {
    id: CCUSAGE_APPLICATION_ID,
    name: "ccusage",
    autoOnline,
    source: {
      type: "npm",
      package: "ccusage",
      version,
      wrapper: {
        mode: "installed-wrapper",
        packageManager: "npm",
        commands: CCUSAGE_REPORT_WRAPPERS.map((report) => ({
          id: report.id,
          displayName: report.displayName,
          description: `Governed ccusage ${report.id} usage report (read-only, JSON).`,
          commandType: "bin",
          command: "ccusage",
          // Base args run the report offline (the ccusage tool only supports
          // offline mode). Optional date/timezone filters are declared, validated
          // argInputs — matching the tool's since/until/timezone parameters.
          args: [...report.args, "--offline"],
          status: "approved",
          riskLevel: "low",
          riskTags: ["usage-report", "read-only"],
          // Read-only offline reports need no approval token — parity with the
          // ccusage tool's always-allowed offline reports. The one exception is
          // the `session` report, which the tool classifies approval-required
          // (CCUSAGE_APPROVAL_REQUIRED_REPORTS); it must keep that gate on the
          // capability path too, so it is NOT invokable without an approvalToken.
          requiresApproval: report.id === "session",
          filePolicy: "read_only",
          networkPolicy: "forbidden",
          compatibilityFacade: {
            type: "tool",
            name: "ccusage.report",
            invocationMode: "tool-facade",
          },
          outputCollection: "importedUsageEstimates",
          billing: {
            authoritative: false,
            externalBilled: true,
            amountSource: "imported_ccusage_report",
          },
          resultImport: {
            source: "ccusage",
            kind: "usage_estimates",
            amountSource: "imported_ccusage_report",
          },
          argInputs: [
            { key: "since", flag: "--since", type: "date" },
            { key: "until", flag: "--until", type: "date" },
            { key: "timezone", flag: "--timezone", type: "token" },
          ],
        })),
      },
    },
  };
}
