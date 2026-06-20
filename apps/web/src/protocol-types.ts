import type {
  Agent,
  AgentDiscoveryRun,
  AgentLifecycleOperation,
  AuditSummary,
  Device,
  Invocation,
  InvocationEvent,
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
};
