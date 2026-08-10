const APPLICATION_RUNNING = new Set(["queued", "dispatching", "running"]);
const APPLICATION_APPROVAL = new Set(["waiting_for_local_approval", "awaiting_approval"]);
const APPLICATION_FAILED = new Set(["failed", "timed_out", "cancelled", "rejected"]);
const AUTO_RUN_RUNNING = new Set(["materializing", "running", "waiting_capacity", "publishing"]);
const AUTO_RUN_APPROVAL = new Set(["awaiting_approval", "needs_input"]);
const AUTO_RUN_VERIFYING = new Set(["verifying", "pr_open", "report_posted", "plan_proposed"]);
const AUTO_RUN_FAILED = new Set(["blocked", "failed", "cancelled"]);
const AUTO_RUN_COMPLETED = new Set(["done", "decomposed"]);
const ARTICLE_IMPORT_RUNNING = new Set(["queued", "running"]);
const ARTICLE_IMPORT_FAILED = new Set(["failed", "canceled"]);

function parsedTimestamp(value) {
  const parsed = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Return the single newest executable binding. `createdAt` wins when present;
 * append order is the durable fallback for legacy bindings without timestamps.
 */
export function latestWorkItemExecutionBinding(item) {
  return (item.executionBindings ?? [])
    .map((binding, index) => ({ binding, index, createdAt: parsedTimestamp(binding.createdAt) }))
    .filter(({ binding }) => ["application_invocation", "auto_run", "article_import", "article_derivative"].includes(binding.kind))
    .sort((left, right) => {
      if (left.createdAt != null && right.createdAt != null && left.createdAt !== right.createdAt) {
        return right.createdAt - left.createdAt;
      }
      return right.index - left.index;
    })[0]?.binding ?? null;
}

function articleImportExecutionState(job) {
  if (ARTICLE_IMPORT_RUNNING.has(job.state)) return "running";
  if (ARTICLE_IMPORT_FAILED.has(job.state)) return "failed";
  if (job.state === "completed") return "completed";
  return null;
}

function applicationExecutionState(invocation) {
  if (APPLICATION_RUNNING.has(invocation.status)) return "running";
  if (APPLICATION_APPROVAL.has(invocation.status)) return "awaiting_approval";
  if (invocation.status === "verifying") return "verifying";
  if (APPLICATION_FAILED.has(invocation.status)) return "failed";
  if (invocation.status === "succeeded") return "completed";
  return null;
}

function autoRunExecutionState(autoRun) {
  if (AUTO_RUN_RUNNING.has(autoRun.status)) return "running";
  if (AUTO_RUN_APPROVAL.has(autoRun.status)) return "awaiting_approval";
  if (AUTO_RUN_VERIFYING.has(autoRun.status)) return "verifying";
  if (AUTO_RUN_FAILED.has(autoRun.status)) return "failed";
  if (AUTO_RUN_COMPLETED.has(autoRun.status)) return "completed";
  return null;
}

export function resolveWorkItemExecution(item, state, { now = Date.now() } = {}) {
  const binding = latestWorkItemExecutionBinding(item);
  const autoRun = binding?.kind === "auto_run"
    ? (state.autoRuns ?? []).find((candidate) => candidate.id === binding.targetId) ?? null
    : null;
  const articleImport = binding?.kind === "article_import"
    ? (state.articleImportJobs ?? []).find((candidate) => candidate.id === binding.targetId) ?? null
    : null;
  const articleDerivativeInvocation = binding?.kind === "article_derivative"
    ? (state.invocations ?? []).find((candidate) =>
      candidate.options?.metadata?.articleDerivative?.id === binding.targetId
      && candidate.options?.metadata?.articleDerivative?.workItemId === item.id) ?? null
    : null;
  const invocationId = binding?.kind === "application_invocation"
    ? binding.id ?? binding.targetId ?? null
    : binding?.kind === "article_derivative"
      ? articleDerivativeInvocation?.id ?? null
      : autoRun?.invocationId ?? null;
  const invocation = invocationId
    ? (state.invocations ?? []).find((candidate) => candidate.id === invocationId) ?? null
    : null;
  const agentId = autoRun?.agentId ?? invocation?.agentId ?? null;
  const agent = agentId
    ? (state.agents ?? []).find((candidate) => candidate.id === agentId) ?? null
    : null;
  const approval = invocationId
    ? [...(state.approvalRequests ?? [])].reverse()
      .find((candidate) => candidate.invocationId === invocationId) ?? null
    : null;

  let executionState = null;
  if (binding?.kind === "application_invocation" && invocation) {
    executionState = applicationExecutionState(invocation);
  } else if (binding?.kind === "auto_run" && autoRun) {
    executionState = autoRunExecutionState(autoRun);
  } else if (binding?.kind === "article_import" && articleImport) {
    executionState = articleImportExecutionState(articleImport);
  } else if (binding?.kind === "article_derivative" && invocation) {
    executionState = applicationExecutionState(invocation);
  }
  // A durable binding whose target disappeared or whose status is unknown is
  // recovery work, never an apparently unclaimed task.
  if (binding && !executionState) executionState = "failed";
  if (!executionState) {
    const nowMs = typeof now === "number" ? now : Date.parse(now);
    const leaseMs = Date.parse(item.claim?.leaseExpiresAt ?? "");
    const claimActive = item.claim?.status === "active"
      && Number.isFinite(leaseMs)
      && leaseMs > nowMs;
    executionState = claimActive ? "claimed" : "unclaimed";
  }

  return { binding, autoRun, articleImport, invocation, agent, approval, executionState };
}
