export type GithubItem = {
  type: "issue" | "pr";
  number: number;
  title: string;
  headRefName: string | null;
  author: string;
  url: string | null;
  state: string;
};
export type GithubResult = { available: boolean; message: string; items: GithubItem[] };
export type WorkItemExecutionState = "unclaimed" | "claimed" | "running" | "awaiting_approval" | "verifying" | "failed" | "completed";
export type WorkItemRequesterRelation = "boss" | "manager" | "customer" | "child" | "colleague" | "self" | "unknown";
export type WorkItemIntakeChannel = "manual" | "meeting" | "email" | "chat" | "phone" | "github" | "import" | "other" | "unknown";
export type WorkItemWaitingOn = "me" | "requester" | "internal" | "ai" | "none";
export type ExternalWorkItemBinding = {
  kind: "github_issue" | "gitlab_issue" | "gitea_issue";
  provider?: "github" | "gitlab" | "gitea";
  resourceType?: "issue";
  relation?: "source" | "related" | "duplicate" | "parent" | "blocks";
  isPrimary?: boolean;
  syncPolicy?: "manual" | "webhook_pull" | "bidirectional";
  linkedAt?: string | null;
  linkedBy?: string | null;
  externalId?: string;
  bindingId?: string;
  number: number; url: string | null; lastSyncedAt: string;
  conflict: null | { fields: string[]; local: Record<string, unknown>; remote: Record<string, unknown> };
};
export type LocalWorkItem = {
  id: string;
  localRef: string;
  projectId: string;
  title: string;
  body: string;
  type: "task" | "bug" | "feature" | "initiative";
  status: "backlog" | "ready" | "in_progress" | "review" | "blocked" | "done";
  priority: "p0" | "p1" | "p2" | "p3";
  executionPolicy?: "inherit" | "auto" | "manual" | "paused";
  state: "open" | "closed";
  businessState?: "open" | "closed";
  planningStatus?: LocalWorkItem["status"];
  executionState?: WorkItemExecutionState;
  statusModel?: {
    business: "open" | "closed";
    planning: LocalWorkItem["status"];
    execution: WorkItemExecutionState;
  };
  labels: string[];
  assigneeIds: string[];
  followUpSchemaVersion: 1;
  requesterRelation: WorkItemRequesterRelation;
  requesterName: string | null;
  requesterOrganization: string | null;
  requesterUserId: string | null;
  intakeChannel: WorkItemIntakeChannel;
  externalReference: string | null;
  waitingOn: WorkItemWaitingOn;
  commitmentDate: string | null;
  nextFollowUpAt: string | null;
  lastProgressAt: string | null;
  lastProgressSummary: string | null;
  acceptanceCriteria: string[];
  acceptanceCriteriaSource?: "manual" | "body_extracted" | "assisted" | "structured" | "body_unstructured" | null;
  verificationSop?: string[];
  executionContractSource?: "manual" | "body_extracted" | "assisted" | null;
  executionContractConfirmedAt?: string | null;
  executionContractGate?: {
    ready: boolean;
    missing: ("acceptance_criteria" | "verification_sop" | "confirmation" | "confirmed_before_execution")[];
    source: string | null;
    confirmedAt: string | null;
    latestAttemptStartedAt?: string | null;
  };
  reviewContract?: {
    schemaVersion: "legacy-v1" | "execution-contract-v2" | string;
    id: string;
    workItemId: string;
    workItemRevision: number | null;
    autoRunId: string | null;
    acceptanceCriteria: string[];
    verificationSop: string[];
    confirmedBy: string | null;
    confirmedAt: string | null;
    digest: string | null;
    readOnly: true;
  } | null;
  reviewEvidence?: {
    criterion: string;
    status: "passed" | "failed" | "not_tested";
    note: string;
    verificationId: string | null;
    command: string | null;
    verificationSummary: string | null;
    evidence: { kind: string; ref: string; summary: string; assetId?: string | null; hash?: string | null; version?: string | null; terminalId?: string | null }[];
    sourceAutoRunId: string | null;
    reviewedBy: string | null;
    reviewedAt: string | null;
  }[];
  acceptanceResults?: { criterion: string; status: "passed" | "failed" | "not_tested"; note: string; verificationId: string }[];
  verificationRecords?: {
    id: string; kind: "test" | "lint" | "typecheck" | "manual" | "review";
    status: "passed" | "failed"; command: string | null; summary: string;
    evidence: { kind: string; ref: string; summary: string; assetId?: string | null; hash?: string | null; version?: string | null; terminalId?: string | null }[]; recordedAt: string; recordedBy: string; sourceAutoRunId?: string | null;
  }[];
  inputAssets?: WorkItemAssetRef[];
  materialChangesPending?: boolean;
  outputAssets?: WorkItemAssetRef[];
  requiredCapabilities?: string[];
  assetReadiness?: { state: "ready" | "waiting_capability" | "refused"; reason: string; terminalId: string };
  queueReadiness?: {
    state: "ready" | "waiting_capability" | "waiting_approval" | "waiting_capacity" | "refusal";
    reason: string; terminalId: string | null;
  };
  applicationResolutions?: {
    state: "ready" | "waiting_capability" | "waiting_approval" | "waiting_capacity" | "refusal";
    terminalId: string; applicationId: string | null; label: string | null;
    reason: string; durationMs: number | null;
  }[];
  assetOperations?: {
    id: string; capability: string; inputAssetId: string; outputAssetId: string | null;
    invocationId: string | null; approvalId: string | null; terminalId: string; traceId: string;
    summary: string; recordedAt: string;
  }[];
  completionGate?: { ready: boolean; missingCriteria: string[]; verificationRequired: boolean };
  dueDate: string | null;
  notBefore?: string | null;
  plannedDate?: string | null;
  carriedFromDate?: string | null;
  schedulePlanSource?: "manual" | "auto_plan" | "rollover" | "urgent_insert" | null;
  scheduleReason?: string | null;
  scheduleOrder?: number | null;
  completedAt?: string | null;
  milestone: string;
  estimatePoints: number;
  revision: number;
  archivedAt: string | null;
  executionBindings?: {
    kind: "worktree" | "auto_run" | "application_invocation" | "article_import" | "article_derivative";
    targetId?: string; id?: string; worktreeId?: string | null; createdAt: string;
    terminalId?: string; applicationId?: string; capabilityId?: string; traceId?: string;
  }[];
  externalBindings?: ExternalWorkItemBinding[];
  planningProjects?: { id: string; name: string; archivedAt: string | null }[];
  dependencyIds?: string[];
  routineDefinitionId?: string;
  routineVersion?: number;
  routineBindingSchemaVersion?: number;
  businessCaseId?: string;
  businessKey?: string;
  triggerArtifactIds?: string[];
  parentId?: string | null;
  parent?: { id: string; localRef: string; title: string; status: LocalWorkItem["status"]; state: "open" | "closed" } | null;
  subIssues?: { id: string; localRef: string; title: string; status: LocalWorkItem["status"]; state: "open" | "closed" }[];
  subIssuesSummary?: { total: number; completed: number; percentCompleted: number };
  blockedBy?: { id: string; localRef: string; title: string; status: LocalWorkItem["status"]; state: "open" | "closed"; resolved: boolean }[];
  blocks?: { id: string; localRef: string; title: string; status: LocalWorkItem["status"]; state: "open" | "closed" }[];
  createdAt?: string;
  updatedAt: string;
};
export type WorkItemAssetRef = {
  id: string | null;
  originalName?: string;
  path: string;
  family: string;
  mimeType?: string | null;
  terminalId: string;
  size?: number | null;
  resourceClass?: "small" | "medium" | "large" | "unknown";
  hash: string | null;
  version: string | null;
  worktreeId?: string | null;
  capabilities: string[];
  readiness: { state: "ready" | "waiting_capability"; reason: string };
};
export type LocalWorkItemResult = {
  workItems: LocalWorkItem[];
  count: number;
  nextCursor?: string | null;
  hasMore?: boolean;
};
export type PlanningAutoRun = { id: string; status: string };
export type WorkItemAutoRunBatch = {
  id: string;
  status: "queued" | "running" | "completed" | "completed_with_failures" | "cancelled";
  maxConcurrent: number;
  agentId: string | null;
  total: number;
  completed: number;
  active: number;
  counts: Record<string, number>;
  items: {
    workItemId: string;
    localRef: string;
    title: string;
    status: string;
    autoRunId: string | null;
    error: string | null;
  }[];
  createdAt: string;
  updatedAt: string;
  finishedAt: string | null;
};
export type PlanningProject = {
  id: string;
  name: string;
  description: string;
  color?: string;
  revision: number;
  archivedAt: string | null;
  autonomyProfile?: "cautious" | "standard" | "high";
  aiHealth?: {
    active: number;
    failed: number;
    blocked: number;
    overdue: number;
    needsAttention: boolean;
    settled?: number;
    successRate?: number | null;
    routingCorrectionRate?: number | null;
    knownCostUsd?: number;
    alertBacklog?: number;
    traceCoverage?: number | null;
    sloStatus?: "insufficient_data" | "healthy" | "at_risk";
    signals?: string[];
    targets?: { successRate: number; maxRoutingCorrectionRate: number; maxAlertBacklog: number };
  };
  updatedAt?: string;
  pinned?: boolean;
  watching?: boolean;
  itemCount: number;
  openItemCount: number;
  completedItemCount: number;
  statusCounts: Record<LocalWorkItem["status"], number>;
  priorityCounts: Record<LocalWorkItem["priority"], number>;
  blockedItemCount?: number;
  overdueItemCount?: number;
  activeRunCount?: number;
  failedRunCount?: number;
  riskScore?: number;
  recommendedActions?: { code: string; count: number; risk: "low" | "medium" | "high"; approvalRequired: boolean }[];
  plannedPoints?: number;
  capacityPoints?: number;
  overCapacity?: boolean;
  capacityUtilization?: number | null;
  startDate?: string | null;
  targetDate?: string | null;
  projectOverdue?: boolean;
  daysRemaining?: number | null;
  ownerId?: string | null;
  unowned?: boolean;
  status?: "planned" | "active" | "on_hold" | "completed";
  tags?: string[];
  statusSummary?: string;
  statusUpdatedAt?: string | null;
  daysSinceStatusUpdate?: number | null;
  staleStatus?: boolean;
  checkIns?: { id: string; summary: string; authorId: string; createdAt: string }[];
  health?: "healthy" | "active" | "attention";
  savedViews?: {
    id: string;
    name: string;
    view: "list" | "board" | "roadmap" | "insights" | "executions";
    filters: { status: string; priority: string; milestone: string; due: "all" | "overdue" | "upcoming" | "month" | "quarter" | "unscheduled" };
  }[];
  automationRules?: { id: string; status: string; priority: string; type: string; label: string }[];
  activity?: { id: string; action: string; actorId: string; createdAt: string; details: Record<string, unknown> }[];
  items?: { membership: { position: number }; workItem: LocalWorkItem }[];
};
export type WorkItemComment = {
  id: string;
  body: string | null;
  revision: number;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  deletedAt: string | null;
};
export type WorkItemActivity = {
  id: string;
  action: string;
  actorId: string;
  createdAt: string;
  details: Record<string, unknown>;
};
export type WorkItemAttention = {
  id: string;
  kind: "github_conflict" | "github_deleted" | "execution_approval" | "verification_failed" | "acceptance_blocked" | "recommended_action_approval" | "governed_action";
  severity: "low" | "medium" | "high";
  workItemId: string | null;
  planningProjectId?: string | null;
  localRef: string | null;
  title: string;
  createdAt: string;
  updatedAt?: string;
  dueAt: string;
  slaStatus: "within_sla" | "breached";
  history: { action: string; actorId: string; createdAt: string }[];
  handling: { actorId: string; claimedAt: string; expiresAt?: string } | null;
  resolution: { actorId: string; resolvedAt: string; note: string } | null;
  details: Record<string, unknown>;
};
export type WorkItemAttentionMetrics = {
  backlog: number;
  breached: number;
  claimed: number;
  pendingApprovals: number;
  oldestAgeSeconds: number;
};
export type LocalWorkItemAutoRun = {
  id: string;
  status: string;
  phase?: "queued" | "understanding" | "waiting_for_input" | "planning" | "implementing" | "verifying" | "review_ready" | "failed" | "cancelled" | null;
  updatedAt: string;
  invocationId?: string | null;
  agentId?: string | null;
  understandingContext?: {
    version: string;
    digest: string;
    documentPaths: string[];
    relatedFiles: { path: string; line: number; term: string }[];
    similarTasks: { localRef: string | null; title: string; score: number }[];
    verificationCommand: string[];
    truncated: boolean;
    redactions?: number;
  } | null;
  decision?: {
    path: string; decidedBy: string; confidence: number; rationale?: string | null;
    via?: string | null; latencyMs?: number | null; clarifyingQuestions?: string[] | null;
    suggestedActions?: Array<{ id: string; label: string; description?: string; payload?: { repoUrl?: string } | null }> | null;
    evidence?: { policyVersion: string; modelVersion: string | null; minConfidence: number; inputDigest: string } | null;
  } | null;
  terminalOutcome?: { disposition: "MERGED" | "CLOSED"; source: string; convergedAt: string } | null;
  report?: string | null;
  localDelivery?: {
    worktreeId: string; branchName: string | null; mode?: "local_merge" | "pull_request";
    deliveredAt?: string | null; promotedAt?: string | null; prNumber?: number | null; prUrl?: string | null;
  } | null;
  clarifyAnswer?: { by?: string | null; at?: string | null; text?: string | null } | null;
  deliveryReport?: {
    summary: string | null;
    verification: { passed: boolean; verified: boolean; summary: string | null } | null;
    changedFiles: string[];
    completedAt: string | null;
  } | null;
  deliveryReview?: {
    status: "queued" | "running" | "completed" | "failed" | "unavailable";
    invocationId: string | null;
    reviewer: string;
    startedAt: string | null;
    completedAt: string | null;
    verdict: "approved" | "changes_requested" | null;
    summary: string | null;
    findings: { severity: "low" | "medium" | "high"; file: string; line: number | null; message: string; suggestion: string | null; confidence: "low" | "medium" | "high" }[];
    reviewedCommit: string | null;
    errorCode: string | null;
    nextRetryAt?: string | null;
  } | null;
  deliveryStopped?: {
    stoppedAt: string;
    stoppedBy: string;
    reason: string | null;
    worktreeKept: boolean;
    pullRequestKept: boolean;
  } | null;
  routingOverride?: {
    recommendedPath: string | null; actualPath: string; reason: string;
    actorId: string; recordedAt: string; revision: number;
  } | null;
};
export type LocalWorkItemObservability = {
  executionChainId?: string;
  nextAction: "review_approval" | "review_delivery" | "resolve_sync_conflict" | "inspect_failure" | "none" | "monitor_execution" | "start_execution";
  attention: WorkItemAttention[];
  latestRun: LocalWorkItemAutoRun | null;
  outcome?: {
    status: "pending" | "available" | "missing";
    summary: string | null;
    fullReport: string | null;
    highlights: string[];
    warnings: string[];
    files: string[];
    verification: { passed: boolean; verified: boolean; summary: string | null } | null;
    deliveredAt: string | null;
  } | null;
  runHistory?: {
    invocationId: string;
    autoRunId: string | null;
    attempt: number;
    status: string;
    createdAt: string | null;
    startedAt: string | null;
    completedAt: string | null;
    errorCode: string | null;
    summary: string | null;
    current: boolean;
  }[];
  delivery?: {
    state: "awaiting_review";
    mode: "local_merge" | "pull_request";
    worktreeId: string;
    branchName: string | null;
    remoteUrl: string | null;
    report: LocalWorkItemAutoRun["deliveryReport"];
    aiReview: LocalWorkItemAutoRun["deliveryReview"];
    review: {
      verdict: "approved" | "changes_requested";
      summary: string | null;
      comments: { path: string | null; body: string; line?: number; severity?: "low" | "medium" | "high"; suggestion?: string }[];
      reviewedCommit: string | null;
      reviewedBy: string | null;
      source: "human" | "ai";
      reviewerName: string | null;
      reviewInvocationId: string | null;
      createdAt: string | null;
    } | null;
  } | null;
  activeClaim: { actorId: string | null; claimedAt: string | null; expiresAt: string | null } | null;
  cost: {
    knownUsd: number; unknownEntries: number; entryCount: number;
    byAutoRun?: { autoRunId: string; knownUsd: number; unknownEntries: number; entryCount: number }[];
    byModel?: { model: string; knownUsd: number; unknownEntries: number; entryCount: number }[];
    byBudgetPool?: { budgetPoolId: string; knownUsd: number; unknownEntries: number; entryCount: number }[];
    projectBudget?: { budgetId: string; limitUsd: number; spentUsd: number; reservedUsd: number; admissionUsd: number; remainingUsd: number; policy: string; over: boolean; admissionOver: boolean } | null;
    teamBudget?: { budgetId: string; limitUsd: number; spentUsd: number; reservedUsd: number; admissionUsd: number; remainingUsd: number; policy: string; over: boolean; admissionOver: boolean } | null;
  };
  alerts: {
    queued: number; failed: number; sent: number; skipped: number;
    items?: { id: string; kind: string; status: string; attempts: number; nextAttemptAt: string | null; sentAt: string | null; lastError: string | null }[];
  };
  timeline?: {
    id: string; at: string; source: "issue" | "execution" | "cost" | "alert"; type: string;
    stage?: "creation" | "routing" | "queue" | "execution" | "approval" | "tool" | "verification" | "retry" | "completion" | "other";
    actorId: string | null; message: string; data: Record<string, unknown>;
  }[];
  estimate?: {
    sampleCount: number; typicalDurationMs: number | null; p90DurationMs?: number | null; elapsedMs: number | null;
    remainingMs: number | null; confidence: "low" | "medium" | "high";
    calibrationSampleCount?: number; calibrationMaeMs?: number | null;
  } | null;
  routingExplanation?: {
    selectedPath: string | null; via: string; confidence: number | null; rationale: string | null;
    humanCorrection?: { actualPath: string; reason: string; actorId: string; recordedAt: string } | null;
    candidates: { path: string; selected: boolean; score?: number | null; reason: string }[];
  } | null;
};
export type Row = GithubItem & { projectId: string; projectName: string };
export const TASK_TABS = ["local", "issue", "pr"] as const;
export type TaskTab = (typeof TASK_TABS)[number];

export function shouldShowWorkItemCost(
  observability: LocalWorkItemObservability | null,
): observability is LocalWorkItemObservability {
  return Boolean(observability && (
    observability.cost.entryCount > 0
    || observability.cost.projectBudget
    || observability.cost.teamBudget
  ));
}
