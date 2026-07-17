import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  InvocationEventHistory,
  mergeInvocationEventPages,
} from "@/features/invocations/invocation-event-history";
import type { InvocationEventSnapshot } from "@/lib/console-state";

const apiMock = vi.hoisted(() => ({
  listInvocationEvents: vi.fn(),
}));

vi.mock("@/lib/api-client", () => ({
  api: {
    listInvocationEvents: apiMock.listInvocationEvents,
  },
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("mergeInvocationEventPages", () => {
  it("deduplicates page boundaries and orders the lifecycle by time then id", () => {
    const duplicateFromArchive = event("evt_3", "2026-07-14T09:03:00.000Z", "archived duplicate");
    const duplicateFromHot = event("evt_3", "2026-07-14T09:03:00.000Z", "hot event three");

    expect(
      mergeInvocationEventPages([
        { events: [duplicateFromHot, event("evt_4", "2026-07-14T09:04:00.000Z", "event four")] },
        {
          events: [
            event("evt_2", "2026-07-14T09:02:00.000Z", "event two"),
            event("evt_1", "2026-07-14T09:02:00.000Z", "event one"),
            duplicateFromArchive,
          ],
        },
      ]).map((item) => [item.id, item.message]),
    ).toEqual([
      ["evt_1", "event one"],
      ["evt_2", "event two"],
      ["evt_3", "hot event three"],
      ["evt_4", "event four"],
    ]);
  });

  it("orders trailing numeric event ids across digit-width boundaries", () => {
    const createdAt = "2026-07-14T09:02:00.000Z";
    expect(
      mergeInvocationEventPages([{ events: [
        event("evt_demo_10000", createdAt, "ten thousand"),
        event("evt_demo_9999", createdAt, "nine thousand nine hundred ninety-nine"),
      ] }]).map((item) => item.id),
    ).toEqual(["evt_demo_9999", "evt_demo_10000"]);
  });

  it("keeps append order when the system clock moves backward", () => {
    expect(
      mergeInvocationEventPages([{ events: [
        event("evt_demo_42", "2026-07-14T09:02:00.000Z", "before clock rollback"),
        event("evt_demo_43", "2026-07-14T08:59:00.000Z", "after clock rollback"),
      ] }]).map((item) => item.id),
    ).toEqual(["evt_demo_42", "evt_demo_43"]);
  });
});

describe("InvocationEventHistory", () => {
  it("renders every event in a page instead of truncating the timeline at 40", async () => {
    apiMock.listInvocationEvents.mockResolvedValue({
      invocationId: "inv_long",
      events: Array.from({ length: 45 }, (_, index) =>
        event(
          `evt_${String(index + 1).padStart(2, "0")}`,
          `2026-07-14T09:${String(index).padStart(2, "0")}:00.000Z`,
          `lifecycle event ${index + 1}`,
        ),
      ),
      nextCursor: null,
      hasMore: false,
      retentionTruncated: false,
    });

    renderHistory(<InvocationEventHistory invocationId="inv_long" />);

    expect(await screen.findByText("lifecycle event 1")).toBeTruthy();
    expect(screen.getByText("lifecycle event 45")).toBeTruthy();
    expect(screen.getAllByText(/^lifecycle event /)).toHaveLength(45);
  });

  it("loads older pages, shows the pending state, and prepends them without duplicates", async () => {
    let resolveOlder!: (value: {
      invocationId: string;
      events: InvocationEventSnapshot[];
      nextCursor: null;
      hasMore: false;
      retentionTruncated: false;
    }) => void;
    const older = new Promise<Parameters<typeof resolveOlder>[0]>((resolve) => {
      resolveOlder = resolve;
    });
    apiMock.listInvocationEvents.mockImplementation(
      (_id: string, options: { before?: string }) =>
        options.before
          ? older
          : Promise.resolve({
              invocationId: "inv_pages",
              events: [
                event("evt_3", "2026-07-14T09:03:00.000Z", "event three"),
                event("evt_4", "2026-07-14T09:04:00.000Z", "event four"),
              ],
              nextCursor: "opaque-before",
              hasMore: true,
              retentionTruncated: false,
            }),
    );

    renderHistory(<InvocationEventHistory invocationId="inv_pages" />);
    fireEvent.click(await screen.findByRole("button", { name: "Load older" }));

    const loadingButton = await screen.findByRole("button", { name: "Loading older…" });
    expect((loadingButton as HTMLButtonElement).disabled).toBe(true);
    expect(apiMock.listInvocationEvents).toHaveBeenNthCalledWith(2, "inv_pages", {
      limit: 100,
      before: "opaque-before",
    });

    await act(async () => {
      resolveOlder({
        invocationId: "inv_pages",
        events: [
          event("evt_1", "2026-07-14T09:01:00.000Z", "event one"),
          event("evt_2", "2026-07-14T09:02:00.000Z", "event two"),
          event("evt_3", "2026-07-14T09:03:00.000Z", "archived duplicate"),
        ],
        nextCursor: null,
        hasMore: false,
        retentionTruncated: false,
      });
      await older;
    });

    await waitFor(() => {
      expect(screen.getAllByText(/^event /).map((node) => node.textContent)).toEqual([
        "event one",
        "event two",
        "event three",
        "event four",
      ]);
    });
    expect(screen.queryByRole("button", { name: "Load older" })).toBeNull();
  }, 15_000);

  it("clearly reports retention-truncated history", async () => {
    apiMock.listInvocationEvents.mockResolvedValue({
      invocationId: "inv_truncated",
      events: [event("evt_2", "2026-07-14T09:02:00.000Z", "retained event")],
      nextCursor: null,
      hasMore: false,
      retentionTruncated: true,
    });

    renderHistory(<InvocationEventHistory invocationId="inv_truncated" />);

    expect((await screen.findByRole("alert")).textContent).toContain(
      "History is retention-truncated. Some earliest lifecycle events are unavailable.",
    );
  });

  it("shows a load error instead of implying that the session is empty", async () => {
    apiMock.listInvocationEvents.mockRejectedValue(new Error("history unavailable"));

    renderHistory(<InvocationEventHistory invocationId="inv_error" />);

    expect((await screen.findByRole("alert")).textContent).toContain("history unavailable");
    expect(screen.queryByText("No session events")).toBeNull();
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
  });

  it("warns when a live refresh fails instead of silently presenting stale history", async () => {
    apiMock.listInvocationEvents
      .mockResolvedValueOnce({
        invocationId: "inv_live",
        events: [event("evt_1", "2026-07-14T09:01:00.000Z", "last known event")],
        nextCursor: null,
        hasMore: false,
        retentionTruncated: false,
      })
      .mockRejectedValue(new Error("refresh unavailable"));

    renderHistory(<InvocationEventHistory invocationId="inv_live" live />);

    expect(await screen.findByText("last known event")).toBeTruthy();
    expect((await screen.findByText(/Session history refresh failed/)).textContent).toContain(
      "Session history refresh failed; showing previously loaded events. refresh unavailable",
    );
    expect(screen.getByRole("button", { name: "Retry refresh" })).toBeTruthy();
    expect(screen.getByText("last known event")).toBeTruthy();
  }, 15_000);
});

function renderHistory(ui: ReactElement) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, refetchInterval: false },
      mutations: { retry: false },
    },
  });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

function event(id: string, createdAt: string, message: string): InvocationEventSnapshot {
  return { id, invocationId: "inv_pages", type: "log", level: "info", createdAt, message };
}
