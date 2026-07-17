import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { createElement, type ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { InvocationRefusalHistory } from "@/features/invocations/invocation-refusal-history";

const apiMock = vi.hoisted(() => ({ listInvocationRefusals: vi.fn() }));
vi.mock("@/lib/api-client", () => ({ api: { listInvocationRefusals: apiMock.listInvocationRefusals } }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderWithClient(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(createElement(QueryClientProvider, { client }, ui));
}

describe("InvocationRefusalHistory", () => {
  it("renders nothing when a run had no refusals (rare — no clutter)", async () => {
    apiMock.listInvocationRefusals.mockResolvedValue({ invocationId: "inv_1", refusals: [], truncated: false });
    const { container } = renderWithClient(<InvocationRefusalHistory invocationId="inv_1" />);
    await waitFor(() => expect(apiMock.listInvocationRefusals).toHaveBeenCalledWith("inv_1"));
    expect(container.querySelector('[data-testid="invocation-refusals"]')).toBeNull();
  });

  it("renders refusals with category/code/summary, the PII-redacted and truncated badges", async () => {
    apiMock.listInvocationRefusals.mockResolvedValue({
      invocationId: "inv_1",
      truncated: true,
      refusals: [
        { id: "ref_1", category: "policy", code: "action_not_permitted", summary: "blocked the write", at: "2026-07-17T00:00:00.000Z", piiRedacted: true },
      ],
    });
    renderWithClient(<InvocationRefusalHistory invocationId="inv_1" />);
    await waitFor(() => expect(screen.getByText("policy")).toBeTruthy());
    expect(screen.getByText("action_not_permitted")).toBeTruthy();
    expect(screen.getByText("blocked the write")).toBeTruthy();
    expect(screen.getByText("PII redacted")).toBeTruthy();
    expect(screen.getByText("history may be incomplete")).toBeTruthy();
    expect(screen.getByText("Refusals (1)")).toBeTruthy();
  });
});
