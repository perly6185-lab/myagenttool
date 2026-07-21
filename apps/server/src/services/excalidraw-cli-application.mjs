// Canonical Excalidraw CLI Application (#1356, PR2 — the governed export slice).
// Mirrors officecli-application.mjs's WRITE path.
//
// The excalidraw-cli runtime (@tommywalkie/excalidraw-cli, bin `excalidraw-cli`)
// is an OFFLINE oclif CLI that renders an Excalidraw scene file (`*.excalidraw`)
// to a PNG. From the device's perspective it is just a binary on PATH, so it
// registers from a `binary` source (#774 pattern), exactly like the managed git /
// officecli Applications. Its readiness/install scaffolding shipped in PR1.
//
// SCOPE: this slice projects a single governed WRITE verb, `export`. The CLI
// writes the PNG to disk (there is no offline stdout-export excalidraw CLI), so it
// is a workspace_write action, NOT a read — it opts into the `apply` capability
// segment so the device classifies it under the excalidrawCliApply WRITE policy
// (workspace_write) instead of the read-only wrapper bucket, and it requires an
// approval token. The render writes in place, so it MUST run in the invocation's
// worktree (cwdPolicy: invocation_root) to stay reviewable before promotion.
//
// The argv is a fixed base plus two declared, typed positionals — the input scene
// file and the output PNG, each a worktree-safe relative path (no traversal, not
// absolute) with its required extension. The device (local-execution-policy.mjs)
// keeps its OWN independent copy of this argv spec; the two allowlists together
// are what keep "all argv comes from an allowlist" intact.

export const EXCALIDRAW_CLI_APPLICATION_ID = "app_excalidraw_cli";

// One governed WRITE verb. `excalidraw-cli <input.excalidraw> <output.png>` renders
// a scene file to a PNG in the invocation's worktree. Both positionals are values,
// never flags — a value with a leading "-" never validates as a positional.
const EXCALIDRAW_CLI_WRITE_COMMANDS = [
  {
    id: "export",
    displayName: "Excalidraw export",
    description: "Render an Excalidraw scene file (.excalidraw) to a PNG. Both paths stay inside the invocation's worktree; writes the image in place so the change is reviewable before promotion.",
    args: [],
    argInputs: [
      { key: "input", positional: true, type: "excalidraw_file" },
      { key: "output", positional: true, type: "png_file" },
    ],
  },
];

function writeCommand(command) {
  return {
    id: command.id,
    displayName: command.displayName,
    description: command.description,
    commandType: "bin",
    command: "excalidraw-cli",
    args: command.args,
    argInputs: command.argInputs ?? [],
    status: "approved",
    // `segment: "apply"` routes this under the device's excalidrawCliApply WRITE
    // policy (workspace_write) — never the read-only wrapper bucket.
    segment: "apply",
    riskLevel: "medium",
    riskTags: ["excalidraw", "diagram", "write"],
    // A write is only allowed with an explicit approval token.
    requiresApproval: true,
    filePolicy: "workspace_write",
    networkPolicy: "forbidden",
    // A write is defined by the worktree it runs in; invocation_root confines it
    // there (the server refuses an unrooted invocation_root command).
    cwdPolicy: "invocation_root",
    outputCollection: "applicationResults",
    resultImport: { source: "excalidraw-cli", kind: "diagram_export" },
  };
}

/**
 * Build a `registerApplication` body for the canonical Excalidraw CLI application.
 * Registered (not auto-online) by default — enabling is an explicit lifecycle
 * step, matching the rest of the registry. Nothing auto-registers at boot.
 */
export function createExcalidrawCliApplicationRegistration({ autoOnline = false } = {}) {
  return {
    id: EXCALIDRAW_CLI_APPLICATION_ID,
    name: "Excalidraw CLI",
    autoOnline,
    source: {
      type: "binary",
      binary: "excalidraw-cli",
      wrapper: {
        mode: "installed-wrapper",
        commands: EXCALIDRAW_CLI_WRITE_COMMANDS.map(writeCommand),
      },
    },
  };
}
