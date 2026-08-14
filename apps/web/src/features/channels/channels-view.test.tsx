import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ChannelsView } from "@/features/channels/channels-view";

const action = vi.hoisted(() => ({
  execute: vi.fn((fn: () => Promise<unknown>) => fn()),
  retry: vi.fn(),
  reroute: vi.fn(),
  takeover: vi.fn(),
  listInteractions: vi.fn(async () => ({
    interactions: [
      { id: "evt_1", direction: "inbound", type: "text", content: "你好，帮我查一下发布状态", attachments: [], status: "imported", createdAt: "2026-08-13T12:00:00.000Z", conversationId: "conv_1" },
      { id: "del_1", direction: "outbound", type: "file", content: "发布报告", attachments: [{ id: "asset_1", name: "release-report.pdf", family: "pdf", mimeType: "application/pdf", size: 1024, projectId: "prj_1", path: "release-report.pdf" }], status: "delivered", createdAt: "2026-08-13T12:01:00.000Z", conversationId: "conv_1" },
    ],
    nextCursor: null,
    count: 2,
  })),
}));
vi.mock("@/data/use-console-state", () => ({ useConsoleState: () => ({ data: {
  channelOperations: [{ id: "chn_1", provider: "wecom", name: "Ops", status: "enabled", readiness: { callback: true }, ready: true, health: "ok", capabilityAllowlist: [], counts: { identities: 1, conversations: 1, events: 1, deliveries: 1, failedDeliveries: 0, injectionFlagged: 0 } }],
  channelDeliveries: [], projects: [],
  channelTaskRequests: [{ id: "ctr_1", channelId: "chn_1", projectId: "prj_1", issueNumber: 42, issueUrl: "https://example.test/42", title: "Repair failed release", status: "routed", stage: "run_failed", autoRunId: "run_1", runStatus: "failed", invocationId: "inv_1", invocationStatus: "failed", resultSummary: "Bridge disconnected", deliveryStatus: "failed_terminal", actions: { retry: true, reroute: true, takeover: true } }],
} }) }));
vi.mock("@/data/use-console-actions", () => ({
  useAsyncAction: () => ({ execute: action.execute, pending: false, error: null }),
  api: { retryChannelTask: action.retry, rerouteChannelTask: action.reroute, takeoverChannelTask: action.takeover, listChannelInteractions: action.listInteractions },
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

  it("opens the interaction timeline and shows inbound and outbound records", async () => {
    render(<ChannelsView />);
    fireEvent.click(screen.getByText("View interaction records"));

    expect(await screen.findByTestId("channel-interactions")).toBeTruthy();
    expect(await screen.findByText("你好，帮我查一下发布状态")).toBeTruthy();
    expect(await screen.findByText("发布报告")).toBeTruthy();
    expect(await screen.findByText(/release-report\.pdf/)).toBeTruthy();
    expect(action.listInteractions).toHaveBeenCalledWith("chn_1", expect.objectContaining({ limit: 50, cursor: null }));
  });
});
