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
    return refused(`Local execution gate refused adapter type ${adapter?.type ?? "unknown"}.`, evidence);
  }
  if (!spawnPlan?.command || !Array.isArray(spawnPlan.args)) {
    return refused("Local execution gate refused an incomplete spawn plan.", evidence);
  }
  if (!spawnPlan.cwd || !isAbsolute(spawnPlan.cwd) || !existsSync(spawnPlan.cwd)) {
    return refused("Local execution gate refused a missing or non-absolute working directory.", evidence);
  }
  // cwd confinement: the working directory must stay inside a root the
  // invocation is actually scoped to (its project or worktree). Defense-in-depth
  // against a cwd that escapes the approved workspace onto arbitrary paths. When
  // no root can be derived, there is nothing to confine to, so the run is not
  // blocked on this check alone.
  if (approvedRoots.length > 0 && !approvedRoots.some((root) => pathWithin(root, spawnPlan.cwd))) {
    return refused("Local execution gate refused a working directory outside the approved project or worktree root.", evidence);
  }
  if (spawnPlan.args.some((arg) => String(arg).includes("\0"))) {
    return refused("Local execution gate refused an argv containing a NUL byte.", evidence);
  }
  if (!FILE_POLICIES.has(localPolicy.filePolicy) || !NETWORK_POLICIES.has(localPolicy.networkPolicy)) {
    return refused("Local execution gate refused an unknown file or network policy.", evidence);
  }
  if (spawnPlan.args.includes("--dangerously-bypass-approvals-and-sandbox") && permissionDecision !== "approved") {
    return refused("Local execution gate refused full-access Codex execution without approval evidence.", evidence);
  }
  if (!commandKind) {
    return refused("Local execution gate refused a non-allowlisted command.", evidence);
  }
  if (!policyAllowed(manifest, commandKind, localPolicy)) {
    return refused("Local execution gate refused a command whose file or network policy exceeds the local allowlist.", evidence);
  }
  if (isApplicationWrapperSpawn(spawnPlan, manifest)) {
    const wrapperGate = applicationWrapperGate(work, spawnPlan, localPolicy, approvedRoots, manifest);
    evidence.applicationWrapper = wrapperGate.evidence;
    if (!wrapperGate.allowed) {
      return refused(wrapperGate.reason, evidence);
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
  const evidence = {
    capability: parsed.capability ?? spec?.capability ?? null,
    command: parsed.execCommand ?? spec?.execCommand ?? null,
    execArgCount: parsed.execArgs?.length ?? 0,
    cwd: parsed.cwd ?? null,
    declaredFilePolicy: spec?.filePolicy ?? null,
    declaredNetworkPolicy: spec?.networkPolicy ?? null,
    localAllowlist: "applicationWrapperCommands",
  };
  if (!spec) {
    return { allowed: false, reason: "Local execution gate refused an application wrapper without server-resolved metadata.", evidence };
  }
  if (!parsed.ok) {
    return { allowed: false, reason: `Local execution gate refused malformed application wrapper argv: ${parsed.reason}`, evidence };
  }
  if (parsed.execCommand !== String(spec.execCommand ?? "").trim()) {
    return { allowed: false, reason: "Local execution gate refused application wrapper command metadata mismatch.", evidence };
  }
  const specArgs = Array.isArray(spec.execArgs) ? spec.execArgs.map(String) : [];
  if (!stringArrayEquals(parsed.execArgs, specArgs)) {
    return { allowed: false, reason: "Local execution gate refused application wrapper args metadata mismatch.", evidence };
  }
  if (parsed.capability !== String(spec.capability ?? "").trim()) {
    return { allowed: false, reason: "Local execution gate refused application wrapper capability metadata mismatch.", evidence };
  }
  if (spec.filePolicy !== localPolicy.filePolicy || spec.networkPolicy !== localPolicy.networkPolicy) {
    return { allowed: false, reason: "Local execution gate refused application wrapper policy metadata mismatch.", evidence };
  }
  const allow = (manifest.applicationWrapperCommands ?? []).find((entry) =>
    parsed.execCommand === entry.command && parsed.capability?.startsWith(entry.capabilityPrefix ?? ""),
  );
  if (!allow) {
    return { allowed: false, reason: "Local execution gate refused a non-allowlisted application wrapper command.", evidence };
  }
  if (localPolicy.filePolicy !== allow.filePolicy || localPolicy.networkPolicy !== allow.networkPolicy) {
    return { allowed: false, reason: "Local execution gate refused an application wrapper policy outside the command allowlist.", evidence };
  }
  if (parsed.cwd) {
    if (!isAbsolute(parsed.cwd) || !existsSync(parsed.cwd)) {
      return { allowed: false, reason: "Local execution gate refused an application wrapper cwd that is missing or non-absolute.", evidence };
    }
    if (approvedRoots.length > 0 && !approvedRoots.some((root) => pathWithin(root, parsed.cwd))) {
      return { allowed: false, reason: "Local execution gate refused an application wrapper cwd outside the approved project or worktree root.", evidence };
    }
  }
  if (!ccusageArgsAllowed(parsed.capability, parsed.execArgs)) {
    return { allowed: false, reason: "Local execution gate refused application wrapper args outside the local allowlist.", evidence };
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

function refused(reason, evidence) {
  return { allowed: false, reason, evidence };
}
