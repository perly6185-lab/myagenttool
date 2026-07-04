import { existsSync } from "node:fs";
import { isAbsolute, resolve, sep } from "node:path";

const FILE_POLICIES = new Set(["forbidden", "read_only", "workspace_write", "native_controls"]);
const NETWORK_POLICIES = new Set(["forbidden", "restricted", "network", "native_controls"]);

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

function refused(reason, evidence) {
  return { allowed: false, reason, evidence };
}
