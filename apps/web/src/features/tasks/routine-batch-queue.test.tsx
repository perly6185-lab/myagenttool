import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RoutineBatchQueue } from "./routine-batch-queue";
import { routineWorkApi, type RoutineQueueItem } from "./routine-workflow";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function item(overrides: Partial<RoutineQueueItem> = {}): RoutineQueueItem {
  return {
    workItemId: "lwi_1",
    localRef: "LOCAL-1",
    title: "Process inquiry — RFQ-001",
    projectId: "prj_1",
    sourceId: "wfs_1",
    businessKey: "RFQ-001",
    definitionName: "Inquiry to quotation",
    routineVersion: 1,
    status: "running",
    revision: 2,
    waitingReason: null,
    ledgerQueuePosition: null,
    capacity: {
      limit: 2,
      active: 2,
      state: "ready",
      position: null,
      waitingSince: null,
    },
    progress: { completed: 1, total: 4 },
    currentStep: {
      key: "quotation",
      label: "Prepare quotation",
      kind: "generate",
      state: "running",
    },
    nextAction: "continue_step",
    updatedAt: "2026-07-29T00:00:00.000Z",
    ...overrides,
  };
}

describe("RoutineBatchQueue", () => {
  it("shows actionable and waiting inquiries without exposing scheduler internals", async () => {
    vi.spyOn(routineWorkApi, "listQueue").mockResolvedValue({
      items: [
        item(),
        item({
          workItemId: "lwi_2",
          localRef: "LOCAL-2",
          businessKey: "RFQ-002",
          status: "planned",
          waitingReason: "device_capacity",
          capacity: {
            limit: 2,
            active: 2,
            state: "waiting",
            position: 1,
            waitingSince: "2026-07-29T00:00:01.000Z",
          },
          progress: { completed: 0, total: 4 },
          currentStep: null,
          nextAction: "wait_capacity",
        }),
      ],
      summary: { total: 2, running: 1, waiting: 1, needsAction: 1 },
    });
    const onOpen = vi.fn();
    render(<RoutineBatchQueue projectId="prj_1" onOpen={onOpen} />);

    await waitFor(() => expect(
      screen.getByRole("progressbar", { name: "Progress RFQ-001" }),
    ).toBeTruthy());
    expect(screen.getByText("Waiting 1")).toBeTruthy();
    expect(screen.queryByText(/lock|executor|queue/i)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Open next action" }));
    expect(onOpen).toHaveBeenCalledWith("lwi_1");
    expect(screen.getByRole("progressbar", { name: "Progress RFQ-001" })
      .getAttribute("aria-valuenow")).toBe("25");
  });
});
