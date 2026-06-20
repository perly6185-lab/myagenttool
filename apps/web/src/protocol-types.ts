import type {
  Agent,
  AgentDiscoveryRun,
  AgentLifecycleOperation,
  AgentUsageSummary,
  ApprovalRequest,
  AuditSummary,
  Device,
  Invocation,
  InvocationEvent,
  InvocationTroubleshootingReport,
  PolicyDecisionRecord,
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
  discoveryRuns: AgentDiscoveryRun[];
  approvalRequests: ApprovalRequest[];
  policyDecisionRecords: PolicyDecisionRecord[];
  troubleshootingReports: InvocationTroubleshootingReport[];
  agentUsageSummaries: AgentUsageSummary[];
};
