import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { createElement, type ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { InvocationDispatchHealth } from "@/features/devices/invocation-dispatch-health";

const apiMock = vi.hoisted(() => ({ getInvocationDispatchHealth: vi.fn() }));
vi.mock("@/lib/api-client", () => ({ api: { getInvocationDispatchHealth: apiMock.getInvocationDispatchHealth } }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderWithClient(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(createElement(QueryClientProvider, { client }, ui));
}

const base = {
  capacity: { maxConcurrency: 3, inFlight: 1, utilization: 0.33, atCapacity: false },
  queue: { depth: 0, byReason: {}, items: [] },
  stats: { sampleSize: 0, indeterminate: true, medianMsToDispatch: null, redeliveryRate: null, exhaustedCount: 0 },
  reliability: { failover: { attempts: 0, recovered: 0, exhausted: 0, latest: [] }, claims: { active: 0, expired: 0, nextExpiryAt: null }, intervention: { required: 0, items: [] } },
};

describe("InvocationDispatchHealth", () => {
  it("shows capacity and a clear-queue message when nothing is waiting", async () => {
    apiMock.getInvocationDispatchHealth.mockResolvedValue(base);
    renderWithClient(<InvocationDispatchHealth />);
    await waitFor(() => expect(screen.getByText("1/3 in flight")).toBeTruthy());
    expect(screen.getByText(/Queue clear/)).toBeTruthy();
    expect(screen.getByText(/not enough data/)).toBeTruthy();
  });

  it("lists queued invocations with a plain-language blocking reason and wait time", async () => {
    apiMock.getInvocationDispatchHealth.mockResolvedValue({
      capacity: { maxConcurrency: 1, inFlight: 1, utilization: 1, atCapacity: true },
      queue: {
        depth: 2,
        byReason: { waiting_concurrency: 1, agent_unhealthy: 1 },
        items: [
          { invocationId: "inv_1", agentId: "agt_a", agentName: "Claude CLI", deliveryState: "queued", dispatchAttempts: 2, queuedForMs: 600_000, blockedReason: "waiting_concurrency" },
          { invocationId: "inv_2", agentId: "agt_b", agentName: null, deliveryState: "queued", dispatchAttempts: 1, queuedForMs: 5_000, blockedReason: "agent_unhealthy" },
        ],
      },
      stats: { sampleSize: 12, indeterminate: false, medianMsToDispatch: 4_000, redeliveryRate: 0.25, exhaustedCount: 1 },
      reliability: { failover: { attempts: 2, recovered: 1, exhausted: 1, latest: [] }, claims: { active: 1, expired: 2, nextExpiryAt: "2026-07-18T01:00:00Z" }, intervention: { required: 1, items: [{ autoRunId: "run_1", invocationId: "inv_2", reason: "stuck", state: "needs_human" }] } },
    });
    renderWithClient(<InvocationDispatchHealth />);
    await waitFor(() => expect(screen.getByText("Waiting for a free slot")).toBeTruthy());
    expect(screen.getByText("Agent unhealthy")).toBeTruthy();
    expect(screen.getByText("Claude CLI")).toBeTruthy();
    expect(screen.getByText("1/1 in flight")).toBeTruthy();
    expect(screen.getByText(/·2 tries/)).toBeTruthy();
    // Stats past the sample floor: median + redelivery + exhausted.
    expect(screen.getByText(/redelivery/)).toBeTruthy();
    expect(screen.getByText(/exhausted/)).toBeTruthy();
    expect(screen.getByText("1/2 recovered")).toBeTruthy();
    expect(screen.getByText("1 need review")).toBeTruthy();
  });

  it("surfaces a failed fetch distinctly (not a silent empty queue)", async () => {
    apiMock.getInvocationDispatchHealth.mockRejectedValue(new Error("boom"));
    const { container } = renderWithClient(<InvocationDispatchHealth />);
    await waitFor(() => expect(container.querySelector('[data-testid="dispatch-health-error"]')).not.toBeNull());
    expect(screen.getByText("Dispatch health unavailable")).toBeTruthy();
    expect(container.querySelector('[data-testid="dispatch-health-queue"]')).toBeNull();
  });
});
