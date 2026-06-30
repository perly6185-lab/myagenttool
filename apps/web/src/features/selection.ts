/*
 * Pure resolvers that turn (snapshot + current selection) into the concrete
 * agent/invocation a screen should act on. Kept side-effect free so they can
 * run during render without fighting React state.
 */

import type {
  AgentSnapshot,
  ApprovalSnapshot,
  ConsoleSnapshot,
  InvocationSnapshot,
  TroubleshootingReport,
} from "@/lib/console-state";

export function resolveAgents(
  state: ConsoleSnapshot | undefined,
  selectedAgentId: string | null,
): { agents: AgentSnapshot[]; agent: AgentSnapshot | null } {
  if (!state) return { agents: [], agent: null };
  const agents = state.agents?.length ? state.agents : state.agent ? [state.agent] : [];
  const agent =
    agents.find((item) => item.id === selectedAgentId) ?? state.agent ?? agents[0] ?? null;
  return { agents, agent };
}

export function resolveInvocation(
  state: ConsoleSnapshot | undefined,
  selectedInvocationId: string | null,
): InvocationSnapshot | null {
  if (!state) return null;
  if (selectedInvocationId) {
    const match = state.invocations.find((item) => item.id === selectedInvocationId);
    if (match) return match;
  }
  return state.invocations[0] ?? null;
}

export function approvalFor(
  state: ConsoleSnapshot | undefined,
  invocation: InvocationSnapshot | null,
): ApprovalSnapshot | null {
  if (!state || !invocation?.approvalRequestId) return null;
  return state.approvalRequests?.find((item) => item.id === invocation.approvalRequestId) ?? null;
}

export function troubleshootingFor(
  state: ConsoleSnapshot | undefined,
  invocation: InvocationSnapshot | null,
): TroubleshootingReport | null {
  if (!state || !invocation) return null;
  return state.troubleshootingReports?.find((item) => item.invocationId === invocation.id) ?? null;
}

export function auditFor(state: ConsoleSnapshot | undefined, invocation: InvocationSnapshot | null) {
  if (!state || !invocation) return null;
  return state.auditSummaries.find((item) => item.invocationId === invocation.id) ?? null;
}

export function usageFor(state: ConsoleSnapshot | undefined, agent: AgentSnapshot | null) {
  if (!state || !agent) return undefined;
  return state.agentUsageSummaries?.find((item) => item.agentId === agent.id);
}
