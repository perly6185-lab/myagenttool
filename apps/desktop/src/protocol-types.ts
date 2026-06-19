import type { Invocation, InvocationEvent } from "@myagenttool/protocol";

export type DesktopBridgeWorkItem = Pick<Invocation, "id" | "agentId" | "input" | "options">;
export type DesktopBridgeEvent = InvocationEvent;
