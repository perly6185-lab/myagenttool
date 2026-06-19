import type { Agent, Invocation, InvocationEvent } from "@myagenttool/protocol";

export type DesktopBridgeWorkItem = {
  invocationId: Invocation["id"];
  agentId: Invocation["agentId"];
  adapter: Agent["adapter"];
  input: Invocation["input"];
  options: Invocation["options"];
};
export type DesktopBridgeEvent = InvocationEvent;
