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

function renderWorkbench() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <CommercialPilotWorkbench projectId="prj_a" />
    </QueryClientProvider>,
  );
}

beforeEach(async () => {
  await i18n.changeLanguage("en-US");
  mocks.get.mockReset();
  mocks.save.mockReset();
  mocks.collect.mockReset();
  mocks.sessionUser.mockReset();
  mocks.sessionUser.mockReturnValue({
    id: "usr_owner",
    teamId: "team_local",
    role: "owner",
  });
  mocks.get.mockResolvedValue(response());
  mocks.save.mockImplementation(async ({ draft }: { draft: CommercialPilotWorkbenchDraftInput }) =>
    response(draft));
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

    const workItem = await screen.findByRole("checkbox", { name: /WI-1/ });
    expect((workItem as HTMLInputElement).checked).toBe(false);
    fireEvent.click(workItem);
    expect(screen.getByText("case-01")).toBeTruthy();
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
});
