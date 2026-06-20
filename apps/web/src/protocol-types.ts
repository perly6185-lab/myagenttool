import type {
  Agent,
  AgentDiscoveryRun,
  AgentLifecycleOperation,
  ApprovalRequest,
  AuditSummary,
  Device,
  Invocation,
  InvocationEvent,
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
};
