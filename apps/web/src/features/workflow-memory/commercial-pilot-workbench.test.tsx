import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CommercialPilotWorkbench } from "@/features/workflow-memory/commercial-pilot-workbench";
import type {
  CommercialPilotWorkbench as CommercialPilotWorkbenchResponse,
  CommercialPilotWorkbenchDraftInput,
} from "@/features/workflow-memory/workflow-memory-api";
import { i18n } from "@/lib/i18n";

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  save: vi.fn(),
  collect: vi.fn(),
  compare: vi.fn(),
  export: vi.fn(),
  revoke: vi.fn(),
  prepare: vi.fn(),
  gaps: vi.fn(),
  submitReview: vi.fn(),
  rollout: vi.fn(),
  sessionUser: vi.fn(),
}));

vi.mock("@/features/workflow-memory/workflow-memory-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/features/workflow-memory/workflow-memory-api")>();
  return {
    ...actual,
    workflowMemoryApi: {
      ...actual.workflowMemoryApi,
      getBusinessPilotWorkbench: mocks.get,
      saveBusinessPilotWorkbench: mocks.save,
      collectBusinessPilotWorkbench: mocks.collect,
      compareBusinessPilotCollections: mocks.compare,
      exportBusinessPilotCollection: mocks.export,
      revokeBusinessPilotCollection: mocks.revoke,
      prepareBusinessPilotWorkbench: mocks.prepare,
      createBusinessPilotGapIssues: mocks.gaps,
      submitBusinessPilotReview: mocks.submitReview,
      updateBusinessPilotRollout: mocks.rollout,
    },
  };
});

vi.mock("@/lib/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-client")>();
  return {
    ...actual,
    getSessionUser: mocks.sessionUser,
  };
});

function response(
  draftPatch: Partial<CommercialPilotWorkbenchDraftInput> = {},
): CommercialPilotWorkbenchResponse {
  return {
    draft: {
      id: null,
      projectId: "prj_a",
      schemaVersion: 1,
      pilotId: "pilot-prj_a",
      description: "",
      dataClassification: "deidentified",
      consent: { confirmed: false, recordedAt: null, scope: "" },
      releaseReview: {
        confirmed: false,
        recordedAt: null,
        reviewerRole: "",
        performance: false,
        security: false,
        privacy: false,
        accessibility: false,
        localization: false,
        migration: false,
        rollback: false,
      },
      cases: [],
      safetyScenarios: [],
      ...draftPatch,
      thresholds: {
        minimumFormalCases: 10,
        documentRoleTop1: 0.8,
        relationshipTop1: 0.75,
      },
      revision: draftPatch.cases?.length ? 1 : 0,
      updatedAt: null,
      lastCollection: null,
    },
    progress: {
      caseCount: draftPatch.cases?.length ?? 0,
      requiredCaseCount: 10,
      completeCaseCount: 0,
      templateCount: 0,
      requiredTemplateCount: 2,
      outcomes: [],
      traits: [],
      safety: [],
      releaseReview: [],
      cases: [],
      missing: ["minimum_formal_cases", "consent_confirmation"],
      readyForCollection: false,
      validationErrors: [],
    },
    eligible: {
      workItems: [{
        id: "wi_1",
        localRef: "WI-1",
        title: "Prepare quotation",
        status: "completed",
        businessCaseId: "bc_1",
      }],
      relationshipArtifacts: [],
      safetyEvidence: [],
    },
    requiredSafetyScenarios: ["path_traversal"],
  };
}

function renderWorkbench(onOpenTask?: (workItemId: string, section: "process" | "assets") => void) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <CommercialPilotWorkbench projectId="prj_a" onOpenTask={onOpenTask} />
    </QueryClientProvider>,
  );
}

beforeEach(async () => {
  await i18n.changeLanguage("en-US");
  mocks.get.mockReset();
  mocks.save.mockReset();
  mocks.collect.mockReset();
  mocks.compare.mockReset();
  mocks.export.mockReset();
  mocks.revoke.mockReset();
  mocks.prepare.mockReset();
  mocks.gaps.mockReset();
  mocks.submitReview.mockReset();
  mocks.rollout.mockReset();
  mocks.sessionUser.mockReset();
  mocks.sessionUser.mockReturnValue({
    id: "usr_owner",
    teamId: "team_local",
    role: "owner",
  });
  mocks.get.mockResolvedValue(response());
  mocks.compare.mockResolvedValue({
    changes: {
      caseCount: 2,
      safetyPassed: 1,
      evidenceStateChanged: true,
      decisionChanged: false,
    },
  });
  mocks.save.mockImplementation(async ({ draft }: { draft: CommercialPilotWorkbenchDraftInput }) =>
    response(draft));
  mocks.prepare.mockImplementation(async () => {
    const prepared = response({
      consent: {
        confirmed: true,
        recordedAt: "2026-08-01T00:00:00.000Z",
        scope: "Authorized project cases",
      },
      cases: [{
        id: "case-01",
        workItemId: "wi_1",
        templateId: "default-a",
        traits: [],
        expectedDocumentRole: "inquiry",
        relationshipExpected: false,
        expectedOutcome: "no_order",
      }],
    });
    return { ...prepared, automation: {
      selectedCaseCount: 1,
      matchedSafetyCount: 0,
      eligibleCaseCount: 1,
      readyCaseCount: 0,
    } };
  });
  mocks.submitReview.mockResolvedValue(response());
});

afterEach(cleanup);

describe("CommercialPilotWorkbench", () => {
  it("does not expose the owner workbench to a viewer", () => {
    mocks.sessionUser.mockReturnValue({
      id: "usr_viewer",
      teamId: "team_local",
      role: "viewer",
    });
    renderWorkbench();
    expect(screen.queryByRole("button", { name: "Open pilot workbench" })).toBeNull();
    expect(mocks.get).not.toHaveBeenCalled();
  });

  it("requires explicit human case selection and saves only expected labels", async () => {
    renderWorkbench();
    await waitFor(() => expect(mocks.get).toHaveBeenCalledWith("prj_a"));
    fireEvent.click(screen.getByRole("button", { name: "Open pilot workbench" }));
    fireEvent.click(screen.getByRole("button", { name: "2. Authorized cases" }));

    const workItem = await screen.findByRole("checkbox", { name: /WI-1/ });
    expect((workItem as HTMLInputElement).checked).toBe(false);
    fireEvent.click(workItem);
    expect(screen.getByText("case-01")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "4. Release review" }));
    expect((screen.getByRole("button", {
      name: "Generate evidence package",
    }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Save pilot" }));
    await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(1));
    const body = mocks.save.mock.calls[0][0];
    expect(body.projectId).toBe("prj_a");
    expect(body.expectedRevision).toBe(0);
    expect(body.draft.cases).toEqual([expect.objectContaining({
      workItemId: "wi_1",
      expectedDocumentRole: "inquiry",
      expectedOutcome: "no_order",
    })]);
    expect(body.draft.cases[0]).not.toHaveProperty("observed");
  });

  it("shows a recoverable load error instead of an endless spinner", async () => {
    mocks.get.mockRejectedValueOnce(new Error("offline"));
    renderWorkbench();
    await waitFor(() => expect(mocks.get).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: "Open pilot workbench" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Pilot evidence could not be loaded.");
    expect(alert.textContent).toContain("offline");

    mocks.get.mockResolvedValueOnce(response());
    fireEvent.click(screen.getByRole("button", { name: "Retry loading" }));
    await waitFor(() => expect(mocks.get).toHaveBeenCalledTimes(2));
    expect(await screen.findByDisplayValue("pilot-prj_a")).toBeTruthy();
  });

  it("opens an incomplete case at the precise task section", async () => {
    const selected = response({
      cases: [{
        id: "case-01",
        workItemId: "wi_1",
        templateId: "default-a",
        traits: [],
        expectedDocumentRole: "inquiry",
        relationshipExpected: false,
        expectedOutcome: "no_order",
      }],
    });
    selected.progress.cases = [{
      id: "case-01",
      workItemId: "wi_1",
      state: "incomplete",
      missing: ["current_trigger_artifacts"],
    }];
    selected.eligible.workItems[0].nextAction = "assets";
    mocks.get.mockResolvedValue(selected);
    const onOpenTask = vi.fn();
    renderWorkbench(onOpenTask);
    await waitFor(() => expect(mocks.get).toHaveBeenCalledWith("prj_a"));
    fireEvent.click(screen.getByRole("button", { name: "Open pilot workbench" }));
    fireEvent.click(screen.getByRole("button", { name: "2. Authorized cases" }));
    fireEvent.click(await screen.findByRole("button", { name: "Resolve in task" }));
    expect(onOpenTask).toHaveBeenCalledWith("wi_1", "assets");
  });

  it("auto-prepares authorized cases without manually selecting each task", async () => {
    renderWorkbench();
    await waitFor(() => expect(mocks.get).toHaveBeenCalledWith("prj_a"));
    fireEvent.click(screen.getByRole("button", { name: "Open pilot workbench" }));
    fireEvent.change(screen.getByLabelText("Authorized scope"), {
      target: { value: "Authorized project cases" },
    });
    fireEvent.click(screen.getByRole("checkbox", {
      name: "I confirm these files are authorized for this local pilot.",
    }));
    fireEvent.click(screen.getByRole("button", { name: "Auto-prepare pilot" }));
    await waitFor(() => expect(mocks.prepare).toHaveBeenCalledWith({
      projectId: "prj_a",
      expectedRevision: 0,
      confirmed: true,
      dataClassification: "deidentified",
      consentScope: "Authorized project cases",
      pilotId: "pilot-prj_a",
    }));
    expect(await screen.findByText("case-01")).toBeTruthy();
  });

  it("lets an operator submit one independently attributed release review", async () => {
    mocks.sessionUser.mockReturnValue({
      id: "usr_operator",
      teamId: "team_local",
      role: "operator",
    });
    const operatorDraft = response();
    operatorDraft.draft.revision = 1;
    mocks.get.mockResolvedValue(operatorDraft);
    mocks.submitReview.mockResolvedValue({ ...operatorDraft, review: {
      dimension: "performance",
      status: "passed",
      reviewerId: "usr_operator",
    } });
    renderWorkbench();
    await waitFor(() => expect(mocks.get).toHaveBeenCalledWith("prj_a"));
    fireEvent.click(screen.getByRole("button", { name: "Open pilot workbench" }));
    expect((screen.getByRole("button", {
      name: "1. Data authorization",
    }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Performance Review result"), {
      target: { value: "passed" },
    });
    fireEvent.change(screen.getAllByLabelText("Review conclusion")[0], {
      target: { value: "Performance evidence passed" },
    });
    fireEvent.change(screen.getAllByLabelText("Evidence references (comma separated)")[0], {
      target: { value: "perf-evidence" },
    });
    fireEvent.click(screen.getAllByRole("button", { name: "Submit this review" })[0]);
    await waitFor(() => expect(mocks.submitReview).toHaveBeenCalledWith("performance", {
      projectId: "prj_a",
      expectedRevision: 1,
      status: "passed",
      note: "Performance evidence passed",
      evidenceIds: ["perf-evidence"],
    }));
  });

  it("compares an older evidence package with the current package", async () => {
    const withHistory = response();
    withHistory.history = [
      {
        id: "bpc_current",
        pilotId: "pilot-prj_a",
        draftRevision: 2,
        evidenceReceiptId: "receipt_current",
        collectedAt: "2026-08-01T10:00:00.000Z",
        evidenceState: "incomplete",
        decision: "no_go",
        caseCount: 3,
        safetyPassed: 2,
        safetyTotal: 10,
        current: true,
        revokedAt: null,
      },
      {
        id: "bpc_old",
        pilotId: "pilot-prj_a",
        draftRevision: 1,
        evidenceReceiptId: "receipt_old",
        collectedAt: "2026-07-31T10:00:00.000Z",
        evidenceState: "incomplete",
        decision: "no_go",
        caseCount: 1,
        safetyPassed: 1,
        safetyTotal: 10,
        current: false,
        revokedAt: null,
      },
    ];
    mocks.get.mockResolvedValue(withHistory);
    renderWorkbench();
    await waitFor(() => expect(mocks.get).toHaveBeenCalledWith("prj_a"));
    fireEvent.click(screen.getByRole("button", { name: "Open pilot workbench" }));
    fireEvent.click(screen.getByRole("button", { name: "4. Release review" }));
    fireEvent.click(await screen.findByRole("button", { name: "Compare with current" }));
    await waitFor(() => expect(mocks.compare).toHaveBeenCalledWith({
      projectId: "prj_a",
      fromId: "bpc_old",
      toId: "bpc_current",
    }));
    expect(screen.getByText("Version changes")).toBeTruthy();
  });

  it("uses human-readable Chinese labels for workflow enums", async () => {
    await i18n.changeLanguage("zh-CN");
    const localized = response({
      cases: [{
        id: "case-01",
        workItemId: "wi_1",
        templateId: "default-a",
        traits: ["restart"],
        expectedDocumentRole: "inquiry",
        relationshipExpected: false,
        expectedOutcome: "no_order",
      }],
    });
    localized.progress.outcomes = ["no_order"];
    localized.progress.traits = [{ id: "restart", complete: true }];
    localized.eligible.safetyEvidence = [{
      id: "path_traversal",
      evidenceKind: "event",
      evidenceId: "evt_path",
    }];
    mocks.get.mockResolvedValue(localized);

    renderWorkbench();
    await waitFor(() => expect(mocks.get).toHaveBeenCalledWith("prj_a"));
    fireEvent.click(screen.getByRole("button", { name: "打开试运行工作台" }));
    fireEvent.click(screen.getByRole("button", { name: "2. 经授权案例" }));

    expect(await screen.findByRole("option", { name: "询价单" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "未下单" })).toBeTruthy();
    expect(screen.getAllByText("中断恢复").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "3. 安全证据" }));
    expect(screen.getByText("路径穿越")).toBeTruthy();
    expect(screen.getByRole("option", { name: "事件 · 已验证" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "4. 发布评审" }));
    expect(screen.getByText("性能")).toBeTruthy();
    expect(screen.getAllByRole("option", { name: "待评审" }).length).toBe(7);
  });
});
