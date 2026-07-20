// Canonical OfficeCLI Application (P1, read-only slice). Mirrors git-application.mjs.
//
// OfficeCLI (https://github.com/iOfficeAI/OfficeCLI) is an AI-friendly CLI that
// reads and edits Word/Excel/PowerPoint files (.docx/.xlsx/.pptx). It is an
// npm-installed system binary (`npm install -g @officecli/officecli`) that, from
// the device's perspective, is just a binary on PATH — so it registers from a
// `binary` source (#774 pattern), exactly like the managed git Application.
//
// SCOPE: this slice projects a READ-ONLY capability set only — the OfficeCLI verbs
// that read a document and print to stdout (get/query/view/validate/dump). It is
// deliberately read-only because the platform Application Wrapper Runner is
// `read_only` by construction (apps/desktop local-execution-policy `policies.
// wrapper.file: ["read_only"]`). Write verbs (create/set/add/batch/import/merge)
// open local file writes and need a governed write path (a new device policy kind
// or an approval-gated MCP capability) — a separate, security-reviewed slice.
//
// Every command's argv comes from a fixed base plus declared, typed argInputs:
//   - `file` / `path` / `selector` are POSITIONAL string inputs (#777) — the
//     OpenXML path and CSS-like selector are values, never flags.
//   - `mode` is an enum positional constrained to the stdout view modes.
// The device (local-execution-policy.mjs) keeps its OWN independent copy of this
// argv spec; the two allowlists together are what keep "all argv comes from an
// allowlist" intact.

export const OFFICECLI_APPLICATION_ID = "app_officecli";
export const OFFICECLI_DEFAULT_VERSION = "1.0.139";

// The stdout view modes. `html` renders a self-contained document preview to
// stdout (per `officecli view --out`: "defaults to stdout for html") and is
// read-only — nothing is written to disk. `svg`/`screenshot` instead write a temp
// file (svg emits nothing to stdout; screenshot prints a PATH), so they are NOT
// stdout-safe and stay out of this read-only wrapper. NOTE: the wrapper result
// path caps stdout at 20 000 chars (application-results RUNNER_TEXT_CAP), so a
// large document's `html` is truncated here — a full-fidelity preview pane needs
// a dedicated artifact route, not this capability's applicationResults body.
export const OFFICECLI_VIEW_MODES = ["text", "annotated", "outline", "stats", "issues", "forms", "html"];

// One wrapper command per read verb. All read-only, offline, low risk — the real
// authorization boundary is owner-scoped tenancy plus the project the invocation
// is already scoped to (cwdPolicy: invocation_root).
const OFFICECLI_WRAPPER_COMMANDS = [
  {
    id: "get",
    displayName: "OfficeCLI get",
    description: "Read a document node by OpenXML path as JSON (defaults to the document root).",
    args: ["get", "--json"],
    argInputs: [
      { key: "file", positional: true, type: "string" },
      { key: "path", positional: true, type: "string" },
    ],
  },
  {
    id: "query",
    displayName: "OfficeCLI query",
    description: "Query document elements with a CSS-like selector, as JSON.",
    args: ["query", "--json"],
    argInputs: [
      { key: "file", positional: true, type: "string" },
      { key: "selector", positional: true, type: "string" },
    ],
  },
  {
    id: "view",
    displayName: "OfficeCLI view",
    description: "Render a document to a stdout view (text/annotated/outline/stats/issues/forms).",
    args: ["view"],
    argInputs: [
      { key: "file", positional: true, type: "string" },
      { key: "mode", positional: true, type: "enum", values: OFFICECLI_VIEW_MODES },
    ],
  },
  {
    id: "validate",
    displayName: "OfficeCLI validate",
    description: "Validate a document against the OpenXML schema, as JSON.",
    args: ["validate", "--json"],
    argInputs: [{ key: "file", positional: true, type: "string" }],
  },
  {
    id: "dump",
    displayName: "OfficeCLI dump",
    description: "Serialize a document subtree into a replayable batch script (read-only round-trip).",
    args: ["dump"],
    argInputs: [
      { key: "file", positional: true, type: "string" },
      { key: "path", positional: true, type: "string" },
    ],
  },
];

// P3.1 (write / "operate", #1349): the first governed WRITE verb. `remove` deletes
// an element by path — its argv is two positionals (file, path), the same trivial
// shape as `get`, which is why it is the proving verb for the write-policy path
// before the `--prop`/JSON verbs (set/add/batch). A write command opts into the
// `apply` capability segment so the device classifies it under the `officecliApply`
// WRITE policy (workspace_write) instead of the read-only wrapper bucket, and it
// requires an approval token. `officecli` writes in place, so a write MUST run in
// the invocation's worktree (cwdPolicy: invocation_root) to stay reviewable before
// promotion — never against the project clone directly.
const OFFICECLI_WRITE_COMMANDS = [
  {
    id: "remove",
    displayName: "OfficeCLI remove",
    description: "Remove an element from a document by OpenXML path. Writes in place — runs in the invocation's worktree so the change is reviewable before promotion.",
    args: ["remove"],
    argInputs: [
      { key: "file", positional: true, type: "string" },
      { key: "path", positional: true, type: "string" },
    ],
  },
  {
    id: "set",
    displayName: "OfficeCLI set",
    description: "Set properties on an element by path — a cell value/formula, run text, or formatting (props are `--prop key=value`). Writes in place; runs in the invocation's worktree.",
    args: ["set"],
    // `officecli set <file> <path> --prop k=v` requires the subject positionals
    // BEFORE the options — the CLI ignores a --prop that precedes the file/path.
    argOrder: "positionals_first",
    argInputs: [
      { key: "file", positional: true, type: "string" },
      { key: "path", positional: true, type: "string" },
      // A repeatable `--prop key=value` map (value/formula/bold/font.size/...).
      { key: "props", flag: "--prop", type: "props" },
    ],
  },
];

function readCommand(command) {
  return {
    id: command.id,
    displayName: command.displayName,
    description: command.description,
    commandType: "bin",
    command: "officecli",
    args: command.args,
    argInputs: command.argInputs ?? [],
    status: "approved",
    // Explicit — the `bin` default is `high`. Read-only offline document reads are
    // low risk; nothing is written and no network is touched.
    riskLevel: "low",
    riskTags: ["office-document", "read-only"],
    requiresApproval: false,
    filePolicy: "read_only",
    networkPolicy: "forbidden",
    // Resolve cwd to the invocation's project/worktree so a relative file path
    // (e.g. "deck.pptx") resolves inside the scoped repository (#773).
    cwdPolicy: "invocation_root",
    // The runner's non-JSON fallback stores { text } (capped at 20 000 chars).
    outputCollection: "applicationResults",
    resultImport: { source: "officecli", kind: "document_read" },
  };
}

function writeCommand(command) {
  return {
    id: command.id,
    displayName: command.displayName,
    description: command.description,
    commandType: "bin",
    command: "officecli",
    args: command.args,
    argInputs: command.argInputs ?? [],
    ...(command.argOrder ? { argOrder: command.argOrder } : {}),
    status: "approved",
    // `segment: "apply"` routes this under the device's officecliApply WRITE policy
    // (workspace_write) — never the read-only wrapper bucket git/ccusage/claude share.
    segment: "apply",
    riskLevel: "medium",
    riskTags: ["office-document", "write"],
    // A write is only allowed with an explicit approval token.
    requiresApproval: true,
    filePolicy: "workspace_write",
    networkPolicy: "forbidden",
    // A write is defined by the worktree it runs in; invocation_root confines it
    // there (the server refuses an unrooted invocation_root command).
    cwdPolicy: "invocation_root",
    outputCollection: "applicationResults",
    resultImport: { source: "officecli", kind: "document_write" },
  };
}

/**
 * Build a `registerApplication` body for the canonical OfficeCLI application.
 * Registered (not auto-online) by default — enabling is an explicit lifecycle
 * step, matching the rest of the registry. Nothing auto-registers at boot.
 */
export function createOfficecliApplicationRegistration({ autoOnline = false } = {}) {
  return {
    id: OFFICECLI_APPLICATION_ID,
    name: "OfficeCLI",
    autoOnline,
    source: {
      type: "binary",
      binary: "officecli",
      wrapper: {
        mode: "installed-wrapper",
        commands: [
          ...OFFICECLI_WRAPPER_COMMANDS.map(readCommand),
          ...OFFICECLI_WRITE_COMMANDS.map(writeCommand),
        ],
      },
    },
  };
}
