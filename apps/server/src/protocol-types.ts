import type { Agent, AuditSummary, Device, Invocation, InvocationEvent, Span, Trace } from "@myagenttool/protocol";

export type LocalDemoServerState = {
  device: Device;
  agent: Agent;
  invocations: Invocation[];
  events: InvocationEvent[];
  traces: Trace[];
  spans: Span[];
  auditSummaries: AuditSummary[];
};
