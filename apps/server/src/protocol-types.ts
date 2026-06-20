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
  discoveryRuns: AgentDiscoveryRun[];
  approvalRequests: ApprovalRequest[];
  policyDecisionRecords: PolicyDecisionRecord[];
};
