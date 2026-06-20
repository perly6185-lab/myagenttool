import type { Agent, AgentDiscoveryRun, Invocation, InvocationEvent } from "@myagenttool/protocol";

export type DesktopBridgeWorkItem = {
  invocationId: Invocation["id"];
  agentId: Invocation["agentId"];
  adapter: Agent["adapter"];
  input: Invocation["input"];
  options: Invocation["options"];
};
export type DesktopBridgeEvent = InvocationEvent;
export type DesktopBridgeHealthWorkItem = {
  checkId: string;
  agentId: Agent["id"];
  adapter: Agent["adapter"];
};
export type DesktopBridgeDiscoveryWorkItem = {
  discoveryRunId: AgentDiscoveryRun["id"];
  deviceId: AgentDiscoveryRun["deviceId"];
  scope: AgentDiscoveryRun["scope"];
  knownCommands: string[];
  knownLocalEndpoints: Array<{
    name: string;
    baseUrl: string;
    requestPath: string;
    healthPath: string;
  }>;
  userProvidedPaths: string[];
  userProvidedEndpoints: string[];
};
