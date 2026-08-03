import { existsSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, resolve, sep } from "node:path";
import { normalizeAgentModel } from "@myagenttool/protocol/agent-models";

const CLAUDE_PERMISSION_MODES = new Set([
  "default",
  "acceptEdits",
  "bypassPermissions",
  "plan",
  "dontAsk",
]);
const READ_ONLY_TOOLS = new Set(["Glob", "Grep", "Read"]);
const WRITE_TOOLS = new Set(["Edit", "Write", "NotebookEdit"]);
const SHELL_TOOLS = new Set(["Bash"]);
const CLAUDE_SDK_TOOLS = ["Glob", "Grep", "Read", "Edit", "Write", "NotebookEdit", "Bash"];

/**
 * The SDK is the default Claude transport after the parity rollout. An
 * adapter-local value wins, and MYAGENTTOOL_CLAUDE_RUNTIME=cli is the immediate
 * rollback switch.
 */
export function resolveClaudeRuntime(adapter = {}, env = process.env) {
  const environmentRuntime = String(env.MYAGENTTOOL_CLAUDE_RUNTIME ?? "").trim().toLowerCase();
  if (["cli", "claude_cli", "claude-cli"].includes(environmentRuntime)) return "cli";
  const requested = String(
    adapter.claudeRuntime
    ?? environmentRuntime
    ?? "agent_sdk",
  ).trim().toLowerCase();
  return ["cli", "claude_cli", "claude-cli"].includes(requested) ? "cli" : "agent_sdk";
}

export function isClaudeSdkRuntime(adapter = {}, env = process.env) {
  return isClaudeCliCommand(adapter.command) && resolveClaudeRuntime(adapter, env) === "agent_sdk";
}

export function normalizeClaudeSdkPermissionMode(value) {
  const alias = String(value ?? "").trim();
  const requested = {
    ask: "default",
    approveForMe: "acceptEdits",
    approve_for_me: "acceptEdits",
    auto: "acceptEdits",
    full: "bypassPermissions",
  }[alias] ?? alias;
  return CLAUDE_PERMISSION_MODES.has(requested) ? requested : "plan";
}

/**
 * Select exactly one filesystem boundary for an invocation. A worktree-bound
 * run must never fall back to, or additionally approve, the main checkout.
 * Existence is validated later by validateClaudeSdkExecutionPlan so a deleted
 * worktree fails closed.
 */
export function claudeSdkWorkspaceBoundary({ projectPath, worktreePath } = {}) {
  const worktree = String(worktreePath ?? "").trim();
  const project = String(projectPath ?? "").trim();
  const cwd = worktree || project;
  return {
    cwd,
    approvedRoots: cwd ? [cwd] : [],
    workspaceKind: worktree ? "worktree" : "project",
  };
}

/**
 * Preserve exact Claude CLI continuation during the SDK emergency rollback.
 * Invalid or missing ids fail closed to a new CLI session instead of rendering
 * an attacker-controlled argument.
 */
export function applyClaudeCliResumeArgs(args, options = {}) {
  const input = Array.isArray(args) ? args.map(String) : [];
  if (options?.claudeSessionMode !== "continue_last") return input;
  const sessionId = String(options?.claudeResumeSessionId ?? "").trim();
  return isUuid(sessionId) ? [...input, "--resume", sessionId] : input;
}

/**
 * The approval broker needs enough information to review Bash safely. Keep the
 * persisted summary bounded and redact common credential assignments/options.
 */
export function claudePermissionRequestSummary({
  toolName,
  input,
  title,
  description,
} = {}) {
  const parts = [title, description]
    .map((value) => String(value ?? "").replace(/\s+/g, " ").trim())
    .filter(Boolean);
  if (String(toolName ?? "") === "Bash" && typeof input?.command === "string") {
    const command = redactApprovalCommand(input.command);
    if (command) parts.push(`Command: ${command}`);
  }
  const fallback = `${String(toolName ?? "Claude tool")} permission request`;
  const summary = [...new Set(parts)].join(" — ") || fallback;
  return summary.length > 1000 ? `${summary.slice(0, 997)}...` : summary;
}

export function claudeSdkCompletionResult(finalResult, roundState, extra = {}) {
  return {
    ...(finalResult && typeof finalResult === "object" ? finalResult : {}),
    ...(extra && typeof extra === "object" ? extra : {}),
    touchedUserFiles: Boolean(roundState?.touchedUserFiles),
  };
}

/**
 * Build the non-secret execution descriptor that is safe to expose in an
 * execution_preview event. The full environment stays local to the Bridge.
 */
export function createClaudeSdkExecutionPlan({
  cwd,
  permissionMode,
  env,
  executablePath,
  timeoutMs,
  approvedRoots,
  resumeSessionId,
  model,
} = {}) {
  const normalizedExecutable = String(executablePath ?? "").trim();
  const normalizedResumeSessionId = String(resumeSessionId ?? "").trim();
  const normalizedModel = normalizeAgentModel(model);
  return {
    runtime: "agent_sdk",
    cwd: String(cwd ?? ""),
    permissionMode: normalizeClaudeSdkPermissionMode(permissionMode),
    approvedRoots: normalizeRoots(approvedRoots),
    env: env && typeof env === "object" && !Array.isArray(env) ? { ...env } : undefined,
    executablePath: normalizedExecutable || null,
    timeoutMs: finitePositive(timeoutMs) ? Number(timeoutMs) : null,
    resumeSessionId: normalizedResumeSessionId || null,
    model: normalizedModel,
  };
}

/**
 * All SDK permission modes are accepted after the in-loop approval broker and
 * PreToolUse policy have been connected.
 */
export function validateClaudeSdkExecutionPlan(
  plan,
  { approvedRoots = plan?.approvedRoots ?? [], exists = existsSync } = {},
) {
  const evidence = {
    runtime: "agent_sdk",
    cwd: plan?.cwd ?? null,
    permissionMode: plan?.permissionMode ?? null,
    approvedRoots: normalizeRoots(approvedRoots),
    executableSource: plan?.executablePath ? "configured" : "sdk_bundled",
  };
  if (!plan || plan.runtime !== "agent_sdk") {
    return refused("Claude Agent SDK execution plan is missing or invalid.", evidence, "validation_failed");
  }
  if (!plan.cwd || !isAbsolute(plan.cwd) || !exists(plan.cwd)) {
    return refused("Claude Agent SDK requires an absolute existing working directory.", evidence, "runtime_error");
  }
  if (evidence.approvedRoots.length === 0) {
    return refused(
      "Claude Agent SDK requires a server-resolved project or worktree root.",
      { ...evidence, refusalCode: "claude_sdk_root_required" },
      "policy_blocked",
    );
  }
  if (
    !evidence.approvedRoots.some((root) => pathWithin(root, plan.cwd))
  ) {
    return refused(
      "Claude Agent SDK working directory is outside the invocation project or worktree.",
      { ...evidence, refusalCode: "cwd_outside_approved_root" },
      "policy_blocked",
    );
  }
  if (!CLAUDE_PERMISSION_MODES.has(plan.permissionMode)) {
    return refused(
      `Claude Agent SDK permission mode is unsupported: ${plan.permissionMode}.`,
      { ...evidence, refusalCode: "claude_sdk_permission_mode_not_enabled" },
      "policy_blocked",
    );
  }
  if (plan.executablePath && (!isAbsolute(plan.executablePath) || !exists(plan.executablePath))) {
    return refused(
      "Configured Claude executable for the Agent SDK is not an absolute existing file.",
      { ...evidence, refusalCode: "claude_sdk_executable_unavailable" },
      "agent_unavailable",
    );
  }
  if (plan.resumeSessionId && !isUuid(plan.resumeSessionId)) {
    return refused(
      "Claude Agent SDK resume requires an exact UUID session id.",
      { ...evidence, refusalCode: "claude_sdk_resume_session_invalid" },
      "validation_failed",
    );
  }
  return {
    allowed: true,
    reason: "Claude Agent SDK execution plan passed local confinement checks.",
    evidence,
  };
}

/**
 * Evaluate an SDK tool request before Claude's own permission rules. This hook
 * is the invariant boundary: auto-approved tools still pass through it.
 */
export function evaluateClaudeSdkToolUse({
  toolName,
  input,
  permissionMode,
  cwd,
  approvedRoots = [],
} = {}) {
  const name = String(toolName ?? "");
  const mode = normalizeClaudeSdkPermissionMode(permissionMode);
  const roots = normalizeRoots(approvedRoots);
  const base = resolve(String(cwd ?? ""));
  const evidence = {
    toolName: name,
    permissionMode: mode,
    cwd: base,
    approvedRoots: roots,
    referencedPaths: referencedToolPaths(input, base),
  };
  if (roots.length === 0 || !roots.some((root) => pathWithin(root, base))) {
    return deniedTool("Tool working directory is outside the approved project roots.", evidence);
  }
  for (const target of evidence.referencedPaths) {
    if (!roots.some((root) => pathWithinReal(root, target))) {
      return deniedTool(`Tool path is outside the approved project roots: ${target}`, evidence);
    }
  }
  if (mode === "plan" && !READ_ONLY_TOOLS.has(name)) {
    return deniedTool(`Plan mode blocks ${name || "unknown tool"}.`, evidence);
  }
  if (mode === "dontAsk" && !READ_ONLY_TOOLS.has(name)) {
    return deniedTool(`dontAsk mode rejects unapproved ${name || "unknown tool"} use.`, evidence);
  }
  if (!READ_ONLY_TOOLS.has(name) && !WRITE_TOOLS.has(name) && !SHELL_TOOLS.has(name)) {
    return deniedTool(`Tool ${name || "unknown"} is not in the MyAgentTool Claude tool set.`, evidence);
  }
  return { allowed: true, reason: `${name} passed the local tool boundary.`, evidence };
}

export function createClaudeSdkCallbacks({
  plan,
  requestApproval = async () => "denied",
  onHook = async () => {},
} = {}) {
  const preToolUse = async (input) => {
    const decision = evaluateClaudeSdkToolUse({
      toolName: input?.tool_name,
      input: input?.tool_input,
      permissionMode: plan.permissionMode,
      cwd: plan.cwd,
      approvedRoots: plan.approvedRoots,
    });
    await onHook({
      eventName: "PreToolUse",
      toolName: input?.tool_name ?? null,
      toolUseId: input?.tool_use_id ?? null,
      input: input?.tool_input ?? null,
      decision: decision.allowed ? "allowed" : "blocked",
      reason: decision.reason,
      evidence: decision.evidence,
    });
    return decision.allowed
      ? { continue: true }
      : {
          hookSpecificOutput: {
            hookEventName: "PreToolUse",
            permissionDecision: "deny",
            permissionDecisionReason: decision.reason,
          },
        };
  };
  const postToolUse = async (input) => {
    const toolName = String(input?.tool_name ?? "");
    await onHook({
      eventName: "PostToolUse",
      toolName: toolName || null,
      toolUseId: input?.tool_use_id ?? null,
      input: input?.tool_input ?? null,
      reason: `${toolName || "Claude tool"} completed.`,
      mayHaveTouchedUserFiles: WRITE_TOOLS.has(toolName) || SHELL_TOOLS.has(toolName),
    });
    return { continue: true };
  };
  const fileChanged = async (input) => {
    await onHook({
      eventName: "FileChanged",
      toolName: null,
      toolUseId: null,
      input: {
        file_path: input?.file_path ?? null,
        event: input?.event ?? null,
      },
      reason: `Claude reported a ${input?.event ?? "change"} filesystem event.`,
      mayHaveTouchedUserFiles: true,
    });
    return { continue: true };
  };
  const canUseTool = async (toolName, input, options = {}) => {
    const local = evaluateClaudeSdkToolUse({
      toolName,
      input,
      permissionMode: plan.permissionMode,
      cwd: plan.cwd,
      approvedRoots: plan.approvedRoots,
    });
    if (!local.allowed) {
      return { behavior: "deny", message: local.reason, interrupt: false, toolUseID: options.toolUseID };
    }
    if (
      READ_ONLY_TOOLS.has(toolName)
      || plan.permissionMode === "bypassPermissions"
      || (plan.permissionMode === "acceptEdits" && WRITE_TOOLS.has(toolName))
    ) {
      return { behavior: "allow", toolUseID: options.toolUseID };
    }
    if (plan.permissionMode === "plan" || plan.permissionMode === "dontAsk") {
      return {
        behavior: "deny",
        message: `${plan.permissionMode} mode does not permit ${toolName}.`,
        interrupt: false,
        toolUseID: options.toolUseID,
      };
    }
    const decision = await requestApproval({
      toolName,
      input,
      toolUseId: options.toolUseID ?? null,
      title: options.title ?? options.displayName ?? `${toolName} permission request`,
      description: options.description ?? options.decisionReason ?? null,
      blockedPath: options.blockedPath ?? null,
      signal: options.signal,
    });
    return decision === "approved"
      ? { behavior: "allow", toolUseID: options.toolUseID }
      : {
          behavior: "deny",
          message: decision === "timed_out"
            ? "MyAgentTool approval timed out."
            : "MyAgentTool denied this tool request.",
          interrupt: false,
          toolUseID: options.toolUseID,
        };
  };
  return {
    canUseTool,
    hooks: {
      PreToolUse: [{ hooks: [preToolUse] }],
      PostToolUse: [{ hooks: [postToolUse] }],
      FileChanged: [{ hooks: [fileChanged] }],
    },
  };
}

/**
 * Execute one SDK query. SDK loading is lazy so the default CLI path does not
 * load the package or its platform binary. `loadSdk` is injectable for unit
 * tests and keeps tests network/auth independent.
 */
export async function runClaudeSdkQuery({
  prompt,
  plan,
  abortController = new AbortController(),
  onMessage = async () => {},
  requestApproval = async () => "denied",
  onHook = async () => {},
  loadSdk = () => import("@anthropic-ai/claude-agent-sdk"),
} = {}) {
  if (!plan || plan.runtime !== "agent_sdk") {
    throw new Error("Claude Agent SDK execution requires a validated agent_sdk plan.");
  }
  const sdk = await loadSdk();
  if (typeof sdk?.query !== "function") {
    throw new Error("Claude Agent SDK query() is unavailable.");
  }

  const callbacks = createClaudeSdkCallbacks({ plan, requestApproval, onHook });
  const options = {
    abortController,
    cwd: plan.cwd,
    permissionMode: plan.permissionMode,
    tools: CLAUDE_SDK_TOOLS,
    canUseTool: callbacks.canUseTool,
    hooks: callbacks.hooks,
    includeHookEvents: true,
    includePartialMessages: false,
    persistSession: true,
    ...(plan.resumeSessionId ? { resume: plan.resumeSessionId } : {}),
    ...(plan.model ? { model: plan.model } : {}),
    ...(plan.permissionMode === "bypassPermissions"
      ? { allowDangerouslySkipPermissions: true }
      : {}),
    env: plan.env,
    ...(plan.executablePath ? { pathToClaudeCodeExecutable: plan.executablePath } : {}),
  };
  const query = sdk.query({ prompt: String(prompt ?? ""), options });
  let resultMessage = null;
  let sessionId = null;
  try {
    for await (const message of query) {
      if (message?.session_id) sessionId = String(message.session_id);
      if (message?.type === "result") resultMessage = message;
      await onMessage(message);
    }
  } finally {
    // query() normally closes itself when the iterator completes. close() is
    // idempotent and guarantees the subprocess is not left behind after an
    // exception in event delivery.
    query?.close?.();
  }
  return { resultMessage, sessionId };
}

export function claudeSdkExecutionPreview(plan) {
  return {
    runtime: "agent_sdk",
    commandLine: "Claude Agent SDK query()",
    cwd: plan.cwd,
    permissionMode: plan.permissionMode,
    executableSource: plan.executablePath ? "configured_claude" : "sdk_bundled",
    sessionMode: plan.resumeSessionId ? "resume_exact" : "new",
    resuming: Boolean(plan.resumeSessionId),
    model: plan.model ?? null,
  };
}

function isClaudeCliCommand(command) {
  const normalized = String(command ?? "").trim().toLowerCase();
  return ["claude", "claude.cmd", "claude.ps1", "claude.exe"].some(
    (name) => normalized === name
      || normalized.endsWith(`/${name}`)
      || normalized.endsWith(`\\${name}`),
  );
}

function normalizeRoots(values) {
  return [...new Set(
    (Array.isArray(values) ? values : [])
      .filter((value) => typeof value === "string" && value.trim())
      .map((value) => resolve(value)),
  )];
}

function pathWithin(root, target) {
  const normalizedRoot = resolve(String(root));
  const normalizedTarget = resolve(String(target));
  const left = process.platform === "win32" ? normalizedRoot.toLowerCase() : normalizedRoot;
  const right = process.platform === "win32" ? normalizedTarget.toLowerCase() : normalizedTarget;
  return right === left || right.startsWith(left + sep);
}

function pathWithinReal(root, target) {
  const normalizedRoot = realPathForBoundary(root);
  const normalizedTarget = realPathForBoundary(target);
  return pathWithin(normalizedRoot, normalizedTarget);
}

function realPathForBoundary(value) {
  let cursor = resolve(String(value));
  const suffix = [];
  while (!existsSync(cursor)) {
    const parent = dirname(cursor);
    if (parent === cursor) break;
    suffix.unshift(cursor.slice(parent.length).replace(/^[/\\]+/, ""));
    cursor = parent;
  }
  let real = existsSync(cursor) ? realpathSync(cursor) : cursor;
  for (const segment of suffix) real = resolve(real, segment);
  return real;
}

function referencedToolPaths(input, cwd) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return [];
  const pathKeys = new Set([
    "file_path",
    "path",
    "notebook_path",
    "directory",
    "cwd",
  ]);
  return [...new Set(
    Object.entries(input)
      .filter(([key, value]) => pathKeys.has(key) && typeof value === "string" && value.trim())
      .map(([, value]) => isAbsolute(value) ? resolve(value) : resolve(cwd, value)),
  )];
}

function deniedTool(reason, evidence) {
  return { allowed: false, reason, evidence };
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value));
}

function redactApprovalCommand(value) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .replace(
      /\b([A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|API_KEY|AUTH)[A-Z0-9_]*)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s]+)/gi,
      "$1=<redacted>",
    )
    .replace(
      /(--?(?:token|secret|password|passwd|credential|api[-_]?key|auth)(?:=|\s+))(?:"[^"]*"|'[^']*'|[^\s]+)/gi,
      "$1<redacted>",
    )
    .trim();
}

function finitePositive(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0;
}

function refused(reason, evidence, code) {
  return { allowed: false, reason, evidence, code };
}
