import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ChannelsView } from "@/features/channels/channels-view";

const action = vi.hoisted(() => ({ execute: vi.fn((fn: () => Promise<unknown>) => fn()), retry: vi.fn(), reroute: vi.fn(), takeover: vi.fn() }));
vi.mock("@/data/use-console-state", () => ({ useConsoleState: () => ({ data: {
  channelOperations: [{ id: "chn_1", provider: "wecom", name: "Ops", status: "enabled", readiness: { callback: true }, ready: true, health: "ok", capabilityAllowlist: [], counts: { identities: 1, conversations: 1, events: 1, deliveries: 1, failedDeliveries: 0, injectionFlagged: 0 } }],
  channelDeliveries: [], projects: [],
  channelTaskRequests: [{ id: "ctr_1", channelId: "chn_1", projectId: "prj_1", issueNumber: 42, issueUrl: "https://example.test/42", title: "Repair failed release", status: "routed", stage: "run_failed", autoRunId: "run_1", runStatus: "failed", invocationId: "inv_1", invocationStatus: "failed", resultSummary: "Bridge disconnected", deliveryStatus: "failed_terminal", actions: { retry: true, reroute: true, takeover: true } }],
} }) }));
vi.mock("@/data/use-console-actions", () => ({
  useAsyncAction: () => ({ execute: action.execute, pending: false, error: null }),
  api: { retryChannelTask: action.retry, rerouteChannelTask: action.reroute, takeoverChannelTask: action.takeover },
}));

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("ChannelsView task operations", () => {
  it("shows trace links, understandable failure state, and recovery actions", async () => {
    render(<ChannelsView />);
    expect(screen.getByText("run failed")).toBeTruthy();
    expect(screen.getByText("Issue #42")).toBeTruthy();
    expect(screen.getByText("inv_1")).toBeTruthy();
    expect(screen.getByText("Bridge disconnected")).toBeTruthy();
    fireEvent.click(screen.getByText("Retry"));
    fireEvent.click(screen.getByText("Reroute"));
    fireEvent.click(screen.getByText("Take over"));
    expect(action.retry).toHaveBeenCalledWith("ctr_1");
    expect(action.reroute).toHaveBeenCalledWith("ctr_1");
    expect(action.takeover).toHaveBeenCalledWith("ctr_1");
  });
});
