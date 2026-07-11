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
  | "lifecycle_rollback";

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
  };
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
  traceId?: string;
  rootSpanId?: string;
  approvalRequestId?: string;
  policyDecisionId?: string;
  delivery?: { state?: string; dispatchAttempts?: number };
  cancellation?: { state?: string };
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
}

export interface AutomationSchedule {
  kind: "interval" | "daily" | "weekdays";
  everyMinutes?: number;
  time?: string;
  label: string;
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
  lastRunAt: string | null;
  runCount?: number;
  tokens?: number;
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
  agentSkills?: AgentSkillSnapshot[];
  device: DeviceSnapshot;
  projects?: ProjectSnapshot[];
  currentProjectId?: string | null;
  projectTargets?: ProjectTargetSnapshot[];
  worktrees?: WorktreeSnapshot[];
  worktreeReviews?: WorktreeReview[];
  deployments?: DeploymentSnapshot[];
  agent: AgentSnapshot | null;
  agents: AgentSnapshot[];
  invocations: InvocationSnapshot[];
  compareRuns?: CompareRunSnapshot[];
  pendingDecisions?: PendingDecision[];
  evidenceLedger?: EvidenceLedgerRow[];
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
  importedUsageEstimates?: ImportedUsageEstimate[];
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
}

export type ApplicationSource =
  | { type: "git"; url: string; ref?: string | null }
  | { type: "local"; path: string }
  | { type: "npm"; package: string; version?: string | null; wrapper?: NpmWrapperSnapshot | null }
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
  lifecycle?: { state?: string; lastOperation?: string; lastOperationAt?: string | null };
  projectId?: string | null;
  path?: string | null;
  ownerTeamId?: string | null;
  capabilitiesVersion?: number;
  /** Opt-in orchestration auto-recovery (docs/design/ORCHESTRATION_AUTO_RECOVERY.md). */
  autoRecovery?: { enabled: boolean; maxAttempts?: number } | null;
  /** Opt-in periodic source health probe (docs/design/APPLICATION_HEALTH_PROBE.md). */
  healthProbe?: { enabled: boolean; intervalMinutes?: number; lastCheckedAt?: string | null } | null;
  /** Latest health check result; auto-degrade only (active→offline), never auto-online. */
  health?: { status: "healthy" | "unhealthy" | "unsupported" | string; reason?: string | null; checkedAt?: string; consecutiveFailures?: number } | null;
  probe?: ApplicationProbe | null;
  orchestrations?: ApplicationOrchestration[];
  orchestrationIds?: string[];
  latestResult?: ApplicationResultRef | null;
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
  metadata?: {
    readiness?: {
      state?: string;
      reason?: string;
      applicationStatus?: string;
      installState?: string;
      executionMode?: string;
    };
    resultPath?: {
      outputCollection?: string;
      resultImport?: Record<string, unknown> | null;
      evidenceCenter?: boolean;
    };
    [key: string]: unknown;
  };
}
