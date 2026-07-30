import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { InquiryIntakePanel } from "@/features/workflow-memory/inquiry-intake-panel";
import { i18n } from "@/lib/i18n";

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  scan: vi.fn(),
  inspect: vi.fn(),
  accept: vi.fn(),
}));

vi.mock("@/features/workflow-memory/workflow-memory-api", () => ({
  workflowMemoryApi: {
    listWorkflowIntakeObservations: mocks.list,
    scanWorkflowIncrementalIntake: mocks.scan,
    inspectWorkflowInquiryIntake: mocks.inspect,
    acceptWorkflowInquiryIntake: mocks.accept,
  },
}));

const source = {
  id: "wfs_a",
  projectId: "prj_a",
  name: "Commercial inbox",
  relativePath: "business/inquiries",
  readMode: "supported_text" as const,
  state: "active" as const,
  scanState: "ready" as const,
  scanRevision: 1,
  revision: 2,
  fileCount: 1,
  skippedCount: 0,
  truncated: false,
  lastScanAt: "2026-07-29T12:00:00.000Z",
  lastError: null,
};

const readyObservation = {
  id: "wio_a",
  projectId: "prj_a",
  sourceId: "wfs_a",
  relativePath: "RFQ-2026-101.md",
  name: "RFQ-2026-101.md",
  state: "ready" as const,
  reason: null,
  artifactId: "wfa_a",
  canonicalArtifactId: "wfa_a",
  revision: 3,
  updatedAt: "2026-07-29T12:00:00.000Z",
};

function renderPanel(onOpenTask = vi.fn()) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return {
    onOpenTask,
    ...render(
      <QueryClientProvider client={client}>
        <InquiryIntakePanel source={source} onOpenTask={onOpenTask} />
      </QueryClientProvider>,
    ),
  };
}

beforeEach(async () => {
  await i18n.changeLanguage("en-US");
  Object.values(mocks).forEach((mock) => mock.mockReset());
  mocks.list.mockResolvedValue({ observations: [readyObservation], count: 1 });
  mocks.scan.mockResolvedValue({
    source,
    intake: {
      scanRevision: 2,
      scannedEntries: 1,
      skipped: 0,
      truncated: false,
      observed: 0,
      waitingStable: 0,
      ready: 1,
      duplicate: 0,
      blocked: 0,
      unchanged: 0,
    },
    observations: [readyObservation],
  });
  mocks.inspect.mockResolvedValue({
    state: "needs_confirmation",
    observation: {
      id: "wio_a",
      sourceId: "wfs_a",
      artifactId: "wfa_a",
      relativePath: "RFQ-2026-101.md",
      revision: 3,
    },
    classification: {
      id: "bdc_a",
      revision: 1,
      documentType: "inquiry",
      confirmationState: "proposed",
      confidence: 0.96,
      fieldProposals: [
        {
          key: "inquiry_number",
          value: "RFQ-2026-101",
          normalizedValue: "RFQ-2026-101",
          confidence: 0.98,
          confirmationState: "proposed",
          evidenceRefs: [],
        },
        {
          key: "customer",
          value: "Acme",
          normalizedValue: "Acme",
          confidence: 0.9,
          confirmationState: "proposed",
          evidenceRefs: [],
        },
      ],
    },
    routines: [{
      id: "brd_a",
      name: "Inquiry to quotation",
      description: "Prepare quotation",
      version: 4,
      triggerDocumentTypes: ["inquiry"],
    }],
  });
  mocks.accept.mockResolvedValue({
    state: "triggered",
    replayed: false,
    receipt: { workItemId: "lwi_a" },
  });
});

afterEach(cleanup);

describe("InquiryIntakePanel", () => {
  it("checks the selected folder with one ordinary action", async () => {
    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: "Check for new inquiries" }));
    await waitFor(() => expect(mocks.scan).toHaveBeenCalledWith("wfs_a"));
  });

  it("requires a review dialog and explicit confirmation before creating a task", async () => {
    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: "Review inquiry" }));
    const dialog = await screen.findByRole("dialog", { name: "Confirm the new inquiry" });
    expect(dialog.textContent).toContain("RFQ-2026-101.md");
    expect(dialog.textContent).toContain("Inquiry to quotation · v4");
    expect(mocks.accept).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("Customer"), { target: { value: "Acme Ltd" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm and create inquiry task" }));
    await waitFor(() => expect(mocks.accept).toHaveBeenCalledTimes(1));
    expect(mocks.accept).toHaveBeenCalledWith(
      "wio_a",
      expect.objectContaining({
        expectedRevision: 3,
        routineDefinitionId: "brd_a",
        confirmed: true,
        fieldCorrections: { customer: "Acme Ltd" },
      }),
    );
  });

  it("opens the created local task and does not offer a second create action", async () => {
    const onOpenTask = vi.fn();
    mocks.list.mockResolvedValue({
      count: 1,
      observations: [{
        ...readyObservation,
        state: "triggered",
        receipt: {
          id: "wir_a",
          businessKey: "RFQ-2026-101",
          routineDefinitionId: "brd_a",
          routineVersion: 4,
          businessCaseId: "bcs_a",
          workItemId: "lwi_a",
          workItemLocalRef: "LOCAL-101",
          routineRunId: "rrn_a",
          state: "triggered",
          triggeredAt: "2026-07-29T12:00:00.000Z",
        },
      }],
    });
    renderPanel(onOpenTask);
    expect(await screen.findByText("Task created")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Review inquiry" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Open task" }));
    expect(onOpenTask).toHaveBeenCalledWith("lwi_a");
  });

  it("presents the primary intake action and state in zh-CN", async () => {
    await i18n.changeLanguage("zh-CN");
    renderPanel();
    expect(await screen.findByRole("button", { name: "检查新询价" })).toBeTruthy();
    expect(await screen.findByText("可以确认")).toBeTruthy();
    expect(screen.getByRole("button", { name: "查看询价" })).toBeTruthy();
  });
});
