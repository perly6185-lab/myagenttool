/*
 * Shape of GET /api/state as the web console reads it. The canonical schema
 * lives in @myagenttool/protocol (and the M0 server); this mirror keeps only
 * the fields the UI touches, with permissive optionals so a leaner server
 * response never crashes a screen. Treat protocol as the source of truth.
 */

export interface DeviceSnapshot {
  id: string;
  name: string;
  status: string;
  platform: string;
  architecture: string;
  lastSeenAt: string | null;
  /** Max invocations this machine runs at once (across distinct worktrees). */
  maxConcurrency?: number;
  runtimeReadiness?: DeviceRuntimeReadiness[];
  /** Compatibility alias for older servers. */
  applicationBinaryReadiness?: DeviceRuntimeReadiness[];
}

export interface DeviceRuntimeReadiness {
    runtimeId?: string;
    command: string;
    capabilityPrefix: string;
    status: "available" | "absent" | "stale";
    version: string | null;
    authenticationStatus?: "authenticated" | "unauthenticated" | "unknown";
    authenticationMethod?: string | null;
    checkedAt: string;
}

export interface AgentHealth {
  status?: string;
  message?: string;
  checkedAt?: string | null;
  nextAction?: string;
}

export interface AgentAdapter {
  type?: string;
  command?: string;
  baseUrl?: string;
  name?: string;
  cancellation?: string;
  outputFormat?: string;
  sandbox?: string;
  permissionMode?: string;
  args?: string[];
  // MCP transport (stdio spawns `command`; http calls `url`).
  transport?: string;
  url?: string;
  allowedTools?: string[];
}

export interface AgentEconomics {
  model?: string;
  unknownCostPolicy?: string;
  costOwner?: string;
}

export interface AgentCapability {
  name?: string;
  description?: string;
  riskLevel?: string;
  riskTags?: string[];
}

export interface AgentRegistrationNotes {
  risk?: string;
  data?: string;
  cost?: string;
  cancellation?: string;
}

export interface AgentSnapshot {
  id: string;
  name: string;
  status?: string;
  health?: AgentHealth;
  capabilities?: AgentCapability[];
  economics?: AgentEconomics;
  adapter?: AgentAdapter;
  lifecycle?: { state?: string; installState?: string };
  location?: { type?: string; deviceId?: string };
  registrationNotes?: AgentRegistrationNotes;
  toolContract?: Record<string, unknown> | null;
  discovery?: { runId?: string };
}

/** A human review of a worktree's diff (Phase 5). Its latest verdict gates promotion. */
export interface WorktreeReview {
  id: string;
  worktreeId: string;
  projectId?: string | null;
  verdict: "approved" | "changes_requested";
  summary?: string | null;
  comments: { path: string | null; body: string }[];
  reviewedBy?: string;
  createdAt?: string;
}

/** One post-merge deploy attempt / rollback (server `deployments`; deploy stage + self-healing). */
export interface DeploymentSnapshot {
  id: string;
  autoRunId: string;
  projectId?: string | null;
  prNumber?: number | null;
  status: "deployed" | "failed" | "rolled_back";
  summary?: string | null;
  at?: string;
}

/** One per-run trust rollup in the Evidence Center (server read-model `evidenceLedger`). */
export interface EvidenceLedgerRow {
  invocationId: string;
  task?: string;
  agentId?: string | null;
  projectId?: string | null;
  status?: string | null;
  createdAt?: string | null;
  review: { total: number; high: number; medium: number; low: number };
  audit?: { permissionDecision?: string | null; status?: string | null } | null;
  troubleshooting: { present: boolean; fixes: number };
  runtimeEvidence: number;
  /** Present when the run is an application orchestration run. */
  application?: { id?: string | null; name?: string | null; routineId?: string | null } | null;
  /** Recovery requests attached to this (failed) run — the resolution story. */
  recovery?: { total: number; latestStatus?: string | null; latestActionType?: string | null; executed: boolean } | null;
  /** Present when this run was produced BY a recovery action (provenance). */
  recoveryResultOf?: { invocationId?: string | null; actionType?: string | null; recoveryActionRequestId?: string | null } | null;
  attention: boolean;
  attentionReasons: string[];
}

/** One per-application per-UTC-day execution counter row. */
export interface ApplicationDailyStat {
  applicationId: string;
  date: string;
  succeeded: number;
  failed: number;
  timedOut: number;
  cancelled: number;
  recovered: number;
}

/** Self-observability for the health-probe sweep (server: applicationHealthSweep). */
export interface ApplicationHealthSweepStatus {
  lastSweepAt: string | null;
  checkedCount: number;
  lastError: string | null;
}

/** Approval-grants phase-1 migration gauge: how often a legacy free-text token was accepted. */
export interface ApprovalTokenLegacyUses {
  count: number;
  lastAt: string | null;
}

/** A Claude patch-apply authorization (governance Phase 4, #914): created by the
 * grant-gated `claude.apply.patch`, executed by the bridge runner, and rolled
 * back — under a fresh grant — via the governed rollback action. The full patch
 * stays server-side; the public row carries a bounded `patchPreview`. */
export interface ClaudeApplyAuthorization {
  id: string;
  proposalInvocationId: string;
  invocationId?: string | null;
  projectId?: string | null;
  worktreeId?: string | null;
  requestedBy?: string | null;
  grantId?: string | null;
  summary?: string | null;
  status: "authorized" | "applying" | "applied" | "failed" | "rolling_back" | "rolled_back" | string;
  applied?: boolean;
  executable?: boolean;
  executionInvocationId?: string | null;
  rollbackInvocationId?: string | null;
  files?: { path: string; action?: string }[];
  appliedFiles?: { path: string; added?: number | null; deleted?: number | null }[];
  verification?: {
    checkPassed?: boolean | null;
    error?: string | null;
    /** Post-apply verification (allowlisted command) — recorded honestly; a
     * failing verification does not undo the apply. */
    verifyCommand?: string | null;
    testsPassed?: boolean;
    testExitCode?: number | null;
    testOutputPreview?: string | null;
  } | null;
  verifyCommandId?: string | null;
  rollback?: { available?: boolean; executed?: boolean; strategy?: string | null; command?: string | null } | null;
  rollbackError?: string | null;
  resultSummary?: string | null;
  patchPreview?: string | null;
  createdAt?: string;
  appliedAt?: string;
  rolledBackAt?: string;
}

/** One row in the consolidated Approvals queue (server read-model `pendingDecisions`). */
export type PendingDecisionKind =
  | "invocation_approval"
  | "decomposition"
  | "design"
  | "clarify"
  | "merge"
  | "compare_promote"
  | "codex_broker"
  | "application_recovery"
  | "lifecycle_approval"
  | "lifecycle_rollback"
  | "channel_task";

export interface PendingDecision {
  id: string;
  kind: PendingDecisionKind;
  title: string;
  subtitle?: string;
  projectId?: string | null;
  createdAt?: string | null;
  /** Native section to deep-link to for the full context. */
  section: string;
  targetId?: string | null;
  /** #1151: advisory "X is handling this" marker — display-only, never gates the decision. */
  softClaim?: { claimedBy: string | null; expiresAt: string | null };
  /** Ids the inline actions need (approvalId / autoRunId / compareRunId / requestId / invocationId …). */
  ref?: {
    approvalId?: string;
    invocationId?: string | null;
    autoRunId?: string;
    prNumber?: number | null;
    prUrl?: string | null;
    mergeRisk?: string | null;
    compareRunId?: string;
    requestId?: string;
    recipeId?: string | null;
    agentId?: string | null;
    rollbackRequestId?: string;
    recoveryActionRequestId?: string | null;
    applicationId?: string | null;
    channelTaskRequestId?: string;
    issueNumber?: number | null;
    issueUrl?: string | null;
  };
}

/** The six lenses of the Status board (server read-model `workBoard`). The first
 * five are exclusive over auto-runs; follow_up is a cross-cutting attention list. */
export type WorkState = "pending_decision" | "in_progress" | "waiting" | "done" | "failed" | "follow_up";

/** One normalized work item on the Status board. */
export interface WorkItem {
  id: string;
  state: WorkState;
  /** Underlying kind: "auto_run", "refusal", or a PendingDecisionKind for 待决策 rows. */
  kind: string;
  title: string;
  subtitle?: string;
  /** Native section to deep-link to for the full context. */
  section: string;
  targetId?: string | null;
  projectId?: string | null;
  updatedAt?: string | null;
  /** follow_up rows only: why this needs attention. */
  reason?: string;
}

export interface WorkBoard {
  generatedAt: number;
  states: Record<WorkState, { count: number; items: WorkItem[] }>;
}

export type WorkPeriodKey = "day" | "week" | "month" | "quarter";

/** One period's rollup (server read-model `workReport`). Run metrics come from
 * the auto-run snapshot; refusals from the durable per-day rollup (null when the
 * viewer is team-scoped, since that rollup has no per-team attribution). */
export interface WorkPeriodReport {
  key: WorkPeriodKey;
  label: string;
  windowStart: number;
  startDate: string;
  flow: {
    opened: number;
    completed: number;
    failed: number;
    /** null when not available at team scope. */
    refusals: number | null;
    refusalsByCategory: Record<string, number>;
    /** Refusal count is a lower bound (rollup began after the window start). */
    refusalsPartial: boolean;
  };
  /** Copy-pasteable / channel-postable report of this period. */
  markdown: string;
}

/** Day / week / month / quarter work reports over the six-state board, sharing
 * one standing + attention snapshot (server read-model `workReport`). */
export interface WorkReport {
  generatedAt: number;
  standing: Record<WorkState, number>;
  attention: {
    agingDecisions: { id: string; title: string; section: string; targetId: string | null; ageHours: number }[];
    stuckRuns: { id: string; title: string; section: string; targetId: string | null; ageHours: number }[];
  };
  refusalsAvailable: boolean;
  refusalDataSince: string | null;
  periods: Record<WorkPeriodKey, WorkPeriodReport>;
}

/** Scheduled push of a work report to a channel (server `reportSchedule`). Posts
 * to a conversation's user (WeCom `touser`) — there is no group-broadcast today. */
export interface ReportSchedule {
  enabled: boolean;
  channelId: string | null;
  conversationId: string | null;
  periodKey: WorkPeriodKey;
  /** "previous" = the just-closed period (last week); "current" = period-to-date. */
  coverage: "previous" | "current";
  cadence: "daily" | "weekly";
  /** 0=Sun..6=Sat, used when cadence === "weekly". */
  weekday: number;
  /** HH:MM, server local time. */
  time: string;
  nextRunAt: string | null;
  lastPostedStartDate: string | null;
  lastPostedAt: string | null;
  updatedAt: string | null;
}

/** #1143: an issue's develop/review lease — one active develop claim per issue. */
export interface IssueClaim {
  id: string;
  projectId: string;
  issueNumber: number;
  mode: "develop" | "review";
  claimedBy: string;
  teamId?: string | null;
  agentId?: string | null;
  autoRunId?: string | null;
  status: "active" | "released" | "expired";
  leaseExpiresAt?: string | null;
  outcome?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

/** #1152: one durable claim lifecycle transition (kept outside the event ring buffer). */
export interface IssueClaimEvent {
  id: string;
  claimId: string;
  projectId: string;
  issueNumber: number;
  type: "claimed" | "released" | "expired";
  mode: "develop" | "review";
  claimedBy: string;
  /** Who performed the transition — differs from claimedBy when a release was on the holder's behalf. */
  actorId?: string | null;
  autoRunId?: string | null;
  outcome?: string | null;
  at: string;
}

export interface CompareRunSnapshot {
  id: string;
  task: string;
  status: string;
  projectId?: string | null;
  isolated?: boolean;
  childInvocationIds: string[];
  children?: { invocationId: string; agentId?: string; worktreeId?: string | null }[];
  preferredInvocationId?: string | null;
  preferredBy?: string | null;
  promotion?: { invocationId: string; worktreeId?: string | null; prNumber?: number | null; prUrl?: string | null } | null;
  summary?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface InvocationSnapshot {
  id: string;
  status?: string;
  input?: { task?: string };
  agentId?: string;
  projectId?: string;
  worktreeId?: string | null;
  // Files the agent read/wrote during the run, captured from its tool_use stream
  // (server read-models/file-ledger.mjs). Deduped + capped; `truncated` when it hit
  // the cap. Absent for agents whose stream we don't parse.
  fileLedger?: { reads?: string[]; writes?: string[]; truncated?: boolean } | null;
  // Request-setup summary captured from the agent CLI's stream-json init event
  // (server read-models/request-context.mjs): model, permission mode, and the
  // tool / MCP / skill / agent inventory the run was dispatched with. This is the
  // wrapper-visible SUMMARY — tool NAMES only, NOT the raw system prompt or full
  // tool schemas (the CLI never emits those). Absent until the init event lands.
  requestContext?: {
    provider?: string;
    model?: string | null;
    permissionMode?: string | null;
    tools?: string[];
    mcpServers?: { name: string; status?: string | null }[];
    skills?: string[];
    agents?: string[];
    slashCommandCount?: number;
    sessionId?: string | null;
  } | null;
  traceId?: string;
  rootSpanId?: string;
  approvalRequestId?: string;
  policyDecisionId?: string;
  delivery?: { state?: string; dispatchAttempts?: number };
  cancellation?: {
    state?: string;
    appliedAt?: string | null;
    message?: string | null;
  };
  result?: { summary?: string; touchedUserFiles?: boolean; errorCode?: string | null; output?: unknown };
  explanation?: InvocationExplanation | null;
  createdAt?: string;
  options?: {
    metadata?: {
      automationId?: string;
      automationName?: string;
      scheduled?: boolean;
      source?: string;
      applicationId?: string;
      applicationName?: string;
      routineId?: string;
      orchestrationPath?: string | null;
      orchestrationRelativePath?: string | null;
      [key: string]: unknown;
    };
  };
}

export interface InvocationExplanation {
  state?: string | null;
  reason?: string | null;
  reasonCode?: string | null;
  summary?: string | null;
  waitingOn?: {
    type?: string | null;
    id?: string | null;
    status?: string | null;
    label?: string | null;
  } | null;
  resultLocation?: {
    type?: string | null;
    invocationId?: string | null;
    reportId?: string | null;
    orchestrationId?: string | null;
    relativePath?: string | null;
    label?: string | null;
  } | null;
  nextAction?: string | null;
  recovery?: {
    category?: string | null;
    actionType?: string | null;
    actionRequestId?: string | null;
    status?: string | null;
    sourceInvocationId?: string | null;
    approvalRequestId?: string | null;
    resultInvocationId?: string | null;
    resultOrchestrationId?: string | null;
    resultOrchestrationRelativePath?: string | null;
  } | null;
  approval?: {
    requestId?: string | null;
    status?: string | null;
    riskLevel?: string | null;
    riskTags?: string[];
    decidedBy?: string | null;
    decidedAt?: string | null;
  } | null;
  source?: {
    type?: string | null;
    applicationId?: string | null;
    applicationName?: string | null;
    routineId?: string | null;
    routineName?: string | null;
    orchestrationRelativePath?: string | null;
    recoveryOfInvocationId?: string | null;
    recoveryActionType?: string | null;
    automationId?: string | null;
    automationName?: string | null;
    channelId?: string | null;
    conversationId?: string | null;
    channelTaskRequestId?: string | null;
    scheduled?: boolean;
    autoRunId?: string | null;
    compareRunId?: string | null;
    invocationId?: string | null;
    recoveryActionRequestId?: string | null;
    actionType?: string | null;
    targetInvocationId?: string | null;
    toolName?: string | null;
    outputCollection?: string | null;
    status?: string | null;
    preferredInvocationId?: string | null;
    siblingInvocationIds?: string[];
    link?: Record<string, unknown> | null;
  } | null;
}

export interface InvocationEventSnapshot {
  id: string;
  invocationId?: string;
  type: string;
  message?: string;
  level?: "info" | "warn" | "error" | string;
  createdAt: string;
  // `artifactId` / `targetInvocationId` let a platform-agent "action requested"
  // event deep-link to the surface where its decision is actually made.
  data?: {
    agentId?: string;
    source?: string;
    artifactId?: string;
    targetInvocationId?: string;
    reportId?: string;
    // Auto-run lifecycle events key off autoRunId (not invocationId) so a run's
    // whole timeline is reconstructable client-side; status carries the stage.
    autoRunId?: string;
    status?: string;
    [key: string]: unknown;
  } | null;
}

// A Codex tool-permission request held by the approval broker. When `status` is
// "pending" the run is blocked until someone approves/denies it (or it times out).
export interface CodexApprovalBrokerRequest {
  id: string;
  invocationId?: string;
  toolName?: string;
  summary?: string;
  riskLevel?: string;
  status: "pending" | "approved" | "denied" | "timed_out" | string;
  approvalMode?: string;
  timeoutAt?: string;
  decision?: string | null;
}

export interface AuditSnapshot {
  invocationId?: string;
  agentId?: string;
  permissionDecision?: string;
  errorSummary?: string;
  traceId?: string;
  costSummary?: string;
}

export interface LifecycleAuditSnapshot {
  agentId?: string;
  operation: string;
  status: string;
}

export interface DiscoveryCandidate {
  id: string;
  name: string;
  description?: string;
  source?: string;
  confidence?: string;
  riskLevel?: string;
  riskTags?: string[];
  riskHints?: string[];
  healthProbeAvailable?: boolean;
  adapter?: AgentAdapter;
  registration?: { status?: string; registeredAgentId?: string };
}

export interface DiscoveryRunSnapshot {
  id: string;
  status: string;
  message?: string;
  candidates?: DiscoveryCandidate[];
}

export interface ApprovalSnapshot {
  id: string;
  invocationId?: string;
  status: string;
  riskLevel?: string;
  riskTags?: string[];
  summary?: { risk?: string; data?: string; cost?: string; cancellation?: string };
}

export interface PolicyDecisionSnapshot {
  id: string;
  decision: string;
  reason?: string;
  riskTags?: string[];
}

export interface TroubleshootingReport {
  id?: string;
  invocationId: string;
  troubleshooterInvocationId?: string | null;
  summary: string;
  bridgeState: string;
  adapterError?: string;
  logSummary: string;
  suggestedFixes?: string[];
  webLinks?: {
    failedInvocation?: WebNavigationLink | null;
    troubleshooterInvocation?: WebNavigationLink | null;
    applicationRun?: WebNavigationLink | null;
  };
}

export interface WebNavigationLink {
  label: string;
  query: string;
  target: Record<string, unknown>;
}

export interface AgentUsageSummary {
  agentId: string;
  costOwner?: string;
  economicModel?: string;
  invocationCount: number;
  succeededCount: number;
  failedCount: number;
  cancelledCount: number;
  totalCostUsd?: number;
  billableInvocations?: number;
  unknownCostInvocations?: number;
}

/** One model turn within a run — per-round telemetry (Epic #805). */
export interface InvocationRound {
  id: string;
  invocationId: string;
  roundIndex: number;
  provider?: string;
  model?: string;
  status?: string;
  startedAt?: string;
  endedAt?: string | null;
  durationMs?: number | null;
  inputTokens?: number;
  outputTokens?: number;
  cachedTokens?: number;
  reasoningTokens?: number;
  filesRead?: string[];
  toolCallIds?: string[];
  responseDigest?: string | null;
  errorCode?: string | null;
  estimatedCostUsd?: number | null;
}

export interface LedgerEntry {
  id: string;
  invocationId?: string;
  agentId?: string;
  agentName?: string;
  provider?: string;
  economicModel?: string;
  inputTokens?: number;
  outputTokens?: number;
  currency?: string;
  amountUsd?: number | null;
  amountText?: string;
  amountSource?: "reported" | "estimated" | "unknown";
  billable?: boolean;
  status?: string;
  costOwner?: string;
  projectId?: string;
  invocationStatus?: string;
  createdAt: string;
}

export interface ImportedUsageEstimate {
  id: string;
  source: string;
  reportInvocationId: string;
  invocationId: string;
  projectId?: string | null;
  worktreeId?: string | null;
  requestedBy?: string | null;
  agentId?: string | null;
  reportAgentName?: string | null;
  reportId: string;
  rowIndex: number;
  periodStart?: string | null;
  periodEnd?: string | null;
  date?: string | null;
  month?: string | null;
  week?: string | null;
  sessionId?: string | null;
  provider?: string | null;
  sourceAgent?: string | null;
  model?: string | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  totalTokens?: number | null;
  estimatedCostUsd?: number | null;
  currency?: string;
  amountSource: "imported_ccusage_report" | string;
  economicModel: "external_billed";
  authoritative: false;
  offline?: boolean | null;
  filters?: Record<string, unknown> | null;
  droppedRowCount?: number;
  createdAt: string;
}

export interface EvidenceCenterRecord {
  id: string;
  type: string;
  source: string;
  redactionState?: string | null;
  invocationId?: string | null;
  codexSessionRegistryId?: string | null;
  agentId?: string | null;
  repoPath?: string | null;
  summary: string;
  detail?: string | null;
  marker?: string | null;
  createdAt?: string | null;
}

export interface CodexReviewFinding {
  id: string;
  source: "codex" | string;
  reviewInvocationId: string;
  invocationId: string;
  projectId?: string | null;
  worktreeId?: string | null;
  requestedBy?: string | null;
  agentId?: string | null;
  reviewAgentName?: string | null;
  tool: "codex.review.diff" | string;
  mode: string;
  severityFloor?: string | null;
  summary?: string | null;
  findingIndex: number;
  severity: "low" | "medium" | "high";
  file: string;
  line?: number | null;
  message: string;
  suggestion?: string | null;
  confidence: "low" | "medium" | "high";
  authoritative: false;
  createdAt: string;
}

export interface ClaudeReviewFinding {
  id: string;
  source: "claude" | string;
  reviewInvocationId: string;
  invocationId: string;
  projectId?: string | null;
  worktreeId?: string | null;
  requestedBy?: string | null;
  agentId?: string | null;
  reviewAgentName?: string | null;
  tool: "claude.review.diff" | string;
  mode: string;
  severityFloor?: string | null;
  summary?: string | null;
  findingIndex: number;
  severity: "low" | "medium" | "high";
  file: string;
  line?: number | null;
  message: string;
  suggestion?: string | null;
  confidence: "low" | "medium" | "high";
  authoritative: false;
  createdAt: string;
}

export interface ReviewFinding {
  id: string;
  source: "codex" | "claude" | string;
  reviewInvocationId: string;
  invocationId: string;
  projectId?: string | null;
  worktreeId?: string | null;
  requestedBy?: string | null;
  agentId?: string | null;
  reviewAgentName?: string | null;
  tool: "codex.review.diff" | "claude.review.diff" | string;
  mode: string;
  severityFloor?: string | null;
  summary?: string | null;
  findingIndex: number;
  severity: "low" | "medium" | "high";
  file: string;
  line?: number | null;
  message: string;
  suggestion?: string | null;
  confidence: "low" | "medium" | "high";
  authoritative: false;
  createdAt: string;
}

export interface ToolAgentRef {
  id: string;
  name: string;
  status?: string;
  report?: string | null;
}

export interface ToolDescriptor {
  name: string;
  version: string;
  displayName: string;
  description?: string;
  riskLevel?: string;
  riskTags?: string[];
  requiresLocalDevice?: boolean;
  inputSchema?: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  agents?: ToolAgentRef[];
  approvalPolicy?: Record<string, unknown>;
  authoritativeBilling?: boolean;
  outputCollection?: string;
}

export interface ToolInvocationRequest {
  report?: string;
  source?: "all" | "codex" | "claude";
  since?: string | null;
  until?: string | null;
  timezone?: string | null;
  offline?: boolean;
  projectId?: string | null;
  worktreeId?: string | null;
  instruction?: string | null;
  severityFloor?: "low" | "medium" | "high";
}

export interface ToolInvocationResponse {
  tool: string;
  invocationId: string;
  agentId: string;
  status: string;
  outputCollection?: string;
  invocation?: InvocationSnapshot;
}

export interface ReviewFindingQueryResponse {
  reviewFindings: ReviewFinding[];
  count: number;
  filters: {
    projectId?: string | null;
    worktreeId?: string | null;
    invocationId?: string | null;
    source?: "codex" | "claude" | string | null;
    severity?: "low" | "medium" | "high" | string | null;
  };
}

export interface LedgerOwnerRollup {
  costOwner: string;
  entries: number;
  knownCostUsd: number;
  estimatedCostUsd: number;
  unknownEntries: number;
}

export interface LedgerProjectRollup {
  projectId: string;
  projectName?: string;
  entries: number;
  knownCostUsd: number;
  estimatedCostUsd: number;
  unknownEntries: number;
}

export interface LedgerAgentRollup {
  agentId: string;
  agentName?: string;
  provider?: string;
  entries: number;
  knownCostUsd: number;
  estimatedCostUsd: number;
  unknownEntries: number;
}

export interface LedgerModelRollup {
  model: string;
  provider?: string;
  entries: number;
  knownCostUsd: number;
  estimatedCostUsd: number;
  unknownEntries: number;
}

export interface LedgerAutoRunRollup {
  autoRunId: string;
  entries: number;
  knownCostUsd: number;
  estimatedCostUsd: number;
  unknownEntries: number;
}

export interface LedgerSummary {
  currency: string;
  totalCostUsd: number;
  finalizedUsd: number;
  estimatedUsd: number;
  entryCount: number;
  knownEntries: number;
  estimatedEntries: number;
  unknownEntries: number;
  voidedEntries?: number;
  billableEntries: number;
  byCostOwner: LedgerOwnerRollup[];
  byProject: LedgerProjectRollup[];
  byAgent: LedgerAgentRollup[];
  byModel: LedgerModelRollup[];
  byAutoRun: LedgerAutoRunRollup[];
}

export interface ProjectSnapshot {
  id: string;
  name: string;
  color: string;
  ownerTeamId: string;
  budgetPoolId: string | null;
  defaultAgentId: string | null;
  verifyCommandName?: string | null;
  status: "active" | "archived";
  isolation: "shared" | "worktree";
  createdAt: string;
  updatedAt?: string;
  /**
   * Git facts read from the project's real root (`readGitFacts`, projects.mjs:68).
   * The server has always sent these — `state.projects` is projected wholesale —
   * but the type never declared them, so the console could not say where a project
   * pushes (#1213). `remoteUrl: null` on a repo means it has nowhere to publish.
   */
  git?: {
    repoPath: string | null;
    remoteUrl: string | null;
    defaultBranch: string | null;
    currentBranch: string | null;
    isRepo: boolean;
  };
}

export interface ProjectTargetSnapshot {
  id: string;
  projectId: string;
  deviceId: string;
  kind: "clone" | "local";
  remoteUrl: string | null;
  rootPath: string;
  defaultBranch: string | null;
  state: "cloning" | "ready" | "failed";
  progress: number;
  message: string;
  createdAt: string;
  updatedAt?: string;
}

export interface WorktreeLink {
  type: "issue" | "pr";
  number: number;
  title: string;
  url: string | null;
  state: string;
}

export interface WorktreeSnapshot {
  id: string;
  projectId: string;
  targetId: string;
  invocationId?: string;
  branch: string;
  path: string;
  isMain: boolean;
  ephemeral?: boolean;
  agentId?: string | null;
  link?: WorktreeLink | null;
  createdAt: string;
}

export interface BudgetStatus {
  projectId: string;
  projectName?: string;
  exists: boolean;
  budgetId?: string;
  limitUsd: number | null;
  policy: string;
  currency?: string;
  spentUsd: number;
  finalizedUsd?: number;
  estimatedUsd?: number;
  remainingUsd: number | null;
  over: boolean;
}

export interface TeamBudgetStatus {
  teamId: string;
  teamName?: string;
  projectCount: number;
  exists: boolean;
  budgetId?: string;
  limitUsd: number | null;
  policy: string;
  currency?: string;
  spentUsd: number;
  finalizedUsd?: number;
  estimatedUsd?: number;
  remainingUsd: number | null;
  over: boolean;
}

export interface IntegrationArtifact {
  id: string;
  summary: string;
  artifactType: string;
  targetType?: string;
  reviewState: string;
  generatedByAi?: boolean;
  payload?: {
    adapterGuidance?: string;
    structuredHints?: Record<string, unknown>;
    adapterConfig?: Record<string, unknown>;
  };
  governance?: {
    economics?: { model?: string };
    quota?: { decision?: string };
    riskTags?: string[];
  };
}

export interface IntegrationProbeRun {
  id: string;
  artifactId: string;
  status: string;
  summary: string;
  details?: string[];
}

export interface QuotaDecisionRecord {
  id: string;
  decision: string;
  reason: string;
  artifactId?: string;
}

export interface RetentionSettings {
  logsDays: number;
  promptsDays: number;
  responsesDays: number;
  artifactsDays: number;
  refusalsDays?: number;
}

/**
 * One refusal record (server read-model `refusals`, protocol `Refusal`). The
 * device's veto as a first-class, auditable reply — NOT a failure or an incident.
 * Refusal model Phase 3 (#761).
 */
export interface RefusalRow {
  id: string;
  at: string;
  subject: { kind: string; id: string | null };
  requester: { kind: string; id: string | null };
  category: "not_granted" | "policy" | "state" | "human";
  code: string;
  decidedBy: { kind: string; id: string | null };
  summary: string;
  evidence?: Record<string, unknown> | null;
  remedy: string;
  retryAfter: string | null;
  appealTo: string | null;
  invocationId?: string | null;
  /** "loop" for a promotion refusal surfaced from tools/ai (refusal model #758). */
  source?: string;
  runId?: string | null;
}

export interface AutomationSchedule {
  kind: "interval" | "daily" | "weekdays";
  everyMinutes?: number;
  time?: string;
  label: string;
}

/** What a schedule fires. An ABSENT target means "agent" — every pre-#847 automation. */
export interface AutomationTarget {
  kind: "agent" | "capability";
  capability?: string;
  inputs?: Record<string, string>;
}

export interface AutomationSnapshot {
  id: string;
  name: string;
  enabled: boolean;
  projectId: string;
  branch?: string;
  schedule: AutomationSchedule;
  nextRunAt: string | null;
  sessionMode?: string;
  graceHours?: number;
  precheck?: string;
  agentId: string;
  prompt: string;
  target?: AutomationTarget;
  lastRunAt: string | null;
  /** Why the scheduler could not fire at all — a refused tick leaves no invocation. */
  lastRunError?: string | null;
  runCount?: number;
  tokens?: number;
}

export type ScheduleHealthState = "healthy" | "failing" | "approval_pending" | "paused" | "unknown";

/** Server-computed schedule health (#848) — never re-derived here. */
export interface ScheduleHealthRow {
  automationId: string;
  applicationId: string | null;
  targetKind: "agent" | "capability";
  capability: string | null;
  state: ScheduleHealthState;
  reason: string | null;
  needsAttention: boolean;
  latestInvocationId: string | null;
  latestStatus: string | null;
  latestRunAt: string | null;
}

/** The per-application rollup, so a card can say WHY it wants attention. */
export interface ApplicationScheduleHealth {
  applicationId: string;
  total: number;
  failing: number;
  approvalPending: number;
  paused: number;
  healthy: number;
  unknown: number;
  needsAttention: boolean;
  attentionAutomationIds: string[];
}

export type AgentSkillTarget = "claude" | "codex";
export type AgentSkillPath = "develop" | "design" | "prototype" | "clarify";

export interface AgentSkillToolBinding {
  cli?: string;
  mcp?: { name: string; command: string; args?: string[]; env?: Record<string, string> };
}

export interface AgentSkillSnapshot {
  id: string;
  name: string;
  slug: string;
  description: string;
  body: string;
  targets: AgentSkillTarget[];
  paths?: AgentSkillPath[];
  tool?: AgentSkillToolBinding;
  enabled: boolean;
  createdAt: string;
  updatedAt?: string;
}

export interface ConsoleSnapshot {
  /** Server-resolved defaults the browser can't compute (e.g. home-relative paths). */
  defaults?: { cloneParentDir?: string };
  automations?: AutomationSnapshot[];
  /** Per-schedule health, computed server-side (#848). */
  scheduleHealth?: ScheduleHealthRow[];
  applicationScheduleHealth?: ApplicationScheduleHealth[];
  agentSkills?: AgentSkillSnapshot[];
  device: DeviceSnapshot | null;
  devices?: DeviceSnapshot[];
  projects?: ProjectSnapshot[];
  currentProjectId?: string | null;
  projectTargets?: ProjectTargetSnapshot[];
  worktrees?: WorktreeSnapshot[];
  worktreeReviews?: WorktreeReview[];
  deployments?: DeploymentSnapshot[];
  /** #1143 issue claims — who holds each issue's develop/review lease. */
  issueClaims?: IssueClaim[];
  /** #1152 durable claim lifecycle history (claimed/released/expired), newest first. */
  issueClaimEvents?: IssueClaimEvent[];
  agent: AgentSnapshot | null;
  agents: AgentSnapshot[];
  invocations: InvocationSnapshot[];
  compareRuns?: CompareRunSnapshot[];
  pendingDecisions?: PendingDecision[];
  /** The Status board — six lenses over the same work, server read-model `workBoard`. */
  workBoard?: WorkBoard;
  /** Day/week/month/quarter work reports — flow + standing + attention, server read-model `workReport`. */
  workReport?: WorkReport;
  /** Scheduled work-report → channel push config (admin-plane; null when team-scoped). */
  reportSchedule?: ReportSchedule | null;
  /** Inbound-established channel conversations — the addressable outbound targets. */
  channelConversations?: ChannelConversation[];
  /** Per-decision dispatch routing — who was chosen, why, and over which candidates. */
  dispatchAssignments?: DispatchAssignment[];
  /** Durable per-application daily execution counters (survive the invocation cap). */
  applicationDailyStats?: ApplicationDailyStat[];
  applicationHealthSweepStatus?: ApplicationHealthSweepStatus | null;
  approvalTokenLegacyUses?: ApprovalTokenLegacyUses | null;
  /** Claude patch-apply authorizations (governance Phase 4, #914): grant-consumed,
   * proposal-bound apply records with status + rollback lifecycle. */
  claudeApplyAuthorizations?: ClaudeApplyAuthorization[];
  evidenceLedger?: EvidenceLedgerRow[];
  /** The device's veto — first-class refusal records (refusal model Phase 3). */
  refusals?: RefusalRow[];
  events: InvocationEventSnapshot[];
  auditSummaries: AuditSnapshot[];
  healthChecks?: LifecycleAuditSnapshot[];
  lifecycleAuditRecords?: LifecycleAuditSnapshot[];
  discoveryRuns?: DiscoveryRunSnapshot[];
  approvalRequests?: ApprovalSnapshot[];
  codexApprovalBrokerRequests?: CodexApprovalBrokerRequest[];
  policyDecisionRecords?: PolicyDecisionSnapshot[];
  troubleshootingReports?: TroubleshootingReport[];
  agentUsageSummaries?: AgentUsageSummary[];
  integrationArtifacts?: IntegrationArtifact[];
  integrationProbeRuns?: IntegrationProbeRun[];
  quotaDecisionRecords?: QuotaDecisionRecord[];
  retentionSettings?: RetentionSettings;
  ledgerEntries?: LedgerEntry[];
  invocationRounds?: InvocationRound[];
  importedUsageEstimates?: ImportedUsageEstimate[];
  /** Parsed Application results (git repo_state, #868), scoped by project. */
  applicationResults?: ApplicationResult[];
  evidenceCenterRecords?: EvidenceCenterRecord[];
  codexReviewFindings?: CodexReviewFinding[];
  claudeReviewFindings?: ClaudeReviewFinding[];
  reviewFindings?: ReviewFinding[];
  applications?: ApplicationSnapshot[];
  applicationRecoveryActions?: ApplicationRecoveryActionRequest[];
  ledgerSummary?: LedgerSummary;
  budgetStatuses?: BudgetStatus[];
  teamBudgetStatuses?: TeamBudgetStatus[];
  teams?: { id: string; name?: string }[];
  users?: { id: string; name?: string; teamId?: string; role?: string }[];
  /** Channel subsystem (#1090): operational rollup per channel, team-scoped. */
  channelOperations?: ChannelOperations[];
  channelDeliveries?: ChannelDelivery[];
  channelTaskRequests?: ChannelTaskRequest[];
}

export interface ChannelTaskRequest {
  id: string;
  channelId: string;
  projectId: string;
  issueNumber: number;
  issueUrl?: string | null;
  title: string;
  status: string;
  stage: string;
  autoRunId?: string | null;
  runStatus?: string | null;
  invocationId?: string | null;
  invocationStatus?: string | null;
  resultSummary?: string | null;
  deliveryStatus?: string | null;
  createdAt?: string | null;
  actions: { retry: boolean; reroute: boolean; takeover: boolean };
}

/** One dispatcher routing decision (state.dispatchAssignments) — the "why here". */
export interface DispatchAssignment {
  id: string;
  projectId: string;
  issueNumber: number;
  workerId: string | null;
  status: string;
  adopted?: boolean;
  assignedAt?: string;
  routing?: {
    chosen: string | null;
    why: string | null;
    margin?: string | null;
    mode?: string;
    candidates?: { id: string; affinity: number; load: number }[];
    ineligible?: { id: string; reason: string }[];
    requirements?: { areas?: string[]; platforms?: string[]; agents?: string[]; risk?: string | null };
  } | null;
}

/** Per-channel operational rollup (read-models/channels.mjs). No secrets — readiness is booleans. */
export interface ChannelOperations {
  id: string;
  provider: string;
  name: string;
  status: "registered" | "enabled" | "disabled" | string;
  ownerTeamId?: string | null;
  readiness: Record<string, boolean>;
  ready: boolean;
  health: "ok" | "attention" | "idle" | string;
  capabilityAllowlist: string[];
  statusCapability?: string | null;
  /** The project `/task` files GitHub issues into (null = /task disabled). */
  taskProjectId?: string | null;
  /** Auto-route /task straight to work (default off = capture-then-promote). */
  taskAutoRoute?: boolean;
  /** Per-channel/day aggregate /task ceiling + today's usage. */
  taskDailyLimit?: number;
  taskDayDate?: string | null;
  taskDayCount?: number;
  /** Whether in-channel /approve is allowed (default off — approve in the console). */
  allowSelfApprove?: boolean;
  counts: {
    identities: number;
    conversations: number;
    events: number;
    deliveries: number;
    failedDeliveries: number;
    injectionFlagged: number;
  };
  lastActivityAt?: string | null;
}

/** An inbound-established conversation — the addressable target for an outbound
 * message (its externalUserId becomes the WeCom `touser`). */
export interface ChannelConversation {
  id: string;
  channelId: string;
  externalUserId: string;
  status?: string;
  updatedAt?: string | null;
}

export interface ChannelDelivery {
  id: string;
  channelId: string;
  conversationId: string;
  invocationId?: string | null;
  status: "queued" | "sending" | "delivered" | "retrying" | "failed_terminal" | string;
  attempts: number;
  providerReceiptId?: string | null;
  lastErrorCode?: string | null;
  updatedAt?: string | null;
}

export type ApplicationSource =
  | { type: "git"; url: string; ref?: string | null }
  | { type: "local"; path: string }
  | { type: "npm"; package: string; version?: string | null; wrapper?: NpmWrapperSnapshot | null }
  // A system binary the platform runs on the device (git) — #774.
  | { type: "binary"; binary: string; wrapper?: NpmWrapperSnapshot | null }
  | { type: "builtin"; id: "markdown" }
  | { type: "manual"; uri?: string | null; manifest?: Record<string, unknown> };

export interface NpmWrapperSnapshot {
  mode?: string;
  installState?: string;
  commands?: { id: string; commandType?: string; command?: string; status?: string; riskLevel?: string }[];
}

export interface ApplicationProbeCapability {
  name: string;
  source?: "declared" | "inferred" | string;
  riskLevel?: string;
}

export interface ApplicationProbe {
  status?: string;
  checkedAt?: string | null;
  summary?: string | null;
  package?: Record<string, unknown> | null;
  readme?: string | null;
  capabilities?: ApplicationProbeCapability[];
  warnings?: string[];
}

export interface ApplicationOrchestration {
  routineId: string;
  status?: string;
  path?: string;
  relativePath?: string;
  validation?: { ok?: boolean } | null;
  generatedAt?: string;
}

export interface ApplicationOrchestrationRun {
  invocationId: string;
  status?: string;
  agentId?: string | null;
  projectId?: string | null;
  worktreeId?: string | null;
  deliveryState?: string | null;
  cancellationState?: string | null;
  resultSummary?: string | null;
  errorSummary?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  completedAt?: string | null;
  metadata?: {
    source?: string | null;
    applicationId?: string | null;
    applicationName?: string | null;
    routineId?: string | null;
    routineName?: string | null;
    orchestrationRelativePath?: string | null;
    retryOfInvocationId?: string | null;
    retryReason?: string | null;
    recoveryActionType?: string | null;
    recoveryOfInvocationId?: string | null;
    recoveryReason?: string | null;
    recoveryCategory?: string | null;
  };
}

export interface ApplicationOrchestrationRunDetail extends ApplicationOrchestrationRun {
  traceId?: string | null;
  rootSpanId?: string | null;
  approvalRequestId?: string | null;
  policyDecisionId?: string | null;
  delivery?: InvocationSnapshot["delivery"] | null;
  cancellation?: InvocationSnapshot["cancellation"] | null;
  result?: InvocationSnapshot["result"] | null;
  audit?: {
    permissionDecision?: string | null;
    errorSummary?: string | null;
    traceId?: string | null;
    costSummary?: string | null;
  } | null;
  metadata?: Record<string, unknown>;
}

export interface ApplicationOrchestrationRecoveryAction {
  type: string;
  label: string;
  description?: string | null;
  requiresApproval?: boolean;
  priority?: number;
  recommended?: boolean;
  recommendationReason?: string | null;
  riskLevel?: "low" | "medium" | "high" | string;
  availability?: {
    state: "available" | "blocked" | "warning" | string;
    blockedReason?: string | null;
    warningReason?: string | null;
    latestRequestId?: string | null;
  };
  blockedReason?: string | null;
  warningReason?: string | null;
  latestRequestId?: string | null;
  target?: Record<string, unknown>;
}

export interface ApplicationOrchestrationRecovery {
  category: string;
  confidence: number;
  retryRecommended: boolean;
  humanApprovalRequired: boolean;
  summary: string;
  actions: ApplicationOrchestrationRecoveryAction[];
}

export interface ApplicationOrchestrationRecoveryAgentCandidate {
  id: string;
  name: string;
  status: string;
  healthStatus?: string | null;
  locationType?: string | null;
  adapterType?: string | null;
  selectable: boolean;
  reasons: string[];
  preferred: boolean;
  sourceAgent: boolean;
}

export interface ApplicationRecoveryTimelineEntry {
  id: string;
  type: string;
  status: string;
  level?: string | null;
  message?: string | null;
  createdAt?: string | null;
}

export interface ApplicationRecoveryExplanation {
  selectedAction?: string | null;
  state?: string | null;
  reason?: string | null;
  summary?: string | null;
  nextStep?: string | null;
  outcomeState?: string | null;
  recoveryCategory?: string | null;
  blockedReason?: string | null;
  latestRequestId?: string | null;
  recoveryActionRequestId?: string | null;
  approvalRequestId?: string | null;
  requestedAgentId?: string | null;
  selectedAgentId?: string | null;
  resultInvocationId?: string | null;
  resultOrchestrationId?: string | null;
  resultOrchestrationRelativePath?: string | null;
}

export interface ApplicationRecoveryActionRequest {
  id: string;
  applicationId: string;
  routineId: string;
  invocationId: string;
  actionType: string;
  status: string;
  recoveryCategory?: string | null;
  reason?: string | null;
  requiresApproval?: boolean;
  approvalRequestId?: string | null;
  resultInvocationId?: string | null;
  selectedAgentId?: string | null;
  requestedAgentId?: string | null;
  agentCandidateSnapshot?: ApplicationOrchestrationRecoveryAgentCandidate[] | null;
  resultOrchestrationId?: string | null;
  resultOrchestrationRelativePath?: string | null;
  error?: string | null;
  requestedBy?: string | null;
  decidedAt?: string | null;
  executedAt?: string | null;
  outcomeReason?: string | null;
  outcome?: {
    state: "recovered" | "still_failed" | "pending" | "needs_attention" | string;
    reason?: string | null;
    severity?: "success" | "info" | "warning" | "danger" | string;
    summary: string;
    nextStep?: string | null;
  } | null;
  explanation?: ApplicationRecoveryExplanation | null;
  sourceInvocation?: ApplicationRecoveryInvocationBrief | null;
  resultInvocation?: ApplicationRecoveryInvocationBrief | null;
  timeline?: ApplicationRecoveryTimelineEntry[];
  createdAt: string;
  updatedAt: string;
}

export interface ApplicationRecoveryInvocationBrief {
  id: string;
  status?: string | null;
  agentId?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  completedAt?: string | null;
}

export interface ApplicationSnapshot {
  id: string;
  name: string;
  kind: string;
  source: ApplicationSource;
  status: "draft" | "probing" | "registered" | "active" | "offline" | "archived" | "failed" | string;
  executionScope?: "local";
  runtimeRequirements?: Array<{ runtimeId: string; required: boolean }>;
  localReadiness?: {
    state: "ready" | "login_required" | "repair_required" | "bridge_offline" | "archived" | string;
    summary: string;
    action: "login" | "repair" | "retry" | "start_bridge" | null;
    scope: "local";
  };
  lifecycle?: { state?: string; lastOperation?: string; lastOperationAt?: string | null };
  projectId?: string | null;
  path?: string | null;
  ownerTeamId?: string | null;
  capabilitiesVersion?: number;
  descriptorSchemaVersion?: number;
  descriptorFingerprint?: string | null;
  descriptorRevision?: number;
  predecessorApplicationId?: string | null;
  successorApplicationId?: string | null;
  /** Opt-in orchestration auto-recovery (docs/design/ORCHESTRATION_AUTO_RECOVERY.md). */
  autoRecovery?: {
    enabled: boolean;
    maxAttempts?: number;
    /** Per-routine overrides — win over the app-level switch and cap. */
    routineOverrides?: Record<string, { enabled?: boolean; maxAttempts?: number }> | null;
  } | null;
  /** Opt-in periodic source health probe (docs/design/APPLICATION_HEALTH_PROBE.md). */
  healthProbe?: { enabled: boolean; intervalMinutes?: number; lastCheckedAt?: string | null } | null;
  /** Latest health check result; auto-degrade only (active→offline), never auto-online. */
  health?: { status: "healthy" | "unhealthy" | "unsupported" | string; reason?: string | null; checkedAt?: string; consecutiveFailures?: number } | null;
  probe?: ApplicationProbe | null;
  orchestrations?: ApplicationOrchestration[];
  orchestrationIds?: string[];
  latestResult?: ApplicationResultRef | null;
  /**
   * The rollup of this application's capability schedules (#848). An application
   * whose schedules are failing or parked is not healthy — the health sweep only
   * ever checked its own source, never what it was asked to do on a timer.
   */
  scheduleHealth?: ApplicationScheduleHealth | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface ApplicationResultRef {
  applicationId: string;
  capability?: string | null;
  applicationAction?: string | null;
  outputCollection?: string | null;
  resultImport?: Record<string, unknown> | null;
  importedRecordIds?: string[];
  importedRecordCount?: number;
  invocationId?: string | null;
  status?: string | null;
  completedAt?: string | null;
}

/**
 * A stored, typed Application result (#801/#868). For the git application `data`
 * is a parsed `repo_state`; its shape depends on the capability (status / log /
 * diff / branch_list / head / show). The web renders `data` structurally and
 * falls back to the trimmed `text` preview when `status === "unparsed"`.
 */
export interface ApplicationResult {
  id: string;
  source: string;
  kind?: string | null;
  applicationId?: string | null;
  capability?: string | null;
  invocationId: string;
  projectId?: string | null;
  status: "parsed" | "unparsed" | string;
  truncated?: boolean;
  data?: GitRepoState | null;
  /** Raw command output, trimmed to a preview in the snapshot. */
  text?: string;
  createdAt?: string;
}

/** The union of git repo_state shapes the parser emits (all fields optional). */
export interface GitRepoState {
  branch?: { name: string | null; oid: string | null; upstream: string | null; ahead: number; behind: number };
  changed?: { code: string | null; path: string; originalPath?: string; renamed?: boolean }[];
  untracked?: { path: string }[];
  unmerged?: { code: string | null; path: string }[];
  clean?: boolean;
  counts?: { changed: number; untracked: number; unmerged: number };
  commits?: { hash: string; author: string | null; date: string | null; subject: string | null }[];
  branches?: { name: string; objectName: string | null }[];
  files?: { path: string; changes: number | null; binary: boolean }[];
  summary?: { filesChanged: number; insertions: number | null; deletions: number | null };
  commit?: { hash: string | null; author: string | null; date: string | null };
  hash?: string;
  count?: number;
}

export interface ProjectTreeEntry {
  name: string;
  path: string;
  kind: "directory" | "file" | "other";
  gitStatus: string;
}

export interface ProjectTreeResponse {
  projectId: string;
  projectPath: string;
  path: string;
  search: string;
  entries: ProjectTreeEntry[];
  truncated: boolean;
  gitSummary?: { modified?: number; added?: number; deleted?: number };
}

export interface ApplicationRegisterRequest {
  name?: string;
  projectId?: string | null;
  source: ApplicationSource;
  descriptorSchemaVersion?: number;
  replacesApplicationId?: string;
}

export interface KnownApplicationCatalogEntry {
  name: string;
  displayName: string;
  aliases: string[];
  command: string;
  installHint: string;
  runtimeRequirements: Array<{ runtimeId: string; required: boolean }>;
}

export interface RuntimeCatalogEntry {
  id: string;
  command: string;
  displayName: string;
  kind: "agent_cli" | "tool" | "shell";
  aliases: string[];
  applicationIds: string[];
  authenticationRequired: boolean;
  userVisible: boolean;
}

export interface ApplicationInstallPlan {
  schemaVersion: string;
  recipeVersion: string;
  planId: string;
  fingerprint: string;
  application: { name: string; displayName: string };
  target: { projectId: string | null; deviceId: string; platform: string; architecture: string | null };
  package: {
    provider: string;
    identifier: string;
    resolvedIdentifier: string;
    versionPolicy: { kind: string; channel: string | null; allowCallerOverride: boolean; exactVersion?: string | null };
    source: { kind: string; name?: string; registry?: string; packageName?: string };
  };
  execution: { executable: string; args: string[]; shell: false; elevated: boolean };
  risk: { level: string; reasons: string[] };
  approval: { required: true; action: "application.install"; bindsToPlanFingerprint: true };
  policy: { timeoutMs: number; cancellable: boolean };
  validity: { issuedAt: string; expiresAt: string; ttlMs: number };
  postInstallProbe: { executable: string; args: string[]; timeoutMs: number };
  rollback: { automatic: false; uninstallSupported: false; summary: string };
  summary: string;
}

export interface ApplicationInstallRun {
  id: string;
  planId: string;
  deviceId: string;
  status: "queued" | "running" | "cancelling" | "succeeded" | "failed" | "cancelled" | "timed_out" | "refused";
  progress: Array<{ at: string; type: string; summary: string }>;
  result?: { status: string; classification: string; summary: string; exitCode: number | null; durationMs?: number | null } | null;
  rollback?: { automatic: false; status: "not_required" | "operator_review_required"; uninstallSupported: false; summary: string } | null;
  createdAt: string;
  startedAt?: string | null;
  completedAt?: string | null;
}

export interface ApplicationCapability {
  name: string;
  version?: string;
  displayName?: string;
  description?: string;
  provider?: { type: string; id: string };
  kind?: string;
  source?: string;
  riskLevel?: string;
  riskTags?: string[];
  requiresApproval?: boolean;
  invocationMode?: string;
  status?: string;
  /**
   * The capability's declared inputs — key and type only. The `--flag` each key
   * becomes stays server-side (a descriptor never exposes argv), so a caller sends
   * `{ since: "2026-07-01" }` and the server alone decides what that means.
   */
  inputSchema?: {
    properties?: Record<string, { type?: string; enum?: string[] }>;
  };
  metadata?: {
    readiness?: {
      state?: string;
      reason?: string;
      applicationStatus?: string;
      installState?: string;
      executionMode?: string;
    };
    wrapper?: {
      commandId?: string;
      filePolicy?: string;
      networkPolicy?: string;
      /** "invocation_root" — the command runs inside the invocation's repository, so one must be named. */
      cwdPolicy?: string;
    };
    resultPath?: {
      outputCollection?: string;
      resultImport?: Record<string, unknown> | null;
      evidenceCenter?: boolean;
    };
    [key: string]: unknown;
  };
}
