import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const __dirname = dirname(scriptPath);
const defaultRepoRoot = resolve(__dirname, "../../../..");
const repoRoot = resolve(process.env.MYAGENTTOOL_REPO_ROOT ?? defaultRepoRoot);

export const LOOP_REGISTRY_VERSION = 1;
export const LOOP_RUN_STATES = [
  "created",
  "planning",
  "planned",
  "applying",
  "running_adapter",
  "checking_scope",
  "verifying",
  "awaiting_human",
  "queued",
  "claimed",
  "completed",
  "failed",
  "cancelled",
  "timed_out",
];

export const LOOP_EVENT_TYPES = [
  "loop_run_created",
  "loop_state_changed",
  "loop_plan_written",
  "loop_manifest_written",
  "loop_testing_plan_written",
  "loop_adapter_contract_written",
  "loop_adapter_started",
  "loop_adapter_completed",
  "loop_scope_checked",
  "loop_verification_completed",
  "loop_pr_requested",
  "loop_completed",
  "loop_failed",
  "loop_cancelled",
  "loop_cancel_requested",
  "loop_resume_requested",
  "loop_retry_requested",
  "loop_human_gate_required",
  "loop_human_gate_approved",
  "loop_human_gate_rejected",
  "loop_enqueued",
  "loop_claimed",
  "loop_heartbeat",
  "loop_released",
  "loop_timed_out",
  "loop_worker_started",
  "loop_worker_completed",
  "loop_worker_failed",
  "loop_worktree_cleanup_requested",
  "loop_worktree_cleanup_completed",
  "loop_worktree_cleanup_refused",
  "loop_worktree_review_written",
  "loop_worktree_promotion_requested",
  "loop_worktree_promotion_refused",
  "loop_worktree_promotion_planned",
  "loop_worktree_promotion_apply_requested",
  "loop_worktree_promotion_apply_checked",
  "loop_worktree_promotion_apply_refused",
  "loop_worktree_promotion_apply_succeeded",
  "loop_worktree_promotion_apply_failed",
  "loop_worktree_promotion_verify_requested",
  "loop_worktree_promotion_verify_started",
  "loop_worktree_promotion_verify_refused",
  "loop_worktree_promotion_verify_succeeded",
  "loop_worktree_promotion_verify_failed",
  "loop_worktree_promotion_pr_prep_requested",
  "loop_worktree_promotion_pr_prep_refused",
  "loop_worktree_promotion_pr_prep_written",
  "loop_worktree_promotion_commit_requested",
  "loop_worktree_promotion_commit_refused",
  "loop_worktree_promotion_commit_succeeded",
  "loop_worktree_promotion_commit_failed",
  "loop_worktree_promotion_push_plan_requested",
  "loop_worktree_promotion_push_plan_refused",
  "loop_worktree_promotion_push_plan_written",
  "loop_worktree_promotion_push_preflight_requested",
  "loop_worktree_promotion_push_preflight_refused",
  "loop_worktree_promotion_push_preflight_succeeded",
  "loop_worktree_promotion_push_preflight_failed",
  "loop_worktree_promotion_push_execute_requested",
  "loop_worktree_promotion_push_execute_refused",
  "loop_worktree_promotion_push_execute_started",
  "loop_worktree_promotion_push_execute_succeeded",
  "loop_worktree_promotion_push_execute_failed",
  "loop_worktree_promotion_pr_create_prep_requested",
  "loop_worktree_promotion_pr_create_prep_refused",
  "loop_worktree_promotion_pr_create_prep_written",
  "loop_worktree_promotion_pr_create_execute_requested",
  "loop_worktree_promotion_pr_create_execute_refused",
  "loop_worktree_promotion_pr_create_execute_started",
  "loop_worktree_promotion_pr_create_execute_succeeded",
  "loop_worktree_promotion_pr_create_execute_failed",
  "loop_worktree_promotion_pr_merge_prep_requested",
  "loop_worktree_promotion_pr_merge_prep_refused",
  "loop_worktree_promotion_pr_merge_prep_ready",
  "loop_worktree_promotion_pr_merge_prep_blocked",
  "loop_worktree_promotion_pr_merge_execute_requested",
  "loop_worktree_promotion_pr_merge_execute_refused",
  "loop_worktree_promotion_pr_merge_execute_started",
  "loop_worktree_promotion_pr_merge_execute_succeeded",
  "loop_worktree_promotion_pr_merge_execute_failed",
];

export const LOOP_TERMINAL_STATES = ["completed", "failed", "cancelled", "timed_out"];
export const LOOP_RESUMABLE_STATES = ["failed", "cancelled", "awaiting_human", "timed_out"];
export const LOOP_ENQUEUEABLE_STATES = ["planned", "failed", "cancelled", "timed_out", "queued"];
export const LOOP_HUMAN_GATE_STATES = ["none", "requested", "approved", "rejected", "expired"];
export const LOOP_DEFAULT_LEASE_MS = 60000;

const LOOP_REGISTRY_LOCK_TIMEOUT_MS = 5000;
const LOOP_REGISTRY_LOCK_STALE_MS = 30000;
const LOOP_REGISTRY_RENAME_RETRY_MS = 1000;
const LOOP_QUEUE_PRIORITY_RANK = {
  p0: -1,
  high: 0,
  p1: 1,
  normal: 1,
  medium: 2,
  p2: 2,
  low: 3,
  p3: 3,
};

function option(args, name) {
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  return args[index + 1];
}

function fail(message) {
  throw new Error(message);
}

function list(items) {
  return items.length > 0 ? items.map((item) => `- ${item}`).join("\n") : "- None.";
}

function normalizePath(path) {
  return path.replace(/\\/g, "/");
}
export function createLoopRegistryEntry({ runId, issue, repo, branch, adapter, apply, verify, openPr, runDir, createdAt }) {
  const relativeRunDir = relativeRepoPath(runDir);
  return {
    runId,
    issue: String(issue),
    repo: repo ?? null,
    branch,
    adapter: adapter.name,
    state: "created",
    apply,
    verify,
    openPr,
    runDir: relativeRunDir,
    eventLog: `${relativeRunDir}/events.jsonl`,
    createdAt,
    updatedAt: createdAt,
    attempts: 1,
    workerId: null,
    heartbeatAt: null,
    leaseExpiresAt: null,
    timeoutAt: null,
    queuePriority: null,
    prNumber: null,
    humanApproval: null,
    humanGate: null,
    evidence: emptyLoopEvidence(),
    lastError: null,
  };
}

export function emptyLoopEvidence() {
  return {
    manifest: null,
    codePlan: null,
    testingPlan: null,
    testingPlanJson: null,
    adapterContract: null,
    adapterResult: null,
    scopeCheck: null,
    scopeCheckJson: null,
    verification: null,
    prBody: null,
    workerLog: null,
    workerResult: null,
  };
}

export function writeLoopWorkerEvidence(entry, result) {
  const runDir = resolve(repoRoot, entry.runDir);
  const logPath = resolve(runDir, "worker-log.md");
  const resultPath = resolve(runDir, "worker-result.json");
  const log = `# Loop Worker Log

Run: ${entry.runId}
Worker: ${result.workerId}
Mode: ${result.mode}
Status: ${result.status}
Started: ${result.startedAt}
Completed: ${result.completedAt}

## Summary

${result.summary}

## Error

${result.error ?? "none"}
`;
  writeFileSync(logPath, log, "utf8");
  writeFileSync(resultPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  return {
    workerLog: loopRunPath(entry.runId, "worker-log.md"),
    workerResult: loopRunPath(entry.runId, "worker-result.json"),
  };
}

export function updateLoopRun(entry, updates, message) {
  const previousState = entry.state;
  const nextEntry = {
    ...entry,
    ...updates,
    evidence: {
      ...entry.evidence,
      ...(updates.evidence ?? {}),
    },
    updatedAt: new Date().toISOString(),
  };
  mergeLoopRegistryEntry(nextEntry);
  if (updates.state && updates.state !== previousState) {
    appendLoopEvent(nextEntry, "loop_state_changed", updates.state, message, { from: previousState, to: updates.state });
  }
  return nextEntry;
}

export function updateLoopEvidence(entry, evidence) {
  const nextEntry = {
    ...entry,
    evidence: {
      ...entry.evidence,
      ...evidence,
    },
    updatedAt: new Date().toISOString(),
  };
  mergeLoopRegistryEntry(nextEntry);
  return nextEntry;
}

export function createLoopHumanGate({ reason, risk, scope, requestedAction, requestedBy, expiresAt, evidence }) {
  const requestedAt = new Date().toISOString();
  return {
    gateId: `gate-${requestedAt.replace(/[:.]/g, "-")}-${Math.random().toString(16).slice(2, 8)}`,
    state: "requested",
    reason,
    risk,
    scope,
    requestedAction,
    requestedBy,
    requestedAt,
    approvedBy: null,
    approvedAt: null,
    rejectedBy: null,
    rejectedAt: null,
    expiresAt,
    evidence,
  };
}

export function applyLoopHumanGate(entry, gate, message) {
  const updated = updateLoopRun(entry, { state: "awaiting_human", humanGate: gate, lastError: gate.reason }, message);
  appendLoopEvent(updated, "loop_human_gate_required", "awaiting_human", message, {
    gateId: gate.gateId,
    reason: gate.reason,
    risk: gate.risk,
    scope: gate.scope,
    requestedAction: gate.requestedAction,
    requestedBy: gate.requestedBy,
    expiresAt: gate.expiresAt,
    evidence: gate.evidence,
  });
  return updated;
}

export function claimLoopRun({ workerId, runId, leaseMs }) {
  return withLoopRegistryLock(() => {
    const registry = readLoopRegistry();
    const candidates = (registry.runs ?? [])
      .filter((run) => run.state === "queued")
      .filter((run) => !runId || run.runId === runId)
      .sort(compareQueuedLoopRuns);
    const entry = candidates[0];
    if (!entry) return null;
    const nowMs = Date.now();
    const now = new Date(nowMs).toISOString();
    const claimed = {
      ...entry,
      state: "claimed",
      workerId,
      heartbeatAt: now,
      leaseExpiresAt: new Date(nowMs + leaseMs).toISOString(),
      updatedAt: now,
      lastError: null,
    };
    const runs = registry.runs.filter((run) => run.runId !== claimed.runId);
    runs.push(claimed);
    writeLoopRegistry({ version: LOOP_REGISTRY_VERSION, runs });
    return claimed;
  });
}

export function heartbeatLoopRun({ runId, workerId, leaseMs }) {
  return withLoopRegistryLock(() => {
    const registry = readLoopRegistry();
    const entry = registry.runs.find((run) => run.runId === runId);
    if (!entry) fail(`Loop run not found: ${runId}`);
    if (entry.state !== "claimed") {
      fail(`Cannot heartbeat loop run from state ${entry.state}.`);
    }
    assertLoopWorker(entry, workerId);
    const nowMs = Date.now();
    const now = new Date(nowMs).toISOString();
    const heartbeat = {
      ...entry,
      heartbeatAt: now,
      leaseExpiresAt: new Date(nowMs + leaseMs).toISOString(),
      updatedAt: now,
    };
    const runs = registry.runs.filter((run) => run.runId !== heartbeat.runId);
    runs.push(heartbeat);
    writeLoopRegistry({ version: LOOP_REGISTRY_VERSION, runs });
    return heartbeat;
  });
}

export function releaseLoopRun({ runId, workerId, toState, reason }) {
  return withLoopRegistryLock(() => {
    const registry = readLoopRegistry();
    const entry = registry.runs.find((run) => run.runId === runId);
    if (!entry) fail(`Loop run not found: ${runId}`);
    if (entry.state !== "claimed") {
      fail(`Cannot release loop run from state ${entry.state}.`);
    }
    assertLoopWorker(entry, workerId);
    const now = new Date().toISOString();
    const released = {
      ...entry,
      state: toState,
      workerId: null,
      heartbeatAt: null,
      leaseExpiresAt: null,
      timeoutAt: toState === "planned" ? null : entry.timeoutAt ?? null,
      queuePriority: toState === "planned" ? null : entry.queuePriority ?? "normal",
      updatedAt: now,
      lastError: null,
    };
    const runs = registry.runs.filter((run) => run.runId !== released.runId);
    runs.push(released);
    writeLoopRegistry({ version: LOOP_REGISTRY_VERSION, runs });
    return released;
  });
}

export function timeoutExpiredLoopRuns() {
  return withLoopRegistryLock(() => {
    const registry = readLoopRegistry();
    const nowMs = Date.now();
    const timedOut = [];
    const runs = (registry.runs ?? []).map((entry) => {
      if (entry.state !== "claimed") return entry;
      const leaseMs = Date.parse(entry.leaseExpiresAt ?? "");
      if (!Number.isFinite(leaseMs) || leaseMs > nowMs) return entry;
      const updatedAt = new Date(nowMs).toISOString();
      const expired = {
        ...entry,
        state: "timed_out",
        updatedAt,
        lastError: `Worker lease expired at ${entry.leaseExpiresAt}.`,
      };
      timedOut.push(expired);
      return expired;
    });
    if (timedOut.length > 0) {
      writeLoopRegistry({ version: LOOP_REGISTRY_VERSION, runs });
    }
    return timedOut;
  });
}

export function assertLoopWorker(entry, workerId) {
  if (entry.workerId !== workerId) {
    fail(`Worker ${workerId} does not own loop run ${entry.runId}. Current worker: ${entry.workerId ?? "none"}.`);
  }
}

export function compareQueuedLoopRuns(left, right) {
  const leftPriority = loopQueuePriorityRank(left.queuePriority);
  const rightPriority = loopQueuePriorityRank(right.queuePriority);
  if (leftPriority !== rightPriority) return leftPriority - rightPriority;
  const leftTimeout = Date.parse(left.timeoutAt ?? "") || Number.POSITIVE_INFINITY;
  const rightTimeout = Date.parse(right.timeoutAt ?? "") || Number.POSITIVE_INFINITY;
  if (leftTimeout !== rightTimeout) return leftTimeout - rightTimeout;
  return String(left.createdAt ?? left.updatedAt ?? left.runId).localeCompare(String(right.createdAt ?? right.updatedAt ?? right.runId));
}

export function loopQueuePriorityRank(priority) {
  return LOOP_QUEUE_PRIORITY_RANK[String(priority ?? "normal").toLowerCase()] ?? LOOP_QUEUE_PRIORITY_RANK.normal;
}

export function normalizeLoopQueuePriority(priority) {
  const normalized = String(priority ?? "normal").trim().toLowerCase();
  if (!Object.prototype.hasOwnProperty.call(LOOP_QUEUE_PRIORITY_RANK, normalized)) {
    fail(`Invalid --priority ${priority}. Expected one of: ${Object.keys(LOOP_QUEUE_PRIORITY_RANK).join(", ")}.`);
  }
  return normalized;
}

export function optionalPositiveInteger(args, name) {
  const value = option(args, name);
  if (value === undefined) return null;
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) {
    fail(`${name} must be a positive integer.`);
  }
  return number;
}

export function appendLoopEvent(entry, type, state, message, data = {}) {
  const event = {
    id: `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`,
    runId: entry.runId,
    type,
    state,
    createdAt: new Date().toISOString(),
    message,
    data,
  };
  const eventLog = resolve(repoRoot, entry.eventLog);
  mkdirSync(dirname(eventLog), { recursive: true });
  writeFileSync(eventLog, `${JSON.stringify(event)}\n`, { encoding: "utf8", flag: "a" });
}

export function readLoopEvents(entry) {
  const eventLog = resolve(repoRoot, entry.eventLog);
  if (!existsSync(eventLog)) return [];
  return readLoopEventsFile(eventLog);
}

export function readLoopEventsFile(eventLog) {
  return readFileSync(eventLog, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return { type: "invalid_event", message: line };
      }
    });
}

export function rebuildLoopRegistryFromEvents() {
  const runsRoot = resolve(repoRoot, ".myagenttool/runs");
  if (!existsSync(runsRoot)) return { version: LOOP_REGISTRY_VERSION, runs: [] };
  const runs = [];
  for (const name of readdirSync(runsRoot)) {
    const runDir = resolve(runsRoot, name);
    if (!safeIsDirectory(runDir)) continue;
    const eventLog = resolve(runDir, "events.jsonl");
    if (!existsSync(eventLog)) continue;
    const events = readLoopEventsFile(eventLog);
    const entry = registryEntryFromEvents({ runId: name, runDir, events });
    if (entry) runs.push(entry);
  }
  runs.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  return { version: LOOP_REGISTRY_VERSION, runs };
}

export function registryEntryFromEvents({ runId, runDir, events }) {
  const created = events.find((event) => event.type === "loop_run_created");
  const codePlan = readOptionalJson(resolve(runDir, "code-plan.json"));
  const context = readOptionalJson(resolve(runDir, "context.json"));
  const adapterContract = readOptionalJson(resolve(runDir, "coding-adapter-contract.json"));
  const manifest = existsSync(resolve(runDir, "manifest.md")) ? loopRunPath(runId, "manifest.md") : null;
  const testingPlan = existsSync(resolve(runDir, "testing-plan.md")) ? loopRunPath(runId, "testing-plan.md") : null;
  const testingPlanJson = existsSync(resolve(runDir, "testing-plan.json")) ? loopRunPath(runId, "testing-plan.json") : null;
  const scopeCheck = existsSync(resolve(runDir, "scope-check.md")) ? loopRunPath(runId, "scope-check.md") : null;
  const scopeCheckJson = existsSync(resolve(runDir, "scope-check.json")) ? loopRunPath(runId, "scope-check.json") : null;
  const verification = existsSync(resolve(runDir, "verification.md")) ? loopRunPath(runId, "verification.md") : null;
  const prBody = existsSync(resolve(runDir, "pr-body.md")) ? loopRunPath(runId, "pr-body.md") : null;
  const adapterResult = existsSync(resolve(runDir, "coding-adapter-result.json")) ? loopRunPath(runId, "coding-adapter-result.json") : null;
  const workerLog = existsSync(resolve(runDir, "worker-log.md")) ? loopRunPath(runId, "worker-log.md") : null;
  const workerResult = existsSync(resolve(runDir, "worker-result.json")) ? loopRunPath(runId, "worker-result.json") : null;
  const issue = String(context?.issue ?? runId.match(/issue-(\d+)/)?.[1] ?? "");
  const adapter = context?.adapter?.name ?? adapterContract?.adapter?.name ?? created?.data?.adapter ?? "unknown";
  const apply = Boolean(created?.data?.apply ?? false);
  const verify = Boolean(created?.data?.verify ?? false);
  const openPr = Boolean(created?.data?.openPr ?? false);
  let state = "created";
  let branch = codePlan?.branch ?? context?.branch ?? created?.data?.branch ?? "";
  let lastError = null;
  let humanApproval = null;
  let humanGate = null;
  let workerId = null;
  let heartbeatAt = null;
  let leaseExpiresAt = null;
  let timeoutAt = null;
  let queuePriority = null;
  let updatedAt = created?.createdAt ?? new Date().toISOString();
  for (const event of events) {
    if (event.createdAt) updatedAt = event.createdAt;
    if (event.type === "loop_state_changed" && event.state) state = event.state;
    if (event.type === "loop_state_changed" && event.state === "planned") lastError = null;
    if (["loop_completed", "loop_failed", "loop_cancelled"].includes(event.type) && event.state) state = event.state;
    if (event.type === "loop_failed") lastError = event.data?.error ?? event.message ?? lastError;
    if (event.type === "loop_cancelled") lastError = event.data?.reason ?? event.message ?? lastError;
    if (event.type === "loop_cancelled") {
      workerId = null;
      heartbeatAt = null;
      leaseExpiresAt = null;
      timeoutAt = null;
      queuePriority = null;
    }
    if (event.type === "loop_resume_requested") {
      lastError = null;
      workerId = null;
      heartbeatAt = null;
      leaseExpiresAt = null;
      timeoutAt = null;
      queuePriority = null;
    }
    if (event.type === "loop_enqueued") {
      state = "queued";
      workerId = null;
      heartbeatAt = null;
      leaseExpiresAt = null;
      timeoutAt = event.data?.timeoutAt ?? null;
      queuePriority = event.data?.priority ?? event.data?.queuePriority ?? "normal";
      lastError = null;
    }
    if (event.type === "loop_claimed") {
      state = "claimed";
      workerId = event.data?.workerId ?? workerId;
      heartbeatAt = event.data?.heartbeatAt ?? event.createdAt;
      leaseExpiresAt = event.data?.leaseExpiresAt ?? leaseExpiresAt;
      lastError = null;
    }
    if (event.type === "loop_heartbeat") {
      heartbeatAt = event.data?.heartbeatAt ?? event.createdAt;
      leaseExpiresAt = event.data?.leaseExpiresAt ?? leaseExpiresAt;
    }
    if (event.type === "loop_released") {
      state = event.data?.toState ?? event.state ?? "queued";
      workerId = null;
      heartbeatAt = null;
      leaseExpiresAt = null;
      if (state === "planned") {
        timeoutAt = null;
        queuePriority = null;
      }
      lastError = null;
    }
    if (event.type === "loop_timed_out") {
      state = "timed_out";
      workerId = event.data?.workerId ?? workerId;
      heartbeatAt = event.data?.heartbeatAt ?? heartbeatAt;
      leaseExpiresAt = event.data?.leaseExpiresAt ?? leaseExpiresAt;
      lastError = event.message ?? lastError;
    }
    if (event.type === "loop_worker_started") {
      workerId = event.data?.workerId ?? workerId;
      lastError = null;
    }
    if (event.type === "loop_worker_completed") {
      state = "completed";
      workerId = null;
      heartbeatAt = null;
      leaseExpiresAt = null;
      timeoutAt = null;
      queuePriority = null;
      lastError = null;
    }
    if (event.type === "loop_worker_failed") {
      state = "failed";
      workerId = null;
      heartbeatAt = null;
      leaseExpiresAt = null;
      timeoutAt = null;
      queuePriority = null;
      lastError = event.data?.error ?? event.message ?? lastError;
    }
    if (event.type === "loop_human_gate_required") {
      humanGate = {
        gateId: event.data?.gateId ?? `gate-${runId}`,
        state: "requested",
        reason: event.data?.reason ?? event.message ?? "Human gate required.",
        risk: event.data?.risk ?? "medium",
        scope: event.data?.scope ?? "unspecified",
        requestedAction: event.data?.requestedAction ?? "Approve or reject.",
        requestedBy: event.data?.requestedBy ?? null,
        requestedAt: event.createdAt,
        approvedBy: null,
        approvedAt: null,
        rejectedBy: null,
        rejectedAt: null,
        expiresAt: event.data?.expiresAt ?? null,
        evidence: event.data?.evidence ?? null,
      };
      lastError = humanGate.reason;
    }
    if (event.type === "loop_human_gate_approved" && humanGate) {
      humanGate = {
        ...humanGate,
        state: "approved",
        approvedBy: event.data?.approvedBy ?? null,
        approvedAt: event.createdAt,
        evidence: event.data?.evidence ?? humanGate.evidence,
      };
      humanApproval = humanGate.approvedBy;
      lastError = null;
    }
    if (event.type === "loop_human_gate_rejected" && humanGate) {
      humanGate = {
        ...humanGate,
        state: "rejected",
        rejectedBy: event.data?.rejectedBy ?? null,
        rejectedAt: event.createdAt,
        evidence: event.data?.reason ?? humanGate.evidence,
      };
      lastError = humanGate.evidence;
    }
  }
  if (!issue) return null;
  return {
    runId,
    issue,
    repo: context?.repo ?? context?.repository ?? created?.data?.repo ?? null,
    branch,
    adapter,
    state,
    apply,
    verify,
    openPr,
    runDir: relativeRepoPath(runDir),
    eventLog: `${relativeRepoPath(runDir)}/events.jsonl`,
    createdAt: created?.createdAt ?? updatedAt,
    updatedAt,
    attempts: 1,
    workerId,
    heartbeatAt,
    leaseExpiresAt,
    timeoutAt,
    queuePriority,
    prNumber: null,
    humanApproval,
    humanGate,
    evidence: {
      manifest,
      codePlan: codePlan ? loopRunPath(runId, "code-plan.json") : null,
      testingPlan,
      testingPlanJson,
      adapterContract: adapterContract ? loopRunPath(runId, "coding-adapter-contract.json") : null,
      adapterResult,
      scopeCheck,
      scopeCheckJson,
      verification,
      prBody,
      workerLog,
      workerResult,
    },
    lastError,
  };
}

export function compareLoopRegistries(actual, rebuilt) {
  const actualRuns = new Map((actual.runs ?? []).map((run) => [run.runId, run]));
  const rebuiltRuns = new Map((rebuilt.runs ?? []).map((run) => [run.runId, run]));
  const missing = [...rebuiltRuns.keys()].filter((runId) => !actualRuns.has(runId));
  const extra = [...actualRuns.keys()].filter((runId) => !rebuiltRuns.has(runId));
  const drift = [];
  for (const [runId, expected] of rebuiltRuns) {
    const found = actualRuns.get(runId);
    if (!found) continue;
    for (const field of ["state", "issue", "repo", "branch", "adapter", "lastError", "humanApproval", "workerId", "heartbeatAt", "leaseExpiresAt", "timeoutAt", "queuePriority"]) {
      if ((found[field] ?? null) !== (expected[field] ?? null)) {
        drift.push({ runId, field, actual: found[field] ?? null, expected: expected[field] ?? null });
      }
    }
    const foundGate = found.humanGate ? `${found.humanGate.state}:${found.humanGate.gateId}` : null;
    const expectedGate = expected.humanGate ? `${expected.humanGate.state}:${expected.humanGate.gateId}` : null;
    if (foundGate !== expectedGate) {
      drift.push({ runId, field: "humanGate", actual: foundGate, expected: expectedGate });
    }
    for (const field of ["workerLog", "workerResult"]) {
      if ((found.evidence?.[field] ?? null) !== (expected.evidence?.[field] ?? null)) {
        drift.push({ runId, field: `evidence.${field}`, actual: found.evidence?.[field] ?? null, expected: expected.evidence?.[field] ?? null });
      }
    }
  }
  return {
    ok: missing.length === 0 && extra.length === 0 && drift.length === 0,
    registryRuns: actual.runs?.length ?? 0,
    rebuiltRuns: rebuilt.runs?.length ?? 0,
    missing,
    extra,
    drift,
  };
}

export function formatLoopRegistryCheck(result) {
  return `# Loop Registry Check

OK: ${result.ok ? "yes" : "no"}
Registry runs: ${result.registryRuns}
Rebuilt runs: ${result.rebuiltRuns}

Missing from registry:
${list(result.missing)}

Extra in registry:
${list(result.extra)}

Drift:
${result.drift.length > 0 ? result.drift.map((item) => `- ${item.runId} ${item.field}: actual=${item.actual ?? "null"} expected=${item.expected ?? "null"}`).join("\n") : "- None."}
`;
}

export function readOptionalJson(path) {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

export function safeIsDirectory(path) {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

export function readLoopRegistry(root = repoRoot) {
  const registryPath = loopRegistryPath(root);
  if (!existsSync(registryPath)) return { version: LOOP_REGISTRY_VERSION, runs: [] };
  try {
    const parsed = JSON.parse(readFileSync(registryPath, "utf8"));
    return {
      version: parsed.version ?? LOOP_REGISTRY_VERSION,
      runs: Array.isArray(parsed.runs) ? parsed.runs : [],
    };
  } catch {
    return { version: LOOP_REGISTRY_VERSION, runs: [] };
  }
}

export function upsertLoopRegistryEntry(entry) {
  withLoopRegistryLock(() => {
    const registry = readLoopRegistry();
    const runs = registry.runs.filter((run) => run.runId !== entry.runId);
    runs.push(entry);
    writeLoopRegistry({ version: LOOP_REGISTRY_VERSION, runs });
  });
}

export function mergeLoopRegistryEntry(entry) {
  withLoopRegistryLock(() => {
    const registry = readLoopRegistry();
    const existing = registry.runs.find((run) => run.runId === entry.runId);
    const merged = existing ? mergeLoopEntries(existing, entry) : entry;
    const runs = registry.runs.filter((run) => run.runId !== entry.runId);
    runs.push(merged);
    writeLoopRegistry({ version: LOOP_REGISTRY_VERSION, runs });
  });
}

export function mergeLoopEntries(existing, next) {
  return {
    ...existing,
    ...next,
    humanGate: next.humanGate ?? existing.humanGate ?? null,
    evidence: {
      ...(existing.evidence ?? emptyLoopEvidence()),
      ...(next.evidence ?? {}),
    },
    lastError: hasOwn(next, "lastError") ? next.lastError : existing.lastError ?? null,
    updatedAt: maxIso(existing.updatedAt, next.updatedAt),
  };
}

export function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value ?? {}, key);
}

export function maxIso(left, right) {
  if (!left) return right;
  if (!right) return left;
  return Date.parse(left) >= Date.parse(right) ? left : right;
}

export function writeLoopRegistry(registry) {
  const registryPath = loopRegistryPath();
  mkdirSync(dirname(registryPath), { recursive: true });
  const tempPath = `${registryPath}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tempPath, `${JSON.stringify(registry, null, 2)}\n`, "utf8");
  renameLoopRegistryTemp(tempPath, registryPath);
}

export function renameLoopRegistryTemp(tempPath, registryPath) {
  const startedAt = Date.now();
  while (true) {
    try {
      renameSync(tempPath, registryPath);
      return;
    } catch (error) {
      if (!["EPERM", "EACCES", "EBUSY"].includes(error?.code) || Date.now() - startedAt > LOOP_REGISTRY_RENAME_RETRY_MS) {
        throw error;
      }
      sleepSync(25);
    }
  }
}

export function findLoopRegistryEntry(runId, root = repoRoot) {
  return readLoopRegistry(root).runs.find((entry) => entry.runId === runId) ?? null;
}

export function requireLoopRegistryEntry(args) {
  const runId = option(args, "--run") ?? option(args, "--run-id");
  if (!runId) fail("Missing --run.");
  const entry = findLoopRegistryEntry(runId);
  if (!entry) fail(`Loop run not found: ${runId}`);
  return entry;
}

export function loopRegistryPath(root = repoRoot) {
  return resolve(root, ".myagenttool/runs/registry.json");
}

export function loopRegistryLockPath() {
  return resolve(repoRoot, ".myagenttool/runs/registry.lock");
}

export function withLoopRegistryLock(callback) {
  mkdirSync(dirname(loopRegistryLockPath()), { recursive: true });
  const startedAt = Date.now();
  while (true) {
    let fd = null;
    try {
      fd = openSync(loopRegistryLockPath(), "wx");
      writeFileSync(fd, `${process.pid}\n${new Date().toISOString()}\n`, "utf8");
      try {
        return callback();
      } finally {
        closeSync(fd);
        rmSync(loopRegistryLockPath(), { force: true });
      }
    } catch (error) {
      if (fd !== null) {
        try {
          closeSync(fd);
        } catch {
          // best effort close before retrying
        }
      }
      if (error?.code !== "EEXIST") throw error;
      if (isLoopRegistryLockStale()) {
        rmSync(loopRegistryLockPath(), { force: true });
        continue;
      }
      if (Date.now() - startedAt > LOOP_REGISTRY_LOCK_TIMEOUT_MS) {
        throw new Error("Timed out waiting for loop registry lock.");
      }
      sleepSync(25);
    }
  }
}

export function isLoopRegistryLockStale() {
  try {
    const content = readFileSync(loopRegistryLockPath(), "utf8");
    const createdAt = content.split(/\r?\n/)[1];
    const createdMs = Date.parse(createdAt);
    return Number.isFinite(createdMs) && Date.now() - createdMs > LOOP_REGISTRY_LOCK_STALE_MS;
  } catch {
    return false;
  }
}

export function sleepSync(ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    // Small synchronous wait keeps this single-file CLI dependency-free.
  }
}

export function loopRunPath(runId, file) {
  return `.myagenttool/runs/${runId}/${file}`;
}

export function relativeRepoPath(path) {
  return normalizePath(path.replace(repoRoot, "")).replace(/^\/+/, "");
}

export function formatLoopRun(entry, events) {
  const evidenceLines = Object.entries(entry.evidence ?? {})
    .map(([key, value]) => `- ${key}: ${value ?? "not recorded"}`)
    .join("\n");
  const eventLines = events.length > 0
    ? events.map((event) => `- ${event.createdAt} ${event.type} [${event.state}]: ${event.message}`).join("\n")
    : "- No events recorded.";
  return `# Loop Run ${entry.runId}

State: ${entry.state}
Issue: #${entry.issue}
Repo: ${entry.repo ?? "not recorded"}
Branch: ${entry.branch || "not recorded"}
Adapter: ${entry.adapter}
Apply: ${entry.apply ? "yes" : "no"}
Verify: ${entry.verify ? "yes" : "no"}
Open PR: ${entry.openPr ? "yes" : "no"}
Created: ${entry.createdAt}
Updated: ${entry.updatedAt}
Worker: ${entry.workerId ?? "none"}
Heartbeat: ${entry.heartbeatAt ?? "none"}
Lease expires: ${entry.leaseExpiresAt ?? "none"}
Timeout: ${entry.timeoutAt ?? "none"}
Queue priority: ${entry.queuePriority ?? "none"}
Last error: ${entry.lastError ?? "none"}
Human gate: ${formatHumanGateSummary(entry.humanGate)}

## Evidence

${evidenceLines}

## Events

${eventLines}
`;
}

export function formatHumanGateSummary(gate) {
  if (!gate) return "none";
  return `${gate.state} ${gate.gateId} (${gate.risk}) ${gate.reason}`;
}


