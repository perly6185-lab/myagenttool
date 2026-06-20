import type {
  Agent,
  AgentDiscoveryRun,
  AgentLifecycleOperation,
  AuditSummary,
  Device,
  Invocation,
  InvocationEvent,
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
};
