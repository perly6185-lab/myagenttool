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
  result?: { summary?: string; touchedUserFiles?: boolean };
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
  invocationId: string;
  summary: string;
  bridgeState: string;
  adapterError?: string;
  logSummary: string;
  suggestedFixes?: string[];
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
  agent: AgentSnapshot | null;
  agents: AgentSnapshot[];
  invocations: InvocationSnapshot[];
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
  probe?: ApplicationProbe | null;
  orchestrations?: ApplicationOrchestration[];
  orchestrationIds?: string[];
  createdAt?: string;
  updatedAt?: string;
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
}
