import type {
  Agent,
  AgentDiscoveryRun,
  AgentLifecycleOperation,
  AgentUsageSummary,
  AIUsageRecord,
  ClaudeReviewFinding,
  CodexReviewFinding,
  ReviewFinding,
  ImportedUsageEstimate,
  ApprovalRequest,
  AuditExportRequest,
  AuditSummary,
  LedgerEntry,
  LifecycleLocalApprovalRequest,
  LifecyclePolicyDecision,
  LifecycleRollbackRequest,
  LifecycleQueuedAction,
  LifecycleRecipeArtifact,
  PrivateCatalogEntry,
  Device,
  Invocation,
  InvocationEvent,
  InvocationTroubleshootingReport,
  PolicyDecisionRecord,
  PrivateDeploymentConfig,
  QuotaDecision,
  QuotaPolicy,
  SignedBundleManifest,
  Span,
  Trace,
} from "@myagenttool/protocol";

export type LocalDemoServerState = {
  device: Device;
  agents: Agent[];
  invocations: Invocation[];
  events: InvocationEvent[];
  traces: Trace[];
  spans: Span[];
  auditSummaries: AuditSummary[];
  healthChecks: AgentLifecycleOperation[];
  lifecycleAuditRecords: AgentLifecycleOperation[];
  lifecycleRecipes: LifecycleRecipeArtifact[];
  lifecyclePolicyDecisions: LifecyclePolicyDecision[];
  lifecycleLocalApprovals: LifecycleLocalApprovalRequest[];
  lifecycleQueuedActions: LifecycleQueuedAction[];
  lifecycleRollbackRequests: LifecycleRollbackRequest[];
  privateCatalogEntries: PrivateCatalogEntry[];
  signedBundleManifests: SignedBundleManifest[];
  discoveryRuns: AgentDiscoveryRun[];
  quotaDecisionRecords: QuotaDecision[];
  quotaPolicies: QuotaPolicy[];
  aiUsageRecords: AIUsageRecord[];
  ledgerEntries: LedgerEntry[];
  importedUsageEstimates: ImportedUsageEstimate[];
  codexReviewFindings: CodexReviewFinding[];
  claudeReviewFindings: ClaudeReviewFinding[];
  reviewFindings: ReviewFinding[];
  privateDeploymentConfig: PrivateDeploymentConfig;
  auditExportRequests: AuditExportRequest[];
  approvalRequests: ApprovalRequest[];
  policyDecisionRecords: PolicyDecisionRecord[];
  troubleshootingReports: InvocationTroubleshootingReport[];
  agentUsageSummaries: AgentUsageSummary[];
};
