import type {
  Agent,
  AgentDiscoveryRun,
  AgentLifecycleOperation,
  AgentUsageSummary,
  AIUsageRecord,
  ApprovalRequest,
  AuditExportRequest,
  AuditSummary,
  LedgerEntry,
  LifecycleLocalApprovalRequest,
  LifecyclePolicyDecision,
  LifecycleQueuedAction,
  LifecycleRecipeArtifact,
  Device,
  Invocation,
  InvocationEvent,
  InvocationTroubleshootingReport,
  PolicyDecisionRecord,
  PrivateDeploymentConfig,
  QuotaDecision,
  QuotaPolicy,
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
