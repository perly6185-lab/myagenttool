import type {
  Agent,
  AgentDiscoveryRun,
  AgentLifecycleOperation,
  AgentUsageSummary,
  AIUsageRecord,
  ApprovalRequest,
  AuditExportRequest,
  AuditSummary,
  Device,
  Invocation,
  InvocationEvent,
  InvocationTroubleshootingReport,
  LedgerEntry,
  LifecycleLocalApprovalRequest,
  LifecyclePolicyDecision,
  LifecycleRollbackRequest,
  LifecycleQueuedAction,
  LifecycleRecipeArtifact,
  PolicyDecisionRecord,
  PrivateCatalogEntry,
  PrivateDeploymentConfig,
  QuotaDecision,
  QuotaPolicy,
  SignedBundleManifest,
} from "@myagenttool/protocol";

export type WebConsoleSnapshot = {
  device: Device;
  agent: Agent;
  agents: Agent[];
  invocations: Invocation[];
  events: InvocationEvent[];
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
  privateDeploymentConfig: PrivateDeploymentConfig;
  auditExportRequests: AuditExportRequest[];
  approvalRequests: ApprovalRequest[];
  policyDecisionRecords: PolicyDecisionRecord[];
  troubleshootingReports: InvocationTroubleshootingReport[];
  agentUsageSummaries: AgentUsageSummary[];
};
