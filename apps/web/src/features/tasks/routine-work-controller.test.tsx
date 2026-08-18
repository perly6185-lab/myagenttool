import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { i18n } from "@/lib/i18n";
import RoutineWorkController from "./routine-work-controller";
import type { RoutineWorkExecution } from "./routine-workflow";

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  requestSourceReview: vi.fn(),
  resumeRecovery: vi.fn(),
  bindLedger: vi.fn(),
  previewLedger: vi.fn(),
  listLedgerPreviews: vi.fn(),
  navigate: vi.fn(),
}));

vi.mock("@/hooks/use-page-navigation", () => ({
  usePageNavigation: () => mocks.navigate,
}));

vi.mock("@/hooks/use-visible-interval", () => ({
  useVisibleInterval: vi.fn(),
}));

vi.mock("@/data/use-console-actions", () => ({
  useAsyncAction: () => ({
    execute: async (action: () => Promise<unknown>) => {
      try {
        await action();
        return true;
      } catch {
        return false;
      }
    },
    pending: false,
    error: null,
  }),
}));

vi.mock("./routine-workflow", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./routine-workflow")>();
  return {
    ...actual,
    routineWorkApi: {
      ...actual.routineWorkApi,
      get: mocks.get,
      requestSourceReview: mocks.requestSourceReview,
      resumeRecovery: mocks.resumeRecovery,
      bindLedger: mocks.bindLedger,
      previewLedger: mocks.previewLedger,
      listLedgerPreviews: mocks.listLedgerPreviews,
    },
  };
});

function extractionFailure(): RoutineWorkExecution {
  return {
    workItemId: "wi_1",
    sourceId: "source-1",
    definition: { id: "routine_1", name: "Inquiry to quotation", version: 3 },
    run: {
      id: "run_1",
      status: "failed",
      revision: 7,
      waitingReason: null,
      cancellationRequestedAt: null,
      capacity: {
        limit: 2,
        active: 0,
        state: "ready",
        position: null,
        waitingSince: null,
      },
    },
    availableOrderTriggers: [],
    steps: [{
      key: "extract",
      label: "Extract inquiry",
      kind: "extract",
      required: true,
      dependsOn: [],
      configuration: {},
      run: {
        state: "failed",
        attempts: 1,
        errorCode: "routine_extract_confirmation_required",
        conditionOutcome: null,
        outputRefs: [],
      },
    }],
  };
}

describe("RoutineWorkController", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    window.history.replaceState(null, "", "/?section=task");
    await i18n.changeLanguage("en-US");
    mocks.get.mockResolvedValue({ execution: extractionFailure() });
    mocks.listLedgerPreviews.mockResolvedValue({ previews: [] });
  });

  afterEach(() => {
    cleanup();
  });

  it("persists a source review intent and resumes extraction when the user returns", async () => {
    const onChanged = vi.fn();
    const first = render(<RoutineWorkController workItemId="wi_1" onChanged={onChanged} />);
    const prepared = extractionFailure();
    prepared.run.revision = 8;
    prepared.recovery = {
      kind: "retry_after_source_review",
      stepKey: "extract",
      requestedAt: "2026-08-11T00:00:00.000Z",
    };
    mocks.requestSourceReview.mockResolvedValue({ execution: prepared });

    fireEvent.click(await screen.findByRole("button", { name: "Review recognized information" }));

    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith("workflowMemory"));
    expect(mocks.requestSourceReview).toHaveBeenCalledWith("wi_1", "extract", 7);
    expect(window.location.search).toContain("section=workflowMemory");
    expect(new URLSearchParams(window.location.search).get("returnWorkItemId")).toBe("wi_1");
    expect(new URLSearchParams(window.location.search).get("sourceId")).toBe("source-1");
    expect(window.location.hash).toBe("#workflow-file-review");

    first.unmount();
    const recovered = extractionFailure();
    recovered.run.status = "running";
    recovered.run.revision = 8;
    recovered.steps[0].run.state = "succeeded";
    recovered.steps[0].run.errorCode = null;
    recovered.recovery = null;
    mocks.get.mockResolvedValue({ execution: prepared });
    mocks.resumeRecovery.mockResolvedValue({
      execution: recovered,
      resumed: true,
      awaitingReview: false,
    });

    render(<RoutineWorkController workItemId="wi_1" onChanged={onChanged} />);

    await waitFor(() => expect(mocks.resumeRecovery).toHaveBeenCalledWith("wi_1", 8));
    expect(mocks.resumeRecovery).toHaveBeenCalledTimes(1);
    expect(onChanged).toHaveBeenCalledOnce();
  });

  it("binds an existing ledger inside the task and immediately prepares its preview", async () => {
    const current = extractionFailure();
    current.run.status = "running";
    current.steps[0] = {
      ...current.steps[0],
      key: "ledger",
      label: "Update inquiry ledger",
      kind: "ledger_upsert",
      configuration: {},
      run: { ...current.steps[0].run, state: "running", errorCode: null },
    };
    current.availableLedgers = [{
      id: "ldg_1",
      name: "Inquiry ledger",
      documentType: "inquiry_ledger",
      format: "csv",
      relativePath: "ledgers/inquiries.csv",
      sheet: null,
    }];
    mocks.get.mockResolvedValue({ execution: current });
    const bound = structuredClone(current);
    bound.run.revision = 8;
    bound.steps[0].configuration = { ledgerDefinitionId: "ldg_1" };
    mocks.bindLedger.mockResolvedValue({ execution: bound });
    mocks.previewLedger.mockResolvedValue({
      preview: {
        id: "preview_1",
        ledgerDefinitionId: "ldg_1",
        routineRunId: "run_1",
        routineStepKey: "ledger",
        businessKey: "RFQ-1",
        action: "insert",
        rowNumber: 2,
        changedCells: [],
        warnings: [],
        approvalRequired: true,
        state: "pending",
        waitingReason: null,
        waitingSince: null,
        queue: { state: "ready", position: null, waitingSince: null },
        expiresAt: "2026-08-11T01:00:00.000Z",
        revision: 1,
      },
    });
    const onChanged = vi.fn();
    render(<RoutineWorkController workItemId="wi_1" onChanged={onChanged} />);

    fireEvent.change(await screen.findByLabelText("Ledger to use"), {
      target: { value: "ldg_1" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Use this ledger" }));

    await waitFor(() => expect(mocks.bindLedger).toHaveBeenCalledWith("wi_1", "ledger", 7, "ldg_1"));
    expect(mocks.previewLedger).toHaveBeenCalledWith("ldg_1", "run_1", "ledger");
    expect(await screen.findByRole("button", { name: "Review and confirm" })).toBeTruthy();
    expect(onChanged).toHaveBeenCalledOnce();
  });
});
