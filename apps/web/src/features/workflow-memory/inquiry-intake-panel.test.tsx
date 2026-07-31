import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { InquiryIntakePanel } from "@/features/workflow-memory/inquiry-intake-panel";
import { ApiError } from "@/lib/api-client";
import { i18n } from "@/lib/i18n";

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  scanSource: vi.fn(),
  scan: vi.fn(),
  inspect: vi.fn(),
  accept: vi.fn(),
  ocrReadiness: vi.fn(),
  ocr: vi.fn(),
  cancelOcr: vi.fn(),
  ocrStatus: vi.fn(),
}));

vi.mock("@/features/workflow-memory/workflow-memory-api", () => ({
  workflowMemoryApi: {
    listWorkflowIntakeObservations: mocks.list,
    scanWorkflowSource: mocks.scanSource,
    scanWorkflowIncrementalIntake: mocks.scan,
    inspectWorkflowInquiryIntake: mocks.inspect,
    acceptWorkflowInquiryIntake: mocks.accept,
    getWorkflowOcrReadiness: mocks.ocrReadiness,
    ocrWorkflowArtifact: mocks.ocr,
    cancelWorkflowOcrArtifact: mocks.cancelOcr,
    getWorkflowOcrStatus: mocks.ocrStatus,
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
  artifactRevision: 2,
  extraction: {
    state: "ready" as const,
    pageCount: null,
    characterCount: 100,
    providerId: null,
    localOnly: null,
  },
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
  window.myagenttoolDesktop = undefined;
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
      supportingObservations: [],
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
  mocks.ocrReadiness.mockResolvedValue({
    state: "ready",
    providerId: "macos-vision",
    reason: null,
    localOnly: true,
    supportedExtensions: [".pdf", ".png", ".jpg", ".jpeg", ".webp"],
  });
  mocks.ocr.mockResolvedValue({ artifact: {}, replayed: false });
  mocks.cancelOcr.mockResolvedValue({ artifactId: "wfa_scanned", cancellationRequested: true });
  mocks.ocrStatus.mockResolvedValue({
    state: "running",
    completedPages: 3,
    totalPages: 6,
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

  it("adds a governed multi-file case and reviews one primary inquiry", async () => {
    const primary = {
      ...readyObservation,
      id: "wio_new",
      relativePath: "incoming/case/inquiry.txt",
      name: "inquiry.txt",
    };
    const supporting = {
      ...readyObservation,
      id: "wio_output",
      artifactId: "wfa_output",
      canonicalArtifactId: "wfa_output",
      relativePath: "incoming/case/case-summary.xlsx",
      name: "case-summary.xlsx",
    };
    const pickWorkflowCaseFiles = vi.fn().mockResolvedValue({
      selectionId: "selection-1",
      files: [
        { name: "inquiry.txt", extension: "txt", size: 100, readiness: "ready" },
        { name: "case-summary.xlsx", extension: "xlsx", size: 200, readiness: "ready" },
      ],
    });
    const stageWorkflowCase = vi.fn().mockResolvedValue({
      requestId: "request-1",
      caseDirectory: "incoming/case",
      primaryRelativePath: primary.relativePath,
      supportingRelativePaths: [supporting.relativePath],
      supportingFileRoles: { [supporting.relativePath]: "historical_output" },
      files: [],
      authorizationMode: "deidentified",
      recordedAt: "2026-07-30T12:00:00.000Z",
    });
    window.myagenttoolDesktop = { pickWorkflowCaseFiles, stageWorkflowCase };
    mocks.scan.mockResolvedValue({
      source,
      intake: {
        scanRevision: 2,
        scannedEntries: 2,
        skipped: 0,
        truncated: false,
        observed: 2,
        waitingStable: 0,
        ready: 2,
        duplicate: 0,
        blocked: 0,
        unchanged: 0,
      },
      observations: [primary, supporting],
    });
    mocks.list.mockResolvedValue({ observations: [primary, supporting], count: 2 });
    mocks.inspect.mockResolvedValue({
      state: "needs_confirmation",
      observation: {
        id: primary.id,
        sourceId: "wfs_a",
        artifactId: "wfa_a",
        relativePath: primary.relativePath,
        revision: 3,
        supportingObservations: [{
          id: supporting.id,
          artifactId: "wfa_output",
          relativePath: supporting.relativePath,
          name: supporting.name,
          family: "spreadsheet",
          extractionState: "ready",
          role: "historical_output",
          documentType: "inquiry_ledger",
          pairingEvidence: [{ kind: "shared_filename_case_key", value: "case" }],
        }],
      },
      classification: {
        id: "bdc_a",
        revision: 1,
        documentType: "inquiry",
        confirmationState: "proposed",
        confidence: 0.96,
        fieldProposals: [{
          key: "inquiry_number",
          value: "RFQ-2026-101",
          normalizedValue: "RFQ-2026-101",
          confidence: 0.98,
          confirmationState: "proposed",
          evidenceRefs: [],
        }],
      },
      routines: [{
        id: "brd_a",
        name: "Inquiry to quotation",
        description: "Prepare quotation",
        version: 4,
        triggerDocumentTypes: ["inquiry"],
      }],
    });

    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: "Add real case" }));
    const addDialog = await screen.findByRole("dialog", { name: "Add one real business case" });
    fireEvent.click(screen.getByRole("button", { name: "Choose files" }));
    expect(await screen.findByText("inquiry.txt")).toBeTruthy();
    expect(screen.getByLabelText("case-summary.xlsx role")).toHaveProperty(
      "value",
      "historical_output",
    );
    fireEvent.click(screen.getByLabelText("I confirm I may use these files in this local workflow."));
    fireEvent.click(screen.getByRole("button", { name: "Add and review" }));

    await waitFor(() => expect(stageWorkflowCase).toHaveBeenCalledWith(expect.objectContaining({
      sourceId: "wfs_a",
      selectionId: "selection-1",
      primaryKey: "file:0",
      authorizationMode: "deidentified",
      supportingRoles: { "file:1": "historical_output" },
      confirmed: true,
    })));
    await waitFor(() => expect(mocks.inspect).toHaveBeenCalledWith(
      "wio_new",
      ["wio_output"],
      { wio_output: "historical_output" },
    ));
    expect(await screen.findByRole("dialog", { name: "Confirm the new inquiry" })).toBeTruthy();
    expect(screen.getByText(/case-summary\.xlsx · Historical output · ready/)).toBeTruthy();
    expect(addDialog.isConnected).toBe(false);
  });

  it("continues a newly added raster image directly into local OCR", async () => {
    const scanned = {
      ...readyObservation,
      id: "wio_added_scan",
      artifactId: "wfa_added_scan",
      canonicalArtifactId: "wfa_added_scan",
      artifactRevision: 4,
      relativePath: "incoming/dma/97-DMA.png",
      name: "97-DMA.png",
      extraction: {
        state: "needs_ocr" as const,
        pageCount: 1,
        characterCount: 0,
        providerId: null,
        localOnly: null,
      },
    };
    const output = {
      ...readyObservation,
      id: "wio_added_output",
      artifactId: "wfa_added_output",
      canonicalArtifactId: "wfa_added_output",
      relativePath: "incoming/dma/97-DMA-summary.xlsx",
      name: "97-DMA-summary.xlsx",
    };
    const pickWorkflowCaseFiles = vi.fn().mockResolvedValue({
      selectionId: "selection-scanned",
      files: [
        { name: scanned.name, extension: "png", size: 1_000, readiness: "needs_ocr" },
        { name: output.name, extension: "xlsx", size: 200, readiness: "ready" },
      ],
    });
    const stageWorkflowCase = vi.fn().mockResolvedValue({
      requestId: "request-scanned",
      caseDirectory: "incoming/dma",
      primaryRelativePath: scanned.relativePath,
      supportingRelativePaths: [output.relativePath],
      supportingFileRoles: { [output.relativePath]: "historical_output" },
      files: [],
      authorizationMode: "deidentified",
      recordedAt: "2026-07-30T12:00:00.000Z",
    });
    window.myagenttoolDesktop = { pickWorkflowCaseFiles, stageWorkflowCase };
    mocks.scan.mockResolvedValue({
      source,
      intake: {
        scanRevision: 2,
        scannedEntries: 2,
        skipped: 0,
        truncated: false,
        observed: 2,
        waitingStable: 0,
        ready: 2,
        duplicate: 0,
        blocked: 0,
        unchanged: 0,
      },
      observations: [scanned, output],
    });
    mocks.list.mockResolvedValue({ observations: [scanned, output], count: 2 });
    mocks.inspect.mockRejectedValue(new ApiError(
      "workflow_business_analysis_needs_ocr",
      "OCR required",
      409,
    ));

    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: "Add real case" }));
    fireEvent.click(screen.getByRole("button", { name: "Choose files" }));
    expect((await screen.findAllByText(scanned.name)).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByLabelText("I confirm I may use these files in this local workflow."));
    fireEvent.click(screen.getByRole("button", { name: "Add and review" }));

    expect(await screen.findByRole("dialog", { name: "Read this scanned file locally" })).toBeTruthy();
    expect(screen.getByText("Image")).toBeTruthy();
    expect(mocks.inspect).toHaveBeenCalledWith(
      scanned.id,
      [output.id],
      { [output.id]: "historical_output" },
    );
  });

  it("retries review without copying an already staged case again", async () => {
    const primary = {
      ...readyObservation,
      id: "wio_retry",
      relativePath: "incoming/retry/inquiry.txt",
      name: "inquiry.txt",
    };
    const pickWorkflowCaseFiles = vi.fn().mockResolvedValue({
      selectionId: "selection-retry",
      files: [{ name: "inquiry.txt", extension: "txt", size: 100, readiness: "ready" }],
    });
    const stageWorkflowCase = vi.fn().mockResolvedValue({
      requestId: "request-retry",
      caseDirectory: "incoming/retry",
      primaryRelativePath: primary.relativePath,
      supportingRelativePaths: [],
      supportingFileRoles: {},
      files: [],
      authorizationMode: "deidentified",
      recordedAt: "2026-07-30T12:00:00.000Z",
    });
    window.myagenttoolDesktop = { pickWorkflowCaseFiles, stageWorkflowCase };
    mocks.scan
      .mockRejectedValueOnce(new Error("Scanner temporarily unavailable"))
      .mockResolvedValueOnce({
        source,
        intake: {
          scanRevision: 2,
          scannedEntries: 1,
          skipped: 0,
          truncated: false,
          observed: 1,
          waitingStable: 0,
          ready: 1,
          duplicate: 0,
          blocked: 0,
          unchanged: 0,
        },
        observations: [primary],
      });
    mocks.list.mockResolvedValue({ observations: [primary], count: 1 });

    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: "Add real case" }));
    fireEvent.click(screen.getByRole("button", { name: "Choose files" }));
    expect((await screen.findAllByText("inquiry.txt")).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByLabelText("I confirm I may use these files in this local workflow."));
    fireEvent.click(screen.getByRole("button", { name: "Add and review" }));

    expect((await screen.findByRole("alert")).textContent).toContain("Scanner temporarily unavailable");
    fireEvent.click(screen.getByRole("button", { name: "Retry review" }));
    await waitFor(() => expect(mocks.inspect).toHaveBeenCalledWith("wio_retry", [], {}));
    expect(stageWorkflowCase).toHaveBeenCalledTimes(1);
  });

  it("requires explicit confirmation before local OCR and resumes inquiry review", async () => {
    let finishOcr!: (value: { artifact: object; replayed: boolean }) => void;
    mocks.ocr.mockImplementation(() => new Promise((resolve) => {
      finishOcr = resolve;
    }));
    const scanned = {
      ...readyObservation,
      id: "wio_scanned",
      name: "97-动态热机械分析仪DMA.pdf",
      relativePath: "incoming/97/97-动态热机械分析仪DMA.pdf",
      artifactId: "wfa_scanned",
      canonicalArtifactId: "wfa_scanned",
      artifactRevision: 7,
      extraction: {
        state: "needs_ocr" as const,
        pageCount: 6,
        characterCount: 0,
        providerId: null,
        localOnly: null,
      },
    };
    const recognized = {
      ...scanned,
      artifactRevision: 8,
      extraction: {
        state: "ready" as const,
        pageCount: 6,
        characterCount: 4_635,
        providerId: "macos-vision",
        localOnly: true,
      },
    };
    mocks.list
      .mockResolvedValueOnce({ observations: [scanned], count: 1 })
      .mockResolvedValue({ observations: [recognized], count: 1 });

    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: "Run local OCR" }));
    const dialog = await screen.findByRole("dialog", { name: "Read this scanned file locally" });
    expect(dialog.textContent).toContain("6");
    await screen.findByText("macos-vision");
    expect(mocks.ocr).not.toHaveBeenCalled();
    const submit = screen.getByRole("button", { name: "Read and continue" });
    expect(submit).toHaveProperty("disabled", true);

    fireEvent.click(screen.getByLabelText("I confirm that this local file may be processed by OCR."));
    fireEvent.click(submit);
    await waitFor(() => expect(mocks.ocr).toHaveBeenCalledWith("wfa_scanned", {
      expectedRevision: 7,
      confirmed: true,
    }));
    expect(await screen.findByText("3/6")).toBeTruthy();
    finishOcr({ artifact: {}, replayed: false });
    await waitFor(() => expect(mocks.inspect).toHaveBeenCalledWith("wio_scanned", [], {}));
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
