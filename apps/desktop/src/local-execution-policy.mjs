import { existsSync } from "node:fs";
import { isAbsolute, resolve, sep } from "node:path";

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

const GIT_WRAPPER_ARGS = {
  status: { base: ["--no-pager", "status", "--porcelain=v2", "--branch"], flags: {} },
  log: {
    base: ["--no-pager", "log", "--format=%H%x1f%an%x1f%aI%x1f%s%x1e", "--max-count=50"],
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
    ],
    policies: {
      demoAgent: { file: ["read_only"], network: ["forbidden"] },
      codex: { file: ["native_controls", "workspace_write", "read_only"], network: ["native_controls", "restricted", "network"] },
      claude: { file: ["native_controls", "workspace_write", "read_only"], network: ["native_controls", "restricted", "network"] },
      wrapper: { file: ["read_only"], network: ["forbidden"] },
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
  return {
    filePolicy: normalizePolicy(adapter?.filePolicy, "read_only"),
    networkPolicy: normalizePolicy(adapter?.networkPolicy, "forbidden"),
    source: "adapter_default",
  };
}

export function localExecutionGate(work, adapter, spawnPlan, { permissionDecision, permissionHook, manifest } = {}) {
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
  if (isApplicationWrapperSpawn(spawnPlan, manifest)) {
    const wrapperGate = applicationWrapperGate(work, spawnPlan, localPolicy, approvedRoots, manifest);
    evidence.applicationWrapper = wrapperGate.evidence;
    if (!wrapperGate.allowed) {
      return refused(wrapperGate.reason, evidence, wrapperGate.code ?? "policy_blocked");
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

function isApplicationWrapperSpawn(spawnPlan, manifest = {}) {
  const command = String(spawnPlan?.command ?? "");
  if (command !== "node" && command !== manifest.execPath) return false;
  const script = String(spawnPlan?.args?.[0] ?? "").replaceAll("\\", "/");
  return script.endsWith("tools/agents/application-wrapper.mjs");
}

function applicationWrapperGate(work, spawnPlan, localPolicy, approvedRoots, manifest = {}) {
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
  return false;
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
