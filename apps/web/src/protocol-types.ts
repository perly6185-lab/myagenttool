import type { Agent, AuditSummary, Device, Invocation, InvocationEvent } from "@myagenttool/protocol";

export type WebConsoleSnapshot = {
  device: Device;
  agent: Agent;
  agents: Agent[];
  invocations: Invocation[];
  events: InvocationEvent[];
  auditSummaries: AuditSummary[];
};
