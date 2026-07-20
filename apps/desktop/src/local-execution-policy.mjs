import { existsSync } from "node:fs";
import { delimiter, extname, isAbsolute, join, resolve, sep } from "node:path";

// Per-device binary availability (#802). git is a per-device property; a wrapper
// command whose binary PATH cannot resolve would spawn-fail with an opaque exit
// 127. Resolve it the way spawn() would — a bare name against PATH, a path checked
// directly — so the gate can refuse with a precise reason INSTEAD of that opaque
// failure. Injected into the gate so tests can simulate a device without git.
export function binaryAvailableOnPath(command, env = process.env) {
  if (!command || typeof command !== "string") return false;
  if (command.includes("/") || command.includes(sep) || isAbsolute(command)) return existsSync(command);
  const dirs = String(env.PATH ?? "").split(delimiter).filter(Boolean);
  const names = process.platform === "win32" && !extname(command)
    ? String(env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean).map((extension) => `${command}${extension}`)
    : [command];
  return dirs.some((dir) => names.some((name) => existsSync(join(dir, name))));
}

const FILE_POLICIES = new Set(["forbidden", "read_only", "workspace_write", "native_controls"]);
const NETWORK_POLICIES = new Set(["forbidden", "restricted", "network", "native_controls"]);
const CCUSAGE_WRAPPER_ARGS = {
  daily: ["daily", "--json", "--offline"],
  weekly: ["weekly", "--json", "--offline"],
  monthly: ["monthly", "--json", "--offline"],
  session: ["session", "--json", "--offline"],
  codex_daily: ["codex", "daily", "--json", "--offline"],
  claude_daily: ["claude", "daily", "--json", "--offline"],
};

// The bridge's OWN copy of the git wrapper argv spec (#775). Deliberately
// duplicated from the server spec (apps/server .../git-application.mjs) — two
// independent allowlists, so a buggy or compromised server still cannot make a
// device spawn something new. Do NOT factor into a shared constant.
//
// Validators mirror the server's argInput types independently, and are STRICTER
// where it costs nothing (max-count numeric 1–1000). A value with a leading "-"
// never validates, so flag-shaped injections (--upload-pack=, --exec-path=) in a
// value slot are refused; unlisted flags (-c, --exec-path) in a flag slot have no
// validator and are refused.
const isIsoDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(value);
const isGitToken = (value) => /^[A-Za-z0-9_+/:.][A-Za-z0-9_+/:.-]{0,63}$/.test(value);
const isMaxCount = (value) => /^\d{1,4}$/.test(value) && Number(value) >= 1 && Number(value) <= 1000;
// A git revision as a positional arg (#777). Mirrors the server's `git-rev`
// validator INDEPENDENTLY — closed char class, no leading "-", no "..".
const isGitRev = (value) => /^[A-Za-z0-9._/-]{1,100}$/.test(value) && !value.includes("..");

// The bridge's OWN copy of the OfficeCLI read-only argv spec (P1). Deliberately
// duplicated from the server spec (apps/server .../officecli-application.mjs) —
// two independent allowlists, so a buggy or compromised server still cannot make
// a device spawn something new. Do NOT factor into a shared constant.
//
// Every command is READ-ONLY (stdout view / JSON read). Positionals are ordered
// and heterogeneous (file, then path/selector/mode), so unlike the git spec each
// command declares an ORDERED list of positional validators — position N is
// checked by positionals[N]. A value with a leading "-" never validates as a
// positional (it is treated as a flag, and no flags are declared), so a
// flag-shaped injection in a value slot is refused.
//
// STRICTER than the server where it costs nothing: `file` must end in a known
// Office extension, and `mode` must be one of the stdout view modes.
const isOfficeArg = (value) => value.length >= 1 && value.length <= 200 && !/[\r\n]/.test(value);
// A document FILE positional is a filesystem path officecli resolves against its
// cwd (the worktree). Confining the cwd is NOT enough — a `../` or absolute path
// in this positional escapes the worktree and reads/writes an arbitrary file
// (confirmed: `officecli set ../x.xlsx …` wrote outside the worktree). So a file
// must be a SAFE RELATIVE path: no traversal segment, not absolute (no leading
// `/`, `~`, `\`, or a Windows drive), plus a known Office extension. Document DOM
// paths (isOfficeArg, e.g. `/Sheet1/A1`) are NOT files and keep their leading `/`.
const isSafeRelPath = (value) =>
  value.length >= 1
  && value.length <= 200
  && !/[\r\n\0]/.test(value)
  && !value.startsWith("/")
  && !value.startsWith("~")
  && !value.startsWith("\\")
  && !/^[A-Za-z]:/.test(value)
  && !value.split(/[/\\]/).includes("..");
const isOfficeFile = (value) => isSafeRelPath(value) && /\.(docx|xlsx|pptx)$/i.test(value);
// A CSV/TSV source file (officecli import) — same worktree-safe rule, data ext.
const isOfficeCsvFile = (value) => isSafeRelPath(value) && /\.(csv|tsv)$/i.test(value);
// Inline merge --data: a JSON object/array within a byte bound. Independent mirror
// of the server's normalizeJsonData. One discrete argv token (no shell).
const isOfficeJsonData = (value) => {
  if (typeof value !== "string" || value.length > 16 * 1024) return false;
  let parsed;
  try { parsed = JSON.parse(value); } catch { return false; }
  return parsed !== null && typeof parsed === "object";
};
// `html` renders a self-contained preview to stdout (read-only); svg/screenshot
// write temp files and stay out of the read-only wrapper. Mirror the server enum.
const OFFICE_VIEW_MODES = new Set(["text", "annotated", "outline", "stats", "issues", "forms", "html"]);
const isOfficeViewMode = (value) => OFFICE_VIEW_MODES.has(value);

const OFFICECLI_WRAPPER_ARGS = {
  get: { base: ["get", "--json"], flags: {}, positionals: [isOfficeFile, isOfficeArg] },
  query: { base: ["query", "--json"], flags: {}, positionals: [isOfficeFile, isOfficeArg] },
  view: { base: ["view"], flags: {}, positionals: [isOfficeFile, isOfficeViewMode] },
  validate: { base: ["validate", "--json"], flags: {}, positionals: [isOfficeFile] },
  dump: { base: ["dump"], flags: {}, positionals: [isOfficeFile, isOfficeArg] },
};

// The bridge's OWN copy of the OfficeCLI WRITE argv spec (P3.1, #1349). Same
// two-allowlist duplication rule as the read spec above. These run under the
// `officecliApply` write policy (workspace_write), NOT the read-only wrapper
// bucket — see classifySpawn + policies.officecliApply. `remove` is the first
// write verb; its argv is two positionals (file, path), identical in shape to the
// read `get`, which is exactly why it proves the write path with no new argv
// modeling. A value with a leading "-" never validates as a positional.
// A `--prop key=value` pair: an identifier key, then `=`, then a bounded value
// that may itself contain `=` (formulas/text) but no control chars. Independent
// mirror of the server's props validator. A leading "-" can't match (key must
// start with a letter), so a prop pair can never smuggle a new flag.
const isOfficePropPair = (value) => /^[a-zA-Z][a-zA-Z0-9._-]{0,39}=[^\r\n]{0,200}$/.test(value);

// The closed set of element kinds `add --type` accepts. Independent mirror of the
// server's OFFICECLI_ELEMENT_TYPES — an unknown --type value is refused here too.
const OFFICE_ELEMENT_TYPES = new Set([
  "paragraph", "run", "table", "sheet", "row", "column", "cell",
  "slide", "shape", "picture", "diagram", "flowchart", "ole", "video",
]);
const isOfficeElementType = (value) => OFFICE_ELEMENT_TYPES.has(value);

// A `batch --commands` JSON value. Independent mirror of the server's
// normalizeJsonCommands: it must parse to an array of ≤100 objects, each with a
// `command` in the write-verb allowlist, within a byte bound. A read/low-level
// verb, a non-array, or an oversized payload is refused.
const OFFICE_BATCH_VERBS = new Set(["add", "set", "remove", "move", "swap"]);
const isOfficeBatchCommands = (value) => {
  if (typeof value !== "string" || value.length > 16 * 1024) return false;
  let list;
  try { list = JSON.parse(value); } catch { return false; }
  if (!Array.isArray(list) || list.length === 0 || list.length > 100) return false;
  return list.every((item) =>
    item && typeof item === "object" && !Array.isArray(item) && OFFICE_BATCH_VERBS.has(String(item.command)));
};

const OFFICECLI_APPLY_WRAPPER_ARGS = {
  remove: { base: ["remove"], flags: {}, positionals: [isOfficeFile, isOfficeArg] },
  // set <file> <path> --prop key=value ... — repeatable --prop (each value is a
  // key=value pair). The matcher handles repeated flags + ordered positionals.
  set: { base: ["set"], flags: { "--prop": isOfficePropPair }, positionals: [isOfficeFile, isOfficeArg] },
  // add <file> <parent> --type <kind> --prop key=value ... — a closed --type enum
  // plus repeatable --prop pairs, positionals (file, parent) first.
  add: { base: ["add"], flags: { "--type": isOfficeElementType, "--prop": isOfficePropPair }, positionals: [isOfficeFile, isOfficeArg] },
  // batch <file> --commands <json> — one JSON operation list, verb-allowlisted.
  batch: { base: ["batch"], flags: { "--commands": isOfficeBatchCommands }, positionals: [isOfficeFile] },
  // swap <file> <path1> <path2> — three positionals, no options.
  swap: { base: ["swap"], flags: {}, positionals: [isOfficeFile, isOfficeArg, isOfficeArg] },
  // move <file> <path> [--to|--after|--before <target-path>] — positionals + path flags.
  move: { base: ["move"], flags: { "--to": isOfficeArg, "--after": isOfficeArg, "--before": isOfficeArg }, positionals: [isOfficeFile, isOfficeArg] },
  // import <file> <sheet> <source.csv> [--header] [--format csv|tsv] — three
  // positionals (target xlsx, sheet DOM path, worktree-safe CSV source) plus a
  // valueless --header (flag=true) and a csv/tsv --format enum.
  import: {
    base: ["import"],
    flags: { "--header": true, "--format": (v) => v === "csv" || v === "tsv" },
    positionals: [isOfficeFile, isOfficeArg, isOfficeCsvFile],
  },
  // merge <template> <output> --data <json> [--force] — two worktree-safe office
  // files (template in, output out) + inline JSON data + a valueless --force.
  merge: {
    base: ["merge"],
    flags: { "--data": isOfficeJsonData, "--force": true },
    positionals: [isOfficeFile, isOfficeFile],
  },
};

const GIT_WRAPPER_ARGS = {
  status: { base: ["--no-pager", "status", "--porcelain=v2", "--branch"], flags: {} },
  log: {
    // `-z` NUL-separates records; a commit message cannot contain NUL, so it
    // cannot forge a record boundary (#864). Keep byte-identical to the server's
    // registered argv (git-application.mjs) — a mismatch here is refused.
    base: ["--no-pager", "log", "-z", "--format=%H%x1f%an%x1f%aI%x1f%s", "--max-count=50"],
    flags: { "--since": isIsoDate, "--until": isIsoDate, "--author": isGitToken, "--max-count": isMaxCount },
  },
  diff_stat: { base: ["--no-pager", "diff", "--stat", "--no-color"], flags: {} },
  // ref-filter spells a hex byte `%1f`; `log --format` spells it `%x1f`. Keep this
  // base byte-identical to the server's registered argv (#801) — a mismatch here
  // is refused, which is the two-allowlist design working, not a bug to paper over.
  branch_list: { base: ["--no-pager", "branch", "--list", "--format=%(refname:short)%1f%(objectname)"], flags: {} },
  head: { base: ["--no-pager", "rev-parse", "HEAD"], flags: {} },
  show: { base: ["--no-pager", "show", "--stat", "--no-color"], flags: {}, positional: isGitRev, maxPositionals: 1 },
  diff_ref: { base: ["--no-pager", "diff", "--stat", "--no-color"], flags: {}, positional: isGitRev, maxPositionals: 1 },
};

export function createLocalExecutionPolicyManifest({
  demoAgentPath,
  codexFixtureAgentPath,
  execPath = process.execPath,
} = {}) {
  return {
    version: 1,
    execPath,
    demoAgentPath,
    codexFixtureAgentPath,
    nodeWrappers: [
      "tools/agents/application-wrapper.mjs",
      "tools/agents/codex-review-wrapper.mjs",
      "tools/agents/claude-review-wrapper.mjs",
    ],
    // The write-capable exec wrapper is kept OUT of the read-only nodeWrappers
    // list and classified as its own `codexExec` kind, so a writer is never
    // mislabeled read_only. File writes are delegated to Codex's native sandbox
    // (native_controls), exactly as for the codex CLI path.
    codexExecWrappers: [
      "tools/agents/codex-exec-wrapper.mjs",
    ],
    // The Claude apply runner (Phase 4b) WRITES via `git apply`, so it is its own
    // `claudeApply` kind — workspace_write, no network — never read_only. It runs
    // only for a server-authorized, approval-bound patch.
    claudeApplyWrappers: [
      "tools/agents/claude-apply-wrapper.mjs",
    ],
    applicationWrapperCommands: [
      {
        command: "ccusage",
        capabilityPrefix: "app.app_ccusage.wrapper.",
        filePolicy: "read_only",
        networkPolicy: "forbidden",
      },
      {
        command: "git",
        capabilityPrefix: "app.app_git.wrapper.",
        filePolicy: "read_only",
        networkPolicy: "forbidden",
      },
      {
        command: "git-bash",
        capabilityPrefix: "app.setup.git_bash.",
        filePolicy: "read_only",
        networkPolicy: "forbidden",
        probe: {
          executable: "C:\\Program Files\\Git\\bin\\bash.exe",
          args: ["--version"],
          candidates: [
            { executable: "C:\\Program Files\\Git\\bin\\bash.exe", args: ["--version"] },
            { executable: "C:\\Program Files (x86)\\Git\\bin\\bash.exe", args: ["--version"] },
            { executable: "git", args: ["--version"] },
          ],
        },
      },
      {
        command: "wsl",
        capabilityPrefix: "app.setup.wsl.",
        filePolicy: "read_only",
        networkPolicy: "forbidden",
        probe: { executable: "wsl.exe", args: ["--status"] },
      },
      {
        command: "claude",
        capabilityPrefix: "app.app_claude.",
        filePolicy: "read_only",
        networkPolicy: "forbidden",
        authenticationProbe: { executable: "claude", args: ["auth", "status"], format: "claude-json" },
      },
      {
        command: "codex",
        capabilityPrefix: "app.setup.codex.",
        filePolicy: "read_only",
        networkPolicy: "forbidden",
        authenticationProbe: { executable: "codex", args: ["login", "status"], format: "exit-code" },
      },
      {
        command: "officecli",
        capabilityPrefix: "app.app_officecli.wrapper.",
        filePolicy: "read_only",
        networkPolicy: "forbidden",
      },
      {
        // OfficeCLI WRITE verbs (P3.1). A distinct capability prefix + filePolicy
        // from the read entry above, so a read command can never resolve to a
        // write policy and vice versa. Gated by the officecliApply policy bucket.
        command: "officecli",
        capabilityPrefix: "app.app_officecli.apply.",
        filePolicy: "workspace_write",
        networkPolicy: "forbidden",
      },
    ],
    policies: {
      demoAgent: { file: ["read_only"], network: ["forbidden"] },
      codex: { file: ["native_controls", "workspace_write", "read_only"], network: ["native_controls", "restricted", "network"] },
      claude: { file: ["native_controls", "workspace_write", "read_only"], network: ["native_controls", "restricted", "network"] },
      wrapper: { file: ["read_only"], network: ["forbidden"] },
      // codex.exec: writes are permitted but governed by Codex's native sandbox;
      // network stays no-broader than restricted (never open `network`).
      codexExec: { file: ["native_controls", "workspace_write", "read_only"], network: ["native_controls", "restricted", "forbidden"] },
      // claude.apply: the runner writes to the worktree with git apply and needs no
      // network. workspace_write only; never native_controls (there is no sandbox).
      claudeApply: { file: ["workspace_write", "read_only"], network: ["forbidden"] },
      // officecli.apply (P3.1): OfficeCLI write verbs edit a document IN PLACE in the
      // invocation's worktree. workspace_write, never network; no sandbox, so never
      // native_controls. Its own bucket keeps the read-only `wrapper` bucket — which
      // ccusage/git/claude/read-officecli share — from ever widening to writes.
      officecliApply: { file: ["workspace_write", "read_only"], network: ["forbidden"] },
    },
  };
}

export function localPolicyForAdapter(adapter, payload = {}) {
  const metadata = payload.options?.metadata && typeof payload.options.metadata === "object" && !Array.isArray(payload.options.metadata)
    ? payload.options.metadata
    : {};
  const wrapper = metadata.applicationWrapper && typeof metadata.applicationWrapper === "object" && !Array.isArray(metadata.applicationWrapper)
    ? metadata.applicationWrapper
    : null;
  if (wrapper) {
    return {
      filePolicy: normalizePolicy(wrapper.filePolicy, "read_only"),
      networkPolicy: normalizePolicy(wrapper.networkPolicy, "forbidden"),
      source: "application_wrapper",
    };
  }
  if (isCodexCliCommand(adapter?.command) || isClaudeCliCommand(adapter?.command)) {
    return {
      filePolicy: normalizePolicy(adapter?.filePolicy, "native_controls"),
      networkPolicy: normalizePolicy(adapter?.networkPolicy, "native_controls"),
      source: "coding_cli_native_controls",
    };
  }
  // The governed exec wrapper spawns Codex, which owns file/sandbox controls, so
  // it delegates to native_controls just like the codex CLI — not the read_only
  // default that a generic node wrapper would get.
  if (usesCodexExecWrapper(adapter)) {
    return {
      filePolicy: normalizePolicy(adapter?.filePolicy, "native_controls"),
      networkPolicy: normalizePolicy(adapter?.networkPolicy, "restricted"),
      source: "codex_exec_wrapper_native_controls",
    };
  }
  // The Claude apply runner writes with git apply (no sandbox), so it is
  // workspace_write with no network — not the read_only default.
  if (usesClaudeApplyWrapper(adapter)) {
    return {
      filePolicy: normalizePolicy(adapter?.filePolicy, "workspace_write"),
      networkPolicy: normalizePolicy(adapter?.networkPolicy, "forbidden"),
      source: "claude_apply_wrapper",
    };
  }
  return {
    filePolicy: normalizePolicy(adapter?.filePolicy, "read_only"),
    networkPolicy: normalizePolicy(adapter?.networkPolicy, "forbidden"),
    source: "adapter_default",
  };
}

export function localExecutionGate(work, adapter, spawnPlan, { permissionDecision, permissionHook, manifest, resolveBinary = binaryAvailableOnPath } = {}) {
  const localPolicy = spawnPlan?.localPolicy ?? localPolicyForAdapter(adapter, work);
  const commandKind = classifySpawn(adapter, spawnPlan, manifest);
  const approvedRoots = collectApprovedRoots(work);
  const evidence = {
    adapterType: adapter?.type ?? "unknown",
    adapterCommand: adapter?.command ?? null,
    command: spawnPlan?.command ?? null,
    cwd: spawnPlan?.cwd ?? null,
    approvedRoots,
    commandKind,
    filePolicy: localPolicy.filePolicy,
    networkPolicy: localPolicy.networkPolicy,
    policySource: localPolicy.source,
    approvalBrokerRequestId: permissionHook?.brokerRequest?.id ?? null,
    permissionDecision: permissionDecision ?? "not_required",
    manifestVersion: manifest?.version ?? null,
  };
  if (adapter?.type !== "cli") {
    return refused(`Local execution gate refused adapter type ${adapter?.type ?? "unknown"}.`, evidence, "agent_unavailable");
  }
  if (!spawnPlan?.command || !Array.isArray(spawnPlan.args)) {
    return refused("Local execution gate refused an incomplete spawn plan.", evidence, "validation_failed");
  }
  if (!spawnPlan.cwd || !isAbsolute(spawnPlan.cwd) || !existsSync(spawnPlan.cwd)) {
    return refused("Local execution gate refused a missing or non-absolute working directory.", evidence, "runtime_error");
  }
  // cwd confinement: the working directory must stay inside a root the
  // invocation is actually scoped to (its project or worktree). Defense-in-depth
  // against a cwd that escapes the approved workspace onto arbitrary paths. When
  // no root can be derived, there is nothing to confine to, so the run is not
  // blocked on this check alone.
  if (approvedRoots.length > 0 && !approvedRoots.some((root) => pathWithin(root, spawnPlan.cwd))) {
    // refusalCode (refusal model #758): the precise sub-code the server classifies
    // this refusal by. This general cwd check fires before the wrapper gate, so
    // it is where a cwd-outside refusal is actually caught for wrapper commands.
    return refused("Local execution gate refused a working directory outside the approved project or worktree root.", { ...evidence, refusalCode: "cwd_outside_approved_root" });
  }
  if (spawnPlan.args.some((arg) => String(arg).includes("\0"))) {
    return refused("Local execution gate refused an argv containing a NUL byte.", evidence, "validation_failed");
  }
  if (!FILE_POLICIES.has(localPolicy.filePolicy) || !NETWORK_POLICIES.has(localPolicy.networkPolicy)) {
    return refused("Local execution gate refused an unknown file or network policy.", evidence, "validation_failed");
  }
  if (spawnPlan.args.includes("--dangerously-bypass-approvals-and-sandbox") && permissionDecision !== "approved") {
    return refused("Local execution gate refused full-access Codex execution without approval evidence.", evidence);
  }
  if (!commandKind) {
    return refused("Local execution gate refused a non-allowlisted command.", evidence);
  }
  if (!policyAllowed(manifest, commandKind, localPolicy)) {
    // refusalCode (refusal model #758): which of file/network exceeded the local
    // allowlist for this command kind — the precise sub-code the server records.
    const kindPolicy = manifest?.policies?.[commandKind];
    const refusalCode = kindPolicy && !kindPolicy.file.includes(localPolicy.filePolicy)
      ? "file_policy_exceeded"
      : "network_policy_exceeded";
    return refused("Local execution gate refused a command whose file or network policy exceeds the local allowlist.", { ...evidence, refusalCode });
  }
  // OfficeCLI writes edit a document IN PLACE, so they must land in the invocation's
  // WORKTREE — never the project clone — to stay reviewable before promotion. The
  // general cwd check above admits the project root as an approved root; a write
  // demands the stricter guarantee. Refuse a write with no worktree, or whose cwd
  // is not inside it (e.g. resolved to the project fallback). (#1357)
  if (commandKind === "officecliApply") {
    const worktreeRoot = work?.options?.metadata?.worktreePath;
    if (typeof worktreeRoot !== "string" || !worktreeRoot.trim() || !pathWithin(worktreeRoot, spawnPlan.cwd)) {
      return refused(
        "Local execution gate refused an OfficeCLI write outside a worktree — writes must run in the invocation's worktree, never the project clone.",
        { ...evidence, refusalCode: "cwd_outside_approved_root" },
        "policy_blocked",
      );
    }
  }
  if (isApplicationWrapperSpawn(spawnPlan, manifest)) {
    const wrapperGate = applicationWrapperGate(work, spawnPlan, localPolicy, approvedRoots, manifest, resolveBinary);
    evidence.applicationWrapper = wrapperGate.evidence;
    if (!wrapperGate.allowed) {
      // Lift the wrapper gate's precise refusalCode (binary_unavailable,
      // file_policy_exceeded, …) to the TOP level: the server classifies a
      // local_execution_refused by `evidence.refusalCode`, not the nested copy.
      const wrapperRefusalCode = wrapperGate.evidence?.refusalCode;
      return refused(
        wrapperGate.reason,
        wrapperRefusalCode ? { ...evidence, refusalCode: wrapperRefusalCode } : evidence,
        wrapperGate.code ?? "policy_blocked",
      );
    }
  }
  return { allowed: true, reason: "Local execution gate allowed the governed command.", evidence };
}

function classifySpawn(adapter, spawnPlan, manifest = {}) {
  if (!spawnPlan) return null;
  const command = String(spawnPlan.command ?? "");
  const firstArg = String(spawnPlan.args?.[0] ?? "");
  if (command === manifest.execPath && samePath(firstArg, manifest.demoAgentPath)) return "demoAgent";
  if (command === manifest.execPath && samePath(firstArg, manifest.codexFixtureAgentPath)) return "codex";
  if (isCodexCliCommand(adapter?.command) && isAllowlistedCodexSpawn(spawnPlan, manifest)) return "codex";
  if (isClaudeCliCommand(adapter?.command) && isClaudeCliCommand(spawnPlan.command)) return "claude";
  // Classify the write-capable exec wrapper BEFORE the generic read_only wrapper
  // check, so it lands in the codexExec policy rather than being treated read_only.
  if (isAllowlistedCodexExecWrapper(spawnPlan, manifest)) return "codexExec";
  // Same for the write-capable Claude apply runner — never read_only.
  if (isAllowlistedClaudeApplyWrapper(spawnPlan, manifest)) return "claudeApply";
  // OfficeCLI WRITE verbs (P3.1) run through the SAME application-wrapper.mjs runner
  // as the read verbs, so they can't be told apart by script path — the write spec's
  // `apply` capability is the signal. Classify it BEFORE the generic read-only
  // `wrapper` kind so a write lands in the officecliApply bucket, never read_only.
  if (isApplicationWrapperSpawn(spawnPlan, manifest)
    && String(parseApplicationWrapperArgs(spawnPlan.args ?? []).capability ?? "").startsWith("app.app_officecli.apply.")) {
    return "officecliApply";
  }
  if (isAllowlistedNodeWrapper(adapter, spawnPlan, manifest)) return "wrapper";
  return null;
}

function policyAllowed(manifest, commandKind, localPolicy) {
  const policy = manifest?.policies?.[commandKind];
  return Boolean(policy)
    && policy.file.includes(localPolicy.filePolicy)
    && policy.network.includes(localPolicy.networkPolicy);
}

function isAllowlistedCodexSpawn(spawnPlan, manifest = {}) {
  const command = String(spawnPlan.command ?? "");
  const args = spawnPlan.args ?? [];
  if (isCodexCliCommand(command)) return ["exec", "resume"].includes(String(args[0] ?? ""));
  if (command === manifest.execPath && String(args[0] ?? "").replaceAll("\\", "/").endsWith("/node_modules/@openai/codex/bin/codex.js")) {
    return ["exec", "resume"].includes(String(args[1] ?? ""));
  }
  return false;
}

function isAllowlistedNodeWrapper(adapter, spawnPlan, manifest = {}) {
  const command = String(spawnPlan.command ?? "");
  if (command !== "node" && command !== manifest.execPath) return false;
  const script = String(spawnPlan.args?.[0] ?? "").replaceAll("\\", "/");
  return (manifest.nodeWrappers ?? []).some((suffix) => script.endsWith(suffix))
    && String(adapter?.command ?? "") === "node";
}

function isAllowlistedClaudeApplyWrapper(spawnPlan, manifest = {}) {
  const command = String(spawnPlan?.command ?? "");
  if (command !== "node" && command !== manifest.execPath) return false;
  const script = String(spawnPlan?.args?.[0] ?? "").replaceAll("\\", "/");
  return (manifest.claudeApplyWrappers ?? []).some((suffix) => script.endsWith(suffix));
}

function isAllowlistedCodexExecWrapper(spawnPlan, manifest = {}) {
  const command = String(spawnPlan?.command ?? "");
  if (command !== "node" && command !== manifest.execPath) return false;
  const script = String(spawnPlan?.args?.[0] ?? "").replaceAll("\\", "/");
  return (manifest.codexExecWrappers ?? []).some((suffix) => script.endsWith(suffix));
}

function usesCodexExecWrapper(adapter) {
  const args = Array.isArray(adapter?.args) ? adapter.args.map(String) : [];
  return String(adapter?.command ?? "") === "node"
    && args.some((arg) => arg.replaceAll("\\", "/").endsWith("tools/agents/codex-exec-wrapper.mjs"));
}

function usesClaudeApplyWrapper(adapter) {
  const args = Array.isArray(adapter?.args) ? adapter.args.map(String) : [];
  return String(adapter?.command ?? "") === "node"
    && args.some((arg) => arg.replaceAll("\\", "/").endsWith("tools/agents/claude-apply-wrapper.mjs"));
}

function isApplicationWrapperSpawn(spawnPlan, manifest = {}) {
  const command = String(spawnPlan?.command ?? "");
  if (command !== "node" && command !== manifest.execPath) return false;
  const script = String(spawnPlan?.args?.[0] ?? "").replaceAll("\\", "/");
  return script.endsWith("tools/agents/application-wrapper.mjs");
}

function applicationWrapperGate(work, spawnPlan, localPolicy, approvedRoots, manifest = {}, resolveBinary = binaryAvailableOnPath) {
  const spec = applicationWrapperSpec(work);
  const parsed = parseApplicationWrapperArgs(spawnPlan?.args ?? []);
  const cwdPolicy = normalizeCwdPolicy(spec?.cwdPolicy);
  const evidence = {
    capability: parsed.capability ?? spec?.capability ?? null,
    command: parsed.execCommand ?? spec?.execCommand ?? null,
    execArgCount: parsed.execArgs?.length ?? 0,
    cwd: parsed.cwd ?? null,
    cwdPolicy,
    declaredFilePolicy: spec?.filePolicy ?? null,
    declaredNetworkPolicy: spec?.networkPolicy ?? null,
    localAllowlist: "applicationWrapperCommands",
  };
  if (!spec) {
    return { allowed: false, reason: "Local execution gate refused an application wrapper without server-resolved metadata.", evidence , code: "validation_failed" };
  }
  if (!parsed.ok) {
    return { allowed: false, reason: `Local execution gate refused malformed application wrapper argv: ${parsed.reason}`, evidence , code: "validation_failed" };
  }
  if (parsed.execCommand !== String(spec.execCommand ?? "").trim()) {
    return { allowed: false, reason: "Local execution gate refused application wrapper command metadata mismatch.", evidence , code: "validation_failed" };
  }
  const specArgs = Array.isArray(spec.execArgs) ? spec.execArgs.map(String) : [];
  if (!stringArrayEquals(parsed.execArgs, specArgs)) {
    return { allowed: false, reason: "Local execution gate refused application wrapper args metadata mismatch.", evidence , code: "validation_failed" };
  }
  if (parsed.capability !== String(spec.capability ?? "").trim()) {
    return { allowed: false, reason: "Local execution gate refused application wrapper capability metadata mismatch.", evidence , code: "validation_failed" };
  }
  if (spec.filePolicy !== localPolicy.filePolicy || spec.networkPolicy !== localPolicy.networkPolicy) {
    return { allowed: false, reason: "Local execution gate refused application wrapper policy metadata mismatch.", evidence , code: "validation_failed" };
  }
  const allow = (manifest.applicationWrapperCommands ?? []).find((entry) =>
    parsed.execCommand === entry.command && parsed.capability?.startsWith(entry.capabilityPrefix ?? ""),
  );
  if (!allow) {
    return { allowed: false, reason: "Local execution gate refused a non-allowlisted application wrapper command.", evidence , code: "policy_blocked" };
  }
  if (localPolicy.filePolicy !== allow.filePolicy || localPolicy.networkPolicy !== allow.networkPolicy) {
    // refusalCode (refusal model #758): the precise policy sub-code the server
    // classifies the refusal by — distinct from `code`, which is the recovery
    // category. Only the non-default branches carry it; everything else the
    // server buckets as command_not_allowlisted.
    const refusalCode = localPolicy.filePolicy !== allow.filePolicy ? "file_policy_exceeded" : "network_policy_exceeded";
    return { allowed: false, reason: "Local execution gate refused an application wrapper policy outside the command allowlist.", evidence: { ...evidence, refusalCode }, code: "policy_blocked" };
  }
  // An "invocation_root" command IS its repository — cwd is not a detail of it,
  // it is the whole definition. With no resolved cwd the runner would fall back to
  // process.cwd(), i.e. the bridge's own directory, and the cwd checks below would
  // be skipped entirely. Refuse (#794).
  //
  // The device refuses an under-specified command; it does NOT derive the missing
  // cwd from a root it happens to know. Guessing the half the server did not send
  // is how the control plane's word becomes the device's truth again.
  if (cwdPolicy === "invocation_root" && !parsed.cwd) {
    // refusalCode (#758): a command with NO cwd is trivially not within an approved
    // root, so it maps onto the existing code rather than minting a new one — the
    // taxonomy is closed on purpose, and widening it is a protocol change (#759).
    return {
      allowed: false,
      reason: "Local execution gate refused an invocation-root application wrapper command with no resolved working directory.",
      evidence: { ...evidence, refusalCode: "cwd_outside_approved_root" },
      code: "policy_blocked",
    };
  }
  if (parsed.cwd) {
    if (!isAbsolute(parsed.cwd) || !existsSync(parsed.cwd)) {
      return { allowed: false, reason: "Local execution gate refused an application wrapper cwd that is missing or non-absolute.", evidence: { ...evidence, refusalCode: "cwd_outside_approved_root" }, code: "runtime_error" };
    }
    if (approvedRoots.length > 0 && !approvedRoots.some((root) => pathWithin(root, parsed.cwd))) {
      return { allowed: false, reason: "Local execution gate refused an application wrapper cwd outside the approved project or worktree root.", evidence: { ...evidence, refusalCode: "cwd_outside_approved_root" }, code: "policy_blocked" };
    }
  }
  if (!wrapperArgsAllowed(parsed.capability, parsed.execArgs)) {
    return { allowed: false, reason: "Local execution gate refused application wrapper args outside the local allowlist.", evidence, code: "policy_blocked" };
  }
  // Per-device availability (#802): the command is allowlisted, but the binary may
  // not be installed on THIS device (git is a per-device property). Resolve it the
  // way spawn() would and refuse with a PRECISE reason — otherwise the spawn fails
  // with exit 127 and the operator only learns "the wrapper failed", never that the
  // device simply lacks git. Checked last, so it never leaks PATH probing for a
  // command that was going to be refused anyway.
  if (!resolveBinary(parsed.execCommand)) {
    return {
      allowed: false,
      reason: `Local execution gate refused an application wrapper command whose binary "${parsed.execCommand}" is not available on this device.`,
      evidence: { ...evidence, refusalCode: "binary_unavailable" },
      code: "runtime_error",
    };
  }
  return { allowed: true, reason: "Local execution gate allowed the application wrapper command.", evidence };
}

function applicationWrapperSpec(work) {
  const metadata = work?.options?.metadata && typeof work.options.metadata === "object" && !Array.isArray(work.options.metadata)
    ? work.options.metadata
    : {};
  return metadata.applicationWrapper && typeof metadata.applicationWrapper === "object" && !Array.isArray(metadata.applicationWrapper)
    ? metadata.applicationWrapper
    : null;
}

function parseApplicationWrapperArgs(args) {
  const parsed = { ok: true, capability: null, execCommand: null, execArgs: [], cwd: null };
  for (let index = 1; index < args.length; index += 1) {
    const arg = String(args[index] ?? "");
    if (arg === "--capability") {
      if (parsed.capability !== null) return { ...parsed, ok: false, reason: "duplicate --capability" };
      parsed.capability = valueAt(args, ++index, arg);
    } else if (arg === "--exec-command") {
      if (parsed.execCommand !== null) return { ...parsed, ok: false, reason: "duplicate --exec-command" };
      parsed.execCommand = valueAt(args, ++index, arg, { allowFlag: true });
    } else if (arg === "--exec-arg") {
      parsed.execArgs.push(valueAt(args, ++index, arg, { allowFlag: true }));
    } else if (arg === "--cwd") {
      if (parsed.cwd !== null) return { ...parsed, ok: false, reason: "duplicate --cwd" };
      parsed.cwd = valueAt(args, ++index, arg);
    } else {
      return { ...parsed, ok: false, reason: `unsupported argument ${arg}` };
    }
  }
  if (!parsed.execCommand) return { ...parsed, ok: false, reason: "missing --exec-command" };
  if (!parsed.capability) return { ...parsed, ok: false, reason: "missing --capability" };
  if (parsed.execCommand.startsWith("-")) return { ...parsed, ok: false, reason: "flag-shaped --exec-command" };
  return parsed;
}

function valueAt(args, index, name, { allowFlag = false } = {}) {
  const value = args[index];
  if (value === undefined) return "";
  const text = String(value);
  if (!allowFlag && text.startsWith("--")) return "";
  return text;
}

// Dispatch on capability prefix to a per-application argv spec. An UNKNOWN prefix
// returns false — default-deny is the property this whole file exists to hold.
function wrapperArgsAllowed(capability, args) {
  const cap = String(capability ?? "");
  if (cap.startsWith("app.app_ccusage.wrapper.")) return ccusageArgsAllowed(cap, args);
  if (cap.startsWith("app.app_git.wrapper.")) return gitArgsAllowed(cap, args);
  if (cap.startsWith("app.app_officecli.wrapper.")) return officecliArgsAllowed(cap, args);
  if (cap.startsWith("app.app_officecli.apply.")) return officecliApplyArgsAllowed(cap, args);
  return false;
}

function officecliApplyArgsAllowed(capability, args) {
  const cmd = String(capability ?? "").match(/^app\.app_officecli\.apply\.([a-z0-9_]+)$/)?.[1] ?? null;
  const spec = cmd ? OFFICECLI_APPLY_WRAPPER_ARGS[cmd] : null;
  return officecliArgvMatches(spec, args);
}

function officecliArgsAllowed(capability, args) {
  const cmd = String(capability ?? "").match(/^app\.app_officecli\.wrapper\.([a-z0-9_]+)$/)?.[1] ?? null;
  return officecliArgvMatches(cmd ? OFFICECLI_WRAPPER_ARGS[cmd] : null, args);
}

// Shared argv matcher for the read (.wrapper.) and write (.apply.) officecli specs.
// Args must match the declared base as a PREFIX, then declared flag/value pairs,
// then declared positionals — each position validated by its OWN validator
// (positionals[N]). An undeclared flag, an over-count positional, or a positional
// failing its position validator is refused.
function officecliArgvMatches(spec, args) {
  if (!spec || !stringArrayStartsWith(args, spec.base)) return false;
  const rest = args.slice(spec.base.length);
  const positionals = Array.isArray(spec.positionals) ? spec.positionals : [];
  let positionalIndex = 0;
  let index = 0;
  while (index < rest.length) {
    const token = String(rest[index] ?? "");
    if (token.startsWith("-")) {
      const validate = spec.flags[token];
      // A valueless boolean flag is declared as `true` (e.g. --header) — it
      // consumes no value token.
      if (validate === true) { index += 1; continue; }
      const value = rest[index + 1];
      if (typeof validate !== "function" || value === undefined || !validate(value)) return false;
      index += 2;
    } else {
      const validate = positionals[positionalIndex];
      if (typeof validate !== "function" || !validate(token)) return false;
      positionalIndex += 1;
      index += 1;
    }
  }
  return true;
}

function ccusageArgsAllowed(capability, args) {
  const report = String(capability ?? "").match(/^app\.app_ccusage\.wrapper\.([a-z0-9_]+)$/)?.[1] ?? null;
  const base = report ? CCUSAGE_WRAPPER_ARGS[report] : null;
  if (!base || !stringArrayStartsWith(args, base)) return false;
  const rest = args.slice(base.length);
  for (let index = 0; index < rest.length; index += 2) {
    const flag = rest[index];
    const value = rest[index + 1];
    if (value === undefined) return false;
    if ((flag === "--since" || flag === "--until") && /^\d{4}-\d{2}-\d{2}$/.test(value)) continue;
    if (flag === "--timezone" && /^[A-Za-z0-9_+/:.][A-Za-z0-9_+/:.-]{0,63}$/.test(value)) continue;
    return false;
  }
  return true;
}

function gitArgsAllowed(capability, args) {
  const cmd = String(capability ?? "").match(/^app\.app_git\.wrapper\.([a-z0-9_]+)$/)?.[1] ?? null;
  const spec = cmd ? GIT_WRAPPER_ARGS[cmd] : null;
  // Args must match the declared base as a PREFIX, then declared flag/value pairs,
  // then declared positionals (git-rev). A positional has NO leading "-", so it is
  // never confusable with a flag; an undeclared flag or an over-count positional
  // is refused.
  if (!spec || !stringArrayStartsWith(args, spec.base)) return false;
  const rest = args.slice(spec.base.length);
  let positionals = 0;
  let index = 0;
  while (index < rest.length) {
    const token = String(rest[index] ?? "");
    if (token.startsWith("-")) {
      const validate = spec.flags[token];
      const value = rest[index + 1];
      if (typeof validate !== "function" || value === undefined || !validate(value)) return false;
      index += 2;
    } else {
      if (typeof spec.positional !== "function" || positionals >= (spec.maxPositionals ?? 0)) return false;
      if (!spec.positional(token)) return false;
      positionals += 1;
      index += 1;
    }
  }
  return true;
}

function isCodexCliCommand(command) {
  const normalized = String(command ?? "").trim().toLowerCase();
  return ["codex", "codex.cmd", "codex.ps1", "codex.exe"].some((name) => normalized === name || normalized.endsWith(`/${name}`) || normalized.endsWith(`\\${name}`));
}

function isClaudeCliCommand(command) {
  const normalized = String(command ?? "").trim().toLowerCase();
  return ["claude", "claude.cmd", "claude.ps1", "claude.exe"].some((name) => normalized === name || normalized.endsWith(`/${name}`) || normalized.endsWith(`\\${name}`));
}

function normalizePolicy(value, fallback) {
  const text = String(value ?? "").trim();
  return FILE_POLICIES.has(text) || NETWORK_POLICIES.has(text) ? text : fallback;
}

// The device's OWN reading of cwdPolicy (#794). A missing or unrecognized value is
// "fixed" — the cwd-insensitive default — rather than an inference about what the
// server meant. Only the exact string opts a command into invocation-root
// confinement, so a truncated or older payload can never silently acquire it.
function normalizeCwdPolicy(value) {
  return String(value ?? "").trim() === "invocation_root" ? "invocation_root" : "fixed";
}

function collectApprovedRoots(work) {
  const metadata = work?.options?.metadata && typeof work.options.metadata === "object" && !Array.isArray(work.options.metadata)
    ? work.options.metadata
    : {};
  const roots = [work?.project?.path, metadata.worktreePath, metadata.projectPath].filter(
    (value) => typeof value === "string" && value.trim(),
  );
  return [...new Set(roots.map((value) => resolve(value)))];
}

function pathWithin(root, target) {
  const r = resolve(String(root));
  const t = resolve(String(target));
  return t === r || t.startsWith(r + sep);
}

function samePath(a, b) {
  return Boolean(a && b) && resolve(String(a)) === resolve(String(b));
}

function stringArrayStartsWith(value, prefix) {
  return Array.isArray(value)
    && value.length >= prefix.length
    && prefix.every((item, index) => String(value[index]) === item);
}

function stringArrayEquals(a, b) {
  return Array.isArray(a)
    && Array.isArray(b)
    && a.length === b.length
    && a.every((item, index) => String(item) === String(b[index]));
}

// `code` is a server recovery-category (docs: BRIDGE_LIVENESS_AND_REFUSAL.md +
// #697 errorCode). It lets a local-gate refusal reported via /api/bridge/refuse
// (or complete-failed) classify honestly instead of as a generic failure.
// Default policy_blocked — most gate refusals are a confinement/allowlist call.
function refused(reason, evidence, code = "policy_blocked") {
  return { allowed: false, reason, evidence, code };
}
