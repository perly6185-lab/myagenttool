import type { Agent, AuditSummary, Device, Invocation, InvocationEvent } from "@myagenttool/protocol";

export type LocalDemoServerState = {
  device: Device;
  agent: Agent;
  invocations: Invocation[];
  events: InvocationEvent[];
  auditSummaries: AuditSummary[];
};
