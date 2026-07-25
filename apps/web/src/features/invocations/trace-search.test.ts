import { describe, expect, it } from "vitest";
import { matchesTraceQuery } from "@/features/invocations/invocations-view";
import type { ConsoleSnapshot, InvocationSnapshot } from "@/lib/console-state";

const invocation = { id: "inv_1", agentId: "agent_codex", input: { task: "Create quarterly deck" }, status: "succeeded" } as InvocationSnapshot;
const state = {
  events: [{ id: "evt_1", invocationId: "inv_1", type: "application_result", data: { applicationId: "app_powerpoint" }, createdAt: "2026-07-25T00:00:00Z" }],
  evidenceLedger: [{ id: "ev_1", invocationId: "inv_1", summary: "slides verified" }],
  channelDeliveries: [{ id: "del_1", invocationId: "inv_1", channelId: "channel_wecom" }],
} as unknown as ConsoleSnapshot;

describe("unified Trace search", () => {
  it("matches task, Agent, Application, Channel, event, and evidence identifiers", () => {
    for (const query of ["quarterly", "agent_codex", "app_powerpoint", "channel_wecom", "evt_1", "ev_1"]) {
      expect(matchesTraceQuery(invocation, state, query), query).toBe(true);
    }
    expect(matchesTraceQuery(invocation, state, "unrelated")).toBe(false);
  });
});
